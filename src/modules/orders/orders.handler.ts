// «Мои заказы» глазами покупателя: список, карточка, чек, отмена, отказ от цены.
import { Composer, InlineKeyboard } from "grammy";
import type { MyContext } from "../../bot/context.js";
import { t } from "../../i18n/texts.js";
import { logAction } from "../../infrastructure/logger.js";
import { formatRub } from "../../views/format.js";
import { action, cancelKb, navRow, pagerRow, show } from "../../views/screen.js";
import { ORDERS_PAGE_SIZE } from "./orders.repository.js";
import type { OrdersService } from "./orders.service.js";
import { STATUS_LABELS, orderTotal } from "./orders.types.js";
import { invoiceText, orderDetails } from "./orders.views.js";

export function createOrdersComposer(orders: OrdersService): Composer<MyContext> {
  const composer = new Composer<MyContext>();

  async function showOrder(ctx: MyContext, id: number): Promise<void> {
    const order = await orders.getOwned(id, ctx.from!.id);
    const kb = new InlineKeyboard();
    if (order.status === "awaiting_payment") kb.text(t("btn.send_receipt"), `r:${id}`).row();
    if (order.type === "custom" && order.status === "new" && order.subtotal !== null && !order.quoteAccepted) {
      kb.text(t("btn.accept_quote"), `qa:${id}`).text(t("btn.reject_quote"), `qr:${id}`).row();
    }
    if (order.status === "new" && order.quoteAccepted && !order.delivery) kb.text(t("btn.continue_checkout"), `qc:${id}`).row();
    kb.text(t("btn.write_order"), `w:${id}`).row();
    if (order.status === "new" || order.status === "awaiting_payment") kb.text(t("btn.cancel_order"), `ox:${id}`).row();
    const text = order.status === "awaiting_payment" ? invoiceText(order) : orderDetails(order);
    await show(ctx, { text, kb: navRow(kb, "os:0") });
  }

  action(composer, /^os:(\d+)$/, async (ctx) => {
    const page = Number(ctx.match[1]);
    const result = await orders.list(ctx.from!.id, page);
    if (result.total === 0) {
      const kb = new InlineKeyboard().text(t("btn.catalog"), "cat");
      return show(ctx, { text: t("orders.empty"), kb: navRow(kb, "m") });
    }
    const kb = new InlineKeyboard();
    for (const o of result.items) {
      const sum = o.subtotal === null ? "" : ` · ${formatRub(orderTotal(o))}`;
      kb.text(`№${o.id} · ${STATUS_LABELS[o.status]}${sum}`, `o:${o.id}`).row();
    }
    pagerRow(kb, page, Math.ceil(result.total / ORDERS_PAGE_SIZE), (p) => `os:${p}`);
    await show(ctx, { text: t("orders.title"), kb: navRow(kb, "m") });
  });

  action(composer, /^o:(\d+)$/, (ctx) => showOrder(ctx, Number(ctx.match[1])));

  action(composer, /^r:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    await orders.getOwned(id, ctx.from!.id);
    ctx.session.flow = { kind: "receipt", orderId: id };
    await ctx.reply(t("receipt.prompt", { id }), { reply_markup: cancelKb() });
  });

  action(composer, /^qr:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    await orders.rejectQuote(id, ctx.from!.id);
    logAction("order.quote_rejected", ctx, { orderId: id });
    await show(ctx, { text: t("custom.rejected", { id }), kb: navRow(new InlineKeyboard(), "os:0") });
  });

  action(composer, /^ox:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    await orders.getOwned(id, ctx.from!.id);
    const kb = new InlineKeyboard().text(t("btn.yes_cancel"), `oxy:${id}`).text(t("btn.no_keep"), `o:${id}`);
    await show(ctx, { text: t("orders.confirm_cancel", { id }), kb });
  });

  action(composer, /^oxy:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    await orders.clientCancel(id, ctx.from!.id);
    logAction("order.client_cancelled", ctx, { orderId: id });
    await showOrder(ctx, id);
  });

  composer.on("message", async (ctx, next) => {
    const flow = ctx.session.flow;
    if (flow?.kind !== "receipt") return next();

    const photo = ctx.msg.photo?.at(-1)?.file_id;
    const doc = ctx.msg.document?.file_id;
    if (!photo && !doc) return ctx.reply(t("receipt.need_file"), { reply_markup: cancelKb() });

    const order = await orders.submitReceipt(flow.orderId, ctx.from.id, (photo ?? doc)!, photo ? "photo" : "document");
    ctx.session.flow = null;
    logAction("order.receipt", ctx, { orderId: order.id });
    await ctx.reply(t("receipt.received"), {
      reply_markup: new InlineKeyboard().text(t("btn.orders"), `o:${order.id}`).text(t("btn.main"), "m"),
    });
  });

  return composer;
}
