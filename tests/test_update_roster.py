import json
from pathlib import Path
import unittest

from update_roster import BIO, MEDIA_URL, ORIGIN, ROSTER_URL, latest_document, parse_depth, parse_roster, refresh

DOC = ORIGIN + "/documents/00000000-0000-0000-0000-000000000001.pdf"
OLD = "2026-11-21T12:00:00+00:00"
NOW = "2026-11-22T12:00:00+00:00"


def roster_row(number, name, position, slug=None):
    slug = slug or f"player-{number}"
    return (f'<tr><td>10</td><th><a href="/sports/football/roster/player/{slug}">{name}</a></th>'
            f'<td>{position}</td><td><button aria-controls="roster-bio-{number}"></button></td></tr>')


def roster_page(season, rows):
    return f'<h1>Football {season}-{(season + 1) % 100}</h1><table>{"".join(rows)}</table>'


def media_page(season=2026):
    return f'''<h2>{season}</h2><table>
     <tr><td>Game</td><td>Notre Dame Depth Chart</td><td>Notre Dame Notes</td></tr>
     <tr><td>Opponent A</td><td><a href="{DOC}">PDF</a></td></tr>
     <tr><td>Opponent B</td><td></td><td><a href="{DOC}">Notes</a></td></tr>
     </table>'''


class TestRoster(unittest.TestCase):
    def test_official_names_positions_ids_and_bio_links(self):
        page = roster_page(2026, [roster_row(10, 'First Player', 'QB'),
                                  roster_row(20, 'Second Player', 'CB'),
                                  roster_row(30, 'Third Player', 'P')])
        season, players = parse_roster(page)
        self.assertEqual(season, 2026)
        self.assertEqual([p["group"] for p in players.values()], ["offense", "defense", "special teams"])
        self.assertEqual(players["10"], {
            "name": "First Player", "position": "QB", "group": "offense",
            "bio_url": ORIGIN + "/sports/football/roster/player/player-10",
        })
        with self.assertRaises(ValueError):
            parse_roster(page.replace('roster-bio-20', 'roster-bio-10'))
        with self.assertRaises(ValueError):
            parse_roster(page.replace('/sports/football/roster/player/player-20',
                                      'https://untrusted.example/player'))

    def test_media_uses_depth_column_and_matches_season(self):
        self.assertEqual(latest_document(media_page(), 2026), ("Opponent A", DOC))
        self.assertIsNone(latest_document(media_page().replace(DOC, "").replace('<a href="">PDF</a>', ''), 2026))
        with self.assertRaises(ValueError):
            latest_document(media_page(), 2027)
        with self.assertRaises(ValueError):
            latest_document(media_page().replace(DOC, 'https://untrusted.example/chart.pdf'), 2026)

    def test_depth_order_and_alternatives_come_from_published_rows(self):
        _, players = parse_roster(roster_page(2026, [
            roster_row(10, "First Player", "QB"),
            roster_row(11, "Alternative", "QB"),
            roster_row(12, "Reserve", "QB"),
            roster_row(20, "Koʻo Player", "CB"),
        ]))
        lines = [f'{"NOTRE DAME OFFENSE":<42}NOTRE DAME DEFENSE',
                 f'{"Pos. No. Name":<42}Pos. No. Name',
                 f'{"QB  7 First Player 6-1 200 Jr.":<42}CB  9 Ko’o Player 6-1 200 Jr.',
                 'or  8 Alternative 6-1 200 Jr.',
                 '    6 Reserve 6-1 200 Jr.']
        lines += [f'{"QB  7 First Player 6-1 200 Jr.":<42}CB  9 Ko’o Player 6-1 200 Jr.'] * 10
        rows = parse_depth("\n".join(lines), players)
        self.assertEqual(rows["offense"][0], {"position": "QB", "tiers": [["10", "11"], ["12"]]})
        self.assertEqual(rows["defense"][0], {"position": "CB", "tiers": [["20"]]})
        with self.assertRaises(ValueError):
            parse_depth("\n".join(lines).replace('Ko’o Player', 'Unknown Player'), players)

    def test_outage_preserves_saved_data_and_rollover_drops_old_chart(self):
        rows = [roster_row(i, f"Player {i}", "QB" if i < 26 else "CB") for i in range(1, 51)]
        _, players = parse_roster(roster_page(2026, rows))
        chart = {"sides": {"offense": [{"position": "QB", "tiers": [["1"]]}]},
                 "opponent": "Opponent A", "url": DOC, "verified_at": OLD}
        previous = {"season": 2026, "players": players, "verified_at": OLD, "roster_status": "current",
                    "depth": chart, "depth_status": "current"}

        def fail(_):
            raise OSError("fixture outage")

        stale = refresh(previous, NOW, fail)
        self.assertEqual(stale, {**previous, "roster_status": "stale"})

        def download(url):
            if url == MEDIA_URL:
                raise OSError("fixture media outage")
            self.assertEqual(url, ROSTER_URL)
            return roster_page(season, rows).encode()

        season = 2026
        saved_chart = refresh(previous, NOW, download)
        self.assertEqual(saved_chart["depth"], chart)
        self.assertEqual(saved_chart["depth_status"], "stale")
        self.assertEqual(saved_chart["verified_at"], NOW)

        season = 2027
        rows = rows[1:] + [roster_row(51, "New Player", "WR")]
        updated = refresh(previous, NOW, download)
        self.assertEqual(updated["season"], 2027)
        self.assertIsNone(updated["depth"])
        self.assertEqual(updated["depth_status"], "unavailable")
        self.assertNotIn("1", updated["players"])
        self.assertIn("51", updated["players"])

    def test_checked_in_snapshot_links_and_depth_references(self):
        path = Path(__file__).resolve().parents[1] / "data/notre-dame-roster.json"
        snapshot = json.loads(path.read_text())
        for player_id, player in snapshot["players"].items():
            self.assertTrue(player_id.isdigit())
            self.assertTrue(player["bio_url"].startswith(ORIGIN))
            self.assertIsNotNone(BIO.fullmatch(player["bio_url"].removeprefix(ORIGIN)))
        if snapshot["depth"]:
            for side, rows in snapshot["depth"]["sides"].items():
                for row in rows:
                    for tier in row["tiers"]:
                        for player_id in tier:
                            self.assertEqual(snapshot["players"][player_id]["group"], side)
