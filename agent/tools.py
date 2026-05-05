"""Typed tools the Pydantic AI agent uses to drive the dev container.

All container-side tools shell out via `docker exec`. `commit_result` runs
on the host so the host git history captures the change.
"""

from __future__ import annotations

import shlex
import subprocess

from pydantic_ai import RunContext

from .models import Deps

_MAX_OUT = 8000


def _truncate(s: str) -> str:
    if len(s) <= _MAX_OUT:
        return s
    return s[:_MAX_OUT] + f"\n... [truncated {len(s) - _MAX_OUT} bytes]"


def _docker_exec(ctx: RunContext[Deps], shell_cmd: str, *, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "exec", "-i", ctx.deps.container_name, "bash", "-c", shell_cmd],
        capture_output=True,
        text=True,
        input=stdin,
    )


def _format(proc: subprocess.CompletedProcess[str]) -> str:
    return _truncate(
        f"exit={proc.returncode}\n"
        f"--- stdout ---\n{proc.stdout}\n"
        f"--- stderr ---\n{proc.stderr}"
    )


def register(agent) -> None:
    """Register all tools on the given Pydantic AI Agent."""

    @agent.tool
    async def list_files(ctx: RunContext[Deps], glob: str = "*") -> str:
        """List files in the workspace matching a path glob (e.g. 'lib/*.ts').

        Skips node_modules and .git.
        """
        ws = ctx.deps.workspace
        pattern = shlex.quote(f"{ws}/{glob}")
        cmd = (
            f"find {ws} -type d \\( -name node_modules -o -name .git \\) -prune "
            f"-o -type f -path {pattern} -print"
        )
        return _format(_docker_exec(ctx, cmd))

    @agent.tool
    async def read_file(ctx: RunContext[Deps], path: str) -> str:
        """Read a file from the workspace, returning its contents."""
        full = f"{ctx.deps.workspace}/{path}"
        return _format(_docker_exec(ctx, f"cat {shlex.quote(full)}"))

    @agent.tool
    async def write_file(ctx: RunContext[Deps], path: str, content: str) -> str:
        """Overwrite a file in the workspace with the given content.

        Content is piped via stdin so any quoting / special chars are safe.
        """
        full = f"{ctx.deps.workspace}/{path}"
        proc = _docker_exec(
            ctx,
            f"mkdir -p \"$(dirname {shlex.quote(full)})\" && tee {shlex.quote(full)} > /dev/null",
            stdin=content,
        )
        if proc.returncode != 0:
            return _format(proc)
        return f"wrote {len(content)} bytes to {path}"

    @agent.tool
    async def run_bash(ctx: RunContext[Deps], cmd: str) -> str:
        """Run an arbitrary bash command inside the container, cwd=/workspace."""
        return _format(_docker_exec(ctx, f"cd {ctx.deps.workspace} && {cmd}"))

    @agent.tool
    async def run_tests(ctx: RunContext[Deps]) -> str:
        """Run the jest suite once and return the output."""
        return _format(
            _docker_exec(ctx, f"cd {ctx.deps.workspace} && npm test --silent")
        )

    @agent.tool
    async def commit_result(ctx: RunContext[Deps], message: str) -> str:
        """Stage all changes and commit on a throwaway per-run branch.

        Commits never advance the baseline branch, so the rollout reset to
        `benchmark-base` always restores a clean broken state.
        """
        ws = ctx.deps.workspace
        msg = shlex.quote(message)
        branch = f"agent-run-{ctx.deps.run_id}" if hasattr(ctx.deps, "run_id") else "agent-run"
        commit = _docker_exec(
            ctx,
            f"cd {ws} && git checkout -B {shlex.quote(branch)} && git add -A "
            f"&& git -c user.email=agent@local -c user.name=agent commit -m {msg} "
            f"&& git rev-parse HEAD && git checkout - --quiet",
        )
        if commit.returncode != 0:
            return _truncate(f"commit failed: {commit.stdout}{commit.stderr}")
        return commit.stdout.strip().splitlines()[-1]
