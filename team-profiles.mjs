import {movement} from './ranking-history.mjs';

export const profileHref = id => `#team=${encodeURIComponent(id)}`;
export const teamFromHash = hash => /^#team=([0-9]+)$/.exec(hash)?.[1] ?? null;

const metrics = [
  ['points', 'Points scored / game', 1], ['allowed', 'Points allowed / game', -1],
  ['margin', 'Scoring margin / game', 1], ['yards', 'Total yards / game', 1],
  ['yards_allowed', 'Yards allowed / game', -1], ['rushing', 'Rushing yards / game', 1],
  ['passing', 'Net passing yards / game', 1], ['turnovers', 'Turnovers lost / game', -1],
  ['third_pct', 'Third-down conversion', 1, '%'], ['strength', 'Opponent win percentage', 1, '%'],
];

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
  char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[char]);
const format = (value, unit = '') => value == null ? 'N/A' : `${value}${unit}`;
const percent = value => format(value, '%');
const metric = (profile, key) => key === 'strength' ? profile?.strength.pct : profile?.stats[key];
const shortDate = (date, tbd = false) => new Date(date).toLocaleDateString(undefined,
  {month:'short', day:'numeric', ...(tbd ? {timeZone:'UTC'} : {})});

export function advantage(left, right, direction) {
  return left == null || right == null || left === right ? 0 : Math.sign(left - right) * direction;
}

let profileData;
async function loadProfiles() {
  if (!profileData) {
    profileData = fetch(new URL('./data/team-profiles.json', import.meta.url), {cache:'no-cache'})
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }).then(data => {
        if (data.season !== 2026 || !data.teams || Array.isArray(data.teams)) {
          throw new Error('Invalid team profile data');
        }
        return data.teams;
      }).catch(error => {
        profileData = null;
        throw error;
      });
  }
  return profileData;
}

