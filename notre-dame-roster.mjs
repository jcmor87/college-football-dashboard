const rosterUrl = 'https://fightingirish.com/sports/football/roster/';
const mediaUrl = 'https://fightingirish.com/news/2022/08/29/ndfbmedia';
const bioUrl = /^https:\/\/fightingirish\.com\/sports\/football\/roster\/player\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/;
const documentUrl = /^https:\/\/fightingirish\.com\/documents\/[a-f0-9-]{36}\.pdf$/;
const dateFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'});
const staleAfter = 12 * 60 * 60 * 1000;

function link(url, title) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.textContent = title;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}

function verifiedTime(value) {
  const time = document.createElement('time');
  time.dateTime = value;
  time.textContent = dateFormat.format(Date.parse(value));
  return time;
}

function table(label, labels, rows) {
  const chart = document.createElement('table');
  chart.setAttribute('aria-label', label);
  const heading = chart.createTHead().insertRow();
  for (const label of labels) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    heading.append(cell);
  }
  const body = chart.createTBody();
  for (const [position, ...columns] of rows) {
    const row = body.insertRow();
    const cell = document.createElement('th');
    cell.scope = 'row';
    cell.textContent = position;
    row.append(cell);
    for (const items of columns) row.insertCell().append(...items);
  }
  return chart;
}

function choices(players) {
  return players.flatMap((player, i) => i ? [' or ', link(player.bio_url, player.name)]
    : [link(player.bio_url, player.name)]);
}

export async function mountRoster(section, isCurrent) {
  const status = section.querySelector('[role="status"]');
  const source = section.querySelector('.nd-roster-source');
  const controls = section.querySelector('.nd-roster-controls');
  const content = section.querySelector('.nd-roster-content');
  source.append(link(rosterUrl, 'Official Notre Dame roster'), ' · ', link(mediaUrl, 'Football media information'));

  try {
    const response = await fetch(new URL('./data/notre-dame-roster.json', import.meta.url), {cache: 'no-cache'});
    if (!response.ok) throw new Error('Roster snapshot unavailable');
    const snapshot = await response.json();
    if (!isCurrent()) return;

    const players = new Map(Object.entries(snapshot?.players ?? {}).filter(([id, player]) =>
      /^\d+$/.test(id) && typeof player?.name === 'string' && player.name.trim() && player.name.length <= 100 &&
      /^[A-Z]{1,8}$/.test(player.position) && bioUrl.test(player.bio_url)));
    if (!Number.isInteger(snapshot?.season) || !Number.isFinite(Date.parse(snapshot.verified_at)) || !players.size) {
      throw new Error('Roster snapshot unavailable');
    }
    const rosterStale = snapshot.roster_status === 'stale' || Date.now() - Date.parse(snapshot.verified_at) > staleAfter;
    status.replaceChildren(`${snapshot.season} roster verified `, verifiedTime(snapshot.verified_at));
    if (rosterStale) status.append(' · Saved roster, refresh unavailable or overdue.');

    const depth = snapshot.depth;
    const hasDepth = documentUrl.test(depth?.url) && typeof depth.opponent === 'string' &&
      Number.isFinite(Date.parse(depth.verified_at));

    function show(side) {
      const sideLabel = side === 'offense' ? 'Offense' : 'Defense';
      for (const button of controls.querySelectorAll('button')) {
        button.setAttribute('aria-pressed', String(button.value === side));
      }
      const groups = new Map();
      for (const player of [...players.values()].filter(p => p.group === side)
        .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name))) {
        if (!groups.has(player.position)) groups.set(player.position, []);
        const group = groups.get(player.position);
        group.push(link(player.bio_url, player.name));
      }
      const roster = table(sideLabel + ' roster', ['Position', 'Players'],
        [...groups].map(([position, links]) => [position, links]));
      roster.className = 'nd-player-names';
      const rows = hasDepth ? depth.sides?.[side] : null;
      const note = document.createElement('p');
      note.className = 'muted';
      if (!Array.isArray(rows) || !rows.length || !rows.every(row =>
        /^[A-Z]{1,8}$/.test(row?.position) && Array.isArray(row.tiers) && row.tiers.length &&
        row.tiers.every(tier => Array.isArray(tier) && tier.length &&
          tier.every(id => players.get(id)?.group === side)))) {
        note.textContent = 'Official depth-chart assignments are unavailable. Players are grouped by roster position and listed alphabetically.';
        content.replaceChildren(note, roster);
        return;
      }

      note.append(link(depth.url, `Official depth chart · ${depth.opponent}`),
        ' · Verified ', verifiedTime(depth.verified_at));
      if (rosterStale || snapshot.depth_status === 'stale') note.append(' · Saved chart, refresh unavailable or overdue.');
      const legend = document.createElement('p');
      legend.className = 'muted';
      legend.textContent = 'Starter and backup columns follow the published game-week order. “Or” marks alternatives on the same depth tier.';
      const chart = table(sideLabel + ' depth chart', ['Position', 'Starter', 'Backups'],
        rows.map(({position, tiers}) => [
          position, choices(tiers[0].map(id => players.get(id))),
          tiers.length > 1 ? tiers.slice(1).map(tier => {
            const line = document.createElement('div');
            line.append(...choices(tier.map(id => players.get(id))));
            return line;
          }) : ['—'],
        ]));
      const fullRoster = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Full ' + side + ' roster by position';
      fullRoster.append(summary, roster);
      content.replaceChildren(note, legend, chart, fullRoster);
    }

    for (const button of controls.querySelectorAll('button')) {
      button.addEventListener('click', () => show(button.value));
    }
    show('offense');
    controls.hidden = false;
  } catch {
    if (isCurrent()) status.textContent = 'The Notre Dame roster is temporarily unavailable. Check the official roster for player biographies.';
  }
}
