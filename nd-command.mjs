import {loadPredictions, predictionCard} from './game-predictions.mjs';
import {mountRoster} from './notre-dame-roster.mjs';
import {mountNews} from './notre-dame-news.mjs';
import {drawChart, loadWeeks, movement, rankAt} from './ranking-history.mjs';
import {
  advantage, escapeHtml, format, loadProfiles, metric, metrics, mountTrends,
  profileHref, shortDate, trendGames, trendSection,
} from './team-profiles.mjs';

const NOTRE_DAME = '87';
const comparisonMetrics = metrics.filter(([key]) =>
  ['points', 'allowed', 'yards', 'yards_allowed', 'turnovers'].includes(key));
const apLabel = (rank, available) => available ? rank == null ? 'Unranked' : 'No. ' + rank : 'N/A';
const fresh = profile => profile?.schedule_status === 'available';

export function rankedWins(games) {
  return (games ?? []).filter(game => game.final && game.result === 'W' && game.game_poll_date &&
    Number.isInteger(game.opponent_rank_at_game) &&
    game.opponent_rank_at_game >= 1 && game.opponent_rank_at_game <= 25);
}

function gamesByOpponent(games) {
  const grouped = new Map();
  for (const game of trendGames(games ?? [], false)) {
    if (!grouped.has(game.opponent_id)) grouped.set(game.opponent_id, []);
    grouped.get(game.opponent_id).push(game);
  }
  return grouped;
}

export function commonOpponents(teamGames, opponentGames) {
  const other = gamesByOpponent(opponentGames);
  const own = gamesByOpponent(teamGames);
  return [...own].filter(([id]) => other.has(id))
    .map(([id, games]) => ({name: games[0].opponent, games, opponentGames: other.get(id)}));
}

export function compareOpponent(team, opponent) {
  return comparisonMetrics.map(([key, label, direction]) => {
    const left = fresh(team) ? metric(team, key) ?? null : null;
    const right = fresh(opponent) ? metric(opponent, key) ?? null : null;
    return {key, label, left, right, edge: advantage(left, right, direction)};
  });
}

export function remainingGames(games, now = Date.now()) {
  return (games ?? []).filter(game => !game.final && !/cancel|no contest/i.test(game.status) &&
    (Date.parse(game.date) >= now || /postpon|delay|in progress|halftime/i.test(game.status)));
}

function result(game) {
  return game.result + ' ' + game.points + '–' + game.allowed;
}

function recent(games) {
  const finals = trendGames(games ?? [], true).reverse();
  if (!finals.length) return '<p class="muted">No verified final scores available.</p>';
  return `<ul class="nd-results">${finals.map(game =>
    `<li><strong>${result(game)}</strong> <span>${escapeHtml(game.opponent)}</span></li>`).join('')}</ul>`;
}

function profileLink(team, name) {
  return team ? `<a href="${profileHref(team.id)}">${escapeHtml(name ?? team.name)}</a>` : escapeHtml(name);
}

function table(label, headings, rows) {
  return `<div class="history-scroll" tabindex="0" aria-label="${label}">
    <table class="history-table"><thead><tr>${headings.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>`;
}

async function mountTrajectory(section) {
  const summary = section.querySelector('.nd-poll-summary');
  let weeks;
  try {
    weeks = await loadWeeks();
  } catch (error) {
    summary.textContent = 'AP history could not load. Reload the dashboard to try again.';
    console.error(error);
    return;
  }
  const latest = weeks.findLastIndex(week => week.poll);
  if (latest < 0) {
    summary.textContent = 'No verified archived polls available.';
    return;
  }
  const picker = section.querySelector('select');
  weeks.forEach((week, index) => picker.add(new Option(week.label, index)));
  picker.selectedIndex = latest;
  section.querySelector('label').hidden = false;
  const canvas = section.querySelector('canvas');
  canvas.hidden = false;
  const draw = () => {
    const index = picker.selectedIndex;
    const current = rankAt(weeks[index], NOTRE_DAME);
    const previous = index ? rankAt(weeks[index - 1], NOTRE_DAME) : undefined;
    const published = weeks[index].poll?.published_at?.slice(0, 10);
    summary.textContent = current === undefined ? 'AP poll unavailable for this week.'
      : weeks[index].label + ' · ' + apLabel(current, true) + ' · ' + movement(previous, current) +
        (published ? ' · Published ' + published : '');
    drawChart(canvas, weeks, [{id: NOTRE_DAME}], index);
  };
  picker.addEventListener('change', draw);
  draw();
}

