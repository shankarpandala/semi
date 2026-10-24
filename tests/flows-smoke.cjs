// Browser checks for the money-flows page. Run with the local server started:
//   node tests/flows-smoke.cjs
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const data = require('../assets/flows-data.js');
const {createModel} = require('../assets/flow-views.js');

const baseURL = process.env.SEMI_BASE_URL || 'http://127.0.0.1:8000';
const model = createModel(data);

async function run(){
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  let checks = 0;
  const check = async (name, fn) => {
    await fn();
    console.log('PASS '+name);
    checks++;
  };
  try {
    const context = await browser.newContext({viewport:{width:1440, height:1000}, locale:'en-US'});
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    await context.route('https://fonts.gstatic.com/**', route => route.abort());
    await context.route('https://scanner.tradingview.com/**', route => route.abort('blockedbyclient'));
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    const rows = () => page.locator('#flowTable tbody tr');
    // A curved band's bounding-box center can miss the stroke; aim at its midpoint.
    const pointOn = async locator => {
      await locator.scrollIntoViewIfNeeded();
      return locator.evaluate(path => {
        const p = path.getPointAtLength(path.getTotalLength() / 2);
        const m = path.getScreenCTM();
        return {x:m.a*p.x + m.c*p.y + m.e, y:m.b*p.x + m.d*p.y + m.f};
      });
    };
    const title = () => page.locator('#viewTitle').textContent();

    await page.goto(baseURL+'/flows.html', {waitUntil:'load'});

    await check('Overview draws every tier group that has a forward band, with a table and header totals', async () => {
      const overview = model.overview(model.flows);
      assert.equal(await page.locator('#chart .node').count(), overview.nodes.length);
      assert.equal(await page.locator('#chart .link').count(), overview.links.length);
      assert.equal(await page.locator('#chart .hit.go').count(), overview.links.length);
      assert.match(await title(), /Who pays whom/);
      assert.equal(await rows().count(), Math.min(30, model.flows.length));
      assert.match(await page.locator('#statTotal').textContent(), /^\$[\d.]+[BT]$/);
      assert.equal(await page.locator('#statCount').textContent(), String(model.flows.length));
      const notDrawn = overview.within.length + overview.counter.length;
      assert.equal(await page.locator('#notes .note-list li').count(), notDrawn);
      assert.ok(requests.every(url => url.startsWith(baseURL+'/') || url.startsWith('https://fonts.')), requests.join('\n'));
    });

    await check('Hovering a band shows its value; selecting it opens the company flows for that tier pair', async () => {
      const overview = model.overview(model.flows);
      const largest = [...overview.links].sort((a, b) => b.value - a.value)[0];
      const index = overview.links.indexOf(largest);
      const band = page.locator('#chart .hit.go').nth(index);
      const point = await pointOn(band);
      await page.mouse.move(point.x, point.y);
      assert.equal(await page.locator('#tooltip').isVisible(), true);
      assert.match(await page.locator('#tooltip .tt-value').textContent(), /^\$[\d.]+[MBT] \/ yr$/);
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction(() => location.hash.startsWith('#from='));
      const params = new URLSearchParams(await page.evaluate(() => location.hash.slice(1)));
      assert.equal(params.get('from'), largest.source);
      assert.equal(params.get('to'), largest.target);
      assert.match(await title(), /→/);
      assert.equal(await rows().count(), Math.min(30, largest.flows.length));
    });

    await check('Breadcrumbs and browser history return to the overview', async () => {
      await page.locator('#crumbs button', {hasText:'All tiers'}).click();
      await page.waitForFunction(() => !location.hash);
      assert.match(await title(), /Who pays whom/);
      await page.goBack();
      await page.waitForFunction(() => location.hash.startsWith('#from='));
      assert.match(await title(), /→/);
      await page.goto(baseURL+'/flows.html', {waitUntil:'load'});
    });

    await check('Selecting a tier group with the keyboard opens its companies', async () => {
      const first = page.locator('#chart .node.go').first();
      await first.focus();
      assert.equal(await page.locator('#tooltip').isVisible(), true);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => location.hash.startsWith('#group='));
      const id = await page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('group'));
      const group = model.groupById.get(id);
      assert.equal(await title(), group.tierLabel+' · '+group.role);
      const members = new Set(group.companies);
      const middle = await page.locator('#chart .node').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')));
      assert.ok(middle.some(label => members.has(label.split(',')[0])), middle.join('\n'));
    });

    await check('A company deep link shows only that company’s flows and links back to its card', async () => {
      await page.goto(baseURL+'/flows.html#co=TSMC', {waitUntil:'load'});
      assert.equal(await title(), 'TSMC');
      const expected = model.flows.filter(f => f.from === 'TSMC' || f.to === 'TSMC').length;
      assert.match(await page.locator('#tableNote').textContent(), new RegExp('^'+expected+' flows?'));
      const cells = await rows().evaluateAll(trs => trs.map(tr => [tr.cells[0].textContent, tr.cells[1].textContent]));
      assert.ok(cells.every(([from, to]) => from === 'TSMC' || to === 'TSMC'));
      assert.equal(await page.locator('#viewSub a').getAttribute('href'), './#co=TSMC');
      assert.equal(await page.locator('#crumbs li').count(), 3);
    });

    await check('Search follows a company by partial name', async () => {
      await page.locator('#search').fill('nvid');
      await page.locator('#search').press('Enter');
      await page.waitForFunction(() => location.hash === '#co=NVIDIA');
      assert.equal(await title(), 'NVIDIA');
      await page.locator('#search').fill('no such company');
      await page.locator('#search').press('Enter');
      assert.match(await page.locator('#searchMsg').textContent(), /No tracked flows/);
    });

    await check('Confidence filters scope the chart and table, and one category always stays on', async () => {
      await page.goto(baseURL+'/flows.html', {waitUntil:'load'});
      await page.locator('[data-conf="estimated"]').click();
      await page.locator('[data-conf="derived"]').click();
      assert.equal(await page.locator('[data-conf="estimated"]').getAttribute('aria-pressed'), 'false');
      const disclosed = model.flows.filter(f => f.conf === 'disclosed');
      assert.match(await page.locator('#tableNote').textContent(), new RegExp('^'+disclosed.length+' flows?'));
      const confs = await rows().evaluateAll(trs => trs.map(tr => tr.cells[4].textContent));
      assert.ok(confs.every(c => c === 'Disclosed'));
      await page.locator('[data-conf="disclosed"]').click();
      assert.equal(await page.locator('[data-conf="disclosed"]').getAttribute('aria-pressed'), 'true');
      await page.locator('[data-conf="estimated"]').click();
      await page.locator('[data-conf="derived"]').click();
    });

    await check('Show all reveals every flow in the view', async () => {
      if(model.flows.length <= 30){
        assert.equal(await page.locator('#showAll').isVisible(), false);
        return;
      }
      await page.locator('#showAll').click();
      assert.equal(await rows().count(), model.flows.length);
      assert.equal(await page.locator('#showAll').isVisible(), false);
    });

    await check('Source links are external, safe and open in a new tab', async () => {
      const links = await page.locator('#flowTable a').evaluateAll(as => as.map(a => [a.href, a.target, a.rel]));
      for(const [href, target, rel] of links){
        assert.match(href, /^https:\/\//);
        assert.equal(target, '_blank');
        assert.match(rel, /noopener/);
      }
    });

    assert.deepEqual(errors, []);

    await check('Mobile layout keeps the page width and scrolls the chart inside its card', async () => {
      const mobile = await browser.newPage({viewport:{width:390, height:844}});
      const mobileErrors = [];
      mobile.on('pageerror', error => mobileErrors.push(error.message));
      await mobile.route('https://fonts.googleapis.com/**', route => route.abort());
      for(const hash of ['', '#group=t6', '#co=TSMC']){
        await mobile.goto(baseURL+'/flows.html'+hash, {waitUntil:'load'});
        assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), hash);
        assert.ok(await mobile.evaluate(() => {
          const s = document.getElementById('chartScroll');
          return s.scrollWidth >= s.clientWidth;
        }), hash);
      }
      assert.deepEqual(mobileErrors, []);
      await mobile.close();
    });

    await check('The companies dashboard links to the flows page and each company’s flows', async () => {
      const dash = await context.newPage();
      await dash.goto(baseURL+'/#co=TSMC', {waitUntil:'domcontentloaded'});
      assert.equal(await dash.locator('.page-nav a[href="flows.html"]').count(), 1);
      await dash.waitForFunction(() => document.getElementById('drawer').classList.contains('open'));
      assert.equal(await dash.locator('#drawerFlows').getAttribute('href'), 'flows.html#co=TSMC');
      await dash.close();
    });

    console.log(`${checks} flows-page checks passed.`);
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
