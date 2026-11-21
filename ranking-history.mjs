export function movement(previous, current) {
  if (current === undefined) return 'Poll unavailable';
  if (current === null) return typeof previous === 'number' ? 'Unranked · Dropped out' : 'Unranked';
  if (previous === undefined) return '—';
  if (previous === null) return 'New entry';
  if (previous === current) return '—';
  return previous > current ? `↑ ${previous - current}` : `↓ ${current - previous}`;
}

export function rankAt(week, id) {
  return week.poll ? week.poll.ranks[id] ?? null : undefined;
}

const COLORS = ['#f2bc45', '#6bcaff', '#7de0a5', '#eea5e8'];
const MAX_TEAMS = 4;

async function readJson(url) {
  const response = await fetch(url, {cache: 'no-cache'});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

let weeksRequest;
export function loadWeeks() {
  weeksRequest ??= fetchWeeks().catch(error => {
    weeksRequest = null;
    throw error;
  });
  return weeksRequest;
}

async function fetchWeeks() {
  const directory = new URL('./data/ap-rankings/2026/', import.meta.url);
  const index = await readJson(new URL('index.json', directory));
  if (index.season !== 2026 || index.poll !== 'AP Top 25' || !Array.isArray(index.weeks)) {
    throw new Error('Invalid AP archive index');
  }

  return Promise.all(index.weeks.map(async ({label, file}) => {
    if (!/^phase-[123]-week-[1-9]\d*\.json$/.test(file ?? '')) return {label};
    try {
      const poll = await readJson(new URL(file, directory));
      if (poll.season === index.season && poll.poll === index.poll && poll.label === label &&
          file === `phase-${poll.phase}-week-${poll.week}.json` && poll.ranks &&
          Object.keys(poll.ranks).length >= 25 && Object.values(poll.ranks).every(
            rank => Number.isInteger(rank) && rank >= 1 && rank <= 25)) {
        return {label, poll};
      }
    } catch (error) {
      console.warn(`AP archive: ${label} unavailable`, error);
    }
    return {label};
  }));
}

export function drawChart(canvas, weeks, teams, activeWeek) {
  const width = Math.max(480, weeks.length * 45 + 55);
  const height = 280;
  const density = window.devicePixelRatio || 1;
  canvas.style.width = `${width}px`;
  canvas.width = width * density;
  canvas.height = height * density;
  const ctx = canvas.getContext('2d');
  ctx.scale(density, density);
  ctx.font = '12px system-ui';
  const left = 42, right = width - 28, top = 23, bottom = 234;
  const x = i => weeks.length === 1 ? (left + right) / 2 : left + i * (right - left) / (weeks.length - 1);
  const y = rank => top + (rank - 1) * (bottom - top) / 24;

  ctx.fillStyle = '#243b54';
  ctx.fillRect(x(activeWeek) - 12, top - 10, 24, bottom - top + 20);
  for (const rank of [1, 5, 10, 15, 20, 25]) {
    ctx.strokeStyle = '#34465d';
    ctx.beginPath();
    ctx.moveTo(left, y(rank));
    ctx.lineTo(right, y(rank));
    ctx.stroke();
    ctx.fillStyle = '#b3c1d2';
    ctx.fillText(`#${rank}`, 8, y(rank) + 4);
  }
  ctx.textAlign = 'center';
  weeks.forEach((week, i) => {
    ctx.fillStyle = week.poll ? '#c9d8e9' : '#f2bc45';
    const label = week.label.replace('Preseason', 'Pre').replace('Week ', 'W').replace('Postseason ', 'Post ');
    ctx.fillText(label, x(i), bottom + 24, 44);
  });

  teams.forEach((team, index) => {
    let previous = null;
    ctx.fillStyle = ctx.strokeStyle = COLORS[index];
    ctx.lineWidth = 2;
    weeks.forEach((week, i) => {
      const rank = rankAt(week, team.id);
      if (typeof rank !== 'number') {
        previous = null;
        return;
      }
      const current = [x(i), y(rank)];
      if (previous) {
        ctx.beginPath();
        ctx.moveTo(...previous);
        ctx.lineTo(...current);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(...current, i === activeWeek ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
      previous = current;
    });
  });
}

export async function mountHistory(panel, directory) {
  const controls = panel.querySelector('.history-controls');
  const message = panel.querySelector('.history-message');
  const results = panel.querySelector('.history-results');
  let weeks;
  try {
    weeks = await loadWeeks();
  } catch (error) {
    console.warn('AP archive unavailable', error);
    message.textContent = 'Ranking history could not load. Reload the page to try again.';
    return;
  }
  if (!weeks.some(week => week.poll)) {
    message.textContent = 'No verified AP polls are available for this season yet.';
    return;
  }

  const teams = directory.map(team => ({...team, id: String(team.id)}))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!teams.length) {
    message.textContent = 'The team directory is unavailable. Reload the page to try again.';
    return;
  }

  const search = panel.querySelector('#historySearch');
  const conference = panel.querySelector('#historyConference');
  const picker = panel.querySelector('#historyTeam');
  const add = panel.querySelector('#historyAdd');
  const weekPicker = panel.querySelector('#historyWeek');
  const chips = panel.querySelector('.history-selected');
  const count = panel.querySelector('.history-count');
  const table = panel.querySelector('.history-table');
  const canvas = panel.querySelector('canvas');
  const summary = panel.querySelector('.history-week-summary');
  const preferredTeam = teams.find(team => team.id === '87');
  const selected = preferredTeam ? [preferredTeam] : [];

  for (const name of [...new Set(teams.map(team => team.conference).filter(Boolean))].sort()) {
    conference.add(new Option(name, name));
  }
  weeks.forEach((week, index) => {
    weekPicker.add(new Option(week.label + (week.poll ? '' : ' (unavailable)'), index));
  });
  weekPicker.selectedIndex = weeks.findLastIndex(week => week.poll);

  function updatePicker() {
    const query = search.value.trim().toLowerCase();
    const matches = teams.filter(team =>
      (!conference.value || conference.value === team.conference) &&
      `${team.name} ${team.abbreviation ?? ''}`.toLowerCase().includes(query) &&
      !selected.includes(team));
    picker.replaceChildren(...matches.map(team => new Option(team.name, team.id)));
    if (!matches.length) picker.add(new Option('No matching teams', ''));
    add.disabled = !picker.value || selected.length >= MAX_TEAMS;
  }

  function showComparison() {
    count.textContent = `${selected.length} of ${MAX_TEAMS} teams selected`;
    chips.replaceChildren(...selected.map((team, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${team.name} ×`;
      button.style.color = COLORS[index];
      button.setAttribute('aria-label', `Remove ${team.name}`);
      button.addEventListener('click', () => {
        selected.splice(index, 1);
        showComparison();
        picker.focus();
      });
      return button;
    }));
    results.hidden = !selected.length;
    message.textContent = selected.length ? '' : 'Choose a team to see its AP poll history.';
    if (selected.length) {
      const current = weekPicker.selectedIndex;
      drawChart(canvas, weeks, selected, current);
      const active = weeks[current];
      summary.textContent = active.poll
        ? `${active.label} · AP poll published ${active.poll.published_at.slice(0, 10)}`
        : `${active.label} · Poll unavailable`;

      const headings = [null, ...selected];
      const header = table.tHead.rows[0];
      header.replaceChildren(...headings.map(team => {
        const cell = document.createElement('th');
        cell.scope = 'col';
        if (team) {
          const link = document.createElement('a');
          link.href = `#team=${encodeURIComponent(team.id)}`;
          link.textContent = team.name;
          cell.append(link);
        } else {
          cell.textContent = 'Poll';
        }
        return cell;
      }));
      const body = table.tBodies[0];
      body.replaceChildren();
      weeks.forEach((week, index) => {
        const row = body.insertRow();
        row.classList.toggle('history-active', index === current);
        const heading = document.createElement('th');
        heading.scope = 'row';
        heading.textContent = week.label;
        row.append(heading);
        const published = document.createElement('small');
        published.textContent = week.poll?.published_at.slice(0, 10) ?? 'Unavailable';
        heading.append(published);
        for (const team of selected) {
          const previous = index ? rankAt(weeks[index - 1], team.id) : undefined;
          const rank = rankAt(week, team.id);
          const cell = row.insertCell();
          const change = movement(previous, rank);
          cell.textContent = typeof rank === 'number' ? `#${rank} · ${change}` : change;
        }
      });
    }
    updatePicker();
  }

  search.addEventListener('input', updatePicker);
  conference.addEventListener('change', updatePicker);
  add.addEventListener('click', () => {
    const team = teams.find(team => team.id === picker.value);
    if (team && !selected.includes(team) && selected.length < MAX_TEAMS) {
      selected.push(team);
      showComparison();
    }
  });
  weekPicker.addEventListener('change', showComparison);
  controls.hidden = false;
  showComparison();
}
