// Общие проверки входящих сообщений.
import type { Message } from "grammy/types";

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 МБ

export function fileTooBig(msg: Message): boolean {
  const size = msg.photo?.at(-1)?.file_size ?? msg.document?.file_size ?? msg.video?.file_size ?? 0;
  return size > MAX_FILE_SIZE;
}
