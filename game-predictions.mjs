import {escapeHtml} from './team-profiles.mjs';

let request;
export function loadPredictions() {
  request ??= fetch(new URL('./data/predictions/latest.json', import.meta.url), {cache:'no-cache'})
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }).then(snapshot => {
      if (snapshot.season !== 2026 || !Array.isArray(snapshot.rows) || !snapshot.live || !snapshot.backtest) {
        throw new Error('Invalid prediction snapshot');
      }
      return snapshot;
    }).catch(error => {
      request = null;
      throw error;
    });
  return request;
}

const pct = value => value == null ? 'N/A' : (100 * value).toFixed(1) + '%';
const value = (number, precision = 1) => number == null ? 'N/A' : number.toFixed(precision);
const isoDay = text => text?.slice(0, 10) ?? 'N/A';
const time = text => new Date(text).toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'});

export function forecastLabel(prediction, first, second) {
  if (prediction.probability === .5) return {team:'Even matchup', chance:pct(.5)};
  return prediction.probability > .5
    ? {team:first, chance:pct(prediction.probability)}
    : {team:second, chance:pct(1 - prediction.probability)};
}

export function predictionCard(row, directory, showHistory = true) {
  const first = escapeHtml(directory.get(row.first)?.name ?? 'Team ' + row.first);
  const second = escapeHtml(directory.get(row.second)?.name ?? 'Team ' + row.second);
  const p = row.prediction;
  const label = p ? forecastLabel(p, first, second) : null;
  const venue = row.venue === 1 ? first + ' home' : row.venue === -1 ? second + ' home'
    : row.venue === 0 ? 'Neutral site' : 'Venue unavailable';
  const favored = (points, positive, negative) => points === 0 ? 'Even'
    : (points > 0 ? positive : negative) + ' by ' + value(Math.abs(points));
  const archive = showHistory && row.history?.length ? `<details>
    <summary>${row.history.length} archived revision${row.history.length === 1 ? '' : 's'}</summary>
    <ul>${row.history.map(revision => `<li>${time(revision.at)} · ${escapeHtml(revision.model)} ·
      ${first} win probability ${pct(revision.probability)} · ${favored(revision.margin, first, second)}${revision.selected ? ' · Selected pregame forecast' : ''}</li>`).join('')}</ul>
    </details>` : '';
  return `<article class="prediction-game">
    <h4>${first} vs. ${second}</h4><p class="muted">${time(row.kickoff)} · ${venue} · ${escapeHtml(row.status)}</p>
    ${p ? `<p><strong>${label.team} · ${label.chance}</strong> · Expected margin: ${favored(p.margin, first, second)}
      · ${escapeHtml(p.confidence)} confidence</p>
      <p class="muted">${row.is_preview ? 'Preview estimate' : 'Archived pregame estimate'} · Data cutoff ${isoDay(p.input_cutoff)} UTC
      ${p.generated_at ? '· Issued ' + time(p.generated_at) : ''}</p>
      <p class="muted">Rating gap effect: ${favored(p.rating_points, first, second)} points.
      Venue effect: ${p.venue_points ? favored(p.venue_points, first, second) + ' points' : '0 points'}.
      ${first} win chance ${pct(p.probability)} · ${second} win chance ${pct(1 - p.probability)}.</p>`
      : '<p class="muted">No verified pregame forecast available.</p>'}
    ${row.actual ? `<p><strong>Final</strong> · ${first} ${row.actual.first}–${row.actual.second} ${second}</p>` : ''}
    ${archive}</article>`;
}

function comparison(report) {
  const entries = [['Saturday HQ', report.engine], ['Home-field only', report.home], ['Raw scoring margin', report.raw_margin]];
  return `<div class="history-scroll" tabindex="0" aria-label="Evaluation metrics"><table class="history-table">
    <thead><tr><th>Model</th><th>Games</th><th>Winner accuracy</th><th>Margin MAE</th><th>Brier score</th></tr></thead>
    <tbody>${entries.map(([name, row]) => `<tr><th scope="row">${name}</th><td>${row.games}</td><td>${pct(row.accuracy)}</td>
      <td>${value(row.mae, 2)}</td><td>${value(row.brier, 4)}</td></tr>`).join('')}</tbody></table></div>`;
}

