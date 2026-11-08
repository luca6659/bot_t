// Контекст бота и состояние диалогов. Состояние хранится в сессии в БД, а не в переменных.
import type { Context, SessionFlavor } from "grammy";

export type DeliveryMethod = "courier" | "pickup";

export interface ProductDraft {
  categoryId: number;
  name?: string;
  photo?: string | null;
  description?: string;
  price?: number;
  sizes?: string[];
}

export type ProductField = "name" | "photo" | "description" | "price" | "sizes" | "colors";

export type AdminAction =
  | { type: "quote_price"; orderId: number }
  | { type: "quote_deadline"; orderId: number; price: number }
  | { type: "delivery_cost"; orderId: number }
  | { type: "tracking"; orderId: number }
  | { type: "cancel_reason"; orderId: number }
  | { type: "product_new"; draft: ProductDraft }
  | { type: "product_edit"; id: number; field: ProductField }
  | { type: "category_new" }
  | { type: "category_rename"; id: number }
  | { type: "text_edit"; key: string }
  | { type: "courier_cost" }
  | { type: "broadcast" }
  | { type: "broadcast_confirm"; messageId: number };

export type CheckoutStep = "delivery" | "name" | "phone" | "address" | "confirm";

export type Flow =
  | { kind: "search" }
  | {
      kind: "checkout";
      step: CheckoutStep;
      orderId?: number;
      delivery?: DeliveryMethod;
      name?: string;
      phone?: string;
      address?: string;
    }
  | {
      kind: "custom";
      step: "description" | "size" | "color" | "confirm";
      description: string;
      photos: string[];
      size?: string;
      color?: string;
    }
  | { kind: "receipt"; orderId: number }
  | { kind: "ask"; orderId: number | null }
  | { kind: "admin"; threadId: number | null; action: AdminAction };

export type ListRef = { type: "category"; id: number; page: number } | { type: "search"; page: number };

export interface SessionData {
  flow: Flow | null;
  list: ListRef | null;
  query: string | null;
  lastAckAt: number;
  lastMediaGroup: string | null;
}

export function initialSession(): SessionData {
  return { flow: null, list: null, query: null, lastAckAt: 0, lastMediaGroup: null };
}

export type MyContext = Context & SessionFlavor<SessionData>;
