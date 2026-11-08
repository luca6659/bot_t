// Сборка бота: БД -> репозитории -> сервисы -> хендлеры. Запуск живёт отдельно в app.ts.
import { autoRetry } from "@grammyjs/auto-retry";
import { limit } from "@grammyjs/ratelimiter";
import { sequentialize } from "@grammyjs/runner";
import { Bot, BotError, Composer, GrammyError, session, type BotConfig } from "grammy";
import type { Db } from "../infrastructure/db.js";
import { AppError, toUserMessage } from "../infrastructure/errors.js";
import { logger } from "../infrastructure/logger.js";
import { createSessionStorage } from "../infrastructure/session-storage.js";
import { t } from "../i18n/texts.js";
import { esc } from "../views/format.js";
import { createAdminComposer } from "../modules/admin/admin.handler.js";
import { createCallmeService, createHttpTransport } from "../modules/callme/callme.service.js";
import { createBroadcastService } from "../modules/broadcast/broadcast.service.js";
import { createCartComposer } from "../modules/cart/cart.handler.js";
import { createCartRepository } from "../modules/cart/cart.repository.js";
import { createCatalogComposer } from "../modules/catalog/catalog.handler.js";
import { createCatalogRepository } from "../modules/catalog/catalog.repository.js";
import { createCheckoutComposer } from "../modules/checkout/checkout.handler.js";
import { createCustomComposer } from "../modules/custom/custom.handler.js";
import { createMainMenuComposer } from "../modules/main-menu/main-menu.handler.js";
import { createOrdersComposer } from "../modules/orders/orders.handler.js";
import { createOrderNotifier } from "../modules/orders/orders.notifier.js";
import { createOrdersRepository } from "../modules/orders/orders.repository.js";
import { createOrdersService } from "../modules/orders/orders.service.js";
import { createManualPaymentProvider } from "../modules/payment/payment.service.js";
import { createAdminRelayComposer, createClientRelayComposer } from "../modules/relay/relay.handler.js";
import { createTopicsService } from "../modules/relay/topics.service.js";
import { createSettingsService } from "../modules/settings/settings.service.js";
import { createUsersRepository } from "../modules/users/users.repository.js";
import { initialSession, type MyContext, type SessionData } from "./context.js";

export interface BotOptions {
  token: string;
  adminGroupId: number;
  // Если список задан, админка и ответы клиентам доступны только этим ID. Пустой — любой в группе.
  adminIds?: number[];
  // 10-значный номер call-me для звонка владельцу при новом заказе. Пусто — звонки выключены.
  callmeNumber?: string | null;
  db: Db;
  botConfig?: BotConfig<MyContext>;
  broadcastDelayMs?: number;
  rateLimit?: number;
  // В тестах нет Telegram: сюда подключается подмена API. Иначе работает auto-retry.
  configureApi?: (bot: Bot<MyContext>) => void;
}

const ERROR_NOTICE_INTERVAL_MS = 60_000;

