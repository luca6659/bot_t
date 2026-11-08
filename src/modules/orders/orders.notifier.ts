// Доставка событий заказа в Telegram. Единственное место, где сервис заказов касается Bot API.
import { GrammyError, InlineKeyboard, type Api } from "grammy";
import { t } from "../../i18n/texts.js";
import { logger } from "../../infrastructure/logger.js";
import type { TopicsService } from "../relay/topics.service.js";
import type { UsersRepository } from "../users/users.repository.js";
import type { OrderNotifier } from "./orders.service.js";
import { adminOrderKb, invoiceText, orderDetails } from "./orders.views.js";
import { esc, formatRub } from "../../views/format.js";
import type { Order } from "./orders.types.js";

function statusMessage(o: Order, previous: string): string | null {
  const id = o.id;
  switch (o.status) {
    case "awaiting_payment":
      return previous === "receipt_check" ? t("status.awaiting_payment.rejected", { id }) : null;
    case "paid":
      return t("status.paid", { id });
    case "printing":
      return t("status.printing", { id });
    case "ready":
      return o.delivery === "pickup"
        ? t("status.ready.pickup", { id, pickup: t("pickup_info") })
        : t("status.ready.courier", { id });
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
): OrderNotifier {
  // Покупатель мог заблокировать бота: это не должно ломать работу админа.
  async function toClient(o: Order, text: string, kb?: InlineKeyboard): Promise<void> {
    try {
      await api.sendMessage(o.userId, text, { parse_mode: "HTML", reply_markup: kb });
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

  return {
    async invoice(o) {
      const kb = new InlineKeyboard()
        .text(t("btn.send_receipt"), `r:${o.id}`).row()
        .text(t("btn.cancel_order"), `ox:${o.id}`).row()
        .text(t("btn.main"), "m");
      await toClient(o, invoiceText(o), kb);
    },

    async quote(o) {
      const kb = new InlineKeyboard()
        .text(t("btn.accept_quote"), `qa:${o.id}`)
        .text(t("btn.reject_quote"), `qr:${o.id}`);
      await toClient(o, t("custom.quote", { id: o.id, price: formatRub(o.subtotal ?? 0), deadline: esc(o.deadline ?? "") }), kb);
    },

    async statusChanged(o, previous) {
      const text = statusMessage(o, previous);
      if (!text) return;
      const kb = o.status === "awaiting_payment"
        ? new InlineKeyboard().text(t("btn.send_receipt"), `r:${o.id}`).row().text(t("btn.main"), "m")
        : orderKb(o);
      await toClient(o, text, kb);
    },

    async orderCard(o, note) {
      const text = note ? `${note}\n\n${orderDetails(o)}` : orderDetails(o);
      await topics.withTopic(o.userId, (threadId) =>
        api.sendMessage(adminGroupId, text, { parse_mode: "HTML", reply_markup: adminOrderKb(o), message_thread_id: threadId }),
      );
      await topics.labelWithOrder(o.userId, o.id);
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
