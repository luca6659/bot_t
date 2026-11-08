import type { Queryable } from "../../infrastructure/db.js";
import { kopecksFromDb } from "../../views/format.js";

export interface Category {
  id: number;
  name: string;
  photo: string | null;
  position: number;
  active: boolean;
}

export type Stock = "in_stock" | "on_order";

export interface Product {
  id: number;
  categoryId: number;
  name: string;
  description: string;
  price: number;
  photos: string[];
  isHit: boolean;
  isNew: boolean;
  stock: Stock;
  active: boolean;
}

export interface NewProduct {
  categoryId: number;
  name: string;
  description: string;
  price: number;
  photos: string[];
  isHit: boolean;
  isNew: boolean;
  stock: Stock;
}

export type ProductPatch = Partial<Omit<NewProduct, "categoryId">>;

export interface Page<T> {
  items: T[];
  total: number;
}

export const PAGE_SIZE = 6;

function toProduct(r: any): Product {
  return {
    id: r.id,
    categoryId: r.category_id,
    name: r.name,
    description: r.description,
    price: kopecksFromDb(r.price),
    photos: r.photos,
    isHit: r.is_hit,
    isNew: r.is_new,
    stock: r.stock,
    active: r.active,
  };
}

function toCategory(r: any): Category {
  return { id: r.id, name: r.name, photo: r.photo_file_id, position: r.position, active: r.active };
}

// В LIKE спецсимволы запроса покупателя должны искаться буквально.
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

const VISIBLE = `p.active AND p.category_id IN (SELECT id FROM categories WHERE active)`;

export function createCatalogRepository(db: Queryable) {
  async function page(where: string, params: unknown[], pageNo: number): Promise<Page<Product>> {
    const count = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM products p WHERE ${where}`, params);
    const n = params.length;
    const { rows } = await db.query(
      `SELECT p.* FROM products p WHERE ${where} ORDER BY p.id DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...params, PAGE_SIZE, pageNo * PAGE_SIZE],
    );
    return { items: rows.map(toProduct), total: count.rows[0]!.n };
  }

  return {
    async categories(onlyActive: boolean): Promise<Category[]> {
      const { rows } = await db.query(
        `SELECT * FROM categories ${onlyActive ? "WHERE active" : ""} ORDER BY position, id`,
      );
      return rows.map(toCategory);
    },
    async category(id: number): Promise<Category | null> {
      const { rows } = await db.query(`SELECT * FROM categories WHERE id = $1`, [id]);
      return rows[0] ? toCategory(rows[0]) : null;
    },
    async createCategory(name: string): Promise<number> {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO categories (name, position) VALUES ($1, (SELECT COALESCE(MAX(position), 0) + 1 FROM categories)) RETURNING id`,
        [name],
      );
      return rows[0]!.id;
    },
    async renameCategory(id: number, name: string): Promise<void> {
      await db.query(`UPDATE categories SET name = $2 WHERE id = $1`, [id, name]);
    },
    async setCategoryPhoto(id: number, photo: string | null): Promise<void> {
      await db.query(`UPDATE categories SET photo_file_id = $2 WHERE id = $1`, [id, photo]);
    },
    // Порядок — парами: двигаем категорию в списке, меняясь местами с соседней.
    async moveCategory(id: number, delta: number): Promise<void> {
      const { rows } = await db.query<{ id: number }>(`SELECT id FROM categories ORDER BY position, id`);
      const ids = rows.map((r) => r.id);
      const i = ids.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      for (let k = 0; k < ids.length; k++) {
        await db.query(`UPDATE categories SET position = $2 WHERE id = $1`, [ids[k], k]);
      }
    },
    async toggleCategory(id: number): Promise<void> {
      await db.query(`UPDATE categories SET active = NOT active WHERE id = $1`, [id]);
    },
    byCategory(categoryId: number, pageNo: number): Promise<Page<Product>> {
      return page(`p.category_id = $1 AND p.active`, [categoryId], pageNo);
    },
    search(query: string, pageNo: number): Promise<Page<Product>> {
      return page(`${VISIBLE} AND p.name ILIKE $1`, [likePattern(query)], pageNo);
    },
    hits(pageNo: number): Promise<Page<Product>> {
      return page(`${VISIBLE} AND (p.is_hit OR p.is_new)`, [], pageNo);
    },
    all(pageNo: number): Promise<Page<Product>> {
      return page(`TRUE`, [], pageNo);
    },
    async product(id: number): Promise<Product | null> {
      const { rows } = await db.query(`SELECT * FROM products p WHERE p.id = $1`, [id]);
      return rows[0] ? toProduct(rows[0]) : null;
    },
    // Соседняя моделька в том же списке (категория/поиск/хиты). На краю — с другого конца.
    async neighbor(current: Product, list: { type: "category"; id: number } | { type: "search"; query: string } | { type: "hits" }, dir: 1 | -1): Promise<Product | null> {
      const where =
        list.type === "category"
          ? { sql: `p.category_id = $1 AND p.active`, params: [list.id] }
          : list.type === "search"
            ? { sql: `${VISIBLE} AND p.name ILIKE $1`, params: [likePattern(list.query)] }
            : { sql: `${VISIBLE} AND (p.is_hit OR p.is_new)`, params: [] };
      const cmp = dir === 1 ? "<" : ">";
      const order = dir === 1 ? "DESC" : "ASC";
      const { rows } = await db.query(
        `SELECT p.* FROM products p WHERE ${where.sql} AND p.id ${cmp} $${where.params.length + 1}
         ORDER BY p.id ${order} LIMIT 1`,
        [...where.params, current.id],
      );
      if (rows[0]) return toProduct(rows[0]);
      const wrap = await db.query(
        `SELECT p.* FROM products p WHERE ${where.sql} ORDER BY p.id ${dir === 1 ? "ASC" : "DESC"} LIMIT 1`,
        where.params,
      );
      return wrap.rows[0] ? toProduct(wrap.rows[0]) : null;
    },
    async createProduct(p: NewProduct): Promise<number> {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO products (category_id, name, description, price, photos, is_hit, is_new, stock)
         VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8) RETURNING id`,
        [p.categoryId, p.name, p.description, p.price / 100, p.photos, p.isHit, p.isNew, p.stock],
      );
      return rows[0]!.id;
    },
    async updateProduct(id: number, fields: ProductPatch): Promise<void> {
      const columns: Record<string, [string, unknown]> = {
        name: ["name = $2", fields.name],
        description: ["description = $2", fields.description],
        price: ["price = $2", fields.price === undefined ? undefined : fields.price / 100],
        photos: ["photos = $2::text[]", fields.photos],
        isHit: ["is_hit = $2", fields.isHit],
        isNew: ["is_new = $2", fields.isNew],
        stock: ["stock = $2", fields.stock],
      };
      for (const [assign, value] of Object.values(columns)) {
        if (value !== undefined) await db.query(`UPDATE products SET ${assign} WHERE id = $1`, [id, value]);
      }
    },
    async toggleProduct(id: number): Promise<void> {
      await db.query(`UPDATE products SET active = NOT active WHERE id = $1`, [id]);
    },
    // Удалять можно только модельку без заказов: иначе в старых заказах потеряется состав.
    async deleteProduct(id: number): Promise<boolean> {
      const { rows } = await db.query<{ id: number }>(
        `DELETE FROM products WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM order_items WHERE product_id = $1)
         RETURNING id`,
        [id],
      );
      return rows.length > 0;
    },
  };
}
export type CatalogRepository = ReturnType<typeof createCatalogRepository>;
