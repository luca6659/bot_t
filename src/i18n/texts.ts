// Все видимые тексты по ключам. Часть из них админ меняет в /admin без деплоя.
// Бот общается с покупателем на «ты». Значения в HTML-разметке Telegram.
const dictionary = {
  // Редактируемые через админку
  "greeting": "Привет! 👋 Здесь можно купить готовую 3D-игрушку или заказать свою. Что посмотрим?",
  "delivery_info":
    "<b>Доставка</b>\n🚕 Яндекс.Курьер или 🏠 самовывоз.\n\n<b>Оплата</b>\nПосле оформления пришлю счёт с реквизитами. Оплати и отправь чек прямо сюда 📸",
  "requisites": "",
  "pickup_info": "Адрес самовывоза уточним после оформления заказа.",
  "about_info": "Печатаем игрушки на 3D-принтере с любовью 💜 Готовые модельки — в каталоге, особенную сделаем по твоим фото.",
  "maintenance": "🛠 Бот на обслуживании. Скоро вернёмся!",

  // Кнопки
  "btn.back": "⬅️ Назад",
  "btn.main": "🏠 Главное меню",
  "btn.catalog": "🛍 Каталог",
  "btn.search": "🔍 Поиск",
  "btn.custom": "🎨 Своя модель",
  "btn.cart": "🛒 Корзина",
  "btn.orders": "📦 Мои заказы",
  "btn.write": "💬 Связаться",
  "btn.hits": "🔥 Хиты и новинки",
  "btn.info": "ℹ️ О нас и доставка",
  "btn.cancel": "❌ Отмена",
  "btn.prev": "◀️",
  "btn.next": "▶️",
  "btn.add_to_cart": "🛒 В корзину",
  "btn.checkout": "✅ Оформить",
  "btn.clear_cart": "🧹 Очистить",
  "btn.courier": "🚕 Яндекс.Курьер",
  "btn.pickup": "🏠 Самовывоз",
  "btn.share_contact": "📱 Поделиться контактом",
  "btn.confirm": "✅ Подтвердить",
  "btn.send_receipt": "📸 Отправить чек",
  "btn.write_order": "💬 Написать продавцу",
  "btn.cancel_order": "❌ Отменить заказ",
  "btn.yes_cancel": "Да, отменить",
  "btn.no_keep": "Нет, оставить",
  "btn.accept_quote": "✅ Согласен",
  "btn.discuss_quote": "💬 Обсудить",
  "btn.reject_quote": "❌ Отказаться",
  "btn.done": "✅ Готово",
  "btn.skip": "⏭ Пропустить",
  "btn.continue_checkout": "▶️ Продолжить оформление",

  // Каталог
  "catalog.title": "🛍 <b>Каталог</b>\nВыбери категорию:",
  "catalog.empty": "Каталог пока наполняется. Загляни чуть позже или закажи свою модель 🎨",
  "catalog.category_empty": "В этой категории пока ничего нет. Загляни в другую или закажи свою модель 🎨",
  "catalog.hits_empty": "Скоро здесь появятся хиты и новинки. А пока — загляни в каталог 🛍",
  "catalog.added": "Добавлено ✅",
  "catalog.in_stock": "✅ В наличии",
  "catalog.on_order": "🖨 Под заказ: напечатаем для тебя",
  "search.prompt": "🔍 Напиши название игрушки, которую ищешь:",
  "search.empty":
    "По запросу «{query}» ничего не нашлось. Попробуй другое слово или закажи такую модель специально для тебя 🎨",

  // Корзина
  "cart.empty": "🛒 Корзина пока пуста.",
  "cart.title": "🛒 <b>Корзина</b>",
  "cart.total": "Итого: <b>{total}</b>",

  // Оформление
  "checkout.name": "Шаг 1 из {total}. Напиши имя и фамилию получателя:",
  "checkout.phone": "Шаг 2 из {total}. Поделись контактом кнопкой ниже или напиши телефон:",
  "checkout.delivery": "Шаг 3 из {total}. Как хочешь получить заказ?",
  "checkout.address": "Шаг 4 из {total}. Напиши адрес доставки: город, улица, дом, квартира.\nИли пришли геолокацию 📍",
  "checkout.comment": "Шаг {step} из {total}. Комментарий к заказу? Например, код домофона или пожелания по упаковке.",
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
    "🎨 <b>Своя модель</b>\n\nШаг 1 из 3. Опиши, что хочешь, и прикрепи до 10 фото-референсов — альбомом или по одному. Когда всё отправишь, нажми «Готово».",
  "custom.got": "Принято: текст {text}, фото {photos} из 10. Добавь ещё или нажми «Готово».",
  "custom.need_description": "Опиши идею хотя бы парой слов или пришли фото.",
  "custom.wishes": "Шаг 2 из 3. Пожелания и сроки: размер, цвет, к какой дате нужно. Если без особенностей — жми «Пропустить».",
  "custom.summary": "<b>Проверь заявку</b>\n\n{details}",
  "custom.created": "✅ Заявка №{id} у мастера. Как только оценит, пришлю тебе цену и срок ⏳",
  "custom.daily_limit": "У тебя уже много заявок за сегодня 🙏 Напиши нам через «Связаться» или вернись завтра.",
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
    "🧾 <b>Счёт по заказу №{id}</b>\n\n{lines}\n\nИтого к оплате: <b>{total}</b>\n\n<b>Реквизиты:</b>\n{requisites}\n\nПосле оплаты нажми «Отправить чек» и пришли 📸 фото чека.",
  "invoice.no_requisites": "пришлём отдельным сообщением",
  "receipt.prompt": "📸 Пришли фото или файл чека по заказу №{id}:",
  "receipt.need_file": "Нужно фото или файл чека. Пришли его или нажми «Отмена».",
  "receipt.received": "🧾 Чек получен! Проверим оплату и сообщим тебе.",

  // Уведомления о статусах
  "status.awaiting_payment.rejected": "❌ Чек по заказу №{id} не приняли. Проверь оплату и пришли чек ещё раз.",
  "status.paid": "✅ Оплата заказа №{id} подтверждена. Спасибо!",
  "status.assembling": "📦 Заказ №{id} собирается.",
  "status.printing": "🖨 Заказ №{id} пошёл в печать.",
  "status.pickup_ready": "🏠 Заказ №{id} ждёт тебя на самовывозе!\n\n{pickup}",
  "status.courier": "🚕 Заказ №{id} передан курьеру.",
  "status.courier.tracking": "🚕 Заказ №{id} передан курьеру.\nОтслеживание: {url}",
  "status.done": "🎉 Заказ №{id} выполнен. Спасибо, что выбрал нас!",
  "status.cancelled": "❌ Заказ №{id} отменён.",
  "status.cancelled.reason": "❌ Заказ №{id} отменён.\nПричина: {reason}",

  // Переписка
  "relay.prompt": "💬 Напиши сообщение, можно с фото или голосовым. Я передам его продавцу:",
  "relay.prompt_order": "💬 Напиши сообщение по заказу №{id}, можно с фото или голосовым:",
  "relay.ack": "✅ Передал! Ответ придёт прямо сюда.",

  // Ошибки и ограничения
  "unknown_command": "Не знаю такой команды. Всё нужное есть в меню 👇",
  "error.rate_limit": "Слишком много сообщений. Подожди пару секунд 🙏",
  "error.file_too_big": "Файл слишком большой: нужно до 20 МБ 🙏",
  "error.banned": "Доступ к боту ограничен. Если это ошибка — свяжись с нами через другой канал.",
} as const;

export type TextKey = keyof typeof dictionary;

export const EDITABLE_TEXTS = {
  greeting: "Приветствие",
  delivery_info: "Доставка и оплата",
  requisites: "Реквизиты для оплаты",
  pickup_info: "Адрес и часы самовывоза",
  about_info: "О нас",
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
