"""Check append-only predictions and record the hashes staged for Pages."""

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from update_power import parse_time
from update_predictions import digest
from update_rankings import save_json

ARCHIVE = "data/predictions/archive"
FILES = (
    "index.html", "featured-games.mjs", "ranking-history.mjs", "team-profiles.mjs", "nd-command.mjs",
    "notre-dame-news.mjs", "data/notre-dame-news.json",
    "notre-dame-roster.mjs", "data/notre-dame-roster.json",
    "power-rankings.mjs", "game-predictions.mjs", "data/dashboard.json", "data/team-profiles.json",
    "data/ap-rankings/2026/index.json", "data/power-rankings/latest.json",
    "data/predictions/latest.json", "playoff-model.mjs", "playoff-explorer.mjs",
    "data/cfp-title-games.json", "data/cfp-official-bracket.json",
    "playoff-simulation.mjs", "playoff-simulator-ui.mjs", "playoff-worker.mjs", "data/playoff-simulation.json",
)


def assert_append_only(root, baseline):
    result = subprocess.run(
        ["git", "diff", "--no-renames", "--name-only", "--diff-filter=DMRTUXB",
         baseline, "--", ARCHIVE], cwd=root, check=True, capture_output=True, text=True,
    )
    if result.stdout.strip():
        raise ValueError("Archive changes must be additions only:\n" + result.stdout)


def verify_archive(root):
    count = 0
    for path in (root / ARCHIVE).glob("*/*.json"):
        record = json.loads(path.read_text())
        candidate = {key: value for key, value in record.items() if key not in ("generated_at", "revision")}
        issued = parse_time(record["generated_at"])
        revision = digest(candidate)
        expected = f"{issued.strftime('%Y%m%dT%H%M%S%fZ')}-{revision}.json"
        if (not path.parent.name.isdigit() or record["id"] != path.parent.name or path.name != expected
                or record["revision"] != revision
                or not parse_time(record["input_cutoff"]) <= issued < parse_time(record["kickoff"])):
            raise ValueError(f"Invalid pregame archive record: {path.relative_to(root)}")
        count += 1
    return count


def write_manifest(root, now, archive_count):
    files = {path: (root / path).read_bytes() for path in FILES}
    dashboard = json.loads(files["data/dashboard.json"])
    profiles = json.loads(files["data/team-profiles.json"])
    power = json.loads(files["data/power-rankings/latest.json"])
    predictions = json.loads(files["data/predictions/latest.json"])
    simulator = json.loads(files["data/playoff-simulation.json"])
    if dashboard["season"] == 2026:
        ids = {str(team["id"]) for team in dashboard["teams"]}
        if (any(snapshot["season"] != dashboard["season"] for snapshot in (profiles, power, predictions))
                or ids != profiles["teams"].keys() or ids != power["teams"].keys()
                or predictions["input_cutoff"] != power["cutoff"]
                or simulator["input"]["cutoff"] != power["cutoff"]
                or simulator["input"]["predictionModel"] != predictions["model"]):
            raise ValueError("Inconsistent dashboard, profiles, power ratings, or prediction inputs")
    save_json(root / "data/refresh-status.json", {
        "checked_at": now.isoformat(), "dashboard_updated_at": dashboard["updated_at"],
        "archive_count": archive_count, "power_cutoff": power["cutoff"], "prediction_cutoff": predictions["input_cutoff"],
        "sha256": {name: hashlib.sha256(content).hexdigest() for name, content in files.items()},
    })


def verify_staged(directory):
    manifest = json.loads((directory / "data/refresh-status.json").read_text())
    for name in FILES:
        checksum = hashlib.sha256((directory / name).read_bytes()).hexdigest()
        if checksum != manifest["sha256"][name]:
            raise ValueError(f"Staged file does not match release manifest: {name}")
    if verify_archive(directory) != manifest["archive_count"]:
        raise ValueError("Staged prediction archive count does not match manifest")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", default="HEAD")
    parser.add_argument("--write-manifest", action="store_true")
    parser.add_argument("--staged", type=Path)
    args = parser.parse_args()
    if args.staged:
        verify_staged(args.staged)
        print("Verified Pages staging against the release manifest.")
        return
    root = Path(__file__).resolve().parent
    assert_append_only(root, args.baseline)
    count = verify_archive(root)
    print(f"Verified {count} append-only pregame records.")
    if args.write_manifest:
        write_manifest(root, datetime.now(timezone.utc), count)


if __name__ == "__main__":
    main()