function scheduleTable(games, directory) {
  if (!games.length) return '<p class="muted">No verified schedule is available.</p>';
  return `<div class="history-scroll" tabindex="0" aria-label="Scrollable team schedule">
    <table class="history-table"><thead><tr>
      <th scope="col">Date</th><th scope="col">Opponent</th><th scope="col">Site</th>
      <th scope="col">Result</th><th scope="col">Opponent AP at game</th><th scope="col">Opponent AP now</th>
    </tr></thead><tbody>${games.map(game => {
      const opponent = escapeHtml(game.opponent);
      const opponentCell = directory.has(game.opponent_id)
        ? `<a href="${profileHref(game.opponent_id)}">${opponent}</a>` : opponent;
      const atGame = game.game_poll_date
        ? (game.opponent_rank_at_game == null ? 'Unranked' : `#${game.opponent_rank_at_game}`) : 'N/A';
      const now = game.current_poll_available
        ? (game.opponent_rank_now == null ? 'Unranked' : `#${game.opponent_rank_now}`) : 'N/A';
      const result = game.final ? `${game.result} ${game.points}–${game.allowed}`
        : escapeHtml(game.time_tbd ? `${game.status} · Time TBD` : game.status);
      return `<tr><td>${shortDate(game.date, game.time_tbd)}</td><th scope="row">${opponentCell}</th><td>${escapeHtml(game.site)}</td>
        <td>${result}</td><td>${atGame}</td><td>${now}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

const trendMetrics = {
  scoring: [['Points scored', game => game.points], ['Points allowed', game => game.allowed]],
  margin: [['Scoring margin', game => game.points - game.allowed]],
  yards: [['Total yards', game => game.offense?.yards], ['Rushing yards', game => game.offense?.rushing],
    ['Net passing yards', game => game.offense?.passing]],
};

export function trendGames(games, lastFive) {
  const finals = games.filter(game => game.final);
  return lastFive ? finals.slice(-5) : finals;
}

function renderTrend(section, games) {
  const mode = section.querySelector('.trend-metric').value;
  const series = trendMetrics[mode];
  const displayed = trendGames(games, section.querySelector('.trend-range').value === 'five');
  const target = section.querySelector('.trend-chart');
  if (!displayed.length) {
    target.textContent = 'No completed games are available.';
    return;
  }

  const max = Math.max(1, ...displayed.flatMap(game => series.map(([, get]) => Math.abs(get(game) ?? 0))));
  target.innerHTML = `<div class="trend-legend">${series.map(([label], index) =>
    `<span class="trend-color-${index}">${label}</span>`).join('')}</div>
    <ul>${displayed.map(game => `<li><span>${shortDate(game.date)} · ${escapeHtml(game.opponent)}</span>
      ${series.map(([label, get], index) => {
        const value = get(game);
        const width = value == null ? 0 : (mode === 'margin' ? 50 : 100) * Math.abs(value) / max;
        return `<div class="trend-line trend-color-${index}" aria-label="${label} ${format(value)}">
          <span class="trend-track${mode === 'margin' ? ' diverging' : ''}"><span class="trend-bar${value < 0 ? ' negative' : ''}" style="--bar-width:${width}%"></span></span>
          <span>${format(value)}</span></div>`;
      }).join('')}</li>`).join('')}</ul>`;
}

export async function renderProfiles(panel, directory, id, hasPoll, isCurrent) {
  const teams = new Map(directory.map(team => [String(team.id), team]));
  const team = teams.get(id ?? '87') ?? (id == null ? directory[0] : null);
  if (!team) {
    panel.innerHTML = '<div class="notice" role="alert">This team profile was not found. Choose a team from All FBS Teams.</div>';
    return;
  }
  panel.innerHTML = '<div class="notice" role="status">Loading team profile…</div>';
  let profiles;
  try {
    profiles = await loadProfiles();
  } catch (error) {
    if (isCurrent()) panel.innerHTML = '<div class="notice" role="alert">Team profiles could not load. Reload the dashboard to try again.</div>';
    console.error(error);
    return;
  }
  if (!isCurrent()) return;
  const profile = profiles[String(team.id)];
  if (!profile) {
    panel.innerHTML = '<div class="notice" role="alert">ESPN profile data is unavailable for this team.</div>';
    return;
  }

  const rank = team.rank ?? null;
  const rankText = !hasPoll ? 'N/A' : rank == null ? 'Unranked' : `#${rank}`;
  const change = profile.movement_available ? movement(profile.previous_rank, rank) : '';
  const options = directory.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  const strength = profile.strength;
  const ranked = profile.ranked_results;
  const available = profile.schedule_status !== 'unavailable';
  const apRecord = available ? `${ranked.W} ranked wins · ${ranked.L} ranked losses${ranked.T ? ` · ${ranked.T} ranked ties` : ''}` : 'Ranked results unavailable';
  panel.innerHTML = `
    <div class="panel-head profile-heading">
      ${profile.logo ? `<img src="${escapeHtml(profile.logo)}" width="64" height="64" alt="">` : ''}
      <div><h2>${escapeHtml(profile.school)}</h2>
      <span class="muted">${escapeHtml(team.name)} · ${escapeHtml(team.conference)}</span></div>
      <label>Team<select class="profile-picker">${options}</select></label>
    </div>
    <div class="statrow">
      <div class="stat"><strong>${escapeHtml(format(team.record))}</strong><span>Overall</span></div>
      <div class="stat"><strong>${escapeHtml(format(profile.conference_record))}</strong><span>Conference</span></div>
      <div class="stat"><strong>${rankText}</strong><span>Current AP ${change ? `· ${change}` : ''}</span></div>
    </div>
    ${profile.schedule_status === 'stale' ? '<p class="notice">ESPN’s schedule feed was unavailable. Showing the last saved schedule and game statistics.</p>' : ''}
    <section class="profile-section"><h3>2026 Season Schedule</h3>${scheduleTable(profile.games, teams)}</section>
    <section class="profile-section"><h3>Offense and Defense</h3>
      <p class="muted">Completed games: ${available ? profile.stats.games : 'N/A'}. Missing box score values are shown as N/A.</p>
      <dl class="profile-metrics">${metrics.slice(0, -1).map(([key, label, , unit]) =>
        `<div><dt>${label}</dt><dd>${format(metric(profile, key), unit)}</dd></div>`).join('')}</dl>
    </section>
    <section class="profile-section trend-section"><h3>Game Trends</h3>
      <div class="profile-controls"><label>Metric<select class="trend-metric">
        <option value="scoring">Points scored vs. allowed</option><option value="margin">Scoring margin</option>
        <option value="yards">Offensive production</option></select></label>
        <label>Games<select class="trend-range"><option value="five">Last five</option><option value="all">Full season</option></select></label></div>
      <div class="trend-chart"></div>
    </section>
    <section class="profile-section"><h3>Opponent Strength</h3>
      <p><strong>${percent(strength.pct)}</strong> opponent win percentage · ${strength.covered} of ${strength.played} completed games covered</p>
      <p class="muted">Combined current records of FBS opponents already played, including head-to-head results. Missing records and non-FBS opponents are excluded. This is a Saturday HQ calculation.</p>
      <p>${apRecord}${ranked.unverified ? ` · ${ranked.unverified} completed games with AP ranking unavailable at kickoff` : ''}</p>
    </section>
    <section class="profile-section"><h3>Compare Two Teams</h3>
      <div class="profile-controls">
        <label>First team<select class="compare-first">${options}</select></label>
        <label>Second team<select class="compare-second">${options}</select></label>
      </div>
      <p class="muted">Highlighted values show the statistical advantage for that row. Opponent win percentage describes schedule strength.</p>
      <div class="compare-table"></div>
    </section>`;

  const picker = panel.querySelector('.profile-picker');
  picker.value = String(team.id);
  picker.addEventListener('change', () => { location.hash = profileHref(picker.value); });
  const trends = panel.querySelector('.trend-section');
  trends.addEventListener('change', () => renderTrend(trends, profile.games));
  renderTrend(trends, profile.games);

  const first = panel.querySelector('.compare-first');
  const second = panel.querySelector('.compare-second');
  const target = panel.querySelector('.compare-table');
  first.value = String(team.id);
  second.value = String(directory.find(item => String(item.id) !== first.value)?.id ?? first.value);

  function compare() {
    if (first.value === second.value) {
      target.textContent = 'Choose two different teams to compare.';
      return;
    }
    const left = teams.get(first.value);
    const right = teams.get(second.value);
    target.innerHTML = `<div class="history-scroll" tabindex="0" aria-label="Scrollable team comparison">
      <table class="history-table"><thead><tr><th scope="col">Metric</th>
        <th scope="col"><a href="${profileHref(left.id)}">${escapeHtml(left.name)}</a></th>
        <th scope="col"><a href="${profileHref(right.id)}">${escapeHtml(right.name)}</a></th></tr></thead>
      <tbody><tr><th scope="row">Overall record</th><td>${escapeHtml(format(left.record))}</td><td>${escapeHtml(format(right.record))}</td></tr>
      <tr><th scope="row">Conference record</th><td>${escapeHtml(format(profiles[first.value]?.conference_record))}</td>
      <td>${escapeHtml(format(profiles[second.value]?.conference_record))}</td></tr>
      ${metrics.map(([key, label, direction, unit]) => {
        const a = metric(profiles[first.value], key);
        const b = metric(profiles[second.value], key);
        const winner = advantage(a, b, direction);
        return `<tr><th scope="row">${label}</th><td class="${winner === 1 ? 'stat-advantage' : ''}">${format(a, unit)}</td>
          <td class="${winner === -1 ? 'stat-advantage' : ''}">${format(b, unit)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }
  first.addEventListener('change', compare);
  second.addEventListener('change', compare);
  compare();
}
