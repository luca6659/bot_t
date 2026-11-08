import type { Queryable } from "../../infrastructure/db.js";
import { kopecksFromDb } from "../../views/format.js";

export interface CartItem {
  id: number;
  productId: number;
  name: string;
  photo: string | null;
  price: number;
  qty: number;
}

// Скрытые админом товары в корзине не показываем и не продаём.
const ITEMS_SQL = `
  SELECT ci.id, ci.product_id, p.name, p.photos[1] AS photo, p.price, ci.qty
  FROM cart_items ci JOIN products p ON p.id = ci.product_id
  WHERE ci.user_id = $1 AND p.active ORDER BY ci.id`;

function toItem(r: any): CartItem {
  return {
    id: r.id,
    productId: r.product_id,
    name: r.name,
    photo: r.photo,
    price: kopecksFromDb(r.price),
    qty: r.qty,
  };
}

export function createCartRepository(db: Queryable) {
  return {
    async add(userId: number, productId: number): Promise<void> {
      await db.query(
        `INSERT INTO cart_items (user_id, product_id, qty) VALUES ($1, $2, 1)
         ON CONFLICT (user_id, product_id) DO UPDATE SET qty = cart_items.qty + 1`,
        [userId, productId],
      );
    },
    async items(userId: number, q: Queryable = db): Promise<CartItem[]> {
      const { rows } = await q.query(ITEMS_SQL, [userId]);
      return rows.map(toItem);
    },
    async count(userId: number): Promise<number> {
      const { rows } = await db.query<{ n: number }>(
        `SELECT COALESCE(SUM(ci.qty), 0)::int AS n
         FROM cart_items ci JOIN products p ON p.id = ci.product_id
         WHERE ci.user_id = $1 AND p.active`,
        [userId],
      );
      return rows[0]!.n;
    },
    async changeQty(userId: number, itemId: number, delta: number): Promise<void> {
      await db.query(`UPDATE cart_items SET qty = qty + $3 WHERE id = $2 AND user_id = $1 AND qty + $3 > 0`, [
        userId,
        itemId,
        delta,
      ]);
    },
    async remove(userId: number, itemId: number): Promise<void> {
      await db.query(`DELETE FROM cart_items WHERE id = $2 AND user_id = $1`, [userId, itemId]);
    },
    async clear(userId: number, q: Queryable = db): Promise<void> {
      await q.query(`DELETE FROM cart_items WHERE user_id = $1`, [userId]);
    },
  };
}
export type CartRepository = ReturnType<typeof createCartRepository>;
