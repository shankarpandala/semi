const test = require('node:test');
const assert = require('node:assert/strict');
const {createModel, CONFIDENCE} = require('../assets/flow-views.js');
const {layout} = require('../assets/sankey-layout.js');
const data = require('../assets/flows-data.js');

const flow = (from, to, usd, conf = 'estimated') => ({from, to, usd, conf, what: 'x', basis: 'x', sources: []});
const fixture = flows => ({
  groups: [
    {id: 'sys', tier: 9, tierLabel: 'Tier 10', role: 'Systems', column: 0, hex: '#000', companies: ['Sys1', 'Sys2']},
    {id: 'chip', tier: 8, tierLabel: 'Tier 9', role: 'Chips', column: 1, hex: '#111', companies: ['Chip1', 'Chip2']},
    {id: 'fab', tier: 5, tierLabel: 'Tier 6', role: 'Fabs', column: 2, hex: '#222', companies: ['Fab1', 'Fab2']},
    {id: 'tool', tier: 3, tierLabel: 'Tier 4', role: 'Tools', column: 3, hex: '#333',
      companies: Array.from({length: 30}, (_, i) => 'Tool' + i)},
  ],
  flows,
});
const total = list => list.reduce((sum, f) => sum + f.usd, 0);
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('overview draws forward group flows and lists within-group and counter-flows separately', () => {
  const model = createModel(fixture([
    flow('Sys1', 'Chip1', 10), flow('Sys2', 'Chip1', 5), flow('Chip1', 'Fab1', 8, 'disclosed'),
    flow('Fab1', 'Fab2', 2), flow('Fab2', 'Chip2', 3), flow('Sys1', 'Fab2', 4),
  ]));
  const view = model.overview(model.flows);
  assert.deepEqual(view.links.map(l => [l.source, l.target, l.value]), [['sys', 'chip', 15], ['chip', 'fab', 8], ['sys', 'fab', 4]]);
  assert.deepEqual(view.within.map(w => [w.group.id, w.value]), [['fab', 2]]);
  assert.deepEqual(view.counter.map(c => [c.from.id, c.to.id, c.value]), [['fab', 'chip', 3]]);
  const shown = [view.links, view.within, view.lateral, view.counter].reduce((sum, items) => sum + total(items.flatMap(i => i.flows)), 0);
  assert.ok(close(shown, total(model.flows)));
  assert.deepEqual(view.nodes.map(n => [n.id, n.column]), [['sys', 0], ['chip', 1], ['fab', 2]]);
});

test('overview keeps flows between groups that share a column apart from counter-flows', () => {
  const data = fixture([flow('Fab1', 'Tool1', 2), flow('Tool1', 'Lab1', 0.5), flow('Lab1', 'Fab2', 0.25)]);
  data.groups.push({id: 'lab', tier: 2, tierLabel: 'Tier 3', role: 'Labs', column: 3, hex: '#444', companies: ['Lab1']});
  const model = createModel(data);
  const view = model.overview(model.flows);
  assert.deepEqual(view.links.map(l => [l.source, l.target]), [['fab', 'tool']]);
  assert.deepEqual(view.lateral.map(l => [l.from.id, l.to.id, l.value]), [['tool', 'lab', 0.5]]);
  assert.deepEqual(view.counter.map(c => [c.from.id, c.to.id, c.value]), [['lab', 'fab', 0.25]]);
});

test('filters by confidence', () => {
  const model = createModel(fixture([flow('Sys1', 'Chip1', 10, 'disclosed'), flow('Chip1', 'Fab1', 8, 'derived'), flow('Fab1', 'Tool1', 1)]));
  assert.deepEqual(model.filter(['disclosed']).map(f => f.to), ['Chip1']);
  assert.equal(model.filter(CONFIDENCE).length, 3);
  const summary = model.summarize(model.flows);
  assert.deepEqual(summary.byConf, {disclosed: 10, derived: 8, estimated: 1});
  assert.equal(summary.count, 3);
});

test('focus folds the smallest counterparties into one node without losing value', () => {
  const flows = Array.from({length: 30}, (_, i) => flow('Fab1', 'Tool' + i, 30 - i));
  flows.push(flow('Chip1', 'Fab1', 50), flow('Fab1', 'Fab2', 1));
  const model = createModel(fixture(flows));
  const view = model.focus(model.flows, ['Fab1'], {maxPerSide: 10});
  const right = view.nodes.filter(n => n.id.startsWith('R:'));
  assert.equal(right.length, 10);
  const other = right.find(n => n.kind === 'other');
  assert.equal(other.names.length, 22);
  assert.equal(other.label, '22 other payees');
  assert.ok(close(total(view.links.flatMap(l => l.flows)), total(model.flows)));
  assert.ok(close(view.totals.out, total(flows.filter(f => f.from === 'Fab1'))));
  assert.equal(view.totals.in, 50);
  assert.deepEqual(view.nodes.filter(n => n.id.startsWith('M:')).map(n => n.column), [1]);
});

