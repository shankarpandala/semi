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
  const shown = total(view.links.flatMap(l => l.flows)) + total(view.within.flatMap(w => w.flows)) + total(view.counter.flatMap(c => c.flows));
  assert.ok(close(shown, total(model.flows)));
  assert.deepEqual(view.nodes.map(n => [n.id, n.column]), [['sys', 0], ['chip', 1], ['fab', 2]]);
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
  const view = model.focus(model.flows, ['Fab1', 'Fab2']);
  assert.deepEqual(view.internal.map(f => f.to), ['Fab2']);
  assert.equal(view.links.length, 2);
  assert.equal(view.totals.internal, 2);
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
  for (const group of model.groups) views.push(model.focus(model.flows, group.companies));
  for (const name of model.groupOf.keys()) views.push(model.focus(model.flows, [name], {maxPerSide: 20}));
  const pairs = new Set(model.flows.map(f => f.fromGroup.id + '>' + f.toGroup.id));
  for (const key of pairs) views.push(model.pair(model.flows, ...key.split('>')));
  for (const view of views) {
    if (!view.links.length) continue;
    const result = layout({...options, nodes: view.nodes, links: view.links, order: view.order});
    assert.equal(result.links.length, view.links.length);
  }
});
