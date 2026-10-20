import { test, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { operationsFixture } from "./helpers/operations-fixture.mjs";
let f;
beforeEach(async () => { f = await operationsFixture(); });
afterEach(() => f.db._raw.close());

describe("BF-A09-01 #10: area, table and type management", () => {
  test("create/update/deactivate preserves records and exposes only active catalogs", async () => {
    const { id: a } = (await f.call("area.save", { code: "NEW", name: "Khu mới" }, "manager")).data;
    const { id: t } = (await f.call("tableType.save", { code: "VIP", name: "VIP", baseHourlyRate: 80000 }, "manager")).data;
    const { id: b } = (await f.call("table.save", { code: "NEW", name: "Bàn mới", areaId: a, tableTypeId: t }, "manager")).data;
    await f.call("table.save", { id: b, code: "NEW", name: "Bàn đổi tên", areaId: a, tableTypeId: t }, "manager");
    assert.equal((await f.one("SELECT name FROM billiard_tables WHERE id=?", b)).name, "Bàn đổi tên");
    await f.reject("area.delete", { id: a }, "manager");
    await f.reject("tableType.delete", { id: t }, "manager");
    await f.call("table.delete", { id: b }, "manager");
    await f.call("area.delete", { id: a }, "manager");
    await f.call("tableType.delete", { id: t }, "manager");
    assert.equal((await f.one("SELECT active FROM billiard_tables WHERE id=?", b)).active, 0);
    assert.ok(!(await f.read()).tables.some((x) => x.id === b));
  });
  test("duplicate area names and table codes are rejected", async () => {
    await f.reject("area.save", { code: "NEW", name: " khu a " }, "manager");
    await f.reject("table.save", { code: "B1", name: "Other", areaId: "a", tableTypeId: "t" }, "manager");
    assert.equal((await f.one("SELECT COUNT(*) n FROM areas")).n, 1);
  });
  test("missing/inactive references and non-existent updates are rejected", async () => {
    for (const payload of [
      { code: "B3", name: "Bàn 3", areaId: "missing", tableTypeId: "t" },
      { code: "B3", name: "Bàn 3", areaId: "a", tableTypeId: "missing" },
      { id: "missing", code: "B3", name: "Bàn 3", areaId: "a", tableTypeId: "t" },
    ]) await f.reject("table.save", payload, "manager");
    f.db._raw.exec("UPDATE areas SET active=0 WHERE id='a'");
    await f.reject("table.save", { code: "B3", name: "Bàn 3", areaId: "a", tableTypeId: "t" }, "manager");
  });
  test("cashier cannot manage catalogs", async () => {
    for (const action of ["area.save", "area.delete", "table.save", "table.delete", "tableType.save", "tableType.delete"]) await f.call(action, {}, "cashier", 403);
  });
});

describe("BF-A09-02 #11: status and active-session guards", () => {
  for (const paused of [false, true]) test(`ACTIVE/PAUSED guard (paused=${paused}) protects status, deletion, table type and duplicate starts`, async () => {
    const sessionId = await f.start();
    if (paused) await f.call("session.pause", { sessionId });
    for (const status of ["AVAILABLE", "RESERVED", "MAINTENANCE", "PLAYING"]) await f.reject("table.status", { id: "b1", status });
    await f.reject("table.delete", { id: "b1" }, "manager");
    await f.reject("session.start", { tableId: "b1" });
    assert.equal((await f.one("SELECT status FROM billiard_tables WHERE id='b1'")).status, "PLAYING");
  });
  test("unpaid invoice prevents table deletion after session ends", async () => {
    const sessionId = await f.start();
    await f.call("session.end", { sessionId });
    await f.call("invoice.create", { sessionId });
    await f.reject("table.delete", { id: "b1" }, "manager");
  });
  test("maintenance, nonexistent, inactive and unsupported statuses are protected", async () => {
    await f.call("table.status", { id: "b1", status: "MAINTENANCE" });
    await f.reject("session.start", { tableId: "b1" });
    await f.reject("table.status", { id: "missing", status: "AVAILABLE" });
    await f.reject("table.status", { id: "b2", status: "PLAYING" });
    await f.reject("table.status", { id: "b2", status: "RESERVED" });
    await f.call("table.delete", { id: "b2" }, "manager");
    await f.reject("session.start", { tableId: "b2" });
  });
  test("two simultaneous starts leave exactly one session and one segment", async () => {
    const results = await Promise.all([f.call("session.start", { tableId: "b1" }, "cashier", null), f.call("session.start", { tableId: "b1" }, "service", null)]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal((await f.one("SELECT COUNT(*) n FROM play_sessions")).n, 1);
    assert.equal((await f.one("SELECT COUNT(*) n FROM session_segments")).n, 1);
  });
});

const price = (extra = {}) => ({ tableTypeId: "t", name: "Giờ vàng", hourlyRate: 90000, daysMask: 127, startMinute: 0, endMinute: 1440, ...extra });
describe("BF-A09-03 #12: price validation and selection", () => {
  for (const [key, bad] of [["hourlyRate", -1], ["hourlyRate", "NaN"], ["hourlyRate", "Infinity"], ["hourlyRate", 1.5], ["daysMask", 0], ["daysMask", 128], ["daysMask", 1.5], ["startMinute", -1], ["startMinute", 2.5], ["endMinute", 0], ["endMinute", 1441], ["priority", "NaN"]]) {
    test(`reject invalid ${key}=${bad}`, async () => {
      await f.reject("price.save", price({ [key]: bad }), "manager");
      assert.equal((await f.one("SELECT COUNT(*) n FROM price_rules")).n, 0);
    });
  }
  test("invalid dates, reversed ranges and inactive type rejected", async () => {
    for (const extra of [
      { startMinute: 500, endMinute: 400 }, { effectiveFrom: "invalid" },
      { effectiveFrom: "2030-02-30T00:00:00Z" },
      { effectiveFrom: "2030-01-02T00:00:00Z", effectiveTo: "2030-01-01T00:00:00Z" },
      { tableTypeId: "missing" },
    ]) await f.reject("price.save", price(extra), "manager");
  });
  test("overlap uses dates, days, minutes and priority; touching effective windows allowed", async () => {
    await f.call("price.save", price({ effectiveFrom: "2030-01-01T00:00:00Z", effectiveTo: "2030-02-01T00:00:00Z" }), "manager");
    await f.reject("price.save", price({ effectiveFrom: "2030-01-15T00:00:00Z", effectiveTo: "2030-02-02T00:00:00Z" }), "manager");
    await f.call("price.save", price({ effectiveFrom: "2030-02-01T00:00:00Z", effectiveTo: "2030-03-01T00:00:00Z" }), "manager");
    await f.call("price.save", price({ priority: 1, hourlyRate: 120000 }), "manager");
    assert.equal(await f.server.activeHourlyRate("b1", new Date("2030-01-15T03:00:00Z")), 120000);
  });
  test("Vietnam midnight/day selection, exact expiry and zero price", async () => {
    // 2030-01-06 is Sunday; 17:00Z Saturday = midnight Sunday in Vietnam.
    await f.call("price.save", price({ daysMask: 1, endMinute: 60, hourlyRate: 0 }), "manager");
    assert.equal(await f.server.activeHourlyRate("b1", new Date("2030-01-05T17:00:00Z")), 0);
    assert.equal(await f.server.activeHourlyRate("b1", new Date("2030-01-05T18:00:00Z")), 60000);
    await f.call("price.save", price({ priority: 1, effectiveTo: "2030-01-05T17:30:00Z" }), "manager");
    assert.equal(await f.server.activeHourlyRate("b1", new Date("2030-01-05T17:29:59Z")), 90000);
    assert.equal(await f.server.activeHourlyRate("b1", new Date("2030-01-05T17:30:00Z")), 0);
  });
  test("simultaneous overlapping rules only save once", async () => {
    const results = await Promise.all([f.call("price.save", price(), "manager", null), f.call("price.save", price(), "manager", null)]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
  });
});
