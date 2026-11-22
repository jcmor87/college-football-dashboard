// Shared by Node precomputation and a browser worker.
import {
  advanceBracket, chooseChampions, collectSchedule, committeeAnchor, conferenceMembers, officialField, pickable, prepareSchedule,
  projectConferences, projectOrder, selectField, SELECTION,
} from './playoff-model.mjs';

export const VERSION = 'playoff-mc-v1';
export const SEED = 20261206;
export const COUNTS = [1000, 10000, 50000];
const roundFields = ['semifinal', 'final', 'title'];

function hashKey(key) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function sampleUniform(seed, draw, keyHash) {
  let x = (seed ^ keyHash ^ Math.imul(draw + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

const finiteProbability = number => Number.isFinite(number) && number >= 0 && number <= 1;

// Mirrors prediction_model.py forecast: margin rounded to 3 places before logistic.
export function gameProbability(firstRating, secondRating, venue, model) {
  if (![firstRating, secondRating, venue, model?.rating_points, model?.home_points, model?.scale]
    .every(Number.isFinite) || model.scale <= 0) return null;
  const raw = (firstRating - secondRating) * model.rating_points + venue * model.home_points;
  const margin = Math.round(raw * 1000) / 1000;
  return Math.round(1e6 / (1 + Math.exp(-Math.max(-60, Math.min(60, margin / model.scale))))) / 1e6;
}

function matchupProbability(row, teams, date, asOf) {
  if (!row || row.status !== 'Scheduled' || row.actual || !row.prediction
      || row.first !== row.prediction.first || row.second !== row.prediction.second
      || Date.parse(row.kickoff) !== Date.parse(date)
      || Date.parse(row.prediction.kickoff) !== Date.parse(date)
      || !Number.isFinite(Date.parse(row.prediction.input_cutoff)) || Date.parse(row.prediction.input_cutoff) > asOf || !finiteProbability(row.prediction.probability)
      || !teams.includes(row.first) || !teams.includes(row.second) || row.first === row.second) return null;
  if (!row.is_preview && !(Date.parse(row.prediction.input_cutoff) <= Date.parse(row.prediction.generated_at)
      && Date.parse(row.prediction.generated_at) <= asOf && Date.parse(row.prediction.generated_at) < Date.parse(date))) return null;
  return row.first === teams[0] ? row.prediction.probability : 1 - row.prediction.probability;
}

export function buildInput({dashboard, profiles, power, predictions, titles, official}, asOf) {
  if ([dashboard, profiles, power, predictions, titles].some(data => data.season !== 2026)
      || predictions.input_cutoff !== power.cutoff || !Number.isFinite(Date.parse(power.cutoff))
      || Date.parse(power.cutoff) > asOf) throw new Error('Inconsistent playoff simulation source snapshots');
  const teams = new Map(dashboard.teams.map(team => [String(team.id), {
    name:team.name, conference:team.conference,
  }]));
  const fixtures = titles.games ?? {};
  const events = collectSchedule(profiles.teams,teams,fixtures);
  const existing = new Map(predictions.rows.map(row => [row.id,row]));
  for (const event of events) {
    if (pickable(event,asOf)) event.probability = matchupProbability(
      existing.get(event.id),event.teams,event.date,asOf);
  }
  const titleProbabilities = {};
  for (const [name, row] of Object.entries(fixtures)) {
    if (row.status === 'Scheduled' && !row.winner && row.teams.length === 2 && Date.parse(row.date) > asOf) {
      titleProbabilities[name] = matchupProbability(existing.get(row.id),row.teams,row.date,asOf);
    }
  }
  return {
    version:VERSION, seed:SEED, asOf, cutoff:power.cutoff,
    predictionModel:predictions.model, powerModel:power.model, parameters:predictions.parameters,
    teams:[...teams], events, fixtures, titleProbabilities, official,
    ranks:power.polls?.cfp?.ranks ?? {}, pollDate:power.polls?.cfp?.date ?? null,
    ratings:Object.fromEntries(Object.entries(power.teams).map(([id,row]) => [id,row.rating])),
    missingTitleDates:titles.unavailable_dates ?? [],
    staleSchedules:Object.values(profiles.teams).filter(team => team.schedule_status !== 'available').length,
  };
}

const empty = () => ({qualification:0, alternate:0, seeds:Array(12).fill(0), semifinal:0, final:0, title:0});

export function simulation(input, choices = {}) {
  const {events, fixtures, ranks, official, ratings, parameters, asOf, seed} = input;
  const teams = new Map(input.teams);
  const officialSeeds = officialField(official,teams,asOf);
  const emptyField = !officialSeeds && (asOf >= SELECTION || !Object.keys(ranks).length);
  const members = conferenceMembers(teams);
  const schedule = prepareSchedule(teams,events,asOf);
  const remaining = events.filter(game => pickable(game,asOf));
  const overrides = choices.games ?? {};
  const forced = remaining.filter(game => game.teams.includes(overrides[game.id])).length;
  const coverage = {
    remaining:remaining.length, forced,
    modeled:remaining.filter(game => !game.teams.includes(overrides[game.id]) && finiteProbability(game.probability)).length,
    unresolved:remaining.filter(game => !game.teams.includes(overrides[game.id]) && !finiteProbability(game.probability)).length,
    otherUnresolved:events.filter(game => !game.outcome && !pickable(game,asOf)).length,
    staleSchedules:input.staleSchedules,
  };
  const denominators = {qualification:0,alternate:0,semifinal:0,final:0,title:0};
  const counts = new Map([...teams.keys()].map(id => [id,empty()]));
  const hashes = new Map();
  const probabilities = new Map();
  let attempted = 0;
  let neutralTitleDraws = 0;
  const honored = {titles:{},bracket:{}};

  function choose(draw,key,ids,p) {
    if (!finiteProbability(p)) return null;
    const [first,second] = ids[0] < ids[1] ? ids : [ids[1],ids[0]];
    const canonical = key + ':' + first + ':' + second;
    if (!hashes.has(canonical)) hashes.set(canonical,hashKey(canonical));
    return sampleUniform(seed,draw,hashes.get(canonical)) < (first === ids[0] ? p : 1-p) ? first : second;
  }
  function modelChance(ids,venue) {
    const key = ids.join('.') + ':' + venue;
    if (!probabilities.has(key)) probabilities.set(key,gameProbability(ratings[ids[0]],ratings[ids[1]],venue,parameters));
    return probabilities.get(key);
  }
  function sample(draw) {
    if (emptyField) return;
    let field = officialSeeds;
    let alternate = officialSeeds;
    let usedNeutralTitle = false;
    if (!field) {
      const {rows, headToHead} = schedule(game => game.teams.includes(overrides[game.id])
        ? overrides[game.id] : choose(draw,'regular-'+game.id,game.teams,game.probability));
      const standings = projectConferences(teams,rows,headToHead,ranks,members);
      const titles = chooseChampions(standings,fixtures,choices.titles ?? {},asOf,(name,ids,fixture) => {
        // The conference must have a listed, not-yet-played fixture.
        if (!fixture) return null;
        const p = input.titleProbabilities[name];
        if (ids.length === fixture.teams.length && ids.every((id,i) => id === fixture.teams[i]) && finiteProbability(p)) {
          return choose(draw,'title-'+fixture.id,ids,p);
        }
        const fallback = modelChance(ids,0);
        if (fallback != null) usedNeutralTitle = true;
        return choose(draw,'title-'+fixture.id,ids,fallback);
      });
      for (const key of Object.keys(titles.used)) honored.titles[key] = (honored.titles[key] ?? 0) + 1;
      const championships = titles.results;
      const anchor = committeeAnchor(rows,ranks);
      field = selectField(projectOrder(teams,rows,ranks,championships,true,anchor),teams,championships);
      alternate = selectField(projectOrder(teams,rows,ranks,championships,false,anchor),teams,championships);
    }
    if (usedNeutralTitle) neutralTitleDraws++;
    if (alternate.every(row => row.id)) {
      denominators.alternate++;
      for (const row of alternate) counts.get(row.id).alternate++;
    }
    if (!field.every(row => row.id)) return;
    denominators.qualification++;
    for (const row of field) {
      const totals = counts.get(row.id);
      totals.qualification++;
      totals.seeds[row.seed-1]++;
    }

    const bracket = advanceBracket(field,choices.bracket ?? {},officialSeeds ? official.winners : {},
      (id, pair, firstRound) => {
        const ids = pair.map(team => team.id);
        const venue = firstRound ? (pair[0].seed < pair[1].seed ? 1 : -1) : 0;
        return choose(draw,'playoff-'+id,ids,modelChance(ids,venue));
      });
    for (const key of Object.keys(bracket.used)) honored.bracket[key] = (honored.bracket[key] ?? 0) + 1;
    for (const [index, field] of roundFields.entries()) {
      const round = bracket.rounds[index+2];
      const entries = field === 'title' ? [bracket.rounds[3][0].winner] : round.flatMap(game => game.teams);
      if (entries.some(team => !team)) continue;
      denominators[field]++;
      for (const team of entries) counts.get(team.id)[field]++;
    }
  }

  return {
    runTo(target, progress) {
      if (!Number.isSafeInteger(target) || target < attempted || target > 50000) throw new Error('Invalid simulation count');
      for (; attempted < target; attempted++) {
        sample(attempted);
        if (progress && (attempted + 1) % 250 === 0) progress(attempted + 1);
      }
      return {
        count:attempted, denominators:{...denominators}, official:Boolean(officialSeeds),
        unavailable:emptyField, coverage, neutralTitleDraws,
        honored:{titles:{...honored.titles},bracket:{...honored.bracket}},
        teams:Object.fromEntries([...counts].map(([id,row]) => [id,{...row,seeds:[...row.seeds]}])),
      };
    },
  };
}
