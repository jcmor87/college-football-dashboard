import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from power_model import Game
from prediction_model import (DEFAULT_MARGIN, chronological_examples, final_pregame,
                              fit, forecast, probability, summarize)
from update_predictions import archive_revision, read_revisions, schedule_events

START = datetime(2026, 9, 1, tzinfo=timezone.utc)


def features(index):
    kickoff = START + timedelta(days=7 * index)
    return {"week": kickoff.date().isoformat(), "kickoff": kickoff,
            "available": kickoff + timedelta(days=1), "gap": 20, "venue": 1,
            "raw_gap": 5, "actual": 10}


class PredictionTests(unittest.TestCase):
    def test_probability_venue_and_symmetry(self):
        self.assertEqual(probability(0, 12), .5)
        self.assertAlmostEqual(probability(-20, 12) + probability(20, 12), 1)
        home = forecast(0, 1, 0, DEFAULT_MARGIN)
        neutral = forecast(0, 0, 0, DEFAULT_MARGIN)
        away = forecast(0, -1, 0, DEFAULT_MARGIN)
        self.assertEqual([home["margin"], neutral["margin"], away["margin"]], [3, 0, -3])
        self.assertAlmostEqual(home["probability"] + away["probability"], 1)
        self.assertEqual(neutral["confidence"], "low")

    def test_training_calibration_and_holdout_do_not_share_future_results(self):
        rows = [{**features(week), "actual": -7 if i % 3 == 0 else 20}
                for week in range(10) for i in range(65)]
        original = fit(rows)
        holdout_start = original[1]["holdout_start"]
        altered = [{**row, "actual": -99} if row["week"] >= holdout_start else row for row in rows]
        changed = fit(altered)
        self.assertEqual(original[:2], changed[:2])
        self.assertNotEqual(original[2], changed[2])
        self.assertEqual(original[1]["train"], 390)
        self.assertIn("calibrated", original[1]["status"])
        self.assertEqual(fit([features(0)])[0], DEFAULT_MARGIN)

    def test_examples_use_only_ratings_from_start_of_window(self):
        game = Game("1", START + timedelta(days=3), "1", "2", 7, 0, None, None, "Neutral")
        early = {"1":{"rating":60, "baseline_margin":5}, "2":{"rating":50, "baseline_margin":0}}
        later = {"1":{"rating":10}, "2":{"rating":90}}
        rows = chronological_examples([game], [(START, early), (START + timedelta(days=7), later)], timedelta(days=1))
        self.assertEqual((rows[0]["gap"], rows[0]["actual"], rows[0]["venue"]), (10, 7, 0))
        self.assertEqual(chronological_examples([game], [(START, {}), (START + timedelta(days=7), later)],
                                              timedelta(days=1)), [])

    def test_archive_keeps_revisions_and_rejects_past_or_future_cutoff(self):
        kickoff = START + timedelta(days=1)
        row = {"id":"7", "kickoff":kickoff.isoformat(), "input_cutoff":START.isoformat(), "margin":4}
        with TemporaryDirectory() as root:
            directory = Path(root)
            self.assertIsNone(archive_revision(directory, row, lambda: START - timedelta(seconds=1)))
            first = archive_revision(directory, row, lambda: START)
            self.assertEqual(archive_revision(directory, row, lambda: START + timedelta(hours=1)), first)
            second = archive_revision(directory, {**row, "margin":6}, lambda: START + timedelta(hours=2))
            self.assertIsNone(archive_revision(directory, {**row, "margin":8}, lambda: kickoff))
            archives = read_revisions(directory)["7"]
            self.assertEqual([item["margin"] for item in archives], [4, 6])
            self.assertEqual(final_pregame(archives, kickoff.isoformat()), second)
            self.assertEqual(final_pregame(archives, (START + timedelta(hours=1)).isoformat()), first)
            self.assertEqual(len(list(directory.rglob("*.json"))), 2)

    def test_accuracy_error_brier_and_calibration(self):
        result = summarize([{"probability":.8, "margin":10, "actual":7},
                            {"probability":.5, "margin":0, "actual":-3}])
        self.assertEqual((result["games"], result["accuracy"], result["mae"], result["brier"]), (2, .75, 3, .145))
        self.assertEqual(sum(row["games"] for row in result["calibration"]), 2)
        self.assertIsNone(summarize([])["accuracy"])

    def test_schedule_handles_cancellation_tbd_and_reciprocal_venues(self):
        row = {"id":"7", "opponent_id":"2", "date":START.isoformat(), "site":"Neutral",
               "status":"Scheduled", "final":False}
        profile = {"schedule_status":"available", "games":[row]}
        self.assertEqual(schedule_events({"1":profile}, {"1","2"})["7"]["venue"], 0)
        row["time_tbd"] = True
        self.assertFalse(schedule_events({"1":profile}, {"1","2"})["7"]["scheduled"])
        row.update(time_tbd=False,status="Canceled")
        self.assertFalse(schedule_events({"1":profile}, {"1","2"})["7"]["scheduled"])
        other = {"schedule_status":"available", "games":[{**row, "opponent_id":"1", "site":"Home"}]}
        self.assertEqual(schedule_events({"1":profile, "2":other}, {"1","2"}), {})


if __name__ == "__main__":
    unittest.main()
