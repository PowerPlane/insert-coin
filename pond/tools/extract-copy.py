"""Regenerate docs/pond/COPY.md from the prototype.

Run me after changing any user-facing string:

    python3 pond/tools/extract-copy.py

The deck is generated so it cannot drift from what the product actually
says. Only the phone screens count as product copy -- the essay around the
device frame is review chrome.
"""
from html.parser import HTMLParser
import json
import pathlib
import re


class Screens(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []          # (tag, classes, data-v)
        self.cur = None          # current screen name
        self.depth = 0
        self.out = {}            # screen -> list of (kind, text)
        self.pending = None      # tag we are collecting text for

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get("class") or "").split()
        if "view" in cls and a.get("data-v"):
            self.cur = a["data-v"]
            self.depth = 0
            self.out.setdefault(self.cur, [])
        elif self.cur is not None:
            self.depth += 1

        if self.cur is None:
            return

        kind = None
        if tag == "button":
            kind = "button"
        elif tag == "label":
            kind = "label"
        elif tag in ("h1", "h2", "h3"):
            kind = "heading"
        elif tag == "p":
            kind = "p" if "priv" not in cls and "k-hint" not in cls else (
                "privacy" if "priv" in cls else "hint")
        elif tag in ("li",):
            kind = "item"
        if kind:
            self.pending = [kind, ""]

        if tag in ("input", "textarea"):
            for key, label in (("placeholder", "placeholder"), ("value", "value")):
                if a.get(key):
                    self.out[self.cur].append([label, a[key]])

    def handle_endtag(self, tag):
        if self.cur is None:
            return
        if self.pending and tag in ("button", "label", "h1", "h2", "h3", "p", "li"):
            text = re.sub(r"\s+", " ", self.pending[1]).strip()
            if text:
                self.out[self.cur].append([self.pending[0], text])
            self.pending = None
        if tag == "div":
            if self.depth == 0:
                self.cur = None
            else:
                self.depth -= 1

    def handle_data(self, data):
        if self.cur is not None and self.pending is not None:
            self.pending[1] += data


ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "pond" / "tools" / "prototype-flow.html"
OUT = ROOT / "docs" / "pond" / "COPY.md"
src = SRC.read_text()
# the phone only
start = src.index('<div class="dev">')
end = src.index('<section class="wrap"', start) if '<section class="wrap"' in src[start:] else len(src)
p = Screens()
p.feed(src[start:end])

order = ["arrival", "studio", "sign", "contact", "release", "keep",
         "pond", "mine", "manage", "keeper", "admin"]
res = {k: p.out[k] for k in order if k in p.out}
for k in p.out:
    if k not in res:
        res[k] = p.out[k]

data = res


"""Render docs/pond/COPY.md from the extracted strings.

Generated, not hand-written, so the deck cannot drift from the product. Add
a string in the prototype, re-run, and it appears here with an id.
"""


TITLES = {
    "arrival": ("01", "Arrival", "The first thing anyone sees after tapping a card."),
    "studio": ("02", "Studio", "Decorating. Almost all controls, almost no prose."),
    "sign": ("03", "Sign it", "Name and message. The first time we ask for anything."),
    "contact": ("04", "Contact", "Optional, skippable, and the most sensitive ask in the flow."),
    "pond": ("05", "The pond", "Includes the keep-link sheet and the duck card."),
    "mine": ("06", "Your duck, later", "Coming back."),
    "manage": ("07", "Settings", "Edit or remove. Includes the only destructive action."),
    "keeper": ("08", "Card setup", "Reached by blowing four times, never by a link."),
    "admin": ("09", "Admin", "One reader. Stays English."),
}
KIND = {
    "heading": "Heading", "p": "Body", "hint": "Hint", "privacy": "Privacy note",
    "label": "Field label", "button": "Button", "placeholder": "Placeholder",
    "value": "Example value", "item": "List item",
}

