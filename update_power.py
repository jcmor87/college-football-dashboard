"""Build current ratings, immutable weekly snapshots and a walk-forward report."""

import argparse
import hashlib
import json
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from power_model import VERSION, Game, backtest, calculate, ranking_changes, validate
from update_data import OUTPUT, RANKINGS, fetch
from update_profiles import PROFILES
from update_rankings import SEASON, save_json

ROOT = Path(__file__).resolve().parent
ARCHIVE = OUTPUT.with_name("power-rankings")
FIRST_CUTOFF = datetime(SEASON, 8, 25, tzinfo=timezone.utc)
POLL_NAMES = {"ap": "AP Top 25", "cfp": "Playoff Committee Rankings"}


def parse_time(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp requires a time zone")
    return parsed.astimezone(timezone.utc)


def third_down(box):
    made, attempts = box.get("third_made"), box.get("third_attempts")
    return (made, attempts) if type(made) is int and type(attempts) is int and 0 <= made <= attempts else None


def collect_games(profiles, teams):
    """Deduplicate reciprocal schedules and exclude conflicting score records."""
    candidates = defaultdict(list)
    rejected = set()
    for team in sorted(teams):
        profile = profiles.get(team, {})
        for row in profile.get("games", []):
            other = str(row.get("opponent_id"))
            if not row.get("final") or other not in teams or team == other:
                continue
            event_id = str(row["id"])
            points, allowed = row.get("points"), row.get("allowed")
            try:
                kickoff = parse_time(row["date"])
            except (TypeError, ValueError, AttributeError):
                rejected.add(event_id)
                continue
            if not all(type(score) is int and score >= 0 for score in (points, allowed)):
                rejected.add(event_id)
                continue
            offense = third_down(row.get("offense") or {})
            defense = third_down(row.get("defense") or {})
            site = row.get("site")
            if team < other:
                game = Game(event_id, kickoff, team, other, points, allowed, offense, defense, site)
            else:
                inverse = {"Home": "Away", "Away": "Home", "Neutral": "Neutral"}
                game = Game(event_id, kickoff, other, team, allowed, points, defense, offense, inverse.get(site))
            candidates[event_id].append(game)

    games = []
    for event, rows in sorted(candidates.items()):
        first = rows[0]
        identity = lambda row: (row.kickoff, row.first, row.second, row.points, row.allowed)
        if event in rejected or any(identity(row) != identity(first) for row in rows):
            rejected.add(event)
            continue

        def consensus(field):
            values = {getattr(game, field) for game in rows if getattr(game, field) is not None}
            return values.pop() if len(values) == 1 else None

        games.append(Game(event, first.kickoff, first.first, first.second, first.points, first.allowed,
                          consensus("first_downs"), consensus("second_downs"), consensus("site")))
    return sorted(games, key=lambda game: (game.kickoff, game.id)), len(rejected)


def official_polls(dashboard, as_of):
    output = {}
    try:
        source = fetch(RANKINGS, season=SEASON)
        if source["requestedSeason"]["year"] != SEASON:
            raise ValueError("ESPN returned another season")
        for key, name in POLL_NAMES.items():
            poll = next((poll for poll in source["rankings"] if poll["name"] == name and poll["ranks"]), None)
            if poll and parse_time(poll["date"]) <= as_of:
                ranks = {str(row["team"]["id"]): row["current"] for row in poll["ranks"]}
                if len(ranks) >= 25 and all(type(value) is int and 1 <= value <= 25 for value in ranks.values()):
                    output[key] = {"name": name, "date": poll["date"], "source": RANKINGS, "ranks": ranks}
    except (KeyError, ValueError, TypeError, OSError, AttributeError) as error:
        print(f"::warning::Official poll comparison feed unavailable: {error}")

    if "ap" not in output and dashboard.get("poll") == POLL_NAMES["ap"] and dashboard.get("poll_date"):
        if parse_time(dashboard["poll_date"]) <= as_of:
            output["ap"] = {"name": POLL_NAMES["ap"], "date": dashboard["poll_date"], "source": RANKINGS,
                            "ranks": {str(team["id"]): team["rank"] for team in dashboard["teams"]
                                      if team["rank"] is not None}}
    return output


def model_key(config):
    fingerprint = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:12]
    return f"v{VERSION}-{fingerprint}"


