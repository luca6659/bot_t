// Хранилище сессий grammY в PostgreSQL: состояние диалогов переживает перезапуск.
import type { StorageAdapter } from "grammy";
import type { Queryable } from "./db.js";

export function createSessionStorage<T>(db: Queryable): StorageAdapter<T> {
  return {
    read: async (key) => {
      const { rows } = await db.query<{ value: T }>(`SELECT value FROM sessions WHERE key = $1`, [key]);
      return rows[0]?.value;
    },
    write: async (key, value) => {
      await db.query(
        `INSERT INTO sessions (key, value, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    },
    delete: async (key) => {
      await db.query(`DELETE FROM sessions WHERE key = $1`, [key]);
    },
  };
}
