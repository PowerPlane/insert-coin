-- ABOUTME: Associates each released fortune with the private pond that created it.
-- ABOUTME: Keeps personal entries out of public slug lookups and supports per-visitor reads.

ALTER TABLE ducks ADD COLUMN visitor TEXT;

CREATE INDEX idx_ducks_visitor_created ON ducks (visitor, hidden, created DESC);
