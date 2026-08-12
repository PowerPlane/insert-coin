-- The Pond — the schema. SQLite dialect, running on Turso (libSQL).
--
-- ══ THIS FILE IS THE FROZEN CONTRACT ══
-- Phase 3 builds nine screens against it. Changing it after that means
-- changing them twice. Nothing is deployed yet, so it is edited in place —
-- writing a migration against a database that has never existed is cargo
-- cult. Once a real database exists, this file stops being editable and
-- 0002_*.sql starts.
--
-- Three rules shape it:
--
--  1. Contacts live in their own table and NO public query ever joins it.
--     Not "we remember to strip the field" — the public read path does not
--     name the table at all, so a leak requires writing new code, not
--     forgetting a filter.
--
--  2. Storage stays deliberately boring: plain columns, base64 in TEXT, no
--     vendor-specific types. Moving this to a machine under a desk should be
--     a dump and a hostname change, not a rewrite.
--
--  3. Nothing a person was promised may depend on a connection setting.
--     See THE DELETION PROMISE at the bottom of this file — that is the
--     single most important block of SQL here.

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────
-- cards — one row per physical Insert Coin card.
--
-- `id` is the MCU serial: eight Crockford base32 characters derived from
-- SIGROW.SERNUM, written into the tag as `&c=`. It is a PRIMARY KEY, so a
-- derivation collision would make two physical cards indistinguishable —
-- the import step in Phase 2 rejects a duplicate loudly rather than
-- overwriting.
--
-- THE SERIAL IS SECRET-ADJACENT. It is half of what a card claim is keyed
-- on, so it must never appear in a public payload. What the pond shows is
-- `via <keeper name>`, resolved through card_epochs below.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE cards (
  id            TEXT PRIMARY KEY,          -- the &c= value, e.g. '7F3A9KQZ'
  label         TEXT NOT NULL DEFAULT '',  -- admin-only: 'the one I gave Sam'
  created       INTEGER NOT NULL,          -- unix seconds
  disabled      INTEGER NOT NULL DEFAULT 0,-- kill switch for a lost card
  -- High-water mark of the claim counter (&g=). A claim is accepted only
  -- when its signed token verifies AND its counter exceeds this. Both, not
  -- either — see docs/pond/BUILD-PLAN.md § The claim credential.
  claim_counter INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────────────────
-- card_epochs — a card has a SUCCESSION OF KEEPERS, not an owner.
--
-- This is the whole reason the table exists. If a card changes hands, the
-- new keeper must not inherit the last keeper's ducks, and above all must
-- not inherit consent: a contact shared with Sam was shared with SAM. Mika
-- picking up the same card later gets a new epoch and sees none of it.
--
-- Ducks and contacts therefore point at an EPOCH, never at a card, and
-- always `ON DELETE SET NULL` — never CASCADE. Ending a keeper's tenure
-- must never delete a stranger's duck.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE card_epochs (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  -- Shown as `via Sam`. Free text the keeper chose, so it is cleaned and
  -- length-capped exactly like a duck name.
  keeper_name TEXT NOT NULL DEFAULT '',
  -- The keeper's DEFAULT, not a lock: a visitor's phone wins if it asks for
  -- a language we have. See docs/pond/UI.md § 8.
  lang        TEXT NOT NULL DEFAULT 'en',
  -- The keeper's own duck, if they linked one. Claiming a card and having a
  -- duck are different things and either can come first, so this is
  -- nullable and set later.
  keeper_duck TEXT REFERENCES ducks(id) ON DELETE SET NULL,
  counter     INTEGER NOT NULL,          -- the &g= that opened this epoch
  claimed     INTEGER NOT NULL,          -- unix seconds
  ended       INTEGER,                   -- NULL while this keeper is current

  CHECK (length(keeper_name) <= 18),
  CHECK (lang IN ('en', 'zh-Hant'))
);
-- At most one current keeper per card, enforced by the database rather than
-- by remembering to close the old epoch first.
CREATE UNIQUE INDEX idx_epoch_current ON card_epochs (card_id) WHERE ended IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- ducks — everything the pond draws. Public.
-- The base artwork is CODE, not data: `fortune` selects a sprite that ships
-- with the site. Improving the art later improves every existing duck.
--
-- Note what is NOT here: bump_count and rescue_count. Both used to be
-- denormalised columns. They are now derived at read time from `bumps` and
-- `rescues`, because a stored counter beside a per-pair table is a drift
-- waiting to happen, and keeping them in step needed a second write with a
-- window in the middle. At pond scale (hundreds) the correlated aggregate
-- costs nothing; the ceiling and its fix are in docs/pond/SECURITY.md § 5.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE ducks (
  id          TEXT PRIMARY KEY,            -- internal id, never in a URL
  -- The readable public address: ducky.davidyang.work/d/<slug>.
  -- Shareable on purpose, renameable, and NOT a credential — if this were
  -- the edit link, /d/sam would be guessable and anyone could delete
  -- anyone's duck. UNIQUE is what makes two simultaneous releases safe;
  -- the generator's own check is only advisory.
  slug        TEXT NOT NULL UNIQUE,
  edit_key    TEXT NOT NULL UNIQUE,        -- the credential. Secret, at /e/<key>.
  -- Which physical card minted it. ADMIN ONLY — never selected into a
  -- public payload. `epoch_id` is what the pond reads.
  card_id     TEXT REFERENCES cards(id),
  -- Which keeper's tenure it was minted under. NULL for a duck from an
  -- unclaimed card, and for every duck made before its card was claimed
  -- (a keeper can adopt those explicitly during Card setup).
  epoch_id    TEXT REFERENCES card_epochs(id) ON DELETE SET NULL,
  fortune     INTEGER NOT NULL,            -- 0 great · 1 little · 2 uncertain · 3 bad
  tint        INTEGER NOT NULL DEFAULT 0,  -- index into the body palette
  stickers    TEXT NOT NULL DEFAULT '[]',  -- JSON [{id,x,y}], max 6
  paint       TEXT NOT NULL DEFAULT '',    -- base64 of 24x24 @ 4bpp = 288 bytes
  name        TEXT NOT NULL DEFAULT '',    -- <= 18 chars, may be empty
  message     TEXT NOT NULL DEFAULT '',    -- <= 90 chars, may be empty
  created     INTEGER NOT NULL,
  updated     INTEGER NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0,  -- moderation; never a hard delete

  CHECK (fortune BETWEEN 0 AND 3),
  -- keep in step with TINTS in src/client/sprites.ts and TINT_COUNT
  CHECK (tint BETWEEN 0 AND 11),
  -- length() counts code points on TEXT, matching cleanText()
  CHECK (length(name) <= 18),
  -- name may duplicate freely; slug may not. Two people called Sam is fine.
  CHECK (length(slug) BETWEEN 3 AND 32),
  CHECK (length(message) <= 90),
  -- empty, or exactly one canonical 24x24 @ 4bpp layer
  CHECK (length(paint) = 0 OR length(paint) = 384),
  CHECK (length(stickers) <= 512)
);

