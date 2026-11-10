// Day and night themes. Loaded in <head> so the saved choice applies before the
// page paints. Without a saved choice the page follows the system setting.
(function () {
  'use strict';
  const KEY = 'semi-theme';
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  const saved = () => { try { return localStorage.getItem(KEY); } catch (error) { return null; } };
  const system = () => (media && media.matches ? 'light' : 'dark');
  const current = () => root.dataset.theme;

  function apply(theme) {
    if (theme === current()) return;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelectorAll('.theme-toggle').forEach(label);
    document.dispatchEvent(new CustomEvent('themechange', {detail: {theme}}));
  }

  function label(button) {
    const night = current() === 'dark';
    button.setAttribute('aria-pressed', String(!night));
    button.setAttribute('aria-label', night ? 'Switch to day mode' : 'Switch to night mode');
    button.title = button.getAttribute('aria-label');
    button.querySelector('.theme-icon').textContent = night ? '☀' : '☾';
    button.querySelector('.theme-text').textContent = night ? 'Day' : 'Night';
  }

  apply(saved() === 'light' || saved() === 'dark' ? saved() : system());
  if (media) {
    const follow = () => { if (!saved()) apply(system()); };
    if (media.addEventListener) media.addEventListener('change', follow);
    else if (media.addListener) media.addListener(follow);
  }

  // Adds the switch to every element marked data-theme-slot once the page is parsed.
  function mount() {
    document.querySelectorAll('[data-theme-slot]').forEach(slot => {
      if (slot.querySelector('.theme-toggle')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-toggle';
      button.innerHTML = '<span class="theme-icon" aria-hidden="true"></span><span class="theme-text"></span>';
      button.addEventListener('click', () => {
        const next = current() === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(KEY, next); } catch (error) { /* private mode: the choice lasts this page only */ }
        apply(next);
      });
      label(button);
      slot.append(button);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  window.SemiTheme = {current, apply};
})();
