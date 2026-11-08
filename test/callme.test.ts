import assert from "node:assert/strict";
import { test } from "node:test";
import { createCallmeService, orderCallText, type CallmeTransport } from "../src/modules/callme/callme.service.js";
import type { Order } from "../src/modules/orders/orders.types.js";

function order(partial: Partial<Order>): Order {
  return {
    id: 1001,
    userId: 101,
    type: "catalog",
    status: "new",
    items: [],
    subtotal: 150000,
    delivery: "courier",
    deliveryCost: 35000,
    fullName: "Анна Иванова",
    phone: "+79001234567",
    address: "Москва, Тверская, 1",
    comment: null,
    description: null,
    wishes: null,
    photos: [],
    deadline: null,
    quotePhotoFileId: null,
    quoteAccepted: false,
    receiptFileId: null,
    receiptKind: null,
    trackingUrl: null,
    cancelReason: null,
    ...partial,
  };
}

test("текст звонка: состав, сумма с доставкой, способ получения, покупатель", () => {
  const text = orderCallText(order({ items: [{ name: "Дракон", price: 150000, qty: 2 }] }));
  assert.match(text, /заказ номер 1001/);
  assert.match(text, /Дракон, 2 штук/);
  assert.match(text, /1850 рублей/); // 1500 + 350 доставка
  assert.match(text, /курьером/);
  assert.match(text, /Анна Иванова/);
  assert.ok(!/[<b>\n]/.test(text), "без разметки: текст читается вслух");
});

test("текст звонка по своей модели и самовывозу", () => {
  const text = orderCallText(order({ type: "custom", description: "Кот по фото", delivery: "pickup", items: [] }));
  assert.match(text, /Своя модель: Кот по фото/);
  assert.match(text, /Самовывоз/);
});

test("звонок: детали, ответ владельца текстом, уточнение и завершение", async () => {
  const paths: string[] = [];
  const transcripts: string[] = [];
  const transport: CallmeTransport = {
    async post(path, body) {
      paths.push(path);
      if (path === "/ring") {
        assert.match(body.text as string, /заказ номер 1001/);
        assert.equal(body.language, "ru");
        return { status: "completed", transcript: "Принял заказ", open: true, call_id: "c1", session_token: "s1" };
      }
      if (path === "/aiphone/calls/c1/say") return { transcript: "всё понятно" };
      return {};
    },
  };
  const callme = createCallmeService("1234567890", transport, async (t) => void transcripts.push(t));
  callme.ringOrder(order({}));

  for (let i = 0; i < 50 && paths.length < 3; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(paths, ["/ring", "/aiphone/calls/c1/say", "/aiphone/calls/c1/hangup"]);
  assert.deepEqual(transcripts, ["Принял заказ", "всё понятно"]);
});

test("без номера звонки выключены и ничего не ломают", async () => {
  let called = 0;
  const transport: CallmeTransport = { async post() { called++; return {}; } };
  const callme = createCallmeService(null, transport, async () => {});
  assert.equal(callme.enabled, false);
  callme.ringOrder(order({}));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(called, 0);
});

test("сбой звонка не роняет заказ, а пишет предупреждение", async () => {
  const transcripts: string[] = [];
  const transport: CallmeTransport = { async post() { throw new Error("HTTP 503"); } };
  const callme = createCallmeService("1234567890", transport, async (t) => void transcripts.push(t));
  callme.ringOrder(order({}));
  for (let i = 0; i < 50 && transcripts.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  assert.match(transcripts[0]!, /Звонок по заказу №1001 не состоялся/);
});
