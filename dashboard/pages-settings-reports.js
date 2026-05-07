// ─── Settings → Reports tab ──────────────────────────────────────────────
// UI for editing config/reports.json. Maps the 8 category-driven reports
// (Dining Out, AI Costs, Vice Spending, Bank Fees, Cash Discrepancy,
// Bills Overview, Automobile Costs, Discretionary vs. Fixed) to user
// category names. Persisted via POST /api/reports-config/save.

// Visible report definitions in the same order as the dashboard menu, with
// shape descriptors so the renderer knows which buckets to draw. Labels are
// fetched at render time so locale switches re-render cleanly.
function _reportTabSections() {
  return [
    {
      key: 'dining_out',
      get title() { return t('settings.reports.dining_out.title', {}, 'Dining Out'); },
      get hint()  { return t('settings.reports.dining_out.hint', {}, 'Categories that count as eating-out / restaurant spending.'); },
      shape: 'flat',
    },
    {
      key: 'ai_costs',
      get title() { return t('settings.reports.ai.title', {}, 'AI Costs'); },
      get hint()  { return t('settings.reports.ai.hint', {}, 'Match mode: prefix. Any category starting with one of these.'); },
      shape: 'flat',
      mode: 'prefix',
    },
    {
      key: 'vice_spending',
      get title() { return t('settings.reports.vice.title', {}, 'Vice Spending'); },
      get hint()  { return t('settings.reports.vice.hint', {}, 'Alcohol, smoking, vaping — whatever you track separately.'); },
      shape: 'flat',
    },
    {
      key: 'bank_fees',
      get title() { return t('settings.reports.bank_fees.title', {}, 'Bank Fees'); },
      get hint()  { return t('settings.reports.bank_fees.hint', {}, 'Match mode: prefix. Categories starting with one of these strings.'); },
      shape: 'flat',
      mode: 'prefix',
    },
    {
      key: 'cash_discrepancy',
      get title() { return t('settings.reports.cd.title', {}, 'Cash Discrepancy'); },
      get hint()  { return t('settings.reports.cd.hint', {}, 'Categories used to record cash differences (e.g. found money / lost money).'); },
      shape: 'cd_split',
    },
    {
      key: 'bills',
      get title() { return t('settings.reports.bills.title', {}, 'Bills Overview'); },
      get hint()  { return t('settings.reports.bills.hint', {}, 'One bucket per bill type. Buckets are visible only in the report; you can map them to whatever your category names are.'); },
      shape: 'buckets',
      buckets: [
        { id: 'rent',        get label() { return t('settings.reports.bills.rent', {}, 'Rent'); } },
        { id: 'electricity', get label() { return t('settings.reports.bills.electricity', {}, 'Electricity'); } },
        { id: 'water',       get label() { return t('settings.reports.bills.water', {}, 'Water'); } },
        { id: 'internet',    get label() { return t('settings.reports.bills.internet', {}, 'Internet'); } },
      ],
    },
    {
      key: 'automobile',
      get title() { return t('settings.reports.auto.title', {}, 'Automobile Costs'); },
      get hint()  { return t('settings.reports.auto.hint', {}, 'Map your vehicle-related categories to these buckets. Anything not assigned shows up under Other.'); },
      shape: 'buckets',
      buckets: [
        { id: 'purchase',     get label() { return t('settings.reports.auto.purchase',     {}, 'Purchase'); } },
        { id: 'petrol',       get label() { return t('settings.reports.auto.petrol',       {}, 'Petrol / Fuel'); } },
        { id: 'maintenance',  get label() { return t('settings.reports.auto.maintenance',  {}, 'Maintenance'); } },
        { id: 'toll',         get label() { return t('settings.reports.auto.toll',         {}, 'Toll'); } },
        { id: 'parking',      get label() { return t('settings.reports.auto.parking',      {}, 'Parking'); } },
        { id: 'insurance',    get label() { return t('settings.reports.auto.insurance',    {}, 'Insurance'); } },
        { id: 'registration', get label() { return t('settings.reports.auto.registration', {}, 'Registration'); } },
        { id: 'accessories',  get label() { return t('settings.reports.auto.accessories',  {}, 'Accessories'); } },
        { id: 'car_rental',   get label() { return t('settings.reports.auto.car_rental',   {}, 'Car Rental'); } },
        { id: 'other',        get label() { return t('settings.reports.auto.other',        {}, 'Other'); } },
      ],
    },
    {
      key: 'discretionary_fixed',
      get title() { return t('settings.reports.disc_fixed.title', {}, 'Discretionary vs. Fixed'); },
      get hint()  { return t('settings.reports.disc_fixed.hint', {}, 'Prefixes that mark a category as a fixed cost. Anything else is discretionary. Use exact name or trailing colon for a prefix (e.g. "Bills:").'); },
      shape: 'prefixes',
    },
  ];
}

