# BidaFlow API / Action Contract — Source Inventory Draft

> **CODE-OBSERVED DRAFT — VERIFIED AGAINST `origin/main` SNAPSHOT `74307d4f27c406b5bfb02183ea57d350d6dd73a6` (2026-10-20), PENDING PROVIDER/CONSUMER AND REVIEWER CONFIRMATION.** This records current implementation behavior, not an approved product contract. Human module/file owners and SRS/Use Case mappings remain `UNVERIFIED`; the tracker and SRS are unavailable. No application code was changed for this documentation task.

## 1. Scope and source map

| Route | Method | Purpose / consumer | Server authorization | Source |
| --- | --- | --- | --- | --- |
| `/api/auth/status` | GET | Initialization state and current user; UI calls on load | No login required | [status route](../app/api/auth/status/route.ts) |
| `/api/auth/login` | POST | Create authenticated session | Same-origin check; validates credentials and active status | [login route](../app/api/auth/login/route.ts) |
| `/api/auth/register` | POST | First admin registration or invite-based registration | Same-origin check; setup code or valid invitation | [register route](../app/api/auth/register/route.ts) |
| `/api/auth/logout` | POST | Delete current session and clear cookie | Same-origin check; can clear cookie without a current user | [logout route](../app/api/auth/logout/route.ts) |
| `/api/app` | GET | Permission-filtered app snapshot and optional reports | `requireUser`; each dataset is filtered by permission | [app route](../app/api/app/route.ts) |
| `/api/action` | POST | Dispatcher for 42 action names listed below | Same-origin check, `requireUser`, permission map for delegated operations plus legacy per-case checks | [action route](../app/api/action/route.ts), [operation map](../lib/operations.ts) |

The only API route files found under `app/api/` are the six above. `components/bidaflow-app.tsx` contains a generic `run(action, payload)` caller, direct UI callers, and connector operation adapters; it sends `{ action, payload }`, reads `response.data`, normally refreshes `/api/app`, and displays `json.error` on failure. The current dispatcher delegates 24 names through `operationPermissions` to catalog, reservation, session, and order action modules; it handles 18 additional names in its switch. Those counts are source-derived and total 42. Human module owners and code-area owners are not identifiable from source; see the separate shared-file ownership draft.

## 2. Shared request, response, and authorization behavior

### `/api/action`

Request: `POST` JSON `{ "action": "<action-name>", "payload": { ... } }`. `payload` defaults to `{}`. The TypeScript `Body` annotation is a compile-time cast; the route does basic runtime checks for a string action and an object payload (not an array), but there is no single full-request/per-action schema. The 24 delegated operations use `lib/operation-validation.ts` helpers (`required`, typed `text`, bounded `numeric`, offset-required `timestamp`); the 18 legacy cases use local helpers and case-specific checks. Missing-number-to-zero behavior therefore applies only to the legacy helper paths and is not a contract-wide default.

Successful response: `200 { "ok": true, "data": <result> }`. For actions without an explicit `result`, `data` is `null`. Exceptions are the action-specific result objects in the table.

### Authorization / origin

- All `/api/action` requests call `assertSameOrigin` and `requireUser` before dispatch. If an `Origin` header is present and differs from the request URL origin, the handler returns an `AppError` with status `403`; an absent Origin header is accepted by this helper.
- `requireUser` returns `401` when unauthenticated. Delegated operation permissions are mapped in `lib/operations.ts`; `ADMIN` bypasses them. The dispatcher’s remaining switch cases call `requireAny` where applicable, also with an `ADMIN` bypass. In addition, `session.pause`, `session.resume`, and `session.transfer` contain role-code checks that limit them to `ADMIN`, `MANAGER`, and `CASHIER` even if a permission is present.
- `profile.update` and `password.change` have no action-specific permission check in the dispatcher; they still require an authenticated user. Their server code binds the update to that current user's ID.
- Role permission definitions and default role assignments are in [server authorization](../lib/server.ts). They are implementation data, not a tracker-based ownership map.

### Current error behavior

