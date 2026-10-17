import { env } from "cloudflare:workers";
import {
  AppError, assertSameOrigin, audit, authCookie, createSession, ensureSystemCatalog,
  getRawDb, hashPassword, id, normalizeEmail, queryOne, responseError, sha256Hex, validatePassword,
} from "@/lib/server";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await request.json() as Record<string, string>;
    const fullName = String(body.fullName ?? "").trim();
    const email = normalizeEmail(String(body.email ?? ""));
    const password = String(body.password ?? "");
    if (fullName.length < 2 || !email.includes("@")) throw new AppError("Vui lòng nhập họ tên và email hợp lệ.");
    if (!validatePassword(password)) throw new AppError("Mật khẩu cần ít nhất 10 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.");

    const count = await queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM users");
    const isFirstUser = Number(count?.count ?? 0) === 0;
    await ensureSystemCatalog();
    let roleId = "role_admin";
    let invitationId: string | null = null;

    if (isFirstUser) {
      const setupCode = env.SETUP_CODE ?? process.env.SETUP_CODE;
      if (!setupCode) throw new AppError("Mã thiết lập ban đầu chưa được cấu hình.", 503);
      if (String(body.setupCode ?? "") !== setupCode) throw new AppError("Mã thiết lập ban đầu không đúng.", 403);
    } else {
      const inviteCode = String(body.invitationCode ?? "").trim();
      if (!inviteCode) throw new AppError("Bạn cần mã mời do quản lý cung cấp.", 403);
      const invitation = await queryOne<{ id: string; role_id: string; email: string | null }>(
        "SELECT id, role_id, email FROM invitations WHERE code_hash = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')",
        await sha256Hex(inviteCode),
      );
      if (!invitation || (invitation.email && normalizeEmail(invitation.email) !== email)) throw new AppError("Mã mời không hợp lệ hoặc đã hết hạn.", 403);
      invitationId = invitation.id;
      roleId = invitation.role_id;
    }

    if (await queryOne("SELECT id FROM users WHERE email = ?", email)) throw new AppError("Email này đã được sử dụng.", 409);
    const passwordData = await hashPassword(password);
    const userId = id("usr");
    const db = getRawDb();
    const statements = [
      db.prepare(`INSERT INTO users (id, email, full_name, password_hash, password_salt, role_id, status)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`).bind(userId, email, fullName, passwordData.hash, passwordData.salt, roleId),
    ];
    if (invitationId) statements.push(db.prepare("UPDATE invitations SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL").bind(invitationId));
    await db.batch(statements);
    const token = await createSession(userId);
    await audit(request, userId, "ACCOUNT_REGISTERED", "USER", userId, isFirstUser ? "Khởi tạo tài khoản quản trị đầu tiên" : "Đăng ký tài khoản bằng mã mời");
    return Response.json({ ok: true }, { status: 201, headers: { "Set-Cookie": authCookie(token) } });
  } catch (error) { return responseError(error); }
}
