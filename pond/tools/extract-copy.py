"""Regenerate docs/pond/COPY.md from the prototype.

Run me after changing any user-facing string:

    python3 pond/tools/extract-copy.py

The deck is generated so it cannot drift from what the product actually
says. Only the phone counts as product copy -- the essay around the device
frame is review chrome.

Three sources, because a review missed strings when there was only one:

  markup      text, labels and headings inside the phone, including the
              duck card, the sheets and the modal that live outside any
              single screen
  attributes  aria-label, placeholder, title -- a screen reader user hears
              these, so they are copy
  code        strings the JS writes into the page (button states, counters,
              empty states). These never appear in the markup at all, and
              leaving them out is what made the first deck incomplete.
"""
from html.parser import HTMLParser
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "pond" / "tools" / "prototype-flow.html"
OUT = ROOT / "docs" / "pond" / "COPY.md"

TEXT_TAGS = ("button", "label", "h1", "h2", "h3", "p", "li", "option", "summary")
# A <span> is copy when it stands on its own -- a screen title, a filter chip,
# a HUD label. A <span> inside a paragraph is emphasis, and is already caught
# as part of that paragraph. "pending is None" is exactly that distinction.
STANDALONE = ("span",)
KIND = {
    "heading": "Heading", "p": "Body", "hint": "Hint", "privacy": "Privacy note",
    "label": "Field label", "button": "Button", "placeholder": "Placeholder",
    "value": "Example value", "item": "List item", "aria": "Screen reader",
    "title": "Tooltip", "option": "Option", "code": "Set from code",
}


