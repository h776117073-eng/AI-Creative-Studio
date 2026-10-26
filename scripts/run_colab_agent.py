#!/usr/bin/env python3
"""Run a Python task through the Google Colab MCP server and persist a JSON log.

The script discovers the server's tools at runtime instead of assuming a fixed
tool name. Set COLAB_TOOL_NAME to pin a specific tool when necessary.
"""
from __future__ import annotations

import asyncio
import json
import os
import shlex
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output"
LOG_PATH = OUTPUT_DIR / "execution_log.json"
DEFAULT_TIMEOUT = 900


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_json(value: Any) -> Any:
    """Convert MCP/Pydantic values to JSON-serializable data."""
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if hasattr(value, "dict"):
        return value.dict()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [safe_json(item) for item in value]
    if isinstance(value, dict):
        return {str(key): safe_json(item) for key, item in value.items()}
    return str(value)


def save_log(payload: dict[str, Any]) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    LOG_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )


def choose_tool(tools: list[Any], requested_name: str | None) -> Any:
    if requested_name:
        match = next((tool for tool in tools if tool.name == requested_name), None)
        if match is None:
            available = ", ".join(tool.name for tool in tools) or "(none)"
            raise RuntimeError(
                f"Requested MCP tool {requested_name!r} was not found. "
                f"Available tools: {available}"
            )
        return match

    # Prefer tools whose names indicate code/cell execution. Do not silently
    # select upload/download or other unrelated tools.
    candidates = [
        tool for tool in tools
        if any(token in tool.name.lower() for token in ("execute_code", "run_code", "run_cell", "execute_cell", "run_python"))
    ]
    if not candidates:
        summary = [
            {"name": tool.name, "description": getattr(tool, "description", "")}
            for tool in tools
        ]
        raise RuntimeError(
            "No recognizable code-execution tool was exposed by the Colab MCP "
            "server. Set COLAB_TOOL_NAME to the exact execution tool after "
            "reviewing output/execution_log.json. Discovered tools: "
            + json.dumps(summary, ensure_ascii=False)
        )
    return candidates[0]


def build_tool_arguments(tool: Any, code: str) -> dict[str, Any]:
    schema = getattr(tool, "inputSchema", None) or getattr(tool, "input_schema", None) or {}
    properties = schema.get("properties", {}) if isinstance(schema, dict) else {}
    if not properties:
        # The standard Google Colab server may change schema versions; use the
        # conventional parameter only when the schema is unavailable.
        return {"code": code}

    aliases = ("code", "python_code", "source_code", "source", "cell_code", "content")
    code_key = next((key for key in aliases if key in properties), None)
    if code_key is None:
        raise RuntimeError(
            f"Tool {tool.name!r} does not expose a recognized code input. "
            f"Input schema properties: {list(properties)}"
        )

    args: dict[str, Any] = {code_key: code}
    # Fill common optional notebook/session identifiers only if required and
    # explicitly supported. The MCP server remains the authority on semantics.
    required = schema.get("required", []) if isinstance(schema, dict) else []
    for key in required:
        if key in args:
            continue
        if key in ("notebook_id", "session_id", "runtime_id"):
            env_key = "COLAB_" + key.upper()
            if os.getenv(env_key):
                args[key] = os.environ[env_key]
    missing = [key for key in required if key not in args]
    if missing:
        raise RuntimeError(
            f"Tool {tool.name!r} requires additional arguments not configured: "
            f"{missing}. Check its input schema and provide the matching "
            "COLAB_NOTEBOOK_ID / COLAB_SESSION_ID / COLAB_RUNTIME_ID setting."
        )
    return args


