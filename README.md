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

## Notre Dame Command Center

Use **Notre Dame** in the dashboard tabs or **Open Notre Dame Command Center**
in the spotlight. Share the dashboard URL with `#notre-dame` appended.
The Command Center uses the existing 2026 ESPN team profiles and archived AP
polls. It requires no new feeds, secrets, or Pages settings.

- **AP trajectory and quality wins.** The trajectory displays Notre Dame's
  published AP ranks. A quality win is a final Notre Dame victory against an
  opponent that a verified archived poll ranked at kickoff. The current AP
  rank appears in a separate column. Missing polls or matchup data may leave
  some wins unclassified.
- **Performance.** Recent form shows up to five completed games. Scoring and
  yardage charts use final games and ESPN team box scores. Rolling averages
  require five consecutive completed games with a reported value for each.
  Missing inputs and the first four games display N/A. Changing the chart
  range does not change the rolling calculation.
- **Opponent intelligence.** The picker defaults to the next listed game
  when one is available. Comparisons use completed-game season averages
  from each team's ESPN profile. Higher scoring and offensive yardage,
  lower scoring and yardage allowed, and fewer turnovers lost are edges.
  Ties and unavailable figures receive no highlight. Common opponents are
  matched by ESPN team ID, with verified final scores shown from each
  team's perspective. Saved results may appear when the feed is stale.
- **Season outlook.** Opponent records and current AP positions come from
  the dashboard snapshot. Challenge and opportunity notes interpret
  scoring defense and offensive yardage differences. The teams may have
  played different schedules. The notes and opponent winning percentage
  offer descriptive context and do not estimate playoff or game outcomes.

To preview the feature branch, run `python3 -m http.server 8000` and open
`http://localhost:8000/#notre-dame`. Try selecting a past opponent, switching
to a rolling chart, and opening a poll in the AP trajectory. Run
`node --test tests/*.test.mjs` and `python3 -m unittest discover -s tests`
for automated checks. The pull request workflow also exercises the share
link and controls in Chromium without publishing the branch.

## Power ranking methodology

**Power Rankings** shows Saturday HQ's experimental model alongside the
official AP Top 25 and CFP selection committee poll from [ESPN](https://www.espn.com/college-football/rankings).
Each poll shows its own publication date. Neither poll enters the model.
A positive HQ-versus-poll difference means HQ ranks that team higher. Teams
must have ranks in both lists to appear in the disagreement calculation.
The existing AP history and Notre Dame Command Center remain available.
The Command Center links to the dedicated Notre Dame breakdown at `#power=87`.

### Inputs and cutoffs

The model uses ESPN final scores and third-down box scores already stored
in `data/team-profiles.json`. An FBS-vs-FBS game is counted once by ESPN
event ID. Conflicting final scores or kickoff dates exclude the event.
Conflicting third-down counts make the affected input unavailable.
Scores from available saved schedules, including stale schedules, can still
count if marked final. The snapshot reports stale and unavailable schedules.
Team membership comes from the 2026 FBS directory. Polls, live scores,
unplayed games, and non-FBS results are excluded from the model.

The daily model cutoff is 00:00 UTC. A game's kickoff must be at least 24
hours before the cutoff and its score must be a verified final. The
delay also applies to box-score statistics and opponent records. This
conservative buffer compensates for the absence of ESPN finalization
timestamps and can delay inclusion of a result by up to about two days.
History is reconstructed from the same rules at fixed weekly Tuesday
00:00 UTC cutoffs starting August 25. Earlier dates with no eligible teams
appear as gaps. After the first eligible rankings at a cutoff, that dated
file is immutable under its model version and configuration hash.
The live movement number compares to the most recent ranked archived cutoff
strictly earlier than the live cutoff. Teams need at least three admissible
FBS games for a numeric rating.

### Formulas

Let `m` be points scored minus points allowed, `c(m)` be `m` capped
to ±28, and `w(m)` be 1 for a win, 0.5 for a tie and 0 for a loss.
Opponent context excludes **all** meetings with the team being rated.
Averages count each meeting once.

| Component | Weight | Raw input |
| --- | ---: | --- |
| Strength of schedule | 30% | Mean opponent win rate, using `(sum(w) + 1) / (opponent_games + 2)` for each opponent outside head-to-head play. Two neutral pseudo-games temper small samples. |
| Opponent-adjusted margin | 30% | For each game, add the opponent's capped margin total outside head-to-head play divided by `opponent_games + 3` to the team's capped margin for that game. Divide the sum by `team_games + 3` to shrink the rating toward zero early in the season. |
| Win/loss performance | 20% | `(sum(w) + 1) / (team_games + 2)` using admissible games. |
| Net third-down efficiency | 15% | Offensive conversions divided by attempts minus opponent conversions divided by attempts. Both sides must report counts in the same games. Require at least three paired games, coverage of at least 70% of admissible games, and at least 15 attempts on each side. This is a narrow efficiency proxy. |
| Recent margin improvement | 5% | Mean capped margin over the last three admissible games minus mean capped margin over all earlier admissible games. Requires at least six games. This measures change in performance. |

For each component, round raw values to 10 decimals before comparing them.
Among eligible teams with an observed value, convert each to the empirical
midrank percentile `100 × (number below + 0.5 × number tied) / observed count`.
If a component is unavailable, use percentile 50 and display the raw value
as N/A. This keeps its contribution neutral and preserves every configured
weight. The score is the weighted sum of percentiles on a 0–100 scale.
Scores equal to six decimal places share competition rank, such as 1, 1, 3.
Team ID gives stable ordering within ties.

Weights are experimental. Schedule and adjusted margin use different
opponent measures, and recent form uses a change in margin. Results, margin,
and third downs still correlate. The weights carry no estimated confidence
intervals and are not fitted coefficients. The third-down proxy does not
cover possession efficiency, field position, or special teams.

Edit `power-model.json` to test weights or thresholds. The five weights
must sum to 100. Use a separate output directory for experiments:

```sh
python3 update_power.py --config power-model.json --cutoff 2026-11-22 --output /tmp/saturday-hq-power
python3 -m unittest discover -s tests
node --test tests/*.test.mjs
```

A cutoff date refers to UTC. To reproduce a rating exactly, also use the
same input snapshots from Git and model revision. Changing configuration
creates a separate weekly archive namespace and leaves earlier files intact.

### Backtest

For each completed Tuesday-to-Tuesday window, freeze model inputs at the
start and score subsequent FBS games in that window whose finals are
available by the report cutoff. Predictions choose the higher pregame
rating. Compare on the same eligible, non-tied games against simple prior
FBS win percentage, prior raw mean margin, and a home-team pick. Tied picks,
neutral venues, and unknown venues for the home-team baseline get half
credit. No games from within a prediction window train that window's model.

The initial report, through the November 22 UTC cutoff, covered 405 games.
Saturday HQ scored 59.5% winner accuracy, prior win percentage 62.8%, raw
margin 64.1%, and the home-team baseline 56.5%. The two performance baselines
outscored this experimental weighting. These are retrospective, single-season
point estimates. No tuning, uncertainty estimates, or out-of-season
validation were performed. The reconstruction assumes scores and box scores
were available within the configured buffer. ESPN can backfill or correct
records, and the available snapshot has no historical field-level
publication timestamps. Early games with ineligible teams are left out.

The default-branch refresh generates ratings after team profiles, commits
`data/power-rankings/`, and publishes the module and snapshots in the
existing Pages artifact. Pull requests run tests without deploying.
