"""Generate the public prediction view and append pregame forecasts when enabled."""

import argparse
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from power_model import calculate
from prediction_model import VERSION, chronological_examples, final_pregame, fit, forecast, performance
from update_data import OUTPUT
from update_power import ARCHIVE as POWER, FIRST_CUTOFF, collect_games, model_key, parse_time
from update_profiles import PROFILES
from update_rankings import save_json

ARCHIVE = OUTPUT.with_name("predictions")
SEASON = 2026
SITES = {"Home": 1, "Away": -1, "Neutral": 0}


def week_of(kickoff):
    day = kickoff.date()
    return (day - timedelta(days=(day.weekday() - 1) % 7)).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:16]


def schedule_events(profiles, ids):
    candidates = defaultdict(list)
    for team in sorted(ids):
        profile = profiles.get(team, {})
        if profile.get("schedule_status") != "available":
            continue
        for row in profile["games"]:
            opponent = str(row.get("opponent_id"))
            if opponent not in ids or team == opponent or row.get("site") not in SITES:
                continue
            game_id = str(row["id"])
            if not game_id.isdigit():
                continue
            first, second = sorted((team, opponent))
            candidates[game_id].append((
                first, second, parse_time(row["date"]), SITES[row["site"]] * (1 if team == first else -1),
                bool(row.get("time_tbd")), row["status"], bool(row["final"]),
            ))
    events = {}
    for game_id, rows in candidates.items():
        sample = rows[0]
        if any(row[:5] != sample[:5] for row in rows):
            continue
        first, second, kickoff, venue, tbd, status, _ = sample
        scheduled = all(row[5] == "Scheduled" and not row[6] for row in rows)
        events[game_id] = {"id": game_id, "first": first, "second": second, "kickoff": kickoff,
                           "venue": venue, "scheduled": scheduled and not tbd,
                           "status": status if all(row[5] == status for row in rows) else "Status unavailable"}
    return events


def archive_revision(directory, candidate, clock):
    # Read the clock immediately before an append. A forecast built after kickoff cannot be saved.
    issued = clock().astimezone(timezone.utc)
    kickoff = parse_time(candidate["kickoff"])
    cutoff = parse_time(candidate["input_cutoff"])
    if not cutoff <= issued < kickoff:
        return None
    folder = directory / "archive" / candidate["id"]
    folder.mkdir(parents=True, exist_ok=True)
    revision = digest(candidate)
    old = sorted(folder.glob("*.json"))
    if old and json.loads(old[-1].read_text())["revision"] == revision:
        return json.loads(old[-1].read_text())
    row = {**candidate, "generated_at": issued.isoformat(), "revision": revision}
    path = folder / f"{issued.strftime('%Y%m%dT%H%M%S%fZ')}-{revision}.json"
    save_json(path, row, immutable=True)
    return row


def read_revisions(directory):
    grouped = defaultdict(list)
    for path in sorted((directory / "archive").glob("*/*.json")):
        record = json.loads(path.read_text())
        grouped[record["id"]].append(record)
    return grouped


