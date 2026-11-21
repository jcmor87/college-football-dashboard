"""Build the static 2026 team profiles from ESPN schedules and final box scores."""

import json
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from urllib.error import HTTPError
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from update_data import ESPN, FOOTBALL, OUTPUT, fetch
from update_rankings import ARCHIVE, SEASON, save_json

BASE = f"{ESPN}/site/v2/{FOOTBALL}"
PROFILES = OUTPUT.with_name("team-profiles.json")
ET = ZoneInfo("America/New_York")
STAT_NAMES = {
    "yards": "totalYards", "rushing": "rushingYards", "passing": "netPassingYards",
    "turnovers": "turnovers",
}
request_lock = threading.Lock()
next_request = 0.0


def request(endpoint, **params):
    """Keep ESPN requests bounded across the worker pool."""
    global next_request
    for attempt in range(3):
        with request_lock:
            now = time.monotonic()
            start = max(now, next_request)
            next_request = start + 0.25
        time.sleep(max(0, start - now))
        try:
            return fetch(f"{BASE}/{endpoint}", **params)
        except ValueError as error:
            cause = error.__cause__
            transient = isinstance(cause, HTTPError) and cause.code in (429, 500, 502, 503, 504)
            if not transient or attempt == 2:
                raise
            retry_after = cause.headers.get("Retry-After", "") if cause.headers else ""
            delay = min(30, int(retry_after)) if retry_after.isdigit() else 2 ** (attempt + 1)
            time.sleep(delay)


def integer(value):
    if isinstance(value, dict):
        value = value.get("value")
    if type(value) in (int, float) and math.isfinite(value) and int(value) == value:
        return int(value)
    if isinstance(value, str) and value.removeprefix("-").isdigit():
        return int(value)
    return None


def game_row(event, team_id):
    competition = event["competitions"][0]
    sides = {str(side["team"]["id"]): side for side in competition["competitors"]}
    if len(sides) != 2 or team_id not in sides:
        raise ValueError("Unexpected teams in schedule event")
    opponent_id = next(key for key in sides if key != team_id)
    team, opponent = sides[team_id], sides[opponent_id]
    status = competition["status"]["type"]
    points = integer(team.get("score")) if status["completed"] else None
    allowed = integer(opponent.get("score")) if status["completed"] else None
    final = points is not None and allowed is not None
    return {
        "id": str(event["id"]), "date": event["date"],
        "time_tbd": competition.get("timeValid") is False,
        "opponent_id": opponent_id, "opponent": opponent["team"]["displayName"],
        "site": "Neutral" if competition.get("neutralSite") else team["homeAway"].title(),
        "status": status.get("description") or status["name"],
        "final": final, "points": points if final else None, "allowed": allowed if final else None,
        "result": ("W" if points > allowed else "L" if points < allowed else "T") if final else None,
    }, next((row.get("displayValue") for row in team.get("record", [])
             if row.get("type") == "vsconf"), None)


def schedule(team):
    team_id = str(team["id"])
    games = {}
    conf_records = []
    school = logo = None
    for phase in (2, 3):
        payload = request(f"teams/{team_id}/schedule", season=SEASON, seasontype=phase)
        info = payload["team"]
        events = payload["events"]
        actual = payload.get("requestedSeason") or payload["season"]
        if (str(info["id"]) != team_id or actual["year"] != SEASON
                or (actual["type"] != phase and (phase == 2 or events))):
            raise ValueError("ESPN returned a different team, season, or phase")
        if phase == 2:
            school = info.get("location")
            logo = info.get("logo")
        for event in events:
            if event["season"]["year"] != SEASON:
                raise ValueError("Unexpected season in schedule event")
            game, record = game_row(event, team_id)
            games[game["id"]] = game
            if phase == 2 and game["final"] and record:
                conf_records.append((game["date"], record))
    return {
        "school": school or team["name"],
        "logo": logo if logo and urlsplit(logo).hostname == "a.espncdn.com" and logo.startswith("https://") else None,
        "conference_record": max(conf_records)[1] if conf_records and team["conference"] != "Independent" else None,
        "schedule_status": "available",
        "games": sorted(games.values(), key=lambda game: (game["date"], game["id"])),
    }


