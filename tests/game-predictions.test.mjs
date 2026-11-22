import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {forecastLabel, predictionCard} from '../game-predictions.mjs';

test('shows the favored side probability and uses an even label for ties', () => {
  assert.deepEqual(forecastLabel({probability:.25},'A','B'), {team:'B',chance:'75.0%'});
  assert.deepEqual(forecastLabel({probability:.5},'A','B'), {team:'Even matchup',chance:'50.0%'});
});

test('keeps preview and final result labels separate', () => {
  const row = {first:'1', second:'2', kickoff:'2026-11-24T00:00:00Z', venue:0,
    status:'Final', actual:{first:17,second:3}, is_preview:true,
    prediction:{probability:.65, margin:5, confidence:'moderate', rating_points:5, venue_points:0}};
  const names = new Map([['1',{name:'First'}],['2',{name:'Second'}]]);
  const html = predictionCard(row,names);
  assert.match(html,/Neutral site/);
  assert.match(html,/Preview estimate/);
  assert.match(html,/Final.*First 17–3 Second/);
});
