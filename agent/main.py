"""Entry point: run a natural-language coding task against the dev container."""

from __future__ import annotations

import argparse
import asyncio
import subprocess
import sys
import time

from pydantic_ai import Agent

from . import metrics, tools
from .models import Deps, RunResult

MODEL_ID = "openai:gpt-4o"

SYSTEM_PROMPT = (
    "You are a coding agent working in a TypeScript project mounted at /workspace. "
    "Use list_files and read_file to understand the code, write_file to make changes, "
    "then run_tests (vitest). If tests fail, read the output, adjust your changes, and "
    "retry — but stop after 3 test runs. When tests pass, call commit_result with a "
    "concise message describing the fix. "
    "Always return a RunResult with files_changed, tests_passed, the commit_sha "
    "returned by commit_result (empty string if you did not commit), a one-line summary, "
    "and any errors encountered."
)

agent: Agent[Deps, RunResult] = Agent(
    MODEL_ID,
    deps_type=Deps,
    output_type=RunResult,
    system_prompt=SYSTEM_PROMPT,
)
tools.register(agent)


def _host_sha() -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()


def _reset_workspace() -> None:
    subprocess.run(["git", "checkout", "."], check=False, capture_output=True)
    subprocess.run(["git", "clean", "-fd"], check=False, capture_output=True)


async def run(task: str) -> RunResult | None:
    pre_sha = _host_sha()
    deps = Deps()
    started = time.monotonic()

    result = None
    outcome = "ok"
    tokens_in = tokens_out = 0
    try:
        run = await agent.run(task, deps=deps)
        result = run.output
        usage = run.usage()
        tokens_in = getattr(usage, "request_tokens", 0) or 0
        tokens_out = getattr(usage, "response_tokens", 0) or 0
        if not result.tests_passed:
            outcome = "tests_failed"
            _reset_workspace()
    except Exception as e:  # noqa: BLE001
        outcome = f"error: {type(e).__name__}: {e}"
        _reset_workspace()

    duration_ms = int((time.monotonic() - started) * 1000)
    post_sha = _host_sha()

    metrics.write(
        provider="openai",
        model=MODEL_ID.split(":", 1)[1],
        duration_ms=duration_ms,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        git_sha=post_sha if post_sha != pre_sha else "",
        outcome=outcome,
        result=result,
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a coding task with the Pydantic AI agent.")
    parser.add_argument("task", help="Natural language description of the task")
    args = parser.parse_args()

    result = asyncio.run(run(args.task))
    if result is None:
        print("run failed; see metrics.sqlite", file=sys.stderr)
        sys.exit(1)
    print(result.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
