// Структурированный логгер: в проде чистый JSON, локально читаемый вывод.
import pino from "pino";

const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: isProd || process.env.LOG_LEVEL === "silent"
    ? undefined
    : { target: "pino-pretty", options: { colorize: true } },
});

export function logAction(
  action: string,
  ctx: { from?: { id?: number }; chat?: { id?: number } },
  extra: Record<string, unknown> = {},
): void {
  logger.info({ action, userId: ctx.from?.id, chatId: ctx.chat?.id, ...extra });
}
