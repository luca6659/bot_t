// Модуль оплаты. Сейчас работает ручной провайдер: реквизиты + фото чека, подтверждение админом.
// Чтобы добавить ЮKassa: реализовать PaymentProvider и подставить его в create-bot вместо manual.
import { InlineKeyboard } from "grammy";
import { t } from "../../i18n/texts.js";
import type { Order } from "../orders/orders.types.js";
import { invoiceText } from "../orders/orders.views.js";
import type { SettingsService } from "../settings/settings.service.js";

export interface PaymentProvider {
  readonly kind: string;
  // Текст счёта и кнопки под ним.
  invoiceView(order: Order): { text: string; kb: InlineKeyboard };
  // Без реквизитов покупатель не знает, куда платить: админы получат предупреждение.
  requisitesMissing(): boolean;
}

export function createManualPaymentProvider(settings: SettingsService): PaymentProvider {
  return {
    kind: "manual",
    invoiceView(order) {
      const kb = new InlineKeyboard()
        .text(t("btn.send_receipt"), `r:${order.id}`).row()
        .text(t("btn.cancel_order"), `ox:${order.id}`).row()
        .text(t("btn.main"), "m");
      return { text: invoiceText(order), kb };
    },
    requisitesMissing() {
      return !t("requisites");
    },
  };
}
