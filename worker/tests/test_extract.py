from pathlib import Path

from abovefold_worker.extract import clean_image_url, extract

FIXTURES = Path(__file__).parent / "fixtures"
ARTICLE_HTML = (FIXTURES / "article.html").read_text()
LINKDUMP_HTML = (FIXTURES / "linkdump.html").read_text()

FEED_CONTENT = (
    "<p>This is the <b>feed's</b> own content, usually a short teaser or a "
    "partial copy of the article body pulled straight from the RSS/Atom feed.</p>"
)


def _fetch(html):
    def fetch(url):
        return html

    return fetch


def test_article_extracts_ok_with_word_count_and_lead_image():
    result = extract(
        "https://example.com/rss-article", FEED_CONTENT, fetch=_fetch(ARTICLE_HTML)
    )
    assert result.status == "ok"
    assert result.word_count >= 200
    assert result.lead_image == "https://example.com/media/rss-lede.jpg"
    assert result.word_count == len(result.text.split())


def test_falls_back_when_the_feed_carries_more_than_the_page():
    """Fallback exists to rescue a thin extraction, not to discard a good one."""
    rich_feed = "<p>" + " ".join(["feed's own content"] * 60) + "</p>"
    result = extract(
        "https://example.com/linkdump", rich_feed, fetch=_fetch(LINKDUMP_HTML)
    )
    assert result.status == "fallback"
    assert "feed's own content" in result.text
    assert "<b>" not in result.text
    assert "<p>" not in result.text
    assert result.word_count == len(result.text.split())


def test_short_but_real_post_keeps_its_own_words():
    """A genuine 70-word release note must not be replaced by a 20-word teaser.
    Measured on live data: this class was 6.7% of a batch and was being lost."""
    body = " ".join(["genuine"] * 70)
    page = f"<html><head><title>Release</title></head><body><article><p>{body}</p></article></body></html>"
    teaser = "<p>Read more on the blog.</p>"
    result = extract("https://example.com/release", teaser, fetch=_fetch(page))
    assert result.word_count >= 60, "the real post's words survived"
    assert "genuine" in result.text
    assert "Read more" not in result.text


def test_linkdump_page_has_no_lead_image():
    result = extract(
        "https://example.com/linkdump", FEED_CONTENT, fetch=_fetch(LINKDUMP_HTML)
    )
    assert result.lead_image is None


def test_fetch_raising_returns_failed_without_propagating():
    def fetch(url):
        raise ConnectionError("boom")

    result = extract("https://example.com/dead-link", FEED_CONTENT, fetch=fetch)
    assert result.status == "failed"
    assert result.lead_image is None
    assert "feed's own content" in result.text
    assert result.word_count == len(result.text.split())


def test_default_fetch_goes_through_safe_fetch(monkeypatch):
    """The default fetcher must be the guarded one, not a bare httpx.get.

    Article URLs come from feeds, so a publisher we subscribe to controls
    them. If this ever regresses to an unguarded client, a feed item pointing
    at http://db:5432 would be fetched.
    """
    calls = {}

    def fake_get_text(url, timeout=20):
        calls["url"] = url
        return ARTICLE_HTML

    monkeypatch.setattr("abovefold_worker.safe_fetch.get_text", fake_get_text)
    result = extract("https://example.com/rss-article", FEED_CONTENT)
    assert calls["url"] == "https://example.com/rss-article"
    assert result.status == "ok"


def test_private_url_from_a_feed_falls_back_instead_of_fetching():
    """A feed item pointing into the private network must not be fetched."""
    result = extract("http://169.254.169.254/latest/meta-data/", FEED_CONTENT)
    assert result.status == "failed"          # the fetch was refused
    assert "meta-data" not in result.text     # nothing internal came back


def test_clean_image_url_drops_invisible_characters():
    """The stored Simon Willison lead image began with two U+FFFC and a space."""
    assert clean_image_url("\ufffc\ufffc https://static.simonwillison.net/x.jpg") == (
        "https://static.simonwillison.net/x.jpg"
    )
    assert clean_image_url("\u200bhttps://a.test/i\ufeff.png\u2060") == "https://a.test/i.png"
    assert clean_image_url("https://a.test/ok.png") == "https://a.test/ok.png"
    assert clean_image_url("\ufffc ") is None
    assert clean_image_url(None) is None


def test_trafilatura_crash_does_not_raise(monkeypatch):
    # trafilatura 1.12.2 raises TypeError in htmlprocessing on some pages with
    # no og:image; that used to propagate and lose the article.
    def boom(*a, **k):
        raise TypeError("'NoneType' object is not subscriptable")

    monkeypatch.setattr("abovefold_worker.extract.trafilatura.extract", boom)
    page = "<html><head><title>t</title></head><body><p>hello</p></body></html>"
    feed = "<p>" + "word " * 80 + "</p>"
    ex = extract("https://ex.com/a", feed, fetch=lambda url: page)
    assert ex.lead_image is None
    assert ex.word_count >= 80, "falls back to the feed text"
