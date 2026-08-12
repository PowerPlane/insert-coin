# The pond — copy deck

Every word the product says, pulled out of `pond/tools/prototype-flow.html`.
**Generated, not hand-written** — change a string, run
`python3 pond/tools/extract-copy.py`, and it shows up here.

Three sources, because the first version of this deck read only the nine
screens and silently missed the rest: **markup** (text and labels),
**attributes** (aria-label, placeholder — a screen reader user hears these,
so they are copy), and **code** (strings the JS writes in, which appear in
no markup at all).

Rules the copy follows are in [UI.md](UI.md). The glossary is the part to
argue about.

---

## Glossary — one word per thing

Left column is the only word we use. Right column is what we deliberately
do **not** say, because a synonym in one screen makes people wonder whether
it is a different feature.

| We say | Never | Why |
| --- | --- | --- |
| **bump** | wave, poke, nudge, like | A thing your duck physically does. |
| **bumped your duck** | bumped you, waved | The duck is what gets bumped, so counts and stats say so. |
| **duck** | avatar, profile, character | It is a duck. |
| **the pond** | feed, gallery, wall, timeline | A place, not a list. But don't overextend it — nothing "swims" or "floats" in UI copy. |
| **card keeper** | owner, admin, user | You keep a card the way you keep a pet. "Keeper" alone is precious, so it only appears where the card role matters. |
| **card** | tag, device, NFC card | What it is to the person holding it. |
| **private link** | edit link, magic link, login, key | The only credential, and there is no account — so "login" is a lie. "Key" was overwrought. |
| **link to show** | your link, public link, straight to my link | The keeper's own URL, distinct from the private link. |
| **link your duck** | adopt, attach, pair | Plain verb for connecting two things you already have. |
| **release** | post, publish, submit | You put a duck in water. ("Share" stays allowed — contact sharing is a different idea.) |
| **take my duck out** | delete account, remove data, opt out, remove your duck | Plain, physical, says exactly what happens. |
| **put out** | douse, extinguish | What you do to a fire. |
| **contact** | details, info, private details | One word for the thing someone optionally leaves. |
| **fortune** | result, score, reading | It is an おみくじ. |
| **David** | the admin, the site owner, we, I | A named person is accountable in a way "we" is not, and the contact screen asks for someone's address. Never switch to first person. |

## Tone

- **Second person, active, present.** "Your duck is in", not "Your duck has been submitted".
- **Say the consequence, not the mechanism.** "Nothing is kept" beats "records are purged".
- **No exclamation marks, no congratulation.** The card already did the delight.
- **Buttons say what happens.** `Take my duck out`, not `Confirm`.
- **Sentence case in source.** Uppercase is a CSS decision, so it can be undone for Chinese, which has no uppercase.
- **An em dash is not a UI element.** `Email, phone, @handle, or address`, not `… — or a postal address`.
- **Never apologise for an optional field.** "Skip this and your duck still goes in" is reassurance.

---

## 01 · Arrival

*The first thing anyone sees after tapping a card.*  
`5 strings · 25 words`

| # | Kind | String |
| --- | --- | --- |
| `arrival.01` | Body | Your fortune |
| `arrival.02` | Heading | 大吉 · Great luck |
| `arrival.03` | Body | No one else got this duck today. Decorate it or release it as is. |
| `arrival.04` | Button | Decorate it |
| `arrival.05` | Button | Just look around |

---

## 02 · Studio

*Decorating. Almost all controls, almost no prose.*  
`18 strings · 37 words`

| # | Kind | String |
| --- | --- | --- |
| `studio.01` | Button | Back |
| `studio.02` | Body | Make it yours |
| `studio.03` | Button | Skip |
| `studio.04` | Screen reader | Your duck. Tap to place or drag a sticker. |
| `studio.05` | Screen reader | Undo |
| `studio.06` | Screen reader | Clear everything |
| `studio.07` | Screen reader | Surprise me |
| `studio.08` | Button | Colour |
| `studio.09` | Button | Stickers |
| `studio.10` | Button | Draw |
| `studio.11` | Body | Body |
| `studio.12` | Body | Brush |
| `studio.13` | Button | 1× |
| `studio.14` | Button | 2× |
| `studio.15` | Button | Erase |
| `studio.16` | Body | Colour |
| `studio.17` | Button | Next |
| `studio.18` | Body | Drag stickers to move them. Nothing is required. |

---

## 03 · Sign it

*Name and message. The first time we ask for anything.*  
`9 strings · 23 words`

