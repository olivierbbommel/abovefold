"""Miniflux REST client. Reads unread entries and marks them read.

The worker never writes to Miniflux's `public` schema directly, this client
is the only channel that mutates Miniflux state, and it only ever does so
through the REST API.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import httpx


class MinifluxError(Exception):
    """Raised on any non-2xx response from the Miniflux API."""


@dataclass(frozen=True)
class Entry:
    id: int
    feed_id: int
    title: str
    url: str
    author: str | None
    published_at: datetime
    content: str
    enclosure_urls: list[str]
    feed_title: str = ""


def _image_enclosure_urls(enclosures: list[dict] | None) -> list[str]:
    if not enclosures:
        return []
    return [
        e["url"]
        for e in enclosures
        if (e.get("mime_type") or "").startswith("image/")
    ]


def _entry_from_json(data: dict) -> Entry:
    return Entry(
        id=data["id"],
        feed_id=data["feed_id"],
        title=data["title"],
        url=data["url"],
        author=data.get("author"),
        published_at=datetime.fromisoformat(data["published_at"].replace("Z", "+00:00")),
        content=data["content"],
        enclosure_urls=_image_enclosure_urls(data.get("enclosures")),
        feed_title=((data.get("feed") or {}).get("title") or ""),
    )


class MinifluxClient:
    def __init__(self, base_url: str, token: str, http: httpx.Client | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._http = http if http is not None else httpx.Client(timeout=30)

    def _headers(self) -> dict[str, str]:
        return {"X-Auth-Token": self._token}

    def fetch_entries(self, after_entry_id: int, limit: int = 100) -> list[Entry]:
        response = self._http.get(
            f"{self._base_url}/v1/entries",
            params={
                "after_entry_id": after_entry_id,
                "limit": limit,
                "order": "id",
                "direction": "asc",
                # Deliberately NOT filtered to unread: anything read in Reeder
                # or NetNewsWire before the next poll would be skipped, and the
                # cursor would advance past it, losing it permanently.
            },
            headers=self._headers(),
        )
        if not response.is_success:
            raise MinifluxError(
                f"GET /v1/entries failed: {response.status_code} {response.text}"
            )
        data = response.json()
        return [_entry_from_json(e) for e in data.get("entries", [])]

    def mark_read(self, entry_ids: list[int]) -> None:
        if not entry_ids:
            return
        response = self._http.put(
            f"{self._base_url}/v1/entries",
            json={"entry_ids": entry_ids, "status": "read"},
            headers=self._headers(),
        )
        if not response.is_success:
            raise MinifluxError(
                f"PUT /v1/entries failed: {response.status_code} {response.text}"
            )
