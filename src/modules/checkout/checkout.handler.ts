// Оформление: имя → телефон → доставка → адрес (у курьера) → комментарий → подтверждение.
// Один и тот же диалог для заказа из корзины и для своей модели после согласия с ценой.
import { Composer, InlineKeyboard, Keyboard } from "grammy";
import type { CheckoutStep, DeliveryMethod, Flow, MyContext } from "../../bot/context.js";
import { t } from "../../i18n/texts.js";
import { ValidationError } from "../../infrastructure/errors.js";
import { logAction } from "../../infrastructure/logger.js";
import { esc, formatRub, normalizePhone } from "../../views/format.js";
import { action, cancelKb, navRow, show } from "../../views/screen.js";
import type { CartRepository } from "../cart/cart.repository.js";
import type { OrdersService } from "../orders/orders.service.js";
import { orderLines } from "../orders/orders.views.js";
import type { UsersRepository } from "../users/users.repository.js";

type CheckoutFlow = Extract<Flow, { kind: "checkout" }>;

function totalSteps(flow: CheckoutFlow): number {
  return flow.delivery === "pickup" ? 4 : 5;
}

export function createCheckoutComposer(
  orders: OrdersService,
  cart: CartRepository,
  users: UsersRepository,
): Composer<MyContext> {
  const composer = new Composer<MyContext>();

  function flowOf(ctx: MyContext): CheckoutFlow {
    const flow = ctx.session.flow;
    if (flow?.kind !== "checkout") throw new ValidationError("Оформление уже завершено. Начни заново.");
    return flow;
  }

  function stepKb(extra?: InlineKeyboard): InlineKeyboard {
    const kb = extra ?? new InlineKeyboard();
    return kb.row().text(t("btn.back"), "cb").text(t("btn.cancel"), "x");
  }

  async function withSaved(ctx: MyContext, field: "name" | "address"): Promise<InlineKeyboard> {
    const user = await users.get(ctx.from!.id);
    const saved = field === "name" ? user?.savedName : user?.savedAddress;
    const kb = new InlineKeyboard();
    if (saved) kb.text(t("checkout.use_saved", { value: saved.slice(0, 40) }), `cs:${field}`).row();
    return stepKb(kb);
  }

  async function ask(ctx: MyContext, flow: CheckoutFlow): Promise<void> {
    const total = totalSteps(flow);
    if (flow.step === "name") {
      return show(ctx, { text: t("checkout.name", { total }), kb: await withSaved(ctx, "name") });
    }
    if (flow.step === "phone") {
      const kb = new Keyboard()
        .requestContact(t("btn.share_contact")).row()
        .text(t("btn.back")).text(t("btn.cancel"))
        .resized().oneTime();
      await ctx.reply(t("checkout.phone", { total }), { reply_markup: kb });
      const user = await users.get(ctx.from!.id);
      if (user?.savedPhone) {
        await ctx.reply("Или возьмём прошлый номер:", {
          reply_markup: new InlineKeyboard().text(t("checkout.use_saved", { value: user.savedPhone }), "cs:phone"),
        });
      }
      return;
    }
    if (flow.step === "delivery") {
      const kb = new InlineKeyboard()
        .text(t("btn.courier"), "d:courier").row()
        .text(t("btn.pickup"), "d:pickup");
      return show(ctx, { text: t("checkout.delivery", { total }), kb: stepKb(kb) });
    }
    if (flow.step === "address") {
      return show(ctx, { text: t("checkout.address", { total }), kb: await withSaved(ctx, "address") });
    }
    if (flow.step === "comment") {
      const kb = new InlineKeyboard().text(t("btn.skip"), "cskip");
      return show(ctx, { text: t("checkout.comment", { step: total, total }), kb: stepKb(kb) });
    }
    await showSummary(ctx, flow);
  }

  async function showSummary(ctx: MyContext, flow: CheckoutFlow): Promise<void> {
    let lines: string;
    let subtotal: number;
    if (flow.orderId) {
      const order = await orders.getOwned(flow.orderId, ctx.from!.id);
      lines = orderLines(order);
      subtotal = order.subtotal ?? 0;
    } else {
      const items = await cart.items(ctx.from!.id);
      if (items.length === 0) throw new ValidationError("Корзина пуста.");
      lines = items.map((i) => `• ${esc(i.name)}: ${i.qty} × ${formatRub(i.price)}`).join("\n");
      subtotal = items.reduce((sum, i) => sum + i.qty * i.price, 0);
    }
    const delivery = flow.delivery === "courier" ? t("btn.courier") : t("btn.pickup");
    const parts = [
      lines,
      `Получение: ${delivery}\nПолучатель: ${esc(flow.name!)}\nТелефон: ${esc(flow.phone!)}${flow.address ? `\nАдрес: ${esc(flow.address)}` : ""}${flow.comment ? `\nКомментарий: ${esc(flow.comment)}` : ""}`,
      flow.delivery === "pickup" ? `Самовывоз: ${t("pickup_info")}` : "Стоимость доставки появится в счёте.",
      `Товары: <b>${formatRub(subtotal)}</b>`,
    ];
    const kb = new InlineKeyboard().text(t("btn.confirm"), "cf");
    await show(ctx, { text: t("checkout.summary", { details: parts.join("\n\n") }), kb: stepKb(kb) });
  }

  const PREVIOUS: Partial<Record<CheckoutStep, CheckoutStep>> = {
    phone: "name",
    delivery: "phone",
    address: "delivery",
    comment: "address",
    confirm: "comment",
  };

  function goBack(flow: CheckoutFlow): void {
    let prev = PREVIOUS[flow.step];
    // У самовывоза шага с адресом нет.
    if (prev === "address" && flow.delivery === "pickup") prev = "delivery";
    if (prev) flow.step = prev;
  }

  async function advance(ctx: MyContext, flow: CheckoutFlow): Promise<void> {
    if (flow.step === "name") flow.step = "phone";
    else if (flow.step === "phone") flow.step = "delivery";
    else if (flow.step === "delivery") flow.step = flow.delivery === "courier" ? "address" : "comment";
    else if (flow.step === "address") flow.step = "comment";
    else if (flow.step === "comment") flow.step = "confirm";
    await ask(ctx, flow);
  }

  action(composer, "co", async (ctx) => {
    if ((await cart.count(ctx.from!.id)) === 0) throw new ValidationError("Корзина пуста.");
    const flow: CheckoutFlow = { kind: "checkout", step: "name" };
    ctx.session.flow = flow;
    await ask(ctx, flow);
  });

  // Покупатель согласился с ценой своей модели: дальше обычное оформление.
  action(composer, /^qa:(\d+)$/, async (ctx) => {
    const order = await orders.acceptQuote(Number(ctx.match[1]), ctx.from!.id);
    logAction("order.quote_accepted", ctx, { orderId: order.id });
    const flow: CheckoutFlow = { kind: "checkout", step: "name", orderId: order.id };
    ctx.session.flow = flow;
    await ask(ctx, flow);
  });

  // Покупатель согласился с ценой, но прервал оформление и вернулся позже.
  action(composer, /^qc:(\d+)$/, async (ctx) => {
    const order = await orders.getOwned(Number(ctx.match[1]), ctx.from!.id);
    if (order.status !== "new" || !order.quoteAccepted || order.delivery) throw new ValidationError("Этот заказ уже оформлен.");
    const flow: CheckoutFlow = { kind: "checkout", step: "name", orderId: order.id };
    ctx.session.flow = flow;
    await ask(ctx, flow);
  });

  action(composer, /^d:(courier|pickup)$/, async (ctx) => {
    const flow = flowOf(ctx);
    flow.delivery = ctx.match[1] as DeliveryMethod;
    await advance(ctx, flow);
  });

  action(composer, "cb", async (ctx) => {
    const flow = flowOf(ctx);
    goBack(flow);
    await ask(ctx, flow);
  });

  action(composer, "cskip", async (ctx) => {
    const flow = flowOf(ctx);
    if (flow.step !== "comment") return;
    flow.comment = undefined;
    await advance(ctx, flow);
  });

  action(composer, /^cs:(name|phone|address)$/, async (ctx) => {
    const flow = flowOf(ctx);
    const user = await users.get(ctx.from!.id);
    const field = ctx.match[1];
    if (field === "name" && flow.step === "name" && user?.savedName) flow.name = user.savedName;
    else if (field === "phone" && flow.step === "phone" && user?.savedPhone) {
      flow.phone = user.savedPhone;
      await ctx.reply(`Телефон: ${esc(user.savedPhone)} ✅`, { reply_markup: { remove_keyboard: true } });
    } else if (field === "address" && flow.step === "address" && user?.savedAddress) flow.address = user.savedAddress;
    else return;
    await advance(ctx, flow);
  });

  action(composer, "cf", async (ctx) => {
    const flow = flowOf(ctx);
    if (flow.step !== "confirm" || !flow.delivery || !flow.name || !flow.phone) {
      throw new ValidationError("Оформление уже завершено. Начни заново.");
    }
    const contacts = {
      delivery: flow.delivery,
      fullName: flow.name,
      phone: flow.phone,
      address: flow.delivery === "courier" ? flow.address ?? null : null,
      comment: flow.comment ?? null,
    };
    const userId = ctx.from!.id;
    const { order, invoiced } = flow.orderId
      ? await orders.setCustomContacts(flow.orderId, userId, contacts)
      : await orders.createFromCart(userId, contacts);

    ctx.session.flow = null;
    await users.saveContacts(userId, contacts.fullName, contacts.phone, contacts.address);
    logAction("order.placed", ctx, { orderId: order.id, invoiced });

    const text = invoiced ? `✅ Заказ №${order.id} оформлен! Счёт выше 👆` : t("checkout.waiting_delivery", { id: order.id });
    await show(ctx, { text, kb: navRow(new InlineKeyboard().text(t("btn.orders"), `o:${order.id}`), "m") });
  });

  composer.on("message", async (ctx, next) => {
    const flow = ctx.session.flow;
    if (flow?.kind !== "checkout") return next();
    const text = ctx.msg.text?.trim();

    if (flow.step === "phone" && (text === t("btn.cancel") || text === t("btn.back"))) {
      if (text === t("btn.back")) {
        goBack(flow);
        await ctx.reply(t("flow.cancelled"), { reply_markup: { remove_keyboard: true } });
        return ask(ctx, flow);
      }
      ctx.session.flow = null;
      return ctx.reply(t("flow.cancelled"), { reply_markup: { remove_keyboard: true } }).then(() =>
        ctx.reply("Вернуться в меню:", { reply_markup: new InlineKeyboard().text(t("btn.main"), "m") }),
      );
    }

    if (flow.step === "name") {
      if (!text) return ctx.reply(t("checkout.need_text"), { reply_markup: cancelKb() });
      if (text.length < 2 || text.length > 100) return ctx.reply(t("checkout.bad_name"), { reply_markup: cancelKb() });
      flow.name = text;
      return advance(ctx, flow);
    }

    if (flow.step === "phone") {
      const contact = ctx.msg.contact;
      const raw = contact && contact.user_id === ctx.from.id ? contact.phone_number : text;
      const phone = raw ? normalizePhone(raw) : null;
      if (!phone) return ctx.reply(t("checkout.bad_phone"));
      flow.phone = phone;
      await ctx.reply(`Телефон: ${esc(phone)} ✅`, { reply_markup: { remove_keyboard: true } });
      return advance(ctx, flow);
    }

    if (flow.step === "address") {
      const loc = ctx.msg.location;
      if (loc) {
        flow.address = `📍 ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)} · https://yandex.ru/maps/?pt=${loc.longitude},${loc.latitude}`;
        return advance(ctx, flow);
      }
      if (!text) return ctx.reply(t("checkout.need_text"), { reply_markup: cancelKb() });
      if (text.length < 5 || text.length > 300) return ctx.reply(t("checkout.bad_address"), { reply_markup: cancelKb() });
      flow.address = text;
      return advance(ctx, flow);
    }

    if (flow.step === "comment") {
      if (!text) return ctx.reply(t("checkout.need_text"), { reply_markup: cancelKb() });
      flow.comment = text.slice(0, 500);
      return advance(ctx, flow);
    }

    // На шагах с кнопками ввод текста просто напоминает про них.
    return ask(ctx, flow);
  });

  return composer;
}
