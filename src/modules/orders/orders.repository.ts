import type { Queryable } from "../../infrastructure/db.js";
import { kopecksFromDb } from "../../views/format.js";
import type { Page } from "../catalog/catalog.repository.js";
import type { CartItem } from "../cart/cart.repository.js";
import { PAID_STATUSES, type Contacts, type Order, type OrderItem, type OrderStatus } from "./orders.types.js";

export const ORDERS_PAGE_SIZE = 6;

function toOrder(r: any, items: OrderItem[]): Order {
  return {
    id: r.id,
    userId: Number(r.user_id),
    type: r.type,
    status: r.status,
    items,
    subtotal: r.subtotal === null ? null : kopecksFromDb(r.subtotal),
    delivery: r.delivery,
    deliveryCost: r.delivery_cost === null ? null : kopecksFromDb(r.delivery_cost),
    fullName: r.full_name,
    phone: r.phone,
    address: r.address,
    comment: r.comment,
    description: r.description,
    wishes: r.wishes,
    photos: r.photos,
    deadline: r.deadline,
    quotePhotoFileId: r.quote_photo_file_id,
    quoteAccepted: r.quote_accepted,
    receiptFileId: r.receipt_file_id,
    receiptKind: r.receipt_kind,
    trackingUrl: r.tracking_url,
    cancelReason: r.cancel_reason,
  };
}

