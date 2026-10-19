import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnvironment, createJsonRequest } from "./helpers/test-fixture.mjs";

let fixture;

beforeEach(async () => {
  fixture = await setupTestEnvironment();
});

describe("BF-A12-01: Customer Profile and Lookup", () => {
  test("Customer creation requires fullName and records audit log", async () => {
    const { actionRoute, cashierCookie, serviceCookie, server } = fixture;

    // 1. Permission check: SERVICE role lacks CUSTOMERS_MANAGE -> 403
    const forbiddenRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "customer.save",
      payload: { fullName: "Nguyễn Văn A" },
    }, serviceCookie));
    assert.equal(forbiddenRes.status, 403);

    // 2. Validation check: Missing fullName -> 400
    const invalidRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "customer.save",
      payload: { phone: "0901234567" },
    }, cashierCookie));
    assert.equal(invalidRes.status, 400);
    const invalidJson = await invalidRes.json();
    assert.match(invalidJson.error, /Tên khách hàng là bắt buộc/);

    // 3. Successful creation with email normalization and optional fields
    const createRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "customer.save",
      payload: {
        fullName: "Nguyễn Văn A",
        phone: "0901234567",
        email: "  NguyenVanA@BidaFlow.VN  ",
        dateOfBirth: "1995-05-15",
        notes: "Khách quen khu VIP",
      },
    }, cashierCookie));
    assert.equal(createRes.status, 200);

    // Verify persisted customer
    const customer = await server.queryOne("SELECT * FROM customers WHERE phone = ?", "0901234567");
    assert.ok(customer);
    assert.equal(customer.full_name, "Nguyễn Văn A");
    assert.equal(customer.email, "nguyenvana@bidaflow.vn"); // Normalized lowercase
    assert.equal(customer.date_of_birth, "1995-05-15");
    assert.equal(customer.notes, "Khách quen khu VIP");
    assert.equal(customer.active, 1);
    assert.match(customer.code, /^KH-/);

    // Verify audit log
    const audit = await server.queryOne("SELECT * FROM audit_logs WHERE action = 'CUSTOMER_SAVED' AND entity_id = ?", customer.id);
    assert.ok(audit);
    assert.match(audit.summary, /Lưu khách hàng Nguyễn Văn A/);
  });

  test("Customer update modifies fields and updates audit log", async () => {
    const { actionRoute, cashierCookie, server } = fixture;

    // Create initial customer
    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "customer.save",
      payload: { fullName: "Trần Thị B", phone: "0987654321" },
    }, cashierCookie));

    const initial = await server.queryOne("SELECT * FROM customers WHERE phone = ?", "0987654321");
    assert.ok(initial);

    // Update customer
    const updateRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "customer.save",
      payload: {
        id: initial.id,
        fullName: "Trần Thị Bích",
        phone: "0987654322",
        email: "bich.tran@example.com",
        notes: "Đổi số điện thoại",
      },
    }, cashierCookie));
    assert.equal(updateRes.status, 200);

    const updated = await server.queryOne("SELECT * FROM customers WHERE id = ?", initial.id);
    assert.equal(updated.full_name, "Trần Thị Bích");
    assert.equal(updated.phone, "0987654322");
    assert.equal(updated.email, "bich.tran@example.com");
    assert.equal(updated.notes, "Đổi số điện thoại");
    assert.equal(updated.code, initial.code); // Code remains unchanged
  });

  test("Customer lookup via /api/app returns active customers and joined membership details", async () => {
    const { actionRoute, appRoute, cashierCookie, managerCookie, serviceCookie, server } = fixture;

    // Create customer and membership tier
    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "customer.save",
      payload: { fullName: "Lê Hoàng Nam", phone: "0911223344" },
    }, cashierCookie));
    const customer = await server.queryOne("SELECT * FROM customers WHERE phone = ?", "0911223344");

    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "tier.save",
      payload: { code: "GOLD", name: "Hội viên Vàng", minPoints: 500, discountPercent: 10 },
    }, managerCookie));
    const tier = await server.queryOne("SELECT * FROM membership_tiers WHERE code = 'GOLD'");

    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "membership.save",
      payload: { customerId: customer.id, tierId: tier.id },
    }, managerCookie));

    // Cashier can see customers
    const cashierAppRes = await appRoute.GET(createJsonRequest("http://localhost:3000/api/app", "GET", null, cashierCookie));
    assert.equal(cashierAppRes.status, 200);
    const cashierData = await cashierAppRes.json();
    assert.ok(Array.isArray(cashierData.customers));
    const found = cashierData.customers.find((c) => c.id === customer.id);
    assert.ok(found);
    assert.equal(found.full_name, "Lê Hoàng Nam");
    assert.equal(found.tier_name, "Hội viên Vàng");
    assert.equal(found.discount_percent, 10);
    assert.equal(found.points, 0);

    // Service role cannot see customers
    const serviceAppRes = await appRoute.GET(createJsonRequest("http://localhost:3000/api/app", "GET", null, serviceCookie));
    assert.equal(serviceAppRes.status, 200);
    const serviceData = await serviceAppRes.json();
    assert.deepEqual(serviceData.customers, []);
  });
});

