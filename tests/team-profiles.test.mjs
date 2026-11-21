import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {advantage, profileHref, teamFromHash, trendGames} from '../team-profiles.mjs';

test('profile URLs preserve the ESPN team ID and reject malformed routes', () => {
  assert.equal(profileHref('87'), '#team=87');
  assert.equal(teamFromHash(profileHref('87')), '87');
  for (const hash of ['', '#rankings', '#team=', '#team=87&amp;', '#team=Notre%20Dame']) {
    assert.equal(teamFromHash(hash), null);
  }
});

test('comparison handles lower-is-better, ties and missing values', () => {
  assert.equal(advantage(15, 10, -1), -1);
  assert.equal(advantage(15, 10, 1), 1);
  assert.equal(advantage(0, 0, -1), 0);
  assert.equal(advantage(null, 10, 1), 0);
});

test('trend windows contain only completed games', () => {
  const games = [{id: 0, final: false}, ...Array.from({length: 7}, (_, i) => ({id: i + 1, final: true}))];
  assert.deepEqual(trendGames(games, true).map(game => game.id), [3, 4, 5, 6, 7]);
  assert.equal(trendGames(games, false).length, 7);
});
