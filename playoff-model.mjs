// Pure scenario rules. No browser state, retrieval, or forecast probabilities.
export const MAJORS = ['Atlantic Coast Conference', 'Big Ten Conference', 'Big 12 Conference', 'Southeastern Conference'];
export const GROUP = ['American Conference', 'Conference USA', 'Mid-American Conference',
  'Mountain West Conference', 'Pac-12 Conference', 'Sun Belt Conference'];
export const NOTRE_DAME = '87';
const TITLE_WEEKEND = Date.parse('2026-12-04T05:00:00Z');
export const SELECTION = Date.parse('2026-12-06T17:00:00Z');

export function collectSchedule(profiles, teams, titleFixtures) {
  const titles = new Set(Object.values(titleFixtures).map(game => game.id));
  const events = new Map();
  for (const [id, profile] of Object.entries(profiles)) {
    if (!teams.has(id)) continue;
    for (const row of profile.games ?? []) {
      const opponent = row.opponent_id;
      if (!/^\d+$/.test(opponent) || opponent === id || !row.opponent || titles.has(row.id)
          || !Number.isFinite(Date.parse(row.date)) || Date.parse(row.date) >= SELECTION) continue;
      const pair = [id, opponent].sort();
      const hint = {id: row.id, date: row.date, pair, opponent: row.opponent, outsider: opponent,
        final: row.final, result: row.final && ['W','L','T'].includes(row.result) ? row.result : null,
        team: id, scheduled: profile.schedule_status === 'available' && row.status === 'Scheduled' && !row.final};
      if (!events.has(row.id)) events.set(row.id, []);
      events.get(row.id).push(hint);
    }
  }

  const output = [];
  for (const appearances of events.values()) {
    const first = appearances[0];
    if (appearances.some(row => row.pair.join() !== first.pair.join() || row.date !== first.date)) continue;
    const finals = appearances.filter(row => row.result).map(row =>
      row.result === 'T' ? 'tie' : row.result === 'W' ? row.team : row.pair.find(id => id !== row.team));
    if (new Set(finals).size > 1) continue;
    const a = teams.get(first.pair[0])?.conference;
    const b = teams.get(first.pair[1])?.conference;
    const conference = a && a === b ? a : null;
    if (eligibleConference(conference) && Date.parse(first.date) >= TITLE_WEEKEND) continue;
    const names = Object.fromEntries(first.pair.map(id => [
      id, teams.get(id)?.name ?? appearances.find(row => row.outsider === id)?.opponent ?? 'Opponent',
    ]));
    output.push({
      id:first.id, date:first.date, teams:first.pair, names,
      outcome:finals[0] ?? null,
      scheduled:!finals.length && appearances.every(row => row.scheduled),
      conference,
    });
  }
  return output.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

const emptyRecord = () => ({wins:0, losses:0, ties:0, unknown:0});
export const ratio = row => (row.wins + .5 * row.ties) / (row.wins + row.losses + row.ties || 1);
const languageOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const eligibleConference = conference => [...MAJORS, ...GROUP].includes(conference);

export function summarizeSchedule(teams, events, picks, now) {
  const rows = new Map([...teams.keys()].map(id => [id, {
    id, overall:emptyRecord(), conference:emptyRecord(), adjustment:0,
  }]));
  const headToHead = new Map();
  const used = {};
  for (const game of events) {
    const picked = game.scheduled && Date.parse(game.date) > now && game.teams.includes(picks[game.id])
      ? picks[game.id] : null;
    const outcome = game.outcome ?? picked;
    if (picked && !game.outcome) used[game.id] = picked;
    if (outcome) headToHead.set(game.teams.join(':'), [...(headToHead.get(game.teams.join(':')) ?? []), outcome]);
    for (const id of game.teams) {
      const row = rows.get(id);
      if (!row) continue;
      const key = !outcome ? 'unknown' : outcome === 'tie' ? 'ties' : outcome === id ? 'wins' : 'losses';
      row.overall[key]++;
      if (eligibleConference(game.conference)) row.conference[key]++;
      if (picked && !game.outcome) row.adjustment += outcome === id ? -2 : 3;
    }
  }
  return {rows, headToHead, used};
}

export function conferenceTable(conference, teams, rows, headToHead, officialRanks) {
  const members = [...teams].filter(([, team]) => team.conference === conference).map(([id]) => rows.get(id));
  const byRecord = members.sort((a, b) => ratio(b.conference) - ratio(a.conference));
  const output = [];
  while (byRecord.length) {
    const boundary = byRecord.findIndex(row => ratio(row.conference) !== ratio(byRecord[0].conference));
    const group = byRecord.splice(0, boundary < 0 ? byRecord.length : boundary);
    const wins = new Map(group.map(row => [row.id, 0]));
    let complete = true;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i].id, b = group[j].id;
        const meetings = headToHead.get([a,b].sort().join(':'));
        if (!meetings?.length) complete = false;
        else for (const winner of meetings) {
          if (winner === 'tie') {
            wins.set(a,wins.get(a) + .5 / meetings.length);
            wins.set(b,wins.get(b) + .5 / meetings.length);
          } else if (wins.has(winner)) wins.set(winner,wins.get(winner) + 1 / meetings.length);
        }
      }
    }
    group.sort((a, b) => (complete ? wins.get(b.id) - wins.get(a.id) : 0)
      || ((officialRanks[a.id] ?? 99) - (officialRanks[b.id] ?? 99))
      || ratio(b.overall) - ratio(a.overall) || languageOrder(a.id,b.id));
    output.push(...group.map(row => ({...row, provisionalTie:group.length > 1
      && (!complete || group.some(other => other !== row && wins.get(other.id) === wins.get(row.id)))})));
  }
  return output;
}

