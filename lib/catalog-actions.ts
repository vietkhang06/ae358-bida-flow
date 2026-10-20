import { AppError, audit, getRawDb, id, nowIso, queryOne, type AppUser } from "@/lib/server";
import { activeRecord, changed, dueBookingSql, numeric, openSessionSql, optional, required, text, timestamp, uniqueCatalog, type Catalog, type Payload } from "@/lib/operation-validation";

export async function catalogAction(action: string, p: Payload, user: AppUser, request: Request) {
  const db = getRawDb();
  const kind = action.split(".")[0];
  const tables: Record<string, Catalog> = { area: "areas", tableType: "table_types", table: "billiard_tables", price: "price_rules", category: "product_categories", product: "products" };
  const entities: Record<string, string> = { area: "AREA", tableType: "TABLE_TYPE", table: "BILLIARD_TABLE", price: "PRICE_RULE", category: "PRODUCT_CATEGORY", product: "PRODUCT" };
  const table = tables[kind];
  const entityId = optional(p, "id") ?? id(kind);
  const existing = p.id ? await activeRecord(table, entityId) : null;
  const at = nowIso();
  if (action.endsWith(".delete")) {
    if (!existing) throw new AppError("Bản ghi là bắt buộc.");
    let guard = "1=1";
    if (kind === "area") guard = "NOT EXISTS (SELECT 1 FROM billiard_tables WHERE area_id=areas.id AND active=1)";
    if (kind === "tableType") guard = "NOT EXISTS (SELECT 1 FROM billiard_tables WHERE table_type_id=table_types.id AND active=1)";
    if (kind === "category") guard = "NOT EXISTS (SELECT 1 FROM products WHERE category_id=product_categories.id AND active=1)";
    if (kind === "table") guard = `NOT EXISTS (${openSessionSql})
      AND NOT EXISTS (SELECT 1 FROM invoices i JOIN play_sessions ps ON ps.id=i.session_id WHERE ps.table_id=billiard_tables.id AND i.status IN ('DRAFT','ISSUED'))
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.table_id=billiard_tables.id AND r.status IN ('PENDING','CONFIRMED') AND julianday(r.ends_at)>julianday('now'))`;
    changed(await db.prepare(`UPDATE ${table} SET active=0, updated_at=? WHERE id=? AND active=1 AND ${guard}`).bind(at, entityId).run(), "Không thể ngừng sử dụng: bản ghi đang được dùng, có phiên chơi, lịch đặt hoặc hóa đơn chưa hoàn tất.");
  } else if (action === "table.status") {
    if (!existing) throw new AppError("Bàn là bắt buộc.");
    const status = required(p, "status");
    if (!["AVAILABLE", "RESERVED", "MAINTENANCE"].includes(status)) throw new AppError("Trạng thái bàn không hợp lệ.");
    const bookingCondition = status === "RESERVED" ? `EXISTS (${dueBookingSql})` : `NOT EXISTS (${dueBookingSql})`;
    changed(await db.prepare(`UPDATE billiard_tables SET status=?, updated_at=? WHERE id=? AND active=1 AND NOT EXISTS (${openSessionSql}) AND ${bookingCondition}`)
      .bind(status, at, entityId, at, at).run(), "Không thể đổi trạng thái bàn đang có phiên chơi hoặc không khớp lịch đặt hiện tại.");
  } else if (action === "price.save") {
    const typeId = required(p, "tableTypeId");
    await activeRecord("table_types", typeId);
    const days = numeric(p, "daysMask", { fallback: 127, min: 1, max: 127, integer: true });
    const start = numeric(p, "startMinute", { fallback: 0, max: 1439, integer: true });
    const end = numeric(p, "endMinute", { fallback: 1440, min: 1, max: 1440, integer: true });
    const rate = numeric(p, "hourlyRate", { integer: true });
    const priority = numeric(p, "priority", { fallback: 0, integer: true });
    const from = timestamp(p, "effectiveFrom", true), to = timestamp(p, "effectiveTo", true);
    if (start >= end || (from && to && from >= to)) throw new AppError("Thời gian kết thúc phải sau thời gian bắt đầu.");
    // One atomic INSERT/UPDATE includes the conflict check, preventing concurrent overlapping saves.
    const guard = `NOT EXISTS (SELECT 1 FROM price_rules WHERE id<>? AND active=1 AND table_type_id=?
      AND priority=? AND (days_mask & ?)<>0 AND start_minute<? AND end_minute>?
      AND (effective_to IS NULL OR ? IS NULL OR julianday(effective_to)>julianday(?))
      AND (effective_from IS NULL OR ? IS NULL OR julianday(effective_from)<julianday(?)))`;
    const args = [typeId, required(p, "name"), days, start, end, rate, priority, from, to];
    const check = [entityId, typeId, priority, days, end, start, from, from, to, to];
    const result = existing
      ? await db.prepare(`UPDATE price_rules SET table_type_id=?, name=?, days_mask=?, start_minute=?, end_minute=?, hourly_rate=?, priority=?, effective_from=?, effective_to=?, updated_at=? WHERE id=? AND ${guard}`).bind(...args, at, entityId, ...check).run()
      : await db.prepare(`INSERT INTO price_rules (id, table_type_id, name, days_mask, start_minute, end_minute, hourly_rate, priority, effective_from, effective_to) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(entityId, ...args, ...check).run();
    changed(result, "Khung giá bị chồng lấn với quy tắc cùng độ ưu tiên.");
  } else {
    const code = required(p, "code").toUpperCase(), name = required(p, "name");
    await uniqueCatalog(table, entityId, code, ["area", "product", "category", "tableType"].includes(kind) ? name : undefined);
    let columns: string[], args: unknown[];
    const sort = () => numeric(p, "sortOrder", { fallback: 0, integer: true });
    switch (kind) {
      case "area":
        columns = ["code", "name", "description", "sort_order"];
        args = [code, name, optional(p, "description"), sort()];
        break;
      case "tableType": {
        const color = text(p, "color") || "#16a085";
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw new AppError("Màu loại bàn không hợp lệ.");
        columns = ["code", "name", "description", "base_hourly_rate", "color"];
        args = [code, name, optional(p, "description"), numeric(p, "baseHourlyRate", { fallback: 0, integer: true }), color];
        break;
      }
      case "table": {
        const areaId = required(p, "areaId"), typeId = required(p, "tableTypeId");
        await activeRecord("areas", areaId);
        await activeRecord("table_types", typeId);
        if (existing && (existing.area_id !== areaId || existing.table_type_id !== typeId) && await queryOne("SELECT id FROM play_sessions WHERE table_id=? AND status IN ('ACTIVE','PAUSED')", entityId)) throw new AppError("Không thể đổi khu vực/loại bàn đang có phiên chơi.");
        columns = ["code", "name", "area_id", "table_type_id", "notes", "sort_order"];
        args = [code, name, areaId, typeId, optional(p, "notes"), sort()];
        break;
      }
      case "category":
        columns = ["code", "name", "sort_order"];
        args = [code, name, sort()];
        break;
      case "product": {
        const categoryId = optional(p, "categoryId");
        if (categoryId) await activeRecord("product_categories", categoryId);
        const productKind = text(p, "kind") || "PRODUCT";
        if (!["PRODUCT", "SERVICE"].includes(productKind)) throw new AppError("Loại sản phẩm/dịch vụ không hợp lệ.");
        if (p.trackStock !== undefined && typeof p.trackStock !== "boolean") throw new AppError("Theo dõi tồn kho phải là boolean.");
        const track = productKind === "SERVICE" ? false : p.trackStock !== false;
        // Stock ownership remains in the inventory module; catalog cannot rewrite a ledger balance.
        if (existing && (Number(existing.track_stock) !== Number(track) || existing.kind !== productKind) &&
          (Number(existing.stock_quantity) !== 0 || await queryOne("SELECT id FROM order_items WHERE product_id=? LIMIT 1", entityId))) throw new AppError("Không thể đổi kiểu/theo dõi kho của sản phẩm đã có tồn hoặc order.");
        columns = ["code", "name", "category_id", "kind", "unit", "sale_price", "cost_price", "min_stock", "track_stock"];
        args = [code, name, categoryId, productKind, text(p, "unit") || "phần", numeric(p, "salePrice", { integer: true }), numeric(p, "costPrice", { fallback: 0, integer: true }), numeric(p, "minStock", { fallback: 0 }), Number(track)];
        break;
      }
      default: throw new AppError("Thao tác không hợp lệ.");
    }
    if (existing) changed(await db.prepare(`UPDATE ${table} SET ${columns.map((c) => `${c}=?`).join(",")}, updated_at=? WHERE id=? AND active=1`).bind(...args, at, entityId).run());
    else await db.prepare(`INSERT INTO ${table} (id,${columns.join(",")}) VALUES (${[entityId, ...args].map(() => "?").join(",")})`).bind(entityId, ...args).run();
  }
  const event = action === "table.status" ? "TABLE_STATUS_CHANGED" : `${entities[kind] === "BILLIARD_TABLE" ? "TABLE" : entities[kind]}_${action.endsWith(".delete") ? "DELETED" : "SAVED"}`;
  await audit(request, user.id, event, entities[kind], entityId, `${action}: ${text(p, "name") || entityId}`);
  return { id: entityId };
}
