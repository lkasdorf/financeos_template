// FinanceOS Setup Wizard frontend (Block C.3b).
// Six-step wizard mirroring scripts/setup.py --interactive. Calls the three
// /api/setup/* endpoints exposed by serve.py. No framework, no dependencies.

'use strict';

const TOTAL_STEPS = 7;

// Default reports config — mirrors window.REPORTS_CONFIG defaults in
// dashboard/core.js. Used when the user picks "Use defaults" on step 6 or
// skips the wizard entirely. The same defaults live in
// scripts/config_loader.py so the server fallback matches.
const DEFAULT_REPORTS_CONFIG = {
  dining_out:    { categories: ['Food:Dining out'] },
  ai_costs:      { match: 'prefix', categories: ['Subscriptions:AI'] },
  vice_spending: { categories: ['Leisure:Alcohol', 'Leisure:Smoking', 'Leisure:Vaping'] },
  bank_fees:     { match: 'prefix', categories: ['Fees:'] },
  cash_discrepancy: {
    expense_categories: ['Other Expenses:Cash Discrepancy'],
    income_categories:  ['Income:Cash Discrepancy'],
  },
  bills: {
    buckets: {
      rent:        { categories: ['Bills:Rent'] },
      electricity: { categories: ['Bills:Electricity'] },
      water:       { categories: ['Bills:Water'] },
      internet:    { categories: ['Bills:Internet'] },
    },
  },
  automobile: {
    buckets: {
      purchase:     { categories: ['Automobile:Purchase'] },
      petrol:       { categories: ['Automobile:Petrol'] },
      maintenance:  { categories: ['Automobile:Maintenance'] },
      toll:         { categories: ['Automobile:Toll'] },
      parking:      { categories: ['Automobile:Parking'] },
      insurance:    { categories: ['Automobile:Insurance'] },
      registration: { categories: ['Automobile:Registration'] },
      accessories:  { categories: ['Automobile:Accessories'] },
      car_rental:   { categories: ['Automobile:Car Rental'] },
      other:        { categories: ['Automobile'] },
    },
  },
  discretionary_fixed: {
    fixed_prefixes: ['Rent', 'Bills:', 'Subscriptions:', 'Insurance:', 'Fees:'],
  },
};

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
    reports_mode: 'defaults', // 'defaults' | 'customize'
    reports_config: null,     // populated on Next from step 6 if customize
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
  bindStep7();

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

  if (n === 6) renderReportsStep();
  if (n === 7) renderReview();
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
  if (n === 6) {
    const mode = (document.querySelector('input[name="reports-mode"]:checked') || {}).value || 'defaults';
    state.config.reports_mode = mode;
    if (mode === 'customize') {
      state.config.reports_config = collectReportsStepForm();
    } else {
      state.config.reports_config = null; // server falls back to defaults
    }
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

// ── Step 6: report → category mapping ────────────────────────────────────

function bindStep6() {
  // Toggle the customize panel based on the radio choice. The actual form
  // body is rendered by renderReportsStep() each time the step is shown
  // (so it picks up the latest categories from staging on MMEX flow).
  document.querySelectorAll('input[name="reports-mode"]').forEach(r => {
    r.addEventListener('change', () => {
      const mode = document.querySelector('input[name="reports-mode"]:checked').value;
      document.getElementById('reports-step-form').hidden = (mode !== 'customize');
    });
  });
}

// Categories visible to the wizard. Empty start: hard-coded canonical set
// (mirror of EMPTY_SEED_CATEGORIES in scripts/setup_core.py). MMEX import:
// the categories[] from the staging payload.
const EMPTY_START_CATEGORIES = [
  'Income', 'Income:Salary', 'Income:Bonus', 'Income:Investments', 'Income:Other',
  'Bills', 'Bills:Electricity', 'Bills:Internet', 'Bills:Phone', 'Bills:Rent', 'Bills:Water',
  'Food', 'Food:Groceries', 'Food:Dining out',
  'Transport', 'Transport:Fuel', 'Transport:Public transit', 'Transport:Taxi',
  'Healthcare', 'Healthcare:Doctor', 'Healthcare:Pharmacy',
  'Leisure', 'Leisure:Entertainment', 'Leisure:Sports',
  'Subscriptions', 'Subscriptions:Streaming', 'Subscriptions:Software',
  'Travel', 'Travel:Flights', 'Travel:Accommodation',
  'Fees', 'Fees:Bank Fees', 'Fees:ATM',
  'Other Expenses',
];

function reportsWizardCategories() {
  if (state.config.datasource === 'mmex' && state.staging?.categories?.length) {
    return [...new Set(state.staging.categories.map(c => c.path || c.name).filter(Boolean))].sort();
  }
  return [...EMPTY_START_CATEGORIES].sort();
}

const REPORTS_STEP_SECTIONS = [
  { key: 'dining_out',    title: 'Dining Out',         shape: 'flat' },
  { key: 'ai_costs',      title: 'AI Costs',           shape: 'flat', mode: 'prefix' },
  { key: 'vice_spending', title: 'Vice Spending',      shape: 'flat' },
  { key: 'bank_fees',     title: 'Bank Fees',          shape: 'flat', mode: 'prefix' },
  { key: 'cash_discrepancy', title: 'Cash Discrepancy', shape: 'cd_split' },
  {
    key: 'bills', title: 'Bills Overview', shape: 'buckets',
    buckets: [
      { id: 'rent', label: 'Rent' }, { id: 'electricity', label: 'Electricity' },
      { id: 'water', label: 'Water' }, { id: 'internet', label: 'Internet' },
    ],
  },
  {
    key: 'automobile', title: 'Automobile Costs', shape: 'buckets',
    buckets: [
      { id: 'purchase', label: 'Purchase' }, { id: 'petrol', label: 'Petrol / Fuel' },
      { id: 'maintenance', label: 'Maintenance' }, { id: 'toll', label: 'Toll' },
      { id: 'parking', label: 'Parking' }, { id: 'insurance', label: 'Insurance' },
      { id: 'registration', label: 'Registration' }, { id: 'accessories', label: 'Accessories' },
      { id: 'car_rental', label: 'Car Rental' }, { id: 'other', label: 'Other' },
    ],
  },
  { key: 'discretionary_fixed', title: 'Discretionary vs. Fixed', shape: 'prefixes' },
];

function renderReportsStep() {
  const wrap = document.getElementById('reports-step-sections');
  if (!wrap) return;
  const cats = reportsWizardCategories();
  const cfg = state.config.reports_config || DEFAULT_REPORTS_CONFIG;
  const optionsHtml = (selected) => {
    const sel = new Set(selected || []);
    return cats.map(c => `<option value="${escapeHtml(c)}"${sel.has(c) ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
  };
  const html = REPORTS_STEP_SECTIONS.map(sec => {
    const node = cfg[sec.key] || {};
    if (sec.shape === 'flat') {
      const cur = node.categories || [];
      return `
        <div class="setup-card-block" data-section="${sec.key}">
          <div style="font-weight:600;">${escapeHtml(sec.title)}</div>
          <select multiple size="4" name="${sec.key}.categories" style="width:100%;padding:6px;margin-top:4px;">${optionsHtml(cur)}</select>
        </div>`;
    }
    if (sec.shape === 'buckets') {
      const buckets = node.buckets || {};
      const inner = sec.buckets.map(b => {
        const cur = (buckets[b.id] && buckets[b.id].categories) || [];
        return `
          <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;align-items:start;margin-bottom:6px;">
            <div style="padding-top:4px;font-weight:500;">${escapeHtml(b.label)}</div>
            <select multiple size="3" name="${sec.key}.${b.id}.categories" style="width:100%;padding:4px;">${optionsHtml(cur)}</select>
          </div>`;
      }).join('');
      return `
        <div class="setup-card-block" data-section="${sec.key}" data-shape="buckets">
          <div style="font-weight:600;margin-bottom:6px;">${escapeHtml(sec.title)}</div>
          ${inner}
        </div>`;
    }
    if (sec.shape === 'cd_split') {
      const exp = node.expense_categories || [];
      const inc = node.income_categories || [];
      return `
        <div class="setup-card-block" data-section="${sec.key}" data-shape="cd_split">
          <div style="font-weight:600;margin-bottom:6px;">${escapeHtml(sec.title)}</div>
          <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;margin-bottom:6px;">
            <div style="padding-top:4px;">Expense side</div>
            <select multiple size="3" name="${sec.key}.expense" style="width:100%;padding:4px;">${optionsHtml(exp)}</select>
          </div>
          <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;">
            <div style="padding-top:4px;">Income side</div>
            <select multiple size="3" name="${sec.key}.income" style="width:100%;padding:4px;">${optionsHtml(inc)}</select>
          </div>
        </div>`;
    }
    if (sec.shape === 'prefixes') {
      const prefixes = node.fixed_prefixes || [];
      return `
        <div class="setup-card-block" data-section="${sec.key}" data-shape="prefixes">
          <div style="font-weight:600;margin-bottom:6px;">${escapeHtml(sec.title)}</div>
          <textarea name="${sec.key}.fixed_prefixes" rows="5" style="width:100%;padding:6px;font-family:monospace;font-size:13px;">${escapeHtml(prefixes.join('\n'))}</textarea>
        </div>`;
    }
    return '';
  }).join('');
  wrap.innerHTML = html;
  // Reflect current radio selection in form visibility.
  const mode = (document.querySelector('input[name="reports-mode"]:checked') || {}).value || 'defaults';
  document.getElementById('reports-step-form').hidden = (mode !== 'customize');
}

function collectReportsStepForm() {
  const out = {};
  for (const sec of REPORTS_STEP_SECTIONS) {
    const root = document.querySelector(`[data-section="${sec.key}"]`);
    if (!root) continue;
    if (sec.shape === 'flat') {
      const sel = root.querySelector('select');
      const cats = sel ? Array.from(sel.selectedOptions).map(o => o.value) : [];
      out[sec.key] = { categories: cats };
      if (sec.mode) out[sec.key].match = sec.mode;
    } else if (sec.shape === 'buckets') {
      const buckets = {};
      for (const b of sec.buckets) {
        const sel = root.querySelector(`select[name="${sec.key}.${b.id}.categories"]`);
        buckets[b.id] = { categories: sel ? Array.from(sel.selectedOptions).map(o => o.value) : [] };
      }
      out[sec.key] = { buckets };
    } else if (sec.shape === 'cd_split') {
      const expSel = root.querySelector(`select[name="${sec.key}.expense"]`);
      const incSel = root.querySelector(`select[name="${sec.key}.income"]`);
      out[sec.key] = {
        expense_categories: expSel ? Array.from(expSel.selectedOptions).map(o => o.value) : [],
        income_categories:  incSel ? Array.from(incSel.selectedOptions).map(o => o.value) : [],
      };
    } else if (sec.shape === 'prefixes') {
      const ta = root.querySelector('textarea');
      const lines = (ta?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
      out[sec.key] = { fixed_prefixes: lines };
    }
  }
  return out;
}

// ── Step 7: review + alias overrides ─────────────────────────────────────

function bindStep7() {
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
      // MMEX staging payload uses currency_code; older paths used currency.
      const cur = acc.currency_code || acc.currency || '—';
      tr.innerHTML = `
        <td>${escapeHtml(acc.name)}</td>
        <td>${escapeHtml(cur)}</td>
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
