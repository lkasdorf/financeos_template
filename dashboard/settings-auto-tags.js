// ─── Auto-Tag Rules — Settings Sub-Tab ─────────────────────────────────
//
// UI for managing the auto_tag rule maps in config/defaults.json:
//   - by_account            account_alias -> tag
//   - by_payee              payee_name    -> tag (case-insensitive on read)
//   - by_category_prefix    Category:Pref -> tag (case-sensitive)
//   - bridge                source_tag    -> [target_tag, ...]
//
// Backend: GET /api/auto-tags/get, POST /api/auto-tags/save,
// POST /api/auto-tags/backfill-prefix. Save replaces the auto_tag block
// in defaults.json and clears the get_defaults() lru_cache so the next
// TX-write picks up the new rules without a server restart.
//
// Per-row edits stay client-only until Save — that way the user can
// add multiple rules in one round-trip and abandon by switching tabs.

let _autoTagsState = {
  cfg: null,            // current config from server (snapshot at last load)
  draft: null,          // working copy mutated by row edits
  costTags: [],         // valid Property_X tags from properties.csv
};

async function renderAutoTagsTab() {
  const container = document.getElementById('settings-tab-content');
  if (!container) return;
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.autotags.loading', {}, 'Loading auto-tag rules...'))}</div>`;

  try {
    const res = await fetch('/api/auto-tags/get', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _autoTagsState.cfg = data.config || {};
    _autoTagsState.draft = JSON.parse(JSON.stringify(_autoTagsState.cfg));
    _autoTagsState.costTags = data.property_cost_tags || [];
  } catch (err) {
    container.innerHTML = `<div class="error-banner">${escapeHtml(t('settings.autotags.err_load', { msg: err.message }, `Could not load auto-tag config: ${err.message}`))}</div>`;
    return;
  }

  _renderAutoTagsForm();
}

function _renderAutoTagsForm() {
  const container = document.getElementById('settings-tab-content');
  if (!container) return;
  const d = _autoTagsState.draft;

  const intro = `
    <h3 style="margin:0 0 6px;">${escapeHtml(t('settings.autotags.heading', {}, 'Auto-tag rules'))}</h3>
    <p class="c-mut" style="margin:0 0 18px;max-width:760px;">${escapeHtml(t('settings.autotags.intro', {}, 'Rules that automatically attach tags to transactions at write-time. Account/payee/category-prefix matches are additive; the bridge propagates a source tag to all listed target tags after the basic matches fire.'))}</p>
  `;

  container.innerHTML = `
    <div style="max-width:880px;">
      ${intro}
      <div id="autotags-sections" style="display:flex;flex-direction:column;gap:22px;"></div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:22px;border-top:1px solid var(--border);padding-top:16px;">
        <button class="btn btn-primary" id="autotags-save">${escapeHtml(t('settings.autotags.save', {}, 'Save all changes'))}</button>
        <button class="btn" id="autotags-revert">${escapeHtml(t('settings.autotags.revert', {}, 'Revert'))}</button>
        <span id="autotags-status" class="c-mut fs-12"></span>
      </div>
    </div>
  `;

  _renderAutoTagsSections();

  document.getElementById('autotags-save').addEventListener('click', _onAutoTagsSave);
  document.getElementById('autotags-revert').addEventListener('click', _onAutoTagsRevert);
}

function _renderAutoTagsSections() {
  const root = document.getElementById('autotags-sections');
  if (!root) return;
  const d = _autoTagsState.draft;
  root.innerHTML = [
    _renderAutoTagMapSection({
      key: 'by_account',
      title: t('settings.autotags.section.by_account', {}, 'By account'),
      hint: t('settings.autotags.hint.by_account', {}, 'Match account alias (lower-case, e.g. "kft"). Tag is auto-attached to every TX on that account.'),
      keyLabel: t('settings.autotags.col.account', {}, 'Account alias'),
      valLabel: t('settings.autotags.col.tag', {}, 'Tag'),
      keyPlaceholder: 'kft',
      valPlaceholder: 'BUSINESS_<X>',
      data: d.by_account || {},
    }),
    _renderAutoTagMapSection({
      key: 'by_payee',
      title: t('settings.autotags.section.by_payee', {}, 'By payee'),
      hint: t('settings.autotags.hint.by_payee', {}, 'Match payee name (case-insensitive). Tag is auto-attached to every TX with that payee.'),
      keyLabel: t('settings.autotags.col.payee', {}, 'Payee (lower-case)'),
      valLabel: t('settings.autotags.col.tag', {}, 'Tag'),
      keyPlaceholder: 'landlord co name',
      valPlaceholder: 'House_costs',
      data: d.by_payee || {},
    }),
    _renderAutoTagMapSection({
      key: 'by_category_prefix',
      title: t('settings.autotags.section.by_category_prefix', {}, 'By category prefix'),
      hint: t('settings.autotags.hint.by_category_prefix', {}, 'Match TX category by case-sensitive prefix. Trailing space (e.g. "Staff:Caretaker ") prevents accidental matches on Custody / Loans.'),
      keyLabel: t('settings.autotags.col.prefix', {}, 'Category prefix'),
      valLabel: t('settings.autotags.col.tag', {}, 'Tag'),
      keyPlaceholder: 'Staff:Caretaker ',
      valPlaceholder: 'Property_HomeABC',
      data: d.by_category_prefix || {},
      showBackfill: true,
    }),
    _renderAutoTagBridgeSection(d.bridge || {}),
  ].join('');

  // Wire row inputs to draft mutations.
  root.querySelectorAll('[data-autotag-input]').forEach((el) => {
    el.addEventListener('input', _onAutoTagInput);
    el.addEventListener('blur', _onAutoTagBlur);
  });
  root.querySelectorAll('[data-autotag-add]').forEach((el) => {
    el.addEventListener('click', _onAutoTagAdd);
  });
  root.querySelectorAll('[data-autotag-remove]').forEach((el) => {
    el.addEventListener('click', _onAutoTagRemove);
  });
  const backfillBtn = root.querySelector('#autotags-backfill-btn');
  if (backfillBtn) backfillBtn.addEventListener('click', _onAutoTagsBackfill);
}

function _renderAutoTagMapSection({ key, title, hint, keyLabel, valLabel, keyPlaceholder, valPlaceholder, data, showBackfill }) {
  const entries = Object.entries(data);
  const rows = entries.map(([k, v], i) => `
    <tr data-autotag-row="${escapeHtml(key)}" data-row-key="${escapeHtml(k)}">
      <td><input type="text" data-autotag-input data-autotag-section="${escapeHtml(key)}" data-autotag-field="key" data-autotag-orig-key="${escapeHtml(k)}" value="${escapeHtml(k)}" placeholder="${escapeHtml(keyPlaceholder)}" style="width:100%;padding:4px 6px;"></td>
      <td><input type="text" data-autotag-input data-autotag-section="${escapeHtml(key)}" data-autotag-field="value" data-autotag-orig-key="${escapeHtml(k)}" value="${escapeHtml(v)}" placeholder="${escapeHtml(valPlaceholder)}" style="width:100%;padding:4px 6px;"></td>
      <td class="nowrap"><button type="button" class="btn-icon" data-autotag-remove data-autotag-section="${escapeHtml(key)}" data-autotag-row-key="${escapeHtml(k)}" title="${escapeHtml(t('settings.autotags.remove', {}, 'Remove'))}">✕</button></td>
    </tr>
  `).join('');
  const empty = entries.length ? '' : `<tr><td colspan="3" class="muted" style="padding:8px;">${escapeHtml(t('settings.autotags.empty_section', {}, 'No rules defined yet.'))}</td></tr>`;
  const backfillRow = showBackfill ? `
    <div style="display:flex;gap:8px;align-items:center;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);">
      <button class="btn" id="autotags-backfill-btn" type="button">${escapeHtml(t('settings.autotags.backfill_btn', {}, 'Backfill matching TX'))}</button>
      <span class="c-mut fs-12">${escapeHtml(t('settings.autotags.backfill_hint', {}, 'Apply current prefix rules retroactively to historical transactions.csv. Dry-run first.'))}</span>
      <span id="autotags-backfill-status" class="c-mut fs-12"></span>
    </div>
  ` : '';
  return `
    <section style="border:1px solid var(--border);border-radius:6px;padding:14px;">
      <h4 style="margin:0 0 4px;">${escapeHtml(title)}</h4>
      <p class="c-mut" style="margin:0 0 10px;font-size:12px;">${escapeHtml(hint)}</p>
      <table class="data-table" style="width:100%;font-size:13px;">
        <thead><tr>
          <th>${escapeHtml(keyLabel)}</th>
          <th>${escapeHtml(valLabel)}</th>
          <th style="width:32px;"></th>
        </tr></thead>
        <tbody>${rows}${empty}</tbody>
      </table>
      <div class="mt-8">
        <button class="btn btn-sm" type="button" data-autotag-add data-autotag-section="${escapeHtml(key)}">+ ${escapeHtml(t('settings.autotags.add', {}, 'Add rule'))}</button>
      </div>
      ${backfillRow}
    </section>
  `;
}

function _renderAutoTagBridgeSection(data) {
  const entries = Object.entries(data);
  const rows = entries.map(([src, targets]) => {
    const targetStr = Array.isArray(targets) ? targets.join(';') : String(targets || '');
    return `
      <tr data-autotag-row="bridge" data-row-key="${escapeHtml(src)}">
        <td><input type="text" data-autotag-input data-autotag-section="bridge" data-autotag-field="key" data-autotag-orig-key="${escapeHtml(src)}" value="${escapeHtml(src)}" placeholder="House_costs" style="width:100%;padding:4px 6px;"></td>
        <td><input type="text" data-autotag-input data-autotag-section="bridge" data-autotag-field="value" data-autotag-orig-key="${escapeHtml(src)}" value="${escapeHtml(targetStr)}" placeholder="Property_HomeABC" style="width:100%;padding:4px 6px;"></td>
        <td class="nowrap"><button type="button" class="btn-icon" data-autotag-remove data-autotag-section="bridge" data-autotag-row-key="${escapeHtml(src)}" title="${escapeHtml(t('settings.autotags.remove', {}, 'Remove'))}">✕</button></td>
      </tr>
    `;
  }).join('');
  const empty = entries.length ? '' : `<tr><td colspan="3" class="muted" style="padding:8px;">${escapeHtml(t('settings.autotags.empty_section', {}, 'No rules defined yet.'))}</td></tr>`;
  return `
    <section style="border:1px solid var(--border);border-radius:6px;padding:14px;">
      <h4 style="margin:0 0 4px;">${escapeHtml(t('settings.autotags.section.bridge', {}, 'Bridge (tag → tags)'))}</h4>
      <p class="c-mut" style="margin:0 0 10px;font-size:12px;">${escapeHtml(t('settings.autotags.hint.bridge', {}, 'Source tag triggers one or more target tags. Targets are separated by semicolons. Fixed-point pass — chains settle in one TX-write.'))}</p>
      <table class="data-table" style="width:100%;font-size:13px;">
        <thead><tr>
          <th>${escapeHtml(t('settings.autotags.col.source_tag', {}, 'Source tag'))}</th>
          <th>${escapeHtml(t('settings.autotags.col.target_tags', {}, 'Target tags (semicolon-separated)'))}</th>
          <th style="width:32px;"></th>
        </tr></thead>
        <tbody>${rows}${empty}</tbody>
      </table>
      <div class="mt-8">
        <button class="btn btn-sm" type="button" data-autotag-add data-autotag-section="bridge">+ ${escapeHtml(t('settings.autotags.add', {}, 'Add rule'))}</button>
      </div>
    </section>
  `;
}

function _onAutoTagInput(ev) {
  // Only sync to draft on blur to avoid breaking the row key while
  // the user is mid-edit (the key field acts as the dict identifier).
}

function _onAutoTagBlur(ev) {
  const el = ev.target;
  const section = el.dataset.autotagSection;
  const field = el.dataset.autotagField;
  const origKey = el.dataset.autotagOrigKey;
  const d = _autoTagsState.draft;
  if (!d[section]) d[section] = {};
  // Find current key (may have been renamed during this edit cycle).
  // We re-locate by walking the row's two inputs.
  const row = el.closest('tr');
  if (!row) return;
  const keyInput = row.querySelector('[data-autotag-field="key"]');
  const valInput = row.querySelector('[data-autotag-field="value"]');
  const newKey = (keyInput?.value || '').trim();
  let newVal = valInput?.value || '';
  if (section === 'bridge') {
    newVal = newVal.split(';').map((s) => s.trim()).filter(Boolean);
  } else {
    newVal = newVal.trim();
  }
  // Drop the original key (if it existed) and re-set under the new one.
  // Skip if the new key is empty — silently. The row stays in the DOM
  // until next render.
  if (origKey && origKey !== newKey && origKey in d[section]) {
    delete d[section][origKey];
  }
  if (newKey) {
    d[section][newKey] = newVal;
    el.dataset.autotagOrigKey = newKey;
    // Update the other input's orig-key too so subsequent edits agree.
    if (keyInput) keyInput.dataset.autotagOrigKey = newKey;
    if (valInput) valInput.dataset.autotagOrigKey = newKey;
    if (row) row.dataset.rowKey = newKey;
  }
}

function _onAutoTagAdd(ev) {
  const section = ev.currentTarget.dataset.autotagSection;
  const d = _autoTagsState.draft;
  if (!d[section]) d[section] = {};
  // Generate a unique placeholder key so multiple "Add" clicks don't collide.
  let i = 1;
  let newKey = '';
  do {
    newKey = `__new${i++}__`;
  } while (newKey in d[section]);
  d[section][newKey] = section === 'bridge' ? [] : '';
  _renderAutoTagsSections();
  // Focus the new row's key input for immediate typing.
  const newRow = document.querySelector(`tr[data-row-key="${CSS.escape(newKey)}"] input[data-autotag-field="key"]`);
  if (newRow) {
    newRow.value = '';
    newRow.focus();
  }
}

function _onAutoTagRemove(ev) {
  const section = ev.currentTarget.dataset.autotagSection;
  const key = ev.currentTarget.dataset.autotagRowKey;
  const d = _autoTagsState.draft;
  if (d[section] && key in d[section]) {
    delete d[section][key];
  }
  _renderAutoTagsSections();
}

async function _onAutoTagsSave() {
  const status = document.getElementById('autotags-status');
  if (status) status.textContent = t('settings.autotags.saving', {}, 'Saving…');
  // Drop empty/placeholder keys before sending.
  const clean = JSON.parse(JSON.stringify(_autoTagsState.draft));
  for (const section of ['by_account', 'by_payee', 'by_category_prefix']) {
    const m = clean[section] || {};
    for (const k of Object.keys(m)) {
      if (!k || k.startsWith('__new') || !m[k]) delete m[k];
    }
  }
  const bridge = clean.bridge || {};
  for (const k of Object.keys(bridge)) {
    if (!k || k.startsWith('__new')) { delete bridge[k]; continue; }
    if (!Array.isArray(bridge[k]) || bridge[k].length === 0) delete bridge[k];
  }
  try {
    const res = await fetch('/api/auto-tags/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: clean }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    _autoTagsState.cfg = data.config;
    _autoTagsState.draft = JSON.parse(JSON.stringify(data.config));
    if (status) status.textContent = t('settings.autotags.saved', {}, 'Saved.');
    _renderAutoTagsSections();
  } catch (err) {
    if (status) status.textContent = t('settings.autotags.err_save', { msg: err.message }, `Save failed: ${err.message}`);
  }
}

function _onAutoTagsRevert() {
  _autoTagsState.draft = JSON.parse(JSON.stringify(_autoTagsState.cfg || {}));
  _renderAutoTagsSections();
  const status = document.getElementById('autotags-status');
  if (status) status.textContent = t('settings.autotags.reverted', {}, 'Reverted to last saved.');
}

async function _onAutoTagsBackfill() {
  const status = document.getElementById('autotags-backfill-status');
  if (status) status.textContent = t('settings.autotags.backfill_running', {}, 'Running dry-run…');
  // Two-step: dry-run first to show the user what would change, then
  // confirm before applying.
  try {
    const dry = await fetch('/api/auto-tags/backfill-prefix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: true }),
    }).then((r) => r.json());
    if (!dry.ok) throw new Error(dry.error || 'dry-run failed');
    const count = dry.total_count || 0;
    const amount = dry.total_amount || 0;
    if (count === 0) {
      if (status) status.textContent = t('settings.autotags.backfill_none', {}, 'Nothing to backfill — all matching rows are already tagged.');
      return;
    }
    const confirmFn = typeof window.uiConfirm === 'function' ? window.uiConfirm : (m) => Promise.resolve(window.confirm(m));
    const proceed = await confirmFn(
      t('settings.autotags.backfill_confirm',
        { count, amount: amount.toLocaleString() },
        `Backfill will tag ${count} transactions (${amount.toLocaleString()} TZS). Apply?`),
    );
    if (!proceed) {
      if (status) status.textContent = t('settings.autotags.backfill_cancelled', {}, 'Cancelled.');
      return;
    }
    const applied = await fetch('/api/auto-tags/backfill-prefix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: false }),
    }).then((r) => r.json());
    if (!applied.ok) throw new Error(applied.error || 'apply failed');
    if (status) status.textContent = t('settings.autotags.backfill_applied', { count: applied.total_count }, `Applied. ${applied.total_count} rows tagged.`);
  } catch (err) {
    if (status) status.textContent = t('settings.autotags.backfill_err', { msg: err.message }, `Backfill failed: ${err.message}`);
  }
}