-- The pond read: visible ducks, newest first.
CREATE INDEX idx_ducks_visible ON ducks (hidden, created DESC);
CREATE INDEX idx_ducks_slug    ON ducks (slug);
CREATE INDEX idx_ducks_card    ON ducks (card_id);
CREATE INDEX idx_ducks_epoch   ON ducks (epoch_id);

-- ─────────────────────────────────────────────────────────────────────────
-- contacts — PRIVATE. The one thing here that would genuinely hurt someone
-- if it leaked.
--
-- Deliberately a separate table with its own access path. The public pond
-- query in src/worker/ducks.ts must never reference this name; there is a
-- test that greps for exactly that.
--
-- `scope` is consent, recorded at the moment it was given, and it is always
-- stated to the person in NAMES — "shared with Sam and David", never
-- "scope: 2". `epoch_id` is what makes that consent expire with the keeper
-- it was given to.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE contacts (
  duck_id     TEXT PRIMARY KEY REFERENCES ducks(id) ON DELETE CASCADE,
  value       TEXT NOT NULL,               -- freeform: email, phone, @handle
  -- Who may read it.
  --
  -- "Nobody" is not a value here: choosing nobody means no row is written at
  -- all, which is the same thing and leaves nothing to leak.
  --
  -- THE DEFAULT IS THE NARROWEST ONE, and that is not fussiness. The contact
  -- screen asks "Want David to reply?" and answers, in writing, "Only David
  -- sees this." (COPY.md contact.02 and contact.06.) Anyone who never
  -- touches a scope picker has agreed to exactly that sentence and nothing
  -- wider, so that sentence is what gets stored. Defaulting to
  -- 'keeper_and_david' would have shared it with a person the screen never
  -- mentioned.
  --
  -- On David's own card the keeper IS David, so all three collapse to the
  -- same reader. The distinction only starts to matter on the ninety-nine
  -- cards somebody else keeps.
  scope       TEXT NOT NULL DEFAULT 'david',
  -- The keeper the consent was given TO. Never inherited by the next one.
  epoch_id    TEXT REFERENCES card_epochs(id) ON DELETE SET NULL,
  created     INTEGER NOT NULL,
  CHECK (length(value) <= 120),
  CHECK (scope IN ('david', 'keeper', 'keeper_and_david'))
);

