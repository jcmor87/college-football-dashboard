import {drawChart} from './ranking-history.mjs';
import {escapeHtml, profileHref} from './team-profiles.mjs';

const LABELS = {
  schedule: 'Strength of schedule',
  margin: 'Opponent-adjusted margin',
  results: 'Win/loss performance',
  efficiency: 'Net third-down efficiency',
  recent: 'Recent margin improvement',
};
const ESPN = 'https://www.espn.com/college-football/rankings';
const ratingFormat = new Intl.NumberFormat(undefined, {maximumFractionDigits: 2});
const number = value => value == null ? 'N/A' : ratingFormat.format(value);
const percentage = value => value == null ? 'N/A' : number(value * 100) + '%';
const day = time => time?.slice(0, 10) ?? 'N/A';
const delta = value => value == null ? '—' : value > 0 ? '+' + value : String(value);
const rank = value => value == null ? 'N/A' : '#' + value;

let pending;
function loadPower() {
  pending ??= fetch(new URL('./data/power-rankings/latest.json', import.meta.url), {cache:'no-cache'})
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }).then(data => {
      if (data.season !== 2026 || !data.teams || !Array.isArray(data.history)) {
        throw new Error('Incomplete power model snapshot');
      }
      return data;
    }).catch(error => {
      pending = null;
      throw error;
    });
  return pending;
}

export function rankDifference(hq, official) {
  return hq == null || official == null ? null : official - hq;
}

function pollRank(poll, id) {
  return poll ? poll.ranks[id] == null ? 'Unranked' : rank(poll.ranks[id]) : 'N/A';
}

