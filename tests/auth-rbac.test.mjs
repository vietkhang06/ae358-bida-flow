import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createMockD1 } from "./helpers/d1-mock.mjs";
import { env, setTestDb } from "./helpers/cf-mock.mjs";

let mockDb;
let server;
let loginRoute;
let logoutRoute;
let registerRoute;
let statusRoute;
let actionRoute;
let appRoute;

beforeEach(async () => {
  mockDb = createMockD1();
  setTestDb(mockDb);

  server = await import("@/lib/server");
  loginRoute = await import("@/app/api/auth/login/route");
  logoutRoute = await import("@/app/api/auth/logout/route");
  registerRoute = await import("@/app/api/auth/register/route");
  statusRoute = await import("@/app/api/auth/status/route");
  actionRoute = await import("@/app/api/action/route");
  appRoute = await import("@/app/api/app/route");

  await server.ensureSystemCatalog();
});

function createJsonRequest(url, method, body, cookie) {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("origin", new URL(url).origin);
  if (cookie) headers.set("cookie", cookie);

  return new Request(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function extractCookie(response, name = "bidaflow_session") {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

describe("BF-A08-01: Authentication, Session & Invitation Lifecycle", () => {
  test("First user setup - succeeds with correct setup code and provisions ADMIN", async () => {
    env.SETUP_CODE = "SECRET_SETUP_2026";

    // 1. Missing / wrong setup code
    const reqWrong = createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
      fullName: "Admin Init",
      email: "admin@bidaflow.vn",
      password: "StrongPassword123!",
      setupCode: "WRONG_CODE",
    });
    const resWrong = await registerRoute.POST(reqWrong);
    assert.equal(resWrong.status, 403);
    const jsonWrong = await resWrong.json();
    assert.match(jsonWrong.error, /Mã thiết lập ban đầu không đúng/);

    // 2. Correct setup code
    const reqOk = createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
      fullName: "Admin Init",
      email: "admin@bidaflow.vn",
      password: "StrongPassword123!",
      setupCode: "SECRET_SETUP_2026",
    });
    const resOk = await registerRoute.POST(reqOk);
    assert.equal(resOk.status, 201);
    const cookie = extractCookie(resOk);
    assert.ok(cookie, "Must issue session cookie");

    // Verify user created with role_admin and ACTIVE status
    const user = await server.queryOne("SELECT * FROM users WHERE email = ?", "admin@bidaflow.vn");
    assert.ok(user);
    assert.equal(user.role_id, "role_admin");
    assert.equal(user.status, "ACTIVE");

    // Verify session token hash in DB
    const session = await server.queryOne("SELECT * FROM user_sessions WHERE user_id = ?", user.id);
    assert.ok(session);
    assert.ok(session.token_hash);
    assert.notEqual(session.token_hash, cookie); // Not storing raw token
  });

  test("Login flow - success, bad credentials, and locked account", async () => {
    env.SETUP_CODE = "SECRET_SETUP_2026";
    // Setup admin first
    await registerRoute.POST(createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
      fullName: "Admin",
      email: "admin@bidaflow.vn",
      password: "StrongPassword123!",
      setupCode: "SECRET_SETUP_2026",
    }));

    // Success login with email
    const reqLogin = createJsonRequest("http://localhost:3000/api/auth/login", "POST", {
      identity: "admin@bidaflow.vn",
      password: "StrongPassword123!",
    });
    const resLogin = await loginRoute.POST(reqLogin);
    assert.equal(resLogin.status, 200);
    const cookie = extractCookie(resLogin);
    assert.ok(cookie);

    // Cookie properties check
    const rawSetCookie = resLogin.headers.get("set-cookie");
    assert.match(rawSetCookie, /HttpOnly/i);
    assert.match(rawSetCookie, /Secure/i);
    assert.match(rawSetCookie, /SameSite=Lax/i);

    // Wrong password -> 401
    const resWrongPass = await loginRoute.POST(createJsonRequest("http://localhost:3000/api/auth/login", "POST", {
      identity: "admin@bidaflow.vn",
      password: "IncorrectPassword123!",
    }));
    assert.equal(resWrongPass.status, 401);

    // Non-existent identity -> 401
    const resNoUser = await loginRoute.POST(createJsonRequest("http://localhost:3000/api/auth/login", "POST", {
      identity: "unknown@bidaflow.vn",
      password: "StrongPassword123!",
    }));
    assert.equal(resNoUser.status, 401);

    // Lock user account -> 403
    await server.getRawDb().prepare("UPDATE users SET status = 'LOCKED' WHERE email = ?").bind("admin@bidaflow.vn").run();
    const resLocked = await loginRoute.POST(createJsonRequest("http://localhost:3000/api/auth/login", "POST", {
      identity: "admin@bidaflow.vn",
      password: "StrongPassword123!",
    }));
    assert.equal(resLocked.status, 403);
    const jsonLocked = await resLocked.json();
    assert.match(jsonLocked.error, /Tài khoản đang bị khóa/);
  });

  test("Session expiration - expired session is rejected, valid session accepted", async () => {
    env.SETUP_CODE = "SECRET_SETUP_2026";
    const resReg = await registerRoute.POST(createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
      fullName: "Admin",
      email: "admin@bidaflow.vn",
      password: "StrongPassword123!",
      setupCode: "SECRET_SETUP_2026",
    }));
    const cookie = extractCookie(resReg);

    // Valid session works
    const reqStatus = createJsonRequest("http://localhost:3000/api/auth/status", "GET", null, cookie);
    const resStatus = await statusRoute.GET(reqStatus);
    const dataStatus = await resStatus.json();
    assert.ok(dataStatus.user);
    assert.equal(dataStatus.user.email, "admin@bidaflow.vn");

    // Manually expire session in DB using ISO timestamp in the past (same day)
    // Testing SQLite datetime comparison fix: '2020-01-01T00:00:00.000Z'
    await server.getRawDb().prepare("UPDATE user_sessions SET expires_at = '2020-01-01T00:00:00.000Z'").run();

    const reqExpired = createJsonRequest("http://localhost:3000/api/auth/status", "GET", null, cookie);
    const resExpired = await statusRoute.GET(reqExpired);
    const dataExpired = await resExpired.json();
    assert.equal(dataExpired.user, null, "Expired session must return null user");
  });

  test("Logout flow - deletes session in database and clears cookie", async () => {
    env.SETUP_CODE = "SECRET_SETUP_2026";
    const resReg = await registerRoute.POST(createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
      fullName: "Admin",
      email: "admin@bidaflow.vn",
      password: "StrongPassword123!",
      setupCode: "SECRET_SETUP_2026",
    }));
    const cookie = extractCookie(resReg);

    // Perform logout
    const reqLogout = createJsonRequest("http://localhost:3000/api/auth/logout", "POST", null, cookie);
    const resLogout = await logoutRoute.POST(reqLogout);
    assert.equal(resLogout.status, 200);

    // Cookie cleared
    const setCookie = resLogout.headers.get("set-cookie") || "";
    assert.match(setCookie, /Max-Age=0/);

    // Database session deleted
    const countSessions = await server.queryOne("SELECT COUNT(*) AS count FROM user_sessions");
    assert.equal(Number(countSessions.count), 0);

    // Subsequent request with old cookie fails
    const reqPostLogout = createJsonRequest("http://localhost:3000/api/auth/status", "GET", null, cookie);
    const resPostLogout = await statusRoute.GET(reqPostLogout);
    const dataPostLogout = await resPostLogout.json();
    assert.equal(dataPostLogout.user, null);
  });

  test("User lock revokes active sessions immediately", async () => {
    env.SETUP_CODE = "SECRET_SETUP_2026";
    const resReg = await registerRoute.POST(createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
      fullName: "Admin User",
      email: "admin@bidaflow.vn",
      password: "StrongPassword123!",
      setupCode: "SECRET_SETUP_2026",
    }));
    const adminCookie = extractCookie(resReg);

    // Create staff invitation
    const inviteRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "user.invite",
      payload: { roleId: "role_cashier", email: "cashier@bidaflow.vn" },
    }, adminCookie));
    const inviteData = await inviteRes.json();
    const code = inviteData.data?.invitationCode ?? inviteData.invitationCode;

    // Register staff
    const regStaff = await registerRoute.POST(createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
      fullName: "Cashier One",
      email: "cashier@bidaflow.vn",
      password: "StrongPassword123!",
      invitationCode: code,
    }));
    const staffCookie = extractCookie(regStaff);

    // Verify staff is logged in
    const staffCheck1 = await statusRoute.GET(createJsonRequest("http://localhost:3000/api/auth/status", "GET", null, staffCookie));
    const staffData1 = await staffCheck1.json();
    assert.equal(staffData1.user.email, "cashier@bidaflow.vn");

    // Admin locks staff account via user.update action
    const staffUser = await server.queryOne("SELECT id FROM users WHERE email = 'cashier@bidaflow.vn'");
    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "user.update",
      payload: { id: staffUser.id, roleId: "role_cashier", status: "LOCKED", fullName: "Cashier One" },
    }, adminCookie));

    // Staff session deleted from DB and subsequent request returns null
    const staffCheck2 = await statusRoute.GET(createJsonRequest("http://localhost:3000/api/auth/status", "GET", null, staffCookie));
    const staffData2 = await staffCheck2.json();
    assert.equal(staffData2.user, null, "Locked user session must be revoked immediately");
  });

  test("Invitation lifecycle - creation, single-use, expiration, and email mismatch", async () => {
    env.SETUP_CODE = "SECRET_SETUP_2026";
    const resReg = await registerRoute.POST(createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
      fullName: "Admin",
      email: "admin@bidaflow.vn",
      password: "StrongPassword123!",
      setupCode: "SECRET_SETUP_2026",
    }));
    const adminCookie = extractCookie(resReg);

    // 1. Create invitation bound to cashier@bidaflow.vn
    const resInvite = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "user.invite",
      payload: { roleId: "role_cashier", email: "cashier@bidaflow.vn" },
    }, adminCookie));
    const inviteData = await resInvite.json();
    const code = inviteData.data?.invitationCode ?? inviteData.invitationCode;

    // 2. Attempt registration with email mismatch -> 403
    const resMismatch = await registerRoute.POST(createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
      fullName: "Wrong Email",
      email: "other@bidaflow.vn",
      password: "StrongPassword123!",
      invitationCode: code,
    }));
    assert.equal(resMismatch.status, 403);

    // 3. Register with correct email -> 201
    const resSuccess = await registerRoute.POST(createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
      fullName: "Cashier Staff",
      email: "cashier@bidaflow.vn",
      password: "StrongPassword123!",
      invitationCode: code,
    }));
    assert.equal(resSuccess.status, 201);

    // 4. Reuse same invitation code -> 403 (used_at IS NOT NULL)
    const resReuse = await registerRoute.POST(createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
      fullName: "Another Cashier",
      email: "cashier2@bidaflow.vn",
      password: "StrongPassword123!",
      invitationCode: code,
    }));
    assert.equal(resReuse.status, 403);

    // 5. Expired invitation test
    const resInviteExp = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "user.invite",
      payload: { roleId: "role_service" },
    }, adminCookie));
    const inviteExpData = await resInviteExp.json();
    const expCode = inviteExpData.data?.invitationCode ?? inviteExpData.invitationCode;
    // Set expiry to past in DB
    await server.getRawDb().prepare("UPDATE invitations SET expires_at = '2020-01-01T00:00:00.000Z' WHERE code_hash = ?")
      .bind(await server.sha256Hex(expCode)).run();

    const resExpired = await registerRoute.POST(createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
      fullName: "Service Staff",
      email: "service@bidaflow.vn",
      password: "StrongPassword123!",
      invitationCode: expCode,
    }));
    assert.equal(resExpired.status, 403);
  });
});

