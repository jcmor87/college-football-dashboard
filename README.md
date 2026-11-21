# Saturday HQ | College Football Intelligence

Saturday HQ is a static dashboard for Notre Dame, the national AP poll, FBS
teams and conferences, and the week's games. The browser loads
`data/dashboard.json` from the same site as `index.html`.

## Data sources

The updater uses three public ESPN feeds. It requires Python 3.10 or newer
and uses the standard library.

| Feed | Data |
| --- | --- |
| [FBS standings](https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=80) | FBS team membership, conference or independent status, overall records, and team links. The directory includes teams in conference divisions. |
| [College football rankings](https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings) | The AP Top 25 for the standings season, matched by ESPN team ID. The snapshot includes the poll name and publication date when available. |
| [FBS scoreboard](https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=200) | Games from ESPN's current scoreboard window involving at least one FBS team, including live and final scores when published. ESPN determines the active week and postseason window. |

Unavailable ranks, records, and scores are stored as JSON `null`. A scoreboard
with no games produces an empty list. A failed refresh exits with an error
and preserves the last saved snapshot. The `updated_at` timestamp changes
when snapshot content changes.

## Run locally

From the repository root:

```sh
python3 update_data.py
python3 -m http.server 8000
```

Open [the local dashboard](http://localhost:8000/). Serving the files over
HTTP lets the browser load the JSON snapshot.

## Publish and refresh on GitHub

1. After merging the Pages workflow changes into `main`, open **Settings →
   Pages**. Under **Build and deployment → Source**, select **GitHub Actions**.
2. Open **Actions → Update dashboard data → Run workflow**. Select `main`
   and confirm. Update and deployment jobs run only on the default branch.
3. Check that both **update** and **deploy** succeed. Open the deployment URL
   from the **deploy** job, then check the header for **Last updated**. The
   timestamp reflects when the published snapshot last changed.

GitHub schedules the workflow every three hours at minute 17 UTC. Each
successful refresh stages the HTML, dashboard JSON, and AP ranking archive
from the same run, then deploys them together. A failed refresh skips deployment so the previous site
stays online. An unchanged snapshot still deploys and keeps its existing
timestamp.

The refresh job uses `contents: write` to commit changed dashboard and AP snapshots to
`main`. Repository rules must allow that push. The deploy job uses
`pages: write` and `id-token: write` in the `github-pages` environment.
If the environment restricts deployment branches, allow `main`. Required
environment approvals, if configured, pause deployment until approved.

The workflow deploys the artifact directly because GitHub does not guarantee
a branch-based Pages build from a commit pushed with `GITHUB_TOKEN`.

[GitHub documentation on running workflows manually](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow) ·
[GitHub Pages publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## 2026 AP ranking history

Open **AP Ranking History** and use the conference filter or team search to
add up to four FBS teams. Pick a poll to highlight its chart column and table
row. On a small screen, swipe horizontally to see the rest of the chart and
table. No. 1 is at the top.

Saturday HQ archives the [AP Top 25 as published by ESPN](https://www.espn.com/college-football/rankings/_/poll/1/year/2026).
These are Associated Press results. Saturday HQ power rankings have no role
in the chart. The archive uses ESPN's poll labels and dates, including its
preseason poll and the September 8 release labeled **Week 2**. Conference
filters use the dashboard's FBS directory.

The refresh workflow discovers published 2026 polls using ESPN's
[season archive](https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/rankings/1?lang=en&region=us).
It adds validated polls under `data/ap-rankings/2026/`, using separate files
for each season phase and week. Existing poll files are kept intact. The
index is updated as polls become available. Temporary source failures leave
saved polls in place and will be retried on the next refresh. The movement
table distinguishes an unranked team from a missing poll. The chart breaks
lines at either, and movement is calculated only across consecutive available
poll slots. Previously unranked teams entering the Top 25 are marked **New entry**.

To refresh the archive locally and run the tests:

```sh
python3 update_rankings.py
python3 -m unittest discover -s tests
node --test tests/ranking-history.test.mjs
```

## Interactive team profiles

Select a team from the rankings, the filtered FBS directory, or a team column
in AP Ranking History. Share the profile URL, such as `#team=87` for Notre Dame.
Use **Team Profiles** to browse all FBS teams and compare any two.

- **Schedule and records.** ESPN's [team schedule feed](https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/87/schedule?season=2026&seasontype=2)
  supplies regular-season and published postseason games. The overall record
  comes from the dashboard's ESPN standings. Conference record is ESPN's
  most recent finished regular-season game's conference record. Independent
  teams and unpublished records show N/A. ESPN can add or move future games.
- **AP rankings.** Current ranks use the dashboard AP poll. Movement is shown
  when the latest archived AP poll matches the dashboard and the preceding
  poll is available. A completed game's opponent rank uses the latest archived
  AP poll published before that game's Eastern calendar date. Same-day
  releases and known archive gaps show N/A where kickoff order is uncertain.
  A verified poll that omits the opponent yields Unranked. Ranked results use
  these game-time ranks.
- **Performance.** Points scored, points allowed, and margin average all
  final scores from the schedule. ESPN [game box scores](https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401858438)
  provide total, rushing and net passing yards, yards allowed, and turnovers
  lost per game. Third-down percentage is total conversions divided by total
  attempts. Each season box-score statistic requires coverage for every
  completed game. A game chart shows N/A for missing data. Trends use the last
  five completed games or all completed games. National stat rankings are
  omitted because published coverage can differ between teams.
- **Opponent strength.** Sum current wins, losses and ties for FBS opponents
  already played, counting one opponent record per meeting. The percentage is
  `(wins + ties / 2) / (wins + losses + ties)`. The denominator includes
  head-to-head results and may include opponents' games against non-FBS
  schools. Missing or stale opponent schedules and non-FBS opponents are
  excluded, and coverage appears alongside the percentage. This descriptive
  figure has no official NCAA standing. Comparison highlights favorable
  scoring, yardage, turnover and conversion figures and the higher opponent
  percentage, without making a prediction.

`python3 update_profiles.py` builds `data/team-profiles.json` after the
dashboard and AP archive refresh. ESPN requests are throttled and completed
box scores are deduplicated across teams and reused on future runs. Failed
schedule fetches keep previously saved games and label them stale when
available. The browser loads the static profile file once when a profile is
opened. GitHub Pages publishes it through the existing default-branch
refresh and deploy workflow. Pull requests run validation without publishing.

To preview the feature branch, run `python3 -m http.server 8000`, open
[the local dashboard](http://localhost:8000/), and select **Team Profiles**.
Try browsing from a ranked team, reloading its shared URL, changing both
comparison teams, and switching the trend to **Full season**.

```sh
python3 -m unittest discover -s tests
node --test tests/*.test.mjs
```
