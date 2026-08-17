-- Admin state: what has been answered, and what has been posted.
--
-- ══ WHY THIS IS A MIGRATION AND NOT AN EDIT TO 0001 ══
-- 0001_init.sql says, at the top: "Once a real database exists, this file
-- stops being editable and 0002_*.sql starts." A real database now exists,
-- with real ducks in it, so this is 0002.
--
-- Writing it as an edit to 0001 would have worked on a fresh database and
-- done nothing at all to the deployed one — which is the failure mode that
-- makes people distrust migrations in the first place.

-- ─────────────────────────────────────────────────────────────────────────
-- Contacts gain two dates, not two booleans.
--
-- The admin screen says "✓ Replied 6 Aug", not "replied: true" — the date
-- is the useful half, because the question David will actually have is
-- "did I get back to this person, and how long ago?" A boolean answers the
-- first and throws away the second.
--
-- NULL means not yet. There is no third state to represent.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE contacts ADD COLUMN replied INTEGER;
ALTER TABLE contacts ADD COLUMN postcard INTEGER;

-- The admin's own queue: everything with a contact, oldest unanswered
-- first, because that is the order a person works through a stack of post.
CREATE INDEX idx_contacts_replied ON contacts (replied, created);