def box_stats(payload, game_id):
    header = payload["header"]
    if (str(header["id"]) != game_id or header["season"]["year"] != SEASON
            or not any(str(game["id"]) == game_id and game["status"]["type"]["completed"]
                       for game in header["competitions"])):
        raise ValueError("Unexpected ESPN box score")
    output = {}
    for side in payload.get("boxscore", {}).get("teams", []):
        columns = {stat["name"]: stat.get("displayValue") for stat in side["statistics"]}
        stats = {key: integer(columns.get(name)) for key, name in STAT_NAMES.items()}
        parts = (columns.get("thirdDownEff") or "").split("-")
        made, attempts = map(integer, parts) if len(parts) == 2 else (None, None)
        valid = made is not None and attempts is not None and 0 <= made <= attempts
        stats.update(third_made=made if valid else None, third_attempts=attempts if valid else None)
        output[str(side["team"]["id"])] = stats
    return output


def complete_stats(stats):
    return bool(stats) and all(stats.get(key) is not None
                               for key in (*STAT_NAMES, "third_made", "third_attempts"))


def season_stats(games):
    finished = [game for game in games if game["final"]]

    def average(values):
        return round(sum(values) / len(values), 1) if values and None not in values else None

    def average_stat(key, source="offense"):
        return average([game.get(source, {}).get(key) for game in finished])

    conversions = [game.get("offense", {}).get("third_made") for game in finished]
    attempts = [game.get("offense", {}).get("third_attempts") for game in finished]
    third_pct = (round(100 * sum(conversions) / sum(attempts), 1)
                 if None not in conversions + attempts and sum(attempts) else None)
    return {
        "games": len(finished),
        "points": average([game["points"] for game in finished]),
        "allowed": average([game["allowed"] for game in finished]),
        "margin": average([game["points"] - game["allowed"] for game in finished]),
        **{key: average_stat(key) for key in STAT_NAMES},
        "yards_allowed": average_stat("yards", "defense"),
        "third_pct": third_pct,
    }


def opponent_strength(games, records):
    completed = [game for game in games if game["final"]]
    eligible = [records[game["opponent_id"]] for game in completed if game["opponent_id"] in records]
    wins = sum(record["W"] for record in eligible)
    losses = sum(record["L"] for record in eligible)
    ties = sum(record["T"] for record in eligible)
    count = wins + losses + ties
    return {
        "pct": round(100 * (wins + ties / 2) / count, 1) if count else None,
        "covered": len(eligible), "played": len(completed),
        "wins": wins, "losses": losses, "ties": ties,
    }


def poll_history():
    manifest = ARCHIVE / "index.json"
    if not manifest.exists():
        return []
    return [json.loads((ARCHIVE / entry["file"]).read_text()) if entry["file"] else None
            for entry in json.loads(manifest.read_text())["weeks"]]


def eastern_date(timestamp):
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(ET).date()


def poll_at_game(timestamp, polls):
    day = eastern_date(timestamp)
    for index in range(len(polls) - 1, -1, -1):
        poll = polls[index]
        if not poll:
            continue
        published = eastern_date(poll["published_at"])
        if published == day:
            return None
        if published < day:
            # A known missing slot before the next known poll makes this date ambiguous.
            if index + 1 < len(polls) and polls[index + 1] is None:
                return None
            return poll
    return None