-- ─────────────────────────────────────────────────────────────────────────
-- sessions — a tap converted into a ticket.
--
-- The card's `?d=` digit is only live for 300 s, but decorating takes
-- minutes. So freshness is checked ONCE, at the first request, and exchanged
-- for a row here. Nothing downstream ever looks at the digit again.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,            -- random; also the cookie value
  card_id     TEXT REFERENCES cards(id),
  fortune     INTEGER NOT NULL,
  nonce       TEXT,                        -- &n= if the firmware supplies one
  created     INTEGER NOT NULL,
  expires     INTEGER NOT NULL,
  -- Set once released; one duck per session.
  --
  -- ON DELETE SET NULL is load-bearing, not tidiness. Without it, this
  -- reference PINS the duck: "take my duck out" inside the 30-minute
  -- session window fails with a foreign key violation and the contact
  -- survives — the exact promise this schema exists to keep, broken in the
  -- most common case there is (release a duck, change your mind).
  spent_duck  TEXT REFERENCES ducks(id) ON DELETE SET NULL,
  CHECK (fortune BETWEEN 0 AND 3)
);
CREATE INDEX idx_sessions_expires ON sessions (expires);

-- ─────────────────────────────────────────────────────────────────────────
-- nonces — optional hard gate: one duck per coin insert.
-- Only used if the firmware writes &n=. A row here means that play is spent.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE nonces (
  card_id     TEXT NOT NULL,
  nonce       TEXT NOT NULL,
  used        INTEGER NOT NULL,            -- unix seconds
  PRIMARY KEY (card_id, nonce)
);
CREATE INDEX idx_nonces_used ON nonces (used);

