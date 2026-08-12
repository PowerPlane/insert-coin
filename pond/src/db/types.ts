/**
 * The database surface the worker talks to.
 *
 * Deliberately D1-shaped — `prepare().bind().first()/run()/all()` with
 * `meta.changes` — so that `src/worker/*.ts` did not have to change when the
 * platform moved from Cloudflare to Vercel. The whole port is this file plus
 * one implementation of it.
 *
 * `meta.changes` is load-bearing, not informational: `extinguish()` credits a
 * rescue only to the request whose UPDATE actually changed a row, and
 * `renameDuck()` distinguishes "taken" from "invalid" the same way. An
 * implementation that always reports 0 or 1 would silently break both.
 */

export type Row = Record<string, unknown>;

export interface RunResult {
  meta: { changes: number; last_row_id: number };
}

export interface AllResult<T> {
  results: T[];
}

export interface Stmt {
  bind(...args: unknown[]): Stmt;
  first<T = Row>(): Promise<T | null>;
  run(): Promise<RunResult>;
  all<T = Row>(): Promise<AllResult<T>>;
}

export interface Db {
  prepare(sql: string): Stmt;
  /**
   * Run several statements as one unit. This is not a convenience — it is how
   * the multi-statement writes stop having a window where a crash leaves a
   * half-state: a bump inserted with no counter bump, a fire out with nobody
   * credited, a duck released with no session claimed.
   */
  batch(stmts: Stmt[]): Promise<RunResult[]>;
  /** Is this connection enforcing foreign keys right now? */
  foreignKeysOn(): Promise<boolean>;
  /** Throws unless the connection really is enforcing foreign keys. */
  assertForeignKeys(): Promise<void>;
  close(): void;
}
