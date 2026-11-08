// Имитация Telegram: бот работает по-настоящему, а вызовы API записываются и проверяются по правилам Telegram.
import assert from "node:assert/strict";
import type { Update } from "grammy/types";
import { createBot } from "../src/bot/create-bot.js";
import { createLocalDb, type Db } from "../src/infrastructure/db.js";
import { runMigrations } from "../src/infrastructure/migrations.js";

export const GROUP = -1001;
export const ADMIN = 900;
export const BOT_ID = 777;

export interface Call {
  method: string;
  payload: any;
  messageId?: number;
}

const ALLOWED_TAGS = /<\/?(b|code)>/g;

// Telegram отвергает кривую разметку и слишком длинные тексты: ловим это в тестах.
function checkTelegramRules(payload: any): void {
  const text = payload.text ?? payload.caption ?? payload.media?.caption;
  if (typeof text === "string") {
    if (payload.parse_mode === "HTML" || payload.media?.parse_mode === "HTML") {
      const stripped = text.replace(ALLOWED_TAGS, "");
      assert.ok(!/[<>]/.test(stripped), `Кривой HTML: ${text}`);
      assert.ok(!/&(?!amp;|lt;|gt;)/.test(stripped), `Неэкранированный &: ${text}`);
    }
    assert.ok(text.length > 0, "Пустой текст");
    assert.ok(text.length <= (payload.text !== undefined ? 4096 : 1024), `Слишком длинно: ${text.length}`);
  }
  for (const row of payload.reply_markup?.inline_keyboard ?? []) {
    assert.ok(row.length > 0, "Пустой ряд кнопок");
    for (const button of row) {
      assert.ok(Buffer.byteLength(button.callback_data) <= 64, `callback_data длиннее 64 байт: ${button.callback_data}`);
    }
  }
}

export class Harness {
  calls: Call[] = [];
  // Настоящий Telegram помнит тему сообщения и после редактирования.
  private threadOfMessage = new Map<number, number>();
  fail = new Map<string, { error_code: number; description: string; times: number; chatId?: number }>();
  private nextMessageId = 1000;
  private nextThreadId = 500;
  private nextUpdateId = 1;
  app!: Awaited<ReturnType<typeof createBot>>;

  private constructor(public db: Db) {}

  static async create(db?: Db): Promise<Harness> {
    const database = db ?? (await createLocalDb());
    await runMigrations(database);
    const h = new Harness(database);
    await h.boot();
    return h;
  }

  // Новый экземпляр бота на той же базе: имитирует перезапуск сервера.
  async boot(): Promise<void> {
    this.app = await createBot({
      token: "1:test",
      adminGroupId: GROUP,
      db: this.db,
      broadcastDelayMs: 0,
      rateLimit: 100_000,
      botConfig: {
        botInfo: {
          id: BOT_ID, is_bot: true, first_name: "Toys", username: "toys_bot",
          can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false,
          can_connect_to_business: false, has_main_web_app: false,
        } as any,
      },
      configureApi: (bot) => {
        bot.api.config.use(async (_prev, method, payload: any) => {
          checkTelegramRules(payload);
          const failure = this.fail.get(method);
          if (failure && failure.times > 0 && (failure.chatId === undefined || failure.chatId === payload.chat_id)) {
            failure.times--;
            return { ok: false, error_code: failure.error_code, description: failure.description } as any;
          }
          const call: Call = { method, payload };
          this.calls.push(call);
          if (method === "createForumTopic") {
            return { ok: true, result: { message_thread_id: ++this.nextThreadId, name: payload.name, icon_color: 0 } } as any;
          }
          if (method === "answerCallbackQuery" || method === "deleteMessage" || method === "editForumTopic") {
            return { ok: true, result: true } as any;
          }
          call.messageId = payload.message_id && method.startsWith("edit") ? payload.message_id : ++this.nextMessageId;
          if (payload.message_thread_id) this.threadOfMessage.set(call.messageId!, payload.message_thread_id);
          return {
            ok: true,
            result: { message_id: call.messageId, date: 0, chat: { id: payload.chat_id, type: "private" }, text: payload.text },
          } as any;
        });
      },
    });
  }

  private async update(u: Partial<Update>): Promise<void> {
    await this.app.bot.handleUpdate({ update_id: this.nextUpdateId++, ...u } as Update);
  }

  private fromUser(id: number) {
    return { id, is_bot: false, first_name: id === ADMIN ? "Админ" : `Клиент${id}`, username: `user${id}` };
  }

