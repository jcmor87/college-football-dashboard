import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {movement, rankAt} from '../ranking-history.mjs';

test('reports rank movement and transitions out of and into the poll', () => {
  assert.equal(movement(8, 3), '↑ 5');
  assert.equal(movement(3, 8), '↓ 5');
  assert.equal(movement(3, 3), '—');
  assert.equal(movement(null, 8), 'New entry');
  assert.equal(movement(8, null), 'Unranked · Dropped out');
  assert.equal(movement(null, null), 'Unranked');
});

test('distinguishes an unavailable poll from an absent team', () => {
  const missing = rankAt({label: 'Week 3'}, '87');
  const unranked = rankAt({poll: {ranks: {'61': 1}}}, '87');
  assert.equal(unranked, null);
  assert.equal(missing, undefined);
  assert.equal(movement(3, missing), 'Poll unavailable');
  assert.equal(movement(missing, 4), '—');
});
