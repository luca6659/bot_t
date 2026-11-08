import type { Queryable } from "../../infrastructure/db.js";
import { kopecksFromDb } from "../../views/format.js";

export interface Category {
  id: number;
  name: string;
  active: boolean;
}

export interface Product {
  id: number;
  categoryId: number;
  name: string;
  description: string;
  price: number;
  photo: string | null;
  sizes: string[];
  colors: string[];
  active: boolean;
}

export interface NewProduct {
  categoryId: number;
  name: string;
  description: string;
  price: number;
  photo: string | null;
  sizes: string[];
  colors: string[];
}

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
    photo: r.photo_file_id,
    sizes: r.sizes,
    colors: r.colors,
    active: r.active,
  };
}

// В LIKE спецсимволы запроса покупателя должны искаться буквально.
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

export function createCatalogRepository(db: Queryable) {
  async function page(where: string, params: unknown[], page: number): Promise<Page<Product>> {
    const count = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM products p WHERE ${where}`, params);
    const n = params.length;
    const { rows } = await db.query(
      `SELECT p.* FROM products p WHERE ${where} ORDER BY p.id DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...params, PAGE_SIZE, page * PAGE_SIZE],
    );
    return { items: rows.map(toProduct), total: count.rows[0]!.n };
  }

  return {
    async categories(onlyActive: boolean): Promise<Category[]> {
      const { rows } = await db.query<Category>(
        `SELECT id, name, active FROM categories ${onlyActive ? "WHERE active" : ""} ORDER BY id`,
      );
      return rows;
    },
    async category(id: number): Promise<Category | null> {
      const { rows } = await db.query<Category>(`SELECT id, name, active FROM categories WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },
    async createCategory(name: string): Promise<number> {
      const { rows } = await db.query<{ id: number }>(`INSERT INTO categories (name) VALUES ($1) RETURNING id`, [name]);
      return rows[0]!.id;
    },
    async renameCategory(id: number, name: string): Promise<void> {
      await db.query(`UPDATE categories SET name = $2 WHERE id = $1`, [id, name]);
    },
    async toggleCategory(id: number): Promise<void> {
      await db.query(`UPDATE categories SET active = NOT active WHERE id = $1`, [id]);
    },
    byCategory(categoryId: number, pageNo: number): Promise<Page<Product>> {
      return page(`p.category_id = $1 AND p.active`, [categoryId], pageNo);
    },
    search(query: string, pageNo: number): Promise<Page<Product>> {
      return page(
        `p.active AND p.name ILIKE $1 AND p.category_id IN (SELECT id FROM categories WHERE active)`,
        [likePattern(query)],
        pageNo,
      );
    },
    all(pageNo: number): Promise<Page<Product>> {
      return page(`TRUE`, [], pageNo);
    },
    async product(id: number): Promise<Product | null> {
      const { rows } = await db.query(`SELECT * FROM products WHERE id = $1`, [id]);
      return rows[0] ? toProduct(rows[0]) : null;
    },
    async createProduct(p: NewProduct): Promise<number> {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO products (category_id, name, description, price, photo_file_id, sizes, colors)
         VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text[]) RETURNING id`,
        [p.categoryId, p.name, p.description, p.price / 100, p.photo, p.sizes, p.colors],
      );
      return rows[0]!.id;
    },
    async updateProduct(id: number, fields: Partial<Omit<NewProduct, "categoryId">>): Promise<void> {
      const columns: Record<string, [string, unknown]> = {
        name: ["name = $2", fields.name],
        description: ["description = $2", fields.description],
        price: ["price = $2", fields.price === undefined ? undefined : fields.price / 100],
        photo: ["photo_file_id = $2", fields.photo],
        sizes: ["sizes = $2::text[]", fields.sizes],
        colors: ["colors = $2::text[]", fields.colors],
      };
      for (const [assign, value] of Object.values(columns)) {
        if (value !== undefined) await db.query(`UPDATE products SET ${assign} WHERE id = $1`, [id, value]);
      }
    },
    async toggleProduct(id: number): Promise<void> {
      await db.query(`UPDATE products SET active = NOT active WHERE id = $1`, [id]);
    },
  };
}
export type CatalogRepository = ReturnType<typeof createCatalogRepository>;
