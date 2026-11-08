// Доставка событий заказа в Telegram. Единственное место, где сервис заказов касается Bot API.
import { GrammyError, InlineKeyboard, type Api } from "grammy";
import { t } from "../../i18n/texts.js";
import { logger } from "../../infrastructure/logger.js";
import { esc, formatRub } from "../../views/format.js";
import type { PaymentProvider } from "../payment/payment.service.js";
import type { TopicsService } from "../relay/topics.service.js";
import type { UsersRepository } from "../users/users.repository.js";
import type { OrdersRepository } from "./orders.repository.js";
import type { OrderNotifier } from "./orders.service.js";
import { STATUS_LABELS, orderTotal, type Order } from "./orders.types.js";
import { adminOrderKb, orderDetails } from "./orders.views.js";

function statusMessage(o: Order, previous: string): string | null {
  const id = o.id;
  switch (o.status) {
    case "awaiting_payment":
      return previous === "receipt_check" ? t("status.awaiting_payment.rejected", { id }) : null;
    case "paid":
      return t("status.paid", { id });
    case "assembling":
      return t("status.assembling", { id });
    case "printing":
      return t("status.printing", { id });
    case "pickup_ready":
      return t("status.pickup_ready", { id, pickup: t("pickup_info") });
    case "courier":
      return o.trackingUrl
        ? t("status.courier.tracking", { id, url: esc(o.trackingUrl) })
        : t("status.courier", { id });
    case "done":
      return t("status.done", { id });
    case "cancelled":
      return o.cancelReason
        ? t("status.cancelled.reason", { id, reason: esc(o.cancelReason) })
        : t("status.cancelled", { id });
    default:
      return null;
  }
}

