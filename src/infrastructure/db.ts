// Тонкая обёртка над базой: репозитории не знают, какой драйвер под ней.
import pg from "pg";

export interface Queryable {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  return {
    query: async <T>(sql: string, params?: unknown[]) => {
      const res = await pool.query(sql, params as any[]);
      return { rows: res.rows as T[] };
    },
    exec: async (sql) => {
      await pool.query(sql);
    },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: async <T>(sql: string, params?: unknown[]) => {
            const res = await client.query(sql, params as any[]);
            return { rows: res.rows as T[] };
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// Встроенный Postgres для локального запуска и тестов. В прод-зависимости не входит.
export async function createLocalDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const lite = await PGlite.create(dataDir);
  return {
    query: async <T>(sql: string, params?: unknown[]) => {
      const res = await lite.query<T>(sql, params as any[]);
      return { rows: res.rows };
    },
    exec: async (sql) => {
      await lite.exec(sql);
    },
    tx: (fn) =>
      lite.transaction((tx) =>
        fn({
          query: async <T>(sql: string, params?: unknown[]) => {
            const res = await tx.query<T>(sql, params as any[]);
            return { rows: res.rows };
          },
        }),
      ) as Promise<any>,
    close: () => lite.close(),
  };
}
