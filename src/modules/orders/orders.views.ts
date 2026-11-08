// Тексты и кнопки заказа. Одна карточка для покупателя и для админов, чтобы не дублировать логику.
import { InlineKeyboard } from "grammy";
import { t } from "../../i18n/texts.js";
import { esc, formatRub } from "../../views/format.js";
import { STATUS_LABELS, orderTotal, type Order } from "./orders.types.js";

export function orderLines(o: Order): string {
  if (o.type === "custom") {
    const lines = [`🎨 Своя модель: ${esc(o.description || "по фото")}`];
    if (o.wishes) lines.push(`📝 Пожелания: ${esc(o.wishes)}`);
    if (o.subtotal !== null) lines.push(`💰 Цена: ${formatRub(o.subtotal)}`);
    if (o.deadline) lines.push(`⏳ Срок: ${esc(o.deadline)}`);
    return lines.join("\n");
  }
  return o.items.map((i) => `• ${esc(i.name)}: ${i.qty} × ${formatRub(i.price)}`).join("\n");
}

export function deliveryLabel(o: Pick<Order, "delivery">): string {
  if (o.delivery === "courier") return t("btn.courier");
  if (o.delivery === "pickup") return t("btn.pickup");
  return "не выбрано";
}

export function orderDetails(o: Order): string {
  const parts = [`<b>Заказ №${o.id}</b> · ${STATUS_LABELS[o.status]}`, orderLines(o)];
  const delivery = [`Получение: ${deliveryLabel(o)}`];
  if (o.fullName) delivery.push(`Получатель: ${esc(o.fullName)}`);
  if (o.phone) delivery.push(`Телефон: ${esc(o.phone)}`);
  if (o.address) delivery.push(`Адрес: ${esc(o.address)}`);
  if (o.comment) delivery.push(`Комментарий: ${esc(o.comment)}`);
  if (o.delivery) parts.push(delivery.join("\n"));

  const money: string[] = [];
  if (o.deliveryCost !== null && o.deliveryCost > 0) money.push(`Доставка: ${formatRub(o.deliveryCost)}`);
  if (o.subtotal !== null) money.push(`Итого: <b>${formatRub(orderTotal(o))}</b>`);
  if (money.length) parts.push(money.join("\n"));

  if (o.trackingUrl) parts.push(`Отслеживание: ${esc(o.trackingUrl)}`);
  if (o.cancelReason) parts.push(`Причина отмены: ${esc(o.cancelReason)}`);
  return parts.join("\n\n");
}

export function invoiceText(o: Order): string {
  const lines = orderLines(o).split("\n");
  if (o.deliveryCost !== null && o.deliveryCost > 0) lines.push(`🚚 Доставка: ${formatRub(o.deliveryCost)}`);
  return t("invoice", {
    id: o.id,
    lines: lines.join("\n"),
    total: formatRub(orderTotal(o)),
    requisites: t("requisites") || t("invoice.no_requisites"),
  });
}

export function adminOrderKb(o: Order): InlineKeyboard {
  const kb = new InlineKeyboard();
  const act = (label: string, name: string) => kb.text(label, `ao:${o.id}:${name}`).row();

  switch (o.status) {
    case "new":
      if (o.type === "custom" && !o.quoteAccepted) act(o.subtotal === null ? "💰 Назначить цену и срок" : "💰 Изменить цену и срок", "quote");
      if (o.delivery === "courier" && o.deliveryCost === null) act("🚚 Указать стоимость доставки", "dcost");
      break;
    case "awaiting_payment":
      act("✅ Оплата подтверждена", "paid");
      break;
    case "receipt_check":
      act("✅ Оплата подтверждена", "paid");
      act("❌ Чек не принят", "reject");
      break;
    case "paid":
      act(o.type === "custom" ? "🖨 В печать" : "📦 Собирается", o.type === "custom" ? "printing" : "assembling");
      break;
    case "assembling":
    case "printing":
      if (o.delivery === "courier") act("🚕 Передан курьеру", "courier");
      else act("🏠 Ждёт самовывоза", "pickup_ready");
      break;
    case "pickup_ready":
      act("🏁 Выдан покупателю", "done");
      break;
    case "courier":
      act("🏁 Выполнен", "done");
      break;
    default:
      break;
  }
  if (o.status !== "done" && o.status !== "cancelled") act("🚫 Отменить заказ", "cancel");
  return kb;
}
