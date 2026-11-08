import type { Queryable } from "../../infrastructure/db.js";
import { kopecksFromDb } from "../../views/format.js";
import type { Page } from "../catalog/catalog.repository.js";
import type { CartItem } from "../cart/cart.repository.js";
import type { Contacts, Order, OrderItem, OrderStatus } from "./orders.types.js";

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
    description: r.description,
    size: r.size,
    color: r.color,
    photos: r.photos,
    deadline: r.deadline,
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
      `SELECT name, size, color, price, qty FROM order_items WHERE order_id = $1 ORDER BY id`,
      [orderId],
    );
    return rows.map((r: any) => ({ name: r.name, size: r.size, color: r.color, price: kopecksFromDb(r.price), qty: r.qty }));
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
    async createFromCart(userId: number, cartItems: CartItem[], c: Contacts, q: Queryable): Promise<number> {
      const subtotal = cartItems.reduce((sum, i) => sum + i.price * i.qty, 0);
      const { rows } = await q.query<{ id: number }>(
        `INSERT INTO orders (user_id, type, status, subtotal, delivery, full_name, phone, address)
         VALUES ($1, 'catalog', 'new', $2, $3, $4, $5, $6) RETURNING id`,
        [userId, subtotal / 100, c.delivery, c.fullName, c.phone, c.address],
      );
      const id = rows[0]!.id;
      for (const i of cartItems) {
        await q.query(
          `INSERT INTO order_items (order_id, product_id, name, size, color, price, qty)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, i.productId, i.name, i.size, i.color, i.price / 100, i.qty],
        );
      }
      await q.query(`INSERT INTO order_status_history (order_id, status, actor) VALUES ($1, 'new', 'client')`, [id]);
      return id;
    },
    async createCustom(userId: number, description: string, size: string, color: string, photos: string[]): Promise<number> {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO orders (user_id, type, status, description, size, color, photos)
         VALUES ($1, 'custom', 'new', $2, $3, $4, $5::text[]) RETURNING id`,
        [userId, description, size, color, photos],
      );
      const id = rows[0]!.id;
      await db.query(`INSERT INTO order_status_history (order_id, status, actor) VALUES ($1, 'new', 'client')`, [id]);
      return id;
    },
    async setQuote(id: number, price: number, deadline: string): Promise<boolean> {
      const { rows } = await db.query(
        `UPDATE orders SET subtotal = $2, deadline = $3, updated_at = now()
         WHERE id = $1 AND type = 'custom' AND status = 'new' AND NOT quote_accepted RETURNING id`,
        [id, price / 100, deadline],
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
        `UPDATE orders SET delivery = $2, full_name = $3, phone = $4, address = $5, updated_at = now() WHERE id = $1`,
        [id, c.delivery, c.fullName, c.phone, c.address],
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
    async stats(): Promise<{ byStatus: Partial<Record<OrderStatus, number>>; revenue: number }> {
      const { rows } = await db.query<{ status: OrderStatus; n: number }>(
        `SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status`,
      );
      const revenue = await db.query<{ sum: unknown }>(
        `SELECT COALESCE(SUM(subtotal + COALESCE(delivery_cost, 0)), 0) AS sum FROM orders
         WHERE status IN ('paid','printing','ready','courier','done')`,
      );
      return {
        byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])),
        revenue: kopecksFromDb(revenue.rows[0]!.sum),
      };
    },
  };
}
export type OrdersRepository = ReturnType<typeof createOrdersRepository>;
