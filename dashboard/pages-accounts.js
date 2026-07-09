// ─── Accounts Overview ───────────────────────────────────────────────────

// Navigation helpers used by data-action handlers. Inlining
// `history.pushState(...);navigateTo(...)` into onclick was the source
// of the apostrophe-XSS risk for user-defined account aliases.
function gotoAccountDetail(alias) {
  history.pushState(null, '', '#account:' + alias);
  navigateTo('account:' + alias);
}

function gotoAccountsOverview() {
  history.pushState(null, '', '#accounts');
  navigateTo('accounts');
}

// Used by the search-result rows that link to the Debts overview.
function gotoDebtsPage() {
  history.pushState(null, '', '#debts');
  navigateTo('debts');
}

// Pool of currencies offered as opt-in "show balance in …" columns on the
// Accounts overview. Restricted to ones we reliably have rates for via the
// existing fxRates loader. User-selected subset persists in localStorage so
// the choice survives reloads (same pattern as displayCurrency).
const ACCOUNTS_FX_CHIPS = ['TZS', 'EUR', 'USD', 'PLN'];
const ACCOUNTS_FX_KEY = 'lp-accounts-extra-cols';

function readAccountsExtraCols() {
  let arr = [];
  try {
    const raw = localStorage.getItem(ACCOUNTS_FX_KEY);
    if (raw) arr = JSON.parse(raw);
  } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  // Keep canonical order (TZS → EUR → USD → PLN) and drop any currency we
  // don't have an FX rate for, so a row never tries to convert blindly.
  return ACCOUNTS_FX_CHIPS.filter(c => arr.includes(c) && (c === 'TZS' || fxRates[c]));
}

function writeAccountsExtraCols(arr) {
  try { localStorage.setItem(ACCOUNTS_FX_KEY, JSON.stringify(arr)); } catch (e) { console.warn('[accounts-fx:storage]', e); }
}

function toggleAccountsExtraCol(currency) {
  const cur = readAccountsExtraCols();
  const idx = cur.indexOf(currency);
  if (idx >= 0) cur.splice(idx, 1);
  else cur.push(currency);
  writeAccountsExtraCols(cur);
  renderAccountsOverview();
}

