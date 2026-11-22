import unittest

from update_data import scoreboard_games


def event(event_id, state, completed=False, time_valid=True):
    return {
        "id": event_id, "date": "2026-11-21T21:00Z", "week": {"number": 12},
        "competitions": [{
            "timeValid": time_valid,
            "competitors": [
                {"homeAway": "home", "team": {"id": 2, "displayName": "Home"}, "score": "0"},
                {"homeAway": "away", "team": {"id": "1", "displayName": "Away"}, "score": "7"},
            ],
            "status": {"type": {"state": state, "completed": completed, "description": state}},
        }],
    }


class ScoreboardTests(unittest.TestCase):
    def test_stable_team_ids_week_and_live_or_final_scores(self):
        scoreboard = {"events": [event("1", "pre", time_valid=False), event("2", "in"), event("3", "post", True)]}
        scheduled, live, final = scoreboard_games(scoreboard, {"1"})
        for game in (scheduled, live, final):
            self.assertEqual((game["away_id"], game["home_id"]), ("1", "2"))
            self.assertEqual((game["away"], game["home"], game["week"]), ("Away", "Home", 12))
        self.assertTrue(scheduled["time_tbd"])
        self.assertIsNone(scheduled["away_score"])
        self.assertIsNone(scheduled["home_score"])
        self.assertFalse(live["time_tbd"])
        self.assertEqual((live["away_score"], live["home_score"]), ("7", "0"))
        self.assertEqual((final["away_score"], final["home_score"]), ("7", "0"))
        self.assertEqual(scoreboard_games(scoreboard, {"99"}), [])
