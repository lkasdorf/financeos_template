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
  income_sources: {
    buckets: {
      salary:            { categories: [] },
      interest:          { categories: ['Income:Interest'] },
      dividends:         { categories: ['Income:Dividends'] },
      investments_sales: { categories: ['Income:Investments', 'Income:Sales'] },
      reimbursement:     { categories: ['Income:Reimbursement'] },
      refunds:           { categories: ['Income:Refund'] },
    },
  },
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
  // Curated FinanceOS account-type vocabulary, populated by /api/setup/status
  // on boot. Used by the Type dropdown in the alias-table review step.
  // Fallback list keeps the wizard usable if the status fetch fails.
  account_types: [
    { key: 'cash', label: 'Cash' }, { key: 'bank', label: 'Bank account' },
    { key: 'savings', label: 'Savings' }, { key: 'credit', label: 'Credit card' },
    { key: 'loan', label: 'Loan' }, { key: 'mobile_money', label: 'Mobile money' },
    { key: 'brokerage', label: 'Brokerage' }, { key: 'pass_through', label: 'Pass-through' },
    { key: 'custody', label: 'Custody' }, { key: 'other', label: 'Other' },
  ],
};

// ── Boot ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  bindLocalePicker();
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

    // Curated account-type list for the alias-table dropdown in step 7.
    if (Array.isArray(status.account_types) && status.account_types.length) {
      state.account_types = status.account_types;
    }
  } catch (e) {
    console.warn('Status probe failed; continuing in offline mode.', e);
    document.getElementById('setup-version').textContent = 'v—';
  }

  showStep(1);
});

// ── Locale picker ────────────────────────────────────────────────────────
// Loads the chosen locale's strings via i18n.js (loadLocale) and walks the
// DOM via applyI18n() to translate every [data-i18n] node. Selection
// persists to localStorage as `lp-locale` so the post-setup dashboard
// boots in the same language.

async function bindLocalePicker() {
  const sel = document.getElementById('setup-locale');
  if (!sel) return;
  const stored = localStorage.getItem('lp-locale');
  if (stored) sel.value = stored;
  // Initial paint — load the stored locale (or default 'en') and walk the DOM.
  if (typeof loadLocale === 'function') {
    try { await loadLocale(sel.value); } catch { /* fall back to baked-in EN */ }
  }
  if (typeof applyI18n === 'function') applyI18n(document);
  sel.addEventListener('change', async () => {
    localStorage.setItem('lp-locale', sel.value);
    if (typeof loadLocale === 'function') {
      try { await loadLocale(sel.value); } catch { return; }
    }
    if (typeof applyI18n === 'function') applyI18n(document);
  });
}

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
      // categories was added to the upload response in rc.3 so the
      // step-6 mapping form can show the user's actual MMEX category
      // names instead of falling back to the empty-start canonical
      // set. Server side ships {id, name, path} per entry.
      categories: data.categories || [],
      warnings: data.warnings || [],
      filename: data.filename,
    };
    // Diagnostic: surface in browser DevTools so users can verify the
    // upload response actually carried categories. If the count is 0
    // here the bug is server-side; if non-zero but step 6 falls back,
    // it's frontend.
    console.log('[setup] MMEX upload OK —',
      'accounts:', state.staging.accounts.length,
      'categories:', state.staging.categories.length,
      'tx:', state.staging.summary?.transactions);
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
    li.style.background = 'color-mix(in srgb, var(--warn) 8%, transparent)';
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

