// Reads the dashboard's inline TIERS list, the source of truth for the roster.
const fs = require('node:fs');
const path = require('node:path');

function dashboardTiers() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('const TIERS = [');
  const end = html.indexOf('\n];', start) + 3;
  if (start < 0 || end < 3) throw new Error('index.html has no TIERS list');
  return new Function(html.slice(start, end) + '\nreturn TIERS;')();
}

const tiers = dashboardTiers();
const companies = tiers.flatMap(tier => tier.companies);
const listed = companies.filter(company => company.ticker && company.status !== 'private');

module.exports = {tiers, companies, listed};
