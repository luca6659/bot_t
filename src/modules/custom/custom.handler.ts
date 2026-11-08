// Заявка на свою модель: идея и референсы, пожелания и сроки, подтверждение.
import { Composer, InlineKeyboard } from "grammy";
import type { Flow, MyContext } from "../../bot/context.js";
import { fileTooBig } from "../../bot/guards.js";
import { t } from "../../i18n/texts.js";
import { ValidationError } from "../../infrastructure/errors.js";
import { logAction } from "../../infrastructure/logger.js";
import { esc } from "../../views/format.js";
import { action, cancelKb, navRow, show } from "../../views/screen.js";
import type { OrdersService } from "../orders/orders.service.js";

type CustomFlow = Extract<Flow, { kind: "custom" }>;

const MAX_PHOTOS = 10;
const MAX_TEXT = 1500;
const MAX_PER_DAY = 5;

function descriptionKb(): InlineKeyboard {
  return new InlineKeyboard().text(t("btn.done"), "cud").row().text(t("btn.cancel"), "x");
}

function stepKb(extra?: InlineKeyboard): InlineKeyboard {
  return (extra ?? new InlineKeyboard()).row().text(t("btn.back"), "cub").text(t("btn.cancel"), "x");
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
      `✨ ${esc(flow.description || "по фото")}`,
      `🖼 Фото: ${flow.photos.length}`,
      `📝 Пожелания: ${esc(flow.wishes || "без особенностей")}`,
    ];
    const kb = new InlineKeyboard().text(t("btn.confirm"), "cuf");
    return show(ctx, { text: t("custom.summary", { details: lines.join("\n") }), kb: stepKb(kb) });
  }

  action(composer, "cu", async (ctx) => {
    if ((await orders.customCountToday(ctx.from!.id)) >= MAX_PER_DAY) {
      throw new ValidationError(t("custom.daily_limit"));
    }
    ctx.session.flow = { kind: "custom", step: "description", description: "", photos: [] };
    await show(ctx, { text: t("custom.description"), kb: descriptionKb() });
  });

  action(composer, "cud", async (ctx) => {
    const flow = flowOf(ctx);
    if (!flow.description && flow.photos.length === 0) throw new ValidationError(t("custom.need_description"));
    flow.step = "wishes";
    await show(ctx, { text: t("custom.wishes"), kb: stepKb(new InlineKeyboard().text(t("btn.skip"), "cuw")) });
  });

  action(composer, "cuw", async (ctx) => {
    const flow = flowOf(ctx);
    flow.wishes = undefined;
    flow.step = "confirm";
    await showSummary(ctx, flow);
  });

  action(composer, "cub", async (ctx) => {
    const flow = flowOf(ctx);
    flow.step = flow.step === "confirm" ? "wishes" : "description";
    if (flow.step === "description") await show(ctx, { text: t("custom.description"), kb: descriptionKb() });
    else await show(ctx, { text: t("custom.wishes"), kb: stepKb(new InlineKeyboard().text(t("btn.skip"), "cuw")) });
  });

  action(composer, "cuf", async (ctx) => {
    const flow = flowOf(ctx);
    if (flow.step !== "confirm") throw new ValidationError("Заявка ещё не заполнена.");
    if ((await orders.customCountToday(ctx.from!.id)) >= MAX_PER_DAY) throw new ValidationError(t("custom.daily_limit"));
    const order = await orders.createCustom(ctx.from!.id, flow.description, flow.wishes ?? "", flow.photos);
    ctx.session.flow = null;
    logAction("order.custom_created", ctx, { orderId: order.id });
    await show(ctx, { text: t("custom.created", { id: order.id }), kb: navRow(new InlineKeyboard().text(t("btn.orders"), `o:${order.id}`), "m") });
  });

  composer.on("message", async (ctx, next) => {
    const flow = ctx.session.flow;
    if (flow?.kind !== "custom") return next();
    const text = ctx.msg.text?.trim();

    if (flow.step === "description") {
      if (fileTooBig(ctx.msg)) return ctx.reply(t("error.file_too_big"), { reply_markup: descriptionKb() });
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

    if (flow.step === "wishes") {
      if (!text) return ctx.reply(t("custom.wishes"), { reply_markup: stepKb() });
      flow.wishes = text.slice(0, 500);
      flow.step = "confirm";
      return showSummary(ctx, flow);
    }

    return showSummary(ctx, flow);
  });

  return composer;
}
