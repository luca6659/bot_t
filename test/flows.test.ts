import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN, GROUP, Harness, withHarness } from "./harness.js";

const ANNA = 101;
const BORIS = 102;

async function buyToCart(h: Harness, user: number): Promise<void> {
  await h.say(user, "/start");
  await h.press(user, /Каталог/);
  await h.press(user, /Животные/);
  await h.press(user, /Дракон/);
  await h.press(user, /^15 см$/);
  await h.press(user, /^зелёный$/);
  await h.press(user, /В корзину/);
}

async function checkoutPickup(h: Harness, user: number): Promise<void> {
  await h.press(user, /Корзина/);
  await h.press(user, /Оформить/);
  await h.press(user, /Самовывоз/);
  await h.say(user, "Анна Иванова");
  await h.say(user, "+7 900 123-45-67");
  await h.press(user, /Подтвердить/);
}

function adminCard(h: Harness, user: number) {
  return h.topicOf(user);
}

test("покупка с курьером от каталога до выполнения, с уведомлениями на каждом статусе", () =>
  withHarness(async (h) => {
    await h.addProduct({ name: "Дракон", price: "1 500", sizes: "10 см, 15 см", colors: "белый, зелёный" });
    await buyToCart(h, ANNA);

    // Выбор и счётчик корзины
    assert.match(h.findButton(ANNA, /Корзина \(1\)/).data, /cart/);
    await h.press(ANNA, /Корзина/);
    assert.match(h.lastText(ANNA), /Дракон \(15 см, зелёный\): 1 × 1\s500 ₽/u);
    await h.press(ANNA, /➕/);
    assert.match(h.lastText(ANNA), /Итого: <b>3\s000 ₽<\/b>/u);

    // Оформление
    await h.press(ANNA, /Оформить/);
    assert.match(h.lastText(ANNA), /Шаг 1 из 4/);
    await h.press(ANNA, /Яндекс курьер/);
    assert.match(h.lastText(ANNA), /Шаг 2 из 4/);
    await h.say(ANNA, "А");
    assert.match(h.lastText(ANNA), /слишком коротким/);
    await h.say(ANNA, "Анна Иванова");
    await h.say(ANNA, "телефон");
    assert.match(h.lastText(ANNA), /разобрать номер/);
    await h.say(ANNA, { contact: { phone_number: "79001234567", first_name: "Анна", user_id: ANNA } });
    assert.match(h.lastText(ANNA), /Шаг 4 из 4/);
    await h.say(ANNA, "Москва, Тверская, 1 <кв. 5>");
    assert.match(h.lastText(ANNA), /&lt;кв\. 5&gt;/);
    await h.press(ANNA, /Подтвердить/);
    assert.match(h.lastText(ANNA), /Считаем стоимость доставки/);

    // Админ считает доставку и бот выставляет счёт
    const thread = await adminCard(h, ANNA);
    assert.ok(thread);
    assert.match(h.lastText(GROUP), /Нужно указать стоимость доставки|Заказ №1001/);
    await h.press(GROUP, /Реквизиты|стоимость доставки/, ADMIN);
    await h.adminSay("дорого", thread);
    assert.match(h.lastText(GROUP), /числом/);
    await h.adminSay("350", thread);
    const invoice = h.texts(ANNA).find((t) => t.includes("Счёт по заказу"))!;
    assert.match(invoice, /Доставка: 350 ₽/);
    assert.match(invoice, /3\s350 ₽/u);
    assert.ok(h.texts(GROUP).some((t) => t.includes("Реквизиты не заданы")), "админа предупредили о реквизитах");

    // Чек
    await h.press(ANNA, /Отправить чек/);
    await h.say(ANNA, "оплатил");
    assert.match(h.lastText(ANNA), /Нужно фото или файл/);
    await h.say(ANNA, { photo: [{ file_id: "receipt1", file_unique_id: "r", width: 1, height: 1 }] });
    assert.match(h.lastText(ANNA), /Чек получен/);
    assert.ok(h.calls.some((c) => c.method === "sendPhoto" && c.payload.photo === "receipt1" && c.payload.chat_id === GROUP));

    // Чек не принят, затем принят
    await h.press(GROUP, /Чек не принят/, ADMIN);
    assert.match(h.lastText(ANNA), /не приняли/);
    await h.press(ANNA, /Отправить чек/);
    await h.say(ANNA, { document: { file_id: "receipt2", file_unique_id: "d" } });
    assert.ok(h.calls.some((c) => c.method === "sendDocument" && c.payload.document === "receipt2"));
    await h.press(GROUP, /Оплата подтверждена/, ADMIN);
    assert.match(h.lastText(ANNA), /Оплата заказа №1001 подтверждена/);
    await h.press(GROUP, /В печать/, ADMIN);
    assert.match(h.lastText(ANNA), /пошёл в печать/);
    await h.press(GROUP, /Готов/, ADMIN);
    assert.match(h.lastText(ANNA), /уедет с курьером/);
    await h.press(GROUP, /Передан курьеру/, ADMIN);
    await h.adminSay("https://dostavka.yandex.ru/track/1", thread);
    assert.match(h.lastText(ANNA), /Отслеживание: https:\/\/dostavka/);
    await h.press(GROUP, /Выполнен/, ADMIN);
    assert.match(h.lastText(ANNA), /выполнен/);
    assert.deepEqual(h.buttons(GROUP).includes("🚫 Отменить заказ"), false);

    const { rows } = await h.db.query(`SELECT status FROM order_status_history WHERE order_id = 1001 ORDER BY id`);
    assert.deepEqual(rows.map((r) => r.status), [
      "new", "awaiting_payment", "receipt_check", "awaiting_payment", "receipt_check", "paid", "printing", "ready", "courier", "done",
    ]);
    const cart = await h.db.query(`SELECT 1 FROM cart_items WHERE user_id = $1`, [ANNA]);
    assert.equal(cart.rows.length, 0);
  }));

