"""The article fetcher must refuse the private network.

Article URLs come from feeds, so a publisher we subscribe to controls them.
"""
import pytest

from abovefold_worker.safe_fetch import BlockedURL, check_url


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:8090/",
        "http://localhost/",
        "http://db:5432/",
        "http://miniflux:8080/",
        "http://web:3000/api/newsletter/x",
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata
        "http://10.0.0.1/",
        "http://192.168.1.1/",
        "http://172.19.0.1:22/",                     # the docker bridge gateway
        "http://2130706433/",                        # 127.0.0.1 as an integer
        "http://0x7f000001/",                        # ...as hex
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",                # IPv4-mapped IPv6
        "http://0.0.0.0/",
        "http://something.internal/",
        "file:///etc/passwd",
        "gopher://127.0.0.1:5432/",
    ],
)
def test_blocks_private_and_non_http(url):
    with pytest.raises(BlockedURL):
        check_url(url)


@pytest.mark.parametrize(
    "url",
    ["https://example.com/a", "http://example.com/", "https://news.ycombinator.com/"],
)
def test_allows_public(url):
    check_url(url)  # must not raise
