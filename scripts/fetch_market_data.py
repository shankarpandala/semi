#!/usr/bin/env python3
"""Fetch live share prices and market caps from Yahoo Finance for every
ticker referenced in index.html, convert market caps to USD using live FX
rates, and write market-data.json for the page to consume.

Run by the GitHub Actions deploy workflow before publishing to Pages.
"""
import datetime
import json
import pathlib
import re
import time

import yfinance as yf

ROOT = pathlib.Path(__file__).resolve().parent.parent

html = (ROOT / "index.html").read_text(encoding="utf-8")
tickers = sorted(set(re.findall(r"ticker:'([^']+)'", html)))
print(f"found {len(tickers)} tickers in index.html")

quotes = {}
currencies = set()
for sym in tickers:
    try:
        fi = yf.Ticker(sym).fast_info
        price = fi.last_price
        cur = fi.currency
        cap = fi.market_cap
        if price is None or cur is None:
            raise ValueError("no price/currency in response")
        # LSE quotes come back in pence
        if cur == "GBp":
            price = price / 100.0
            cap = cap / 100.0 if cap is not None else None
            cur = "GBP"
        quotes[sym] = {
            "price": round(float(price), 2),
            "currency": cur,
            "cap": float(cap) if cap is not None else None,
        }
        currencies.add(cur)
    except Exception as e:  # noqa: BLE001 - tolerate any per-ticker failure
        print(f"WARN {sym}: {e}")
    time.sleep(0.25)

rates = {"USD": 1.0}
for cur in sorted(currencies - {"USD"}):
    try:
        rates[cur] = float(yf.Ticker(f"{cur}USD=X").fast_info.last_price)
    except Exception as e:  # noqa: BLE001
        print(f"WARN FX {cur}: {e}")

data = {
    "updated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "quotes": {},
}
for sym, q in quotes.items():
    rate = rates.get(q["currency"])
    cap_usd = None
    if q["cap"] is not None and rate is not None:
        cap_usd = round(q["cap"] * rate / 1e9, 2)  # USD billions
    data["quotes"][sym] = {
        "price": q["price"],
        "currency": q["currency"],
        "capUSD": cap_usd,
    }

out = ROOT / "market-data.json"
out.write_text(json.dumps(data, indent=1), encoding="utf-8")
print(f"wrote {out.name}: {len(data['quotes'])}/{len(tickers)} quotes, {len(rates)} FX rates")

# If most quotes failed, fail the workflow so the previous (good) deploy stays live.
if len(data["quotes"]) < len(tickers) * 0.5:
    raise SystemExit("too many quote failures; aborting so the last good data stays published")
