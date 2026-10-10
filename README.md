# The Silicon Spectrum

A browser-based dashboard of 119 companies across the semiconductor supply chain.

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

Set `SEMI_BASE_URL` to use a different server and `CHROMIUM_PATH` to override
`/usr/bin/chromium`. Browser tests use explicit synthetic provider responses to
verify calculations, currency conversion, loading, errors, retries, and
navigation. They do not establish real provider availability. Verify actual
prices separately in a browser.

## Deployment

GitHub Actions publishes static assets to GitHub Pages when configured branches
are pushed or the workflow is run manually. It does not fetch or precompute
market data. Visitors fetch and calculate their own values when opening the site.
