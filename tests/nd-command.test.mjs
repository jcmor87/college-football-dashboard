import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {rollingFive} from '../team-profiles.mjs';
import {commonOpponents, compareOpponent, rankedWins, remainingGames} from '../nd-command.mjs';

const game = {final:true, result:'W', game_poll_date:'2026-10-04', opponent_rank_at_game:9,
  opponent_rank_now:19, opponent_id:'61', opponent:'Georgia', points:24, allowed:14};

test('rolling averages require a full five-game window without skipping missing values', () => {
  assert.deepEqual(rollingFive([1, 2, 3, 4, 5, null, 0, 0, 0, 0, 0]),
    [null, null, null, null, 3, null, null, null, null, null, 0]);
  assert.deepEqual(rollingFive([]), []);
});

test('compares verified averages, including real zero and unavailable values', () => {
  const left = {schedule_status:'available', stats:{points:30, allowed:10, yards:390, turnovers:0}};
  const right = {schedule_status:'available', stats:{points:20, allowed:10, yards:400, turnovers:1}};
  const rows = new Map(compareOpponent(left, right).map(row => [row.key, row]));
  assert.deepEqual(['points','allowed','yards','yards_allowed','turnovers'].map(key => rows.get(key).edge),
    [1, 0, -1, 0, 1]);
  assert.equal(rows.get('yards_allowed').left, null);
  assert.ok(compareOpponent(left, {...right, schedule_status:'stale'}).every(row => row.edge === 0 && row.right === null));
  assert.ok(compareOpponent(left, undefined).every(row => row.edge === 0));
});

test('common opponents match verified finals by ID and keep repeat meetings', () => {
  const other = {...game, opponent:'Georgia Bulldogs'};
  const rows = commonOpponents([game, other], [other, {...other, final:false}, {...other, opponent_id:'99'}]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].games, [game, other]);
  assert.deepEqual(rows[0].opponentGames, [other]);
  assert.deepEqual(commonOpponents([game], undefined), []);
});

test('ranked wins require final victories and verified kickoff AP rank', () => {
  assert.deepEqual(rankedWins([game, {...game, opponent_rank_at_game:null},
    {...game, game_poll_date:null}, {...game, result:'L'}, {...game, final:false},
    {...game, opponent_rank_at_game:26}]), [game]);
});

test('outlook excludes completed, cancelled and expired scheduled games', () => {
  const upcoming = {final:false, date:'2026-11-28T22:00Z', status:'Scheduled'};
  assert.deepEqual(remainingGames([upcoming, {...upcoming, status:'Canceled'},
    {...upcoming, final:true}, {...upcoming, date:'2026-11-10T00:00Z'}], Date.parse('2026-11-21')),
    [upcoming]);
});