test("самовывоз: счёт сразу, реквизиты из админки, контакты запоминаются, повторное подтверждение не создаёт заказ", () =>
  withHarness(async (h) => {
    await h.addProduct({ name: "Дракон", price: "100", sizes: "15 см", colors: "зелёный", photo: false });
    await h.adminSay("/admin");
    await h.press(GROUP, /Тексты/, ADMIN);
    await h.press(GROUP, /Реквизиты/, ADMIN);
    await h.adminSay("Карта 2200 <Сбер> & СБП");

    await h.say(ANNA, "/start");
    await h.press(ANNA, /Каталог/);
    await h.press(ANNA, /Животные/);
    await h.press(ANNA, /Дракон/);
    // Единственный вариант выбран сам
    assert.match(h.lastText(ANNA), /<b>15 см<\/b>/);
    await h.press(ANNA, /В корзину/);
    await checkoutPickup(h, ANNA);

    const invoice = h.texts(ANNA).find((t) => t.includes("Счёт по заказу"))!;
    assert.match(invoice, /Карта 2200 &lt;Сбер&gt; &amp; СБП/);
    assert.match(invoice, /100 ₽/);
    assert.ok(!h.texts(GROUP).some((t) => t.includes("Реквизиты не заданы")));

    // Повторное нажатие старой кнопки
    await h.pressRaw(ANNA, "cf");
    const orders = await h.db.query(`SELECT id FROM orders`);
    assert.equal(orders.rows.length, 1);

    // Второй заказ предлагает прошлые контакты
    await h.press(ANNA, /Главное меню/);
    await h.press(ANNA, /Каталог/);
    await h.press(ANNA, /Животные/);
    await h.press(ANNA, /Дракон/);
    await h.press(ANNA, /В корзину/);
    await h.press(ANNA, /Корзина/);
    await h.press(ANNA, /Оформить/);
    await h.press(ANNA, /Самовывоз/);
    await h.press(ANNA, /Как в прошлый раз: Анна/);
    await h.press(ANNA, /Как в прошлый раз: \+7900/);
    assert.match(h.lastText(ANNA), /Проверь заказ/);
  }));

