# BidaFlow API / Action Contract — Source Inventory Draft

> **DRAFT — VERIFIED AGAINST SOURCE SNAPSHOT `b9ae689` (`main`), PENDING VẠN KHẢI REVIEW.** This records handler behavior found in the repository at preparation time. It is not a promise that behavior is approved as a product contract. Human module/file owners and SRS requirement mappings are `UNVERIFIED` because the tracker and SRS were unavailable. No handler was changed.

## 1. Scope and source map

| Route | Method | Purpose / consumer | Server authorization | Source |
| --- | --- | --- | --- | --- |
| `/api/auth/status` | GET | Initialization state and current user; UI calls on load | No login required | [status route](../app/api/auth/status/route.ts) |
| `/api/auth/login` | POST | Create authenticated session | Same-origin check; validates credentials and active status | [login route](../app/api/auth/login/route.ts) |
| `/api/auth/register` | POST | First admin registration or invite-based registration | Same-origin check; setup code or valid invitation | [register route](../app/api/auth/register/route.ts) |
| `/api/auth/logout` | POST | Delete current session and clear cookie | Same-origin check; can clear cookie without a current user | [logout route](../app/api/auth/logout/route.ts) |
| `/api/app` | GET | Permission-filtered app snapshot and optional reports | `requireUser`; each dataset is filtered by permission | [app route](../app/api/app/route.ts) |
| `/api/action` | POST | Dispatcher for 41 action names listed below | Same-origin check, `requireUser`, then per-action `requireAny` where present | [action route](../app/api/action/route.ts) |

The only API route files found under `app/api/` are the six above. The generic UI caller is `components/bidaflow-app.tsx`: it sends `{ action, payload }` to `/api/action`, reads `response.data`, refreshes `/api/app` by default, and displays `json.error` on failure. Human module owners and code-area owners are not identifiable from source; see the separate shared-file ownership draft.

## 2. Shared request, response, and authorization behavior

### `/api/action`

Request: `POST` JSON `{ "action": "<action-name>", "payload": { ... } }`. `payload` defaults to `{}`. The TypeScript `Body` annotation is a compile-time cast; the route does not apply a runtime schema validator to the full request. Common helpers convert missing number values to `0`, trim string values, and convert empty optional strings to `null`. Individual handler checks are listed below.

Successful response: `200 { "ok": true, "data": <result> }`. For actions without an explicit `result`, `data` is `null`. Exceptions are the action-specific result objects in the table.

### Authorization / origin

- All `/api/action` requests call `assertSameOrigin` and `requireUser` before dispatch. If an `Origin` header is present and differs from the request URL origin, the handler returns an `AppError` with status `403`; an absent Origin header is accepted by this helper.
- `requireAny` checks the listed permission and allows `ADMIN` as a bypass. `requireUser` returns `401` when unauthenticated and `403` when a requested permission is missing.
- `profile.update` and `password.change` have no action-specific permission check in the dispatcher; they still require an authenticated user. Their server code binds the update to that current user's ID.
- Role permission definitions and default role assignments are in [server authorization](../lib/server.ts). They are implementation data, not a tracker-based ownership map.

### Current error behavior

| Case | Current HTTP status | Current body / evidence |
| --- | --- | --- |
| `AppError` with default status | 400 | `{ "error": "<message>" }` |
| Unauthenticated | 401 | Error envelope from `requireUser` / `responseError` |
| Permission or origin rejected | 403 | Error envelope from `requireUser` / `assertSameOrigin` |
| Unsupported action string | 404 | `{ "error": "Thao tác không được hỗ trợ." }` |
| Unique constraint exception in `/api/action` | 400 | Generic duplicate/state-changed Vietnamese message |
| Foreign-key exception in `/api/action` | 400 | Generic related-data message |
| Other unhandled exception | 500 | `{ "error": "Hệ thống đang bận. Vui lòng thử lại." }`; server logs the exception |
| `/api/auth/register` missing setup configuration | 503 | `AppError` message |
| `/api/auth/register` duplicate email | 409 | `AppError` message |

