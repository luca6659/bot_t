// Главное меню, команды и общий выход из любого диалога.
import { Composer, InlineKeyboard } from "grammy";
import type { MyContext } from "../../bot/context.js";
import { t } from "../../i18n/texts.js";
import { action, navRow, show } from "../../views/screen.js";
import type { CartRepository } from "../cart/cart.repository.js";
import type { SettingsService } from "../settings/settings.service.js";

export function createMainMenuComposer(cart: CartRepository, settings: SettingsService): Composer<MyContext> {
  const composer = new Composer<MyContext>();

  async function mainKb(userId: number): Promise<InlineKeyboard> {
    const count = await cart.count(userId);
    return new InlineKeyboard()
      .text(t("btn.catalog"), "cat").text(t("btn.search"), "s").row()
      .text(count > 0 ? `${t("btn.cart")} (${count})` : t("btn.cart"), "cart").text(t("btn.orders"), "os:0").row()
      .text(t("btn.custom"), "cu").text(t("btn.write"), "w").row()
      .text(t("btn.hits"), "hits").text(t("btn.info"), "info");
  }

  // На шаге с телефоном под полем ввода висит обычная клавиатура: её надо убирать отдельно.
  async function leaveFlow(ctx: MyContext): Promise<void> {
    const flow = ctx.session.flow;
    ctx.session.flow = null;
    if (flow?.kind === "checkout" && flow.step === "phone") {
      await ctx.reply(t("flow.cancelled"), { reply_markup: { remove_keyboard: true } });
    }
  }

  async function showMain(ctx: MyContext): Promise<void> {
    await show(ctx, { text: t("greeting"), kb: await mainKb(ctx.from!.id), photo: settings.get("menu_banner") ?? null });
  }

  composer.command(["start", "menu", "cancel"], async (ctx) => {
    await leaveFlow(ctx);
    const kb = await mainKb(ctx.from!.id);
    const banner = settings.get("menu_banner");
    if (banner) await ctx.replyWithPhoto(banner, { caption: t("greeting"), parse_mode: "HTML", reply_markup: kb });
    else await ctx.reply(t("greeting"), { parse_mode: "HTML", reply_markup: kb });
  });

  action(composer, "m", async (ctx) => {
    await leaveFlow(ctx);
    await showMain(ctx);
  });

  action(composer, "x", async (ctx) => {
    await leaveFlow(ctx);
    await ctx.answerCallbackQuery({ text: t("flow.cancelled") });
    await showMain(ctx);
  });

  action(composer, "info", async (ctx) => {
    const text = `${t("about_info")}\n\n${t("delivery_info")}\n\n<b>Самовывоз</b>\n${t("pickup_info")}`;
    await show(ctx, { text, kb: navRow(new InlineKeyboard(), "m"), photo: settings.get("menu_banner") ?? null });
  });

  action(composer, "noop", async () => {});

  return composer;
}
