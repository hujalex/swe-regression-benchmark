"""Append one Markdown table row to OUTPUT.md after each run."""

from __future__ import annotations

import datetime
from pathlib import Path

OUTPUT_PATH = Path(__file__).parent / "OUTPUT.md"

_HEADER = (
    "# Run Results\n\n"
    "| Run ID | Timestamp | Task | Reward | Visible | Held-Out | Shallow Fix | Lint | Outcome/Model |\n"
    "|--------|-----------|------|--------|---------|----------|-------------|------|---------------|\n"
)


def append_run(
    *,
    run_id: str,
    ts: float,
    task: str,
    reward: float | None = None,
    visible_passed: int | None = None,
    visible_total: int | None = None,
    held_out_passed: int | None = None,
    held_out_total: int | None = None,
    shallow_fix: bool | None = None,
    lint_ok: bool | None = None,
    outcome: str | None = None,
    model: str | None = None,
) -> None:
    if not OUTPUT_PATH.exists():
        OUTPUT_PATH.write_text(_HEADER)

    dt = datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")
    short_id = run_id[:8]
    task_short = task[:60].replace("|", "╎").replace("\n", " ")
    reward_str = f"{reward:.2f}" if reward is not None else "—"
    visible_str = f"{visible_passed}/{visible_total}" if visible_total else "—"
    held_str = f"{held_out_passed}/{held_out_total}" if held_out_total else "—"
    sf_str = "Yes" if shallow_fix else ("No" if shallow_fix is not None else "—")
    lint_str = "✓" if lint_ok else ("✗" if lint_ok is not None else "—")
    last_col = outcome or model or "—"

    row = (
        f"| {short_id} | {dt} | {task_short} | {reward_str} | "
        f"{visible_str} | {held_str} | {sf_str} | {lint_str} | {last_col} |\n"
    )
    with OUTPUT_PATH.open("a") as f:
        f.write(row)
