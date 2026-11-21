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
