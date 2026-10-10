const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {tradingViewSymbol, createPanel} = require('../assets/market-prices.js');

test('market-price module exposes the mapping and panel APIs', () => {
  assert.equal(typeof tradingViewSymbol, 'function');
  assert.equal(typeof createPanel, 'function');
});

test('maps every existing company listing to an explicit provider symbol', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const tickers = [...new Set([...html.matchAll(/ticker:'([^']+)'/g)].map(match => match[1]))];
  assert.equal(tickers.length, 101);
  for (const ticker of tickers) {
    assert.match(tradingViewSymbol(ticker) || '', /^[A-Z]+:[A-Z0-9]+$/, ticker);
  }
  assert.equal(new Set(tickers.map(tradingViewSymbol)).size, tickers.length);
});

test('uses the selected US exchanges, including Nasdaq-listed Linde', () => {
  assert.equal(tradingViewSymbol('AAPL'), 'NASDAQ:AAPL');
  assert.equal(tradingViewSymbol('LIN'), 'NASDAQ:LIN');
  assert.equal(tradingViewSymbol('TSM'), 'NYSE:TSM');
  assert.equal(tradingViewSymbol('ASX'), 'NYSE:ASX');
  assert.equal(tradingViewSymbol('KEYS'), 'NYSE:KEYS');
});

test('preserves exchange-specific ticker formats and handles the MosChip listing', () => {
  const cases = {
    '0981.HK': 'HKEX:981',
    '005930.KS': 'KRX:005930',
    '005290.KQ': 'KRX:005290',
    '002371.SZ': 'SZSE:002371',
    '688012.SS': 'SSE:688012',
    '6488.TWO': 'TPEX:6488',
    '2408.TW': 'TWSE:2408',
    '3436.T': 'TSE:3436',
    'WCH.DE': 'XETR:WCH',
    'AI.PA': 'EURONEXT:AI',
    'ASM.AS': 'EURONEXT:ASM',
    'SOLB.BR': 'EURONEXT:SOLB',
    'VACN.SW': 'SIX:VACN',
    'ATS.VI': 'VIE:ATS',
    'MOSCHIP.NS': 'BSE:MOSCHIP',
  };
  for (const [ticker, symbol] of Object.entries(cases)) {
    assert.equal(tradingViewSymbol(ticker), symbol);
  }
});

test('normalizes harmless input differences and rejects unverified listings', () => {
  assert.equal(tradingViewSymbol('  nvda  '), 'NASDAQ:NVDA');
  for (const ticker of [null, undefined, 123, {}, '', 'UNKNOWN', 'UNKNOWN.T', 'NVDA.L', 'NASDAQ:AAPL', '__proto__', '<script>']) {
    assert.equal(tradingViewSymbol(ticker), null);
  }
});