describe("BF-A08-02: Server-Side Role-Based Access Control (RBAC)", () => {
  let adminCookie;
  let cashierCookie;
  let serviceCookie;
  let warehouseCookie;

  beforeEach(async () => {
    env.SETUP_CODE = "SECRET_SETUP_2026";
    // 1. Create admin
    const resAdmin = await registerRoute.POST(createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
      fullName: "Admin Head",
      email: "admin@bidaflow.vn",
      password: "StrongPassword123!",
      setupCode: "SECRET_SETUP_2026",
    }));
    adminCookie = extractCookie(resAdmin);

    // Helper to invite and register a user
    async function createStaff(name, email, roleId) {
      const invRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
        action: "user.invite",
        payload: { roleId, email },
      }, adminCookie));
      const invJson = await invRes.json();
      const code = invJson.data?.invitationCode ?? invJson.invitationCode;
      const regRes = await registerRoute.POST(createJsonRequest("http://localhost:3000/api/auth/register", "POST", {
        fullName: name,
        email,
        password: "StrongPassword123!",
        invitationCode: code,
      }));
      return extractCookie(regRes);
    }

    cashierCookie = await createStaff("Cashier Bob", "cashier@bidaflow.vn", "role_cashier");
    serviceCookie = await createStaff("Service Alice", "service@bidaflow.vn", "role_service");
    warehouseCookie = await createStaff("Warehouse Dan", "warehouse@bidaflow.vn", "role_warehouse");

    // Seed basic operational entities
    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "area.save", payload: { code: "VIP", name: "VIP Area" },
    }, adminCookie));
    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "tableType.save", payload: { code: "POOL", name: "Pool Standard", baseHourlyRate: 80000 },
    }, adminCookie));
    const area = await server.queryOne("SELECT id FROM areas WHERE code = 'VIP'");
    const type = await server.queryOne("SELECT id FROM table_types WHERE code = 'POOL'");
    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "table.save", payload: { code: "T01", name: "Bàn 1", areaId: area.id, tableTypeId: type.id },
    }, adminCookie));
  });

  test("Unauthenticated requests are blocked with 401 across action and app data endpoints", async () => {
    // Action route without cookie
    const reqAction = createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "table.status", payload: { id: "tbl_any", status: "AVAILABLE" },
    });
    const resAction = await actionRoute.POST(reqAction);
    assert.equal(resAction.status, 401);
    const jsonAction = await resAction.json();
    assert.match(jsonAction.error, /Bạn cần đăng nhập để tiếp tục/);

    // App data route without cookie
    const reqApp = createJsonRequest("http://localhost:3000/api/app", "GET");
    const resApp = await appRoute.GET(reqApp);
    assert.equal(resApp.status, 401);
  });

  test("CASHIER role permissions - can manage sessions & payments, cannot manage tables, prices, users or inventory", async () => {
    const table = await server.queryOne("SELECT id FROM billiard_tables WHERE code = 'T01'");

    // Positive: CASHIER can start play session (SESSIONS_MANAGE)
    const resStart = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "session.start", payload: { tableId: table.id },
    }, cashierCookie));
    assert.equal(resStart.status, 200, "Cashier should be allowed to start play session");

    // Negative: CASHIER cannot create areas (TABLES_MANAGE) -> 403
    const resArea = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "area.save", payload: { code: "ZONE2", name: "Zone 2" },
    }, cashierCookie));
    assert.equal(resArea.status, 403);

    // Negative: CASHIER cannot change pricing (PRICES_MANAGE) -> 403
    const resPrice = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "price.save", payload: { tableTypeId: "type_any", name: "Peak", hourlyRate: 100000 },
    }, cashierCookie));
    assert.equal(resPrice.status, 403);

    // Negative: CASHIER cannot invite users (USERS_MANAGE) -> 403
    const resInvite = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "user.invite", payload: { roleId: "role_cashier" },
    }, cashierCookie));
    assert.equal(resInvite.status, 403);

    // Negative: CASHIER cannot adjust stock (INVENTORY_MANAGE) -> 403
    const resStock = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "inventory.move", payload: { productId: "prod_any", type: "IN", quantity: 10 },
    }, cashierCookie));
    assert.equal(resStock.status, 403);
  });

  test("SERVICE role permissions - can view and operate tables/orders, cannot invoice or shift manage", async () => {
    const table = await server.queryOne("SELECT id FROM billiard_tables WHERE code = 'T01'");

    // Positive: SERVICE can update table status (TABLE_STATUS)
    const resStatus = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "table.status", payload: { id: table.id, status: "AVAILABLE" },
    }, serviceCookie));
    assert.equal(resStatus.status, 200);

    // Negative: SERVICE cannot manage shifts (SHIFTS_MANAGE) -> 403
    const resShift = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "shift.open", payload: { openingCash: 1000000 },
    }, serviceCookie));
    assert.equal(resShift.status, 403);

    // Negative: SERVICE cannot collect payments (PAYMENTS_MANAGE) -> 403
    const resPay = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay", payload: { invoiceId: "inv_any", method: "CASH", amount: 100000 },
    }, serviceCookie));
    assert.equal(resPay.status, 403);
  });

  test("WAREHOUSE role permissions - can manage inventory and products, cannot access cashier/sessions", async () => {
    // Positive: WAREHOUSE can create product category (PRODUCTS_MANAGE)
    const resCat = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "category.save", payload: { code: "DRINK", name: "Nước giải khát" },
    }, warehouseCookie));
    assert.equal(resCat.status, 200);

    // Negative: WAREHOUSE cannot start session (SESSIONS_MANAGE) -> 403
    const table = await server.queryOne("SELECT id FROM billiard_tables WHERE code = 'T01'");
    const resSession = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "session.start", payload: { tableId: table.id },
    }, warehouseCookie));
    assert.equal(resSession.status, 403);

    // Negative: WAREHOUSE cannot manage customer memberships (MEMBERSHIPS_MANAGE) -> 403
    const resTier = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "tier.save", payload: { code: "GOLD", name: "Gold Tier", minPoints: 100, discountPercent: 10 },
    }, warehouseCookie));
    assert.equal(resTier.status, 403);
  });

  test("ADMIN override - ADMIN has all permissions even if not mapped in role_permissions table", async () => {
    // Clear all entries in role_permissions for role_admin
    await server.getRawDb().prepare("DELETE FROM role_permissions WHERE role_id = 'role_admin'").run();

    // ADMIN can still perform USERS_MANAGE
    const resInvite = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "user.invite", payload: { roleId: "role_cashier" },
    }, adminCookie));
    assert.equal(resInvite.status, 200, "ADMIN must retain all permissions via role override");
  });

  test("Dynamic permission updates via role.permissions take effect immediately", async () => {
    // Initially CASHIER cannot manage inventory (INVENTORY_MANAGE)
    const resBefore = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "inventory.move", payload: { productId: "prod_any", type: "IN", quantity: 5 },
    }, cashierCookie));
    assert.equal(resBefore.status, 403);

    // Admin grants INVENTORY_MANAGE to role_cashier
    const cashierRole = await server.queryOne("SELECT id FROM roles WHERE code = 'CASHIER'");
    const currentPerms = (await server.queryAll("SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?", cashierRole.id)).map(r => r.code);
    const newPerms = [...currentPerms, "INVENTORY_MANAGE"];

    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "role.permissions", payload: { roleId: cashierRole.id, permissionCodes: newPerms },
    }, adminCookie));

    // Create a product so inventory.move doesn't fail on missing product validation
    await server.getRawDb().prepare("INSERT INTO products (id, code, name, sale_price, cost_price, track_stock, stock_quantity) VALUES ('prod_01', 'P01', 'Bia', 20000, 15000, 1, 10)").run();

    // Now CASHIER can execute inventory.move without 403
    const resAfter = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "inventory.move", payload: { productId: "prod_01", type: "IN", quantity: 5, reason: "Nhập thêm" },
    }, cashierCookie));
    assert.equal(resAfter.status, 200, "Updated role permissions should take effect immediately on next request");
  });

  test("PROFILE_MANAGE permission protects profile.update and password.change", async () => {
    // 1. Positive: User with PROFILE_MANAGE can update profile
    const resUpdate = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "profile.update", payload: { fullName: "Cashier Updated Name", phone: "0901234567" },
    }, cashierCookie));
    assert.equal(resUpdate.status, 200);

    const updatedUser = await server.queryOne("SELECT full_name, phone FROM users WHERE email = 'cashier@bidaflow.vn'");
    assert.equal(updatedUser.full_name, "Cashier Updated Name");

    // 2. Negative: Revoke PROFILE_MANAGE from role_cashier and test rejection
    const cashierRole = await server.queryOne("SELECT id FROM roles WHERE code = 'CASHIER'");
    const remainingPerms = (await server.queryAll("SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?", cashierRole.id))
      .map(r => r.code)
      .filter(c => c !== "PROFILE_MANAGE");

    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "role.permissions", payload: { roleId: cashierRole.id, permissionCodes: remainingPerms },
    }, adminCookie));

    const resForbidden = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "profile.update", payload: { fullName: "Hacked Name" },
    }, cashierCookie));
    assert.equal(resForbidden.status, 403, "Must return 403 when user lacks PROFILE_MANAGE");
  });
});