async function renderReportsConfigTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.reports.loading', {}, 'Loading reports config...'))}</div>`;

  // Pull the effective config from the server (file overlay over defaults).
  let cfg = window.REPORTS_CONFIG || {};
  try {
    const res = await fetch('/api/reports-config/get', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.config) cfg = data.config;
    }
  } catch { /* fall back to in-memory defaults */ }

  // All known categories from data/categories.csv, sorted for the dropdowns.
  const allCats = [...new Set((state.categories || []).map(c => c.path))].sort();
  const sections = _reportTabSections();

  const intro = `
    <h3 style="margin:0 0 6px;">${escapeHtml(t('settings.reports.heading', {}, 'Report → Category mapping'))}</h3>
    <p class="c-mut" style="margin:0 0 16px;">${escapeHtml(t('settings.reports.intro', {}, 'Some reports filter transactions by category. Map each report to whatever your categories are called — defaults match the canonical category set shipped with FinanceOS.'))}</p>
  `;

  const sectionsHtml = sections.map(sec => {
    const node = cfg[sec.key] || {};
    if (sec.shape === 'flat') {
      return _renderFlatSection(sec, node, allCats);
    }
    if (sec.shape === 'buckets') {
      return _renderBucketSection(sec, node, allCats);
    }
    if (sec.shape === 'cd_split') {
      return _renderCashDiscrepancySection(sec, node, allCats);
    }
    if (sec.shape === 'prefixes') {
      return _renderPrefixSection(sec, node);
    }
    return '';
  }).join('');

  container.innerHTML = `
    <div style="max-width:760px;">
      ${intro}
      <div id="reports-config-form" style="display:flex;flex-direction:column;gap:18px;">
        ${sectionsHtml}
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:18px;">
        <button class="btn btn-primary" id="reports-config-save">${escapeHtml(t('settings.reports.save', {}, 'Save'))}</button>
        <button class="btn" id="reports-config-reset">${escapeHtml(t('settings.reports.reset', {}, 'Reset to defaults'))}</button>
        <span id="reports-config-status" class="c-mut" style="font-size:12px;"></span>
      </div>
    </div>
  `;

  document.getElementById('reports-config-save').addEventListener('click', _onReportsConfigSave);
  document.getElementById('reports-config-reset').addEventListener('click', _onReportsConfigReset);
}

