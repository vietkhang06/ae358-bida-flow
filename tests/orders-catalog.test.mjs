import { test, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { operationsFixture } from "./helpers/operations-fixture.mjs";
let f;
beforeEach(async () => { f = await operationsFixture(); });
afterEach(() => f.db._raw.close());
const product = (extra = {}) => ({ code: "NEW", name: "Sản phẩm mới", categoryId: "cat", salePrice: 12000, ...extra });
async function item(quantity = 2, productId = "p") {
  const sessionId = await f.start();
  const { itemId, orderId } = (await f.call("order.add", { sessionId, productId, quantity }, "service")).data;
  return { sessionId, itemId, orderId };
}

describe("BF-A11-01 #17: catalog", () => {
  test("create/update/deactivate category and product, service does not track stock", async () => {
    const { id: categoryId } = (await f.call("category.save", { code: "NEW", name: "Nhóm mới" }, "manager")).data;
    const { id } = (await f.call("product.save", product({ categoryId }), "manager")).data;
    await f.call("product.save", product({ id, categoryId, name: "Tên mới", salePrice: 14000, stockQuantity: 9999 }), "manager");
    const row = await f.one("SELECT * FROM products WHERE id=?", id);
    assert.equal(row.stock_quantity, 0); assert.equal(row.sale_price, 14000);
    await f.reject("category.delete", { id: categoryId }, "manager");
    await f.call("product.delete", { id }, "manager");
    await f.call("category.delete", { id: categoryId }, "manager");
    assert.equal((await f.one("SELECT active FROM products WHERE id=?", id)).active, 0);
    const service = (await f.call("product.save", product({ code: "S2", name: "Dịch vụ", kind: "SERVICE" }), "manager")).data;
    assert.equal((await f.one("SELECT track_stock FROM products WHERE id=?", service.id)).track_stock, 0);
  });
  for (const patch of [{ salePrice: -1 }, { salePrice: "NaN" }, { costPrice: "Infinity" }, { minStock: -1 }, { salePrice: 1.5 }, { categoryId: "missing" }, { kind: "UNKNOWN" }, { trackStock: "false" }, { name: "nước suối" }, { code: "P" }]) {
    test(`invalid product ${JSON.stringify(patch)}`, async () => { await f.reject("product.save", product(patch), "manager"); });
  }
  test("history and order snapshot survive catalog update and deactivation", async () => {
    const { itemId, sessionId } = await item();
    await f.call("product.save", product({ id: "p", code: "P", name: "Nước mới", salePrice: 30000 }), "manager");
    await f.call("product.delete", { id: "p" }, "manager");
    const line = await f.one("SELECT * FROM order_items WHERE id=?", itemId);
    assert.equal(line.product_name, "Nước suối"); assert.equal(line.unit_price, 15000);
    await f.reject("order.add", { sessionId, productId: "p", quantity: 1 });
    await f.call("order.item.status", { itemId, status: "SERVED" });
    assert.equal((await f.one("SELECT stock_quantity FROM products WHERE id='p'")).stock_quantity, 8);
  });
  test("cashier/service cannot modify catalog", async () => {
    for (const role of ["cashier", "service"]) for (const action of ["category.save", "category.delete", "product.save", "product.delete"]) await f.call(action, {}, role, 403);
  });
});

describe("BF-A11-02 #18: order lifecycle", () => {
  test("edit quantity and notes, use snapshotted price and cancel without deleting history", async () => {
    const { itemId } = await item();
    await f.call("order.item.update", { itemId, quantity: 3, notes: "Không đá" }, "service");
    const visible = (await f.read("service")).orderItems.find((i) => i.id === itemId);
    assert.equal(visible.quantity * visible.unit_price, 45000); assert.equal(visible.notes, "Không đá");
    await f.call("order.item.status", { itemId, status: "CANCELLED" });
    await f.reject("order.item.update", { itemId, quantity: 1 });
    assert.equal((await f.one("SELECT status FROM order_items WHERE id=?", itemId)).status, "CANCELLED");
  });
  for (const [from, to, allowed] of [
    ["PENDING", "PREPARING", true], ["PENDING", "SERVED", true], ["PENDING", "CANCELLED", true],
    ["PREPARING", "PENDING", false], ["PREPARING", "SERVED", true], ["PREPARING", "CANCELLED", true],
    ["SERVED", "PENDING", false], ["SERVED", "PREPARING", false], ["SERVED", "CANCELLED", false],
    ["CANCELLED", "PENDING", false], ["CANCELLED", "PREPARING", false], ["CANCELLED", "SERVED", false],
  ]) test(`${from} -> ${to}: ${allowed ? "allowed" : "rejected"}`, async () => {
    const { itemId } = await item();
    if (from !== "PENDING") await f.call("order.item.status", { itemId, status: from });
    if (allowed) await f.call("order.item.status", { itemId, status: to });
    else await f.reject("order.item.status", { itemId, status: to });
    assert.equal((await f.one("SELECT status FROM order_items WHERE id=?", itemId)).status, allowed ? to : from);
  });
  test("pending dishes require explicit end acknowledgement and remain visible until settled", async () => {
    const { sessionId, itemId, orderId } = await item();
    await f.call("session.end", { sessionId }, "cashier", 409);
    await f.call("session.end", { sessionId, confirmPendingOrders: true });
    assert.equal((await f.one("SELECT status FROM orders WHERE id=?", orderId)).status, "OPEN");
    assert.ok((await f.read("service")).orderItems.some((i) => i.id === itemId));
    await f.reject("invoice.create", { sessionId });
    await f.call("order.item.status", { itemId, status: "SERVED" }, "service");
    assert.equal((await f.one("SELECT status FROM orders WHERE id=?", orderId)).status, "COMPLETED");
    await f.call("invoice.create", { sessionId });
    await f.reject("order.item.update", { itemId, quantity: 5 });
    await f.reject("order.add", { sessionId, productId: "p", quantity: 1 });
  });
  test("all cancelled dishes complete as CANCELLED when session closes", async () => {
    const { sessionId, itemId, orderId } = await item();
    await f.call("order.item.status", { itemId, status: "CANCELLED" });
    await f.call("session.end", { sessionId });
    assert.equal((await f.one("SELECT status FROM orders WHERE id=?", orderId)).status, "CANCELLED");
    const invoice = (await f.call("invoice.create", { sessionId })).data.invoiceId;
    assert.equal((await f.one("SELECT service_amount FROM invoices WHERE id=?", invoice)).service_amount, 0);
  });
  test("quantity, missing IDs and insufficient stock are rejected", async () => {
    const { sessionId, itemId } = await item();
    for (const quantity of [0, -1, "NaN", "Infinity", 11]) {
      await f.reject("order.add", { sessionId, productId: "p", quantity });
      await f.reject("order.item.update", { itemId, quantity });
    }
    await f.reject("order.item.status", { itemId: "missing", status: "SERVED" });
  });
});

describe("BF-A11-03 #19: order to inventory handoff", () => {
  test("serve exactly once records actor/reference/before/after and retries do not decrement", async () => {
    const { itemId } = await item(3);
    await f.call("order.item.status", { itemId, status: "PREPARING" }, "service");
    assert.equal((await f.one("SELECT stock_quantity FROM products WHERE id='p'")).stock_quantity, 10);
    await f.call("order.item.status", { itemId, status: "SERVED" }, "service");
    await f.call("order.item.status", { itemId, status: "SERVED" }, "service");
    const tx = await f.one("SELECT * FROM inventory_transactions WHERE reference_id=?", itemId);
    assert.equal(tx.before_quantity, 10); assert.equal(tx.after_quantity, 7); assert.equal(tx.quantity, 3);
    assert.equal(tx.created_by, "usr_service"); assert.equal(tx.reference_type, "ORDER_ITEM");
    assert.equal((await f.one("SELECT COUNT(*) n FROM inventory_transactions")).n, 1);
    assert.equal((await f.one("SELECT stock_quantity FROM products WHERE id='p'")).stock_quantity, 7);
  });
  test("concurrent serve same item decrements once", async () => {
    const { itemId } = await item(3);
    const results = await Promise.all([f.call("order.item.status", { itemId, status: "SERVED" }, "service", null), f.call("order.item.status", { itemId, status: "SERVED" }, "cashier", null)]);
    assert.ok(results.some((r) => r.status === 200));
    assert.ok(results.every((r) => [200, 409].includes(r.status)));
    assert.equal((await f.one("SELECT stock_quantity FROM products WHERE id='p'")).stock_quantity, 7);
    assert.equal((await f.one("SELECT COUNT(*) n FROM inventory_transactions")).n, 1);
  });
  test("different items competing for insufficient stock cannot oversell", async () => {
    const { sessionId, itemId } = await item(7);
    const second = (await f.call("order.add", { sessionId, productId: "p", quantity: 7 })).data.itemId;
    const results = await Promise.all([itemId, second].map((id) => f.call("order.item.status", { itemId: id, status: "SERVED" }, "service", null)));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal((await f.one("SELECT stock_quantity FROM products WHERE id='p'")).stock_quantity, 3);
    assert.equal((await f.one("SELECT COUNT(*) n FROM inventory_transactions")).n, 1);
  });
  test("service and cancelled product never create stock movement", async () => {
    const { sessionId, itemId } = await item(1, "svc");
    await f.call("order.item.status", { itemId, status: "SERVED" });
    const cancelled = (await f.call("order.add", { sessionId, productId: "p", quantity: 2 })).data.itemId;
    await f.call("order.item.status", { itemId: cancelled, status: "CANCELLED" });
    assert.equal((await f.one("SELECT COUNT(*) n FROM inventory_transactions")).n, 0);
    assert.equal((await f.one("SELECT stock_quantity FROM products WHERE id='p'")).stock_quantity, 10);
  });
  test("failure writing ledger rolls back item status and stock", async () => {
    const { itemId } = await item(3);
    f.db._raw.exec("CREATE TRIGGER fail_sale BEFORE INSERT ON inventory_transactions BEGIN SELECT RAISE(ABORT,'injected ledger error'); END");
    const old = console.error; console.error = () => {};
    try { await f.call("order.item.status", { itemId, status: "SERVED" }, "service", 500); } finally { console.error = old; }
    assert.equal((await f.one("SELECT status FROM order_items WHERE id=?", itemId)).status, "PENDING");
    assert.equal((await f.one("SELECT stock_quantity FROM products WHERE id='p'")).stock_quantity, 10);
    assert.equal((await f.one("SELECT COUNT(*) n FROM inventory_transactions")).n, 0);
  });
  test("invoice-locked pending item cannot be edited or served, even on a legacy OPEN order", async () => {
    const { sessionId, itemId } = await item();
    await f.db.prepare("INSERT INTO invoices(id,code,session_id,status,created_by) VALUES('invoice','INV',?,'ISSUED','usr_cashier')").bind(sessionId).run();
    await f.reject("order.item.update", { itemId, quantity: 4 });
    await f.reject("order.item.status", { itemId, status: "SERVED" });
    assert.equal((await f.one("SELECT stock_quantity FROM products WHERE id='p'")).stock_quantity, 10);
  });
});
