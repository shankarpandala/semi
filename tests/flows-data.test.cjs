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
    // At least $10M: smaller disclosed or capped amounts are real, near-zero placeholders are not.
    assert.ok(typeof flow.usd === 'number' && Number.isFinite(flow.usd) && flow.usd >= 0.01, 'amount ' + id);
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

test('display names refer to tracked companies', () => {
  for (const [name, label] of Object.entries(data.short)) {
    assert.ok(names.has(name), name);
    assert.ok(label.length > 0 && label.length <= name.length, name);
  }
});

test('tickers match the dashboard listings', () => {
  const listed = {};
  for (const tier of tiers) for (const company of tier.companies) {
    if (company.ticker && company.status !== 'private') listed[company.name] = company.ticker;
  }
  assert.deepEqual(data.tickers, listed);
});

test('every company has a sourced 2025 account', () => {
  assert.deepEqual(Object.keys(data.accounts).sort(), [...names].sort());
  for (const [name, account] of Object.entries(data.accounts)) {
    assert.ok(account.revenue > 0 && Number.isFinite(account.revenue), 'revenue ' + name);
    assert.ok(account.people >= 0 && Number.isFinite(account.people), 'people ' + name);
    assert.ok(Number.isFinite(account.profit), 'profit ' + name);
    if (account.total !== undefined) assert.ok(account.total >= account.revenue, 'total ' + name);
    if (account.buyer) assert.ok(account.people === 0 && account.profit === 0, 'buyer ' + name);
    assert.ok(['disclosed', 'derived', 'estimated'].includes(account.conf), 'confidence ' + name);
    for (const key of ['scope', 'period']) assert.ok(typeof account[key] === 'string' && account[key].length > 0, key + ' ' + name);
    assert.ok(typeof account.basis === 'string' && account.basis.length >= 10, 'basis ' + name);
    assert.ok(Array.isArray(account.outside), 'outside ' + name);
    for (const item of account.outside) assert.ok(item.label && item.usd >= 0, 'outside item ' + name);
    assert.ok(account.sources.length > 0, 'sources ' + name);
    for (const source of account.sources) {
      assert.ok(source.title, 'source title ' + name);
      if (source.url !== undefined) assert.match(source.url, /^https:\/\/[^\s"<>]+$/, 'source url ' + name);
    }
  }
});

test('no company receives more from tracked customers than its reported revenue', () => {
  const inflow = new Map();
  for (const flow of data.flows) inflow.set(flow.to, (inflow.get(flow.to) || 0) + flow.usd);
  for (const [name, total] of inflow) {
    const account = data.accounts[name];
    assert.ok(account && total <= account.revenue * 1.001, `${name}: inflows ${total.toFixed(2)} > revenue ${account && account.revenue}`);
  }
});

test('accounts without a cost split say so, and estimated splits are not badged disclosed', () => {
  for (const [name, account] of Object.entries(data.accounts)) {
    if (!account.buyer && !(account.people > 0)) assert.match(account.otherLabel || '', /breakdown pending/, 'pending label ' + name);
    if (/\bestimat/i.test(account.scope)) assert.notEqual(account.conf, 'disclosed', 'confidence ' + name);
  }
});

test('the revenue in each basis is the revenue drawn', () => {
  for (const [name, account] of Object.entries(data.accounts)) {
    // A segment-scoped account states the company total first, then its segment.
    const match = account.basis.match(account.total ? /of which \$([\d.]+)([BM])/ : /: revenue \$([\d.]+)([BM])/);
    if (!match) continue;
    const stated = match[2] === 'M' ? match[1] / 1000 : Number(match[1]);
    if (/shown at the \$[\d.]+[BM] paid by tracked customers/.test(account.basis)) continue;
    assert.ok(Math.abs(stated - account.revenue) <= Math.max(0.06, 0.015 * account.revenue), `${name}: ${match[0]} vs ${account.revenue}`);
  }
});

test('outside customer categories roughly add up to the revenue not paid by tracked companies', () => {
  const {createModel} = require('../assets/flow-views.js');
  const model = createModel(data);
  for (const [name, account] of Object.entries(data.accounts)) {
    const listed = account.outside.reduce((total, item) => total + item.usd, 0);
    const outside = model.account(name).outsideTotal;
    // Within a factor of 2.5 either way: a list researched for another scope would be far off.
    if (listed > 0.01 && outside > 0.01) assert.ok(outside / listed <= 2.5 && outside / listed >= 0.4, `${name}: categories ${listed.toFixed(2)} vs ${outside.toFixed(2)}`);
  }
});

test('purchases ahead of sales only arise where there are tracked purchases', () => {
  const {createModel} = require('../assets/flow-views.js');
  const model = createModel(data);
  for (const name of Object.keys(data.accounts)) {
    const account = model.account(name);
    assert.ok(account.ahead <= account.trackedOut + 1e-9, `${name}: ahead ${account.ahead} > tracked purchases ${account.trackedOut}`);
  }
});

test('Apple counts buy-sell receipts only while Foxconn\u2019s payment for them is tracked', () => {
  const receipts = data.flows.find(flow => flow.from === 'Foxconn (Hon Hai)' && flow.to === 'Apple');
  assert.equal(/buy-sell/.test(data.accounts.Apple.revenueLabel || ''), !!receipts);
});

test('text shown to readers carries no research-process notes', () => {
  const internal = /merged[-\w]*\.json|fetch returned|seen in search results|\bthe dataset\b|\brelevant_revenue\b|revenue not found|filing not retrieved/i;
  for (const [name, account] of Object.entries(data.accounts)) {
    for (const text of [account.basis, account.scope, account.otherLabel || '', ...account.outside.map(item => item.label), ...account.sources.map(source => source.title)]) {
      assert.doesNotMatch(text, internal, name);
    }
  }
  for (const flow of data.flows) {
    for (const text of [flow.basis, flow.what, ...flow.sources.map(source => source.title)]) {
      assert.doesNotMatch(text, internal, flow.from + ' → ' + flow.to);
    }
  }
});

test('metadata states the period, unit and exchange rates', () => {
  for (const key of ['period', 'unit', 'fx', 'compiled']) {
    assert.ok(typeof data.meta[key] === 'string' && data.meta[key].length > 0, key);
  }
});
