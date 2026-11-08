// Анонимная переписка: покупатель пишет боту, админ отвечает в теме. copyMessage не показывает автора.
import { Composer, GrammyError, InlineKeyboard } from "grammy";
import type { MyContext } from "../../bot/context.js";
import { t } from "../../i18n/texts.js";
import { logger, logAction } from "../../infrastructure/logger.js";
import { action, cancelKb, show } from "../../views/screen.js";
import type { OrdersService } from "../orders/orders.service.js";
import type { UsersRepository } from "../users/users.repository.js";
import type { TopicsService } from "./topics.service.js";

const ACK_INTERVAL_MS = 10 * 60 * 1000;

export function createClientRelayComposer(
  adminGroupId: number,
  topics: TopicsService,
  orders: OrdersService,
): Composer<MyContext> {
  const composer = new Composer<MyContext>();

  action(composer, /^w(?::(\d+))?$/, async (ctx) => {
    const orderId = ctx.match[1] ? Number(ctx.match[1]) : null;
    if (orderId) await orders.getOwned(orderId, ctx.from!.id);
    ctx.session.flow = { kind: "ask", orderId };
    const text = orderId ? t("relay.prompt_order", { id: orderId }) : t("relay.prompt");
    await show(ctx, { text, kb: cancelKb() });
  });

  // Последнее звено цепочки: всё, что не поймали диалоги, уходит в тему покупателя.
  composer.on("message", async (ctx) => {
    if (ctx.msg.text?.startsWith("/")) {
      await ctx.reply(t("unknown_command"), { reply_markup: new InlineKeyboard().text(t("btn.main"), "m") });
      return;
    }

    const flow = ctx.session.flow?.kind === "ask" ? ctx.session.flow : null;
    const userId = ctx.from.id;
    const messageId = ctx.msg.message_id;

    await topics.withTopic<unknown>(userId, async (threadId) => {
      if (flow?.orderId) {
        await ctx.api.sendMessage(adminGroupId, `💬 Сообщение по заказу №${flow.orderId}:`, { message_thread_id: threadId });
      }
      return ctx.api.copyMessage(adminGroupId, userId, messageId, { message_thread_id: threadId });
    });
    logAction("relay.to_admins", ctx, { orderId: flow?.orderId });

    const now = Date.now();
    if (flow || now - ctx.session.lastAckAt > ACK_INTERVAL_MS) {
      ctx.session.flow = null;
      ctx.session.lastAckAt = now;
      await ctx.reply(t("relay.ack"), { reply_markup: new InlineKeyboard().text(t("btn.main"), "m") });
    }
  });

  return composer;
}

export function createAdminRelayComposer(users: UsersRepository): Composer<MyContext> {
  const composer = new Composer<MyContext>();

  composer.on("message", async (ctx) => {
    const msg = ctx.msg;
    // Служебные сообщения тем копировать нельзя и незачем.
    const hasContent =
      msg.text || msg.photo || msg.document || msg.video || msg.voice || msg.audio ||
      msg.sticker || msg.animation || msg.video_note || msg.location || msg.contact;
    if (!hasContent || !msg.is_topic_message || !msg.message_thread_id) return;
    if (msg.text?.startsWith("/")) return;
    if (ctx.from.is_bot && !msg.sender_chat) return;

    const user = await users.getByTopic(msg.message_thread_id);
    if (!user) return;

    try {
      await ctx.api.copyMessage(user.id, msg.chat.id, msg.message_id);
      logAction("relay.to_client", ctx, { clientId: user.id });
    } catch (err) {
      if (!(err instanceof GrammyError)) throw err;
      logger.warn({ action: "relay.to_client_failed", clientId: user.id, err: err.description });
      if (err.error_code === 403) await users.markBlocked(user.id);
      const reason = err.error_code === 403 ? "покупатель заблокировал бота" : "Telegram не принял это сообщение";
      await ctx.reply(`⚠️ Не доставлено: ${reason}.`, {
        message_thread_id: msg.message_thread_id,
        reply_parameters: { message_id: msg.message_id },
      });
    }
  });

  return composer;
}
