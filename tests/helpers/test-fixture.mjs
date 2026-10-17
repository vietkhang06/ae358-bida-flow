import { createMockD1 } from "./d1-mock.mjs";
import { env, setTestDb } from "./cf-mock.mjs";

export function createJsonRequest(url, method, body, cookie) {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("origin", new URL(url).origin);
  if (cookie) headers.set("cookie", cookie);

  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD" && body !== undefined && body !== null) {
    init.body = JSON.stringify(body);
  }

  return new Request(url, init);
}

export function extractCookie(response, name = "bidaflow_session") {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

export async function setupTestEnvironment() {
  const mockDb = createMockD1();
  setTestDb(mockDb);

  const server = await import("@/lib/server");
  const actionRoute = await import("@/app/api/action/route");
  const appRoute = await import("@/app/api/app/route");
  const loginRoute = await import("@/app/api/auth/login/route");
  const registerRoute = await import("@/app/api/auth/register/route");

  await server.ensureSystemCatalog();

  const passwordHashed = await server.hashPassword("StrongPass123!");

  // Provision users for each role
  const usersToCreate = [
    { id: "usr_admin", email: "admin@bidaflow.vn", name: "Admin Test", roleId: "role_admin" },
    { id: "usr_manager", email: "manager@bidaflow.vn", name: "Manager Test", roleId: "role_manager" },
    { id: "usr_cashier", email: "cashier@bidaflow.vn", name: "Cashier Test", roleId: "role_cashier" },
    { id: "usr_service", email: "service@bidaflow.vn", name: "Service Test", roleId: "role_service" },
    { id: "usr_warehouse", email: "warehouse@bidaflow.vn", name: "Warehouse Test", roleId: "role_warehouse" },
  ];

  const cookies = {};

  for (const u of usersToCreate) {
    await mockDb.prepare(
      "INSERT INTO users (id, email, full_name, password_hash, password_salt, role_id, status) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')"
    ).bind(u.id, u.email, u.name, passwordHashed.hash, passwordHashed.salt, u.roleId).run();

    const token = await server.createSession(u.id);
    cookies[u.roleId] = server.authCookie(token).split(";")[0];
  }

  return {
    db: mockDb,
    server,
    actionRoute,
    appRoute,
    loginRoute,
    registerRoute,
    adminCookie: cookies["role_admin"],
    managerCookie: cookies["role_manager"],
    cashierCookie: cookies["role_cashier"],
    serviceCookie: cookies["role_service"],
    warehouseCookie: cookies["role_warehouse"],
  };
}
