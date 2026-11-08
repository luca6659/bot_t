// У каждого покупателя своя тема в группе админов. Если тему удалили, создаём новую.
import { GrammyError, type Api } from "grammy";
import { logger } from "../../infrastructure/logger.js";
import { esc } from "../../views/format.js";
import type { User, UsersRepository } from "../users/users.repository.js";

function isTopicGone(err: unknown): boolean {
  return err instanceof GrammyError && /thread not found|TOPIC_(ID_INVALID|DELETED|CLOSED)/i.test(err.description);
}

function topicName(user: User, orderId?: number): string {
  const name = user.firstName || `Покупатель ${user.id}`;
  return (orderId ? `${name} · №${orderId}` : name).slice(0, 128);
}

export function createTopicsService(api: Api, adminGroupId: number, users: UsersRepository) {
  // Две быстрые посылки одного покупателя не должны создать две темы.
  const creating = new Map<number, Promise<number>>();

  async function create(user: User): Promise<number> {
    const topic = await api.createForumTopic(adminGroupId, topicName(user));
    await users.setTopic(user.id, topic.message_thread_id);
    const username = user.username ? `@${esc(user.username)}` : "без username";
    await api.sendMessage(adminGroupId, `👤 <b>${esc(user.firstName)}</b>, ${username}, ID ${user.id}\n\nОтвечай в этой теме: бот передаст сообщение покупателю от своего имени.`, {
      parse_mode: "HTML",
      message_thread_id: topic.message_thread_id,
    });
    logger.info({ action: "relay.topic_created", userId: user.id, topicId: topic.message_thread_id });
    return topic.message_thread_id;
  }

  async function ensure(userId: number): Promise<number> {
    const pending = creating.get(userId);
    if (pending) return pending;

    const user = await users.get(userId);
    if (!user) throw new Error(`Нет покупателя ${userId}`);
    if (user.topicId) return user.topicId;

    const promise = create(user).finally(() => creating.delete(userId));
    creating.set(userId, promise);
    return promise;
  }

  return {
    ensure,
    // Выполняет отправку в тему покупателя и один раз пересоздаёт тему, если её удалили.
    async withTopic<T>(userId: number, send: (threadId: number) => Promise<T>): Promise<T> {
      const threadId = await ensure(userId);
      try {
        return await send(threadId);
      } catch (err) {
        if (!isTopicGone(err)) throw err;
        await users.setTopic(userId, null);
        return send(await ensure(userId));
      }
    },
    async labelWithOrder(userId: number, orderId: number): Promise<void> {
      const user = await users.get(userId);
      if (!user?.topicId) return;
      await api
        .editForumTopic(adminGroupId, user.topicId, { name: topicName(user, orderId) })
        .catch((err) => logger.warn({ action: "relay.topic_rename_failed", userId, err: String(err) }));
    },
  };
}
export type TopicsService = ReturnType<typeof createTopicsService>;
