/* ============================================================
 * Credibe — login.js
 * Uses window.apiFetch (from net.js) for reliable login that:
 *  - Shows a visible loading spinner on the button
 *  - Swaps label to "Waking the server…" after 3s of waiting
 *  - Retries on transient network errors
 *  - Surfaces real error messages instead of hanging silently
 * ============================================================ */
console.log('login.js loaded successfully');

// ----- Injectable styles for spinner -----
(function ensureSpinKeyframes() {
  if (document.getElementById('credibe-login-kf')) return;
  var s = document.createElement('style');
  s.id = 'credibe-login-kf';
  s.textContent = '@keyframes credibe-spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(s);
})();

// ----- UI helpers -----
function showNotification(message, type) {
  type = type || 'error';
  var colors = { error: '#ef4444', success: '#10b981', info: '#0ea5e9' };
  var bg = colors[type] || colors.error;
  var n = document.createElement('div');
  n.textContent = message;
  n.style.cssText =
    'position:fixed;top:14px;right:14px;background:' + bg +
    ';color:#fff;padding:12px 16px;border-radius:12px;z-index:100001;' +
    'box-shadow:0 14px 30px rgba(0,0,0,.35);' +
    'font:500 14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
    'max-width:360px';
  document.body.appendChild(n);
  setTimeout(function () { n.remove(); }, 4200);
}

function validateForm(username, password) {
  if (!username) { showNotification('Enter your username or email'); return false; }
  if (!password || password.length < 4) { showNotification('Password must be at least 4 characters'); return false; }
  return true;
}

function setButtonLoading(btn, loading, label) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.style.opacity = '0.92';
    btn.style.cursor = 'wait';
    btn.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:9px;justify-content:center;width:100%">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style="animation:credibe-spin 1s linear infinite">' +
          '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" fill="none" stroke-dasharray="14 42" stroke-linecap="round"/>' +
        '</svg>' +
        '<span class="credibe-login-label">' + (label || 'Signing in…') + '</span>' +
      '</span>';
  } else {
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.cursor = '';
    if (btn.dataset.originalHtml) {
      btn.innerHTML = btn.dataset.originalHtml;
      delete btn.dataset.originalHtml;
    }
  }
}

function setLoadingLabel(btn, label) {
  if (!btn) return;
  var span = btn.querySelector('.credibe-login-label');
  if (span) span.textContent = label;
}

// ----- Login submit -----
var form = document.getElementById('login-form');
if (form) {
  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    var username = document.getElementById('username').value.trim();
    var password = document.getElementById('password').value.trim();
    if (!validateForm(username, password)) return;

    var btn = document.getElementById('login-button');
    setButtonLoading(btn, true, 'Signing in…');

    // If the server takes >3s (likely cold start), switch the label
    var slowTimer = setTimeout(function () {
      setLoadingLabel(btn, 'Waking the server, this can take up to a minute…');
    }, 3000);

    // Nudge the backend to wake up in parallel (cheap GET /health)
    if (window.Credibe && typeof window.Credibe.wake === 'function') {
      window.Credibe.wake();
    }

    // Call the real login endpoint via our robust fetcher
    var result;
    if (window.apiFetch) {
      result = await window.apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: username, password: password }
      });
    } else {
      // Fallback if net.js didn't load for some reason
      try {
        var res = await fetch('https://credibe-backends.onrender.com/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: username, password: password })
        });
        var data = {};
        try { data = await res.json(); } catch (_) {}
        result = res.ok ? { ok: true, data: data } : { ok: false, error: { message: data.error || ('HTTP ' + res.status) } };
      } catch (err) {
        result = { ok: false, error: { message: 'Network error', code: 'NETWORK' } };
      }
    }

    clearTimeout(slowTimer);
    setButtonLoading(btn, false);

    if (!result.ok) {
      var err = result.error || {};
      var msg;
      if (err.code === 'TIMEOUT') {
        msg = 'Server took too long to respond. Please try again in a moment.';
      } else if (err.code === 'NETWORK') {
        msg = 'Network error. Check your internet connection and try again.';
      } else if (err.status === 401 || err.status === 404) {
        msg = err.message || 'Invalid credentials';
      } else {
        msg = err.message || 'Login failed';
      }
      showNotification(msg, 'error');
      return;
    }

    var data = result.data || {};

    // ---- BLOCK CHECK ----
    var isBlocked = !!(data && data.user && data.user.isBlocked === true);
    if (isBlocked) {
      localStorage.clear();
      sessionStorage.setItem('blockedEmail', username);
      if (data.user.blockedReason) sessionStorage.setItem('blockedReason', data.user.blockedReason);
      window.location.href = 'blockedd.html';
      return;
    }

    // ---- Normal login flow ----
    if (data.token) {
      localStorage.setItem('userToken', data.token);
      localStorage.setItem('userId', (data.user && data.user._id) || '');
      localStorage.setItem('isBlocked', String(!!(data.user && data.user.isBlocked)));
      localStorage.setItem('lastLogin', new Date().toISOString());

      // Short session demo (5 min)
      var logoutAt = Date.now() + (5 * 60 * 1000);
      localStorage.setItem('logoutAt', String(logoutAt));
      setTimeout(function () {
        alert('Session expired. Please log in again.');
        localStorage.clear();
        window.location.href = 'login.html';
      }, 5 * 60 * 1000);

      var staticLoginInfo = document.getElementById('static-login-info');
      if (staticLoginInfo) staticLoginInfo.remove();

      var fromLoan = sessionStorage.getItem('fromLoan');
      if (fromLoan === 'true') {
        sessionStorage.removeItem('fromLoan');
        window.location.href = 'ineligible.html';
        return;
      }

      window.location.href = 'dashboard.html';
    } else {
      showNotification(data.error || 'Login failed');
    }
  });
}

// ----- Password toggle -----
var togglePassword = document.getElementById('toggle-password');
if (togglePassword) {
  var passwordInput = document.getElementById('password');
  togglePassword.addEventListener('click', function () {
    var isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    togglePassword.textContent = isHidden ? '🙈' : '👁️';
  });
}

// ----- Language switcher (unchanged) -----
var languageSwitcher = document.getElementById('language-switcher');
if (languageSwitcher) {
  var translations = {
    en: { login: 'Sign in', username: 'Username or Email' },
    fr: { login: 'Connexion', username: 'Nom d’utilisateur ou email' }
  };
  var loginButton = document.getElementById('login-button');
  var usernameInput = document.getElementById('username');

  languageSwitcher.addEventListener('change', function (e) {
    var lang = e.target.value;
    if (translations[lang]) {
      loginButton.textContent = translations[lang].login;
      usernameInput.placeholder = translations[lang].username;
    }
  });
}
