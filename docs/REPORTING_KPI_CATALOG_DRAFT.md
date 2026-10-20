# Reporting KPI Catalog — Draft, Pending Business Approval

> **DRAFT — NOT AN APPROVED KPI CONTRACT.** No authoritative SRS, reporting rubric, or KPI decision record was available in the repository or supplied workspace. The catalog below describes the current implementation only; it does not settle business definitions, date semantics, or role policy.

## Current implementation observed

| Report output | Current source and calculation | Current scope / access | Contract status |
| --- | --- | --- | --- |
| `summary.today_revenue` | Sum of `invoices.total_amount` where invoice status is `PAID` and `date(paid_at)=date('now')` in `app/api/app/route.ts` | Current database date; included in the general snapshot | Observed implementation; timezone and gross/net meaning unapproved |
| `report.revenue` | Sum of paid invoice `total_amount`, `table_amount`, and `service_amount`, grouped by `substr(paid_at,1,10)` | `paid_at >= datetime('now','-30 day')`; `REPORTS_VIEW`; no caller-supplied date filter | Observed implementation; window boundaries and timezone unapproved |
| `report.tables` | Per-table count of `CLOSED` play sessions, sum of `play_sessions.table_amount`, and elapsed minutes from `started_at` to `ended_at` | All closed sessions; no invoice-status or date filter; `REPORTS_VIEW` | Observed implementation; whether minutes mean elapsed or pause-excluded billable time is unapproved |
| `report.products` | Sum of quantity and amount for `PRODUCT`/`SERVICE` invoice items on `PAID` invoices, grouped by item description | Top 20 across stored history; no date filter; `REPORTS_VIEW` | Observed implementation; duplicate descriptions and time window are unapproved |
| `report.inventory` | Current product stock/minimum stock plus accumulated `IN` quantity and `OUT`/`SALE` quantity | All products/history; no date filter; `REPORTS_VIEW` | Observed implementation; treatment of `ADJUST` and period-vs-lifetime totals is unapproved |

The UI presents these objects in `components/bidaflow-app.tsx`. The API sets `report` to `null` unless the user has `REPORTS_VIEW` (with the existing ADMIN override). This documents code behavior, not an approved access matrix.

## Decisions required before A16-01 can be approved

1. For revenue, decide whether the KPI means collected payments, paid invoice totals, recognized sales, or another definition; specify discounts, surcharges, partial payments, cancellations, refunds, and rounding.
2. Define the reporting timezone, inclusive/exclusive date boundaries, default period, and whether users need selectable start/end dates.
3. Define table utilization/revenue: which session states count, whether minutes exclude pauses, and whether cancelled/unpaid invoices are included.
4. Define product ranking: quantity or revenue, whether descriptions or product IDs identify an item, and the reporting period.
5. Define inventory flow periods and how adjustments, stock counts, and sales are represented.
6. Confirm roles allowed to view each report and whether any report requires finer-grained permission than `REPORTS_VIEW`.
7. Identify the accountable business owner and reviewer who approve these definitions.

## A16-03 validation evidence and gaps

- `tests/reporting-access.test.mjs` verifies that the current manager role receives the report object and the current cashier, service, and warehouse roles receive `report: null`.
- This test runs against the repository's in-memory SQLite/D1 mock. It does not verify production D1 data, KPI totals, period boundaries, timezone behavior, empty-range behavior, or selectable filters.
- The current API exposes no query parameters for report date/filter selection. Filter acceptance therefore remains `BLOCKED` on an approved filter contract; no guessed filter behavior was added.

## Source pointers

- `app/api/app/route.ts` — report queries and `REPORTS_VIEW` gate.
- `components/bidaflow-app.tsx` — report rendering and visible labels.
- `db/schema.ts` and `drizzle/0000_natural_silvermane.sql` — stored invoice, session, product, and inventory fields.
- `lib/server.ts` — current role/permission seed values; these are code evidence, not an approved project matrix.
