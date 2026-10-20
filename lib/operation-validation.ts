import { AppError, queryAll, queryOne } from "@/lib/server";

export type Payload = Record<string, unknown>;
export const text = (data: Payload, key: string) => {
  const value = data[key];
  if (value == null) return "";
  if (typeof value !== "string") throw new AppError(`${key} phải là chuỗi.`);
  return value.trim();
};
export const optional = (data: Payload, key: string) => text(data, key) || null;
export function required(data: Payload, key: string, label = key) {
  const result = text(data, key);
  if (!result) throw new AppError(`${label} là bắt buộc.`);
  return result;
}
export function numeric(data: Payload, key: string, { fallback, min = 0, max = Number.MAX_SAFE_INTEGER, integer = false }: { fallback?: number; min?: number; max?: number; integer?: boolean } = {}) {
  const raw = data[key];
  if (raw == null || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new AppError(`${key} là bắt buộc.`);
  }
  if (typeof raw !== "string" && typeof raw !== "number") throw new AppError(`${key} không hợp lệ.`);
  const result = Number(raw);
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isSafeInteger(result))) throw new AppError(`${key} không hợp lệ.`);
  return result;
}
export function timestamp(data: Payload, key: string, nullable = false): string | null {
  const raw = text(data, key);
  if (!raw && nullable) return null;
  // Require an explicit offset; bare local times must be converted by the client.
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(raw)) throw new AppError(`${key} phải là thời gian ISO có múi giờ.`);
  const date = new Date(raw);
  const day = raw.slice(0, 10);
  if (!Number.isFinite(date.getTime()) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new AppError(`${key} không hợp lệ.`);
  return date.toISOString();
}

// Only these internal constants may become SQL identifiers.
export type Catalog = "areas" | "table_types" | "billiard_tables" | "price_rules" | "product_categories" | "products" | "customers";
export async function activeRecord(table: Catalog, id: string) {
  const row = await queryOne<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id=? AND active=1`, id);
  if (!row) throw new AppError("Không tìm thấy bản ghi đang hoạt động.", 404);
  return row;
}
export async function uniqueCatalog(table: Catalog, id: string, code: string, name?: string) {
  const rows = await queryAll<{ id: string; code: string; name: string; active: number }>(`SELECT id, code, name, active FROM ${table}`);
  const normalize = (s: string) => s.trim().normalize("NFC").toLocaleLowerCase("vi");
  if (rows.some((row) => row.id !== id && (normalize(row.code) === normalize(code) || (name && row.active && normalize(row.name) === normalize(name))))) {
    throw new AppError("Mã hoặc tên đã tồn tại.", 409);
  }
}
export function changed(result: D1Result, message = "Dữ liệu đã thay đổi hoặc thao tác không còn hợp lệ. Vui lòng tải lại.") {
  if (!result.meta.changes) throw new AppError(message, 409);
}

export const dueBookingSql = `SELECT 1 FROM reservations r WHERE r.table_id=billiard_tables.id
  AND r.status IN ('PENDING','CONFIRMED') AND julianday(r.starts_at)<=julianday(?) AND julianday(r.ends_at)>julianday(?)`;
export const openSessionSql = "SELECT 1 FROM play_sessions ps WHERE ps.table_id=billiard_tables.id AND ps.status IN ('ACTIVE','PAUSED')";

/** Derive reservation state at read time too: future bookings must not block today's walk-ins. */
export function effectiveTableStatus(table: { status: string; has_session?: unknown; has_booking?: unknown }) {
  if (table.has_session) return "PLAYING";
  if (table.status === "MAINTENANCE") return "MAINTENANCE";
  return table.has_booking ? "RESERVED" : "AVAILABLE";
}
