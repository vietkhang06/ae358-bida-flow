# Draft PR Body — BF-A17 / BF-A18 Integration and Regression Evidence

> **DRAFT — findings and test limits only.** No production behavior changed, no defect was marked fixed, and no E2E sign-off is claimed.

## Tasks

BF-A17-02, BF-A17-03, BF-A18-02 (evidence and triage preparation).

## Included

- Record a reproducible `invoice.pay` schema/runtime mismatch and route it to the open BF-PLAT-03 owner dependency.
- Record the actual regression/build/lint evidence and the limits of mock-based testing.
- Distinguish the unmerged A10 mock-fixture test branch from tests present on `main`.

## Evidence

- Baseline test invocation on `origin/main` — 39 passed, 0 failed; in-memory SQLite/D1 mock.
- Targeted ESLint on auth/API/server files — exit 0; whole-project lint remains unverified.
- Local production build via `node scripts/run-framework.mjs build` — exit 0; no deployment performed.
- Reproduction of BF-INT-001 returned 200 and persisted a value outside the `db/schema.ts` method enum in the in-memory D1 fixture.
- `git diff --check` — run before commit.

## Pending

- Bùi Vạn Khải / BF-PLAT-03: confirm contract and approve any runtime/schema fix.
- PM/domain owner: approve report semantics that affect integration expectations.
- A17-01/A17-02 owners: provide dependency evidence and a real integration environment.
- QA owner: review severity and triage decisions.

Keep this PR in Draft. It does not close any task or accept release risk.
