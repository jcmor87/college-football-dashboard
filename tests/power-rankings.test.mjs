import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {rankDifference} from '../power-rankings.mjs';

test('positive differences mean Saturday HQ ranks a team higher', () => {
  assert.equal(rankDifference(4, 10), 6);
  assert.equal(rankDifference(10, 4), -6);
  assert.equal(rankDifference(4, 4), 0);
  assert.equal(rankDifference(null, 4), null);
  assert.equal(rankDifference(4, undefined), null);
});
