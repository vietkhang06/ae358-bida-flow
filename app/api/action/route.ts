import {
  AppError, activeHourlyRate, assertSameOrigin, audit, calculateSessionAmount, code, getRawDb,
  hashPassword, id, normalizeEmail, nowIso, queryAll, queryOne, randomToken, requireUser,
  responseError, sha256Hex, validatePassword, verifyPassword,
} from "@/lib/server";

type Body = { action: string; payload?: Record<string, unknown> };
const value = (data: Record<string, unknown>, key: string) => String(data[key] ?? "").trim();
const numberValue = (data: Record<string, unknown>, key: string) => Number(data[key] ?? 0);
const optional = (data: Record<string, unknown>, key: string) => value(data, key) || null;
const required = (data: Record<string, unknown>, key: string, label: string) => {
  const result = value(data, key);
  if (!result) throw new AppError(`${label} là bắt buộc.`);
  return result;
};
const hasPermission = (user: Awaited<ReturnType<typeof requireUser>>, permission: string) => user.roleCode === "ADMIN" || user.permissions.includes(permission);
const requireAny = (user: Awaited<ReturnType<typeof requireUser>>, permissions: string[]) => {
  if (!permissions.some((permission) => hasPermission(user, permission))) throw new AppError("Bạn không có quyền thực hiện thao tác này.", 403);
};

