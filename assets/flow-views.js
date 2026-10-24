(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlowViews = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const CONFIDENCE = ['disclosed', 'derived', 'estimated'];

  // Builds the graphs the flows page draws. Every view is a column graph whose
  // links only move rightward; flows that cannot be drawn that way (within one
  // group, or against the money order) are returned separately so totals stay honest.
  function createModel(data) {
    const groups = data.groups.map((group, index) => ({...group, index}));
    const groupById = new Map(groups.map(group => [group.id, group]));
    const groupOf = new Map();
    for (const group of groups) {
      for (const name of group.companies) {
        if (groupOf.has(name)) throw new Error('Company is in two groups: ' + name);
        groupOf.set(name, group);
      }
    }
    const flows = data.flows.map((flow, index) => {
      const fromGroup = groupOf.get(flow.from);
      const toGroup = groupOf.get(flow.to);
      if (!fromGroup || !toGroup) throw new Error('Flow references an unknown company: ' + flow.from + ' → ' + flow.to);
      return {...flow, id: index, fromGroup, toGroup};
    });

    const sortKey = name => {
      const group = groupOf.get(name);
      return group.column * 100 + group.index;
    };
    const byGroupThenValue = values => (a, b) => sortKey(a) - sortKey(b) || values.get(b) - values.get(a) || a.localeCompare(b);

    function filter(confidence) {
      const allowed = new Set(confidence);
      return flows.filter(flow => allowed.has(flow.conf));
    }

    function overview(list) {
      const links = new Map();
      const within = new Map();
      const counter = new Map();
      for (const flow of list) {
        const a = flow.fromGroup;
        const b = flow.toGroup;
        if (a === b) add(within, a.id, flow, () => ({group: a}));
        else if (a.column < b.column) add(links, a.id + '>' + b.id, flow, () => ({source: a.id, target: b.id}));
        else add(counter, a.id + '>' + b.id, flow, () => ({from: a, to: b}));
      }
      const used = new Set();
      for (const link of links.values()) { used.add(link.source); used.add(link.target); }
      const nodes = groups.filter(group => used.has(group.id)).map(group => ({
        id: group.id, column: group.column, kind: 'group', group, label: group.tierLabel + ' · ' + group.role,
      }));
      return {
        kind: 'overview',
        nodes: compactColumns(nodes),
        links: [...links.values()],
        within: sortDesc([...within.values()]),
        counter: sortDesc([...counter.values()]),
        flows: list,
        order: 'fixed',
      };
    }

    function pair(list, fromId, toId, {maxPerSide = 22} = {}) {
      const selected = list.filter(flow => flow.fromGroup.id === fromId && flow.toGroup.id === toId);
      const payers = totals(selected, 'from');
      const payees = totals(selected, 'to');
      const keepLeft = keep(payers, maxPerSide);
      const keepRight = keep(payees, maxPerSide);
      const nodes = [
        ...sideNodes('L', payers, keepLeft, 0, 'payers'),
        ...sideNodes('R', payees, keepRight, 1, 'payees'),
      ];
      const links = new Map();
      for (const flow of selected) {
        const source = keepLeft.has(flow.from) ? 'L:' + flow.from : 'L:*';
        const target = keepRight.has(flow.to) ? 'R:' + flow.to : 'R:*';
        add(links, source + '>' + target, flow, () => ({source, target}));
      }
      return {
        kind: 'pair', from: groupById.get(fromId), to: groupById.get(toId),
        nodes: compactColumns(nodes), links: [...links.values()], flows: selected, order: 'barycenter',
      };
    }

    function focus(list, members, {maxPerSide = 18} = {}) {
      const memberSet = new Set(members);
      const inbound = list.filter(flow => memberSet.has(flow.to) && !memberSet.has(flow.from));
      const outbound = list.filter(flow => memberSet.has(flow.from) && !memberSet.has(flow.to));
      const internal = list.filter(flow => memberSet.has(flow.from) && memberSet.has(flow.to));
      const payers = totals(inbound, 'from');
      const payees = totals(outbound, 'to');
      const midIn = totals(inbound, 'to');
      const midOut = totals(outbound, 'from');
      const middle = new Map();
      for (const name of new Set([...midIn.keys(), ...midOut.keys()])) {
        middle.set(name, Math.max(midIn.get(name) || 0, midOut.get(name) || 0));
      }
      const keepLeft = keep(payers, maxPerSide);
      const keepRight = keep(payees, maxPerSide);
      const midColumn = payers.size ? 1 : 0;
      const nodes = [
        ...sideNodes('L', payers, keepLeft, 0, 'payers'),
        ...[...middle.keys()].sort(byGroupThenValue(middle)).map(name => companyNode('M:' + name, name, midColumn)),
        ...sideNodes('R', payees, keepRight, midColumn + 1, 'payees'),
      ];
      const links = new Map();
      for (const flow of inbound) {
        const source = keepLeft.has(flow.from) ? 'L:' + flow.from : 'L:*';
        add(links, source + '>M:' + flow.to, flow, () => ({source, target: 'M:' + flow.to}));
      }
      for (const flow of outbound) {
        const target = keepRight.has(flow.to) ? 'R:' + flow.to : 'R:*';
        add(links, 'M:' + flow.from + '>' + target, flow, () => ({source: 'M:' + flow.from, target}));
      }
      return {
        kind: 'focus', members: [...memberSet], nodes: compactColumns(nodes), links: [...links.values()],
        internal: sortDesc(internal.map(flow => ({flow, value: flow.usd}))).map(item => item.flow),
        flows: [...inbound, ...outbound, ...internal], order: 'fixed',
        totals: {in: sum(inbound), out: sum(outbound), internal: sum(internal)},
      };
    }

    function companyNode(id, name, column) {
      const group = groupOf.get(name);
      return {id, column, kind: 'company', name, group, label: name};
    }

    function sideNodes(prefix, values, kept, column, noun) {
      const names = [...kept].sort(byGroupThenValue(values));
      const nodes = names.map(name => companyNode(prefix + ':' + name, name, column));
      const folded = [...values.keys()].filter(name => !kept.has(name));
      if (folded.length) {
        nodes.push({
          id: prefix + ':*', column, kind: 'other', names: folded,
          label: folded.length + ' other ' + noun,
        });
      }
      return nodes;
    }

    function summarize(list) {
      const byConf = Object.fromEntries(CONFIDENCE.map(conf => [conf, 0]));
      for (const flow of list) byConf[flow.conf] += flow.usd;
      return {total: sum(list), count: list.length, byConf};
    }

    return {groups, groupById, groupOf, flows, filter, overview, pair, focus, summarize};
  }

  function add(map, key, flow, create) {
    let entry = map.get(key);
    if (!entry) { entry = {...create(), value: 0, flows: []}; map.set(key, entry); }
    entry.value += flow.usd;
    entry.flows.push(flow);
  }

  function totals(list, side) {
    const values = new Map();
    for (const flow of list) values.set(flow[side], (values.get(flow[side]) || 0) + flow.usd);
    return values;
  }

  // Keep the largest counterparties; fold the rest when there are more than fit.
  function keep(values, max) {
    const ranked = [...values.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const limit = ranked.length > max ? max - 1 : ranked.length;
    return new Set(ranked.slice(0, limit).map(([name]) => name));
  }

  function compactColumns(nodes) {
    const used = [...new Set(nodes.map(node => node.column))].sort((a, b) => a - b);
    const index = new Map(used.map((column, i) => [column, i]));
    return nodes.map(node => ({...node, column: index.get(node.column)}));
  }

  function sortDesc(items) {
    return items.sort((a, b) => b.value - a.value);
  }

  function sum(list) {
    return list.reduce((total, flow) => total + flow.usd, 0);
  }

  return {CONFIDENCE, createModel};
});
