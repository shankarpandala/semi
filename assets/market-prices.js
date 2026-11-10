(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarketPrices = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  // The roster identifies each listing by the provider's own symbol, written
  // EXCHANGE:CODE (for example NASDAQ:NVDA, TSE:8035, KRX:000660). Only that
  // shape is accepted, so nothing else can reach the request or the widget URL.
  const SYMBOL = /^[A-Z][A-Z0-9_]{1,14}:[A-Z0-9][A-Z0-9._&-]{0,19}$/;

  function tradingViewSymbol(ticker) {
    if (typeof ticker !== 'string') return null;
    const symbol = ticker.trim().toUpperCase();
    return SYMBOL.test(symbol) ? symbol : null;
  }

  // Listing page for a symbol: /symbols/EXCHANGE-CODE/.
  function listingUrl(symbol) {
    const split = symbol.indexOf(':');
    return 'https://www.tradingview.com/symbols/' + encodeURIComponent(symbol.slice(0, split)) + '-'
      + encodeURIComponent(symbol.slice(split + 1)) + '/';
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
      const url = listingUrl(symbol);
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

  return {tradingViewSymbol, listingUrl, createPanel};
});