test("единая стоимость курьера сразу попадает в счёт", () =>
  withHarness(async (h) => {
    await h.addProduct({ name: "Дракон", price: "100", photo: false });
    await h.adminSay("/admin");
    await h.press(GROUP, /Тексты/, ADMIN);
    await h.press(GROUP, /Курьер/, ADMIN);
    await h.adminSay("250");
    await h.say(ANNA, "/start");
    await h.press(ANNA, /Каталог/);
    await h.press(ANNA, /Животные/);
    await h.press(ANNA, /Дракон/);
    await h.press(ANNA, /В корзину/);
    await h.press(ANNA, /Корзина/);
    await h.press(ANNA, /Оформить/);
    await h.press(ANNA, /Яндекс курьер/);
    await h.say(ANNA, "Анна Иванова");
    await h.say(ANNA, "89001234567");
    await h.say(ANNA, "Москва, Тверская, 1");
    await h.press(ANNA, /Подтвердить/);
    const invoice = h.texts(ANNA).find((t) => t.includes("Счёт по заказу"))!;
    assert.match(invoice, /350 ₽/);
  }));

test("своя модель: заявка с альбомом, оценка, согласие, прерванное и возобновлённое оформление", () =>
  withHarness(async (h) => {
    await h.say(ANNA, "/start");
    await h.press(ANNA, /Заказать свою модель/);
    await h.press(ANNA, /Готово/);
    assert.ok(h.alerts().some((a) => a.includes("Опиши идею")));
    await h.say(ANNA, "Дракон как на фото");
    const before = h.texts(ANNA).length;
    const ph = (id: string) => ({ photo: [{ file_id: id, file_unique_id: id, width: 1, height: 1 }], media_group_id: "album" });
    await h.say(ANNA, ph("ref1"));
    await h.say(ANNA, ph("ref2"));
    assert.equal(h.texts(ANNA).length, before + 1, "на альбом один ответ");
    await h.press(ANNA, /Готово/);
    await h.say(ANNA, "15 см");
    await h.press(ANNA, /Пропустить/);
    assert.match(h.lastText(ANNA), /Картинок: 2/);
    await h.press(ANNA, /Подтвердить/);
    assert.match(h.lastText(ANNA), /Заявка №1001/);
    assert.ok(h.calls.some((c) => c.method === "sendPhoto" && c.payload.photo === "ref2" && c.payload.chat_id === GROUP));

    const thread = await h.topicOf(ANNA);
    await h.press(GROUP, /Назначить цену и срок/, ADMIN);
    await h.adminSay("2 500", thread);
    await h.adminSay("5 дней", thread);
    assert.match(h.lastText(ANNA), /Цена: <b>2\s500 ₽<\/b>/u);

    await h.press(ANNA, /Согласен/);
    await h.press(ANNA, /Самовывоз/);
    await h.press(ANNA, /Отмена/);
    assert.equal(h.texts(ANNA).filter((t) => t.includes("Счёт по заказу")).length, 0);

    // Возвращается через «Мои заказы»
    await h.press(ANNA, /Мои заказы/);
    await h.press(ANNA, /№1001/);
    await h.press(ANNA, /Продолжить оформление/);
    await h.press(ANNA, /Самовывоз/);
    await h.say(ANNA, "Анна Иванова");
    await h.say(ANNA, "89001234567");
    await h.press(ANNA, /Подтвердить/);
    const invoice = h.texts(ANNA).find((t) => t.includes("Счёт по заказу"))!;
    assert.match(invoice, /2\s500 ₽/u);
  }));

