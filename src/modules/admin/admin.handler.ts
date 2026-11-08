// Панель /admin: товары, категории, заказы, тексты, рассылка, статистика, обслуживание.
import { Composer, InlineKeyboard } from "grammy";
import type { AdminAction, MyContext, ProductField } from "../../bot/context.js";
import { EDITABLE_TEXTS, t, type EditableTextKey } from "../../i18n/texts.js";
import { logAction } from "../../infrastructure/logger.js";
import { esc, formatRub, parseList, parseRub } from "../../views/format.js";
import { action, cancelKb, navRow, pagerRow, show, threadOf } from "../../views/screen.js";
import type { BroadcastService } from "../broadcast/broadcast.service.js";
import { PAGE_SIZE, type CatalogRepository } from "../catalog/catalog.repository.js";
import { ORDERS_PAGE_SIZE } from "../orders/orders.repository.js";
import type { OrdersService } from "../orders/orders.service.js";
import { STATUS_LABELS, orderTotal, type OrderStatus } from "../orders/orders.types.js";
import type { SettingsService } from "../settings/settings.service.js";
import type { UsersRepository } from "../users/users.repository.js";
import { createOrderActions, showCard } from "./order-actions.handler.js";

const HOME = "a:home";
const MAX_DESCRIPTION = 700; // Подпись к фото ограничена 1024 символами, нужен запас под цену и варианты.

function adminNav(kb: InlineKeyboard, back: string): InlineKeyboard {
  return navRow(kb, back, HOME, "🏠 Админка");
}

const FIELD_PROMPTS: Record<ProductField, string> = {
  name: "Новое название:",
  photo: "Пришли новое фото:",
  description: "Новое описание:",
  price: "Новая цена в рублях:",
  sizes: "Размеры через запятую, например «10 см, 15 см». Если размера нет, напиши «-»:",
  colors: "Цвета через запятую, например «белый, зелёный». Если цвета нет, напиши «-»:",
};