test('group focus keeps flows inside the group out of the drawn graph', () => {
  const model = createModel(fixture([flow('Fab1', 'Fab2', 2), flow('Chip1', 'Fab1', 5), flow('Fab2', 'Tool3', 1)]));
  const view = model.focus(model.flows, ['Fab1', 'Fab2'], {accounts: false});
  assert.deepEqual(view.internal.map(f => f.to), ['Fab2']);
  assert.equal(view.links.length, 2);
  assert.equal(view.totals.internal, 2);
});

test('group focus can collapse counterparties into their tier groups', () => {
  const model = createModel(fixture([
    flow('Sys1', 'Fab1', 4), flow('Sys2', 'Fab1', 1), flow('Chip1', 'Fab2', 5),
    flow('Fab1', 'Tool1', 2), flow('Fab2', 'Tool2', 3), flow('Fab1', 'Fab2', 1),
  ]));
  const view = model.focus(model.flows, ['Fab1', 'Fab2'], {outer: 'group', accounts: false});
  assert.deepEqual(view.nodes.map(n => [n.id, n.column, n.kind]), [
    ['L:sys', 0, 'groupSide'], ['L:chip', 0, 'groupSide'],
    ['M:Fab1', 1, 'company'], ['M:Fab2', 1, 'company'],
    ['R:tool', 2, 'groupSide'],
  ]);
  const value = (s, t) => view.links.find(l => l.source === s && l.target === t).value;
  assert.equal(value('L:sys', 'M:Fab1'), 5);
  assert.equal(value('M:Fab2', 'R:tool'), 3);
  assert.deepEqual(view.internal.map(f => f.to), ['Fab2']);
  assert.deepEqual(view.totals, {in: 10, out: 5, internal: 1});
});

const withAccounts = (flows, accounts) => ({...fixture(flows), accounts});
const sumLinks = (view, predicate) => view.links.filter(predicate).reduce((total, l) => total + l.value, 0);

test('accounts balance revenue against tracked suppliers, other costs, people and profit', () => {
  const model = createModel(withAccounts(
    [flow('Chip1', 'Fab1', 6), flow('Fab1', 'Tool1', 3), flow('Chip2', 'Fab2', 1), flow('Fab2', 'Tool2', 4)],
    {
      Fab1: {revenue: 10, people: 2, profit: 4, outside: [{label: 'Car makers', usd: 3}, {label: 'Phone makers', usd: 1}]},
      Fab2: {revenue: 0.5, people: 1, profit: -2},
    },
  ));
  const fab1 = model.account('Fab1');
  assert.deepEqual([fab1.revenue, fab1.trackedIn, fab1.trackedOut, fab1.other, fab1.reserves], [10, 6, 3, 1, 0]);
  assert.deepEqual(fab1.outside.map(o => [o.label, o.usd]), [['Car makers', 3], ['Phone makers', 1]]);
  assert.equal(fab1.inTotal, fab1.outTotal);
  // Revenue is raised to tracked inflows; the loss and the purchases beyond it
  // are funded from reserves, so both sides still balance.
  const fab2 = model.account('Fab2');
  assert.deepEqual([fab2.revenue, fab2.reserves, fab2.profit, fab2.other, fab2.outsideTotal], [1, 4, 0, 0, 0]);
  assert.equal(fab2.outTotal, 4 + 1);
  assert.equal(fab2.inTotal, 5);
  // Without account data a company's revenue is its tracked inflow or outflow.
  assert.deepEqual([model.account('Tool1').revenue, model.account('Sys1').revenue], [3, 0]);
});

test('company focus with accounts balances the company on both sides', () => {
  const model = createModel(withAccounts(
    [flow('Chip1', 'Fab1', 6, 'disclosed'), flow('Chip2', 'Fab1', 1), flow('Fab1', 'Tool1', 3, 'disclosed')],
    {Fab1: {revenue: 10, people: 2, profit: 4, outside: [{label: 'Car makers', usd: 3}]}},
  ));
  const view = model.focus(model.filter(['disclosed']), ['Fab1']);
  const into = sumLinks(view, l => l.target === 'M:Fab1');
  const out = sumLinks(view, l => l.source === 'M:Fab1');
  assert.equal(into, 10);
  assert.equal(out, 10);
  const ids = view.nodes.map(n => n.id);
  assert.ok(ids.includes('XL:in:Car makers') && ids.includes('XL:hiddenIn') && ids.includes('XR:profit'), ids.join());
  assert.equal(view.links.find(l => l.source === 'XL:hiddenIn').value, 1);
  assert.deepEqual(view.account, {revenue: 10, trackedIn: 7, trackedOut: 3, outside: 3, reserves: 0, people: 2, profit: 4, other: 1});
});

