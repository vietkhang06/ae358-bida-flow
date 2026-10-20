import assert from "node:assert/strict";
import { setupTestEnvironment, createJsonRequest } from "./test-fixture.mjs";

export async function operationsFixture() {
  const f = await setupTestEnvironment();
  f.db._raw.exec(`
    INSERT INTO areas(id,code,name) VALUES ('a','A','Khu A');
    INSERT INTO table_types(id,code,name,base_hourly_rate) VALUES ('t','T','Pool',60000);
    INSERT INTO billiard_tables(id,code,name,area_id,table_type_id) VALUES ('b1','B1','Bàn 1','a','t'),('b2','B2','Bàn 2','a','t');
    INSERT INTO product_categories(id,code,name) VALUES ('cat','CAT','Đồ uống');
    INSERT INTO products(id,code,name,category_id,sale_price,stock_quantity,track_stock) VALUES ('p','P','Nước suối','cat',15000,10,1);
    INSERT INTO products(id,code,name,kind,sale_price,track_stock) VALUES ('svc','SVC','Thuê cơ','SERVICE',20000,0);
  `);
  f.call = async (action, payload = {}, role = "cashier", expected = 200) => {
    const response = await f.actionRoute.POST(createJsonRequest("http://localhost/api/action", "POST", { action, payload }, f[`${role}Cookie`]));
    const json = await response.json();
    if (expected !== null) assert.equal(response.status, expected, `${action}: ${JSON.stringify(json)}`);
    return { status: response.status, ...json };
  };
  f.read = async (role = "cashier") => {
    const response = await f.appRoute.GET(createJsonRequest("http://localhost/api/app", "GET", null, f[`${role}Cookie`]));
    assert.equal(response.status, 200);
    return response.json();
  };
  f.one = (sql, ...params) => f.db.prepare(sql).bind(...params).first();
  f.start = async (tableId = "b1") => (await f.call("session.start", { tableId })).data.sessionId;
  f.booking = (overrides = {}) => ({
    tableId: "b1", customerName: "Khách Test", customerPhone: "0901234567", guestCount: 2,
    startsAt: new Date(Date.now() + 3600000).toISOString(),
    endsAt: new Date(Date.now() + 7200000).toISOString(),
    ...overrides,
  });
  f.reject = async (action, payload, role = "cashier") => {
    const result = await f.call(action, payload, role, null);
    assert.ok([400, 404, 409].includes(result.status), `${action} should reject: ${JSON.stringify(result)}`);
    return result;
  };
  return f;
}
