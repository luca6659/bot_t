// У каждого покупателя своя тема в группе админов. Если тему удалили, создаём новую.
// Служебные темы «🔔 Заказы» и «⚠️ Ошибки» создаются по требованию и запоминаются в настройках.
import { GrammyError, type Api } from "grammy";
import { logger } from "../../infrastructure/logger.js";
import { esc } from "../../views/format.js";
import type { SettingsService } from "../settings/settings.service.js";
import type { User, UsersRepository } from "../users/users.repository.js";

function isTopicGone(err: unknown): boolean {
  return err instanceof GrammyError && /thread not found|TOPIC_(ID_INVALID|DELETED|CLOSED)/i.test(err.description);
}

function topicName(user: User, orderId?: number): string {
  const name = user.firstName || `Покупатель ${user.id}`;
  return (orderId ? `${name} · №${orderId}` : name).slice(0, 128);
}

export type SystemTopic = "orders" | "errors";

export function createTopicsService(api: Api, adminGroupId: number, users: UsersRepository, settings: SettingsService) {
  // Две быстрые посылки одного покупателя не должны создать две темы.
  const creating = new Map<number, Promise<number>>();

  // Вызывается после создания темы: сюда подключается закреп-карточка клиента.
  let onCreated: ((userId: number) => Promise<void>) | null = null;

  async function create(user: User): Promise<number> {
    const topic = await api.createForumTopic(adminGroupId, topicName(user));
    await users.setTopic(user.id, topic.message_thread_id);
    logger.info({ action: "relay.topic_created", userId: user.id, topicId: topic.message_thread_id });
    await onCreated?.(user.id);
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

  async function systemThread(key: SystemTopic): Promise<number> {
    const settingKey = `topic_${key}`;
    const existing = Number(settings.get(settingKey));
    if (existing) return existing;
    const title = key === "orders" ? "🔔 Заказы" : "⚠️ Ошибки";
    const topic = await api.createForumTopic(adminGroupId, title);
    await settings.set(settingKey, String(topic.message_thread_id));
    return topic.message_thread_id;
  }

  return {
    ensure,
    setOnCreated(handler: (userId: number) => Promise<void>): void {
      onCreated = handler;
    },
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
    async sendToSystem(key: SystemTopic, text: string): Promise<void> {
      try {
        await api.sendMessage(adminGroupId, text, { parse_mode: "HTML", message_thread_id: await systemThread(key) });
      } catch (err) {
        if (!isTopicGone(err)) throw err;
        await settings.remove(`topic_${key}`);
        await api.sendMessage(adminGroupId, text, { parse_mode: "HTML", message_thread_id: await systemThread(key) });
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
