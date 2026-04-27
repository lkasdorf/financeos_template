// FinanceOS Setup Wizard frontend (Block C.3b).
// Six-step wizard mirroring scripts/setup.py --interactive. Calls the three
// /api/setup/* endpoints exposed by serve.py. No framework, no dependencies.

'use strict';

const TOTAL_STEPS = 6;

const state = {
  step: 1,
  config: {
    brand: { display_name: '', accent_color: '#1e40af' },
    currency: 'EUR',
    auth_mode: 'basic',
    auth_user: '',
    auth_password: '',
    datasource: 'empty',
    features: {
      debt_tracking: false,
      metals: false,
      pwa: false,
      crdb_recon: false,
      quick_expenses: true,
      custom_reports: true,
      scheduled_tx: true,
    },
  },
  staging: null, // { id, summary, accounts, warnings, filename }
};

// ── Boot ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  bindStepNav();
  bindStep1();
  bindStep2();
  bindStep3();
  bindStep4();
  bindStep5();
  bindStep6();

  // Setup-status gate: refuse to mount the wizard if the repo is initialized.
  try {
    const resp = await fetch('/api/setup/status', { method: 'POST' });
    const status = await resp.json();
    document.getElementById('setup-version').textContent = 'v' + (status.wizard_version || '—');

    if (status.initialized || status.has_data) {
      const reason = status.initialized
        ? 'data/.setup_state.json marks this instance as already initialized.'
        : 'data/transactions.csv contains live data — running setup again would overwrite it.';
      document.getElementById('blocked-reason').textContent = reason;
      document.getElementById('blocked-card').hidden = false;
      // Hide every step + actions while blocked
      document.querySelectorAll('.setup-step').forEach(s => s.hidden = true);
      document.querySelector('.setup-actions').hidden = true;
      document.getElementById('stepper').hidden = true;
      return;
    }

    // Pre-fill default currency from server hint
    if (status.default_currency) {
      state.config.currency = status.default_currency;
      document.getElementById('currency-input').value = status.default_currency;
      highlightCurrencyPick(status.default_currency);
    }
  } catch (e) {
    console.warn('Status probe failed; continuing in offline mode.', e);
    document.getElementById('setup-version').textContent = 'v—';
  }

  showStep(1);
});

// ── Step navigation ──────────────────────────────────────────────────────

function bindStepNav() {
  document.getElementById('btn-back').addEventListener('click', () => goto(state.step - 1));
  document.getElementById('btn-next').addEventListener('click', () => {
    if (!validateStep(state.step)) return;
    goto(state.step + 1);
  });
  document.getElementById('btn-finish').addEventListener('click', finalize);
}

function goto(target) {
  if (target < 1 || target > TOTAL_STEPS) return;
  state.step = target;
  showStep(target);
}

function showStep(n) {
  document.querySelectorAll('.setup-step').forEach(s => {
    s.hidden = parseInt(s.dataset.step, 10) !== n;
  });
  document.querySelectorAll('#stepper li').forEach(li => {
    const sn = parseInt(li.dataset.step, 10);
    li.classList.toggle('active', sn === n);
    li.classList.toggle('done', sn < n);
  });

  document.getElementById('btn-back').disabled = (n === 1);
  document.getElementById('btn-next').hidden = (n === TOTAL_STEPS);
  document.getElementById('btn-finish').hidden = (n !== TOTAL_STEPS);

  if (n === 6) renderReview();
}

function validateStep(n) {
  if (n === 1) {
    const name = document.getElementById('brand-name').value.trim();
    if (!name) { alert('Please enter a display name.'); return false; }
    state.config.brand.display_name = name;
    state.config.brand.accent_color = document.getElementById('brand-color-hex').value.trim();
    return true;
  }
  if (n === 2) {
    const cur = document.getElementById('currency-input').value.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) { alert('Currency must be a 3-letter ISO code.'); return false; }
    state.config.currency = cur;
    return true;
  }
  if (n === 3) {
    const mode = document.querySelector('input[name="auth-mode"]:checked').value;
    state.config.auth_mode = mode;
    if (mode === 'basic') {
      const user = document.getElementById('auth-user').value.trim();
      const p1 = document.getElementById('auth-pass').value;
      const p2 = document.getElementById('auth-pass2').value;
      if (!user) { alert('Please enter a username.'); return false; }
      if (p1.length < 8) { alert('Password must be at least 8 characters.'); return false; }
      if (p1 !== p2) { alert('Passwords do not match.'); return false; }
      state.config.auth_user = user;
      state.config.auth_password = p1;
    } else {
      if (!document.getElementById('auth-none-confirm').checked) {
        alert('Please confirm you understand the risk of running without authentication.');
        return false;
      }
      state.config.auth_user = '';
      state.config.auth_password = '';
    }
    return true;
  }
  if (n === 4) {
    const ds = document.querySelector('input[name="datasource"]:checked').value;
    state.config.datasource = ds;
    if (ds === 'mmex' && !state.staging) {
      alert('Please upload an .mmb file before continuing.');
      return false;
    }
    return true;
  }
  if (n === 5) {
    document.querySelectorAll('#features-list input[type="checkbox"]').forEach(cb => {
      state.config.features[cb.dataset.feature] = cb.checked;
    });
    return true;
  }
  return true;
}

