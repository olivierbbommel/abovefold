import pytest

from abovefold_worker.prefilter import MIN_WORDS, should_process


def test_normal_article_is_processed():
    result = should_process(200, "A perfectly ordinary article title", 1, set())
    assert result == (True, "")


def test_muted_feed_is_skipped():
    result = should_process(200, "A perfectly ordinary article title", 1, {1})
    assert result == (False, "muted_feed")


def test_too_short_is_skipped():
    result = should_process(MIN_WORDS - 1, "A perfectly ordinary article title", 1, set())
    assert result == (False, "too_short")


def test_exactly_min_words_passes():
    result = should_process(MIN_WORDS, "A perfectly ordinary article title", 1, set())
    assert result == (True, "")


@pytest.mark.parametrize(
    "title",
    [
        "Links",
        "Links for today",
        "Link dump",
        "Link dump: cool stuff",
        "Weekly roundup",
        "Weekly roundup of the internet",
        "Open thread",
        "Open thread for August",
        "Daily digest",
        "Daily digest: news",
        "What we're reading",
        "What we're reading this week",
    ],
)
def test_link_dump_titles_are_skipped(title):
    result = should_process(200, title, 1, set())
    assert result == (False, "link_dump")


def test_link_dump_match_is_case_insensitive():
    result = should_process(200, "LINKS FOR TODAY", 1, set())
    assert result == (False, "link_dump")


def test_link_dump_match_strips_leading_whitespace():
    result = should_process(200, "   Links for today", 1, set())
    assert result == (False, "link_dump")


def test_linkerd_is_not_a_false_positive():
    result = should_process(200, "Linkerd ships 2.0", 1, set())
    assert result == (True, "")


def test_linking_is_not_a_false_positive():
    result = should_process(200, "Linking strategy for SEO", 1, set())
    assert result == (True, "")


def test_precedence_muted_feed_wins_over_too_short_and_link_dump():
    # Short word count AND link-dump title AND muted feed: muted_feed must win.
    result = should_process(5, "Links for today", 1, {1})
    assert result == (False, "muted_feed")


def test_precedence_too_short_wins_over_link_dump():
    result = should_process(5, "Links for today", 1, set())
    assert result == (False, "too_short")


def test_not_muted_feed_is_unaffected():
    result = should_process(200, "A perfectly ordinary article title", 2, {1, 3})
    assert result == (True, "")