// Union of every category source we know about so the user always sees
// something to pick from, even if MMEX category parsing failed or the
// staging payload didn't include them. Canonical-default categories
// (Income:Salary, Bills:Rent, etc.) act as a safety net so the new
// wizard step never lands a user on an empty dropdown.
function reportsWizardCategories() {
  const set = new Set();
  // 1. MMEX staging — first-class source when datasource=mmex
  if (state.config.datasource === 'mmex' && Array.isArray(state.staging?.categories)) {
    for (const c of state.staging.categories) {
      const v = c?.path || c?.name;
      if (v) set.add(v);
    }
  }
  // 2. Empty-start canonical (always included as a safety net)
  for (const c of EMPTY_START_CATEGORIES) set.add(c);
  // 3. Default bucket categories — guarantees the bucket-mapping
  //    work even if the user is on an MMEX import where the staging
  //    payload happened to drop them.
  const cfg = DEFAULT_REPORTS_CONFIG;
  for (const k of Object.keys(cfg)) {
    const node = cfg[k];
    if (Array.isArray(node?.categories)) node.categories.forEach(v => set.add(v));
    if (Array.isArray(node?.expense_categories)) node.expense_categories.forEach(v => set.add(v));
    if (Array.isArray(node?.income_categories)) node.income_categories.forEach(v => set.add(v));
    if (node?.buckets) {
      for (const b of Object.values(node.buckets)) {
        if (Array.isArray(b?.categories)) b.categories.forEach(v => set.add(v));
      }
    }
  }
  // Strip empty + sort.
  return [...set].filter(Boolean).sort();
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
  {
    key: 'income_sources', title: 'Income Sources Breakdown', shape: 'buckets',
    buckets: [
      { id: 'salary', label: 'Salary' }, { id: 'interest', label: 'Interest' },
      { id: 'dividends', label: 'Dividends' },
      { id: 'investments_sales', label: 'Investments & Sales' },
      { id: 'reimbursement', label: 'Reimbursement' }, { id: 'refunds', label: 'Refunds' },
    ],
  },
];

// User-typed extra categories from the textarea on step 6. Merged into
// the dropdown options so users can always pick whatever they need,
// even if MMEX category parsing returned nothing.
const _extraStepCats = new Set();
// Live filter string from the step-6 filter input. Empty = show all.
let _stepCatsFilter = '';

