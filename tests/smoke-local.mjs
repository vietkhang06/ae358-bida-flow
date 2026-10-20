// Explicit, opt-in integration smoke against an isolated local Wrangler/D1 instance.
// Run: BIDAFLOW_TEST_SETUP_CODE=... node tests/smoke-local.mjs
import assert from "node:assert/strict";
const base = process.env.BIDAFLOW_TEST_URL ?? "http://127.0.0.1:5173";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname), "Local test servers only");
const email = "qa-ja@bidaflow.test", password = "BidaFlowLocal123!";
let cookie;
const steps = [];
async function request(path, body, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", origin: base, ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(json)}`);
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  return json;
}
const status = await request("/api/auth/status");
if (!status.initialized) await request("/api/auth/register", { fullName: "QA ja-gnahk", email, password, setupCode: process.env.BIDAFLOW_TEST_SETUP_CODE }, 201);
else await request("/api/auth/login", { identity: email, password });
steps.push("authentication via real Worker");
const call = async (action, payload, expected = 200) => (await request("/api/action", { action, payload }, expected)).data;
const stamp = Date.now().toString(36).toUpperCase();
const { id: areaId } = await call("area.save", { code: `QA-${stamp}`, name: `Khu kiểm thử ${stamp}` });
const { id: tableTypeId } = await call("tableType.save", { code: `QA-${stamp}`, name: `Pool QA ${stamp}`, baseHourlyRate: 60000 });
const { id: tableId } = await call("table.save", { code: `API-${stamp}`, name: "Bàn kiểm thử API", areaId, tableTypeId });
const { id: uiTableId } = await call("table.save", { code: `UI-${stamp}`, name: "Bàn kiểm thử giao diện", areaId, tableTypeId });
const { id: productId } = await call("product.save", { code: `QA-${stamp}`, name: `Nước suối QA ${stamp}`, salePrice: 15000 });
await call("inventory.move", { productId, type: "IN", quantity: 10, reason: "Tồn thử cục bộ" });
steps.push("catalog and stock fixtures");
const { reservationId } = await call("reservation.save", { tableId, customerName: "Khách QA", customerPhone: "0900000000", startsAt: new Date(Date.now() + 60000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString() });
await call("reservation.status", { id: reservationId, status: "CONFIRMED" });
const { sessionId } = await call("reservation.seat", { reservationId });
await call("session.pause", { sessionId });
const paused1 = (await request("/api/app")).sessions.find((s) => s.id === sessionId);
const paused2 = (await request("/api/app")).sessions.find((s) => s.id === sessionId);
assert.equal(paused1.billable_seconds, paused2.billable_seconds);
await call("session.resume", { sessionId });
steps.push("reservation and pause/resume on real D1");
const { itemId } = await call("order.add", { sessionId, productId, quantity: 2 });
await call("order.item.update", { itemId, quantity: 3, notes: "Test sửa món" });
await call("session.end", { sessionId }, 409);
await call("session.end", { sessionId, confirmPendingOrders: true });
await call("invoice.create", { sessionId }, 400);
await call("order.item.status", { itemId, status: "SERVED" });
await call("order.item.status", { itemId, status: "SERVED" });
const data = await request("/api/app");
assert.equal(data.products.find((p) => p.id === productId).stock_quantity, 7);
assert.equal(data.inventory.filter((tx) => tx.reference_id === itemId).length, 1);
steps.push("atomic stock handoff; serve retry deducted once");
await call("invoice.create", { sessionId });
steps.push("order completion unblocks invoice integration");
console.log(JSON.stringify({ passed: steps.length, steps, uiTableId, productId, email }, null, 2));
