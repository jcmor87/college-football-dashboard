"""Deterministic Saturday HQ power model. No network, clock, or poll inputs."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import groupby
from math import isfinite
from statistics import mean

COMPONENTS = ("schedule", "margin", "results", "efficiency", "recent")
VERSION = "1"


@dataclass(frozen=True)
class Game:
    id: str
    kickoff: datetime
    first: str
    second: str
    points: int
    allowed: int
    first_downs: tuple | None
    second_downs: tuple | None
    site: str


def validate(config):
    weights = config["weights"]
    if (set(weights) != set(COMPONENTS)
            or any(type(v) not in (int, float) or not isfinite(v) or v < 0 for v in weights.values())
            or sum(weights.values()) != 100):
        raise ValueError("The five nonnegative component weights must sum to 100")
    integer_keys = ("minimum_games", "margin_cap", "margin_prior_games", "record_prior_games",
                    "efficiency_minimum_games", "efficiency_minimum_attempts", "recent_games",
                    "result_delay_hours")
    if any(type(config[key]) is not int or config[key] < 1 for key in integer_keys):
        raise ValueError("Model counts, margin cap and result delay must be positive integers")
    if config["result_delay_hours"] < 24:
        raise ValueError("The result delay must be at least 24 hours")
    coverage = config["efficiency_minimum_coverage"]
    if type(coverage) not in (int, float) or not 0 < coverage <= 1:
        raise ValueError("Efficiency coverage must be between zero and one")


def percentiles(values):
    """Midrank empirical percentiles, excluding missing observations."""
    ordered = sorted((value, team) for team, value in values.items() if value is not None)
    scores = dict.fromkeys(values, 50.0)
    start = 0
    for _, group in groupby(ordered, key=lambda item: item[0]):
        ties = list(group)
        score = 100 * (start + len(ties) / 2) / len(ordered)
        scores.update((team, score) for _, team in ties)
        start += len(ties)
    return scores


def clipped(value, cap):
    return max(-cap, min(cap, value))


def win_value(margin):
    return 1 if margin > 0 else 0.5 if margin == 0 else 0


def observations(games, cutoff, delay):
    rows = defaultdict(list)
    for game in sorted(games, key=lambda item: (item.kickoff, item.id)):
        if game.kickoff + delay > cutoff:
            continue
        margin = game.points - game.allowed
        rows[game.first].append((game.second, margin, game.first_downs, game.second_downs))
        rows[game.second].append((game.first, -margin, game.second_downs, game.first_downs))
    return rows


def calculate(team_ids, games, cutoff, config):
    """Compute ratings strictly from results admissible at cutoff."""
    validate(config)
    cap = config["margin_cap"]
    margin_prior = config["margin_prior_games"]
    record_prior = config["record_prior_games"]
    recent_games = config["recent_games"]
    observed = observations(games, cutoff, timedelta(hours=config["result_delay_hours"]))
    teams = {}
    for team in sorted(team_ids):
        rows = observed[team]
        n = len(rows)
        if n < config["minimum_games"]:
            teams[team] = {"games": n, "rating": None, "rank": None}
            continue

        schedule = []
        adjusted = []
        for opponent, margin, _, _ in rows:
            other_margins = [value for rival, value, _, _ in observed[opponent] if rival != team]
            other_count = len(other_margins)
            schedule.append((sum(map(win_value, other_margins)) + record_prior / 2)
                            / (other_count + record_prior))
            opponent_margin = sum(clipped(value, cap) for value in other_margins) / (other_count + margin_prior)
            adjusted.append(clipped(margin, cap) + opponent_margin)

        # Keep offense and defense on the same game sample.
        boxes = [(offense, defense) for _, _, offense, defense in rows
                 if offense is not None and defense is not None]
        own_attempts = sum(offense[1] for offense, _ in boxes)
        opp_attempts = sum(defense[1] for _, defense in boxes)
        minimum_attempts = config["efficiency_minimum_attempts"]
        efficiency = None
        if (len(boxes) >= config["efficiency_minimum_games"]
                and len(boxes) / n >= config["efficiency_minimum_coverage"]
                and min(own_attempts, opp_attempts) >= minimum_attempts):
            efficiency = (sum(offense[0] for offense, _ in boxes) / own_attempts
                          - sum(defense[0] for _, defense in boxes) / opp_attempts)

        margins = [row[1] for row in rows]
        capped = [clipped(value, cap) for value in margins]
        recent = (mean(capped[-recent_games:]) - mean(capped[:-recent_games])
                  if n >= recent_games * 2 else None)
        teams[team] = {
            "games": n, "efficiency_games": len(boxes),
            "wins": sum(value > 0 for value in margins),
            "losses": sum(value < 0 for value in margins),
            "ties": margins.count(0),
            "raw": {
                "schedule": mean(schedule),
                "margin": sum(adjusted) / (n + margin_prior),
                "results": (sum(map(win_value, margins)) + record_prior / 2) / (n + record_prior),
                "efficiency": efficiency,
                "recent": recent,
            },
            "baseline_win_pct": mean(map(win_value, margins)),
            "baseline_margin": mean(margins),
        }

    eligible = {team: row for team, row in teams.items() if "raw" in row}
    normalized = {key: percentiles({team: round(row["raw"][key], 10)
                                    if row["raw"][key] is not None else None
                                    for team, row in eligible.items()}) for key in COMPONENTS}
    for team, row in eligible.items():
        scores = {key: normalized[key][team] for key in COMPONENTS}
        contribution = {key: scores[key] * config["weights"][key] / 100 for key in COMPONENTS}
        row["components"] = {key: {"raw": round(row["raw"][key], 6) if row["raw"][key] is not None else None,
                                   "percentile": round(scores[key], 6),
                                   "points": round(contribution[key], 6)} for key in COMPONENTS}
        row["rating"] = round(sum(contribution.values()), 6)
        del row["raw"]

    ranked = sorted(eligible, key=lambda team: (-teams[team]["rating"], team))
    previous = None
    for index, team in enumerate(ranked, 1):
        if teams[team]["rating"] != previous:
            rank = index
        teams[team]["rank"] = rank
        previous = teams[team]["rating"]
    return teams


def ranking_changes(current, previous):
    return {team: previous[team]["rank"] - row["rank"]
            if row["rank"] is not None and team in previous and previous[team]["rank"] is not None
            else None for team, row in current.items()}


def backtest(games, snapshots):
    """Weekly frozen rankings predict next window; no in-window training."""
    models = ("power", "win_pct", "raw_margin", "home")
    correct = dict.fromkeys(models, 0.0)
    sample = 0
    weeks = []
    for (start, training), (end, _) in zip(snapshots, snapshots[1:]):
        count = 0
        for game in games:
            if not start <= game.kickoff < end or game.points == game.allowed:
                continue
            first, second = training.get(game.first, {}), training.get(game.second, {})
            if first.get("rank") is None or second.get("rank") is None:
                continue
            outcome = 1 if game.points > game.allowed else -1
            predictions = {
                "power": first["rating"] - second["rating"],
                "win_pct": first["baseline_win_pct"] - second["baseline_win_pct"],
                "raw_margin": first["baseline_margin"] - second["baseline_margin"],
                "home": 1 if game.site == "Home" else -1 if game.site == "Away" else 0,
            }
            for model, prediction in predictions.items():
                correct[model] += 0.5 if prediction == 0 else float(prediction * outcome > 0)
            count += 1
        weeks.append({"from": start.isoformat(), "until": end.isoformat(), "games": count})
        sample += count
    return {"games": sample, "accuracy": {key: round(value / sample, 4) if sample else None
                                          for key, value in correct.items()}, "weeks": weeks}
