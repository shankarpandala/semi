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
    // A band's bounding-box centre can miss a curved ribbon, so walk its centre
    // line and return the first screen point where the band itself is on top.
    const pointOn = async locator => {
      await locator.scrollIntoViewIfNeeded();
      const point = await locator.evaluate(path => {
        // d = M x0,top0 C xm,top0 xm,top1 x1,top1 L x1,bottom1 C xm,bottom1 xm,bottom0 x0,bottom0 Z
        const n = path.getAttribute('d').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number);
        const [x0, xm, x1] = [n[0], n[2], n[6]];
        const y0 = (n[1] + n[15]) / 2, y1 = (n[7] + n[9]) / 2;
        const m = path.getScreenCTM();
        for(const t of [.5, .4, .6, .3, .7, .2, .8]){
          const u = 1 - t, a = u*u*u, b = 3*u*u*t, c = 3*u*t*t, e = t*t*t;
          const x = a*x0 + (b + c)*xm + e*x1, y = (a + b)*y0 + (c + e)*y1;
          const p = {x:m.a*x + m.c*y + m.e, y:m.b*x + m.d*y + m.f};
          if(document.elementFromPoint(p.x, p.y) === path) return p;
        }
        return null;
      });
      assert.ok(point, 'no uncovered point on the band centre line');
      return point;
    };
    const title = () => page.locator('#viewTitle').textContent();

    await page.goto(baseURL+'/flows.html', {waitUntil:'load'});

    await check('Overview draws every tier group with its full revenue, stubs for outside money, and tables', async () => {
      const overview = model.overview(model.flows);
      assert.equal(await page.locator('#chart .node').count(), overview.nodes.length);
      const stubs = overview.nodes.reduce((n, node) => n + node.stubIn.length + node.stubOut.length, 0);
      assert.equal(await page.locator('#chart .stub').count(), stubs);
      assert.equal(await page.locator('#accountsTable tbody tr').count(), model.groups.length + 1);
      assert.match(await page.locator('#statRevenue').textContent(), /^\$[\d.]+[BT]$/);
      assert.equal(await page.locator('#chart .link').count(), overview.links.length);
      assert.equal(await page.locator('#chart .hit.go').count(), overview.links.length);
      assert.match(await title(), /Who pays whom/);
      assert.equal(await rows().count(), Math.min(30, model.flows.length));
      assert.match(await page.locator('#statTotal').textContent(), /^\$[\d.]+[BT]$/);
      assert.equal(await page.locator('#statCount').textContent(), String(model.flows.length));
      const notDrawn = overview.within.length + overview.lateral.length + overview.counter.length;
      assert.equal(await page.locator('#notes .note-list li').count(), notDrawn);
      // Only the page itself, fonts, and the market-cap request leave the browser.
      assert.ok(requests.every(url => url.startsWith(baseURL+'/') || url.startsWith('https://fonts.') || url.startsWith('https://scanner.tradingview.com/')), requests.join('\n'));
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
      const cells = await rows().evaluateAll(trs => trs.map(tr => [tr.cells[0].querySelector('.co-btn').textContent, tr.cells[1].querySelector('.co-btn').textContent]));
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
      assert.match(await page.locator('#searchMsg').textContent(), /No company matches/);
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

    await check('Every overview band owns the pointer over its own ribbon', async () => {
      await page.goto(baseURL+'/flows.html', {waitUntil:'load'});
      await page.evaluate(() => scrollTo(0, document.getElementById('chartScroll').getBoundingClientRect().top + scrollY - 90));
      const report = await page.evaluate(() => {
        const links = [...document.querySelectorAll('#chart .link')];
        const hits = [...document.querySelectorAll('#chart .hit')];
        const pads = [...document.querySelectorAll('#chart .hit-pad')];
        const sticky = document.querySelector('.controls').getBoundingClientRect().bottom;
        const result = {checked:0, wrong:[]};
        links.forEach((link, i) => {
          const n = link.getAttribute('d').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number);
          const [x0, xm, x1] = [n[0], n[2], n[6]];
          const y0 = (n[1] + n[15]) / 2, y1 = (n[7] + n[9]) / 2;
          const m = link.getScreenCTM();
          for(const t of [.5, .35, .65, .2, .8]){
            const u = 1 - t, x = u*u*u*x0 + 3*u*t*xm + t*t*t*x1, y = (u*u*u + 3*u*u*t)*y0 + (3*u*t*t + t*t*t)*y1;
            const point = new DOMPoint(x, y);
            if(!link.isPointInFill(point) || links.some((other, j) => j !== i && other.isPointInFill(point))) continue;
            const sx = m.a*x + m.c*y + m.e, sy = m.b*x + m.d*y + m.f;
            if(sy < sticky + 2 || sy > innerHeight - 2) continue;
            const top = document.elementFromPoint(sx, sy);
            // Nodes and outside-money stubs are drawn above the bands.
            if(top?.closest('#chart .node') || top?.classList.contains('stub')) continue;
            result.checked++;
            if(top !== hits[i] && top !== pads[i]) result.wrong.push(hits[i].getAttribute('aria-label'));
            break;
          }
        });
        return result;
      });
      // Bands that are fully covered by other bands or nodes cannot be tested this way.
      assert.ok(report.checked >= Math.min(10, model.overview(model.flows).links.length), JSON.stringify(report));
      assert.deepEqual(report.wrong, []);
    });

    await check('Totals that are zero read as nothing, not "$1M"', async () => {
      for(const hash of ['#group=t10-brands', '#group=t0', '#co=Apple']){
        await page.goto(baseURL+'/flows.html'+hash, {waitUntil:'load'});
        const sub = await page.locator('#viewSub').textContent();
        assert.ok(!/\$1M|\$0\b| 0 tracked/.test(sub), hash+': '+sub);
      }
    });

    await check('Tier and company summaries name outside customers, losses and pending splits as such', async () => {
      await page.goto(baseURL+'/flows.html#group=t6', {waitUntil:'load'});
      const foundries = model.focus(model.flows, model.groupById.get('t6').companies, {outer:'group'}).account;
      assert.ok(foundries.outsideTotal > 0);
      assert.match(await page.locator('#viewSub').textContent(), /from customers outside the 119/);
      const pending = Object.keys(data.accounts).find(name => /breakdown pending/.test(data.accounts[name].otherLabel || '') && !data.accounts[name].buyer);
      await page.goto(baseURL+'/flows.html#co='+encodeURIComponent(pending), {waitUntil:'load'});
      const sub = await page.locator('#viewSub').textContent();
      assert.match(sub, /still being researched/, pending+': '+sub);
      assert.doesNotMatch(sub, /to other suppliers and production/, pending+': '+sub);
      const loss = Object.keys(data.accounts).find(name => model.account(name).loss > 0.05 && !data.accounts[name].buyer);
      await page.goto(baseURL+'/flows.html#co='+encodeURIComponent(loss), {waitUntil:'load'});
      assert.match(await page.locator('#viewSub').textContent(), /operating loss/, loss);
      // The legend lists only what the view draws.
      const legend = await page.locator('#chartLegend li').allTextContents();
      assert.ok(legend.some(text => /Operating loss/.test(text)), legend.join(' | '));
      assert.ok(!legend.some(text => /Operating profit/.test(text)) || model.account(loss).profit > 0, legend.join(' | '));
    });

    await check('Pending amounts, buyers and hidden flows are described as what they are', async () => {
      // Shin-Etsu Handotai's profit is known, so Tier 1's unsplit amount is costs only.
      await page.goto(baseURL+'/flows.html#group=t1', {waitUntil:'load'});
      const sub = await page.locator('#viewSub').textContent();
      assert.match(sub, /of other costs is not yet split/, sub);
      assert.match(await page.locator('#accountsNote').textContent(), /† Includes other costs not yet split between suppliers and people/);
      // A hyperscaler's other money is hardware bought outside the 119.
      await page.goto(baseURL+'/flows.html#co=Microsoft', {waitUntil:'load'});
      const node = page.locator('#chart .node[aria-label^="Other hardware suppliers"]');
      await node.scrollIntoViewIfNeeded();
      await node.hover();
      assert.match(await page.locator('#tooltip').textContent(), /Hardware bought from suppliers that are not among the 119/);
      // With only disclosed flows shown, grey bands are labelled as hidden, not as undrawn.
      await page.goto(baseURL+'/flows.html#co=NVIDIA', {waitUntil:'load'});
      for(const conf of ['derived', 'estimated']) await page.locator(`.chip[data-conf="${conf}"]`).click();
      const legend = await page.locator('#chartLegend li').allTextContents();
      assert.ok(legend.includes('Tracked flows hidden by the filter'), legend.join(' | '));
      for(const conf of ['derived', 'estimated']) await page.locator(`.chip[data-conf="${conf}"]`).click();
    });

    await check('A company without tracked flows still shows its revenue, costs and profit', async () => {
      const untracked = [...model.groupOf.keys()].find(name => data.accounts[name] && !model.flows.some(f => f.from === name || f.to === name));
      if(!untracked) return;
      await page.goto(baseURL+'/flows.html#co='+encodeURIComponent(untracked), {waitUntil:'load'});
      const account = model.account(untracked);
      assert.match(await page.locator('#viewSub').textContent(), /took in/);
      assert.ok(await page.locator('#chart .node').count() >= 3);
      const note = await page.locator('#tableNote').textContent();
      assert.match(note, /outside the 119/);
      assert.ok(!/filter/.test(note), note);
      const moneyIn = await page.locator('#accountsTable tr.total td.num').first().textContent();
      assert.equal(moneyIn, account.inTotal >= 100 ? '$'+account.inTotal.toFixed(0)+'B' : account.inTotal >= 1 ? '$'+account.inTotal.toFixed(1)+'B' : '$'+Math.round(account.inTotal*1000)+'M');
    });

    await check('A company view balances money in and money out, with outside customers, costs and profit', async () => {
      await page.goto(baseURL+'/flows.html#co=TSMC', {waitUntil:'load'});
      const labels = await page.locator('#chart .node').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')));
      for(const label of ['People, R&D & overhead', 'Operating profit']) assert.ok(labels.some(l => l.startsWith(label)), labels.join(' | '));
      const totals = await page.locator('#accountsTable tr.total td.num').allTextContents();
      assert.equal(totals.length, 2);
      assert.equal(totals[0], totals[1]);
    });

    await check('Leaving the search box does not jump to a loosely matched company', async () => {
      await page.goto(baseURL+'/flows.html', {waitUntil:'load'});
      await page.locator('#search').fill('sam');
      await page.locator('[data-conf="estimated"]').click();
      assert.equal(await page.evaluate(() => location.hash), '');
      await page.locator('[data-conf="estimated"]').click();
    });

    await check('Keyboard activation moves focus to the new view, and only actionable chart parts are Tab stops', async () => {
      await page.goto(baseURL+'/flows.html', {waitUntil:'load'});
      await page.locator('#chart .node.go').first().focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => location.hash.startsWith('#group='));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'viewTitle');
      await page.goto(baseURL+'/flows.html#co=TSMC', {waitUntil:'load'});
      await page.locator('#chart').evaluate(svg => svg.scrollIntoView());
      await page.locator('#viewSub a').focus();
      const stops = [];
      for(let i = 0; i < 120; i++){
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const a = document.activeElement;
          return {inChart:!!a.closest('#chart'), role:a.getAttribute('role'), tabindex:a.getAttribute('tabindex')};
        });
        if(!info.inChart){ if(stops.length) break; continue; }
        stops.push(info);
      }
      assert.ok(stops.length > 0);
      assert.ok(stops.every(s => s.role === 'button' && s.tabindex === '0'), JSON.stringify(stops));
    });

    await check('Re-selecting the current view from a percent-encoded link adds no history entry', async () => {
      await page.goto(baseURL+'/flows.html#co='+encodeURIComponent('Samsung Electronics'), {waitUntil:'load'});
      assert.equal(await title(), 'Samsung Electronics');
      const before = await page.evaluate(() => history.length);
      await page.locator('#flowTable .co-btn', {hasText:/^Samsung Electronics$/}).first().click();
      assert.equal(await title(), 'Samsung Electronics');
      assert.equal(await page.evaluate(() => history.length), before);
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
          const overflow = getComputedStyle(s).overflowX;
          return (overflow === 'auto' || overflow === 'scroll') && s.scrollWidth > s.clientWidth;
        }), hash);
      }
      assert.deepEqual(mobileErrors, []);
      await mobile.close();
    });

    await check('Live market caps appear in the company heading, tooltips and tables', async () => {
      const capsContext = await browser.newContext({viewport:{width:1440, height:1000}});
      await capsContext.route('https://fonts.googleapis.com/**', route => route.abort());
      const scans = [];
      await capsContext.route('https://scanner.tradingview.com/**', async route => {
        const body = route.request().postDataJSON();
        scans.push(body);
        const data = body.symbols.tickers.filter(s => s === 'NYSE:TSM' || s === 'NASDAQ:NVDA')
          .map(s => ({s, d:[100, s === 'NYSE:TSM' ? 1.5e12 : 4.4e12, 1, 'delayed_streaming_900', 'USD', 'USD']}));
        return route.fulfill({contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:JSON.stringify({data})});
      });
      const capsPage = await capsContext.newPage();
      await capsPage.goto(baseURL+'/flows.html#co=TSMC', {waitUntil:'load'});
      await capsPage.waitForFunction(() => document.querySelector('#viewTitle .cap')?.textContent);
      assert.equal(await capsPage.locator('#viewTitle .cap').textContent(), 'cap $1.50T');
      assert.equal(scans[0].symbols.tickers.length, Object.keys(data.tickers).length);
      assert.ok(await capsPage.locator('#flowTable .cap', {hasText:'cap $4.40T'}).count() > 0);
      await capsPage.goto(baseURL+'/flows.html#group=t6', {waitUntil:'load'});
      await capsPage.waitForFunction(() => [...document.querySelectorAll('#accountsTable .cap')].some(c => c.textContent));
      assert.ok(await capsPage.locator('#accountsTable .cap', {hasText:'cap $1.50T'}).count() === 1);
      await capsContext.close();
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
