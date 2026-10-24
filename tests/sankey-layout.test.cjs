const test = require('node:test');
const assert = require('node:assert/strict');
const {layout, linkPath} = require('../assets/sankey-layout.js');

const EPS = 1e-6;
const graph = () => ({
  nodes: [
    {id: 'a', column: 0}, {id: 'b', column: 0},
    {id: 'c', column: 1}, {id: 'd', column: 1},
    {id: 'e', column: 2}, {id: 'f', column: 2},
  ],
  links: [
    {source: 'a', target: 'c', value: 30}, {source: 'a', target: 'd', value: 10},
    {source: 'b', target: 'd', value: 20}, {source: 'c', target: 'e', value: 25},
    {source: 'd', target: 'f', value: 25}, {source: 'a', target: 'f', value: 5},
  ],
  width: 600, height: 300, nodePadding: 10,
});

test('places columns from the left edge to the right edge', () => {
  const result = layout(graph());
  const byId = new Map(result.nodes.map(node => [node.id, node]));
  assert.equal(byId.get('a').x0, 0);
  assert.equal(byId.get('e').x1, 600);
  assert.ok(Math.abs(byId.get('c').x0 - (600 - 12) / 2) < EPS);
  assert.equal(result.columns.length, 3);
});

test('sizes nodes by the larger of inflow and outflow and fills the fullest column', () => {
  const result = layout(graph());
  const byId = new Map(result.nodes.map(node => [node.id, node]));
  assert.equal(byId.get('a').value, 45);
  assert.equal(byId.get('d').value, 30);
  assert.equal(byId.get('f').value, 30);
  for (const node of result.nodes) assert.ok(Math.abs(node.height - node.value * result.ky) < EPS, node.id);
  const columnTotals = result.columns.map(column => column.reduce((sum, node) => sum + node.height, 0) + 10 * (column.length - 1));
  assert.ok(Math.abs(Math.max(...columnTotals) - 300) < EPS);
});

test('keeps nodes inside the chart without overlaps and stacks links inside their nodes', () => {
  const result = layout(graph());
  for (const column of result.columns) {
    const sorted = [...column].sort((a, b) => a.y0 - b.y0);
    sorted.forEach((node, i) => {
      assert.ok(node.y0 >= -EPS && node.y1 <= 300 + EPS, node.id);
      if (i) assert.ok(node.y0 >= sorted[i - 1].y1 + 10 - EPS, node.id);
    });
  }
  for (const node of result.nodes) {
    for (const [links, key] of [[node.sourceLinks, 'y0'], [node.targetLinks, 'y1']]) {
      const used = links.reduce((sum, link) => sum + link.width, 0);
      assert.ok(used <= node.height + EPS, node.id);
      for (const link of links) {
        assert.ok(link[key] - link.width / 2 >= node.y0 - EPS && link[key] + link.width / 2 <= node.y1 + EPS, node.id);
      }
    }
  }
});

test('fixed order keeps input order within each column', () => {
  const input = graph();
  input.nodes = [{id: 'b', column: 0}, {id: 'a', column: 0}, ...input.nodes.slice(2)];
  const result = layout(input);
  const [b, a] = result.columns[0];
  assert.equal(b.id, 'b');
  assert.ok(b.y1 <= a.y0 + EPS);
});

test('barycenter order reduces crossings in a two-column graph', () => {
  const result = layout({
    nodes: [{id: 'p', column: 0}, {id: 'q', column: 0}, {id: 'x', column: 1}, {id: 'y', column: 1}],
    links: [{source: 'p', target: 'y', value: 10}, {source: 'q', target: 'x', value: 10}],
    width: 400, height: 200, order: 'barycenter',
  });
  const byId = new Map(result.nodes.map(node => [node.id, node]));
  assert.equal(byId.get('p').y0 < byId.get('q').y0, byId.get('y').y0 < byId.get('x').y0);
});

