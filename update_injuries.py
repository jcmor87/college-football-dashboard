"""Validate reviewed pregame availability reports and publish the current-season view."""

import argparse
import ipaddress
import json
import re
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from update_rankings import save_json
from update_roster import POSITIONS, name_key

ROOT = Path(__file__).resolve().parent
INPUT = ROOT / "data/injury-reports.json"
OUTPUT = ROOT / "data/injury-availability.json"
NOTRE_DAME = "87"
EASTERN = ZoneInfo("America/New_York")
VERIFICATION = {"official", "verified_reporting", "unverified"}
STATUS = {
    "out": "confirmed_out", "out for the game": "confirmed_out", "out for the season": "confirmed_out",
    "out for the year": "confirmed_out", "ruled out": "confirmed_out",
    "doubtful": "doubtful",
    "questionable": "questionable", "game time decision": "questionable",
    "probable": "probable", "expected available": "probable",
    "available": "confirmed_available", "cleared to play": "confirmed_available",
    "unknown": "unknown",
}
REQUIRED = {
    "season", "game_id", "kickoff", "team_id", "player_id", "player_name", "position",
    "source_status", "report_timestamp", "source_name", "source_url", "verification_status",
    "retrieved_at", "last_verified_at",
}


def instant(value):
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})", value,
    ):
        raise ValueError("Expected an ISO-8601 timestamp with an explicit time zone")
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def publication_range(value):
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        day = date.fromisoformat(value)
        start = datetime.combine(day, time.min, tzinfo=EASTERN)
        end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=EASTERN)
        return start.astimezone(timezone.utc), end.astimezone(timezone.utc) - timedelta(microseconds=1)
    point = instant(value)
    return point, point


def source_url(value):
    if not isinstance(value, str) or re.search(r"[\s\x00-\x1f\x7f\\]", value):
        raise ValueError("Missing or invalid public source URL")
    url = urlsplit(value)
    host = url.hostname or ""
    if (url.scheme != "https" or url.netloc != host or "." not in host or host.endswith((".local", ".internal"))
            or not re.fullmatch(r"[a-z0-9.-]+", host) or url.path in ("", "/")):
        raise ValueError("Use a public HTTPS URL for the specific report")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return value
    raise ValueError("Use a publisher domain rather than an IP address")


def identifier(value):
    return isinstance(value, str) and bool(re.fullmatch(r"[1-9]\d*", value))


def validate_report(row, now):
    if not isinstance(row, dict) or row.keys() != REQUIRED:
        raise ValueError("Missing or unexpected report fields")
    if type(row["season"]) is not int or not 2000 <= row["season"] <= 2100:
        raise ValueError("Invalid season")
    if not all(identifier(row[key]) for key in ("game_id", "team_id")):
        raise ValueError("Expected numeric game and team IDs as strings")
    if row["player_id"] is not None and not identifier(row["player_id"]):
        raise ValueError("Invalid player ID")
    for field in ("player_name", "source_name", "source_status"):
        value = row[field]
        if (not isinstance(value, str) or not value.strip() or len(value) > 120
                or any(ord(char) < 32 for char in value)):
            raise ValueError(f"Invalid {field}")
    if not name_key(row["player_name"]) or not any(char.isalpha() for char in row["player_name"]):
        raise ValueError("Invalid player name")
    position = row["position"]
    if position is not None and (not isinstance(position, str) or not re.fullmatch(r"[A-Z]{1,8}", position)):
        raise ValueError("Invalid position code")
    source_url(row["source_url"])
    verification = row["verification_status"]
    if verification not in VERIFICATION:
        raise ValueError("Invalid verification status")
    kickoff = instant(row["kickoff"])
    start, end = publication_range(row["report_timestamp"])
    retrieved = instant(row["retrieved_at"])
    checked = instant(row["last_verified_at"]) if row["last_verified_at"] is not None else None
    if not start <= retrieved <= now or (checked is not None and not retrieved <= checked <= now):
        raise ValueError("Report, retrieval and verification timestamps are out of order")
    if verification != "unverified" and checked is None:
        raise ValueError("Verified reports need last_verified_at")
    if end > kickoff:
        raise ValueError("Publication date must establish that the report was available by kickoff")
    label = " ".join(row["source_status"].casefold().replace("-", " ").split())
    status = STATUS.get(label, "unknown")
    if status == "probable" and verification != "official":
        status = "unknown"
    return {
        **row,
        "availability_status": status,
        "position_group": next((side for side, codes in POSITIONS.items() if position in codes), "other"),
    }