export function chooseChampions(conferences, fixtures, choices, now) {
  const results = {};
  const used = {};
  for (const name of [...MAJORS, ...GROUP]) {
    const fixture = fixtures[name];
    const known = fixture?.teams ?? [];
    const candidates = conferences[name].filter(row =>
      row.conference.wins + row.conference.losses + row.conference.ties > 0).map(row => row.id);
    const participants = [...new Set([...known, ...candidates])].slice(0, 2);
    const match = participants.slice().sort().join('.');
    const valid = participants.find(id => choices[name] === match + ':' + id);
    const open = participants.length === 2 && !fixture?.winner && now < SELECTION &&
      (!fixture || (fixture.status === 'Scheduled' && Date.parse(fixture.date) > now));
    const winner = fixture?.winner ?? (open ? valid ?? null : null);
    if (valid && open && !fixture?.winner) used[name] = choices[name];
    results[name] = {participants, match, winner, confirmed:known.length === 2,
      actual:Boolean(fixture?.winner), open, fixture:fixture ?? null};
  }
  return {results, used};
}

export function projectOrder(teams, rows, ranks, champions) {
  if (!Object.keys(ranks).length) return [];
  const fallback = [...rows.values()].filter(row => !ranks[row.id]
    && row.overall.wins + row.overall.losses + row.overall.ties).sort((a, b) =>
    ratio(b.overall) - ratio(a.overall) || b.overall.wins - a.overall.wins || languageOrder(a.id,b.id));
  const startingRank = {...Object.fromEntries(fallback.map((row, i) => [row.id,26 + i])), ...ranks};
  const titleAdjustments = {};
  for (const title of Object.values(champions)) {
    if (title.actual || !title.winner) continue;
    for (const id of title.participants) titleAdjustments[id] = id === title.winner ? -2 : 3;
  }
  return Object.keys(startingRank).filter(id => teams.has(id)).sort((a,b) => {
    const points = id => startingRank[id] + rows.get(id).adjustment + (titleAdjustments[id] ?? 0);
    return points(a) - points(b) || startingRank[a] - startingRank[b] || languageOrder(a,b);
  });
}

export function selectField(order, teams, champions) {
  if (!order.length) return Array.from({length:12}, (_,i) => ({seed:i+1,id:null,reason:'Ranking input unavailable'}));
  const ranked = new Map(order.map((id, index) => [id, index + 1]));
  const automatic = new Map();
  let pending = 0;
  for (const name of MAJORS) {
    const id = champions[name]?.winner;
    if (id && teams.get(id)?.conference === name) automatic.set(id, name + ' champion');
    else pending++;
  }
  const group = order.find(id => GROUP.includes(teams.get(id)?.conference));
  if (group) automatic.set(group, 'Highest-ranked team from the six eligible conferences');
  else pending++;
  if (ranked.has(NOTRE_DAME) && ranked.get(NOTRE_DAME) <= 12) automatic.set(NOTRE_DAME, 'Notre Dame top-12 guarantee');
  const selected = new Map(automatic);
  for (const id of order) {
    if (selected.size >= 12 - pending) break;
    if (!selected.has(id)) selected.set(id, 'At-large');
  }
  const field = [...selected].sort(([a],[b]) => (ranked.get(a) ?? Infinity) - (ranked.get(b) ?? Infinity)
    || languageOrder(a,b)).map(([id, reason]) => ({id, reason, projectedRank:ranked.get(id) ?? null}));
  return Array.from({length:12}, (_, index) => ({seed:index + 1, ...(field[index] ?? {id:null, reason:'Pending selection'})}));
}

