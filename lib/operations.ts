import { AppError, type AppUser } from "@/lib/server";
import { catalogAction } from "@/lib/catalog-actions";
import { reservationAction } from "@/lib/reservation-actions";
import { sessionAction } from "@/lib/session-actions";
import { orderAction } from "@/lib/order-actions";
import type { Payload } from "@/lib/operation-validation";

export const operationPermissions: Record<string, string> = Object.fromEntries([
  ...["area.save", "area.delete", "table.save", "table.delete"].map((a) => [a, "TABLES_MANAGE"]),
  ...["tableType.save", "tableType.delete", "price.save", "price.delete"].map((a) => [a, "PRICES_MANAGE"]),
  ...["category.save", "category.delete", "product.save", "product.delete"].map((a) => [a, "PRODUCTS_MANAGE"]),
  ...["reservation.save", "reservation.status"].map((a) => [a, "RESERVATIONS_MANAGE"]),
  ...["session.start", "session.pause", "session.resume", "session.transfer", "session.end", "reservation.seat"].map((a) => [a, "SESSIONS_MANAGE"]),
  ...["order.add", "order.item.update", "order.item.status"].map((a) => [a, "ORDERS_MANAGE"]),
  ["table.status", "TABLE_STATUS"],
]);

export async function executeOperation(action: string, p: Payload, user: AppUser, request: Request) {
  if (user.roleCode !== "ADMIN" && !user.permissions.includes(operationPermissions[action])) throw new AppError("Bạn không có quyền thực hiện thao tác này.", 403);
  if (action.startsWith("session.") || action === "reservation.seat") return sessionAction(action, p, user, request);
  if (action.startsWith("reservation.")) return reservationAction(action, p, user, request);
  if (action.startsWith("order.")) return orderAction(action, p, user, request);
  return catalogAction(action, p, user, request);
}