test('applies a minimum height to tiny nodes without overflowing the chart', () => {
  const nodes = [{id: 'big', column: 0}, ...Array.from({length: 12}, (_, i) => ({id: 't' + i, column: 1}))];
  const links = nodes.slice(1).map((node, i) => ({source: 'big', target: node.id, value: i === 0 ? 1000 : 0.001}));
  const result = layout({nodes, links, width: 300, height: 200, nodePadding: 4, minNodeHeight: 3});
  for (const node of result.nodes) {
    assert.ok(node.height >= 3 - EPS, node.id);
    assert.ok(node.y0 >= -EPS && node.y1 <= 200 + EPS, node.id);
  }
});

test('extra amounts size a node and sit below its links', () => {
  const input = graph();
  input.nodes = input.nodes.map(node => node.id === 'c' ? {...node, extraIn: 20, extraOut: 50} : node);
  input.nodes.push({id: 'lonely', column: 2, extraIn: 5});
  const result = layout(input);
  const byId = new Map(result.nodes.map(node => [node.id, node]));
  const c = byId.get('c');
  assert.equal(c.valueIn, 30);
  assert.equal(c.valueOut, 25);
  assert.equal(c.value, 75);
  assert.ok(Math.abs(c.height - 75 * result.ky) < EPS);
  assert.ok(Math.abs(c.inStub.y0 - (c.y0 + 30 * result.ky)) < EPS);
  assert.ok(Math.abs(c.inStub.y1 - c.inStub.y0 - 20 * result.ky) < EPS);
  assert.ok(Math.abs(c.outStub.y0 - (c.y0 + 25 * result.ky)) < EPS);
  assert.ok(c.outStub.y1 <= c.y1 + EPS);
  const lonely = byId.get('lonely');
  assert.equal(lonely.value, 5);
  assert.ok(Math.abs(lonely.inStub.y1 - lonely.y1) < EPS);
  assert.throws(() => layout({...graph(), nodes: [...graph().nodes, {id: 'bad', column: 1, extraIn: -1}]}), /extraIn/);
});

test('is deterministic', () => {
  const pick = result => result.nodes.map(node => [node.id, node.y0, node.y1]);
  assert.deepEqual(pick(layout(graph())), pick(layout(graph())));
});

test('rejects graphs it cannot draw left to right', () => {
  const base = graph();
  assert.throws(() => layout({...base, links: [{source: 'c', target: 'a', value: 1}]}), /later column/);
  assert.throws(() => layout({...base, links: [{source: 'a', target: 'b', value: 1}]}), /later column/);
  assert.throws(() => layout({...base, links: [{source: 'a', target: 'zz', value: 1}]}), /unknown node/);
  assert.throws(() => layout({...base, links: [{source: 'a', target: 'c', value: 0}]}), /positive/);
  assert.throws(() => layout({...base, nodes: [...base.nodes, {id: 'a', column: 1}]}), /Duplicate/);
  assert.throws(() => layout({...base, width: 0}), /size/);
});

test('draws each link as a closed ribbon from the source edge to the target edge', () => {
  const result = layout(graph());
  const link = result.links[0];
  const d = linkPath(link);
  const numbers = d.match(/-?[\d.]+(e-?\d+)?/g).map(Number);
  const xs = numbers.filter((_, i) => i % 2 === 0);
  const ys = numbers.filter((_, i) => i % 2 === 1);
  assert.ok(d.startsWith('M' + link.source.x1 + ',' + (link.y0 - link.width / 2)));
  assert.ok(d.endsWith('Z'));
  assert.equal(Math.min(...xs), link.source.x1);
  assert.equal(Math.max(...xs), link.target.x0);
  assert.ok(Math.abs(Math.max(...ys) - Math.max(link.y0, link.y1) - link.width / 2) < EPS);
  assert.ok(Math.abs(Math.min(...ys) - Math.min(link.y0, link.y1) + link.width / 2) < EPS);
  const thin = linkPath({...link, width: 0.1}, 1);
  assert.ok(thin.startsWith('M' + link.source.x1 + ',' + (link.y0 - 0.5)));
});
