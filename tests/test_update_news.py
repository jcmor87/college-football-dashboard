from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from unittest import TestCase
from xml.sax.saxutils import escape

from update_news import SOURCES, parse_feed, refresh, select_articles

NOW = datetime(2026, 11, 22, 16, tzinfo=timezone.utc)
OFFICIAL = "Notre Dame Athletics"
NDN = "NDNation"
CBS = "CBS Sports"
EMPTY = {"last_success_at": None, "articles": [], "status": "unavailable", "failed_sources": []}


def rss(*items):
    return "<rss><channel>" + "".join(items) + "</channel></rss>"


def entry(title, url, age=1, tags="", date=True):
    pub = format_datetime(NOW - timedelta(days=age)) if date is True else date or ""
    return (f"<item><title>{escape(title)}</title><link>{escape(url)}</link>"
            f"<pubDate>{pub}</pubDate>{tags}</item>")


def article(title, number, age, source=NDN):
    url = f"https://ndnation.com/story-{number}/"
    return {"title": title, "url": url, "source": source,
            "published_at": (NOW - timedelta(days=age)).isoformat()}


class NewsTest(TestCase):
    def test_official_feed_uses_sport_and_article_type(self):
        url = "https://fightingirish.com/news/2026/11/21/report"
        feed = rss(
            entry("Irish & Mustangs", url + "?utm_source=rss#top",
                  tags="<sports>Football</sports><type>default</type>"),
            entry("Notre Dame Football Highlights", url, tags="<sports>Football</sports><type>video</type>"),
            entry("Irish Win", url, tags="<sports>Volleyball</sports><type>default</type>"),
        )
        self.assertEqual(parse_feed(feed, OFFICIAL, NOW), [{
            "title": "Irish & Mustangs", "url": url, "source": OFFICIAL,
            "published_at": (NOW - timedelta(days=1)).isoformat(),
        }])

    def test_original_urls_and_valid_dates_required(self):
        url = "https://ndnation.com/recap/"
        tagged = "<category>Football</category>"
        feed = rss(
            entry("   ", url, tags=tagged),
            entry("Missing date", url, tags=tagged, date=False),
            entry("Invalid date", url, tags=tagged, date="yesterday"),
            entry("Future date", url, age=-1, tags=tagged),
            entry("Old date", url, age=31, tags=tagged),
            entry("Wrong site", "https://other.example/story", tags=tagged),
            entry("Wrong protocol", "javascript:alert(1)", tags=tagged),
            entry("Credentials", "https://name@ndnation.com/recap/", tags=tagged),
            entry("Basketball", url, tags="<category>Basketball</category>"),
            entry("Verified", url, tags=tagged),
        )
        self.assertEqual([row["title"] for row in parse_feed(feed, NDN, NOW)], ["Verified"])

    def test_general_feed_needs_college_football_and_notre_dame_focus(self):
        root = "https://www.cbssports.com/"
        match = "college-football/news/notre-dame-game-preview/"
        feed = rss(
            entry("Notre Dame game preview", root + match),
            entry("Notre Dame basketball", root + "college-basketball/news/notre-dame/"),
            entry("Notre Dame among FBS picks", root + "college-football/news/fbs-picks/"),
            entry("Other college football news", root + match),
        )
        self.assertEqual(len(parse_feed(feed, CBS, NOW)), 1)

    def test_deduplication_order_age_and_limit(self):
        newest = article("Notre Dame football opens spring practice today", 1, 1)
        candidates = [
            article("Beyond the age cutoff", 5, 31),
            article("Notre Dame football opens spring practice", 2, 2),
            article("Same URL under a new headline", 1, 3),
            article("Older article", 3, 18),
            newest,
        ]
        self.assertEqual([row["title"] for row in select_articles(candidates, NOW)],
                         [newest["title"], "Older article"])
        candidates.extend(article(f"Report {n}", n, 8) for n in range(20, 48))
        selected = select_articles(candidates, NOW)
        self.assertEqual(len(selected), 20)
        self.assertEqual(selected[0], newest)
        self.assertEqual({row["published_at"] for row in selected},
                         {newest["published_at"], (NOW - timedelta(days=8)).isoformat()})

    def test_full_failure_preserves_snapshot_and_partial_refresh_keeps_failed_source_rows(self):
        previous = {**EMPTY, "last_success_at": (NOW - timedelta(hours=3)).isoformat(),
                    "articles": [article("Saved headline", 1, 3)], "status": "current"}

        def fail(url):
            raise OSError("fixture outage")

        stale = refresh(previous, NOW, fail)
        self.assertEqual(stale["status"], "stale")
        self.assertEqual(stale["last_success_at"], previous["last_success_at"])
        self.assertEqual(stale["articles"], previous["articles"])
        self.assertEqual(refresh(EMPTY, NOW, fail)["status"], "unavailable")

        def recover(url):
            return rss() if url == SOURCES[OFFICIAL][0] else fail(url)

        partial = refresh(stale, NOW, recover)
        self.assertEqual(partial["status"], "partial")
        self.assertEqual(partial["failed_sources"], [NDN, CBS])
        self.assertEqual(partial["last_success_at"], NOW.isoformat())
        self.assertEqual(partial["articles"], previous["articles"])
        current_empty = refresh(partial, NOW, lambda _: rss())
        self.assertEqual(current_empty["status"], "current")
        self.assertEqual(current_empty["articles"], [])