// ── Step 1: brand ────────────────────────────────────────────────────────

function bindStep1() {
  const color = document.getElementById('brand-color');
  const hex = document.getElementById('brand-color-hex');
  color.addEventListener('input', () => { hex.value = color.value; });
  hex.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) color.value = hex.value;
  });
}

// ── Step 2: currency ─────────────────────────────────────────────────────

function bindStep2() {
  const input = document.getElementById('currency-input');
  document.querySelectorAll('#currency-picks button').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.cur;
      highlightCurrencyPick(btn.dataset.cur);
    });
  });
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase();
    highlightCurrencyPick(input.value);
  });
}

function highlightCurrencyPick(cur) {
  document.querySelectorAll('#currency-picks button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cur === cur);
  });
}

// ── Step 3: auth ─────────────────────────────────────────────────────────

function bindStep3() {
  document.querySelectorAll('input[name="auth-mode"]').forEach(r => {
    r.addEventListener('change', () => {
      const mode = document.querySelector('input[name="auth-mode"]:checked').value;
      document.getElementById('auth-basic-fields').hidden = (mode !== 'basic');
      document.getElementById('auth-none-warning').hidden = (mode !== 'none');
    });
  });
}

// ── Step 4: datasource + MMEX upload ─────────────────────────────────────

function bindStep4() {
  document.querySelectorAll('input[name="datasource"]').forEach(r => {
    r.addEventListener('change', () => {
      const ds = document.querySelector('input[name="datasource"]:checked').value;
      document.getElementById('mmex-zone').hidden = (ds !== 'mmex');
    });
  });

  const fileInput = document.getElementById('mmex-file');
  const uploadBtn = document.getElementById('mmex-upload-btn');
  fileInput.addEventListener('change', () => {
    uploadBtn.disabled = !fileInput.files || fileInput.files.length === 0;
    state.staging = null;
    document.getElementById('mmex-summary').hidden = true;
    document.getElementById('mmex-status').textContent = '';
  });
  uploadBtn.addEventListener('click', uploadMmex);
}

