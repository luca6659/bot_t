// Точка входа: подключить БД, собрать бота, запустить. Webhook в облаке, long polling локально.
import { createServer } from "node:http";
import { webhookCallback } from "grammy";
import { createBot } from "./bot/create-bot.js";
import { loadConfig } from "./config.js";
import { createLocalDb, createPgDb } from "./infrastructure/db.js";
import { logger } from "./infrastructure/logger.js";
import { runMigrations } from "./infrastructure/migrations.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const db = config.databaseUrl ? createPgDb(config.databaseUrl) : await createLocalDb(".data/pg");
  await runMigrations(db);

  const { bot, broadcast } = await createBot({
    token: config.botToken,
    adminGroupId: config.adminGroupId,
    adminIds: config.adminIds,
    callmeNumber: config.callmeNumber,
    db,
  });
  await bot.api.setMyCommands([
    { command: "start", description: "Главное меню" },
    { command: "cancel", description: "Отменить текущее действие" },
  ], { scope: { type: "all_private_chats" } });
  await bot.api.setMyCommands([{ command: "admin", description: "Админка" }], {
    scope: { type: "chat", chat_id: config.adminGroupId },
  }).catch((err) => logger.warn({ action: "bot.admin_commands_failed", err: String(err) }));
  await broadcast.resume();

  let server: ReturnType<typeof createServer> | null = null;

  const stop = async () => {
    logger.info({ action: "bot.stopping" });
    await broadcast.stop();
    if (server) await new Promise((resolve) => server!.close(resolve));
    else await bot.stop();
    await db.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  if (config.webhookUrl && config.webhookSecret) {
    const path = `/tg/${config.webhookSecret}`;
    const handle = webhookCallback(bot, "http", { secretToken: config.webhookSecret, timeoutMilliseconds: 25_000 });
    server = createServer((req, res) => {
      if (req.method === "POST" && req.url === path) {
        handle(req, res).catch((err) => {
          logger.error({ action: "webhook.failed", err: String(err) });
          if (!res.headersSent) res.statusCode = 500;
          res.end();
        });
        return;
      }
      res.statusCode = req.url === "/healthz" ? 200 : 404;
      res.end(req.url === "/healthz" ? "ok" : "not found");
    });
    server.listen(config.port, () => logger.info({ action: "server.listening", port: config.port }));
    await bot.api.setWebhook(`${config.webhookUrl.replace(/\/$/, "")}${path}`, { secret_token: config.webhookSecret });
    logger.info({ action: "bot.started", mode: "webhook" });
  } else {
    await bot.api.deleteWebhook();
    logger.info({ action: "bot.started", mode: "polling" });
    await bot.start();
  }
}

main().catch((err) => {
  logger.fatal({ action: "bot.fatal", err: String(err) });
  process.exit(1);
});
