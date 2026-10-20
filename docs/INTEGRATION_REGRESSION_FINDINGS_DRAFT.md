# Integration and Regression Findings — Draft

> **DRAFT — evidence log, not an approved severity or risk acceptance.** The official API contract, severity scale, integration owner map, and tracker were not available. Findings remain open until the responsible owners review them.

## Finding BF-INT-001 — `invoice.pay` accepts payment methods outside the schema enum

| Field | Evidence / status |
| --- | --- |
| Area | `POST /api/action`, `invoice.pay` handler |
| Reproduction | Create an issued invoice with a positive outstanding balance. As an authenticated user with `PAYMENTS_MANAGE`, submit `{"action":"invoice.pay","payload":{"invoiceId":"<issued-invoice>","method":"NOT_A_SCHEMA_METHOD","amount":1000}}`. In the in-memory D1 test environment this returned HTTP 200 and stored the supplied method in `payments.method`. |
| Expected from current schema declaration | `db/schema.ts` declares `payments.method` with the values `CASH`, `BANK_TRANSFER`, `CARD`, and `EWALLET`. |
| Actual | The handler only checks that `method` is non-empty, then inserts it. The migration defines `payments.method` as `TEXT NOT NULL` without an enum `CHECK`, so the unexpected value persisted in the reproduction. |
| Impact | Payment-method data can contain values outside the declared schema set and may be omitted or misclassified by downstream reporting/reconciliation. No monetary loss was demonstrated. |
| Severity | `UNASSESSED` — no project severity rubric or risk acceptance was available. |
| Owner / dependency | Bùi Vạn Khải is assigned BF-PLAT-03 (GitHub issue #6), which remains open; API/action contract review also depends on BF-PLAT-01. |
| Proposed resolution | Ask the PLAT owner to confirm the allowed methods and error contract, then add runtime allowlist validation and a regression test in an owner-reviewed code PR. Do not change production behavior in this documentation task. |
| Status | `OPEN — OWNER / CONTRACT REVIEW REQUIRED` |

## Other observations not classified as defects

- `/api/app` exposes no request-selected report date/filter parameters. The present fixed periods are cataloged in `REPORTING_KPI_CATALOG_DRAFT.md`; expected filter behavior cannot be judged until the KPI contract is approved.
- The current table report computes elapsed minutes from session start/end. The project has pause-excluding billing logic, but whether this report should use billable minutes is a pending KPI definition, not a confirmed defect.

## Regression evidence

- Baseline branch `origin/main` at `8349079`: the repository test command's underlying Node invocation passed 39 tests, 0 failed, using the checked-in in-memory SQLite/D1 mock.
- A reporting access test added in PR #32 passes on its feature branch; it is draft and is not part of `main` until review/merge.
- A targeted ESLint run for the auth, app, action, and server files exited 0. A full-project ESLint invocation was interrupted after 30 seconds without output; full lint is therefore `NOT VERIFIED`.
- The direct `node scripts/run-framework.mjs build` command completed successfully from the source-equivalent branch; this is a local build, not a deployment test.
- `pnpm test` could not get past pnpm's package metadata/install check because registry access failed. The exact test script from `package.json`, invoked directly with Node, did run and pass.

## E2E / integration limits

- The current `main` test tree has no reservation/session lifecycle test file and no browser or deployed-environment E2E harness.
- A remote feature branch `origin/feat/BF-A10-reservations-and-sessions` contains `tests/reservations-sessions.test.mjs`, but it uses an in-memory fixture and is not merged into current `main`; it is not production E2E evidence.
- BF-A17-03 remains `BLOCKED` by the stated BF-A17-01/BF-A17-02 dependencies and by the missing owner-approved test environment/data. No sign-off or test attachment is inferred.
- BF-A18-02 can claim only the automated mock-suite result above. It cannot claim production integration, browser E2E, or stakeholder acceptance.

## Required owner decisions

1. BF-PLAT-03 owner: confirm the payment-method enum, invalid-input response, and whether to add schema-level protection in a separate reviewed change.
2. PM / domain owner: provide the approved KPI contract before deciding table-minute and report-filter expectations.
3. Integration owners: supply A17-01/A17-02 completion evidence, test environment, and sanitized fixture/data to run the real end-to-end flow.
4. QA owner: provide the project severity scale and decide whether any finding needs a risk acceptance or release block.
