import { AppError, audit, code, getRawDb, id, nowIso, queryOne, type AppUser } from "@/lib/server";
import { changed, numeric, optional, required, type Payload } from "@/lib/operation-validation";

const unlocked = `EXISTS (SELECT 1 FROM orders o JOIN play_sessions ps ON ps.id=o.session_id WHERE o.id=order_items.order_id
  AND o.status='OPEN' AND NOT EXISTS (SELECT 1 FROM invoices WHERE session_id=ps.id AND status<>'CANCELLED'))`;

export async function orderAction(action: string, p: Payload, user: AppUser, request: Request) {
  const db = getRawDb(), at = nowIso();
  if (action === "order.add") {
    const sessionId = required(p, "sessionId"), productId = required(p, "productId");
    const quantity = numeric(p, "quantity", { min: Number.MIN_VALUE });
    const product = await queryOne<{ name: string; sale_price: number; track_stock: number; stock_quantity: number }>("SELECT name, sale_price, track_stock, stock_quantity FROM products WHERE id=? AND active=1", productId);
    if (!product) throw new AppError("Sản phẩm không khả dụng.");
    if (product.track_stock && product.stock_quantity < quantity) throw new AppError("Tồn kho không đủ.");
    if (!await queryOne("SELECT id FROM play_sessions WHERE id=? AND status IN ('ACTIVE','PAUSED')", sessionId)) throw new AppError("Chỉ có thể tạo order cho phiên đang hoạt động.");
    const orderId = id("ord"), itemId = id("item");
    const results = await db.batch([
      db.prepare(`INSERT INTO orders (id, code, session_id, created_by) SELECT ?,?,?,?
        WHERE EXISTS (SELECT 1 FROM play_sessions WHERE id=? AND status IN ('ACTIVE','PAUSED'))
        AND NOT EXISTS (SELECT 1 FROM invoices WHERE session_id=? AND status<>'CANCELLED')
        AND NOT EXISTS (SELECT 1 FROM orders WHERE session_id=? AND status='OPEN')`).bind(orderId, code("OD"), sessionId, user.id, sessionId, sessionId, sessionId),
      db.prepare(`INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, notes)
        SELECT ?,o.id,p.id,p.name,?,p.sale_price,? FROM orders o JOIN play_sessions ps ON ps.id=o.session_id JOIN products p ON p.id=?
        WHERE o.session_id=? AND o.status='OPEN' AND ps.status IN ('ACTIVE','PAUSED') AND p.active=1 AND (p.track_stock=0 OR p.stock_quantity>=?)
        AND NOT EXISTS (SELECT 1 FROM invoices WHERE session_id=ps.id AND status<>'CANCELLED') ORDER BY o.created_at LIMIT 1`)
        .bind(itemId, quantity, optional(p, "notes"), productId, sessionId, quantity),
      // If a concurrent session close or catalog change made the add invalid, leave no empty order.
      db.prepare("DELETE FROM orders WHERE id=? AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id=?)").bind(orderId, orderId),
    ]);
    changed(results[1], "Phiên/order đã khóa hoặc sản phẩm không đủ tồn.");
    const item = await queryOne<{ order_id: string }>("SELECT order_id FROM order_items WHERE id=?", itemId);
    await audit(request, user.id, "ORDER_ITEM_ADDED", "ORDER", item!.order_id, `Thêm ${quantity} ${product.name} vào order`, { itemId });
    return { itemId, orderId: item!.order_id };
  }
  const itemId = required(p, "itemId");
  const item = await queryOne<{ status: string; product_id: string; quantity: number; product_name: string; order_id: string; order_status: string }>(`
    SELECT oi.*,o.status AS order_status FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.id=?`, itemId);
  if (!item) throw new AppError("Không tìm thấy món.", 404);
  if (action === "order.item.status" && required(p, "status") === item.status) return { itemId, unchanged: true };
  if (["SERVED", "CANCELLED"].includes(item.status)) throw new AppError("Món đã phục vụ/hủy không thể thay đổi.");
  if (item.order_status !== "OPEN" || !await queryOne(`SELECT id FROM order_items WHERE id=? AND ${unlocked}`, itemId)) throw new AppError("Order đã khóa theo trạng thái hoặc hóa đơn.");
  if (action === "order.item.update") {
    const quantity = numeric(p, "quantity", { min: Number.MIN_VALUE });
    const product = await queryOne<{ track_stock: number; stock_quantity: number }>("SELECT track_stock, stock_quantity FROM products WHERE id=?", item.product_id);
    if (product?.track_stock && product.stock_quantity < quantity) throw new AppError("Tồn kho không đủ.");
    changed(await db.prepare(`UPDATE order_items SET quantity=?, notes=? WHERE id=? AND status IN ('PENDING','PREPARING') AND ${unlocked}
      AND EXISTS (SELECT 1 FROM products WHERE id=order_items.product_id AND (track_stock=0 OR stock_quantity>=?))`)
      .bind(quantity, optional(p, "notes"), itemId, quantity).run());
    await audit(request, user.id, "ORDER_ITEM_UPDATED", "ORDER_ITEM", itemId, "Cập nhật món trong order");
    return { itemId };
  }
  const status = required(p, "status");
  const transitions: Record<string, string[]> = { PENDING: ["PREPARING", "SERVED", "CANCELLED"], PREPARING: ["SERVED", "CANCELLED"] };
  if (!transitions[item.status]?.includes(status)) throw new AppError("Chuyển trạng thái món không hợp lệ.");
  const product = await queryOne<{ track_stock: number; stock_quantity: number }>("SELECT track_stock, stock_quantity FROM products WHERE id=?", item.product_id);
  if (status === "SERVED" && product?.track_stock && product.stock_quantity < item.quantity) throw new AppError("Tồn kho không đủ để hoàn tất món.");
  // First statement claims this transition; all inventory statements are gated by changes().
  // D1 batch is transactional: failure anywhere rolls back item, stock, and ledger together.
  const results = await db.batch([
    db.prepare(`UPDATE order_items SET status=? WHERE id=? AND status=? AND quantity=? AND ${unlocked}
      AND (?<>'SERVED' OR EXISTS (SELECT 1 FROM products WHERE id=order_items.product_id AND (track_stock=0 OR stock_quantity>=order_items.quantity)))`)
      .bind(status, itemId, item.status, item.quantity, status),
    db.prepare("UPDATE products SET stock_quantity=stock_quantity-?, updated_at=? WHERE id=? AND track_stock=1 AND ?='SERVED' AND changes()>0").bind(item.quantity, at, item.product_id, status),
    db.prepare(`INSERT INTO inventory_transactions (id, code, product_id, type, quantity, before_quantity, after_quantity, reference_type, reference_id, reason, created_by)
      SELECT ?,?,id,'SALE',?,stock_quantity+?,stock_quantity,'ORDER_ITEM',?,?,? FROM products WHERE id=? AND changes()>0`)
      .bind(id("stock"), code("XK"), item.quantity, item.quantity, itemId, `Phục vụ ${item.product_name}`, user.id, item.product_id),
    db.prepare(`UPDATE orders SET status=CASE WHEN EXISTS (SELECT 1 FROM order_items WHERE order_id=orders.id AND status='SERVED') THEN 'COMPLETED' ELSE 'CANCELLED' END, updated_at=?
      WHERE id=? AND status='OPEN' AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id=orders.id AND status IN ('PENDING','PREPARING'))
      AND EXISTS (SELECT 1 FROM play_sessions WHERE id=orders.session_id AND status='CLOSED')`).bind(at, item.order_id),
  ]);
  changed(results[0], "Món/order vừa thay đổi hoặc tồn kho không đủ. Vui lòng tải lại.");
  await audit(request, user.id, "ORDER_ITEM_STATUS_CHANGED", "ORDER_ITEM", itemId, `Cập nhật món thành ${status}`);
  return { itemId };
}
