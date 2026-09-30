import { Pool, type QueryResult, type QueryResultRow } from "pg";

/*
 * One pg.Pool for the whole process, guarded behind globalThis so Next's
 * dev-mode module reloads don't leak a fresh pool on every hot reload.
 *
 * The pool is built LAZILY, on first query. Constructing it at module import
 * broke `next build`: Next collects page data for every route at build time,
 * which imports this module, and the builder stage has no DATABASE_URL, so
 * the whole image build failed the moment any route imported queries.ts.
 * Nothing here connects to Postgres until a query actually runs.
 */
const globalForPg = globalThis as unknown as { __abovefoldPgPool?: Pool };

function getPool(): Pool {
  if (globalForPg.__abovefoldPgPool) return globalForPg.__abovefoldPgPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const pool = new Pool({ connectionString, max: 10 });
  globalForPg.__abovefoldPgPool = pool;
  return pool;
}

/** Run a parameterised query. Never interpolate values into SQL. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as never[]);
}

/**
 * Back-compat for callers written against the old eager export. Every property
 * access resolves the pool at call time rather than at import time, which is
 * what keeps `next build` working without a database.
 */
export const pool = new Proxy({} as Pool, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getPool(), prop, receiver);
    return typeof value === "function" ? value.bind(getPool()) : value;
  },
});
