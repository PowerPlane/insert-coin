/**
 * libSQL (Turso) behind the D1-shaped interface.
 *
 * ══ THE FOREIGN KEY TRAP ══
 * Turso ships with foreign key enforcement OFF, for SQLite compatibility.
 * Our schema declares `contacts.duck_id ... ON DELETE CASCADE`, and that
 * cascade is the entire mechanism behind "take my duck out deletes its
 * message and contact at the same time. Nothing is kept." — a promise the
 * contact screen makes in writing before anyone hands over an address.
 *
 * With the pragma off, deleting a duck leaves the contact row behind and
 * NOTHING FAILS. No error, no warning; the data is just quietly still there.
 * That is the worst shape a bug can take, so this module does three things
 * rather than one:
 *
 *   1. sets the pragma on every connection,
 *   2. asserts it is actually on, by reading it back,
 *   3. refuses to serve if it is not.
 *
 * Point 3 is not defensive programming for its own sake. If a future Turso
 * change, a connection-pool reset, or an HTTP-mode quirk drops the pragma
 * between deploys, the correct behaviour is a loud 500 — not a site that
 * keeps working while silently retaining data people asked us to delete.
 */

import { createClient, type Client, type InArgs, type InValue } from "@libsql/client";
import type { AllResult, Db, Row, RunResult, Stmt } from "./types";

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

  async assertForeignKeys(): Promise<void> {
    const r = await this.client.execute("PRAGMA foreign_keys");
    const on = Number(Object.values(r.rows[0] ?? {})[0] ?? 0) === 1;
    if (!on) {
      throw new Error(
        "foreign_keys is OFF. Deleting a duck would leave its contact row " +
          "behind with no error, breaking the deletion promise. Refusing to serve.",
      );
    }
  }

  close(): void {
    this.client.close();
  }
}

/**
 * Connect, turn foreign keys on, and prove it took.
 *
 * `url` is `file:` for tests and local work, or a Turso `libsql://` URL.
 * **Embedded replicas are deliberately not used**: they read locally and
 * write remotely, so a fire ignited inside one `GET /api/pond` can be
 * invisible to the next request. Read-your-writes is load-bearing for
 * ignition and rescue credit, so this is a remote primary only.
 */
export async function connect(url: string, authToken?: string): Promise<Db> {
  const client = createClient({ url, authToken });
  await client.execute("PRAGMA foreign_keys = ON");
  const db = new LibsqlDb(client);
  await db.assertForeignKeys();
  return db;
}
