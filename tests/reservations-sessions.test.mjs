import { test, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { operationsFixture } from "./helpers/operations-fixture.mjs";
import { billableSeconds, segmentAmount } from "../lib/play-time.ts";
let f;
beforeEach(async () => { f = await operationsFixture(); });
afterEach(() => f.db._raw.close());

describe("BF-A10-01 #13: reservation lifecycle", () => {
  test("create/edit/confirm/cancel audits actor; terminal bookings cannot reopen", async () => {
    const payload = f.booking();
    const { reservationId: id } = (await f.call("reservation.save", payload)).data;
    await f.call("reservation.save", { ...payload, id, guestCount: 4 });
    await f.call("reservation.status", { id, status: "CONFIRMED" });
    await f.call("reservation.status", { id, status: "CANCELLED" });
    await f.reject("reservation.status", { id, status: "CONFIRMED" });
    await f.reject("reservation.save", { ...payload, id });
    assert.equal((await f.one("SELECT guest_count FROM reservations WHERE id=?", id)).guest_count, 4);
    const log = await f.one("SELECT actor_id FROM audit_logs WHERE entity_id=? AND metadata_json LIKE '%CANCELLED%'", id);
    assert.equal(log.actor_id, "usr_cashier");
  });
  test("no-show and missing IDs are protected", async () => {
    const { reservationId: id } = (await f.call("reservation.save", f.booking())).data;
    await f.call("reservation.status", { id, status: "NO_SHOW" });
    await f.reject("reservation.status", { id, status: "CONFIRMED" });
    await f.reject("reservation.status", { id: "missing", status: "CANCELLED" });
  });
  test("equivalent timezone overlaps are rejected; adjacent intervals are valid", async () => {
    const p = f.booking({ startsAt: "2030-01-01T10:00:00+07:00", endsAt: "2030-01-01T11:00:00+07:00" });
    await f.call("reservation.save", p);
    await f.reject("reservation.save", { ...p, startsAt: "2030-01-01T03:30:00Z", endsAt: "2030-01-01T04:30:00Z" });
    await f.call("reservation.save", { ...p, startsAt: "2030-01-01T04:00:00Z", endsAt: "2030-01-01T05:00:00Z" });
    assert.equal((await f.one("SELECT starts_at FROM reservations ORDER BY starts_at LIMIT 1")).starts_at, "2030-01-01T03:00:00.000Z");
  });
  for (const patch of [{ startsAt: "x" }, { endsAt: "2030-02-30T00:00:00Z" }, { guestCount: 0 }, { guestCount: 1.5 }, { guestCount: "Infinity" }, { status: "SEATED" }, { customerId: "missing" }, { tableId: "missing" }]) {
    test(`invalid booking payload ${JSON.stringify(patch)}`, async () => { await f.reject("reservation.save", f.booking(patch)); });
  }
  test("simultaneous overlapping reservations cannot both succeed", async () => {
    const p = f.booking();
    const results = await Promise.all([f.call("reservation.save", p, "cashier", null), f.call("reservation.save", p, "cashier", null)]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal((await f.one("SELECT COUNT(*) n FROM reservations")).n, 1);
  });
  test("future booking does not reserve now; due booking protects walk-in and clears on cancel", async () => {
    const { reservationId: id } = (await f.call("reservation.save", f.booking())).data;
    assert.equal((await f.read()).tables.find((t) => t.id === "b1").status, "AVAILABLE");
    await f.call("reservation.save", f.booking({ id, startsAt: new Date(Date.now() - 60000).toISOString() }));
    assert.equal((await f.read()).tables.find((t) => t.id === "b1").status, "RESERVED");
    await f.reject("session.start", { tableId: "b1" });
    await f.reject("table.status", { id: "b1", status: "AVAILABLE" });
    await f.call("reservation.status", { id, status: "CANCELLED" });
    assert.equal((await f.read()).tables.find((t) => t.id === "b1").status, "AVAILABLE");
  });
});

describe("BF-A10-02 #14: session transitions", () => {
  test("only confirmed booking can seat; unknown booking cannot fall back to a table", async () => {
    const payload = f.booking();
    const { reservationId } = (await f.call("reservation.save", payload)).data;
    await f.reject("reservation.seat", { reservationId });
    await f.reject("reservation.seat", { reservationId: "missing", tableId: "b2" });
    await f.call("reservation.status", { id: reservationId, status: "CONFIRMED" });
    const { sessionId } = (await f.call("reservation.seat", { reservationId }, "service")).data;
    await f.reject("reservation.seat", { reservationId });
    await f.reject("reservation.save", { ...payload, id: reservationId });
    assert.equal((await f.one("SELECT reservation_id FROM play_sessions WHERE id=?", sessionId)).reservation_id, reservationId);
  });
  test("pause/resume restrict service; repeats/end states rejected; table remains occupied", async () => {
    const sessionId = await f.start();
    await f.call("session.pause", { sessionId }, "service", 403);
    await f.reject("session.resume", { sessionId });
    await f.call("session.pause", { sessionId });
    await f.reject("session.pause", { sessionId });
    assert.equal((await f.read()).tables.find((t) => t.id === "b1").status, "PLAYING");
    await f.call("session.resume", { sessionId });
    await f.call("session.end", { sessionId }, "service");
    for (const action of ["session.pause", "session.resume", "session.end"]) await f.reject(action, { sessionId });
    assert.equal((await f.one("SELECT status FROM billiard_tables WHERE id='b1'")).status, "AVAILABLE");
  });
  test("transfer retains pause, old history, destination rate and role checks", async () => {
    const sessionId = await f.start();
    await f.call("session.pause", { sessionId });
    await f.call("session.transfer", { sessionId, toTableId: "b2" }, "service", 403);
    await f.call("session.transfer", { sessionId, toTableId: "b2" });
    assert.equal((await f.one("SELECT status FROM play_sessions WHERE id=?", sessionId)).status, "PAUSED");
    assert.equal((await f.one("SELECT COUNT(*) n FROM session_pauses WHERE ended_at IS NULL")).n, 1);
    assert.equal((await f.one("SELECT COUNT(*) n FROM session_segments")).n, 2);
    assert.equal((await f.one("SELECT COUNT(*) n FROM table_transfers")).n, 1);
    await f.call("session.end", { sessionId });
    assert.equal((await f.one("SELECT COUNT(*) n FROM session_pauses WHERE ended_at IS NULL")).n, 0);
  });
  test("start batch rollback does not leave partial session or table state", async () => {
    const original = f.db.batch;
    f.db.batch = (statements) => original([...statements.slice(0, 1), f.db.prepare("INSERT INTO table_does_not_exist VALUES (1)"), ...statements.slice(1)]);
    const old = console.error; console.error = () => {};
    try { await f.call("session.start", { tableId: "b1" }, "cashier", 500); } finally { console.error = old; f.db.batch = original; }
    assert.equal((await f.one("SELECT COUNT(*) n FROM play_sessions")).n, 0);
    assert.equal((await f.one("SELECT status FROM billiard_tables WHERE id='b1'")).status, "AVAILABLE");
  });
});

describe("BF-A10-03 #15: billable time and frozen segment rate", () => {
  for (const [seconds, expected] of [[0, 0], [1, 1000], [60, 1000], [61, 2000], [3600, 60000]]) {
    test(`minute rounding ${seconds}s -> ${expected} VND`, () => assert.equal(segmentAmount(seconds, 60000), expected));
  }
  test("overlapping/out-of-range/open pauses are clipped and unioned", () => {
    const segment = { started_at: "2030-01-01T00:00:00Z", ended_at: null };
    assert.equal(billableSeconds(segment, [
      { started_at: "2029-12-31T23:00:00Z", ended_at: "2030-01-01T00:10:00Z" },
      { started_at: "2030-01-01T00:05:00Z", ended_at: "2030-01-01T00:20:00Z" },
      { started_at: "2030-01-01T00:50:00Z", ended_at: null },
    ], new Date("2030-01-01T01:00:00Z")), 1800);
  });
  test("multiple segments, pause intervals, snapshot rates and closed totals", async () => {
    const sid = await f.start();
    f.db._raw.exec(`UPDATE play_sessions SET status='CLOSED',ended_at='2030-01-01T02:00:00Z',table_amount=120000 WHERE id='${sid}';
      UPDATE session_segments SET started_at='2030-01-01T00:00:00Z',ended_at='2030-01-01T01:00:00Z',hourly_rate=60000;
      INSERT INTO session_pauses(id,session_id,segment_id,started_at,ended_at,created_by) SELECT 'pause','${sid}',id,'2030-01-01T00:10:00Z','2030-01-01T00:30:00Z','usr_cashier' FROM session_segments;
      INSERT INTO session_segments(id,session_id,table_id,started_at,ended_at,hourly_rate) VALUES ('seg2','${sid}','b2','2030-01-01T01:00:00Z','2030-01-01T02:00:00Z',120000);
      UPDATE table_types SET base_hourly_rate=999999;
    `);
    const timing = await f.server.sessionTiming(sid, new Date("2030-01-02T00:00:00Z"));
    assert.equal(timing.seconds, 6000);
    assert.equal(timing.amount, 160000);
    assert.equal(await f.server.calculateSessionAmount(sid, new Date("2031-01-02T00:00:00Z")), 160000);
  });
  test("open pause freezes server time and displayed amount", async () => {
    const sessionId = await f.start();
    await f.call("session.pause", { sessionId });
    const a = await f.server.sessionTiming(sessionId, new Date(Date.now() + 60000));
    const b = await f.server.sessionTiming(sessionId, new Date(Date.now() + 3600000));
    assert.equal(a.seconds, b.seconds); assert.equal(a.amount, b.amount);
    const visible = (await f.read()).sessions.find((s) => s.id === sessionId);
    assert.equal(visible.billable_seconds, a.seconds);
    assert.ok(visible.sampled_at);
  });
});

describe("BF-A10-04 #16: complete API lifecycle", () => {
  test("manager setup -> cashier booking -> service seats -> cashier pauses/resumes -> service ends", async () => {
    const { id: areaId } = (await f.call("area.save", { code: "E2E", name: "Khu E2E" }, "manager")).data;
    const { id: tableTypeId } = (await f.call("tableType.save", { code: "E2E", name: "Loại E2E", baseHourlyRate: 90000 }, "manager")).data;
    const { id: tableId } = (await f.call("table.save", { code: "E2E", name: "Bàn E2E", areaId, tableTypeId }, "manager")).data;
    const { reservationId } = (await f.call("reservation.save", f.booking({ tableId }))).data;
    await f.call("reservation.status", { id: reservationId, status: "CONFIRMED" });
    assert.ok((await f.read("service")).reservations.some((r) => r.id === reservationId));
    await f.call("reservation.status", { id: reservationId, status: "CANCELLED" }, "service", 403);
    const { sessionId } = (await f.call("reservation.seat", { reservationId }, "service")).data;
    await f.call("session.pause", { sessionId, reason: "Khách nghỉ" });
    assert.equal((await f.read()).sessions.find((s) => s.id === sessionId).status, "PAUSED");
    await f.call("session.resume", { sessionId });
    const result = await f.call("session.end", { sessionId }, "service");
    const saved = await f.one("SELECT * FROM play_sessions WHERE id=?", sessionId);
    assert.equal(saved.table_amount, result.data.tableAmount);
    assert.equal(saved.status, "CLOSED"); assert.ok(saved.ended_at);
    assert.equal((await f.one("SELECT status FROM reservations WHERE id=?", reservationId)).status, "SEATED");
    assert.equal((await f.read()).tables.find((t) => t.id === tableId).status, "AVAILABLE");
  });
  test("concurrent pause/end requests preserve a single final state and closed pause", async () => {
    const sessionId = await f.start();
    const results = await Promise.all([f.call("session.pause", { sessionId }, "cashier", null), f.call("session.end", { sessionId }, "cashier", null)]);
    assert.ok(results.every((r) => [200, 400, 409].includes(r.status)));
    const state = await f.one("SELECT status FROM play_sessions WHERE id=?", sessionId);
    if (state.status === "CLOSED") assert.equal((await f.one("SELECT COUNT(*) n FROM session_pauses WHERE ended_at IS NULL")).n, 0);
    else { assert.equal(state.status, "PAUSED"); await f.call("session.end", { sessionId }); }
    assert.equal((await f.one("SELECT COUNT(*) n FROM session_segments WHERE ended_at IS NULL")).n, 0);
  });
});
