import unittest

from update_playoff import title_games


class TitleFixturesTests(unittest.TestCase):
    def test_confirms_finals_only_for_two_matching_conference_teams(self):
        acc = "Atlantic Coast Conference"
        event = {
            "id": "900", "date": "2026-12-05T17:00Z",
            "status": {"type": {"completed": True, "description": "Final"}},
            "competitions": [{
                "notes": [{"headline": "ACC Championship"}],
                "competitors": [{"team": {"id": "1"}, "score": "24"},
                                {"team": {"id": "2"}, "score": "7"}],
            }],
        }
        result = title_games({"events": [event]}, {"1": acc, "2": acc})
        self.assertEqual(result[acc]["winner"], "1")
        partial = title_games({"events": [event]}, {"1": acc})
        self.assertEqual(partial[acc]["teams"], ["1"])
        self.assertIsNone(partial[acc]["winner"])
        event["status"]["type"]["completed"] = False
        self.assertIsNone(title_games({"events": [event]}, {"1": acc, "2": acc})[acc]["winner"])
