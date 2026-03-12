"""
Tool executor for AutoImprove tool_simulation mode.
Provides real web_search (DuckDuckGo) and web_fetch implementations.
"""

import os
import re
from html import unescape
from urllib.parse import unquote

import httpx


FETCH_MAX_CHARS = 15_000
FETCH_TIMEOUT = 30.0
SEARCH_TIMEOUT = 15.0

DDG_URL = "https://html.duckduckgo.com/html/"


async def web_search(query: str, count: int = 10) -> dict:
    """Search the web using DuckDuckGo."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                DDG_URL,
                data={"q": query},
                headers={
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                },
                timeout=SEARCH_TIMEOUT,
            )
            resp.raise_for_status()
            html = resp.text

        results = _parse_ddg_html(html)
        return {"results": results[:count]}
    except Exception as e:
        return {"error": str(e), "results": []}


def _parse_ddg_html(html: str) -> list:
    """Parse DuckDuckGo HTML search results."""
    results = []

    # DDG lite HTML: <a rel="nofollow" class="result__a" href="...">
    link_pattern = re.compile(
        r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
        re.DOTALL,
    )
    snippet_pattern = re.compile(
        r'<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>',
        re.DOTALL,
    )

    links = link_pattern.findall(html)
    snippets = snippet_pattern.findall(html)

    for i, (raw_url, raw_title) in enumerate(links):
        url = raw_url
        if "uddg=" in url:
            match = re.search(r'uddg=([^&]+)', url)
            if match:
                url = unquote(match.group(1))
        elif url.startswith("//"):
            url = "https:" + url

        title = _strip_html(raw_title)
        snippet = _strip_html(snippets[i]) if i < len(snippets) else ""

        if url and title:
            results.append({
                "title": title[:200],
                "url": url,
                "snippet": snippet[:300],
            })

    return results


def _strip_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r'<[^>]+>', '', text)
    return unescape(text).strip()


async def web_fetch(url: str) -> dict:
    """Fetch a web page and return its text content."""
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(
                url,
                headers={"User-Agent": "OpenClaw-AutoImprove/1.0"},
                timeout=FETCH_TIMEOUT,
            )
            resp.raise_for_status()
            text = resp.text[:FETCH_MAX_CHARS]
        return {"url": url, "content": text, "status": resp.status_code}
    except Exception as e:
        return {"url": url, "error": str(e), "content": "", "status": 0}


TOOL_REGISTRY = {
    "web_search": web_search,
    "web_fetch": web_fetch,
}