| Case | Current HTTP status | Current body / evidence |
| --- | --- | --- |
| `AppError` with default status | 400 | `{ "error": "<message>" }` |
| Unauthenticated | 401 | Error envelope from `requireUser` / `responseError` |
| Permission or origin rejected | 403 | Error envelope from `requireUser` / `assertSameOrigin` |
| Unsupported action string | 404 | `{ "error": "Thao tác không được hỗ trợ." }` |
| Invalid JSON / invalid top-level action or payload shape | 400 | `AppError` message through `responseError`; see request checks in the current dispatcher |
| Delegated missing record / uniqueness or changed-state conflict | 404 or 409 in operation helpers | Current error envelope; several legacy validations still use default 400 |
| Unique constraint exception in `/api/action` | 400 | Generic duplicate/state-changed Vietnamese message |
| Foreign-key exception in `/api/action` | 400 | Generic related-data message |
| Other unhandled exception | 500 | `{ "error": "Hệ thống đang bận. Vui lòng thử lại." }`; server logs the exception |
| `/api/auth/register` missing setup configuration | 503 | `AppError` message |
| `/api/auth/register` duplicate email | 409 | `AppError` message |

No stable `error.code`, field-error collection, or request/correlation ID is emitted by these handlers. Some resource/state validation failures use the default 400 even when they could be distinguished as not-found or conflict. Malformed JSON is caught by the current dispatcher and returned as a default-status 400 `AppError`; it does not intentionally fall through to the generic 500 path. Error conditions and status codes differ between delegated modules and legacy switch cases. These are observations from current source, not a proposal to change runtime behavior.

### Proposed normalization (not implemented / not binding)

`PROPOSED — PENDING REVIEW`: preserve the current Vietnamese user-facing `message`, and add a stable machine-readable `code` in a versioned envelope, for example `{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }`. Candidate codes/statuses for team discussion: `AUTHENTICATION_REQUIRED` (401), `PERMISSION_DENIED` / `ORIGIN_REJECTED` (403), `VALIDATION_ERROR` (400), `ACTION_NOT_FOUND` (404), `STATE_CONFLICT` (409), `CONFIGURATION_UNAVAILABLE` (503), and `INTERNAL_ERROR` (500). Define this only after consumer review; the current contract remains the behavior above.

## 3. Authentication and app-read contracts

| Endpoint | Request fields | Current success response | Important validation / permission |
| --- | --- | --- | --- |
| `GET /api/auth/status` | None | `{ initialized: boolean, user: AppUser \| null }` | `initialized` is whether any user exists; user comes from the session cookie if valid. |
| `POST /api/auth/login` | Required: `identity`, `password` | `200 { ok: true }` plus `Set-Cookie` | Identity is normalized and matched against email or username. Invalid credentials return 401; locked account returns 403. |
| `POST /api/auth/register` | Required: `fullName`, `email`, `password`; first user also needs `setupCode`; later users need `invitationCode` | `201 { ok: true }` plus `Set-Cookie` | Name length >= 2, email contains `@`, password >= 10 chars and includes lower/upper/digit/special. First user needs configured `SETUP_CODE`; subsequent registration needs valid unused, unexpired invitation and matching invited email when set. Duplicate email returns 409. |
| `POST /api/auth/logout` | No required body fields | `200 { ok: true }` plus clearing `Set-Cookie` | Deletes the session when a cookie exists; records logout audit when a current user is found. |
| `GET /api/app` | None | `{ user, summary, areas, tableTypes, priceRules, tables, sessions, reservations, categories, products, orders, orderItems, customers, tiers, invoices, invoiceItems, payments, inventory, shifts, users, roles, permissionRows, auditLogs, report }` | Login required. Collections are permission-filtered; `report` is `null` unless `REPORTS_VIEW` is allowed. The snapshot computes live session amounts. |