test("своя модель: отказ от цены отменяет заявку", () =>
  withHarness(async (h) => {
    await h.say(ANNA, "/start");
    await h.press(ANNA, /Заказать свою модель/);
    await h.say(ANNA, "Кот");
    await h.press(ANNA, /Готово/);
    await h.say(ANNA, "10 см");
    await h.say(ANNA, "чёрный");
    await h.press(ANNA, /Подтвердить/);
    const thread = await h.topicOf(ANNA);
    await h.press(GROUP, /Назначить цену/, ADMIN);
    await h.adminSay("9999", thread);
    await h.adminSay("неделя", thread);
    await h.press(ANNA, /Отказаться/);
    const { rows } = await h.db.query(`SELECT status, cancel_reason FROM orders WHERE id = 1001`);
    assert.equal(rows[0]!.status, "cancelled");
    assert.match(rows[0]!.cancel_reason, /отказался/);
  }));

test("переписка анонимна: только copyMessage, одна тема, заметки не теряются", () =>
  withHarness(async (h) => {
    await h.say(ANNA, "Здравствуйте!");
    await h.say(ANNA, { photo: [{ file_id: "p", file_unique_id: "p", width: 1, height: 1 }] });
    assert.equal(h.calls.filter((c) => c.method === "createForumTopic").length, 1);
    const copies = h.calls.filter((c) => c.method === "copyMessage" && c.payload.chat_id === GROUP);
    assert.equal(copies.length, 2);
    const thread = await h.topicOf(ANNA);
    assert.equal(copies[0]!.payload.message_thread_id, thread);
    assert.equal(h.texts(ANNA).filter((t) => t.includes("Передал")).length, 1, "подтверждение не спамит");

    await h.adminSay("Добрый день, чем помочь?", thread);
    const reply = h.calls.findLast((c) => c.method === "copyMessage" && c.payload.chat_id === ANNA)!;
    assert.equal(reply.payload.from_chat_id, GROUP);
    assert.equal(h.calls.filter((c) => c.method === "forwardMessage").length, 0, "пересылка показала бы автора");

    // Служебные сообщения и команды не уходят покупателю
    const n = h.calls.filter((c) => c.method === "copyMessage").length;
    await h.adminSay({ forum_topic_edited: { name: "x" } }, thread);
    await h.adminSay("/admin", thread);
    assert.equal(h.calls.filter((c) => c.method === "copyMessage").length, n);

    // Сообщения вне темы и в неизвестной теме не уходят никому
    await h.adminSay("всем привет");
    await h.adminSay("чужая тема", 99999);
    assert.equal(h.calls.filter((c) => c.method === "copyMessage").length, n);
  }));

test("переписка: тема удалена, покупатель заблокировал бота", () =>
  withHarness(async (h) => {
    await h.say(ANNA, "первое");
    const oldThread = await h.topicOf(ANNA);
    h.fail.set("copyMessage", { error_code: 400, description: "Bad Request: message thread not found", times: 1 });
    await h.say(ANNA, "второе");
    const newThread = await h.topicOf(ANNA);
    assert.notEqual(newThread, oldThread);
    assert.equal(h.calls.findLast((c) => c.method === "copyMessage")!.payload.message_thread_id, newThread);

    h.fail.set("copyMessage", { error_code: 403, description: "Forbidden: bot was blocked by the user", times: 1, chatId: ANNA });
    await h.adminSay("ответ", newThread);
    assert.match(h.lastText(GROUP), /заблокировал бота/);
    const { rows } = await h.db.query(`SELECT blocked_bot FROM users WHERE id = $1`, [ANNA]);
    assert.equal(rows[0]!.blocked_bot, true);

    await h.say(ANNA, "я вернулся");
    const again = await h.db.query(`SELECT blocked_bot FROM users WHERE id = $1`, [ANNA]);
    assert.equal(again.rows[0]!.blocked_bot, false);
  }));

test("«Написать по заказу» подписывает номер заказа", () =>
  withHarness(async (h) => {
    await h.addProduct({ name: "Дракон", price: "100", photo: false });
    await h.say(ANNA, "/start");
    await h.press(ANNA, /Каталог/);
    await h.press(ANNA, /Животные/);
    await h.press(ANNA, /Дракон/);
    await h.press(ANNA, /В корзину/);
    await checkoutPickup(h, ANNA);
    await h.press(ANNA, /Мои заказы/);
    await h.press(ANNA, /Написать по заказу/);
    await h.say(ANNA, "Когда будет?");
    assert.ok(h.texts(GROUP).some((t) => t.includes("Сообщение по заказу №1001")));
    assert.match(h.lastText(ANNA), /Передал/);
  }));

