// Заявка на свою модель: идея, картинки, размер, цвет.
import { Composer, InlineKeyboard } from "grammy";
import type { Flow, MyContext } from "../../bot/context.js";
import { t } from "../../i18n/texts.js";
import { ValidationError } from "../../infrastructure/errors.js";
import { logAction } from "../../infrastructure/logger.js";
import { esc } from "../../views/format.js";
import { action, cancelKb, navRow, show } from "../../views/screen.js";
import type { OrdersService } from "../orders/orders.service.js";

type CustomFlow = Extract<Flow, { kind: "custom" }>;

const MAX_PHOTOS = 10;
const MAX_TEXT = 1500;

function descriptionKb(): InlineKeyboard {
  return new InlineKeyboard().text(t("btn.done"), "cud").row().text(t("btn.cancel"), "x");
}

export function createCustomComposer(orders: OrdersService): Composer<MyContext> {
  const composer = new Composer<MyContext>();

  function flowOf(ctx: MyContext): CustomFlow {
    const flow = ctx.session.flow;
    if (flow?.kind !== "custom") throw new ValidationError("Заявка уже отправлена. Начни заново.");
    return flow;
  }

  function showSummary(ctx: MyContext, flow: CustomFlow): Promise<void> {
    const lines = [
      `✨ ${esc(flow.description || "по картинкам")}`,
      `🖼 Картинок: ${flow.photos.length}`,
      `📏 Размер: ${esc(flow.size ?? "")}`,
      `🎨 Цвет: ${esc(flow.color || "на усмотрение мастера")}`,
    ];
    const kb = new InlineKeyboard().text(t("btn.confirm"), "cuf").row().text(t("btn.cancel"), "x");
    return show(ctx, { text: t("custom.summary", { details: lines.join("\n") }), kb });
  }

  action(composer, "cu", async (ctx) => {
    ctx.session.flow = { kind: "custom", step: "description", description: "", photos: [] };
    await show(ctx, { text: t("custom.description"), kb: descriptionKb() });
  });

  action(composer, "cud", async (ctx) => {
    const flow = flowOf(ctx);
    if (!flow.description && flow.photos.length === 0) throw new ValidationError(t("custom.need_description"));
    flow.step = "size";
    await show(ctx, { text: t("custom.size"), kb: cancelKb() });
  });

  action(composer, "cus", async (ctx) => {
    const flow = flowOf(ctx);
    flow.color = "";
    flow.step = "confirm";
    await showSummary(ctx, flow);
  });

  action(composer, "cuf", async (ctx) => {
    const flow = flowOf(ctx);
    if (flow.step !== "confirm") throw new ValidationError("Заявка ещё не заполнена.");
    const order = await orders.createCustom(ctx.from!.id, flow.description, flow.size ?? "", flow.color ?? "", flow.photos);
    ctx.session.flow = null;
    logAction("order.custom_created", ctx, { orderId: order.id });
    await show(ctx, { text: t("custom.created", { id: order.id }), kb: navRow(new InlineKeyboard().text(t("btn.orders"), `o:${order.id}`), "m") });
  });

  composer.on("message", async (ctx, next) => {
    const flow = ctx.session.flow;
    if (flow?.kind !== "custom") return next();
    const text = ctx.msg.text?.trim();

    if (flow.step === "description") {
      const photo = ctx.msg.photo?.at(-1)?.file_id;
      const part = (text ?? ctx.msg.caption ?? "").trim();
      if (photo && flow.photos.length < MAX_PHOTOS) flow.photos.push(photo);
      if (part) flow.description = `${flow.description}\n${part}`.trim().slice(0, MAX_TEXT);
      if (!photo && !part) return ctx.reply(t("custom.need_description"), { reply_markup: descriptionKb() });
      // Альбом приходит несколькими сообщениями: отвечаем на него только один раз.
      const group = ctx.msg.media_group_id;
      if (group && group === ctx.session.lastMediaGroup) return;
      ctx.session.lastMediaGroup = group ?? null;
      return ctx.reply(
        t("custom.got", { text: flow.description ? "есть" : "нет", photos: flow.photos.length }),
        { reply_markup: descriptionKb() },
      );
    }

    if (flow.step === "size") {
      if (!text) return ctx.reply(t("custom.size"), { reply_markup: cancelKb() });
      flow.size = text.slice(0, 100);
      flow.step = "color";
      return ctx.reply(t("custom.color"), {
        reply_markup: new InlineKeyboard().text(t("btn.skip"), "cus").row().text(t("btn.cancel"), "x"),
      });
    }

    if (flow.step === "color") {
      if (!text) return ctx.reply(t("custom.color"), { reply_markup: cancelKb() });
      flow.color = text.slice(0, 100);
      flow.step = "confirm";
      return showSummary(ctx, flow);
    }

    return showSummary(ctx, flow);
  });

  return composer;
}
