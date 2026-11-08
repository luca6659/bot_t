// Кнопки под карточкой заказа в группе админов и связанный с ними ввод.
import { Composer, InlineKeyboard } from "grammy";
import type { AdminAction, MyContext } from "../../bot/context.js";
import { logAction } from "../../infrastructure/logger.js";
import { parseRub } from "../../views/format.js";
import { action, cancelKb, show, threadOf } from "../../views/screen.js";
import type { OrdersService } from "../orders/orders.service.js";
import type { Order, OrderStatus } from "../orders/orders.types.js";
import { adminOrderKb, orderDetails } from "../orders/orders.views.js";

const DIRECT: Record<string, OrderStatus> = {
  paid: "paid",
  reject: "awaiting_payment",
  printing: "printing",
  ready: "ready",
  done: "done",
  courier_skip: "courier",
  cancel_skip: "cancelled",
};

export function showCard(ctx: MyContext, order: Order): Promise<void> {
  return show(ctx, { text: orderDetails(order), kb: adminOrderKb(order) });
}

export function createOrderActions(orders: OrdersService) {
  const composer = new Composer<MyContext>();

  function startInput(ctx: MyContext, a: AdminAction, prompt: string, kb = cancelKb("a:x")): Promise<unknown> {
    ctx.session.flow = { kind: "admin", threadId: threadOf(ctx) ?? null, action: a };
    return ctx.reply(prompt, { reply_markup: kb, message_thread_id: threadOf(ctx) });
  }

  action(composer, /^ao:(\d+):(\w+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const op = ctx.match[2]!;
    const actor = `admin:${ctx.from!.id}`;

    const direct = DIRECT[op];
    if (direct) {
      const order = await orders.adminTransition(id, direct, actor);
      ctx.session.flow = null;
      logAction("order.status", ctx, { orderId: id, status: direct });
      return showCard(ctx, order);
    }
    if (op === "quote") {
      return startInput(ctx, { type: "quote_price", orderId: id }, `💰 Цена заказа №${id} в рублях:`);
    }
    if (op === "dcost") {
      return startInput(ctx, { type: "delivery_cost", orderId: id }, `🚚 Стоимость доставки заказа №${id} в рублях:`);
    }
    if (op === "courier") {
      const kb = new InlineKeyboard().text("Без ссылки", `ao:${id}:courier_skip`).row().text("❌ Отмена", "a:x");
      return startInput(ctx, { type: "tracking", orderId: id }, `🚚 Ссылка отслеживания Яндекса для заказа №${id}:`, kb);
    }
    if (op === "cancel") {
      const kb = new InlineKeyboard().text("Без причины", `ao:${id}:cancel_skip`).row().text("⬅️ Не отменять", "a:x");
      return startInput(ctx, { type: "cancel_reason", orderId: id }, `🚫 Причина отмены заказа №${id}. Её увидит покупатель:`, kb);
    }
  });

  // Возвращает true, если ввод относится к заказам.
  async function handleInput(ctx: MyContext, a: AdminAction, text: string | undefined): Promise<boolean> {
    const actor = `admin:${ctx.from!.id}`;
    const thread = { message_thread_id: threadOf(ctx) };

    const finish = async (order: Order) => {
      ctx.session.flow = null;
      await ctx.reply(orderDetails(order), { parse_mode: "HTML", reply_markup: adminOrderKb(order), ...thread });
    };
    const money = async (): Promise<number | null> => {
      const value = text ? parseRub(text) : null;
      if (value === null) await ctx.reply("Напиши сумму числом, например 1500.", { reply_markup: cancelKb("a:x"), ...thread });
      return value;
    };

    switch (a.type) {
      case "quote_price": {
        const price = await money();
        if (price === null) return true;
        ctx.session.flow = { kind: "admin", threadId: threadOf(ctx) ?? null, action: { type: "quote_deadline", orderId: a.orderId, price } };
        await ctx.reply("⏳ Срок изготовления, например «5 дней»:", { reply_markup: cancelKb("a:x"), ...thread });
        return true;
      }
      case "quote_deadline": {
        if (!text) {
          await ctx.reply("Напиши срок текстом.", { reply_markup: cancelKb("a:x"), ...thread });
          return true;
        }
        await finish(await orders.setQuote(a.orderId, a.price, text.slice(0, 100)));
        return true;
      }
      case "delivery_cost": {
        const cost = await money();
        if (cost === null) return true;
        await finish(await orders.setDeliveryCost(a.orderId, cost));
        return true;
      }
      case "tracking": {
        if (!text) {
          await ctx.reply("Пришли ссылку текстом.", { reply_markup: cancelKb("a:x"), ...thread });
          return true;
        }
        await finish(await orders.adminTransition(a.orderId, "courier", actor, { tracking: text.slice(0, 500) }));
        return true;
      }
      case "cancel_reason": {
        if (!text) {
          await ctx.reply("Напиши причину текстом.", { reply_markup: cancelKb("a:x"), ...thread });
          return true;
        }
        await finish(await orders.adminTransition(a.orderId, "cancelled", actor, { reason: text.slice(0, 500) }));
        return true;
      }
      default:
        return false;
    }
  }

  return { composer, handleInput };
}
