"""
Generic URL fetcher for zq.titan007.com (used by the titan analysis page).

仅服务 jc-workset 一条线：`fetch_url` 抓取分析页
（zq.titan007.com/analysis/{sid}cn.htm），优先快 HTTP，限流/失败回退 Playwright。
"""
import time
import urllib.error
import urllib.request
from typing import Optional

from . import playwright_fetcher

BASE = "https://zq.titan007.com"
REFERER = "https://zq.titan007.com/"

_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"),
    "Accept-Language": "zh-CN,zh;q=0.9",
}

# titan007's anti-bot responds to request bursts with HTTP 429/442.
_RETRY_STATUS = frozenset({429, 442})
_MAX_HTTP_RETRIES = 3
_RETRY_BACKOFF = (2.0, 5.0, 10.0)


class RateLimitedError(RuntimeError):
    """Raised when the site keeps rejecting requests with 429/442."""


def _decode(data: bytes) -> str:
    # Season files (sea{id}.js) are UTF-8 with a BOM; plain-HTTP returns the
    # raw BOM bytes, which a GBK-first decode would swallow into the following
    # 'v' of "var arrSeason". Match-result files decode fine as GBK.
    if data[:3] == b"\xef\xbb\xbf":
        return data[3:].decode("utf-8", errors="replace")
    try:
        return data.decode("gbk")
    except UnicodeDecodeError:
        return data.decode("utf-8-sig", errors="replace")


def _http_fetch(url: str, accept: str, timeout: int = 15000) -> Optional[str]:
    """Fast plain-HTTP GET with browser-like headers.

    Returns None on network errors / non-rate-limit HTTP errors (callers fall
    back to Playwright). Raises RateLimitedError when the site keeps answering
    429/442 after backoff retries.
    """
    for attempt in range(_MAX_HTTP_RETRIES):
        req = urllib.request.Request(url, headers={
            **_HEADERS, "Referer": REFERER, "Accept": accept})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return _decode(r.read())
        except urllib.error.HTTPError as e:
            if e.code in _RETRY_STATUS:
                if attempt == _MAX_HTTP_RETRIES - 1:
                    raise RateLimitedError(
                        f"HTTP {e.code} after {_MAX_HTTP_RETRIES} attempts: {url}")
                time.sleep(_RETRY_BACKOFF[attempt])
            else:
                return None
        except Exception:
            return None
    return None


def _playwright_fetch(url: str, accept: str, max_retry: int = 2) -> Optional[str]:
    data = playwright_fetcher.fetch_bytes(url, referer=REFERER, accept=accept,
                                          timeout=30000, max_retry=max_retry)
    if data is not None:
        return _decode(data)
    return None


def fetch_url(url: str, accept: str = "text/html,*/*", max_retry: int = 2) -> Optional[str]:
    """Fetch a URL, preferring a fast plain-HTTP request with a Playwright
    fallback. Analysis pages keep using their own dedicated Playwright path.
    Raises RateLimitedError when the site is actively throttling us (a real
    browser attempt first, then give up so callers can back off)."""
    try:
        text = _http_fetch(url, accept)
    except RateLimitedError:
        text = _playwright_fetch(url, accept, max_retry=1)
        if text is None:
            raise
        return text
    if text is not None:
        return text
    return _playwright_fetch(url, accept, max_retry)