function renderReportsStep() {
  const wrap = document.getElementById('reports-step-sections');
  if (!wrap) return;
  // Wire the filter input + "Add to options" textarea once.
  const filterInp = document.getElementById('reports-step-filter');
  if (filterInp && !filterInp.dataset.bound) {
    filterInp.dataset.bound = '1';
    filterInp.addEventListener('input', () => {
      _stepCatsFilter = filterInp.value || '';
      renderReportsStep();
    });
  }
  // Wire the "Add to options" textarea once.
  const applyBtn = document.getElementById('reports-step-extra-apply');
  const extraTa = document.getElementById('reports-step-extra-cats');
  if (applyBtn && extraTa && !applyBtn.dataset.bound) {
    applyBtn.dataset.bound = '1';
    applyBtn.addEventListener('click', () => {
      const lines = (extraTa.value || '').split('\n').map(s => s.trim()).filter(Boolean);
      lines.forEach(l => _extraStepCats.add(l));
      extraTa.value = '';
      renderReportsStep(); // re-render with the new options
    });
  }
  // Categories from every known source (MMEX staging if present + canonical
  // empty-start + bucket defaults + user-typed). Union ensures the list is
  // never empty.
  const baseCats = reportsWizardCategories();
  const cfg = state.config.reports_config || DEFAULT_REPORTS_CONFIG;
  // Pre-expand current selections so categories the user typed previously
  // (or an MMEX category that fell out of the union) stay visible & selected.
  const allSelected = new Set();
  const collectSelections = (node) => {
    if (!node) return;
    if (Array.isArray(node.categories)) node.categories.forEach(v => allSelected.add(v));
    if (Array.isArray(node.expense_categories)) node.expense_categories.forEach(v => allSelected.add(v));
    if (Array.isArray(node.income_categories)) node.income_categories.forEach(v => allSelected.add(v));
    if (node.buckets) Object.values(node.buckets).forEach(b => collectSelections(b));
  };
  Object.values(cfg).forEach(collectSelections);
  const allCats = [...new Set([...baseCats, ..._extraStepCats, ...allSelected])].filter(Boolean).sort();
  // Apply the step-6 filter input. Always keep already-selected entries
  // visible (otherwise the user couldn't unselect them while filtering).
  const filterLc = _stepCatsFilter.trim().toLowerCase();
  const cats = filterLc
    ? allCats.filter(c => c.toLowerCase().includes(filterLc) || allSelected.has(c))
    : allCats;
  // Also surface the count so the user knows how many options exist.
  const det = document.getElementById('reports-step-detection');
  if (det) {
    const mmexCount = (state.config.datasource === 'mmex' && state.staging?.categories?.length) || 0;
    const visibleNote = filterLc
      ? ` · showing ${cats.length} of ${allCats.length} (filtered)`
      : ` · ${allCats.length} total options`;
    if (mmexCount) {
      det.innerHTML = `<span class="c-pos">✓ Detected ${mmexCount} categories from your MMEX file${visibleNote}.</span>`;
    } else if (state.config.datasource === 'mmex') {
      det.innerHTML = `<span class="c-warn">⚠ No MMEX categories reached the frontend — using canonical defaults${visibleNote}. Open browser DevTools → Console for the upload diagnostic.</span>`;
    } else {
      det.innerHTML = `<span class="c-mut">Empty start: showing canonical default category set${visibleNote}.</span>`;
    }
  }
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
          <div class="fw-600">${escapeHtml(sec.title)}</div>
          <select multiple size="10" name="${sec.key}.categories" style="width:100%;padding:6px;margin-top:4px;">${optionsHtml(cur)}</select>
        </div>`;
    }
    if (sec.shape === 'buckets') {
      const buckets = node.buckets || {};
      const inner = sec.buckets.map(b => {
        const cur = (buckets[b.id] && buckets[b.id].categories) || [];
        return `
          <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;align-items:start;margin-bottom:6px;">
            <div style="padding-top:4px;font-weight:500;">${escapeHtml(b.label)}</div>
            <select multiple size="8" name="${sec.key}.${b.id}.categories" style="width:100%;padding:4px;">${optionsHtml(cur)}</select>
          </div>`;
      }).join('');
      return `
        <div class="setup-card-block" data-section="${sec.key}" data-shape="buckets">
          <div class="fw-600 mb-6">${escapeHtml(sec.title)}</div>
          ${inner}
        </div>`;
    }
    if (sec.shape === 'cd_split') {
      const exp = node.expense_categories || [];
      const inc = node.income_categories || [];
      return `
        <div class="setup-card-block" data-section="${sec.key}" data-shape="cd_split">
          <div class="fw-600 mb-6">${escapeHtml(sec.title)}</div>
          <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;margin-bottom:6px;">
            <div style="padding-top:4px;">Expense side</div>
            <select multiple size="8" name="${sec.key}.expense" style="width:100%;padding:4px;">${optionsHtml(exp)}</select>
          </div>
          <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;">
            <div style="padding-top:4px;">Income side</div>
            <select multiple size="8" name="${sec.key}.income" style="width:100%;padding:4px;">${optionsHtml(inc)}</select>
          </div>
        </div>`;
    }
    if (sec.shape === 'prefixes') {
      const prefixes = node.fixed_prefixes || [];
      const hintText = (typeof t === 'function')
        ? t('settings.reports.disc_fixed.hint', {}, 'List prefixes that count as fixed costs (one per line). Trailing colon = whole subtree (e.g. "Bills:" matches every Bills:* category). No colon = exact category name. Everything else → Discretionary.')
        : 'List prefixes that count as fixed costs (one per line). Trailing colon = whole subtree (e.g. "Bills:" matches every Bills:* category). No colon = exact category name. Everything else → Discretionary.';
      const phText = (typeof t === 'function')
        ? t('settings.reports.disc_fixed.placeholder', {}, 'e.g.\nRent\nBills:\nInsurance:')
        : 'e.g.\nRent\nBills:\nInsurance:';
      return `
        <div class="setup-card-block" data-section="${sec.key}" data-shape="prefixes">
          <div class="fw-600 mb-6">${escapeHtml(sec.title)}</div>
          <div class="c-mut" style="font-size:12px;margin:0 0 8px;line-height:1.4;">${escapeHtml(hintText)}</div>
          <textarea name="${sec.key}.fixed_prefixes" rows="5" placeholder="${escapeHtml(phText)}" style="width:100%;padding:6px;font-family:monospace;font-size:13px;">${escapeHtml(prefixes.join('\n'))}</textarea>
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
    // MMEX-string → FOS-key best-guess for the dropdown default. Mirrors
    // _MMEX_ACCOUNT_TYPE_MAP in scripts/setup_core.py — kept short, the
    // user fixes mismatches on the dropdown.
    const mmexTypeGuess = (raw) => {
      const t = (raw || '').toLowerCase().trim();
      if (t === 'checking') return 'bank';
      if (t === 'credit card') return 'credit';
      if (t === 'investment' || t === 'asset') return 'brokerage';
      if (t === 'term deposit') return 'savings';
      if (t === 'cash' || t === 'savings' || t === 'loan' || t === 'bank') return t;
      return 'other';
    };
    const typeKeys = new Set(state.account_types.map(at => at.key));
    // Translate the type label via the global i18n helper. The fallback
    // is the English label that ships in the backend's ACCOUNT_TYPES list,
    // so non-localized installs keep working unchanged.
    const typeLabel = (at) => (typeof t === 'function')
      ? t(`setup.account_type.${at.key}`, {}, at.label)
      : at.label;
    for (const acc of state.staging.accounts) {
      const tr = document.createElement('tr');
      const slug = autoSlug(acc.name);
      const cur = acc.currency_code || acc.currency || '—';
      const guess = mmexTypeGuess(acc.type);
      const selected = typeKeys.has(guess) ? guess : 'other';
      const opts = state.account_types.map(at =>
        `<option value="${escapeHtml(at.key)}"${at.key === selected ? ' selected' : ''}>${escapeHtml(typeLabel(at))}</option>`
      ).join('');
      tr.innerHTML = `
        <td>${escapeHtml(acc.name)}</td>
        <td>${escapeHtml(cur)}</td>
        <td><select data-acc-id="${acc.id}" data-acc-field="type" class="setup-type-select">${opts}</select></td>
        <td><input type="text" data-acc-id="${acc.id}" data-acc-field="alias" placeholder="${slug}" pattern="[a-z0-9_]+" maxlength="40"></td>
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

  // Read alias + type overrides (key = mmex account id as string)
  const aliasOverrides = {};
  document.querySelectorAll('#alias-table input[data-acc-field="alias"]').forEach(inp => {
    const v = inp.value.trim().toLowerCase();
    if (v) aliasOverrides[inp.dataset.accId] = v;
  });
  const typeOverrides = {};
  document.querySelectorAll('#alias-table select[data-acc-field="type"]').forEach(sel => {
    typeOverrides[sel.dataset.accId] = sel.value;
  });

  // Build the request payload — strip empty optional features to keep it clean
  const cfg = JSON.parse(JSON.stringify(state.config));
  const body = {
    config: cfg,
    staging_id: state.staging?.id || '',
    account_alias_overrides: aliasOverrides,
    account_type_overrides: typeOverrides,
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

    // Fire-and-forget: kick the backend into fetching FX rates for any
    // dates between the bundled history snapshot and today. The Python
    // handler keeps running even if the browser navigates away, so the
    // CSV is up-to-date by the time the user starts adding transactions.
    // We deliberately do not await this — it can take a few seconds and
    // the user should not wait at the wizard's "Done" screen.
    fetch('/api/fx/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      keepalive: true,
    }).catch(() => { /* network/timeout — Settings → Currency exposes a manual button */ });

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
