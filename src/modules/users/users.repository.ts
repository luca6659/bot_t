import type { Queryable } from "../../infrastructure/db.js";

export interface User {
  id: number;
  firstName: string;
  username: string | null;
  topicId: number | null;
  savedName: string | null;
  savedPhone: string | null;
  savedAddress: string | null;
  banned: boolean;
  pinnedMessageId: number | null;
}

function toUser(r: any): User {
  return {
    id: Number(r.id),
    firstName: r.first_name,
    username: r.username,
    topicId: r.topic_id,
    savedName: r.saved_name,
    savedPhone: r.saved_phone,
    savedAddress: r.saved_address,
    banned: r.banned,
    pinnedMessageId: r.pinned_message_id,
  };
}

export function createUsersRepository(db: Queryable) {
  return {
    async touch(id: number, firstName: string, username: string | null): Promise<void> {
      await db.query(
        `INSERT INTO users (id, first_name, username) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE
         SET first_name = EXCLUDED.first_name, username = EXCLUDED.username,
             blocked_bot = FALSE, last_seen_at = now()`,
        [id, firstName, username],
      );
    },
    async get(id: number): Promise<User | null> {
      const { rows } = await db.query(`SELECT * FROM users WHERE id = $1`, [id]);
      return rows[0] ? toUser(rows[0]) : null;
    },
    async getByTopic(topicId: number): Promise<User | null> {
      const { rows } = await db.query(`SELECT * FROM users WHERE topic_id = $1`, [topicId]);
      return rows[0] ? toUser(rows[0]) : null;
    },
    async setTopic(id: number, topicId: number | null): Promise<void> {
      await db.query(`UPDATE users SET topic_id = $2, pinned_message_id = NULL WHERE id = $1`, [id, topicId]);
    },
    async setPinnedMessage(id: number, messageId: number | null): Promise<void> {
      await db.query(`UPDATE users SET pinned_message_id = $2 WHERE id = $1`, [id, messageId]);
    },
    async setBanned(id: number, banned: boolean): Promise<void> {
      await db.query(`UPDATE users SET banned = $2 WHERE id = $1`, [id, banned]);
    },
    async saveContacts(id: number, name: string | null, phone: string | null, address: string | null): Promise<void> {
      await db.query(
        `UPDATE users SET saved_name = COALESCE($2, saved_name), saved_phone = COALESCE($3, saved_phone),
         saved_address = COALESCE($4, saved_address) WHERE id = $1`,
        [id, name, phone, address],
      );
    },
    async markBlocked(id: number): Promise<void> {
      await db.query(`UPDATE users SET blocked_bot = TRUE WHERE id = $1`, [id]);
    },
    async nextForBroadcast(afterId: number, limit: number): Promise<number[]> {
      const { rows } = await db.query<{ id: unknown }>(
        `SELECT id FROM users WHERE id > $1 AND blocked_bot = FALSE AND banned = FALSE ORDER BY id LIMIT $2`,
        [afterId, limit],
      );
      return rows.map((r) => Number(r.id));
    },
    async countActive(): Promise<number> {
      const { rows } = await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM users WHERE blocked_bot = FALSE AND banned = FALSE`,
      );
      return rows[0]!.n;
    },
    async stats(): Promise<{ total: number; new7d: number }> {
      const { rows } = await db.query<{ total: number; new7d: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new7d
         FROM users`,
      );
      return rows[0]!;
    },
  };
}
export type UsersRepository = ReturnType<typeof createUsersRepository>;
