const test = require('node:test');
const assert = require('node:assert/strict');
const {tiers, companies, listed} = require('./roster.cjs');
const {tradingViewSymbol} = require('../assets/market-prices.js');
const flows = require('../assets/flows-data.js');

test('the roster has ten tiers and far more than the original 119 companies', () => {
  assert.equal(tiers.length, 10);
  assert.deepEqual(tiers.map(tier => tier.id), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(companies.length >= 1000, 'companies ' + companies.length);
  assert.ok(listed.length >= 900, 'listed ' + listed.length);
  for (const tier of tiers) assert.ok(tier.companies.length >= 25, tier.label + ' has ' + tier.companies.length);
});

test('every tier keeps its label, colour and description, and declares its segments', () => {
  const labels = ['Tier 0–1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Tier 6', 'Tier 7', 'Tier 8', 'Tier 9', 'Tier 10'];
  tiers.forEach((tier, index) => {
    assert.ok(tier.label.startsWith(labels[index] + ' · '), tier.label);
    assert.match(tier.hex, /^#[0-9A-F]{6}$/i, tier.label);
    assert.equal(tier.color, 'var(--r' + index + ')');
    assert.ok(tier.desc.length > 40 && tier.icon.length > 10, tier.label);
    assert.ok(tier.segments.length >= 3, tier.label);
    const ids = tier.segments.map(segment => segment.id);
    assert.equal(new Set(ids).size, ids.length, tier.label);
    for (const segment of tier.segments) {
      assert.match(segment.id, /^[a-z]+$/, tier.label);
      assert.ok(segment.label.length > 3, tier.label + ' ' + segment.id);
      assert.ok(tier.companies.some(company => company.seg === segment.id), tier.label + ' has an empty segment: ' + segment.id);
    }
  });
});

test('every company is well formed and sits in one of its tier’s segments', () => {
  for (const tier of tiers) {
    const segments = new Set(tier.segments.map(segment => segment.id));
    for (const company of tier.companies) {
      const id = tier.label + ' / ' + company.name;
      assert.ok(typeof company.name === 'string' && company.name.length >= 2 && company.name.length <= 60, id);
      assert.equal(company.name, company.name.trim(), id);
      assert.ok(typeof company.hq === 'string' && company.hq.length >= 4, 'headquarters ' + id);
      assert.ok(segments.has(company.seg), 'segment ' + id);
      assert.ok(typeof company.domain === 'string' && company.domain.length >= 4 && company.domain.length <= 110, 'domain ' + id);
      assert.doesNotMatch(company.domain, /\?\s*$|\bTODO\b|unverified/i, 'domain ' + id);
      for (const key of Object.keys(company)) {
        assert.ok(['name', 'hq', 'ticker', 'seg', 'domain', 'status', 'note', 'flows'].includes(key), key + ' in ' + id);
      }
      if (company.status !== undefined) assert.ok(['private', 'crossref'].includes(company.status), 'status ' + id);
      // A private company or unlisted unit says who owns it; a listed one has a symbol.
      if (company.status) assert.ok(company.note && company.note.length >= 10, 'ownership note ' + id);
      if (company.status) assert.equal(company.ticker, undefined, 'unlisted companies carry no symbol: ' + id);
    }
  }
});

test('company names are unique, so deep links and the flows page can use them', () => {
  const seen = new Map();
  for (const tier of tiers) for (const company of tier.companies) {
    const key = company.name.toLowerCase();
    assert.ok(!seen.has(key), company.name + ' appears in ' + seen.get(key) + ' and ' + tier.label);
    seen.set(key, tier.label);
  }
});

test('every listing is a unique, well-formed provider symbol', () => {
  const seen = new Map();
  for (const company of listed) {
    assert.equal(tradingViewSymbol(company.ticker), company.ticker, company.name + ' ' + company.ticker);
    assert.ok(!seen.has(company.ticker), company.ticker + ' is used by ' + seen.get(company.ticker) + ' and ' + company.name);
    seen.set(company.ticker, company.name);
  }
});

test('companies flagged for the flows page are exactly the ones it has figures for', () => {
  const flagged = companies.filter(company => company.flows).map(company => company.name).sort();
  const tracked = flows.groups.flatMap(group => group.companies).sort();
  assert.deepEqual(flagged, tracked);
  for (const company of companies) if (company.flows !== undefined) assert.equal(company.flows, true, company.name);
});
