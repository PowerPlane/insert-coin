# Personal Pond and Internet Sculptures

Date: 2026-08-27

## Decision

Insert Coin is a personal fortune journal expressed as a pond. A physical card creates a fortune. The phone that taps it owns a private pond, and every completed tap adds another decorated fortune to that pond.

An entry represents a moment, not a person. Its durable content is:

- the fortune selected by the card
- an optional intention for the day
- the tint, stickers, and paint used to decorate it
- its creation date and physical-card provenance

The visitor flow does not expose names, contact sharing, bumping, reporting, speech, keeper offers, or public entry links. Historical public entries and their administration remain in the database until a separate removal decision is made.

## Identity and persistence

The first implementation uses the existing opaque `pond_v` browser cookie as the pond identity. The server hashes its high-entropy random value before storing it on an entry. It deliberately does not derive this identity from `SESSION_SECRET`, because rotating an operational signing secret must not orphan durable ponds. The cookie is not the fortune store: Turso stores the entries, while the cookie only tells the server which rows to return.

This gives one stable pond per browser profile:

- A repeat tap during an unfinished fortune resumes the pending session.
- A repeat tap after a completed fortune creates another session and entry.
- A different browser or phone gets a different pond.
- A guessed personal slug returns 404.

This is a useful first boundary, but it is not account recovery. Clearing site data or changing phones loses the pointer to the pond even though the database rows remain. Local storage is used only for an unfinished decoration draft and the most recent edit credential.

## Recovery design

The next persistence slice should add one recovery credential per pond, not one link per fortune. Generate a high-entropy recovery token, store only its hash, and expose a route such as `/p/<token>` that restores the signed pond cookie after an explicit confirmation.

The recovery credential can be presented as a link and QR code. It should support:

- restoring a pond after browser data is cleared
- moving the pond to a new phone
- optionally adding a second device without merging anonymous browser identities

Do not use email as the primary identity unless the product deliberately becomes an account system. Do not put the raw recovery token into analytics, logs, or the entry table. A pond-level credential avoids making people save a separate secret for every fortune.

The physical device should eventually provide a unique play identifier in each signed NFC URL. Without it, the server can distinguish an unfinished session from a completed session, but it cannot distinguish a legitimate later insertion from a replay of the same still-live five-minute URL. A signed monotonic play counter or random nonce written for each insertion closes that gap and gives the entry a natural idempotency key.

## Keeper claim

The firmware listens for four distinct rises in the blow sensor while the result animation is active. One continuous breath counts once. On four blows, it skips the ordinary fortune URL, increments the card's persistent claim counter, signs the card serial and counter, and writes the claim URL to NFC.

The server verifies the signature and requires the counter to exceed the stored high-water mark before it opens, resumes, or transfers a keeper epoch. The gesture is therefore physical proof that someone is holding the card, while the counter prevents replay.

The personal pond does not need keeper identity in its visitor experience. Keeper claim remains useful only if physical card custody, owner configuration, or handoff becomes part of the sculpture. It should not be used as a user account or a way to join ponds.

## URL-to-session exchange

The NFC URL's fortune digit is valid for five minutes, but decorating may take longer. The first page request verifies the signed card data and exchanges the digit for a thirty-minute server session. The session id is stored in a signed, HTTP-only cookie. Release endpoints read the session, not the original URL.

An unspent session wins over a repeat tap so work is not orphaned. A spent session may be replaced, allowing the same phone to accrue another fortune.

## Reports

The historical report endpoint writes a row to the Turso `reports` table with the entry id, hashed visitor, reason, optional note, and creation time. Unresolved counts appear in the password-protected `/pondkeeper` admin interface, where they can be marked resolved. Reports do not currently send email, webhooks, or external notifications.

Personal entries do not expose a report action because the pond contains only that visitor's entries. The endpoint remains for historical public entries.

## Internet Sculptures integration

The Webstones repositories currently separate three responsibilities:

- `webstones` is the shop and object catalog.
- `shrine.computer` hosts the web experiences, including the current Fortune Webstone.
- Touchstone and QiQi register known objects and static NFC destinations for companion-device use.