export function officialField(snapshot, teams, now) {
  if (snapshot?.season !== 2026 || !Number.isFinite(Date.parse(snapshot.published_at))
      || Date.parse(snapshot.published_at) < SELECTION || Date.parse(snapshot.published_at) > now
      || !Array.isArray(snapshot.seeds) || snapshot.seeds.length !== 12
      || !snapshot.seeds.every(id => typeof id === 'string' && teams.has(id))
      || new Set(snapshot.seeds).size !== 12) return null;
  return snapshot.seeds.map((id, index) => ({seed:index + 1,id,reason:'Official CFP seed'}));
}

const ROUNDS = [
  [['r89',8,9],['r512',5,12],['r710',7,10],['r611',6,11]],
  [['q1',1,'r89'],['q4',4,'r512'],['q2',2,'r710'],['q3',3,'r611']],
  [['s14','q1','q4'],['s23','q2','q3']],
  [['final','s14','s23']],
];

export function advanceBracket(field, choices, officialWinners = {}) {
  const seeds = new Map(field.filter(row => row.id).map(row => [row.seed,row]));
  const winners = new Map();
  const used = {};
  const rounds = ROUNDS.map(round => round.map(([id, left, right]) => {
    const resolve = key => seeds.get(key) ?? winners.get(key) ?? null;
    const teams = [resolve(left), resolve(right)];
    const match = teams.every(Boolean) ? teams.map(team => team.id).join('.') : null;
    const official = match && teams.find(team => team.id === officialWinners[id]);
    const picked = match && teams.find(team => choices[id] === match + ':' + team.id);
    const winner = official || picked || null;
    if (picked && !official) used[id] = choices[id];
    winners.set(id,winner);
    return {id, teams, feeds:[left,right], match, winner, official:Boolean(official)};
  }));
  return {rounds, used};
}

export function scenarios({teams, events, fixtures, ranks, official}, input, now) {
  const {rows, headToHead, used} = summarizeSchedule(teams,events,input.games,now);
  const standings = Object.fromEntries([...MAJORS,...GROUP].map(name =>
    [name,conferenceTable(name,teams,rows,headToHead,ranks)]));
  const titles = chooseChampions(standings,fixtures,input.titles,now);
  const order = projectOrder(teams,rows,ranks,titles.results);
  const officialSeeds = officialField(official,teams,now);
  const field = officialSeeds ?? selectField(order,teams,titles.results);
  const bracket = advanceBracket(field,input.bracket,officialSeeds ? official.winners : undefined);
  return {rows, standings, titles:titles.results, order, field, bracket, isOfficial:Boolean(officialSeeds),
    used:{games:used,titles:titles.used,bracket:bracket.used}};
}

export function decodeScenario(hash) {
  const params = new URLSearchParams(hash.split('?')[1] ?? '');
  const read = key => Object.fromEntries(params.getAll(key).slice(0, 250).map(item => {
    const split = item.indexOf('=');
    return split < 0 ? [] : [item.slice(0,split),item.slice(split+1)];
  }).filter(row => row.length));
  return {games:read('g'),titles:read('t'),bracket:read('b'),team:params.get('team') === NOTRE_DAME ? NOTRE_DAME : null};
}

export function encodeScenario(input, team) {
  const params = new URLSearchParams();
  if (team === NOTRE_DAME) params.set('team',team);
  for (const [key, choices] of [['g',input.games],['t',input.titles],['b',input.bracket]]) {
    for (const [id, pick] of Object.entries(choices).sort()) params.append(key,id+'='+pick);
  }
  return '#playoff' + (params.size ? '?' + params : '');
}