function renderAccountsOverview() {
  const content = document.getElementById('accounts-overview-content');
  if (!content || !state.accounts.length) return;

  const cur = displayCurrency;
  const extraCols = readAccountsExtraCols();
  const groups = [
    { label: t('accounts_overview.group.own', {}, 'Own Accounts'), accounts: state.accounts.filter(a => a.owner === 'self' && a.status === 'active' && a.type !== 'pass_through') },
    { label: t('accounts_overview.group.passthrough', {}, 'Pass-Through'), accounts: state.accounts.filter(a => a.owner === 'self' && a.status === 'active' && a.type === 'pass_through') },
    { label: t('accounts_overview.group.custody', {}, 'Custody'), accounts: state.accounts.filter(a => a.owner !== 'self' && a.status === 'active') },
    { label: t('accounts_overview.group.archived', {}, 'Archived'), accounts: state.accounts.filter(a => a.status === 'archived') },
  ];

  // Net Worth (same logic as dashboard)
  const nw = netWorthByCurrency(state.accounts, state.balances);
  const nwTotal = Object.values(nw).reduce((s, v) => s + v.total, 0);

  // Multi-select chip strip — toggles extra "Balance in X" columns. Default
  // empty (no chips active) renders the original two-column layout exactly.
  const chipStrip = `
    <div class="acc-fx-row">
      <span class="acc-fx-label">${t('accounts_overview.fx_toggle_label', {}, 'Also show in')}</span>
      <span class="acc-fx-chips">
        ${ACCOUNTS_FX_CHIPS.map(c => `<button type="button" class="acc-fx-chip${extraCols.includes(c) ? ' active' : ''}" data-fx-toggle="${c}">${c}</button>`).join('')}
      </span>
    </div>
  `;

  // Total column count after extras — the existing 5 columns (Account,
  // Currency, Type, Balance, auto-convert) plus one per opt-in chip.
  const totalCols = 5 + extraCols.length;
  const valueColspan = totalCols - 3; // label always spans the first 3 cols

  let html = chipStrip;
  for (const g of groups) {
    if (!g.accounts.length) continue;
    const extraHeaders = extraCols.map(c =>
      `<th class="amt">${t('accounts_overview.col_balance_in', { currency: c }, `Balance (${c})`)}</th>`
    ).join('');

    const rows = g.accounts.map(a => {
      const bal = state.balances[a.alias] || 0;
      const converted = a.currency === cur ? bal : convertTo(bal, a.currency, cur);
      const balClass = bal < 0 ? 'negative' : '';
      const ownerBadge = a.owner !== 'self' ? `<span style="font-size:10px;color:var(--muted);margin-left:6px;">(${a.owner})</span>` : '';
      const extraCells = extraCols.map(c => {
        const v = a.currency === c ? bal : convertTo(bal, a.currency, c);
        const cls = v < 0 ? 'negative' : '';
        return `<td class="amt label-sm ${cls}">${formatCurrency(v, c)}<span class="acc-currency">${c}</span></td>`;
      }).join('');
      return `<tr class="ptr" data-action="gotoAccountDetail" data-arg1="${escapeHtml(a.alias)}">
        <td><strong>${escapeHtml(a.name)}</strong>${ownerBadge}<br><span class="label-sm">${escapeHtml(a.alias)}</span></td>
        <td class="label-sm">${a.currency}</td>
        <td class="label-sm">${a.type}</td>
        <td class="amt ${balClass} fw-500">${formatCurrency(bal, a.currency)}<span class="acc-currency">${a.currency}</span></td>
        ${a.currency !== cur ? `<td class="amt label-sm">${formatCurrency(converted, cur)} ${cur}</td>` : `<td></td>`}
        ${extraCells}
      </tr>`;
    }).join('');

    // Native totals (sum per native currency, no conversion) — unchanged
    // behaviour, just widened so it spans the new extra columns too.
    const byCur = {};
    g.accounts.forEach(a => {
      if (!byCur[a.currency]) byCur[a.currency] = 0;
      byCur[a.currency] += state.balances[a.alias] || 0;
    });
    const nativeTotalRows = Object.entries(byCur).map(([c, total]) =>
      `<tr style="font-weight:600;border-top:1px solid var(--border);">
        <td colspan="3">${t('accounts_overview.total_label', { group: g.label, currency: c }, `Total ${g.label} (${c})`)}</td>
        <td class="amt" colspan="${valueColspan}">${formatCurrency(total, c)}<span class="acc-currency">${c}</span></td>
      </tr>`
    ).join('');

    // Converted grand totals — one row per active chip currency, sums every
    // account in the group after converting into the chip currency. Visually
    // marked with "≈" so it's not mistaken for a native sum.
    const convertedTotalRows = extraCols.map(c => {
      let sum = 0;
      g.accounts.forEach(a => {
        const bal = state.balances[a.alias] || 0;
        sum += a.currency === c ? bal : convertTo(bal, a.currency, c);
      });
      const cls = sum < 0 ? 'negative' : '';
      return `<tr style="font-weight:600;color:var(--muted);">
        <td colspan="3">${t('accounts_overview.total_label_converted', { group: g.label, currency: c }, `Total ${g.label} (≈ ${c})`)}</td>
        <td class="amt ${cls}" colspan="${valueColspan}">${formatCurrency(sum, c)}<span class="acc-currency">${c}</span></td>
      </tr>`;
    }).join('');

    html += `
      <div class="section">
        <div class="section-title">${g.label}</div>
        <table class="tx-table">
          <thead><tr><th>${t('accounts_overview.col_account', {}, 'Account')}</th><th>${t('accounts_overview.col_currency', {}, 'Currency')}</th><th>${t('accounts_overview.col_type', {}, 'Type')}</th><th class="amt">${t('accounts_overview.col_balance', {}, 'Balance')}</th><th class="amt"></th>${extraHeaders}</tr></thead>
          <tbody>
            ${rows}
            ${nativeTotalRows}
            ${convertedTotalRows}
          </tbody>
        </table>
      </div>
    `;
  }

  // Net Worth summary at bottom (matches dashboard exactly — reuses dashboard.networth.* keys)
  html += `
    <div class="section">
      <div class="section-title">${t('dashboard.networth.title', {}, 'Net Worth')} <span class="hint">${t('dashboard.networth.hint', {}, '(per-account toggle in Settings → Accounts)')}</span></div>
      <div class="income-grid">
        ${Object.entries(nw).map(([c, v]) => `
          <div class="income-cell">
            <div class="ic-label">${c}</div>
            <div class="ic-value">${formatCurrency(v.total, c)}<span class="ic-cur">${c}</span></div>
            <div class="ic-count">${t(v.accounts === 1 ? 'accounts_overview.account_count_one' : 'accounts_overview.account_count_many', { n: v.accounts }, v.accounts === 1 ? '1 account' : `${v.accounts} accounts`)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  content.innerHTML = html;

  // Chip-strip event delegation. Registered once on the container — the
  // container itself survives renderAccountsOverview() re-renders, only its
  // innerHTML is replaced, so the listener stays alive.
  if (!content._fxDelegated) {
    content.addEventListener('click', (e) => {
      const chip = e.target.closest('.acc-fx-chip[data-fx-toggle]');
      if (!chip) return;
      const ccy = chip.getAttribute('data-fx-toggle');
      if (ccy) toggleAccountsExtraCol(ccy);
    });
    content._fxDelegated = true;
  }
}

// ─── Account Detail ──────────────────────────────────────────────────────

function renderAccountPage() {
  const alias = accountPage.alias;
  const acc = state.accounts.find(a => a.alias === alias);
  if (!acc) return;

  const bal = state.balances[alias] || 0;
  const headerEl = document.getElementById('account-header');
  const contentEl = document.getElementById('account-content');

  // Header
  const metaBits = [];
  metaBits.push(acc.currency);
  metaBits.push(acc.type);
  if (acc.owner !== 'self') metaBits.push(t('accp.meta_owner', { owner: acc.owner }, `owner: ${acc.owner}`));
  if (acc.status === 'archived') metaBits.push(t('accp.meta_archived', {}, 'archived'));

  headerEl.innerHTML = `
    <div style="display:flex;align-items:center;margin-bottom:12px;">
      <button class="report-back m-0" data-action="gotoAccountsOverview">${t('accp.back', {}, '← Accounts')}</button>
      <div style="margin-left:auto;display:flex;gap:8px;">
        <button data-action="exportAccountTx" data-arg1="${alias}" style="padding:6px 14px;font-size:12px;">${t('accp.export_xlsx', {}, 'Export XLSX')}</button>
        <button class="btn-save" data-action="navigateToAddTxWithAccount" data-arg1="${alias}" style="padding:8px 14px;font-size:12px;">${t('accp.add_tx', {}, '+ Add TX')}</button>
      </div>
    </div>
    <h2>${escapeHtml(acc.name)} <span class="accent">${alias}</span></h2>
    <div class="page-meta">
      <span class="bal">${formatCurrency(bal, acc.currency)} ${acc.currency}</span>
      <span>${metaBits.join(' · ')}</span>
    </div>
    <div class="accp-primary-cta">
      <button class="primary-action-btn" data-action="navigateToAddTxWithAccount" data-arg1="${alias}">${t('accp.add_tx', {}, '+ Add TX')}</button>
    </div>
  `;

  // All TX for this account (source or transfer target), unfiltered — needed
  // for the running-balance calculation. buildTxIndexes already de-duplicates
  // transfer-rows under both endpoints (see core.js), so a single Map lookup
  // here is equivalent to the previous linear filter over state.tx.
  // Fallback to the linear scan if the index is empty for any reason
  // (defensive — buildTxIndexes runs on every data reload).
  const indexed = state.txIndex?.byAccount?.get(alias);
  const allAccountTx = (indexed && indexed.length
    ? indexed.slice()
    : state.tx.filter(t =>
        t.account === alias || (t.type === 'transfer' && t.transfer_to_account === alias)
      )
  ).sort((a, b) => {
    const c = (b.date || '').localeCompare(a.date || '');
    if (c !== 0) return c;
    return (b._ord || 0) - (a._ord || 0);
  });

  // Apply current account-page filters
  const txForAccount = applyTxFilterSort(allAccountTx, accountPage, { includeAccount: alias }).sort((a, b) => {
    const c = (b.date || '').localeCompare(a.date || '');
    if (c !== 0) return c;
    return (b._ord || 0) - (a._ord || 0);
  });

  const total = txForAccount.length;
  const pageSize = accountPage.PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(accountPage.page, totalPages - 1);
  const start = currentPage * pageSize;
  const slice = txForAccount.slice(start, start + pageSize);

  // Calculate effect of a TX on this account's balance
  function txEffect(t) {
    const isTransferIn = t.type === 'transfer' && t.transfer_to_account === alias && t.account !== alias;
    if (isTransferIn) return parseFloat(t.transfer_to_amount || t.amount) || 0;
    if (t.type === 'transfer') return -(parseFloat(t.amount) || 0);
    if (t.type === 'income') return parseFloat(t.amount) || 0;
    return -(parseFloat(t.amount) || 0); // expense
  }

  // Running balance computed on the UNFILTERED list (newest → oldest) so that
  // filtered rows still show the true account balance at each point in time.
  const balByImportId = new Map();
  let walkBal = bal;
  for (const t of allAccountTx) {
    balByImportId.set(t.import_id, walkBal);
    walkBal -= txEffect(t);
  }

  // Table — map var renamed from `t` to `tx` so the global t() i18n function
  // is not shadowed inside the callback (same pattern as renderRecentTx).
  const editLabel = t('tx.actions.edit', {}, 'Edit');
  const duplicateLabel = t('tx.actions.duplicate', {}, 'Duplicate');
  const deleteLabel = t('tx.actions.delete', {}, 'Delete');
  const transferLabel = t('dashboard.recent.transfer_category', {}, 'Transfer');
  const rows = slice.map(tx => {
    const rowBal = balByImportId.get(tx.import_id) || 0;

    const tags = (tx.tags || '').split(';').filter(Boolean).map(x => `<span class="tag-chip">${escapeHtml(x)}</span>`).join('');
    const isTransferIn = tx.type === 'transfer' && tx.transfer_to_account === alias && tx.account !== alias;
    let label, typeClass;
    if (tx.type === 'transfer') {
      if (isTransferIn) {
        label = `← ${escapeHtml(tx.account)}`;
        typeClass = 'income';
      } else {
        label = `→ ${tx.transfer_to_account || '?'}`;
        typeClass = 'transfer';
      }
    } else {
      label = escapeHtml(tx.payee || '');
      typeClass = tx.type;
    }
    const catOrType = tx.type === 'transfer' ? transferLabel : escapeHtml(tx.category || '');
    const balClass = rowBal >= 0 ? '' : 'negative';
    const noteFull = tx.note || '';
    const noteShort = noteFull.length > 80 ? noteFull.slice(0, 79) + '…' : noteFull;
    const note = noteFull ? `<div class="tx-note" title="${escapeHtml(noteFull)}">${escapeHtml(noteShort)}</div>` : '';
    return `
      <tr>
        <td>${fmtDate(tx.date)}</td>
        <td>${label}${note}</td>
        <td class="cat">${catOrType}${tags ? '<br>' + tags : ''}</td>
        <td class="amt ${typeClass}">${formatCurrency(tx.amount, tx.currency)}</td>
        <td class="amt ${balClass} fs-12">${formatCurrency(rowBal, acc.currency)}</td>
        <td class="tx-actions"><button class="tx-edit-btn icon-btn" data-import-id="${escapeHtml(tx.import_id)}" title="${editLabel}" aria-label="${editLabel}">✎</button><button class="tx-edit-btn icon-btn" data-duplicate-id="${escapeHtml(tx.import_id)}" title="${duplicateLabel}" aria-label="${duplicateLabel}">⧉</button><button class="tx-edit-btn icon-btn btn-delete-sm" data-delete-id="${escapeHtml(tx.import_id)}" title="${deleteLabel}" aria-label="${deleteLabel}">✕</button></td>
      </tr>
    `;
  }).join('');

  // Build filter toolbar (same fields as TX page, minus Account)
  const types = ['expense', 'income', 'transfer'];
  const allCats = [...new Set(allAccountTx.map(t => t.category).filter(Boolean))].sort();
  const topCats = [...new Set(allCats.map(c => c.split(':')[0]))].sort();
  const allTags = [...new Set(allAccountTx.flatMap(t => (t.tags || '').split(';').filter(Boolean)))].sort();
  const allPayees = [...new Set(allAccountTx.map(t => t.payee).filter(Boolean))].sort();
  const hasActiveFilters = accountPage.filterType || accountPage.filterCategory || accountPage.filterTags.length > 0 || accountPage.filterDateFrom || accountPage.filterDateTo || accountPage.filterAmountMin || accountPage.filterAmountMax || accountPage.filterPayee;

  const filterBar = `
    <div class="report-toolbar" style="flex-wrap:wrap;gap:6px 12px;margin-bottom:12px;">
      <label>${t('tx.filter.type', {}, 'Type')}</label>
      <select id="accp-type">
        <option value="">${t('tx.filter.all', {}, 'All')}</option>
        ${types.map(tt => `<option value="${tt}" ${accountPage.filterType === tt ? 'selected' : ''}>${tt}</option>`).join('')}
      </select>
      <label>${t('tx.filter.category', {}, 'Category')}</label>
      <select id="accp-category">
        <option value="">${t('tx.filter.all', {}, 'All')}</option>
        ${topCats.map(top => {
          const subs = allCats.filter(c => c === top || c.startsWith(top + ':'));
          const topOpt = `<option value="${escapeHtml(top)}" ${accountPage.filterCategory === top ? 'selected' : ''}>${t('tx.filter.category_all_suffix', { name: escapeHtml(top) }, `${escapeHtml(top)} (all)`)}</option>`;
          const subOpts = subs.filter(c => c !== top).map(c => `<option value="${escapeHtml(c)}" ${accountPage.filterCategory === c ? 'selected' : ''}>&nbsp;&nbsp;— ${escapeHtml(c)}</option>`).join('');
          return topOpt + subOpts;
        }).join('')}
      </select>
    </div>
    ${allTags.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:12px;">
      <span class="fs-12 c-mut2" style="margin-right:4px;">${t('tx.filter.tags', {}, 'Tags')}</span>
      ${allTags.map(tag => `<button class="accp-tag-chip ${accountPage.filterTags.includes(tag) ? 'active' : ''}" data-tag="${escapeHtml(tag)}" style="padding:3px 10px;font-size:10px;border-radius:12px;">${escapeHtml(tag)}</button>`).join('')}
    </div>` : ''}
    <div class="report-toolbar" style="flex-wrap:wrap;gap:6px 12px;margin-bottom:12px;">
      <label>${t('tx.filter.from', {}, 'From')}</label>
      <input type="date" id="accp-date-from" value="${accountPage.filterDateFrom}" class="input-compact">
      <label>${t('tx.filter.to', {}, 'To')}</label>
      <input type="date" id="accp-date-to" value="${accountPage.filterDateTo}" class="input-compact">
      <label>${t('tx.filter.payee', {}, 'Payee')}</label>
      <input type="text" id="accp-payee" list="accp-payee-list" value="${escapeHtml(accountPage.filterPayee)}" placeholder="${t('search.placeholder', {}, 'Search...')}" autocomplete="off" style="width:180px;padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
      <datalist id="accp-payee-list">${allPayees.map(p => `<option value="${escapeHtml(p)}">`).join('')}</datalist>
      <label>${t('tx.filter.amount', {}, 'Amount')}</label>
      <input type="text" id="accp-amt-min" value="${escapeHtml(String(accountPage.filterAmountMin || ''))}" placeholder="${t('tx.filter.amount_min', {}, 'min')}" style="width:90px;padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
      <input type="text" id="accp-amt-max" value="${escapeHtml(String(accountPage.filterAmountMax || ''))}" placeholder="${t('tx.filter.amount_max', {}, 'max')}" style="width:90px;padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
      ${hasActiveFilters ? `<button id="accp-reset" style="padding:5px 12px;font-size:12px;">${t('accp.reset_filters', {}, 'Reset filters')}</button>` : ''}
    </div>
  `;

  const txCountKey = total === 1 ? 'accp.tx_count_one' : 'accp.tx_count_many';
  const txCountFb = total === 1 ? '1 Transaction' : `${total} Transactions`;
  contentEl.innerHTML = `
    <div class="section">
      ${filterBar}
      <div class="section-title">${t(txCountKey, { n: total }, txCountFb)}${hasActiveFilters ? ` <span class="hint">${t('accp.filtered_from', { n: allAccountTx.length }, `(filtered from ${allAccountTx.length})`)}</span>` : ''}</div>
      <table class="tx-table">
        <thead>
          <tr><th>${t('tx.table.col_date', {}, 'Date')}</th><th>${t('tx.table.col_payee_transfer', {}, 'Payee / Transfer')}</th><th>${t('tx.table.col_category_tags', {}, 'Category / Tags')}</th><th class="amt">${t('tx.table.col_amount', {}, 'Amount')}</th><th class="amt">${t('tx.table.col_balance', {}, 'Balance')}</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${totalPages > 1 ? `
        <div class="pagination">
          <button id="acc-prev" ${currentPage === 0 ? 'disabled' : ''}>${t('tx.pagination.prev', {}, '← Previous')}</button>
          <span class="page-info">${t('tx.pagination.page_info', { start: start + 1, end: Math.min(start + pageSize, total), total }, `${start + 1}–${Math.min(start + pageSize, total)} of ${total}`)}</span>
          <button id="acc-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>${t('tx.pagination.next', {}, 'Next →')}</button>
        </div>
      ` : ''}
    </div>
  `;

  // Event delegation for account detail page (registered once)
  if (!contentEl._delegated) {
    contentEl.addEventListener('click', (e) => {
      if (e.target.id === 'acc-prev') { accountPage.page--; renderAccountPage(); return; }
      if (e.target.id === 'acc-next') { accountPage.page++; renderAccountPage(); return; }
      // Tag chip toggle
      const tagChip = e.target.closest('.accp-tag-chip');
      if (tagChip) {
        const tag = tagChip.getAttribute('data-tag');
        const idx = accountPage.filterTags.indexOf(tag);
        if (idx >= 0) accountPage.filterTags.splice(idx, 1);
        else accountPage.filterTags.push(tag);
        accountPage.page = 0;
        renderAccountPage();
        return;
      }
      // Reset filters
      if (e.target.id === 'accp-reset') {
        accountPage.filterType = ''; accountPage.filterCategory = '';
        accountPage.filterTags = []; accountPage.filterDateFrom = '';
        accountPage.filterDateTo = ''; accountPage.filterAmountMin = '';
        accountPage.filterAmountMax = ''; accountPage.filterPayee = '';
        accountPage.page = 0;
        renderAccountPage();
        return;
      }
      const editBtn = e.target.closest('.tx-edit-btn[data-import-id]');
      if (editBtn) {
        const tx = state.tx.find(t => t.import_id === editBtn.getAttribute('data-import-id'));
        if (tx) openEditModal(tx);
        return;
      }
      const dupBtn = e.target.closest('.tx-edit-btn[data-duplicate-id]');
      if (dupBtn) {
        const tx = state.tx.find(t => t.import_id === dupBtn.getAttribute('data-duplicate-id'));
        if (tx) duplicateTx(tx);
        return;
      }
      const delBtn = e.target.closest('.btn-delete-sm[data-delete-id]');
      if (delBtn) { deleteTx(delBtn.getAttribute('data-delete-id')); return; }
    });
    contentEl.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === 'accp-type') { accountPage.filterType = e.target.value; accountPage.page = 0; renderAccountPage(); }
      else if (id === 'accp-category') { accountPage.filterCategory = e.target.value; accountPage.page = 0; renderAccountPage(); }
      else if (id === 'accp-date-from') { accountPage.filterDateFrom = e.target.value; accountPage.page = 0; renderAccountPage(); }
      else if (id === 'accp-date-to') { accountPage.filterDateTo = e.target.value; accountPage.page = 0; renderAccountPage(); }
      else if (id === 'accp-amt-min') { accountPage.filterAmountMin = e.target.value; accountPage.page = 0; renderAccountPage(); }
      else if (id === 'accp-amt-max') { accountPage.filterAmountMax = e.target.value; accountPage.page = 0; renderAccountPage(); }
      else if (id === 'accp-payee') { accountPage.filterPayee = e.target.value; accountPage.page = 0; renderAccountPage(); }
    });
    contentEl._delegated = true;
  }
}

function exportAccountTx(alias) {
  const txForAccount = state.tx.filter(t =>
    t.account === alias || (t.type === 'transfer' && t.transfer_to_account === alias)
  ).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const data = txForAccount.map(t => ({
    Date: t.date,
    Type: t.type,
    Payee: t.payee || '',
    Category: t.category || '',
    Amount: t.amount,
    Currency: t.currency,
    Tags: t.tags || '',
    Note: t.note || '',
  }));
  exportXlsx(data, `account_${alias}_${new Date().toISOString().slice(0,10)}`, alias);
}