test('group focus with accounts shows payments inside the group on both sides', () => {
  const model = createModel(withAccounts(
    [flow('Chip1', 'Fab1', 6), flow('Fab1', 'Fab2', 2), flow('Fab2', 'Tool1', 1)],
    {Fab1: {revenue: 8, people: 1, profit: 2}, Fab2: {revenue: 5, people: 1, profit: 1}},
  ));
  const view = model.focus(model.flows, ['Fab1', 'Fab2'], {outer: 'group'});
  for (const name of ['Fab1', 'Fab2']) {
    const item = model.account(name);
    assert.ok(Math.abs(sumLinks(view, l => l.target === 'M:' + name) - item.inTotal) < 1e-9, name);
    assert.ok(Math.abs(sumLinks(view, l => l.source === 'M:' + name) - item.outTotal) < 1e-9, name);
  }
  assert.equal(view.links.find(l => l.source === 'XL:internalIn').value, 2);
  assert.equal(view.links.find(l => l.target === 'XR:internalOut').value, 2);
  assert.equal(sumLinks(view, l => l.source === 'XL:customers'), 2 + 3);
});

test('overview stubs make each group\'s height its full account', () => {
  const model = createModel(withAccounts(
    [flow('Sys1', 'Chip1', 10), flow('Chip1', 'Fab1', 8), flow('Fab1', 'Fab2', 1)],
    {Chip1: {revenue: 30, people: 5, profit: 12}, Fab1: {revenue: 20, people: 2, profit: 9}},
  ));
  const view = model.overview(model.flows);
  for (const node of view.nodes) {
    const accounts = node.group.companies.map(model.account);
    const inTotal = accounts.reduce((t, a) => t + a.inTotal, 0);
    const outTotal = accounts.reduce((t, a) => t + a.outTotal, 0);
    const drawnIn = sumLinks(view, l => l.target === node.id);
    const drawnOut = sumLinks(view, l => l.source === node.id);
    assert.ok(Math.abs(drawnIn + node.extraIn - inTotal) < 1e-9, node.id);
    assert.ok(Math.abs(drawnOut + node.extraOut - outTotal) < 1e-9, node.id);
  }
  const chip = view.nodes.find(n => n.id === 'chip');
  assert.deepEqual(chip.stubIn.map(s => [s.key, s.usd]), [['customers', 20]]);
  assert.deepEqual(chip.stubOut.map(s => [s.key, s.usd]), [['other', 5], ['people', 5], ['profit', 12]]);
  const fab = view.nodes.find(n => n.id === 'fab');
  assert.deepEqual(fab.stubOut.map(s => s.key), ['notDrawn', 'other', 'people', 'profit']);
});

test('pair view links payers to payees and handles a group paying itself', () => {
  const model = createModel(fixture([flow('Chip1', 'Fab1', 5), flow('Chip2', 'Fab1', 3), flow('Fab1', 'Fab2', 2)]));
  const view = model.pair(model.flows, 'chip', 'fab');
  assert.deepEqual(view.nodes.map(n => n.id).sort(), ['L:Chip1', 'L:Chip2', 'R:Fab1']);
  const self = model.pair(model.flows, 'fab', 'fab');
  assert.deepEqual(self.links.map(l => [l.source, l.target]), [['L:Fab1', 'R:Fab2']]);
});

test('rejects unknown or duplicated companies', () => {
  assert.throws(() => createModel(fixture([flow('Nobody', 'Fab1', 1)])), /unknown company/);
  const dup = fixture([]);
  dup.groups[1].companies.push('Sys1');
  assert.throws(() => createModel(dup), /two groups/);
});

test('every view of the published data can be laid out', () => {
  const model = createModel(data);
  const options = {width: 800, height: 600, nodePadding: 8};
  const views = [model.overview(model.flows)];
  for (const group of model.groups) views.push(model.focus(model.flows, group.companies, {outer: 'group'}));
  for (const name of model.groupOf.keys()) views.push(model.focus(model.flows, [name], {maxPerSide: 20}));
  const pairs = new Set(model.flows.map(f => f.fromGroup.id + '>' + f.toGroup.id));
  for (const key of pairs) views.push(model.pair(model.flows, ...key.split('>')));
  for (const name of model.groupOf.keys()) {
    const view = model.focus(model.flows, [name]);
    const item = model.account(name);
    const into = view.links.filter(l => l.target === 'M:' + name).reduce((t, l) => t + l.value, 0);
    const out = view.links.filter(l => l.source === 'M:' + name).reduce((t, l) => t + l.value, 0);
    assert.ok(Math.abs(into - item.inTotal) < 1e-6, name + ' in');
    assert.ok(Math.abs(out - item.outTotal) < 1e-6, name + ' out');
    assert.ok(Math.abs(item.inTotal - item.outTotal) < 1e-6, name + ' balances');
  }
  for (const view of views) {
    if (!view.links.length) continue;
    const result = layout({...options, nodes: view.nodes, links: view.links, order: view.order});
    assert.equal(result.links.length, view.links.length);
  }
});
