-- The Pond — initial schema (Cloudflare D1 / SQLite)
--
-- Two rules shape this file:
--
--  1. Contacts live in their own table and NO public query ever joins it.
--     Not "we remember to strip the field" — the public read path does not
--     name the table at all, so a leak requires writing new code, not
--     forgetting a filter.
--
--  2. Storage stays deliberately boring: plain columns, base64 in TEXT, no
--     vendor-specific types. Moving this to a machine under a desk should be
--     a dump and a hostname change, not a rewrite.

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────
-- cards — one row per physical Insert Coin card.
-- Seeded by hand when a card is provisioned; `c=` in the tag URL points here.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE cards (
  id          TEXT PRIMARY KEY,            -- the &c= value, e.g. '7F3A9K'
  label       TEXT NOT NULL DEFAULT '',    -- 'the one I gave Sam'
  created     INTEGER NOT NULL,            -- unix seconds
  disabled    INTEGER NOT NULL DEFAULT 0   -- kill switch for a lost card
);

-- ─────────────────────────────────────────────────────────────────────────
-- ducks — everything the pond draws. Public.
-- The base artwork is CODE, not data: `fortune` selects a sprite that ships
-- with the site. Improving the art later improves every existing duck.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE ducks (
  id          TEXT PRIMARY KEY,            -- public id, short + urlsafe
  edit_key    TEXT NOT NULL UNIQUE,        -- the private link's secret half
  card_id     TEXT REFERENCES cards(id),   -- which physical card minted it
  fortune     INTEGER NOT NULL,            -- 0 great · 1 little · 2 uncertain · 3 bad
  tint        INTEGER NOT NULL DEFAULT 0,  -- index into the body palette
  stickers    TEXT NOT NULL DEFAULT '[]',  -- JSON [{id,x,y}], max 6
  paint       TEXT NOT NULL DEFAULT '',    -- base64 of 24x24 @ 4bpp = 288 bytes
  name        TEXT NOT NULL DEFAULT '',    -- <= 18 chars, may be empty
  message     TEXT NOT NULL DEFAULT '',    -- <= 90 chars, may be empty
  created     INTEGER NOT NULL,
  updated     INTEGER NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0,  -- moderation; never a hard delete
  wave_count  INTEGER NOT NULL DEFAULT 0,  -- denormalised for the pond read
  rescue_count INTEGER NOT NULL DEFAULT 0,

  CHECK (fortune BETWEEN 0 AND 3),
  CHECK (length(name) <= 18),
  CHECK (length(message) <= 90),
  CHECK (length(paint) <= 512),
  CHECK (length(stickers) <= 512)
);

-- The pond read: visible ducks, newest first.
CREATE INDEX idx_ducks_visible ON ducks (hidden, created DESC);
CREATE INDEX idx_ducks_card    ON ducks (card_id);

-- ─────────────────────────────────────────────────────────────────────────
-- contacts — PRIVATE. Owner-only.
--
-- Deliberately a separate table with its own access path. The public pond
-- query in src/worker/ducks.ts must never reference this name; there is a
-- test that greps for exactly that.
--
-- ON DELETE CASCADE matters: removing a duck removes the contact in the same
-- transaction. "Take my duck out" has to actually mean it.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE contacts (
  duck_id     TEXT PRIMARY KEY REFERENCES ducks(id) ON DELETE CASCADE,
  value       TEXT NOT NULL,               -- freeform: email, phone, @handle
  created     INTEGER NOT NULL,
  CHECK (length(value) <= 120)
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
  spent_duck  TEXT REFERENCES ducks(id),   -- set once released; one duck per session
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

-- ─────────────────────────────────────────────────────────────────────────
-- waves — one per visitor per duck, not one per tap.
-- `visitor` is a salted hash of a long-lived client id; no IP is stored.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE waves (
  duck_id     TEXT NOT NULL REFERENCES ducks(id) ON DELETE CASCADE,
  visitor     TEXT NOT NULL,
  created     INTEGER NOT NULL,
  PRIMARY KEY (duck_id, visitor)
);

-- ─────────────────────────────────────────────────────────────────────────
-- fires — 凶 ducks only. The server is the only thing that can ignite.
-- A row exists while a duck is alight; `out_at` closes it.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE fires (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  duck_id     TEXT NOT NULL REFERENCES ducks(id) ON DELETE CASCADE,
  lit_at      INTEGER NOT NULL,
  burns_until INTEGER NOT NULL,            -- self-extinguishes; never a stuck state
  out_at      INTEGER,                     -- NULL while burning
  out_by      TEXT                         -- visitor hash of whoever got there first
);
CREATE INDEX idx_fires_active ON fires (out_at, burns_until);

-- rescues — credit per person, so spamming taps earns nothing
CREATE TABLE rescues (
  fire_id     INTEGER NOT NULL REFERENCES fires(id) ON DELETE CASCADE,
  visitor     TEXT NOT NULL,
  created     INTEGER NOT NULL,
  PRIMARY KEY (fire_id, visitor)
);

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
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  duck_id     TEXT NOT NULL REFERENCES ducks(id) ON DELETE CASCADE,
  visitor     TEXT NOT NULL,
  created     INTEGER NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_reports_open ON reports (resolved, created DESC);