async function recalculateInvoice(invoiceId: string) {
  const items = await queryOne<{ amount: number }>("SELECT COALESCE(SUM(amount),0) AS amount FROM invoice_items WHERE invoice_id = ?", invoiceId);
  const adjustments = await queryOne<{ discount: number; surcharge: number }>(`SELECT
    COALESCE(SUM(CASE WHEN type IN ('DISCOUNT','MEMBER_BENEFIT') THEN amount ELSE 0 END),0) AS discount,
    COALESCE(SUM(CASE WHEN type='SURCHARGE' THEN amount ELSE 0 END),0) AS surcharge
    FROM invoice_adjustments WHERE invoice_id = ?`, invoiceId);
  const tableAmount = await queryOne<{ amount: number }>("SELECT COALESCE(SUM(amount),0) AS amount FROM invoice_items WHERE invoice_id = ? AND source_type = 'TABLE'", invoiceId);
  const serviceAmount = Math.max(0, Number(items?.amount ?? 0) - Number(tableAmount?.amount ?? 0));
  const total = Math.max(0, Number(items?.amount ?? 0) - Number(adjustments?.discount ?? 0) + Number(adjustments?.surcharge ?? 0));
  await getRawDb().prepare(`UPDATE invoices SET table_amount=?, service_amount=?, discount_amount=?, surcharge_amount=?, total_amount=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(Number(tableAmount?.amount ?? 0), serviceAmount, Number(adjustments?.discount ?? 0), Number(adjustments?.surcharge ?? 0), total, invoiceId).run();
  return total;
}

async function closeSegment(segmentId: string, sessionId: string, endAt: string) {
  await getRawDb().prepare("UPDATE session_pauses SET ended_at = ? WHERE segment_id = ? AND ended_at IS NULL").bind(endAt, segmentId).run();
  await getRawDb().prepare("UPDATE session_segments SET ended_at = ? WHERE id = ? AND ended_at IS NULL").bind(endAt, segmentId).run();
  const amount = await calculateSessionAmount(sessionId, new Date(endAt));
  return amount;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const body = await request.json() as Body;
    const payload = body.payload ?? {};
    const db = getRawDb();
    let result: unknown = null;

    switch (body.action) {
      case "profile.update": {
        requireAny(user, ["PROFILE_MANAGE"]);
        const fullName = required(payload, "fullName", "Họ tên");
        const phone = optional(payload, "phone");
        await db.prepare("UPDATE users SET full_name=?, phone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(fullName, phone, user.id).run();
        await audit(request, user.id, "PROFILE_UPDATED", "USER", user.id, "Cập nhật hồ sơ cá nhân");
        break;
      }
      case "password.change": {
        requireAny(user, ["PROFILE_MANAGE"]);
        const currentPassword = required(payload, "currentPassword", "Mật khẩu hiện tại");
        const newPassword = required(payload, "newPassword", "Mật khẩu mới");
        if (!validatePassword(newPassword)) throw new AppError("Mật khẩu mới cần ít nhất 10 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.");
        const account = await queryOne<{ password_hash: string; password_salt: string }>("SELECT password_hash, password_salt FROM users WHERE id=?", user.id);
        if (!account || !(await verifyPassword(currentPassword, account.password_salt, account.password_hash))) throw new AppError("Mật khẩu hiện tại không đúng.");
        const hashed = await hashPassword(newPassword);
        await db.prepare("UPDATE users SET password_hash=?, password_salt=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(hashed.hash, hashed.salt, user.id).run();
        await audit(request, user.id, "PASSWORD_CHANGED", "USER", user.id, "Đổi mật khẩu");
        break;
      }
      case "user.invite": {
        requireAny(user, ["USERS_MANAGE"]);
        const roleId = required(payload, "roleId", "Vai trò");
        if (!await queryOne("SELECT id FROM roles WHERE id=?", roleId)) throw new AppError("Vai trò không hợp lệ.");
        const rawCode = randomToken(12);
        const invitationId = id("inv");
        const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
        await db.prepare("INSERT INTO invitations (id, code_hash, email, role_id, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(invitationId, await sha256Hex(rawCode), optional(payload, "email") ? normalizeEmail(value(payload, "email")) : null, roleId, expiresAt, user.id).run();
        await audit(request, user.id, "INVITATION_CREATED", "INVITATION", invitationId, "Tạo mã mời nhân viên", { roleId });
        result = { invitationCode: rawCode, expiresAt };
        break;
      }
      case "user.update": {
        requireAny(user, ["USERS_MANAGE"]);
        const targetId = required(payload, "id", "Tài khoản");
        if (targetId === user.id && value(payload, "status") === "LOCKED") throw new AppError("Bạn không thể tự khóa tài khoản của mình.");
        const roleId = required(payload, "roleId", "Vai trò");
        const status = value(payload, "status") === "LOCKED" ? "LOCKED" : "ACTIVE";
        await db.prepare("UPDATE users SET full_name=?, phone=?, role_id=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(required(payload, "fullName", "Họ tên"), optional(payload, "phone"), roleId, status, targetId).run();
        if (status === "LOCKED") await db.prepare("DELETE FROM user_sessions WHERE user_id=?").bind(targetId).run();
        await audit(request, user.id, "USER_UPDATED", "USER", targetId, "Cập nhật tài khoản nhân viên", { roleId, status });
        break;
      }
      case "role.permissions": {
        requireAny(user, ["ROLES_MANAGE"]);
        const roleId = required(payload, "roleId", "Vai trò");
        if (roleId === "role_admin") throw new AppError("Không thể giảm quyền của vai trò quản trị hệ thống.");
        const permissionCodes = Array.isArray(payload.permissionCodes) ? payload.permissionCodes.map(String) : [];
        const permissions = permissionCodes.length ? await queryAll<{ id: string }>(`SELECT id FROM permissions WHERE code IN (${permissionCodes.map(() => "?").join(",")})`, ...permissionCodes) : [];
        const statements = [db.prepare("DELETE FROM role_permissions WHERE role_id=?").bind(roleId), ...permissions.map((item) => db.prepare("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)").bind(roleId, item.id))];
        await db.batch(statements);
        await audit(request, user.id, "ROLE_PERMISSIONS_UPDATED", "ROLE", roleId, "Cập nhật quyền vai trò", { permissionCodes });
        break;
      }
      case "area.save": {
        requireAny(user, ["TABLES_MANAGE"]);
        const areaId = optional(payload, "id") ?? id("area");
        const areaCode = required(payload, "code", "Mã khu vực").toUpperCase();
        const name = required(payload, "name", "Tên khu vực");
        if (payload.id) await db.prepare("UPDATE areas SET code=?, name=?, description=?, sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(areaCode, name, optional(payload, "description"), numberValue(payload, "sortOrder"), areaId).run();
        else await db.prepare("INSERT INTO areas (id, code, name, description, sort_order) VALUES (?, ?, ?, ?, ?)").bind(areaId, areaCode, name, optional(payload, "description"), numberValue(payload, "sortOrder")).run();
        await audit(request, user.id, "AREA_SAVED", "AREA", areaId, `Lưu khu vực ${name}`);
        break;
      }
      case "area.delete": {
        requireAny(user, ["TABLES_MANAGE"]);
        const areaId = required(payload, "id", "Khu vực");
        if (await queryOne("SELECT id FROM billiard_tables WHERE area_id=? AND active=1 LIMIT 1", areaId)) throw new AppError("Không thể xóa khu vực đang chứa bàn hoạt động.");
        await db.prepare("UPDATE areas SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(areaId).run();
        await audit(request, user.id, "AREA_DELETED", "AREA", areaId, "Ngừng sử dụng khu vực");
        break;
      }
      case "tableType.save": {
        requireAny(user, ["PRICES_MANAGE"]);
        const typeId = optional(payload, "id") ?? id("type");
        const rate = numberValue(payload, "baseHourlyRate");
        if (rate < 0) throw new AppError("Đơn giá không được âm.");
        const typeCode = required(payload, "code", "Mã loại bàn").toUpperCase();
        const name = required(payload, "name", "Tên loại bàn");
        if (payload.id) await db.prepare("UPDATE table_types SET code=?, name=?, description=?, base_hourly_rate=?, color=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(typeCode, name, optional(payload, "description"), rate, value(payload, "color") || "#16a085", typeId).run();
        else await db.prepare("INSERT INTO table_types (id, code, name, description, base_hourly_rate, color) VALUES (?, ?, ?, ?, ?, ?)").bind(typeId, typeCode, name, optional(payload, "description"), rate, value(payload, "color") || "#16a085").run();
        await audit(request, user.id, "TABLE_TYPE_SAVED", "TABLE_TYPE", typeId, `Lưu loại bàn ${name}`);
        break;
      }
      case "tableType.delete": {
        requireAny(user, ["PRICES_MANAGE"]);
        const typeId = required(payload, "id", "Loại bàn");
        if (await queryOne("SELECT id FROM billiard_tables WHERE table_type_id=? AND active=1 LIMIT 1", typeId)) throw new AppError("Loại bàn đang được sử dụng.");
        await db.prepare("UPDATE table_types SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(typeId).run();
        await audit(request, user.id, "TABLE_TYPE_DELETED", "TABLE_TYPE", typeId, "Ngừng sử dụng loại bàn");
        break;
      }
      case "table.save": {
        requireAny(user, ["TABLES_MANAGE"]);
        const tableId = optional(payload, "id") ?? id("tbl");
        const tableCode = required(payload, "code", "Mã bàn").toUpperCase();
        const name = required(payload, "name", "Tên bàn");
        const areaId = required(payload, "areaId", "Khu vực");
        const tableTypeId = required(payload, "tableTypeId", "Loại bàn");
        if (payload.id) await db.prepare("UPDATE billiard_tables SET code=?, name=?, area_id=?, table_type_id=?, notes=?, sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(tableCode, name, areaId, tableTypeId, optional(payload, "notes"), numberValue(payload, "sortOrder"), tableId).run();
        else await db.prepare("INSERT INTO billiard_tables (id, code, name, area_id, table_type_id, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(tableId, tableCode, name, areaId, tableTypeId, optional(payload, "notes"), numberValue(payload, "sortOrder")).run();
        await audit(request, user.id, "TABLE_SAVED", "BILLIARD_TABLE", tableId, `Lưu bàn ${name}`);
        break;
      }
      case "table.delete": {
        requireAny(user, ["TABLES_MANAGE"]);
        const tableId = required(payload, "id", "Bàn");
        if (await queryOne("SELECT id FROM play_sessions WHERE table_id=? AND status IN ('ACTIVE','PAUSED')", tableId)) throw new AppError("Không thể xóa bàn đang có phiên chơi.");
        if (await queryOne(`SELECT i.id FROM invoices i JOIN play_sessions ps ON ps.id=i.session_id WHERE ps.table_id=? AND i.status IN ('DRAFT','ISSUED') LIMIT 1`, tableId)) throw new AppError("Bàn còn hóa đơn chưa hoàn tất.");
        await db.prepare("UPDATE billiard_tables SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(tableId).run();
        await audit(request, user.id, "TABLE_DELETED", "BILLIARD_TABLE", tableId, "Ngừng sử dụng bàn");
        break;
      }
      case "table.status": {
        requireAny(user, ["TABLE_STATUS"]);
        const tableId = required(payload, "id", "Bàn");
        const status = required(payload, "status", "Trạng thái");
        if (!new Set(["AVAILABLE", "RESERVED", "MAINTENANCE"]).has(status)) throw new AppError("Trạng thái bàn không hợp lệ.");
        if (await queryOne("SELECT id FROM play_sessions WHERE table_id=? AND status IN ('ACTIVE','PAUSED')", tableId)) throw new AppError("Không thể đổi thủ công trạng thái của bàn đang chơi.");
        await db.prepare("UPDATE billiard_tables SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, tableId).run();
        await audit(request, user.id, "TABLE_STATUS_CHANGED", "BILLIARD_TABLE", tableId, `Cập nhật trạng thái bàn thành ${status}`);
        break;
      }
      case "price.save": {
        requireAny(user, ["PRICES_MANAGE"]);
        const ruleId = optional(payload, "id") ?? id("price");
        const tableTypeId = required(payload, "tableTypeId", "Loại bàn");
        const daysMask = numberValue(payload, "daysMask") || 127;
        const startMinute = numberValue(payload, "startMinute");
        const endMinute = numberValue(payload, "endMinute") || 1440;
        const priority = numberValue(payload, "priority");
        const hourlyRate = numberValue(payload, "hourlyRate");
        if (hourlyRate < 0 || startMinute < 0 || endMinute > 1440 || startMinute >= endMinute) throw new AppError("Khung giờ hoặc đơn giá không hợp lệ.");
        const overlap = await queryOne("SELECT id FROM price_rules WHERE table_type_id=? AND active=1 AND id<>? AND priority=? AND (days_mask & ?)<>0 AND start_minute < ? AND end_minute > ?", tableTypeId, ruleId, priority, daysMask, endMinute, startMinute);
        if (overlap) throw new AppError("Khung giá bị chồng lấn với quy tắc cùng độ ưu tiên.");
        const params = [tableTypeId, required(payload, "name", "Tên bảng giá"), daysMask, startMinute, endMinute, hourlyRate, priority, optional(payload, "effectiveFrom"), optional(payload, "effectiveTo")];
        if (payload.id) await db.prepare("UPDATE price_rules SET table_type_id=?, name=?, days_mask=?, start_minute=?, end_minute=?, hourly_rate=?, priority=?, effective_from=?, effective_to=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(...params, ruleId).run();
        else await db.prepare("INSERT INTO price_rules (id, table_type_id, name, days_mask, start_minute, end_minute, hourly_rate, priority, effective_from, effective_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(ruleId, ...params).run();
        await audit(request, user.id, "PRICE_RULE_SAVED", "PRICE_RULE", ruleId, "Lưu quy tắc bảng giá");
        break;
      }
      case "price.delete": {
        requireAny(user, ["PRICES_MANAGE"]);
        const ruleId = required(payload, "id", "Bảng giá");
        await db.prepare("UPDATE price_rules SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(ruleId).run();
        await audit(request, user.id, "PRICE_RULE_DELETED", "PRICE_RULE", ruleId, "Ngừng áp dụng bảng giá");
        break;
      }
      case "reservation.save": {
        requireAny(user, ["RESERVATIONS_MANAGE"]);
        const reservationId = optional(payload, "id") ?? id("res");
        const tableId = required(payload, "tableId", "Bàn");
        const startsAt = required(payload, "startsAt", "Thời gian bắt đầu");
        const endsAt = required(payload, "endsAt", "Thời gian kết thúc");
        if (new Date(startsAt) >= new Date(endsAt)) throw new AppError("Thời gian kết thúc phải sau thời gian bắt đầu.");
        const conflict = await queryOne(`SELECT id FROM reservations WHERE table_id=? AND id<>? AND status IN ('PENDING','CONFIRMED') AND starts_at < ? AND ends_at > ?`, tableId, reservationId, endsAt, startsAt);
        if (conflict) throw new AppError("Bàn đã có lịch đặt trùng khoảng thời gian này.");
        const args = [optional(payload, "customerId"), required(payload, "customerName", "Tên khách"), required(payload, "customerPhone", "Số điện thoại"), tableId, startsAt, endsAt, Math.max(1, numberValue(payload, "guestCount")), value(payload, "status") || "PENDING", optional(payload, "notes")];
        if (payload.id) await db.prepare("UPDATE reservations SET customer_id=?, customer_name=?, customer_phone=?, table_id=?, starts_at=?, ends_at=?, guest_count=?, status=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(...args, reservationId).run();
        else await db.prepare("INSERT INTO reservations (id, code, customer_id, customer_name, customer_phone, table_id, starts_at, ends_at, guest_count, status, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(reservationId, code("DB"), ...args, user.id).run();
        await audit(request, user.id, "RESERVATION_SAVED", "RESERVATION", reservationId, "Lưu lịch đặt bàn");
        break;
      }
      case "reservation.status": {
        requireAny(user, ["RESERVATIONS_MANAGE"]);
        const reservationId = required(payload, "id", "Lịch đặt");
        const status = required(payload, "status", "Trạng thái");
        if (!new Set(["PENDING", "CONFIRMED", "CANCELLED", "NO_SHOW"]).has(status)) throw new AppError("Trạng thái lịch đặt không hợp lệ.");
        await db.prepare("UPDATE reservations SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'SEATED'").bind(status, reservationId).run();
        await audit(request, user.id, "RESERVATION_STATUS_CHANGED", "RESERVATION", reservationId, `Cập nhật lịch đặt thành ${status}`);
        break;
      }
      case "session.start":
      case "reservation.seat": {
        requireAny(user, ["SESSIONS_MANAGE"]);
        const reservation = body.action === "reservation.seat" ? await queryOne<{ id: string; table_id: string; customer_id: string | null; status: string }>("SELECT id, table_id, customer_id, status FROM reservations WHERE id=?", required(payload, "reservationId", "Lịch đặt")) : null;
        if (reservation && !["PENDING", "CONFIRMED"].includes(reservation.status)) throw new AppError("Lịch đặt không còn hiệu lực.");
        const tableId = reservation?.table_id ?? required(payload, "tableId", "Bàn");
        const table = await queryOne<{ status: string }>("SELECT status FROM billiard_tables WHERE id=? AND active=1", tableId);
        if (!table || !["AVAILABLE", "RESERVED"].includes(table.status)) throw new AppError("Bàn không sẵn sàng để mở phiên.");
        const startedAt = nowIso();
        const sessionId = id("play");
        const segmentId = id("seg");
        const rate = await activeHourlyRate(tableId, new Date(startedAt));
        const statements = [
          db.prepare("INSERT INTO play_sessions (id, code, table_id, customer_id, reservation_id, started_at, opened_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(sessionId, code("PS"), tableId, reservation?.customer_id ?? optional(payload, "customerId"), reservation?.id ?? null, startedAt, user.id, optional(payload, "notes")),
          db.prepare("INSERT INTO session_segments (id, session_id, table_id, started_at, hourly_rate) VALUES (?, ?, ?, ?, ?)").bind(segmentId, sessionId, tableId, startedAt, rate),
          db.prepare("UPDATE billiard_tables SET status='PLAYING', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(tableId),
        ];
        if (reservation) statements.push(db.prepare("UPDATE reservations SET status='SEATED', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(reservation.id));
        await db.batch(statements);
        await audit(request, user.id, "SESSION_STARTED", "PLAY_SESSION", sessionId, "Mở bàn và bắt đầu phiên chơi", { tableId, rate });
        result = { sessionId };
        break;
      }
      case "session.pause": {
        requireAny(user, ["SESSIONS_MANAGE"]);
        const sessionId = required(payload, "sessionId", "Phiên chơi");
        const session = await queryOne<{ status: string }>("SELECT status FROM play_sessions WHERE id=?", sessionId);
        if (!session || session.status !== "ACTIVE") throw new AppError("Chỉ có thể tạm dừng phiên đang chạy.");
        const segment = await queryOne<{ id: string }>("SELECT id FROM session_segments WHERE session_id=? AND ended_at IS NULL ORDER BY started_at DESC", sessionId);
        if (!segment) throw new AppError("Không tìm thấy đoạn tính giờ đang hoạt động.");
        await db.batch([
          db.prepare("INSERT INTO session_pauses (id, session_id, segment_id, started_at, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)").bind(id("pause"), sessionId, segment.id, nowIso(), optional(payload, "reason"), user.id),
          db.prepare("UPDATE play_sessions SET status='PAUSED', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(sessionId),
        ]);
        await audit(request, user.id, "SESSION_PAUSED", "PLAY_SESSION", sessionId, "Tạm dừng phiên chơi", { reason: optional(payload, "reason") });
        break;
      }
      case "session.resume": {
        requireAny(user, ["SESSIONS_MANAGE"]);
        const sessionId = required(payload, "sessionId", "Phiên chơi");
        const session = await queryOne<{ status: string }>("SELECT status FROM play_sessions WHERE id=?", sessionId);
        if (!session || session.status !== "PAUSED") throw new AppError("Phiên chơi không ở trạng thái tạm dừng.");
        await db.batch([
          db.prepare("UPDATE session_pauses SET ended_at=? WHERE session_id=? AND ended_at IS NULL").bind(nowIso(), sessionId),
          db.prepare("UPDATE play_sessions SET status='ACTIVE', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(sessionId),
        ]);
        await audit(request, user.id, "SESSION_RESUMED", "PLAY_SESSION", sessionId, "Tiếp tục phiên chơi");
        break;
      }
      case "session.transfer": {
        requireAny(user, ["SESSIONS_MANAGE"]);
        const sessionId = required(payload, "sessionId", "Phiên chơi");
        const toTableId = required(payload, "toTableId", "Bàn đích");
        const session = await queryOne<{ table_id: string; status: string }>("SELECT table_id, status FROM play_sessions WHERE id=?", sessionId);
        if (!session || !["ACTIVE", "PAUSED"].includes(session.status)) throw new AppError("Phiên chơi không thể chuyển bàn.");
        const destination = await queryOne<{ status: string }>("SELECT status FROM billiard_tables WHERE id=? AND active=1", toTableId);
        if (!destination || destination.status !== "AVAILABLE") throw new AppError("Bàn đích không khả dụng.");
        const segment = await queryOne<{ id: string }>("SELECT id FROM session_segments WHERE session_id=? AND ended_at IS NULL ORDER BY started_at DESC", sessionId);
        if (!segment) throw new AppError("Không tìm thấy đoạn tính giờ.");
        const transferredAt = nowIso();
        await closeSegment(segment.id, sessionId, transferredAt);
        const rate = await activeHourlyRate(toTableId, new Date(transferredAt));
        await db.batch([
          db.prepare("UPDATE billiard_tables SET status='AVAILABLE', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(session.table_id),
          db.prepare("UPDATE billiard_tables SET status='PLAYING', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(toTableId),
          db.prepare("UPDATE play_sessions SET table_id=?, status='ACTIVE', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(toTableId, sessionId),
          db.prepare("INSERT INTO session_segments (id, session_id, table_id, started_at, hourly_rate) VALUES (?, ?, ?, ?, ?)").bind(id("seg"), sessionId, toTableId, transferredAt, rate),
          db.prepare("INSERT INTO table_transfers (id, session_id, from_table_id, to_table_id, transferred_at, transferred_by, reason) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id("move"), sessionId, session.table_id, toTableId, transferredAt, user.id, optional(payload, "reason")),
        ]);
        await audit(request, user.id, "SESSION_TRANSFERRED", "PLAY_SESSION", sessionId, "Chuyển bàn", { from: session.table_id, to: toTableId });
        break;
      }
      case "session.end": {
        requireAny(user, ["SESSIONS_MANAGE"]);
        const sessionId = required(payload, "sessionId", "Phiên chơi");
        const session = await queryOne<{ table_id: string; status: string }>("SELECT table_id, status FROM play_sessions WHERE id=?", sessionId);
        if (!session || !["ACTIVE", "PAUSED"].includes(session.status)) throw new AppError("Phiên chơi đã kết thúc hoặc không tồn tại.");
        const segment = await queryOne<{ id: string }>("SELECT id FROM session_segments WHERE session_id=? AND ended_at IS NULL ORDER BY started_at DESC", sessionId);
        if (!segment) throw new AppError("Không tìm thấy đoạn tính giờ.");
        const endedAt = nowIso();
        await closeSegment(segment.id, sessionId, endedAt);
        const amount = await calculateSessionAmount(sessionId, new Date(endedAt));
        await db.batch([
          db.prepare("UPDATE play_sessions SET status='CLOSED', ended_at=?, table_amount=?, closed_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(endedAt, amount, user.id, sessionId),
          db.prepare("UPDATE billiard_tables SET status='AVAILABLE', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(session.table_id),
          db.prepare("UPDATE orders SET status='COMPLETED', updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND status='OPEN'").bind(sessionId),
        ]);
        await audit(request, user.id, "SESSION_ENDED", "PLAY_SESSION", sessionId, "Kết thúc phiên chơi", { tableAmount: amount });
        result = { tableAmount: amount };
        break;
      }
      case "category.save": {
        requireAny(user, ["PRODUCTS_MANAGE"]);
        const categoryId = optional(payload, "id") ?? id("cat");
        const categoryCode = required(payload, "code", "Mã nhóm").toUpperCase();
        const name = required(payload, "name", "Tên nhóm");
        if (payload.id) await db.prepare("UPDATE product_categories SET code=?, name=?, sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(categoryCode, name, numberValue(payload, "sortOrder"), categoryId).run();
        else await db.prepare("INSERT INTO product_categories (id, code, name, sort_order) VALUES (?, ?, ?, ?)").bind(categoryId, categoryCode, name, numberValue(payload, "sortOrder")).run();
        await audit(request, user.id, "PRODUCT_CATEGORY_SAVED", "PRODUCT_CATEGORY", categoryId, `Lưu nhóm ${name}`);
        break;
      }
      case "product.save": {
        requireAny(user, ["PRODUCTS_MANAGE"]);
        const productId = optional(payload, "id") ?? id("prd");
        const productCode = required(payload, "code", "Mã sản phẩm").toUpperCase();
        const name = required(payload, "name", "Tên sản phẩm");
        const salePrice = numberValue(payload, "salePrice");
        const costPrice = numberValue(payload, "costPrice");
        const minStock = numberValue(payload, "minStock");
        if (salePrice < 0 || costPrice < 0 || minStock < 0) throw new AppError("Giá và tồn tối thiểu không được âm.");
        const args = [productCode, name, optional(payload, "categoryId"), value(payload, "kind") === "SERVICE" ? "SERVICE" : "PRODUCT", value(payload, "unit") || "phần", salePrice, costPrice, minStock, payload.trackStock === false ? 0 : 1];
        if (payload.id) await db.prepare("UPDATE products SET code=?, name=?, category_id=?, kind=?, unit=?, sale_price=?, cost_price=?, min_stock=?, track_stock=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(...args, productId).run();
        else await db.prepare("INSERT INTO products (id, code, name, category_id, kind, unit, sale_price, cost_price, min_stock, track_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(productId, ...args).run();
        await audit(request, user.id, "PRODUCT_SAVED", "PRODUCT", productId, `Lưu sản phẩm/dịch vụ ${name}`);
        break;
      }
      case "product.delete": {
        requireAny(user, ["PRODUCTS_MANAGE"]);
        const productId = required(payload, "id", "Sản phẩm");
        await db.prepare("UPDATE products SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(productId).run();
        await audit(request, user.id, "PRODUCT_DELETED", "PRODUCT", productId, "Ngừng kinh doanh sản phẩm/dịch vụ");
        break;
      }
      case "order.add": {
        requireAny(user, ["ORDERS_MANAGE"]);
        const sessionId = required(payload, "sessionId", "Phiên chơi");
        const productId = required(payload, "productId", "Sản phẩm");
        const quantity = numberValue(payload, "quantity");
        if (quantity <= 0) throw new AppError("Số lượng phải lớn hơn 0.");
        const session = await queryOne("SELECT id FROM play_sessions WHERE id=? AND status IN ('ACTIVE','PAUSED')", sessionId);
        if (!session) throw new AppError("Chỉ có thể tạo order cho phiên đang hoạt động.");
        const product = await queryOne<{ name: string; sale_price: number; stock_quantity: number; track_stock: number }>("SELECT name, sale_price, stock_quantity, track_stock FROM products WHERE id=? AND active=1", productId);
        if (!product) throw new AppError("Sản phẩm không khả dụng.");
        if (product.track_stock && product.stock_quantity < quantity) throw new AppError("Tồn kho không đủ.");
        let order = await queryOne<{ id: string }>("SELECT id FROM orders WHERE session_id=? AND status='OPEN'", sessionId);
        if (!order) {
          order = { id: id("ord") };
          await db.prepare("INSERT INTO orders (id, code, session_id, created_by) VALUES (?, ?, ?, ?)").bind(order.id, code("OD"), sessionId, user.id).run();
        }
        const itemId = id("item");
        await db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, notes) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(itemId, order.id, productId, product.name, quantity, product.sale_price, optional(payload, "notes")).run();
        await audit(request, user.id, "ORDER_ITEM_ADDED", "ORDER", order.id, `Thêm ${quantity} ${product.name} vào order`, { itemId });
        break;
      }
      case "order.item.update": {
        requireAny(user, ["ORDERS_MANAGE"]);
        const itemId = required(payload, "itemId", "Món");
        const item = await queryOne<{ status: string }>("SELECT status FROM order_items WHERE id=?", itemId);
        if (!item || ["SERVED", "CANCELLED"].includes(item.status)) throw new AppError("Món đã phục vụ/hủy không thể sửa số lượng.");
        const quantity = numberValue(payload, "quantity");
        if (quantity <= 0) throw new AppError("Số lượng phải lớn hơn 0.");
        await db.prepare("UPDATE order_items SET quantity=?, notes=? WHERE id=?").bind(quantity, optional(payload, "notes"), itemId).run();
        await audit(request, user.id, "ORDER_ITEM_UPDATED", "ORDER_ITEM", itemId, "Cập nhật món trong order");
        break;
      }
      case "order.item.status": {
        requireAny(user, ["ORDERS_MANAGE"]);
        const itemId = required(payload, "itemId", "Món");
        const status = required(payload, "status", "Trạng thái");
        if (!new Set(["PENDING", "PREPARING", "SERVED", "CANCELLED"]).has(status)) throw new AppError("Trạng thái món không hợp lệ.");
        const item = await queryOne<{ status: string; product_id: string; quantity: number; product_name: string }>("SELECT status, product_id, quantity, product_name FROM order_items WHERE id=?", itemId);
        if (!item) throw new AppError("Không tìm thấy món.");
        if (item.status === "SERVED" && status !== "SERVED") throw new AppError("Món đã phục vụ không thể quay lại trạng thái trước.");
        if (status === "SERVED" && item.status !== "SERVED") {
          const product = await queryOne<{ stock_quantity: number; track_stock: number }>("SELECT stock_quantity, track_stock FROM products WHERE id=?", item.product_id);
          if (product?.track_stock && product.stock_quantity < item.quantity) throw new AppError("Tồn kho không đủ để hoàn tất món.");
          if (product?.track_stock) {
            const after = product.stock_quantity - item.quantity;
            await db.batch([
              db.prepare("UPDATE products SET stock_quantity=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(after, item.product_id),
              db.prepare("INSERT INTO inventory_transactions (id, code, product_id, type, quantity, before_quantity, after_quantity, reference_type, reference_id, reason, created_by) VALUES (?, ?, ?, 'SALE', ?, ?, ?, 'ORDER_ITEM', ?, ?, ?)")
                .bind(id("stock"), code("XK"), item.product_id, item.quantity, product.stock_quantity, after, itemId, `Phục vụ ${item.product_name}`, user.id),
            ]);
          }
        }
        await db.prepare("UPDATE order_items SET status=? WHERE id=?").bind(status, itemId).run();
        await audit(request, user.id, "ORDER_ITEM_STATUS_CHANGED", "ORDER_ITEM", itemId, `Cập nhật món thành ${status}`);
        break;
      }
      case "customer.save": {
        requireAny(user, ["CUSTOMERS_MANAGE"]);
        const customerId = optional(payload, "id") ?? id("cus");
        const name = required(payload, "fullName", "Tên khách hàng");
        const args = [name, optional(payload, "phone"), optional(payload, "email") ? normalizeEmail(value(payload, "email")) : null, optional(payload, "dateOfBirth"), optional(payload, "notes")];
        if (payload.id) await db.prepare("UPDATE customers SET full_name=?, phone=?, email=?, date_of_birth=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(...args, customerId).run();
        else await db.prepare("INSERT INTO customers (id, code, full_name, phone, email, date_of_birth, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(customerId, code("KH"), ...args).run();
        await audit(request, user.id, "CUSTOMER_SAVED", "CUSTOMER", customerId, `Lưu khách hàng ${name}`);
        break;
      }
      case "tier.save": {
        requireAny(user, ["MEMBERSHIPS_MANAGE"]);
        const tierId = optional(payload, "id") ?? id("tier");
        const discount = numberValue(payload, "discountPercent");
        if (discount < 0 || discount > 100) throw new AppError("Mức giảm giá phải từ 0 đến 100%.");
        const args = [required(payload, "code", "Mã hạng").toUpperCase(), required(payload, "name", "Tên hạng"), numberValue(payload, "minPoints"), discount];
        if (payload.id) await db.prepare("UPDATE membership_tiers SET code=?, name=?, min_points=?, discount_percent=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(...args, tierId).run();
        else await db.prepare("INSERT INTO membership_tiers (id, code, name, min_points, discount_percent) VALUES (?, ?, ?, ?, ?)").bind(tierId, ...args).run();
        await audit(request, user.id, "MEMBERSHIP_TIER_SAVED", "MEMBERSHIP_TIER", tierId, "Lưu hạng hội viên");
        break;
      }
      case "membership.save": {
        requireAny(user, ["MEMBERSHIPS_MANAGE"]);
        const customerId = required(payload, "customerId", "Khách hàng");
        const tierId = required(payload, "tierId", "Hạng hội viên");
        const existing = await queryOne<{ id: string }>("SELECT id FROM memberships WHERE customer_id=?", customerId);
        if (existing) await db.prepare("UPDATE memberships SET tier_id=?, active=1, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(tierId, existing.id).run();
        else await db.prepare("INSERT INTO memberships (id, customer_id, tier_id) VALUES (?, ?, ?)").bind(id("member"), customerId, tierId).run();
        await audit(request, user.id, "MEMBERSHIP_UPDATED", "CUSTOMER", customerId, "Cập nhật hội viên");
        break;
      }
      case "invoice.create": {
        requireAny(user, ["INVOICES_MANAGE"]);
        const sessionId = required(payload, "sessionId", "Phiên chơi");
        const session = await queryOne<{ id: string; status: string; table_amount: number; customer_id: string | null; code: string }>("SELECT id, status, table_amount, customer_id, code FROM play_sessions WHERE id=?", sessionId);
        if (!session || session.status !== "CLOSED") throw new AppError("Cần kết thúc phiên chơi trước khi lập hóa đơn.");
        if (await queryOne("SELECT id FROM invoices WHERE session_id=? AND status<>'CANCELLED'", sessionId)) throw new AppError("Phiên chơi đã có hóa đơn.");
        const invoiceId = id("bill");
        const items = await queryAll<{ id: string; product_id: string; product_name: string; quantity: number; unit_price: number; kind: string }>(`
          SELECT oi.id, oi.product_id, oi.product_name, oi.quantity, oi.unit_price, p.kind FROM order_items oi
          JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id
          WHERE o.session_id=? AND oi.status<>'CANCELLED'`, sessionId);
        const statements = [
          db.prepare("INSERT INTO invoices (id, code, session_id, customer_id, status, issued_at, created_by) VALUES (?, ?, ?, ?, 'ISSUED', ?, ?)").bind(invoiceId, code("HD"), sessionId, session.customer_id, nowIso(), user.id),
          db.prepare("INSERT INTO invoice_items (id, invoice_id, source_type, source_id, description, quantity, unit_price, amount) VALUES (?, ?, 'TABLE', ?, ?, 1, ?, ?)").bind(id("line"), invoiceId, sessionId, `Tiền bàn - ${session.code}`, session.table_amount, session.table_amount),
          ...items.map((item) => db.prepare("INSERT INTO invoice_items (id, invoice_id, source_type, source_id, description, quantity, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(id("line"), invoiceId, item.kind, item.id, item.product_name, item.quantity, item.unit_price, Math.round(item.quantity * item.unit_price))),
        ];
        await db.batch(statements);
        if (session.customer_id) {
          const member = await queryOne<{ discount_percent: number; tier_name: string }>(`SELECT mt.discount_percent, mt.name AS tier_name FROM memberships m JOIN membership_tiers mt ON mt.id=m.tier_id WHERE m.customer_id=? AND m.active=1`, session.customer_id);
          if (member && member.discount_percent > 0) {
            const subtotal = session.table_amount + items.reduce((sum, item) => sum + Math.round(item.quantity * item.unit_price), 0);
            await db.prepare("INSERT INTO invoice_adjustments (id, invoice_id, type, description, amount, approved_by) VALUES (?, ?, 'MEMBER_BENEFIT', ?, ?, ?)")
              .bind(id("adj"), invoiceId, `Ưu đãi hội viên ${member.tier_name} (${member.discount_percent}%)`, Math.round(subtotal * member.discount_percent / 100), user.id).run();
          }
        }
        const total = await recalculateInvoice(invoiceId);
        await audit(request, user.id, "INVOICE_CREATED", "INVOICE", invoiceId, "Tạo hóa đơn", { sessionId, total });
        result = { invoiceId, total };
        break;
      }
      case "invoice.adjust": {
        requireAny(user, ["INVOICES_MANAGE"]);
        const invoiceId = required(payload, "invoiceId", "Hóa đơn");
        const invoice = await queryOne<{ status: string }>("SELECT status FROM invoices WHERE id=?", invoiceId);
        if (!invoice || invoice.status !== "ISSUED") throw new AppError("Chỉ có thể điều chỉnh hóa đơn đang chờ thanh toán.");
        const type = value(payload, "type") === "SURCHARGE" ? "SURCHARGE" : "DISCOUNT";
        const amount = numberValue(payload, "amount");
        if (amount <= 0) throw new AppError("Số tiền điều chỉnh phải lớn hơn 0.");
        await db.prepare("INSERT INTO invoice_adjustments (id, invoice_id, type, description, amount, approved_by) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(id("adj"), invoiceId, type, required(payload, "description", "Lý do"), amount, user.id).run();
        const total = await recalculateInvoice(invoiceId);
        await audit(request, user.id, "INVOICE_ADJUSTED", "INVOICE", invoiceId, "Điều chỉnh hóa đơn", { type, amount, total });
        result = { total };
        break;
      }
      case "invoice.pay": {
        requireAny(user, ["PAYMENTS_MANAGE"]);
        const invoiceId = required(payload, "invoiceId", "Hóa đơn");
        const invoice = await queryOne<{ status: string; total_amount: number; customer_id: string | null }>("SELECT status, total_amount, customer_id FROM invoices WHERE id=?", invoiceId);
        if (!invoice || invoice.status !== "ISSUED") throw new AppError("Hóa đơn không ở trạng thái chờ thanh toán.");
        const alreadyPaid = Number((await queryOne<{ total: number }>("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE invoice_id=?", invoiceId))?.total ?? 0);
        const amount = numberValue(payload, "amount") || invoice.total_amount - alreadyPaid;
        if (amount <= 0 || alreadyPaid + amount > invoice.total_amount) throw new AppError("Số tiền thanh toán không hợp lệ.");
        const method = required(payload, "method", "Phương thức thanh toán");
        const shift = await queryOne<{ id: string }>("SELECT id FROM work_shifts WHERE cashier_id=? AND status='OPEN'", user.id);
        if (method === "CASH" && !shift) throw new AppError("Bạn cần mở ca trước khi nhận thanh toán tiền mặt.");
        const paymentId = id("pay");
        const statements = [db.prepare("INSERT INTO payments (id, invoice_id, method, amount, reference, received_by) VALUES (?, ?, ?, ?, ?, ?)").bind(paymentId, invoiceId, method, amount, optional(payload, "reference"), user.id)];
        const isPaid = alreadyPaid + amount === invoice.total_amount;
        if (isPaid) statements.push(db.prepare("UPDATE invoices SET status='PAID', paid_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(invoiceId));
        if (method === "CASH" && shift) statements.push(db.prepare("INSERT INTO shift_cash_movements (id, shift_id, type, amount, reference_type, reference_id, notes, created_by) VALUES (?, ?, 'PAYMENT', ?, 'INVOICE', ?, ?, ?)").bind(id("cash"), shift.id, amount, invoiceId, "Thu tiền hóa đơn", user.id));
        await db.batch(statements);
        if (isPaid && invoice.customer_id) {
          const membership = await queryOne<{ id: string }>("SELECT id FROM memberships WHERE customer_id=? AND active=1", invoice.customer_id);
          if (membership) {
            const points = Math.floor(invoice.total_amount / 10000);
            await db.batch([
              db.prepare("UPDATE memberships SET points=points+?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(points, membership.id),
              db.prepare("INSERT INTO loyalty_transactions (id, membership_id, points, reason, reference_type, reference_id) VALUES (?, ?, ?, ?, 'INVOICE', ?)").bind(id("point"), membership.id, points, "Tích điểm thanh toán", invoiceId),
            ]);
          }
        }
        await audit(request, user.id, "INVOICE_PAID", "INVOICE", invoiceId, isPaid ? "Thanh toán hoàn tất" : "Thanh toán một phần", { method, amount });
        break;
      }
      case "invoice.cancel": {
        requireAny(user, ["INVOICES_MANAGE"]);
        const invoiceId = required(payload, "invoiceId", "Hóa đơn");
        const reason = required(payload, "reason", "Lý do hủy");
        const invoice = await queryOne<{ status: string }>("SELECT status FROM invoices WHERE id=?", invoiceId);
        if (!invoice || !["DRAFT", "ISSUED"].includes(invoice.status)) throw new AppError("Chỉ có thể hủy hóa đơn chưa thanh toán.");
        await db.prepare("UPDATE invoices SET status='CANCELLED', cancelled_at=CURRENT_TIMESTAMP, cancel_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(reason, invoiceId).run();
        await audit(request, user.id, "INVOICE_CANCELLED", "INVOICE", invoiceId, "Hủy hóa đơn", { reason });
        break;
      }
      case "invoice.split": {
        requireAny(user, ["INVOICES_MANAGE"]);
        const invoiceId = required(payload, "invoiceId", "Hóa đơn");
        const itemIds = Array.isArray(payload.itemIds) ? payload.itemIds.map(String) : [];
        if (!itemIds.length) throw new AppError("Cần chọn ít nhất một dòng để tách.");
        const invoice = await queryOne<{ status: string; customer_id: string | null }>("SELECT status, customer_id FROM invoices WHERE id=?", invoiceId);
        if (!invoice || invoice.status !== "ISSUED") throw new AppError("Chỉ tách được hóa đơn chờ thanh toán.");
        const totalItems = Number((await queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM invoice_items WHERE invoice_id=?", invoiceId))?.count ?? 0);
        if (itemIds.length >= totalItems) throw new AppError("Hóa đơn gốc phải còn ít nhất một dòng.");
        const newId = id("bill");
        await db.prepare("INSERT INTO invoices (id, code, customer_id, status, issued_at, created_by) VALUES (?, ?, ?, 'ISSUED', ?, ?)").bind(newId, code("HD"), invoice.customer_id, nowIso(), user.id).run();
        await db.prepare(`UPDATE invoice_items SET invoice_id=? WHERE invoice_id=? AND id IN (${itemIds.map(() => "?").join(",")})`).bind(newId, invoiceId, ...itemIds).run();
        await recalculateInvoice(invoiceId); await recalculateInvoice(newId);
        await audit(request, user.id, "INVOICE_SPLIT", "INVOICE", invoiceId, "Tách hóa đơn", { newInvoiceId: newId, itemIds });
        result = { invoiceId: newId };
        break;
      }
      case "invoice.merge": {
        requireAny(user, ["INVOICES_MANAGE"]);
        const targetId = required(payload, "targetInvoiceId", "Hóa đơn đích");
        const sourceIds = Array.isArray(payload.sourceInvoiceIds) ? payload.sourceInvoiceIds.map(String).filter((item) => item !== targetId) : [];
        if (!sourceIds.length) throw new AppError("Cần chọn hóa đơn để gộp.");
        const valid = await queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM invoices WHERE status='ISSUED' AND id IN (${sourceIds.map(() => "?").join(",")})`, ...sourceIds);
        if (Number(valid?.count ?? 0) !== sourceIds.length || !await queryOne("SELECT id FROM invoices WHERE id=? AND status='ISSUED'", targetId)) throw new AppError("Chỉ gộp được các hóa đơn chờ thanh toán.");
        await db.batch([
          ...sourceIds.map((sourceId) => db.prepare("UPDATE invoice_items SET invoice_id=? WHERE invoice_id=?").bind(targetId, sourceId)),
          ...sourceIds.map((sourceId) => db.prepare("UPDATE invoices SET status='CANCELLED', cancelled_at=CURRENT_TIMESTAMP, cancel_reason='Đã gộp vào hóa đơn khác' WHERE id=?").bind(sourceId)),
        ]);
        await recalculateInvoice(targetId);
        await audit(request, user.id, "INVOICES_MERGED", "INVOICE", targetId, "Gộp hóa đơn", { sourceIds });
        break;
      }
      case "inventory.move": {
        requireAny(user, ["INVENTORY_MANAGE"]);
        const productId = required(payload, "productId", "Hàng hóa");
        const type = required(payload, "type", "Loại giao dịch");
        if (!new Set(["IN", "OUT", "ADJUST"]).has(type)) throw new AppError("Loại giao dịch kho không hợp lệ.");
        const product = await queryOne<{ stock_quantity: number; name: string }>("SELECT stock_quantity, name FROM products WHERE id=? AND active=1", productId);
        if (!product) throw new AppError("Không tìm thấy hàng hóa.");
        const quantity = numberValue(payload, "quantity");
        if (quantity < 0 || (type !== "ADJUST" && quantity <= 0)) throw new AppError("Số lượng không hợp lệ.");
        const after = type === "IN" ? product.stock_quantity + quantity : type === "OUT" ? product.stock_quantity - quantity : quantity;
        if (after < 0) throw new AppError("Không thể xuất kho làm tồn kho âm.");
        const transactionId = id("stock");
        await db.batch([
          db.prepare("UPDATE products SET stock_quantity=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(after, productId),
          db.prepare("INSERT INTO inventory_transactions (id, code, product_id, type, quantity, before_quantity, after_quantity, unit_cost, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(transactionId, code(type === "IN" ? "NK" : type === "OUT" ? "XK" : "DC"), productId, type, type === "ADJUST" ? Math.abs(after - product.stock_quantity) : quantity, product.stock_quantity, after, optional(payload, "unitCost") ? numberValue(payload, "unitCost") : null, required(payload, "reason", "Lý do"), user.id),
        ]);
        await audit(request, user.id, "INVENTORY_MOVED", "PRODUCT", productId, `${type} kho ${product.name}`, { before: product.stock_quantity, after });
        break;
      }
      case "stock.count": {
        requireAny(user, ["INVENTORY_MANAGE"]);
        const rows = Array.isArray(payload.items) ? payload.items as Array<Record<string, unknown>> : [];
        if (!rows.length) throw new AppError("Phiếu kiểm kê chưa có hàng hóa.");
        const countId = id("count");
        const statements = [db.prepare("INSERT INTO stock_counts (id, code, status, notes, counted_by, approved_by, completed_at) VALUES (?, ?, 'COMPLETED', ?, ?, ?, CURRENT_TIMESTAMP)").bind(countId, code("KK"), optional(payload, "notes"), user.id, user.id)];
        for (const row of rows) {
          const productId = required(row, "productId", "Hàng hóa");
          const product = await queryOne<{ stock_quantity: number; name: string }>("SELECT stock_quantity, name FROM products WHERE id=?", productId);
          if (!product) throw new AppError("Có hàng hóa kiểm kê không hợp lệ.");
          const actual = numberValue(row, "actualQuantity");
          if (actual < 0) throw new AppError("Tồn thực tế không được âm.");
          const difference = actual - product.stock_quantity;
          statements.push(db.prepare("INSERT INTO stock_count_items (id, stock_count_id, product_id, system_quantity, actual_quantity, difference, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id("countline"), countId, productId, product.stock_quantity, actual, difference, optional(row, "notes")));
          if (difference !== 0) {
            statements.push(db.prepare("UPDATE products SET stock_quantity=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(actual, productId));
            statements.push(db.prepare("INSERT INTO inventory_transactions (id, code, product_id, type, quantity, before_quantity, after_quantity, reference_type, reference_id, reason, created_by) VALUES (?, ?, ?, 'ADJUST', ?, ?, ?, 'STOCK_COUNT', ?, ?, ?)").bind(id("stock"), code("DC"), productId, Math.abs(difference), product.stock_quantity, actual, countId, "Điều chỉnh sau kiểm kê", user.id));
          }
        }
        await db.batch(statements);
        await audit(request, user.id, "STOCK_COUNT_COMPLETED", "STOCK_COUNT", countId, "Hoàn tất kiểm kê kho", { itemCount: rows.length });
        break;
      }
      case "shift.open": {
        requireAny(user, ["SHIFTS_MANAGE"]);
        if (await queryOne("SELECT id FROM work_shifts WHERE cashier_id=? AND status='OPEN'", user.id)) throw new AppError("Bạn đã có một ca đang mở.");
        const openingCash = numberValue(payload, "openingCash");
        if (openingCash < 0) throw new AppError("Tiền đầu ca không được âm.");
        const shiftId = id("shift");
        await db.batch([
          db.prepare("INSERT INTO work_shifts (id, code, cashier_id, opening_cash, notes) VALUES (?, ?, ?, ?, ?)").bind(shiftId, code("CA"), user.id, openingCash, optional(payload, "notes")),
          db.prepare("INSERT INTO shift_cash_movements (id, shift_id, type, amount, notes, created_by) VALUES (?, ?, 'OPENING', ?, 'Tiền đầu ca', ?)").bind(id("cash"), shiftId, openingCash, user.id),
        ]);
        await audit(request, user.id, "SHIFT_OPENED", "WORK_SHIFT", shiftId, "Mở ca làm việc", { openingCash });
        break;
      }
      case "shift.close": {
        requireAny(user, ["SHIFTS_MANAGE"]);
        const shift = await queryOne<{ id: string; opening_cash: number }>("SELECT id, opening_cash FROM work_shifts WHERE cashier_id=? AND status='OPEN'", user.id);
        if (!shift) throw new AppError("Bạn không có ca đang mở.");
        const cashFlow = Number((await queryOne<{ total: number }>("SELECT COALESCE(SUM(CASE WHEN type IN ('OPENING','PAYMENT','CASH_IN') THEN amount ELSE -amount END),0) AS total FROM shift_cash_movements WHERE shift_id=?", shift.id))?.total ?? 0);
        const actual = numberValue(payload, "actualCash");
        if (actual < 0) throw new AppError("Tiền thực tế không được âm.");
        await db.batch([
          db.prepare("UPDATE work_shifts SET status='CLOSED', closed_at=CURRENT_TIMESTAMP, expected_cash=?, actual_cash=?, difference=?, notes=COALESCE(?,notes), closed_by=? WHERE id=?").bind(cashFlow, actual, actual - cashFlow, optional(payload, "notes"), user.id, shift.id),
          db.prepare("INSERT INTO shift_cash_movements (id, shift_id, type, amount, notes, created_by) VALUES (?, ?, 'CLOSING', ?, 'Tiền thực tế chốt ca', ?)").bind(id("cash"), shift.id, actual, user.id),
        ]);
        await audit(request, user.id, "SHIFT_CLOSED", "WORK_SHIFT", shift.id, "Chốt ca làm việc", { expected: cashFlow, actual, difference: actual - cashFlow });
        result = { expectedCash: cashFlow, difference: actual - cashFlow };
        break;
      }
      default: throw new AppError("Thao tác không được hỗ trợ.", 404);
    }
    return Response.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) return responseError(new AppError("Dữ liệu bị trùng hoặc trạng thái đã thay đổi. Vui lòng tải lại."));
    if (error instanceof Error && /FOREIGN KEY constraint failed/.test(error.message)) return responseError(new AppError("Dữ liệu liên quan không hợp lệ hoặc vẫn đang được sử dụng."));
    return responseError(error);
  }
}
