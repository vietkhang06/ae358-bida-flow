import { test, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { operationsFixture } from "./helpers/operations-fixture.mjs";
import { createJsonRequest } from "./helpers/test-fixture.mjs";
let f;
beforeEach(async () => { f = await operationsFixture(); });
afterEach(() => f.db._raw.close());

describe("BF-A08-03 #9: authentication and authorization edges", () => {
  for (const cookie of [null, "bidaflow_session=forged", "bidaflow_session=%E0%A4%A"]) test(`unauthenticated or malformed cookie: ${cookie}`, async () => {
    const response = await f.appRoute.GET(createJsonRequest("http://localhost/api/app", "GET", null, cookie));
    assert.equal(response.status, 401);
  });
  test("cross-origin mutation rejected before data changes", async () => {
    const req = createJsonRequest("http://localhost/api/action", "POST", { action: "area.save", payload: { code: "X", name: "X" } }, f.managerCookie);
    req.headers.set("origin", "https://untrusted.invalid");
    assert.equal((await f.actionRoute.POST(req)).status, 403);
    assert.equal((await f.one("SELECT COUNT(*) n FROM areas")).n, 1);
  });
  test("profile payload cannot modify another account or elevate own role", async () => {
    await f.call("profile.update", { id: "usr_admin", fullName: "Name", roleId: "role_admin", permissions: ["USERS_MANAGE"] }, "service");
    assert.equal((await f.one("SELECT role_id FROM users WHERE id='usr_service'")).role_id, "role_service");
    assert.equal((await f.one("SELECT full_name FROM users WHERE id='usr_admin'")).full_name, "Admin Test");
  });
  test("revocation persists through catalog initialization and invited registration", async () => {
    await f.call("role.permissions", { roleId: "role_service", permissionCodes: ["PROFILE_MANAGE"] }, "manager");
    await f.call("session.start", { tableId: "b1" }, "service", 403);
    const invite = (await f.call("user.invite", { roleId: "role_service" }, "manager")).data.invitationCode;
    const res = await f.registerRoute.POST(createJsonRequest("http://localhost/api/auth/register", "POST", { fullName: "New Staff", email: "new@example.test", password: "StrongPass123!", invitationCode: invite }));
    assert.equal(res.status, 201);
    await f.call("session.start", { tableId: "b1" }, "service", 403);
  });
  test("restricted views omit accounts, orders and revenue; role change immediately applies", async () => {
    await f.call("role.permissions", { roleId: "role_service", permissionCodes: ["TABLES_MANAGE", "PROFILE_MANAGE"] }, "manager");
    const service = await f.read("service");
    assert.deepEqual(service.users, []); assert.deepEqual(service.roles, []);
    assert.equal(service.summary.today_revenue, undefined);
    const warehouse = await f.read("warehouse");
    assert.deepEqual(warehouse.orders, []); assert.deepEqual(warehouse.orderItems, []);
  });
  test("username login, wrong credentials and locked account", async () => {
    f.db._raw.exec("UPDATE users SET username='Cashier.Test' WHERE id='usr_cashier'");
    const login = (identity, password) => f.loginRoute.POST(createJsonRequest("http://localhost/api/auth/login", "POST", { identity, password }));
    assert.equal((await login(" CASHIER.TEST ", "StrongPass123!")).status, 200);
    assert.equal((await login("Cashier.Test", "Wrong123!")).status, 401);
    f.db._raw.exec("UPDATE users SET status='LOCKED' WHERE id='usr_cashier'");
    assert.equal((await login("Cashier.Test", "StrongPass123!")).status, 403);
    const expired = await f.appRoute.GET(createJsonRequest("http://localhost/api/app", "GET", null, f.cashierCookie));
    assert.equal(expired.status, 401);
  });
  test("password confirmation mismatch and weak password leave hash unchanged", async () => {
    const before = (await f.one("SELECT password_hash FROM users WHERE id='usr_service'")).password_hash;
    await f.reject("password.change", { currentPassword: "StrongPass123!", newPassword: "NewStrongPass123!", confirmPassword: "different" }, "service");
    await f.reject("password.change", { currentPassword: "StrongPass123!", newPassword: "weak", confirmPassword: "weak" }, "service");
    assert.equal((await f.one("SELECT password_hash FROM users WHERE id='usr_service'")).password_hash, before);
    await f.call("password.change", { currentPassword: "StrongPass123!", newPassword: "NewStrongPass123!", confirmPassword: "NewStrongPass123!" }, "service");
    assert.notEqual((await f.one("SELECT password_hash FROM users WHERE id='usr_service'")).password_hash, before);
  });
  test("bad action JSON and non-object payload return client errors", async () => {
    for (const raw of ["{", "null", '{"action":"area.save","payload":[]}']) {
      const req = new Request("http://localhost/api/action", { method: "POST", headers: { cookie: f.managerCookie, origin: "http://localhost", "content-type": "application/json" }, body: raw });
      assert.equal((await f.actionRoute.POST(req)).status, 400);
    }
  });
});
