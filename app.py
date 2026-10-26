from __future__ import annotations

import asyncio
import json
import os
import secrets
import shutil
import stat
import subprocess
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

APP_NAME = "AI Creative Studio — Colab Bridge"
TASKS: dict[str, dict[str, Any]] = {}
MAX_CODE_CHARS = int(os.getenv("MAX_CODE_CHARS", "20000"))
DEFAULT_TIMEOUT = int(os.getenv("COLAB_TIMEOUT_SECONDS", "300"))


def _write_credentials() -> dict[str, Any]:
    raw = os.getenv("COLAB_CREDENTIALS", "").strip()
    if not raw:
        return {"configured": False, "message": "COLAB_CREDENTIALS is not set"}

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("COLAB_CREDENTIALS must contain valid JSON") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("COLAB_CREDENTIALS must be a JSON object")

    colab_path = Path.home() / ".config" / "colab-mcp" / "credentials.json"
    colab_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(colab_path.parent, 0o700)
    colab_path.write_text(json.dumps(parsed), encoding="utf-8")
    os.chmod(colab_path, 0o600)

    # ADC is a different credential contract. Do not copy arbitrary Colab
    # credentials into it; only install JSON that declares a known ADC type.
    adc_type = parsed.get("type")
    adc_path = Path.home() / ".config" / "gcloud" / "application_default_credentials.json"
    adc_written = False
    if adc_type in {"authorized_user", "service_account", "external_account", "impersonated_service_account"}:
        adc_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(adc_path.parent, 0o700)
        adc_path.write_text(json.dumps(parsed), encoding="utf-8")
        os.chmod(adc_path, 0o600)
        adc_written = True

    return {
        "configured": True,
        "colab_credentials_written": True,
        "adc_credentials_written": adc_written,
        "adc_reason": None if adc_written else "Skipped: JSON does not declare a recognized Google ADC credential type",
    }


