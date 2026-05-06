# Plan: Add 3 failure-rich tasks to swe-regression-benchmark

> Plan-mode note: the user asked for a `plan.md`. Plan mode only permits writing
> this designated plan file. After approval (ExitPlanMode), the same content can
> be copied to `plan.md` at the repo root if desired.

## Context

The benchmark currently has 4 real tasks + 1 negative control
(`environments/code_agent/tasks/tasks.jsonl`), all in the auth domain
(rate-limit, validation, JWT expiry, bcrypt full-flow). They're solid but
narrow: there is no parser-edge-case task, no task whose hidden cases probe a
*nearby* validation rule, and no config/service-shape task.

The Deep24 description asks specifically for three small, failure-rich tasks
covering: (a) parser edge case, (b) validation rule with one hidden case,
(c) config/CLI/service repair with real verification — each with hidden checks
that catch shallow fixes.

This plan adds those three tasks on top of the existing harness. No new
infrastructure is needed: tasks are just new rows in `tasks.jsonl`, new visible
test files inside `app/tests/auth/`, new held-out files under
`environments/code_agent/held_out/`, and small "broken on purpose" edits to
`app/src/` re-tagged as `benchmark-base`. The reward shape, shallow-fix
detector, and held-out runner all already exist (`environments/code_agent/code_agent.py:61-148`,
`env/tools.py:145-274`).

## The 3 new tasks

Each task is designed so the most natural shallow fix passes the visible test
and fails the held-out one — driving the `-0.5` shallow-fix branch in
`_score_rollout` (`environments/code_agent/code_agent.py:120-129`).

### Task 6 — Parser edge case: email normalization

**Failure mode targeted:** "patch works only in the current fixture";
"hardcodes the visible test case".

**Requirement:** `/register` and `/login` must canonicalize email by
`trim()` + `toLowerCase()` before hitting the DB, so `"  Alice@Example.com  "`
and `"alice@example.com"` are the *same* account.

**Baseline break (in `app/src/routes/auth.ts`):** store and look up email
verbatim. Already broken on the baseline diff — just leave it.

**Visible test (`app/tests/auth/email_normalize.test.ts`):**
- Register `"Alice@Example.com"`, then login as `"alice@example.com"` → 200.

**Held-out (`environments/code_agent/held_out/email_normalize.held.ts`):**
- Trailing whitespace: register `"  bob@x.com  "`, login `"bob@x.com"` → 200.
- Duplicate via case: after registering `"carol@x.com"`, registering
  `"CAROL@X.COM"` → 409.
- DB invariant: stored `email` column is lowercase + trimmed (Prisma query
  inside the test).
- Negative control: `"dave@x.com"` and `"d ave@x.com"` (internal space) are
  *not* the same — internal whitespace is not collapsed.

**Why this is failure-rich:** an agent that only adds `.toLowerCase()` at
`/register` (not `/login`) passes the visible test but fails the duplicate
case. Hardcoding `if (email === "Alice@Example.com")` triggers
`detect_hardcoded_values` only if it touches NODE_ENV — but the held-out
permutations alone defeat fixture-specific patches. The internal-whitespace
negative case catches over-eager `replaceAll(' ', '')` fixes.

### Task 7 — Validation with one hidden case: password strength

**Failure mode targeted:** "agent weakens validation"; "passes visible but
fails nearby hidden case".

**Requirement:** `/register` rejects passwords shorter than 8 characters OR
containing no digit, with HTTP 400. Existing zod schema `credsSchema` already
exists; extend it.

**Baseline break:** `credsSchema.password` is `z.string().min(1)` — already
true on baseline.

**Visible test (`app/tests/auth/password_strength.test.ts`):**
- `"short"` → 400.
- `"longenough1"` → 201.

**Held-out (`environments/code_agent/held_out/password_strength.held.ts`):**
- 8-char no-digit `"abcdefgh"` → 400 (catches "min(8) only" shallow fix).
- 7-char with digit `"abc1234"` → 400 (catches "has digit" shallow fix).
- Boundary `"abcdefg1"` (exactly 8, has digit) → 201.
- Negative-control: existing accounts with weak passwords still *log in*
  successfully (rule is at registration only — catches agents that "tighten"
  login too and break legacy users).