lines = []
w = lines.append
w("# The pond — copy deck\n")
w("Every word the product says, pulled straight out of")
w("`pond/tools/prototype-flow.html`. **Generated, not hand-written** — add a")
w("string to a screen, re-run `pond/tools/extract-copy.py`, and it shows up here.")
w("If a string is in the product and not in this file, the extractor missed it")
w("and that is a bug worth fixing.\n")
w("Purpose: so wording can be reviewed in one place by a person who is not")
w("looking at the code, and so there is a single source for the Traditional")
w("Chinese translation.\n")
w("Rules the copy follows are in [UI.md](UI.md). The glossary below is the")
w("part to argue about.\n")
w("---\n")

w("## Glossary — one word per thing\n")
w("The left column is the only word we use. The right column is what we")
w("deliberately do **not** say, because a synonym in one screen makes people")
w("wonder whether it is a different feature.\n")
w("| We say | Never | Why |")
w("| --- | --- | --- |")
for a, b, c in [
    ("bump", "wave, poke, nudge, like", "It is a thing your duck physically does. Renamed from wave on 12 Aug; one instance survived on the come-back screen and this deck is what caught it."),
    ("duck", "avatar, profile, character", "It is a duck."),
    ("the pond", "feed, gallery, wall, timeline", "It is a place, not a list."),
    ("keeper", "owner, admin, user", "You keep a card the way you keep a pet, not the way you own an asset. \"Owner\" also implies rights we do not grant."),
    ("card", "tag, device, NFC card", "What it is to the person holding it."),
    ("private link", "edit link, magic link, login", "It is the only credential and there is no account, so \"login\" is a lie."),
    ("release", "post, publish, submit, share", "You put a duck in water."),
    ("take my duck out", "delete account, remove data, opt out", "Plain, physical, and it says exactly what happens."),
    ("fortune", "result, score, reading", "It is an おみくじ."),
    ("David", "the admin, the site owner, we", "A named person is accountable in a way that \"we\" is not, and the contact screen is asking for someone's address."),
]:
    w("| **%s** | %s | %s |" % (a, b, c))
w("")

w("## Tone\n")
w("- **Second person, active, present.** \"Your duck is in\", not \"Your duck has been submitted\".")
w("- **Say the consequence, not the mechanism.** \"Nothing is kept\" beats \"records are purged\".")
w("- **No exclamation marks, no congratulation.** The card already did the delight.")
w("- **Buttons say what happens.** `Take my duck out`, not `Confirm`.")
w("- **Sentence case in source.** Uppercase is a CSS decision, so it can be undone for Chinese, where there is no uppercase.")
w("- **Never apologise for an optional field.** \"Skip it and your duck still swims\" is reassurance; \"Sorry, we need this\" is not.\n")

total = 0
for key, items in data.items():
    if key not in TITLES:
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
        t = text.replace("|", "\\|").replace("\n", " ")
        w("| `%s.%02d` | %s | %s |" % (key, i, KIND.get(kind, kind), t))
    w("")

w("---\n")
w("## Weight\n")
w("| Screen | Words |")
w("| --- | ---: |")
for key, items in data.items():
    if key not in TITLES:
        continue
    w("| %s | %d |" % (TITLES[key][1], sum(len(t.split()) for _, t in items)))
w("| **Total** | **%d** |" % total)
w("")
w("Card setup was 169 words on 12 Aug — nearly double the next screen — which")
w("is what prompted this deck. Trimmed to 124 by cutting three explanations")
w("down to the sentence that carried them. Anything over ~120 words on one")
w("phone screen is worth a second look.\n")

w("## Open questions for review\n")
w("- **\"Whose card is it\"** as a field label reads as a question about someone")
w("  else. \"Your name\" is plainer but loses that it is the *card* being named.")
w("- **\"Fortune first\" / \"Straight to my link\"** are terse enough to be cryptic")
w("  the first time. They may need a line of explanation, which fights the trim.")
w("- **\"Adopt\"** for inheriting earlier ducks — warm, or strange?")
w("- The contact screen names **David** four times across the flow. Right amount?\n")

OUT.write_text("\n".join(lines))
print("wrote %s — %d words of product copy" % (OUT, total))
