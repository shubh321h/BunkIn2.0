import postgres from 'postgres';
import type { Db } from './lib.ts';

/** One shared connection per running function instance. numeric values come back as numbers, not strings. */
export function makeDb(url: string, options: Record<string, unknown> = {}): Db {
  const sql = postgres(url, {
    max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false, onnotice: () => {},
    types: { numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) } },
    ...options,
  });
  return sql as unknown as Db;
}
