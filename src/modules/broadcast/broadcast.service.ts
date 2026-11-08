// Рассылка идёт в фоне с паузами (лимит Telegram около 30 сообщений в секунду).
// Курсор хранится в БД: после перезапуска рассылка продолжится с нужного места.
import { GrammyError } from "grammy";
import type { Queryable } from "../../infrastructure/db.js";
import { logger } from "../../infrastructure/logger.js";
import type { UsersRepository } from "../users/users.repository.js";

export interface BroadcastTransport {
  copy(userId: number, fromChatId: number, messageId: number): Promise<void>;
  finished(threadId: number | null, sent: number, failed: number): Promise<void>;
}

const BATCH = 50;

export function createBroadcastService(
  db: Queryable,
  users: UsersRepository,
  transport: BroadcastTransport,
  delayMs = 50,
) {
  let stopping = false;
  const running = new Set<Promise<void>>();

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function run(id: number): Promise<void> {
    const { rows } = await db.query<any>(`SELECT * FROM broadcasts WHERE id = $1`, [id]);
    const b = rows[0];
    if (!b) return;

    let cursor = Number(b.cursor_user_id);
    let sent: number = b.sent;
    let failed: number = b.failed;

    while (!stopping) {
      const batch = await users.nextForBroadcast(cursor, BATCH);
      if (batch.length === 0) {
        await db.query(`UPDATE broadcasts SET status = 'done', sent = $2, failed = $3 WHERE id = $1`, [id, sent, failed]);
        logger.info({ action: "broadcast.done", id, sent, failed });
        await transport.finished(b.thread_id, sent, failed);
        return;
      }
      for (const userId of batch) {
        if (stopping) break;
        try {
          await transport.copy(userId, Number(b.from_chat_id), b.message_id);
          sent++;
        } catch (err) {
          failed++;
          if (err instanceof GrammyError && err.error_code === 403) await users.markBlocked(userId);
          else logger.warn({ action: "broadcast.send_failed", id, userId, err: String(err) });
        }
        cursor = userId;
        await sleep(delayMs);
      }
      await db.query(`UPDATE broadcasts SET cursor_user_id = $2, sent = $3, failed = $4 WHERE id = $1`, [id, cursor, sent, failed]);
    }
  }

  function launch(id: number): void {
    const task = run(id)
      .catch((err) => logger.error({ action: "broadcast.crashed", id, err: String(err) }))
      .finally(() => running.delete(task));
    running.add(task);
  }

  return {
    async start(fromChatId: number, messageId: number, threadId: number | null): Promise<void> {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO broadcasts (from_chat_id, message_id, thread_id) VALUES ($1, $2, $3) RETURNING id`,
        [fromChatId, messageId, threadId],
      );
      logger.info({ action: "broadcast.started", id: rows[0]!.id });
      launch(rows[0]!.id);
    },
    async resume(): Promise<void> {
      const { rows } = await db.query<{ id: number }>(`SELECT id FROM broadcasts WHERE status = 'running'`);
      for (const r of rows) launch(r.id);
    },
    async stop(): Promise<void> {
      stopping = true;
      await Promise.all(running);
    },
    // Для тестов и аккуратного завершения: дождаться текущих рассылок.
    async drain(): Promise<void> {
      await Promise.all(running);
    },
  };
}
export type BroadcastService = ReturnType<typeof createBroadcastService>;
