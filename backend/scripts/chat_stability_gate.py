"""Boot backend and run a baseline chat stability gate.

This gate:
1) starts uvicorn,
2) runs the three chat validation scripts against one base URL,
3) validates expected success markers in stdout,
4) exits non-zero on any failure.
"""

import os
import signal
import subprocess
import sys
import time

import httpx

HOST = os.getenv("CHAT_GATE_HOST", "127.0.0.1")
PORT = int(os.getenv("CHAT_GATE_PORT", "8010"))
BASE_URL = os.getenv("CHAT_GATE_BASE_URL", f"http://{HOST}:{PORT}").rstrip("/")

SERVER_START_TIMEOUT_SECONDS = 45
SCRIPT_RETRIES = int(os.getenv("CHAT_GATE_SCRIPT_RETRIES", "1"))


def _configure_console_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(errors="replace")
            except Exception:
                pass


def _backend_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _script_path(name: str) -> str:
    return os.path.join(_backend_root(), "scripts", name)


def _wait_for_server_ready(base_url: str, timeout_seconds: int) -> bool:
    deadline = time.time() + timeout_seconds
    ready_url = f"{base_url}/health/ready"

    while time.time() < deadline:
        try:
            with httpx.Client(timeout=2.0) as client:
                resp = client.get(ready_url)
                if resp.status_code == 200:
                    return True
        except Exception:
            pass
        time.sleep(1)

    return False


def _run_script_once(script_name: str, required_markers: list[str]) -> tuple[bool, str]:
    env = os.environ.copy()
    env["TEST_BASE_URL"] = BASE_URL
    env["CHAT_TEST_BASE_URL"] = BASE_URL

    script_full_path = _script_path(script_name)
    cmd = [sys.executable, script_full_path]

    result = subprocess.run(
        cmd,
        cwd=_backend_root(),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
    )

    output = result.stdout or ""
    rc_ok = result.returncode == 0
    markers_ok = all(marker in output for marker in required_markers)
    ok = rc_ok and markers_ok

    print(f"\n=== {script_name} ===")
    print(output)
    if not rc_ok:
        print(f"[gate] FAILED: {script_name} exited with code {result.returncode}")
    if rc_ok and not markers_ok:
        print(f"[gate] FAILED: {script_name} missing expected success markers")

    return ok, output


def _run_script(script_name: str, required_markers: list[str]) -> tuple[bool, str]:
    last_output = ""
    total_attempts = SCRIPT_RETRIES + 1

    for attempt in range(1, total_attempts + 1):
        if attempt > 1:
            print(f"[gate] Retrying {script_name} (attempt {attempt}/{total_attempts})")

        ok, output = _run_script_once(script_name, required_markers)
        last_output = output
        if ok:
            return True, output

        # brief cooldown before retrying transient failures (timeouts/network)
        if attempt < total_attempts:
            time.sleep(2)

    return False, last_output


def _stop_server(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return

    if os.name == "nt":
        proc.send_signal(signal.CTRL_BREAK_EVENT)
    else:
        proc.terminate()

    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def main() -> int:
    _configure_console_output()
    print(f"[gate] Starting uvicorn on {BASE_URL}")

    server_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        HOST,
        "--port",
        str(PORT),
    ]

    server_proc = subprocess.Popen(
        server_cmd,
        cwd=_backend_root(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )

    try:
        if not _wait_for_server_ready(BASE_URL, SERVER_START_TIMEOUT_SECONDS):
            print("[gate] FAILED: server did not become ready in time")
            return 1

        checks = [
            ("test_chat_direct.py", ["Testing", "Status: 200", "Status: 404"]),
            ("test_chat_history.py", ["SUCCESS: Messages are being saved correctly!"]),
            ("test_rag_integration.py", ["ALL TESTS PASSED"]),
        ]

        all_ok = True
        for script_name, markers in checks:
            ok, _ = _run_script(script_name, markers)
            all_ok = all_ok and ok

        if all_ok:
            print("\n[gate] PASS: chat stability baseline succeeded")
            return 0

        print("\n[gate] FAIL: one or more chat stability checks failed")
        return 1
    finally:
        _stop_server(server_proc)


if __name__ == "__main__":
    raise SystemExit(main())
