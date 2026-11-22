"""Refresh Saturday HQ's Notre Dame football headlines from publisher RSS."""

import gzip
import io
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree

from update_rankings import save_json

OUTPUT = Path(__file__).resolve().parent / "data/notre-dame-news.json"
SOURCES = {
    "Notre Dame Athletics": ("https://fightingirish.com/rss", "/news/"),
    "NDNation": ("https://ndnation.com/feed/", "/"),
    "CBS Sports": ("https://www.cbssports.com/rss/headlines/college-football/", "/college-football/news/"),
}
DISPLAY_LIMIT = 20
DEFAULT_COUNT = 5
MAX_FEED_BYTES = 2_000_000
ND_NAME = re.compile(r"\bnotre[ -]dame\b|\bfighting[ -]irish\b", re.I)
STOP_WORDS = {"a", "an", "and", "as", "at", "in", "of", "the", "to", "with"}


class DirectFeed(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_feed(url):
    request = Request(url, headers={"User-Agent": "SaturdayHQNews/1.0"})
    with build_opener(DirectFeed()).open(request, timeout=10) as response:
        data = response.read(MAX_FEED_BYTES + 1)
    if data.startswith(b"\x1f\x8b") and len(data) <= MAX_FEED_BYTES:
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as compressed:
            data = compressed.read(MAX_FEED_BYTES + 1)
    if len(data) > MAX_FEED_BYTES:
        raise ValueError("RSS response exceeds size limit")
    # Decode before scanning so an alternate XML encoding cannot hide a DTD.
    xml = data.decode("utf-8-sig")
    if re.search(r"<!DOCTYPE\b|<!ENTITY\b", xml, re.I) or "\x00" in xml:
        raise ValueError("Unsupported RSS document")
    return xml


def canonical_url(value, source):
    if re.search(r"[\x00-\x20\x7f\\]", value):
        return None
    feed, prefix = SOURCES[source]
    try:
        url = urlsplit(value)
        if (url.scheme != "https" or url.netloc != urlsplit(feed).netloc
                or not url.path.startswith(prefix) or url.path.rstrip("/") == prefix.rstrip("/")):
            return None
    except ValueError:
        return None
    # All selected publishers use article paths. Query and fragment are tracking or anchors.
    return urlunsplit(("https", url.netloc, url.path, "", ""))


def relevant(item, source, title, url):
    if source == "Notre Dame Athletics":
        return item.findtext("sports") == "Football" and item.findtext("type") == "default"
    if source == "NDNation":
        return any((tag.text or "").strip().casefold() == "football" for tag in item.findall("category"))
    return bool(ND_NAME.search(title) and ND_NAME.search(urlsplit(url).path))


def parse_feed(xml, source, now):
    root = ElementTree.fromstring(xml)
    channel = root.find("channel")
    if root.tag != "rss" or channel is None:
        raise ValueError("Expected an RSS channel")
    articles = []
    for item in channel.findall("item"):
        title = " ".join(unescape(item.findtext("title", "")).split())
        url = canonical_url(item.findtext("link", "").strip(), source)
        if not title or len(title) > 300 or not url or not relevant(item, source, title, url):
            continue
        try:
            published = parsedate_to_datetime(item.findtext("pubDate", ""))
        except (ValueError, TypeError, OverflowError):
            continue
        if published.utcoffset() is None or not now - timedelta(days=30) <= published <= now:
            continue
        articles.append({
            "title": title, "url": url, "source": source,
            "published_at": published.astimezone(timezone.utc).isoformat(),
        })
    return articles


def headline_words(title):
    return [word for word in re.findall(r"[^\W_]+", title.casefold()) if word not in STOP_WORDS]


def select_articles(articles, now):
    oldest = (now - timedelta(days=30)).isoformat()
    recent = (now - timedelta(days=14)).isoformat()
    ordered = sorted(articles, key=lambda row: (row["published_at"], row["url"]), reverse=True)
    selected = []
    urls = set()
    headlines = []
    for row in ordered:
        if row["published_at"] < oldest:
            break
        if row["published_at"] < recent and len(selected) >= DEFAULT_COUNT:
            break
        # Expand to the older window only to fill the default view.
        words = headline_words(row["title"])
        key = row["url"].rstrip("/")
        if key in urls:
            continue
        if any(words == other or (min(len(words), len(other)) >= 5
                                 and SequenceMatcher(None, words, other).ratio() >= 0.85)
               for other in headlines):
            continue
        selected.append(row)
        urls.add(key)
        headlines.append(words)
        if len(selected) == DISPLAY_LIMIT:
            break
    return selected


def refresh(previous, now, fetch=fetch_feed):
    def collect(source):
        try:
            return parse_feed(fetch(SOURCES[source][0]), source, now)
        except (OSError, EOFError, ValueError, ElementTree.ParseError) as error:
            print(f"{source} RSS unavailable: {error}")
            return None

    with ThreadPoolExecutor(max_workers=len(SOURCES)) as pool:
        results = dict(zip(SOURCES, pool.map(collect, SOURCES)))
    failed = [source for source, rows in results.items() if rows is None]
    if len(failed) == len(SOURCES):
        last_success = previous["last_success_at"]
        return {**previous, "status": "stale" if last_success else "unavailable", "failed_sources": failed}

    articles = [row for rows in results.values() if rows is not None for row in rows]
    articles.extend(row for row in previous["articles"] if row["source"] in failed)
    return {
        "last_success_at": now.isoformat(),
        "status": "partial" if failed else "current",
        "failed_sources": failed,
        "articles": select_articles(articles, now),
    }


def main():
    previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
    snapshot = refresh(previous, datetime.now(timezone.utc))
    save_json(OUTPUT, snapshot)
    print(f"Notre Dame news: {snapshot['status']}, {len(snapshot['articles'])} headlines")


if __name__ == "__main__":
    main()