test("чужой заказ недоступен, чужая группа игнорируется, админка только в своей группе", () =>
  withHarness(async (h) => {
    await h.addProduct({ name: "Дракон", price: "100", photo: false });
    await h.say(ANNA, "/start");
    await h.press(ANNA, /Каталог/);
    await h.press(ANNA, /Животные/);
    await h.press(ANNA, /Дракон/);
    await h.press(ANNA, /В корзину/);
    await checkoutPickup(h, ANNA);

    await h.say(BORIS, "/start");
    for (const data of ["o:1001", "r:1001", "w:1001", "oxy:1001", "qa:1001", "qr:1001", "qc:1001"]) {
      const n = h.alerts().length;
      await h.pressRaw(BORIS, data);
      assert.equal(h.alerts().length, n + 1, data);
      assert.match(h.alerts().at(-1)!, /не найден/, data);
    }
    const { rows } = await h.db.query(`SELECT status FROM orders WHERE id = 1001`);
    assert.equal(rows[0]!.status, "awaiting_payment");

    // Покупатель не может вызвать действия админа
    const before = h.calls.length;
    await h.pressRaw(BORIS, "ao:1001:paid");
    await h.pressRaw(BORIS, "a:mt");
    assert.equal(h.app.settings.isMaintenance(), false);
    const after = await h.db.query(`SELECT status FROM orders WHERE id = 1001`);
    assert.equal(after.rows[0]!.status, "awaiting_payment");
    assert.ok(h.calls.slice(before).every((c) => c.method === "answerCallbackQuery" || c.payload.chat_id === BORIS));

    // Посторонняя группа
    const n = h.calls.length;
    await h.adminSay("/admin", undefined, -999);
    await h.adminSay("привет", 5, -999);
    assert.equal(h.calls.length, n);
  }));

test("устаревшая кнопка у админа даёт подсказку, а не меняет заказ", () =>
  withHarness(async (h) => {
    await h.addProduct({ name: "Дракон", price: "100", photo: false });
    await h.say(ANNA, "/start");
    await h.press(ANNA, /Каталог/);
    await h.press(ANNA, /Животные/);
    await h.press(ANNA, /Дракон/);
    await h.press(ANNA, /В корзину/);
    await checkoutPickup(h, ANNA);
    await h.press(GROUP, /Оплата подтверждена/, ADMIN);
    // Второй админ жмёт ту же кнопку на старой карточке
    const data = "ao:1001:paid";
    const n = h.alerts().length;
    await h.adminSay("/admin");
    const call = h.calls.findLast((c) => c.payload.chat_id === GROUP && c.method === "sendMessage")!;
    call.payload.reply_markup.inline_keyboard[0][0].callback_data = data;
    await h.press(GROUP, new RegExp(call.payload.reply_markup.inline_keyboard[0][0].text), ADMIN);
    assert.equal(h.alerts().length, n + 1);
    assert.match(h.alerts().at(-1)!, /неактуально/);
  }));

test("поиск: находит, не падает на спецсимволах, предлагает свою модель", () =>
  withHarness(async (h) => {
    await h.addProduct({ name: "Дракон 100%", price: "100", photo: false });
    await h.addProduct({ name: "Кот", price: "200", photo: false });
    await h.say(ANNA, "/start");
    await h.press(ANNA, /Поиск/);
    await h.say(ANNA, "драк");
    assert.ok(h.buttons(ANNA).some((b) => b.includes("Дракон 100%")));
    assert.ok(!h.buttons(ANNA).some((b) => b.includes("Кот")));

    // Назад с карточки ведёт в результаты поиска
    await h.press(ANNA, /Дракон/);
    await h.press(ANNA, /Назад/);
    assert.match(h.lastText(ANNA), /нашлось по запросу «драк»/);

    await h.press(ANNA, /Назад/);
    await h.say(ANNA, "%");
    assert.ok(h.buttons(ANNA).some((b) => b.includes("Дракон 100%")));
    assert.ok(!h.buttons(ANNA).some((b) => b.includes("Кот")), "% ищется буквально");

    await h.press(ANNA, /Поиск|Назад/);
    await h.say(ANNA, "<script>&");
    assert.match(h.lastText(ANNA), /&lt;script&gt;&amp;/);
    assert.ok(h.buttons(ANNA).some((b) => b.includes("Заказать свою модель")));
  }));

