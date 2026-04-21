/* ============================================================
 * Credibe — transactions.js
 * Standalone transactions loader for pages that use a single
 * #transactions-page table (not the full dashboard, which has
 * its own loader inside dashboard.html).
 *
 * Fixes over the previous version:
 *  - Uses window.apiFetch (timeout + retry + real errors)
 *  - Shows a loading skeleton so "sometimes nothing shows up"
 *    is replaced with a clear loading → rendered / loading → error
 *    transition.
 *  - Shows a retry button on error rather than pretending the
 *    account is empty.
 * ============================================================ */

(function () {
  'use strict';

  var tbody = function () {
    return document.querySelector('#transactions-page tbody');
  };

  var filterEl = function () {
    return document.getElementById('transaction-filter');
  };

  function userId() {
    try { return localStorage.getItem('userId') || ''; } catch (_) { return ''; }
  }

  // --- States ---
  function renderLoading() {
    var tb = tbody(); if (!tb) return;
    var row = '<tr><td colspan="4" class="p-3">' +
      '<div style="height:14px;border-radius:6px;background:linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.12) 50%,rgba(255,255,255,.05) 75%);background-size:200% 100%;animation:credibe-shimmer 1.2s infinite"></div>' +
      '</td></tr>';
    tb.innerHTML = row + row + row + row;
    injectShimmer();
  }

  function injectShimmer() {
    if (document.getElementById('credibe-txn-shimmer')) return;
    var s = document.createElement('style');
    s.id = 'credibe-txn-shimmer';
    s.textContent = '@keyframes credibe-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}';
    document.head.appendChild(s);
  }

  function renderEmpty() {
    var tb = tbody(); if (!tb) return;
    tb.innerHTML =
      '<tr><td colspan="4" class="text-center text-sm py-6" style="color:rgba(255,255,255,.55)">' +
        'No transactions yet.' +
      '</td></tr>';
  }

  function renderError(message) {
    var tb = tbody(); if (!tb) return;
    tb.innerHTML =
      '<tr><td colspan="4" class="p-4">' +
        '<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:10px 0">' +
          '<div style="color:#fbbf24;font-size:14px">' + (message || "Couldn't load transactions.") + '</div>' +
          '<button id="txn-retry" style="background:#0ea5e9;color:#fff;border:0;border-radius:10px;padding:8px 14px;font:600 13px system-ui;cursor:pointer">Retry</button>' +
        '</div>' +
      '</td></tr>';
    var btn = document.getElementById('txn-retry');
    if (btn) btn.addEventListener('click', fetchTransactions);
  }

  // --- Filtering ---
  function filterTransactions(list, days) {
    if (days === 'all') return list;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(days, 10));
    return list.filter(function (t) {
      return new Date(t.createdAt || t.date) >= cutoff;
    });
  }

  // --- Render ---
  function renderTransactions(list) {
    var tb = tbody(); if (!tb) return;
    var f = filterEl();
    var days = f ? f.value : 'all';
    var filtered = filterTransactions(list, days);

    if (!filtered.length) { renderEmpty(); return; }

    tb.innerHTML = filtered.map(function (t) {
      var raw = t.createdAt || t.date;
      var d = raw ? new Date(raw).toISOString().split('T')[0] : '—';
      var recipient = t.recipient || t.toEmail || (t.to && t.to.email) || 'N/A';
      var amount = Number(t.amount || 0).toFixed(2);
      var status = (t.status || '').toLowerCase();
      var amountCls = status === 'approved'
        ? (t.type === 'credit' ? 'text-green-500' : 'text-red-500')
        : 'text-yellow-400';
      var badge =
        status === 'approved'
          ? '<span class="bg-green-500/20 text-green-400 px-1 py-0.5 rounded text-xs sm:text-sm">Completed</span>'
          : status === 'rejected'
            ? '<span class="bg-red-500/20 text-red-400 px-1 py-0.5 rounded text-xs sm:text-sm">Rejected</span>'
            : '<span class="bg-yellow-500/20 text-yellow-400 px-1 py-0.5 rounded text-xs sm:text-sm">Pending</span>';

      return '' +
        '<tr class="border-t border-[#444]">' +
          '<td class="p-1 sm:p-2 text-xs sm:text-sm">' + d + '</td>' +
          '<td class="p-1 sm:p-2 text-xs sm:text-sm">' + recipient + '</td>' +
          '<td class="p-1 sm:p-2 text-xs sm:text-sm"><span class="' + amountCls + '">€' + amount + '</span></td>' +
          '<td class="p-1 sm:p-2 text-xs sm:text-sm">' + badge + '</td>' +
        '</tr>';
    }).join('');
  }

  // --- Fetch ---
  async function fetchTransactions() {
    var uid = userId();
    if (!uid) { renderError('Please log in to view transactions.'); return; }

    renderLoading();

    // apiFetch already handles timeout + retry
    if (!window.apiFetch) {
      // Graceful fallback if net.js wasn't loaded
      try {
        var res = await fetch('https://credibe-backends.onrender.com/api/user/transactions/' + uid);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        if (!Array.isArray(data)) throw new Error('Invalid response');
        renderTransactions(data);
      } catch (err) {
        console.error('❌ Transaction fetch error:', err.message);
        renderError();
      }
      return;
    }

    var r = await window.apiFetch('/api/user/transactions/' + uid);
    if (!r.ok) {
      console.error('❌ Transaction fetch error:', r.error && r.error.message);
      var msg =
        r.code === 'TIMEOUT' ? 'Server is slow. Please retry.' :
        r.code === 'NETWORK' ? 'Network error. Check your connection.' :
        "Couldn't load transactions.";
      renderError(msg);
      return;
    }
    if (!Array.isArray(r.data)) { renderError('Invalid response from server.'); return; }
    renderTransactions(r.data);
  }

  // --- Init ---
  document.addEventListener('DOMContentLoaded', function () {
    // Only run if we're on a page that actually has the #transactions-page tbody
    if (!document.querySelector('#transactions-page tbody')) return;

    fetchTransactions();
    var f = filterEl();
    if (f) f.addEventListener('change', function () { renderTransactions(window.__credibe_txns || []); });
  });

  // Re-render on filter change without re-fetching
  // (We do this by stashing the last list on fetch.)
  var origRender = renderTransactions;
  renderTransactions = function (list) { window.__credibe_txns = list; origRender(list); };

  // Expose for debugging
  window.Credibe = window.Credibe || {};
  window.Credibe.fetchTransactions = fetchTransactions;
})();
