import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {
  advanceBracket, chooseChampions, collectSchedule, conferenceTable, decodeScenario,
  encodeScenario, GROUP, MAJORS, officialField, projectOrder, selectField, summarizeSchedule,
} from '../playoff-model.mjs';

const now = Date.parse('2026-11-21T21:00:00Z');
const teams = new Map(Array.from({length:20}, (_, i) => {
  const id = i === 11 ? '87' : String(i + 1);
  return [id,{name:'Team '+id,conference:i >= 15 && i <= 18 ? MAJORS[i-15]
    : i === 5 || i === 19 ? GROUP[0] : 'Independent'}];
}));
const order = [...teams.keys()];
const championships = Object.fromEntries(MAJORS.map((name,i) => [name,{winner:String(16+i)}]));

test('2026 field protects four title winners, highest group team and top-12 Notre Dame', () => {
  const field = selectField(order,teams,championships);
  assert.equal(field.length,12);
  assert.equal(field.find(team=>team.id==='6').reason,'Highest-ranked team from the six eligible conferences');
  assert.equal(field.find(team=>team.id==='87').reason,'Notre Dame top-12 guarantee');
  assert.equal(field.filter(team=>team.reason==='At-large').length,6);
  assert.deepEqual(field.slice(-4).map(team=>team.id),['16','17','18','19']);
  assert.deepEqual(field.slice(0,4).map(team=>team.id),['1','2','3','4']);
  const shifted = order.filter(id=>id!=='87').concat('87');
  assert.equal(selectField(shifted,teams,championships).filter(team=>team.reason==='At-large').length,7);
  assert.ok(!selectField(shifted,teams,championships).some(team=>team.id==='87'));
});

test('unresolved automatic bids reserve slots, absent poll leaves all seeds pending', () => {
  assert.equal(selectField(order,teams,{}).filter(team=>team.id==null).length,4);
  assert.equal(selectField([],teams,championships).filter(team=>team.id==null).length,12);
});

test('fixed bracket propagates picks without reseeding and invalidates changed matchups', () => {
  const field = selectField(order,teams,championships);
  const initial = advanceBracket(field,{});
  assert.deepEqual(initial.rounds[0].map(game=>game.teams.map(t=>t.seed)),[[8,9],[5,12],[7,10],[6,11]]);
  const [first,second] = initial.rounds[0];
  const choices = {[first.id]:first.match+':'+first.teams[1].id,[second.id]:second.match+':'+second.teams[1].id};
  const early = advanceBracket(field,choices);
  assert.deepEqual(early.rounds[1].slice(0,2).map(game=>game.teams.map(t=>t.seed)),[[1,9],[4,12]]);
  choices.q1 = early.rounds[1][0].match+':'+early.rounds[1][0].teams[1].id;
  const progressed = advanceBracket(field,choices);
  assert.equal(progressed.rounds[2][0].teams[0].seed,9);
  choices[first.id] = first.match+':'+first.teams[0].id;
  assert.equal(advanceBracket(field,choices).rounds[2][0].teams[0],null);
});

test('official bracket requires dated and unique seeds and official results win over picks', () => {
  const snapshot = {season:2026,published_at:'2026-12-06T18:00Z',seeds:order.slice(0,12)};
  assert.equal(officialField(snapshot,teams,now),null);
  const field = officialField(snapshot,teams,Date.parse('2026-12-07'));
  assert.equal(field[11].id,'87');
  assert.equal(officialField({...snapshot,seeds:Array(12).fill('87')},teams,Date.parse('2026-12-07')),null);
  const {match,teams:pair} = advanceBracket(field,{}).rounds[0][0];
  const actual = advanceBracket(field,{r89:match+':'+pair[1].id},{r89:pair[0].id});
  assert.equal(actual.rounds[0][0].winner.id,pair[0].id);
  assert.equal(actual.rounds[0][0].official,true);
});

