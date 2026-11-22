"""Publish verified ESPN conference title fixtures for the 2026 scenario explorer."""

import json

from update_data import FBS_GROUP, GAME_LIMIT, OUTPUT, SCOREBOARD, fetch
from update_profiles import integer
from update_rankings import save_json

OUTPUT_PATH = OUTPUT.with_name("cfp-title-games.json")
TITLE_DATES = ("20261204", "20261205", "20261206")
CONFERENCES = {
    "ACC": "Atlantic Coast Conference", "Big Ten": "Big Ten Conference",
    "Big 12": "Big 12 Conference", "SEC": "Southeastern Conference",
    "American": "American Conference", "Conference USA": "Conference USA",
    "MAC": "Mid-American Conference", "Mountain West": "Mountain West Conference",
    "Pac-12": "Pac-12 Conference", "Sun Belt": "Sun Belt Conference",
}


def title_games(payload, membership):
    games = {}
    if len(payload["events"]) >= GAME_LIMIT:
        raise ValueError("ESPN title-date scoreboard may be truncated")
    for event in payload["events"]:
        competition = event["competitions"][0]
        notes = [note.get("headline", "") for note in competition.get("notes", [])]
        conference = next((conference for label, conference in CONFERENCES.items()
                           if any(note.endswith(f"{label} Championship") for note in notes)), None)
        if not conference:
            continue
        teams, scores = [], {}
        for side in competition["competitors"]:
            team = str(side["team"]["id"])
            if membership.get(team) == conference:
                teams.append(team)
                scores[team] = integer(side.get("score"))
        status = event["status"]["type"]
        winner = None
        if status["completed"] and len(scores) == 2 and None not in scores.values():
            a, b = scores
            winner = a if scores[a] > scores[b] else b if scores[b] > scores[a] else None
        games[conference] = {
            "id": str(event["id"]), "date": event["date"], "teams": sorted(set(teams)),
            "status": status["description"], "winner": winner,
        }
    return games


def main():
    dashboard = json.loads(OUTPUT.read_text())
    if dashboard["season"] != 2026:
        return
    membership = {str(team["id"]): team["conference"] for team in dashboard["teams"]}
    previous = json.loads(OUTPUT_PATH.read_text()) if OUTPUT_PATH.exists() else {}
    fixtures = previous.get("games", {}).copy()
    unavailable = []
    for date in TITLE_DATES:
        try:
            fresh = title_games(fetch(SCOREBOARD, groups=FBS_GROUP, limit=GAME_LIMIT, dates=date), membership)
        except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
            print(f"::warning::ESPN title fixtures unavailable for {date}: {error}")
            unavailable.append(date)
            continue
        # A successful date supersedes its old unfinished fixtures. Preserve verified finals.
        fixtures = {key: row for key, row in fixtures.items()
                    if row.get("source_date") != date or row["winner"]}
        for key, row in fresh.items():
            if not fixtures.get(key, {}).get("winner") or row["winner"]:
                fixtures[key] = {**row, "source_date": date}
    save_json(OUTPUT_PATH, {"season": 2026, "source": SCOREBOARD,
                            "unavailable_dates": unavailable, "games": fixtures})


if __name__ == "__main__":
    main()