function table(label, headers, rows) {
  return `<div class="history-scroll" tabindex="0" aria-label="${label}"><table class="history-table">
    <thead><tr>${headers.map(header => `<th scope="col">${header}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>`;
}

function disagreement(data, directory, key, label) {
  const poll = data.polls[key];
  const ranked = directory.map(team => {
    const id = String(team.id);
    return {team, difference: rankDifference(data.teams[id]?.rank, poll?.ranks[id])};
  }).filter(row => row.difference != null && row.difference !== 0)
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.team.name.localeCompare(b.team.name))
    .slice(0, 5);
  return `<div><h4>${label}</h4>${ranked.length ? `<ul>${ranked.map(({team, difference}) =>
    `<li><a href="#power=${encodeURIComponent(team.id)}">${escapeHtml(team.name)}</a>
    <strong>${delta(difference)}</strong></li>`).join('')}</ul>`
    : '<p class="muted">No comparable disagreements available.</p>'}</div>`;
}

function factors(row, config) {
  if (!row?.components) return '<p class="notice">Rating unavailable. This team has too few admissible FBS games.</p>';
  const rows = Object.entries(LABELS).map(([key, label]) => {
    const {raw, percentile, points} = row.components[key];
    const value = ['schedule', 'results', 'efficiency'].includes(key) ? percentage(raw) : number(raw);
    const relative = points - config.weights[key] / 2;
    return {label, value, percentile: raw == null ? 'Neutral (50)' : number(percentile),
      points, relative, weight: config.weights[key]};
  });
  const drivers = [...rows].sort((a, b) => Math.abs(b.relative) - Math.abs(a.relative))
    .filter(item => Math.abs(item.relative) >= 0.005).slice(0, 2);
  return `<p class="muted">${drivers.length ? 'Largest effects vs. a neutral score: ' + drivers.map(
    item => item.label + ' (' + (item.relative > 0 ? '+' : '') + number(item.relative) + ')').join(', ') + '.'
    : 'All components are at their neutral contribution.'}</p>
    ${table('Power rating factors', ['Component', 'Raw input', 'Percentile', 'Rating points'], rows.map(item =>
      `<tr><th scope="row">${item.label}</th><td>${item.value}</td><td>${item.percentile}</td>
       <td>${number(item.points)} / ${item.weight}</td></tr>`))}`;
}

function renderAnalysis(panel, data, team) {
  if (!team) {
    panel.innerHTML = '<p class="notice">No team matches this ranking view.</p>';
    return;
  }
  const id = String(team.id);
  const row = data.teams[id];
  const title = id === '87' ? 'Notre Dame Power Analysis' : team.name + ' Power Analysis';
  const weekData = data.history.map(entry => ({label: day(entry.cutoff).slice(5), poll: {ranks: entry.ranks}}));
  const history = weekData.map(week => week.poll.ranks[id]);
  const active = history.findLastIndex(value => value != null);
  panel.innerHTML = `<h3>${escapeHtml(title)}</h3>
    <p><strong>${rank(row?.rank)} · ${number(row?.rating)} / 100</strong>
    · ${row?.games ?? 0} admissible FBS games · AP ${pollRank(data.polls.ap, id)} · CFP ${pollRank(data.polls.cfp, id)}</p>
    <p class="muted">${row?.efficiency_games ?? 0} games with both third-down boxes.
    <a href="${profileHref(id)}">Full team profile</a></p>
    ${factors(row, data.config)}
    <h4>Weekly HQ rank</h4>
    ${active < 0 ? '<p class="muted">No archived rank for this team yet.</p>' :
      `<label>Weekly cutoff<select class="power-week">${data.history.map((entry, index) =>
        `<option value="${index}" ${index === active ? 'selected' : ''}>${day(entry.cutoff)} UTC</option>`).join('')}</select></label>
      <p class="muted power-week-rank" role="status"></p>
      <div class="history-scroll" tabindex="0" aria-label="Scrollable Saturday HQ ranking history">
        <canvas role="img" aria-label="Saturday HQ weekly rank, number one at the top"></canvas></div>`}`;

  if (active >= 0) {
    const picker = panel.querySelector('.power-week');
    const draw = () => {
      const index = Number(picker.value);
      panel.querySelector('.power-week-rank').textContent = history[index] == null
        ? 'No eligible ranking at this cutoff.' : 'Saturday HQ rank ' + rank(history[index]);
      drawChart(panel.querySelector('canvas'), weekData, [team], index, Math.max(2, Object.keys(data.teams).length));
    };
    picker.addEventListener('change', draw);
    draw();
  }
}

export async function mountPower(panel, directory, selectedId, isCurrent) {
  let data;
  try {
    data = await loadPower();
  } catch (error) {
    if (isCurrent()) panel.innerHTML = '<p class="notice" role="alert">Power rankings could not load. Reload the dashboard to try again.</p>';
    console.error(error);
    return;
  }
  if (!isCurrent()) return;

  const teams = [...directory].sort((a, b) => (data.teams[a.id]?.rank ?? Infinity)
    - (data.teams[b.id]?.rank ?? Infinity) || a.name.localeCompare(b.name));
  const conferences = [...new Set(teams.map(team => team.conference).filter(Boolean))].sort();
  const accuracy = data.backtest.accuracy;
  panel.innerHTML = `<div class="panel-head"><h2>Saturday HQ Power Rankings</h2><span class="muted">Experimental</span></div>
    <p class="notice">Model ${escapeHtml(data.model)} · Cutoff ${day(data.cutoff)} UTC · ${data.eligible} eligible FBS teams ·
    ${data.completed_fbs_games} final FBS games.
    ${data.profile_coverage.stale || data.profile_coverage.unavailable
      ? `${data.profile_coverage.stale} stale and ${data.profile_coverage.unavailable} unavailable team schedules. ` : ''}
    Official polls appear as published by ESPN:
    <a href="${ESPN}">AP Top 25</a> ${day(data.polls.ap?.date)} · <a href="${ESPN}">CFP committee</a> ${day(data.polls.cfp?.date)}.</p>
    <section class="profile-section"><h3>National Comparison</h3>
      <div class="profile-controls"><label>Conference<select class="power-conference">
       <option value="">All conferences</option>${conferences.map(name => `<option>${escapeHtml(name)}</option>`).join('')}</select></label>
       <label>Find a team<input class="power-search" type="search" placeholder="Team or abbreviation"></label></div>
      <p class="muted">A positive poll difference means HQ ranks the team higher. Differences require both ranks.
      Weekly movement compares to ${day(data.movement_reference)} UTC.</p>
      <div class="power-table"></div>
    </section>
    <section class="profile-section"><h3>Biggest Official Poll Disagreements</h3>
      <div class="nd-split">${disagreement(data, teams, 'ap', 'AP comparison')}${disagreement(data, teams, 'cfp', 'CFP comparison')}</div>
    </section>
    <section class="profile-section"><label>Team analysis<select class="power-team">${[...teams]
      .sort((a, b) => a.name.localeCompare(b.name)).map(team =>
        `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`).join('')}</select></label>
      <div class="power-analysis"></div>
    </section>
    <section class="profile-section"><h3>Chronological Backtest</h3>
      <p class="muted">${data.backtest.games} held-out FBS games with both teams eligible. Every model uses the same games.
      Ratings were frozen before each game week. Tied picks receive half credit. This single-season evaluation is exploratory.</p>
      ${table('Backtest winner accuracy', ['Saturday HQ', 'Win percentage', 'Raw scoring margin', 'Home team'],
        [`<tr><td>${percentage(accuracy.power)}</td><td>${percentage(accuracy.win_pct)}</td>
         <td>${percentage(accuracy.raw_margin)}</td><td>${percentage(accuracy.home)}</td></tr>`])}
      <p class="muted">See the <a href="https://github.com/jcmor87/college-football-dashboard#power-ranking-methodology">methodology</a>
        for weights, coverage rules and backtest limits.</p>
    </section>`;

  const conference = panel.querySelector('.power-conference');
  const search = panel.querySelector('.power-search');
  const selector = panel.querySelector('.power-team');
  const analysis = panel.querySelector('.power-analysis');
  selector.value = String(teams.find(team => String(team.id) === selectedId)?.id
    ?? teams.find(team => String(team.id) === '87')?.id ?? teams[0]?.id ?? '');
  const showAnalysis = () => renderAnalysis(analysis, data, teams.find(team => String(team.id) === selector.value));
  selector.addEventListener('change', showAnalysis);
  showAnalysis();

  function showTable() {
    const query = search.value.trim().toLowerCase();
    const filtered = teams.filter(team => (!conference.value || team.conference === conference.value) &&
      `${team.name} ${team.abbreviation ?? ''}`.toLowerCase().includes(query));
    panel.querySelector('.power-table').innerHTML = filtered.length
      ? table('National ranking comparison', ['Saturday HQ', 'Team', 'Rating', 'Weekly move', 'AP', 'HQ vs. AP', 'CFP', 'HQ vs. CFP'],
        filtered.map(team => {
          const id = String(team.id);
          const row = data.teams[id];
          return `<tr><td>${rank(row?.rank)}</td><th scope="row"><a href="#power=${encodeURIComponent(id)}">${escapeHtml(team.name)}</a></th>
            <td>${number(row?.rating)}</td><td>${delta(row?.movement)}</td>
            <td>${pollRank(data.polls.ap, id)}</td><td>${delta(rankDifference(row?.rank, data.polls.ap?.ranks[id]))}</td>
            <td>${pollRank(data.polls.cfp, id)}</td><td>${delta(rankDifference(row?.rank, data.polls.cfp?.ranks[id]))}</td></tr>`;
        })) : '<p class="muted">No teams match these filters.</p>';
  }
  conference.addEventListener('change', showTable);
  search.addEventListener('input', showTable);
  showTable();
  if (selectedId) analysis.scrollIntoView({block:'start'});
}