export function createAdminComposer(
  catalog: CatalogRepository,
  orders: OrdersService,
  settings: SettingsService,
  users: UsersRepository,
  broadcast: BroadcastService,
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
      .text("🧸 Товары", "a:ps:0").text("🗂 Категории", "a:cs").row()
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

  // --- Товары ---

  async function showProducts(ctx: MyContext, page: number): Promise<void> {
    const result = await catalog.all(page);
    const kb = new InlineKeyboard().text("➕ Добавить товар", "a:pn").row();
    for (const p of result.items) kb.text(`${p.active ? "" : "🙈 "}${p.name} · ${formatRub(p.price)}`, `a:p:${p.id}`).row();
    pagerRow(kb, page, Math.ceil(result.total / PAGE_SIZE), (n) => `a:ps:${n}`);
    await show(ctx, { text: `🧸 <b>Товары</b> (${result.total})`, kb: adminNav(kb, HOME) });
  }

  async function showProduct(ctx: MyContext, id: number): Promise<void> {
    const p = await catalog.product(id);
    if (!p) return showProducts(ctx, 0);
    const text = [
      `<b>${esc(p.name)}</b>${p.active ? "" : " 🙈 скрыт"}`,
      `💰 ${formatRub(p.price)}`,
      p.description ? esc(p.description) : "Описания нет",
      `📏 Размеры: ${esc(p.sizes.join(", ") || "нет")}`,
      `🎨 Цвета: ${esc(p.colors.join(", ") || "нет")}`,
    ].join("\n");
    const kb = new InlineKeyboard()
      .text("Название", `a:pe:${id}:name`).text("Фото", `a:pe:${id}:photo`).row()
      .text("Описание", `a:pe:${id}:description`).text("Цена", `a:pe:${id}:price`).row()
      .text("Размеры", `a:pe:${id}:sizes`).text("Цвета", `a:pe:${id}:colors`).row()
      .text(p.active ? "🙈 Скрыть" : "👁 Показать", `a:pt:${id}`);
    await show(ctx, { text, kb: adminNav(kb, "a:ps:0"), photo: p.photo });
  }

  action(composer, /^a:ps:(\d+)$/, (ctx) => showProducts(ctx, Number(ctx.match[1])));
  action(composer, /^a:p:(\d+)$/, (ctx) => showProduct(ctx, Number(ctx.match[1])));

  action(composer, /^a:pt:(\d+)$/, async (ctx) => {
    await catalog.toggleProduct(Number(ctx.match[1]));
    await showProduct(ctx, Number(ctx.match[1]));
  });

  action(composer, /^a:pe:(\d+):(\w+)$/, async (ctx) => {
    const field = ctx.match[2] as ProductField;
    await startInput(ctx, { type: "product_edit", id: Number(ctx.match[1]), field }, FIELD_PROMPTS[field]);
  });

  action(composer, "a:pn", async (ctx) => {
    const categories = await catalog.categories(false);
    if (categories.length === 0) {
      const kb = new InlineKeyboard().text("➕ Создать категорию", "a:cn");
      return show(ctx, { text: "Сначала создай хотя бы одну категорию.", kb: adminNav(kb, "a:ps:0") });
    }
    const kb = new InlineKeyboard();
    for (const c of categories) kb.text(c.name, `a:pnc:${c.id}`).row();
    await show(ctx, { text: "Шаг 1 из 7. В какую категорию добавить товар?", kb: adminNav(kb, "a:ps:0") });
  });

  action(composer, /^a:pnc:(\d+)$/, async (ctx) => {
    await startInput(ctx, { type: "product_new", draft: { categoryId: Number(ctx.match[1]) } }, "Шаг 2 из 7. Название товара:");
  });

  action(composer, "a:pnp", async (ctx) => {
    const flow = ctx.session.flow;
    if (flow?.kind !== "admin" || flow.action.type !== "product_new") return;
    flow.action.draft.photo = null;
    await show(ctx, { text: "Шаг 4 из 7. Описание товара:", kb: cancelKb("a:x") });
  });

  // Создание товара: один шаг на сообщение, шаг определяется заполненными полями черновика.
  async function handleProductNew(ctx: MyContext, a: Extract<AdminAction, { type: "product_new" }>, text?: string, photo?: string) {
    const d = a.draft;
    const ask = (prompt: string, kb = cancelKb("a:x")) => say(ctx, prompt, kb);

    if (d.name === undefined) {
      if (!text) return ask("Шаг 2 из 7. Напиши название текстом:");
      d.name = text.slice(0, 100);
      return ask("Шаг 3 из 7. Пришли фото товара:", new InlineKeyboard().text("Без фото", "a:pnp").row().text("❌ Отмена", "a:x"));
    }
    if (d.photo === undefined) {
      if (!photo) return ask("Шаг 3 из 7. Нужно именно фото:", new InlineKeyboard().text("Без фото", "a:pnp").row().text("❌ Отмена", "a:x"));
      d.photo = photo;
      return ask("Шаг 4 из 7. Описание товара:");
    }
    if (d.description === undefined) {
      if (!text) return ask("Шаг 4 из 7. Напиши описание текстом:");
      d.description = text.slice(0, MAX_DESCRIPTION);
      return ask("Шаг 5 из 7. Цена в рублях:");
    }
    if (d.price === undefined) {
      const price = text ? parseRub(text) : null;
      if (price === null) return ask("Шаг 5 из 7. Напиши цену числом, например 1500:");
      d.price = price;
      return ask(`Шаг 6 из 7. ${FIELD_PROMPTS.sizes}`);
    }
    if (d.sizes === undefined) {
      if (!text) return ask(`Шаг 6 из 7. ${FIELD_PROMPTS.sizes}`);
      d.sizes = parseList(text);
      return ask(`Шаг 7 из 7. ${FIELD_PROMPTS.colors}`);
    }
    if (!text) return ask(`Шаг 7 из 7. ${FIELD_PROMPTS.colors}`);
    const id = await catalog.createProduct({
      categoryId: d.categoryId,
      name: d.name,
      description: d.description,
      price: d.price,
      photo: d.photo,
      sizes: d.sizes,
      colors: parseList(text),
    });
    ctx.session.flow = null;
    logAction("admin.product_created", ctx, { productId: id });
    return say(ctx, `✅ Товар «${esc(d.name)}» добавлен.`, new InlineKeyboard().text("Открыть товар", `a:p:${id}`).row().text("➕ Ещё товар", "a:pn").row().text("🏠 Админка", HOME));
  }

  async function handleProductEdit(ctx: MyContext, a: Extract<AdminAction, { type: "product_edit" }>, text?: string, photo?: string) {
    const retry = (prompt: string) => say(ctx, prompt, cancelKb("a:x"));
    switch (a.field) {
      case "photo":
        if (!photo) return retry(FIELD_PROMPTS.photo);
        await catalog.updateProduct(a.id, { photo });
        break;
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
      case "sizes":
      case "colors":
        if (!text) return retry(FIELD_PROMPTS[a.field]);
        await catalog.updateProduct(a.id, { [a.field]: parseList(text) });
        break;
    }
    ctx.session.flow = null;
    logAction("admin.product_updated", ctx, { productId: a.id, field: a.field });
    return say(ctx, "✅ Сохранено.", new InlineKeyboard().text("Открыть товар", `a:p:${a.id}`).text("🏠 Админка", HOME));
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
      .text("✏️ Переименовать", `a:cr:${id}`).row()
      .text(c.active ? "🙈 Скрыть" : "👁 Показать", `a:ct:${id}`);
    await show(ctx, { text: `<b>${esc(c.name)}</b>${c.active ? "" : " 🙈 скрыта"}`, kb: adminNav(kb, "a:cs") });
  });

  action(composer, /^a:cr:(\d+)$/, (ctx) =>
    startInput(ctx, { type: "category_rename", id: Number(ctx.match[1]) }, "Новое название категории:"),
  );

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
    kb.text(`🚚 Курьер: ${courierLabel()}`, "a:cc");
    return show(ctx, { text: "✏️ <b>Тексты и настройки</b>", kb: adminNav(kb, HOME) });
  }

  action(composer, "a:ts", showTexts);

  action(composer, /^a:te:(\w+)$/, async (ctx) => {
    const key = ctx.match[1] as EditableTextKey;
    const current = t(key) || "пока пусто";
    await startInput(ctx, { type: "text_edit", key }, `<b>${EDITABLE_TEXTS[key]}</b>\n\nСейчас:\n${current}\n\nПришли новый текст:`);
  });

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
    const lines = (Object.keys(STATUS_LABELS) as OrderStatus[]).map((s) => `${STATUS_LABELS[s]}: ${o.byStatus[s] ?? 0}`);
    const text = `📊 <b>Статистика</b>\n\nПокупателей: ${u.total}, новых за 7 дней: ${u.new7d}\nОплачено на сумму: <b>${formatRub(o.revenue)}</b>\n\n${lines.join("\n")}`;
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
