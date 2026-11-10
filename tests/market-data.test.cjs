const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {fetchQuotes, toUSD} = require('../assets/market-data.js');

const response = rows => ({ok: true, json: async () => ({data: rows})});
const stock = (symbol, price, cap, priceCurrency = 'USD', capCurrency = 'USD', change = 0) => ({
  s: symbol,
  d: [price, cap, change, 'delayed_streaming_900', priceCurrency, capCurrency],
});

function abortableFetch(onStart = () => {}) {
  return (url, {signal}) => new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error('Aborted'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, {once: true});
    onStart(signal);
  });
}

test('requests explicit listings through a simple browser POST without custom headers', async () => {
  const calls = [];
  const result = await fetchQuotes(['NASDAQ:AAPL', 'NASDAQ:AAPL', 'HKEX:981', 'KRX:005930', 'BSE:MOSCHIP', 'UNKNOWN'], {
    fetchImpl: async (url, options) => {
      calls.push({url, options});
      return response([stock('NASDAQ:AAPL', 200, 3e12)]);
    },
  });

  assert.equal(calls.length, 1);
  const {url, options} = calls[0];
  assert.equal(url, 'https://scanner.tradingview.com/global/scan');
  assert.equal(options.method, 'POST');
  assert.equal(typeof options.body, 'string');
  assert.equal(options.headers, undefined);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.mode, 'cors');
  assert.equal(options.cache, 'no-store');
  const payload = JSON.parse(options.body);
  assert.deepEqual(payload.symbols.tickers, ['NASDAQ:AAPL', 'HKEX:981', 'KRX:005930', 'BSE:MOSCHIP']);
  for (const column of ['close', 'market_cap_basic', 'currency', 'fundamental_currency_code']) {
    assert.ok(payload.columns.includes(column), column);
  }
  assert.deepEqual(result.missing, ['HKEX:981', 'KRX:005930', 'BSE:MOSCHIP', 'UNKNOWN']);
});

test('keeps USD prices and returns market capitalization in billions with honest timing', async () => {
  const before = Date.now();
  const result = await fetchQuotes(['NASDAQ:NVDA'], {
    fetchImpl: async () => response([stock('NASDAQ:NVDA', 142.5, 3.5e12, 'USD', 'USD', -2.25)]),
  });
  assert.deepEqual(result.quotes['NASDAQ:NVDA'], {
    priceUSD: 142.5,
    capUSD: 3500,
    changePct: -2.25,
    delay: 'delayed_streaming_900',
    providerTime: null,
  });
  assert.deepEqual(result.missing, []);
  assert.ok(Date.parse(result.fetchedAt) >= before);
  assert.ok(Date.parse(result.fetchedAt) <= Date.now());
});

