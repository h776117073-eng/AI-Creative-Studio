#!/usr/bin/env python3
"""Run a repository Python task on a remote Google Colab VM using Google's Colab CLI.

This is intentionally a headless CLI adapter, not the browser-bound Colab MCP
server. GitHub Actions runners have no local Colab browser session to attach to.
Credentials are read from GOOGLE_APPLICATION_CREDENTIALS and never logged.
"""
from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output"
RESULT_FILE = OUTPUT_DIR / "colab_result.txt"
DEFAULT_SCRIPT = ROOT / "tasks" / "current_task.py"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_result(lines: list[str]) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    RESULT_FILE.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    log: list[str] = []
    started = time.monotonic()
    log.append(f"Started UTC: {utc_now()}")

    temp_script: pathlib.Path | None = None
    try:
        credential_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        if not credential_path or not pathlib.Path(credential_path).is_file():
            raise RuntimeError(
                "GOOGLE_APPLICATION_CREDENTIALS is not set to an existing ADC JSON file. "
                "Check that the COLAB_CREDENTIALS Actions secret contains Google ADC credentials."
            )

        cli = shutil.which("colab")
        if not cli:
            raise RuntimeError(
                "Google Colab CLI executable 'colab' was not found. "
                "Install the google-colab-cli package in the workflow."
            )

        requested_path = os.environ.get("SCRIPT_PATH", "").strip()
        inline_code = os.environ.get("TASK_CODE", "")
        if requested_path:
            candidate = (ROOT / requested_path).resolve()
            if candidate == ROOT or ROOT not in candidate.parents:
                raise ValueError("script_path must resolve to a file inside this repository.")
            if not candidate.is_file() or candidate.suffix.lower() != ".py":
                raise FileNotFoundError(f"script_path must name an existing .py file: {requested_path}")
            task_script = candidate
            task_label = str(candidate.relative_to(ROOT))
        elif inline_code.strip():
            fd, temp_name = tempfile.mkstemp(prefix="colab_inline_", suffix=".py", dir=OUTPUT_DIR)
            os.close(fd)
            temp_script = pathlib.Path(temp_name)
            temp_script.write_text(inline_code, encoding="utf-8")
            task_script = temp_script
            task_label = "workflow_dispatch.task_code"
        elif DEFAULT_SCRIPT.is_file():
            task_script = DEFAULT_SCRIPT
            task_label = "tasks/current_task.py"
        else:
            raise FileNotFoundError("No task_code or script_path was supplied and tasks/current_task.py is missing.")

        timeout = int(os.environ.get("COLAB_TIMEOUT_SECONDS", "900"))
        if timeout < 30:
            timeout = 30
        gpu = os.environ.get("COLAB_GPU", "none").strip().lower()

        command = [cli, "--auth=adc", "run"]
        if gpu and gpu != "none":
            allowed = {"t4": "T4", "l4": "L4", "a100": "A100", "h100": "H100"}
            if gpu not in allowed:
                raise ValueError("COLAB_GPU must be one of none, T4, L4, A100, or H100.")
            command.extend(["--gpu", allowed[gpu]])
        command.append(str(task_script))

        log.extend([
            f"Task: {task_label}",
            f"Accelerator: {gpu if gpu else 'none'}",
            "Execution backend: official googlecolab/google-colab-cli (headless remote runtime)",
            f"Timeout seconds: {timeout}",
            "Starting remote Colab task; credentials are not written to the task output.",
            "Command: colab --auth=adc run [GPU options] <task.py>",
        ])
        print("\n".join(log), flush=True)

        try:
            proc = subprocess.run(
                command,
                cwd=str(ROOT),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout,
                check=False,
                env=os.environ.copy(),
            )
            stdout = proc.stdout or ""
            stderr = proc.stderr or ""
            if stdout:
                print("===== Colab stdout / CLI output =====", flush=True)
                print(stdout, end="" if stdout.endswith("\n") else "\n", flush=True)
                log.extend(["===== Colab stdout / CLI output =====", stdout.rstrip()])
            if stderr:
                print("===== Colab stderr =====", file=sys.stderr, flush=True)
                print(stderr, end="" if stderr.endswith("\n") else "\n", file=sys.stderr, flush=True)
                log.extend(["===== Colab stderr =====", stderr.rstrip()])
            log.append(f"Exit code: {proc.returncode}")
            if proc.returncode != 0:
                log.append("RESULT: FAILED — Colab CLI returned a non-zero exit code.")
                raise RuntimeError(f"Colab CLI exited with code {proc.returncode}. See captured stdout/stderr above.")
            log.append("RESULT: CLI returned success. Review the captured remote output to verify task-level success.")
            return_code = 0
        except subprocess.TimeoutExpired as exc:
            out = exc.stdout.decode(errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
            err = exc.stderr.decode(errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
            log.extend(["RESULT: TIMEOUT", f"Timeout after {timeout} seconds.", out, err])
            raise RuntimeError(f"Colab execution exceeded {timeout} seconds.") from exc

        log.append(f"Elapsed seconds: {time.monotonic() - started:.1f}")
        log.append(f"Finished UTC: {utc_now()}")
        write_result(log)
        return return_code

    except Exception as exc:
        log.extend([
            f"RESULT: FAILED — {type(exc).__name__}: {exc}",
            traceback.format_exc(),
            f"Finished UTC: {utc_now()}",
        ])
        write_result(log)
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        print(f"Full diagnostic log: {RESULT_FILE}", flush=True)
        return 1
    finally:
        if temp_script is not None:
            try:
                temp_script.unlink(missing_ok=True)
            except OSError:
                pass


if __name__ == "__main__":
    sys.exit(main())