The session cookie is named `bidaflow_session`, has `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and a seven-day max age. The server stores a hash of the session token. This describes current source behavior, not a new identity requirement.

`/api/app` report object (when authorized) currently contains `revenue`, `tables`, `products`, and `inventory`. The `summary` currently contains table count, playing count, today's reservations, today's paid revenue, and low-stock count. The route exposes no separate report endpoint.

## 4. Action inventory

Provider for all rows: `POST /api/action` in `app/api/action/route.ts`, with 24 operations delegated through `lib/operations.ts` and 18 remaining switch cases. Consumers observed in `components/bidaflow-app.tsx` include its generic `run(action, payload)`, UI action handlers, and connector operation adapters. Task-specific provider/consumer owners and SRS/UC mappings are `UNVERIFIED`. Required and optional/default fields below reflect current handler reads and validation, not a formally approved runtime schema. Current implementation exposes 42 names; `session.start` and `reservation.seat` share one implementation block.

### Account, areas, tables, and pricing

| Action | Required payload | Optional / defaults | Server permission | Success `data` / key current checks |
| --- | --- | --- | --- | --- |
| `profile.update` | `fullName` | `phone` | Authenticated | `null`; updates only current user's profile. |
| `password.change` | `currentPassword`, `newPassword` | — | Authenticated | `null`; new password must meet 10-character complexity rule and current password must verify. |
| `user.invite` | `roleId` | `email` | `USERS_MANAGE` | `{ invitationCode, expiresAt }`; role must exist; invitation expiry is 72 hours. Code is returned once; only its hash is stored. |
| `user.update` | `id`, `roleId`, `fullName` | `phone`; `status` defaults to `ACTIVE` unless exactly `LOCKED` | `USERS_MANAGE` | `null`; prevents current user locking self; locking target deletes their sessions. |
| `role.permissions` | `roleId` | `permissionCodes` defaults to `[]` | `ROLES_MANAGE` | `null`; `role_admin` cannot be reduced by this action. The handler replaces role links using codes found in the permission table; unknown codes are not inserted. |
| `area.save` | `code`, `name` | `id`, `description`, `sortOrder` default `0` | `TABLES_MANAGE` | `{ id }`; typed string checks, uniqueness check; insert/update. |
| `area.delete` | `id` | — | `TABLES_MANAGE` | `{ id }`; soft-deactivates only when no active table references the area. |
| `tableType.save` | `code`, `name` | `id`, `description`, `baseHourlyRate` default `0`, `color` default `#16a085` | `PRICES_MANAGE` | `{ id }`; code uppercased; nonnegative integer rate; color must be `#RRGGBB`; uniqueness check. |
| `tableType.delete` | `id` | — | `PRICES_MANAGE` | `{ id }`; soft-deactivates only when no active table references the type. |
| `table.save` | `code`, `name`, `areaId`, `tableTypeId` | `id`, `notes`, `sortOrder` default `0` | `TABLES_MANAGE` | `{ id }`; area/type must be active; cannot change table area/type while it has an active/paused session; insert/update. |
| `table.delete` | `id` | — | `TABLES_MANAGE` | `{ id }`; soft-deactivates only with no active session, issued/draft invoice, or pending/confirmed future reservation. |
| `table.status` | `id`, `status` | — | `TABLE_STATUS` | `{ id }`; status limited to `AVAILABLE`, `RESERVED`, `MAINTENANCE`; state must match current booking and no active/paused session. |
| `price.save` | `tableTypeId`, `name`, `hourlyRate` | `id`, `daysMask` default `127`, `startMinute` default `0`, `endMinute` default `1440`, `priority` default `0`, offset-bearing `effectiveFrom`, `effectiveTo` | `PRICES_MANAGE` | `{ id }`; rate/minutes/priority are integers; days mask 1–127, start 0–1439, end 1–1440, start < end; checks temporal overlap at same priority. |
| `price.delete` | `id` | — | `PRICES_MANAGE` | `{ id }`; soft-deactivates rule. |

### Reservations, sessions, products, and orders

