# The Silicon Spectrum

A browser-based dashboard of 119 companies across the semiconductor supply chain.

Open the live portal at **https://www.pandala.in/semi/**. A downloaded copy of
`index.html` alone is incomplete: the files in `assets/` are also required to
load market data. Use the deployed portal, or serve the complete repository.

## Money flows

`flows.html` is a Sankey chart of who pays whom across the chain. Bands run from
the customer who pays to the supplier who is paid, in USD billions for calendar
2025 (or the fiscal year that mostly overlaps it).

- The overview groups companies by tier. Tiers 10, 8, 7 and 0–1 are split by role
  because each contains a customer–supplier step of its own.
- Select a tier to see its companies, a band to see the company-to-company flows
  behind it, or search for a company to follow all of its money. Views are
  deep-linkable (`#group=t6`, `#from=t9&to=t6`, `#co=TSMC`), and each company card
  on the dashboard links to its flows.
- Flows within one group, or running against the chain (for example Samsung's
  phone business buying Snapdragon chips), are listed below the chart rather than
  drawn.

Every company's bands add up to its 2025 revenue. Coloured bands are payments
between the 119 companies; grey shows money from customers without a tracked
flow (mostly companies outside the 119) and
where the rest of each company's revenue goes (other suppliers and production,
people and R&D, operating profit). An operating loss is shown as money drawn
from reserves; tracked purchases above what a profitable company's costs
absorbed that year (inventory, prepayments, equipment) are shown as purchases
from cash. For Apple, Microsoft, Amazon and Alphabet only the hardware part
counts: the others' purchases of servers, networking and chips, and Apple's
device sales plus the $75B Foxconn pays Apple for the components Apple buys and
resells to it (Apple's gross payment to Foxconn includes those parts).
Most companies with large non-chip businesses count only their chip-related
segment; a few are shown whole because their other businesses trade with
tracked companies (Samsung Electronics, Samsung Electro-Mechanics, Tata
Electronics and board makers such as Zhen Ding).
Where a company publishes no cost breakdown, the rest of its revenue is shown as
one amount marked "breakdown pending".

The figures in `assets/flows-data.js` are static research estimates. Each flow
records what is bought, the amount, a confidence level (`disclosed`, `derived`
or `estimated`), the calculation behind it and its sources; each company
account records its revenue scope, costs, profit, outside customers and
sources. Bands are gross payments, so the same dollar can appear in several
tiers. Market caps on the flows page are fetched live from TradingView by the
visitor's browser, as on the dashboard, and are never drawn as bands. They value
the whole company, while the revenue shown may be only its chip-related part.

## Run locally

Serve the repository with Python's standard library:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

No backend or API key is required. The site requests market data when the page
opens and when **Refresh market data** is selected.

## Market data and calculations

Each visitor's browser sends a batch request for the 101 listed companies to
TradingView's public screener endpoint. It then fetches any required exchange
rates. Prices, market caps, rankings, tier totals, tier percentages, and the
combined total are calculated from that request. There are no embedded market
valuations, cached quote files, or fixed exchange rates.

Prices and valuations are shown in USD. Share-price currency and financial
currency are handled separately; they can differ. A `USD/XXX` exchange rate
means XXX units per USD, so a native value is divided by that rate. Market caps
are converted to USD billions. Unknown currencies or missing rates leave the
affected value unavailable; they are never assumed to be USD.

Totals include only available market caps and show coverage out of 101 listed
companies. Private companies and business units have no standalone public
valuation. An unsuccessful refresh clears previous values and shows
**Unavailable**. A company's share price can be available even if its market
cap is missing, and vice versa.

**Fetched** is the time this visit retrieved usable data, not an exchange trade
timestamp. Quotes can be delayed or reflect the latest market close. The public
screener is an undocumented service and can change, rate-limit, or reject a
browser request. The site reports missing data instead of substituting old
figures. Company drawers also provide an optional TradingView listing widget
and link.

The scanner request deliberately uses a plain string body with no custom
headers. Setting `Content-Type: application/json` triggers a CORS preflight
that this endpoint does not support. Requests use normal browser CORS checks,
omit credentials, and go directly to TradingView; there is no relay or proxy
operated by this project.

Network destinations include `scanner.tradingview.com` for calculations and
TradingView's widget hosts for optional listing panels. Cloud environment
network rules affect cloud testing; deployed visitors use their own network.

## Tests

```sh
node --test tests/*.test.cjs
```

With the local server running, the integration checks use Playwright and Chromium:

```sh
node tests/browser-smoke.cjs
```

The flows page has its own browser checks:

```sh
node tests/flows-smoke.cjs
```

Set `SEMI_BASE_URL` to use a different server and `CHROMIUM_PATH` to override
`/usr/bin/chromium`. Browser tests use explicit synthetic provider responses to
verify calculations, currency conversion, loading, errors, retries, and
navigation. They do not establish real provider availability. Verify actual
prices separately in a browser.

## Deployment

GitHub Actions publishes static assets to GitHub Pages when configured branches
are pushed or the workflow is run manually. It does not fetch or precompute
market data. Visitors fetch and calculate their own values when opening the site.