def _require_bridge_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("BRIDGE_API_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="BRIDGE_API_TOKEN is not configured; execution API is disabled")
    scheme, _, supplied = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Missing or invalid Bearer token")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        app.state.credentials_status = _write_credentials()
    except Exception as exc:
        # Do not log credential contents or exception payloads that might
        # accidentally contain sensitive material.
        app.state.credentials_status = {"configured": False, "error": type(exc).__name__}
    yield


app = FastAPI(title=APP_NAME, version="1.0.0", lifespan=lifespan)


class RunRequest(BaseModel):
    code: str = Field(min_length=1, max_length=MAX_CODE_CHARS)
    timeout_seconds: int = Field(default=DEFAULT_TIMEOUT, ge=5, le=1800)
    tool_name: str | None = Field(default=None, max_length=128)


class TriggerRequest(BaseModel):
    event_type: str = Field(default="colab_bridge_run", min_length=1, max_length=100)
    client_payload: dict[str, Any] = Field(default_factory=dict)


@app.get("/")
async def health() -> dict[str, Any]:
    credentials = getattr(app.state, "credentials_status", {"configured": False})
    return {
        "service": APP_NAME,
        "status": "ok",
        "time_utc": datetime.now(timezone.utc).isoformat(),
        "credentials": credentials,
        "execution_configured": bool(os.getenv("COLAB_MCP_COMMAND")),
        "note": "Health status does not prove that a live Colab notebook is connected.",
    }


@app.get("/health")
async def health_alias() -> dict[str, Any]:
    return await health()


async def _execute_colab(task_id: str, code: str, timeout_seconds: int, requested_tool: str | None) -> None:
    TASKS[task_id]["status"] = "running"
    TASKS[task_id]["started_at"] = datetime.now(timezone.utc).isoformat()
    try:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        # Google Colab MCP is distributed from the official Git repository,
        # not as the previously configured @google/colab-mcp-server npm package.
        # Override this command only if the official server's documented
        # invocation changes or a compatible bridge is supplied.
        command = os.getenv("COLAB_MCP_COMMAND", "").strip()
        if not command:
            raise RuntimeError(
                "COLAB_MCP_COMMAND is unset. Configure the official Colab MCP server "
                "command and ensure it can reach an authenticated live Colab browser session."
            )
        import shlex
        parts = shlex.split(command)
        if not parts:
            raise RuntimeError("COLAB_MCP_COMMAND is empty")
        params = StdioServerParameters(command=parts[0], args=parts[1:], env=os.environ.copy())

        async with asyncio.timeout(timeout_seconds):
            async with stdio_client(params) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.list_tools()
                    tools = result.tools
                    public_tools = [{"name": t.name, "description": (t.description or "")[:300]} for t in tools]
                    chosen = next((t for t in tools if t.name == requested_tool), None) if requested_tool else None
                    if chosen is None and not requested_tool:
                        chosen = next((t for t in tools if any(w in t.name.lower() for w in ("execute", "run_code", "python", "notebook"))), None)
                    if chosen is None:
                        raise RuntimeError("No compatible code-execution tool found; discovered: " + ", ".join(t.name for t in tools))
                    schema = getattr(chosen, "inputSchema", {}) or {}
                    properties = schema.get("properties", {})
                    code_key = next((k for k in properties if k.lower() in {"code", "python_code", "source", "cell", "content"}), None)
                    if not code_key:
                        raise RuntimeError(f"Tool {chosen.name} has no recognized code input; inspect its input schema.")
                    tool_result = await session.call_tool(chosen.name, {code_key: code})
                    content = []
                    for item in getattr(tool_result, "content", []) or []:
                        if getattr(item, "text", None) is not None:
                            content.append(item.text)
                    TASKS[task_id].update({
                        "status": "completed" if not getattr(tool_result, "isError", False) else "failed",
                        "tool_name": chosen.name,
                        "discovered_tools": public_tools,
                        "output": "\n".join(content)[:50000],
                        "is_error": bool(getattr(tool_result, "isError", False)),
                    })
    except TimeoutError:
        TASKS[task_id].update({"status": "timeout", "error": f"Execution exceeded {timeout_seconds} seconds"})
    except Exception as exc:
        TASKS[task_id].update({"status": "failed", "error": f"{type(exc).__name__}: {str(exc)[:1500]}"})
    finally:
        TASKS[task_id]["finished_at"] = datetime.now(timezone.utc).isoformat()


@app.post("/run", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(_require_bridge_token)])
async def run_code(body: RunRequest, background_tasks: BackgroundTasks) -> dict[str, str]:
    if not os.getenv("COLAB_CREDENTIALS", "").strip():
        raise HTTPException(status_code=503, detail="COLAB_CREDENTIALS is not configured")
    task_id = str(uuid.uuid4())
    TASKS[task_id] = {
        "task_id": task_id,
        "status": "queued",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    background_tasks.add_task(_execute_colab, task_id, body.code, body.timeout_seconds, body.tool_name)
    return {"task_id": task_id, "status": "queued", "status_url": f"/tasks/{task_id}"}


@app.get("/tasks/{task_id}", dependencies=[Depends(_require_bridge_token)])
async def task_status(task_id: str) -> dict[str, Any]:
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found (in-memory task state is lost on restart)")
    return task


@app.post("/trigger-action", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(_require_bridge_token)])
async def trigger_action(body: TriggerRequest) -> dict[str, Any]:
    token = os.getenv("GITHUB_DISPATCH_TOKEN", "").strip()
    repository = os.getenv("GITHUB_REPOSITORY", "").strip()
    if not token or not repository or "/" not in repository:
        raise HTTPException(status_code=503, detail="Configure GITHUB_DISPATCH_TOKEN and GITHUB_REPOSITORY (owner/repo)")
    url = f"https://api.github.com/repos/{repository}/dispatches"
    response = requests.post(
        url,
        headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}", "X-GitHub-Api-Version": "2022-11-28"},
        json={"event_type": body.event_type, "client_payload": body.client_payload},
        timeout=20,
    )
    if response.status_code != 204:
        raise HTTPException(status_code=502, detail=f"GitHub repository_dispatch failed with HTTP {response.status_code}")
    return {"status": "dispatched", "repository": repository, "event_type": body.event_type}