function _selectMultiple(name, options, selected, size = 6) {
  const sel = new Set(selected || []);
  return `
    <select multiple name="${escapeHtml(name)}" size="${size}" style="width:100%;min-width:240px;padding:6px;">
      ${options.map(o => `<option value="${escapeHtml(o)}"${sel.has(o) ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}
    </select>
  `;
}

function _renderFlatSection(sec, node, allCats) {
  const cats = node.categories || [];
  return `
    <div class="card" data-section="${sec.key}">
      <div style="font-weight:600;">${escapeHtml(sec.title)}</div>
      <div class="c-mut" style="font-size:12px;margin:2px 0 8px;">${escapeHtml(sec.hint)}</div>
      ${_selectMultiple(`${sec.key}.categories`, allCats, cats, 5)}
    </div>
  `;
}

function _renderBucketSection(sec, node, allCats) {
  const buckets = (node && node.buckets) || {};
  const inner = sec.buckets.map(b => {
    const cats = (buckets[b.id] && buckets[b.id].categories) || [];
    return `
      <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;align-items:start;margin-bottom:8px;">
        <div style="padding-top:4px;font-weight:500;">${escapeHtml(b.label)}</div>
        ${_selectMultiple(`${sec.key}.${b.id}.categories`, allCats, cats, 4)}
      </div>
    `;
  }).join('');
  return `
    <div class="card" data-section="${sec.key}" data-shape="buckets">
      <div style="font-weight:600;">${escapeHtml(sec.title)}</div>
      <div class="c-mut" style="font-size:12px;margin:2px 0 12px;">${escapeHtml(sec.hint)}</div>
      ${inner}
    </div>
  `;
}

function _renderCashDiscrepancySection(sec, node, allCats) {
  const exp = node.expense_categories || [];
  const inc = node.income_categories || [];
  return `
    <div class="card" data-section="${sec.key}" data-shape="cd_split">
      <div style="font-weight:600;">${escapeHtml(sec.title)}</div>
      <div class="c-mut" style="font-size:12px;margin:2px 0 12px;">${escapeHtml(sec.hint)}</div>
      <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;align-items:start;margin-bottom:8px;">
        <div style="padding-top:4px;font-weight:500;">${escapeHtml(t('settings.reports.cd.expense', {}, 'Expense side'))}</div>
        ${_selectMultiple(`${sec.key}.expense`, allCats, exp, 4)}
      </div>
      <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;align-items:start;">
        <div style="padding-top:4px;font-weight:500;">${escapeHtml(t('settings.reports.cd.income', {}, 'Income side'))}</div>
        ${_selectMultiple(`${sec.key}.income`, allCats, inc, 4)}
      </div>
    </div>
  `;
}

function _renderPrefixSection(sec, node) {
  const prefixes = node.fixed_prefixes || [];
  return `
    <div class="card" data-section="${sec.key}" data-shape="prefixes">
      <div style="font-weight:600;">${escapeHtml(sec.title)}</div>
      <div class="c-mut" style="font-size:12px;margin:2px 0 8px;">${escapeHtml(sec.hint)}</div>
      <textarea name="${sec.key}.fixed_prefixes" rows="6" style="width:100%;min-height:120px;padding:8px;font-family:monospace;font-size:13px;">${escapeHtml(prefixes.join('\n'))}</textarea>
    </div>
  `;
}

function _collectReportsConfigFromForm() {
  const sections = _reportTabSections();
  const out = {};
  for (const sec of sections) {
    const root = document.querySelector(`[data-section="${sec.key}"]`);
    if (!root) continue;
    if (sec.shape === 'flat') {
      const sel = root.querySelector('select');
      const cats = Array.from(sel.selectedOptions).map(o => o.value);
      out[sec.key] = { categories: cats };
      if (sec.mode) out[sec.key].match = sec.mode;
    } else if (sec.shape === 'buckets') {
      const buckets = {};
      for (const b of sec.buckets) {
        const sel = root.querySelector(`select[name="${sec.key}.${b.id}.categories"]`);
        const cats = sel ? Array.from(sel.selectedOptions).map(o => o.value) : [];
        buckets[b.id] = { categories: cats };
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
      const lines = (ta?.value || '')
        .split('\n').map(s => s.trim()).filter(Boolean);
      out[sec.key] = { fixed_prefixes: lines };
    }
  }
  return out;
}

async function _onReportsConfigSave() {
  const status = document.getElementById('reports-config-status');
  const cfg = _collectReportsConfigFromForm();
  status.textContent = t('settings.reports.saving', {}, 'Saving...');
  try {
    const res = await fetch('/api/reports-config/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.config) Object.assign(window.REPORTS_CONFIG, data.config);
    status.textContent = t('settings.reports.saved', {}, '✓ Saved');
    setTimeout(() => { if (status) status.textContent = ''; }, 2400);
  } catch (e) {
    status.textContent = t('settings.reports.save_failed', { err: String(e) }, `Save failed: ${e}`);
  }
}

async function _onReportsConfigReset() {
  if (!confirm(t('settings.reports.confirm_reset', {}, 'Reset all report mappings to defaults? Your current mapping will be overwritten.'))) return;
  // Reset by saving an empty object — server fallback fills with defaults.
  const status = document.getElementById('reports-config-status');
  status.textContent = t('settings.reports.resetting', {}, 'Resetting...');
  try {
    const res = await fetch('/api/reports-config/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: {} }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.config) {
      // Replace REPORTS_CONFIG entirely so the UI shows the defaults next render.
      for (const k of Object.keys(window.REPORTS_CONFIG)) delete window.REPORTS_CONFIG[k];
      Object.assign(window.REPORTS_CONFIG, data.config);
    }
    renderReportsConfigTab();
  } catch (e) {
    status.textContent = t('settings.reports.reset_failed', { err: String(e) }, `Reset failed: ${e}`);
  }
}
