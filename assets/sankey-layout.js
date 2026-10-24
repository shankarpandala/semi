(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SankeyLayout = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  // Column-based Sankey layout. Callers assign every node a column and pass only
  // links that move to a later column, so the graph can never contain a cycle.
  // order 'fixed' keeps each column in input order; 'barycenter' reorders
  // columns to reduce crossings. Positions are then relaxed toward linked nodes.
  function layout(options) {
    const {
      width, height, nodeWidth = 12, nodePadding = 14, minNodeHeight = 2,
      order = 'fixed', iterations = 6,
    } = options;
    if (!(width > nodeWidth) || !(height > 0)) throw new Error('Invalid layout size.');

    const nodes = options.nodes.map(node => ({...node, sourceLinks: [], targetLinks: [], valueIn: 0, valueOut: 0}));
    const byId = new Map();
    for (const node of nodes) {
      if (byId.has(node.id)) throw new Error('Duplicate node: ' + node.id);
      if (!Number.isInteger(node.column) || node.column < 0) throw new Error('Invalid column for node: ' + node.id);
      byId.set(node.id, node);
    }
    const links = options.links.map(link => {
      const source = byId.get(link.source);
      const target = byId.get(link.target);
      if (!source || !target) throw new Error('Link references an unknown node: ' + link.source + ' → ' + link.target);
      if (source.column >= target.column) throw new Error('Link must move to a later column: ' + link.source + ' → ' + link.target);
      if (!(link.value > 0) || !Number.isFinite(link.value)) throw new Error('Link value must be positive: ' + link.source + ' → ' + link.target);
      const out = {...link, source, target, width: 0, y0: 0, y1: 0};
      source.sourceLinks.push(out);
      target.targetLinks.push(out);
      source.valueOut += link.value;
      target.valueIn += link.value;
      return out;
    });
    for (const node of nodes) node.value = Math.max(node.valueIn, node.valueOut);

    const columnCount = nodes.reduce((max, node) => Math.max(max, node.column + 1), 0);
    const columns = Array.from({length: columnCount}, () => []);
    for (const node of nodes) columns[node.column].push(node);
    const step = columnCount > 1 ? (width - nodeWidth) / (columnCount - 1) : 0;
    for (const node of nodes) {
      node.x0 = node.column * step;
      node.x1 = node.x0 + nodeWidth;
    }

    // Scale so the fullest column fits, allowing for minimum heights on tiny nodes.
    const columnHeight = (column, ky) => column.reduce((sum, node) => sum + Math.max(node.value * ky, minNodeHeight), 0)
      + Math.max(0, column.length - 1) * nodePadding;
    let ky = Infinity;
    for (const column of columns) {
      const total = column.reduce((sum, node) => sum + node.value, 0);
      if (!column.length || !(total > 0)) continue;
      let k = Math.max(0, height - (column.length - 1) * nodePadding) / total;
      if (columnHeight(column, k) > height) {
        let low = 0;
        for (let i = 0; i < 40; i++) {
          const mid = (low + k) / 2;
          if (columnHeight(column, mid) > height) k = mid; else low = mid;
        }
        k = low;
      }
      ky = Math.min(ky, k);
    }
    if (!Number.isFinite(ky)) ky = 0;
    for (const node of nodes) node.height = Math.max(node.value * ky, minNodeHeight);
    for (const link of links) link.width = link.value * ky;

    const padFor = column => {
      const used = column.reduce((sum, node) => sum + node.height, 0);
      return column.length > 1 ? Math.max(0, Math.min(nodePadding, (height - used) / (column.length - 1))) : 0;
    };
    const stack = column => {
      const pad = padFor(column);
      const total = column.reduce((sum, node) => sum + node.height, 0) + pad * Math.max(0, column.length - 1);
      let y = Math.max(0, (height - total) / 2);
      for (const node of column) {
        node.y0 = y;
        node.y1 = y + node.height;
        y = node.y1 + pad;
      }
    };
    const center = node => (node.y0 + node.y1) / 2;
    const weighted = (items, pick) => {
      let sum = 0;
      let weight = 0;
      for (const link of items) { sum += pick(link) * link.value; weight += link.value; }
      return weight ? sum / weight : null;
    };
    columns.forEach(stack);

    if (order === 'barycenter') {
      for (let round = 0; round < 2; round++) {
        for (let c = 1; c < columnCount; c++) sortByBarycenter(columns[c], node => weighted(node.targetLinks, link => center(link.source)));
        for (let c = columnCount - 2; c >= 0; c--) sortByBarycenter(columns[c], node => weighted(node.sourceLinks, link => center(link.target)));
        columns.forEach(stack);
      }
    }

    const resolve = column => {
      if (order === 'barycenter') column.sort((a, b) => a.y0 - b.y0);
      const pad = padFor(column);
      let y = 0;
      for (const node of column) {
        if (node.y0 < y) { node.y1 += y - node.y0; node.y0 = y; }
        y = node.y1 + pad;
      }
      y = height;
      for (let i = column.length - 1; i >= 0; i--) {
        const node = column[i];
        if (node.y1 > y) { node.y0 -= node.y1 - y; node.y1 = y; }
        y = node.y0 - pad;
      }
    };
    for (let i = 0; i < iterations; i++) {
      const alpha = Math.pow(0.9, i) * 0.6;
      for (let c = 1; c < columnCount; c++) {
        for (const node of columns[c]) moveToward(node, weighted(node.targetLinks, link => center(link.source)), alpha);
        resolve(columns[c]);
      }
      for (let c = columnCount - 2; c >= 0; c--) {
        for (const node of columns[c]) moveToward(node, weighted(node.sourceLinks, link => center(link.target)), alpha);
        resolve(columns[c]);
      }
    }

    for (const node of nodes) {
      node.sourceLinks.sort((a, b) => a.target.y0 - b.target.y0 || a.target.column - b.target.column);
      node.targetLinks.sort((a, b) => a.source.y0 - b.source.y0 || a.source.column - b.source.column);
      let y = node.y0;
      for (const link of node.sourceLinks) { link.y0 = y + link.width / 2; y += link.width; }
      y = node.y0;
      for (const link of node.targetLinks) { link.y1 = y + link.width / 2; y += link.width; }
    }
    return {nodes, links, columns, ky, width, height};
  }

  function sortByBarycenter(column, score) {
    const scored = column.map((node, index) => ({node, index, value: score(node)}));
    scored.sort((a, b) => {
      if (a.value === null || b.value === null) return a.index - b.index;
      return a.value - b.value || a.index - b.index;
    });
    column.splice(0, column.length, ...scored.map(item => item.node));
  }

  function moveToward(node, target, alpha) {
    if (target === null) return;
    const dy = (target - (node.y0 + node.y1) / 2) * alpha;
    node.y0 += dy;
    node.y1 += dy;
  }

  // A link is a filled ribbon between two cubic curves. A thick stroked curve
  // would bulge past its endpoints when a wide band bends over a short distance.
  function linkPath(link, minWidth = 0) {
    const x0 = link.source.x1;
    const x1 = link.target.x0;
    const xm = (x0 + x1) / 2;
    const half = Math.max(link.width, minWidth) / 2;
    const top0 = link.y0 - half, bottom0 = link.y0 + half;
    const top1 = link.y1 - half, bottom1 = link.y1 + half;
    return 'M' + x0 + ',' + top0 + 'C' + xm + ',' + top0 + ' ' + xm + ',' + top1 + ' ' + x1 + ',' + top1
      + 'L' + x1 + ',' + bottom1 + 'C' + xm + ',' + bottom1 + ' ' + xm + ',' + bottom0 + ' ' + x0 + ',' + bottom0 + 'Z';
  }

  return {layout, linkPath};
});
