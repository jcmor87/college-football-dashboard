import {readFileSync, writeFileSync, renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildInput, COUNTS, simulation} from './playoff-simulation.mjs';

const read = file => JSON.parse(readFileSync(new URL('./data/' + file, import.meta.url),'utf8'));
const dashboard = read('dashboard.json');
if (dashboard.season === 2026) {
  const [destination = 'data/playoff-simulation.json', time] = process.argv.slice(2);
  const asOf = time ? Date.parse(time) : Date.now();
  if (!Number.isFinite(asOf)) throw new Error('Invalid simulation snapshot time');
  const input = buildInput({
    dashboard, profiles:read('team-profiles.json'), power:read('power-rankings/latest.json'),
    predictions:read('predictions/latest.json'), titles:read('cfp-title-games.json'),
    official:read('cfp-official-bracket.json'),
  },asOf);
  const engine = simulation(input);
  const baseline = Object.fromEntries(COUNTS.map(count => [count,engine.runTo(count)]));
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0,16);
  const temporary = destination + '.' + process.pid + '.tmp';
  writeFileSync(temporary, JSON.stringify({fingerprint,input,baseline})+'\n');
  renameSync(temporary,destination);
  console.log(`Playoff model ${fingerprint}; ${baseline[50000].denominators.qualification}/50000 complete fields`);
}
