"""Refresh Notre Dame's official player directory and published game-week depth chart."""

import gzip
import io
import json
import re
import subprocess
import unicodedata
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from update_rankings import save_json

ORIGIN = "https://fightingirish.com"
ROSTER_URL = ORIGIN + "/sports/football/roster/"
MEDIA_URL = ORIGIN + "/news/2022/08/29/ndfbmedia"
BIO = re.compile(r"/sports/football/roster/player/[a-z0-9]+(?:-[a-z0-9]+)*/?")
DOCUMENT = re.compile(r"https://fightingirish\.com/documents/[a-f0-9-]{36}\.pdf")
PDF_ASSET = re.compile(r"https://storage\.googleapis\.com/fightingirish-com/[\w./-]+\.pdf", re.ASCII)
POSITIONS = {
    "offense": ("QB", "RB", "FB", "WR", "TE", "OL", "LT", "LG", "C", "RG", "RT", "OT", "OG"),
    "defense": ("DL", "DE", "DT", "NT", "EDGE", "LB", "WILL", "MIKE", "SAM", "NICKEL", "DB", "CB", "S",
                "FS", "SS", "BOUND", "FIELD"),
    "special teams": ("K", "PK", "P", "LS"),
}
DEPTH_ROW = re.compile(r"\s*(?:(or|[A-Z]+)\s+)?(\d{1,2})\s+(.+?)\s+\d-\d{1,2}\s+\d{2,3}\s+\S+\s*")
LIMIT = 5_000_000


def fetch(url):
    request = Request(url, headers={"User-Agent": "SaturdayHQRoster/1.0"})
    with urlopen(request, timeout=12) as response:
        if response.geturl().split("/")[2] not in {ORIGIN.split("/")[2], "storage.googleapis.com"}:
            raise ValueError("Unexpected publisher redirect")
        data = response.read(LIMIT + 1)
    if data.startswith(b"\x1f\x8b") and len(data) <= LIMIT:
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
            data = stream.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError("Publisher response exceeds size limit")
    return data


class Publication(HTMLParser):
    """Read server-rendered roster and media tables plus the published PDF object."""

    def __init__(self, html):
        super().__init__()
        self.title = ""
        self.heading = ""
        self.heading_tag = None
        self.tables = []
        self.table = None
        self.row = None
        self.cell = None
        self.pdfs = []
        self.feed(html)
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("h1", "h2"):
            setattr(self, "title" if tag == "h1" else "heading", "")
            self.heading_tag = tag
        elif tag == "table":
            self.table = (self.heading.strip(), [])
            self.tables.append(self.table)
        elif tag == "tr" and self.table:
            self.row = {"cells": [], "id": None}
            self.table[1].append(self.row)
        elif tag in ("td", "th") and self.row is not None:
            self.cell = {"text": "", "links": []}
            self.row["cells"].append(self.cell)
        elif tag == "a" and self.cell is not None and attrs.get("href"):
            self.cell["links"].append(attrs["href"])
        elif tag == "button" and self.row is not None:
            match = re.fullmatch(r"roster-bio-(\d+)", attrs.get("aria-controls", ""))
            if match:
                self.row["id"] = match[1]
        elif tag == "object" and attrs.get("type") == "application/pdf" and attrs.get("data"):
            self.pdfs.append(attrs["data"])

    def handle_endtag(self, tag):
        if tag == self.heading_tag:
            self.heading_tag = None
        if tag in ("td", "th", "tr", "table"):
            self.cell = None
        if tag in ("tr", "table"):
            self.row = None
        if tag == "table":
            self.table = None

    def handle_data(self, data):
        if self.heading_tag == "h1":
            self.title += data
        elif self.heading_tag == "h2":
            self.heading += data
        if self.cell is not None:
            self.cell["text"] += data


def parse_roster(html):
    page = Publication(html)
    season = re.search(r"\bFootball (20\d\d)-(\d\d)\b", page.title)
    if not season or (int(season[1]) + 1) % 100 != int(season[2]):
        raise ValueError("Official football roster season is missing")
    players = {}
    urls = set()
    for _, rows in page.tables:
        for row in rows:
            cells = row["cells"]
            if len(cells) < 3:
                continue
            links = [link for link in cells[1]["links"] if BIO.fullmatch(link)]
            if not links:
                continue  # Staff rows link to coach biographies.
            name = " ".join(cells[1]["text"].split())
            position = cells[2]["text"].strip()
            group = next((side for side, codes in POSITIONS.items() if position in codes), None)
            if (len(links) != 1 or not row["id"] or not any(char.isalpha() for char in name)
                    or len(name) > 100 or not group
                    or row["id"] in players or links[0] in urls):
                raise ValueError("Invalid or duplicate official roster entry")
            urls.add(links[0])
            players[row["id"]] = {"name": name, "position": position, "group": group,
                                  "bio_url": ORIGIN + links[0]}
    if not all(any(p["group"] == side for p in players.values()) for side in ("offense", "defense")):
        raise ValueError("Official roster is missing offensive or defensive players")
    return int(season[1]), players