test("навигация: в каждом подменю есть «Назад» и «Главное меню», длинный каталог листается", () =>
  withHarness(async (h) => {
    for (let i = 1; i <= 8; i++) await h.addProduct({ name: `Игрушка ${i}`, price: "100", photo: false });
    await h.say(ANNA, "/start");
    const check = (where: string) => {
      const b = h.buttons(ANNA);
      assert.ok(b.includes("⬅️ Назад"), `${where}: нет «Назад»: ${b}`);
      assert.ok(b.includes("🏠 Главное меню"), `${where}: нет «Главное меню»: ${b}`);
    };
    await h.press(ANNA, /Каталог/);
    check("категории");
    await h.press(ANNA, /Животные/);
    check("товары");
    assert.equal(h.buttons(ANNA).filter((b) => b.startsWith("Игрушка")).length, 6);
    await h.press(ANNA, /▶️/);
    check("товары, страница 2");
    assert.equal(h.buttons(ANNA).filter((b) => b.startsWith("Игрушка")).length, 2);
    await h.press(ANNA, /Игрушка/);
    check("карточка");
    await h.press(ANNA, /В корзину/);
    await h.press(ANNA, /Корзина/);
    check("корзина");
    await h.press(ANNA, /Назад/);
    await h.press(ANNA, /Доставка и оплата/);
    check("доставка");
    await h.press(ANNA, /Главное меню/);
    await h.press(ANNA, /Мои заказы/);
    check("заказы, пусто");
  }));

test("фото товара: карточка с фото, смена размера не перезагружает картинку", () =>
  withHarness(async (h) => {
    await h.addProduct({ name: "Дракон", price: "1500", sizes: "10 см, 15 см", colors: "белый, зелёный" });
    await h.say(ANNA, "/start");
    await h.press(ANNA, /Каталог/);
    await h.press(ANNA, /Животные/);
    await h.press(ANNA, /Дракон/);
    assert.equal(h.calls.findLast((c) => c.method === "sendPhoto")!.payload.photo, "photo-Дракон");
    await h.press(ANNA, /В корзину/);
    assert.ok(h.alerts().includes("Сначала выбери размер"));
    await h.press(ANNA, /^10 см$/);
    assert.equal(h.calls.at(-2)!.method, "editMessageCaption");
    await h.press(ANNA, /В корзину/);
    assert.ok(h.alerts().includes("Сначала выбери цвет"));
    await h.press(ANNA, /^белый$/);
    await h.press(ANNA, /В корзину/);
    assert.ok(h.alerts().includes("✅ Добавлено в корзину"));
    assert.ok(h.buttons(ANNA).includes("✅ 10 см"));
  }));

test("админка: правка и скрытие товара, скрытый товар нельзя купить", () =>
  withHarness(async (h) => {
    await h.addProduct({ name: "Дракон", price: "100", sizes: "15 см", photo: false });
    await h.say(ANNA, "/start");
    await h.press(ANNA, /Каталог/);
    await h.press(ANNA, /Животные/);
    await h.press(ANNA, /Дракон/);
    await h.press(ANNA, /В корзину/);

    await h.adminSay("/admin");
    await h.press(GROUP, /Товары/, ADMIN);
    await h.press(GROUP, /Дракон/, ADMIN);
    await h.press(GROUP, /^Цена$/, ADMIN);
    await h.adminSay("сто");
    assert.match(h.lastText(GROUP), /числом/);
    await h.adminSay("250,50");
    await h.press(GROUP, /Открыть товар/, ADMIN);
    assert.match(h.lastText(GROUP), /250,50 ₽/);
    await h.press(GROUP, /Скрыть/, ADMIN);

    await h.press(ANNA, /Корзина|Главное меню/);
    await h.say(ANNA, "/start");
    assert.ok(h.buttons(ANNA).includes("🛒 Корзина"), "скрытый товар не считается");
    await h.press(ANNA, /Корзина/);
    assert.match(h.lastText(ANNA), /пуста/);
    const n = h.alerts().length;
    await h.pressRaw(ANNA, "p:1:-1:-1");
    assert.equal(h.alerts().length, n + 1);
    await h.pressRaw(ANNA, "add:1:0:-1");
    assert.match(h.alerts().at(-1)!, /нет в продаже/);
  }));

