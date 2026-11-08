import type { DeliveryMethod } from "../../bot/context.js";

export type OrderStatus =
  | "new"
  | "awaiting_payment"
  | "receipt_check"
  | "paid"
  | "printing"
  | "ready"
  | "courier"
  | "done"
  | "cancelled";

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: "🆕 Новый",
  awaiting_payment: "💳 Ждёт оплаты",
  receipt_check: "🔍 Чек на проверке",
  paid: "✅ Оплачен",
  printing: "🖨 В печати",
  ready: "📦 Готов",
  courier: "🚚 У курьера",
  done: "🎉 Выполнен",
  cancelled: "❌ Отменён",
};

// Разрешённые переходы. Всё, чего здесь нет, сервис отклоняет.
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["receipt_check", "paid", "cancelled"],
  receipt_check: ["paid", "awaiting_payment", "cancelled"],
  paid: ["printing", "cancelled"],
  printing: ["ready", "cancelled"],
  ready: ["courier", "done", "cancelled"],
  courier: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

export interface OrderItem {
  name: string;
  size: string;
  color: string;
  price: number;
  qty: number;
}

export interface Order {
  id: number;
  userId: number;
  type: "catalog" | "custom";
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number | null;
  delivery: DeliveryMethod | null;
  deliveryCost: number | null;
  fullName: string | null;
  phone: string | null;
  address: string | null;
  description: string | null;
  size: string | null;
  color: string | null;
  photos: string[];
  deadline: string | null;
  quoteAccepted: boolean;
  receiptFileId: string | null;
  receiptKind: "photo" | "document" | null;
  trackingUrl: string | null;
  cancelReason: string | null;
}

export function orderTotal(o: Order): number {
  return (o.subtotal ?? 0) + (o.deliveryCost ?? 0);
}

export interface Contacts {
  fullName: string;
  phone: string;
  address: string | null;
  delivery: DeliveryMethod;
}
