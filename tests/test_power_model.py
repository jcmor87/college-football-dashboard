import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from power_model import Game, backtest, calculate, percentiles, ranking_changes, validate
from update_power import collect_games, generate

START = datetime(2026, 8, 25, tzinfo=timezone.utc)
CONFIG = json.loads((Path(__file__).resolve().parents[1] / "power-model.json").read_text())


def game(index, a="1", b="2", score=21, allowed=7, first=(4, 10), second=(2, 10)):
    return Game(str(index), START + timedelta(days=index), a, b, score, allowed, first, second, "Home")


class ModelTests(unittest.TestCase):
    def test_percentile_ties_and_missing_values(self):
        self.assertEqual(percentiles({"low": -2, "a": 3, "b": 3, "missing": None}),
                         {"low": 100 / 6, "a": 100 * 2 / 3, "b": 100 * 2 / 3, "missing": 50})
        self.assertEqual(percentiles({"x": None}), {"x": 50})

    def test_cutoff_delay_and_future_changes_cannot_affect_rating(self):
        known = [game(i) for i in range(3)]
        cutoff = START + timedelta(days=3)
        reference = calculate({"1", "2"}, known, cutoff, CONFIG)
        with_future = calculate({"2", "1"}, [game(3, score=90), game(6, a="2", b="1"), *reversed(known)],
                                cutoff, CONFIG)
        self.assertEqual(reference, with_future)
        self.assertIsNone(calculate({"1", "2"}, known, cutoff - timedelta(seconds=1), CONFIG)["1"]["rank"])

    def test_components_have_precise_meaning_and_fallback(self):
        games = [game(0, score=90), game(1), game(2, second=None)]
        result = calculate({"1", "2", "3"}, games, START + timedelta(days=5), CONFIG)
        winner = result["1"]
        components = winner["components"]
        self.assertEqual(components["schedule"]["raw"], 0.5)  # All opponent games were head-to-head.
        self.assertEqual(components["margin"]["raw"], round((28 + 14 + 14) / 6, 6))
        self.assertEqual(components["results"]["raw"], 0.8)
        self.assertEqual(components["efficiency"], {"raw": None, "percentile": 50.0, "points": 7.5})
        self.assertEqual(components["recent"]["points"], 2.5)
        self.assertAlmostEqual(sum(row["points"] for row in components.values()), winner["rating"], places=5)
        self.assertIsNone(result["3"]["rank"])

    def test_efficiency_uses_attempt_weighting_and_matched_games(self):
        games = [game(0, first=(1, 1), second=(0, 2)),
                 game(1, first=(3, 9), second=(4, 8)),
                 game(2, first=(5, 10), second=(3, 10))]
        result = calculate({"1", "2"}, games, START + timedelta(days=4), CONFIG)
        self.assertEqual(result["1"]["components"]["efficiency"]["raw"], 0.10)

    def test_ties_and_movement(self):
        games = [game(i, score=7, allowed=7, first=None, second=None) for i in range(3)]
        result = calculate({"1", "2", "3"}, games, START + timedelta(days=4), CONFIG)
        self.assertEqual([result[team]["rank"] for team in ("1", "2", "3")], [1, 1, None])
        self.assertEqual(ranking_changes(result, {"1": {"rank": 3}, "2": {"rank": None}}),
                         {"1": 2, "2": None, "3": None})

    def test_backtest_compares_same_chronological_sample(self):
        train = [game(i) for i in range(3)]
        cutoff = START + timedelta(days=4)
        states = [(cutoff, calculate({"1", "2", "3"}, train, cutoff, CONFIG)),
                  (cutoff + timedelta(days=7), {})]
        result = backtest([*train, game(5), game(6, b="3"), game(7, score=10, allowed=10)], states)
        self.assertEqual(result["games"], 1)
        self.assertEqual(result["accuracy"], {"power": 1.0, "win_pct": 1.0, "raw_margin": 1.0, "home": 1.0})

    def test_invalid_configuration_rejected(self):
        with self.assertRaises(ValueError):
            validate({**CONFIG, "weights": {**CONFIG["weights"], "results": 10}})
        with self.assertRaises(ValueError):
            validate({**CONFIG, "result_delay_hours": 1})


class PipelineTests(unittest.TestCase):
    def test_deduplicates_and_validates_reciprocal_scores(self):
        row = {"final": True, "id": "7", "date": START.isoformat(), "opponent_id": "2",
               "points": 20, "allowed": 0, "site": "Home"}
        reciprocal = {**row, "opponent_id": "1", "points": 0, "allowed": 20, "site": "Away"}
        profile = {"1": {"games": [row, {**row, "id": "8", "final": False},
                                   {**row, "id": "9", "opponent_id": "999"}]},
                   "2": {"games": [reciprocal]}}
        games, conflicts = collect_games(profile, {"1", "2"})
        self.assertEqual([(g.points, g.allowed, g.site) for g in games], [(20, 0, "Home")])
        self.assertEqual(conflicts, 0)
        reciprocal["allowed"] = 21
        self.assertEqual(collect_games(profile, {"1", "2"}), ([], 1))

    def test_weekly_snapshot_does_not_change_after_reprocessing(self):
        dashboard = {"season": 2026, "teams": [{"id": "1"}, {"id": "2"}]}
        rows = [{"final": True, "id": str(i), "opponent_id": "2",
                 "date": (START + timedelta(days=i)).isoformat(), "points": 20, "allowed": 0}
                for i in range(3)]
        profiles = {"season": 2026, "teams": {"1": {"games": rows}}}
        with TemporaryDirectory() as folder:
            archive = Path(folder)
            cutoff = START + timedelta(days=8)
            first = generate(dashboard, profiles, CONFIG, cutoff, {}, archive)
            path = archive / "2026" / first["model"] / "2026-09-01.json"
            original = path.read_bytes()
            for row in rows:
                row["points"], row["allowed"] = 0, 21
            changed = generate(dashboard, profiles, CONFIG, cutoff, {}, archive)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(changed["teams"]["1"]["movement"], -1)
            self.assertEqual(changed["history"][-1]["ranks"]["1"], 1)


if __name__ == "__main__":
    unittest.main()