-- ─────────────────────────────────────────────────────────────────────────
-- bumps — a duck bumps a duck. Per pair, counted, directional.
--
-- This replaces `waves` outright. A wave was a number on a duck; a bump is
-- an event between two ducks, and the difference is the whole point:
--
--   * "bump back" is derivable — the reverse row either exists or does not,
--     so the button can say so without storing a second thing,
--   * "Most bumps from" (a duck card, pond.28) is a query, not a new table,
--   * the TEN UNRETURNED CAP is expressible: count(A→B) − count(B→A) < 10.
--
-- The cap is the poke dynamic. It forces reciprocity instead of one-way
-- spam, and it is enforced SERVER-SIDE in one statement — a client-side cap
-- is a suggestion.
--
-- Bumping requires having a duck ("Make a duck to bump"), which is why the
-- from side is a duck id and not a visitor hash. The API authenticates it
-- with the private edit key: a forgeable `from` would let anyone exhaust
-- someone else's cap on their behalf, which would make the cap meaningless.
-- ─────────────────────────────────────────────────────────────────────────
-- `total` rather than `count`, because an upsert has to say
-- `SET total = bumps.total + 1` and a column named `count` there reads as
-- the aggregate function. Names that need explaining in the query are the
-- wrong names.
CREATE TABLE bumps (
  from_duck   TEXT NOT NULL REFERENCES ducks(id) ON DELETE CASCADE,
  to_duck     TEXT NOT NULL REFERENCES ducks(id) ON DELETE CASCADE,
  total       INTEGER NOT NULL DEFAULT 0,
  first_at    INTEGER NOT NULL,
  last_at     INTEGER NOT NULL,
  PRIMARY KEY (from_duck, to_duck),
  CHECK (from_duck <> to_duck),            -- no bumping yourself for a number
  CHECK (total >= 0)
);
-- The pond read totals bumps per recipient; the duck card ranks senders.
CREATE INDEX idx_bumps_to ON bumps (to_duck, total DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- fires — 凶 ducks only. The server is the only thing that can ignite.
-- A row exists while a duck is alight; `out_at` closes it.
--
-- Ignition happens ON READ, inside GET /api/pond, because Vercel Hobby
-- crons run daily and a finer expression fails at deploy. Nobody sees a
-- fire that starts while nobody is looking, so a timer was never doing real
-- work. Fires go out by arithmetic: `burning` is computed, never stored.
-- ─────────────────────────────────────────────────────────────────────────
--
-- THERE IS NO `rescues` TABLE, and that is a decision rather than an
-- omission. It used to exist, keyed `(fire_id, visitor)`, to make sure a
-- person could only be credited once per fire. But credit belongs to
-- whoever actually put the fire out — one person, the one who won the
-- `out_at IS NULL` race — and `out_by` already records exactly that. A
-- second table could only ever hold one row per fire saying the same thing,
-- kept in step by a second write with a window in the middle.
--
-- Deleting it collapsed extinguish() to a SINGLE atomic statement whose
-- `meta.changes` is both "you won" and "you are credited".
CREATE TABLE fires (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  duck_id     TEXT NOT NULL REFERENCES ducks(id) ON DELETE CASCADE,
  lit_at      INTEGER NOT NULL,
  burns_until INTEGER NOT NULL,            -- self-extinguishes; never a stuck state
  out_at      INTEGER,                     -- NULL while burning
  out_by      TEXT                         -- visitor hash of whoever got there first
);
CREATE INDEX idx_fires_active ON fires (out_at, burns_until);
CREATE INDEX idx_fires_duck   ON fires (duck_id);

-- ─────────────────────────────────────────────────────────────────────────
-- says — speech bubbles. 60 chars, 45 s on screen, one per 10 minutes.
-- The cooldown is enforced here, not in the client, because the client is
-- the one thing an attacker controls.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE says (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  duck_id     TEXT NOT NULL REFERENCES ducks(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created     INTEGER NOT NULL,
  CHECK (length(text) <= 60)
);
CREATE INDEX idx_says_recent ON says (duck_id, created DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- reports — moderation queue. Anyone can file; only the admin acts.
--
-- The prototype collects a reason AND an optional note, and the schema now
-- stores both — a report that arrives as a bare row tells David nothing he
-- can act on. One report per visitor per duck, so the button is idempotent
-- ("Reported ✓") and cannot be used to flood the queue.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  duck_id     TEXT NOT NULL REFERENCES ducks(id) ON DELETE CASCADE,
  visitor     TEXT NOT NULL,
  -- Matches the four buttons in COPY.md pond.30–33, in order.
  reason      TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',    -- "Anything to add" — optional
  created     INTEGER NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0,
  CHECK (reason IN ('rude', 'private', 'spam', 'other')),
  CHECK (length(note) <= 200)
);
CREATE INDEX idx_reports_open ON reports (resolved, created DESC);
CREATE UNIQUE INDEX idx_reports_once ON reports (duck_id, visitor);

-- ─────────────────────────────────────────────────────────────────────────
-- rate_limits — a fixed-window counter, one row per bucket per window.
--
-- `?d=N` is forgeable: anyone can type ducky.davidyang.work/?d=1 and get a
-- session without touching a card. That is the central fact in
-- docs/pond/SECURITY.md, and these counters are most of what holds the line
-- against it. Swept daily.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE rate_limits (
  bucket       TEXT NOT NULL,              -- 'mint:card:7F3A9KQZ', 'mint:v:<hash>'
  window_start INTEGER NOT NULL,           -- unix seconds, floored to the window
  hits         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX idx_rate_window ON rate_limits (window_start);

-- ═════════════════════════════════════════════════════════════════════════
-- THE DELETION PROMISE
--
-- The contact screen says, in writing, before anyone types an address:
--
--   "Only David sees this. It is not shown in the pond, and it is deleted
--    when you take your duck out."
--
-- Every child row above already declares ON DELETE CASCADE, which would be
-- enough — if foreign key enforcement were guaranteed. It is not. SQLite
-- ships the pragma OFF and it is per-connection, so on Turso's HTTP mode a
-- pooled or re-established connection can arrive without it. When that
-- happens the cascade does not fire and NOTHING FAILS: no error, no
-- warning, the contact is simply still there.
--
-- That is the worst shape a bug can take — a broken promise that looks
-- exactly like a kept one. So the promise does not rest on a connection
-- setting. A trigger fires regardless of `PRAGMA foreign_keys`, and BEFORE
-- DELETE means there is never an instant where a reference dangles.
--
-- It also covers every delete path that will ever exist, including the
-- admin screens in Phase 4, without anyone having to remember this file.
-- ═════════════════════════════════════════════════════════════════════════
CREATE TRIGGER ducks_before_delete BEFORE DELETE ON ducks
BEGIN
  -- The promise itself. First, and on its own line, so it is impossible to
  -- read this trigger without seeing it.
  DELETE FROM contacts WHERE duck_id = OLD.id;

  DELETE FROM fires   WHERE duck_id = OLD.id;
  DELETE FROM says    WHERE duck_id = OLD.id;
  DELETE FROM reports WHERE duck_id = OLD.id;

  -- Both directions. A duck that is gone neither owes nor is owed a bump.
  DELETE FROM bumps WHERE from_duck = OLD.id OR to_duck = OLD.id;

  -- Release the references that would otherwise pin this row. `spent_duck`
  -- is the one that actually bit: see the note on sessions above.
  UPDATE sessions    SET spent_duck  = NULL WHERE spent_duck  = OLD.id;
  UPDATE card_epochs SET keeper_duck = NULL WHERE keeper_duck = OLD.id;
END;