| # | Kind | String |
| --- | --- | --- |
| `sign.01` | Body | Sign it |
| `sign.02` | Heading | Name your duck |
| `sign.03` | Field label | Name |
| `sign.04` | Placeholder | Sam |
| `sign.05` | Body | 0 |
| `sign.06` | Field label | Message |
| `sign.07` | Placeholder | Say something |
| `sign.08` | Privacy note | Everyone who taps a card can see your name and message. |
| `sign.09` | Button | Next |

---

## 04 · Contact

*Optional, skippable, the most sensitive ask in the flow.*  
`8 strings · 52 words`

| # | Kind | String |
| --- | --- | --- |
| `contact.01` | Body | Optional |
| `contact.02` | Heading | Want David to reply? |
| `contact.03` | Body | Skip this and your duck still goes in. |
| `contact.04` | Field label | Email, phone, @handle, or address |
| `contact.05` | Placeholder | @yourhandle or 12 Somewhere St, Brooklyn NY 11211 |
| `contact.06` | Privacy note | Only David sees this. It is not shown in the pond, and it is deleted when you take your duck out. |
| `contact.07` | Button | Release my duck |
| `contact.08` | Button | Skip contact |

---

## 05 · The pond

*The water itself.*  
`32 strings · 87 words`

| # | Kind | String |
| --- | --- | --- |
| `pond.01` | Body | 14 ducks |
| `pond.02` | Body | BY-002 |
| `pond.03` | Screen reader | Say something |
| `pond.04` | Button | Find my duck |
| `pond.05` | Screen reader | Your duck settings |
| `pond.06` | Screen reader | Ducks in the pond |
| `pond.07` | Body | Your duck is in |
| `pond.08` | Heading | Keep this link |
| `pond.09` | Body | No accounts. Use this to edit, redecorate, or take your duck out. |
| `pond.10` | Field label | Your private link |
| `pond.11` | Example value | ducky.davidyang.work/e/9fQ2xK7pLm |
| `pond.12` | Button | Copy |
| `pond.13` | Button | Text |
| `pond.14` | Button | Email |
| `pond.15` | Button | Done |
| `pond.16` | Screen reader | Close |
| `pond.17` | Body | 小吉·Little luck |
| `pond.18` | Body | Mika |
| `pond.19` | Body | via Sam · 4 Aug |
| `pond.20` | Body | found this card at the bar |
| `pond.21` | Body | Most bumps from |
| `pond.22` | Body | What's wrong with it? |
| `pond.23` | Button | Rude or abusive |
| `pond.24` | Button | Private details |
| `pond.25` | Button | Spam |
| `pond.26` | Button | Something else |
| `pond.27` | Field label | Anything to add |
| `pond.28` | Placeholder | Anything to add — optional |
| `pond.29` | Button | Send report |
| `pond.30` | Button | Cancel |
| `pond.31` | Button | Bump · 6 |
| `pond.32` | Button | Report |

---

## 06 · Your duck, later

*Coming back.*  
`7 strings · 29 words`

| # | Kind | String |
| --- | --- | --- |
| `mine.01` | Body | Welcome back |
| `mine.02` | Heading | Your duck |
| `mine.03` | Body | In the pond for six days. Four people bumped your duck. |
| `mine.04` | Body | Mika, Jo, Lu, and Sam bumped your duck. |
| `mine.05` | Button | Back to the pond |
| `mine.06` | Button | Redecorate |
| `mine.07` | Button | Settings |

---

## 07 · Settings

*Edit or remove. Holds the only destructive action.*  
`9 strings · 38 words`

| # | Kind | String |
| --- | --- | --- |
| `manage.01` | Body | Your duck |
| `manage.02` | Heading | Message & settings |
| `manage.03` | Field label | Your message |
| `manage.04` | Field label | Email, phone, @handle, or address |
| `manage.05` | Field label | Your private link |
| `manage.06` | Example value | ducky.davidyang.work/e/9fQ2xK7pLm |
| `manage.07` | Privacy note | Taking your duck out deletes its message and contact at the same time. Nothing is kept. |
| `manage.08` | Button | Save changes |
| `manage.09` | Button | Take my duck out |

---

## 08 · Card setup

*Reached by blowing four times, never by a link.*  
`24 strings · 88 words`

