const test = require('node:test');
const assert = require('node:assert/strict');
const {tradingViewSymbol, listingUrl, createPanel} = require('../assets/market-prices.js');
const {listed} = require('./roster.cjs');

test('market-price module exposes the listing and panel APIs', () => {
  assert.equal(typeof tradingViewSymbol, 'function');
  assert.equal(typeof listingUrl, 'function');
  assert.equal(typeof createPanel, 'function');
});

test('accepts every roster listing as it is written', () => {
  assert.ok(listed.length > 0);
  for (const company of listed) assert.equal(tradingViewSymbol(company.ticker), company.ticker, company.name);
});

test('keeps exchange-specific symbol formats', () => {
  for (const symbol of ['NASDAQ:NVDA', 'NYSE:TSM', 'HKEX:981', 'KRX:005930', 'SZSE:002371', 'SSE:688012', 'TPEX:6488',
    'TWSE:2408', 'TSE:3436', 'TSE:285A', 'XETR:WCH', 'EURONEXT:AI', 'SIX:VACN', 'VIE:ATS', 'BSE:MOSCHIP',
    'OMXSTO:ERIC_A', 'NGM:OBDU.B', 'MYX:D&O', 'LSE:IQE']) {
    assert.equal(tradingViewSymbol(symbol), symbol);
  }
});

test('normalizes harmless input differences', () => {
  assert.equal(tradingViewSymbol('  nasdaq:nvda  '), 'NASDAQ:NVDA');
  assert.equal(tradingViewSymbol('tse:285a'), 'TSE:285A');
});

test('rejects anything that is not an exchange-qualified symbol', () => {
  for (const ticker of [null, undefined, 123, {}, [], '', 'NVDA', '6857.T', 'UNKNOWN', 'NASDAQ:', ':NVDA', 'NASDAQ:NVDA:X',
    'NASDAQ NVDA', 'NASDAQ:NV DA', 'N:NVDA', 'NASDAQ:NVDA/..', 'NASDAQ:<script>', 'javascript:alert(1)', '__proto__',
    'constructor', 'NASDAQ:' + 'A'.repeat(21), 'A'.repeat(16) + ':NVDA']) {
    assert.equal(tradingViewSymbol(ticker), null, String(ticker));
  }
});

test('builds listing links from an encoded exchange and code', () => {
  assert.equal(listingUrl('NASDAQ:NVDA'), 'https://www.tradingview.com/symbols/NASDAQ-NVDA/');
  assert.equal(listingUrl('OMXSTO:ERIC_A'), 'https://www.tradingview.com/symbols/OMXSTO-ERIC_A/');
  assert.equal(listingUrl('MYX:D&O'), 'https://www.tradingview.com/symbols/MYX-D%26O/');
  for (const company of listed) assert.match(listingUrl(company.ticker), /^https:\/\/www\.tradingview\.com\/symbols\/[A-Z0-9_]+-[A-Z0-9._%-]+\/$/, company.name);
});
