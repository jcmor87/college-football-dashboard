"""Rating-gap forecasts and chronological evaluation, without retrieval or storage."""


from datetime import datetime
from math import exp
from statistics import mean

VERSION = "1"
DEFAULT_MARGIN = {"rating_points": 0.30, "home_points": 3.0, "scale": 12.0}
BASELINES = ("home", "raw_margin")


def probability(margin, scale):
    return 1 / (1 + exp(-max(-60, min(60, margin / scale))))


def forecast(gap, venue, raw_gap, parameters):
    rating = gap * parameters["rating_points"]
    home = venue * parameters["home_points"]
    margin = round(rating + home, 3)
    chance = round(probability(margin, parameters["scale"]), 6)
    separation = max(chance, 1 - chance)
    return {
        "margin": margin, "probability": chance,
        "confidence": "high" if separation >= .75 else "moderate" if separation >= .60 else "low",
        "rating_points": round(rating, 3), "venue_points": round(home, 3),
        "baselines": {
            "home": {"margin": venue * 3, "probability": probability(venue * 3, 12)},
            "raw_margin": {"margin": raw_gap / 2 + venue * 3,
                           "probability": probability(raw_gap / 2 + venue * 3, 12)},
        },
    }


def chronological_examples(games, cutoffs, delay):
    rows = []
    for (start, teams), (end, _) in zip(cutoffs, cutoffs[1:]):
        for game in games:
            if not start <= game.kickoff < end or game.site not in ("Home", "Away", "Neutral"):
                continue
            a, b = teams.get(game.first, {}), teams.get(game.second, {})
            if a.get("rating") is None or b.get("rating") is None:
                continue
            rows.append({
                "week": start.date().isoformat(), "kickoff": game.kickoff,
                "available": game.kickoff + delay,
                "gap": a["rating"] - b["rating"],
                "raw_gap": a["baseline_margin"] - b["baseline_margin"],
                "venue": {"Home": 1, "Neutral": 0, "Away": -1}[game.site],
                "actual": game.points - game.allowed,
            })
    return rows


def outcome(margin):
    return 1 if margin > 0 else 0 if margin < 0 else 0.5


def fit_margin(training):
    # Penalize deviations from the fallback coefficients by 100 on the diagonal.
    a = sum(row["gap"] ** 2 for row in training) + 100
    b = sum(row["gap"] * row["venue"] for row in training)
    c = sum(row["venue"] ** 2 for row in training) + 100
    d = sum(row["gap"] * row["actual"] for row in training) + 30
    e = sum(row["venue"] * row["actual"] for row in training) + 300
    det = a * c - b * b
    rating = (c * d - b * e) / det
    home = (a * e - b * d) / det
    # A sign reversal would make the power-rating or venue explanation misleading.
    if rating <= 0 or home < 0:
        return None
    return {"rating_points": round(rating, 8), "home_points": round(home, 8)}


def fit(rows):
    weeks = sorted({row["week"] for row in rows})
    if len(weeks) < 5:
        held_out = [row for row in rows if weeks and row["week"] == weeks[-1]]
        return DEFAULT_MARGIN.copy(), {"status": "experimental fallback", "train": 0, "calibration": 0}, held_out
    first = weeks[max(1, len(weeks) * 3 // 5)]
    second = weeks[max(2, len(weeks) * 4 // 5)]
    training = [row for row in rows if row["week"] < first and row["available"].date().isoformat() < first]
    calibration = [row for row in rows if first <= row["week"] < second
                   and row["available"].date().isoformat() < second]
    evaluation = [row for row in rows if row["week"] >= second]
    parameters = fit_margin(training) if len(training) >= 120 else None
    sufficient = len(calibration) >= 50 and {outcome(row["actual"]) for row in calibration} >= {0, 1}
    if parameters and sufficient:
        def brier(scale):
            return mean((probability(row["gap"] * parameters["rating_points"]
                                    + row["venue"] * parameters["home_points"], scale)
                         - outcome(row["actual"])) ** 2 for row in calibration)
        parameters["scale"] = min(range(4, 41), key=brier)
        status = "chronologically calibrated · experimental"
    else:
        parameters, status = DEFAULT_MARGIN.copy(), "experimental fallback"
    return parameters, {
        "status": status, "train": len(training), "calibration": len(calibration),
        "calibration_start": first, "holdout_start": second,
    }, evaluation


def summarize(records):
    if not records:
        return {"games": 0, "accuracy": None, "mae": None, "brier": None, "calibration": []}
    wins = [float(outcome(row["actual"]) == int(row["probability"] > .5))
            if row["probability"] != .5 else .5 for row in records if row["actual"] != 0]
    bins = [[] for _ in range(5)]
    for row in records:
        bins[min(4, int(row["probability"] * 5))].append(row)
    return {
        "games": len(records), "decisive": len(wins),
        "accuracy": round(mean(wins), 4) if wins else None,
        "mae": round(mean(abs(row["margin"] - row["actual"]) for row in records), 3),
        "brier": round(mean((row["probability"] - outcome(row["actual"])) ** 2 for row in records), 5),
        "calibration": [
            {"bin": f"{i * 20}–{(i + 1) * 20}%", "games": len(values),
             "expected": round(mean(row["probability"] for row in values), 4),
             "observed": round(mean(outcome(row["actual"]) for row in values), 4)}
            for i, values in enumerate(bins) if values
        ],
    }


def performance(pairs):
    pairs = list(pairs)
    grouped = {}
    for week, prediction, actual in pairs:
        grouped.setdefault(week, []).append({**prediction, "actual": actual})
    return {
        "engine": summarize([row for rows in grouped.values() for row in rows]),
        **{model: summarize([{**pred["baselines"][model], "actual": actual}
                            for _, pred, actual in pairs]) for model in BASELINES},
        "weeks": [{"week": week, **summarize(rows)} for week, rows in sorted(grouped.items())],
    }


def final_pregame(revisions, kickoff):
    def timestamp(value):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    valid = [row for row in revisions
             if timestamp(row["input_cutoff"]) <= timestamp(row["generated_at"])
             < min(timestamp(kickoff), timestamp(row["kickoff"]))]
    return max(valid, key=lambda row: (timestamp(row["generated_at"]), row["revision"]), default=None)
