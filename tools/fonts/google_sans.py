"""Writes app/assets/fonts/GoogleSans-Medium.ttf and .woff2, the label font of Google's sign-in button.

They are Google Sans from github.com/google/fonts at SOURCE_COMMIT, checked against SOURCE_SHA256,
pinned at weight 500 with its other axes at their defaults, and cut to Basic Latin and the
characters of the button's labels, with fontTools' instancer and subsetter at the release
uv.lock pins. Run from the repository's root:

    uv run --project tools/fonts --locked python tools/fonts/google_sans.py
"""

import hashlib
import io
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SOURCE_COMMIT = "d4eb04601981780781306966afb88e876652bab4"
SOURCE_URL = (
    f"https://raw.githubusercontent.com/google/fonts/{SOURCE_COMMIT}"
    "/ofl/googlesans/GoogleSans%5BGRAD,opsz,wght%5D.ttf"
)
SOURCE_SHA256 = "d0a87d835a944b8b40d0e82a5651bb59ab97b936a2aeed5946eb57e7b2a3a90a"

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "app/assets/fonts/GoogleSans-Medium"

# Each label of the button, and the file that holds it, where it is checked to still be.
LABELS = {
    "app/lib/l10n/app_en.arb": "Continue with Google",
    "app/lib/l10n/app_ko.arb": "Google로 계속하기",
    "web/src/features/account/components/sign-in-button.tsx": "Google로 로그인",
}
BASIC_LATIN = range(0x20, 0x7F)


def source() -> bytes:
    with urllib.request.urlopen(SOURCE_URL) as response:
        data = response.read()
    found = hashlib.sha256(data).hexdigest()
    if found != SOURCE_SHA256:
        raise SystemExit(f"{SOURCE_URL} has SHA-256 {found}, not {SOURCE_SHA256}")
    return data


def characters() -> set[int]:
    wanted = set(BASIC_LATIN)
    for path, label in LABELS.items():
        if label not in (ROOT / path).read_text(encoding="utf-8"):
            raise SystemExit(f'{path} no longer holds the label "{label}"; update LABELS')
        wanted.update(ord(c) for c in label)
    return wanted


def main() -> None:
    # None pins an axis at its default.
    font = instancer.instantiateVariableFont(
        TTFont(io.BytesIO(source())),
        {"wght": 500, "opsz": None, "GRAD": None},
        updateFontNames=True,
    )
    options = subset.Options()
    # Keeps the copyright and licence names, which the subsetter drops by default.
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=characters())
    subsetter.subset(font)
    # The source's own timestamp, so a rerun writes the same bytes.
    font.recalcTimestamp = False
    font.save(OUT.with_suffix(".ttf"))
    font.flavor = "woff2"
    font.save(OUT.with_suffix(".woff2"))
    for suffix in (".ttf", ".woff2"):
        path = OUT.with_suffix(suffix)
        print(f"wrote {path.relative_to(ROOT)}, {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