function opponentView(nd, opponent, team, name) {
  const comparison = compareOpponent(nd, opponent);
  const common = commonOpponents(nd?.games, opponent?.games);
  const coverage = !fresh(nd) || !fresh(opponent)
    ? '<p class="muted">Current season comparison unavailable for at least one team. Any available saved results remain visible.</p>' : '';
  const displayName = escapeHtml(name);
  return `<h4>${profileLink(team, name)}</h4>${coverage}
    ${table('Opponent comparison', ['Completed-game average', 'Notre Dame', displayName], comparison.map(row => `
      <tr><th scope="row">${row.label}</th>
      <td class="${row.edge > 0 ? 'stat-advantage' : ''}">${format(row.left)}${row.edge > 0 ? ' · Edge' : ''}</td>
      <td class="${row.edge < 0 ? 'stat-advantage' : ''}">${format(row.right)}${row.edge < 0 ? ' · Edge' : ''}</td></tr>`))}
    <div class="nd-split"><div><h4>Notre Dame recent results</h4>${recent(nd?.games)}</div>
    <div><h4>${displayName} recent results</h4>${recent(opponent?.games)}</div></div>
    <h4>Common opponents</h4>
    ${common.length ? table('Common opponents', ['Opponent', 'Notre Dame', displayName], common.map(row => `
      <tr><th scope="row">${escapeHtml(row.name)}</th>
      <td>${row.games.map(result).join(', ')}</td><td>${row.opponentGames.map(result).join(', ')}</td></tr>`))
      : '<p class="muted">No shared opponents with verified finals in both schedules.</p>'}`;
}

function outlookNotes(nd, opponent) {
  const rows = compareOpponent(nd, opponent);
  const defense = rows.find(row => row.key === 'allowed');
  const offense = rows.find(row => row.key === 'yards');
  const challenge = defense.edge < 0
    ? 'Challenge: opponent has allowed ' + defense.right + ' points per game to Notre Dame’s ' + defense.left + '.' : '';
  const opportunity = offense.edge > 0
    ? 'Opportunity: Notre Dame has averaged ' + offense.left + ' yards per game to the opponent’s ' + offense.right + '.' : '';
  return [challenge, opportunity].filter(Boolean).join(' ') ||
    (defense.left == null || defense.right == null || offense.left == null || offense.right == null
      ? 'Comparable figures are unavailable.' : 'Neither of the highlighted conditions applies to this pairing.');
}

