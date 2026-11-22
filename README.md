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
polls. It requires no secrets or additional Pages settings.

- **Notre Dame in the News.** The existing three-hour GitHub Actions refresh
  runs `python update_news.py` and publishes `data/notre-dame-news.json`.
  The Command Center reads this snapshot and shows the five newest headlines
  first, with up to 20 under **Show More**. Dates come from publisher RSS
  timestamps and display in the viewer's time zone. Links go directly to the
  publisher, where its normal access rules apply.

  [Notre Dame Athletics RSS](https://fightingirish.com/rss) supplies articles
  tagged Football, with video entries excluded.
  [NDNation RSS](https://ndnation.com/feed/) supplies posts in its Football
  category. [CBS Sports RSS](https://www.cbssports.com/rss/headlines/college-football/)
  is a general college football feed. Only CBS entries naming Notre Dame or the
  Fighting Irish in both the headline and article URL qualify. That narrow filter
  can omit relevant coverage. ESPN's college football RSS returned the same
  timestamp for distinct stories, and automated access to the news API could
  not be verified. On3 and South Bend Tribune did not yield accessible,
  verified football news feeds.

  The collector removes duplicate publisher URLs and near-identical headlines.
  Separate reporting on the same game can appear from multiple publishers.
  It prefers the most recent 14 days and looks back up to 30 days only to fill
  the first five entries. A source outage can leave saved headlines alongside
  current entries. If all feeds fail, the last successful snapshot is retained
  and marked stale. A snapshot older than nine hours also shows a stale
  indicator. News errors do not stop the other dashboard updates.
- **Notre Dame Roster & Depth Chart.** The three-hour refresh reads the
  public football roster and the latest published game-week chart listed in
  the matching season's media table. The roster supplies player IDs, position
  groups, and individual biography links. The official chart supplies the order
  within each position, including alternatives marked “or.” The chart is
  labeled by opponent and can differ from the eventual game-day lineup.
  Open **Offense** or **Defense** for the chart and full position-group roster.
  [Official roster](https://fightingirish.com/sports/football/roster/) ·
  [Official football media information](https://fightingirish.com/news/2022/08/29/ndfbmedia)

  Run `python update_roster.py` to refresh `data/notre-dame-roster.json`.
  The updater uses `pdftotext` from Poppler to read the public chart PDF.
  It preserves saved roster data on an outage and can keep a same-season
  chart if all player references still match. A missing or unsupported chart
  leaves the verified roster grouped by position. The updater drops
  prior-season charts when the roster rolls over. The Command Center shows
  verification dates and labels saved data during failures or when the last
  roster verification is more than 12 hours old.
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

## Game prediction methodology

Open **Game Predictions** or use `#predictions`. Week filters use
Tuesday-to-Tuesday UTC windows. Conference and team filters match the same team
in a matchup. The Notre Dame Command Center shows the forecast for the selected
upcoming opponent beside its existing statistical comparison.

The model uses the frozen Saturday HQ rating difference `R_A - R_B` and
venue indicator `V` (+1 when team A is home, −1 when team B is home, and
0 at a verified neutral site). A is the first team in stable ESPN ID order.

- Expected margin for A is `M = b × (R_A - R_B) + h × V`, in points.
  The venue contribution and rating contribution are displayed separately.
- The probability that A wins is `1 / (1 + exp(-M / T))`. The higher
  probability selects the winner. An exact 50% is an even matchup.
  Confidence labels follow favorite probability: low below 60%, moderate
  from 60% to below 75%, and high at 75% or above. These labels describe
  estimate size and provide no statistical confidence interval.
- The experimental fallback is `b=0.30, h=3, T=12`. When coverage permits,
  weighted schedule and third-down features enter through the existing rating.
  The margin fit uses least squares with a penalty of 100 on each squared
  coefficient deviation from the fallback. A nonpositive rating slope or a
  negative home coefficient triggers the fallback.
- Historical rows use the power model's rating computed at the start of each
  completed weekly window and the existing result-admission delay. The first
  roughly 60% of weeks fit the margin, the next roughly 20% select the
  integer logistic scale from 4–40 by minimum Brier score, and the final
  weeks form the holdout. A label must pass the result buffer before the
  next partition's UTC date. The fit requires at least five usable weeks,
  120 margin-training games, and 50 calibration games with both outcomes
  represented. With fewer than five usable weeks, the fixed fallback is
  evaluated on the latest usable window if available.

### Live forecast archive

`python3 update_predictions.py` regenerates previews. The default-branch
workflow runs it with `--archive-live` after recomputing power ratings.
Only genuinely issued operational forecasts are scored as live. A forecast
requires two eligible FBS teams, a current verified schedule and venue, a
known future kickoff, and a power cutoff no more than 48 hours old.
TBD, canceled, conflicting, and already-started games receive no new forecast.

Each revision is written once beneath `data/predictions/archive/<game-id>/`
with the known kickoff, issue timestamp, input cutoff, model and parameters,
signed margin, probability and both baseline forecasts. Identical consecutive
inputs produce no duplicate archive. Changes before kickoff append a new file.
After a final is verified, grading selects the newest timestamp strictly
earlier than both its archived and currently reported kickoff. Missing,
canceled and unverified games remain outside evaluation. A reschedule can
exclude a revision that was issued after the corrected kickoff.
The JSON index is rebuilt independently, leaving all archived files intact.

### Evaluation

The accuracy dashboard separates historical holdout results from operational
live forecasts. It reports sample sizes, winner accuracy, mean absolute
margin error, Brier score, weekly accuracy, and mean forecast versus observed
outcome in five 20-point calibration bins. Tied picks receive half credit on
decisive games. Tied finals are excluded from winner accuracy and use a 0.5
outcome for Brier and calibration. The home-only baseline uses `3 × V`.
The raw-margin baseline uses half the difference in mean FBS scoring margin
plus `3 × V`. Both convert margin using a fixed scale of 12. All models in a
sample score the same games.

The initial holdout covered 129 games. Winner accuracy was 62.0% for the
engine, 60.5% for raw margin, and 49.2% for home field. Margin MAE was
13.93, 14.07, and 15.40 points respectively. Brier scores were 0.22174,
0.22151, and 0.25480 respectively. The engine's Brier score was slightly
worse than raw margin. These mixed results from a single season and a small
holdout provide no evidence of sustained superiority.

The retrospective split can change as more weeks become available, and ESPN
can correct historical fields after publication. The replay uses the same
game-time cutoff safeguards as the power model without claiming point-in-time
field availability. Live results may combine archived model versions.
Timestamped files record issuance on the runner, with deployment potentially
following later. Small calibration bins are descriptive. Neither poll ranks
nor betting lines enter the engine.

For a local preview, start `python3 -m http.server 8000` and open the
Game Predictions tab. Run `python3 -m unittest discover -s tests` and
`node --test tests/*.test.mjs` for automated checks. The pull request workflow
regenerates previews in a temporary directory without writing live revisions
or deploying Pages.

## Version 2.0 quality audit

See the [audit report](AUDIT.md) for reproduced backtests, paired uncertainty
checks, verified Pages evidence, and priorities before the Playoff Simulator.
The release workflow enforces an append-only forecast archive and publishes
`data/refresh-status.json` with a check timestamp and core snapshot hashes.
The header keeps its last-changed timestamp separate from the refresh check.

## 2026–27 Playoff Scenario Explorer

Open **Playoff Explorer** or use `#playoff`. The Notre Dame Command Center
also has a compact outcome picker that deep-links to the full explorer with
its selections. Choose winners for remaining games and conference titles,
then advance teams through the bracket. Reset clears picks. Copy the URL to
share the selected results. Picks are checked against the current data when
a link opens. A completed game or a changed matchup can invalidate an
older choice.

### Official selection and bracket rules

The CFP's [2026–27 format](https://collegefootballplayoff.com/sports/2024/5/29/12-team-format)
and [selection protocol](https://collegefootballplayoff.com/sports/2016/10/24/selection-committee-protocol)
govern this explorer. The ACC, Big Ten, Big 12, and SEC champions receive
automatic entry. The highest-ranked team among the American, Conference USA,
MAC, Mountain West, Pac-12, and Sun Belt receives a berth. That team can be
a nonchampion. The committee identifies the highest team in that group if
none appears in its Top 25. Seven places go to the best remaining teams,
or six when Notre Dame earns its guaranteed berth by finishing in the final
CFP Top 12. There is no conference cap.

The four highest-ranked teams receive byes. Automatic qualifiers outside
the top 12 take the bottom seeds in rank order. Seeds 5–8 host 12–9
respectively. The quarterfinal paths are 1 vs. 8/9, 4 vs. 5/12, 2 vs. 7/10,
and 3 vs. 6/11. The first two paths share one semifinal and the last
two share the other. The bracket stays fixed, including rematches.
Seeds 1–3 select bowl sites in order, with seed 1 also choosing its semifinal
destination. Seed 4 receives the remaining quarterfinal site.
The explorer links the official sites and does not assign bowl slots.
The [official bracket page](https://collegefootballplayoff.com/sports/2026/8/9/bracket-place-holder)
lists Selection Day as December 6, 2026.

### Data and subjective assumptions

- The separately labeled committee poll comes from the existing ESPN CFP
  snapshot. Confirmed title fixtures and completed title winners come from
  the ESPN scoreboard for December 4–6. The loader validates participants
  against the FBS conference directory. The production run updates this
  feed alongside existing data without touching archived forecasts.
- Standings use available ESPN profile finals and explicit scenario picks.
  Unresolved games add no wins or losses. When phase metadata is absent,
  same-conference games count as league games. Known title fixtures are
  excluded from those records, as are unclassified same-conference games
  on title weekend and games after the Selection Day cutoff.
- Before official finalists are available, title entrants are provisional.
  The explorer orders teams by league win percentage, then uses head-to-head
  for fully played tied groups, published CFP order, overall win percentage,
  and ESPN team ID. It does not reproduce all conference tiebreakers,
  divisions or eligibility rules. Published participants take precedence.
  There is no assumed winner. Unresolved automatic berths remain pending.
- Projected committee order starts with the latest CFP Top 25. Teams outside
  it start at 26 or lower in overall win percentage order, then wins and
  team ID. For unranked teams, that record reflects available results and
  the scenario. Each hypothetical win improves the starting position by
  two points and each loss worsens it by three, including title picks.
  Ties use starting position. When the published CFP poll is unavailable,
  the projected field stays pending. Real finals update standings but do
  not award hypothetical ranking points. The heuristic does not model
  committee voting or changes since its latest published list.
- Once the official field is published, a maintainer can enter verified
  ESPN team IDs in seed order in `data/cfp-official-bracket.json`, with an
  ISO publication timestamp and official source link. Until then the
  file deliberately contains null seeds. Optional `winners` entries keyed
  by bracket game ID can record verified CFP winners. The official seed
  list takes priority over projections. A user's bracket picks remain
  conditional. The official file is reviewed and does not auto-ingest
  or infer seeds from interim rankings.
- Existing archived single-game forecasts can be referenced from the game
  picker. They do not drive selections. The [Version 2.0 audit](AUDIT.md)
  found that HQ Power Rankings trailed simple historical baselines and
  Game Predictions has not demonstrated a meaningful advantage. The explorer
  gives no playoff probabilities.

`playoff-model.mjs` holds deterministic schedule, selection, and bracket
functions. It accepts explicit outcomes independent of how they are generated.
A future simulation can supply sampled outcomes through the same functions.
Run `node --test tests/*.test.mjs` and
`python3 -m unittest discover -s tests` for automated checks.

## Monte Carlo Playoff Simulator

Open the **Playoff Simulator** tab or share the direct URL with
`#simulator`. In the tab, choose a game and winner, then tap **Run what-if comparison**. To carry your picks into the tab, choose **Open Playoff
Simulator** from Playoff Explorer. The simulator also remains available
inside **Playoff Explorer → Monte Carlo Playoff Simulator**. The Notre Dame
Command Center shows Notre Dame's dashboard inside **Explore Notre Dame
outcomes**. Choose 1,000, 10,000, or 50,000 seasons. The baseline loads from
the current Pages snapshot. Choose winners in the explorer or the Notre Dame
picker, then run a what-if comparison. The comparison uses a dedicated
browser worker so controls stay responsive and changing the count or picks
cancels the prior computation. No backend is required.

- **Rules and selection.** The simulator uses the explorer's existing
  [2026–27 CFP rules](https://collegefootballplayoff.com/sports/2024/5/29/12-team-format)
  and deterministic selection and bracket functions. Primary selections use
  the documented scenario rank-point adjustment. A separately reported
  sensitivity policy retains the published ranked order and uses modeled
  records for the unranked fallback while dropping winner/loser rank-point
  adjustments. Both use identical outcomes and automatic bids. The gap is
  sensitivity to these two assumptions. It assigns no probabilities to
  committee choices or to conference tiebreak procedures.
- **Games and title fixtures.** For known, unfinished regular-season games
  the simulator uses matching published pregame probabilities for the
  exact game, participants and kickoff. Verified finals stay fixed. Missing
  probabilities and other unresolved games remain unresolved. A user can
  supply an admissible winner for a known upcoming game. For an ESPN-listed
  conference title fixture, verified participants are pinned and provisional
  participants come from the explorer's simulated standings. If no forecast
  matches those participants, the existing Game Predictions equation uses
  the current ratings and an explicitly assumed zero venue adjustment.
  A missing or already-started fixture is not simulated.
- **Bracket.** First-round games use the higher seed's home advantage.
  Quarterfinals and later games use the Game Predictions equation with a
  neutral venue. Official seeds and verified postseason winners take priority
  when entered in the existing official bracket file. After the scheduled
  Selection Day cutoff, the simulator waits for that official field.
- **Sampling and interpretation.** The seed is fixed and printed with the
  snapshot fingerprint, model version, rating cutoff, and frozen schedule
  time. Draws are keyed by draw number and matchup so baseline and what-if
  runs share random numbers. Picks for a specific conference title or
  bracket matchup apply only when that pair occurs, and the dashboard reports
  how many draws honored the pick. Matchup outcomes are modeled independently
  conditional on ratings and venue. Missing schedules, roster changes,
  cross-game dependencies, and committee uncertainty remain limitations.
- **Denominators.** Qualification and seed shares use complete-field draws.
  Semifinal, final and title probabilities each use draws where that stage
  resolves fully. Any metric with zero resolved draws displays N/A. The
  dashboard shows input coverage and resolved counts. These conditional
  estimates can exclude meaningful unknown outcomes. A result of 100% means
  every eligible draw under the stated inputs, and the audited models have
  not established predictive superiority. See the [audit](AUDIT.md).

The default-branch workflow precomputes all three baselines from one seeded
50,000-draw stream and publishes its prefixes, input snapshot, and worker
with the existing Pages artifact. Prediction archives remain append-only.
Rebuild locally with `node update_simulation.mjs`. For an exact replay,
use the same source files and pass the original snapshot time as the second
argument, for example `node update_simulation.mjs /tmp/playoff-simulation.json
2026-11-22T02:45:00Z`. Source files and snapshot time must match to reproduce
the fingerprint and counts. Run `node --test tests/*.test.mjs` and the
Chromium integration suite in the PR workflow for regression checks.
