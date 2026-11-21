import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import update_rankings as archive


def source(week):
    return f"{archive.CORE}{archive.SEASON_PATH}/types/2/weeks/{week}/rankings/1?{archive.QUERY}"


def sample(week):
    return {
        "$ref": source(week), "type": "ap", "name": archive.POLL,
        "season": {"year": archive.SEASON, "type": {"type": 2}},
        "occurrence": {"number": week, "displayValue": f"Week {week}"},
        "date": "2026-09-08T07:00Z",
        "ranks": [
            {"current": rank, "team": {"$ref": f"{archive.CORE}{archive.SEASON_PATH}/teams/{rank}"}}
            for rank in range(1, 26)
        ],
    }


class ArchiveTests(unittest.TestCase):
    def test_ties_preserve_official_ranks(self):
        data = sample(2)
        data["ranks"][14]["current"] = 14
        result = archive.normalize_poll(data, (2, 2), source(2))
        self.assertEqual([result["ranks"][str(i)] for i in (14, 15, 16)], [14, 14, 16])

    def test_wrong_week_incomplete_or_duplicate_team_rejected(self):
        data = sample(2)
        with self.assertRaises(ValueError):
            archive.normalize_poll(data, (2, 3), source(3))
        data["ranks"].pop()
        with self.assertRaises(ValueError):
            archive.normalize_poll(data, (2, 2), source(2))
        data = sample(2)
        data["ranks"][1]["team"] = data["ranks"][0]["team"]
        with self.assertRaises(ValueError):
            archive.normalize_poll(data, (2, 2), source(2))

    def test_backfill_missing_week_and_preserve_existing_snapshot(self):
        listing = {"type": "ap", "name": archive.POLL,
                   "rankings": [{"$ref": source(week)} for week in (2, 4)]}
        responses = {source(2): sample(2), source(4): sample(4)}

        def fetch(url):
            return responses[url] if "/weeks/" in url else listing

        with tempfile.TemporaryDirectory() as folder, patch.object(archive, "fetch", side_effect=fetch):
            directory = Path(folder)
            archive.archive_polls(directory)
            manifest = json.loads((directory / "index.json").read_text())
            self.assertEqual(manifest["weeks"][1], {"label": "Week 3", "file": None})
            earlier = directory / "phase-2-week-2.json"
            original = earlier.read_bytes()
            responses[source(2)]["ranks"][0]["current"] = 25
            listing["rankings"].append({"$ref": source(3)})
            responses[source(3)] = sample(3)
            archive.archive_polls(directory)
            self.assertEqual(earlier.read_bytes(), original)
            self.assertTrue((directory / "phase-2-week-3.json").exists())


if __name__ == "__main__":
    unittest.main()
