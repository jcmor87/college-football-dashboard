"""Archive published Associated Press polls without replacing saved weeks."""

import json
import os
import re
from collections import Counter
from datetime import datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlsplit

from update_data import fetch

SEASON = 2026
CORE = "https://sports.core.api.espn.com"
SEASON_PATH = f"/v2/sports/football/leagues/college-football/seasons/{SEASON}"
QUERY = "lang=en&region=us"
ARCHIVE = Path(__file__).resolve().parent / "data" / "ap-rankings" / str(SEASON)
POLL = "AP Top 25"


def poll_key(ref):
    url = urlsplit(ref)
    match = re.fullmatch(f"{SEASON_PATH}/types/([123])/weeks/([1-9][0-9]*)/rankings/1", url.path)
    if url.netloc != "sports.core.api.espn.com" or not match:
        raise ValueError("Unexpected ESPN AP poll reference")
    phase, week = map(int, match.groups())
    return phase, week


def normalize_poll(payload, key, source):
    phase, week = key
    season = payload["season"]
    if (payload["type"] != "ap" or payload["name"] != POLL
            or season["year"] != SEASON or season["type"]["type"] != phase
            or payload["occurrence"]["number"] != week or poll_key(payload["$ref"]) != key):
        raise ValueError("ESPN returned a different poll or week")

    published_at = datetime.fromisoformat(payload["date"].replace("Z", "+00:00"))
    if published_at.tzinfo is None or published_at.year not in (SEASON, SEASON + 1):
        raise ValueError("Invalid AP poll date")

    ranks = {}
    for row in payload["ranks"]:
        team_ref = urlsplit(row["team"]["$ref"])
        team = re.fullmatch(f"{SEASON_PATH}/teams/([1-9][0-9]*)", team_ref.path)
        rank = row["current"]
        if (team_ref.netloc != "sports.core.api.espn.com" or not team
                or type(rank) is not int or not 1 <= rank <= 25 or team[1] in ranks):
            raise ValueError("Invalid team or rank in ESPN AP poll")
        ranks[team[1]] = rank

    # AP ties share a rank and skip the corresponding positions.
    counts = Counter(ranks.values())
    expected = 1
    for rank, count in sorted(counts.items()):
        if rank != expected:
            raise ValueError("Invalid rank sequence in ESPN AP poll")
        expected += count
    if len(ranks) < 25:
        raise ValueError("Incomplete ESPN AP poll")
    return {
        "season": SEASON, "phase": phase, "week": week, "poll": POLL,
        "label": payload["occurrence"]["displayValue"],
        "published_at": payload["date"], "source": source, "ranks": ranks,
    }


def save_json(path, data, *, immutable=False):
    content = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if path.exists() and (immutable or path.read_text(encoding="utf-8") == content):
        return
    with NamedTemporaryFile(dir=path.parent, delete=False, mode="w", encoding="utf-8") as output:
        temporary = Path(output.name)
        try:
            with output:
                output.write(content)
            if immutable:
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    pass
            else:
                os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def archive_polls(directory=ARCHIVE):
    directory.mkdir(parents=True, exist_ok=True)
    catalog = f"{CORE}{SEASON_PATH}/rankings/1?{QUERY}"
    keys = set()
    try:
        listing = fetch(catalog)
        if listing["type"] != "ap" or listing["name"] != POLL:
            raise ValueError("ESPN archive is not the AP poll")
        keys = {poll_key(entry["$ref"]) for entry in listing["rankings"]}
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"::warning::AP archive discovery unavailable: {error}")
        return

    snapshots = {}
    for path in sorted(directory.glob("phase-*-week-*.json")):
        snapshot = json.loads(path.read_text(encoding="utf-8"))
        snapshots[snapshot["phase"], snapshot["week"]] = snapshot
    for phase, week in sorted(keys - snapshots.keys()):
        source = f"{CORE}{SEASON_PATH}/types/{phase}/weeks/{week}/rankings/1?{QUERY}"
        try:
            snapshot = normalize_poll(fetch(source), (phase, week), source)
        except (OSError, ValueError, KeyError, TypeError) as error:
            print(f"::warning::AP poll unavailable for phase {phase}, week {week}: {error}")
            continue
        save_json(directory / f"phase-{phase}-week-{week}.json", snapshot, immutable=True)
        snapshots[phase, week] = snapshot

    slots = keys | snapshots.keys()
    regular = [week for phase, week in slots if phase == 2]
    # ESPN's preseason is the first chart slot. Fill holes between numbered polls.
    if regular:
        slots.update((2, week) for week in range(min(regular), max(regular) + 1))
    entries = []
    for phase, week in sorted(slots):
        snapshot = snapshots.get((phase, week))
        label = {1: "Preseason", 2: f"Week {week}", 3: f"Postseason {week}"}[phase]
        entries.append({
            "label": snapshot["label"] if snapshot else label,
            "file": f"phase-{phase}-week-{week}.json" if snapshot else None,
        })
    save_json(directory / "index.json", {"season": SEASON, "poll": POLL, "weeks": entries})
    print(f"Archived {len(snapshots)} AP polls of {len(entries)} slots")


if __name__ == "__main__":
    archive_polls()
