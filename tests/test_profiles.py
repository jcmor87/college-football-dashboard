import json
import unittest
from pathlib import Path

from update_profiles import game_row, opponent_strength, poll_at_game, season_stats


def event(completed):
    return {
        "id": "10", "date": "2026-10-10T22:00Z",
        "competitions": [{
            "neutralSite": True,
            "status": {"type": {"completed": completed, "name": "STATUS_SCHEDULED"}},
            "competitors": [
                {"team": {"id": "87", "displayName": "Notre Dame"}, "homeAway": "home", "score": {"value": 24}},
                {"team": {"id": "61", "displayName": "Georgia"}, "homeAway": "away", "score": "0"},
            ],
        }],
    }


class ProfileTests(unittest.TestCase):
    def test_schedule_uses_team_perspective_and_excludes_pending_scores(self):
        game, _ = game_row(event(True), "61")
        self.assertEqual((game["site"], game["points"], game["allowed"], game["result"]), ("Neutral", 0, 24, "L"))
        pending, _ = game_row(event(False), "61")
        self.assertFalse(pending["final"])
        self.assertIsNone(pending["points"])
        self.assertIsNone(pending["result"])

    def test_averages_require_coverage_and_weight_third_down_attempts(self):
        completed, _ = game_row(event(True), "87")
        a = {**completed, "offense": {"yards": 400, "turnovers": 0, "third_made": 1, "third_attempts": 2}}
        b = {**completed, "offense": {"yards": 300, "third_made": 1, "third_attempts": 8}}
        pending, _ = game_row(event(False), "87")
        stats = season_stats([a, b, pending])
        self.assertEqual((stats["games"], stats["points"], stats["allowed"], stats["margin"]), (2, 24, 0, 24))
        self.assertEqual((stats["yards"], stats["third_pct"]), (350, 20))
        self.assertIsNone(stats["turnovers"])
        self.assertIsNone(season_stats([pending])["points"])

    def test_strength_reports_coverage_and_excludes_unplayed_games(self):
        completed, _ = game_row(event(True), "87")
        pending, _ = game_row(event(False), "87")
        result = opponent_strength([completed, {**completed, "opponent_id": "999"}, pending],
                                   {"61": {"W": 2, "L": 1, "T": 1}})
        self.assertEqual((result["pct"], result["covered"], result["played"]), (62.5, 1, 2))

    def test_ap_poll_requires_unambiguous_earlier_release(self):
        poll = {"published_at": "2026-10-05T07:00Z"}
        self.assertIs(poll_at_game("2026-10-06T12:00Z", [poll]), poll)
        self.assertIsNone(poll_at_game("2026-10-05T23:00Z", [poll]))
        self.assertIsNone(poll_at_game("2026-10-12T23:00Z", [poll, None]))

    def test_published_profile_ids_and_games(self):
        data = Path(__file__).resolve().parents[1] / "data"
        dashboard = json.loads((data / "dashboard.json").read_text())
        profiles = json.loads((data / "team-profiles.json").read_text())
        self.assertEqual(profiles["season"], 2026)
        if dashboard["season"] == 2026:
            self.assertEqual(set(profiles["teams"]), {str(team["id"]) for team in dashboard["teams"]})
        for profile in profiles["teams"].values():
            games = profile["games"]
            self.assertEqual(len(games), len({game["id"] for game in games}))
            self.assertEqual(profile["stats"]["games"], sum(game["final"] for game in games))


if __name__ == "__main__":
    unittest.main()