**Why this is failure-rich:** the natural single-rule fix (`.min(8)` or
"contains digit") passes visible, fails one held-out branch. Tightening login
breaks the negative-control case. A regex-based shallow fix that only checks
ASCII letters can be probed by the boundary case.

**Trap surface (do NOT pre-fix on baseline):** `credsSchema` at
`app/src/routes/auth.ts:10-13` is intentionally shared between `/register`
(`:26`) and `/login` (`:44`). This shared schema is *load-bearing for the
trap*: the lazy agent slaps `.min(8).regex(/\d/)` onto `credsSchema` because
it's right there, which then breaks login for legacy weak-password accounts
and fails the held-out negative control. The agent who actually thinks
splits the schema (or moves the check into the register handler). Leaving
the shared schema in place on baseline is the whole point — do not split it
preemptively.

### Task 8 — Service repair: structured `/me` error envelope

**Failure mode targeted:** "agent fixes snapshot/output instead of root
behavior"; "skips or fakes verification".

**Requirement:** `/me` (and `requireAuth` middleware in
`app/src/middleware/auth.ts`) must return a structured error body
`{ error: { code, message } }` with distinct `code`s:
- missing `Authorization` header → `code: "missing_token"`
- malformed/invalid signature → `code: "invalid_token"`
- expired JWT → `code: "expired_token"`
All three return HTTP 401.