def generate(dashboard, profile_data, config, cutoff, polls, directory=ARCHIVE):
    validate(config)
    if dashboard["season"] != SEASON or profile_data["season"] != SEASON:
        raise ValueError("Power rankings require 2026 ESPN data")
    team_ids = {str(team["id"]) for team in dashboard["teams"]}
    games, rejected = collect_games(profile_data["teams"], team_ids)
    delay = timedelta(hours=config["result_delay_hours"])
    known = [game for game in games if game.kickoff + delay <= cutoff]
    key = model_key(config)
    history_dir = directory / str(SEASON) / key
    history_dir.mkdir(parents=True, exist_ok=True)
    weekly = []
    point = FIRST_CUTOFF
    while point <= cutoff:
        weekly.append((point, calculate(team_ids, known, point, config)))
        point += timedelta(days=7)

    history = []
    previous = {}
    reference = None
    for point, rows in weekly:
        path = history_dir / (point.date().isoformat() + ".json")
        saved = {
            "model": key, "season": SEASON, "cutoff": point.isoformat(),
            "teams": {team: {field: row[field] for field in ("rank", "rating", "games")}
                      for team, row in rows.items()},
        }
        # A regional outage should not permanently freeze a week with no model coverage.
        if any(row["rank"] is not None for row in rows.values()):
            save_json(path, saved, immutable=True)
        if path.exists():
            saved = json.loads(path.read_text())
        history.append({"cutoff": saved["cutoff"],
                        "ranks": {team: row["rank"] for team, row in saved["teams"].items()
                                  if row["rank"] is not None}})
        if point < cutoff and history[-1]["ranks"]:
            previous = saved["teams"]
            reference = saved["cutoff"]

    current = calculate(team_ids, known, cutoff, config)
    changes = ranking_changes(current, previous)
    for team, row in current.items():
        row["movement"] = changes[team]
    result = {
        "season": SEASON, "model": key, "config": config, "cutoff": cutoff.isoformat(),
        "eligible": sum(row["rank"] is not None for row in current.values()),
        "completed_fbs_games": len(known), "conflicting_games_excluded": rejected,
        "profile_coverage": {
            status: sum(profile_data["teams"].get(team, {}).get("schedule_status", "unavailable") == status
                        for team in team_ids)
            for status in ("available", "stale", "unavailable")
        },
        "polls": polls, "history": history, "teams": current,
        "movement_reference": reference,
        "backtest": backtest(known, weekly),
    }
    save_json(directory / "latest.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "power-model.json")
    parser.add_argument("--output", type=Path, default=ARCHIVE)
    parser.add_argument("--cutoff", type=date.fromisoformat, help="As-of UTC date (YYYY-MM-DD)")
    args = parser.parse_args()
    dashboard = json.loads(OUTPUT.read_text())
    if dashboard["season"] != SEASON:
        print(f"Power rankings are configured for {SEASON}; keeping the archive.")
        return
    profiles = json.loads(PROFILES.read_text())
    config = json.loads(args.config.read_text())
    today = datetime.now(timezone.utc).date()
    if args.cutoff and args.cutoff > today:
        parser.error("Cutoff cannot be in the future")
    cutoff = datetime.combine(args.cutoff or today, time.min, tzinfo=timezone.utc)
    result = generate(dashboard, profiles, config, cutoff, official_polls(dashboard, cutoff), args.output)
    print(f"Power model {result['model']}: {result['eligible']} eligible teams, "
          f"{result['completed_fbs_games']} admissible final games, "
          f"{result['backtest']['games']} held-out games")


if __name__ == "__main__":
    main()