test("обслуживание закрывает бота для покупателей, но не для админов", () =>
  withHarness(async (h) => {
    await h.adminSay("/admin");
    await h.press(GROUP, /Режим обслуживания/, ADMIN);
    await h.say(ANNA, "/start");
    assert.match(h.lastText(ANNA), /обслуживании/);
    await h.adminSay("/admin");
    assert.match(h.lastText(GROUP), /на обслуживании/);
    await h.press(GROUP, /Включить бота/, ADMIN);
    await h.say(ANNA, "/start");
    assert.match(h.lastText(ANNA), /Привет/);
  }));

test("рассылка: подтверждение, доставка всем, заблокировавшие помечаются, отчёт админу", () =>
  withHarness(async (h) => {
    for (const u of [ANNA, BORIS, 103]) await h.say(u, "/start");
    h.fail.set("copyMessage", { error_code: 403, description: "Forbidden: bot was blocked by the user", times: 1, chatId: BORIS });

    await h.adminSay("/admin");
    await h.press(GROUP, /Рассылка/, ADMIN);
    assert.equal(h.calls.filter((c) => c.method === "copyMessage").length, 0);
    await h.adminSay("Новинка!");
    assert.equal(h.calls.filter((c) => c.method === "copyMessage").length, 0, "без подтверждения ничего не уходит");
    await h.press(GROUP, /Отправить \(3\)/, ADMIN);
    await h.app.broadcast.drain();

    const copies = h.calls.filter((c) => c.method === "copyMessage");
    assert.deepEqual(copies.map((c) => c.payload.chat_id).sort(), [101, 103]);
    assert.match(h.lastText(GROUP), /Доставлено: 2, не доставлено: 1/);
    const { rows } = await h.db.query(`SELECT blocked_bot FROM users WHERE id = $1`, [BORIS]);
    assert.equal(rows[0]!.blocked_bot, true);
  }));

test("рассылка продолжается после перезапуска с нужного места", () =>
  withHarness(async (h) => {
    for (const u of [ANNA, BORIS, 103]) await h.say(u, "/start");
    await h.db.query(
      `INSERT INTO broadcasts (from_chat_id, message_id, cursor_user_id, sent) VALUES ($1, 5, $2, 1)`,
      [GROUP, ANNA],
    );
    await h.app.broadcast.resume();
    await h.app.broadcast.drain();
    assert.deepEqual(h.calls.filter((c) => c.method === "copyMessage").map((c) => c.payload.chat_id), [BORIS, 103]);
    assert.match(h.lastText(GROUP), /Доставлено: 3/);
  }));

test("перезапуск сервера не теряет оформление, корзину и настройки", () =>
  withHarness(async (h) => {
    await h.addProduct({ name: "Дракон", price: "100", photo: false });
    await h.adminSay("/admin");
    await h.press(GROUP, /Тексты/, ADMIN);
    await h.press(GROUP, /Приветствие/, ADMIN);
    await h.adminSay("Здорово, друг!");

    await h.say(ANNA, "/start");
    assert.match(h.lastText(ANNA), /Здорово, друг!/);
    await h.press(ANNA, /Каталог/);
    await h.press(ANNA, /Животные/);
    await h.press(ANNA, /Дракон/);
    await h.press(ANNA, /В корзину/);
    await h.press(ANNA, /Корзина/);
    await h.press(ANNA, /Оформить/);
    await h.press(ANNA, /Самовывоз/);

    await h.boot();

    await h.say(ANNA, "Анна Иванова");
    assert.match(h.lastText(ANNA), /Шаг 3 из 3|Поделись контактом/);
    await h.say(ANNA, "89001234567");
    await h.press(ANNA, /Подтвердить/);
    assert.ok(h.texts(ANNA).some((t) => t.includes("Счёт по заказу №1001")));
    await h.say(ANNA, "/start");
    assert.match(h.lastText(ANNA), /Здорово, друг!/);
  }));