test('converts price and financial currencies independently using this request’s FX values', async () => {
  const calls = [];
  const result = await fetchQuotes(['NYSE:TSM', 'TSE:8035'], {
    fetchImpl: async (url, options) => {
      calls.push({url, payload: JSON.parse(options.body)});
      return url.endsWith('/global/scan')
        ? response([
          stock('NYSE:TSM', 150, 32e12, 'USD', 'TWD'),
          stock('TSE:8035', 30000, 60e9, 'JPY', 'EUR'),
        ])
        : response([
          {s: 'FX_IDC:USDTWD', d: [32, 'USD', 'TWD']},
          {s: 'FX_IDC:USDJPY', d: [150, 'USD', 'JPY']},
          {s: 'FX_IDC:USDEUR', d: [0.75, 'USD', 'EUR']},
        ]);
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://scanner.tradingview.com/forex/scan');
  assert.deepEqual(new Set(calls[1].payload.symbols.tickers), new Set([
    'FX_IDC:USDTWD', 'FX_IDC:USDJPY', 'FX_IDC:USDEUR',
  ]));
  assert.equal(result.quotes['NYSE:TSM'].priceUSD, 150);
  assert.equal(result.quotes['NYSE:TSM'].capUSD, 1000);
  assert.equal(result.quotes['TSE:8035'].priceUSD, 200);
  assert.equal(result.quotes['TSE:8035'].capUSD, 80);
});

test('converts UK pence before applying the USD to GBP rate', () => {
  assert.equal(toUSD(8000, 'GBX', {GBP: 0.8}), 100);
  assert.equal(toUSD(8000, 'GBp', {GBP: 0.8}), 100);
  assert.equal(toUSD(80, 'GBP', {GBP: 0.8}), 100);
});

test('converts Israeli agorot and South African cents as hundredths of their currency', () => {
  assert.equal(toUSD(40000, 'ILA', {ILS: 4}), 100);
  assert.equal(toUSD(400, 'ILS', {ILS: 4}), 100);
  assert.equal(toUSD(180000, 'ZAC', {ZAR: 18}), 100);
  assert.equal(toUSD(40000, 'ILA', {}), null);
});

test('requests an exchange rate for each share-price currency on the roster', async () => {
  const currencies = ['JPY', 'TWD', 'KRW', 'CNY', 'HKD', 'EUR', 'CHF', 'INR', 'GBX', 'AUD', 'CAD',
    'SEK', 'NOK', 'DKK', 'PLN', 'MYR', 'SGD', 'THB', 'PHP', 'IDR', 'ILA', 'RUB', 'TRY', 'ZAC'];
  const symbols = currencies.map((currency, index) => 'TEST:C' + index);
  const calls = [];
  const result = await fetchQuotes(symbols, {
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body);
      calls.push({url, payload});
      if (url.endsWith('/global/scan')) return response(symbols.map((symbol, index) => stock(symbol, 100, 1e9, currencies[index], 'USD')));
      return response(payload.symbols.tickers.map(symbol => ({s: symbol, d: [2, 'USD', symbol.slice(-3)]})));
    },
  });
  assert.deepEqual(calls[1].payload.symbols.tickers.slice().sort(), ['AUD', 'CAD', 'CHF', 'CNY', 'DKK', 'EUR', 'GBP', 'HKD', 'IDR', 'ILS', 'INR',
    'JPY', 'KRW', 'MYR', 'NOK', 'PHP', 'PLN', 'RUB', 'SEK', 'SGD', 'THB', 'TRY', 'TWD', 'ZAR'].map(code => 'FX_IDC:USD' + code));
  for (const [index, symbol] of symbols.entries()) {
    const minor = ['GBX', 'ILA', 'ZAC'].includes(currencies[index]);
    assert.equal(result.quotes[symbol].priceUSD, minor ? 0.5 : 50, currencies[index]);
    assert.equal(result.quotes[symbol].capUSD, 1);
  }
  assert.deepEqual(result.missing, []);
});

test('refuses missing units, unsupported rates, coercion, and nonpositive numbers', () => {
  for (const value of [null, undefined, '100', 0, -1, NaN, Infinity, -Infinity]) {
    assert.equal(toUSD(value, 'USD', {USD: 1}), null, String(value));
  }
  for (const currency of [null, undefined, '', 'usd', 'DOLLARS', 'ZZZ', {}, 1]) {
    assert.equal(toUSD(100, currency, {USD: 1}), null, String(currency));
  }
  for (const rate of [null, undefined, '1', 0, -1, NaN, Infinity]) {
    assert.equal(toUSD(100, 'JPY', {JPY: rate}), null, String(rate));
  }
});

test('does not assume USD when provider currency metadata is missing or unknown', async () => {
  const result = await fetchQuotes(['NASDAQ:AAPL', 'NASDAQ:NVDA', 'NASDAQ:AMD'], {
    fetchImpl: async () => response([
      stock('NASDAQ:AAPL', 200, 3e12, null, null),
      stock('NASDAQ:NVDA', 150, 3e12, 'ZZZ', 'ZZZ'),
      {s: 'NASDAQ:AMD', d: [150, 250e9]},
    ]),
  });
  assert.deepEqual(result.quotes, {});
  assert.deepEqual(result.missing, ['NASDAQ:AAPL', 'NASDAQ:NVDA', 'NASDAQ:AMD']);
  assert.equal(result.fetchedAt, null);
});

test('keeps price-only and cap-only observations distinct instead of inventing the missing value', async () => {
  const result = await fetchQuotes(['NASDAQ:AAPL', 'NASDAQ:NVDA', 'NASDAQ:AMD'], {
    fetchImpl: async () => response([
      stock('NASDAQ:AAPL', 200, null, 'USD', null),
      stock('NASDAQ:NVDA', null, 3e12, null, 'USD', null),
      stock('NASDAQ:AMD', '150', 0),
    ]),
  });
  assert.equal(result.quotes['NASDAQ:AAPL'].priceUSD, 200);
  assert.equal(result.quotes['NASDAQ:AAPL'].capUSD, null);
  assert.equal(result.quotes['NASDAQ:NVDA'].priceUSD, null);
  assert.equal(result.quotes['NASDAQ:NVDA'].capUSD, 3000);
  assert.equal(result.quotes['NASDAQ:NVDA'].changePct, null);
  assert.deepEqual(result.missing, ['NASDAQ:AMD']);
});

test('rejects inverted, mismatched, unrequested, and invalid FX rates', async () => {
  const invalidRates = [
    {s: 'FX_IDC:USDJPY', d: [150, 'JPY', 'USD']},
    {s: 'FX_IDC:USDJPY', d: [150, 'USD', 'EUR']},
    {s: 'FX_IDC:JPYUSD', d: [0.006, 'JPY', 'USD']},
    {s: 'FX_IDC:USDJPY', d: [0, 'USD', 'JPY']},
    {s: 'FX_IDC:USDJPY', d: [-150, 'USD', 'JPY']},
    {s: 'FX_IDC:USDJPY', d: ['150', 'USD', 'JPY']},
    {s: 'FX_IDC:USDJPY', d: [Infinity, 'USD', 'JPY']},
    {s: 'FX_IDC:USDJPY', d: [150]},
  ];
  for (const row of invalidRates) {
    const result = await fetchQuotes(['TSE:8035'], {
      fetchImpl: async url => url.endsWith('/global/scan')
        ? response([stock('TSE:8035', 30000, 15e12, 'JPY', 'JPY')])
        : response([row]),
    });
    assert.deepEqual(result.quotes, {}, JSON.stringify(row));
    assert.deepEqual(result.missing, ['TSE:8035']);
    assert.equal(result.fetchedAt, null);
  }
});

test('an FX failure preserves independent USD observations and identifies missing companies', async () => {
  const result = await fetchQuotes(['NASDAQ:NVDA', 'NYSE:TSM', 'TSE:8035'], {
    fetchImpl: async url => url.endsWith('/global/scan')
      ? response([
        stock('NASDAQ:NVDA', 150, 3e12),
        stock('NYSE:TSM', 150, 32e12, 'USD', 'TWD'),
        stock('TSE:8035', 30000, 15e12, 'JPY', 'JPY'),
      ])
      : {ok: false, status: 503},
  });
  assert.equal(result.quotes['NASDAQ:NVDA'].capUSD, 3000);
  assert.equal(result.quotes['NYSE:TSM'].priceUSD, 150);
  assert.equal(result.quotes['NYSE:TSM'].capUSD, null);
  assert.deepEqual(result.missing, ['TSE:8035']);
  assert.ok(result.fetchedAt);
});

test('ignores unsolicited symbols and malformed rows without turning them into successful quotes', async () => {
  const result = await fetchQuotes(['NASDAQ:AAPL'], {
    fetchImpl: async () => response([
      null,
      {},
      {s: 'NASDAQ:AAPL', d: 'not an array'},
      stock('NASDAQ:NVDA', 150, 3e12),
    ]),
  });
  assert.deepEqual(result, {quotes: {}, fetchedAt: null, missing: ['NASDAQ:AAPL']});
});

test('does not stamp an empty provider response as freshly loaded market data', async () => {
  const result = await fetchQuotes(['NASDAQ:AAPL'], {fetchImpl: async () => response([])});
  assert.deepEqual(result, {quotes: {}, fetchedAt: null, missing: ['NASDAQ:AAPL']});
});

test('unsupported listings avoid unnecessary network requests', async () => {
  const fetchImpl = () => assert.fail('No provider symbols should be requested');
  assert.deepEqual(await fetchQuotes([], {fetchImpl}), {quotes: {}, fetchedAt: null, missing: []});
  assert.deepEqual(await fetchQuotes(['UNKNOWN'], {fetchImpl}), {
    quotes: {}, fetchedAt: null, missing: ['UNKNOWN'],
  });
});

test('rejects initial HTTP failures and malformed response envelopes', async () => {
  await assert.rejects(fetchQuotes(['NASDAQ:AAPL'], {
    fetchImpl: async () => ({ok: false, status: 429}),
  }), /HTTP 429/);
  for (const envelope of [null, {}, {data: null}, {data: {}}, {data: 'invalid'}]) {
    await assert.rejects(fetchQuotes(['NASDAQ:AAPL'], {
      fetchImpl: async () => ({ok: true, json: async () => envelope}),
    }), /Invalid market data response/);
  }
  await assert.rejects(fetchQuotes(['NASDAQ:AAPL'], {
    fetchImpl: async () => ({ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); }}),
  }), /Invalid JSON/);
});

