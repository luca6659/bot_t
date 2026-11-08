// Бизнес-логика заказов. Не знает про grammY: о событиях сообщает через интерфейс OrderNotifier.
import type { Db } from "../../infrastructure/db.js";
import { ConflictError, NotFoundError, ValidationError } from "../../infrastructure/errors.js";
import { t } from "../../i18n/texts.js";
import type { CartRepository } from "../cart/cart.repository.js";
import type { PaymentProvider } from "../payment/payment.service.js";
import type { SettingsService } from "../settings/settings.service.js";
import type { OrdersRepository } from "./orders.repository.js";
import { TRANSITIONS, type Contacts, type Order, type OrderStatus } from "./orders.types.js";

export interface OrderNotifier {
  // Покупатель: счёт, цена своей модели, смена статуса.
  invoice(order: Order): Promise<void>;
  quote(order: Order): Promise<void>;
  statusChanged(order: Order, previous: OrderStatus): Promise<void>;
  // Админы: карточка заказа и закреп клиента в его теме, короткие уведомления в теме «Заказы».
  orderCard(order: Order, note?: string): Promise<void>;
  clientCard(userId: number): Promise<void>;
  systemNotice(text: string): Promise<void>;
  receipt(order: Order): Promise<void>;
  customPhotos(order: Order): Promise<void>;
  missingRequisites(order: Order): Promise<void>;
}

