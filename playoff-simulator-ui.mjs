import {escapeHtml as esc} from './team-profiles.mjs';
import {NOTRE_DAME} from './playoff-model.mjs';
import {COUNTS, VERSION} from './playoff-simulation.mjs';

const number = value => Number(value).toLocaleString();
const pct = value => value == null ? 'N/A' : (100 * value).toFixed(1) + '%';
const delta = (a,b) => a == null || b == null ? '—'
  : ((b-a) > 0 ? '+' : '') + ((b-a)*100).toFixed(1) + ' pp';
const fraction = (report,id,key,seed) => {
  const divisor = report?.denominators[seed == null ? key : 'qualification'];
  const numerator = seed == null ? report?.teams[id]?.[key] : report?.teams[id]?.seeds[seed];
  return divisor && numerator != null ? numerator / divisor : null;
};
const namedMetrics = [
  ['qualification','Playoff qualification'], ['semifinal','Reach semifinal'],
  ['final','Reach championship game'], ['title','Win national title'],
];
let snapshotRequest;

function loadSnapshot() {
  snapshotRequest ??= fetch(new URL('./data/playoff-simulation.json',import.meta.url),{cache:'no-cache'})
    .then(response => {
      if (!response.ok) throw new Error('Simulation snapshot unavailable');
      return response.json();
    }).then(data => {
      if (data.input?.version !== VERSION || !COUNTS.every(count => data.baseline?.[count]?.count === count)) {
        throw new Error('Simulation snapshot does not match this release');
      }
      return data;
    }).catch(error => {
      snapshotRequest = null;
      throw error;
    });
  return snapshotRequest;
}

function anyPicks(choices) {
  return ['games','titles','bracket'].some(kind => Object.keys(choices[kind] ?? {}).length);
}

function results(base, scenario, id, choices) {
  const sample = report => report ? ['qualification','semifinal','final','title']
    .map((key,index) => `${number(report.denominators[key])} ${['fields','semifinal draws','final draws','titles'][index]}`).join(' · ') : 'Run a scenario to compare.';
  const altBase = fraction(base,id,'alternate');
  const altScenario = fraction(scenario,id,'alternate');
  const conditioned = scenario ? ['titles','bracket'].flatMap(kind => Object.keys(choices[kind] ?? {})
    .map(key => `${esc(key)}: ${number(scenario.honored[kind][key] ?? 0)} / ${number(scenario.count)} draws`)) : [];
  return `<p class="muted">Baseline resolved: ${sample(base)}.</p>
    <p class="muted">Scenario resolved: ${sample(scenario)}</p>
    <div class="history-scroll" tabindex="0" aria-label="Playoff probabilities">
      <table class="history-table"><thead><tr><th>Outcome</th><th>Baseline</th><th>Scenario</th><th>Change</th></tr></thead>
      <tbody>${namedMetrics.map(([key,label]) => {
        const before = fraction(base,id,key);
        const after = fraction(scenario,id,key);
        return `<tr><th scope="row">${label}</th><td>${pct(before)}</td><td>${pct(after)}</td><td>${delta(before,after)}</td></tr>`;
      }).join('')}</tbody></table>
    </div>
    <h4>Seed Distribution</h4>
    <p class="muted">Shares use all complete-field draws, including draws when the team missed the field.</p>
    <div class="history-scroll" tabindex="0" aria-label="Playoff seed distribution"><table class="history-table">
      <thead><tr><th>Seed</th><th>Baseline</th><th>Scenario</th><th>Change</th></tr></thead><tbody>
      ${Array.from({length:12},(_,seed) => {
        const before = fraction(base,id,'qualification',seed);
        const after = fraction(scenario,id,'qualification',seed);
        return `<tr><th scope="row">${seed+1}</th><td>${pct(before)}${before != null ? ` <meter min="0" max="1" value="${before}" aria-label="Baseline seed ${seed+1}"></meter>` : ''}</td>
          <td>${pct(after)}</td><td>${delta(before,after)}</td></tr>`;
      }).join('')}</tbody></table></div>
    <h4>Committee Sensitivity</h4>
    <p>Without the outcome-based rank adjustment, playoff qualification is <strong>${pct(altBase)}</strong> baseline
    ${scenario ? 'and <strong>' + pct(altScenario) + '</strong> under this scenario' : ''}.
    ${base.official ? 'The official field is locked.' : 'Both policies use the same sampled results. The difference reflects the selection assumption.'}</p>
    <p class="muted">${number(base.neutralTitleDraws)} baseline draws used a zero venue adjustment for at least one title fixture without a matching forecast.</p>
    ${scenario ? `<p class="muted">${scenario.coverage.forced} regular-season picks applied in every draw.</p>` : ''}
    ${conditioned.length ? '<p class="muted">Title and bracket choices apply when that matchup occurs. Applied: ' + conditioned.join(' · ') + '.</p>' : ''}`;
}

