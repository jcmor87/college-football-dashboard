const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {createReadStream, existsSync} = require('node:fs');
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
    await page.goto(url+'#team=999999');
    await page.getByRole('alert').filter({hasText:'not found'}).waitFor();
    await page.route('**/data/team-profiles.json',route=>route.fulfill({status:503,body:'Unavailable'}));
    await page.goto(url+'#team=87');
    await page.reload();
    await page.getByRole('alert').filter({hasText:'could not load'}).waitFor();
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
