from datetime import timezone

import httpx
import pytest

from abovefold_worker.miniflux import Entry, MinifluxClient, MinifluxError


def make_client(handler):
    transport = httpx.MockTransport(handler)
    http = httpx.Client(transport=transport)
    return MinifluxClient("http://miniflux:8080", "tok", http=http)


ENTRY_JSON = {
    "id": 42,
    "feed_id": 7,
    "title": "A real article",
    "url": "https://example.com/a",
    "author": "Jane Doe",
    "published_at": "2026-08-20T10:15:00Z",
    "content": "<p>hello</p>",
    "enclosures": [
        {"url": "https://example.com/a.jpg", "mime_type": "image/jpeg"},
        {"url": "https://example.com/a.mp3", "mime_type": "audio/mpeg"},
    ],
}


def test_fetch_entries_request_path_and_params():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"total": 1, "entries": [ENTRY_JSON]})

    client = make_client(handler)
    client.fetch_entries(after_entry_id=41, limit=50)

    req = captured["request"]
    assert req.url.path == "/v1/entries"
    params = dict(httpx.QueryParams(req.url.query))
    assert params["after_entry_id"] == "41"
    assert params["limit"] == "50"
    assert params["order"] == "id"
    assert params["direction"] == "asc"
    # Deliberately unfiltered: filtering to unread loses anything read in a
    # native client before the next poll, because the cursor advances past it.
    assert "status" not in params


def test_fetch_entries_sets_auth_header():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"total": 0, "entries": []})

    client = make_client(handler)
    client.fetch_entries(after_entry_id=0)

    assert captured["request"].headers["X-Auth-Token"] == "tok"


def test_fetch_entries_default_limit():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"total": 0, "entries": []})

    client = make_client(handler)
    client.fetch_entries(after_entry_id=0)

    params = dict(httpx.QueryParams(captured["request"].url.query))
    assert params["limit"] == "100"


def test_fetch_entries_picks_up_image_enclosures_only():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"total": 1, "entries": [ENTRY_JSON]})

    client = make_client(handler)
    entries = client.fetch_entries(after_entry_id=0)

    assert len(entries) == 1
    entry = entries[0]
    assert isinstance(entry, Entry)
    assert entry.enclosure_urls == ["https://example.com/a.jpg"]


def test_fetch_entries_null_enclosures_yields_empty_list():
    entry_json = dict(ENTRY_JSON)
    entry_json["enclosures"] = None

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"total": 1, "entries": [entry_json]})

    client = make_client(handler)
    entries = client.fetch_entries(after_entry_id=0)

    assert entries[0].enclosure_urls == []


def test_fetch_entries_absent_enclosures_yields_empty_list():
    entry_json = dict(ENTRY_JSON)
    del entry_json["enclosures"]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"total": 1, "entries": [entry_json]})

    client = make_client(handler)
    entries = client.fetch_entries(after_entry_id=0)

    assert entries[0].enclosure_urls == []


def test_fetch_entries_parses_fields_and_timezone_aware_datetime():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"total": 1, "entries": [ENTRY_JSON]})

    client = make_client(handler)
    entry = client.fetch_entries(after_entry_id=0)[0]

    assert entry.id == 42
    assert entry.feed_id == 7
    assert entry.title == "A real article"
    assert entry.url == "https://example.com/a"
    assert entry.author == "Jane Doe"
    assert entry.content == "<p>hello</p>"
    assert entry.published_at.tzinfo is not None
    assert entry.published_at.astimezone(timezone.utc).isoformat() == "2026-08-20T10:15:00+00:00"


def test_fetch_entries_author_can_be_none():
    entry_json = dict(ENTRY_JSON)
    entry_json["author"] = None

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"total": 1, "entries": [entry_json]})

    client = make_client(handler)
    entry = client.fetch_entries(after_entry_id=0)[0]

    assert entry.author is None


def test_mark_read_empty_list_makes_no_request():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={})

    client = make_client(handler)
    client.mark_read([])

    assert calls == []


def test_mark_read_sends_put_with_body():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(204)

    client = make_client(handler)
    client.mark_read([1, 2, 3])

    req = captured["request"]
    assert req.method == "PUT"
    assert req.url.path == "/v1/entries"
    import json

    body = json.loads(req.content)
    assert body == {"entry_ids": [1, 2, 3], "status": "read"}


def test_fetch_entries_raises_on_401():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error_message": "Invalid access token"})

    client = make_client(handler)
    with pytest.raises(MinifluxError):
        client.fetch_entries(after_entry_id=0)


def test_mark_read_raises_on_non_2xx():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error_message": "boom"})

    client = make_client(handler)
    with pytest.raises(MinifluxError):
        client.mark_read([1])