export async function mountSimulator(panel, getChoices, {focus, fixedTeam = false, isCurrent, signal, explorerHref} = {}) {
  panel.innerHTML = '<p class="notice" role="status">Loading precomputed simulations…</p>';
  let snapshot;
  try {
    snapshot = await loadSnapshot();
  } catch (error) {
    if (!signal?.aborted && isCurrent?.() !== false) panel.innerHTML = '<p class="notice" role="alert">Playoff simulation data unavailable. Reload to try again.</p>';
    console.error(error);
    return;
  }
  if (signal?.aborted || isCurrent?.() === false) return;
  const {input,baseline,fingerprint} = snapshot;
  const teams = [...input.teams].sort(([,a],[,b]) => a.name.localeCompare(b.name));
  const defaultTeam = focus ?? NOTRE_DAME;
  const coverage = baseline[1000].coverage;
  panel.innerHTML = `<h3>${fixedTeam ? 'Notre Dame Playoff Probabilities' : 'Monte Carlo Playoff Simulator'}</h3>
    <p class="notice">Experimental estimates, conditional on available inputs and the stated selection policy.
      The audit found that Power Rankings trailed simple baselines and game forecasts have yet to establish a predictive advantage.
      <a href="https://github.com/jcmor87/college-football-dashboard/blob/main/AUDIT.md">Version 2.0 audit</a></p>
    <p class="muted">Simulation ${esc(input.version)} · Model ${esc(input.predictionModel)} · Snapshot ${esc(fingerprint)} ·
    Seed ${input.seed} · Rating cutoff ${esc(input.cutoff)} · Inputs recorded ${esc(new Date(input.asOf).toISOString())}.</p>
    ${baseline[1000].official ? '<p class="notice">Official CFP field locked. Unplayed playoff rounds are simulated.</p>'
      : baseline[1000].unavailable ? '<p class="notice">Qualification estimates are pending the required CFP ranking or official seed data.</p>' : ''}
    <p class="muted">${coverage.modeled} scheduled games with model probabilities, ${coverage.unresolved} scheduled without,
    ${coverage.otherUnresolved} other listed unresolved games, and ${coverage.staleSchedules} stale or unavailable team schedules.
    ${input.missingTitleDates.length ? 'Some title fixture dates were unavailable. ' : ''}
    Unmodeled games remain unresolved unless a valid winner is selected.</p>
    ${explorerHref ? `<p><a href="${esc(explorerHref)}">Choose or edit outcomes in Playoff Explorer</a></p>` : ''}
    <div class="profile-controls simulator-controls">
      <label>Simulated seasons<select class="sim-count">${COUNTS.map(count => `<option value="${count}">${number(count)}</option>`).join('')}</select></label>
      ${fixedTeam ? '' : `<label>Team<select class="sim-team">${teams.map(([id,team]) =>
        `<option value="${esc(id)}">${esc(team.name)}</option>`).join('')}</select></label>`}
      <button type="button" class="sim-run">Run what-if comparison</button>
    </div>
    <p class="muted sim-status" role="status"></p><div class="sim-results"></div>
    <details><summary>Simulation methodology</summary><p>Independent game draws use archived matchup probabilities when available.
    Projected title matchups use the prediction formula with a zero venue adjustment when no matching forecast exists.
    The higher seed hosts in round one. Later playoff rounds use a neutral venue. Verified official seeds and winners take priority.
    Selections use the explorer's disclosed rules. The alternate policy drops the scenario rank-point adjustments while
    keeping the unranked records fallback and the same automatic bids. Committee uncertainty is presented as sensitivity between
    these fixed policies. Neither policy estimates how the committee will vote. Only resolved draws enter each probability.</p></details>`;

  const size = panel.querySelector('.sim-count');
  const team = panel.querySelector('.sim-team');
  const run = panel.querySelector('.sim-run');
  const status = panel.querySelector('.sim-status');
  if (team) team.value = defaultTeam;
  let worker, scenario, signature;
  const stop = () => { worker?.terminate(); worker = null; };
  signal?.addEventListener('abort',stop,{once:true});
  const draw = () => {
    const base = baseline[size.value];
    panel.querySelector('.sim-results').innerHTML = results(base,scenario,team?.value ?? defaultTeam,getChoices());
  };
  const refresh = () => {
    const key = JSON.stringify([size.value,getChoices()]);
    if (key === signature) return;
    signature = key;
    stop();
    scenario = null;
    status.textContent = anyPicks(getChoices()) ? 'Scenario picks ready. Run the comparison.' : explorerHref ? 'Choose outcomes in Playoff Explorer to run a comparison.' : 'Choose an outcome above to compare against the baseline.';
    run.disabled = !anyPicks(getChoices());
    draw();
  };
  panel.addEventListener('scenariochange',refresh);
  size.addEventListener('change',refresh);
  team?.addEventListener('change',draw);
  run.addEventListener('click',() => {
    stop();
    const choices = getChoices();
    const count = Number(size.value);
    if (!anyPicks(choices)) return;
    try {
      worker = new Worker(new URL('./playoff-worker.mjs',import.meta.url),{type:'module'});
    } catch {
      status.textContent = 'This browser could not start a simulation worker. The precomputed baseline is still available.';
      return;
    }
    run.disabled = true;
    status.textContent = 'Running what-if simulation…';
    const finish = () => {stop(); run.disabled = false;};
    worker.onmessage = ({data}) => {
      if (!panel.isConnected || isCurrent?.() === false) {stop(); return;}
      if (data.result) {
        scenario = data.result;
        status.textContent = `Scenario complete: ${number(scenario.count)} draws.`;
        finish();
        draw();
      } else if (data.error) {
        status.textContent = 'Simulation failed. Try again.';
        finish();
      } else {
        status.textContent = `Simulated ${number(data.completed)} of ${number(count)} seasons…`;
      }
    };
    worker.onerror = () => {
      status.textContent = 'The simulation worker could not load. The baseline is still available.';
      finish();
    };
    worker.postMessage({input,choices,count});
  });
  refresh();
}