def generate(dashboard, profiles, power, output, clock, archive_live=False):
    if any(snapshot["season"] != SEASON for snapshot in (dashboard, profiles, power)):
        raise ValueError("Prediction inputs must use the same 2026 season")
    now = clock().astimezone(timezone.utc)
    cutoff = parse_time(power["cutoff"])
    if cutoff > now or power["model"] != model_key(power["config"]):
        raise ValueError("Power snapshot has a future cutoff or unexpected model fingerprint")
    ids = {str(team["id"]) for team in dashboard["teams"]}
    data, _ = collect_games(profiles["teams"], ids)
    delay = timedelta(hours=power["config"]["result_delay_hours"])
    known = [game for game in data if game.kickoff + delay <= cutoff]
    weekly = []
    point = FIRST_CUTOFF
    while point <= cutoff:
        weekly.append((point, calculate(ids, known, point, power["config"])))
        point += timedelta(days=7)
    examples = chronological_examples(known, weekly, delay)
    parameters, fitting, held_out = fit(examples)
    model = "prediction-v" + VERSION + "-" + digest([power["model"], parameters, fitting])
    upcoming = schedule_events(profiles["teams"], ids)
    archived = read_revisions(output)
    previews = {}
    age_ok = now - cutoff <= timedelta(hours=48)
    for game_id, event in upcoming.items():
        if not event["scheduled"] or event["kickoff"] <= now or not age_ok:
            continue
        first, second = event["first"], event["second"]
        a, b = power["teams"].get(first, {}), power["teams"].get(second, {})
        if a.get("rating") is None or b.get("rating") is None:
            continue
        gap = a["rating"] - b["rating"]
        row = {
            "id": game_id, "first": first, "second": second, "kickoff": event["kickoff"].isoformat(),
            "input_cutoff": cutoff.isoformat(), "model": model, "power_model": power["model"],
            "parameters": parameters, "rating_first": a["rating"], "rating_second": b["rating"],
            "venue": event["venue"],
            **forecast(gap, event["venue"], a["baseline_margin"] - b["baseline_margin"], parameters),
        }
        if archive_live:
            saved = archive_revision(output, row, clock)
            if saved and saved not in archived[game_id]:
                archived[game_id].append(saved)
        else:
            previews[game_id] = row

    final_by_id = {game.id: game for game in data if game.kickoff < now}
    rows, evaluated = [], []
    for game_id in sorted(set(upcoming) | set(archived) | final_by_id.keys()):
        event, final = upcoming.get(game_id), final_by_id.get(game_id)
        revisions = archived.get(game_id, [])
        if not final and not revisions and (not event or not event["scheduled"] or event["kickoff"] <= now):
            continue
        # Completed historical games without an actual archive belong only to the backtest.
        if final and not revisions:
            continue
        if not final and not event:
            last = revisions[-1]
            event = {**last, "kickoff": parse_time(last["kickoff"]), "status": "Schedule unavailable"}
        kickoff = final.kickoff if final else event["kickoff"]
        matchup = (final.first, final.second) if final else (event["first"], event["second"])
        selected = final_pregame(revisions, kickoff.isoformat(), matchup)
        actual = {"first": final.points, "second": final.allowed} if final else None
        if selected and final:
            evaluated.append((week_of(kickoff), selected, final.points - final.allowed))
        rows.append({
            "id": game_id, "kickoff": kickoff.isoformat(), "week": week_of(kickoff),
            "first": final.first if final else event["first"], "second": final.second if final else event["second"],
            "venue": (SITES.get(final.site) if final else event["venue"]),
            "status": "Final" if final else event["status"], "actual": actual,
            "prediction": selected or previews.get(game_id), "revisions": len(revisions),
            "is_preview": selected is None and game_id in previews,
            "history": [{
                "at": revision["generated_at"], "model": revision["model"], "id": revision["revision"],
                "margin": revision["margin"], "probability": revision["probability"],
                "selected": revision is selected,
            } for revision in revisions],
        })
    result = {
        "season": SEASON, "input_cutoff": cutoff.isoformat(), "model": model, "parameters": parameters,
        "fitting": fitting, "rows": sorted(rows, key=lambda row: (row["kickoff"], row["id"])),
        "live": performance(evaluated),
        "backtest": performance((row["week"], forecast(row["gap"], row["venue"], row["raw_gap"], parameters),
                                 row["actual"]) for row in held_out),
    }
    output.mkdir(parents=True, exist_ok=True)
    save_json(output / "latest.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ARCHIVE)
    parser.add_argument("--archive-live", action="store_true", help="Append genuine operational pregame forecasts")
    args = parser.parse_args()
    dashboard = json.loads(OUTPUT.read_text())
    if dashboard["season"] != SEASON:
        print("Prediction model is configured for 2026; preserving existing data.")
        return
    result = generate(dashboard, json.loads(PROFILES.read_text()), json.loads((POWER / "latest.json").read_text()),
                      args.output, lambda: datetime.now(timezone.utc), args.archive_live)
    print(f"Prediction data: {len(result['rows'])} games; "
          f"{result['live']['engine']['games']} verified live outcomes; "
          f"{result['backtest']['engine']['games']} held-out historical games")


if __name__ == "__main__":
    main()
