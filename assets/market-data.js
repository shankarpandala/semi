(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./market-prices.js'));
  } else {
    root.MarketData = factory(root.MarketPrices);
  }
})(globalThis, function (listings) {
  'use strict';

  const ENDPOINT = 'https://scanner.tradingview.com';
  const COLUMNS = ['close', 'market_cap_basic', 'change', 'update_mode', 'currency', 'fundamental_currency_code'];
  const FX_CURRENCIES = new Set(['JPY', 'TWD', 'KRW', 'CNY', 'HKD', 'EUR', 'CHF', 'INR', 'GBP', 'AUD', 'CAD']);
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

  function currencyUnit(value) {
    if (value === 'GBp' || value === 'GBX') return {code: 'GBP', scale: 100};
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) return null;
    return {code: value, scale: 1};
  }

  function toUSD(value, currency, rates) {
    const unit = currencyUnit(currency);
    if (!positive(value) || !unit || !positive(rates[unit.code])) return null;
    const dollars = value / unit.scale / rates[unit.code];
    return positive(dollars) ? dollars : null;
  }

  async function scan(market, symbols, columns, signal, fetchImpl) {
    const response = await fetchImpl(ENDPOINT + '/' + market + '/scan', {
      method: 'POST',
      // A string body uses the browser's safelisted text/plain content type.
      // An explicit application/json header triggers an unsupported preflight.
      body: JSON.stringify({symbols: {tickers: symbols, query: {types: []}}, columns}),
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal,
    });
    if (!response.ok) throw new Error('Market data request failed (HTTP ' + response.status + ').');
    const body = await response.json();
    if (!body || !Array.isArray(body.data)) throw new Error('Invalid market data response.');
    return body.data;
  }

  async function fetchQuotes(tickers, options = {}) {
    const {signal, timeoutMs = 15000, fetchImpl = globalThis.fetch.bind(globalThis)} = options;
    const requested = [...new Set(tickers)];
    const providerToTicker = new Map();
    for (const ticker of requested) {
      const symbol = listings.tradingViewSymbol(ticker);
      if (symbol) providerToTicker.set(symbol, ticker);
    }
    if (!providerToTicker.size) return {quotes: {}, fetchedAt: null, missing: requested};

    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const data = await scan('global', [...providerToTicker.keys()], COLUMNS, controller.signal, fetchImpl);
      const native = new Map();
      const currencies = new Set();
      for (const row of data) {
        if (!row || !providerToTicker.has(row.s) || !Array.isArray(row.d)) continue;
        const [price, cap, change, delay, priceCurrency, capCurrency] = row.d;
        native.set(row.s, {price, cap, change, delay, priceCurrency, capCurrency});
        for (const [value, currency] of [[price, priceCurrency], [cap, capCurrency]]) {
          const unit = currencyUnit(currency);
          if (positive(value) && unit && FX_CURRENCIES.has(unit.code)) currencies.add(unit.code);
        }
      }

      // Financial currency can differ from the share-price currency. Both are
      // converted independently using this visit's FX quotes, never fixed rates.
      const rates = {USD: 1};
      if (currencies.size) {
        const fxSymbols = [...currencies].map(code => 'FX_IDC:USD' + code);
        try {
          const fx = await scan('forex', fxSymbols, ['close', 'base_currency', 'currency'], controller.signal, fetchImpl);
          for (const row of fx) {
            if (!row || !fxSymbols.includes(row.s) || !Array.isArray(row.d)) continue;
            const [rate, base, quote] = row.d;
            if (base === 'USD' && row.s === 'FX_IDC:USD' + quote && positive(rate)) rates[quote] = rate;
          }
        } catch (error) {
          // A failed FX request must not discard independent USD valuations.
          if (signal?.aborted) throw error;
        }
      }
      if (signal?.aborted) throw signal.reason || new Error('Market request cancelled.');

      const quotes = {};
      for (const [symbol, value] of native) {
        const priceUSD = toUSD(value.price, value.priceCurrency, rates);
        const capDollars = toUSD(value.cap, value.capCurrency, rates);
        if (priceUSD === null && capDollars === null) continue;
        quotes[providerToTicker.get(symbol)] = {
          priceUSD,
          capUSD: capDollars === null ? null : capDollars / 1e9,
          changePct: typeof value.change === 'number' && Number.isFinite(value.change) ? value.change : null,
          delay: typeof value.delay === 'string' ? value.delay : null,
          // The scanner does not provide an exchange timestamp in this query.
          providerTime: null,
        };
      }
      const missing = requested.filter(ticker => !Object.prototype.hasOwnProperty.call(quotes, ticker));
      return {quotes, fetchedAt: Object.keys(quotes).length ? new Date().toISOString() : null, missing};
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  return {fetchQuotes, toUSD};
});
