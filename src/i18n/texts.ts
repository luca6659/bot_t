// Все видимые тексты по ключам. Часть из них админ меняет в /admin без деплоя.
// Бот общается с покупателем на «ты». Значения в HTML-разметке Telegram.
const dictionary = {
  // Редактируемые через админку
  "greeting": "Привет! 👋 Здесь можно купить готовую 3D-игрушку или заказать свою. Что посмотрим?",
  "delivery_info":
    "<b>Доставка</b>\nЯндекс курьер или самовывоз.\n\n<b>Оплата</b>\nПосле оформления пришлю счёт с реквизитами. Оплати и отправь чек прямо сюда.",
  "requisites": "",
  "pickup_info": "Адрес самовывоза уточним после оформления заказа.",
  "maintenance": "🛠 Бот на обслуживании. Скоро вернёмся!",

  // Кнопки
  "btn.back": "⬅️ Назад",
  "btn.main": "🏠 Главное меню",
  "btn.catalog": "🛍 Каталог",
  "btn.search": "🔍 Поиск",
  "btn.custom": "✨ Заказать свою модель",
  "btn.cart": "🛒 Корзина",
  "btn.orders": "📦 Мои заказы",
  "btn.write": "💬 Написать",
  "btn.info": "ℹ️ Доставка и оплата",
  "btn.cancel": "❌ Отмена",
  "btn.prev": "◀️",
  "btn.next": "▶️",
  "btn.add_to_cart": "🛒 В корзину",
  "btn.checkout": "✅ Оформить",
  "btn.clear_cart": "🧹 Очистить",
  "btn.courier": "🚚 Яндекс курьер",
  "btn.pickup": "🏪 Самовывоз",
  "btn.share_contact": "📱 Поделиться контактом",
  "btn.confirm": "✅ Подтвердить",
  "btn.send_receipt": "📎 Отправить чек",
  "btn.write_order": "💬 Написать по заказу",
  "btn.cancel_order": "❌ Отменить заказ",
  "btn.yes_cancel": "Да, отменить",
  "btn.no_keep": "Нет, оставить",
  "btn.accept_quote": "✅ Согласен",
  "btn.reject_quote": "❌ Отказаться",
  "btn.done": "✅ Готово",
  "btn.skip": "Пропустить",
  "btn.continue_checkout": "▶️ Продолжить оформление",

  // Каталог
  "catalog.title": "🛍 Выбери категорию:",
  "catalog.empty": "Каталог пока наполняется. Загляни чуть позже или закажи свою модель ✨",
  "catalog.category_empty": "В этой категории пока ничего нет.",
  "catalog.choose_size": "Сначала выбери размер",
  "catalog.choose_color": "Сначала выбери цвет",
  "catalog.added": "✅ Добавлено в корзину",
  "search.prompt": "🔍 Напиши название игрушки, которую ищешь:",
  "search.results": "🔍 Вот что нашлось по запросу «{query}»:",
  "search.empty":
    "По запросу «{query}» ничего не нашлось. Попробуй другое слово или закажи такую модель специально для тебя ✨",

  // Корзина
  "cart.empty": "🛒 Корзина пока пуста.",
  "cart.title": "🛒 <b>Корзина</b>",
  "cart.total": "Итого: <b>{total}</b>",

  // Оформление
  "checkout.delivery": "Шаг 1 из {total}. Как хочешь получить заказ?",
  "checkout.name": "Шаг {step} из {total}. Напиши имя и фамилию получателя:",
  "checkout.phone": "Шаг {step} из {total}. Поделись контактом кнопкой ниже или напиши телефон:",
  "checkout.address": "Шаг {step} из {total}. Напиши адрес доставки: город, улица, дом, квартира:",
  "checkout.use_saved": "Как в прошлый раз: {value}",
  "checkout.summary": "<b>Проверь заказ</b>\n\n{details}",
  "checkout.bad_name": "Имя выглядит слишком коротким. Напиши имя и фамилию.",
  "checkout.bad_phone": "Не получилось разобрать номер. Напиши его цифрами, например +7 900 123-45-67.",
  "checkout.bad_address": "Адрес выглядит слишком коротким. Напиши город, улицу, дом и квартиру.",
  "checkout.need_text": "Нужен текст. Напиши сообщением или нажми «Отмена».",
  "checkout.waiting_delivery": "✅ Заказ №{id} принят! Считаем стоимость доставки и скоро пришлём счёт ⏳",
  "flow.cancelled": "Хорошо, отменили.",

  // Своя модель
  "custom.description":
    "✨ <b>Своя модель</b>\n\nШаг 1 из 3. Опиши идею и прикрепи картинки, если есть. Когда всё отправишь, нажми «Готово».",
  "custom.got": "Принято: текст {text}, картинок {photos}. Добавь ещё или нажми «Готово».",
  "custom.need_description": "Опиши идею хотя бы парой слов или пришли картинку.",
  "custom.size": "Шаг 2 из 3. Какой нужен размер? Например, 15 см:",
  "custom.color": "Шаг 3 из 3. Какой цвет хочешь?",
  "custom.summary": "<b>Проверь заявку</b>\n\n{details}",
  "custom.created": "✅ Заявка №{id} у мастера. Как только оценит, пришлю тебе цену и срок ⏳",
  "custom.quote":
    "💰 <b>Заявка №{id} оценена</b>\n\nЦена: <b>{price}</b>\nСрок: {deadline}\n\nБерём в работу?",
  "custom.rejected": "Хорошо, заявку №{id} отменили. Будем рады помочь в другой раз!",

  // Заказы
  "orders.empty": "📦 Заказов пока нет.",
  "orders.title": "📦 <b>Твои заказы</b>",
  "orders.confirm_cancel": "Точно отменить заказ №{id}?",
  "orders.cancelled_by_client": "Отменён покупателем",
  "quote.rejected_reason": "Покупатель отказался от цены",

  // Счёт и чек
  "invoice":
    "🧾 <b>Счёт по заказу №{id}</b>\n\n{lines}\n\nИтого к оплате: <b>{total}</b>\n\n<b>Реквизиты:</b>\n{requisites}\n\nПосле оплаты нажми «Отправить чек».",
  "invoice.no_requisites": "пришлём отдельным сообщением",
  "receipt.prompt": "📎 Пришли фото или файл чека по заказу №{id}:",
  "receipt.need_file": "Нужно фото или файл чека. Пришли его или нажми «Отмена».",
  "receipt.received": "🔍 Чек получен! Проверим оплату и сообщим тебе.",

  // Уведомления о статусах
  "status.awaiting_payment.rejected": "❌ Чек по заказу №{id} не приняли. Проверь оплату и пришли чек ещё раз.",
  "status.paid": "✅ Оплата заказа №{id} подтверждена. Спасибо!",
  "status.printing": "🖨 Заказ №{id} пошёл в печать.",
  "status.ready.courier": "📦 Заказ №{id} готов и скоро уедет с курьером.",
  "status.ready.pickup": "📦 Заказ №{id} готов, можно забирать!\n\n{pickup}",
  "status.courier": "🚚 Заказ №{id} передан курьеру.",
  "status.courier.tracking": "🚚 Заказ №{id} передан курьеру.\nОтслеживание: {url}",
  "status.done": "🎉 Заказ №{id} выполнен. Спасибо, что выбрал нас!",
  "status.cancelled": "❌ Заказ №{id} отменён.",
  "status.cancelled.reason": "❌ Заказ №{id} отменён.\nПричина: {reason}",

  // Переписка
  "relay.prompt": "💬 Напиши сообщение, можно с фото или голосовым. Я передам его нам в команду:",
  "relay.prompt_order": "💬 Напиши сообщение по заказу №{id}, можно с фото или голосовым:",
  "relay.ack": "✅ Передал! Ответ придёт прямо сюда.",

  // Ошибки
  "unknown_command": "Не знаю такой команды. Всё нужное есть в меню 👇",
  "error.rate_limit": "Слишком много сообщений. Подожди пару секунд 🙏",
} as const;

export type TextKey = keyof typeof dictionary;

export const EDITABLE_TEXTS = {
  greeting: "Приветствие",
  delivery_info: "Доставка и оплата",
  requisites: "Реквизиты для оплаты",
  pickup_info: "Адрес и часы самовывоза",
  maintenance: "Сообщение об обслуживании",
} as const;
export type EditableTextKey = keyof typeof EDITABLE_TEXTS;

let overrides: Record<string, string> = {};

// Загружает значения из настроек: текст админа важнее значения по умолчанию.
export function setTextOverrides(values: Record<string, string>): void {
  overrides = values;
}

export function t(key: TextKey, vars: Record<string, string | number> = {}): string {
  let text: string = overrides[key] ?? dictionary[key];
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}
