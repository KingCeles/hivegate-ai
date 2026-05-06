from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"
PYTHON_EXE = ROOT / ".venv" / "Scripts" / "python.exe"
NPM_CMD = "npm.cmd" if os.name == "nt" else "npm"


def stream_output(name: str, pipe, target_stream) -> None:
    prefix = f"[{name}] "
    try:
        for line in iter(pipe.readline, ""):
            if not line:
                break
            target_stream.write(prefix + line)
            target_stream.flush()
    finally:
        pipe.close()


def start_process(name: str, command: list[str], cwd: Path, extra_env: dict[str, str] | None = None):
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)

    process = subprocess.Popen(
        command,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    threading.Thread(
        target=stream_output, args=(name, process.stdout, sys.stdout), daemon=True
    ).start()
    threading.Thread(
        target=stream_output, args=(name, process.stderr, sys.stderr), daemon=True
    ).start()
    return process


def terminate_processes(processes: list[subprocess.Popen]) -> None:
    for process in processes:
        if process.poll() is None:
            process.terminate()

    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def main() -> int:
    if not PYTHON_EXE.exists():
        print(f"Missing virtualenv Python at {PYTHON_EXE}", file=sys.stderr)
        return 1

    processes: list[subprocess.Popen] = []

    try:
        processes.append(
            start_process(
                "api-5000",
                [str(PYTHON_EXE), "app.py"],
                BACKEND_DIR,
                {"PORT": "5000"},
            )
        )
        processes.append(
            start_process(
                "api-5001",
                [str(PYTHON_EXE), "app2.py"],
                BACKEND_DIR,
                {"PORT": "5001"},
            )
        )
        processes.append(
            start_process(
                "web-5173",
                [NPM_CMD, "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"],
                FRONTEND_DIR,
            )
        )

        while True:
            for process in processes:
                code = process.poll()
                if code is not None:
                    print(f"{process.args[1] if len(process.args) > 1 else process.args[0]} exited with code {code}", file=sys.stderr)
                    terminate_processes(processes)
                    return code
            threading.Event().wait(0.5)
    except KeyboardInterrupt:
        terminate_processes(processes)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
