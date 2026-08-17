/**
 * Splitting `schema/0001_init.sql` into statements you can actually execute.
 *
 * libSQL executes one statement per call, so the schema has to be cut up
 * first. The obvious `sql.split(";")` is wrong twice over:
 *
 *   1. The comments explain the NDEF layout and the URL format, so they
 *      contain semicolons and `&c=`. Splitting before stripping them turns
 *      prose into fragments of invalid SQL.
 *
 *   2. A trigger body is `BEGIN … ; … ; … END` — semicolons INSIDE one
 *      statement. Splitting on them cuts the deletion promise into pieces,
 *      each of which fails to parse. This is exactly the kind of thing that
 *      would have left the triggers silently unapplied.
 *
 * So: strip comments, then reassemble across any `;` that falls inside an
 * unclosed BEGIN. Deliberately not a general SQL parser — it handles this
 * file, and this file is the only input it will ever have.
 */

/** Count non-overlapping whole-word matches. */
function words(text: string, word: string): number {
  return (text.match(new RegExp(`\\b${word}\\b`, "gi")) ?? []).length;
}

export function statements(sql: string): string[] {
  const stripped = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

  const out: string[] = [];
  let buffer = "";

  for (const piece of stripped.split(";")) {
    buffer += piece;
    // Inside a trigger body the BEGINs outnumber the ENDs, so that
    // semicolon was punctuation, not a terminator. Put it back.
    if (words(buffer, "BEGIN") > words(buffer, "END")) {
      buffer += ";";
      continue;
    }
    if (buffer.trim()) out.push(buffer.trim());
    buffer = "";
  }

  if (buffer.trim()) out.push(buffer.trim());
  return out;
}
