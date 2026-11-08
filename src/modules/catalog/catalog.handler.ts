// Каталог, поиск и хиты: карточка модельки с фото-галереей и листанием по списку.
import { Composer, InlineKeyboard } from "grammy";
import type { ListRef, MyContext } from "../../bot/context.js";
import { t } from "../../i18n/texts.js";
import { NotFoundError } from "../../infrastructure/errors.js";
import { logAction } from "../../infrastructure/logger.js";
import { esc, formatRub } from "../../views/format.js";
import { action, cancelKb, navRow, show } from "../../views/screen.js";
import type { CartRepository } from "../cart/cart.repository.js";
import type { SettingsService } from "../settings/settings.service.js";
import type { CatalogRepository, Product } from "./catalog.repository.js";

export function createCatalogComposer(
  catalog: CatalogRepository,
  cart: CartRepository,
  settings: SettingsService,
): Composer<MyContext> {
  const composer = new Composer<MyContext>();

  function backData(list: ListRef | null): string {
    if (list?.type === "category") return "cat";
    if (list?.type === "search") return "s";
    return "m";
  }

  function caption(p: Product): string {
    const badges = `${p.isHit ? " 🔥 Хит" : ""}${p.isNew ? " 🆕 Новинка" : ""}`;
    const lines = [
      `<b>${esc(p.name)}</b>${badges}`,
      `💰 ${formatRub(p.price)} · ${t(p.stock === "in_stock" ? "catalog.in_stock" : "catalog.on_order")}`,
    ];
    if (p.description) lines.push("", esc(p.description));
    return lines.join("\n");
  }

  async function showProduct(ctx: MyContext, p: Product, photoIdx: number, keepPhoto = false): Promise<void> {
    if (!p.active) throw new NotFoundError(`product ${p.id}`, "Этой игрушки уже нет в продаже.");
    const idx = p.photos.length ? ((photoIdx % p.photos.length) + p.photos.length) % p.photos.length : 0;

    const kb = new InlineKeyboard();
    if (p.photos.length > 1) {
      kb.text("⬅️", `ph:${p.id}:${idx - 1}`).text(`${idx + 1}/${p.photos.length}`, "noop").text("➡️", `ph:${p.id}:${idx + 1}`).row();
    }
    if (ctx.session.list) {
      kb.text("⏪", `pp:${p.id}`).text(t("btn.catalog"), backData(ctx.session.list)).text("⏩", `pn:${p.id}`).row();
    }
    kb.text(t("btn.add_to_cart"), `add:${p.id}`).row();
    const count = await cart.count(ctx.from!.id);
    if (count > 0) kb.text(`${t("btn.cart")} (${count})`, "cart").row();
    navRow(kb, backData(ctx.session.list));

    await show(ctx, { text: caption(p), kb, photo: p.photos[idx] ?? settings.get("menu_banner") ?? null, keepPhoto });
  }

  // Открыть список (категория/поиск/хиты) — сразу показываем первую карточку.
  async function openList(ctx: MyContext, list: ListRef): Promise<void> {
    const first =
      list.type === "category"
        ? (await catalog.byCategory(list.id, 0)).items[0]
        : list.type === "search"
          ? (await catalog.search(list.query, 0)).items[0]
          : (await catalog.hits(0)).items[0];

    if (!first) {
      const text =
        list.type === "category"
          ? t("catalog.category_empty")
          : list.type === "search"
            ? t("search.empty", { query: esc(list.query) })
            : t("catalog.hits_empty");
      const kb = new InlineKeyboard().text(t("btn.custom"), "cu").row();
      if (list.type === "search") kb.text(t("btn.search"), "s").row();
      const photo = list.type === "category" ? (await catalog.category(list.id))?.photo : null;
      return show(ctx, { text, kb: navRow(kb, backData(list)), photo: photo ?? settings.get("menu_banner") ?? null });
    }

    ctx.session.list = list;
    await showProduct(ctx, first, 0);
  }

  action(composer, "cat", async (ctx) => {
    const categories = await catalog.categories(true);
    if (categories.length === 0) {
      return show(ctx, { text: t("catalog.empty"), kb: navRow(new InlineKeyboard(), "m") });
    }
    const kb = new InlineKeyboard();
    for (const c of categories) kb.text(`🧸 ${c.name}`, `c:${c.id}`).row();
    await show(ctx, { text: t("catalog.title"), kb: navRow(kb, "m"), photo: settings.get("menu_banner") ?? null });
  });

  action(composer, /^c:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const category = await catalog.category(id);
    if (!category || !category.active) throw new NotFoundError(`category ${id}`);
    await openList(ctx, { type: "category", id });
  });

  action(composer, /^p:(\d+)$/, async (ctx) => {
    const p = await catalog.product(Number(ctx.match[1]));
    if (!p) throw new NotFoundError(`product ${ctx.match[1]}`, "Этой игрушки уже нет в продаже.");
    await showProduct(ctx, p, 0);
  });

  action(composer, /^ph:(\d+):(-?\d+)$/, async (ctx) => {
    const p = await catalog.product(Number(ctx.match[1]));
    if (!p) throw new NotFoundError(`product ${ctx.match[1]}`, "Этой игрушки уже нет в продаже.");
    await showProduct(ctx, p, Number(ctx.match[2]));
  });

  action(composer, /^(pn|pp):(\d+)$/, async (ctx) => {
    const p = await catalog.product(Number(ctx.match[2]));
    const list = ctx.session.list;
    if (!p || !list) throw new NotFoundError(`product ${ctx.match[2]}`);
    const next = await catalog.neighbor(p, list, ctx.match[1] === "pn" ? 1 : -1);
    if (!next || next.id === p.id) {
      await ctx.answerCallbackQuery({ text: "Здесь только эта моделька 🙂" });
      return;
    }
    await showProduct(ctx, next, 0);
  });

  action(composer, /^add:(\d+)$/, async (ctx) => {
    const p = await catalog.product(Number(ctx.match[1]));
    if (!p || !p.active) throw new NotFoundError(`product ${ctx.match[1]}`, "Этой игрушки уже нет в продаже.");
    await cart.add(ctx.from!.id, p.id);
    logAction("cart.add", ctx, { productId: p.id });
    await ctx.answerCallbackQuery({ text: t("catalog.added") });
    await showProduct(ctx, p, 0, true);
  });

  action(composer, "s", async (ctx) => {
    ctx.session.flow = { kind: "search" };
    await show(ctx, { text: t("search.prompt"), kb: cancelKb() });
  });

  action(composer, "hits", (ctx) => openList(ctx, { type: "hits" }));

  composer.chatType("private").on("message", async (ctx, next) => {
    if (ctx.session.flow?.kind !== "search") return next();
    const query = ctx.msg.text?.trim();
    if (!query) return ctx.reply(t("search.prompt"), { reply_markup: cancelKb() });
    ctx.session.flow = null;
    logAction("catalog.search", ctx, { query: query.slice(0, 100) });
    await openList(ctx, { type: "search", query: query.slice(0, 100) });
  });

  return composer;
}
