# The pond — copy deck

Every word the product says, pulled straight out of
`pond/tools/prototype-flow.html`. **Generated, not hand-written** — add a
string to a screen, re-run `pond/tools/extract-copy.py`, and it shows up here.
If a string is in the product and not in this file, the extractor missed it
and that is a bug worth fixing.

Purpose: so wording can be reviewed in one place by a person who is not
looking at the code, and so there is a single source for the Traditional
Chinese translation.

Rules the copy follows are in [UI.md](UI.md). The glossary below is the
part to argue about.

---

## Glossary — one word per thing

The left column is the only word we use. The right column is what we
deliberately do **not** say, because a synonym in one screen makes people
wonder whether it is a different feature.

| We say | Never | Why |
| --- | --- | --- |
| **bump** | wave, poke, nudge, like | It is a thing your duck physically does. Renamed from wave on 12 Aug; one instance survived on the come-back screen and this deck is what caught it. |
| **duck** | avatar, profile, character | It is a duck. |
| **the pond** | feed, gallery, wall, timeline | It is a place, not a list. |
| **keeper** | owner, admin, user | You keep a card the way you keep a pet, not the way you own an asset. "Owner" also implies rights we do not grant. |
| **card** | tag, device, NFC card | What it is to the person holding it. |
| **private link** | edit link, magic link, login | It is the only credential and there is no account, so "login" is a lie. |
| **release** | post, publish, submit, share | You put a duck in water. |
| **take my duck out** | delete account, remove data, opt out | Plain, physical, and it says exactly what happens. |
| **fortune** | result, score, reading | It is an おみくじ. |
| **David** | the admin, the site owner, we | A named person is accountable in a way that "we" is not, and the contact screen is asking for someone's address. |

## Tone

- **Second person, active, present.** "Your duck is in", not "Your duck has been submitted".
- **Say the consequence, not the mechanism.** "Nothing is kept" beats "records are purged".
- **No exclamation marks, no congratulation.** The card already did the delight.
- **Buttons say what happens.** `Take my duck out`, not `Confirm`.
- **Sentence case in source.** Uppercase is a CSS decision, so it can be undone for Chinese, where there is no uppercase.
- **Never apologise for an optional field.** "Skip it and your duck still swims" is reassurance; "Sorry, we need this" is not.

---

## 01 · Arrival

*The first thing anyone sees after tapping a card.*  
`5 strings · 32 words`

| # | Kind | String |
| --- | --- | --- |
| `arrival.01` | Body | The card dealt you |
| `arrival.02` | Heading | 大吉 · Great luck |
| `arrival.03` | Body | Nobody else got this one today. Make it look like you, or drop it in as it is. |
| `arrival.04` | Button | Make it mine |
| `arrival.05` | Button | Just look around |

---

## 02 · Studio

*Decorating. Almost all controls, almost no prose.*  
`13 strings · 25 words`

| # | Kind | String |
| --- | --- | --- |
| `studio.01` | Button | ← Back |
| `studio.02` | Button | Skip → |
| `studio.03` | Button | Colour |
| `studio.04` | Button | Stickers |
| `studio.05` | Button | Draw |
| `studio.06` | Body | Body |
| `studio.07` | Body | Brush |
| `studio.08` | Button | 1× |
| `studio.09` | Button | 2× |
| `studio.10` | Button | Erase |
| `studio.11` | Body | Colour |
| `studio.12` | Button | Looks good |
| `studio.13` | Body | Drag a sticker to move it · nothing is required |

---

## 03 · Sign it

*Name and message. The first time we ask for anything.*  
`8 strings · 30 words`

| # | Kind | String |
| --- | --- | --- |
| `sign.01` | Body | Sign it |
| `sign.02` | Heading | Who's this duck? |
| `sign.03` | Field label | Name on the duck |
| `sign.04` | Placeholder | Sam |
| `sign.05` | Field label | Leave a message |
| `sign.06` | Placeholder | tell the pond something |
| `sign.07` | Privacy note | Your name and message are visible to everyone who taps a card. |
| `sign.08` | Button | Next |