Insert Coin should join this suite as a first-class Internet Sculpture, not as a configuration mode of the existing Fortune Webstone. The existing Fortune Webstone is a passive tag whose per-tag configuration lives in Cloudflare KV. Insert Coin has an active microcontroller, generates a fresh fortune event, and needs private append-only history. Treating them as the same object would erase the most important difference in how they behave.

Recommended integration:

1. Add Insert Coin to the Webstones object catalog with a product story and non-interactive preview.
2. Give the experience a stable suite URL such as `https://shrine.computer/pond`, while keeping firmware and Pond implementation ownership in this repository.
3. Back the personal pond with a relational store such as Cloudflare D1 or the existing Turso database. Do not put fortune history or recovery tokens in the current `fortuneConfigurations` KV namespace.
4. Add Touchstone support only when there is meaningful owner configuration, such as intention prompts, language, privacy, or recovery. A launcher tile alone does not justify companion registration.
5. Require signed play ids and a pond-level recovery credential before calling cross-device persistence complete.

The suite story is: Webstones catalogs the sculpture, `shrine.computer` gives it a stable public home, the physical Insert Coin object creates each event, and the private pond lets the event accumulate into a personal ritual over time.

## Hosting and database decision

Keep Vercel and Turso for the personal-pond release. The expected load is far below the free allowances of either platform, so a migration would not solve a capacity problem. The current choice also preserves `ducky.davidyang.work` as a single CNAME while the `davidyang.work` zone remains outside Cloudflare.

Turso is the authoritative fortune store, not a backup for browser storage. The browser contains only the anonymous pond cookie, an unfinished one-hour draft, a cooldown display deadline, and the latest per-entry edit credential. Removing Turso without replacing it with another server database would remove the durable pond.

Cloudflare D1 is a reasonable later destination because the application already speaks through a D1-shaped database interface and the Internet Sculptures server already runs on Cloudflare Workers. Move when the experience moves under a Cloudflare-controlled suite hostname and one operational owner is worth more than preserving the existing deployment. Do not move for anticipated load alone.

Before any database migration:

1. Add pond-level recovery so a user can prove that the rows survived the move from a second browser.
2. Export and checksum a SQLite-compatible backup.
3. Rehearse every migration and the database verification script against D1.
4. Run Turso and D1 in a short, explicit cutover window; do not introduce indefinite dual writes.
5. Verify the NFC URL, session exchange, release, recovery, and personal pond through the production hostname before retiring Turso.

Keep an independent periodic export even though Turso provides point-in-time restore. Provider restore protects against recent mistakes; an export protects against account, retention-window, or provider-level loss.

## Companion PWA boundary

The companion PWA should recognize Insert Coin only after it has an owner operation worth exposing. A catalog tile or launcher is not enough. The first useful surface is pond recovery and transfer:

- show a recovery QR or link
- attach this browser to an existing pond after confirmation
- rotate the recovery credential
- export or delete the pond
- show the card identity and last successful connection as diagnostics

Language or a small set of curated intention prompts can follow if testing shows that owners need them. Do not expose arbitrary fortune editing by default; surprise is part of this sculpture's ritual, and the existing Fortune Webstone configuration model describes a different object.

The current companion architecture needs two changes before it can safely own this configuration:

- Registration currently prevents more than one instance of an object type, but people may own or administer multiple Insert Coin cards. Registration must be unique by physical card, not only by catalog object id.
- The existing Fortune Webstone endpoint accepts configuration writes keyed by a tag id without authenticating ownership. Insert Coin recovery, deletion, and owner settings must require proof of physical custody, such as the signed four-blow keeper claim, followed by a revocable owner session. A scanned or typed tag id is not authority.

Do not use Web NFC to rewrite the Insert Coin tag from the PWA. The microcontroller owns its changing signed URL, Web NFC is not available on iOS, and a browser-written static URL would bypass the physical fortune event. The PWA may consume a signed claim URL to establish ownership, but firmware remains responsible for NFC contents.

## Explicit non-goals for this slice

- No accounts or email login.
- No cross-device recovery yet.
- No merging ponds created by different browser identities.
- No social graph, public feed, messaging, bumping, or contact exchange.
- No deletion of historical social tables or keeper firmware.
- No migration of an old public duck into a visitor's private pond.