export function createOrderNotifier(
  api: Api,
  adminGroupId: number,
  topics: TopicsService,
  users: UsersRepository,
  orders: OrdersRepository,
  payment: PaymentProvider,
): OrderNotifier {
  // Покупатель мог заблокировать бота: это не должно ломать работу админа.
  async function toClient(o: Order, text: string, kb?: InlineKeyboard, photo?: string | null): Promise<void> {
    try {
      if (photo) await api.sendPhoto(o.userId, photo, { caption: text, parse_mode: "HTML", reply_markup: kb });
      else await api.sendMessage(o.userId, text, { parse_mode: "HTML", reply_markup: kb });
    } catch (err) {
      if (!(err instanceof GrammyError) || err.error_code !== 403) throw err;
      await users.markBlocked(o.userId);
      logger.warn({ action: "client.blocked_bot", userId: o.userId, orderId: o.id });
      await topics
        .withTopic(o.userId, (threadId) =>
          api.sendMessage(adminGroupId, `⚠️ Покупатель заблокировал бота и не получил сообщение по заказу №${o.id}.`, {
            message_thread_id: threadId,
          }),
        )
        .catch(() => {});
    }
  }

  function orderKb(o: Order): InlineKeyboard {
    return new InlineKeyboard().text(t("btn.orders"), `o:${o.id}`).text(t("btn.main"), "m");
  }

  async function clientCardText(userId: number): Promise<{ text: string; kb: InlineKeyboard } | null> {
    const user = await users.get(userId);
    if (!user) return null;
    const username = user.username ? `@${esc(user.username)}` : "без username";
    const lines = [
      `👤 <b>${esc(user.firstName)}</b> · ${username} · ID ${user.id}`,
      `📱 ${esc(user.savedPhone ?? "телефона пока нет")}${user.banned ? " · 🚫 забанен" : ""}`,
      "",
      "Отвечай в этой теме: бот передаст сообщение покупателю от своего имени.",
    ];
    const recent = (await orders.byUser(userId, 0)).items.slice(0, 5);
    if (recent.length) {
      lines.push("", "<b>Заказы:</b>");
      for (const o of recent) {
        const sum = o.subtotal === null ? "" : ` · ${formatRub(orderTotal(o))}`;
        lines.push(`№${o.id} · ${STATUS_LABELS[o.status]}${sum}`);
      }
    }
    const kb = new InlineKeyboard();
    const active = recent.find((o) => o.status !== "done" && o.status !== "cancelled");
    if (active) {
      // Кнопки смены статуса актуального заказа — прямо в закрепе.
      const orderKb = adminOrderKb(active);
      for (const row of orderKb.inline_keyboard) kb.inline_keyboard.push(row);
    }
    kb.text(user.banned ? "✅ Разбанить" : "🚫 Забанить", `ab:${user.id}`);
    return { text: lines.join("\n"), kb };
  }

  // Закреп в теме покупателя: контакты, заказы, кнопки статусов и бана. Обновляется на месте.
  async function clientCard(userId: number): Promise<void> {
    const user = await users.get(userId);
    if (!user?.topicId) return;
    const card = await clientCardText(userId);
    if (!card) return;

    if (user.pinnedMessageId) {
      try {
        await api.editMessageText(adminGroupId, user.pinnedMessageId, card.text, {
          parse_mode: "HTML",
          reply_markup: card.kb,
        });
        return;
      } catch (err) {
        if (err instanceof GrammyError && err.description.includes("message is not modified")) return;
        logger.warn({ action: "relay.client_card_edit_failed", userId, err: String(err) });
        // Закреп удалили — ниже отправим новый.
      }
    }
    // Тема уже есть (проверили выше): идти через ensure() нельзя — при вызове из onCreated
    // он ждал бы завершения создания той же темы, а оно ждёт этот вызов. Взаимная блокировка.
    const sent = await api.sendMessage(adminGroupId, card.text, {
      parse_mode: "HTML",
      reply_markup: card.kb,
      message_thread_id: user.topicId,
    });
    await api.pinChatMessage(adminGroupId, sent.message_id, { disable_notification: true }).catch((err) =>
      logger.warn({ action: "relay.pin_failed", userId, err: String(err) }),
    );
    await users.setPinnedMessage(userId, sent.message_id);
  }

  return {
    async invoice(o) {
      const view = payment.invoiceView(o);
      await toClient(o, view.text, view.kb);
    },

    async quote(o) {
      const kb = new InlineKeyboard()
        .text(t("btn.accept_quote"), `qa:${o.id}`).row()
        .text(t("btn.discuss_quote"), `w:${o.id}`)
        .text(t("btn.reject_quote"), `qr:${o.id}`);
      await toClient(o, t("custom.quote", { id: o.id, price: formatRub(o.subtotal ?? 0), deadline: esc(o.deadline ?? "") }), kb, o.quotePhotoFileId);
    },

    async statusChanged(o, previous) {
      const text = statusMessage(o, previous);
      if (!text) return;
      const kb = o.status === "awaiting_payment"
        ? new InlineKeyboard().text(t("btn.send_receipt"), `r:${o.id}`).row().text(t("btn.main"), "m")
        : orderKb(o);
      await toClient(o, text, kb, await orders.firstPhoto(o));
    },

    async orderCard(o, note) {
      const text = note ? `${note}\n\n${orderDetails(o)}` : orderDetails(o);
      await topics.withTopic(o.userId, (threadId) =>
        api.sendMessage(adminGroupId, text, { parse_mode: "HTML", reply_markup: adminOrderKb(o), message_thread_id: threadId }),
      );
      await topics.labelWithOrder(o.userId, o.id);
      await clientCard(o.userId);
    },

    clientCard,

    async systemNotice(text) {
      await topics.sendToSystem("orders", text).catch((err) => logger.warn({ action: "relay.system_notice_failed", err: String(err) }));
    },

    async receipt(o) {
      if (!o.receiptFileId) return;
      const caption = `🧾 Чек по заказу №${o.id}`;
      await topics.withTopic<unknown>(o.userId, (threadId) =>
        o.receiptKind === "photo"
          ? api.sendPhoto(adminGroupId, o.receiptFileId!, { caption, message_thread_id: threadId })
          : api.sendDocument(adminGroupId, o.receiptFileId!, { caption, message_thread_id: threadId }),
      );
    },

    async customPhotos(o) {
      for (const photo of o.photos) {
        await topics.withTopic(o.userId, (threadId) =>
          api.sendPhoto(adminGroupId, photo, { message_thread_id: threadId }),
        );
      }
    },

    async missingRequisites(o) {
      await topics.withTopic(o.userId, (threadId) =>
        api.sendMessage(
          adminGroupId,
          `⚠️ Реквизиты не заданы, покупатель не знает, куда платить за заказ №${o.id}. Напиши их здесь и задай в /admin → Тексты.`,
          { message_thread_id: threadId },
        ),
      );
    },
  };
}