export function createOrdersRepository(db: Queryable) {
  async function items(orderId: number, q: Queryable): Promise<OrderItem[]> {
    const { rows } = await q.query(
      `SELECT name, price, qty FROM order_items WHERE order_id = $1 ORDER BY id`,
      [orderId],
    );
    return rows.map((r: any) => ({ name: r.name, price: kopecksFromDb(r.price), qty: r.qty }));
  }

  async function page(where: string, params: unknown[], pageNo: number): Promise<Page<Order>> {
    const count = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM orders WHERE ${where}`, params);
    const n = params.length;
    const { rows } = await db.query(
      `SELECT * FROM orders WHERE ${where} ORDER BY id DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...params, ORDERS_PAGE_SIZE, pageNo * ORDERS_PAGE_SIZE],
    );
    return { items: rows.map((r) => toOrder(r, [])), total: count.rows[0]!.n };
  }

  return {
    async get(id: number, q: Queryable = db): Promise<Order | null> {
      const { rows } = await q.query(`SELECT * FROM orders WHERE id = $1`, [id]);
      return rows[0] ? toOrder(rows[0], await items(id, q)) : null;
    },
    byUser(userId: number, pageNo: number): Promise<Page<Order>> {
      return page(`user_id = $1`, [userId], pageNo);
    },
    byStatus(status: OrderStatus, pageNo: number): Promise<Page<Order>> {
      return page(`status = $1`, [status], pageNo);
    },
    // Фото для карточки и уведомлений: первая моделька заказа или фото/рендер своей модели.
    async firstPhoto(order: Order): Promise<string | null> {
      if (order.type === "custom") return order.quotePhotoFileId ?? order.photos[0] ?? null;
      const { rows } = await db.query<{ photo: string | null }>(
        `SELECT p.photos[1] AS photo FROM order_items oi JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1 AND p.photos <> '{}' ORDER BY oi.id LIMIT 1`,
        [order.id],
      );
      return rows[0]?.photo ?? null;
    },
    async createFromCart(userId: number, cartItems: CartItem[], c: Contacts, q: Queryable): Promise<number> {
      const subtotal = cartItems.reduce((sum, i) => sum + i.price * i.qty, 0);
      const { rows } = await q.query<{ id: number }>(
        `INSERT INTO orders (user_id, type, status, subtotal, delivery, full_name, phone, address, comment)
         VALUES ($1, 'catalog', 'new', $2, $3, $4, $5, $6, $7) RETURNING id`,
        [userId, subtotal / 100, c.delivery, c.fullName, c.phone, c.address, c.comment],
      );
      const id = rows[0]!.id;
      for (const i of cartItems) {
        await q.query(
          `INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES ($1, $2, $3, $4, $5)`,
          [id, i.productId, i.name, i.price / 100, i.qty],
        );
      }
      await q.query(`INSERT INTO order_status_history (order_id, status, actor) VALUES ($1, 'new', 'client')`, [id]);
      return id;
    },
    async createCustom(userId: number, description: string, wishes: string, photos: string[]): Promise<number> {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO orders (user_id, type, status, description, wishes, photos)
         VALUES ($1, 'custom', 'new', $2, $3, $4::text[]) RETURNING id`,
        [userId, description, wishes, photos],
      );
      const id = rows[0]!.id;
      await db.query(`INSERT INTO order_status_history (order_id, status, actor) VALUES ($1, 'new', 'client')`, [id]);
      return id;
    },
    // Антиспам: не больше нескольких заявок на свою модель в сутки.
    async customCountToday(userId: number): Promise<number> {
      const { rows } = await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM orders WHERE user_id = $1 AND type = 'custom' AND created_at > now() - interval '1 day'`,
        [userId],
      );
      return rows[0]!.n;
    },
    async setQuote(id: number, price: number, deadline: string, quotePhoto: string | null): Promise<boolean> {
      const { rows } = await db.query(
        `UPDATE orders SET subtotal = $2, deadline = $3, quote_photo_file_id = $4, updated_at = now()
         WHERE id = $1 AND type = 'custom' AND status = 'new' AND NOT quote_accepted RETURNING id`,
        [id, price / 100, deadline, quotePhoto],
      );
      return rows.length > 0;
    },
    async acceptQuote(id: number, userId: number): Promise<boolean> {
      const { rows } = await db.query(
        `UPDATE orders SET quote_accepted = TRUE, updated_at = now()
         WHERE id = $1 AND user_id = $2 AND type = 'custom' AND status = 'new'
           AND subtotal IS NOT NULL AND NOT quote_accepted RETURNING id`,
        [id, userId],
      );
      return rows.length > 0;
    },
    async setContacts(id: number, c: Contacts): Promise<void> {
      await db.query(
        `UPDATE orders SET delivery = $2, full_name = $3, phone = $4, address = $5, comment = $6, updated_at = now() WHERE id = $1`,
        [id, c.delivery, c.fullName, c.phone, c.address, c.comment],
      );
    },
    async setDeliveryCost(id: number, cost: number): Promise<void> {
      await db.query(`UPDATE orders SET delivery_cost = $2, updated_at = now() WHERE id = $1`, [id, cost / 100]);
    },
    // Смена статуса с проверкой старого: параллельное нажатие второго админа не пройдёт.
    async changeStatus(
      id: number,
      from: OrderStatus,
      to: OrderStatus,
      actor: string,
      extra: { reason?: string; tracking?: string; receipt?: { fileId: string; kind: string } } = {},
    ): Promise<boolean> {
      const { rows } = await db.query(
        `UPDATE orders SET status = $3, updated_at = now(),
           cancel_reason = COALESCE($4, cancel_reason),
           tracking_url = COALESCE($5, tracking_url),
           receipt_file_id = COALESCE($6, receipt_file_id),
           receipt_kind = COALESCE($7, receipt_kind)
         WHERE id = $1 AND status = $2 RETURNING id`,
        [id, from, to, extra.reason ?? null, extra.tracking ?? null, extra.receipt?.fileId ?? null, extra.receipt?.kind ?? null],
      );
      if (rows.length === 0) return false;
      await db.query(`INSERT INTO order_status_history (order_id, status, actor) VALUES ($1, $2, $3)`, [id, to, actor]);
      return true;
    },
    async stats(): Promise<{
      byStatus: Partial<Record<OrderStatus, number>>;
      revenue: number;
      revenueDay: number;
      revenueWeek: number;
      revenueMonth: number;
      top: { name: string; qty: number }[];
    }> {
      const { rows } = await db.query<{ status: OrderStatus; n: number }>(
        `SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status`,
      );
      const paid = PAID_STATUSES.map((s) => `'${s}'`).join(",");
      const revenue = await db.query<{ day: unknown; week: unknown; month: unknown; total: unknown }>(
        `SELECT COALESCE(SUM(subtotal + COALESCE(delivery_cost, 0)), 0) AS total,
                COALESCE(SUM(subtotal + COALESCE(delivery_cost, 0)) FILTER (WHERE updated_at > now() - interval '1 day'), 0) AS day,
                COALESCE(SUM(subtotal + COALESCE(delivery_cost, 0)) FILTER (WHERE updated_at > now() - interval '7 days'), 0) AS week,
                COALESCE(SUM(subtotal + COALESCE(delivery_cost, 0)) FILTER (WHERE updated_at > now() - interval '30 days'), 0) AS month
         FROM orders WHERE status IN (${paid})`,
      );
      const top = await db.query<{ name: string; qty: number }>(
        `SELECT oi.name, SUM(oi.qty)::int AS qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.status IN (${paid}) GROUP BY oi.name ORDER BY qty DESC LIMIT 5`,
      );
      const r = revenue.rows[0]!;
      return {
        byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])),
        revenue: kopecksFromDb(r.total),
        revenueDay: kopecksFromDb(r.day),
        revenueWeek: kopecksFromDb(r.week),
        revenueMonth: kopecksFromDb(r.month),
        top: top.rows,
      };
    },
  };
}
export type OrdersRepository = ReturnType<typeof createOrdersRepository>;
