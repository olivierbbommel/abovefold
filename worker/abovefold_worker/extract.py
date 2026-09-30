"""Article full-text extraction, with a fallback to feed content.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from typing import Callable

import trafilatura

from . import safe_fetch

MIN_WORDS = 200


@dataclass(frozen=True)
class Extraction:
    text: str
    status: str  # "ok" | "fallback" | "failed"
    word_count: int
    lead_image: str | None


class _TextStripper(HTMLParser):
    """Strips tags, keeping the visible text with sane word boundaries."""

    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []

    def handle_data(self, data: str) -> None:
        self._chunks.append(data)

    def get_text(self) -> str:
        return unescape(" ".join(self._chunks))


def _html_to_text(html: str) -> str:
    stripper = _TextStripper()
    stripper.feed(html)
    text = stripper.get_text()
    return re.sub(r"\s+", " ", text).strip()


def _word_count(text: str) -> int:
    return len(text.split())


class _OgImageParser(HTMLParser):
    """Finds <meta property="og:image" content="..."> anywhere on the page."""

    def __init__(self) -> None:
        super().__init__()
        self.og_image: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "meta" or self.og_image is not None:
            return
        attr_dict = dict(attrs)
        prop = attr_dict.get("property") or attr_dict.get("name")
        if prop and prop.lower() == "og:image" and attr_dict.get("content"):
            self.og_image = attr_dict["content"]


def _find_og_image(html: str) -> str | None:
    parser = _OgImageParser()
    parser.feed(html)
    return parser.og_image


def _find_first_image(fragment: str | None) -> str | None:
    if not fragment:
        return None
    match = re.search(r'<img\b[^>]*\bsrc=["\']([^"\']+)["\']', fragment, re.IGNORECASE)
    return match.group(1) if match else None


# Object replacement (U+FFFC), zero-width and BOM characters. Simon Willison's
# pages wrap the image URL in them, and the stored value then 404s upstream.
_INVISIBLE_RE = re.compile("[\ufffc\u200b-\u200d\u2060\ufeff]")


def clean_image_url(url: str | None) -> str | None:
    if not url:
        return None
    return _INVISIBLE_RE.sub("", url).strip() or None


def _find_lead_image(html: str) -> str | None:
    og_image = _find_og_image(html)
    if og_image:
        return og_image
    try:
        article_html = trafilatura.extract(html, output_format="html", include_images=True)
    except Exception:
        # trafilatura 1.12.2 raises TypeError inside htmlprocessing on some
        # pages with no og:image. A lead image is optional; the article is not.
        return None
    return _find_first_image(article_html)


def extract(
    url: str,
    feed_content: str,
    fetch: Callable[[str], str] | None = None,
) -> Extraction:
    # safe_fetch, not a bare httpx.get: the URL comes from a feed item, and a
    # feed is not a trusted input. See worker/abovefold_worker/safe_fetch.py.
    fetcher = fetch if fetch is not None else safe_fetch.get_text

    try:
        html = fetcher(url)
    except Exception:
        fallback_text = _html_to_text(feed_content)
        return Extraction(
            text=fallback_text,
            status="failed",
            word_count=_word_count(fallback_text),
            lead_image=None,
        )

    lead_image = _find_lead_image(html)

    try:
        extracted = trafilatura.extract(html, output_format="markdown", include_comments=False)
    except Exception:
        extracted = None  # same trafilatura crash; fall through to the feed text
    if extracted and _word_count(extracted) >= MIN_WORDS:
        return Extraction(
            text=extracted,
            status="ok",
            word_count=_word_count(extracted),
            lead_image=lead_image,
        )

    # Below the confidence bar. Fall back to the feed's own content ONLY when it
    # actually carries more than the extraction did, a genuine 70-word release
    # note should keep its 70 real words, not be replaced by a 20-word teaser.
    fallback_text = _html_to_text(feed_content)
    extracted_words = _word_count(extracted) if extracted else 0
    if extracted and extracted_words >= _word_count(fallback_text):
        return Extraction(
            text=extracted,
            status="ok",
            word_count=extracted_words,
            lead_image=lead_image,
        )
    return Extraction(
        text=fallback_text,
        status="fallback",
        word_count=_word_count(fallback_text),
        lead_image=lead_image,
    )