| Action | Required payload | Optional / defaults | Server permission | Success `data` / key current checks |
| --- | --- | --- | --- | --- |
| `reservation.save` | `tableId`, offset-bearing `startsAt`, `endsAt`, `customerName`, `customerPhone` | `id`, active `customerId`, `guestCount` default `1` (integer, >=1), `status` default `PENDING`, `notes` | `RESERVATIONS_MANAGE` | `{ reservationId }`; timestamps require explicit offset; end must be future and after start; overlapping active booking/session rejected. |
| `reservation.status` | `id`, `status` | — | `RESERVATIONS_MANAGE` | `{ reservationId }`; transition accepts `CONFIRMED`, `CANCELLED`, or `NO_SHOW`; terminal/SEATED rows cannot be reopened. |
| `session.start` | `tableId` | `customerId`, `notes` | `SESSIONS_MANAGE` | `{ sessionId }`; rejects maintenance, another active session, or conflicting active booking; snapshots active rate. |
| `reservation.seat` | `reservationId` | `notes` | `SESSIONS_MANAGE` | `{ sessionId }`; reservation must be CONFIRMED; rejects concurrent active session/booking; reservation becomes SEATED. |
| `session.pause` | `sessionId` | `reason` | `SESSIONS_MANAGE` plus role `ADMIN`/`MANAGER`/`CASHIER` | `{ sessionId }`; only ACTIVE session with open segment can pause. |
| `session.resume` | `sessionId` | — | `SESSIONS_MANAGE` plus role `ADMIN`/`MANAGER`/`CASHIER` | `{ sessionId }`; only PAUSED session can resume; closes open pause. |
| `session.transfer` | `sessionId`, `toTableId` | `reason` | `SESSIONS_MANAGE` plus role `ADMIN`/`MANAGER`/`CASHIER` | `{ sessionId }`; session must be ACTIVE/PAUSED; target must differ and be available; closes old segment and creates a new rate segment; transfer resumes a paused session. |
| `session.end` | `sessionId` | `confirmPendingOrders` (boolean) | `SESSIONS_MANAGE` | `{ tableAmount, pendingOrders }`; requires explicit `confirmPendingOrders: true` when pending/preparing items exist. |
| `category.save` | `code`, `name` | `id`, `sortOrder` default `0` | `PRODUCTS_MANAGE` | `{ id }`; code/name uniqueness is checked. |
| `category.delete` | `id` | — | `PRODUCTS_MANAGE` | `{ id }`; soft-deactivates only when no active product uses the category. |
| `product.save` | `code`, `name`, `salePrice` (nonnegative integer) | `id`, `categoryId`, `kind` default `PRODUCT` (`PRODUCT` or `SERVICE` only), `unit` default `phần`, `costPrice` and `minStock` default `0`, `trackStock` default true | `PRODUCTS_MANAGE` | `{ id }`; `trackStock` must be boolean; service disables stock tracking; kind/tracking cannot change when existing stock or order history prevents it. |
| `product.delete` | `id` | — | `PRODUCTS_MANAGE` | `{ id }`; soft-deactivates product. |
| `order.add` | `sessionId`, `productId`, positive numeric `quantity` | `notes` | `ORDERS_MANAGE` | `{ itemId, orderId }`; session active/paused and unbilled; product active; checks available stock and prevents a second open order. |
| `order.item.update` | `itemId`, positive numeric `quantity` | `notes` | `ORDERS_MANAGE` | `{ itemId }`; item/order must remain open and unbilled; served/cancelled item cannot be edited; checks stock. |
| `order.item.status` | `itemId`, `status` | — | `ORDERS_MANAGE` | `{ itemId }` or `{ itemId, unchanged: true }`; allowed transitions PENDING→PREPARING/SERVED/CANCELLED and PREPARING→SERVED/CANCELLED; serving tracked stock decrements stock and writes inventory ledger. |

### Customers, memberships, invoices, inventory, and shifts

| Action | Required payload | Optional / defaults | Server permission | Success `data` / key current checks |
| --- | --- | --- | --- | --- |
| `customer.save` | `fullName` | `id`, `phone`, `email`, `dateOfBirth`, `notes` | `CUSTOMERS_MANAGE` | `null`; email is lowercased/trimmed when present. |
| `tier.save` | `code`, `name` | `id`, `minPoints` default `0`, `discountPercent` default `0` | `MEMBERSHIPS_MANAGE` | `null`; discount must be 0–100; code uppercased. |
| `membership.save` | `customerId`, `tierId` | — | `MEMBERSHIPS_MANAGE` | `null`; updates existing membership or inserts one; sets active. |
| `invoice.create` | `sessionId` | — | `INVOICES_MANAGE` | `{ invoiceId, total }`; session must be CLOSED and have no non-cancelled invoice; snapshots table and non-cancelled order items; active membership benefit may be added. |
| `invoice.adjust` | `invoiceId`, `description`, positive `amount` | `type` (only exact `SURCHARGE` becomes surcharge; other values become `DISCOUNT`) | `INVOICES_MANAGE` | `{ total }`; invoice must be ISSUED; recalculates invoice. |
| `invoice.pay` | `invoiceId`, `method` | `amount` defaults to remaining balance when numeric value is 0; `reference` | `PAYMENTS_MANAGE` | `null`; only ISSUED invoice, positive payment not above remaining; CASH requires the caller's open shift; partial payment is supported. |
| `invoice.cancel` | `invoiceId`, `reason` | — | `INVOICES_MANAGE` | `null`; only DRAFT/ISSUED invoice can be cancelled. |
| `invoice.split` | `invoiceId`, non-empty `itemIds` array | — | `INVOICES_MANAGE` | `{ invoiceId }` (new invoice ID); source invoice must be ISSUED and must retain at least one item. |
| `invoice.merge` | `targetInvoiceId`, non-empty `sourceInvoiceIds` array | — | `INVOICES_MANAGE` | `null`; target and all source invoices must be ISSUED; source items move to target and sources become CANCELLED. |
| `inventory.move` | `productId`, `type`, `quantity`, `reason` | `unitCost` | `INVENTORY_MANAGE` | `null`; type `IN`, `OUT`, `ADJUST`; quantity cannot be negative; non-adjust quantity > 0; resulting stock cannot be negative. |
| `stock.count` | non-empty `items` array; each item has `productId`, `actualQuantity` | top-level `notes`; per-item `notes` | `INVENTORY_MANAGE` | `null`; actual quantity >= 0; creates completed count and adjustment transaction for differences. |
| `shift.open` | None enforced by `required()` | `openingCash` defaults `0`, `notes` | `SHIFTS_MANAGE` | `null`; opening cash >= 0; one open shift per current cashier. |
| `shift.close` | None enforced by `required()` | `actualCash` defaults `0`, `notes` | `SHIFTS_MANAGE` | `{ expectedCash, difference }`; requires current cashier open shift; actual >= 0; expected cash computed from movements. |

