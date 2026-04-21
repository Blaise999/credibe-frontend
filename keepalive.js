/* ============================================================
 * Credibe — keepalive.js
 * Warms the Render free-tier backend on page load and every 5 min.
 *
 * Render sleeps the service after ~15 min of inactivity, which
 * makes the first real request hang for 30–60 seconds.
 *
 * This script:
 *  1. Pings /health immediately when the page loads.
 *  2. Pings /health every 5 min while the tab is visible.
 *  3. Re-pings when the user returns to the tab (visibilitychange).
 *  4. Shows a tiny "Waking up server…" toast only if the wake
 *     actually takes more than 2.5s (so users on a warm server
 *     never see it).
 *
 *  Include on every page:  <script defer src="keepalive.js"></script>
 * ============================================================ */
(function () {
  'use strict';

  var API_BASE = window.CREDIBE_API_BASE || 'https://credibe-backends.onrender.com';
  var PING_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
  var TOAST_DELAY_MS   = 2500;            // show toast only if wake takes longer than this

  var activeWake = null;
  var toastEl = null;
  var toastTimer = null;

  function injectStyles() {
    if (document.getElementById('credibe-ka-styles')) return;
    var s = document.createElement('style');
    s.id = 'credibe-ka-styles';
    s.textContent =
      '@keyframes credibe-ka-spin{to{transform:rotate(360deg)}}' +
      '@keyframes credibe-ka-in{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}';
    document.head.appendChild(s);
  }

  function showToast() {
    if (toastEl || !document.body) return;
    injectStyles();
    toastEl = document.createElement('div');
    toastEl.setAttribute('role', 'status');
    toastEl.style.cssText = [
      'position:fixed', 'top:16px', 'left:50%',
      'background:rgba(17,24,38,.96)', '-webkit-backdrop-filter:blur(12px)', 'backdrop-filter:blur(12px)',
      'color:#dfefff', 'padding:9px 16px', 'border-radius:999px',
      'z-index:100000', 'font:500 13px/1 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'border:1px solid rgba(120,190,255,.22)',
      'box-shadow:0 14px 32px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.02) inset',
      'display:flex', 'align-items:center', 'gap:9px',
      'animation:credibe-ka-in .22s ease-out'
    ].join(';');
    toastEl.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style="animation:credibe-ka-spin 1s linear infinite;color:#6ac8ff">' +
        '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" fill="none" stroke-dasharray="14 42" stroke-linecap="round"/>' +
      '</svg>' +
      '<span>Waking up server…</span>';
    document.body.appendChild(toastEl);
  }

  function hideToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (toastEl) {
      var el = toastEl;
      toastEl = null;
      el.style.transition = 'opacity .25s ease, transform .25s ease';
      el.style.opacity = '0';
      el.style.transform = 'translate(-50%,-8px)';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }
  }

  function pingOnce(timeoutMs) {
    timeoutMs = timeoutMs || 70000;
    var ac = new AbortController();
    var t = setTimeout(function () { ac.abort(); }, timeoutMs);
    return fetch(API_BASE + '/health', { method: 'GET', signal: ac.signal, cache: 'no-store' })
      .then(function (res) { clearTimeout(t); return !!(res && res.ok); })
      .catch(function () { clearTimeout(t); return false; });
  }

  function wake() {
    if (activeWake) return activeWake;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(showToast, TOAST_DELAY_MS);

    activeWake = pingOnce().finally(function () {
      hideToast();
      activeWake = null;
    });
    return activeWake;
  }

  // Initial wake — fires as soon as the script loads, not at DOMContentLoaded,
  // so the server starts warming up during the rest of the page parse.
  wake();

  // Regular heartbeat while the tab is visible
  setInterval(function () {
    if (!document.hidden) pingOnce(15000);
  }, PING_INTERVAL_MS);

  // Re-wake when the user comes back to the tab
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) wake();
  });

  // Public API
  window.Credibe = window.Credibe || {};
  window.Credibe.wake = wake;
})();