describe("BF-A12-02: Membership and Loyalty Rules", () => {
  test("Tier creation validates discount range and enforces MEMBERSHIPS_MANAGE permission", async () => {
    const { actionRoute, cashierCookie, managerCookie, server } = fixture;

    // Cashier cannot manage tiers -> 403
    const forbiddenRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "tier.save",
      payload: { code: "SILVER", name: "Bạc", minPoints: 100, discountPercent: 5 },
    }, cashierCookie));
    assert.equal(forbiddenRes.status, 403);

    // Discount percent > 100 -> 400
    const invalidHigh = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "tier.save",
      payload: { code: "OVER", name: "Over Discount", minPoints: 100, discountPercent: 120 },
    }, managerCookie));
    assert.equal(invalidHigh.status, 400);
    assert.match((await invalidHigh.json()).error, /Mức giảm giá phải từ 0 đến 100%/);

    // Discount percent < 0 -> 400
    const invalidLow = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "tier.save",
      payload: { code: "NEG", name: "Negative Discount", minPoints: 100, discountPercent: -5 },
    }, managerCookie));
    assert.equal(invalidLow.status, 400);

    // Valid tier creation
    const validRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "tier.save",
      payload: { code: "vip", name: "Hội viên VIP", minPoints: 1000, discountPercent: 15 },
    }, managerCookie));
    assert.equal(validRes.status, 200);

    const savedTier = await server.queryOne("SELECT * FROM membership_tiers WHERE code = 'VIP'");
    assert.ok(savedTier);
    assert.equal(savedTier.name, "Hội viên VIP");
    assert.equal(savedTier.min_points, 1000);
    assert.equal(savedTier.discount_percent, 15);
  });

  test("Membership assignment and update updates customer tier correctly", async () => {
    const { actionRoute, cashierCookie, managerCookie, server } = fixture;

    // Create customer and tiers
    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "customer.save",
      payload: { fullName: "Phạm Minh C" },
    }, cashierCookie));
    const customer = await server.queryOne("SELECT * FROM customers WHERE full_name = 'Phạm Minh C'");

    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "tier.save",
      payload: { code: "SILVER", name: "Hạng Bạc", minPoints: 100, discountPercent: 5 },
    }, managerCookie));
    const silverTier = await server.queryOne("SELECT * FROM membership_tiers WHERE code = 'SILVER'");

    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "tier.save",
      payload: { code: "DIAMOND", name: "Hạng Kim Cương", minPoints: 2000, discountPercent: 20 },
    }, managerCookie));
    const diamondTier = await server.queryOne("SELECT * FROM membership_tiers WHERE code = 'DIAMOND'");

    // Assign silver tier
    const assignRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "membership.save",
      payload: { customerId: customer.id, tierId: silverTier.id },
    }, managerCookie));
    assert.equal(assignRes.status, 200);

    let member = await server.queryOne("SELECT * FROM memberships WHERE customer_id = ?", customer.id);
    assert.ok(member);
    assert.equal(member.tier_id, silverTier.id);
    assert.equal(member.points, 0);

    // Upgrade to diamond tier (upsert check)
    const upgradeRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "membership.save",
      payload: { customerId: customer.id, tierId: diamondTier.id },
    }, managerCookie));
    assert.equal(upgradeRes.status, 200);

    member = await server.queryOne("SELECT * FROM memberships WHERE customer_id = ?", customer.id);
    assert.equal(member.tier_id, diamondTier.id);
  });

  test("Loyalty points accumulate on invoice payment: 1 point per 10,000 VND", async () => {
    const { actionRoute, cashierCookie, managerCookie, server } = fixture;

    // 1. Setup customer with membership
    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "customer.save",
      payload: { fullName: "Đặng Thuỳ D" },
    }, cashierCookie));
    const customer = await server.queryOne("SELECT * FROM customers WHERE full_name = 'Đặng Thuỳ D'");

    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "tier.save",
      payload: { code: "MEMBER", name: "Thành viên", minPoints: 0, discountPercent: 0 },
    }, managerCookie));
    const tier = await server.queryOne("SELECT * FROM membership_tiers WHERE code = 'MEMBER'");

    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "membership.save",
      payload: { customerId: customer.id, tierId: tier.id },
    }, managerCookie));

    // 2. Setup closed session with customer
    const now = new Date().toISOString();
    await server.getRawDb().prepare(
      "INSERT INTO areas (id, code, name) VALUES ('area_1', 'KV1', 'Khu A')"
    ).run();
    await server.getRawDb().prepare(
      "INSERT INTO table_types (id, code, name, base_hourly_rate) VALUES ('type_1', 'POOL', 'Bàn Lỗ', 60000)"
    ).run();
    await server.getRawDb().prepare(
      "INSERT INTO billiard_tables (id, code, name, area_id, table_type_id, status) VALUES ('tbl_1', 'B1', 'Bàn 01', 'area_1', 'type_1', 'AVAILABLE')"
    ).run();
    await server.getRawDb().prepare(
      "INSERT INTO play_sessions (id, code, table_id, customer_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_1', 'PS-01', 'tbl_1', ?, 'usr_cashier', 'CLOSED', ?, ?, 150000)"
    ).bind(customer.id, now, now).run();

    // 3. Create invoice: total = 150,000 VND
    const invoiceRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_1" },
    }, cashierCookie));
    const { data: { invoiceId, total } } = await invoiceRes.json();
    assert.equal(total, 150000);

    // 4. Open cashier shift
    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "shift.open",
      payload: { openingCash: 1000000 },
    }, cashierCookie));

    // 5. Pay invoice in full: 150,000 VND -> should award 15 points
    const payRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "CASH", amount: 150000 },
    }, cashierCookie));
    assert.equal(payRes.status, 200);

    // Verify membership points updated
    const membership = await server.queryOne("SELECT * FROM memberships WHERE customer_id = ?", customer.id);
    assert.equal(membership.points, 15); // 150,000 / 10,000 = 15

    // Verify loyalty transaction logged
    const loyaltyTx = await server.queryOne("SELECT * FROM loyalty_transactions WHERE membership_id = ?", membership.id);
    assert.ok(loyaltyTx);
    assert.equal(loyaltyTx.points, 15);
    assert.equal(loyaltyTx.reason, "Tích điểm thanh toán");
    assert.equal(loyaltyTx.reference_id, invoiceId);
  });
});

