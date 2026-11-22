import {loadProfiles, escapeHtml as esc, profileHref} from './team-profiles.mjs';
import {collectSchedule, decodeScenario, encodeScenario, MAJORS, GROUP, NOTRE_DAME, scenarios} from './playoff-model.mjs';

import {loadPredictions} from './game-predictions.mjs';

const PROTOCOL = 'https://collegefootballplayoff.com/sports/2016/10/24/selection-committee-protocol';
const OFFICIAL = 'https://collegefootballplayoff.com/sports/2026/8/9/bracket-place-holder';

async function json(path) {
  const response = await fetch(new URL(path, import.meta.url), {cache:'no-cache'});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const formatDate = value => new Date(value).toLocaleDateString(undefined, {month:'short', day:'numeric'});
const record = row => row.wins + '–' + row.losses + (row.ties ? '–' + row.ties : '');
const percentage = row => row.wins + row.losses + row.ties ? record(row) : 'N/A';
const empty = '<option value="">Choose winner</option>';
const sourceError = '<p class="notice" role="alert">Scenario data could not load. Reload to try again.</p>';
const textOption = (key, text, active) => `<option value="${esc(key)}" ${key === active ? 'selected' : ''}>${esc(text)}</option>`;

async function scenarioData(dashboard) {
  const [profiles, power, titleData, official, predictions] = await Promise.all([
    loadProfiles(),
    json('./data/power-rankings/latest.json').catch(() => null),
    json('./data/cfp-title-games.json').catch(() => null),
    json('./data/cfp-official-bracket.json').catch(() => null),
    loadPredictions().catch(() => null),
  ]);
  const teams = new Map(dashboard.teams.map(team => [String(team.id), team]));
  const cfp = power?.season === 2026 ? power.polls?.cfp : null;
  const fixtures = titleData?.season === 2026 ? titleData.games ?? {} : {};
  const events = collectSchedule(profiles, teams, fixtures);
  return {teams,events,fixtures,ranks:cfp?.ranks ?? {},official,cfp,titleData,predictions};
}

export async function mountNotreDamePlayoff(panel, dashboard, isCurrent) {
  if (dashboard.season !== 2026) {
    panel.textContent = '2026 scenario data is unavailable.';
    return;
  }
  panel.textContent = 'Loading Notre Dame playoff scenarios…';
  let context;
  try {
    context = await scenarioData(dashboard);
  } catch {
    if (isCurrent()) panel.innerHTML = sourceError;
    return;
  }
  if (!isCurrent()) return;
  const now = Date.now();
  const games = context.events.filter(game => game.scheduled && Date.parse(game.date) > now &&
    game.teams.includes(NOTRE_DAME));
  panel.innerHTML = `<p class="muted">Choose an outcome to see its effect under the explorer’s selection assumptions.</p>
    ${games.map(game => `<label class="playoff-pick">${esc(game.teams.map(id => game.names[id]).join(' vs. '))}
      <select data-nd-scenario-game="${esc(game.id)}">${empty}
      ${game.teams.map(id => textOption(id,game.names[id],null)).join('')}</select></label>`).join('')}
    <p class="nd-playoff-result" role="status"></p><a class="nd-playoff-link" href="#playoff?team=87">Open full Playoff Explorer</a>
    <div class="nd-simulator"></div>`;
  function render() {
    const input = decodeScenario('');
    for (const select of panel.querySelectorAll('[data-nd-scenario-game]')) input.games[select.dataset.ndScenarioGame] = select.value;
    const projection = scenarios(context,input,now);
    const seed = projection.field.find(row => row.id === NOTRE_DAME);
    const nd = projection.rows.get(NOTRE_DAME);
    panel.querySelector('.nd-playoff-result').textContent = (seed ? (projection.isOfficial ? 'Official' : 'Projected') + ' seed ' + seed.seed
      : projection.isOfficial ? 'Outside the official field' : projection.order.length ? 'Outside the current scenario field' : 'Projection unavailable')
      + (nd ? ' · Record ' + percentage(nd.overall) : '') + '.';
    panel.querySelector('.nd-playoff-link').href = encodeScenario(projection.used,NOTRE_DAME);
    panel.querySelector('.nd-simulator').dispatchEvent(new Event('scenariochange'));
  }
  panel.addEventListener('change', event => {
    if (event.target.matches('[data-nd-scenario-game]')) render();
  });
  render();
  const target = panel.querySelector('.nd-simulator');
  import('./playoff-simulator-ui.mjs').then(module => module.mountSimulator(target,
    () => decodeScenario(panel.querySelector('.nd-playoff-link').hash), {focus:NOTRE_DAME,fixedTeam:true,isCurrent}))
    .catch(() => { if (isCurrent()) target.textContent = 'Playoff simulation unavailable.'; });
}

export async function mountPlayoff(panel, dashboard, isCurrent) {
  panel.playoffSignal?.abort();
  const controller = new AbortController();
  panel.playoffSignal = controller;
  if (dashboard.season !== 2026) {
    panel.innerHTML = '<p class="notice">This explorer covers the 2026 season. Current-season inputs are unavailable.</p>';
    return;
  }
  let context;
  try {
    context = await scenarioData(dashboard);
  } catch (error) {
    if (isCurrent()) panel.innerHTML = sourceError;
    console.error(error);
    return;
  }
  if (!isCurrent()) return;
  const {teams,events,cfp,titleData,official,predictions} = context;
  const archivedForecasts = new Set((predictions?.rows ?? []).filter(row =>
    row.prediction && !row.is_preview).map(row => row.id));
  const name = id => teams.get(id)?.name ?? 'Opponent TBD';
  const teamLink = id => teams.has(id) ? `<a href="${profileHref(id)}">${esc(name(id))}</a>` : esc(name(id));
  const now = Date.now();
  let input = decodeScenario(location.hash);
  let filter = input.team ? 'notre-dame' : 'all';
  let conference = input.team ? 'Independent' : MAJORS[0];

  panel.innerHTML = `<div class="panel-head"><h2>College Football Playoff Scenario Explorer</h2></div>
    <p class="notice">2026–27 · Saturday HQ scenarios. These are conditional brackets and selections with no playoff probabilities.
      <a href="${PROTOCOL}">Official CFP rules</a> · <a href="${OFFICIAL}">Official CFP bracket and sites</a></p>
    <div class="profile-section playoff-toolbar">
      <a class="playoff-open-simulator" href="#simulator">Open Playoff Simulator</a>
      <button type="button" data-scenario-action="reset">Reset scenario</button>
      <button type="button" data-scenario-action="share">Copy scenario link</button>
      <label>Shareable URL<input class="playoff-link" readonly aria-label="Shareable scenario URL"></label>
      <span class="muted playoff-feedback" role="status"></span>
    </div>
    <section class="profile-section playoff-nd"></section>
    <section class="profile-section">
      <h3>12-Team Bracket</h3>
      <p class="muted playoff-source"></p><div class="playoff-bracket"></div>
    </section>
    <section class="profile-section">
      <h3>Conference Championships</h3>
      <p class="muted">ESPN-confirmed finalists take priority. Other matchups use the provisional standings below.
      Unpicked winners remain pending. Only the four named conference champions receive a champion automatic bid.</p>
      ${!titleData || titleData.unavailable_dates?.length ? '<p class="notice">Some ESPN title fixture data is unavailable. Saved verified results are used when present.</p>' : ''}
      <div class="playoff-titles"></div>
    </section>
    <section class="profile-section"><h3>Pick Regular-Season Results</h3>
      <label>Filter games<select class="playoff-filter">
        <option value="all">All scheduled games</option><option value="notre-dame">Notre Dame</option>
        ${[...MAJORS,...GROUP].map(item => textOption(item,item,filter)).join('')}
      </select></label>
      <div class="playoff-events"></div>
    </section>
    <section class="profile-section"><h3>Projected Standings</h3>
      <p class="muted">Records show ESPN finals and your picks. Unresolved or missing results add no wins or losses.
      Same-conference games count as league play when the schedule omits classification. Title games are excluded.</p>
      <label>View standings<select class="playoff-conference">
        ${[...MAJORS,...GROUP,'Independent'].map(item => textOption(item,item,conference)).join('')}
      </select></label>
      <div class="playoff-standings"></div>
    </section>
    <section class="profile-section"><h3>Published CFP Rankings</h3>
      <p class="muted">${cfp ? 'CFP committee Top 25 · ESPN feed · ' + esc(cfp.date.slice(0,10)) : 'Current official CFP rankings unavailable.'}</p>
      ${cfp ? `<ol class="playoff-poll">${Object.entries(cfp.ranks).sort(([,a],[,b]) => a-b).map(([id,rank]) =>
        `<li value="${rank}">${teamLink(id)}</li>`).join('')}</ol>` : ''}
    </section>
    <section class="profile-section"><details class="playoff-sim-details">
      <summary>Monte Carlo Playoff Simulator</summary><div class="playoff-sim-target"></div>
    </details></section>
    <section class="profile-section">
      <h3>Scenario Assumptions</h3>
      <p>The latest published CFP order anchors the projection. Unranked teams start after No. 25 in verified/picked overall
      record order. A selected win improves the starting position by two points and a loss costs three. Verified finals update
      standings. Committee votes, injuries, and changes after the latest poll are outside this ranking heuristic.</p>
      <p>Provisional conference order uses conference win percentage, head-to-head when the full tied group has played,
      then published CFP rank and overall record. Official conference tiebreakers, divisions, and eligibility can produce
      different matchups. Seats are held for unresolved automatic bids, so provisional seeds can move.</p>
      <p>Saturday HQ’s audit found that Power Rankings trailed simple baselines and Game Predictions has yet to
      show a meaningful advantage. This explorer uses explicit winner choices and offers no statistical odds.
      <a href="https://github.com/jcmor87/college-football-dashboard/blob/main/AUDIT.md">Version 2.0 audit</a></p>
    </section>`;

  const selector = panel.querySelector('.playoff-filter');
  selector.value = filter;
  const render = () => {
    const state = scenarios(context,input,now);
    input = {...state.used,team:input.team};
    const next = encodeScenario(input,input.team);
    if (next !== location.hash) history.replaceState(history.state,'',next);
    panel.querySelector('.playoff-link').value = location.href;
    panel.querySelector('.playoff-open-simulator').href = next.replace(/^#playoff/,'#simulator');
    panel.querySelector('.playoff-sim-target').dispatchEvent(new Event('scenariochange'));

    const nd = state.rows.get(NOTRE_DAME);
    const seed = state.field.find(row => row.id === NOTRE_DAME);
    const projected = state.order.indexOf(NOTRE_DAME) + 1;
    panel.querySelector('.playoff-nd').innerHTML = nd ? `<h3>Notre Dame Playoff Path</h3>
      <p><strong>${seed ? (state.isOfficial ? 'Official seed ' : 'Projected seed ') + seed.seed :
        state.isOfficial ? 'Outside the official field' : projected ? 'Outside the current scenario field' : 'Projection unavailable'}</strong> ·
      ${percentage(nd.overall)} with ${nd.overall.unknown} unresolved listed games · ${cfp?.ranks[NOTRE_DAME] ? 'Published CFP No. ' + cfp.ranks[NOTRE_DAME] : 'Published CFP rank unavailable'}</p>
      <p class="muted">${projected && !state.isOfficial ? 'Projected committee position ' + projected + '. ' : ''}
      A final committee rank in the top 12 guarantees Notre Dame a berth.</p>` : '';
    panel.querySelector('.playoff-source').innerHTML = state.isOfficial
      ? 'Official seeds · ' + esc(official.published_at.slice(0,10)) + '. Any winner you choose is a scenario.'
      : `Saturday HQ projected bracket · Official selections pending. Selection Day is Dec. 6.
         <a href="${OFFICIAL}">CFP bracket and game sites</a>. Seeds 1–4 receive byes and sites follow CFP bowl selections.`;
    panel.querySelector('.playoff-bracket').innerHTML = state.bracket.rounds.map((round,index) =>
      `<section class="playoff-round"><h4>${['First Round · Higher seed hosts','Quarterfinals','Semifinals','Championship'][index]}</h4>
      ${round.map(game => `<div class="playoff-match">
        ${game.teams.map((team,i) => `<div>${team ? `<strong>${team.seed}</strong> ${teamLink(team.id)}
          <small>${esc(team.reason)}</small>` : typeof game.feeds[i] === 'number' ? 'Seed ' + game.feeds[i] + ' · Pending'
          : 'Awaiting earlier winner'}</div>`).join('')}
        ${game.official ? '<p>Official winner: ' + esc(name(game.winner.id)) + '</p>'
          : game.match ? `<label>Advance a team<select data-kind="bracket" data-id="${game.id}">${empty}
          ${game.teams.map(team => textOption(game.match+':'+team.id,name(team.id),input.bracket[game.id])).join('')}</select></label>` : ''}
      </div>`).join('')}</section>`).join('');
    panel.querySelector('.playoff-titles').innerHTML = Object.entries(state.titles).map(([key,title]) =>
      `<div class="playoff-match"><h4>${esc(key)}</h4>
      <p class="muted">${title.confirmed ? 'ESPN-listed matchup' : 'Projected matchup'} ·
      ${title.participants.map(id => esc(name(id))).join(' vs. ') || 'Participants unavailable'}</p>
      ${title.actual ? '<p>Verified champion: ' + esc(name(title.winner)) + '</p>'
        : title.open ? `<label>Title winner<select data-kind="titles" data-id="${esc(key)}">${empty}
        ${title.participants.map(id => textOption(title.match+':'+id,name(id),input.titles[key])).join('')}</select></label>`
        : '<p class="muted">Winner pending.</p>'}</div>`).join('');

    const available = events.filter(game => game.scheduled && Date.parse(game.date) > now &&
      (filter === 'all' || (filter === 'notre-dame' ? game.teams.includes(NOTRE_DAME) :
        game.teams.some(id => teams.get(id)?.conference === filter))));
    panel.querySelector('.playoff-events').innerHTML = available.length ? available.map(game =>
      `<label class="playoff-pick">${esc(game.teams.map(id => game.names[id]).join(' vs. '))} · ${formatDate(game.date)}
      <select data-kind="games" data-id="${esc(game.id)}">${empty}
      ${game.teams.map(id => textOption(id,game.names[id],input.games[game.id])).join('')}</select>
      ${archivedForecasts.has(game.id) ? '<small class="muted">Archived game estimate in <a href="#predictions">Game Predictions</a></small>' : ''}</label>`).join('')
      : '<p class="muted">No verified remaining games match this filter.</p>';
    const standings = state.standings[conference] ?? [...state.rows.values()].filter(row => teams.get(row.id)?.conference === conference);
    panel.querySelector('.playoff-standings').innerHTML = `<div class="history-scroll" tabindex="0" aria-label="Projected standings"><table class="history-table">
      <thead><tr><th>Team</th><th>Overall</th><th>Conference</th><th>Unresolved games</th></tr></thead>
      <tbody>${standings.map(row => `<tr><th scope="row">${teamLink(row.id)}${row.provisionalTie ? '<small>Provisional tiebreak</small>' : ''}</th>
        <td>${percentage(row.overall)}</td><td>${percentage(row.conference)}</td><td>${row.overall.unknown}</td></tr>`).join('')}</tbody></table></div>`;
  };

  panel.addEventListener('change', event => {
    const select = event.target;
    if (select === selector) filter = select.value;
    else if (select.classList.contains('playoff-conference')) conference = select.value;
    else if (['games','titles','bracket'].includes(select.dataset.kind)) {
      const choices = input[select.dataset.kind];
      if (select.value) choices[select.dataset.id] = select.value;
      else delete choices[select.dataset.id];
    } else return;
    const kind = select.dataset.kind;
    const id = select.dataset.id;
    render();
    if (kind) [...panel.querySelectorAll('select[data-kind]')].find(item =>
      item.dataset.kind === kind && item.dataset.id === id)?.focus({preventScroll:true});
  }, {signal:controller.signal});

  panel.addEventListener('click', async event => {
    const action = event.target.dataset.scenarioAction;
    if (action === 'reset') {
      input = {...decodeScenario(''),team:input.team};
      render();
      panel.querySelector('.playoff-feedback').textContent = 'Scenario reset.';
    } else if (action === 'share') {
      const link = panel.querySelector('.playoff-link');
      try {
        await navigator.clipboard.writeText(link.value);
        panel.querySelector('.playoff-feedback').textContent = 'Link copied.';
      } catch {
        link.select();
        panel.querySelector('.playoff-feedback').textContent = 'Copy the selected URL.';
      }
    }
  }, {signal:controller.signal});
  const simulator = panel.querySelector('.playoff-sim-details');
  simulator.addEventListener('toggle',() => {
    if (!simulator.open || simulator.dataset.loaded) return;
    simulator.dataset.loaded = 'true';
    const target = simulator.querySelector('.playoff-sim-target');
    import('./playoff-simulator-ui.mjs').then(module => module.mountSimulator(
      target,() => input,{focus:input.team ?? undefined,isCurrent,signal:controller.signal}))
      .catch(() => { if (isCurrent()) target.textContent = 'Playoff simulation unavailable.'; });
  });
  render();
}
