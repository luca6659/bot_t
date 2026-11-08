// Миграции применяются при старте по порядку. Уже применённые не трогаем, новые дописываем в конец.
import type { Db } from "./db.js";
import { logger } from "./logger.js";

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    first_name TEXT NOT NULL DEFAULT '',
    username TEXT,
    topic_id INTEGER,
    saved_name TEXT,
    saved_phone TEXT,
    saved_address TEXT,
    blocked_bot BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX users_topic_idx ON users (topic_id) WHERE topic_id IS NOT NULL;

  CREATE TABLE categories (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
  );

  CREATE TABLE products (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    photo_file_id TEXT,
    sizes TEXT[] NOT NULL DEFAULT '{}',
    colors TEXT[] NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX products_category_idx ON products (category_id, active);

  CREATE TABLE cart_items (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    size TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    qty INTEGER NOT NULL CHECK (qty > 0),
    UNIQUE (user_id, product_id, size, color)
  );

  CREATE TABLE orders (
    id INTEGER GENERATED ALWAYS AS IDENTITY (START WITH 1001) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK (type IN ('catalog','custom')),
    status TEXT NOT NULL,
    subtotal NUMERIC(12,2),
    delivery TEXT CHECK (delivery IN ('courier','pickup')),
    delivery_cost NUMERIC(12,2),
    full_name TEXT,
    phone TEXT,
    address TEXT,
    description TEXT,
    size TEXT,
    color TEXT,
    photos TEXT[] NOT NULL DEFAULT '{}',
    deadline TEXT,
    quote_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    receipt_file_id TEXT,
    receipt_kind TEXT,
    tracking_url TEXT,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX orders_user_idx ON orders (user_id, id DESC);
  CREATE INDEX orders_status_idx ON orders (status, id DESC);

  CREATE TABLE order_items (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER REFERENCES products(id),
    name TEXT NOT NULL,
    size TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    price NUMERIC(12,2) NOT NULL,
    qty INTEGER NOT NULL
  );
  CREATE INDEX order_items_order_idx ON order_items (order_id);

  CREATE TABLE order_status_history (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    status TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX order_status_history_order_idx ON order_status_history (order_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE sessions (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE broadcasts (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    from_chat_id BIGINT NOT NULL,
    message_id INTEGER NOT NULL,
    thread_id INTEGER,
    status TEXT NOT NULL DEFAULT 'running',
    cursor_user_id BIGINT NOT NULL DEFAULT 0,
    sent INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `,
  `
  -- Одна моделька = одна цена, без размеров и цветов. Фото стало галереей.
  ALTER TABLE products ADD COLUMN photos TEXT[] NOT NULL DEFAULT '{}';
  UPDATE products SET photos = ARRAY[photo_file_id] WHERE photo_file_id IS NOT NULL;
  ALTER TABLE products DROP COLUMN photo_file_id;
  ALTER TABLE products DROP COLUMN sizes;
  ALTER TABLE products DROP COLUMN colors;
  ALTER TABLE products ADD COLUMN is_hit BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE products ADD COLUMN is_new BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE products ADD COLUMN stock TEXT NOT NULL DEFAULT 'in_stock' CHECK (stock IN ('in_stock','on_order'));

  ALTER TABLE categories ADD COLUMN photo_file_id TEXT;
  ALTER TABLE categories ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

  -- Корзина: одна моделька = одна строка, повторные варианты сливаем в количество.
  UPDATE cart_items ci SET qty = t.total FROM (
    SELECT user_id, product_id, SUM(qty) AS total FROM cart_items GROUP BY user_id, product_id
  ) t WHERE ci.user_id = t.user_id AND ci.product_id = t.product_id;
  DELETE FROM cart_items WHERE id NOT IN (SELECT MIN(id) FROM cart_items GROUP BY user_id, product_id);
  ALTER TABLE cart_items DROP CONSTRAINT cart_items_user_id_product_id_size_color_key;
  ALTER TABLE cart_items DROP COLUMN size;
  ALTER TABLE cart_items DROP COLUMN color;
  ALTER TABLE cart_items ADD UNIQUE (user_id, product_id);

  ALTER TABLE orders DROP COLUMN size;
  ALTER TABLE orders DROP COLUMN color;
  ALTER TABLE orders ADD COLUMN comment TEXT;
  ALTER TABLE orders ADD COLUMN wishes TEXT;
  ALTER TABLE orders ADD COLUMN quote_photo_file_id TEXT;
  UPDATE orders SET status = CASE
    WHEN status = 'printing' AND type = 'catalog' THEN 'assembling'
    WHEN status = 'ready' AND delivery = 'pickup' THEN 'pickup_ready'
    WHEN status = 'ready' THEN 'courier'
    ELSE status END;

  ALTER TABLE order_items DROP COLUMN size;
  ALTER TABLE order_items DROP COLUMN color;

  ALTER TABLE users ADD COLUMN banned BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN pinned_message_id INTEGER;
  `,
];

export async function runMigrations(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`);
  const { rows } = await db.query<{ v: number | null }>(`SELECT MAX(version)::int AS v FROM schema_migrations`);
  const current = rows[0]?.v ?? 0;

  for (let i = current; i < MIGRATIONS.length; i++) {
    await db.exec(MIGRATIONS[i]!);
    await db.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [i + 1]);
    logger.info({ action: "db.migrated", version: i + 1 });
  }
}
