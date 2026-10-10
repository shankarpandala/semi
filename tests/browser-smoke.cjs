// Synthetic HTTP responses exercise the real browser loader and calculations.
// These tests do not establish the provider's availability or quote accuracy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const baseURL = process.env.SEMI_BASE_URL || 'http://127.0.0.1:8000';
const scannerURL = 'https://scanner.tradingview.com';
const loaderURL = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-info.js';
const fixtureLoader = `(() => {
  const script = document.currentScript;
  const config = JSON.parse(script.textContent);
  const frame = document.createElement('iframe');
  frame.style.width = '100%';
  frame.src = 'https://www.tradingview-widget.com/embed-widget/symbol-info/?symbol=' + encodeURIComponent(config.symbol);
  script.parentElement.querySelector('.tradingview-widget-container__widget').appendChild(frame);
})();`;
const quote = (symbol, price, cap, currency = 'USD', capCurrency = currency) => ({
  s: symbol, d: [price, cap, 1.25, 'delayed_streaming_900', currency, capCurrency],
});
const initialQuotes = [
  quote('NASDAQ:NVDA', 125, 100e9),
  quote('NASDAQ:AMD', 150, 50e9),
  quote('NYSE:TSM', 200, 200e9),
];
const fxQuotes = [
  {s:'FX_IDC:USDJPY', d:[150, 'USD', 'JPY']},
  {s:'FX_IDC:USDTWD', d:[30, 'USD', 'TWD']},
];

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
    // Observe real fetch options without changing the implementation or result.
    await context.addInitScript(() => {
      const browserFetch = window.fetch;
      window.marketFetchOptions = [];
      window.fetch = function(url, options){
        if(String(url).startsWith('https://scanner.tradingview.com/')){
          window.marketFetchOptions.push({url, method:options.method, mode:options.mode, credentials:options.credentials, cache:options.cache});
        }
        return browserFetch.call(this, url, options);
      };
    });
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    await context.route('https://fonts.gstatic.com/**', route => route.abort());
    await context.route(loaderURL, route => route.fulfill({contentType:'text/javascript', body:fixtureLoader}));
    await context.route('https://www.tradingview-widget.com/**', route => {
      const symbol = new URL(route.request().url()).searchParams.get('symbol');
      return route.fulfill({contentType:'text/html', body:'<p>Fixture listing '+symbol+'</p>'});
    });
    let mode = 'pending';
    let fxMode = 'success';
    let quotes = initialQuotes;
    const scannerRequests = [];
    const pending = [];
    const success = (route, data) => route.fulfill({
      contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:JSON.stringify({data}),
    });
    await context.route(scannerURL+'/**', async route => {
      const request = route.request();
      scannerRequests.push({url:request.url(), method:request.method(), headers:request.headers(), body:request.postDataJSON()});
      if(request.url() === scannerURL+'/forex/scan'){
        return fxMode === 'success' ? success(route, fxQuotes) : route.abort('blockedbyclient');
      }
      assert.equal(request.url(), scannerURL+'/global/scan');
      if(mode === 'pending'){ pending.push(route); return; }
      if(mode === 'network-failure') return route.abort('blockedbyclient');
      if(mode === 'http-failure') return route.fulfill({status:503, headers:{'access-control-allow-origin':'*'}, body:'unavailable'});
      if(mode === 'invalid-data') return route.fulfill({contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:'{"error":"no market records"}'});
      return success(route, quotes);
    });
    const releasePending = async data => {
      for(const route of pending.splice(0)) await success(route, data).catch(() => {});
    };
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    const loaded = () => page.waitForFunction(() => !document.getElementById('marketRefresh').disabled);
    const refresh = async () => { await page.locator('#marketRefresh').click(); await loaded(); };
    const findCompany = async query => {
      await page.locator('#search').fill(query);
      assert.equal(await page.locator('.card:not(.hidden)').count(), 1, query);
      return page.locator('.card:not(.hidden)');
    };
    const initialRequest = page.waitForRequest(scannerURL+'/global/scan');
    await page.goto(baseURL, {waitUntil:'domcontentloaded'});
    await initialRequest;

    await check('Opening the portal requests all listings and shows loading without old valuations', async () => {
      assert.equal(await page.locator('.card').count(), 119);
      assert.equal(await page.locator('.row').count(), 10);
      assert.equal(await page.locator('#tierChips .chip').count(), 10);
      assert.equal(await page.locator('#statTotalCap').textContent(), 'Loading…');
      assert.equal(await page.locator('#statPricedCount').textContent(), '0 / 101');
      assert.equal(await page.locator('#statUpdated').textContent(), 'Loading…');
      assert.equal(await page.locator('#marketRefresh').isDisabled(), true);
      assert.ok(!(await page.locator('body').textContent()).includes('Jul 2026'));
      assert.ok(!(await page.locator('.rows').textContent()).includes('$'));
      assert.equal(scannerRequests.length, 1);
      assert.equal(scannerRequests[0].body.symbols.tickers.length, 101);
      assert.equal(new Set(scannerRequests[0].body.symbols.tickers).size, 101);
      assert.deepEqual(scannerRequests[0].body.columns, ['close','market_cap_basic','change','update_mode','currency','fundamental_currency_code']);
    });

    await check('Completion recalculates totals and shares while preserving open drawer, search, focus, and hash', async () => {
      const card = await findCompany('NVDA');
      await card.focus();
      await page.keyboard.press('Enter');
      await page.locator('#marketWidget iframe').waitFor();
      assert.equal(await page.locator('#drawerCapBig').textContent(), 'Loading…');
      mode = 'success';
      await releasePending(initialQuotes);
      await loaded();
      assert.equal(await page.locator('#statTotalCap').textContent(), '$350.0B');
      assert.equal(await page.locator('#statPricedCount').textContent(), '3 / 101');
      assert.match(await page.locator('#tier-8 .row-cap-line').textContent(), /\$150\.0B/);
      assert.match(await page.locator('#tier-8 .wt-pct').textContent(), /42\.9%/);
      assert.equal(await page.locator('#drawerCapBig').textContent(), '$100.0B');
      assert.match(await page.locator('#drawerCapSub').textContent(), /66\.7%/);
      assert.match(await page.locator('#drawerPrice').textContent(), /\$125\.00/);
      assert.match(await card.locator('.quote-price').textContent(), /\$125\.00 USD/);
      assert.equal(await page.locator('#search').inputValue(), 'NVDA');
      assert.equal(await page.locator('.card:not(.hidden)').count(), 1);
      assert.equal(new URL(page.url()).hash, '#co=NVIDIA');
      assert.equal(await page.evaluate(() => document.activeElement._co?.ticker), 'NVDA');
      assert.equal(await page.locator('.card').count(), 119);
      assert.equal(await page.locator('.row').count(), 10);
      assert.equal(await page.locator('#marketWidget iframe').count(), 1);
      assert.match(await page.locator('#marketDataStatus').textContent(), /3 of 101/);
      assert.match(await page.locator('#statUpdated').getAttribute('title'), /retrieval time/);
      await page.keyboard.press('Escape');
    });

    await check('Search supports company, ticker, headquarters, domain, zero matches, and reset', async () => {
      await findCompany('NVIDIA');
      await findCompany('NVDA');
      await page.locator('#search').fill('Taiwan');
      const headquarters = await page.locator('.card:not(.hidden) .hq').allTextContents();
      assert.ok(headquarters.length > 1 && headquarters.every(hq => hq === 'Taiwan'));
      await findCompany('sub-3nm');
      assert.equal(await page.locator('.card:not(.hidden) .name').textContent(), 'TSMC');
      await page.locator('#search').fill('unmatched-company-123');
      assert.equal(await page.locator('#resultCount').textContent(), '0 matches');
      await page.locator('#search').fill('');
      assert.equal(await page.locator('.card:not(.hidden)').count(), 119);
    });

    await check('Native prices and market caps use fetched FX and their independent currencies', async () => {
      quotes = [quote('TSE:3436', 1500, 1.5e12, 'JPY'), quote('NYSE:TSM', 300, 30e12, 'USD', 'TWD')];
      await refresh();
      assert.equal(await page.locator('#statTotalCap').textContent(), '$1.01T');
      assert.equal(await page.locator('#statPricedCount').textContent(), '2 / 101');
      const sumco = await findCompany('3436.T');
      assert.equal(await sumco.locator('.cap-value').textContent(), '$10.0B');
      assert.match(await sumco.locator('.quote-price').textContent(), /\$10\.00 USD/);
      const tsm = await findCompany('TSM');
      assert.equal(await tsm.locator('.cap-value').textContent(), '$1.00T');
      assert.match(await tsm.locator('.quote-price').textContent(), /\$300\.00 USD/);
      const fxRequest = scannerRequests.find(request => request.url.endsWith('/forex/scan'));
      assert.deepEqual([...fxRequest.body.symbols.tickers].sort(), ['FX_IDC:USDJPY','FX_IDC:USDTWD']);
      assert.deepEqual(fxRequest.body.columns, ['close','base_currency','currency']);
    });

    await check('An FX failure preserves independent USD values and excludes unconverted caps', async () => {
      fxMode = 'failure';
      quotes = [...quotes, quote('NASDAQ:NVDA', 125, 100e9)];
      await refresh();
      assert.equal(await page.locator('#statTotalCap').textContent(), '$100.0B');
      assert.equal(await page.locator('#statPricedCount').textContent(), '1 / 101');
      assert.match(await page.locator('#marketDataStatus').textContent(), /share prices for 2/);
      const sumco = await findCompany('3436.T');
      assert.equal(await sumco.locator('.cap-value').textContent(), 'Unavailable');
      assert.equal(await sumco.locator('.quote-price').textContent(), 'Price unavailable');
      const tsm = await findCompany('TSM');
      assert.equal(await tsm.locator('.cap-value').textContent(), 'Unavailable');
      assert.match(await tsm.locator('.quote-price').textContent(), /\$300\.00 USD/);
      fxMode = 'success';
    });

    for(const failure of ['http-failure','network-failure','invalid-data']){
      await check(failure+' removes prior values and does not invent a fetch date', async () => {
        mode = failure;
        await refresh();
        assert.equal(await page.locator('#statTotalCap').textContent(), 'Unavailable');
        assert.equal(await page.locator('#statPricedCount').textContent(), '0 / 101');
        assert.equal(await page.locator('#statUpdated').textContent(), '—');
        assert.ok(!(await page.locator('.rows').textContent()).includes('$'));
        assert.equal(await page.locator('.tier-weight').count(), 0);
        assert.match(await page.locator('#marketDataStatus').textContent(), /unavailable/i);
        assert.equal(await page.locator('.card').count(), 119);
      });
    }

    await check('Retry recomputes changed totals, weights, and descending company rankings', async () => {
      mode = 'success';
      quotes = [quote('NASDAQ:NVDA', 12, 10e9), quote('NASDAQ:AMD', 20, 20e9), quote('NYSE:TSM', 30, 30e9)];
      await refresh();
      assert.equal(await page.locator('#statTotalCap').textContent(), '$60.0B');
      assert.equal(await page.locator('#statPricedCount').textContent(), '3 / 101');
      assert.equal(await page.locator('#tier-8 .card .name').first().textContent(), 'AMD');
      assert.match(await page.locator('#tier-8 .row-cap-line').textContent(), /\$30\.0B/);
      assert.match(await page.locator('#tier-8 .wt-pct').textContent(), /50\.0%/);
      await (await findCompany('NVDA')).click();
      assert.match(await page.locator('#drawerCapSub').textContent(), /33\.3%/);
      assert.match(await page.locator('#drawerPrice').textContent(), /\$12\.00/);
      await page.keyboard.press('Escape');
    });

    await check('A price-only response has a fetch date but no fabricated market cap or weights', async () => {
      quotes = [quote('NASDAQ:NVDA', 123, null)];
      await refresh();
      assert.equal(await page.locator('#statTotalCap').textContent(), 'Unavailable');
      assert.equal(await page.locator('#statPricedCount').textContent(), '0 / 101');
      assert.notEqual(await page.locator('#statUpdated').textContent(), '—');
      assert.equal(await page.locator('.tier-weight').count(), 0);
      await (await findCompany('NVDA')).click();
      assert.equal(await page.locator('#drawerCapBig').textContent(), 'Unavailable');
      assert.match(await page.locator('#drawerPrice').textContent(), /\$123\.00/);
      await page.keyboard.press('Escape');
    });

    await check('Reload starts a new request and uses the newly returned valuations', async () => {
      quotes = initialQuotes;
      const before = scannerRequests.filter(request => request.url.endsWith('/global/scan')).length;
      await page.reload({waitUntil:'domcontentloaded'});
      await loaded();
      assert.equal(scannerRequests.filter(request => request.url.endsWith('/global/scan')).length, before+1);
      assert.equal(await page.locator('#statTotalCap').textContent(), '$350.0B');
      assert.equal(await page.locator('.card').count(), 119);
    });

    await check('Private companies have no public quote panel and make no extra market request', async () => {
      const before = requests.filter(url => /tradingview/.test(url)).length;
      await (await findCompany('Hemlock')).click();
      assert.equal(await page.locator('#drawerCapBig').textContent(), 'Private');
      assert.equal(await page.locator('#marketPanel').isVisible(), false);
      assert.equal(await page.locator('#drawerPrice').isVisible(), false);
      assert.equal(requests.filter(url => /tradingview/.test(url)).length, before);
      await page.locator('#drawerClose').click();
    });

    await check('A blocked optional widget preserves fetched data and can be retried independently', async () => {
      await context.unroute(loaderURL);
      await context.route(loaderURL, route => route.abort('blockedbyclient'));
      await (await findCompany('NVDA')).click();
      await page.locator('#marketRetry:visible').waitFor();
      assert.equal(await page.locator('#drawerCapBig').textContent(), '$100.0B');
      assert.match(await page.locator('#drawerPrice').textContent(), /\$125\.00/);
      assert.equal(await page.locator('#marketLink').isVisible(), true);
      await context.unroute(loaderURL);
      await context.route(loaderURL, route => route.fulfill({contentType:'text/javascript', body:fixtureLoader}));
      await page.locator('#marketRetry').click();
      await page.frameLocator('#marketWidget iframe').getByText('Fixture listing NASDAQ:NVDA').waitFor();
      assert.equal(await page.locator('#marketWidget iframe').count(), 1);
      await page.keyboard.press('Escape');
    });

    await check('Late widget responses cannot replace a subsequently selected company', async () => {
      await context.unroute(loaderURL);
      let firstRoute;
      await context.route(loaderURL, async route => {
        if(!firstRoute){ firstRoute = route; return; }
        await route.fulfill({contentType:'text/javascript', body:fixtureLoader});
      });
      const firstRequest = page.waitForRequest(loaderURL);
      await (await findCompany('NVDA')).click();
      await firstRequest;
      await page.keyboard.press('Escape');
      await (await findCompany('TSM')).click();
      await firstRoute.fulfill({contentType:'text/javascript', body:fixtureLoader}).catch(() => {});
      await page.frameLocator('#marketWidget iframe').getByText('Fixture listing NYSE:TSM').waitFor();
      assert.equal(await page.locator('#drawerName').textContent(), 'TSMC');
      assert.equal(await page.locator('#drawerCapBig').textContent(), '$200.0B');
      assert.equal(await page.locator('#marketWidget iframe').count(), 1);
      await page.keyboard.press('Escape');
      await context.unroute(loaderURL);
      await context.route(loaderURL, route => route.fulfill({contentType:'text/javascript', body:fixtureLoader}));
    });

    await check('Company and tier deep links remain valid through asynchronous loading', async () => {
      await page.goto('about:blank');
      await page.goto(baseURL+'/#co='+encodeURIComponent('Linde plc'), {waitUntil:'domcontentloaded'});
      await loaded();
      await page.locator('#marketWidget iframe').waitFor();
      assert.equal(await page.locator('#drawerName').textContent(), 'Linde plc');
      assert.equal(await page.locator('#drawerCapBig').textContent(), 'Unavailable');
      await page.keyboard.press('Escape');
      await page.locator('a.chip[href="#tier-9"]').click();
      assert.equal(new URL(page.url()).hash, '#tier-9');
      await page.goto('about:blank');
      await page.goto(baseURL+'/#tier-5', {waitUntil:'domcontentloaded'});
      await page.locator('#tier-5.visible').waitFor();
      assert.equal(await page.locator('.card').count(), 119);
    });

    await check('Market requests go directly to the provider with no credentials or JSON preflight', async () => {
      const options = await page.evaluate(() => window.marketFetchOptions);
      assert.ok(options.length > 0);
      for(const request of options){
        assert.ok(request.url.startsWith(scannerURL+'/'));
        assert.equal(request.method, 'POST');
        assert.equal(request.mode, 'cors');
        assert.equal(request.credentials, 'omit');
        assert.equal(request.cache, 'no-store');
      }
      for(const request of scannerRequests){
        assert.equal(request.method, 'POST');
        assert.match(request.headers['content-type'], /^text\/plain/);
        assert.equal(request.headers.cookie, undefined);
      }
      assert.ok(!requests.some(url => /yahoo|market-data\.json|allorigins|corsproxy/i.test(url)));
    });

    await check('A stalled market request times out, avoids overlapping refresh, and ignores late values', async () => {
      await page.clock.install();
      mode = 'pending';
      const requested = page.waitForRequest(scannerURL+'/global/scan');
      await page.locator('#marketRefresh').click();
      await requested;
      const before = scannerRequests.length;
      await page.evaluate(() => document.getElementById('marketRefresh').click());
      assert.equal(scannerRequests.length, before);
      assert.equal(await page.locator('#marketRefresh').isDisabled(), true);
      await page.clock.fastForward(16000);
      await loaded();
      assert.equal(await page.locator('#statTotalCap').textContent(), 'Unavailable');
      assert.equal(await page.locator('#statUpdated').textContent(), '—');
      mode = 'success';
      quotes = [quote('NASDAQ:NVDA', 20, 20e9)];
      await refresh();
      assert.equal(await page.locator('#statTotalCap').textContent(), '$20.0B');
      await releasePending([quote('NASDAQ:NVDA', 999, 999e9)]);
      assert.equal(await page.locator('#statTotalCap').textContent(), '$20.0B');
      assert.equal(await page.locator('#statPricedCount').textContent(), '1 / 101');
    });

    await check('Mobile cards and drawer fit without horizontal overflow or JavaScript errors', async () => {
      await page.setViewportSize({width:390, height:844});
      await (await findCompany('NVDA')).click();
      await page.locator('#marketWidget iframe').waitFor();
      const sizes = await page.evaluate(() => ({
        body:[document.documentElement.scrollWidth, document.documentElement.clientWidth],
        drawer:[document.getElementById('drawer').scrollWidth, document.getElementById('drawer').clientWidth],
      }));
      assert.ok(sizes.body[0] <= sizes.body[1], JSON.stringify(sizes));
      assert.ok(sizes.drawer[0] <= sizes.drawer[1], JSON.stringify(sizes));
      assert.deepEqual(errors, []);
    });
    await check('Market data still loads in browsers without Object.hasOwn', async () => {
      const compatiblePage = await context.newPage();
      const compatibilityErrors = [];
      compatiblePage.on('pageerror', error => compatibilityErrors.push(error.message));
      await compatiblePage.addInitScript(() => { delete Object.hasOwn; });
      await compatiblePage.goto(baseURL, {waitUntil:'domcontentloaded'});
      await compatiblePage.waitForFunction(() => !document.getElementById('marketRefresh').disabled);
      assert.equal(await compatiblePage.evaluate(() => typeof Object.hasOwn), 'undefined');
      assert.equal(await compatiblePage.locator('#statTotalCap').textContent(), '$20.0B');
      assert.equal(await compatiblePage.locator('#statPricedCount').textContent(), '1 / 101');
      assert.notEqual(await compatiblePage.locator('#statUpdated').textContent(), '—');
      assert.deepEqual(compatibilityErrors, []);
      await compatiblePage.close();
    });

    await check('An HTML-only copy explains missing supporting files and links to the live portal', async () => {
      // Managed Chromium blocks file:// navigation. Model the same missing-file
      // condition with an HTTP copy that has no sibling assets directory.
      const copiedPage = await context.newPage();
      const copyURL = baseURL+'/downloaded-copy/index.html';
      const copyErrors = [];
      const copyRequests = [];
      copiedPage.on('pageerror', error => copyErrors.push(error.message));
      copiedPage.on('request', request => copyRequests.push(request.url()));
      await copiedPage.route(copyURL, route => route.fulfill({
        contentType:'text/html', body:fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'),
      }));
      await copiedPage.route(baseURL+'/downloaded-copy/assets/**', route => route.fulfill({status:404, body:'File not found'}));
      await copiedPage.goto(copyURL, {waitUntil:'domcontentloaded'});
      await copiedPage.waitForFunction(() => !document.getElementById('marketRefresh').disabled);
      assert.match(await copiedPage.locator('#marketDataStatus').textContent(), /missing its market-data files/i);
      assert.equal(await copiedPage.locator('#marketPortalLink').isVisible(), true);
      assert.equal(await copiedPage.locator('#marketPortalLink').getAttribute('href'), 'https://www.pandala.in/semi/');
      assert.equal(await copiedPage.locator('#statTotalCap').textContent(), 'Unavailable');
      assert.equal(await copiedPage.locator('#statUpdated').textContent(), '—');
      assert.equal(await copiedPage.locator('.card').count(), 119);
      assert.ok(!copyRequests.some(url => url.startsWith(scannerURL+'/')));
      assert.deepEqual(copyErrors, []);
      await copiedPage.close();
    });
    console.log(`${checks} browser checks passed (synthetic provider fixtures).`);
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
