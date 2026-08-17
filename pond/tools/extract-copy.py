"""Regenerate docs/pond/COPY.md from the strings the product actually ships.

Run me after changing any user-facing string:

    python3 pond/tools/extract-copy.py

══ IT USED TO READ THE PROTOTYPE ══
This walked `pond/tools/prototype-flow.html` with an HTML parser and pulled
copy out of the markup. That was right while the prototype WAS the product.
It stopped being right the moment the real client shipped, and nothing said
so: the deck went on calling itself "every word the product says" while
describing a file nobody serves.

The contact screen was rewritten end to end and not one word of it reached
the deck. That is the same one-belief-two-copies bug this codebase keeps
having, in documentation form -- and a copy deck is exactly the document
that must not have it, because its whole job is to be the place you check.

So it reads `src/client/strings.ts`, which is what the product speaks from.
Two things get better for free:

  * BOTH LANGUAGES, side by side. Only the string table has the Traditional
    Chinese, so the prototype-based deck could never show it -- and a
    translation you cannot read next to its original is a translation
    nobody proofreads.
  * The kind of each string ("Button", "Heading") comes from the trailing
    comment already written beside it, rather than being guessed from which
    HTML tag it happened to sit in.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "pond" / "src" / "client" / "strings.ts"
OUT = ROOT / "docs" / "pond" / "COPY.md"

# `"key": "value",` with an optional trailing `// Kind` comment. Values may
# contain escaped quotes; the table is authored by hand and stays simple.
ENTRY = re.compile(
    r'^\s*"(?P<key>[a-z]+\.\d+)":\s*"(?P<val>(?:[^"\\]|\\.)*)",?\s*(?://\s*(?P<kind>.+?))?\s*$'
)
BLOCK = re.compile(r"^(?:export )?const (?P<name>\w+)(?::[^=]+)? = \{")

# Which screen each prefix belongs to, in the order somebody meets them.
SCREENS = [
    ("arrival", "01 · Arrival — the fortune you were dealt"),
    ("studio", "02 · Studio — decorating the duck"),
    ("sign", "03 · Sign — a name and a message"),
    ("contact", "04 · Contact — leaving a way to be reached"),
    ("scope", "04 · Contact — who may see it"),
    ("keep", "05 · Keep — the private link"),
    ("pond", "06 · The pond"),
    ("manage", "07 · Your duck's own screen"),
    ("keeper", "08 · Keeping a card"),
    ("code", "Set from code — button states and empty screens"),
    ("live", "Assembled at runtime — counts, names, errors"),
    ("shared", "Review scaffolding — not part of the product"),
]


def tables(text: str) -> dict[str, dict[str, tuple[str, str]]]:
    """Every string table in the file, as {table: {key: (value, kind)}}."""
    found: dict[str, dict[str, tuple[str, str]]] = {}
    current: str | None = None
    for line in text.splitlines():
        opened = BLOCK.match(line)
        if opened:
            current = opened.group("name")
            found.setdefault(current, {})
            continue
        if current and re.match(r"^\}", line):
            current = None
            continue
        if not current:
            continue
        got = ENTRY.match(line)
        if got:
            found[current][got.group("key")] = (
                got.group("val"),
                (got.group("kind") or "").strip(),
            )
    return found


def unescape(s: str) -> str:
    return s.replace('\\"', '"').replace("\\\\", "\\")


def cell(s: str) -> str:
    """A markdown table cell: pipes escaped, empties made visible."""
    if not s:
        return "*(empty)*"
    return unescape(s).replace("|", "\\|")


def main() -> None:
    text = SRC.read_text(encoding="utf-8")
    found = tables(text)

    # English lives across four tables; the Chinese is one.
    english: dict[str, tuple[str, str]] = {}
    for name in ("SCOPE_STRINGS", "LIVE_STRINGS", "KEEPER_STRINGS", "EN"):
        english.update(found.get(name, {}))
    chinese = found.get("ZH_HANT", {})

    lines: list[str] = []
    w = lines.append
    w("# The pond — copy deck")
    w("")
    w("Every word the product says, in both languages.")
    w("")
    w("**Generated, not hand-written.** Change a string in")
    w("`pond/src/client/strings.ts`, run `python3 pond/tools/extract-copy.py`,")
    w("and it shows up here. Editing this file by hand only makes it wrong.")
    w("")
    w(f"{len(english)} strings.")
    w("")
    w("---")
    w("")

    seen: set[str] = set()
    for prefix, title in SCREENS:
        keys = sorted(
            (k for k in english if k.split(".")[0] == prefix),
            key=lambda k: (k.split(".")[0], int(k.split(".")[1])),
        )
        if not keys:
            continue
        seen.update(keys)
        w(f"## {title}")
        w("")
        w("| Key | English | 繁體中文 | Kind |")
        w("| --- | --- | --- | --- |")
        for k in keys:
            en, kind = english[k]
            zh = chinese.get(k, ("", ""))[0]
            w(f"| `{k}` | {cell(en)} | {cell(zh)} | {kind or '—'} |")
        w("")

    leftover = sorted(set(english) - seen)
    if leftover:
        w("## Everything else")
        w("")
        w("| Key | English | 繁體中文 | Kind |")
        w("| --- | --- | --- | --- |")
        for k in leftover:
            en, kind = english[k]
            zh = chinese.get(k, ("", ""))[0]
            w(f"| `{k}` | {cell(en)} | {cell(zh)} | {kind or '—'} |")
        w("")

    missing = sorted(k for k in english if k not in chinese)
    w("---")
    w("")
    w("## Translation")
    w("")
    if missing:
        w(f"**{len(missing)} strings have no Traditional Chinese yet.** A reader")
        w("sees the English for these — `t()` falls back rather than showing a key,")
        w("which is why a half-finished table is safe to ship.")
        w("")
        for k in missing:
            w(f"- `{k}`")
    else:
        w("Every string has both languages.")
    w("")
    w("A handful are identical in both on purpose — names, an email example,")
    w("the language buttons. `test/strings.test.ts` keeps that list explicit, so")
    w("\"identical\" and \"nobody has translated this yet\" stay distinguishable.")
    w("")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(english)} strings, "
          f"{len(english) - len(missing)} translated")


if __name__ == "__main__":
    main()
