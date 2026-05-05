# swe-regression-benchmark

Benchmark harness for evaluating coding agents on TypeScript regression-style
tasks. An agent is given a real Express+Prisma+JWT app (intentionally broken
on the `benchmark-base` baseline) inside a Docker container and must edit
files until the visible Jest tests pass. The grader then runs an additional
**held-out** test suite the agent never sees, so shallow patches that overfit
to the visible cases are penalized. Per-run metrics are written to SQLite.
Hard disqualifiers: deleted tests, hardcoded NODE_ENV shortcuts.

## Layout

- `app/` — TypeScript app under test (Express + Prisma + JWT + Jest+supertest).
  Its own nested git repo, with the broken baseline pinned at the
  `benchmark-base` tag. Mounted into `dev-container` as `/workspace`.
  Ignored by the outer repo's `.gitignore`.
- `agent/` — Pydantic AI one-shot runner.
  - `main.py` — `python -m agent.main "<task>"`.
  - `tools.py` — typed tools (`list_files`, `read_file`, `write_file`,
    `run_bash`, `run_tests`, `commit_result`). `commit_result` commits onto
    a throwaway `agent-run-*` branch so the baseline is never advanced.
  - `metrics.py` — one row per run into `metrics.sqlite`.
  - `models.py` — `RunResult` and `Deps` (container=`dev-container`,
    workspace=`/workspace`).
- `env/tools.py` — plain-callable docker-exec tools shared with the Verifiers
  env. Includes `run_tests_json`, `run_test_file` (path-filtered jest),
  `copy_into_workspace`/`remove_from_workspace` (host→container file IO for
  held-out tests), `test_file_snapshot`, `detect_hardcoded_values`. The
  baseline reset constant is `BASELINE_REF = "benchmark-base"`.
- `environments/code_agent/` — Verifiers `ToolEnv` + `Rubric` + tasks dataset.
  - `code_agent.py` — env, rubric (`_score_rollout`), held-out runner
    (`_run_held_out`). Each task's `info` carries `visible_tests` and
    `held_out_tests` paths.
  - `tasks/tasks.jsonl` — task definitions; each row has `visible_tests` (a
    path inside the workspace) and `held_out_tests` (a filename relative to
    `environments/code_agent/held_out/`).
  - `held_out/` — held-out test files **on the host**, copied into the
    container as `tests/_held_out/<name>.test.ts` only during scoring, then
    removed. Agents never see them.
- `run_eval.sh` — entry point for running a Verifiers eval.
- `docker-compose.yml` — `node:20` container `dev-container`, mounts `./app`
  at `/workspace`.
- `venv/` — Python 3.14 virtualenv. Use `./venv/bin/python`.
- `metrics.sqlite` — Pydantic AI run history. `metrics/runs.db` — Verifiers
  rollout history (now also stores `held_out_*` and `shallow_fix`).

## Common commands

```bash
# bring up the dev container (run once per session)
docker compose up -d
docker exec dev-container bash -c "cd /workspace && npm ci && npx prisma migrate deploy"

# run tests directly inside the container
docker exec dev-container bash -c "cd /workspace && npm test"

# run the Pydantic AI agent on a single task
./venv/bin/python -m agent.main "restore the rate limiter on POST /login"

# run a Verifiers eval (auto-starts container, installs env package on first run)
./run_eval.sh                          # all tasks, gpt-5.5
MODEL=gpt-5.5 NUM_EXAMPLES=2 ./run_eval.sh
# extra args pass through to vf-eval, e.g. -v for verbose

# direct vf-eval invocation (what the script wraps)
./venv/bin/vf-eval code_agent -p environments \
    -m gpt-5.5 -k OPENAI_API_KEY -b https://api.openai.com/v1 \
    -n 5 -r 1 -c 1

# inspect metrics
sqlite3 metrics.sqlite "select run_id, model, tests_passed, outcome, summary from runs order by ts desc limit 10;"
sqlite3 metrics/runs.db "select run_id, prompt, passed, total, held_out_passed, held_out_total, shallow_fix, reward from runs order by ts desc limit 10;"
```

> Note: older docs reference `prime env install code_agent` / `prime eval run`.
> Those subcommands do not exist in the installed prime CLI (v0.4.3); use
> `./run_eval.sh` (or `vf-eval` directly) instead. The local env is
> registered via `pip install -e environments/code_agent`.

## Environment

- `.env` — provider API keys. **Note:** has `OPENAI_API_KEY = ...` with a
  space before `=`, so `source .env` does not work. The eval script extracts
  it with `grep | sed`.
- `app/.env.test` — `DATABASE_URL`, `JWT_SECRET` for jest.
- Default agent model: `openai:gpt-4.1` (`agent/main.py:16`).

## Prime Intellect `verifiers`

`verifiers` lives in `venv/`. Build env classes with `vf.ToolEnv` /
`vf.SingleTurnEnv`, score with `vf.Rubric`. Docs:
https://github.com/PrimeIntellect-ai/verifiers.

## Reward shape

```
if deleted_tests or hardcoded_values:    -1.0     # hard disqualifiers
if visible_total == 0:                    0.0     # task ran no tests
if visible_pass_rate >= 0.999
   AND held_out_pass_rate < 0.5:         -0.5     # shallow-fix signal
else: 0.6*visible_rate + 0.3*held_out_rate + 0.1*lint_score
```

`lint_score` = `npx tsc --noEmit` exit 0. The 0.6/0.3/0.1 split favors
correctness over polish but bakes the held-out suite into the score so
overfit patches cap below a real fix.

## Held-out tests

Each task in `tasks.jsonl` references a held-out file (e.g.
`rate_limit.held.ts`) under `environments/code_agent/held_out/`. The rubric:

1. `docker cp`s the file into the container as
   `tests/_held_out/<name>.test.ts`.
2. Runs jest filtered to that path with `--testPathPattern`.
3. Removes the file before returning.

Held-out tests assert the *general* property (e.g. for `token_expiry`: `exp ≈
now + 3600`, not `exp - iat == 3600` exactly), so a fix that hardcodes the
visible assertions fails them. The agent's `read_file` / `list_files` tools
cannot see the host-side directory.

## Conventions

- Agent tool outputs truncated to 8000 bytes (`env/tools.py:_MAX_OUT`).
- Each rollout: `git reset --hard benchmark-base && git clean -fd` (the tag
  is the source of truth, not HEAD), then drop `prisma/test.db` and re-run
  `prisma migrate deploy`.
- Pydantic AI agent's `commit_result` writes onto a `agent-run-<id>` branch
  and switches back, so the baseline branch never advances.
- Container name and workspace path hardcoded in `Deps` and `env/tools.py`;
  change there if compose is renamed.
- When seeding new broken baselines: edit `app/`, then
  `docker exec dev-container bash -c "cd /workspace && git add -A && git commit -m '...' && git tag -f benchmark-base HEAD"`.