test('initial requests time out and abort the in-flight fetch', {timeout: 1000}, async () => {
  let requestSignal;
  await assert.rejects(fetchQuotes(['NASDAQ:AAPL'], {
    timeoutMs: 15,
    fetchImpl: abortableFetch(signal => { requestSignal = signal; }),
  }), error => error.name === 'AbortError');
  assert.equal(requestSignal.aborted, true);
});

test('an FX timeout is bounded and retains the already received USD result', {timeout: 1000}, async () => {
  const waitingFetch = abortableFetch();
  const result = await fetchQuotes(['NASDAQ:NVDA', 'TSE:8035'], {
    timeoutMs: 15,
    fetchImpl: (url, options) => url.endsWith('/global/scan')
      ? Promise.resolve(response([
        stock('NASDAQ:NVDA', 150, 3e12),
        stock('TSE:8035', 30000, 15e12, 'JPY', 'JPY'),
      ]))
      : waitingFetch(url, options),
  });
  assert.equal(result.quotes['NASDAQ:NVDA'].capUSD, 3000);
  assert.deepEqual(result.missing, ['TSE:8035']);
});

test('caller cancellation propagates through both the stock and FX requests', {timeout: 1000}, async () => {
  for (const phase of ['stock', 'fx']) {
    const controller = new AbortController();
    const reason = new Error('Navigation cancelled');
    const waitingFetch = abortableFetch(() => controller.abort(reason));
    const request = fetchQuotes(['TSE:8035'], {
      signal: controller.signal,
      fetchImpl: (url, options) => phase === 'fx' && url.endsWith('/global/scan')
        ? Promise.resolve(response([stock('TSE:8035', 30000, 15e12, 'JPY', 'JPY')]))
        : waitingFetch(url, options),
    });
    await assert.rejects(request, error => error === reason);
  }
});