---

## 04 · Contact

*Optional, skippable, and the most sensitive ask in the flow.*  
`9 strings · 90 words`

| # | Kind | String |
| --- | --- | --- |
| `contact.01` | Body | Optional |
| `contact.02` | Heading | Want David to write back? |
| `contact.03` | Body | Skip it and your duck still swims. This changes nothing about the pond. |
| `contact.04` | Field label | Email, phone, @handle — or a postal address |
| `contact.05` | Placeholder | @yourhandle or 12 Somewhere St, Brooklyn NY 11211 |
| `contact.06` | Body | I like mailing postcards. Leave an address and I'll send you one. I won't share it with anyone. |
| `contact.07` | Privacy note | Only David sees this. Never drawn in the pond, never returned by the public API, stored apart from everything else — and deleted the moment you take your duck out. |
| `contact.08` | Button | Release my duck |
| `contact.09` | Button | Skip — no contact |

---

## 05 · The pond

*Includes the keep-link sheet and the duck card.*  
`27 strings · 89 words`

| # | Kind | String |
| --- | --- | --- |
| `pond.01` | Button | Find my duck |
| `pond.02` | Body | Your duck is in |
| `pond.03` | Heading | Keep this link |
| `pond.04` | Body | There are no accounts. It's the only way back to change your message, redecorate, or take it out. |
| `pond.05` | Field label | Your private link — the only key that exists |
| `pond.06` | Example value | ducky.davidyang.work/e/9fQ2xK7pLm |
| `pond.07` | Button | Copy |
| `pond.08` | Button | Text it |
| `pond.09` | Button | Email it |
| `pond.10` | Button | Done |
| `pond.11` | Button | ✕ |
| `pond.12` | Body | 小吉Little luck |
| `pond.13` | Body | Mika |
| `pond.14` | Body | via Sam · 4 Aug |
| `pond.15` | Body | found this card at the bar |
| `pond.16` | Body | Bumped most by |
| `pond.17` | Body | What's wrong with it? |
| `pond.18` | Button | Rude or abusive |
| `pond.19` | Button | Private details |
| `pond.20` | Button | Spam |
| `pond.21` | Button | Something else |
| `pond.22` | Field label | Anything to add |
| `pond.23` | Placeholder | Anything to add — optional |
| `pond.24` | Button | Send report |
| `pond.25` | Button | Cancel |
| `pond.26` | Button | Bump · 6 |
| `pond.27` | Button | Report |

---

## 06 · Your duck, later

*Coming back.*  
`7 strings · 31 words`

| # | Kind | String |
| --- | --- | --- |
| `mine.01` | Body | Welcome back |
| `mine.02` | Heading | Still floating |
| `mine.03` | Body | Your duck has been in the pond for six days. Four people bumped it. |
| `mine.04` | Body | Mika, Jo, Lu and Sam bumped you. |
| `mine.05` | Button | Back to the pond |
| `mine.06` | Button | Redecorate |
| `mine.07` | Button | Settings |

---

## 07 · Settings

*Edit or remove. Includes the only destructive action.*  
`10 strings · 58 words`

| # | Kind | String |
| --- | --- | --- |
| `manage.01` | Body | Your duck |
| `manage.02` | Heading | Message & settings |
| `manage.03` | Field label | Your message |
| `manage.04` | Field label | Email, phone, @handle — or a postal address |
| `manage.05` | Field label | Your private link — the only key that exists |
| `manage.06` | Example value | ducky.davidyang.work/e/9fQ2xK7pLm |
| `manage.07` | Privacy note | Removing your duck deletes its message and your contact at the same time. Nothing is kept. |
| `manage.08` | Button | Save changes |
| `manage.09` | Button | Take my duck out |
| `manage.10` | Body | Tap ducks in the pond · drag stickers in the studio |

---

## 08 · Card setup