def build_profiles(dashboard, previous, polls):
    teams = dashboard["teams"]
    prior = previous.get("teams", {}) if previous.get("season") == SEASON else {}
    profiles = {}

    def load_schedule(team):
        team_id = str(team["id"])
        try:
            return team_id, schedule(team)
        except (ValueError, OSError, KeyError, TypeError, IndexError) as error:
            print(f"::warning::Schedule unavailable for {team_id}: {error}")
            saved = prior.get(team_id)
            if saved and saved["schedule_status"] != "unavailable":
                return team_id, {**saved, "schedule_status": "stale"}
            return team_id, {"school": team["name"], "logo": None, "conference_record": None,
                             "schedule_status": "unavailable", "games": []}

    cached = {}
    for team_id, saved in prior.items():
        for game in saved["games"]:
            for key, side_id in (("offense", team_id), ("defense", game["opponent_id"])):
                if complete_stats(game.get(key)):
                    cached.setdefault(game["id"], {})[side_id] = game[key]

    with ThreadPoolExecutor(max_workers=6) as workers:
        profiles.update(workers.map(load_schedule, teams))
        needed = {}
        for team_id, profile in profiles.items():
            for game in profile["games"]:
                if game["final"]:
                    needed.setdefault(game["id"], set()).update((team_id, game["opponent_id"]))

        def load_box(game_id):
            stats = cached.get(game_id, {})
            if needed[game_id] <= stats.keys():
                return game_id, stats
            try:
                fresh = box_stats(request("summary", event=game_id), game_id)
                return game_id, {**fresh, **stats}
            except (ValueError, OSError, KeyError, TypeError) as error:
                print(f"::warning::Box score unavailable for {game_id}: {error}")
                return game_id, stats

        boxes = dict(workers.map(load_box, sorted(needed)))

    records = {}
    for team_id, profile in profiles.items():
        if profile["schedule_status"] == "available":
            record = {result: sum(game["result"] == result for game in profile["games"]) for result in "WLT"}
            if sum(record.values()):
                records[team_id] = record

    current_ranks = {str(team["id"]): team.get("rank") for team in teams}
    latest = polls[-1] if polls else None
    preceding = polls[-2] if len(polls) > 1 else None
    for team_id, profile in profiles.items():
        profile["previous_rank"] = None
        profile["movement_available"] = bool(
            latest and preceding and latest["published_at"] == dashboard.get("poll_date")
            and latest["ranks"].get(team_id) == current_ranks[team_id]
        )
        if profile["movement_available"]:
            profile["previous_rank"] = preceding["ranks"].get(team_id)
        ranked = {"W": 0, "L": 0, "T": 0, "unverified": 0}
        for game in profile["games"]:
            opponent = game["opponent_id"]
            game["opponent_rank_now"] = current_ranks.get(opponent)
            game["current_poll_available"] = bool(dashboard.get("poll") == "AP Top 25" and opponent in current_ranks)
            poll = poll_at_game(game["date"], polls) if game["final"] else None
            game["game_poll_date"] = poll["published_at"] if poll else None
            game["opponent_rank_at_game"] = poll["ranks"].get(opponent) if poll else None
            if game["final"]:
                stats = boxes.get(game["id"], {})
                game["offense"] = stats.get(team_id, {})
                game["defense"] = stats.get(opponent, {})
                if not poll:
                    ranked["unverified"] += 1
                elif game["opponent_rank_at_game"] is not None:
                    ranked[game["result"]] += 1
        profile["stats"] = season_stats(profile["games"])
        profile["strength"] = opponent_strength(profile["games"], records)
        profile["ranked_results"] = ranked
    return {"season": SEASON, "teams": profiles}


def main():
    dashboard = json.loads(OUTPUT.read_text())
    if dashboard["season"] != SEASON:
        print(f"Team profiles are configured for {SEASON}; keeping the archived season.")
        return
    previous = json.loads(PROFILES.read_text()) if PROFILES.exists() else {}
    result = build_profiles(dashboard, previous, poll_history())
    save_json(PROFILES, result)
    counts = {status: sum(team["schedule_status"] == status for team in result["teams"].values())
              for status in ("available", "stale", "unavailable")}
    print(f"Published schedules: {counts}")


if __name__ == "__main__":
    main()
