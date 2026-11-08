// Контекст бота и состояние диалогов. Состояние хранится в сессии в БД, а не в переменных.
import type { Context, SessionFlavor } from "grammy";

export type DeliveryMethod = "courier" | "pickup";

export interface ProductDraft {
  categoryId?: number;
  name?: string;
  description?: string;
  photos: string[];
  photosDone?: boolean;
  price?: number;
  stock?: "in_stock" | "on_order";
  isHit?: boolean;
  isNew?: boolean;
}

export type ProductField = "name" | "description" | "price" | "photos_add";

export type AdminAction =
  | { type: "quote_price"; orderId: number }
  | { type: "quote_deadline"; orderId: number; price: number }
  | { type: "quote_photo"; orderId: number; price: number; deadline: string }
  | { type: "delivery_cost"; orderId: number }
  | { type: "tracking"; orderId: number }
  | { type: "cancel_reason"; orderId: number }
  | { type: "product_new"; draft: ProductDraft }
  | { type: "product_edit"; id: number; field: ProductField }
  | { type: "category_new" }
  | { type: "category_rename"; id: number }
  | { type: "category_photo"; id: number }
  | { type: "text_edit"; key: string }
  | { type: "banner_edit" }
  | { type: "courier_cost" }
  | { type: "broadcast" }
  | { type: "broadcast_confirm"; messageId: number };

export type CheckoutStep = "name" | "phone" | "delivery" | "address" | "comment" | "confirm";

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
      comment?: string;
    }
  | {
      kind: "custom";
      step: "description" | "wishes" | "confirm";
      description: string;
      photos: string[];
      wishes?: string;
    }
  | { kind: "receipt"; orderId: number }
  | { kind: "ask"; orderId: number | null }
  | { kind: "admin"; threadId: number | null; action: AdminAction };

// В каком списке листаем карточки моделек: категория, поиск или хиты.
export type ListRef = { type: "category"; id: number } | { type: "search"; query: string } | { type: "hits" };

export interface SessionData {
  flow: Flow | null;
  list: ListRef | null;
  lastAckAt: number;
  lastMediaGroup: string | null;
}

export function initialSession(): SessionData {
  return { flow: null, list: null, lastAckAt: 0, lastMediaGroup: null };
}

export type MyContext = Context & SessionFlavor<SessionData>;
