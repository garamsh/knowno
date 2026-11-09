"""Writes the Anki packages of this directory with Anki's own library, so each is what Anki exports.

Run from this directory: `uv run --with anki==26.9.4 python -I generate.py`. The note ids, GUIDs and
timestamps Anki draws differ per run, so the bytes do; the notes and the media do not.
"""

import struct
import tempfile
import zlib
from pathlib import Path

from anki.collection import Collection, DeckIdLimit, ExportAnkiPackageOptions

here = Path(__file__).parent


def png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """A solid-colour PNG."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    row = b"\x00" + bytes(rgb) * width
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(row * height))
        + chunk(b"IEND", b"")
    )


def write(path: Path, legacy: bool) -> None:
    with tempfile.TemporaryDirectory() as scratch:
        col = Collection(str(Path(scratch) / "collection.anki2"))
        spanish = col.decks.id("Spanish")
        verbs = col.decks.id("Spanish::Verbs")
        col.media.write_data("red.png", png(8, 8, (220, 40, 40)))

        def add(notetype: str, deck: int, *fields: str) -> None:
            model = col.models.by_name(notetype)
            assert model is not None
            note = col.new_note(model)
            for index, value in enumerate(fields):
                note.fields[index] = value
            col.add_note(note, deck)

        add("Basic", spanish, "<b>hablar</b>", "to speak<br>to talk")
        add("Basic", spanish, '<img src="red.png">', "red")
        add("Cloze", verbs, "Madrid is the capital of {{c1::Spain::country}}", "an extra")
        add("Basic (and reversed card)", verbs, "uno", "one")
        col.export_anki_package(
            out_path=str(path),
            options=ExportAnkiPackageOptions(
                with_scheduling=False, with_deck_configs=False, with_media=True, legacy=legacy
            ),
            limit=DeckIdLimit(deck_id=spanish),
        )
        col.close()


write(here / "spanish-latest.apkg", legacy=False)
write(here / "spanish-legacy.apkg", legacy=True)
