"""Outbound HTTP that refuses to touch the private network.

Article URLs come from feeds, and a feed is not a trusted input: a publisher
we subscribe to can point an item at ``http://db:5432`` or redirect to
``http://172.19.0.1:22`` and the worker would fetch it. The extracted text is
stored as the article body and shown back to the reader, so an internal
response that happens to parse as text would surface.

The blast radius was always small (the host's own ports are bound to loopback
and are unreachable from a container, and there is no cloud metadata endpoint
on a typical host), but "small" is not a reason to leave the fetcher unguarded.

Redirects are followed by hand so that EVERY hop is checked. Validating only
the URL we were given is the classic mistake: any public host can redirect
into private space.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit, urljoin

import httpx

MAX_REDIRECTS = 5
DEFAULT_TIMEOUT = 20

# Named services on the compose network, plus the usual local aliases.
BLOCKED_HOSTNAMES = frozenset({"localhost", "db", "miniflux", "web", "worker"})
BLOCKED_SUFFIXES = (".internal", ".local", ".localdomain")


class BlockedURL(Exception):
    """The URL resolves somewhere this process must not fetch."""


def _address_is_private(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local          # includes 169.254.169.254
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def check_url(url: str) -> None:
    """Raise BlockedURL unless this URL is a public http(s) address.

    Resolution happens here rather than trusting the literal text, so a DNS
    name that points at a private address is caught too.
    """
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise BlockedURL(f"scheme not allowed: {parts.scheme!r}")

    host = (parts.hostname or "").lower()
    if not host:
        raise BlockedURL("no host")
    if host in BLOCKED_HOSTNAMES or host.endswith(BLOCKED_SUFFIXES):
        raise BlockedURL(f"blocked host: {host}")

    try:
        resolved = socket.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80))
    except socket.gaierror as error:
        raise BlockedURL(f"could not resolve {host}") from error

    for family, _type, _proto, _canon, sockaddr in resolved:
        if _address_is_private(sockaddr[0]):
            raise BlockedURL(f"{host} resolves to {sockaddr[0]}")


def get_text(url: str, timeout: int = DEFAULT_TIMEOUT) -> str:
    """Fetch a public URL, checking the target at every redirect hop."""
    current = url
    with httpx.Client(follow_redirects=False, timeout=timeout) as client:
        for _ in range(MAX_REDIRECTS + 1):
            check_url(current)
            response = client.get(current)
            if not response.is_redirect:
                return response.text
            location = response.headers.get("location")
            if not location:
                return response.text
            current = urljoin(current, location)
    raise BlockedURL("too many redirects")
