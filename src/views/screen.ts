// Единый способ показать экран: меняем текущее сообщение на месте, чтобы чат не забивался меню.
import { Composer, GrammyError, InlineKeyboard } from "grammy";
import type { MyContext } from "../bot/context.js";
import { AppError } from "../infrastructure/errors.js";
import { t } from "../i18n/texts.js";

export interface Screen {
  text: string;
  kb?: InlineKeyboard;
  photo?: string | null;
  // Фото то же, меняем только подпись и кнопки: выбор размера не должен мигать картинкой.
  keepPhoto?: boolean;
}

export function threadOf(ctx: MyContext): number | undefined {
  const msg = ctx.callbackQuery?.message ?? ctx.msg;
  return msg?.is_topic_message ? msg.message_thread_id : undefined;
}

function isNotModified(err: unknown): boolean {
  return err instanceof GrammyError && err.description.includes("message is not modified");
}

async function send(ctx: MyContext, s: Screen): Promise<void> {
  const other = { parse_mode: "HTML" as const, reply_markup: s.kb, message_thread_id: threadOf(ctx) };
  if (s.photo) await ctx.replyWithPhoto(s.photo, { ...other, caption: s.text });
  else await ctx.reply(s.text, other);
}

export async function show(ctx: MyContext, s: Screen): Promise<void> {
  const msg = ctx.callbackQuery?.message;
  if (!msg) return send(ctx, s);

  const hasPhoto = Boolean(msg.photo);
  try {
    if (s.photo && hasPhoto) {
      if (s.keepPhoto) {
        await ctx.editMessageCaption({ caption: s.text, parse_mode: "HTML", reply_markup: s.kb });
      } else {
        await ctx.editMessageMedia(
          { type: "photo", media: s.photo, caption: s.text, parse_mode: "HTML" },
          { reply_markup: s.kb },
        );
      }
      return;
    }
    if (!s.photo && !hasPhoto && msg.text) {
      await ctx.editMessageText(s.text, { parse_mode: "HTML", reply_markup: s.kb });
      return;
    }
  } catch (err) {
    if (isNotModified(err)) return;
    if (!(err instanceof GrammyError)) throw err;
  }
  // Текст нельзя превратить в фото: заменяем сообщение новым.
  await ctx.deleteMessage().catch(() => {});
  await send(ctx, s);
}

// Строка навигации: есть в каждом меню, кроме главного.
export function navRow(kb: InlineKeyboard, back: string, home = "m", homeLabel = t("btn.main")): InlineKeyboard {
  return kb.row().text(t("btn.back"), back).text(homeLabel, home);
}

export function cancelKb(data = "x"): InlineKeyboard {
  return new InlineKeyboard().text(t("btn.cancel"), data);
}

export function pagerRow(kb: InlineKeyboard, page: number, pages: number, data: (page: number) => string): void {
  if (pages <= 1) return;
  kb.row();
  if (page > 0) kb.text(t("btn.prev"), data(page - 1));
  kb.text(`${page + 1} / ${pages}`, "noop");
  if (page < pages - 1) kb.text(t("btn.next"), data(page + 1));
}

// Регистрирует нажатие кнопки: всегда отвечает Telegram, а понятные ошибки показывает всплывашкой.
export function action(
  composer: Composer<MyContext>,
  pattern: RegExp | string,
  handler: (ctx: MyContext & { match: RegExpMatchArray | string }) => Promise<unknown>,
): void {
  composer.callbackQuery(pattern, async (ctx) => {
    try {
      await handler(ctx as any);
    } catch (err) {
      if (err instanceof AppError) {
        await ctx.answerCallbackQuery({ text: err.userMessage, show_alert: true }).catch(() => {});
        return;
      }
      throw err;
    }
    await ctx.answerCallbackQuery().catch(() => {});
  });
}
