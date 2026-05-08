// ─── Settings Page (Categories, Tags, Scheduled, QuickExp, AtmFees, Backup, Accounts, Language) ─
//
// Extracted from forms.js (Code-Review HIGH 1, forms.js God-Module split,
// step 2b/3: Settings island ~1200 LOC). External dependencies stay in
// core.js / i18n.js / settings-finance.js / pages-payees.js: t,
// escapeHtml, settingsTab (let in core.js), renderCurrencyTab, renderFxRatesTab,
// renderBudgetsTab, renderGoalsTab, renderPayeesPage, applyI18n, navigateTo,
// loadAccounts, loadCategories, fmtDate, formatCurrency. All functions stay
// on the global scope so onclick="..." string handlers in the rendered
// HTML keep working unchanged.

function renderBackupTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `
    <div class="section">
      <div class="section-title">${t('settings.backup.title', {}, 'Backup & Export')}</div>
      <p class="hint-md mb-16">${t('settings.backup.hint_html', {}, 'Backups are stored in <code>data/backups/</code>. Max 30 per file, older ones auto-pruned.')}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-save" data-action="triggerBackup" data-arg1="transactions">${t('settings.backup.btn_transactions', {}, 'Backup Transactions')}</button>
        <button class="btn-save" data-action="triggerBackup" data-arg1="scheduled">${t('settings.backup.btn_scheduled', {}, 'Backup Scheduled')}</button>
        <button class="btn-save" data-action="triggerBackup" data-arg1="third_party">${t('settings.backup.btn_debts', {}, 'Backup Debts')}</button>
        <button data-action="triggerBackup" data-arg1="all">${t('settings.backup.btn_all', {}, 'Backup All')}</button>
      </div>
      <div class="section-title" style="margin-top:24px;">${t('settings.backup.full_title', {}, 'Download full backup')}</div>
      <p class="hint-md mb-16">${t('settings.backup.full_hint_html', {}, 'Bundle the entire <code>data/</code> directory (excluding rolling backups) into a single ZIP for off-device storage or migration to another machine.')}</p>
      <div>
        <button class="btn-save" data-action="downloadFullBackup">${t('settings.backup.btn_download_zip', {}, 'Download full backup (.zip)')}</button>
      </div>
      <div id="backup-status" class="mt-16"></div>
      <div id="backup-list" style="margin-top:24px;"></div>
    </div>
  `;
  loadBackupList();
}

