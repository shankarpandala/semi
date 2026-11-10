#!/usr/bin/env node
// Audits the dashboard roster against the market-data provider.
//
//   node scripts/audit-roster.mjs            (behind a proxy: NODE_USE_ENV_PROXY=1 node ...)
//
// 1. Listings. Every symbol on the roster must resolve at the provider. A
//    listing with a price but no market cap yet (a company that listed days
//    ago) is reported as a notice: the page shows it as unavailable until
//    the provider has a value.
// 2. Coverage. Every primary listing the provider files under its
//    Semiconductors or Electronic Production Equipment industries must either
//    be on the roster or be listed, with a reason, in roster-exclusions.tsv.
//    A new listing therefore shows up here as "unreviewed" until someone
//    places it in a tier or rules it out.
//
// The provider's industry labels are broad (they include solar, displays and
// passive components) and miss companies filed elsewhere (equipment under
// machinery, materials under chemicals), so this check is a floor for
// coverage, not a definition of the roster.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = 'https://scanner.tradingview.com/global/scan';
const INDUSTRIES = ['Semiconductors', 'Electronic Production Equipment'];

function roster() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const start = html.indexOf('const TIERS = [');
  const end = html.indexOf('\n];', start) + 3;
  const tiers = new Function(html.slice(start, end) + '\nreturn TIERS;')();
  return tiers.flatMap(tier => tier.companies.map(company => ({...company, tier: tier.label})));
}

function exclusions() {
  const rows = new Map();
  const file = path.join(root, 'scripts', 'roster-exclusions.tsv');
  for (const line of fs.readFileSync(file, 'utf8').split('\n').slice(1)) {
    if (!line.trim()) continue;
    const [symbol, name, reason] = line.split('\t');
    rows.set(symbol, {name, reason});
  }
  return rows;
}

async function scan(body) {
  const response = await fetch(SCAN, {method: 'POST', body: JSON.stringify(body)});
  if (!response.ok) throw new Error('Provider request failed (HTTP ' + response.status + ').');
  const json = await response.json();
  if (!json || !Array.isArray(json.data)) throw new Error('Unexpected provider response.');
  return json.data;
}

const companies = roster();
const listed = companies.filter(company => company.ticker && company.status !== 'private');
const excluded = exclusions();
const problems = [];

// 1. Listings
const quotes = new Map((await scan({
  symbols: {tickers: listed.map(company => company.ticker), query: {types: []}},
  columns: ['description', 'market_cap_basic', 'is_primary', 'close'],
})).map(row => [row.s, row.d]));
const unvalued = [];
for (const company of listed) {
  const quote = quotes.get(company.ticker);
  if (!quote) problems.push('not found at the provider: ' + company.ticker + ' ' + company.name + ' (' + company.tier + ')');
  else if (!(quote[1] > 0) && quote[3] > 0) unvalued.push(company);
  else if (!(quote[1] > 0)) problems.push('no price or market cap: ' + company.ticker + ' ' + company.name);
}
const secondary = listed.filter(company => quotes.get(company.ticker)?.[2] === false);

// 2. Coverage
const onRoster = new Set(listed.map(company => company.ticker));
const unreviewed = [];
for (const industry of INDUSTRIES) {
  const rows = await scan({
    filter: [
      {left: 'industry', operation: 'equal', right: industry},
      {left: 'is_primary', operation: 'equal', right: true},
      {left: 'type', operation: 'in_range', right: ['stock', 'dr']},
    ],
    columns: ['description', 'market_cap_basic', 'country'],
    sort: {sortBy: 'market_cap_basic', sortOrder: 'desc'},
    range: [0, 5000],
  });
  for (const row of rows) {
    if (onRoster.has(row.s) || excluded.has(row.s)) continue;
    const millions = Math.round((row.d[1] || 0) / 1e6);
    unreviewed.push([row.s, row.d[0], row.d[2], industry, 'USD ' + millions + 'M'].join('\t'));
  }
}
for (const symbol of excluded.keys()) {
  if (onRoster.has(symbol)) problems.push('on the roster and in roster-exclusions.tsv: ' + symbol);
}

console.log(companies.length + ' companies on the roster, ' + listed.length + ' listed; ' + quotes.size + ' resolved at the provider.');
console.log(excluded.size + ' listings ruled out in scripts/roster-exclusions.tsv.');
if (secondary.length) {
  console.log('\n' + secondary.length + ' roster listings are not the company’s primary line (kept deliberately, for example US ADRs):');
  for (const company of secondary) console.log('  ' + company.ticker + '  ' + company.name);
}
if (unvalued.length) {
  console.log('\n' + unvalued.length + ' roster listings have a price but no market cap at the provider yet:');
  for (const company of unvalued) console.log('  ' + company.ticker + '  ' + company.name);
}
if (unreviewed.length) {
  console.log('\n' + unreviewed.length + ' provider listings are neither on the roster nor ruled out:');
  for (const line of unreviewed) console.log('  ' + line);
}
if (problems.length) {
  console.log('\n' + problems.length + ' problems:');
  for (const line of problems) console.log('  ' + line);
}
if (!unreviewed.length && !problems.length) console.log('\nRoster and provider agree: every listing resolves and nothing is unreviewed.');
process.exitCode = unreviewed.length || problems.length ? 1 : 0;
