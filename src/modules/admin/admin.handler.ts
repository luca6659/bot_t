// Панель /admin: модельки, категории, заказы, тексты, рассылка, статистика, обслуживание.
import { Composer, InlineKeyboard } from "grammy";
import type { AdminAction, MyContext, ProductField } from "../../bot/context.js";
import { fileTooBig } from "../../bot/guards.js";
import { EDITABLE_TEXTS, t, type EditableTextKey } from "../../i18n/texts.js";
import { logAction } from "../../infrastructure/logger.js";
import { esc, formatRub, parseRub } from "../../views/format.js";
import { action, cancelKb, navRow, pagerRow, show, threadOf } from "../../views/screen.js";
import type { BroadcastService } from "../broadcast/broadcast.service.js";
import { PAGE_SIZE, type CatalogRepository, type Product } from "../catalog/catalog.repository.js";
import type { OrderNotifier } from "../orders/orders.service.js";
import { ORDERS_PAGE_SIZE } from "../orders/orders.repository.js";
import type { OrdersService } from "../orders/orders.service.js";
import { STATUS_LABELS, orderTotal, type OrderStatus } from "../orders/orders.types.js";
import type { SettingsService } from "../settings/settings.service.js";
import type { UsersRepository } from "../users/users.repository.js";
import { createOrderActions, showCard } from "./order-actions.handler.js";

const HOME = "a:home";
const MAX_DESCRIPTION = 700; // Подпись к фото ограничена 1024 символами, нужен запас под цену и наличие.
const MAX_PHOTOS = 10;

function adminNav(kb: InlineKeyboard, back: string): InlineKeyboard {
  return navRow(kb, back, HOME, "🏠 Админка");
}

const FIELD_PROMPTS: Record<ProductField, string> = {
  name: "Новое название:",
  description: "Новое описание:",
  price: "Новая цена в рублях:",
  photos_add: "Пришли фото — по одному или альбомом. Когда закончишь, нажми «Готово».",
};

function stockLabel(p: Product): string {
  return p.stock === "in_stock" ? "✅ В наличии" : "🖨 Под заказ";
}