No stable `error.code`, field-error collection, or request/correlation ID is emitted by these handlers. Some resource/state validation failures use the default 400 even when they could be distinguished as not-found or conflict. A malformed JSON body is not explicitly handled as a client error and can fall through to the generic 500 path. These are observations from the shared server helper and route catches, not a proposal to change runtime behavior.

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

Provider for all rows: `POST /api/action` in `app/api/action/route.ts`. Consumer: `components/bidaflow-app.tsx` generic `run(action, payload)`; task-specific module owner and SRS/UC mapping are `UNVERIFIED`. Required fields below are those read through the route's `required()` helper; fields listed as optional/default reflect current fallback behavior, not a formal runtime schema. The handler has 41 action names, with `session.start` and `reservation.seat` sharing an implementation block.

### Account, areas, tables, and pricing

| Action | Required payload | Optional / defaults | Server permission | Success `data` / key current checks |
| --- | --- | --- | --- | --- |
| `profile.update` | `fullName` | `phone` | Authenticated | `null`; updates only current user's profile. |
| `password.change` | `currentPassword`, `newPassword` | — | Authenticated | `null`; new password must meet 10-character complexity rule and current password must verify. |
| `user.invite` | `roleId` | `email` | `USERS_MANAGE` | `{ invitationCode, expiresAt }`; role must exist; invitation expiry is 72 hours. Code is returned once; only its hash is stored. |
| `user.update` | `id`, `roleId`, `fullName` | `phone`; `status` defaults to `ACTIVE` unless exactly `LOCKED` | `USERS_MANAGE` | `null`; prevents current user locking self; locking target deletes their sessions. |
| `role.permissions` | `roleId` | `permissionCodes` defaults to `[]` | `ROLES_MANAGE` | `null`; `role_admin` cannot be reduced by this action. The handler replaces role links using codes found in the permission table; unknown codes are not inserted. |
| `area.save` | `code`, `name` | `id`, `description`, `sortOrder` default `0` | `TABLES_MANAGE` | `null`; code is uppercased; insert or update. |
| `area.delete` | `id` | — | `TABLES_MANAGE` | `null`; soft-deactivates; rejects while an active table uses the area. |
| `tableType.save` | `code`, `name` | `id`, `description`, `baseHourlyRate` default `0`, `color` default `#16a085` | `PRICES_MANAGE` | `null`; rate cannot be negative; code uppercased. |
| `tableType.delete` | `id` | — | `PRICES_MANAGE` | `null`; soft-deactivates; rejects while an active table uses the type. |
| `table.save` | `code`, `name`, `areaId`, `tableTypeId` | `id`, `notes`, `sortOrder` default `0` | `TABLES_MANAGE` | `null`; insert or update. |
| `table.delete` | `id` | — | `TABLES_MANAGE` | `null`; soft-deactivates; rejects an active session or DRAFT/ISSUED invoice for that table. |
| `table.status` | `id`, `status` | — | `TABLE_STATUS` | `null`; status limited to `AVAILABLE`, `RESERVED`, `MAINTENANCE`; rejects a table with active/paused session. |
| `price.save` | `tableTypeId`, `name` | `id`, `daysMask` default `127`, `startMinute` default `0`, `endMinute` default `1440`, `hourlyRate` default `0`, `priority` default `0`, `effectiveFrom`, `effectiveTo` | `PRICES_MANAGE` | `null`; rate >= 0, minutes within 0–1440 and start < end; checks overlap at same priority. |
| `price.delete` | `id` | — | `PRICES_MANAGE` | `null`; soft-deactivates rule. |

### Reservations, sessions, products, and orders

