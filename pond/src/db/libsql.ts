/**
 * libSQL (Turso) behind the D1-shaped interface.
 *
 * ══ THE FOREIGN KEY TRAP, AND WHY IT NO LONGER DECIDES ANYTHING ══
 * SQLite ships foreign key enforcement OFF and the pragma is PER-CONNECTION.
 * Turso's HTTP mode hands out connections we do not own the lifetime of, so
 * a pooled or re-established one can arrive without it — and with the pragma
 * off, `contacts.duck_id ... ON DELETE CASCADE` silently does nothing.
 * Deleting a duck leaves the contact row behind and NOTHING FAILS: no error,
 * no warning, the data is just quietly still there. A broken promise that
 * looks exactly like a kept one.
 *
 * The first version of this file answered that by refusing to serve unless
 * it could read the pragma back as ON. That was the wrong lever:
 *
 *   * it could not be verified without a real Turso database, so the whole
 *     port sat behind a fact nobody could check, and
 *   * if the answer turned out to be "no", the site would simply not boot —
 *     downtime bought no safety, because the promise was still resting on
 *     the pragma either way.
 *
 * So the promise moved into the schema instead. `ducks_before_delete` in
 * 0001_init.sql deletes the contact itself, and a trigger fires whether or
 * not foreign keys are on. `test/foreign-keys.test.ts` proves it by running
 * the whole deletion with the pragma deliberately OFF.
 *
 * What is left here is honest bookkeeping, not a load-bearing gate:
 *
 *   1. set the pragma on every connection — it is still worth having, for
 *      the integrity checks the triggers do not cover,
 *   2. read it back and say so,
 *   3. refuse only for local files, where "off" means a broken test rig
 *      rather than a platform we do not control.
 */

import { createClient, type Client, type InArgs, type InValue } from "@libsql/client";
import type { AllResult, Db, Row, RunResult, Stmt } from "./types.js";

/** libSQL accepts a narrower value set than `unknown`. */
function toArgs(args: unknown[]): InArgs {
  return args.map((a) => {
    if (a === undefined) return null;
    if (typeof a === "boolean") return a ? 1 : 0;
    return a as InValue;
  });
}

class LibsqlStmt implements Stmt {
  constructor(
    private readonly client: Client,
    readonly sql: string,
    readonly args: InArgs = [],
  ) {}

  bind(...args: unknown[]): Stmt {
    return new LibsqlStmt(this.client, this.sql, toArgs(args));
  }

  async first<T = Row>(): Promise<T | null> {
    const r = await this.client.execute({ sql: this.sql, args: this.args });
    return (r.rows[0] as T | undefined) ?? null;
  }

  async run(): Promise<RunResult> {
    const r = await this.client.execute({ sql: this.sql, args: this.args });
    return {
      meta: {
        changes: r.rowsAffected,
        last_row_id: Number(r.lastInsertRowid ?? 0),
      },
    };
  }

  async all<T = Row>(): Promise<AllResult<T>> {
    const r = await this.client.execute({ sql: this.sql, args: this.args });
    return { results: r.rows as unknown as T[] };
  }
}

export class LibsqlDb implements Db {
  constructor(private readonly client: Client) {}

  prepare(sql: string): Stmt {
    return new LibsqlStmt(this.client, sql);
  }

  async batch(stmts: Stmt[]): Promise<RunResult[]> {
    const rs = await this.client.batch(
      stmts.map((s) => {
        const st = s as LibsqlStmt;
        return { sql: st.sql, args: st.args };
      }),
      "write",
    );
    return rs.map((r) => ({
      meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) },
    }));
  }

  async foreignKeysOn(): Promise<boolean> {
    const r = await this.client.execute("PRAGMA foreign_keys");
    return Number(Object.values(r.rows[0] ?? {})[0] ?? 0) === 1;
  }

  async assertForeignKeys(): Promise<void> {
    if (!(await this.foreignKeysOn())) {
      throw new Error(
        "foreign_keys is OFF on this connection. The triggers in " +
          "0001_init.sql still hold the deletion promise, but every other " +
          "referential check is unenforced, which is not acceptable locally.",
      );
    }
  }

  close(): void {
    this.client.close();
  }
}

/** A file or in-memory database — somewhere we control the connection. */
function isLocal(url: string): boolean {
  return url.startsWith("file:") || url === ":memory:";
}

/**
 * Connect and turn foreign keys on.
 *
 * `url` is `file:`/`:memory:` for tests and local work, or a Turso
 * `libsql://` URL. **Embedded replicas are deliberately not used**: they
 * read locally and write remotely, so a fire ignited inside one
 * `GET /api/pond` can be invisible to the next request. Read-your-writes is
 * load-bearing for ignition and rescue credit, so this is a remote primary
 * only.
 *
 * On a local database, foreign keys being off means the test rig is broken
 * and we say so. On a remote one it means the platform did not keep a
 * per-connection setting, which is its prerogative — we log it once and
 * carry on, because the triggers, not the pragma, are what keep the promise.
 * `npm run db:verify` is the script that proves that end to end against a
 * real database.
 */
export async function connect(url: string, authToken?: string): Promise<Db> {
  const client = createClient({ url, authToken });
  await client.execute("PRAGMA foreign_keys = ON");
  const db = new LibsqlDb(client);

  if (isLocal(url)) {
    await db.assertForeignKeys();
  } else if (!(await db.foreignKeysOn())) {
    console.warn(
      "[pond] foreign_keys did not survive on this connection. Deletion is " +
        "still complete — ducks_before_delete does the work — but no " +
        "referential check is being enforced. Run `npm run db:verify`.",
    );
  }

  return db;
}