describe("BF-A12-03: Discount Eligibility Testing", () => {
  test("Automatic member discount applied to invoice when member tier has discount_percent > 0", async () => {
    const { actionRoute, cashierCookie, managerCookie, server } = fixture;

    // 1. Create VIP customer (10% discount)
    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "customer.save",
      payload: { fullName: "Võ Thị VIP" },
    }, cashierCookie));
    const vipCustomer = await server.queryOne("SELECT * FROM customers WHERE full_name = 'Võ Thị VIP'");

    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "tier.save",
      payload: { code: "VIP10", name: "VIP Vàng", minPoints: 500, discountPercent: 10 },
    }, managerCookie));
    const vipTier = await server.queryOne("SELECT * FROM membership_tiers WHERE code = 'VIP10'");

    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "membership.save",
      payload: { customerId: vipCustomer.id, tierId: vipTier.id },
    }, managerCookie));

    // 2. Setup product and order
    const db = server.getRawDb();
    await db.prepare("INSERT INTO areas (id, code, name) VALUES ('a_vip', 'KV_VIP', 'Khu VIP')").run();
    await db.prepare("INSERT INTO table_types (id, code, name, base_hourly_rate) VALUES ('tt_vip', 'CAROM', 'Bàn Carom', 80000)").run();
    await db.prepare("INSERT INTO billiard_tables (id, code, name, area_id, table_type_id, status) VALUES ('tbl_vip', 'VIP1', 'Bàn VIP 1', 'a_vip', 'tt_vip', 'AVAILABLE')").run();
    await db.prepare("INSERT INTO product_categories (id, code, name) VALUES ('cat_drink', 'NUOC', 'Đồ uống')").run();
    await db.prepare("INSERT INTO products (id, code, name, category_id, kind, unit, sale_price, stock_quantity, track_stock) VALUES ('p_sting', 'STING', 'Sting dâu', 'cat_drink', 'PRODUCT', 'Lon', 20000, 50, 1)").run();

    const now = new Date().toISOString();
    // Closed session with table_amount = 100,000 VND
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, customer_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_vip', 'PS-VIP', 'tbl_vip', ?, 'usr_cashier', 'CLOSED', ?, ?, 100000)"
    ).bind(vipCustomer.id, now, now).run();

    // Order with 2 Stings = 40,000 VND
    await db.prepare("INSERT INTO orders (id, code, session_id, created_by, status) VALUES ('ord_1', 'ORD-1', 'ses_vip', 'usr_cashier', 'COMPLETED')").run();
    await db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status) VALUES ('oi_1', 'ord_1', 'p_sting', 'Sting dâu', 2, 20000, 'SERVED')").run();

    // Subtotal = 100,000 (table) + 40,000 (order) = 140,000 VND
    // Expected discount = 10% of 140,000 = 14,000 VND
    // Expected total = 140,000 - 14,000 = 126,000 VND
    const invoiceRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_vip" },
    }, cashierCookie));
    assert.equal(invoiceRes.status, 200);
    const { data: { invoiceId, total } } = await invoiceRes.json();
    assert.equal(total, 126000);

    // Verify invoice fields
    const invoice = await server.queryOne("SELECT * FROM invoices WHERE id = ?", invoiceId);
    assert.equal(invoice.table_amount, 100000);
    assert.equal(invoice.service_amount, 40000);
    assert.equal(invoice.discount_amount, 14000);
    assert.equal(invoice.total_amount, 126000);

    // Verify adjustment entry
    const adjustment = await server.queryOne("SELECT * FROM invoice_adjustments WHERE invoice_id = ?", invoiceId);
    assert.ok(adjustment);
    assert.equal(adjustment.type, "MEMBER_BENEFIT");
    assert.equal(adjustment.amount, 14000);
    assert.match(adjustment.description, /Ưu đãi hội viên VIP Vàng \(10%\)/);
  });

  test("No discount applied when customer has 0% discount tier or session has no customer", async () => {
    const { actionRoute, cashierCookie, server } = fixture;

    const db = server.getRawDb();
    await db.prepare("INSERT INTO areas (id, code, name) VALUES ('a_norm', 'KV_NORM', 'Khu Thường')").run();
    await db.prepare("INSERT INTO table_types (id, code, name, base_hourly_rate) VALUES ('tt_norm', 'POOL', 'Bàn Lỗ', 50000)").run();
    await db.prepare("INSERT INTO billiard_tables (id, code, name, area_id, table_type_id, status) VALUES ('tbl_norm', 'NORM1', 'Bàn Thường 1', 'a_norm', 'tt_norm', 'AVAILABLE')").run();

    const now = new Date().toISOString();
    // Session without customer
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, customer_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_anon', 'PS-ANON', 'tbl_norm', NULL, 'usr_cashier', 'CLOSED', ?, ?, 80000)"
    ).bind(now, now).run();

    const invoiceRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_anon" },
    }, cashierCookie));
    assert.equal(invoiceRes.status, 200);
    const { data: { invoiceId, total } } = await invoiceRes.json();
    assert.equal(total, 80000);

    const invoice = await server.queryOne("SELECT * FROM invoices WHERE id = ?", invoiceId);
    assert.equal(invoice.discount_amount, 0);
    assert.equal(invoice.total_amount, 80000);

    const adjustments = await server.queryAll("SELECT * FROM invoice_adjustments WHERE invoice_id = ?", invoiceId);
    assert.equal(adjustments.length, 0);
  });
});