**Baseline break:** the *current* middleware
(`app/src/middleware/auth.ts:11,19`) already returns JSON, but with the
wrong shape (`{ error: 'unauthorized' }` / `{ error: 'invalid token' }`,
just two branches — `jwt.verify` failures all get lumped into "invalid
token", with no separate expired-token branch). To break the baseline for
this task, collapse both branches to `res.sendStatus(401)` (no body), so
the visible assertion `body.error.code === "missing_token"` cleanly fails.
(Leaving the current `{error: string}` shape would *also* fail the visible
test, since there's no `code` key — but `sendStatus(401)` is the cleaner,
more obviously-broken baseline.)

**Visible test (`app/tests/auth/me_errors.test.ts`):**
- No header → `body.error.code === "missing_token"`, status 401.
- Bearer of literal string `"garbage"` → `code: "invalid_token"`.

**Held-out (`environments/code_agent/held_out/me_errors.held.ts`):**
- Expired token (manually signed with `exp: now - 60`) → `code:
  "expired_token"` (not `invalid_token`).
- Header `"Token abc"` (wrong scheme) → `code: "missing_token"` or
  `"invalid_token"` — but **not** a 500.
- Valid token still returns 200 with `{ id, email }` (positive control —
  catches agents that "fix" by always 401-ing).
- HTTP status is exactly 401 in all error cases (not 400/403/500).

**Why this is failure-rich:** the shallow fix is to always return
`code: "invalid_token"`, which passes both visible cases. Distinguishing
*expired* from *invalid* requires actually catching `TokenExpiredError` from
`jsonwebtoken`. Agents that "fake" verification by returning
`{ error: { code: "invalid_token" } }` unconditionally lose the
positive-control (200) case.

## Files to modify / create

**New:**
- `app/tests/auth/email_normalize.test.ts`
- `app/tests/auth/password_strength.test.ts`
- `app/tests/auth/me_errors.test.ts`
- `environments/code_agent/held_out/email_normalize.held.ts`
- `environments/code_agent/held_out/password_strength.held.ts`
- `environments/code_agent/held_out/me_errors.held.ts`

**Edit:**
- `environments/code_agent/tasks/tasks.jsonl` — append 3 task rows. Match
  the existing **flat** on-disk schema exactly (verified by reading
  `tasks.jsonl:1-5`): each row has top-level keys `task`,
  `acceptance_criteria`, `difficulty`, `regression_target`,
  `visible_tests`, `held_out_tests`. **Note:** the prompt key is `task`
  (not `prompt`) and `visible_tests` / `held_out_tests` are top-level (no
  `info.` nesting in the JSONL — Verifiers wraps them into `info` at load
  time, but that's runtime, not the file format).
- `app/src/routes/auth.ts` — relax email handling on baseline (store verbatim,
  case-sensitive lookup). Already broken; just confirm.
- `app/src/middleware/auth.ts` — collapse error branches into
  `res.sendStatus(401)` so the structured envelope is missing on baseline.
- Re-tag baseline:
  ```bash
  docker exec dev-container bash -c \
    "cd /workspace && git add -A && git commit -m 'broken baseline: email normalize, password strength, /me errors' && git tag -f benchmark-base HEAD"
  ```
  (per CLAUDE.md "seeding new broken baselines" convention).

## Reused infrastructure (do not reimplement)

- `_run_held_out` copies `*.held.ts` → `tests/_held_out/*.test.ts` and runs
  jest with `--testPathPattern` (`environments/code_agent/code_agent.py:61-80`).
- `detect_hardcoded_values` flags `NODE_ENV` shortcuts in the diff
  (`env/tools.py:249-274`).
- `_score_rollout` already implements the visible/held-out/lint reward and the
  shallow-fix `-0.5` branch (`environments/code_agent/code_agent.py:83-148`).
- `BASELINE_REF = "benchmark-base"` reset between rollouts
  (`env/tools.py:289`).

No code changes needed in any of the above.

## Verification

After implementing on a feature branch:

1. **Container up + baseline seeded:**
   ```bash
   docker compose up -d
   docker exec dev-container bash -c "cd /workspace && npm ci && npx prisma migrate deploy"
   ```

2. **Confirm baseline fails new visible tests** (proves the break is real):
   ```bash
   docker exec dev-container bash -c \
     "cd /workspace && npx jest tests/auth/email_normalize.test.ts tests/auth/password_strength.test.ts tests/auth/me_errors.test.ts"
   ```
   All three should fail.

3. **Confirm a hand-written correct fix passes visible AND held-out** (proves
   each task is solvable). For each new task, manually apply the intended fix
   on a scratch branch, then:
   ```bash
   ./venv/bin/python -m agent.main "<task prompt>"   # or apply by hand
   docker cp environments/code_agent/held_out/email_normalize.held.ts \
     dev-container:/workspace/tests/_held_out/email_normalize.test.ts
   docker exec dev-container bash -c \
     "cd /workspace && npx jest tests/auth/email_normalize.test.ts tests/_held_out/email_normalize.test.ts"
   ```
   Both files green ⇒ task is solvable.

4. **Confirm shallow-fix detection** (proves the rubric earns its keep): apply
   a deliberately shallow fix (e.g. `if (email === "Alice@Example.com")
   email = email.toLowerCase()`), run the eval against just the new task,
   and confirm reward = `-0.5`. `vf-eval` (v0.4.x) has no `--task-id` flag,
   so filter by reordering the dataset or temporarily moving the target row
   to the top of `tasks.jsonl` and using `NUM_EXAMPLES=1`:
   ```bash
   # temporarily move the email_normalize row to line 1 of tasks.jsonl
   NUM_EXAMPLES=1 ./run_eval.sh
   sqlite3 metrics/runs.db \
     "select prompt, passed, total, held_out_passed, held_out_total, shallow_fix, reward from runs order by ts desc limit 3;"
   ```
   Expect `shallow_fix=1` and `reward=-0.5` for that row. (Alternative:
   invoke `vf-eval` directly with `-n 1` after reordering — see CLAUDE.md
   for the direct command.)

5. **End-to-end agent run** on all 3 new tasks:
   ```bash
   NUM_EXAMPLES=3 MODEL=gpt-4.1 ./run_eval.sh
   ```
   Inspect `metrics/runs.db` for per-task reward. The deliverable failure
   catalog comes from this run.

## Out of scope

- No new rubric branches or scoring changes.
- No CLI/Click subcommand task (deferred — would require new app surface).
- No changes to the Pydantic AI agent.
