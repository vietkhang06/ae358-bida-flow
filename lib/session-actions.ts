import { AppError, activeHourlyRate, audit, calculateSessionAmount, code, getRawDb, id, nowIso, queryOne, type AppUser } from "@/lib/server";
import { activeRecord, changed, optional, required, type Payload } from "@/lib/operation-validation";

type Session = { id: string; table_id: string; status: string };
type Booking = { id: string; table_id: string; customer_id: string | null; status: string };

export async function sessionAction(action: string, p: Payload, user: AppUser, request: Request) {
  const db = getRawDb(), at = nowIso();
  if (["session.pause", "session.resume", "session.transfer"].includes(action) && !["ADMIN", "MANAGER", "CASHIER"].includes(user.roleCode)) throw new AppError("Chỉ Thu ngân hoặc Quản lý được tạm dừng/tiếp tục/chuyển bàn.", 403);
  if (action === "session.start" || action === "reservation.seat") {
    let reservation: Booking | null = null;
    if (action === "reservation.seat") {
      reservation = await queryOne<Booking>("SELECT id, table_id, customer_id, status FROM reservations WHERE id=?", required(p, "reservationId"));
      if (!reservation) throw new AppError("Không tìm thấy lịch đặt.", 404);
      if (reservation.status !== "CONFIRMED") throw new AppError("Chỉ nhận bàn từ lịch đặt đã xác nhận.");
    }
    const tableId = reservation?.table_id ?? required(p, "tableId");
    const table = await activeRecord("billiard_tables", tableId);
    if (table.status === "MAINTENANCE") throw new AppError("Bàn đang bảo trì.");
    const customerId = reservation?.customer_id ?? optional(p, "customerId");
    if (customerId) await activeRecord("customers", customerId);
    const sessionId = id("play"), segmentId = id("seg");
    const rate = await activeHourlyRate(tableId, new Date(at));
    const results = await db.batch([
      db.prepare(`INSERT INTO play_sessions (id, code, table_id, customer_id, reservation_id, started_at, opened_by, notes)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM billiard_tables WHERE id=? AND active=1 AND status<>'MAINTENANCE')
        AND NOT EXISTS (SELECT 1 FROM play_sessions WHERE table_id=? AND status IN ('ACTIVE','PAUSED'))
        AND NOT EXISTS (SELECT 1 FROM reservations WHERE table_id=? AND id<>? AND status IN ('PENDING','CONFIRMED') AND julianday(starts_at)<=julianday(?) AND julianday(ends_at)>julianday(?))
        AND (? IS NULL OR EXISTS (SELECT 1 FROM reservations WHERE id=? AND status='CONFIRMED'))
        AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM play_sessions WHERE reservation_id=?))`)
        .bind(sessionId, code("PS"), tableId, customerId, reservation?.id ?? null, at, user.id, optional(p, "notes"), tableId, tableId, tableId, reservation?.id ?? "", at, at, reservation?.id ?? null, reservation?.id ?? null, reservation?.id ?? null, reservation?.id ?? null),
      db.prepare("INSERT INTO session_segments (id, session_id, table_id, started_at, hourly_rate) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM play_sessions WHERE id=?)").bind(segmentId, sessionId, tableId, at, rate, sessionId),
      db.prepare("UPDATE billiard_tables SET status='PLAYING', updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM play_sessions WHERE id=?)").bind(at, tableId, sessionId),
      db.prepare("UPDATE reservations SET status='SEATED', updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM play_sessions WHERE id=?)").bind(at, reservation?.id ?? "", sessionId),
    ]);
    changed(results[0], "Bàn đang có phiên chơi/lịch đặt khác hoặc lịch đặt đã được nhận.");
    await audit(request, user.id, "SESSION_STARTED", "PLAY_SESSION", sessionId, "Mở bàn và bắt đầu phiên chơi", { tableId, rate, reservationId: reservation?.id });
    return { sessionId };
  }
  const sessionId = required(p, "sessionId");
  const session = await queryOne<Session>("SELECT id, table_id, status FROM play_sessions WHERE id=?", sessionId);
  if (!session || !["ACTIVE", "PAUSED"].includes(session.status)) throw new AppError("Phiên chơi đã kết thúc hoặc không tồn tại.");
  const segment = await queryOne<{ id: string }>("SELECT id FROM session_segments WHERE session_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1", sessionId);
  if (!segment) throw new AppError("Không tìm thấy đoạn tính giờ.");

  if (action === "session.pause") {
    if (session.status !== "ACTIVE") throw new AppError("Chỉ có thể tạm dừng phiên đang chạy.");
    const pauseId = id("pause");
    const results = await db.batch([
      db.prepare(`INSERT INTO session_pauses (id, session_id, segment_id, started_at, reason, created_by)
        SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM play_sessions WHERE id=? AND status='ACTIVE' AND table_id=?)
        AND EXISTS (SELECT 1 FROM session_segments WHERE id=? AND ended_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM session_pauses WHERE session_id=? AND ended_at IS NULL)`)
        .bind(pauseId, sessionId, segment.id, at, optional(p, "reason"), user.id, sessionId, session.table_id, segment.id, sessionId),
      db.prepare("UPDATE play_sessions SET status='PAUSED', updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM session_pauses WHERE id=?)").bind(at, sessionId, pauseId),
    ]);
    changed(results[0]);
  } else if (action === "session.resume") {
    if (session.status !== "PAUSED") throw new AppError("Phiên chơi không ở trạng thái tạm dừng.");
    const results = await db.batch([
      db.prepare(`UPDATE session_pauses SET ended_at=? WHERE session_id=? AND segment_id=? AND ended_at IS NULL
        AND EXISTS (SELECT 1 FROM play_sessions WHERE id=? AND status='PAUSED')`).bind(at, sessionId, segment.id, sessionId),
      db.prepare("UPDATE play_sessions SET status='ACTIVE', updated_at=? WHERE id=? AND changes()>0").bind(at, sessionId),
    ]);
    changed(results[0]);
  } else {
    const fingerprint = await queryOne<{ count: number; open: number }>("SELECT COUNT(*) AS count, COALESCE(SUM(ended_at IS NULL),0) AS open FROM session_pauses WHERE session_id=?", sessionId);
    // The state and pause counters detect pause/resume/transfer racing with the money calculation.
    const stable = `id=? AND status=? AND table_id=?
      AND EXISTS (SELECT 1 FROM session_segments WHERE id=? AND ended_at IS NULL)
      AND (SELECT COUNT(*) FROM session_pauses WHERE session_id=play_sessions.id)=?
      AND (SELECT COUNT(*) FROM session_pauses WHERE session_id=play_sessions.id AND ended_at IS NULL)=?`;
    const check = [sessionId, session.status, session.table_id, segment.id, fingerprint!.count, fingerprint!.open];
    if (action === "session.end") {
      const pending = await queryOne("SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.session_id=? AND oi.status IN ('PENDING','PREPARING') LIMIT 1", sessionId);
      if (pending && p.confirmPendingOrders !== true) throw new AppError("Còn món chưa hoàn thành. Xác nhận kết thúc phiên hoặc xử lý các món trước.", 409);
      const amount = await calculateSessionAmount(sessionId, new Date(at));
      const results = await db.batch([
        db.prepare(`UPDATE play_sessions SET status='CLOSED', ended_at=?, table_amount=?, closed_by=?, updated_at=? WHERE ${stable}
          AND (?=1 OR NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.session_id=play_sessions.id AND oi.status IN ('PENDING','PREPARING')))`)
          .bind(at, amount, user.id, at, ...check, p.confirmPendingOrders === true ? 1 : 0),
        db.prepare("UPDATE session_segments SET ended_at=? WHERE id=? AND changes()>0").bind(at, segment.id),
        db.prepare("UPDATE session_pauses SET ended_at=? WHERE session_id=? AND ended_at IS NULL AND EXISTS (SELECT 1 FROM session_segments WHERE id=? AND ended_at=?)").bind(at, sessionId, segment.id, at),
        db.prepare("UPDATE billiard_tables SET status='AVAILABLE', updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM play_sessions WHERE id=? AND status='CLOSED' AND ended_at=?)").bind(at, session.table_id, sessionId, at),
        db.prepare(`UPDATE orders SET status=CASE WHEN EXISTS (SELECT 1 FROM order_items WHERE order_id=orders.id AND status='SERVED') THEN 'COMPLETED' ELSE 'CANCELLED' END, updated_at=?
          WHERE session_id=? AND status='OPEN' AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id=orders.id AND status IN ('PENDING','PREPARING'))
          AND EXISTS (SELECT 1 FROM play_sessions WHERE id=? AND status='CLOSED')`).bind(at, sessionId, sessionId),
      ]);
      changed(results[0]);
      await audit(request, user.id, "SESSION_ENDED", "PLAY_SESSION", sessionId, "Kết thúc phiên chơi", { tableAmount: amount, pendingOrdersAcknowledged: p.confirmPendingOrders === true });
      return { tableAmount: amount, pendingOrders: Boolean(pending) };
    }
    if (action !== "session.transfer") throw new AppError("Thao tác phiên không hợp lệ.");
    const toTableId = required(p, "toTableId"), newSegment = id("seg");
    if (toTableId === session.table_id) throw new AppError("Bàn đích phải khác bàn hiện tại.");
    await activeRecord("billiard_tables", toTableId);
    const rate = await activeHourlyRate(toTableId, new Date(at));
    const newExists = "EXISTS (SELECT 1 FROM session_segments WHERE id=?)";
    const results = await db.batch([
      db.prepare(`UPDATE play_sessions SET table_id=?, updated_at=? WHERE ${stable}
        AND EXISTS (SELECT 1 FROM billiard_tables WHERE id=? AND active=1 AND status<>'MAINTENANCE')
        AND NOT EXISTS (SELECT 1 FROM play_sessions WHERE table_id=? AND status IN ('ACTIVE','PAUSED'))
        AND NOT EXISTS (SELECT 1 FROM reservations WHERE table_id=? AND status IN ('PENDING','CONFIRMED') AND julianday(starts_at)<=julianday(?) AND julianday(ends_at)>julianday(?))`)
        .bind(toTableId, at, ...check, toTableId, toTableId, toTableId, at, at),
      db.prepare("INSERT INTO session_segments (id, session_id, table_id, started_at, hourly_rate) SELECT ?,?,?,?,? WHERE changes()>0").bind(newSegment, sessionId, toTableId, at, rate),
      db.prepare(`UPDATE session_segments SET ended_at=? WHERE id=? AND ${newExists}`).bind(at, segment.id, newSegment),
      db.prepare(`UPDATE session_pauses SET ended_at=? WHERE session_id=? AND ended_at IS NULL AND ${newExists}`).bind(at, sessionId, newSegment),
      db.prepare(`INSERT INTO session_pauses (id, session_id, segment_id, started_at, reason, created_by) SELECT ?,?,?,?,'Tiếp tục tạm dừng sau chuyển bàn',? WHERE ?='PAUSED' AND ${newExists}`).bind(id("pause"), sessionId, newSegment, at, user.id, session.status, newSegment),
      db.prepare(`UPDATE billiard_tables SET status='AVAILABLE', updated_at=? WHERE id=? AND ${newExists}`).bind(at, session.table_id, newSegment),
      db.prepare(`UPDATE billiard_tables SET status='PLAYING', updated_at=? WHERE id=? AND ${newExists}`).bind(at, toTableId, newSegment),
      db.prepare(`INSERT INTO table_transfers (id, session_id, from_table_id, to_table_id, transferred_at, transferred_by, reason) SELECT ?,?,?,?,?,?,? WHERE ${newExists}`).bind(id("move"), sessionId, session.table_id, toTableId, at, user.id, optional(p, "reason"), newSegment),
    ]);
    changed(results[0], "Bàn đích không khả dụng hoặc phiên vừa thay đổi.");
    await audit(request, user.id, "SESSION_TRANSFERRED", "PLAY_SESSION", sessionId, "Chuyển bàn", { from: session.table_id, to: toTableId });
    return { sessionId };
  }
  await audit(request, user.id, action === "session.pause" ? "SESSION_PAUSED" : "SESSION_RESUMED", "PLAY_SESSION", sessionId, action, { reason: optional(p, "reason") });
  return { sessionId };
}