test("неизвестная команда получает ответ, сбой Telegram не показывает покупателю стектрейс", () =>
  withHarness(async (h) => {
    await h.say(ANNA, "/foo");
    assert.match(h.lastText(ANNA), /Не знаю такой команды/);
    assert.equal(h.calls.filter((c) => c.method === "copyMessage").length, 0);

    h.fail.set("createForumTopic", { error_code: 400, description: "Bad Request: the chat is not a forum", times: 1 });
    await h.say(ANNA, "привет");
    assert.match(h.lastText(ANNA), /Что-то пошло не так/);
    assert.ok(h.texts(GROUP).some((t) => t.includes("Ошибка в боте")));
  }));

test("отмена на шаге телефона убирает клавиатуру", () =>
  withHarness(async (h) => {
    await h.addProduct({ name: "Дракон", price: "100", photo: false });
    await h.say(ANNA, "/start");
    await h.press(ANNA, /Каталог/);
    await h.press(ANNA, /Животные/);
    await h.press(ANNA, /Дракон/);
    await h.press(ANNA, /В корзину/);
    await h.press(ANNA, /Корзина/);
    await h.press(ANNA, /Оформить/);
    await h.press(ANNA, /Самовывоз/);
    await h.say(ANNA, "Анна Иванова");
    await h.say(ANNA, "❌ Отмена");
    assert.ok(h.calls.some((c) => c.payload.chat_id === ANNA && c.payload.reply_markup?.remove_keyboard));
    const { rows } = await h.db.query(`SELECT value FROM sessions WHERE key = $1`, [`u:${ANNA}`]);
    assert.equal(rows[0]!.value.flow, null);
  }));

test("покупатель отменяет неоплаченный заказ, но не заказ в работе", () =>
  withHarness(async (h) => {
    await h.addProduct({ name: "Дракон", price: "100", photo: false });
    await h.say(ANNA, "/start");
    await h.press(ANNA, /Каталог/);
    await h.press(ANNA, /Животные/);
    await h.press(ANNA, /Дракон/);
    await h.press(ANNA, /В корзину/);
    await checkoutPickup(h, ANNA);
    await h.pressRaw(ANNA, "ox:1001");
    await h.press(ANNA, /Да, отменить/);
    const { rows } = await h.db.query(`SELECT status FROM orders WHERE id = 1001`);
    assert.equal(rows[0]!.status, "cancelled");
    assert.ok(h.texts(GROUP).some((t) => t.includes("Отменён покупателем")));

    await h.press(ANNA, /Главное меню/);
    await h.press(ANNA, /Каталог/);
    await h.press(ANNA, /Животные/);
    await h.press(ANNA, /Дракон/);
    await h.press(ANNA, /В корзину/);
    await checkoutPickup(h, ANNA);
    await h.press(GROUP, /Оплата подтверждена/, ADMIN);
    await h.pressRaw(ANNA, "oxy:1002");
    assert.match(h.alerts().at(-1)!, /уже в работе/);
  }));

test("сбой обработчика не выходит наружу: при webhook Telegram не будет повторять апдейт", () =>
  withHarness(async (h) => {
    h.fail.set("createForumTopic", { error_code: 500, description: "Internal Server Error", times: 1 });
    await assert.doesNotReject(h.say(ANNA, "привет"));
    assert.match(h.lastText(ANNA), /Что-то пошло не так/);
  }));
