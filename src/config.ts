// Единственное место, где читаются настройки окружения.
import "dotenv/config";

export interface Config {
  botToken: string;
  adminGroupId: number;
  adminIds: number[];
  databaseUrl: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  port: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана обязательная переменная окружения: ${name}`);
  return value;
}

export function loadConfig(): Config {
  const adminGroupId = Number(required("ADMIN_GROUP_ID"));
  if (!Number.isInteger(adminGroupId)) throw new Error("ADMIN_GROUP_ID должен быть числом");

  const webhookUrl = process.env.WEBHOOK_URL || null;
  const webhookSecret = process.env.WEBHOOK_SECRET || null;
  if (webhookUrl && !webhookSecret) throw new Error("Для WEBHOOK_URL нужен WEBHOOK_SECRET");

  // Встроенная база только для локального запуска: на сервере данные пропадут при перезапуске.
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
    throw new Error("В продакшене нужен DATABASE_URL");
  }

  return {
    botToken: required("BOT_TOKEN"),
    adminGroupId,
    // Через запятую: только эти люди могут пользоваться админкой. Пусто — любой в группе админов.
    adminIds: (process.env.ADMIN_IDS ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0),
    databaseUrl: process.env.DATABASE_URL || null,
    webhookUrl,
    webhookSecret,
    port: Number(process.env.PORT ?? 3000),
  };
}