async function uploadMmex() {
  const file = document.getElementById('mmex-file').files[0];
  if (!file) return;
  const status = document.getElementById('mmex-status');
  const btn = document.getElementById('mmex-upload-btn');
  btn.disabled = true;
  status.textContent = 'Reading file…';

  try {
    const buf = await file.arrayBuffer();
    const b64 = arrayBufferToBase64(buf);
    status.textContent = 'Uploading & parsing…';
    const resp = await fetch('/api/setup/mmex-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, content_b64: b64 }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      status.textContent = 'Error: ' + (data.error || resp.status);
      return;
    }
    state.staging = {
      id: data.staging_id,
      summary: data.summary,
      accounts: data.accounts || [],
      warnings: data.warnings || [],
      filename: data.filename,
    };
    status.textContent = `Parsed ${file.name} successfully.`;
    renderMmexSummary(data.summary, data.warnings || []);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

function arrayBufferToBase64(buf) {
  // Chunk to keep us off the call-stack limit on large files.
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function renderMmexSummary(summary, warnings) {
  const list = document.getElementById('mmex-summary-list');
  list.innerHTML = '';
  const items = [
    ['Accounts', summary.accounts],
    ['Categories', summary.categories],
    ['Payees', summary.payees],
    ['Tags', summary.tags],
    ['Transactions', summary.transactions],
  ];
  for (const [label, val] of items) {
    const li = document.createElement('li');
    li.innerHTML = `<b>${val ?? 0}</b><span>${label}</span>`;
    list.appendChild(li);
  }
  if (warnings.length) {
    const li = document.createElement('li');
    li.style.gridColumn = '1 / -1';
    li.style.background = 'rgba(245, 158, 11, 0.08)';
    li.innerHTML = `<b>${warnings.length}</b><span>warnings — first: ${escapeHtml(warnings[0])}</span>`;
    list.appendChild(li);
  }
  document.getElementById('mmex-summary').hidden = false;
}

// ── Step 5: features ─────────────────────────────────────────────────────

function bindStep5() {
  // Nothing to wire — values read on validateStep(5).
}

// ── Step 6: review + alias overrides ─────────────────────────────────────

function bindStep6() {
  // No bindings here; renderReview() runs each time the step is shown.
}

function renderReview() {
  document.getElementById('rv-brand').textContent =
    `${state.config.brand.display_name} (accent ${state.config.brand.accent_color})`;
  document.getElementById('rv-currency').textContent = state.config.currency;
  document.getElementById('rv-auth').textContent =
    state.config.auth_mode === 'basic'
      ? `basic — user "${state.config.auth_user}", bcrypt-hashed password`
      : 'none (no authentication)';
  document.getElementById('rv-datasource').textContent =
    state.config.datasource === 'mmex'
      ? `MMEX import (${state.staging?.summary?.transactions ?? 0} TX from ${state.staging?.filename ?? 'upload'})`
      : 'Empty start (4 accounts, 34 categories)';
  const enabled = Object.entries(state.config.features).filter(([, v]) => v).map(([k]) => k);
  document.getElementById('rv-features').textContent = enabled.length ? enabled.join(', ') : '(none enabled)';

  const aliasZone = document.getElementById('alias-override-zone');
  const tbody = document.querySelector('#alias-table tbody');
  tbody.innerHTML = '';
  if (state.config.datasource === 'mmex' && state.staging?.accounts?.length) {
    aliasZone.hidden = false;
    for (const acc of state.staging.accounts) {
      const tr = document.createElement('tr');
      const slug = autoSlug(acc.name);
      tr.innerHTML = `
        <td>${escapeHtml(acc.name)}</td>
        <td>${escapeHtml(acc.currency || '—')}</td>
        <td><input type="text" data-acc-id="${acc.id}" placeholder="${slug}" pattern="[a-z0-9_]+" maxlength="40"></td>
      `;
      tbody.appendChild(tr);
    }
  } else {
    aliasZone.hidden = true;
  }
}

function autoSlug(name) {
  return (name || 'account')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'account';
}

// ── Finalize ─────────────────────────────────────────────────────────────

async function finalize() {
  const finishBtn = document.getElementById('btn-finish');
  const backBtn = document.getElementById('btn-back');
  const status = document.getElementById('finalize-status');

  finishBtn.disabled = true;
  backBtn.disabled = true;
  status.hidden = false;
  status.className = 'setup-status info';
  status.textContent = 'Writing setup files…';

  // Read alias overrides (key = mmex account id as string)
  const overrides = {};
  document.querySelectorAll('#alias-table input').forEach(inp => {
    const v = inp.value.trim().toLowerCase();
    if (v) overrides[inp.dataset.accId] = v;
  });

  // Build the request payload — strip empty optional features to keep it clean
  const cfg = JSON.parse(JSON.stringify(state.config));
  const body = {
    config: cfg,
    staging_id: state.staging?.id || '',
    account_alias_overrides: overrides,
  };

  try {
    const resp = await fetch('/api/setup/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) {
      status.className = 'setup-status error';
      status.textContent = 'Setup failed: ' + (data.error || resp.status) + (data.hint ? ` (${data.hint})` : '');
      finishBtn.disabled = false;
      backBtn.disabled = false;
      return;
    }
    const counts = data.counts || {};
    status.className = 'setup-status success';
    status.textContent = `Done. Wrote ${counts.accounts || 0} accounts, ${counts.categories || 0} categories, ${counts.transactions || 0} transactions. Redirecting to dashboard…`;
    setTimeout(() => { window.location.href = 'index.html'; }, 1400);
  } catch (e) {
    status.className = 'setup-status error';
    status.textContent = 'Network error: ' + e.message;
    finishBtn.disabled = false;
    backBtn.disabled = false;
  }
}

// ── Utils ────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