  // Сообщение покупателя в личку.
  async say(userId: number, content: string | Record<string, unknown>): Promise<void> {
    const body = typeof content === "string" ? { text: content } : content;
    const text = (body as any).text as string | undefined;
    await this.update({
      message: {
        message_id: ++this.nextMessageId, date: 0, chat: { id: userId, type: "private", first_name: "x" },
        from: this.fromUser(userId), ...body,
        ...(text?.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] } : {}),
      } as any,
    });
  }

  // Сообщение админа в группе. threadId: тема покупателя.
  async adminSay(content: string | Record<string, unknown>, threadId?: number, chatId = GROUP): Promise<void> {
    const body = typeof content === "string" ? { text: content } : content;
    const text = (body as any).text as string | undefined;
    await this.update({
      message: {
        message_id: ++this.nextMessageId, date: 0, chat: { id: chatId, type: "supergroup", title: "Админы", is_forum: true },
        from: this.fromUser(ADMIN), ...body,
        ...(threadId ? { message_thread_id: threadId, is_topic_message: true } : {}),
        ...(text?.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] } : {}),
      } as any,
    });
  }

  // Последнее сообщение с кнопкой, подходящей под подпись, в этом чате.
  findButton(chatId: number, label: RegExp): { data: string; call: Call } {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const call = this.calls[i]!;
      if (call.payload.chat_id !== chatId) continue;
      for (const row of call.payload.reply_markup?.inline_keyboard ?? []) {
        for (const button of row) {
          if (label.test(button.text)) return { data: button.callback_data, call };
        }
      }
    }
    assert.fail(`Нет кнопки ${label} в чате ${chatId}. Последние: ${JSON.stringify(this.buttons(chatId))}`);
  }

  // Подписи кнопок последнего сообщения с кнопками в чате.
  buttons(chatId: number): string[] {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const call = this.calls[i]!;
      if (call.payload.chat_id === chatId && call.payload.reply_markup?.inline_keyboard) {
        return call.payload.reply_markup.inline_keyboard.flat().map((b: any) => b.text);
      }
    }
    return [];
  }

  // Нажатие кнопки: только той, что реально показана.
  async press(chatId: number, label: RegExp, from = chatId): Promise<void> {
    const { data, call } = this.findButton(chatId, label);
    const isPhoto = call.method === "sendPhoto" || call.payload.media?.type === "photo" || call.method === "editMessageCaption";
    const thread = call.payload.message_thread_id ?? this.threadOfMessage.get(call.messageId ?? 0);
    await this.update({
      callback_query: {
        id: String(++this.nextMessageId), chat_instance: "x", from: this.fromUser(from), data,
        message: {
          message_id: call.messageId ?? 1, date: 0,
          chat: chatId === GROUP
            ? { id: chatId, type: "supergroup", title: "Админы", is_forum: true }
            : { id: chatId, type: "private", first_name: "x" },
          ...(isPhoto ? { photo: [{ file_id: "f", file_unique_id: "u", width: 1, height: 1 }] } : { text: "x" }),
          ...(thread ? { message_thread_id: thread, is_topic_message: true } : {}),
        },
      } as any,
    });
  }

  async pressRaw(chatId: number, data: string, from = chatId): Promise<void> {
    await this.update({
      callback_query: {
        id: String(++this.nextMessageId), chat_instance: "x", from: this.fromUser(from), data,
        message: { message_id: 1, date: 0, chat: { id: chatId, type: "private", first_name: "x" }, text: "x" },
      } as any,
    });
  }

  texts(chatId: number): string[] {
    return this.calls
      .filter((c) => c.payload.chat_id === chatId && (c.payload.text ?? c.payload.caption))
      .map((c) => c.payload.text ?? c.payload.caption);
  }

  lastText(chatId: number): string {
    return this.texts(chatId).at(-1) ?? "";
  }

  alerts(): string[] {
    return this.calls.filter((c) => c.method === "answerCallbackQuery" && c.payload.text).map((c) => c.payload.text);
  }

  topicOf(userId: number): Promise<number> {
    return this.db
      .query<{ topic_id: number }>(`SELECT topic_id FROM users WHERE id = $1`, [userId])
      .then((r) => r.rows[0]!.topic_id);
  }

  // Товар через настоящую админку, со всеми шагами.
  async addProduct(p: { name: string; price: string; sizes?: string; colors?: string; photo?: boolean; category?: string }): Promise<void> {
    await this.adminSay("/admin");
    const category = p.category ?? "Животные";
    const { rows } = await this.db.query(`SELECT 1 FROM categories WHERE name = $1`, [category]);
    if (rows.length === 0) {
      await this.press(GROUP, /Категории/, ADMIN);
      await this.press(GROUP, /Добавить категорию/, ADMIN);
      await this.adminSay(category);
      await this.press(GROUP, /Админка/, ADMIN);
    }
    await this.press(GROUP, /Товары/, ADMIN);
    await this.press(GROUP, /Добавить товар/, ADMIN);
    await this.press(GROUP, new RegExp(category), ADMIN);
    await this.adminSay(p.name);
    if (p.photo === false) await this.press(GROUP, /Без фото/, ADMIN);
    else await this.adminSay({ photo: [{ file_id: "small", file_unique_id: "a", width: 1, height: 1 }, { file_id: `photo-${p.name}`, file_unique_id: "b", width: 9, height: 9 }] });
    await this.adminSay(`Описание: ${p.name}`);
    await this.adminSay(p.price);
    await this.adminSay(p.sizes ?? "-");
    await this.adminSay(p.colors ?? "-");
  }
}

export async function withHarness(fn: (h: Harness) => Promise<void>): Promise<void> {
  const h = await Harness.create();
  try {
    await fn(h);
  } finally {
    await h.db.close();
  }
}
