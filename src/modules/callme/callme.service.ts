// Звонок владельцу при новом заказе через call-me (https://callmemcp.com).
// Бот звонит, читает детали вслух, а голосовой ответ владельца приходит текстом в группу админов.
// Без CALLME_NUMBER модуль молча выключен: заказы работают как раньше.
import { logger } from "../../infrastructure/logger.js";
import type { Order } from "../orders/orders.types.js";
import { orderTotal } from "../orders/orders.types.js";

const API = "https://callmemcp.com";
const RING_TIMEOUT_MS = 310_000; // /ring ждёт ответ до 300 секунд, берём с запасом.

export interface CallmeTransport {
  post(path: string, body: Record<string, unknown>, timeoutMs: number): Promise<any>;
}

// Текст, который нейронка прочитает вслух. Коротко и по-русски, без разметки.
export function orderCallText(o: Order): string {
  const lines = [`Новый заказ номер ${o.id}.`];
  if (o.type === "custom") {
    lines.push(`Своя модель: ${o.description || "по фото"}.`);
  } else {
    const items = o.items.map((i) => `${i.name}, ${i.qty} штук`).join("; ");
    if (items) lines.push(`Состав: ${items}.`);
  }
  if (o.subtotal !== null) lines.push(`Сумма ${Math.round(orderTotal(o) / 100)} рублей.`);
  lines.push(o.delivery === "pickup" ? "Самовывоз." : "Доставка курьером.");
  if (o.fullName) lines.push(`Покупатель: ${o.fullName}.`);
  return lines.join(" ").slice(0, 1900); // Лимит сервиса — 2000 символов.
}

export function createCallmeService(
  number: string | null,
  transport: CallmeTransport,
  onTranscript: (text: string) => Promise<void>,
) {
  const enabled = Boolean(number);

  async function post(path: string, body: Record<string, unknown>, timeoutMs = 30_000): Promise<any> {
    return transport.post(path, body, timeoutMs);
  }

  async function call(text: string): Promise<void> {
    const ring = await post("/ring", { to: number, text, from: "3D Магазин", language: "ru", keep_open: true }, RING_TIMEOUT_MS);
    if (ring.transcript) await onTranscript(String(ring.transcript));
    logger.info({ action: "callme.ring", status: ring.status });

    // Если владелец ответил и линия открыта — одна уточняющая реплика и завершаем.
    if (ring.open && ring.call_id && ring.session_token) {
      const base = { session_token: ring.session_token };
      const say = await post(`/aiphone/calls/${ring.call_id}/say`, {
        ...base,
        text: "Если есть вопросы по заказу, скажи. Если всё понятно, скажи: всё понятно.",
        language: "ru",
      });
      if (say.transcript) await onTranscript(String(say.transcript));
      await post(`/aiphone/calls/${ring.call_id}/hangup`, { ...base, text: "Спасибо, заказ уже в работе в админке." }).catch(() => {});
    }
  }

  return {
    enabled,
    // Не ждём звонок в сценарии заказа: /ring может висеть до 5 минут, пока владелец не возьмёт трубку.
    ringOrder(order: Order): void {
      if (!enabled) return;
      call(orderCallText(order)).catch(async (err) => {
        logger.warn({ action: "callme.failed", orderId: order.id, err: String(err) });
        await onTranscript(`⚠️ Звонок по заказу №${order.id} не состоялся: ${String(err).slice(0, 200)}`).catch(() => {});
      });
    },
  };
}
export type CallmeService = ReturnType<typeof createCallmeService>;

export function createHttpTransport(): CallmeTransport {
  return {
    async post(path, body, timeoutMs) {
      const res = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`call-me HTTP ${res.status}`);
      return res.json();
    },
  };
}
