const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = require('../assets/flows-data.js');

// The dashboard's inline TIERS list is the source of truth for company names and tiers.
function dashboardTiers() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('const TIERS = [');
  const end = html.indexOf('];', html.indexOf("label:'Tier 10")) + 2;
  return new Function(html.slice(start, end) + '\nreturn TIERS;')();
}
const tiers = dashboardTiers();
const names = new Set(tiers.flatMap(tier => tier.companies.map(company => company.name)));

test('groups cover every dashboard company exactly once, in its own tier and color', () => {
  assert.equal(names.size, 119);
  const seen = new Map();
  for (const group of data.groups) {
    const tier = tiers[group.tier];
    assert.ok(tier, group.id);
    assert.equal(group.hex, tier.hex, group.id);
    assert.ok(tier.label.startsWith(group.tierLabel.replace(/^Tier (0|1)$/, 'Tier 0–1')), group.id);
    for (const name of group.companies) {
      assert.ok(!seen.has(name), 'duplicate ' + name);
      seen.set(name, group);
      assert.ok(tier.companies.some(company => company.name === name), name + ' is not in ' + tier.label);
    }
    assert.ok(Number.isInteger(group.column) && group.column >= 0, group.id);
  }
  assert.deepEqual([...seen.keys()].sort(), [...names].sort());
});

test('every flow is well formed and between two different tracked companies', () => {
  assert.ok(data.flows.length > 0);
  const pairs = new Set();
  for (const flow of data.flows) {
    const id = flow.from + ' → ' + flow.to;
    assert.ok(names.has(flow.from), 'unknown payer ' + id);
    assert.ok(names.has(flow.to), 'unknown payee ' + id);
    assert.notEqual(flow.from, flow.to, id);
    assert.ok(!pairs.has(id), 'duplicate ' + id);
    pairs.add(id);
    assert.ok(typeof flow.usd === 'number' && Number.isFinite(flow.usd) && flow.usd >= 0.05, 'amount ' + id);
    assert.ok(['disclosed', 'derived', 'estimated'].includes(flow.conf), 'confidence ' + id);
    assert.ok(typeof flow.what === 'string' && flow.what.length > 0 && flow.what.length <= 60, 'what ' + id);
    assert.ok(typeof flow.basis === 'string' && flow.basis.length >= 10, 'basis ' + id);
    assert.ok(Array.isArray(flow.sources), 'sources ' + id);
    for (const source of flow.sources) {
      assert.ok(typeof source.title === 'string' && source.title.length > 0, 'source title ' + id);
      if (source.url !== undefined) assert.match(source.url, /^https:\/\/[^\s"<>]+$/, 'source url ' + id);
    }
  }
});

test('display names and revenue entries refer to tracked companies', () => {
  for (const [name, label] of Object.entries(data.short)) {
    assert.ok(names.has(name), name);
    assert.ok(label.length > 0 && label.length <= name.length, name);
  }
  for (const [name, revenue] of Object.entries(data.revenue)) {
    assert.ok(names.has(name), name);
    assert.ok(revenue.usd > 0 && typeof revenue.basis === 'string' && revenue.basis.length > 0, name);
  }
});

test('no company receives more from tracked customers than its reported revenue', () => {
  const inflow = new Map();
  for (const flow of data.flows) inflow.set(flow.to, (inflow.get(flow.to) || 0) + flow.usd);
  for (const [name, total] of inflow) {
    const revenue = data.revenue[name];
    if (revenue) assert.ok(total <= revenue.usd * 1.001, `${name}: inflows ${total.toFixed(2)} > revenue ${revenue.usd}`);
  }
});

test('metadata states the period, unit and exchange rates', () => {
  for (const key of ['period', 'unit', 'fx', 'compiled']) {
    assert.ok(typeof data.meta[key] === 'string' && data.meta[key].length > 0, key);
  }
});
