"""
Playwright-based HTTP fetcher.

Thread model: each thread owns a complete playwright instance (sync_playwright
+ browser), stored in threading.local. Playwright's sync API is bound to the
thread that created it — sharing one browser across threads raises
`greenlet.error: Cannot switch to a different thread`. Per-thread instances
make concurrent crawling safe, at the cost of one Chromium per thread.

UA rotates per request: a fresh context is created for every fetch and closed
afterwards, so the whole UA pool is used regardless of thread count.
"""
import atexit
import time
import random
import threading
from typing import Optional

from playwright.sync_api import sync_playwright, Browser
from core.user_agents import UA_LIST

_state = threading.local()


def _get_browser() -> Browser:
    pw = getattr(_state, "playwright", None)
    if pw is None:
        pw = _state.playwright = sync_playwright().start()
    if getattr(_state, "browser", None) is None:
        _state.browser = pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
            ],
        )
    return _state.browser


def _new_context():
    browser = _get_browser()
    return browser.new_context(
        locale="zh-CN",
        timezone_id="Asia/Shanghai",
        viewport={
            "width": random.randint(1200, 1400),
            "height": random.randint(800, 900),
        },
        user_agent=random.choice(UA_LIST),
        extra_http_headers={
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
    )


def fetch_text(
    url: str,
    referer: Optional[str] = None,
    accept: str = "text/html,*/*",
    timeout: int = 30000,
    max_retry: int = 2,
) -> Optional[str]:
    ctx = _new_context()
    try:
        for attempt in range(max_retry):
            page = ctx.new_page()
            try:
                headers = {"Accept": accept}
                if referer:
                    headers["Referer"] = referer
                page.set_extra_http_headers(headers)
                resp = page.goto(url, timeout=timeout, wait_until="domcontentloaded")
                if resp:
                    if resp.ok:
                        return resp.text()
                    if resp.status == 404:
                        return None
            except Exception:
                if attempt < max_retry - 1:
                    time.sleep(2)
            finally:
                page.close()
    finally:
        ctx.close()
    return None


def fetch_bytes(
    url: str,
    referer: Optional[str] = None,
    accept: str = "text/html,*/*",
    timeout: int = 30000,
    max_retry: int = 2,
) -> Optional[bytes]:
    ctx = _new_context()
    try:
        for attempt in range(max_retry):
            page = ctx.new_page()
            try:
                headers = {"Accept": accept}
                if referer:
                    headers["Referer"] = referer
                page.set_extra_http_headers(headers)
                resp = page.goto(url, timeout=timeout, wait_until="domcontentloaded")
                if resp:
                    if resp.ok:
                        return resp.body()
                    if resp.status == 404:
                        return None
            except Exception:
                if attempt < max_retry - 1:
                    time.sleep(2)
            finally:
                page.close()
    finally:
        ctx.close()
    return None


def close_thread_local():
    """Close the current thread's playwright instance (safe if none exists).
    Call this from each worker thread before it dies."""
    browser = getattr(_state, "browser", None)
    pw = getattr(_state, "playwright", None)
    try:
        if browser:
            browser.close()
    except Exception:
        pass
    try:
        if pw:
            pw.stop()
    except Exception:
        pass
    _state.browser = None
    _state.playwright = None


def close():
    """Close the current thread's playwright instance."""
    close_thread_local()


atexit.register(close_thread_local)
