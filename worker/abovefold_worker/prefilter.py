"""Model-free prefilter.

Runs before any paid API call to decide whether an entry is worth spending
tokens on. Pure function: no I/O, no clock, no network, no database.
"""

import re

MIN_WORDS = 45   # 80 dropped real release-note posts (measured: 6.7% of a live batch)

# Case-insensitive match at the start of the (whitespace-stripped) title,
# on a word boundary so "Linkerd ships 2.0" or "Linking strategy for SEO"
# are not caught.
_LINK_DUMP_RE = re.compile(
    r"^(links|link dump|weekly roundup|open thread|daily digest|what we're reading)\b",
    re.IGNORECASE,
)


def should_process(
    word_count: int, title: str, feed_id: int, muted_feed_ids: set[int]
) -> tuple[bool, str]:
    if feed_id in muted_feed_ids:
        return False, "muted_feed"
    if word_count < MIN_WORDS:
        return False, "too_short"
    if _LINK_DUMP_RE.match(title.lstrip()):
        return False, "link_dump"
    return True, ""
