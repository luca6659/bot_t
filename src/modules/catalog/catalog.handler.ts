// Каталог и поиск для покупателя. Выбор размера и цвета хранится прямо в данных кнопок.
import { Composer, InlineKeyboard } from "grammy";
import type { ListRef, MyContext } from "../../bot/context.js";
import { t } from "../../i18n/texts.js";
import { NotFoundError, ValidationError } from "../../infrastructure/errors.js";
import { logAction } from "../../infrastructure/logger.js";
import { esc, formatRub } from "../../views/format.js";
import { action, cancelKb, navRow, pagerRow, show } from "../../views/screen.js";
import type { CartRepository } from "../cart/cart.repository.js";
import { PAGE_SIZE, type CatalogRepository, type Page, type Product } from "./catalog.repository.js";

const NOT_SELECTED = -1;

function productCaption(p: Product, size: number, color: number): string {
  const lines = [`<b>${esc(p.name)}</b>`, `💰 ${formatRub(p.price)}`];
  if (p.description) lines.push("", esc(p.description));
  if (p.sizes.length) lines.push("", `📏 Размер: ${p.sizes[size] ? `<b>${esc(p.sizes[size]!)}</b>` : "выбери ниже"}`);
  if (p.colors.length) lines.push(`🎨 Цвет: ${p.colors[color] ? `<b>${esc(p.colors[color]!)}</b>` : "выбери ниже"}`);
  return lines.join("\n");
}

function optionRows(
  kb: InlineKeyboard,
  options: string[],
  selected: number,
  data: (index: number) => string,
): void {
  options.forEach((option, i) => {
    if (i > 0 && i % 3 === 0) kb.row();
    kb.text(i === selected ? `✅ ${option}` : option, data(i));
  });
  if (options.length) kb.row();
}

export function createCatalogComposer(catalog: CatalogRepository, cart: CartRepository): Composer<MyContext> {
  const composer = new Composer<MyContext>();

  function listBackData(list: ListRef | null): string {
    if (list?.type === "search") return `sr:${list.page}`;
    if (list?.type === "category") return `c:${list.id}:${list.page}`;
    return "cat";
  }

  function productListKb(result: Page<Product>, page: number, pageData: (p: number) => string, back: string) {
    const kb = new InlineKeyboard();
    for (const p of result.items) kb.text(`${p.name} · ${formatRub(p.price)}`, `p:${p.id}:${NOT_SELECTED}:${NOT_SELECTED}`).row();
    pagerRow(kb, page, Math.ceil(result.total / PAGE_SIZE), pageData);
    return navRow(kb, back);
  }

  async function showProduct(ctx: MyContext, id: number, size: number, color: number, keepPhoto: boolean) {
    const p = await catalog.product(id);
    if (!p || !p.active) throw new NotFoundError(`product ${id}`, "Этой игрушки уже нет в продаже.");

    // Если вариант один, выбирать нечего.
    const s = size === NOT_SELECTED && p.sizes.length === 1 ? 0 : size;
    const c = color === NOT_SELECTED && p.colors.length === 1 ? 0 : color;

    const kb = new InlineKeyboard();
    optionRows(kb, p.sizes, s, (i) => `p:${id}:${i}:${c}`);
    optionRows(kb, p.colors, c, (i) => `p:${id}:${s}:${i}`);
    kb.text(t("btn.add_to_cart"), `add:${id}:${s}:${c}`).row();
    const count = await cart.count(ctx.from!.id);
    if (count > 0) kb.text(`${t("btn.cart")} (${count})`, "cart").row();
    navRow(kb, listBackData(ctx.session.list));

    await show(ctx, { text: productCaption(p, s, c), kb, photo: p.photo, keepPhoto });
  }

  action(composer, "cat", async (ctx) => {
    const categories = await catalog.categories(true);
    if (categories.length === 0) {
      return show(ctx, { text: t("catalog.empty"), kb: navRow(new InlineKeyboard(), "m") });
    }
    const kb = new InlineKeyboard();
    for (const c of categories) kb.text(c.name, `c:${c.id}:0`).row();
    await show(ctx, { text: t("catalog.title"), kb: navRow(kb, "m") });
  });

  action(composer, /^c:(\d+):(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const page = Number(ctx.match[2]);
    const category = await catalog.category(id);
    if (!category || !category.active) throw new NotFoundError(`category ${id}`);
    ctx.session.list = { type: "category", id, page };

    const result = await catalog.byCategory(id, page);
    const text = result.total === 0 ? t("catalog.category_empty") : `<b>${esc(category.name)}</b>`;
    await show(ctx, { text, kb: productListKb(result, page, (p) => `c:${id}:${p}`, "cat") });
  });

  action(composer, /^p:(\d+):(-?\d+):(-?\d+)$/, async (ctx) => {
    const fromCard = Boolean(ctx.callbackQuery?.message?.photo);
    await showProduct(ctx, Number(ctx.match[1]), Number(ctx.match[2]), Number(ctx.match[3]), fromCard);
  });

  action(composer, /^add:(\d+):(-?\d+):(-?\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const size = Number(ctx.match[2]);
    const color = Number(ctx.match[3]);
    const p = await catalog.product(id);
    if (!p || !p.active) throw new NotFoundError(`product ${id}`, "Этой игрушки уже нет в продаже.");
    if (p.sizes.length && !p.sizes[size]) throw new ValidationError(t("catalog.choose_size"));
    if (p.colors.length && !p.colors[color]) throw new ValidationError(t("catalog.choose_color"));

    await cart.add(ctx.from!.id, id, p.sizes[size] ?? "", p.colors[color] ?? "");
    logAction("cart.add", ctx, { productId: id });
    await ctx.answerCallbackQuery({ text: t("catalog.added") });
    await showProduct(ctx, id, size, color, Boolean(ctx.callbackQuery?.message?.photo));
  });

  action(composer, "s", async (ctx) => {
    ctx.session.flow = { kind: "search" };
    await show(ctx, { text: t("search.prompt"), kb: cancelKb() });
  });

  async function showSearch(ctx: MyContext, query: string, page: number): Promise<void> {
    const result = await catalog.search(query, page);
    ctx.session.list = { type: "search", page };
    const safe = esc(query);
    if (result.total === 0) {
      const kb = new InlineKeyboard().text(t("btn.search"), "s").row().text(t("btn.custom"), "cu");
      return show(ctx, { text: t("search.empty", { query: safe }), kb: kb.row().text(t("btn.main"), "m") });
    }
    await show(ctx, {
      text: t("search.results", { query: safe }),
      kb: productListKb(result, page, (p) => `sr:${p}`, "s"),
    });
  }

  action(composer, /^sr:(\d+)$/, async (ctx) => {
    if (!ctx.session.query) throw new ValidationError("Запрос устарел. Начни поиск заново.");
    await showSearch(ctx, ctx.session.query, Number(ctx.match[1]));
  });

  composer.chatType("private").on("message", async (ctx, next) => {
    if (ctx.session.flow?.kind !== "search") return next();
    const query = ctx.msg.text?.trim();
    if (!query) return ctx.reply(t("search.prompt"), { reply_markup: cancelKb() });
    ctx.session.flow = null;
    ctx.session.query = query.slice(0, 100);
    logAction("catalog.search", ctx, { query: ctx.session.query });
    await showSearch(ctx, ctx.session.query, 0);
  });

  return composer;
}