## 5. Examples based on current handlers

Unless a handler/helper sets another status, `AppError` validations described in the action rows use the default HTTP 400 and `{ "error": "<message>" }` envelope. The delegated action modules explicitly use 404 for selected missing-record cases and 409 for uniqueness/state-change conflicts; those conditions are called out in the affected rows. Central authorization, origin, unsupported-action, unique/FK mapping, and unexpected-error statuses are listed above. These are source observations, not an approved error contract.

Successful session start (IDs are generated at runtime):

```http
POST /api/action
Content-Type: application/json

{"action":"session.start","payload":{"tableId":"<existing-table-id>"}}
```

```json
{"ok":true,"data":{"sessionId":"<generated-session-id>"}}
```

Unsupported action (current behavior):

```http
404
{"error":"Thao tác không được hỗ trợ."}
```

Business failures return the shared error envelope; the exact status/message depends on the thrown `AppError` and shared mapping above.

### Request payload examples for every dispatched action

These are illustrative payloads made from fields the current handlers read. Placeholder strings are not real identifiers or credentials. The action table distinguishes the current data result: direct legacy switch cases generally return `null`; delegated operation modules generally return an entity/result object.

```json
{"action":"profile.update","payload":{"fullName":"<name>"}}
{"action":"password.change","payload":{"currentPassword":"<current-password>","newPassword":"<new-password>"}}
{"action":"user.invite","payload":{"roleId":"<role-id>"}}
{"action":"user.update","payload":{"id":"<user-id>","roleId":"<role-id>","fullName":"<name>"}}
{"action":"role.permissions","payload":{"roleId":"<role-id>","permissionCodes":["TABLES_VIEW"]}}
{"action":"area.save","payload":{"code":"AREA1","name":"<name>"}}
{"action":"area.delete","payload":{"id":"<area-id>"}}
{"action":"tableType.save","payload":{"code":"TYPE1","name":"<name>"}}
{"action":"tableType.delete","payload":{"id":"<table-type-id>"}}
{"action":"table.save","payload":{"code":"T01","name":"<name>","areaId":"<area-id>","tableTypeId":"<type-id>"}}
{"action":"table.delete","payload":{"id":"<table-id>"}}
{"action":"table.status","payload":{"id":"<table-id>","status":"MAINTENANCE"}}
{"action":"price.save","payload":{"tableTypeId":"<type-id>","name":"<name>","hourlyRate":100000}}
{"action":"price.delete","payload":{"id":"<price-rule-id>"}}
{"action":"reservation.save","payload":{"tableId":"<table-id>","startsAt":"<ISO-date-time>","endsAt":"<ISO-date-time>","customerName":"<name>","customerPhone":"<phone>"}}
{"action":"reservation.status","payload":{"id":"<reservation-id>","status":"CONFIRMED"}}
{"action":"session.start","payload":{"tableId":"<table-id>"}}
{"action":"reservation.seat","payload":{"reservationId":"<reservation-id>"}}
{"action":"session.pause","payload":{"sessionId":"<session-id>"}}
{"action":"session.resume","payload":{"sessionId":"<session-id>"}}
{"action":"session.transfer","payload":{"sessionId":"<session-id>","toTableId":"<table-id>"}}
{"action":"session.end","payload":{"sessionId":"<session-id>"}}
{"action":"category.save","payload":{"code":"CAT1","name":"<name>"}}
{"action":"category.delete","payload":{"id":"<category-id>"}}
{"action":"product.save","payload":{"code":"PRD1","name":"<name>","salePrice":10000}}
{"action":"product.delete","payload":{"id":"<product-id>"}}
{"action":"order.add","payload":{"sessionId":"<session-id>","productId":"<product-id>","quantity":1}}
{"action":"order.item.update","payload":{"itemId":"<item-id>","quantity":2}}
{"action":"order.item.status","payload":{"itemId":"<item-id>","status":"PREPARING"}}
{"action":"customer.save","payload":{"fullName":"<name>"}}
{"action":"tier.save","payload":{"code":"TIER1","name":"<name>"}}
{"action":"membership.save","payload":{"customerId":"<customer-id>","tierId":"<tier-id>"}}
{"action":"invoice.create","payload":{"sessionId":"<closed-session-id>"}}
{"action":"invoice.adjust","payload":{"invoiceId":"<invoice-id>","description":"<reason>","amount":1000}}
{"action":"invoice.pay","payload":{"invoiceId":"<invoice-id>","method":"CASH"}}
{"action":"invoice.cancel","payload":{"invoiceId":"<invoice-id>","reason":"<reason>"}}
{"action":"invoice.split","payload":{"invoiceId":"<invoice-id>","itemIds":["<item-id>"]}}
{"action":"invoice.merge","payload":{"targetInvoiceId":"<target-invoice-id>","sourceInvoiceIds":["<source-invoice-id>"]}}
{"action":"inventory.move","payload":{"productId":"<product-id>","type":"IN","quantity":1,"reason":"<reason>"}}
{"action":"stock.count","payload":{"items":[{"productId":"<product-id>","actualQuantity":1}]}}
{"action":"shift.open","payload":{}}
{"action":"shift.close","payload":{}}
```

