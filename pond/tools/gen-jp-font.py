#!/usr/bin/env python3
"""Fetch the subsetted Dela Gothic One woff2 and inline it as a data URI.

Google Fonts' css2 endpoint accepts a `text=` parameter and returns a font
containing only those glyphs. For 大吉 / 小吉 / 末吉 / 凶 plus おみくじ that is
a handful of characters, so the file is a few KB instead of megabytes.

The unicode-range in the returned @font-face is the useful part: it lets the
Japanese font apply ONLY to Japanese codepoints, so Young Serif keeps the
Latin without wrapping anything in spans.
"""

import base64
import pathlib
import re
import urllib.request

CSS = pathlib.Path("dela.css").read_text()
url = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", CSS).group(1)
rng = re.search(r"unicode-range:\s*([^;]+);", CSS).group(1).strip()

req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
data = urllib.request.urlopen(req).read()
print(f"woff2: {len(data)} bytes")

b64 = base64.b64encode(data).decode()
face = (
    "@font-face{font-family:'Dela Gothic One';font-style:normal;"
    "font-weight:400;font-display:swap;"
    f"src:url(data:font/woff2;base64,{b64}) format('woff2');"
    f"unicode-range:{rng};}}"
)
pathlib.Path("dela-inline.css").write_text(face)
print(f"inline css: {len(face)} bytes -> dela-inline.css")
print(f"unicode-range: {rng}")