export function createAdminComposer(
  catalog: CatalogRepository,
  orders: OrdersService,
  settings: SettingsService,
  users: UsersRepository,
  broadcast: BroadcastService,
  notifier: OrderNotifier,
): Composer<MyContext> {
  const composer = new Composer<MyContext>();
  const orderActions = createOrderActions(orders);
  composer.use(orderActions.composer);

  function startInput(ctx: MyContext, a: AdminAction, prompt: string, kb = cancelKb("a:x")): Promise<void> {
    ctx.session.flow = { kind: "admin", threadId: threadOf(ctx) ?? null, action: a };
    return show(ctx, { text: prompt, kb });
  }

  function say(ctx: MyContext, text: string, kb?: InlineKeyboard) {
    return ctx.reply(text, { parse_mode: "HTML", reply_markup: kb, message_thread_id: threadOf(ctx) });
  }

  // --- Главный экран ---

  function homeScreen() {
    const kb = new InlineKeyboard()
      .text("🧸 Модельки", "a:ps:0").text("🗂 Категории", "a:cs").row()
      .text("🧾 Заказы", "a:os").text("✏️ Тексты", "a:ts").row()
      .text("📣 Рассылка", "a:b").text("📊 Статистика", "a:st").row()
      .text(settings.isMaintenance() ? "🟢 Включить бота" : "🛠 Режим обслуживания", "a:mt");
    const state = settings.isMaintenance() ? "🛠 Сейчас бот на обслуживании: покупатели его не видят." : "🟢 Бот работает.";
    return { text: `<b>Админка</b>\n${state}`, kb };
  }

  composer.command("admin", async (ctx) => {
    ctx.session.flow = null;
    const s = homeScreen();
    await say(ctx, s.text, s.kb);
  });

  action(composer, HOME, async (ctx) => {
    ctx.session.flow = null;
    await show(ctx, homeScreen());
  });

  action(composer, "a:x", async (ctx) => {
    ctx.session.flow = null;
    await show(ctx, homeScreen());
  });

  action(composer, "a:mt", async (ctx) => {
    if (settings.isMaintenance()) await settings.remove("maintenance_on");
    else await settings.set("maintenance_on", "1");
    logAction("admin.maintenance", ctx, { on: settings.isMaintenance() });
    await show(ctx, homeScreen());
  });

  // Бан из закреп-карточки клиента в его теме.
  action(composer, /^ab:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const user = await users.get(id);
    if (!user) return;
    await users.setBanned(id, !user.banned);
    logAction("admin.ban", ctx, { userId: id, banned: !user.banned });
    await ctx.answerCallbackQuery({ text: !user.banned ? "Пользователь забанен" : "Пользователь разбанен" });
    await notifier.clientCard(id);
  });

  // --- Модельки ---

  async function showProducts(ctx: MyContext, page: number): Promise<void> {
    const result = await catalog.all(page);
    const kb = new InlineKeyboard().text("➕ Добавить модельку", "a:pn").row();
    for (const p of result.items) kb.text(`${p.active ? "" : "🙈 "}${p.name} · ${formatRub(p.price)}`, `a:p:${p.id}`).row();
    pagerRow(kb, page, Math.ceil(result.total / PAGE_SIZE), (n) => `a:ps:${n}`);
    await show(ctx, { text: `🧸 <b>Модельки</b> (${result.total})`, kb: adminNav(kb, HOME) });
  }

  async function showProduct(ctx: MyContext, id: number): Promise<void> {
    const p = await catalog.product(id);
    if (!p) return showProducts(ctx, 0);
    const badges = [p.isHit ? "🔥 Хит" : "", p.isNew ? "🆕 Новинка" : ""].filter(Boolean).join(" · ") || "нет";
    const text = [
      `<b>${esc(p.name)}</b>${p.active ? "" : " 🙈 скрыта"}`,
      `💰 ${formatRub(p.price)} · ${stockLabel(p)}`,
      `🏷 Метки: ${badges}`,
      `🖼 Фото: ${p.photos.length}`,
      p.description ? esc(p.description) : "Описания нет",
    ].join("\n");
    const kb = new InlineKeyboard()
      .text("✏️ Название", `a:pe:${id}:name`).text("💰 Цена", `a:pe:${id}:price`).row()
      .text("📝 Описание", `a:pe:${id}:description`).row()
      .text("➕ Фото", `a:pe:${id}:photos_add`).text("🗑 Фото", `a:pdl:${id}`).row()
      .text(p.stock === "in_stock" ? "🖨 Сделать «под заказ»" : "✅ Сделать «в наличии»", `a:pstk:${id}`).row()
      .text(`${p.isHit ? "✅" : "▫️"} 🔥 Хит`, `a:pb:${id}:hit`).text(`${p.isNew ? "✅" : "▫️"} 🆕 Новинка`, `a:pb:${id}:new`).row()
      .text(p.active ? "🙈 Скрыть" : "👁 Показать", `a:pt:${id}`).text("🗑 Удалить", `a:px:${id}`).row();
    await show(ctx, { text, kb: adminNav(kb, "a:ps:0"), photo: p.photos[0] ?? null });
  }

  action(composer, /^a:ps:(\d+)$/, (ctx) => showProducts(ctx, Number(ctx.match[1])));
  action(composer, /^a:p:(\d+)$/, (ctx) => showProduct(ctx, Number(ctx.match[1])));

  action(composer, /^a:pt:(\d+)$/, async (ctx) => {
    await catalog.toggleProduct(Number(ctx.match[1]));
    await showProduct(ctx, Number(ctx.match[1]));
  });

  action(composer, /^a:pstk:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const p = await catalog.product(id);
    if (p) await catalog.updateProduct(id, { stock: p.stock === "in_stock" ? "on_order" : "in_stock" });
    await showProduct(ctx, id);
  });

  action(composer, /^a:pb:(\d+):(hit|new)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const p = await catalog.product(id);
    if (p) await catalog.updateProduct(id, ctx.match[2] === "hit" ? { isHit: !p.isHit } : { isNew: !p.isNew });
    await showProduct(ctx, id);
  });

  // Удаление одного фото по номеру.
  action(composer, /^a:pdl:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const p = await catalog.product(id);
    if (!p) return;
    const kb = new InlineKeyboard();
    p.photos.forEach((_, i) => kb.text(`🗑 Фото ${i + 1}`, `a:pd:${id}:${i}`).row());
    await show(ctx, { text: `🖼 Какое фото удалить у «${esc(p.name)}»?`, kb: adminNav(kb, `a:p:${id}`) });
  });

  action(composer, /^a:pd:(\d+):(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const idx = Number(ctx.match[2]);
    const p = await catalog.product(id);
    if (p) {
      const photos = p.photos.filter((_, i) => i !== idx);
      await catalog.updateProduct(id, { photos });
    }
    await showProduct(ctx, id);
  });

  action(composer, /^a:px:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const kb = new InlineKeyboard().text("Да, удалить", `a:pxy:${id}`).text("Нет, оставить", `a:p:${id}`);
    await show(ctx, { text: `🗑 Точно удалить модельку? Если она есть в заказах, удалить не получится — только скрыть.`, kb });
  });

  action(composer, /^a:pxy:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const ok = await catalog.deleteProduct(id);
    if (!ok) {
      await ctx.answerCallbackQuery({ text: "Моделька есть в заказах. Лучше скрой её.", show_alert: true });
      return showProduct(ctx, id);
    }
    logAction("admin.product_deleted", ctx, { productId: id });
    await showProducts(ctx, 0);
  });

  action(composer, /^a:pe:(\d+):(\w+)$/, async (ctx) => {
    const field = ctx.match[2] as ProductField;
    await startInput(ctx, { type: "product_edit", id: Number(ctx.match[1]), field }, FIELD_PROMPTS[field]);
  });

  // Создание модельки: название → описание → фото → категория → цена → наличие → метки.
  action(composer, "a:pn", async (ctx) => {
    ctx.session.flow = { kind: "admin", threadId: threadOf(ctx) ?? null, action: { type: "product_new", draft: { photos: [] } } };
    await show(ctx, { text: "Шаг 1 из 7. Название модельки:", kb: cancelKb("a:x") });
  });

  action(composer, "a:png", async (ctx) => {
    const flow = ctx.session.flow;
    if (flow?.kind !== "admin" || flow.action.type !== "product_new") return;
    const d = flow.action.draft;
    if (d.name === undefined || d.description === undefined) return;
    d.photosDone = true;
    const categories = await catalog.categories(false);
    if (categories.length === 0) {
      const kb = new InlineKeyboard().text("➕ Создать категорию", "a:cn");
      return show(ctx, { text: "Сначала создай хотя бы одну категорию.", kb: adminNav(kb, "a:ps:0") });
    }
    const kb = new InlineKeyboard();
    for (const c of categories) kb.text(c.name, `a:pnc:${c.id}`).row();
    await show(ctx, { text: "Шаг 4 из 7. В какую категорию добавить модельку?", kb: adminNav(kb, "a:ps:0") });
  });

  action(composer, /^a:pnc:(\d+)$/, async (ctx) => {
    const flow = ctx.session.flow;
    if (flow?.kind !== "admin" || flow.action.type !== "product_new") return;
    flow.action.draft.categoryId = Number(ctx.match[1]);
    await show(ctx, { text: "Шаг 5 из 7. Цена в рублях:", kb: cancelKb("a:x") });
  });

  action(composer, /^a:pns:(in_stock|on_order)$/, async (ctx) => {
    const flow = ctx.session.flow;
    if (flow?.kind !== "admin" || flow.action.type !== "product_new") return;
    flow.action.draft.stock = ctx.match[1] as "in_stock" | "on_order";
    const kb = new InlineKeyboard()
      .text("🔥 Хит", "a:pnh:hit").text("🆕 Новинка", "a:pnh:new").row()
      .text("🔥 + 🆕", "a:pnh:both").text("Без меток", "a:pnh:none").row();
    await show(ctx, { text: "Шаг 7 из 7. Метки для витрины:", kb });
  });

  action(composer, /^a:pnh:(hit|new|both|none)$/, async (ctx) => {
    const flow = ctx.session.flow;
    if (flow?.kind !== "admin" || flow.action.type !== "product_new") return;
    const d = flow.action.draft;
    if (d.categoryId === undefined || d.price === undefined || d.stock === undefined) return;
    const mark = ctx.match[1];
    const id = await catalog.createProduct({
      categoryId: d.categoryId,
      name: d.name!,
      description: d.description!,
      price: d.price,
      photos: d.photos,
      stock: d.stock,
      isHit: mark === "hit" || mark === "both",
      isNew: mark === "new" || mark === "both",
    });
    ctx.session.flow = null;
    logAction("admin.product_created", ctx, { productId: id });
    await say(ctx, `✅ Моделька «${esc(d.name!)}» добавлена.`, new InlineKeyboard().text("Открыть модельку", `a:p:${id}`).row().text("➕ Ещё моделька", "a:pn").row().text("🏠 Админка", HOME));
  });

  action(composer, "a:ped", async (ctx) => {
    const flow = ctx.session.flow;
    if (flow?.kind !== "admin" || flow.action.type !== "product_edit") return;
    const id = flow.action.id;
    ctx.session.flow = null;
    await showProduct(ctx, id);
  });

  async function handleProductNew(ctx: MyContext, a: Extract<AdminAction, { type: "product_new" }>, text?: string, photo?: string) {
    const d = a.draft;
    const ask = (prompt: string, kb = cancelKb("a:x")) => say(ctx, prompt, kb);

    if (d.name === undefined) {
      if (!text) return ask("Шаг 1 из 7. Напиши название текстом:");
      d.name = text.slice(0, 100);
      return ask("Шаг 2 из 7. Описание модельки:");
    }
    if (d.description === undefined) {
      if (!text) return ask("Шаг 2 из 7. Напиши описание текстом:");
      d.description = text.slice(0, MAX_DESCRIPTION);
      return ask(`Шаг 3 из 7. Пришли до ${MAX_PHOTOS} фото — по одному или альбомом. Когда закончишь, нажми «Готово»:`, new InlineKeyboard().text(t("btn.done"), "a:png").row().text("❌ Отмена", "a:x"));
    }
    if (!d.photosDone) {
      if (fileTooBig(ctx.msg!)) return ask(t("error.file_too_big"));
      if (photo && d.photos.length < MAX_PHOTOS) d.photos.push(photo);
      const group = ctx.msg!.media_group_id;
      if (group && group === ctx.session.lastMediaGroup) return;
      ctx.session.lastMediaGroup = group ?? null;
      return ask(`🖼 Фото: ${d.photos.length} из ${MAX_PHOTOS}. Ещё или «Готово»:`, new InlineKeyboard().text(t("btn.done"), "a:png").row().text("❌ Отмена", "a:x"));
    }
    if (d.categoryId === undefined) return ask("Выбери категорию кнопкой выше.");
    if (d.price === undefined) {
      const price = text ? parseRub(text) : null;
      if (price === null) return ask("Шаг 5 из 7. Напиши цену числом, например 1500:");
      d.price = price;
      const kb = new InlineKeyboard().text("✅ В наличии", "a:pns:in_stock").text("🖨 Под заказ", "a:pns:on_order");
      return ask("Шаг 6 из 7. Наличие:", kb);
    }
    return ask("Выбери наличие и метки кнопками выше.");
  }

  async function handleProductEdit(ctx: MyContext, a: Extract<AdminAction, { type: "product_edit" }>, text?: string, photo?: string) {
    const retry = (prompt: string) => say(ctx, prompt, cancelKb("a:x"));
    switch (a.field) {
      case "price": {
        const price = text ? parseRub(text) : null;
        if (price === null) return retry("Напиши цену числом, например 1500:");
        await catalog.updateProduct(a.id, { price });
        break;
      }
      case "name":
        if (!text) return retry(FIELD_PROMPTS.name);
        await catalog.updateProduct(a.id, { name: text.slice(0, 100) });
        break;
      case "description":
        if (!text) return retry(FIELD_PROMPTS.description);
        await catalog.updateProduct(a.id, { description: text.slice(0, MAX_DESCRIPTION) });
        break;
      case "photos_add": {
        if (fileTooBig(ctx.msg!)) return retry(t("error.file_too_big"));
        if (!photo) return retry(FIELD_PROMPTS.photos_add);
        const p = await catalog.product(a.id);
        if (!p) return;
        const photos = [...p.photos, photo].slice(0, MAX_PHOTOS);
        await catalog.updateProduct(a.id, { photos });
        const group = ctx.msg!.media_group_id;
        if (group && group === ctx.session.lastMediaGroup) return;
        ctx.session.lastMediaGroup = group ?? null;
        return say(ctx, `🖼 Фото: ${photos.length}. Ещё или «Готово»:`, new InlineKeyboard().text(t("btn.done"), "a:ped").row().text("❌ Отмена", "a:x"));
      }
    }
    ctx.session.flow = null;
    logAction("admin.product_updated", ctx, { productId: a.id, field: a.field });
    return say(ctx, "✅ Сохранено.", new InlineKeyboard().text("Открыть модельку", `a:p:${a.id}`).text("🏠 Админка", HOME));
  }

  // --- Категории ---

  async function showCategories(ctx: MyContext): Promise<void> {
    const categories = await catalog.categories(false);
    const kb = new InlineKeyboard().text("➕ Добавить категорию", "a:cn").row();
    for (const c of categories) kb.text(`${c.active ? "" : "🙈 "}${c.name}`, `a:c:${c.id}`).row();
    await show(ctx, { text: `🗂 <b>Категории</b> (${categories.length})`, kb: adminNav(kb, HOME) });
  }

  action(composer, "a:cs", showCategories);
  action(composer, "a:cn", (ctx) => startInput(ctx, { type: "category_new" }, "Название новой категории:"));

  action(composer, /^a:c:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const c = await catalog.category(id);
    if (!c) return showCategories(ctx);
    const kb = new InlineKeyboard()
      .text("✏️ Переименовать", `a:cr:${id}`).text("🖼 Обложка", `a:cp:${id}`).row()
      .text("⬆️ Выше", `a:cm:${id}:-1`).text("⬇️ Ниже", `a:cm:${id}:1`).row()
      .text(c.active ? "🙈 Скрыть" : "👁 Показать", `a:ct:${id}`);
    await show(ctx, { text: `<b>${esc(c.name)}</b>${c.active ? "" : " 🙈 скрыта"}`, kb: adminNav(kb, "a:cs"), photo: c.photo });
  });

  action(composer, /^a:cr:(\d+)$/, (ctx) =>
    startInput(ctx, { type: "category_rename", id: Number(ctx.match[1]) }, "Новое название категории:"),
  );

  action(composer, /^a:cp:(\d+)$/, (ctx) =>
    startInput(ctx, { type: "category_photo", id: Number(ctx.match[1]) }, "Пришли фото-обложку категории:"),
  );

  action(composer, /^a:cm:(\d+):(-?\d+)$/, async (ctx) => {
    await catalog.moveCategory(Number(ctx.match[1]), Number(ctx.match[2]));
    await showCategories(ctx);
  });

  action(composer, /^a:ct:(\d+)$/, async (ctx) => {
    await catalog.toggleCategory(Number(ctx.match[1]));
    await showCategories(ctx);
  });

  // --- Заказы ---

  action(composer, "a:os", async (ctx) => {
    const kb = new InlineKeyboard();
    const { byStatus } = await orders.stats();
    (Object.keys(STATUS_LABELS) as OrderStatus[]).forEach((s, i) => {
      if (i > 0 && i % 2 === 0) kb.row();
      kb.text(`${STATUS_LABELS[s]} (${byStatus[s] ?? 0})`, `a:ol:${s}:0`);
    });
    await show(ctx, { text: "🧾 <b>Заказы</b>\nВыбери статус:", kb: adminNav(kb, HOME) });
  });

  action(composer, /^a:ol:(\w+):(\d+)$/, async (ctx) => {
    const status = ctx.match[1] as OrderStatus;
    const page = Number(ctx.match[2]);
    const result = await orders.listByStatus(status, page);
    const kb = new InlineKeyboard();
    for (const o of result.items) {
      const sum = o.subtotal === null ? "" : ` · ${formatRub(orderTotal(o))}`;
      kb.text(`№${o.id}${o.fullName ? ` · ${o.fullName}` : ""}${sum}`, `a:o:${o.id}`).row();
    }
    pagerRow(kb, page, Math.ceil(result.total / ORDERS_PAGE_SIZE), (n) => `a:ol:${status}:${n}`);
    await show(ctx, { text: `<b>${STATUS_LABELS[status]}</b>: ${result.total}`, kb: adminNav(kb, "a:os") });
  });

  action(composer, /^a:o:(\d+)$/, async (ctx) => {
    const order = await orders.get(Number(ctx.match[1]));
    await showCard(ctx, order);
  });

  // --- Тексты ---

  function courierLabel(): string {
    const cost = settings.courierCost();
    return cost === null ? "считает админ" : formatRub(cost);
  }

  function showTexts(ctx: MyContext): Promise<void> {
    const kb = new InlineKeyboard();
    for (const [key, label] of Object.entries(EDITABLE_TEXTS)) kb.text(label, `a:te:${key}`).row();
    kb.text(`🖼 Баннер меню: ${settings.get("menu_banner") ? "есть" : "нет"}`, "a:tb").row();
    kb.text(`🚚 Курьер: ${courierLabel()}`, "a:cc");
    return show(ctx, { text: "✏️ <b>Тексты и настройки</b>", kb: adminNav(kb, HOME) });
  }

  action(composer, "a:ts", showTexts);

  action(composer, /^a:te:(\w+)$/, async (ctx) => {
    const key = ctx.match[1] as EditableTextKey;
    const current = t(key) || "пока пусто";
    await startInput(ctx, { type: "text_edit", key }, `<b>${EDITABLE_TEXTS[key]}</b>\n\nСейчас:\n${current}\n\nПришли новый текст:`);
  });

  action(composer, "a:tb", (ctx) =>
    startInput(ctx, { type: "banner_edit" }, "🖼 Пришли фото для баннера главного меню. Он же будет заглушкой там, где нет своих фото:"),
  );

  action(composer, "a:cc", (ctx) =>
    startInput(ctx, { type: "courier_cost" }, `🚚 Сейчас: ${courierLabel()}.\n\nНапиши единую стоимость курьера в рублях. Чтобы считать её вручную для каждого заказа, напиши «-»:`),
  );

  // --- Рассылка ---

  action(composer, "a:b", async (ctx) => {
    await startInput(ctx, { type: "broadcast" }, `📣 Пришли сообщение для рассылки: текст, фото или видео.\nПолучателей: ${await users.countActive()}.`);
  });

  action(composer, "a:by", async (ctx) => {
    const flow = ctx.session.flow;
    if (flow?.kind !== "admin" || flow.action.type !== "broadcast_confirm") return;
    await broadcast.start(ctx.chat!.id, flow.action.messageId, flow.threadId);
    ctx.session.flow = null;
    logAction("admin.broadcast", ctx);
    await show(ctx, { text: "📣 Рассылка запущена. Когда закончится, напишу здесь.", kb: adminNav(new InlineKeyboard(), HOME) });
  });

  // --- Статистика ---

  action(composer, "a:st", async (ctx) => {
    const [u, o] = await Promise.all([users.stats(), orders.stats()]);
    const top = o.top.length ? o.top.map((p, i) => `${i + 1}. ${esc(p.name)} — ${p.qty} шт`).join("\n") : "пока нет продаж";
    const text = [
      "📊 <b>Статистика</b>",
      "",
      `👤 Покупателей: ${u.total}, новых за 7 дней: ${u.new7d}`,
      `🧾 Заказов всего: ${Object.values(o.byStatus).reduce((a, b) => a + b, 0)}`,
      "",
      "💰 <b>Выручка</b>",
      `За день: ${formatRub(o.revenueDay)}`,
      `За неделю: ${formatRub(o.revenueWeek)}`,
      `За месяц: ${formatRub(o.revenueMonth)}`,
      `За всё время: <b>${formatRub(o.revenue)}</b>`,
      "",
      `🏆 <b>Топ моделек</b>\n${top}`,
    ].join("\n");
    await show(ctx, { text, kb: adminNav(new InlineKeyboard(), HOME) });
  });

  // --- Ввод данных ---

  composer.on("message", async (ctx, next) => {
    const flow = ctx.session.flow;
    if (flow?.kind !== "admin" || flow.threadId !== (threadOf(ctx) ?? null)) return next();

    const a = flow.action;
    const text = ctx.msg.text?.trim();
    const photo = ctx.msg.photo?.at(-1)?.file_id;

    if (await orderActions.handleInput(ctx, a, text)) return;

    switch (a.type) {
      case "product_new":
        return void (await handleProductNew(ctx, a, text, photo));
      case "product_edit":
        return void (await handleProductEdit(ctx, a, text, photo));
      case "category_new":
      case "category_rename": {
        if (!text) return void (await say(ctx, "Напиши название текстом.", cancelKb("a:x")));
        if (a.type === "category_new") await catalog.createCategory(text.slice(0, 60));
        else await catalog.renameCategory(a.id, text.slice(0, 60));
        ctx.session.flow = null;
        return void (await say(ctx, "✅ Сохранено.", new InlineKeyboard().text("🗂 Категории", "a:cs").text("🏠 Админка", HOME)));
      }
      case "category_photo": {
        if (fileTooBig(ctx.msg!)) return void (await say(ctx, t("error.file_too_big"), cancelKb("a:x")));
        if (!photo) return void (await say(ctx, "Пришли именно фото.", cancelKb("a:x")));
        await catalog.setCategoryPhoto(a.id, photo);
        ctx.session.flow = null;
        return void (await say(ctx, "✅ Обложка сохранена.", new InlineKeyboard().text("🗂 Категории", "a:cs").text("🏠 Админка", HOME)));
      }
      case "banner_edit": {
        if (fileTooBig(ctx.msg!)) return void (await say(ctx, t("error.file_too_big"), cancelKb("a:x")));
        if (!photo) return void (await say(ctx, "Пришли именно фото.", cancelKb("a:x")));
        await settings.set("menu_banner", photo);
        ctx.session.flow = null;
        logAction("admin.banner_updated", ctx);
        return void (await say(ctx, "✅ Баннер обновлён.", new InlineKeyboard().text("✏️ Тексты", "a:ts").text("🏠 Админка", HOME)));
      }
      case "text_edit": {
        if (!text) return void (await say(ctx, "Пришли текст.", cancelKb("a:x")));
        // Ввод админа хранится как простой текст: случайный символ < не сломает разметку.
        await settings.set(a.key, esc(text));
        ctx.session.flow = null;
        logAction("admin.text_updated", ctx, { key: a.key });
        return void (await say(ctx, "✅ Текст обновлён, бот уже использует его.", new InlineKeyboard().text("✏️ Тексты", "a:ts").text("🏠 Админка", HOME)));
      }
      case "courier_cost": {
        if (text === "-" || text === "—") await settings.remove("courier_cost");
        else {
          const cost = text ? parseRub(text) : null;
          if (cost === null) return void (await say(ctx, "Напиши сумму числом или «-».", cancelKb("a:x")));
          await settings.set("courier_cost", String(cost));
        }
        ctx.session.flow = null;
        return void (await say(ctx, `✅ Курьер: ${courierLabel()}.`, new InlineKeyboard().text("✏️ Тексты", "a:ts").text("🏠 Админка", HOME)));
      }
      case "broadcast": {
        flow.action = { type: "broadcast_confirm", messageId: ctx.msg.message_id };
        const n = await users.countActive();
        const kb = new InlineKeyboard().text(`✅ Отправить (${n})`, "a:by").row().text("❌ Отмена", "a:x");
        return void (await say(ctx, `Отправить сообщение выше всем покупателям (${n})?`, kb));
      }
      case "broadcast_confirm":
        return void (await say(ctx, "Нажми кнопку подтверждения или отмены выше."));
      default:
        return next();
    }
  });

  return composer;
}
