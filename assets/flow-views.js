(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlowViews = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const CONFIDENCE = ['disclosed', 'derived', 'estimated'];
  const EPS = 1e-9;

  // Money that enters or leaves a company without a tracked counterparty.
  const OUTSIDE = {
    customers: 'Customers without a tracked flow',
    otherCustomers: 'Other customers (not broken down)',
    reserves: 'Operating loss, funded from reserves',
    ahead: 'Purchases ahead of sales, from cash',
    hiddenIn: 'Tracked flows hidden by the filter',
    internalIn: 'From others in this group',
    notDrawnIn: 'Tracked flows not drawn here',
    hiddenOut: 'Tracked flows hidden by the filter',
    internalOut: 'To others in this group',
    notDrawnOut: 'Tracked flows not drawn here',
    other: 'Other suppliers & production',
    pending: 'Costs and profit (breakdown pending)',
    people: 'People, R&D & overhead',
    profit: 'Operating profit',
  };

  // Builds the graphs the flows page draws. Every view is a column graph whose
  // links only move rightward; flows that cannot be drawn that way (within one
  // group, between groups sharing a column, or against the money order) are
  // returned separately so totals stay honest.
  //
  // Each company also has an account: its revenue, and where that revenue goes
  // (tracked suppliers, other suppliers and production costs, people, profit).
  // Views add it as stubs (overview) or outside nodes (drill-downs), so every
  // company's money in equals its money out.
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
    const accountData = data.accounts || {};
    for (const name of Object.keys(accountData)) {
      if (!groupOf.has(name)) throw new Error('Account for an unknown company: ' + name);
    }
    const trackedIn = totals(flows, 'to');
    const trackedOut = totals(flows, 'from');

    const sortKey = name => {
      const group = groupOf.get(name);
      return group.column * 100 + group.index;
    };
    const byGroupThenValue = values => (a, b) => sortKey(a) - sortKey(b) || values.get(b) - values.get(a) || a.localeCompare(b);

    // Revenue never falls below tracked inflows. Spending beyond revenue is
    // drawn from reserves so both sides of every account balance: an operating
    // loss, or tracked purchases above what the year's costs absorb (inventory,
    // prepayments, equipment). The two causes are kept apart for wording.
    const accountCache = new Map();
    function account(name) {
      if (accountCache.has(name)) return accountCache.get(name);
      const source = accountData[name];
      const tin = trackedIn.get(name) || 0;
      const tout = trackedOut.get(name) || 0;
      const revenue = Math.max(source ? source.revenue : Math.max(tin, tout), tin);
      const people = source && source.people > 0 ? source.people : 0;
      const reported = source && Number.isFinite(source.profit) ? source.profit : 0;
      const profit = Math.max(reported, 0);
      const loss = Math.max(-reported, 0);
      let other = revenue + loss - tout - people - profit;
      const ahead = other < 0 ? -other : 0;
      if (other < 0) other = 0;
      const reserves = loss + ahead;
      // Named outside customers keep their researched amounts: they only shrink
      // when they exceed what is left, and any remainder gets its own row.
      const outsideTotal = revenue - tin;
      const categories = ((source && source.outside) || []).filter(item => item.usd > 0);
      const categoryTotal = categories.reduce((total, item) => total + item.usd, 0);
      const shrink = categoryTotal > outsideTotal ? Math.max(outsideTotal, 0) / categoryTotal : 1;
      const outside = outsideTotal <= EPS ? [] : categories.map(item => ({label: item.label, usd: item.usd * shrink}));
      const rest = outsideTotal - categoryTotal * shrink;
      if (outsideTotal > EPS && rest > EPS) outside.push({label: categories.length ? OUTSIDE.otherCustomers : OUTSIDE.customers, usd: rest});
      const otherLabel = (source && source.otherLabel) || OUTSIDE.other;
      const result = {
        name, known: !!source, revenue, people, profit, loss, ahead, reserves, other, outside, outsideTotal,
        otherLabel, pending: /breakdown pending/i.test(otherLabel),
        trackedIn: tin, trackedOut: tout,
        inTotal: revenue + reserves, outTotal: tout + people + profit + other,
        scope: source && source.scope, period: source && source.period, total: source && source.total,
        conf: source && source.conf, basis: source && source.basis, sources: (source && source.sources) || [],
      };
      accountCache.set(name, result);
      return result;
    }

    function filter(confidence) {
      const allowed = new Set(confidence);
      return flows.filter(flow => allowed.has(flow.conf));
    }

    function overview(list) {
      const links = new Map();
      const within = new Map();
      const lateral = new Map();
      const counter = new Map();
      for (const flow of list) {
        const a = flow.fromGroup;
        const b = flow.toGroup;
        if (a === b) add(within, a.id, flow, () => ({group: a}));
        else if (a.column < b.column) add(links, a.id + '>' + b.id, flow, () => ({source: a.id, target: b.id}));
        else if (a.column === b.column) add(lateral, a.id + '>' + b.id, flow, () => ({from: a, to: b}));
        else add(counter, a.id + '>' + b.id, flow, () => ({from: a, to: b}));
      }
      const listedIn = totals(list.map(flow => ({...flow, group: flow.toGroup.id})), 'group');
      const listedOut = totals(list.map(flow => ({...flow, group: flow.fromGroup.id})), 'group');
      const drawnIn = new Map();
      const drawnOut = new Map();
      for (const link of links.values()) {
        drawnOut.set(link.source, (drawnOut.get(link.source) || 0) + link.value);
        drawnIn.set(link.target, (drawnIn.get(link.target) || 0) + link.value);
      }
      const nodes = [];
      for (const group of groups) {
        const accounts = group.companies.map(account);
        const sumOf = key => accounts.reduce((total, item) => total + item[key], 0);
        const inDrawn = drawnIn.get(group.id) || 0;
        const outDrawn = drawnOut.get(group.id) || 0;
        const inTotal = sumOf('inTotal');
        const outTotal = sumOf('outTotal');
        if (inTotal <= EPS && outTotal <= EPS && !inDrawn && !outDrawn) continue;
        const inListed = listedIn.get(group.id) || 0;
        const outListed = listedOut.get(group.id) || 0;
        const stubIn = [
          {key: 'customers', label: OUTSIDE.customers, usd: sumOf('outsideTotal')},
          {key: 'reserves', label: OUTSIDE.reserves, usd: sumOf('loss')},
          {key: 'ahead', label: OUTSIDE.ahead, usd: sumOf('ahead')},
          {key: 'hidden', label: OUTSIDE.hiddenIn, usd: Math.max(0, sumOf('trackedIn') - inListed)},
          {key: 'notDrawn', label: OUTSIDE.notDrawnIn, usd: Math.max(0, inListed - inDrawn)},
        ].filter(item => item.usd > EPS);
        const otherLabels = accounts.filter(item => item.other > EPS && !item.pending).map(item => item.otherLabel);
        const pendingLabels = accounts.filter(item => item.other > EPS && item.pending).map(item => item.otherLabel);
        const otherOf = pending => accounts.filter(item => item.pending === pending).reduce((total, item) => total + item.other, 0);
        const stubOut = [
          {key: 'hidden', label: OUTSIDE.hiddenOut, usd: Math.max(0, sumOf('trackedOut') - outListed)},
          {key: 'notDrawn', label: OUTSIDE.notDrawnOut, usd: Math.max(0, outListed - outDrawn)},
          {key: 'other', label: sharedLabel(otherLabels), usd: otherOf(false)},
          {key: 'pending', label: sharedLabel(pendingLabels, OUTSIDE.pending), usd: otherOf(true)},
          {key: 'people', label: OUTSIDE.people, usd: sumOf('people')},
          {key: 'profit', label: OUTSIDE.profit, usd: sumOf('profit')},
        ].filter(item => item.usd > EPS);
        nodes.push({
          id: group.id, column: group.column, kind: 'group', group, label: group.tierLabel + ' · ' + group.role,
          revenue: sumOf('revenue'), stubIn, stubOut,
          extraIn: stubIn.reduce((total, item) => total + item.usd, 0),
          extraOut: stubOut.reduce((total, item) => total + item.usd, 0),
        });
      }
      return {
        kind: 'overview',
        nodes: compactColumns(nodes),
        links: [...links.values()],
        within: sortDesc([...within.values()]),
        lateral: sortDesc([...lateral.values()]),
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

    // outer 'company' shows each counterparty; outer 'group' collapses
    // counterparties into their tier groups so a whole tier stays readable.
    // With accounts (the default), outside customers and the company's costs
    // and profit appear as nodes, so each member's in and out equal its revenue.
    function focus(list, members, {maxPerSide = 18, outer = 'company', accounts = true} = {}) {
      const memberSet = new Set(members);
      const inbound = list.filter(flow => memberSet.has(flow.to) && !memberSet.has(flow.from));
      const outbound = list.filter(flow => memberSet.has(flow.from) && !memberSet.has(flow.to));
      const internal = list.filter(flow => memberSet.has(flow.from) && memberSet.has(flow.to));
      const midIn = totals(inbound, 'to');
      const midOut = totals(outbound, 'from');
      const middle = new Map();
      for (const name of new Set([...midIn.keys(), ...midOut.keys()])) {
        middle.set(name, Math.max(midIn.get(name) || 0, midOut.get(name) || 0));
      }
      if (accounts) {
        for (const name of memberSet) {
          const item = account(name);
          if (item.inTotal > EPS || item.outTotal > EPS) middle.set(name, Math.max(middle.get(name) || 0, item.inTotal));
        }
      }
      const left = [];
      const right = [];
      const links = new Map();
      if (outer === 'group') {
        const leftGroups = new Set(inbound.map(flow => flow.fromGroup));
        const rightGroups = new Set(outbound.map(flow => flow.toGroup));
        const sideGroup = (side, group) => ({
          id: side + ':' + group.id, kind: 'groupSide', side, group, label: group.tierLabel + ' · ' + group.role,
        });
        left.push(...groups.filter(group => leftGroups.has(group)).map(group => sideGroup('L', group)));
        right.push(...groups.filter(group => rightGroups.has(group)).map(group => sideGroup('R', group)));
        for (const flow of inbound) {
          const source = 'L:' + flow.fromGroup.id;
          add(links, source + '>M:' + flow.to, flow, () => ({source, target: 'M:' + flow.to}));
        }
        for (const flow of outbound) {
          const target = 'R:' + flow.toGroup.id;
          add(links, 'M:' + flow.from + '>' + target, flow, () => ({source: 'M:' + flow.from, target}));
        }
      } else {
        const payers = totals(inbound, 'from');
        const payees = totals(outbound, 'to');
        const keepLeft = keep(payers, maxPerSide);
        const keepRight = keep(payees, maxPerSide);
        left.push(...sideNodes('L', payers, keepLeft, 0, 'payers'));
        right.push(...sideNodes('R', payees, keepRight, 0, 'payees'));
        for (const flow of inbound) {
          const source = keepLeft.has(flow.from) ? 'L:' + flow.from : 'L:*';
          add(links, source + '>M:' + flow.to, flow, () => ({source, target: 'M:' + flow.to}));
        }
        for (const flow of outbound) {
          const target = keepRight.has(flow.to) ? 'R:' + flow.to : 'R:*';
          add(links, 'M:' + flow.from + '>' + target, flow, () => ({source: 'M:' + flow.from, target}));
        }
      }

      const summary = {revenue: 0, trackedIn: 0, trackedOut: 0, outsideTotal: 0, loss: 0, ahead: 0, reserves: 0, people: 0, profit: 0, other: 0, pendingOther: 0};
      if (accounts) {
        const outsideIn = new Map();
        const outsideOut = new Map();
        const toOutside = (map, key, label, role, name, usd, side) => {
          if (!(usd > EPS)) return;
          if (!map.has(key)) map.set(key, {id: 'X' + side + ':' + key, kind: 'outside', role, side, label});
          const id = map.get(key).id;
          const linkKey = side === 'L' ? id + '>M:' + name : 'M:' + name + '>' + id;
          const entry = links.get(linkKey) || {source: side === 'L' ? id : 'M:' + name, target: side === 'L' ? 'M:' + name : id, value: 0, flows: [], outside: role};
          entry.value += usd;
          links.set(linkKey, entry);
        };
        const sumFor = (items, side, name) => items.filter(flow => flow[side] === name).reduce((total, flow) => total + flow.usd, 0);
        const otherLabels = new Set();
        const pendingLabels = new Set();
        for (const name of [...middle.keys()]) {
          const item = account(name);
          for (const key of Object.keys(summary)) summary[key] += key === 'pendingOther' ? (item.pending ? item.other : 0) : item[key];
          if (outer === 'group') toOutside(outsideIn, 'customers', OUTSIDE.customers, 'customers', name, item.outsideTotal, 'L');
          else for (const category of item.outside) toOutside(outsideIn, 'in:' + category.label, category.label, 'customers', name, category.usd, 'L');
          toOutside(outsideIn, 'reserves', OUTSIDE.reserves, 'reserves', name, item.loss, 'L');
          toOutside(outsideIn, 'ahead', OUTSIDE.ahead, 'ahead', name, item.ahead, 'L');
          const internalIn = sumFor(internal, 'to', name);
          const internalOut = sumFor(internal, 'from', name);
          toOutside(outsideIn, 'internalIn', OUTSIDE.internalIn, 'internal', name, internalIn, 'L');
          toOutside(outsideIn, 'hiddenIn', OUTSIDE.hiddenIn, 'hidden', name, item.trackedIn - (midIn.get(name) || 0) - internalIn, 'L');
          toOutside(outsideOut, 'hiddenOut', OUTSIDE.hiddenOut, 'hidden', name, item.trackedOut - (midOut.get(name) || 0) - internalOut, 'R');
          toOutside(outsideOut, 'internalOut', OUTSIDE.internalOut, 'internal', name, internalOut, 'R');
          const otherRole = item.pending ? 'pending' : 'other';
          toOutside(outsideOut, otherRole, item.otherLabel, otherRole, name, item.other, 'R');
          if (item.other > EPS) (item.pending ? pendingLabels : otherLabels).add(item.otherLabel);
          toOutside(outsideOut, 'people', OUTSIDE.people, 'people', name, item.people, 'R');
          toOutside(outsideOut, 'profit', OUTSIDE.profit, 'profit', name, item.profit, 'R');
        }
        if (otherLabels.size > 1 && outsideOut.has('other')) outsideOut.get('other').label = OUTSIDE.other;
        if (pendingLabels.size > 1 && outsideOut.has('pending')) outsideOut.get('pending').label = OUTSIDE.pending;
        left.push(...outsideIn.values());
        right.push(...outsideOut.values());
      }

      const midColumn = left.length ? 1 : 0;
      const nodes = [
        ...left.map(node => ({...node, column: 0})),
        ...[...middle.keys()].sort(byGroupThenValue(middle)).map(name => companyNode('M:' + name, name, midColumn)),
        ...right.map(node => ({...node, column: midColumn + 1})),
      ];
      return {
        kind: 'focus', members: [...memberSet], nodes: compactColumns(nodes), links: [...links.values()],
        internal: sortDesc(internal.map(flow => ({flow, value: flow.usd}))).map(item => item.flow),
        flows: [...inbound, ...outbound, ...internal], order: 'fixed',
        totals: {in: sum(inbound), out: sum(outbound), internal: sum(internal)},
        account: accounts ? summary : null,
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

    return {groups, groupById, groupOf, flows, account, filter, overview, pair, focus, summarize};
  }

  // One label when every company uses the same wording for its other costs.
  function sharedLabel(labels, fallback = OUTSIDE.other) {
    return labels.length && labels.every(label => label === labels[0]) ? labels[0] : fallback;
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

  return {CONFIDENCE, OUTSIDE, createModel};
});
