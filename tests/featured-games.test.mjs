import assert from 'node:assert/strict';
import {test} from 'node:test';

import {selectFeaturedGames} from '../featured-games.mjs';

const teams = [
  {id: 1, name: 'First', rank: 1},
  {id: '2', name: 'Second', rank: 25},
  {id: '3', name: 'Third', rank: null},
  {id: '4', name: 'Fourth', rank: 26},
];
const snapshot = {poll: 'AP Top 25', teams, week: 12};
const game = (id, date, away_id, home_id, fields = {}) => ({
  id, date, away_id, home_id, week: 12, ...fields,
});

test('ranks two AP teams ahead of one, sorts by kickoff within each group, and excludes unranked games', () => {
  const games = [
    game('one-late', '2026-11-21T21:00Z', '3', '1', {status: 'Scheduled'}),
    game('two-late', '2026-11-21T19:00-06:00', '2', '1', {status: 'Final', away_score: '20', home_score: '0'}),
    game('unranked', '2026-11-20T14:00Z', '3', '4'),
    game('one-early', '2026-11-20T15:00Z', 1, '3', {status: 'Halftime'}),
    game('two-early', '2026-11-21T23:00Z', '1', 2),
    game('other-week', '2026-11-15T23:00Z', '1', '2', {week: 11}),
  ];
  const selection = selectFeaturedGames({...snapshot, games});
  assert.equal(selection.status, 'available');
  assert.deepEqual(selection.games.map(row => row.id), ['two-early', 'two-late', 'one-early', 'one-late']);
  assert.deepEqual(selection.games.map(row => [row.awayRank, row.homeRank]), [
    [1, 25], [25, 1], [1, null], [null, 1],
  ]);
  assert.equal(selection.games[1].home_score, '0');
  assert.equal(selection.games[2].status, 'Halftime');
});

test('retains only the best five games and leaves unknown kickoff after known times', () => {
  const games = Array.from({length: 6}, (_, i) => game(i, `2026-11-21T${23 - i}:00Z`, '3', '2'));
  games.push(game('unknown', null, '1', '2'));
  games.push(game('known', '2026-11-22T23:00Z', '1', '2'));
  assert.deepEqual(selectFeaturedGames({...snapshot, games}).games.map(row => row.id), ['known', 'unknown', 5, 4, 3]);
});

test('explicit IDs take precedence and older snapshots use only unique exact names', () => {
  const games = [
    game('direct', '2026-11-21T14:00Z', '1', '3', {away: 'Different name', home: 'Second'}),
    game('no-name-override', '2026-11-21T15:00Z', '99', '3', {away: 'Second'}),
    game('legacy-unique', '2026-11-21T16:00Z', null, null, {away: 'Second', home: 'Third'}),
    game('legacy-ambiguous', '2026-11-21T17:00Z', null, null, {away: 'First', home: 'Third'}),
  ];
  const result = selectFeaturedGames({...snapshot, games, teams: [...teams, {id: '5', name: 'First', rank: null}]});
  assert.deepEqual(result.games.map(row => [row.id, row.awayRank, row.homeRank]), [
    ['direct', 1, null], ['legacy-unique', 25, null],
  ]);
});

test('reports unavailable AP data separately from empty or unranked schedules', () => {
  const games = [game('one', '2026-11-21T14:00Z', '1', '2')];
  assert.deepEqual(selectFeaturedGames({...snapshot, poll: null, games}), {status: 'no-poll', games: []});
  assert.deepEqual(selectFeaturedGames({...snapshot, poll: 'Saturday HQ Power Rankings', games}), {status: 'no-poll', games: []});
  assert.deepEqual(selectFeaturedGames({...snapshot, teams: [], games}), {status: 'no-poll', games: []});
  assert.deepEqual(selectFeaturedGames({...snapshot, games: []}), {status: 'no-games', games: []});
  assert.deepEqual(selectFeaturedGames({...snapshot, games: [game('none', null, '3', '4')]}), {
    status: 'no-games', games: [],
  });
});
