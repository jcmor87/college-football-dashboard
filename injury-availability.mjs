import {escapeHtml, shortDate} from './team-profiles.mjs';

const NOTRE_DAME = '87';
const reportAgeLimit = 72 * 60 * 60 * 1000;
const snapshotAgeLimit = 9 * 60 * 60 * 1000;
const labels = {
  confirmed_out: 'Confirmed out',
  doubtful: 'Doubtful',
  questionable: 'Questionable',
  probable: 'Probable / expected available',
  confirmed_available: 'Confirmed available',
  unknown: 'Unknown',
};
const groups = [['offense', 'Offense'], ['defense', 'Defense'], ['special teams', 'Special Teams'], ['other', 'Other']];

export function gameReports(snapshot, season, game) {
  const entry = snapshot?.schema_version === 1 && snapshot.season === season ? snapshot.games?.[game.id] : null;
  return entry && entry.opponent_id === game.opponent_id && Date.parse(entry.kickoff) === Date.parse(game.date)
    ? entry.teams : null;
}

export function freshness(snapshot, team, game, now = Date.now()) {
  const kickoff = Date.parse(game.date);
  const historical = game.final || kickoff <= now;
  const report = team?.latest_report_timestamp;
  // Date-only reports refer to an Eastern calendar day. Using the start of the
  // reported day for the age check is conservative when the exact time is absent.
  const reportAt = Date.parse(report);
  const generatedAt = Date.parse(snapshot?.generated_at);
  return {
    historical,
    staleReport: Number.isFinite(reportAt) && Math.min(now, kickoff) - reportAt > reportAgeLimit,
    staleSnapshot: snapshot?.refresh_status === 'stale' ||
      !Number.isFinite(generatedAt) || now - generatedAt > snapshotAgeLimit,
  };
}

function sourceLink(url, name) {
  try {
    const source = new URL(url);
    if (source.protocol === 'https:' && !source.username && !source.password) {
      return `<a href="${escapeHtml(source.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>`;
    }
  } catch {
    // Display the attribution as text if the source link is malformed.
  }
  return escapeHtml(name);
}

function dateLabel(value) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return 'Date unavailable';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Date(stamp).toLocaleString(undefined, dateOnly
    ? {dateStyle: 'medium', timeZone: 'UTC'}
    : {dateStyle: 'medium', timeStyle: 'short'});
}

function reportLine(report) {
  return `${sourceLink(report.source_url, report.source_name)} · ${escapeHtml(report.source_status)} ·
    ${dateLabel(report.report_timestamp)}`;
}

function teamCard(name, team, snapshot, game) {
  if (!Array.isArray(team?.players)) return `<section><h4>${escapeHtml(name)}</h4><p>No verified report available.</p></section>`;
  const status = freshness(snapshot, team, game);
  const statusText = status.historical ? 'Historical pregame reports · Partial coverage' : 'Partial coverage';
  const count = team.confirmed_out_count;
  const reportGroups = groups.map(([key, label]) => {
    const players = team.players.filter(player => player?.position_group === key);
    if (!players.length) return '';
    return `<h5>${label}</h5><ul>${players.map(player => {
      const conflicting = Array.isArray(player.conflicting_reports);
      const title = conflicting ? 'Unknown · conflicting reports' : labels[player.availability_status] ?? 'Unknown';
      const reports = conflicting ? player.conflicting_reports : [player];
      const sourceType = player.verification_status === 'official' ? 'Official publication' : 'Reviewed reporting';
      return `<li><strong>${escapeHtml(player.player_name)}</strong> · ${escapeHtml(player.position ?? 'Position unavailable')}
        <span class="nd-injury-state">${title}${player.earlier_report ? ' · Earlier report' : ''}</span>
        <small class="muted">${reports.map(reportLine).join('<br>')}${conflicting ? '' : ' · ' + sourceType}
          <br>Verified ${dateLabel(player.last_verified_at)}</small></li>`;
    }).join('')}</ul>`;
  }).join('');
  return `<section><h4>${escapeHtml(name)}</h4>
    <p><strong>${escapeHtml(count)} ${count === 1 ? 'player' : 'players'} reported out</strong></p>
    <p class="muted">${statusText} · Latest verified report ${dateLabel(team.latest_report_timestamp)}
    ${status.staleReport ? ' · Stale report' : ''}</p>${reportGroups}</section>`;
}

export async function mountAvailability(section, {season, games, nextGame, scheduleStatus}, isCurrent) {
  const notice = section.querySelector('[role="status"]');
  const control = section.querySelector('label');
  const select = control.querySelector('select');
  const result = section.querySelector('.nd-injury-results');
  const eligible = games.filter(game => game.id && game.opponent_id && Number.isFinite(Date.parse(game.date)) &&
    !/cancel|no contest/i.test(game.status));
  if (!season || !eligible.length) {
    notice.textContent = 'No verified Notre Dame schedule is available for this season.';
    return;
  }

  const ordered = [...eligible].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  for (const game of ordered) {
    select.add(new Option(`${game.opponent} · ${shortDate(game.date, game.time_tbd)}`, game.id));
  }
  select.value = eligible.find(game => game.id === nextGame?.id)?.id ?? ordered[0].id;
  let snapshot;
  let unavailable = false;
  try {
    const response = await fetch(new URL('./data/injury-availability.json', import.meta.url), {cache: 'no-cache'});
    if (!response.ok) throw new Error('Availability snapshot unavailable');
    snapshot = await response.json();
    unavailable = snapshot?.schema_version !== 1 || !snapshot.games || snapshot.season !== season;
  } catch {
    unavailable = true;
  }
  if (!isCurrent()) return;

  function render() {
    const game = eligible.find(game => game.id === select.value);
    const teams = unavailable ? null : gameReports(snapshot, season, game);
    const context = freshness(snapshot, null, game);
    notice.textContent = unavailable ? 'Availability data could not be loaded for this season.'
      : (context.staleSnapshot ? 'Saved availability snapshot · refresh delayed or unavailable. ' : '') +
        `Snapshot generated ${dateLabel(snapshot.generated_at)}.`;
    if (scheduleStatus !== 'available') notice.textContent += ' Showing the saved schedule.';
    const date = game.time_tbd ? `${shortDate(game.date, true)} · Kickoff time TBD` : dateLabel(game.date);
    const opponent = escapeHtml(game.opponent);
    result.innerHTML = `<p class="nd-injury-matchup"><strong>Notre Dame vs. ${opponent}</strong>
      <span>${game.id === nextGame?.id ? 'Next scheduled matchup · ' : ''}${escapeHtml(date)}</span></p>
      <div class="nd-split">${teamCard('Notre Dame', teams?.[NOTRE_DAME], snapshot, game)}
      ${teamCard(game.opponent, teams?.[game.opponent_id], snapshot, game)}</div>`;
  }

  select.addEventListener('change', render);
  render();
  control.hidden = false;
}
