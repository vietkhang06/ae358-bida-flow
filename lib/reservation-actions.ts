import { AppError, audit, code, getRawDb, id, nowIso, queryOne, type AppUser } from "@/lib/server";
import { activeRecord, changed, numeric, optional, required, text, timestamp, type Payload } from "@/lib/operation-validation";

export async function reservationAction(action: string, p: Payload, user: AppUser, request: Request) {
  const db = getRawDb(), at = nowIso();
  const reservationId = optional(p, "id") ?? id("res");
  const previous = p.id ? await queryOne<{ status: string }>("SELECT status FROM reservations WHERE id=?", reservationId) : null;
  if (p.id && !previous) throw new AppError("Không tìm thấy lịch đặt.", 404);
  if (previous && !["PENDING", "CONFIRMED"].includes(previous.status)) throw new AppError("Lịch đặt đã hoàn tất hoặc đã hủy, không thể sửa.");
  const status = text(p, "status") || previous?.status || "PENDING";
  if (action === "reservation.status") {
    if (!previous || !["CONFIRMED", "CANCELLED", "NO_SHOW"].includes(status)) throw new AppError("Chuyển trạng thái lịch đặt không hợp lệ.");
    // No reopening terminal bookings and no CONFIRMED -> PENDING rollback.
    changed(await db.prepare("UPDATE reservations SET status=?, updated_at=? WHERE id=? AND status=?").bind(status, at, reservationId, previous.status).run());
  } else {
    if (!["PENDING", "CONFIRMED"].includes(status) || (previous?.status === "CONFIRMED" && status === "PENDING")) throw new AppError("Trạng thái lịch đặt không hợp lệ.");
    const tableId = required(p, "tableId");
    const table = await activeRecord("billiard_tables", tableId);
    if (table.status === "MAINTENANCE") throw new AppError("Bàn đang bảo trì.");
    const customerId = optional(p, "customerId");
    if (customerId) await activeRecord("customers", customerId);
    const startsAt = timestamp(p, "startsAt")!, endsAt = timestamp(p, "endsAt")!;
    if (startsAt >= endsAt || endsAt <= at) throw new AppError("Thời gian đặt không hợp lệ hoặc đã kết thúc.");
    const guests = numeric(p, "guestCount", { fallback: 1, min: 1, integer: true });
    const guard = `NOT EXISTS (SELECT 1 FROM reservations WHERE id<>? AND table_id=? AND status IN ('PENDING','CONFIRMED')
      AND julianday(starts_at)<julianday(?) AND julianday(ends_at)>julianday(?))
      AND EXISTS (SELECT 1 FROM billiard_tables WHERE id=? AND active=1 AND status<>'MAINTENANCE')
      AND (? > ? OR NOT EXISTS (SELECT 1 FROM play_sessions WHERE table_id=? AND status IN ('ACTIVE','PAUSED')))`;
    const args = [customerId, required(p, "customerName"), required(p, "customerPhone"), tableId, startsAt, endsAt, guests, status, optional(p, "notes")];
    const check = [reservationId, tableId, endsAt, startsAt, tableId, startsAt, at, tableId];
    const result = previous
      ? await db.prepare(`UPDATE reservations SET customer_id=?, customer_name=?, customer_phone=?, table_id=?, starts_at=?, ends_at=?, guest_count=?, status=?, notes=?, updated_at=?
          WHERE id=? AND status=? AND ${guard}`).bind(...args, at, reservationId, previous.status, ...check).run()
      : await db.prepare(`INSERT INTO reservations (id, code, customer_id, customer_name, customer_phone, table_id, starts_at, ends_at, guest_count, status, notes, created_by)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(reservationId, code("DB"), ...args, user.id, ...check).run();
    changed(result, "Bàn đã có lịch đặt trùng khoảng thời gian này hoặc đang có phiên chơi.");
  }
  await audit(request, user.id, action === "reservation.status" ? "RESERVATION_STATUS_CHANGED" : "RESERVATION_SAVED", "RESERVATION", reservationId, `Lịch đặt: ${status}`, { from: previous?.status, to: status });
  return { reservationId };
}
