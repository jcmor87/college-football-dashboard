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

## Merge and refresh on GitHub

1. Open the setup pull request. Review **Files changed**, then choose
   **Merge pull request** and **Confirm merge**, subject to repository rules.
2. On the repository's **Actions** tab, select **Update dashboard data**,
   choose **Run workflow**, select the default branch (`main`), and choose
   **Run workflow** again. GitHub displays the manual trigger after the
   workflow file is present on the default branch.
3. Open the new run to check the **Refresh ESPN snapshot** and **Commit
   updated snapshot** steps. The workflow commits the JSON only when its
   contents change.

GitHub schedules the workflow every three hours at minute 17 UTC. The
workflow uses the repository's built-in token with `contents: write`.
Repository rules must allow the workflow to push its snapshot commit.

If GitHub Pages publishes from a branch, commits pushed with
`GITHUB_TOKEN` do not trigger a Pages build. To publish automatic updates
to a Pages site, configure an Actions-based Pages deployment that publishes
the refreshed files as part of the workflow. The JSON is available on the
default branch after a successful push.

[GitHub documentation on running workflows manually](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow) ·
[GitHub Pages publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