class Phone(HTMLParser):
    """Walks the device frame, tracking which screen each string sits in."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.view = None
        self.view_depth = 0
        self.depth = 0
        self.out = {}
        self.pending = None

    def _add(self, kind, text):
        text = re.sub(r"\s+", " ", text).strip()
        if not text or text in ("·", "✕", "—"):
            return
        key = self.view or "shared"
        self.out.setdefault(key, [])
        if [kind, text] not in self.out[key]:
            self.out[key].append([kind, text])

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get("class") or "").split()
        self.depth += 1
        if "view" in cls and a.get("data-v"):
            self.view = a["data-v"]
            self.view_depth = self.depth
            self.out.setdefault(self.view, [])

        for attr, kind in (("aria-label", "aria"), ("placeholder", "placeholder"),
                           ("title", "title"), ("value", "value")):
            if a.get(attr):
                self._add(kind, a[attr])

        if tag in STANDALONE and self.pending is None:
            self.pending = ["p", ""]
        elif tag in TEXT_TAGS:
            kind = tag if tag in ("button", "label", "option") else "p"
            if tag in ("h1", "h2", "h3"):
                kind = "heading"
            elif tag == "li":
                kind = "item"
            elif tag == "p":
                kind = "privacy" if "priv" in cls else ("hint" if "k-hint" in cls else "p")
            self.pending = [kind, ""]

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.depth -= 1

    def handle_endtag(self, tag):
        if self.pending and (tag in TEXT_TAGS or tag in STANDALONE):
            self._add(self.pending[0], self.pending[1])
            self.pending = None
        if self.view is not None and self.depth == self.view_depth:
            self.view = None
        self.depth -= 1

    def handle_data(self, data):
        if self.pending is not None:
            self.pending[1] += data


src = SRC.read_text()
start = src.index('<div class="dev">')
end = src.index('<section class="wrap"', start)
p = Phone()
p.feed(src[start:end])
data = p.out

# ── strings the JS writes in ───────────────────────────────────────────
code = []
for m in re.finditer(
        r'(?:textContent\s*=\s*|innerHTML\s*=\s*|setAttribute\("aria-label",\s*)'
        r'"((?:[^"\\]|\\.){2,90})"', src):
    t = m.group(1)
    if re.search(r"[A-Za-z一-鿿]{3}", t) and "<" not in t and "://" not in t:
        t = t.replace('\\"', '"').strip()
        if t and t not in code:
            code.append(t)
data["code"] = [["code", t] for t in sorted(code, key=str.lower)]

TITLES = {
    "arrival": ("01", "Arrival", "The first thing anyone sees after tapping a card."),
    "studio": ("02", "Studio", "Decorating. Almost all controls, almost no prose."),
    "sign": ("03", "Sign it", "Name and message. The first time we ask for anything."),
    "contact": ("04", "Contact", "Optional, skippable, the most sensitive ask in the flow."),
    "pond": ("05", "The pond", "The water itself."),
    "mine": ("06", "Your duck, later", "Coming back."),
    "manage": ("07", "Settings", "Edit or remove. Holds the only destructive action."),
    "keeper": ("08", "Card setup", "Reached by blowing four times, never by a link."),
    "admin": ("09", "Admin", "One reader. Stays English."),
    "shared": ("—", "Shared chrome", "The duck card, the sheets and the modal — these sit outside any one screen."),
    "code": ("—", "Set from code", "Written by JS, so they appear in no markup. Button states, counters, empty states."),
}

lines = []
w = lines.append
w("# The pond — copy deck\n")
w("Every word the product says, pulled out of `pond/tools/prototype-flow.html`.")
w("**Generated, not hand-written** — change a string, run")
w("`python3 pond/tools/extract-copy.py`, and it shows up here.\n")
w("Three sources, because the first version of this deck read only the nine")
w("screens and silently missed the rest: **markup** (text and labels),")
w("**attributes** (aria-label, placeholder — a screen reader user hears these,")
w("so they are copy), and **code** (strings the JS writes in, which appear in")
w("no markup at all).\n")
w("Rules the copy follows are in [UI.md](UI.md). The glossary is the part to")
w("argue about.\n")
w("---\n")

w("## Glossary — one word per thing\n")
w("Left column is the only word we use. Right column is what we deliberately")
w("do **not** say, because a synonym in one screen makes people wonder whether")
w("it is a different feature.\n")
w("| We say | Never | Why |")
w("| --- | --- | --- |")
for a, b, c in [
    ("bump", "wave, poke, nudge, like", "A thing your duck physically does."),
    ("bumped your duck", "bumped you, waved", "The duck is what gets bumped, so counts and stats say so."),
    ("duck", "avatar, profile, character", "It is a duck."),
    ("the pond", "feed, gallery, wall, timeline", "A place, not a list. But don't overextend it — nothing \"swims\" or \"floats\" in UI copy."),
    ("card keeper", "owner, admin, user", "You keep a card the way you keep a pet. \"Keeper\" alone is precious, so it only appears where the card role matters."),
    ("card", "tag, device, NFC card", "What it is to the person holding it."),
    ("private link", "edit link, magic link, login, key", "The only credential, and there is no account — so \"login\" is a lie. \"Key\" was overwrought."),
    ("link to show", "your link, public link, straight to my link", "The keeper's own URL, distinct from the private link."),
    ("link your duck", "adopt, attach, pair", "Plain verb for connecting two things you already have."),
    ("release", "post, publish, submit", "You put a duck in water. (\"Share\" stays allowed — contact sharing is a different idea.)"),
    ("take my duck out", "delete account, remove data, opt out, remove your duck", "Plain, physical, says exactly what happens."),
    ("put out", "douse, extinguish", "What you do to a fire."),
    ("contact", "details, info, private details", "One word for the thing someone optionally leaves."),
    ("fortune", "result, score, reading", "It is an おみくじ."),
    ("David", "the admin, the site owner, we, I", "A named person is accountable in a way \"we\" is not, and the contact screen asks for someone's address. Never switch to first person."),
]:
    w("| **%s** | %s | %s |" % (a, b, c))
w("")

w("## Tone\n")
w("- **Second person, active, present.** \"Your duck is in\", not \"Your duck has been submitted\".")
w("- **Say the consequence, not the mechanism.** \"Nothing is kept\" beats \"records are purged\".")
w("- **No exclamation marks, no congratulation.** The card already did the delight.")
w("- **Buttons say what happens.** `Take my duck out`, not `Confirm`.")
w("- **Sentence case in source.** Uppercase is a CSS decision, so it can be undone for Chinese, which has no uppercase.")
w("- **An em dash is not a UI element.** `Email, phone, @handle, or address`, not `… — or a postal address`.")
w("- **Never apologise for an optional field.** \"Skip this and your duck still goes in\" is reassurance.\n")

order = ["arrival", "studio", "sign", "contact", "pond", "mine", "manage",
         "keeper", "admin", "shared", "code"]
total = 0
for key in order:
    items = data.get(key)
    if not items:
        continue
    num, title, blurb = TITLES[key]
    words = sum(len(t.split()) for _, t in items)
    total += words
    w("---\n")
    w("## %s · %s\n" % (num, title))
    w("*%s*  " % blurb)
    w("`%d strings · %d words`\n" % (len(items), words))
    w("| # | Kind | String |")
    w("| --- | --- | --- |")
    for i, (kind, text) in enumerate(items, 1):
        w("| `%s.%02d` | %s | %s |" % (key, i, KIND.get(kind, kind),
                                       text.replace("|", "\\|")))
    w("")

w("---\n")
w("## Weight\n")
w("| Screen | Strings | Words |")
w("| --- | ---: | ---: |")
for key in order:
    items = data.get(key)
    if items:
        w("| %s | %d | %d |" % (TITLES[key][1], len(items),
                                sum(len(t.split()) for _, t in items)))
w("| **Total** | | **%d** |" % total)
w("")
w("Anything over ~120 words on one phone screen is worth a second look.\n")

OUT.write_text("\n".join(lines))
print("wrote %s — %d words across %d groups" % (OUT, total, len([k for k in order if data.get(k)])))