def latest_document(html, season):
    for heading, rows in Publication(html).tables:
        if heading != str(season) or not rows:
            continue
        headings = [cell["text"].strip() for cell in rows[0]["cells"]]
        if headings[:2] != ["Game", "Notre Dame Depth Chart"]:
            continue
        for row in reversed(rows[1:]):
            cells = row["cells"]
            if len(cells) < 2 or not cells[1]["links"]:
                continue
            url = urljoin(ORIGIN, cells[1]["links"][0])
            label = " ".join(cells[0]["text"].split())
            if not label or not DOCUMENT.fullmatch(url):
                raise ValueError("Unsupported official depth chart link")
            return label, url
        return None
    raise ValueError("Official media table for roster season is unavailable")


def pdf_text(document, download):
    data = download(document)
    if not data.startswith(b"%PDF-"):
        urls = Publication(data.decode("utf-8")).pdfs
        if len(urls) != 1 or not PDF_ASSET.fullmatch(urls[0]) or ".." in urls[0].split("/"):
            raise ValueError("Official PDF asset not found")
        data = download(urls[0])
    if not data.startswith(b"%PDF-"):
        raise ValueError("Official document did not return a PDF")
    return subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", "-", "-"],
                          input=data, capture_output=True, check=True, timeout=15).stdout.decode("utf-8")


def name_key(name):
    return "".join(char for char in unicodedata.normalize("NFKD", name.casefold()) if char.isalnum() and char not in "ʻʼ")


def parse_depth(text, players):
    lines = text.splitlines()
    index = next(i for i, line in enumerate(lines) if "NOTRE DAME OFFENSE" in line and "NOTRE DAME DEFENSE" in line)
    headings = list(re.finditer(r"\bPos\.", lines[index + 1]))
    if len(headings) != 2:
        raise ValueError("Expected two depth chart columns")
    # Centered labels such as NICKEL can start slightly left of the Pos. heading.
    split = headings[1].start() - 3
    columns = {"offense": [], "defense": []}
    for line in lines[index + 2:]:
        if "NOTRE DAME SPECIAL TEAMS" in line:
            break
        for side, content in zip(columns, (line[:split], line[split:])):
            if content.strip():
                columns[side].append(content)

    result = {}
    for side, column in columns.items():
        by_name = {}
        for player_id, player in players.items():
            if player["group"] == side:
                by_name.setdefault(name_key(player["name"]), []).append(player_id)
        rows = []
        for line in column:
            match = DEPTH_ROW.fullmatch(line)
            if not match:
                raise ValueError("Unsupported depth chart row layout")
            position, _, name = match.groups()
            ids = by_name.get(name_key(name), [])
            if len(ids) != 1:
                raise ValueError(f"Depth chart player has no unambiguous official roster biography: {name}")
            player_id = ids[0]
            if position and position != "or":
                if position not in POSITIONS[side]:
                    raise ValueError(f"Unexpected {side} position: {position}")
                rows.append({"position": position, "tiers": [[player_id]]})
            elif not rows:
                raise ValueError("Depth chart continuation has no position")
            elif position == "or":
                rows[-1]["tiers"][-1].append(player_id)
            else:
                rows[-1]["tiers"].append([player_id])
        if not 10 <= len(rows) <= 14:
            raise ValueError(f"Incomplete {side} depth chart")
        result[side] = rows
    return result


def refresh(previous, now, download=fetch, extract=pdf_text):
    errors = (OSError, EOFError, ValueError, StopIteration, IndexError, subprocess.SubprocessError)
    try:
        season, players = parse_roster(download(ROSTER_URL).decode("utf-8"))
        if len(players) < 50 or season < (previous.get("season") or 0):
            raise ValueError("Official roster appears incomplete or older than the saved season")
    except errors as error:
        print(f"Notre Dame roster unavailable: {error}")
        return {**previous, "roster_status": "stale" if previous.get("players") else "unavailable"}

    chart = None
    status = "unavailable"
    try:
        document = latest_document(download(MEDIA_URL).decode("utf-8"), season)
        if document:
            opponent, url = document
            chart = {"opponent": opponent, "url": url, "verified_at": now,
                     "sides": parse_depth(extract(url, download), players)}
            status = "current"
    except errors as error:
        print(f"Notre Dame depth chart unavailable: {error}")
        cached = previous.get("depth")
        if cached and season == previous.get("season") and all(
            player_id in players and players[player_id]["group"] == side
            for side, rows in cached["sides"].items()
            for row in rows for tier in row["tiers"] for player_id in tier
        ):
            chart = cached
            status = "stale"

    return {"season": season, "verified_at": now, "roster_status": "current", "players": players,
            "depth_status": status, "depth": chart}


def main():
    path = Path(__file__).resolve().parent / "data/notre-dame-roster.json"
    previous = json.loads(path.read_text(encoding="utf-8"))
    snapshot = refresh(previous, datetime.now(timezone.utc).isoformat(timespec="seconds"))
    save_json(path, snapshot)
    print(f"Notre Dame roster: {len(snapshot['players'])} players, depth chart {snapshot['depth_status']}")


if __name__ == "__main__":
    main()