test('a verified final is never overridden and missing or unplayed games add no record', () => {
  const clubs = new Map(['1','2','3'].map(id=>[id,{conference:MAJORS[0]}]));
  const dates = ['2026-11-15','2026-11-26'];
  const games = [
    {id:'won',teams:['1','2'],outcome:'1',scheduled:false,date:dates[0],conference:MAJORS[0]},
    {id:'next',teams:['1','3'],outcome:null,scheduled:true,date:dates[1],conference:MAJORS[0]},
    {id:'missing',teams:['2','3'],outcome:null,scheduled:false,date:dates[1],conference:MAJORS[0]},
  ];
  const s = summarizeSchedule(clubs,games,{won:'2',next:'3',missing:'2'},now);
  assert.deepEqual(s.used,{next:'3'});
  assert.deepEqual(s.rows.get('1').conference,{wins:1,losses:1,ties:0,unknown:0});
  assert.equal(s.rows.get('2').overall.unknown,1);
  const standings = conferenceTable(MAJORS[0],clubs,s.rows,s.headToHead,{});
  assert.equal(standings[0].id,'3');
  assert.deepEqual(projectOrder(clubs,s.rows,{},{}),[]);
  assert.equal(projectOrder(clubs,s.rows,{1:8,2:7,3:10},{})[1],'3');
});

test('known title teams take priority and a changed participant invalidates a title pick', () => {
  const school = id => ({id,conference:{wins:1,losses:0,ties:0}});
  const name = MAJORS[0];
  const standings = Object.fromEntries([...MAJORS,...GROUP].map(key=>[key,[school('1'),school('2')]]));
  const official = {[name]:{teams:['3','4'],date:'2026-12-05',status:'Scheduled',winner:null}};
  assert.equal(chooseChampions(standings,official,{[name]:'1.2:1'},now).results[name].winner,null);
  assert.equal(chooseChampions(standings,official,{[name]:'3.4:4'},now).results[name].winner,'4');
  assert.equal(chooseChampions(standings,{[name]:{...official[name],winner:'3'}},{[name]:'3.4:4'},now).results[name].winner,'3');
  assert.equal(chooseChampions(standings,official,{[name]:'3.4:4'},Date.parse('2026-12-06')).results[name].winner,null);
});

test('deduplicates reciprocal results and rejects two conflicting finals', () => {
  const row = {id:'7',date:'2026-11-15',opponent_id:'2',opponent:'Team 2',final:true,result:'W'};
  const other = {...row,opponent_id:'1',opponent:'Team 1',result:'L'};
  const data = {'1':{games:[row]},'2':{games:[other]}};
  assert.equal(collectSchedule(data,teams,{})[0].outcome,'1');
  other.result = 'W';
  assert.deepEqual(collectSchedule(data,teams,{}),[]);
});

test('scenario URL roundtrips choices and reset preserves only Notre Dame focus', () => {
  const state = {games:{99:'87'},titles:{[MAJORS[0]]:'1.2:1'},bracket:{r89:'3.4:4'},team:'87'};
  assert.deepEqual(decodeScenario(encodeScenario(state,'87')),state);
  assert.equal(encodeScenario(decodeScenario(''),'87'),'#playoff?team=87');
});

test('head-to-head breaks a fully played conference tie before published rankings', () => {
  const league = MAJORS[0];
  const clubs = new Map(['1','2','3','4'].map(id=>[id,{conference:league}]));
  const match = (id, pair, winner) => ({
    id,date:'2026-11-16',teams:pair,outcome:winner,scheduled:false,conference:league,
  });
  const games = [match('a',['1','2'],'1'),match('b',['1','3'],'3'),match('c',['2','4'],'2')];
  const totals = summarizeSchedule(clubs,games,{},now);
  const table = conferenceTable(league,clubs,totals.rows,totals.headToHead,{1:20,2:1});
  assert.ok(table.findIndex(row=>row.id==='1') < table.findIndex(row=>row.id==='2'));
  assert.equal(table.find(row=>row.id==='1').provisionalTie,false);
});
