# Saturday HQ 2.0 quality and accuracy audit

Audited the public Pages release and repository commit
[`6bf03a3`](https://github.com/jcmor87/college-football-dashboard/commit/6bf03a3).
The current weights and rating formula are unchanged by this audit.

## Priorities

| Priority | Category | Finding and disposition |
| --- | --- | --- |
| P1 | Confirmed integrity gap | The writer creates files atomically and rejects post-kickoff writes, but the workflow previously had no Git-level check for changes to previously tracked forecasts. This PR rejects changes or deletions against the PR base and again before the production bot commits. It verifies file keys, content digests, and issuance timestamps. |
| P1 | Confirmed grading bug | The previous code selected the newest forecast, then checked the teams. A newer revision with different teams could suppress an older valid forecast for the verified matchup. Selection now filters the matchup before choosing the newest eligible revision. Regression coverage reproduces the failure. |
| P1 | Statistical limitation | Neither model clears an evidence bar for a validated simulator. Power rankings underperform both performance baselines in this replay. The prediction model has mixed results over two holdout weeks. Retain the experimental label and keep future evaluations separate. |
| P2 | Confirmed UX defect | About still said Version 1.0 and described shipped features as future work. The updated section covers the AP archive, profiles, Notre Dame, power rankings, and predictions, with a shareable `#about` route. |
| P2 | Confirmed freshness ambiguity | The header displayed the last changed dashboard snapshot without distinguishing a successful unchanged refresh. The new release status reports refresh-check time, flags checks older than six hours, and suppresses status when its dashboard timestamp disagrees. Power and prediction screens retain their own input cutoff. |
| P3 | Optional UX | Add an explicit stale age beside individual feature cutoffs and a direct link from each forecast revision to its raw archive JSON. Table scrolling and the existing revision detail view worked in browser tests. |

## Power rankings

Replaying the saved ESPN profiles from the audited commit with the checked-in
configuration reproduced the published result on the **same 405 games**.

| Model | Correct-pick credits | Winner accuracy |
| --- | ---: | ---: |
| Saturday HQ | 241.0 | 59.51% |
| Prior FBS win percentage | 254.5 | 62.84% |
| Prior raw scoring margin | 259.5 | 64.07% |

HQ trails raw margin by 18.5 credits (4.57 percentage points). HQ earned more
credit on 35 games and raw margin earned more on 53. Credit differences
include tied picks worth a half point. Raw margin led in seven of eight
scored weeks. The only exception had one game. The early replay samples are
uneven: teams need three qualifying FBS games, and week sample sizes range
from 1 to 67. The model rates the FBS schedule available in the archive.
Non-FBS outcomes are excluded from all three comparisons.

- **Schedule and adjustment.** Thirty percent of the rating rewards opposition
  win rate, shrunk toward .500 and calculated without games against the
  rated team. Another 30% uses capped own margin and adds the opponent's
  shrunk, capped margin against other teams. Excluding head-to-head results
  avoids direct feedback. Both terms still reward opponent strength, so
  schedule quality can lift a team with weaker own results. The replay
  describes the gap without identifying a causal effect of either term.
- **Normalization and overlap.** Midrank percentiles make components
  comparable in scale, but compress distances between close and far-apart
  raw values and depend on who clears eligibility at each cutoff. Adjusted
  margin and win/loss component percentiles had a mean within-week
  Pearson correlation of **0.875** across scored-week cutoffs with at
  least 10 eligible teams. Their combined weight is 50%. The schedule
  and adjusted margin percentile correlation was **0.252**.
- **Missingness and thresholds.** Third-down net efficiency was available
  on both sides of all 405 scored matchups under the coverage rules.
  Recent form was neutral for **380 of 810 team-game observations**, mainly
  because six prior games are required. Neutral percentile 50 preserves
  weights. Capping margins and shrinking small samples reduce variance
  but can also discard signal retained by the raw-margin baseline.
- **Leakage.** Each cutoff admits only verified finals with kickoff plus
  the configured 24-hour delay at or before the cutoff. Same-window games
  cannot enter its features. The opponent adjustments follow the same
  cutoff. The replay uses reconstructed ESPN data and season membership,
  and there are no original field-level publication timestamps. Late
  corrections, reschedules, and delayed box scores prevent a proof of
  exact point-in-time availability. Treat the replay as retrospective.

Before changing the formula, preregister candidates such as reducing the
overlap between schedule and margin, comparing raw versus percentile scaling,
and adding venue handling to matched baselines. Fit or choose candidates
using earlier date blocks only. Reserve new weeks or later seasons as a
locked evaluation sample, apply an identical eligibility rule to all
models, and report paired differences with uncertainty. No weights were
fit, selected, or changed using these 405 games.

## Game prediction holdout

The margin fit used 164 earlier games and the probability scale used 112
subsequent games. The 129-game holdout spans the Nov 3 and Nov 10 UTC
kickoff weeks. Paired replay against the raw scoring-margin baseline gave:

| Metric | HQ | Raw margin | HQ minus raw | Descriptive paired 95% interval |
| --- | ---: | ---: | ---: | ---: |
| Winner accuracy | 62.02% | 60.47% | +1.55 pp | −6.20 to +9.30 pp |
| Margin MAE | 13.932 | 14.066 | −0.134 points | −1.038 to +0.775 |
| Brier score | 0.22174 | 0.22151 | +0.00023 | −0.01472 to +0.01484 |

Intervals are game-paired percentile bootstrap estimates from 10,000
resamples with seed 2026. They are descriptive. Game-level resampling
assumes independence, while teams recur and each week shares model inputs.
There are only two holdout weeks, so the data do not support reliable
week-cluster inference. All intervals include zero. HQ led accuracy in
the first holdout week (64.52% vs. 57.26%) and trailed in the second
(59.70% vs. 63.43%). The observed differences do not establish
statistically meaningful improvement.

The mean expected versus observed first-listed win rate by probability
bin was **30.77% vs. 24.32%** (37 games), **48.98% vs. 44.07%**
(59), **66.84% vs. 65.62%** (32), and **80.53% vs. 100%** (1).
No observations fell in the 0–20% bin. Approximate game-level Wilson
intervals for the observed rates in those four populated bins were
13.4–40.1%, 32.2–56.7%, 48.3–79.6%, and 20.7–100%.
The forecasts fall inside all four descriptive intervals. This sample
does not demonstrate calibration, especially at the extremes.

The live dashboard reported **62 archived forecasts across 62 games and
zero scored live outcomes** at the audited release. The live archive is
prospective and kept separate from the historical replay. It is not a second
sample of the 129 holdout games.

## Pages, workflow, and archive checks

- Pages reported a successful Actions-based deployment. The last audited
  [production run](https://github.com/jcmor87/college-football-dashboard/actions/runs/44973251960)
  passed both update and deploy. The cron is `17 */3 * * *` UTC. Recent
  scheduled run records showed successes and scheduler delay. For example,
  Nov 21 21:50 UTC was about 33 minutes after its 21:17 UTC slot. A cron
  interval is a scheduling target, and delays or missed launches can occur.
- The deployed HTML, model modules, dashboard, team profiles, AP index,
  power snapshot, prediction snapshot, and all 62 archive files were checked
  against the audited commit. The release guard now validates team IDs,
  model cutoff alignment, and staged-file hashes for the core files it lists.
  It checks the pipeline and does not certify that every upstream feed is fresh.
- All archived filenames and digests verified. Every input cutoff was at or
  before issuance, and every issuance was strictly before its recorded kickoff.
  The narrowest lead was 9 minutes and 6 seconds. The Git history showed
  additions only. Grading also excludes any forecast issued at or after
  ESPN's corrected kickoff. The append-only gate governs normal PR and bot
  paths, and repository administrators can still bypass workflow checks or
  rewrite history. The branch-protection API returned 403 to the integration,
  so required-protection settings could not be verified.
- Browser regression checks cover main tabs, direct team, Notre Dame, power,
  prediction and About routes, narrow and tablet-width layouts, filtering,
  forecast error isolation, and current, delayed, or mismatched refresh status.
  The published release was checked using its verified files served locally
  because the test Chromium instance did not trust the environment's HTTPS
  certificate chain. HTTPS downloads themselves verified normally.

To repeat verification, use the audited commit's data and the documented
cutoffs. Run `python3 -m unittest discover -s tests`, `node --test
tests/*.test.mjs`, `python3 verify_release.py`, and the Playwright browser
test in the PR workflow. The release and archive checks run before
the production staging steps.
