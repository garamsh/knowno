"""Fetches a font source file by its SHA-256: from the cache directory when it holds the file,
otherwise from its URL, and keeps what it downloaded there.

The cache is outside the repository, so no checkout holds a copy: $XDG_CACHE_HOME/knowno/fonts, or
~/.cache/knowno/fonts. One file per hash, named by it, so a changed pin never reads another's
file. CI restores and saves that directory with actions/cache. The hash is checked on every read,
a cache hit included, so a damaged or swapped cache file is dropped and downloaded again.
"""

import hashlib
import http.client
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ATTEMPTS = 4
PAUSE_SECONDS = 2.0
# Per socket operation, so a download that stalls between bytes fails, and is retried, in seconds.
TIMEOUT_SECONDS = 30


def cache_directory() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache"
    return Path(base) / "knowno" / "fonts"


def transient(error: Exception) -> bool:
    if isinstance(error, urllib.error.HTTPError):
        return error.code == 429 or error.code >= 500
    return isinstance(error, (OSError, http.client.HTTPException))


def download(url: str, attempts: int, pause: float) -> bytes:
    """The body of url. A transient failure is retried, after pause seconds and then twice as many
    for each further attempt, until attempts are spent; any other failure is raised at once."""
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT_SECONDS) as response:
                return response.read()
        except Exception as error:
            if attempt == attempts or not transient(error):
                raise
            wait = pause * 2 ** (attempt - 1)
            print(f"{url}: {error}; attempt {attempt} of {attempts} failed, retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise AssertionError("attempts is at least 1")


def fetch(
    url: str,
    sha256: str,
    attempts: int = ATTEMPTS,
    pause: float = PAUSE_SECONDS,
) -> bytes:
    cached = cache_directory() / sha256
    if cached.is_file():
        data = cached.read_bytes()
        if hashlib.sha256(data).hexdigest() == sha256:
            print(f"font source: cache hit, {cached}", file=sys.stderr)
            return data
        print(f"font source: {cached} has another hash; dropped", file=sys.stderr)
        cached.unlink()
    print(f"font source: cache miss, downloading {url}", file=sys.stderr)
    data = download(url, attempts, pause)
    found = hashlib.sha256(data).hexdigest()
    if found != sha256:
        raise SystemExit(f"{url} has SHA-256 {found}, not {sha256}")
    cached.parent.mkdir(parents=True, exist_ok=True)
    partial = cached.with_name(f"{sha256}.{os.getpid()}.part")
    partial.write_bytes(data)
    os.replace(partial, cached)
    return data
