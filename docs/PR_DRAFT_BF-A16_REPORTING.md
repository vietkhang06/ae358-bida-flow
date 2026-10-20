# Draft PR Body — BF-A16 Reporting Validation

> **DRAFT — partial evidence only.** This PR does not approve KPI definitions or complete implementation acceptance.

## Tasks

BF-A16-01, BF-A16-02, BF-A16-03 (audit and safe validation scope).

## Changes

- Add a code-grounded catalog of the report calculations and filters that currently exist, with business definitions and missing decisions marked pending.
- Add an automated test for the current `REPORTS_VIEW` access gate: manager receives the report object; cashier, service, and warehouse snapshots contain `report: null`.
- No report query, KPI formula, role assignment, schema, or application behavior changed.

## Evidence

- `node --experimental-strip-types --import ./tests/helpers/register-loader.mjs --test 'tests/**/*.test.mjs'` — 40 tests passed, 0 failed.
- `node ./node_modules/eslint/bin/eslint.js tests/reporting-access.test.mjs` — exit 0.
- `git diff --check` — exit 0 after staging.
- Tests use the repository's in-memory SQLite/D1 mock; they do not prove production D1 totals or date/filter behavior.

## Acceptance still pending

- PM/business owner supplies approved KPI definitions, periods, timezone, filters, and data interpretation.
- Reviewer confirms the report permission matrix against the authoritative SRS/tracker.
- A16-02 requires implementation against the approved contract; no guessed filter or formula was added.
- A16-03 still needs approved totals, date-boundary, empty-range, filter, and production-data validation.

Keep this PR in Draft until those decisions and remaining acceptance evidence are supplied.
