// Настройки и редактируемые тексты. Читаются из кэша: они нужны почти на каждый апдейт.
import type { Queryable } from "../../infrastructure/db.js";
import { EDITABLE_TEXTS, setTextOverrides } from "../../i18n/texts.js";

export function createSettingsService(db: Queryable) {
  let cache: Record<string, string> = {};

  function applyTextOverrides(): void {
    const texts: Record<string, string> = {};
    for (const key of Object.keys(EDITABLE_TEXTS)) {
      const value = cache[key];
      if (value !== undefined) texts[key] = value;
    }
    setTextOverrides(texts);
  }

  return {
    async load(): Promise<void> {
      const { rows } = await db.query<{ key: string; value: string }>(`SELECT key, value FROM settings`);
      cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      applyTextOverrides();
    },
    get(key: string): string | undefined {
      return cache[key];
    },
    async set(key: string, value: string): Promise<void> {
      await db.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value],
      );
      cache[key] = value;
      applyTextOverrides();
    },
    async remove(key: string): Promise<void> {
      await db.query(`DELETE FROM settings WHERE key = $1`, [key]);
      delete cache[key];
      applyTextOverrides();
    },
    isMaintenance(): boolean {
      return cache.maintenance_on === "1";
    },
    // Стоимость курьера в копейках. null: админ считает её вручную для каждого заказа.
    courierCost(): number | null {
      const value = cache.courier_cost;
      return value === undefined ? null : Number(value);
    },
  };
}
export type SettingsService = ReturnType<typeof createSettingsService>;
