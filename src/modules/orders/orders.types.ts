import type { DeliveryMethod } from "../../bot/context.js";

export type OrderStatus =
  | "new"
  | "awaiting_payment"
  | "receipt_check"
  | "paid"
  | "assembling"
  | "printing"
  | "pickup_ready"
  | "courier"
  | "done"
  | "cancelled";

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: "🆕 Новый",
  awaiting_payment: "💳 Ждёт оплаты",
  receipt_check: "🧾 Чек на проверке",
  paid: "✅ Оплачен",
  assembling: "📦 Собирается",
  printing: "🖨 В печати",
  pickup_ready: "🏠 Ждёт самовывоза",
  courier: "🚕 Передан курьеру",
  done: "🏁 Выполнен",
  cancelled: "❌ Отменён",
};

// Разрешённые переходы. Всё, чего здесь нет, сервис отклоняет.
// «В печати» — только у своей модели, «Собирается» — только у каталога: это проверяет сервис.
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["receipt_check", "paid", "cancelled"],
  receipt_check: ["paid", "awaiting_payment", "cancelled"],
  paid: ["assembling", "printing", "cancelled"],
  assembling: ["courier", "pickup_ready", "cancelled"],
  printing: ["courier", "pickup_ready", "cancelled"],
  pickup_ready: ["done", "cancelled"],
  courier: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

// Статусы, которые считаются выручкой.
export const PAID_STATUSES: OrderStatus[] = ["paid", "assembling", "printing", "pickup_ready", "courier", "done"];

export interface OrderItem {
  name: string;
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
  comment: string | null;
  description: string | null;
  wishes: string | null;
  photos: string[];
  deadline: string | null;
  quotePhotoFileId: string | null;
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
  comment: string | null;
}