*Reached by blowing four times, never by a link.*  
`23 strings · 123 words`

| # | Kind | String |
| --- | --- | --- |
| `keeper.01` | Body | Four blows · this card |
| `keeper.02` | Heading | This card is yours |
| `keeper.03` | Body | Nobody can change this without holding the card and blowing into it again. |
| `keeper.04` | Field label | Whose card is it |
| `keeper.05` | Example value | Sam |
| `keeper.06` | Hint | Ducks released from this card will say via Sam. |
| `keeper.07` | Field label | Your duck — optional |
| `keeper.08` | Button | Not mine |
| `keeper.09` | Button | Make one now |
| `keeper.10` | Button | Paste my link |
| `keeper.11` | Hint | Linking your duck lets people bump you back. |
| `keeper.12` | Field label | Language people see first |
| `keeper.13` | Button | English |
| `keeper.14` | Button | 繁體中文 |
| `keeper.15` | Hint | A default, not a lock — a phone that asks for another language still gets it. |
| `keeper.16` | Field label | Your link — optional |
| `keeper.17` | Placeholder | https:// |
| `keeper.18` | Button | Fortune first |
| `keeper.19` | Button | Straight to my link |
| `keeper.20` | Privacy note | Never an automatic redirect. Visitors land on a page with your name on it and choose. https only. |
| `keeper.21` | Field label | Adopt the 12 ducks that came from this card before you claimed it |
| `keeper.22` | Button | Save |
| `keeper.23` | Button | Not now |

---

## 09 · Admin

*One reader. Stays English.*  
`25 strings · 81 words`

| # | Kind | String |
| --- | --- | --- |
| `admin.01` | Body | ducky.davidyang.work/admin |
| `admin.02` | Heading | Admin |
| `admin.03` | Button | Ducks |
| `admin.04` | Button | Contacts |
| `admin.05` | Button | Cards |
| `admin.06` | Body | Mika · shared with you · 4 Aug |
| `admin.07` | Body | "found this card at the bar" |
| `admin.08` | Body | mika.tanaka@example.com |
| `admin.09` | Button | Reply |
| `admin.10` | Button | Mark done |
| `admin.11` | Body | Shuang · shared with Sam and you · 12 Jul |
| `admin.12` | Body | "clover duck" |
| `admin.13` | Body | Shuang Li 14 Bishopsgate, Flat 6 London EC2N 3AR |
| `admin.14` | Button | Copy address |
| `admin.15` | Button | Postcard sent |
| `admin.16` | Body | Ren · shared with you · 5 Aug |
| `admin.17` | Body | "insert coin → insert duck" |
| `admin.18` | Body | +44 7700 900142 |
| `admin.19` | Button | ✓ Replied 6 Aug |
| `admin.20` | Button | Download CSV |
| `admin.21` | Body | 繁體中文 · mika.example.com |
| `admin.22` | Button | Unclaim |
| `admin.23` | Button | Kill link |
| `admin.24` | Body | English · no link |
| `admin.25` | Button | Unclaim |

---

## Weight

| Screen | Words |
| --- | ---: |
| Arrival | 32 |
| Studio | 25 |
| Sign it | 30 |
| Contact | 90 |
| The pond | 89 |
| Your duck, later | 31 |
| Settings | 58 |
| Card setup | 123 |
| Admin | 81 |
| **Total** | **559** |

Card setup was 169 words on 12 Aug — nearly double the next screen — which
is what prompted this deck. Trimmed to 124 by cutting three explanations
down to the sentence that carried them. Anything over ~120 words on one
phone screen is worth a second look.

## Open questions for review

- **"Whose card is it"** as a field label reads as a question about someone
  else. "Your name" is plainer but loses that it is the *card* being named.
- **"Fortune first" / "Straight to my link"** are terse enough to be cryptic
  the first time. They may need a line of explanation, which fights the trim.
- **"Adopt"** for inheriting earlier ducks — warm, or strange?
- The contact screen names **David** four times across the flow. Right amount?
