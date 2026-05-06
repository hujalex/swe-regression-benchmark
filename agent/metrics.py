"""SQLite metrics writer. Each agent run produces one row in `runs`."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path

from .models import RunResult
from output_md import append_run as _append_md

DB_PATH = Path(__file__).resolve().parent.parent / "metrics.sqlite"

# USD per 1M tokens. Extend as needed.
PRICES: dict[str, tuple[float, float]] = {
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4.1": (2.00, 8.00),
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id        TEXT PRIMARY KEY,
    ts            REAL NOT NULL,
    provider      TEXT NOT NULL,
    model         TEXT NOT NULL,
    tokens_in     INTEGER,
    tokens_out    INTEGER,
    cost_usd      REAL,
    duration_ms   INTEGER,
    git_sha       TEXT,
    files_changed TEXT,
    tests_passed  INTEGER,
    outcome       TEXT,
    summary       TEXT
);
"""


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(_SCHEMA)
    return conn


def _cost(model: str, tin: int, tout: int) -> float:
    if model not in PRICES:
        return 0.0
    in_price, out_price = PRICES[model]
    return (tin / 1_000_000) * in_price + (tout / 1_000_000) * out_price


def write(
    *,
    provider: str,
    model: str,
    duration_ms: int,
    tokens_in: int,
    tokens_out: int,
    git_sha: str,
    outcome: str,
    result: RunResult | None,
    task: str = "",
) -> str:
    """Write one row. Returns the run_id."""
    run_id = uuid.uuid4().hex
    ts = time.time()
    files = json.dumps(result.files_changed if result else [])
    summary = result.summary if result else ""
    tests_passed = int(bool(result.tests_passed)) if result else 0
    cost = _cost(model, tokens_in, tokens_out)
    with _conn() as conn:
        conn.execute(
            "INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                run_id,
                ts,
                provider,
                model,
                tokens_in,
                tokens_out,
                cost,
                duration_ms,
                git_sha,
                files,
                tests_passed,
                outcome,
                summary,
            ),
        )
    _append_md(run_id=run_id, ts=ts, task=task or summary, outcome=outcome, model=model)
    return run_id
