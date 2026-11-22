const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {createReadStream, existsSync, readFileSync} = require('node:fs');
const {createServer} = require('node:http');
const {resolve} = require('node:path');
const prefix = '/college-football-dashboard/';
const root = resolve(__dirname, '..');
(async () => {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const file = path === prefix ? 'index.html' : path.slice(prefix.length);
    if (!path.startsWith(prefix) || !/^(?:index\.html|[a-z-]+\.mjs|data\/[a-z0-9/.-]+\.json)$/.test(file) ||
            file.split('/').includes('..') || !existsSync(resolve(root, file))) {
      response.writeHead(404).end();
      return;
    }
    const contentType = file.endsWith('.mjs') ? 'text/javascript'
      : file.endsWith('.json') ? 'application/json' : 'text/html';
    response.writeHead(200, {'Content-Type': contentType});
    createReadStream(resolve(root, file)).pipe(response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH});
    const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const url = `http://127.0.0.1:${server.address().port}${prefix}`;
    let profileFetches = 0;
    page.on('request', r => {if (r.url().endsWith('/data/team-profiles.json')) profileFetches++;});
    await page.goto(url);
    await page.getByRole('button', {name:'All FBS Teams', exact:true}).click();
    await page.locator('#teamList .team').first().waitFor();
    assert.equal(profileFetches, 0);
    await page.locator('#teamList .team').filter({hasText:'Notre Dame'}).click();
    await page.getByRole('heading',{name:'2026 Season Schedule'}).waitFor();
    assert.equal(new URL(page.url()).hash,'#team=87');
    assert.equal(await page.locator('.trend-chart li').count(),5);
    await page.locator('.trend-range').selectOption('all');
    assert.ok(await page.locator('.trend-chart li').count() > 5);
    await page.locator('.trend-metric').selectOption('yards');
    assert.match(await page.locator('.trend-legend').innerText(),/Net passing yards/);
    await page.locator('.compare-first').selectOption('61');
    await page.locator('.compare-second').selectOption('194');
    assert.ok(await page.locator('.stat-advantage').count() > 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.getByRole('button',{name:'AP Ranking History'}).click();
    await page.locator('#historyPanel .history-table thead a').first().click();
    await page.getByRole('heading',{name:'2026 Season Schedule'}).waitFor();
    assert.equal(profileFetches, 1);
    await page.getByRole('button',{name:/This Week.s Games/}).click();
    await page.locator('#mainExtra .score').first().waitFor();
    await page.getByRole('button',{name:'All FBS Teams'}).click();
    await page.locator('#filters button').filter({hasText:'Southeastern Conference'}).click();
    await page.locator('#teamList a').filter({hasText:'Georgia Bulldogs'}).click();
    await page.getByRole('heading',{name:'Georgia',exact:true}).waitFor();
    await page.goto(url+'#team=87');
    await page.getByRole('heading',{name:'Notre Dame',exact:true}).waitFor();
    await page.reload();
    await page.getByRole('heading',{name:'Notre Dame',exact:true}).waitFor();
    await page.locator('.nd-spotlight-link').click();
    const command = page.locator('#ndPanel');
    await command.getByRole('heading', {name:'Opponent Intelligence'}).waitFor();
    assert.equal(new URL(page.url()).hash, '#notre-dame');
    await page.reload();
    await command.getByRole('heading', {name:'AP Ranking Trajectory'}).waitFor();
    await command.locator('.nd-trajectory select').selectOption({index:0});
    assert.match(await command.locator('.nd-poll-summary').innerText(), /Preseason/);
    await command.locator('.trend-metric').selectOption('rollingScoring');
    assert.match(await command.locator('.trend-legend').innerText(), /5-game avg/);
    await command.locator('.nd-opponent').selectOption({index:0});
    assert.ok(await command.locator('.nd-comparison table').count());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    const newsRoute = '**/data/notre-dame-news.json';
    const publishedAt = new Date(Date.now() - 60_000).toISOString();
    const articles = Array.from({length: 21}, (_, index) => ({
      title: index === 0 ? '<b>Literal headline</b>' : 'Fixture headline ' + (index + 1),
      source: 'NDNation', url: 'https://ndnation.com/fixture-' + (index + 1) + '/', published_at: publishedAt,
    }));
    const newsSnapshot = {status: 'current', last_success_at: publishedAt, articles};
    let releaseNews;
    const newsGate = new Promise(resolve => { releaseNews = resolve; });
    await page.route(newsRoute, async route => {
      await newsGate;
      await route.fulfill({json: {...newsSnapshot, articles: [
        {...articles[0], url: 'javascript:alert(1)'}, ...articles,
      ]}});
    });
    await page.reload();
    const news = command.getByRole('region', {name: 'Notre Dame in the News'});
    await news.getByText('Loading Notre Dame football news…').waitFor();
    await command.getByRole('heading', {name: 'Opponent Intelligence'}).waitFor();
    releaseNews();
    await news.getByText(/Last successful refresh/).waitFor();
    assert.equal(await news.getByRole('link').count(), 5);
    assert.equal(await news.locator('b').count(), 0);
    const headline = news.getByRole('link', {name: '<b>Literal headline</b>'});
    assert.equal(await headline.getAttribute('href'), articles[0].url);
    assert.equal(await headline.getAttribute('target'), '_blank');
    assert.equal(await headline.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(await news.locator('li time').first().getAttribute('datetime'), publishedAt);
    await news.getByRole('button', {name: 'Show More'}).click();
    assert.equal(await news.getByRole('link').count(), 20);
    assert.equal(await news.getByRole('button', {name: 'Show Less'}).getAttribute('aria-expanded'), 'true');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await news.getByRole('button', {name: 'Show Less'}).click();
    assert.equal(await news.getByRole('link').count(), 5);
    await page.unroute(newsRoute);

    const tablet = await browser.newPage({viewport: {width: 768, height: 1024}, isMobile: true, hasTouch: true});
    await tablet.route(newsRoute, route => route.fulfill({json: {...newsSnapshot, status: 'stale'}}));
    await tablet.goto(url+'#notre-dame');
    await tablet.locator('.nd-news').getByText(/Stale news/).waitFor();
    await tablet.getByRole('button', {name: 'Show More'}).click();
    assert.ok(await tablet.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await tablet.close();

    await page.route(newsRoute, route => route.fulfill({json: {...newsSnapshot, articles: []}}));
    await page.reload();
    await news.getByText(/No recent Notre Dame football articles/).waitFor();
    assert.equal(await news.getByRole('button').count(), 0);
    await page.unroute(newsRoute);
    await page.route(newsRoute, route => route.fulfill({status: 503, body: 'Unavailable'}));
    await page.reload();
    await news.getByText(/news is temporarily unavailable/).waitFor();
    await command.getByRole('heading', {name: 'Recent Form'}).waitFor();
    await page.unroute(newsRoute);
    const rosterRoute = '**/data/notre-dame-roster.json';
    const roster = command.getByRole('region', {name: 'Notre Dame Roster & Depth Chart'});
    const fixtureBio = 'https://fightingirish.com/sports/football/roster/player/fixture-qb';
    const rosterFixture = {
      season: 2026, verified_at: publishedAt, roster_status: 'current', depth_status: 'current',
      players: {
        101: {name: 'Fixture QB', position: 'QB', group: 'offense', bio_url: fixtureBio},
        102: {name: 'Fixture Reserve', position: 'QB', group: 'offense', bio_url: fixtureBio+'-reserve'},
        103: {name: 'Fixture Alternate', position: 'QB', group: 'offense', bio_url: fixtureBio+'-alternate'},
        201: {name: 'Fixture CB', position: 'CB', group: 'defense', bio_url: fixtureBio+'-defense'},
        202: {name: 'Unsafe Player', position: 'CB', group: 'defense', bio_url: 'https://example.com/roster/player'},
      },
      depth: {
        opponent: 'Test Opponent', verified_at: publishedAt,
        url: 'https://fightingirish.com/documents/00000000-0000-0000-0000-000000000001.pdf',
        sides: {offense: [{position: 'QB', tiers: [['101'], ['102', '103']]}],
          defense: [{position: 'CB', tiers: [['201']]}]},
      },
    };
    await page.route(rosterRoute, route => route.fulfill({json: rosterFixture}));
    await page.reload();
    const offense = roster.getByRole('table', {name: 'Offense depth chart'});
    const defense = roster.getByRole('table', {name: 'Defense depth chart'});
    await offense.waitFor();
    const player = offense.getByRole('link', {name: 'Fixture QB'});
    assert.equal(await player.getAttribute('href'), fixtureBio);
    assert.equal(await player.getAttribute('target'), '_blank');
    assert.equal(await player.getAttribute('rel'), 'noopener noreferrer');
    assert.match(await offense.innerText(), /Fixture Reserve or Fixture Alternate/);
    await roster.getByRole('button', {name: 'Defense'}).click();
    await defense.getByRole('link', {name: 'Fixture CB'}).waitFor();
    assert.equal(await roster.getByRole('button', {name: 'Defense'}).getAttribute('aria-pressed'), 'true');
    await roster.getByText('Full defense roster by position', {exact: true}).click();
    assert.equal(await roster.getByRole('table', {name: 'Defense roster'}).getByRole('link').count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.unroute(rosterRoute);

    for (const width of [768, 1280]) {
      const preview = await browser.newPage({viewport: {width, height: 1024}, hasTouch: width === 768});
      await preview.route(rosterRoute, route => route.fulfill({
        json: {...rosterFixture, depth: null, depth_status: 'unavailable', roster_status: 'stale'},
      }));
      await preview.goto(url+'#notre-dame');
      const previewRoster = preview.getByRole('region', {name: 'Notre Dame Roster & Depth Chart'});
      await previewRoster.getByText(/depth-chart assignments are unavailable/).waitFor();
      await previewRoster.getByText(/Saved roster/).waitFor();
      await previewRoster.getByRole('button', {name: 'Defense'}).click();
      await previewRoster.getByRole('table', {name: 'Defense roster'}).getByRole('link', {name: 'Fixture CB'}).waitFor();
      assert.ok(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await preview.close();
    }

    await page.route(rosterRoute, route => route.fulfill({status: 503, body: 'Unavailable'}));
    await page.reload();
    await roster.getByText(/roster is temporarily unavailable/).waitFor();
    await roster.getByRole('link', {name: 'Official Notre Dame roster'}).waitFor();
    await command.getByRole('heading', {name: 'Notre Dame in the News'}).waitFor();
    await page.unroute(rosterRoute);
    const injuryRoute = '**/data/injury-availability.json';
    const injuryData = JSON.parse(readFileSync(resolve(root, 'data/injury-availability.json'), 'utf8'));
    const injuryPreview = await browser.newPage({
      viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true,
    });
    // Freeze the clock before Syracuse's kickoff so the upcoming selection is deterministic.
    await injuryPreview.clock.setFixedTime(new Date('2026-11-22T21:00:00Z'));
    await injuryPreview.route(injuryRoute, route => route.fulfill({
      json: {...injuryData, refresh_status: 'stale'},
    }));
    await injuryPreview.goto(url+'#notre-dame');
    const injuryPanel = injuryPreview.getByRole('region', {name: 'Injury Impact Index'});
    const picker = injuryPanel.getByLabel('Availability matchup');
    await injuryPanel.getByText(/Next scheduled matchup/).waitFor();
    assert.equal(await picker.inputValue(), '401858314');
    assert.equal(await injuryPanel.getByText('No verified report available.', {exact: true}).count(), 2);
    await injuryPanel.getByText('Experimental — availability data only', {exact: true}).waitFor();
    const coverage = injuryPanel.locator('.notice');
    await coverage.getByText('Injury coverage is partial', {exact: true}).waitFor();
    await coverage.getByText(/New injury reports are found, reviewed, and entered manually/).waitFor();
    await coverage.getByText(/GitHub Actions refresh only validates and republishes existing reviewed reports/).waitFor();
    assert.equal(await injuryPanel.getByText('Verified reported outs', {exact: true}).count(), 0);
    await picker.selectOption('401858307');
    await injuryPanel.getByText('Verified reported outs · 1', {exact: true}).waitFor();
    await injuryPanel.getByText('Verified reported outs · 2', {exact: true}).waitFor();
    await coverage.getByText('Injury coverage is partial', {exact: true}).waitFor();
    await injuryPanel.getByText(/Saved availability snapshot/).waitFor();
    await injuryPanel.getByText(/Historical pregame reports/).first().waitFor();
    await injuryPanel.getByText(/Earlier report/).first().waitFor();
    const injuryLink = injuryPanel.getByRole('link', {name: 'South Bend Tribune via Yahoo Sports'}).first();
    assert.ok((await injuryLink.getAttribute('href')).startsWith('https://sports.yahoo.com/'));
    assert.equal(await injuryLink.getAttribute('target'), '_blank');
    assert.equal(await injuryLink.getAttribute('rel'), 'noopener noreferrer');
    await injuryPanel.getByRole('heading', {name: 'Offense', exact: true}).waitFor();
    await injuryPanel.getByRole('heading', {name: 'Defense', exact: true}).first().waitFor();
    assert.ok(await injuryPreview.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await injuryPreview.unroute(injuryRoute);
    await injuryPreview.route(injuryRoute, route => route.fulfill({status: 503, body: 'Unavailable'}));
    await injuryPreview.reload();
    await injuryPanel.getByText(/Availability data could not be loaded/).waitFor();
    assert.equal(await injuryPanel.getByText('No verified report available.', {exact: true}).count(), 2);
    await injuryPreview.getByRole('heading', {name: 'Notre Dame in the News'}).waitFor();
    await injuryPreview.getByRole('heading', {name: 'Notre Dame Roster & Depth Chart'}).waitFor();
    await injuryPreview.close();

    for (const width of [768, 1280]) {
      const injuryWide = await browser.newPage({viewport: {width, height: 1024}, hasTouch: width === 768});
      await injuryWide.goto(url+'#notre-dame');
      await injuryWide.getByLabel('Availability matchup').selectOption('401858307');
      await injuryWide.getByRole('region', {name: 'Injury Impact Index'}).getByText('Will Black', {exact: true}).waitFor();
      assert.ok(await injuryWide.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await injuryWide.close();
    }
    await command.getByRole('link', {name:'Full team profile'}).click();
    await page.getByRole('heading',{name:'Notre Dame',exact:true}).waitFor();
    await page.getByRole('button', {name:'Power Rankings', exact:true}).click();
    const power = page.locator('#powerPanel');
    await power.getByRole('heading', {name:'Notre Dame Power Analysis'}).waitFor();
    assert.ok(await power.locator('.power-table tbody tr').count() > 100);
    await power.locator('.power-conference').selectOption('Independent');
    await power.locator('.power-search').fill('Notre Dame');
    assert.equal(await power.locator('.power-table tbody tr').count(),1);
    await power.locator('.power-week').selectOption({index:0});
    assert.match(await power.locator('.power-week-rank').innerText(), /No eligible ranking/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.goto(url+'#notre-dame');
    await command.getByRole('link', {name:'Power ranking analysis'}).click();
    await power.getByRole('heading', {name:'Notre Dame Power Analysis'}).waitFor();
    assert.equal(new URL(page.url()).hash, '#power=87');
    await page.reload();
    await power.getByRole('heading', {name:'Notre Dame Power Analysis'}).waitFor();
    await page.getByRole('button', {name:'Game Predictions', exact:true}).click();
    const predictions = page.locator('#predictionPanel');
    await predictions.getByRole('heading', {name:'Accuracy Dashboard'}).waitFor();
    assert.match(await predictions.locator('.prediction-report').innerText(), /Saturday HQ/);
    await predictions.locator('.prediction-mode').selectOption('backtest');
    assert.match(await predictions.locator('.prediction-report').innerText(), /Mean forecast/);
    await predictions.locator('.prediction-week').selectOption('');
    await predictions.locator('.prediction-search').fill('Notre Dame');
    await predictions.locator('.prediction-conference').selectOption('Independent');
    for (const matchup of await predictions.locator('.prediction-game').all()) {
      assert.match(await matchup.innerText(), /Notre Dame/);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.reload();
    await predictions.getByRole('heading', {name:'Accuracy Dashboard'}).waitFor();
    await page.goto(url+'#notre-dame');
    await command.getByRole('heading', {name:'Notre Dame Matchup Predictor'}).waitFor();
    const dashboard = JSON.parse(readFileSync(resolve(root, 'data/dashboard.json'), 'utf8'));
    let checkedAt = new Date().toISOString();
    let changedAt = dashboard.updated_at;
    await page.route('**/data/refresh-status.json', route => route.fulfill({json:{
      checked_at:checkedAt, dashboard_updated_at:changedAt,
    }}));
    await page.goto(url+'#about');
    const about = page.locator('#mainExtra');
    await about.getByText('Saturday HQ · Version 2.0').waitFor();
    for (const label of ['AP Ranking History','Team Profiles','Notre Dame Command Center','Power Rankings','Game Predictions']) {
      await about.getByText(label,{exact:true}).waitFor();
    }
    await page.reload();
    await about.getByText('Saturday HQ · Version 2.0').waitFor();
    await page.getByText(/Refresh checked/).waitFor();
    checkedAt = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
    await page.reload();
    await page.getByText(/Refresh delayed/).waitFor();
    changedAt = 'mismatched-response';
    await page.reload();
    await page.getByText('Refresh check unavailable').waitFor();
    await about.getByRole('link',{name:'Game Predictions'}).click();
    await predictions.getByRole('heading',{name:'Accuracy Dashboard'}).waitFor();
    await page.setViewportSize({width:320,height:720});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.setViewportSize({width:768,height:900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.route('**/data/predictions/latest.json', route => route.fulfill({status:503,body:'Unavailable'}));
    await page.reload();
    await predictions.getByRole('alert').filter({hasText:'could not load'}).waitFor();
    await page.unroute('**/data/predictions/latest.json');
    await page.getByRole('button',{name:'National Rankings',exact:true}).click();
    await page.getByRole('heading',{name:'National Poll Rankings',exact:true}).waitFor();
    await page.goto(url+'#notre-dame');
    await command.getByText('Explore Notre Dame outcomes',{exact:true}).click();
    await command.locator('.nd-playoff-result').waitFor();
    await command.getByRole('heading',{name:'Notre Dame Playoff Probabilities'}).waitFor();
    await command.locator('.nd-simulator .sim-count').selectOption('10000');
    assert.match(await command.locator('.nd-simulator .sim-results').innerText(),/Committee Sensitivity/);
    await command.getByRole('link',{name:'Open full Playoff Explorer'}).click();
    const playoff = page.locator('#playoffPanel');
    await playoff.getByRole('heading',{name:'12-Team Bracket'}).waitFor();
    assert.match(new URL(page.url()).hash,/team=87/);
    assert.equal(await playoff.locator('.playoff-bracket .playoff-match').count(),11);
    await page.setViewportSize({width:320,height:720});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.setViewportSize({width:768,height:900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    const remaining = playoff.locator('select[data-kind="games"]').first();
    if (await remaining.count()) {
      await remaining.selectOption({index:1});
      assert.match(new URL(page.url()).hash, /[?&]g=/);
      const shared = new URL(page.url()).hash;
      await page.reload();
      await playoff.locator('select[data-kind="games"]').first().waitFor();
      assert.equal(new URL(page.url()).hash,shared);
    }
    const title = playoff.locator('select[data-kind="titles"]').first();
    if (await title.count()) {
      await title.selectOption({index:1});
      assert.match(new URL(page.url()).hash, /[?&]t=/);
    }
    await playoff.locator('.playoff-sim-details summary').click();
    const simulator = playoff.locator('.playoff-sim-target');
    await simulator.getByRole('heading',{name:'Seed Distribution'}).waitFor();
    await page.setViewportSize({width:320,height:720});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await simulator.locator('.sim-count').selectOption('50000');
    if (/[?&][gtb]=/.test(new URL(page.url()).hash)) {
      await simulator.getByRole('button',{name:'Run what-if comparison'}).click();
      await simulator.locator('.sim-team').selectOption('61');
      await simulator.locator('.sim-count').selectOption('1000');
      await simulator.getByRole('button',{name:'Run what-if comparison'}).click();
      await simulator.getByText('Scenario complete: 1,000 draws.').waitFor({timeout:20000});
      assert.match(await simulator.locator('.sim-results').innerText(),/Scenario resolved/);
    }
    await page.setViewportSize({width:768,height:900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await playoff.getByRole('button',{name:'Reset scenario'}).click();
    assert.equal(new URL(page.url()).hash,'#playoff?team=87');
    await page.goto(url+'#team=999999');
    await page.getByRole('alert').filter({hasText:'not found'}).waitFor();
    await page.route('**/data/team-profiles.json',route=>route.fulfill({status:503,body:'Unavailable'}));
    await page.goto(url+'#team=87');
    await page.reload();
    await page.getByRole('alert').filter({hasText:'could not load'}).waitFor();
    const standalone = await browser.newPage({viewport:{width:320,height:720},isMobile:true,hasTouch:true});
    const standalonePanel = standalone.locator('#simulatorPanel');
    let releaseSnapshot;
    const snapshotGate = new Promise(resolve => { releaseSnapshot = resolve; });
    const snapshotRoute = '**/data/playoff-simulation.json';
    await standalone.route(snapshotRoute, async route => {
      await snapshotGate;
      await route.continue();
    });
    await standalone.goto(url);
    const simulatorTab = standalone.getByRole('button',{name:'Playoff Simulator',exact:true});
    assert.equal(await simulatorTab.evaluate(button => {
      const tab = button.getBoundingClientRect();
      const nav = button.parentElement.getBoundingClientRect();
      return tab.left >= nav.left && tab.right <= nav.right;
    }),true);
    await simulatorTab.click();
    assert.equal(new URL(standalone.url()).hash,'#simulator');
    await standalonePanel.getByRole('status').filter({hasText:'Loading precomputed simulations'}).waitFor();
    releaseSnapshot();
    await standalonePanel.getByRole('heading',{name:'Seed Distribution'}).waitFor();
    assert.equal(await simulatorTab.evaluate(button => button.classList.contains('active')),true);
    assert.equal(await standalone.locator('#dashboardGrid').isVisible(),false);
    assert.equal(await standalone.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await standalone.setViewportSize({width:768,height:900});
    await standalone.reload();
    await standalonePanel.getByRole('heading',{name:'Seed Distribution'}).waitFor();
    assert.equal(await standalone.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    const snapshot = JSON.parse(readFileSync(resolve(root,'data/playoff-simulation.json'),'utf8'));
    const game = snapshot.input.events.find(row => row.scheduled && Date.parse(row.date) > snapshot.input.asOf);
    if (game) {
      const matchup = snapshot.input.events.find(row => row.scheduled &&
        Date.parse(row.date) > snapshot.input.asOf && row.teams.includes('87')) ?? game;
      const run = standalonePanel.getByRole('button',{name:'Run what-if comparison'});
      assert.equal(await run.isDisabled(),true);
      await standalonePanel.locator('.sim-game').selectOption(matchup.id);
      await standalonePanel.locator('.sim-winner').selectOption(matchup.teams[0]);
      assert.match(new URL(standalone.url()).hash,/[?&]g=/);
      assert.match(await standalonePanel.locator('.sim-picks').innerText(),/Locked outcomes/);
      await run.click();
      await standalonePanel.getByText('Scenario complete: 1,000 draws.').waitFor({timeout:20000});
      assert.match(await standalonePanel.locator('.sim-results').innerText(),/1 regular-season picks applied/);
      await standalonePanel.locator('.sim-winner').selectOption(matchup.teams[1]);
      assert.match(await standalonePanel.locator('.sim-status').innerText(),/Scenario picks ready/);
      await run.click();
      await standalonePanel.getByText('Scenario complete: 1,000 draws.').waitFor({timeout:20000});
      await standalone.reload();
      await standalonePanel.locator('.sim-winner').waitFor();
      assert.equal(await standalonePanel.locator('.sim-winner').inputValue(),matchup.teams[1]);
      await standalonePanel.locator('.sim-winner').selectOption('');
      assert.equal(await run.isDisabled(),true);
    }
    const pick = game ? game.id + '=' + game.teams[0] : '123=87';
    const selection = '?'+new URLSearchParams({team:'87',g:pick});
    await standalone.goto(url+'#simulator'+selection);
    const explorerLink = standalonePanel.getByRole('link',{name:'Choose or edit outcomes in Playoff Explorer'});
    await explorerLink.waitFor();
    assert.equal(await explorerLink.getAttribute('href'),'#playoff'+selection);
    if (game) {
      await standalonePanel.getByRole('button',{name:'Run what-if comparison'}).click();
      await standalonePanel.getByText('Scenario complete: 1,000 draws.').waitFor({timeout:20000});
      assert.match(await standalonePanel.locator('.sim-results').innerText(), /1 regular-season picks applied/);
    }
    await standalone.getByRole('button',{name:'National Rankings',exact:true}).click();
    await standalone.getByRole('heading',{name:'National Poll Rankings',exact:true}).waitFor();
    assert.equal(await standalonePanel.isVisible(),false);
    await standalone.goBack();
    await standalonePanel.getByRole('heading',{name:'Seed Distribution'}).waitFor();
    await standalone.unroute(snapshotRoute);
    await standalone.route(snapshotRoute, route => route.fulfill({status:503,body:'unavailable'}));
    await standalone.reload();
    await standalonePanel.getByRole('alert').filter({hasText:'Playoff simulation data unavailable'}).waitFor();
    await standalone.unroute(snapshotRoute);
    await standalone.route(snapshotRoute, route => route.fulfill({json:{input:{version:'wrong-version'}}}));
    await standalone.reload();
    await standalonePanel.getByRole('alert').filter({hasText:'Playoff simulation data unavailable'}).waitFor();
    await standalone.unroute(snapshotRoute);
    await standalone.route('**/data/dashboard.json',route => route.fulfill({status:503,body:'unavailable'}));
    await standalone.goto(url+'#simulator');
    await standalone.reload();
    await standalonePanel.getByRole('heading',{name:'Seed Distribution'}).waitFor();
    assert.equal(await standalone.locator('#dataError').isVisible(),false);
    await standalone.getByRole('button',{name:'National Rankings',exact:true}).click();
    await standalone.locator('#dataError').waitFor();
    await standalone.close();
    const featured = await browser.newPage({
      viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, timezoneId: 'America/Los_Angeles',
    });
    const featuredTeam = (id, name, rank) => ({id, name, rank, record: '0-0'});
    const featuredGame = (id, away, home, date, status, scores = {}) => ({
      id, away_id: away.id, home_id: home.id, away: away.name, home: home.name, date, status, week: 12, ...scores,
    });
    const first = featuredTeam('1', 'Ranked Away', 3);
    const second = featuredTeam('2', 'Ranked Home', 8);
    const third = featuredTeam('3', 'Unranked Away', null);
    const fourth = featuredTeam('4', 'Unranked Home', null);
    let featuredSnapshot = {
      poll: 'AP Top 25', week: 12, teams: [first, second, third, fourth],
      games: [
        featuredGame('1', third, fourth, '2026-11-21T17:00Z', 'Scheduled'),
        featuredGame('2', third, first, '2026-11-21T18:00Z', '11/21 - 1:00 PM EST', {time_tbd: true, scheduled: true}),
        featuredGame('3', first, second, '2026-11-21T19:00Z', 'Final', {away_score: '21', home_score: '0'}),
        featuredGame('4', second, fourth, '2026-11-21T20:00Z', 'Halftime', {away_score: '14', home_score: '7'}),
      ],
    };
    await featured.route('**/data/dashboard.json', route => route.fulfill({json: featuredSnapshot}));
    await featured.goto(url);
    await featured.getByRole('heading', {name: 'Top 25 Featured Games'}).waitFor();
    const sidebar = featured.locator('#gamesSidebar');
    await sidebar.getByText('#3 Ranked Away @ #8 Ranked Home', {exact: true}).waitFor();
    assert.deepEqual(await sidebar.locator('.score strong').allTextContents(),
      ['#3 Ranked Away @ #8 Ranked Home', 'Unranked Away @ #3 Ranked Away', '#8 Ranked Home @ Unranked Home']);
    assert.match(await sidebar.locator('.score').nth(0).innerText(), /Nov 21.*11:00 AM.*Final[\s\S]*21 – 0/);
    assert.match(await sidebar.locator('.score').nth(1).innerText(), /Time TBD.*Scheduled[\s\S]*Score pending/);
    assert.match(await sidebar.locator('.score').nth(2).innerText(), /Halftime[\s\S]*14 – 7/);
    assert.ok(await featured.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await featured.getByRole('button', {name: "This Week's Games"}).click();
    assert.deepEqual(await featured.locator('#mainExtra .score strong').allTextContents(),
      ['Unranked Away @ Unranked Home', 'Unranked Away @ Ranked Away', 'Ranked Away @ Ranked Home', 'Ranked Home @ Unranked Home']);
    assert.match(await featured.locator('#mainExtra .score').nth(1).innerText(), /11\/21 - 1:00 PM EST/);
    featuredSnapshot = {...featuredSnapshot, games: []};
    await featured.reload();
    await sidebar.getByText(/No AP Top 25 matchups/).waitFor();
    featuredSnapshot = {...featuredSnapshot, poll: null};
    await featured.reload();
    await sidebar.getByText(/official AP Top 25 is unavailable/).waitFor();
    assert.equal(await sidebar.locator('.score').count(), 0);
    await featured.close();

    const desktop = await browser.newPage({viewport:{width:1280,height:1100}});
    await desktop.goto(url+'#team=87');
    await desktop.getByRole('heading',{name:'2026 Season Schedule'}).waitFor();
    await desktop.screenshot({path: process.env.PROFILE_SCREENSHOT ?? 'team-profile-preview.png',fullPage:true});
    console.log('Browser passed mobile navigation, AP history links, shareable routes, trends, comparison, caching and errors.');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