async def run() -> dict[str, Any]:
    started = utc_now()
    timeout = int(os.getenv("COLAB_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT)))
    if timeout < 1:
        timeout = DEFAULT_TIMEOUT

    credentials = Path.home() / ".config" / "colab-mcp" / "credentials.json"
    if not credentials.is_file() or credentials.stat().st_size == 0:
        raise RuntimeError(
            f"Colab credentials are missing or empty at {credentials}. "
            "Configure the COLAB_CREDENTIALS GitHub secret as the complete "
            "contents of credentials.json."
        )

    env = os.environ.copy()
    env["API_KEY"] = os.getenv("API_KEY", "")
    env["GOOGLE_API_KEY"] = os.getenv("API_KEY", env.get("GOOGLE_API_KEY", ""))
    command_text = os.getenv("COLAB_MCP_COMMAND", "").strip()
    if not command_text:
        raise RuntimeError(
            "COLAB_MCP_COMMAND is not configured. The old npm package "
            "@google/colab-mcp-server is not available; set this variable to "
            "the invocation documented by the official googlecolab/colab-mcp "
            "repository. A valid command still requires access to an authenticated "
            "Colab browser/session."
        )
    command_parts = shlex.split(command_text)
    if not command_parts:
        raise RuntimeError("COLAB_MCP_COMMAND is empty")
    server = StdioServerParameters(
        command=command_parts[0],
        args=command_parts[1:],
        env=env,
    )
    code = os.getenv("COLAB_CODE", 'print("Hello from Google Colab")')
    requested_tool = os.getenv("COLAB_TOOL_NAME", "").strip() or None

    record: dict[str, Any] = {
        "status": "running",
        "started_at": started,
        "finished_at": None,
        "server_command": os.getenv("COLAB_MCP_COMMAND", "(not configured)"),
        "credentials_path": str(credentials),
        "tool_name": None,
        "discovered_tools": [],
        "input_code": code,
        "tool_arguments": None,
        "result": None,
        "stdout": "",
        "stderr": "",
        "error": None,
    }

    try:
        async with stdio_client(server) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await asyncio.wait_for(session.initialize(), timeout=min(timeout, 60))
                tool_result = await asyncio.wait_for(session.list_tools(), timeout=min(timeout, 60))
                tools = list(tool_result.tools)
                record["discovered_tools"] = [
                    {
                        "name": tool.name,
                        "description": getattr(tool, "description", "") or "",
                        "input_schema": safe_json(
                            getattr(tool, "inputSchema", None)
                            or getattr(tool, "input_schema", None)
                            or {}
                        ),
                    }
                    for tool in tools
                ]
                tool = choose_tool(tools, requested_tool)
                arguments = build_tool_arguments(tool, code)
                record["tool_name"] = tool.name
                record["tool_arguments"] = arguments
                result = await asyncio.wait_for(
                    session.call_tool(tool.name, arguments),
                    timeout=timeout,
                )
                record["result"] = safe_json(result)
                content = getattr(result, "content", []) or []
                rendered = []
                for item in content:
                    text = getattr(item, "text", None)
                    if text is not None:
                        rendered.append(text)
                record["stdout"] = "\n".join(rendered)
                if getattr(result, "isError", False):
                    record["status"] = "tool_error"
                    record["stderr"] = record["stdout"] or "MCP tool reported an error."
                else:
                    record["status"] = "success"
                return record
    except asyncio.TimeoutError:
        record["status"] = "timeout"
        record["error"] = (
            f"Timed out after {timeout} seconds while initializing the server, "
            "listing tools, or waiting for execution. A timeout does not prove "
            "that remote Colab execution stopped; inspect the Colab session."
        )
    except (BrokenPipeError, ConnectionError, OSError) as exc:
        record["status"] = "connection_error"
        record["error"] = f"{type(exc).__name__}: {exc}"
    except Exception as exc:  # preserve diagnostic context in the artifact
        record["status"] = "error"
        message = str(exc)
        if any(word in message.lower() for word in ("credential", "token", "unauthorized", "unauthenticated", "401", "403")):
            record["error"] = (
                "Authentication/authorization failed. Verify that COLAB_CREDENTIALS "
                "contains a valid credentials.json and that the account can access Colab. "
                f"Diagnostic: {message}"
            )
        else:
            record["error"] = f"{type(exc).__name__}: {message}"
        record["traceback"] = traceback.format_exc()
    finally:
        record["finished_at"] = utc_now()
        save_log(record)

    return record


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        result = asyncio.run(run())
    except Exception as exc:
        result = {
            "status": "configuration_error",
            "started_at": utc_now(),
            "finished_at": utc_now(),
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(),
        }
        save_log(result)

    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    return 0 if result.get("status") == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