export function createOrdersService(
  db: Db,
  orders: OrdersRepository,
  cart: CartRepository,
  settings: SettingsService,
  payment: PaymentProvider,
  notifier: OrderNotifier,
) {
  async function mustGet(id: number): Promise<Order> {
    const order = await orders.get(id);
    if (!order) throw new NotFoundError(`order ${id}`, "Заказ не найден.");
    return order;
  }

  async function mustOwn(id: number, userId: number): Promise<Order> {
    const order = await mustGet(id);
    if (order.userId !== userId) throw new NotFoundError(`order ${id} of ${order.userId}`, "Заказ не найден.");
    return order;
  }

  async function move(order: Order, to: OrderStatus, actor: string, extra: Parameters<OrdersRepository["changeStatus"]>[4] = {}) {
    if (!TRANSITIONS[order.status].includes(to)) throw new ConflictError(`${order.status} -> ${to}`);
    // У каталога сборка, у своей модели — печать.
    if (to === "printing" && order.type !== "custom") throw new ConflictError(`printing catalog order ${order.id}`);
    if (to === "assembling" && order.type !== "catalog") throw new ConflictError(`assembling custom order ${order.id}`);
    const ok = await orders.changeStatus(order.id, order.status, to, actor, extra);
    if (!ok) throw new ConflictError(`race on order ${order.id}`);
    return mustGet(order.id);
  }

  async function issueInvoice(order: Order, actor: string): Promise<Order> {
    const updated = await move(order, "awaiting_payment", actor);
    await notifier.invoice(updated);
    if (payment.requisitesMissing()) await notifier.missingRequisites(updated);
    await notifier.orderCard(updated);
    return updated;
  }

  // Получатель известен: выставляем счёт сразу или ждём, пока админ посчитает доставку.
  async function afterDeliveryChosen(order: Order): Promise<{ order: Order; invoiced: boolean }> {
    const fixed = settings.courierCost();
    if (order.delivery === "pickup" || fixed !== null) {
      await orders.setDeliveryCost(order.id, order.delivery === "pickup" ? 0 : fixed!);
      return { order: await issueInvoice(await mustGet(order.id), "client"), invoiced: true };
    }
    await notifier.orderCard(order, "🚚 Нужно указать стоимость доставки");
    return { order, invoiced: false };
  }

  return {
    get: mustGet,
    getOwned: mustOwn,
    firstPhoto: orders.firstPhoto,
    customCountToday: orders.customCountToday,

    async createFromCart(userId: number, contacts: Contacts) {
      // Корзина очищается в той же транзакции: повторное нажатие не создаст второй заказ.
      const id = await db.tx(async (q) => {
        const items = await cart.items(userId, q);
        if (items.length === 0) throw new ValidationError("Корзина пуста. Возможно, заказ уже оформлен.");
        const orderId = await orders.createFromCart(userId, items, contacts, q);
        await cart.clear(userId, q);
        return orderId;
      });
      await notifier.systemNotice(`🆕 Новый заказ №${id}`);
      return afterDeliveryChosen(await mustGet(id));
    },

    async createCustom(userId: number, description: string, wishes: string, photos: string[]) {
      const id = await orders.createCustom(userId, description, wishes, photos);
      const order = await mustGet(id);
      await notifier.systemNotice(`🎨 Новая заявка на свою модель №${id}`);
      await notifier.orderCard(order, "✨ Новая заявка на свою модель");
      if (order.photos.length) await notifier.customPhotos(order);
      return order;
    },

    async setQuote(id: number, price: number, deadline: string, quotePhoto: string | null) {
      if (!(await orders.setQuote(id, price, deadline, quotePhoto))) throw new ConflictError(`quote on order ${id}`);
      const order = await mustGet(id);
      await notifier.quote(order);
      return order;
    },

    async acceptQuote(id: number, userId: number) {
      await mustOwn(id, userId);
      if (!(await orders.acceptQuote(id, userId))) throw new ConflictError(`accept quote ${id}`, "Это предложение уже неактуально.");
      const order = await mustGet(id);
      await notifier.orderCard(order, "✅ Покупатель согласен с ценой, выбирает доставку");
      return order;
    },

    async rejectQuote(id: number, userId: number) {
      const order = await mustOwn(id, userId);
      if (order.status !== "new" || order.quoteAccepted) throw new ConflictError(`reject quote ${id}`, "Это предложение уже неактуально.");
      const updated = await move(order, "cancelled", "client", { reason: t("quote.rejected_reason") });
      await notifier.orderCard(updated);
      return updated;
    },

    async setCustomContacts(id: number, userId: number, contacts: Contacts) {
      const order = await mustOwn(id, userId);
      if (order.status !== "new" || !order.quoteAccepted) throw new ConflictError(`contacts on order ${id}`, "Этот заказ уже оформлен.");
      await orders.setContacts(id, contacts);
      return afterDeliveryChosen(await mustGet(id));
    },

    async setDeliveryCost(id: number, cost: number) {
      const order = await mustGet(id);
      if (order.status !== "new" || order.delivery !== "courier") throw new ConflictError(`delivery cost on order ${id}`);
      await orders.setDeliveryCost(id, cost);
      return issueInvoice(await mustGet(id), "admin");
    },

    async submitReceipt(id: number, userId: number, fileId: string, kind: "photo" | "document") {
      const order = await mustOwn(id, userId);
      if (order.status !== "awaiting_payment") throw new ConflictError(`receipt on order ${id}`, "Этот заказ сейчас не ждёт оплаты.");
      const updated = await move(order, "receipt_check", "client", { receipt: { fileId, kind } });
      await notifier.receipt(updated);
      await notifier.systemNotice(`🧾 Новый чек по заказу №${id}`);
      await notifier.orderCard(updated, "🔍 Покупатель прислал чек");
      return updated;
    },

    // Смена статуса админом: покупатель получает уведомление.
    async adminTransition(id: number, to: OrderStatus, actor: string, extra: { reason?: string; tracking?: string } = {}) {
      const order = await mustGet(id);
      const updated = await move(order, to, actor, extra);
      await notifier.statusChanged(updated, order.status);
      await notifier.clientCard(order.userId);
      return updated;
    },

    async clientCancel(id: number, userId: number) {
      const order = await mustOwn(id, userId);
      if (order.status !== "new" && order.status !== "awaiting_payment") {
        throw new ConflictError(`client cancel ${id}`, "Заказ уже в работе. Напиши нам, и мы поможем.");
      }
      const updated = await move(order, "cancelled", "client", { reason: t("orders.cancelled_by_client") });
      await notifier.orderCard(updated);
      return updated;
    },

    list: orders.byUser,
    listByStatus: orders.byStatus,
    stats: orders.stats,
  };
}
export type OrdersService = ReturnType<typeof createOrdersService>;
