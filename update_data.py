"""Refresh the static FBS dashboard snapshot from ESPN."""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

ESPN = "https://site.api.espn.com/apis"
FOOTBALL = "sports/football/college-football"
STANDINGS = f"{ESPN}/v2/{FOOTBALL}/standings"
RANKINGS = f"{ESPN}/site/v2/{FOOTBALL}/rankings"
SCOREBOARD = f"{ESPN}/site/v2/{FOOTBALL}/scoreboard"
OUTPUT = Path(__file__).resolve().parent / "data" / "dashboard.json"
FBS_GROUP = "80"
POLL = "AP Top 25"
GAME_LIMIT = 200


def fetch(endpoint, **params):
    url = f"{endpoint}?{urlencode(params)}" if params else endpoint
    request = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except (OSError, ValueError) as error:
        raise ValueError(f"Could not fetch {url}: {error}") from error


def standings_entries(group):
    yield from (group.get("standings") or {}).get("entries", [])
    for division in group.get("children", []):
        yield from standings_entries(division)


def team_profile(team):
    for link in team.get("links", []):
        if "clubhouse" in link.get("rel", []):
            url = urlparse(link["href"])
            if url.scheme == "https" and url.hostname == "www.espn.com":
                return link["href"]
    return None


def fbs_directory(standings, ranks):
    if str(standings["id"]) != FBS_GROUP:
        raise ValueError("Standings feed did not return ESPN's FBS group")

    conferences = []
    teams = {}
    for group in standings["children"]:
        group_id = str(group["id"])
        name = "Independent" if group_id == "18" else group["name"]
        conferences.append({"id": group_id, "name": name})
        for entry in standings_entries(group):
            team = entry["team"]
            team_id = str(team["id"])
            if team_id in teams and teams[team_id]["conference"] != name:
                raise ValueError(f"Conflicting conference affiliations for team {team_id}")
            teams[team_id] = {
                "id": team_id,
                "name": team["displayName"],
                "abbreviation": team.get("abbreviation"),
                "conference": name,
                "record": next(
                    (stat.get("summary") for stat in entry["stats"] if stat["type"] == "total"),
                    None,
                ),
                "rank": ranks.get(team_id),
                "url": team_profile(team),
            }

    if not teams:
        raise ValueError("ESPN returned no FBS teams")
    if ranks.keys() - teams.keys():
        raise ValueError("The AP poll includes a team missing from FBS standings")
    return (
        sorted(conferences, key=lambda conference: conference["name"]),
        sorted(teams.values(), key=lambda team: team["name"]),
    )


def scoreboard_games(scoreboard, fbs_ids):
    events = scoreboard["events"]
    if len(events) >= GAME_LIMIT:
        raise ValueError("ESPN scoreboard reached the configured event limit")

    games = {}
    for event in events:
        competition = event["competitions"][0]
        sides = {side["homeAway"]: side for side in competition["competitors"]}
        away, home = sides["away"], sides["home"]
        away_id, home_id = str(away["team"]["id"]), str(home["team"]["id"])
        if not {away_id, home_id} & fbs_ids:
            continue
        status = competition.get("status") or event["status"]
        status_type = status["type"]
        has_scores = status_type["state"] == "in" or status_type["completed"]
        game_id = str(event["id"])
        games[game_id] = {
            "id": game_id,
            "date": event["date"],
            "week": (event.get("week") or {}).get("number"),
            "time_tbd": competition.get("timeValid") is False,
            "status": status_type.get("shortDetail") or status_type["description"],
            "away_id": away_id,
            "home_id": home_id,
            "away": away["team"]["displayName"],
            "home": home["team"]["displayName"],
            "away_score": away.get("score") if has_scores else None,
            "home_score": home.get("score") if has_scores else None,
        }
    return sorted(games.values(), key=lambda game: (game["date"], game["id"]))


def build_snapshot():
    standings = fetch(STANDINGS, group=FBS_GROUP)
    season = standings["season"]["year"]
    rankings = fetch(RANKINGS, season=season)
    scoreboard = fetch(SCOREBOARD, groups=FBS_GROUP, limit=GAME_LIMIT)

    if rankings["requestedSeason"]["year"] != season:
        raise ValueError("ESPN standings and rankings report different seasons")
    if scoreboard["events"] and scoreboard["season"]["year"] != season:
        raise ValueError("ESPN standings and scoreboard report different seasons")

    poll = next(
        (item for item in rankings["rankings"] if item["name"] == POLL and item["ranks"]),
        None,
    )
    ranks = {str(row["team"]["id"]): row["current"] for row in poll["ranks"]} if poll else {}
    conferences, teams = fbs_directory(standings, ranks)
    games = scoreboard_games(scoreboard, {team["id"] for team in teams})
    return {
        "status": "ok",
        "season": season,
        "week": scoreboard.get("week", {}).get("number") if games else None,
        "poll": poll["name"] if poll else None,
        "poll_date": poll.get("date") if poll else None,
        "sources": {"standings": STANDINGS, "rankings": RANKINGS, "scoreboard": SCOREBOARD},
        "conferences": conferences,
        "teams": teams,
        "games": games,
    }


def write_snapshot(path, snapshot):
    if path.exists():
        previous = json.loads(path.read_text(encoding="utf-8"))
        previous.pop("updated_at", None)
        if previous == snapshot:
            return False

    snapshot = {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **snapshot,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    file = NamedTemporaryFile(dir=path.parent, delete=False, mode="w", encoding="utf-8")
    temporary = Path(file.name)
    try:
        with file:
            json.dump(snapshot, file, indent=2, ensure_ascii=False)
            file.write("\n")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def main():
    try:
        snapshot = build_snapshot()
        changed = write_snapshot(OUTPUT, snapshot)
    except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
        print(f"Dashboard refresh failed: {error}", file=sys.stderr)
        return 1

    result = "Updated snapshot" if changed else "Snapshot already current"
    print(f"{result}: {len(snapshot['teams'])} FBS teams, {len(snapshot['games'])} games")
    return 0


if __name__ == "__main__":
    sys.exit(main())