| # | Kind | String |
| --- | --- | --- |
| `keeper.01` | Body | Card setup |
| `keeper.02` | Heading | Set up this card |
| `keeper.03` | Body | To change it, hold the card and blow again. |
| `keeper.04` | Field label | Card name |
| `keeper.05` | Example value | Sam |
| `keeper.06` | Hint | Ducks from this card say via Sam. |
| `keeper.07` | Field label | Link your duck |
| `keeper.08` | Button | Remove link |
| `keeper.09` | Button | Make a duck |
| `keeper.10` | Button | Paste duck link |
| `keeper.11` | Hint | People can bump you back. |
| `keeper.12` | Field label | Default language |
| `keeper.13` | Button | English |
| `keeper.14` | Button | 繁體中文 |
| `keeper.15` | Hint | A visitor's phone can still choose another language. |
| `keeper.16` | Field label | Link to show |
| `keeper.17` | Placeholder | https:// |
| `keeper.18` | Screen reader | When your link is shown |
| `keeper.19` | Button | Show fortune first |
| `keeper.20` | Button | Link first |
| `keeper.21` | Privacy note | Visitors always choose before opening your link. https only. |
| `keeper.22` | Field label | Add the 12 earlier ducks to this card |
| `keeper.23` | Button | Save setup |
| `keeper.24` | Button | Not now |

---

## 09 · Admin

*One reader. Stays English.*  
`33 strings · 97 words`

| # | Kind | String |
| --- | --- | --- |
| `admin.01` | Body | ducky.davidyang.work/admin |
| `admin.02` | Heading | Admin |
| `admin.03` | Button | Ducks |
| `admin.04` | Button | Contacts |
| `admin.05` | Button | Cards |
| `admin.06` | Body | All |
| `admin.07` | Body | Reported 1 |
| `admin.08` | Body | Hidden |
| `admin.09` | Body | To reply 2 |
| `admin.10` | Body | Replied |
| `admin.11` | Body | Postcards 1 |
| `admin.12` | Body | Mika · shared with you · 4 Aug |
| `admin.13` | Body | "found this card at the bar" |
| `admin.14` | Body | mika.tanaka@example.com |
| `admin.15` | Button | Reply |
| `admin.16` | Button | Mark replied |
| `admin.17` | Body | Shuang · shared with Sam and you · 12 Jul |
| `admin.18` | Body | "clover duck" |
| `admin.19` | Body | Shuang Li 14 Bishopsgate, Flat 6 London EC2N 3AR |
| `admin.20` | Button | Copy address |
| `admin.21` | Button | Postcard sent |
| `admin.22` | Body | Ren · shared with you · 5 Aug |
| `admin.23` | Body | "insert coin → insert duck" |
| `admin.24` | Body | +44 7700 900142 |
| `admin.25` | Button | ✓ Replied 6 Aug |
| `admin.26` | Button | Download CSV |
| `admin.27` | Body | All 100 |
| `admin.28` | Body | Claimed 12 |
| `admin.29` | Body | Never tapped 43 |
| `admin.30` | Body | 繁體中文 · mika.example.com |
| `admin.31` | Button | Unclaim |
| `admin.32` | Button | Disable link |
| `admin.33` | Body | English · no link |

---

## — · Shared chrome

*The duck card, the sheets and the modal — these sit outside any one screen.*  
`1 strings · 10 words`

| # | Kind | String |
| --- | --- | --- |
| `shared.01` | Body | Tap ducks in the pond. Drag stickers in the studio. |

---

## — · Set from code

*Written by JS, so they appear in no markup. Button states, counters, empty states.*  
`7 strings · 31 words`

| # | Kind | String |
| --- | --- | --- |
| `code.01` | Set from code | Drag a sticker to move it · nothing is required |
| `code.02` | Set from code | Find my duck |
| `code.03` | Set from code | Finish my duck |
| `code.04` | Set from code | Make a duck to bump |
| `code.05` | Set from code | Reported |
| `code.06` | Set from code | Reported ✓ |
| `code.07` | Set from code | Slide a coin in to get one |

---

## Weight

| Screen | Strings | Words |
| --- | ---: | ---: |
| Arrival | 5 | 25 |
| Studio | 18 | 37 |
| Sign it | 9 | 23 |
| Contact | 8 | 52 |
| The pond | 32 | 87 |
| Your duck, later | 7 | 29 |
| Settings | 9 | 38 |
| Card setup | 24 | 88 |
| Admin | 33 | 97 |
| Shared chrome | 1 | 10 |
| Set from code | 7 | 31 |
| **Total** | | **517** |

Anything over ~120 words on one phone screen is worth a second look.