test('an already cancelled caller signal cannot return a successful result', {timeout: 1000}, async () => {
  const controller = new AbortController();
  const reason = new Error('Already cancelled');
  controller.abort(reason);
  await assert.rejects(fetchQuotes(['NASDAQ:AAPL'], {
    signal: controller.signal,
    fetchImpl: abortableFetch(),
  }), error => error === reason);
});

test('works without Object.hasOwn and calls the browser fetch with its required receiver', async () => {
  const context = vm.createContext({
    AbortController, setTimeout, clearTimeout,
    MarketPrices: {tradingViewSymbol: ticker => ticker === 'NASDAQ:AAPL' ? 'NASDAQ:AAPL' : null},
  });
  vm.runInContext(`
    Object.hasOwn = undefined;
    globalThis.fetch = async function () {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return {ok: true, json: async () => ({data: [
        {s: 'NASDAQ:AAPL', d: [200, 3e12, 0, 'delayed_streaming_900', 'USD', 'USD']}
      ]})};
    };
  `, context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'market-data.js'), 'utf8'), context);
  const result = await vm.runInContext("MarketData.fetchQuotes(['NASDAQ:AAPL', 'UNKNOWN'])", context);
  assert.equal(result.quotes['NASDAQ:AAPL'].priceUSD, 200);
  assert.equal(result.quotes['NASDAQ:AAPL'].capUSD, 3000);
  assert.deepEqual(Array.from(result.missing), ['UNKNOWN']);
});
