/* ============================================================
 * Credibe — net.js
 * A small, robust fetch wrapper for a Render free-tier backend.
 *
 * Why this exists:
 *  - Render free-tier sleeps after ~15 min of inactivity.
 *  - The first request after a cold-start can take 30–60 seconds.
 *  - The browser's default fetch has NO timeout, so requests can
 *    hang forever, which looks to the user like "it works sometimes".
 *
 * What this gives you:
 *  - Timeout via AbortController (default 65s — covers cold starts).
 *  - Automatic retry with back-off on network / 5xx / 429 failures.
 *  - Real error objects you can inspect (code: TIMEOUT | NETWORK | HTTP).
 *  - Auto-attaches the JWT from localStorage.userToken if present.
 *
 * Usage:
 *  const r = await apiFetch('/api/user/me');
 *  if (!r.ok) handle(r.error);
 *  else use(r.data);
 * ============================================================ */
(function () {
  'use strict';

  var API_BASE = window.CREDIBE_API_BASE || 'https://credibe-backends.onrender.com';
  var DEFAULT_TIMEOUT = 65000;             // 65 seconds — enough for Render cold start
  var RETRY_DELAYS = [1500, 4000];         // retry schedule in ms

  function getToken() {
    try { return localStorage.getItem('userToken') || null; } catch (_) { return null; }
  }

  function fetchWithTimeout(url, opts, timeoutMs) {
    var ac = new AbortController();
    var timer = setTimeout(function () { ac.abort(); }, timeoutMs);
    return fetch(url, Object.assign({}, opts, { signal: ac.signal }))
      .finally(function () { clearTimeout(timer); });
  }

  async function doCall(url, fetchOpts, timeoutMs) {
    var res;
    try {
      res = await fetchWithTimeout(url, fetchOpts, timeoutMs);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        var te = new Error('The server is taking too long to respond.');
        te.code = 'TIMEOUT';
        throw te;
      }
      var ne = new Error('Network error. Please check your connection.');
      ne.code = 'NETWORK';
      throw ne;
    }

    var text = await res.text();
    var data = null;
    if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }

    if (!res.ok) {
      var he = new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
      he.code = 'HTTP';
      he.status = res.status;
      he.data = data;
      throw he;
    }
    return data;
  }

  /**
   * apiFetch(path, opts)
   *  path     — '/api/...' (relative) or 'https://...' (absolute)
   *  opts     — { method, headers, body, timeoutMs, retry: false }
   * returns  — { ok: true, data } | { ok: false, error, status?, code? }
   */
  window.apiFetch = async function apiFetch(path, opts) {
    opts = opts || {};
    var url = /^https?:/.test(path) ? path : (API_BASE + path);

    var token = getToken();
    var hasJSONBody = opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData);
    var headers = Object.assign(
      { 'Accept': 'application/json' },
      hasJSONBody ? { 'Content-Type': 'application/json' } : {},
      token ? { 'Authorization': 'Bearer ' + token } : {},
      opts.headers || {}
    );

    var fetchOpts = {
      method: opts.method || 'GET',
      headers: headers,
      cache: opts.cache || 'no-store'
    };
    if (opts.body != null) {
      fetchOpts.body = hasJSONBody ? JSON.stringify(opts.body) : opts.body;
    }

    var timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT;
    var shouldRetry = opts.retry !== false;

    var attempts = shouldRetry ? RETRY_DELAYS.length + 1 : 1;
    var lastErr = null;

    for (var i = 0; i < attempts; i++) {
      try {
        var data = await doCall(url, fetchOpts, timeoutMs);
        return { ok: true, data: data };
      } catch (err) {
        lastErr = err;
        // Don't retry user-caused 4xx (except 408 timeout / 429 rate-limit)
        if (err.code === 'HTTP' && err.status >= 400 && err.status < 500 &&
            err.status !== 408 && err.status !== 429) {
          break;
        }
        if (i < attempts - 1) {
          await new Promise(function (r) { setTimeout(r, RETRY_DELAYS[i]); });
        }
      }
    }

    return {
      ok: false,
      error: lastErr,
      code: lastErr && lastErr.code,
      status: lastErr && lastErr.status,
      message: lastErr && lastErr.message
    };
  };

  // Also expose as a namespaced object for convenience
  window.Credibe = window.Credibe || {};
  window.Credibe.apiFetch = window.apiFetch;
  window.Credibe.API_BASE = API_BASE;
})();