def eligible_games(profiles, season):
    if profiles.get("season") != season:
        raise ValueError("Notre Dame schedule season does not match the dashboard")
    nd = profiles["teams"][NOTRE_DAME]
    if nd["schedule_status"] != "available":
        raise ValueError("Current Notre Dame schedule could not be verified")
    games = {}
    for game in nd["games"]:
        if re.search(r"cancel|no contest", game["status"], re.I):
            continue
        if (not identifier(game["id"]) or not identifier(game["opponent_id"]) or game["id"] in games):
            raise ValueError("Invalid or duplicate Notre Dame schedule game")
        instant(game["date"])
        games[game["id"]] = game
    return games


def resolve_team(rows):
    by_player = defaultdict(list)
    ids_by_name = {}
    for row in rows:
        name = name_key(row["player_name"])
        if row["player_id"] is not None:
            if ids_by_name.setdefault(name, row["player_id"]) != row["player_id"]:
                raise ValueError("Conflicting player IDs for the same name and team")
    seen = set()
    for row in rows:
        name = name_key(row["player_name"])
        player = row["player_id"] or ids_by_name.get(name) or name
        start, end = publication_range(row["report_timestamp"])
        evidence_key = (player, row["source_url"], start, end)
        if evidence_key in seen:
            raise ValueError("Duplicate player status from the same report")
        seen.add(evidence_key)
        if row["verification_status"] != "unverified":
            by_player[player].append((start, end, row))

    verified = [candidate for group in by_player.values() for candidate in group]
    if not verified:
        return None

    newest_start, _, newest = max(verified, key=lambda candidate: candidate[:2])
    players = []
    for group in by_player.values():
        most_recent_start = max(start for start, _, _ in group)
        candidates = [(start, end, row) for start, end, row in group if end >= most_recent_start]
        _, latest_end, selected = max(candidates, key=lambda candidate: (
            candidate[0], candidate[2]["verification_status"] == "official", candidate[2]["source_url"],
        ))
        chosen = {**selected, "earlier_report": latest_end < newest_start}
        if len({row["availability_status"] for _, _, row in candidates}) > 1:
            chosen["availability_status"] = "unknown"
            chosen["conflicting_reports"] = [
                {key: row[key] for key in ("source_name", "source_url", "source_status", "report_timestamp")}
                for _, _, row in candidates
            ]
        players.append(chosen)
    players.sort(key=lambda row: (row["position_group"], row["player_name"].casefold()))
    return {
        "latest_report_timestamp": newest["report_timestamp"],
        "players": players,
        "confirmed_out_count": sum(
            row["availability_status"] == "confirmed_out" and not row["earlier_report"] for row in players
        ),
    }


def build_snapshot(reviewed, profiles, season, now):
    if (not isinstance(reviewed, dict) or reviewed.get("schema_version") != 1
            or not isinstance(reviewed.get("reports"), list)):
        raise ValueError("Expected injury intake schema version 1 and a reports list")
    schedule = eligible_games(profiles, season)
    grouped = defaultdict(list)
    excluded = 0
    skipped_unverified = 0
    for raw in reviewed["reports"]:
        row = validate_report(raw, now)
        game = schedule.get(row["game_id"])
        if (row["season"] != season or not game or row["team_id"] not in (NOTRE_DAME, game["opponent_id"])
                or instant(row["kickoff"]) != instant(game["date"])):
            excluded += 1
            continue
        if row["verification_status"] == "unverified":
            skipped_unverified += 1
        grouped[row["game_id"], row["team_id"]].append(row)
    result = {}
    for (game_id, team_id), rows in sorted(grouped.items()):
        resolved = resolve_team(rows)
        if resolved:
            game = schedule[game_id]
            entry = result.setdefault(game_id, {"kickoff": game["date"], "opponent_id": game["opponent_id"], "teams": {}})
            entry["teams"][team_id] = resolved
    return {
        "schema_version": 1, "season": season, "generated_at": now.isoformat(timespec="seconds"),
        "refresh_status": "current", "excluded_reports": excluded,
        "unverified_reports": skipped_unverified, "games": result,
    }


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate intake and schedule without writing data")
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    try:
        season = read(ROOT / "data/dashboard.json")["season"]
        snapshot = build_snapshot(read(INPUT), read(ROOT / "data/team-profiles.json"), season, now)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"::warning::Injury availability refresh failed: {error}")
        if not args.check:
            previous = read(OUTPUT)
            save_json(OUTPUT, {**previous, "refresh_status": "stale"})
        return 1
    if not args.check:
        save_json(OUTPUT, snapshot)
    print(f"Availability reports for {len(snapshot['games'])} matchups. "
          f"Excluded {snapshot['excluded_reports']} with season, team or kickoff mismatch and "
          f"{snapshot['unverified_reports']} unverified reports.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