export async function mountCommand(panel, dashboard, isCurrent) {
  const directory = new Map(dashboard.teams.map(team => [String(team.id), team]));
  const team = directory.get(NOTRE_DAME);
  let profiles;
  try {
    profiles = await loadProfiles();
  } catch (error) {
    if (isCurrent()) panel.innerHTML = '<p class="notice" role="alert">Team data unavailable. Reload to try again.</p>';
    console.error(error);
    return;
  }
  if (!isCurrent()) return;
  const nd = profiles[NOTRE_DAME];
  if (!team || !nd) {
    panel.innerHTML = '<p class="notice" role="alert">Notre Dame data is unavailable in this snapshot.</p>';
    return;
  }

  const hasPoll = dashboard.poll === 'AP Top 25';
  const wins = rankedWins(nd.games);
  const remaining = remainingGames(nd.games);
  const opponents = new Map(nd.games.map(game => [game.opponent_id, game.opponent]));
  const nextGame = remaining.find(game => Date.parse(game.date) >= Date.now() &&
    !/postpon|delay|in progress|halftime/i.test(game.status));
  const defaultOpponent = nextGame?.opponent_id ?? remaining[0]?.opponent_id ?? nd.games.at(-1)?.opponent_id;
  const rank = team.rank ?? null;
  const pollMovement = nd.movement_available ? movement(nd.previous_rank, rank) : '';
  const status = nd.schedule_status === 'available' ? '' :
    '<p class="notice">Current Notre Dame schedule data is unavailable. Saved results and statistics are shown where available.</p>';
  panel.innerHTML = `
    <div class="panel-head"><h2>Notre Dame Command Center</h2>
      <div><a href="${profileHref(NOTRE_DAME)}">Full team profile</a> · <a href="#power=87">Power ranking analysis</a> · <a href="#playoff?team=87">Notre Dame playoff scenarios</a></div></div>
    ${status}
    <div class="statrow">
      <div class="stat"><strong>${escapeHtml(format(team.record))}</strong><span>Overall record</span></div>
      <div class="stat"><strong>${apLabel(rank, hasPoll)}</strong><span>Official AP poll${pollMovement ? ' · ' + pollMovement : ''}</span></div>
      <div class="stat"><strong>${format(nd.stats.margin)}</strong><span>Scoring margin per game</span></div>
    </div>
    <section class="profile-section nd-news" aria-labelledby="nd-news-heading">
      <h3 id="nd-news-heading">Notre Dame in the News</h3>
      <p class="muted nd-news-status" role="status">Loading Notre Dame football news…</p>
      <ul id="nd-news-list"></ul>
      <button type="button" aria-controls="nd-news-list" aria-expanded="false" hidden>Show More</button>
    </section>
    <section class="profile-section nd-roster" aria-labelledby="nd-roster-heading">
      <h3 id="nd-roster-heading">Notre Dame Roster &amp; Depth Chart</h3>
      <p class="muted" role="status">Loading the Notre Dame roster…</p>
      <p class="muted nd-roster-source"></p>
      <div class="nd-roster-controls" role="group" aria-label="Roster side" hidden>
        <button type="button" value="offense" aria-controls="nd-roster-content" aria-pressed="true">Offense</button>
        <button type="button" value="defense" aria-controls="nd-roster-content" aria-pressed="false">Defense</button>
      </div>
      <div class="nd-roster-content" id="nd-roster-content"></div>
    </section>
    <section class="profile-section"><h3>Recent Form</h3>${recent(nd.games)}</section>
    <section class="profile-section nd-trajectory"><h3>AP Ranking Trajectory</h3>
      <label hidden>Archived poll<select></select></label>
      <p class="muted nd-poll-summary" role="status">Loading published AP polls…</p>
      <div class="history-scroll" tabindex="0" aria-label="Scrollable Notre Dame AP ranking chart">
        <canvas hidden role="img" aria-label="Notre Dame AP ranks by week, rank one at the top. Use the poll selector for exact ranks."></canvas>
      </div>
    </section>
    ${trendSection(true)}
    <section class="profile-section"><h3>Opponent Intelligence</h3>
      <p class="muted">Season averages use only verified final games. Higher scoring and offensive yardage, lower points and yards allowed, and fewer turnovers lost are highlighted. Figures come from ESPN schedules and box scores.</p>
      ${opponents.size ? '<label>Schedule opponent<select class="nd-opponent"></select></label><div class="nd-prediction"></div><div class="nd-comparison"></div>'
        : '<p class="muted">No verified schedule opponents available.</p>'}
    </section>
    <section class="profile-section"><h3>Quality Wins</h3>
      <p class="muted">Wins count when an archived AP poll establishes that the opponent was ranked at game time. Current rank is shown separately.</p>
      ${wins.length ? table('Ranked wins', ['Date', 'Opponent', 'Result', 'AP at game', 'AP now'], wins.map(game => `
        <tr><td>${shortDate(game.date)}</td><th scope="row">${profileLink(directory.get(game.opponent_id), game.opponent)}</th>
         <td>${result(game)}</td><td>${apLabel(game.opponent_rank_at_game, true)}</td>
         <td>${apLabel(directory.get(game.opponent_id)?.rank, hasPoll && directory.has(game.opponent_id))}</td></tr>`))
        : '<p class="muted">No ranked wins verified in the available results.</p>'}
      <p><strong>${format(nd.strength.pct, '%')}</strong> opponent win percentage
        ${nd.strength.played ? ' · ' + nd.strength.covered + ' of ' + nd.strength.played + ' completed games covered' : ''}</p>
      <p class="muted">Saturday HQ combines current FBS opponent records, including head-to-head games, with half credit for ties. Missing, stale, and non-FBS records are excluded. This metric has no official NCAA standing.</p>
    </section>
    <section class="profile-section"><h3>Notre Dame Playoff Scenarios</h3>
      <details class="nd-playoff"><summary>Explore Notre Dame outcomes</summary><div class="nd-playoff-controls"></div></details>
    </section>
    <section class="profile-section"><h3>Season Outlook</h3>
      <p class="muted">Challenges and opportunities interpret the available season averages. Teams have faced different schedules, and these observations carry no game or playoff forecast.</p>
      ${remaining.length ? table('Remaining Notre Dame games', ['Date', 'Opponent', 'Overall', 'Current AP', 'Statistical context'],
        remaining.map(game => {
          const opponent = directory.get(game.opponent_id);
          return `<tr><td>${shortDate(game.date, game.time_tbd)}</td><th scope="row">${profileLink(opponent, game.opponent)}</th>
            <td>${escapeHtml(format(opponent?.record))}</td><td>${apLabel(opponent?.rank, hasPoll && Boolean(opponent))}</td>
            <td class="nd-context">${outlookNotes(nd, profiles[game.opponent_id])}</td></tr>`;
        })) : '<p class="muted">No remaining games are listed in the available schedule.</p>'}
    </section>`;

  void mountNews(panel.querySelector('.nd-news'), isCurrent);
  void mountRoster(panel.querySelector('.nd-roster'), isCurrent);
  const playoff = panel.querySelector('.nd-playoff');
  playoff.addEventListener('toggle', () => {
    if (!playoff.open || playoff.dataset.loaded) return;
    playoff.dataset.loaded = 'true';
    const target = playoff.querySelector('.nd-playoff-controls');
    import('./playoff-explorer.mjs').then(module => {
      if (isCurrent()) return module.mountNotreDamePlayoff(target,dashboard,isCurrent);
    }).catch(() => { if (isCurrent()) target.textContent = 'Playoff scenarios unavailable.'; });
  });
  mountTrends(panel.querySelector('.trend-section'), nd.games);
  void mountTrajectory(panel.querySelector('.nd-trajectory'));
  const select = panel.querySelector('.nd-opponent');
  if (select) {
    for (const [id, name] of opponents) select.add(new Option(name + (id === nextGame?.opponent_id ? ' (next)' : ''), id));
    select.value = defaultOpponent;
    const target = panel.querySelector('.nd-prediction');
    const forecasts = loadPredictions().catch(error => {
      console.warn('Notre Dame forecasts unavailable', error);
      return null;
    });
    let selection = 0;
    const show = () => {
      const selected = ++selection;
      const opponent = select.value;
      target.textContent = 'Loading matchup forecast…';
      forecasts.then(data => {
        if (!isCurrent() || selected !== selection) return;
        const row = data?.rows.find(game => Date.parse(game.kickoff) > Date.now() && game.status === 'Scheduled' &&
          [game.first, game.second].includes(NOTRE_DAME) && [game.first, game.second].includes(opponent));
        target.innerHTML = '<h4>Notre Dame Matchup Predictor</h4>' + (row
          ? predictionCard(row, directory, false)
          : '<p class="muted">No upcoming forecast available for the selected opponent.</p>');
      });
      panel.querySelector('.nd-comparison').innerHTML = opponentView(nd, profiles[select.value],
        directory.get(select.value), opponents.get(select.value));
    };
    select.addEventListener('change', show);
    show();
  }
}
