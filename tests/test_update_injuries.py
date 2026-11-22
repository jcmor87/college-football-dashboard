import json
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

import update_injuries

from update_injuries import build_snapshot, resolve_team, validate_report

NOW = datetime(2026, 11, 22, 20, tzinfo=timezone.utc)
GAME_ID = "401"
KICKOFF = "2026-11-22T00:30Z"


def report(**changes):
    return {
        "season": 2026, "game_id": GAME_ID, "kickoff": KICKOFF, "team_id": "87",
        "player_name": "Example Player", "player_id": "15555", "position": "OL",
        "source_status": "Out for the Game", "report_timestamp": "2026-11-21T23:40:00Z",
        "source_name": "Example Athletics", "source_url": "https://athletics.example.com/reports/401",
        "retrieved_at": "2026-11-22T19:00:00Z", "last_verified_at": "2026-11-22T19:05:00Z",
        "verification_status": "official", **changes,
    }


def snapshot(*reports, season=2026, date=KICKOFF, schedule_status="available", status="Final"):
    profiles = {
        "season": season, "teams": {"87": {"schedule_status": schedule_status, "games": [
            {"id": GAME_ID, "date": date, "opponent_id": "2567", "status": status},
        ]}},
    }
    return build_snapshot({"schema_version": 1, "reports": list(reports)}, profiles, season, NOW)


class InjuryReports(TestCase):
    def test_schema_source_and_status_validation(self):
        row = validate_report(report(), NOW)
        self.assertEqual((row["availability_status"], row["position_group"]), ("confirmed_out", "offense"))
        for label, state in [("Doubtful", "doubtful"), ("Game-Time Decision", "questionable"),
                             ("Probable", "probable"), ("Available", "confirmed_available"), ("Maybe", "unknown")]:
            self.assertEqual(validate_report(report(source_status=label), NOW)["availability_status"], state)
        self.assertEqual(validate_report(report(
            source_status="Expected available", verification_status="verified_reporting",
        ), NOW)["availability_status"], "unknown")
        invalid = [
            report(source_url=None), report(source_url="https://foo@example.com/report"),
            report(source_url="https://localhost/report"), report(source_url="javascript:alert(1)"),
            report(last_verified_at=None), report(report_timestamp="2026-11-21T23:00"),
            report(report_timestamp="2026-11-22"),
            report(report_timestamp="2026-11-22T01:00Z"),
            report(retrieved_at="2026-11-20T00:00Z"), report(position="left tackle"),
            report(team_id=87), report(player_name="  "),
        ]
        row = report()
        del row["source_name"]
        for invalid_row in [*invalid, row]:
            with self.subTest(invalid=invalid_row), self.assertRaises(ValueError):
                validate_report(invalid_row, NOW)

    def test_newer_verified_status_wins_and_unverified_cannot_supersede(self):
        data = snapshot(
            report(report_timestamp="2026-11-16", source_status="Questionable", player_id=None),
            report(),
            report(report_timestamp="2026-11-21T23:55Z", source_status="Available",
                   verification_status="unverified", last_verified_at=None),
        )
        team = data["games"][GAME_ID]["teams"]["87"]
        self.assertEqual(len(team["players"]), 1)
        self.assertEqual(team["players"][0]["availability_status"], "confirmed_out")
        self.assertEqual(team["confirmed_out_count"], 1)
        self.assertEqual(data["unverified_reports"], 1)

    def test_conflicting_reports_do_not_count_as_confirmed_out(self):
        rows = [
            report(report_timestamp="2026-11-20"),
            report(report_timestamp="2026-11-20T19:00Z", source_status="Available",
                   source_url="https://league.example.com/report"),
        ]
        team = resolve_team([validate_report(row, NOW) for row in rows])
        self.assertEqual(team["players"][0]["availability_status"], "unknown")
        self.assertEqual(len(team["players"][0]["conflicting_reports"]), 2)
        self.assertEqual(team["confirmed_out_count"], 0)

    def test_earlier_player_reports_remain_visible_but_are_excluded_from_latest_count(self):
        data = snapshot(report(report_timestamp="2026-11-16"),
                        report(player_id="15556", player_name="A New Player", source_status="Available"))
        status = data["games"][GAME_ID]["teams"]["87"]
        self.assertEqual(status["confirmed_out_count"], 0)
        self.assertTrue(next(row for row in status["players"] if row["player_id"] == "15555")["earlier_report"])

    def test_duplicate_reports_and_conflicting_player_ids_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicate player"):
            snapshot(report(), report(player_id=None, player_name="EXAMPLE player"))
        with self.assertRaisesRegex(ValueError, "Conflicting player IDs"):
            snapshot(report(), report(player_id="15556"))

    def test_schedule_changes_filter_out_unrelated_reports_without_migrating_them(self):
        for kwargs in [{}, {"season": 2027}, {"date": "2026-11-22T01:00Z"}, {"status": "Canceled"}]:
            with self.subTest(kwargs=kwargs):
                row = report(team_id="99") if not kwargs else report()
                data = snapshot(row, **kwargs)
                self.assertEqual(data["games"], {})
                self.assertEqual(data["excluded_reports"], 1)
        self.assertEqual(snapshot(report(team_id="2567"))["games"][GAME_ID]["opponent_id"], "2567")
        with self.assertRaisesRegex(ValueError, "schedule"):
            snapshot(report(), schedule_status="stale")

    def test_empty_and_unverified_only_have_no_coverage(self):
        self.assertEqual(snapshot()["games"], {})
        self.assertEqual(snapshot(report(verification_status="unverified", last_verified_at=None))["games"], {})


    def test_failed_refresh_marks_last_valid_artifact_stale(self):
        previous = snapshot(report())
        with TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "data"
            data.mkdir()
            (data / "dashboard.json").write_text('{"season": 2026}')
            (data / "team-profiles.json").write_text('{}')
            input_path = data / "injury-reports.json"
            input_path.write_text("incomplete JSON")
            output_path = data / "injury-availability.json"
            output_path.write_text(json.dumps(previous))
            with patch.multiple(update_injuries, ROOT=root, INPUT=input_path, OUTPUT=output_path):
                with patch("sys.argv", ["update_injuries.py"]):
                    self.assertEqual(update_injuries.main(), 1)
                self.assertEqual(json.loads(output_path.read_text()), {**previous, "refresh_status": "stale"})