function bars(label, rows) {
  return `<figure class="prediction-chart"><figcaption>${label}</figcaption>
  ${rows.length ? `<ul>${rows.map(row => `<li><span>${row.label}</span>
    ${row.series.map(([name, amount]) =>
      `<div class="prediction-bar"><span>${name}: ${pct(amount)}</span><meter min="0" max="1" value="${amount ?? 0}"
        aria-label="${name}, ${pct(amount)}"></meter></div>`).join('')}</li>`).join('')}</ul>`
    : '<p class="muted">No scored forecasts in this sample.</p>'}</figure>`;
}

function reportView(report) {
  return comparison(report)
    + bars('Winner accuracy by kickoff week', report.weeks.map(week => ({
      label: week.week + ' UTC · ' + week.games + ' games', series:[['Accuracy', week.accuracy]],
    })))
    + bars('Calibration by first-listed team win probability', report.engine.calibration.map(bin => ({
      label: bin.bin + ' · ' + bin.games + ' games',
      series:[['Mean forecast', bin.expected], ['Observed win rate', bin.observed]],
    })));
}

export async function mountPredictions(panel, teams, isCurrent) {
  const data = await loadPredictions();
  if (!isCurrent()) return;
  const directory = new Map(teams.map(team => [String(team.id), team]));
  const weeks = [...new Set(data.rows.map(row => row.week))].sort();
  const conferences = [...new Set(teams.map(team => team.conference).filter(Boolean))].sort();
  panel.innerHTML = `<div class="panel-head"><h2>Game Predictions</h2></div>
    <p class="notice">Statistical estimates · ${escapeHtml(data.fitting.status)} · Data cutoff ${isoDay(data.input_cutoff)} UTC.
    Confidence labels describe the size of the estimated edge.</p>
    <p class="notice">Margin model: ${value(data.parameters.rating_points, 3)} points per rating point and
    ${value(data.parameters.home_points, 2)} points for home field. Neutral sites get zero venue adjustment.
    <a href="https://github.com/jcmor87/college-football-dashboard#game-prediction-methodology">Methodology</a></p>
    <section class="profile-section"><h3>Matchups</h3>
    <div class="profile-controls prediction-controls">
      <label>Week<select class="prediction-week"><option value="">All weeks</option>
        ${weeks.map(week => `<option>${week}</option>`).join('')}</select></label>
      <label>Conference<select class="prediction-conference"><option value="">All conferences</option>
        ${conferences.map(conference => `<option>${escapeHtml(conference)}</option>`).join('')}</select></label>
      <label>Team<input type="search" class="prediction-search" placeholder="Name or abbreviation"></label>
    </div><div class="prediction-matches"></div></section>
    <section class="profile-section"><h3>Accuracy Dashboard</h3>
    <label class="prediction-controls">Evaluation sample<select class="prediction-mode">
      <option value="live">Archived live forecasts</option><option value="backtest">Historical holdout</option></select></label>
    <p class="muted">The historical holdout follows the training and calibration periods.
    Live results use the selected archived forecast issued before kickoff. Lower MAE and Brier score are better.</p>
    <div class="prediction-report"></div></section>`;
  const week = panel.querySelector('.prediction-week');
  const conference = panel.querySelector('.prediction-conference');
  const search = panel.querySelector('.prediction-search');
  const mode = panel.querySelector('.prediction-mode');
  const upcoming = data.rows.find(row => row.status === 'Scheduled' && Date.parse(row.kickoff) > Date.now());
  if (upcoming) week.value = upcoming.week;
  function showMatches() {
    const query = search.value.trim().toLowerCase();
    const rows = data.rows.filter(row => !week.value || row.week === week.value)
      .filter(row => [row.first, row.second].some(id => {
        const team = directory.get(id);
        return (!conference.value || team?.conference === conference.value)
          && (!query || (team?.name + ' ' + (team?.abbreviation ?? '')).toLowerCase().includes(query));
      }));
    panel.querySelector('.prediction-matches').innerHTML = rows.length
      ? rows.map(row => predictionCard(row, directory)).join('')
      : '<p class="muted">No games match these filters.</p>';
  }
  function showReport() {
    const context = mode.value === 'backtest'
      ? `<p class="muted">${data.fitting.train} training games · ${data.fitting.calibration} calibration games
         ${data.fitting.holdout_start ? '· Holdout starts ' + isoDay(data.fitting.holdout_start) + ' UTC' : ''}</p>`
      : '';
    panel.querySelector('.prediction-report').innerHTML = context + reportView(data[mode.value]);
  }
  week.addEventListener('change', showMatches);
  conference.addEventListener('change', showMatches);
  search.addEventListener('input', showMatches);
  mode.addEventListener('change', showReport);
  showMatches();
  showReport();
}
