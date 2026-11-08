import { Composer, InlineKeyboard } from "grammy";
import type { MyContext } from "../../bot/context.js";
import { t } from "../../i18n/texts.js";
import { esc, formatRub } from "../../views/format.js";
import { action, navRow, show } from "../../views/screen.js";
import type { SettingsService } from "../settings/settings.service.js";
import type { CartRepository } from "./cart.repository.js";

export function createCartComposer(cart: CartRepository, settings: SettingsService): Composer<MyContext> {
  const composer = new Composer<MyContext>();

  async function showCart(ctx: MyContext): Promise<void> {
    const items = await cart.items(ctx.from!.id);
    if (items.length === 0) {
      const kb = new InlineKeyboard().text(t("btn.catalog"), "cat");
      return show(ctx, { text: t("cart.empty"), kb: navRow(kb, "m"), photo: settings.get("menu_banner") ?? null });
    }

    const lines = items.map((i) => `• ${esc(i.name)}: ${i.qty} × ${formatRub(i.price)} = ${formatRub(i.qty * i.price)}`);
    const total = items.reduce((sum, i) => sum + i.qty * i.price, 0);

    const kb = new InlineKeyboard();
    for (const i of items) {
      kb.text(`🧸 ${i.name}`, "noop").row();
      kb.text("➖", `ci:${i.id}:dec`).text(`${i.qty} шт`, "noop").text("➕", `ci:${i.id}:inc`).text("🗑", `ci:${i.id}:del`).row();
    }
    kb.text(t("btn.checkout"), "co").row().text(t("btn.clear_cart"), "cc");

    await show(ctx, {
      text: `${t("cart.title")}\n\n${lines.join("\n")}\n\n${t("cart.total", { total: formatRub(total) })}`,
      kb: navRow(kb, "m"),
      photo: items.find((i) => i.photo)?.photo ?? settings.get("menu_banner") ?? null,
    });
  }

  action(composer, "cart", showCart);

  action(composer, /^ci:(\d+):(inc|dec|del)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const op = ctx.match[2];
    if (op === "del") await cart.remove(ctx.from!.id, id);
    else await cart.changeQty(ctx.from!.id, id, op === "inc" ? 1 : -1);
    await showCart(ctx);
  });

  action(composer, "cc", async (ctx) => {
    await cart.clear(ctx.from!.id);
    await showCart(ctx);
  });

  return composer;
}