async function downloadFullBackup() {
  const statusEl = document.getElementById('backup-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${escapeHtml(t('settings.backup.zip_building', {}, 'Building ZIP archive...'))}</div>`;
  try {
    const res = await fetch('/api/backup/export', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    // Prefer the server-supplied filename from Content-Disposition; fall back to timestamp.
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `financeos-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    const sizeKb = blob.size / 1024;
    const sizeStr = sizeKb < 1024 ? `${sizeKb.toFixed(1)} KB` : `${(sizeKb / 1024).toFixed(1)} MB`;
    statusEl.innerHTML = `<div class="atx-status success">${escapeHtml(t('settings.backup.zip_done', { filename, size: sizeStr }, `Downloaded ${filename} (${sizeStr})`))}</div>`;
  } catch (e) {
    statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.backup.zip_failed', { msg: e.message }, `ZIP export failed: ${e.message}`))}</div>`;
  }
}

async function triggerBackup(target) {
  const statusEl = document.getElementById('backup-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${escapeHtml(t('settings.backup.creating', {}, 'Creating backup...'))}</div>`;
  try {
    const targets = target === 'all' ? ['transactions', 'scheduled', 'third_party'] : [target];
    const results = [];
    // Inner loop var renamed to `target_` to avoid shadowing the global t() i18n function.
    for (const target_ of targets) {
      const res = await fetch('/api/backup/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: target_ }) });
      const data = await res.json();
      results.push(data.message || data.error || target_);
    }
    statusEl.innerHTML = `<div class="atx-status success">${results.join('<br>')}</div>`;
    loadBackupList();
  } catch (e) {
    statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.backup.failed', { msg: e.message }, `Backup failed: ${e.message}`))}</div>`;
  }
}

async function loadBackupList() {
  const listEl = document.getElementById('backup-list');
  try {
    const res = await fetch('/api/backup/list', { method: 'POST' });
    const data = await res.json();
    const backups = data.backups || [];
    if (backups.length === 0) {
      listEl.innerHTML = `<p class="hint-md">${escapeHtml(t('settings.backup.empty', {}, 'No backups found.'))}</p>`;
      return;
    }
    listEl.innerHTML = `
      <div class="section-title">${t('settings.backup.list_title', { n: backups.length }, `Recent Backups (${backups.length})`)}</div>
      <table class="tx-table">
        <thead><tr><th>${t('settings.backup.col_file', {}, 'File')}</th><th>${t('settings.backup.col_size', {}, 'Size')}</th><th>${t('settings.backup.col_date', {}, 'Date')}</th></tr></thead>
        <tbody>${backups.slice(0, 20).map(b => `<tr>
          <td class="fs-11">${escapeHtml(b.name)}</td>
          <td class="label-sm">${b.size}</td>
          <td class="label-sm">${b.date}</td>
        </tr>`).join('')}</tbody>
      </table>
    `;
  } catch (e) {
    listEl.innerHTML = `<p style="color:var(--negative);font-size:12px;">${escapeHtml(t('settings.backup.load_failed', {}, 'Could not load backup list.'))}</p>`;
  }
}

// ─── Settings: Accounts Management ──────────────────────────────────────

async function renderAccountsSettingsTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.accounts.loading', {}, 'Loading accounts...'))}</div>`;

  let accounts = [];
  try {
    const res = await fetch('/api/tx/context', { method: 'POST' });
    const data = await res.json();
    accounts = data.accounts || [];
  } catch (e) {
    container.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.accounts.load_failed', {}, 'Failed to load accounts'))}</div>`;
    return;
  }

  const activeItems = accounts.filter(a => a.status === 'active');
  const archivedItems = accounts.filter(a => a.status === 'archived');
  const groups = [
    { label: t('settings.accounts.group_active_count', { n: activeItems.length }, `Active (${activeItems.length})`), items: activeItems },
    { label: t('settings.accounts.group_archived_count', { n: archivedItems.length }, `Archived (${archivedItems.length})`), items: archivedItems },
  ];

  const editLabel = t('common.actions.edit', {}, 'Edit');
  const labelOn = t('common.actions.on', {}, 'On');
  const labelOff = t('common.actions.off', {}, 'Off');
  const nwHeader = t('settings.accounts.col_net_worth', {}, 'In Net Worth');
  let html = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
      <button class="btn-save" data-action="showAccountAddModal">${escapeHtml(t('settings.accounts.add', {}, '+ Add Account'))}</button>
    </div>
  `;
  for (const g of groups) {
    if (!g.items.length) continue;
    const rows = g.items.map(a => {
      const bal = (state && state.balances && state.balances[a.alias]) || 0;
      const inNw = isInNetWorth(a);
      const currentFlag = inNw ? 'true' : 'false';
      return `<tr>
        <td><strong>${escapeHtml(a.alias)}</strong></td>
        <td>${escapeHtml(a.name)}</td>
        <td>${a.currency}</td>
        <td>${a.type}</td>
        <td>${a.owner}</td>
        <td>${a.status}</td>
        <td class="amt">${formatCurrency(bal, a.currency)}<span class="acc-currency"> ${a.currency}</span></td>
        <td>${a.initial_balance_date || ''}</td>
        <td><button style="font-size:10px;padding:3px 8px;" data-action="toggleAccountNetWorth" data-arg1="${escapeHtml(a.alias)}" data-arg2="${currentFlag}">${inNw ? labelOn : labelOff}</button></td>
        <td><button class="tx-edit-btn" data-action="showAccountEditModal" data-arg1="${escapeHtml(a.alias)}">${editLabel}</button></td>
      </tr>`;
    }).join('');
    html += `
      <div class="section mb-20">
        <div class="section-title">${g.label}</div>
        <table class="tx-table">
          <thead><tr><th>${t('settings.accounts.col_alias', {}, 'Alias')}</th><th>${t('common.col.name', {}, 'Name')}</th><th>${t('common.col.currency', {}, 'Currency')}</th><th>${t('common.col.type', {}, 'Type')}</th><th>${t('settings.accounts.col_owner', {}, 'Owner')}</th><th>${t('settings.accounts.col_status', {}, 'Status')}</th><th>${t('settings.accounts.col_balance', {}, 'Balance')}</th><th>${t('settings.accounts.col_since', {}, 'Since')}</th><th>${nwHeader}</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }
  container.innerHTML = html;
}

// Per-row toggle for "include in Net Worth". Flips the flag via the
// existing /api/accounts/update endpoint, which already accepts the
// new column since it walks the CSV header dynamically. Also patches
// state.accounts so the dashboard widget picks up the change without
// a full reload.
async function toggleAccountNetWorth(alias, currentFlag) {
  const next = (currentFlag === 'true') ? 'false' : 'true';
  await fetch('/api/accounts/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, updated: { include_in_net_worth: next } }),
  });
  if (typeof state !== 'undefined' && state.accounts) {
    const acc = state.accounts.find(a => a.alias === alias);
    if (acc) acc.include_in_net_worth = next;
  }
  renderAccountsSettingsTab();
}

// Open the "Add Account" modal. Distinct values for type / owner /
// currency are derived from the existing accounts so the dropdowns
// match the install's vocabulary, but each comes with a sensible seed
// list for fresh installs that have only the wizard-seeded accounts.
async function showAccountAddModal() {
  const allAccs = (typeof state !== 'undefined' && state.accounts) ? state.accounts : [];
  const distinct = (key, fallbacks) => {
    const seen = new Set(allAccs.map(a => a[key]).filter(Boolean));
    for (const f of fallbacks) seen.add(f);
    return [...seen].sort();
  };
  const typeOptions = distinct('type', ['bank', 'cash', 'savings', 'credit_card', 'mobile_money', 'pass_through']);
  const ownerOptions = distinct('owner', ['self']);
  const currencyOptions = distinct('currency', ['EUR', 'USD']);

  const today = new Date().toISOString().slice(0, 10);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${escapeHtml(t('settings.accounts.modal.add_title', {}, 'Add new account'))}</h3>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('settings.accounts.modal.label_alias', {}, 'Alias')}</label>
          <input type="text" id="acc-add-alias" placeholder="${escapeHtml(t('settings.accounts.modal.alias_ph', {}, 'short_id'))}" autocomplete="off">
        </div>
        <div class="atx-field fx2"><label>${t('common.col.name', {}, 'Name')}</label>
          <input type="text" id="acc-add-name" placeholder="${escapeHtml(t('settings.accounts.modal.name_ph', {}, 'My Bank Checking'))}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('common.col.currency', {}, 'Currency')}</label>
          <select id="acc-add-currency">${currencyOptions.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>
        </div>
        <div class="atx-field fx1"><label>${t('common.col.type', {}, 'Type')}</label>
          <select id="acc-add-type">${typeOptions.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>
        </div>
        <div class="atx-field fx1"><label>${t('settings.accounts.col_owner', {}, 'Owner')}</label>
          <select id="acc-add-owner">${ownerOptions.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('settings.accounts.modal.label_initial_balance', {}, 'Initial Balance')}</label>
          <input type="text" id="acc-add-balance" value="0">
        </div>
        <div class="atx-field fx1"><label>${t('settings.accounts.modal.label_initial_balance_date', {}, 'Initial Balance Date')}</label>
          <input type="date" id="acc-add-baldate" value="${today}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.accounts.modal.label_notes', {}, 'Notes')}</label>
          <input type="text" id="acc-add-notes">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="acc-add-in-net-worth" checked>
            <span>${t('settings.accounts.modal.label_in_net_worth', {}, 'Include in Net Worth')}</span>
          </label>
        </div>
      </div>
      <div id="acc-add-status-msg"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button data-action="closeModal">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" data-action="saveAccountAdd">${t('common.actions.save', {}, 'Save')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
  setTimeout(() => { const el = document.getElementById('acc-add-alias'); if (el) el.focus(); }, 30);
}

async function saveAccountAdd() {
  const payload = {
    alias: document.getElementById('acc-add-alias').value.trim().toLowerCase(),
    name: document.getElementById('acc-add-name').value.trim(),
    currency: document.getElementById('acc-add-currency').value,
    type: document.getElementById('acc-add-type').value,
    owner: document.getElementById('acc-add-owner').value,
    initial_balance: parseAmountInputStr(document.getElementById('acc-add-balance').value || '0'),
    initial_balance_date: document.getElementById('acc-add-baldate').value,
    notes: document.getElementById('acc-add-notes').value.trim(),
    include_in_net_worth: document.getElementById('acc-add-in-net-worth').checked ? 'true' : 'false',
  };
  const statusEl = document.getElementById('acc-add-status-msg');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;
  try {
    const res = await fetch('/api/accounts/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) {
      statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(data.error)}</div>`;
      return;
    }
    closeModal();
    // Patch state in-memory so the new account shows up immediately
    // without a full boot() (which would jump tabs, see saveAccountEdit).
    if (typeof state !== 'undefined' && state.accounts && data.account) {
      state.accounts.push(data.account);
    }
    renderAccountsSettingsTab();
  } catch (e) {
    statusEl.innerHTML = `<div class="atx-status error">${t('common.save_failed', { msg: escapeHtml(e.message) }, `Save failed: ${escapeHtml(e.message)}`)}</div>`;
  }
}

async function showAccountEditModal(alias) {
  const acc = state.accounts.find(a => a.alias === alias);
  if (!acc) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${t('settings.accounts.modal.title', { alias: escapeHtml(alias) }, `Edit <span class="accent">${escapeHtml(alias)}</span>`)}</h3>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('settings.accounts.modal.label_alias', {}, 'Alias')}</label>
          <input type="text" id="acc-edit-alias" value="${escapeHtml(alias)}">
        </div>
        <div class="atx-field fx2"><label>${t('common.col.name', {}, 'Name')}</label>
          <input type="text" id="acc-edit-name" value="${escapeHtml(acc.name)}">
        </div>
        <div class="atx-field fx1"><label>${t('common.label.status', {}, 'Status')}</label>
          <select id="acc-edit-status">
            <option value="active" ${acc.status === 'active' ? 'selected' : ''}>${t('common.status.active', {}, 'Active')}</option>
            <option value="archived" ${acc.status === 'archived' ? 'selected' : ''}>${t('settings.accounts.modal.opt_archived', {}, 'Archived')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('settings.accounts.modal.label_initial_balance', {}, 'Initial Balance')}</label>
          <input type="text" id="acc-edit-balance" value="${acc.initial_balance || 0}">
        </div>
        <div class="atx-field fx1"><label>${t('settings.accounts.modal.label_initial_balance_date', {}, 'Initial Balance Date')}</label>
          <input type="date" id="acc-edit-baldate" value="${acc.initial_balance_date || ''}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.accounts.modal.label_notes', {}, 'Notes')}</label>
          <input type="text" id="acc-edit-notes" value="${escapeHtml(acc.notes || '')}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="acc-edit-in-net-worth" ${isInNetWorth(acc) ? 'checked' : ''}>
            <span>${t('settings.accounts.modal.label_in_net_worth', {}, 'Include in Net Worth')}</span>
          </label>
        </div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:8px;">${t('settings.accounts.modal.meta_html', { currency: escapeHtml(acc.currency), type: escapeHtml(acc.type), owner: escapeHtml(acc.owner) }, `Currency: ${acc.currency} · Type: ${acc.type} · Owner: ${acc.owner}`)}</div>
      <div id="acc-edit-status-msg"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button data-action="closeModal">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" data-action="saveAccountEdit" data-arg1="${escapeHtml(alias)}">${t('common.actions.save', {}, 'Save')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function saveAccountEdit(alias) {
  const newAlias = document.getElementById('acc-edit-alias').value.trim().toLowerCase();
  const updated = {
    name: document.getElementById('acc-edit-name').value.trim(),
    status: document.getElementById('acc-edit-status').value,
    initial_balance: parseAmountInputStr(document.getElementById('acc-edit-balance').value),
    initial_balance_date: document.getElementById('acc-edit-baldate').value,
    notes: document.getElementById('acc-edit-notes').value.trim(),
    include_in_net_worth: document.getElementById('acc-edit-in-net-worth').checked ? 'true' : 'false',
  };
  const statusEl = document.getElementById('acc-edit-status-msg');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;
  try {
    // Rename first if alias changed
    let currentAlias = alias;
    let didRename = false;
    if (newAlias && newAlias !== alias) {
      const renameRes = await fetch('/api/accounts/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_alias: alias, new_alias: newAlias }),
      });
      const renameData = await renameRes.json();
      if (renameData.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(renameData.error)}</div>`; return; }
      currentAlias = newAlias;
      didRename = true;
    }
    // Then update other fields
    const res = await fetch('/api/accounts/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: currentAlias, updated }),
    });
    const data = await res.json();
    if (data.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(data.error)}</div>`; return; }
    closeModal();
    // Patch state.accounts in-memory so the dashboard widget and the
    // settings tab see the change immediately. We avoid boot() here
    // because navigateTo('settings') resets settingsTab to 'categories'
    // mid-flow, so the user would land on the wrong tab.
    if (typeof state !== 'undefined' && state.accounts) {
      const idx = state.accounts.findIndex(a => a.alias === alias);
      if (idx >= 0) {
        const merged = { ...state.accounts[idx], ...updated };
        if (didRename) merged.alias = currentAlias;
        state.accounts[idx] = merged;
      }
    }
    if (didRename) {
      // Rename cascades through transactions/scheduled/quick-expenses,
      // so the in-memory tx cache is now stale — best to do a full
      // reload, but we must restore the accounts tab afterwards.
      const wasTab = (typeof settingsTab !== 'undefined') ? settingsTab : 'accounts';
      await boot();
      settingsTab = wasTab;
      renderSettingsPage();
    } else {
      renderAccountsSettingsTab();
    }
  } catch (e) {
    statusEl.innerHTML = `<div class="atx-status error">${t('common.save_failed', { msg: escapeHtml(e.message) }, `Save failed: ${escapeHtml(e.message)}`)}</div>`;
  }
}


// Tab-switch wrapper — invoked via data-action so the tab buttons don't
// need an inline `settingsTab='x';renderSettingsPage()` script payload.
function setSettingsTab(tabId) {
  settingsTab = tabId;
  renderSettingsPage();
}

// Same idea but for cross-page links (`<a href="#settings" data-action="...">`).
// These let browser hashchange do the navigation — we only need to preset
// the active tab so the subsequent renderSettingsPage shows the right one.
function presetSettingsTab(tabId) {
  settingsTab = tabId;
}

async function renderSettingsPage() {
  const content = document.getElementById('settings-content');
  // Tab labels go through t() so translated strings show up after locale switch.
  // English fallback (third arg) keeps the label readable if the i18n key is missing.
  // Each tab can declare a feature flag; if disabled in config/features.json,
  // the tab is filtered out before render.
  const tabs = [
    { id: 'categories', label: t('settings.tab.categories', {}, 'Categories') },
    { id: 'tags', label: t('settings.tab.tags', {}, 'Tags') },
    { id: 'scheduled', label: t('settings.tab.scheduled', {}, 'Scheduled'), feature: 'scheduled_tx' },
    { id: 'quickexp', label: t('settings.tab.quickexp', {}, 'Quick Expenses'), feature: 'quick_expenses' },
    { id: 'atmfees', label: t('settings.tab.atmfees', {}, 'ATM Fees') },
    { id: 'payees', label: t('settings.tab.payees', {}, 'Payees') },
    { id: 'accounts', label: t('settings.tab.accounts', {}, 'Accounts') },
    { id: 'vehicles', label: t('settings.tab.vehicles', {}, 'Vehicles'), feature: 'vehicles' },
    { id: 'currency', label: t('settings.tab.currency', {}, 'Currency') },
    { id: 'fxrates', label: t('settings.tab.fxrates', {}, 'FX Rates') },
    { id: 'goals', label: t('settings.tab.goals', {}, 'Goals') },
    { id: 'budgets', label: t('settings.tab.budgets', {}, 'Budgets') },
    { id: 'reports', label: t('settings.tab.reports', {}, 'Reports') },
    { id: 'branding', label: t('settings.tab.branding', {}, 'Branding') },
    { id: 'backup', label: t('settings.tab.backup', {}, 'Backup') },
    { id: 'language', label: t('settings.tab.language', {}, 'Language') },
  ].filter(tab => !tab.feature || isFeatureEnabled(tab.feature));
  content.innerHTML = `
    <div class="atx-tabs" style="margin-bottom:24px;flex-wrap:wrap;">
      ${tabs.map(t => `<button class="${settingsTab === t.id ? 'active' : ''}" data-action="setSettingsTab" data-arg1="${escapeHtml(t.id)}">${t.label}</button>`).join('')}
    </div>
    <div id="settings-tab-content"></div>
  `;
  if (settingsTab === 'categories') renderCategoriesTab();
  else if (settingsTab === 'tags') renderTagsTab();
  else if (settingsTab === 'scheduled') renderScheduledTab();
  else if (settingsTab === 'quickexp') renderQuickExpTab();
  else if (settingsTab === 'atmfees') renderAtmFeesTab();
  else if (settingsTab === 'payees') renderPayeesPage();
  else if (settingsTab === 'accounts') renderAccountsSettingsTab();
  else if (settingsTab === 'currency') renderCurrencyTab();
  else if (settingsTab === 'fxrates') renderFxRatesTab();
  else if (settingsTab === 'goals') renderGoalsTab();
  else if (settingsTab === 'budgets') renderBudgetsTab();
  else if (settingsTab === 'reports') renderReportsConfigTab();
  else if (settingsTab === 'vehicles') renderVehiclesTab();
  else if (settingsTab === 'branding') renderBrandingTab();
  else if (settingsTab === 'backup') renderBackupTab();
  else if (settingsTab === 'language') renderLanguageTab();
}

// ─── Settings: Vehicles (CRUD list with archive/delete) ────────────────
// List of all vehicles (active + archived) with per-row Edit, Archive (or
// Activate when archived), and Delete actions. Reuses openVehicleModal()
// from vehicles.js for both Add and Edit. Delete is blocked client-side
// when fuel-log entries reference the vehicle — the user must archive in
// that case to preserve historical reporting integrity.

async function renderVehiclesTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.vehicles.loading', {}, 'Loading vehicles...'))}</div>`;
  // Fresh-load the data so the tab can be opened directly without first
  // visiting the Vehicles page (where loadVehiclesData usually fires).
  if (typeof loadVehiclesData === 'function' && (!Array.isArray(vehicleList) || vehicleList.length === 0)) {
    await loadVehiclesData();
  }

  const list = Array.isArray(vehicleList) ? vehicleList.slice() : [];
  // Stable sort: active first, then by name. Same shape Settings tabs
  // use elsewhere (active rows above archived).
  list.sort((a, b) => {
    const aActive = a.active === true || a.active === 'true' ? 0 : 1;
    const bActive = b.active === true || b.active === 'true' ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return (a.name || '').localeCompare(b.name || '');
  });

  // Count fuel-log entries per vehicle so the Delete button can be blocked
  // when a vehicle still has history. Archived vehicles with entries can
  // still be archived again (no-op) but never deleted.
  const fuelCounts = {};
  (Array.isArray(fuelLog) ? fuelLog : []).forEach(e => {
    const vid = e.vehicle_id;
    if (vid) fuelCounts[vid] = (fuelCounts[vid] || 0) + 1;
  });

  const rowsHtml = list.length === 0
    ? `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px;">${escapeHtml(t('settings.vehicles.empty', {}, 'No vehicles configured. Click "Add Vehicle" to create one.'))}</td></tr>`
    : list.map(v => {
        const isActive = v.active === true || v.active === 'true';
        const fuelN = fuelCounts[v.vehicle_id] || 0;
        const canDelete = fuelN === 0;
        const archiveLabel = isActive
          ? t('settings.vehicles.action.archive', {}, 'Archive')
          : t('settings.vehicles.action.activate', {}, 'Activate');
        const statusBadge = isActive
          ? `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:var(--accent-glow);color:var(--accent);font-size:11px;font-weight:600;">${escapeHtml(t('settings.vehicles.status.active', {}, 'Active'))}</span>`
          : `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:var(--border-soft);color:var(--muted);font-size:11px;font-weight:600;">${escapeHtml(t('settings.vehicles.status.archived', {}, 'Archived'))}</span>`;
        const deleteAttrs = canDelete
          ? ''
          : `disabled title="${escapeHtml(t('settings.vehicles.delete_blocked_tooltip', { n: fuelN }, `${fuelN} fuel entries reference this vehicle. Archive instead, or delete the entries first.`))}" style="opacity:0.4;cursor:not-allowed;"`;
        return `
          <tr data-vid="${escapeHtml(v.vehicle_id)}">
            <td style="padding:10px 12px;">
              <div style="font-weight:600;">${escapeHtml(v.name || v.vehicle_id)}</div>
              <div style="font-size:11px;color:var(--muted);">${escapeHtml(v.license_plate || '')} ${v.license_plate ? '·' : ''} ${escapeHtml(v.vehicle_id)}</div>
            </td>
            <td style="padding:10px 12px;font-size:12px;color:var(--muted-soft);">${escapeHtml(v.currency || '—')}</td>
            <td style="padding:10px 12px;font-size:12px;color:var(--muted-soft);">${escapeHtml(v.default_account || '—')}</td>
            <td style="padding:10px 12px;font-size:12px;color:var(--muted-soft);">${escapeHtml(v.default_payee || '—')}</td>
            <td style="padding:10px 12px;">${statusBadge}<div style="font-size:11px;color:var(--muted);margin-top:2px;">${fuelN} ${escapeHtml(t('settings.vehicles.fuel_entries_label', {}, 'fuel entries'))}</div></td>
            <td style="padding:10px 12px;text-align:right;white-space:nowrap;">
              <button class="vt-edit-btn" data-vid="${escapeHtml(v.vehicle_id)}" style="padding:4px 10px;font-size:11px;background:transparent;color:var(--accent);border:1px solid var(--accent);border-radius:var(--radius-xs);cursor:pointer;margin-right:4px;">${escapeHtml(t('settings.vehicles.action.edit', {}, 'Edit'))}</button>
              <button class="vt-archive-btn" data-vid="${escapeHtml(v.vehicle_id)}" data-active="${isActive ? 'true' : 'false'}" style="padding:4px 10px;font-size:11px;background:transparent;color:var(--muted-soft);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;margin-right:4px;">${escapeHtml(archiveLabel)}</button>
              <button class="vt-delete-btn" data-vid="${escapeHtml(v.vehicle_id)}" ${deleteAttrs} style="padding:4px 10px;font-size:11px;background:transparent;color:var(--negative,#dc2626);border:1px solid var(--negative,#dc2626);border-radius:var(--radius-xs);cursor:pointer;">${escapeHtml(t('settings.vehicles.action.delete', {}, 'Delete'))}</button>
            </td>
          </tr>`;
      }).join('');

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div>
        <h3 style="margin:0 0 4px;">${escapeHtml(t('settings.vehicles.heading', {}, 'Vehicles'))}</h3>
        <p class="c-mut" style="margin:0;font-size:12px;">${escapeHtml(t('settings.vehicles.intro', {}, 'Manage tracked vehicles. The Sidebar → Vehicles page shows fuel-log analytics per active vehicle.'))}</p>
      </div>
      <button class="btn btn-primary" id="vt-add-btn">+ ${escapeHtml(t('settings.vehicles.action.add', {}, 'Add Vehicle'))}</button>
    </div>
    <div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:var(--border-soft);font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted);">
            <th style="padding:8px 12px;text-align:left;font-weight:500;">${escapeHtml(t('settings.vehicles.col.name', {}, 'Name'))}</th>
            <th style="padding:8px 12px;text-align:left;font-weight:500;">${escapeHtml(t('settings.vehicles.col.currency', {}, 'Currency'))}</th>
            <th style="padding:8px 12px;text-align:left;font-weight:500;">${escapeHtml(t('settings.vehicles.col.account', {}, 'Default account'))}</th>
            <th style="padding:8px 12px;text-align:left;font-weight:500;">${escapeHtml(t('settings.vehicles.col.payee', {}, 'Default payee'))}</th>
            <th style="padding:8px 12px;text-align:left;font-weight:500;">${escapeHtml(t('settings.vehicles.col.status', {}, 'Status'))}</th>
            <th style="padding:8px 12px;text-align:right;font-weight:500;">${escapeHtml(t('settings.vehicles.col.actions', {}, 'Actions'))}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <p class="c-mut" style="margin-top:12px;font-size:11px;">${escapeHtml(t('settings.vehicles.delete_hint', {}, 'Vehicles with fuel-log entries cannot be deleted. Archive them instead — archived vehicles are excluded from the per-vehicle selector but remain in historical reports.'))}</p>
  `;

  // Wire up the action buttons. Delegation would also work but per-row
  // click handlers stay tighter and avoid an extra closure path.
  document.getElementById('vt-add-btn')?.addEventListener('click', () => openVehicleModal());
  container.querySelectorAll('.vt-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const vid = btn.dataset.vid;
      const v = list.find(x => x.vehicle_id === vid);
      if (v) openVehicleModal(v);
    });
  });
  container.querySelectorAll('.vt-archive-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const vid = btn.dataset.vid;
      const v = list.find(x => x.vehicle_id === vid);
      if (!v) return;
      const newActive = btn.dataset.active === 'true' ? 'false' : 'true';
      btn.disabled = true;
      try {
        const res = await fetch('/api/vehicles/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...v, vehicle_id: vid, active: newActive }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        await loadVehiclesData();
        renderVehiclesTab();
      } catch (e) {
        btn.disabled = false;
        uiAlert(t('settings.vehicles.err_archive', { msg: e.message }, `Update failed: ${e.message}`), { type: 'error' });
      }
    });
  });
  container.querySelectorAll('.vt-delete-btn').forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener('click', async () => {
      const vid = btn.dataset.vid;
      const v = list.find(x => x.vehicle_id === vid);
      if (!v) return;
      const ok = await uiConfirm(
        t('settings.vehicles.confirm_delete', { name: v.name || vid }, `Delete vehicle "${v.name || vid}"? This cannot be undone.`),
        { type: 'destructive' }
      );
      if (!ok) return;
      btn.disabled = true;
      try {
        const res = await fetch('/api/vehicles/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vehicle_id: vid }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        await loadVehiclesData();
        renderVehiclesTab();
        uiAlert(t('settings.vehicles.success_delete', { name: v.name || vid }, `Vehicle "${v.name || vid}" deleted.`), { type: 'info' });
      } catch (e) {
        btn.disabled = false;
        uiAlert(t('settings.vehicles.err_delete', { msg: e.message }, `Delete failed: ${e.message}`), { type: 'error' });
      }
    });
  });
}

// ─── Settings: Branding (display name + accent color) ──────────────────
// Editable post-install version of the setup-wizard's Step 1. Reads/writes
// config/branding.json via /api/branding/{get,save}. applyBranding() is
// called immediately on save so the new name + color show up without a
// reload, including the derived --accent-dim/glow/subtle variables.

async function renderBrandingTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.branding.loading', {}, 'Loading branding...'))}</div>`;
  let data = {
    display_name: window.BRANDING.display_name || 'FinanceOS',
    accent_color: window.BRANDING.accent_color || '#1e40af',
    fx_dashboard_url: window.BRANDING.fx_dashboard_url || '',
  };
  try {
    const res = await fetch('/api/branding/get', { method: 'POST' });
    if (res.ok) data = await res.json();
  } catch { /* fall back to in-memory */ }
  container.innerHTML = `
    <div style="max-width:560px;">
      <h3 style="margin:0 0 6px;">${escapeHtml(t('settings.branding.heading', {}, 'Branding'))}</h3>
      <p class="c-mut" style="margin:0 0 16px;">${escapeHtml(t('settings.branding.intro', {}, 'Display name + accent color. Both are written to config/branding.json and applied immediately to the dashboard (header, sidebar, footer, charts, hover glows).'))}</p>
      <label style="display:block;margin-bottom:14px;">
        <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(t('settings.branding.name_label', {}, 'Display name'))}</div>
        <input type="text" id="branding-name" maxlength="60" value="${escapeHtml(data.display_name)}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);">
      </label>
      <label style="display:block;margin-bottom:14px;">
        <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(t('settings.branding.accent_label', {}, 'Accent color'))}</div>
        <div style="display:flex;gap:10px;align-items:center;">
          <input type="color" id="branding-color" value="${escapeHtml(data.accent_color)}" style="width:60px;height:36px;padding:0;border:1px solid var(--border);border-radius:6px;cursor:pointer;">
          <input type="text" id="branding-color-hex" value="${escapeHtml(data.accent_color)}" pattern="#[0-9A-Fa-f]{6}" maxlength="7" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-family:monospace;">
          <span class="c-mut" style="font-size:12px;">${escapeHtml(t('settings.branding.accent_hint', {}, 'Used for accents, hover glows, links.'))}</span>
        </div>
      </label>
      <hr style="border:0;border-top:1px solid var(--border-soft);margin:20px 0 16px;">
      <label style="display:block;margin-bottom:14px;">
        <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(t('settings.branding.fx_url_label', {}, 'FX Dashboard URL'))}</div>
        <input type="url" id="branding-fx-url" placeholder="https://example.ts.net:8446/" value="${escapeHtml(data.fx_dashboard_url || '')}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-family:monospace;font-size:12px;">
        <div class="c-mut" style="font-size:12px;margin-top:4px;">${escapeHtml(t('settings.branding.fx_url_hint', {}, 'Optional. If set, an "FX Charts" link appears in the sidebar and opens this URL in a new tab. Leave empty to hide.'))}</div>
      </label>
      <div style="display:flex;gap:10px;align-items:center;margin-top:18px;">
        <button class="btn btn-primary" id="branding-save">${escapeHtml(t('settings.branding.save', {}, 'Save'))}</button>
        <span id="branding-status" class="c-mut" style="font-size:12px;"></span>
      </div>
    </div>
  `;
  const colorInp = document.getElementById('branding-color');
  const hexInp = document.getElementById('branding-color-hex');
  colorInp.addEventListener('input', () => { hexInp.value = colorInp.value; });
  hexInp.addEventListener('input', () => {
    if (/^#[0-9A-Fa-f]{6}$/.test(hexInp.value)) colorInp.value = hexInp.value;
  });
  document.getElementById('branding-save').addEventListener('click', async () => {
    const status = document.getElementById('branding-status');
    const name = document.getElementById('branding-name').value.trim();
    const accent = hexInp.value.trim();
    const fxUrl = document.getElementById('branding-fx-url').value.trim();
    if (!name) { status.textContent = t('settings.branding.err_name', {}, 'Display name required'); return; }
    if (!/^#[0-9A-Fa-f]{6}$/.test(accent)) { status.textContent = t('settings.branding.err_color', {}, 'Color must be #rrggbb'); return; }
    if (fxUrl && !/^https?:\/\//i.test(fxUrl)) {
      status.textContent = t('settings.branding.err_fx_url', {}, 'FX URL must start with http:// or https://');
      return;
    }
    status.textContent = t('settings.branding.saving', {}, 'Saving...');
    try {
      const res = await fetch('/api/branding/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name, accent_color: accent, fx_dashboard_url: fxUrl }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = await res.json();
      window.BRANDING.display_name = out.display_name;
      window.BRANDING.accent_color = out.accent_color;
      window.BRANDING.fx_dashboard_url = out.fx_dashboard_url || '';
      applyBranding();
      status.textContent = t('settings.branding.saved', {}, '✓ Saved');
      setTimeout(() => { if (status) status.textContent = ''; }, 2400);
    } catch (e) {
      status.textContent = t('settings.branding.save_failed', { err: String(e) }, `Save failed: ${e}`);
    }
  });
}

// ─── Settings: Language ──────────────────────────────────────────────────
// B1 scope: minimal locale picker. Dropdown shows codes from window.AVAILABLE_LOCALES;
// only "en" is shipped in the template. Forks add config/i18n/<code>.json and append
// the code to AVAILABLE_LOCALES (in i18n.js) to make it selectable here.
async function renderLanguageTab() {
  const container = document.getElementById('settings-tab-content');
  const options = window.AVAILABLE_LOCALES.map(code => {
    const label = t(`settings.language.option.${code}`, {}, code.toUpperCase());
    const sel = code === window.LOCALE ? ' selected' : '';
    return `<option value="${code}"${sel}>${label}</option>`;
  }).join('');
  container.innerHTML = `
    <div style="max-width:560px;">
      <h3 style="margin:0 0 12px;">${t('settings.language.heading', {}, 'Interface Language')}</h3>
      <p class="c-mut" style="margin:0 0 16px;">${t('settings.language.description', {}, 'Choose the display language for the dashboard.')}</p>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <label for="locale-select" style="font-weight:600;">${t('settings.language.current_label', {}, 'Current locale:')}</label>
        <select id="locale-select" style="padding:6px 10px;">${options}</select>
      </div>
      <div class="c-mut" style="font-size:12px;">${t('settings.language.fallback_note', {}, 'Strings without a translation fall back to the English value baked into the HTML.')}</div>
    </div>
  `;
  // Switch locale, re-apply DOM, then re-render this tab so the new strings show up immediately.
  document.getElementById('locale-select').addEventListener('change', async (e) => {
    await setLocale(e.target.value);
    renderSettingsPage();
  });
}

async function renderCategoriesTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.categories.loading', {}, 'Loading categories...'))}</div>`;

  let categories = [];
  try {
    const res = await fetch('/api/categories/list', { method: 'POST' });
    const data = await res.json();
    categories = data.categories || [];
  } catch (e) { container.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.categories.load_failed', {}, 'Failed to load'))}</div>`; return; }

  // Group by top-level
  const groups = {};
  categories.forEach(c => {
    const top = c.path.split(':')[0];
    if (!groups[top]) groups[top] = [];
    groups[top].push(c);
  });

  // Cache common translations once per render to avoid re-lookup in the loop.
  const labelYes = t('common.yes', {}, 'Yes');
  const labelNo = t('common.no', {}, 'No');
  const labelLuxury = t('settings.categories.val_luxury', {}, 'Luxury');
  const labelActive = t('common.status.active', {}, 'Active');
  const labelInactive = t('common.status.inactive', {}, 'Inactive');
  const labelEdit = t('common.actions.edit', {}, 'Edit');

  let html = `
    <div class="flex-row gap-md mb-20">
      <span class="hint-md">${t('settings.categories.count', { n: categories.length }, `${categories.length} categories`)}</span>
      <button class="btn-save" data-action="showCategoryModal" style="padding:8px 16px;font-size:11px;">${t('settings.categories.add', {}, '+ Add Category')}</button>
    </div>
  `;

  for (const [top, cats] of Object.entries(groups).sort()) {
    html += `<div class="section mb-16">
      <div class="section-title">${escapeHtml(top)}</div>
      <table class="tx-table"><thead><tr><th>${t('settings.categories.col_path', {}, 'Path')}</th><th>${t('common.col.type', {}, 'Type')}</th><th>${t('settings.categories.col_pnl', {}, 'P&L')}</th><th>${t('settings.categories.col_essential', {}, 'Essential')}</th><th>${labelActive}</th><th>${t('settings.categories.col_note', {}, 'Note')}</th><th></th></tr></thead><tbody>`;
    cats.forEach(c => {
      const pnlVal = c.pnl === 'false' ? false : true;
      const essentialVal = !(c.essential === 'false' || c.essential === false);
      const essentialRelevant = c.type === 'expense';
      const isActive = c.active === 'true' || c.active === true;
      html += `<tr style="${c.active === 'false' || c.active === false ? 'opacity:0.5' : ''}">
        <td>${escapeHtml(c.path)}</td>
        <td class="fs-11">${c.type}</td>
        <td><span style="font-size:10px;color:${pnlVal ? 'var(--positive)' : 'var(--muted)'}">${pnlVal ? labelYes : labelNo}</span></td>
        <td><span style="font-size:10px;color:${!essentialRelevant ? 'var(--muted)' : essentialVal ? 'var(--positive)' : 'var(--warn)'}">${!essentialRelevant ? '—' : essentialVal ? labelYes : labelLuxury}</span></td>
        <td><button style="font-size:10px;padding:3px 8px;" data-action="toggleCategory" data-arg1="${escapeHtml(c.path)}" data-arg2="${isActive}">${isActive ? labelActive : labelInactive}</button></td>
        <td class="hint-sm">${escapeHtml(c.note || '')}</td>
        <td><button class="tx-edit-btn" data-action="showCategoryModal" data-arg1="${escapeHtml(c.path)}" title="${labelEdit}">${labelEdit}</button></td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }

  container.innerHTML = html;
}

async function toggleCategory(path, isActive) {
  // isActive arrives as the string 'true'/'false' (data-action dispatcher
  // passes data-arg2 verbatim); also accept the original boolean shape so
  // direct callers don't break.
  const wasActive = isActive === true || isActive === 'true';
  await fetch('/api/categories/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, updated: { active: wasActive ? 'false' : 'true' } }),
  });
  renderCategoriesTab();
  reloadCategories();
}

async function showCategoryModal(editPath) {
  let cat = null;
  if (editPath) {
    try {
      const res = await fetch('/api/categories/list', { method: 'POST' });
      const data = await res.json();
      cat = (data.categories || []).find(c => c.path === editPath);
    } catch (e) {}
  }
  const isEdit = !!cat;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? t('settings.categories.modal.title_edit', {}, 'Edit <span class="accent">Category</span>') : t('settings.categories.modal.title_add', {}, 'Add <span class="accent">Category</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.categories.modal.label_path', {}, 'Path (e.g. Food:Dining out)')}</label>
          <input type="text" id="cm-path" value="${escapeHtml(cat?.path || '')}" ${isEdit ? 'readonly style="opacity:0.6"' : ''}>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('common.col.type', {}, 'Type')}</label>
          <select id="cm-type">
            <option value="expense" ${cat?.type === 'expense' ? 'selected' : ''}>${t('common.type.expense', {}, 'Expense')}</option>
            <option value="income" ${cat?.type === 'income' ? 'selected' : ''}>${t('common.type.income', {}, 'Income')}</option>
          </select>
        </div>
        <div class="atx-field"><label>${t('common.status.active', {}, 'Active')}</label>
          <select id="cm-active">
            <option value="true" ${!cat || cat.active === 'true' || cat.active === true ? 'selected' : ''}>${t('common.status.active', {}, 'Active')}</option>
            <option value="false" ${cat && (cat.active === 'false' || cat.active === false) ? 'selected' : ''}>${t('common.status.inactive', {}, 'Inactive')}</option>
          </select>
        </div>
        <div class="atx-field"><label>${t('settings.categories.modal.label_pnl', {}, 'P&L Relevant')}</label>
          <select id="cm-pnl">
            <option value="true" ${!cat || cat.pnl !== 'false' ? 'selected' : ''}>${t('common.yes', {}, 'Yes')}</option>
            <option value="false" ${cat && cat.pnl === 'false' ? 'selected' : ''}>${t('settings.categories.modal.opt_pnl_no_balance', {}, 'No (Balance Sheet)')}</option>
          </select>
        </div>
        <div class="atx-field"><label>${t('settings.categories.modal.label_essential', {}, 'Essential (Cost of Living)')}</label>
          <select id="cm-essential">
            <option value="true" ${!cat || !(cat.essential === 'false' || cat.essential === false) ? 'selected' : ''}>${t('settings.categories.modal.opt_essential_yes', {}, 'Yes — counts as essential')}</option>
            <option value="false" ${cat && (cat.essential === 'false' || cat.essential === false) ? 'selected' : ''}>${t('settings.categories.modal.opt_essential_no', {}, 'No — discretionary / luxury')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('common.label.note', {}, 'Note')}</label>
          <input type="text" id="cm-note" value="${escapeHtml(cat?.note || '')}">
        </div>
      </div>
      <div id="cm-status"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button data-action="closeModal">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" data-action="saveCategory" data-arg1="${isEdit ? `'${escapeHtml(editPath)}'` : 'null'}">${isEdit ? t('common.actions.save', {}, 'Save') : t('common.actions.add', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function saveCategory(editPath) {
  const path = editPath || document.getElementById('cm-path').value.trim();
  const data = {
    type: document.getElementById('cm-type').value,
    active: document.getElementById('cm-active').value,
    pnl: document.getElementById('cm-pnl').value,
    essential: document.getElementById('cm-essential').value,
    note: document.getElementById('cm-note').value.trim(),
  };
  if (!path) { document.getElementById('cm-status').innerHTML = `<div class="atx-status error">${t('settings.categories.modal.err_path_required', {}, 'Path is required')}</div>`; return; }

  const statusEl = document.getElementById('cm-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

  try {
    const endpoint = editPath ? '/api/categories/update' : '/api/categories/add';
    const body = editPath ? { path, updated: data } : { path, ...data };
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderCategoriesTab();
    addTxState.context = null; // Invalidate cached context
    reloadCategories();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

// ─── Tags Tab ─────────────────────────────────────────────────────────────

async function renderTagsTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.tags.loading', {}, 'Loading tags...'))}</div>`;

  let tags = [];
  try {
    const res = await fetch('/api/tags/list', { method: 'POST' });
    const data = await res.json();
    tags = data.tags || [];
  } catch (e) { container.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.categories.load_failed', {}, 'Failed to load'))}</div>`; return; }

  // Cache translations + rename map var from `t` to `tag` to avoid shadowing t().
  const labelActive = t('common.status.active', {}, 'Active');
  const labelInactive = t('common.status.inactive', {}, 'Inactive');
  const labelEdit = t('common.actions.edit', {}, 'Edit');
  const labelDelete = t('common.actions.delete', {}, 'Delete');
  const autoRuleManual = t('settings.tags.auto_rule_manual', {}, '(manual)');

  let html = `
    <div class="flex-row gap-md mb-20">
      <span class="hint-md">${t('settings.tags.count', { n: tags.length }, `${tags.length} tags`)}</span>
      <button class="btn-save" data-action="showTagModal" style="padding:8px 16px;font-size:11px;">${t('settings.tags.add', {}, '+ Add Tag')}</button>
    </div>
    <div class="section">
      <table class="tx-table"><thead><tr><th>${t('settings.tags.col_tag', {}, 'Tag')}</th><th>${t('settings.tags.col_description', {}, 'Description')}</th><th>${t('settings.tags.col_auto_rule', {}, 'Auto-Rule')}</th><th>${labelActive}</th><th></th></tr></thead><tbody>
  `;
  tags.forEach(tag => {
    html += `<tr style="${tag.active === 'false' ? 'opacity:0.5' : ''}">
      <td><strong>${escapeHtml(tag.tag)}</strong></td>
      <td class="fs-11">${escapeHtml(tag.description || '')}</td>
      <td class="hint-sm">${escapeHtml(tag.auto_rule || autoRuleManual)}</td>
      <td><button style="font-size:10px;padding:3px 8px;" data-action="toggleTag" data-arg1="${escapeHtml(tag.tag)}" data-arg2="${tag.active}">${tag.active === 'true' ? labelActive : labelInactive}</button></td>
      <td>
        <button class="tx-edit-btn" data-action="showTagModal" data-arg1="${escapeHtml(tag.tag)}" title="${labelEdit}">${labelEdit}</button>
        <button class="tx-edit-btn c-neg" data-action="deleteTag" data-arg1="${escapeHtml(tag.tag)}" title="${labelDelete}">${labelDelete}</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table></div>';

  container.innerHTML = html;
}

async function toggleTag(tag, active) {
  await fetch('/api/tags/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag, updated: { active: active === 'true' ? 'false' : 'true' } }),
  });
  renderTagsTab();
}

async function showTagModal(editTag) {
  let tag = null;
  if (editTag) {
    try {
      const res = await fetch('/api/tags/list', { method: 'POST' });
      const data = await res.json();
      tag = (data.tags || []).find(t => t.tag === editTag);
    } catch (e) {}
  }
  const isEdit = !!tag;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? t('settings.tags.modal.title_edit', {}, 'Edit <span class="accent">Tag</span>') : t('settings.tags.modal.title_add', {}, 'Add <span class="accent">Tag</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.tags.modal.label_tag_name', {}, 'Tag Name')}</label>
          <input type="text" id="tm-tag" value="${escapeHtml(tag?.tag || '')}" ${isEdit ? 'readonly style="opacity:0.6"' : ''}>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('common.label.description', {}, 'Description')}</label>
          <input type="text" id="tm-desc" value="${escapeHtml(tag?.description || '')}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.tags.modal.label_auto_rule', {}, 'Auto-Rule (e.g. "account in kft;kfu")')}</label>
          <input type="text" id="tm-rule" value="${escapeHtml(tag?.auto_rule || '')}">
        </div>
        <div class="atx-field"><label>${t('common.status.active', {}, 'Active')}</label>
          <select id="tm-active">
            <option value="true" ${!tag || tag.active === 'true' ? 'selected' : ''}>${t('common.status.active', {}, 'Active')}</option>
            <option value="false" ${tag?.active === 'false' ? 'selected' : ''}>${t('common.status.inactive', {}, 'Inactive')}</option>
          </select>
        </div>
      </div>
      <div id="tm-status"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button data-action="closeModal">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" data-action="saveTag" data-arg1="${isEdit ? `'${escapeHtml(editTag)}'` : 'null'}">${isEdit ? t('common.actions.save', {}, 'Save') : t('common.actions.add', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function saveTag(editTag) {
  const tagName = editTag || document.getElementById('tm-tag').value.trim();
  const data = {
    description: document.getElementById('tm-desc').value.trim(),
    auto_rule: document.getElementById('tm-rule').value.trim(),
    active: document.getElementById('tm-active').value,
  };
  if (!tagName) { document.getElementById('tm-status').innerHTML = `<div class="atx-status error">${t('settings.tags.modal.err_tag_required', {}, 'Tag name is required')}</div>`; return; }

  const statusEl = document.getElementById('tm-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

  try {
    const endpoint = editTag ? '/api/tags/update' : '/api/tags/add';
    const body = editTag ? { tag: tagName, updated: data } : { tag: tagName, ...data };
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderTagsTab();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

async function deleteTag(tag) {
  if (!(await uiConfirm(t('settings.tags.modal.confirm_delete', { tag }, `Delete tag "${tag}"?`), { type: 'destructive' }))) return;
  try {
    await fetch('/api/tags/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag }) });
    renderTagsTab();
  } catch (e) {}
}

// ─── Scheduled Tab ────────────────────────────────────────────────────────

async function renderScheduledTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.scheduled.loading', {}, 'Loading scheduled...'))}</div>`;

  let items = [];
  try {
    const res = await fetch('/api/scheduled/list', { method: 'POST' });
    const data = await res.json();
    items = data.scheduled || [];
  } catch (e) { container.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.categories.load_failed', {}, 'Failed to load'))}</div>`; return; }

  const active = items.filter(s => s.active === 'true');
  const inactive = items.filter(s => s.active !== 'true');

  const labelActive = t('common.status.active', {}, 'Active');
  const labelInactive = t('common.status.inactive', {}, 'Inactive');
  const labelEdit = t('common.actions.edit', {}, 'Edit');
  const labelDelete = t('common.actions.delete', {}, 'Delete');

  let html = `
    <div class="flex-row gap-md mb-20">
      <span class="hint-md">${t('settings.scheduled.count_split', { active: active.length, inactive: inactive.length }, `${active.length} active, ${inactive.length} inactive`)}</span>
      <button class="btn-save" data-action="showScheduledModal" style="padding:8px 16px;font-size:11px;">${t('settings.scheduled.add', {}, '+ Add Scheduled')}</button>
    </div>
    <div class="section">
      <table class="tx-table"><thead><tr>
        <th>${t('common.col.name', {}, 'Name')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('common.col.amount', {}, 'Amount')}</th><th>${t('common.col.payee', {}, 'Payee')}</th><th>${t('common.col.category', {}, 'Category')}</th><th>${t('settings.scheduled.col_frequency', {}, 'Frequency')}</th><th>${t('settings.scheduled.col_next_run', {}, 'Next Run')}</th><th>${t('settings.scheduled.col_last_run', {}, 'Last Run')}</th><th>${labelActive}</th><th></th>
      </tr></thead><tbody>
  `;
  items.forEach(s => {
    const overdue = s.active === 'true' && s.next_run && s.next_run <= new Date().toISOString().slice(0,10);
    html += `<tr style="${s.active !== 'true' ? 'opacity:0.5' : ''}">
      <td><strong>${escapeHtml(s.name)}</strong>${s.note ? `<br><span class="hint-sm">${escapeHtml(s.note)}</span>` : ''}</td>
      <td class="fs-11">${escapeHtml(s.account)}</td>
      <td style="font-size:11px;font-variant-numeric:tabular-nums">${formatCurrency(Number(s.amount), s.currency)} ${s.currency}</td>
      <td class="fs-11">${escapeHtml(s.payee)}</td>
      <td class="fs-10">${escapeHtml(s.category)}</td>
      <td class="fs-10">${escapeHtml(s.frequency)}</td>
      <td style="font-size:11px;${overdue ? 'color:var(--negative);font-weight:500' : ''}">${fmtDate(s.next_run)}${overdue ? ' !' : ''}</td>
      <td class="hint-sm">${fmtDate(s.last_run) || '—'}</td>
      <td><button style="font-size:10px;padding:3px 8px;" data-action="toggleScheduled" data-arg1="${s.sched_id}" data-arg2="${s.active}">${s.active === 'true' ? labelActive : labelInactive}</button></td>
      <td>
        <button class="tx-edit-btn" data-action="showScheduledModal" data-arg1="${s.sched_id}" title="${labelEdit}">${labelEdit}</button>
        <button class="tx-edit-btn c-neg" data-action="deleteScheduled" data-arg1="${s.sched_id}" title="${labelDelete}">${labelDelete}</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  if (items.some(s => s.manual_tags)) {
    html += `<div style="font-size:10px;color:var(--muted);margin-top:8px;">${escapeHtml(t('settings.scheduled.footer_manual_tags', {}, 'Tags shown are manual only — auto-tags (Pass-Through, Payee-based) are applied at booking time.'))}</div>`;
  }
  container.innerHTML = html;
}

async function toggleScheduled(schedId, active) {
  await fetch('/api/scheduled/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sched_id: schedId, updated: { active: active === 'true' ? 'false' : 'true' } }),
  });
  renderScheduledTab();
}

async function showScheduledModal(editId) {
  const ctx = await loadTxContext();
  let item = null;
  if (editId) {
    try {
      const res = await fetch('/api/scheduled/list', { method: 'POST' });
      const data = await res.json();
      item = (data.scheduled || []).find(s => s.sched_id === editId);
    } catch (e) {}
  }
  const isEdit = !!item;
  const activeAccounts = ctx.accounts.filter(a => a.status === 'active');
  const accOptions = activeAccounts.map(a =>
    `<option value="${a.alias}" data-currency="${a.currency}" ${item && item.account === a.alias ? 'selected' : ''}>${a.alias} — ${a.name} [${a.currency}]</option>`
  ).join('');
  const catOptions = ctx.categories.filter(c => c.active).map(c =>
    `<option value="${c.path}" ${item && item.category === c.path ? 'selected' : ''}>${c.path}</option>`
  ).join('');
  const currencies = ['TZS', 'EUR', 'USD', 'PLN'];
  const selectedCur = item?.currency || 'TZS';
  const curOptions = currencies.map(c => `<option value="${c}" ${selectedCur === c ? 'selected' : ''}>${c}</option>`).join('');
  const existingTags = new Set((item?.manual_tags || '').split(';').map(t => t.trim()).filter(Boolean));
  const tagCheckboxes = (ctx.tags || []).filter(t => t.active).map(t =>
    `<label><input type="checkbox" value="${t.tag}" ${existingTags.has(t.tag) ? 'checked' : ''}><span>${escapeHtml(t.tag)}</span></label>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? t('settings.scheduled.modal.title_edit', {}, 'Edit <span class="accent">Scheduled Transaction</span>') : t('settings.scheduled.modal.title_add', {}, 'Add <span class="accent">Scheduled Transaction</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field fx2"><label>${t('common.col.name', {}, 'Name')}</label>
          <input type="text" id="sm-name" value="${escapeHtml(item?.name || '')}" placeholder="${t('settings.scheduled.modal.placeholder_name', {}, 'Monthly Subscription')}">
        </div>
        <div class="atx-field fx1"><label>${t('common.status.active', {}, 'Active')}</label>
          <select id="sm-active">
            <option value="true" ${!item || item.active === 'true' ? 'selected' : ''}>${t('common.status.active', {}, 'Active')}</option>
            <option value="false" ${item?.active === 'false' ? 'selected' : ''}>${t('common.status.inactive', {}, 'Inactive')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('common.col.account', {}, 'Account')}</label>
          <select id="sm-account"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option>${accOptions}</select>
        </div>
        <div class="atx-field fx1"><label>${t('common.col.amount', {}, 'Amount')}</label>
          <input type="text" id="sm-amount" value="${escapeHtml(item?.amount || '')}" placeholder="${t('settings.scheduled.modal.placeholder_amount', {}, '900000')}">
        </div>
        <div class="atx-field fx05"><label>${t('common.col.currency', {}, 'Currency')}</label>
          <select id="sm-currency">${curOptions}</select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('common.col.payee', {}, 'Payee')}</label>
          <input type="text" id="sm-payee" value="${escapeHtml(item?.payee || '')}">
        </div>
        <div class="atx-field fx1"><label>${t('common.col.category', {}, 'Category')}</label>
          <select id="sm-category"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option>${catOptions}</select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('settings.scheduled.modal.label_frequency', {}, 'Frequency (e.g. monthly:1, monthly:last, weekly:mon, yearly:09-15, quarterly:03-15)')}</label>
          <input type="text" id="sm-frequency" value="${escapeHtml(item?.frequency || 'monthly:1')}" placeholder="${t('settings.scheduled.modal.placeholder_frequency', {}, 'monthly:1')}">
        </div>
        <div class="atx-field fx1"><label>${t('settings.scheduled.modal.label_next_run', {}, 'Next Run (YYYY-MM-DD)')}</label>
          <input type="date" id="sm-next-run" value="${item?.next_run || ''}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('common.label.note', {}, 'Note')}</label>
          <input type="text" id="sm-note" value="${escapeHtml(item?.note || '')}">
        </div>
        <div class="atx-field fx1"><label>${t('settings.scheduled.modal.label_manual_tags', {}, 'Manual Tags')}</label>
          <div id="sm-tags" class="tag-picker">${tagCheckboxes}</div>
        </div>
      </div>
      <div id="sm-status"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button data-action="closeModal">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" data-action="saveScheduled" data-arg1="${isEdit ? `'${editId}'` : 'null'}">${isEdit ? t('common.actions.save', {}, 'Save') : t('common.actions.add', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);

  // Auto-sync currency to the selected account's native currency. Only
  // overwrites when adding a new entry or when the user hasn't manually
  // picked a currency yet — avoids clobbering an intentional override.
  const accSel = document.getElementById('sm-account');
  const curSel = document.getElementById('sm-currency');
  if (accSel && curSel) {
    let curTouched = !!item; // Treat existing entries as user-set already
    curSel.addEventListener('change', () => { curTouched = true; });
    accSel.addEventListener('change', () => {
      if (curTouched) return;
      const opt = accSel.options[accSel.selectedIndex];
      const accCur = opt && opt.getAttribute('data-currency');
      if (accCur && currencies.includes(accCur)) curSel.value = accCur;
    });
  }
}

async function saveScheduled(editId) {
  const data = {
    name: document.getElementById('sm-name').value.trim(),
    account: document.getElementById('sm-account').value,
    amount: parseAmountInputStr(document.getElementById('sm-amount').value),
    currency: document.getElementById('sm-currency').value,
    payee: document.getElementById('sm-payee').value.trim(),
    category: document.getElementById('sm-category').value,
    frequency: document.getElementById('sm-frequency').value.trim(),
    next_run: document.getElementById('sm-next-run').value,
    note: document.getElementById('sm-note').value.trim(),
    manual_tags: Array.from(document.querySelectorAll('#sm-tags input:checked')).map(c => c.value).join(';'),
    active: document.getElementById('sm-active').value,
  };
  if (!data.name || !data.account || !data.amount) {
    document.getElementById('sm-status').innerHTML = `<div class="atx-status error">${t('settings.scheduled.modal.err_required', {}, 'Name, account, and amount are required')}</div>`;
    return;
  }

  const statusEl = document.getElementById('sm-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

  try {
    const endpoint = editId ? '/api/scheduled/update' : '/api/scheduled/add';
    const body = editId ? { sched_id: editId, updated: data } : data;
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderScheduledTab();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

async function deleteScheduled(schedId) {
  if (!(await uiConfirm(t('settings.scheduled.modal.confirm_delete', { schedId }, `Delete scheduled "${schedId}"?`), { type: 'destructive' }))) return;
  try {
    await fetch('/api/scheduled/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sched_id: schedId }) });
    renderScheduledTab();
  } catch (e) {}
}

// ─── Quick Expenses Settings Tab ─────────────────────────────────────────

async function renderQuickExpTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.quickexp.loading', {}, 'Loading quick expenses...'))}</div>`;

  let items = [];
  try {
    const res = await fetch('/api/quickexp/list', { method: 'POST' });
    const data = await res.json();
    items = data.quick_expenses || [];
  } catch (e) { container.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.categories.load_failed', {}, 'Failed to load'))}</div>`; return; }

  const active = items.filter(q => q.active === 'true');
  const inactive = items.filter(q => q.active !== 'true');

  const labelActive = t('common.status.active', {}, 'Active');
  const labelInactive = t('common.status.inactive', {}, 'Inactive');
  const labelEdit = t('common.actions.edit', {}, 'Edit');
  const labelDelete = t('common.actions.delete', {}, 'Delete');

  let html = `
    <div class="flex-row gap-md mb-20">
      <span class="hint-md">${t('settings.quickexp.count_split', { active: active.length, inactive: inactive.length }, `${active.length} active, ${inactive.length} inactive`)}</span>
      <button class="btn-save" data-action="showQuickExpModal" style="padding:8px 16px;font-size:11px;">${t('settings.quickexp.add', {}, '+ Add Quick Expense')}</button>
    </div>
    <div class="section">
      <table class="tx-table"><thead><tr>
        <th>${t('common.col.name', {}, 'Name')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('common.col.payee', {}, 'Payee')}</th><th>${t('common.col.category', {}, 'Category')}</th><th>${t('common.col.tags', {}, 'Tags')}</th><th>${labelActive}</th><th></th>
      </tr></thead><tbody>
  `;
  items.forEach(q => {
    html += `<tr style="${q.active !== 'true' ? 'opacity:0.5' : ''}">
      <td><strong>${escapeHtml(q.name)}</strong></td>
      <td class="fs-11">${escapeHtml(q.account)}</td>
      <td class="fs-11">${escapeHtml(q.payee)}</td>
      <td class="fs-10">${escapeHtml(q.category)}</td>
      <td class="hint-sm">${escapeHtml(q.tags || '')}</td>
      <td><button style="font-size:10px;padding:3px 8px;" data-action="toggleQuickExp" data-arg1="${q.id}" data-arg2="${q.active}">${q.active === 'true' ? labelActive : labelInactive}</button></td>
      <td>
        <button class="tx-edit-btn" data-action="showQuickExpModal" data-arg1="${q.id}" title="${labelEdit}">${labelEdit}</button>
        <button class="tx-edit-btn c-neg" data-action="deleteQuickExp" data-arg1="${q.id}" title="${labelDelete}">${labelDelete}</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

async function toggleQuickExp(qeId, active) {
  await fetch('/api/quickexp/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: qeId, updated: { active: active === 'true' ? 'false' : 'true' } }),
  });
  renderQuickExpTab();
}

async function showQuickExpModal(editId) {
  const ctx = await loadTxContext();
  let item = null;
  if (editId) {
    try {
      const res = await fetch('/api/quickexp/list', { method: 'POST' });
      const data = await res.json();
      item = (data.quick_expenses || []).find(q => q.id === editId);
    } catch (e) {}
  }
  const isEdit = !!item;
  const activeAccounts = ctx.accounts.filter(a => a.status === 'active');
  const accOptions = activeAccounts.map(a =>
    `<option value="${a.alias}" ${item && item.account === a.alias ? 'selected' : ''}>${a.alias} — ${a.name} [${a.currency}]</option>`
  ).join('');
  const catOptions = ctx.categories.filter(c => c.active).map(c =>
    `<option value="${c.path}" ${item && item.category === c.path ? 'selected' : ''}>${c.path}</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? t('settings.quickexp.modal.title_edit', {}, 'Edit <span class="accent">Quick Expense</span>') : t('settings.quickexp.modal.title_add', {}, 'Add <span class="accent">Quick Expense</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field fx2"><label>${t('settings.quickexp.modal.label_name_chip', {}, 'Name (shown as chip)')}</label>
          <input type="text" id="qm-name" value="${escapeHtml(item?.name || '')}" placeholder="${t('settings.quickexp.modal.placeholder_name', {}, 'Vegetables')}">
        </div>
        <div class="atx-field fx1"><label>${t('common.status.active', {}, 'Active')}</label>
          <select id="qm-active">
            <option value="true" ${!item || item.active === 'true' ? 'selected' : ''}>${t('common.status.active', {}, 'Active')}</option>
            <option value="false" ${item?.active === 'false' ? 'selected' : ''}>${t('common.status.inactive', {}, 'Inactive')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('common.col.account', {}, 'Account')}</label>
          <select id="qm-account"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option>${accOptions}</select>
        </div>
        <div class="atx-field fx1"><label>${t('common.col.payee', {}, 'Payee')}</label>
          <input type="text" id="qm-payee" value="${escapeHtml(item?.payee || '')}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('common.col.category', {}, 'Category')}</label>
          <select id="qm-category"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option>${catOptions}</select>
        </div>
        <div class="atx-field fx1"><label>${t('common.col.tags', {}, 'Tags')}</label>
          <div id="qm-tags-wrap" style="display:flex;flex-wrap:wrap;gap:6px;padding:6px 0;">
            ${(ctx.tags || []).map(tag => {
              const checked = item && (item.tags || '').split(';').includes(tag.tag);
              return `<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;">
                <input type="checkbox" class="qm-tag-cb" value="${escapeHtml(tag.tag)}" ${checked ? 'checked' : ''}> ${escapeHtml(tag.tag)}
              </label>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('common.col.type', {}, 'Type')}</label>
          <select id="qm-type">
            <option value="expense" ${!item || item.type !== 'income' ? 'selected' : ''}>${t('common.type.expense', {}, 'Expense')}</option>
            <option value="income" ${item?.type === 'income' ? 'selected' : ''}>${t('common.type.income', {}, 'Income')}</option>
          </select>
        </div>
        <div class="atx-field fx1"><label>${t('common.label.note', {}, 'Note')}</label>
          <input type="text" id="qm-note" value="${escapeHtml(item?.note || '')}">
        </div>
      </div>
      <div id="qm-status"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button data-action="closeModal">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" data-action="saveQuickExp" data-arg1="${isEdit ? `'${editId}'` : 'null'}">${isEdit ? t('common.actions.save', {}, 'Save') : t('common.actions.add', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function saveQuickExp(editId) {
  const data = {
    name: document.getElementById('qm-name').value.trim(),
    account: document.getElementById('qm-account').value,
    payee: document.getElementById('qm-payee').value.trim(),
    category: document.getElementById('qm-category').value,
    tags: [...document.querySelectorAll('.qm-tag-cb:checked')].map(cb => cb.value).join(';'),
    type: document.getElementById('qm-type').value,
    note: document.getElementById('qm-note').value.trim(),
    active: document.getElementById('qm-active').value,
  };
  if (!data.name || !data.account) {
    document.getElementById('qm-status').innerHTML = `<div class="atx-status error">${t('settings.quickexp.modal.err_required', {}, 'Name and account are required')}</div>`;
    return;
  }

  const statusEl = document.getElementById('qm-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

  try {
    const endpoint = editId ? '/api/quickexp/update' : '/api/quickexp/add';
    const body = editId ? { id: editId, updated: data } : data;
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderQuickExpTab();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

async function deleteQuickExp(qeId) {
  if (!(await uiConfirm(t('settings.quickexp.modal.confirm_delete', { qeId }, `Delete quick expense "${qeId}"?`), { type: 'destructive' }))) return;
  try {
    await fetch('/api/quickexp/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: qeId }) });
    renderQuickExpTab();
  } catch (e) {}
}

// ─── ATM Fees Settings Tab ───────────────────────────────────────────────

async function renderAtmFeesTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.atmfees.loading', {}, 'Loading ATM fees...'))}</div>`;

  let items = [];
  try {
    const res = await fetch('/api/atm-fees/list', { method: 'POST' });
    const data = await res.json();
    items = data.atm_fees || [];
  } catch (e) { container.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.atmfees.load_failed', { msg: e.message }, `Failed to load ATM fees: ${e.message}`))}</div>`; return; }

  const active = items.filter(i => i.active === 'true');
  const inactive = items.filter(i => i.active !== 'true');

  const labelActive = t('common.status.active', {}, 'Active');
  const labelInactive = t('common.status.inactive', {}, 'Inactive');
  const labelEdit = t('common.actions.edit', {}, 'Edit');
  const labelDelete = t('common.actions.delete', {}, 'Delete');

  let html = `
    <div class="flex-row gap-md mb-20">
      <span class="hint-md">${t('settings.atmfees.count_html', { active: active.length, inactive: inactive.length }, `${active.length} active, ${inactive.length} inactive — preset fees for <code>TX atm</code>`)}</span>
      <button class="btn-save" data-action="showAtmFeeModal" style="padding:8px 16px;font-size:11px;">${t('settings.atmfees.add', {}, '+ Add ATM Fee')}</button>
    </div>
    <div class="section">
      <table class="tx-table"><thead><tr>
        <th>${t('settings.atmfees.col_bank', {}, 'Bank')}</th><th>${t('common.col.amount', {}, 'Amount')}</th><th>${t('common.col.currency', {}, 'Currency')}</th><th>${t('settings.atmfees.col_fee_net', {}, 'Fee (net)')}</th><th>${t('settings.atmfees.col_levy', {}, 'Levy')}</th><th>${t('settings.atmfees.col_vat', {}, 'VAT %')}</th><th>${t('settings.atmfees.col_total', {}, 'Total')}</th><th>${t('settings.atmfees.col_note', {}, 'Note')}</th><th>${labelActive}</th><th></th>
      </tr></thead><tbody>`;
  items.forEach(f => {
    const feeNet = parseFloat(f.fee_net) || 0;
    const levy = parseFloat(f.levy) || 0;
    const vatRate = parseFloat(f.vat_rate) || 0;
    const vat = feeNet * vatRate;
    const total = feeNet + levy + vat;
    html += `<tr>
      <td>${escapeHtml(f.bank)}</td>
      <td class="fs-10">${formatCurrency(parseFloat(f.amount) || 0, f.currency || 'TZS')}</td>
      <td class="fs-10">${escapeHtml(f.currency || 'TZS')}</td>
      <td class="fs-10">${formatCurrency(feeNet, f.currency || 'TZS')}</td>
      <td class="fs-10">${formatCurrency(levy, f.currency || 'TZS')}</td>
      <td class="fs-10">${(vatRate * 100).toFixed(1)}%</td>
      <td class="fs-10">${formatCurrency(total, f.currency || 'TZS')}</td>
      <td class="hint-sm">${escapeHtml(f.note || '')}</td>
      <td><button style="font-size:10px;padding:3px 8px;" data-action="toggleAtmFee" data-arg1="${f.id}" data-arg2="${f.active}">${f.active === 'true' ? labelActive : labelInactive}</button></td>
      <td>
        <button class="tx-edit-btn" data-action="showAtmFeeModal" data-arg1="${f.id}" title="${labelEdit}">${labelEdit}</button>
        <button class="tx-edit-btn c-neg" data-action="deleteAtmFee" data-arg1="${f.id}" title="${labelDelete}">${labelDelete}</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  html += `<div class="hint-sm" style="margin-top:12px;">${t('settings.atmfees.footer_html', {}, '<strong>How it works:</strong> <code>TX atm 400k crdb</code> looks up the matching row (bank + amount). Claude generates 4 bookings: transfer (amount, tag <code>ATM</code>), fee_net, levy, and VAT (= fee_net × vat_rate). Unknown amounts trigger a follow-up question.')}</div>`;
  container.innerHTML = html;
}

async function toggleAtmFee(feeId, active) {
  await fetch('/api/atm-fees/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: feeId, updated: { active: active === 'true' ? 'false' : 'true' } }),
  });
  renderAtmFeesTab();
}

async function showAtmFeeModal(editId) {
  const ctx = await loadTxContext();
  let item = null;
  if (editId) {
    try {
      const res = await fetch('/api/atm-fees/list', { method: 'POST' });
      const data = await res.json();
      item = (data.atm_fees || []).find(f => f.id === editId);
    } catch (e) {}
  }
  const isEdit = !!item;
  const activeAccounts = ctx.accounts.filter(a => a.status === 'active');
  // Bank selector = account alias — bank is free text but prefilled with common aliases
  const accOptions = activeAccounts.map(a =>
    `<option value="${a.alias}" ${item && item.bank === a.alias ? 'selected' : ''}>${a.alias} — ${a.name} [${a.currency}]</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? t('settings.atmfees.modal.title_edit', {}, 'Edit <span class="accent">ATM Fee</span>') : t('settings.atmfees.modal.title_add', {}, 'Add <span class="accent">ATM Fee</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('settings.atmfees.modal.label_bank', {}, 'Bank (account alias)')}</label>
          <select id="af-bank"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option>${accOptions}</select>
        </div>
        <div class="atx-field fx1"><label>${t('common.status.active', {}, 'Active')}</label>
          <select id="af-active">
            <option value="true" ${!item || item.active === 'true' ? 'selected' : ''}>${t('common.status.active', {}, 'Active')}</option>
            <option value="false" ${item?.active === 'false' ? 'selected' : ''}>${t('common.status.inactive', {}, 'Inactive')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('settings.atmfees.modal.label_withdrawal_amount', {}, 'Withdrawal amount')}</label>
          <input type="number" id="af-amount" step="1" value="${escapeHtml(item?.amount || '')}" placeholder="400000">
        </div>
        <div class="atx-field fx1"><label>${t('common.col.currency', {}, 'Currency')}</label>
          <input type="text" id="af-currency" value="${escapeHtml(item?.currency || 'TZS')}" placeholder="TZS">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('settings.atmfees.modal.label_fee_net', {}, 'Fee (net, pre-VAT)')}</label>
          <input type="number" id="af-fee-net" step="0.01" value="${escapeHtml(item?.fee_net || '')}" placeholder="1864">
        </div>
        <div class="atx-field fx1"><label>${t('settings.atmfees.modal.label_levy', {}, 'Levy / transaction tax')}</label>
          <input type="number" id="af-levy" step="0.01" value="${escapeHtml(item?.levy || '')}" placeholder="982">
        </div>
        <div class="atx-field fx1"><label>${t('settings.atmfees.modal.label_vat_rate', {}, 'VAT rate')}</label>
          <input type="number" id="af-vat-rate" step="0.01" value="${escapeHtml(item?.vat_rate || '0.18')}" placeholder="0.18">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx2"><label>${t('common.label.note', {}, 'Note')}</label>
          <input type="text" id="af-note" value="${escapeHtml(item?.note || '')}" placeholder="${t('settings.atmfees.modal.placeholder_note', {}, 'Tier description, source, etc.')}">
        </div>
      </div>
      <div class="hint-sm" style="margin-top:8px;">
        ${t('settings.atmfees.modal.vat_hint', {}, "VAT = fee_net × vat_rate is computed at booking time — don't enter it separately.")}
      </div>
      <div id="af-status"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button data-action="closeModal">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" data-action="saveAtmFee" data-arg1="${isEdit ? `'${editId}'` : 'null'}">${isEdit ? t('common.actions.save', {}, 'Save') : t('common.actions.add', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function saveAtmFee(editId) {
  const data = {
    bank: document.getElementById('af-bank').value,
    amount: document.getElementById('af-amount').value.trim(),
    currency: document.getElementById('af-currency').value.trim() || 'TZS',
    fee_net: document.getElementById('af-fee-net').value.trim() || '0',
    levy: document.getElementById('af-levy').value.trim() || '0',
    vat_rate: document.getElementById('af-vat-rate').value.trim() || '0',
    note: document.getElementById('af-note').value.trim(),
    active: document.getElementById('af-active').value,
  };
  const statusEl = document.getElementById('af-status');
  if (!data.bank || !data.amount) {
    statusEl.innerHTML = `<div class="atx-status error">${t('settings.atmfees.modal.err_required', {}, 'Bank and Amount are required')}</div>`;
    return;
  }
  const endpoint = editId ? '/api/atm-fees/update' : '/api/atm-fees/add';
  const body = editId ? { id: editId, updated: data } : data;
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderAtmFeesTab();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

async function deleteAtmFee(feeId) {
  if (!(await uiConfirm(t('settings.atmfees.modal.confirm_delete', { feeId }, `Delete ATM fee preset "${feeId}"?`), { type: 'destructive' }))) return;
  try {
    await fetch('/api/atm-fees/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: feeId }) });
    renderAtmFeesTab();
  } catch (e) {}
}

