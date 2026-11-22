import test from 'node:test';
import assert from 'node:assert/strict';

import {freshness, gameReports} from '../injury-availability.mjs';

const game = {id: '100', opponent_id: '200', date: '2026-11-28T17:00Z', final: false};
const team = {latest_report_timestamp: '2026-11-23T10:00Z'};
const now = Date.parse('2026-11-27T11:00Z');
const snapshot = {
  schema_version: 1, season: 2026, refresh_status: 'current', generated_at: '2026-11-27T10:00Z',
  games: {'100': {kickoff: '2026-11-28T12:00-05:00', opponent_id: '200', teams: {'87': team}}},
};

test('shows only an exact season, game, opponent and kickoff match', () => {
  assert.deepEqual(gameReports(snapshot, 2026, game), {'87': team});
  assert.equal(gameReports(snapshot, 2027, game), null);
  assert.equal(gameReports(snapshot, 2026, {...game, id: '101'}), null);
  assert.equal(gameReports(snapshot, 2026, {...game, date: '2026-11-29T17:00Z'}), null);
  assert.equal(gameReports(snapshot, 2026, {...game, opponent_id: '201'}), null);
});

test('tracks report age and snapshot age independently', () => {
  assert.deepEqual(freshness(snapshot, team, game, now), {
    historical: false, staleReport: true, staleSnapshot: false,
  });
  const recent = {latest_report_timestamp: '2026-11-27T09:00Z'};
  assert.equal(freshness({...snapshot, refresh_status: 'stale'}, recent, game, now).staleSnapshot, true);
  assert.equal(freshness({...snapshot, generated_at: '2026-11-26T10:00Z'}, recent, game, now).staleSnapshot, true);
  assert.equal(freshness(snapshot, recent, {...game, final: true}, Date.parse('2027-02-10')).staleReport, false);
  assert.equal(freshness(snapshot, null, game, now).staleReport, false);
});
