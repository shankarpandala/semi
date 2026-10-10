(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarketPrices = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  // Explicit listings prevent an ambiguous ticker from resolving to another company.
  // Yahoo suffixes are retained as the dashboard's company identifiers.
  const symbols = Object.create(null);
  const listings = [
    ['', 'NASDAQ', 'AAPL AEIS AMAT AMD AMKR AMZN ARM ASML AVGO CDNS CEVA ENTG GFS GOOGL ICHR INTC KLAC LIN LRCX MKSI MRVL MSFT MU NVDA QCOM RMBS SMCI SNPS TER TSEM UCTT'],
    ['', 'NYSE', 'APD ASX AVTR KEYS TSM UMC'],
    ['.DE', 'XETR', 'BAS MRK WAF WCH'],
    ['.PA', 'EURONEXT', 'AI'],
    ['.AS', 'EURONEXT', 'ASM'],
    ['.BR', 'EURONEXT', 'SOLB'],
    ['.SW', 'SIX', 'COTN VACN'],
    ['.VI', 'VIE', 'ATS'],
    ['.T', 'TSE', '2802 3436 4004 4043 4062 4063 4091 4109 4186 4901 5333 6361 6525 6856 6857 6947 6971 7731 7735 7751 8035'],
    ['.TW', 'TWSE', '2317 2356 2382 2408 2449 2454 3037 3189 3231 3532 4958 6239 8046 8150'],
    ['.TWO', 'TPEX', '6147 6488'],
    ['.KS', 'KRX', '000660 005930 009150 456040'],
    ['.KQ', 'KRX', '005290 033640 036540 067310'],
    ['.SZ', 'SZSE', '002156 002185 002371 002916'],
    ['.SS', 'SSE', '600584 688012'],
    ['.HK', 'HKEX', '0981 1347'],
  ];
  for (const [suffix, exchange, tickers] of listings) {
    for (const ticker of tickers.split(' ')) {
      const localTicker = exchange === 'HKEX' ? String(Number(ticker)) : ticker;
      symbols[ticker + suffix] = exchange + ':' + localTicker;
    }
  }
  // MosChip's listing is on BSE; its legacy dashboard identifier used .NS.
  symbols['MOSCHIP.NS'] = 'BSE:MOSCHIP';

  function tradingViewSymbol(ticker) {
    if (typeof ticker !== 'string') return null;
    return symbols[ticker.trim().toUpperCase()] || null;
  }

  function createPanel({host, status, retry, link}) {
    const doc = host.ownerDocument;
    const view = doc.defaultView;
    let currentCompany = null;
    let generation = 0;
    let timer = null;
    let observer = null;
    let script = null;
    let frameListeners = [];

    function stopWatching() {
      if (timer !== null) view.clearTimeout(timer);
      timer = null;
      if (observer) observer.disconnect();
      observer = null;
      if (script) {
        script.onload = null;
        script.onerror = null;
      }
      for (const [frame, loaded, failed] of frameListeners) {
        frame.removeEventListener('load', loaded);
        frame.removeEventListener('error', failed);
      }
      frameListeners = [];
    }

    function clear() {
      generation += 1;
      stopWatching();
      script = null;
      host.replaceChildren();
      retry.hidden = true;
      link.hidden = true;
      link.removeAttribute('href');
      status.textContent = '';
    }

    function show(company) {
      clear();
      currentCompany = company;
      const symbol = company && company.status !== 'private'
        ? tradingViewSymbol(company.ticker) : null;
      if (!symbol) {
        status.textContent = 'No supported public listing for this company.';
        return;
      }

      const request = generation;
      let finished = false;
      const url = 'https://www.tradingview.com/symbols/' + symbol.replace(':', '-') + '/';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.hidden = false;
      status.textContent = 'Opening TradingView prices…';

      const container = doc.createElement('div');
      container.className = 'tradingview-widget-container';
      const widget = doc.createElement('div');
      widget.className = 'tradingview-widget-container__widget';
      const copyright = doc.createElement('div');
      copyright.className = 'tradingview-widget-copyright';
      const attribution = doc.createElement('a');
      attribution.href = url;
      attribution.target = '_blank';
      attribution.rel = 'noopener noreferrer';
      attribution.textContent = company.name + ' on TradingView';
      copyright.append(attribution);
      container.append(widget, copyright);

      function fail() {
        if (request !== generation || finished) return;
        finished = true;
        stopWatching();
        host.replaceChildren();
        status.textContent = 'The price panel could not open. Retry or open the listing on TradingView.';
        retry.hidden = false;
      }

      function watchFrames() {
        if (request !== generation || finished) return;
        for (const frame of container.querySelectorAll('iframe')) {
          if (frameListeners.some(([existing]) => existing === frame)) continue;
          frame.title = company.name + ' share price on TradingView';
          const loaded = function () {
            if (request !== generation || finished) return;
            finished = true;
            stopWatching();
            // Cross-origin frames cannot expose quote availability to this page.
            status.textContent = 'TradingView prices may be delayed. If unavailable, open the listing on TradingView.';
          };
          frame.addEventListener('load', loaded);
          frame.addEventListener('error', fail);
          frameListeners.push([frame, loaded, fail]);
        }
      }

      observer = new view.MutationObserver(watchFrames);
      observer.observe(container, {childList: true, subtree: true});
      timer = view.setTimeout(fail, 15000);
      script = doc.createElement('script');
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-info.js';
      script.async = true;
      script.textContent = JSON.stringify({
        symbol,
        width: '100%',
        locale: 'en',
        colorTheme: 'dark',
        isTransparent: true,
      });
      script.onerror = fail;
      script.onload = watchFrames;
      container.append(script);
      host.append(container);
    }

    function hide() {
      currentCompany = null;
      clear();
    }

    retry.addEventListener('click', function () {
      if (currentCompany) show(currentCompany);
    });

    return {show, hide};
  }

  return {tradingViewSymbol, createPanel};
});
