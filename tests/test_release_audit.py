import subprocess
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from prediction_model import final_pregame
from update_predictions import archive_revision
from verify_release import ARCHIVE, assert_append_only, verify_archive


class ArchiveAuditTests(unittest.TestCase):
    def setUp(self):
        self.start = datetime(2026, 11, 21, tzinfo=timezone.utc)
        self.kickoff = (self.start + timedelta(days=1)).isoformat()
        self.candidate = {"id": "123", "first": "1", "second": "2",
                          "input_cutoff": self.start.isoformat(), "kickoff": self.kickoff, "margin": 2}

    def test_latest_revision_must_match_verified_teams(self):
        first = {**self.candidate, "generated_at": self.start.isoformat(), "revision": "first"}
        second = {**first, "second": "3", "generated_at": (self.start + timedelta(hours=1)).isoformat(),
                  "revision": "later"}
        self.assertEqual(final_pregame([first, second], self.kickoff, ("1", "2")), first)

    def test_append_only_gate_detects_edits_and_deletion(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            def git(*args):
                subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)
            git("init", "-q")
            archive_revision(root / "data/predictions", self.candidate, lambda: self.start)
            git("add", ".")
            git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "archive")
            path = next((root / ARCHIVE).glob("*/*.json"))
            self.assertEqual(verify_archive(root), 1)
            later = self.start + timedelta(hours=1)
            archive_revision(root / "data/predictions", {**self.candidate, "margin": 4}, lambda: later)
            git("add", ".")
            assert_append_only(root, "HEAD")
            path.write_text(path.read_text().replace('"margin": 2', '"margin": 99'))
            with self.assertRaisesRegex(ValueError, "additions only"):
                assert_append_only(root, "HEAD")
            with self.assertRaisesRegex(ValueError, "Invalid pregame"):
                verify_archive(root)
            path.unlink()
            with self.assertRaisesRegex(ValueError, "additions only"):
                assert_append_only(root, "HEAD")


if __name__ == "__main__":
    unittest.main()
