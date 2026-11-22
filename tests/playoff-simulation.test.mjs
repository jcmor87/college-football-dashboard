import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {MAJORS, GROUP, prepareSchedule, summarizeSchedule} from '../playoff-model.mjs';
import {gameProbability, sampleUniform, simulation, VERSION} from '../playoff-simulation.mjs';

const teams = Array.from({length:16},(_,i) => [String(i+1), {
  name:'Team '+(i+1),conference:i<4 ? MAJORS[i] : i===4 ? GROUP[0] : 'Independent',
}]);
const input = {
  version:VERSION, asOf:Date.parse('2026-11-21T21:00Z'), seed:20261206, teams,
  ranks:Object.fromEntries(teams.map(([id],i) => [id,i+1])),
  ratings:Object.fromEntries(teams.map(([id],i) => [id,75-i*2])),
  parameters:{rating_points:.3,home_points:3,scale:12}, official:null, titleProbabilities:{},
  fixtures:Object.fromEntries(MAJORS.map((name,i) => [name,{teams:[String(i+1)],winner:String(i+1)}])),
  events:[],
};

test('the seeded stream is deterministic and keyed by game and draw', () => {
  assert.equal(sampleUniform(1,2,3),sampleUniform(1,2,3));
  assert.notEqual(sampleUniform(1,2,3),sampleUniform(1,3,3));
  assert.notEqual(sampleUniform(1,2,3),sampleUniform(1,2,4));
  assert.deepEqual(simulation(input).runTo(1000),simulation(input).runTo(1000));
  const cached = simulation(input);
  cached.runTo(20);
  assert.deepEqual(cached.runTo(250),simulation(input).runTo(250));
});

test('game probability preserves neutral symmetry, home edge and missing ratings', () => {
  const model = input.parameters;
  assert.equal(gameProbability(80,80,0,model),.5);
  assert.ok(gameProbability(80,80,1,model) > .5);
  assert.equal(gameProbability(80,70,0,model)+gameProbability(70,80,0,model),1);
  assert.equal(gameProbability(null,80,0,model),null);
});

test('published matchup probabilities agree with the shared game-model equation', () => {
  const data = JSON.parse(readFileSync(new URL('../data/predictions/latest.json',import.meta.url)));
  const saved = data.rows.map(row=>row.prediction).filter(Boolean);
  assert.ok(saved.length);
  for (const row of saved) {
    assert.ok(Math.abs(gameProbability(row.rating_first,row.rating_second,row.venue,row.parameters)-row.probability) <= 0.000001);
  }
});

test('aggregation conserves bracket slots and round entrants', () => {
  const result = simulation(input).runTo(1000);
  assert.deepEqual(result.denominators,{qualification:1000,alternate:1000,semifinal:1000,final:1000,title:1000});
  const sum = key => Object.values(result.teams).reduce((total,row)=>total+row[key],0);
  assert.deepEqual(['qualification','semifinal','final','title'].map(sum),[12000,4000,2000,1000]);
  for(const row of Object.values(result.teams)) assert.equal(row.seeds.reduce((a,b)=>a+b,0),row.qualification);
});

test('forced outcomes use the scenario engine even when no forecast is available', () => {
  const game = {id:'g',teams:['12','13'],date:'2026-11-28T21:00Z',scheduled:true,outcome:null,conference:null};
  const snapshot = {...input,events:[game]};
  const baseline = simulation(snapshot).runTo(1000);
  const forced = simulation(snapshot,{games:{g:'13'}}).runTo(1000);
  const invalid = simulation(snapshot,{games:{g:'99'}}).runTo(1000);
  assert.deepEqual(baseline,invalid);
  assert.equal(baseline.coverage.unresolved,1);
  assert.equal(forced.coverage.unresolved,0);
  assert.equal(forced.coverage.forced,1);
  assert.equal(baseline.teams[12].qualification,1000);
  assert.equal(forced.teams[12].qualification,0);
  assert.equal(forced.teams[13].qualification,1000);
  const map = new Map(teams);
  const expected = summarizeSchedule(map,[game],{g:'13'},input.asOf);
  const optimized = prepareSchedule(map,[game],input.asOf)(()=>'13');
  assert.deepEqual(optimized.rows,expected.rows);
  assert.deepEqual(optimized.headToHead.get('12:13'),expected.headToHead.get('12:13'));
});

test('incomplete fields and unavailable bracket probabilities do not become zero chances', () => {
  assert.equal(simulation({...input,fixtures:{}}).runTo(1000).denominators.qualification,0);
  const result = simulation({...input,ratings:{}}).runTo(1000);
  assert.equal(result.denominators.qualification,1000);
  assert.equal(result.denominators.title,0);
});

test('official seeds and recorded championship results take precedence', () => {
  const official = {season:2026,published_at:'2026-12-06T19:00Z',
    seeds:teams.slice(0,12).map(([id])=>id),winners:{r89:'9',q1:'9',s14:'9',final:'9'}};
  const result = simulation({...input,official,asOf:Date.parse('2027-01-26')},
    {bracket:{r89:'8.9:8'}}).runTo(1000);
  assert.equal(result.official,true);
  assert.equal(result.teams['9'].title,1000);
  assert.equal(result.teams['13'].qualification,0);
  assert.equal(simulation({...input,asOf:Date.parse('2026-12-07')}).runTo(1000).unavailable,true);
});
