# Review of PLAN.md - Final Assessment

After reviewing the current PLAN.md in detail, I confirm it is complete, accurate, and ready for implementation. All previous concerns have been satisfactorily addressed.

## Summary of Contents

The plan outlines three new failure-rich tasks for the swe-regression-benchmark:

### Task 6: Email Normalization (Parser Edge Case)
- **Target**: Canonicalize email via `trim()` + `toLowerCase()` in `/register` and `/login`
- **Baseline**: Already stores/looks up email verbatim (no change needed)
- **Visible test**: Register "Alice@Example.com", login as "alice@example.com" → 200
- **Held-out**: Tests trailing whitespace, case duplicates, DB invariant, internal whitespace negative control
- **Failure-rich**: Catches agents who only normalize on one endpoint or use hardcoded fixes

### Task 7: Password Strength (Validation Rule with Hidden Case)
- **Target**: `/register` rejects passwords <8 chars OR no digit (HTTP 400)
- **Baseline**: `credsSchema.password` is `z.string().min(1)` (already true)
- **Visible test**: `"short"` → 400, `"longenough1"` → 201
- **Held-out**: 8-char no-digit, 7-char with digit, boundary case, negative control for legacy users
- **Trap surface**: Shared `credsSchema` between `/register` and `/login` is **intentional** - lazy agents who add validation to shared schema break legacy logins
- **Failure-rich**: Natural single-rule fix passes visible but fails one held-out branch

### Task 8: Structured `/me` Error Envelope (Config/Service Repair)
- **Target**: `/me` and `requireAuth` middleware return `{ error: { code, message } }` with distinct codes:
  - missing token → `"missing_token"`
  - invalid signature → `"invalid_token"`
  - expired JWT → `"expired_token"`
- **Baseline**: Currently returns JSON but with wrong shape (`{ error: 'unauthorized' }` / `{ error: 'invalid token' }`) - needs to be collapsed to `res.sendStatus(401)`
- **Visible test**: No header → `body.error.code === "missing_token"`, Bearer "garbage" → `code: "invalid_token"`
- **Held-out**: Expired token (should be `"expired_token"` not `"invalid_token"`), wrong scheme, valid token positive control, HTTP status exactly 401
- **Failure-rich**: Shallow fix of always returning `"invalid_token"` passes visible but fails held-out expired token case

## Implementation Details

**Files to Create:**
- `app/tests/auth/email_normalize.test.ts`
- `app/tests/auth/password_strength.test.ts`
- `app/tests/auth/me_errors.test.ts`
- `environments/code_agent/held_out/email_normalize.held.ts`
- `environments/code_agent/held_out/password_strength.held.ts`
- `environments/code_agent/held_out/me_errors.held.ts`

**Files to Edit:**
- `environments/code_agent/tasks/tasks.jsonl` (append 3 task rows)
- `app/src/middleware/auth.ts` (collapse error branches to `res.sendStatus(401)`)
- Re-tag baseline with `git tag -f benchmark-base HEAD`

**Infrastructure Reuse:**
- All scoring, held-out running, and shallow-fix detection uses existing code
- No new rubric branches or scoring changes needed

## Verification Plan

The plan provides a clear 5-step verification process:
1. Seed baseline and run container
2. Confirm baseline fails new visible tests
3. Confirm hand-written fix passes visible + held-out
4. Confirm shallow-fix detection works (reward = -0.5)
5. End-to-end agent run on all 3 tasks

## Conclusion

The plan successfully addresses the Deep24 requirements for three small, failure-rich tasks covering:
- (a) parser edge case (email normalization)
- (b) validation rule with one hidden case (password strength)
- (c) config/service-shape repair with real verification (/me errors)

Each task is designed so the most natural shallow fix passes visible tests but fails held-out ones, triggering the -0.5 shallow-fix branch in scoring.

The plan is comprehensive, technically accurate, and ready for immediate implementation. No further revisions are needed.