## 6. Review gaps / contract decisions

### Provider/consumer confirmation matrix

| Participant / boundary | Evidence and named owner | Confirmation requested | Current status |
| --- | --- | --- | --- |
| Action API provider: `app/api/action/route.ts`, `lib/operations.ts`, action modules | Implementation paths verified; human provider/module owners `UNVERIFIED` because tracker/maintainer mapping is absent | Confirm 42 action names, payload validation, permissions/role checks, results, errors, and side effects against current source | `PENDING PROVIDER OWNER IDENTIFICATION + CONFIRMATION` |
| Main UI consumer: `components/bidaflow-app.tsx` | Generic caller, direct UI handlers, and connector operation adapters observed; human owner `UNVERIFIED` | Confirm the consumer payloads/results/error behavior remain compatible with the proposed source inventory | `PENDING CONSUMER OWNER IDENTIFICATION + CONFIRMATION` |
| Persistence/permission boundary: `db/schema.ts`, `lib/server.ts`, `/api/app` | Enum/schema/auth/read behavior observed in source; human owners `UNVERIFIED` | Confirm enum, permission, response-shape, and persistence assumptions relevant to action contracts | `PENDING OWNER IDENTIFICATION + CONFIRMATION` |
| Independent BF-PLAT-01 reviewer: Bùi Vạn Khải | Reviewer assignment supplied by task authorization; no GitHub review submitted yet | Check every action row, source pointer, error/result claim, and open mismatch | `REVIEW-PENDING` |
| PM / SRS and task-tracker custodian | PM owns task per authorization; authoritative SRS/tracker not available | Map actions to approved Use Cases, acceptance, provider/consumer task owners, and task status | `PENDING SOURCE DELIVERY + PM MAPPING` |

The contract remains `CODE-OBSERVED DRAFT`; it must not be called frozen until relevant provider and consumer owners are identified and their confirmations are recorded. A reviewer assignment, PM authorization, PR merge, or code observation does not substitute for those confirmations.

- Bùi Vạn Khải should review every action name, payload/default, response, permission, and source pointer against the current code; re-check after dispatcher/schema edits.
- PM should provide the task tracker and official SRS to map human module owner/provider, consumer task, and UC/acceptance requirement without inference.
- `invoice.pay.method` is required by the handler and CASH has a special rule. The route itself does not validate that method against the enum declared in `db/schema.ts`; decide whether to add explicit validation in a future implementation task.
- The dispatcher validates basic top-level shape; there is no single declarative schema covering every action. Delegated operations use typed field helpers, while remaining switch cases retain per-case validation. Decide whether a shared schema/validation convention belongs in a later implementation task.
- Proposed error code/envelope needs consumer review and a compatibility/version decision. No code change is included here.
- Shared responsibility for `app/api/action/route.ts`, `lib/operations.ts`, action modules, `lib/server.ts`, `db/schema.ts`, and migrations is pending the tracker/owner map.
