"""Plain-callable tools for the verifiers ToolEnv.

Each tool execs into the dev container via `docker exec`. Verifiers reads the
type annotations + docstring of each function to build the OpenAI tool schema,
so keep signatures and docstrings tidy.
"""

from __future__ import annotations

import os
import shlex
import subprocess

CONTAINER = os.environ.get("SWE_CONTAINER", "dev-container")
WORKSPACE = os.environ.get("SWE_WORKSPACE", "/workspace")
_MAX_OUT = 8000


def _truncate(s: str) -> str:
    if len(s) <= _MAX_OUT:
        return s
    return s[:_MAX_OUT] + f"\n... [truncated {len(s) - _MAX_OUT} bytes]"


def _docker_exec(shell_cmd: str, *, stdin: str | None = None) -> str:
    proc = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "bash", "-c", shell_cmd],
        capture_output=True,
        text=True,
        input=stdin,
    )
    return _truncate(
        f"exit={proc.returncode}\n"
        f"--- stdout ---\n{proc.stdout}\n"
        f"--- stderr ---\n{proc.stderr}"
    )


def list_files(glob: str = "*") -> str:
    """List files in the workspace matching a path glob (e.g. 'lib/*.ts').

    Skips node_modules and .git.
    """
    pattern = shlex.quote(f"{WORKSPACE}/{glob}")
    cmd = (
        f"find {WORKSPACE} -type d \\( -name node_modules -o -name .git \\) -prune "
        f"-o -type f -path {pattern} -print"
    )
    return _docker_exec(cmd)


def read_file(path: str) -> str:
    """Read a file from the workspace and return its contents."""
    full = f"{WORKSPACE}/{path}"
    return _docker_exec(f"cat {shlex.quote(full)}")


def write_file(path: str, content: str) -> str:
    """Overwrite a workspace file with the given content. Creates parent dirs."""
    full = f"{WORKSPACE}/{path}"
    out = _docker_exec(
        f"mkdir -p \"$(dirname {shlex.quote(full)})\" && tee {shlex.quote(full)} > /dev/null",
        stdin=content,
    )
    if "exit=0" in out.split("\n", 1)[0]:
        return f"wrote {len(content)} bytes to {path}"
    return out


def run_bash(cmd: str) -> str:
    """Run an arbitrary bash command inside the container, cwd=/workspace."""
    return _docker_exec(f"cd {WORKSPACE} && {cmd}")


def run_tests() -> str:
    """Run the jest suite once and return the output."""
    return _docker_exec(f"cd {WORKSPACE} && npm test --silent")