| Action | Required payload | Optional / defaults | Server permission | Success `data` / key current checks |
| --- | --- | --- | --- | --- |
| `reservation.save` | `tableId`, `startsAt`, `endsAt`, `customerName`, `customerPhone` | `id`, `customerId`, `guestCount` default/minimum `1`, `status` default `PENDING`, `notes` | `RESERVATIONS_MANAGE` | `null`; end must follow start; active PENDING/CONFIRMED reservation overlap is rejected. |
| `reservation.status` | `id`, `status` | — | `RESERVATIONS_MANAGE` | `null`; accepted values `PENDING`, `CONFIRMED`, `CANCELLED`, `NO_SHOW`; update excludes `SEATED` rows. |
| `session.start` | `tableId` | `customerId`, `notes` | `SESSIONS_MANAGE` | `{ sessionId }`; active table must be AVAILABLE or RESERVED; snapshots active rate. |
| `reservation.seat` | `reservationId` | — | `SESSIONS_MANAGE` | `{ sessionId }`; reservation must be PENDING/CONFIRMED; its table must be AVAILABLE or RESERVED; reservation becomes SEATED. |
| `session.pause` | `sessionId` | `reason` | `SESSIONS_MANAGE` | `null`; only ACTIVE session with an open segment can pause. |
| `session.resume` | `sessionId` | — | `SESSIONS_MANAGE` | `null`; only PAUSED session can resume; closes open pause. |
| `session.transfer` | `sessionId`, `toTableId` | `reason` | `SESSIONS_MANAGE` | `null`; session must be ACTIVE/PAUSED; target must be AVAILABLE; closes old segment and creates a new rate segment; handler sets session status to ACTIVE after transfer, including when it was PAUSED. |
| `session.end` | `sessionId` | — | `SESSIONS_MANAGE` | `{ tableAmount }`; closes open segment and order; session must be ACTIVE/PAUSED. |
| `category.save` | `code`, `name` | `id`, `sortOrder` default `0` | `PRODUCTS_MANAGE` | `null`; code uppercased. |
| `product.save` | `code`, `name` | `id`, `categoryId`, `kind` (`SERVICE` only when exact, otherwise `PRODUCT`), `unit` default `phần`, `salePrice`/`costPrice`/`minStock` default `0`, `trackStock` default true | `PRODUCTS_MANAGE` | `null`; prices and minimum stock cannot be negative. |
| `product.delete` | `id` | — | `PRODUCTS_MANAGE` | `null`; soft-deactivates. |
| `order.add` | `sessionId`, `productId`, `quantity` | `notes` | `ORDERS_MANAGE` | `null`; quantity > 0; session active/paused; product active; checks available stock when tracked. |
| `order.item.update` | `itemId`, `quantity` | `notes` | `ORDERS_MANAGE` | `null`; quantity > 0; served/cancelled item cannot be edited. |
| `order.item.status` | `itemId`, `status` | — | `ORDERS_MANAGE` | `null`; status `PENDING`, `PREPARING`, `SERVED`, or `CANCELLED`; served item cannot roll back; serving a tracked product deducts stock. |

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

These are illustrative payloads made from fields the current handlers read. Placeholder strings are not real identifiers or credentials. Unless the action table lists a result object, the current success response is `{ "ok": true, "data": null }`.

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
{"action":"price.save","payload":{"tableTypeId":"<type-id>","name":"<name>"}}
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
{"action":"product.save","payload":{"code":"PRD1","name":"<name>"}}
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

- Bùi Vạn Khải should review every action name, payload/default, response, permission, and source pointer against the current code; re-check after dispatcher/schema edits.
- PM should provide the task tracker and official SRS to map human module owner/provider, consumer task, and UC/acceptance requirement without inference.
- `invoice.pay.method` is required by the handler and CASH has a special rule. The route itself does not validate that method against the enum declared in `db/schema.ts`; decide whether to add explicit validation in a future implementation task.
- The dispatcher casts incoming JSON instead of applying a whole-request runtime schema. Decide whether type-specific validation belongs in a later implementation task.
- Proposed error code/envelope needs consumer review and a compatibility/version decision. No code change is included here.
- Shared responsibility for `app/api/action/route.ts`, `lib/server.ts`, `db/schema.ts`, and migrations is pending the tracker/owner map.
