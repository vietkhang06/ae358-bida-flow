import test from "node:test";
import assert from "node:assert/strict";
import { createJsonRequest, setupTestEnvironment } from "./helpers/test-fixture.mjs";

test("BF-A16-03: report snapshot is visible only to roles with REPORTS_VIEW", async () => {
  const fixture = await setupTestEnvironment();
  try {
    const managerResponse = await fixture.appRoute.GET(createJsonRequest(
      "http://localhost:3000/api/app", "GET", null, fixture.managerCookie,
    ));
    assert.equal(managerResponse.status, 200);
    const managerBody = await managerResponse.json();
    assert.deepEqual(Object.keys(managerBody.report).sort(), ["inventory", "products", "revenue", "tables"]);
    for (const key of ["inventory", "products", "revenue", "tables"]) {
      assert.ok(Array.isArray(managerBody.report[key]), `${key} report must be an array`);
    }

    for (const [role, cookie] of [
      ["CASHIER", fixture.cashierCookie],
      ["SERVICE", fixture.serviceCookie],
      ["WAREHOUSE", fixture.warehouseCookie],
    ]) {
      const response = await fixture.appRoute.GET(createJsonRequest(
        "http://localhost:3000/api/app", "GET", null, cookie,
      ));
      assert.equal(response.status, 200, `${role} may read its permitted app snapshot`);
      const body = await response.json();
      assert.equal(body.report, null, `${role} must not receive report data without REPORTS_VIEW`);
    }
  } finally {
    fixture.db._raw.close();
  }
});