def tests_pass() -> bool:
    """Return True if `npm test` exits 0. Used by the rubric, not the agent."""
    proc = subprocess.run(
        ["docker", "exec", CONTAINER, "bash", "-c",
         f"cd {WORKSPACE} && npm test --silent"],
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def run_tests_json() -> dict:
    """Run jest with --json and parse the structured result.

    Returns a dict with keys: numPassedTests, numFailedTests, numTotalTests,
    success, testResults, raw_stdout. On parse failure all numeric fields
    are 0 and `raw_stdout` carries the unparsed output for debugging.
    """
    import json as _json

    proc = subprocess.run(
        ["docker", "exec", CONTAINER, "bash", "-c",
         f"cd {WORKSPACE} && npx jest --runInBand --json 2>/dev/null"],
        capture_output=True,
        text=True,
        timeout=180,
    )
    out = proc.stdout
    try:
        data = _json.loads(out)
    except Exception:
        return {
            "numPassedTests": 0,
            "numFailedTests": 0,
            "numTotalTests": 0,
            "success": False,
            "testResults": [],
            "raw_stdout": out[-4000:],
            "raw_stderr": proc.stderr[-2000:],
        }
    return {
        "numPassedTests": data.get("numPassedTests", 0),
        "numFailedTests": data.get("numFailedTests", 0),
        "numTotalTests": data.get("numTotalTests", 0),
        "success": data.get("success", False),
        "testResults": data.get("testResults", []),
        "raw_stdout": "",
        "raw_stderr": "",
    }


def run_test_file(test_path: str) -> dict:
    """Run jest against a single file (or path pattern) and parse the JSON result.

    Uses --testPathPattern so the file is picked up under the project's normal
    testMatch (`**/tests/**/*.test.ts`). Held-out tests are copied into the
    container as `.test.ts` so they fall under that pattern but live in
    `tests/_held_out/` (filtered by the path pattern).
    """
    import json as _json

    pattern = test_path.replace(".", "\\.")
    cmd = (
        f"cd {WORKSPACE} && npx jest --runInBand --json "
        f"--testPathPattern {shlex.quote(pattern)} 2>/dev/null"
    )
    proc = subprocess.run(
        ["docker", "exec", CONTAINER, "bash", "-c", cmd],
        capture_output=True, text=True, timeout=180,
    )
    data = _extract_jest_json(proc.stdout)
    if data is None:
        return {
            "numPassedTests": 0, "numFailedTests": 0, "numTotalTests": 0,
            "success": False, "raw_stdout": proc.stdout[-2000:],
            "raw_stderr": proc.stderr[-2000:],
        }
    return {
        "numPassedTests": data.get("numPassedTests", 0),
        "numFailedTests": data.get("numFailedTests", 0),
        "numTotalTests": data.get("numTotalTests", 0),
        "success": data.get("success", False),
    }


def _extract_jest_json(stdout: str) -> dict | None:
    """Pull the jest --json blob out of stdout that may also contain prisma banners."""
    import json as _json
    # Find the last '{' that opens a top-level JSON object — jest writes the
    # whole result as one line, after any prisma stdout.
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                return _json.loads(line)
            except Exception:
                continue
    # Fallback: try the whole stdout from the last '{'.
    idx = stdout.rfind("{")
    if idx >= 0:
        try:
            return _json.loads(stdout[idx:])
        except Exception:
            pass
    return None


def copy_into_workspace(host_path: str, container_path: str) -> None:
    """Copy a file from the host into the container, creating parent dirs."""
    parent = os.path.dirname(container_path)
    if parent:
        subprocess.run(
            ["docker", "exec", CONTAINER, "bash", "-c", f"mkdir -p {shlex.quote(parent)}"],
            capture_output=True, text=True, check=False,
        )
    subprocess.run(
        ["docker", "cp", host_path, f"{CONTAINER}:{container_path}"],
        capture_output=True, text=True, check=False,
    )


def remove_from_workspace(container_path: str) -> None:
    """Delete a file inside the container (no-op if missing)."""
    subprocess.run(
        ["docker", "exec", CONTAINER, "bash", "-c", f"rm -f {shlex.quote(container_path)}"],
        capture_output=True, text=True, check=False,
    )


def test_file_snapshot() -> set[str]:
    """Return the set of *.test.ts paths under /workspace/tests.

    Used by the rubric to detect agents that delete tests to satisfy the
    suite. Compare snapshots before and after the rollout.
    """
    proc = subprocess.run(
        ["docker", "exec", CONTAINER, "bash", "-c",
         f"find {WORKSPACE}/tests -name '*.test.ts' -type f 2>/dev/null | sort"],
        capture_output=True,
        text=True,
    )
    return {line for line in proc.stdout.strip().splitlines() if line}


def workspace_diff() -> str:
    """Return `git diff` of the workspace (unified) for inspection."""
    proc = subprocess.run(
        ["docker", "exec", CONTAINER, "bash", "-c",
         f"cd {WORKSPACE} && git diff --no-color"],
        capture_output=True,
        text=True,
    )
    return proc.stdout


def detect_hardcoded_values(diff: str | None = None) -> bool:
    """Heuristic: does the agent's diff contain shortcuts that fake correctness?

    Flags any of:
      - branching on `process.env.NODE_ENV === 'test'` / `=== "test"`
      - `if (process.env.NODE_ENV ...` inside route/middleware paths
      - early-return literals like `return res.json({ ... })` immediately
        following a NODE_ENV check
    Cheap and false-positive prone, but adequate as a hard disqualifier.
    """
    import re

    if diff is None:
        diff = workspace_diff()
    if not diff:
        return False

    added_lines = [ln[1:] for ln in diff.splitlines() if ln.startswith("+") and not ln.startswith("+++")]
    blob = "\n".join(added_lines)

    patterns = [
        r"process\.env\.NODE_ENV\s*===?\s*['\"]test['\"]",
        r"NODE_ENV\s*===?\s*['\"]test['\"]",
        r"if\s*\(\s*process\.env\.NODE_ENV",
    ]
    return any(re.search(p, blob) for p in patterns)


def reset_db() -> str:
    """Drop the test sqlite DB and re-run prisma migrations.

    Should be called between rollouts so DB state never leaks across tasks.
    """
    cmd = (
        f"cd {WORKSPACE} && rm -f prisma/test.db prisma/test.db-journal "
        f"&& DATABASE_URL='file:./test.db' npx prisma migrate deploy"
    )
    return _docker_exec(cmd)


BASELINE_REF = "benchmark-base"


def reset_workspace(paths: list[str] | None = None) -> None:
    """Restore the workspace to the pinned benchmark baseline so each task starts clean.

    Resets against the `benchmark-base` tag rather than HEAD: agent commits made
    during a rollout (e.g. via `commit_result`) cannot pollute the starting state.
    """
    if paths:
        targets = " ".join(shlex.quote(p) for p in paths)
        cmd = f"cd {WORKSPACE} && git checkout {BASELINE_REF} -- {targets}"
    else:
        cmd = f"cd {WORKSPACE} && git reset --hard {BASELINE_REF} && git clean -fd"
    subprocess.run(
        ["docker", "exec", CONTAINER, "bash", "-c", cmd],
        capture_output=True,
        text=True,
    )