export async function createBot(options: BotOptions) {
  const { adminGroupId, db } = options;
  const adminIds = options.adminIds ?? [];
  const bot = new Bot<MyContext>(options.token, options.botConfig);
  if (options.configureApi) options.configureApi(bot);
  else bot.api.config.use(autoRetry());
  // Сборщик клавиатур оставляет пустые ряды после .row(): Telegram они не нужны.
  // Подключается последним: последний установленный обработчик API срабатывает первым.
  bot.api.config.use((prev, method, payload, signal) => {
    const markup = (payload as any).reply_markup;
    if (markup?.inline_keyboard) {
      const inline_keyboard = markup.inline_keyboard.filter((row: unknown[]) => row.length > 0);
      payload = { ...payload, reply_markup: { inline_keyboard } } as typeof payload;
    }
    return prev(method, payload, signal);
  });

  const users = createUsersRepository(db);
  const catalog = createCatalogRepository(db);
  const cart = createCartRepository(db);
  const ordersRepo = createOrdersRepository(db);
  const settings = createSettingsService(db);
  await settings.load();

  const payment = createManualPaymentProvider(settings);
  const topics = createTopicsService(bot.api, adminGroupId, users, settings);
  const notifier = createOrderNotifier(bot.api, adminGroupId, topics, users, ordersRepo, payment);
  topics.setOnCreated((userId) => notifier.clientCard(userId));
  // Звонки владельцу: голосовой ответ приходит текстом в тему «🔔 Заказы».
  const callme = createCallmeService(options.callmeNumber ?? null, createHttpTransport(), (text) =>
    topics.sendToSystem("orders", `📞 ${esc(text)}`),
  );
  const orders = createOrdersService(db, ordersRepo, cart, settings, payment, notifier, callme);
  const broadcast = createBroadcastService(
    db,
    users,
    {
      copy: async (userId, fromChatId, messageId) => {
        await bot.api.copyMessage(userId, fromChatId, messageId);
      },
      finished: async (threadId, sent, failed) => {
        await bot.api.sendMessage(adminGroupId, `📣 Рассылка завершена. Доставлено: ${sent}, не доставлено: ${failed}.`, {
          message_thread_id: threadId ?? undefined,
        });
      },
    },
    options.broadcastDelayMs,
  );

  // Последний рубеж: покупатель видит понятный текст, админы узнают о сбое в теме «⚠️ Ошибки».
  let lastNoticeAt = 0;
  async function handleError(err: BotError<MyContext>): Promise<void> {
    const { ctx, error } = err;
    logger.error({ action: "bot.error", err: String(error), update: ctx.update.update_id, userId: ctx.from?.id });

    const text = toUserMessage(error);
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text, show_alert: true }).catch(() => {});
    else if (ctx.chat) await ctx.reply(text, { message_thread_id: ctx.msg?.is_topic_message ? ctx.msg.message_thread_id : undefined }).catch(() => {});

    const isExpected = error instanceof AppError || (error instanceof GrammyError && error.error_code === 403);
    if (!isExpected && Date.now() - lastNoticeAt > ERROR_NOTICE_INTERVAL_MS) {
      lastNoticeAt = Date.now();
      const notice = `🔴 Ошибка в боте: ${esc(String(error).slice(0, 500))}`;
      await topics.sendToSystem("errors", notice).catch(() =>
        bot.api.sendMessage(adminGroupId, notice, { parse_mode: "HTML" }).catch(() => {}),
      );
    }
  }
  bot.catch(handleError);

  // bot.catch работает только при long polling. В режиме webhook ошибка ушла бы в HTTP-ответ,
  // и Telegram бесконечно повторял бы один и тот же апдейт. Граница ошибок закрывает оба режима.
  const app = bot.errorBoundary(handleError);

  // Апдейты одного покупателя идут строго по очереди, иначе сессии затрут друг друга (например, на альбомах).
  app.use(sequentialize((ctx) => [ctx.chat?.id, ctx.from?.id].filter((v) => v !== undefined).map(String)));

  app.use(
    session<SessionData, MyContext>({
      initial: initialSession,
      storage: createSessionStorage<SessionData>(db),
      // Админская сессия отдельная: админ может быть и покупателем в личке.
      getSessionKey: (ctx) => {
        if (!ctx.from || !ctx.chat) return undefined;
        return ctx.chat.type === "private" ? `u:${ctx.from.id}` : `a:${ctx.chat.id}:${ctx.from.id}`;
      },
    }),
  );

  // Служебная команда для настройки: показывает ID группы и свой ID (для ADMIN_IDS).
  app.chatType(["group", "supergroup"]).command("chatid", (ctx) =>
    ctx.reply(`ID этой группы: <code>${ctx.chat.id}</code>\nТвой ID: <code>${ctx.from?.id}</code>`, { parse_mode: "HTML", message_thread_id: ctx.msg.message_thread_id }),
  );

  // Группа админов.
  const adminGroup = new Composer<MyContext>();
  adminGroup.use(async (ctx, next) => {
    if (adminIds.length && ctx.from && !adminIds.includes(ctx.from.id)) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Нет доступа", show_alert: true }).catch(() => {});
      else if (ctx.msg?.text?.startsWith("/admin")) await ctx.reply("Нет доступа.").catch(() => {});
      return;
    }
    await next();
  });
  adminGroup.use(createAdminComposer(catalog, orders, settings, users, broadcast, notifier));
  adminGroup.use(createAdminRelayComposer(users));
  app.filter((ctx) => ctx.chat?.id === adminGroupId, adminGroup);

  // Покупатели. Чужие группы бот игнорирует.
  const client = new Composer<MyContext>();
  client.use(
    limit<MyContext, never>({
      timeFrame: 3000,
      limit: options.rateLimit ?? 12, // С запасом: альбом приходит пачкой сообщений.
      keyGenerator: (ctx) => ctx.from?.id.toString(),
      onLimitExceeded: async (ctx) => {
        if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: t("error.rate_limit") }).catch(() => {});
      },
    }),
  );
  client.use(async (ctx, next) => {
    if (ctx.from) await users.touch(ctx.from.id, ctx.from.first_name, ctx.from.username ?? null);
    const user = ctx.from ? await users.get(ctx.from.id) : null;
    if (user?.banned) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
      else await ctx.reply(t("error.banned"));
      return;
    }
    if (settings.isMaintenance()) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
      await ctx.reply(t("maintenance"), { parse_mode: "HTML" });
      return;
    }
    await next();
  });
  client.use(createMainMenuComposer(cart, settings));
  client.use(createCatalogComposer(catalog, cart, settings));
  client.use(createCartComposer(cart, settings));
  client.use(createCheckoutComposer(orders, cart, users));
  client.use(createCustomComposer(orders));
  client.use(createOrdersComposer(orders, settings));
  client.use(createClientRelayComposer(adminGroupId, topics, orders));
  app.filter((ctx) => ctx.chat?.type === "private", client);

  return { bot, broadcast, settings, catalog, orders, users };
}
