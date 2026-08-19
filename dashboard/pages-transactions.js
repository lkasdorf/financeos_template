// ─── Transactions Page ───────────────────────────────────────────────────

let txPage = {
  page: 0, PAGE_SIZE: 100, sortCol: 'date', sortAsc: false,
  filterType: '', filterAccount: '', filterCategory: '', filterTags: [],
  filterDateFrom: '', filterDateTo: '', filterAmountMin: '', filterAmountMax: '',
  filterPayee: '',
  filterUncategorized: false,  // Show only TX with both type and category empty
  selected: new Set(),  // import_ids of selected rows
};

// ─── Filter Presets (E4) ────────────────────────────────────────────────

function loadFilterPresets() {
  try { return JSON.parse(localStorage.getItem('lp-filter-presets') || '[]'); } catch { return []; }
}
function saveFilterPresets(presets) {
  localStorage.setItem('lp-filter-presets', JSON.stringify(presets));
}
function applyFilterPreset(preset) {
  txPage.filterType = preset.filterType || '';
  txPage.filterAccount = preset.filterAccount || '';
  txPage.filterCategory = preset.filterCategory || '';
  txPage.filterTags = preset.filterTags || [];
  txPage.filterDateFrom = preset.filterDateFrom || '';
  txPage.filterDateTo = preset.filterDateTo || '';
  txPage.filterAmountMin = preset.filterAmountMin || '';
  txPage.filterAmountMax = preset.filterAmountMax || '';
  txPage.filterPayee = preset.filterPayee || '';
  txPage.filterUncategorized = !!preset.filterUncategorized;
  txPage.page = 0;
  txPage.selected.clear();
  renderTransactionsPage();
}
function getCurrentFilterState() {
  return {
    filterType: txPage.filterType, filterAccount: txPage.filterAccount,
    filterCategory: txPage.filterCategory, filterTags: [...txPage.filterTags],
    filterDateFrom: txPage.filterDateFrom, filterDateTo: txPage.filterDateTo,
    filterAmountMin: txPage.filterAmountMin, filterAmountMax: txPage.filterAmountMax,
    filterPayee: txPage.filterPayee,
    filterUncategorized: txPage.filterUncategorized,
  };
}

function renderTransactionsPage() {
  const metaEl = document.getElementById('tx-page-meta');
  const contentEl = document.getElementById('tx-page-content');

  // Filter
  let filtered = state.tx.slice();
  if (txPage.filterType) filtered = filtered.filter(t => t.type === txPage.filterType);
  if (txPage.filterAccount) filtered = filtered.filter(t => t.account === txPage.filterAccount || (t.type === 'transfer' && t.transfer_to_account === txPage.filterAccount));
  if (txPage.filterCategory) {
    const fc = txPage.filterCategory;
    if (fc.includes(':')) {
      // Exact subcategory match
      filtered = filtered.filter(t => (t.category || '') === fc);
    } else {
      // Top-level: match the top-level itself or any subcategory under it
      filtered = filtered.filter(t => {
        const c = t.category || '';
        return c === fc || c.startsWith(fc + ':');
      });
    }
  }
  if (txPage.filterTags.length > 0) filtered = filtered.filter(t => {
    const txTags = (t.tags || '').split(';').filter(Boolean);
    return txPage.filterTags.some(ft => txTags.includes(ft));
  });
  if (txPage.filterDateFrom) filtered = filtered.filter(t => t.date >= txPage.filterDateFrom);
  if (txPage.filterDateTo) filtered = filtered.filter(t => t.date <= txPage.filterDateTo);
  if (txPage.filterAmountMin) filtered = filtered.filter(t => t.amount >= parseFloat(txPage.filterAmountMin));
  if (txPage.filterAmountMax) filtered = filtered.filter(t => t.amount <= parseFloat(txPage.filterAmountMax));
  if (txPage.filterPayee) {
    const pq = txPage.filterPayee.toLowerCase();
    filtered = filtered.filter(t => (t.payee || '').toLowerCase().includes(pq));
  }
  if (txPage.filterUncategorized) {
    filtered = filtered.filter(t => !t.type && !t.category);
  }

  // Sort
  filtered.sort((a, b) => {
    let va = a[txPage.sortCol] || '', vb = b[txPage.sortCol] || '';
    if (txPage.sortCol === 'amount') { va = a.amount; vb = b.amount; }
    if (va < vb) return txPage.sortAsc ? -1 : 1;
    if (va > vb) return txPage.sortAsc ? 1 : -1;
    // Tiebreak: CSV row order — newest (appended) rows win when sort is desc
    const oa = a._ord || 0, ob = b._ord || 0;
    return txPage.sortAsc ? oa - ob : ob - oa;
  });

  const total = filtered.length;
  const pageSize = txPage.PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(txPage.page, totalPages - 1);
  const start = currentPage * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  const accounts = state.accounts.map(a => a.alias).sort();
  const types = ['expense', 'income', 'transfer'];

  // Collect unique categories and tags for dropdowns
  const allCats = [...new Set(state.tx.map(t => t.category).filter(Boolean))].sort();
  // Top-level categories for grouping
  const topCats = [...new Set(allCats.map(c => c.split(':')[0]))].sort();
  const allTags = [...new Set(state.tx.flatMap(t => (t.tags || '').split(';').filter(Boolean)))].sort();
  const allPayees = [...new Set(state.tx.map(t => t.payee).filter(Boolean))].sort();

  // Sum of filtered amounts. DP-M2: convert per row into the display
  // currency — filters can select mixed-currency TX (tag/date filters
  // without an account), and raw sums labelled 'TZS' were nonsense
  // (15 EUR + 45.000 TZS = '45.015 TZS').
  const sumIncome = filtered.filter(t => t.type === 'income')
    .reduce((s, t) => s + convertTo(t.amount, t.currency, displayCurrency), 0);
  const sumExpense = filtered.filter(t => t.type === 'expense')
    .reduce((s, t) => s + convertTo(t.amount, t.currency, displayCurrency), 0);

  // Store filtered set for export
  txPage._filtered = filtered;
  const metaKey = total === 1 ? 'txp.meta_count_one' : 'txp.meta_count_many';
  const metaFb = total === 1 ? '1 transaction' : `${total} transactions`;
  metaEl.innerHTML = `<span>${t(metaKey, { n: total }, metaFb)}</span>`;

  const sortIcon = (col) => txPage.sortCol === col ? (txPage.sortAsc ? ' ↑' : ' ↓') : '';

  // Prune selected set to only valid import_ids
  const validIds = new Set(filtered.map(t => t.import_id));
  for (const id of txPage.selected) { if (!validIds.has(id)) txPage.selected.delete(id); }

  // Map var renamed from `t` to `tx` so the global t() i18n function is not
  // shadowed inside the callback (same pattern as renderRecentTx).
  const editLabel = t('tx.actions.edit', {}, 'Edit');
  const duplicateLabel = t('tx.actions.duplicate', {}, 'Duplicate');
  const deleteLabel = t('tx.actions.delete', {}, 'Delete');
  const transferLabel = t('dashboard.recent.transfer_category', {}, 'Transfer');

  // Receipt-split markers. The counter is derived from the full set so a
  // group shows "2/3" even when the page or an active filter only holds
  // part of it. The connecting bar, by contrast, is drawn from adjacency
  // in the rendered slice: sorting by amount tears groups apart, and
  // re-ordering rows to keep them together would silently override the
  // sort the user asked for.
  // The index is assigned in booking order (the order state.tx holds), not
  // in render order — otherwise "1/3" would mean "whichever line the
  // current sort happened to show first", which is not a fact about the
  // receipt.
  // Pass-through counter-entries inherit the receipt_group of the expense
  // they mirror, but they are the backend's twin of the whole group, not a
  // slice of the receipt — counting them would report a 2-line split as
  // "1/3". Same exclusion the group editor and _sync_group_counter use.
  const groupCounts = {};
  const groupIndex = {};
  state.tx.forEach(row => {
    const g = (row.receipt_group || '').trim();
    if (!g || (row.counter_entry_id || '').trim()) return;
    groupCounts[g] = (groupCounts[g] || 0) + 1;
    groupIndex[row.import_id] = groupCounts[g];
  });

  const rows = slice.map((tx, rowIdx) => {
    const isChecked = txPage.selected.has(tx.import_id);
    const grp = (tx.counter_entry_id || '').trim()
      ? '' : (tx.receipt_group || '').trim();
    const grpTotal = grp ? (groupCounts[grp] || 0) : 0;
    let grpIdx = 0;
    let grpClass = '';
    if (grp && grpTotal > 1) {
      grpIdx = groupIndex[tx.import_id] || 0;
      const prevSame = rowIdx > 0
        && (slice[rowIdx - 1].receipt_group || '').trim() === grp;
      const nextSame = rowIdx < slice.length - 1
        && (slice[rowIdx + 1].receipt_group || '').trim() === grp;
      if (prevSame && nextSame) grpClass = 'grp-mid';
      else if (nextSame) grpClass = 'grp-first';
      else if (prevSame) grpClass = 'grp-last';
    }
    const grpBadge = grpTotal > 1
      ? `<span class="split-badge grp-badge" title="${escapeHtml(t('tx.list.group_title', { i: grpIdx, n: grpTotal }, `Part ${grpIdx} of ${grpTotal} of one receipt`))}">${escapeHtml(t('tx.list.group_badge', { i: grpIdx, n: grpTotal }, `${grpIdx}/${grpTotal}`))}</span>`
      : '';
    const tags = (tx.tags || '').split(';').filter(Boolean).map(x => `<span class="tag-chip">${escapeHtml(x)}</span>`).join('');
    let payeeLabel;
    if (tx.type === 'transfer') {
      payeeLabel = `${escapeHtml(tx.account)} → ${escapeHtml(tx.transfer_to_account || '?')}`;
    } else {
      payeeLabel = escapeHtml(tx.payee || '');
    }
    const rawCat = tx.category || '';
    const catOrType = tx.type === 'transfer' ? transferLabel : (rawCat ? `<span class="cat-link" data-cat="${escapeHtml(rawCat)}">${escapeHtml(rawCat)}</span>` : '');
    const typeClass = tx.type;
    const noteFull = tx.note || '';
    const noteShort = noteFull.length > 80 ? noteFull.slice(0, 79) + '…' : noteFull;
    const note = noteFull ? `<div class="tx-note" title="${escapeHtml(noteFull)}">${escapeHtml(noteShort)}</div>` : '';
    // v1.6.0 — 📎 indicator for TXs with attached receipts. Click opens the
    // read-only preview modal (renderAttachmentGrid from receipts.js).
    const receiptUrls = parseReceiptList(tx.receipt_url || '');
    const receiptIcon = receiptUrls.length
      ? `<button type="button" class="tx-receipt-icon" data-action="showTxReceipts" data-arg1="${escapeHtml(tx.import_id)}" title="${escapeHtml(t('receipts.tx_list.icon_alt', { n: receiptUrls.length }, `${receiptUrls.length} attachment${receiptUrls.length === 1 ? '' : 's'}`))}">📎</button>`
      : '';
    const fxTitle = t('tx.fx_converted_title', { date: tx.date }, `Converted using FX rate on ${tx.date} (fallback: month rate)`);
    // td-* classes drive the mobile card-layout rules in styles.css —
    // the same <tr> reshuffles into a grid on phones via `display: grid`
    // + `grid-template-areas`. Don't rename without updating the CSS.
    return `
      <tr class="${isChecked ? 'row-selected' : ''} ${grpClass}">
        <td class="td-chk"><input type="checkbox" class="tx-select" data-id="${escapeHtml(tx.import_id)}" ${isChecked ? 'checked' : ''}></td>
        <td class="td-date">${fmtDate(tx.date)}</td>
        <td class="td-account">${escapeHtml(tx.account)}</td>
        <td class="td-type fs-10 c-mut2">${tx.type}</td>
        <td class="td-payee">${payeeLabel}${receiptIcon}${note}</td>
        <td class="td-cat cat">${catOrType}${grpBadge}</td>
        <td class="td-tags">${tags}</td>
        <td class="td-amount amt ${typeClass}">${formatCurrency(tx.amount, tx.currency)}</td>
        <td class="td-ccy hint-sm">${tx.currency}</td>
        <td class="td-eur amt c-mut2" title="${escapeHtml(fxTitle)}">${tx.currency === 'EUR' ? '' : formatCurrency(convertToEur(tx.amount, tx.currency, tx.date), 'EUR') + ' €'}</td>
        <td class="td-actions tx-actions">${receiptUrls.length ? `<button class="tx-edit-btn icon-btn" data-action="showTxReceipts" data-arg1="${escapeHtml(tx.import_id)}" title="${escapeHtml(t('receipts.tx_list.btn_title', {}, 'Show attachments'))}" aria-label="${escapeHtml(t('receipts.tx_list.btn_title', {}, 'Show attachments'))}">📎</button>` : ''}<button class="tx-edit-btn icon-btn" data-import-id="${escapeHtml(tx.import_id)}" title="${editLabel}" aria-label="${editLabel}">✎</button><button class="tx-edit-btn icon-btn" data-duplicate-id="${escapeHtml(tx.import_id)}" title="${duplicateLabel}" aria-label="${duplicateLabel}">⧉</button><button class="tx-edit-btn icon-btn btn-delete-sm" data-delete-id="${escapeHtml(tx.import_id)}" title="${deleteLabel}" aria-label="${deleteLabel}">✕</button></td>
      </tr>
    `;
  }).join('');

  const hasActiveFilters = txPage.filterType || txPage.filterAccount || txPage.filterCategory || txPage.filterTags.length > 0 || txPage.filterDateFrom || txPage.filterDateTo || txPage.filterAmountMin || txPage.filterAmountMax || txPage.filterPayee || txPage.filterUncategorized;

  // Count of uncategorized TX (both type and category empty), used in the
  // toggle label so the user sees how much triage work is left at a glance.
  const uncategorizedCount = state.tx.filter(t => !t.type && !t.category).length;

  contentEl.innerHTML = `
    <div class="report-toolbar txp-toolbar">
      <label>${t('tx.filter.type', {}, 'Type')}</label>
      <select id="txp-type">
        <option value="">${t('tx.filter.all', {}, 'All')}</option>
        ${types.map(tt => `<option value="${tt}" ${txPage.filterType === tt ? 'selected' : ''}>${tt}</option>`).join('')}
      </select>
      <label>${t('tx.filter.account', {}, 'Account')}</label>
      <select id="txp-account">
        <option value="">${t('tx.filter.all', {}, 'All')}</option>
        ${accounts.map(a => `<option value="${escapeHtml(a)}" ${txPage.filterAccount === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
      </select>
      <label>${t('tx.filter.category', {}, 'Category')}</label>
      <select id="txp-category">
        <option value="">${t('tx.filter.all', {}, 'All')}</option>
        ${topCats.map(top => {
          const subs = allCats.filter(c => c === top || c.startsWith(top + ':'));
          const topOpt = `<option value="${escapeHtml(top)}" ${txPage.filterCategory === top ? 'selected' : ''}>${t('tx.filter.category_all_suffix', { name: escapeHtml(top) }, `${escapeHtml(top)} (all)`)}</option>`;
          const subOpts = subs.filter(c => c !== top).map(c => `<option value="${escapeHtml(c)}" ${txPage.filterCategory === c ? 'selected' : ''}>&nbsp;&nbsp;— ${escapeHtml(c)}</option>`).join('');
          return topOpt + subOpts;
        }).join('')}
      </select>
      ${uncategorizedCount > 0 ? `
      <label class="chk-row">
        <input type="checkbox" id="txp-uncat" ${txPage.filterUncategorized ? 'checked' : ''}>
        <span class="fs-12">${t('txp.uncategorized_only', { n: uncategorizedCount }, `Uncategorized only (${uncategorizedCount})`)}</span>
      </label>
      ` : ''}
      <span class="toolbar-spacer"></span>
      ${hasActiveFilters ? `<button id="txp-save-preset" title="${t('txp.save_preset_title', {}, 'Save current filters as preset')}">${t('txp.save_preset', {}, 'Save Preset')}</button>` : ''}
      <select id="txp-presets" class="input-compact">
        <option value="">${t('txp.presets_default', {}, 'Presets')}</option>
        ${loadFilterPresets().map((p, i) => `<option value="${i}">${escapeHtml(p.name)}</option>`).join('')}
      </select>
      ${loadFilterPresets().length > 0 ? `<button id="txp-delete-preset" title="${t('txp.delete_preset_title', {}, 'Delete selected preset')}" aria-label="${t('txp.delete_preset_title', {}, 'Delete selected preset')}">×</button>` : ''}
    </div>
    <div class="report-toolbar txp-toolbar">
      <label>${t('tx.filter.from', {}, 'From')}</label>
      <input type="date" id="txp-date-from" value="${txPage.filterDateFrom}" class="input-compact">
      <label>${t('tx.filter.to', {}, 'To')}</label>
      <input type="date" id="txp-date-to" value="${txPage.filterDateTo}" class="input-compact">
      <label>${t('tx.filter.payee', {}, 'Payee')}</label>
      <input type="text" id="txp-payee" list="txp-payee-list" value="${escapeHtml(txPage.filterPayee)}" placeholder="${t('search.placeholder', {}, 'Search...')}" autocomplete="off" class="txp-payee">
      <datalist id="txp-payee-list">${allPayees.map(p => `<option value="${escapeHtml(p)}">`).join('')}</datalist>
      <label>${t('tx.filter.amount', {}, 'Amount')}</label>
      <input type="text" inputmode="numeric" id="txp-amt-min" value="${escapeHtml(txPage.filterAmountMin)}" placeholder="${t('tx.filter.amount_min', {}, 'min')}" class="txp-amt">
      <span class="c-mut">–</span>
      <input type="text" inputmode="numeric" id="txp-amt-max" value="${escapeHtml(txPage.filterAmountMax)}" placeholder="${t('tx.filter.amount_max', {}, 'max')}" class="txp-amt">
      ${hasActiveFilters ? `<button id="txp-reset">${t('txp.reset', {}, 'Reset')}</button>` : ''}
      <span class="toolbar-spacer"></span>
      <button id="txp-export">${t('txp.export_xlsx', {}, 'Export XLSX')}</button>
    </div>
    <div class="txp-tag-row">
      <span class="fs-12 c-mut2">${t('tx.filter.tags', {}, 'Tags')}</span>
      ${allTags.map(tag => `<button class="txp-tag-chip ${txPage.filterTags.includes(tag) ? 'active' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')}
    </div>
    ${hasActiveFilters ? `
    <div class="income-grid mb-16" style="grid-template-columns:repeat(3,1fr);">
      <div class="income-cell"><div class="ic-label">${t('txp.sum_income', {}, 'Income')}</div><div class="ic-value c-pos">${formatCurrency(sumIncome, displayCurrency)} <span class="ic-cur">${displayCurrency}</span></div></div>
      <div class="income-cell"><div class="ic-label">${t('txp.sum_expenses', {}, 'Expenses')}</div><div class="ic-value c-neg">${formatCurrency(sumExpense, displayCurrency)} <span class="ic-cur">${displayCurrency}</span></div></div>
      <div class="income-cell"><div class="ic-label">${t('txp.sum_net', {}, 'Net')}</div><div class="ic-value" style="color:${sumIncome - sumExpense >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(sumIncome - sumExpense, displayCurrency)} <span class="ic-cur">${displayCurrency}</span></div></div>
    </div>
    ` : ''}
    ${txPage.selected.size > 0 ? `
    <div class="bulk-bar">
      <span class="bulk-count">${t('txp.bulk_count', { n: txPage.selected.size }, `${txPage.selected.size} selected`)}</span>
      <button id="bulk-tag" class="bulk-btn">${t('txp.bulk_tag', {}, 'Tag')}</button>
      <div class="bulk-edit-wrap" style="position:relative;display:inline-block;">
        <button id="bulk-edit" class="bulk-btn">${t('txp.bulk_edit', {}, 'Edit')} <span style="font-size:9px;">▾</span></button>
        <div id="bulk-edit-menu" class="bulk-edit-menu" hidden>
          <button data-bulk-op="property" class="bulk-edit-item">${t('txp.bulk_op.property', {}, 'Set Property…')}</button>
          <button data-bulk-op="property-remove" class="bulk-edit-item">${t('txp.bulk_op.property_remove', {}, 'Remove Property…')}</button>
          <button data-bulk-op="subscription" class="bulk-edit-item">${t('txp.bulk_op.subscription', {}, 'Link Subscription…')}</button>
          <button data-bulk-op="subscription-unlink" class="bulk-edit-item">${t('txp.bulk_op.subscription_unlink', {}, 'Unlink Subscription')}</button>
          <button data-bulk-op="payee" class="bulk-edit-item">${t('txp.bulk_op.payee', {}, 'Change Payee…')}</button>
          <button data-bulk-op="account" class="bulk-edit-item">${t('txp.bulk_op.account', {}, 'Move to Account…')}</button>
        </div>
      </div>
      <button id="bulk-delete" class="bulk-btn bulk-btn-danger">${t('txp.bulk_delete', {}, 'Delete')}</button>
      <button id="bulk-clear" class="bulk-btn">${t('txp.bulk_clear', {}, 'Deselect All')}</button>
    </div>` : ''}
    <div class="section">
      <table class="tx-table">
        <thead>
          <tr>
            <th class="td-chk"><input type="checkbox" id="txp-select-all" ${slice.length > 0 && slice.every(tx => txPage.selected.has(tx.import_id)) ? 'checked' : ''}></th>
            <th class="sortable" data-col="date">${t('tx.table.col_date', {}, 'Date')}${sortIcon('date')}</th>
            <th class="sortable" data-col="account">${t('tx.table.col_account', {}, 'Account')}${sortIcon('account')}</th>
            <th>${t('tx.table.col_type', {}, 'Type')}</th>
            <th class="sortable" data-col="payee">${t('tx.table.col_payee_note', {}, 'Payee / Note')}${sortIcon('payee')}</th>
            <th class="sortable" data-col="category">${t('tx.table.col_category', {}, 'Category')}${sortIcon('category')}</th>
            <th>${t('tx.table.col_tags', {}, 'Tags')}</th>
            <th class="amt sortable" data-col="amount">${t('tx.table.col_amount', {}, 'Amount')}${sortIcon('amount')}</th>
            <th></th>
            <th class="amt">${t('tx.table.col_eur', {}, 'EUR')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${totalPages > 1 ? `
        <div class="pagination">
          <button id="txp-prev" ${currentPage === 0 ? 'disabled' : ''}>${t('tx.pagination.prev', {}, '← Previous')}</button>
          <span class="page-info">${t('tx.pagination.page_info', { start: start + 1, end: Math.min(start + pageSize, total), total }, `${start + 1}–${Math.min(start + pageSize, total)} of ${total}`)}</span>
          <button id="txp-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>${t('tx.pagination.next', {}, 'Next →')}</button>
        </div>
      ` : ''}
    </div>
  `;

  // Event delegation: single listener handles all interactions
  if (!contentEl._delegated) {
    contentEl.addEventListener('click', async (e) => {
      // Sort headers
      const sortTh = e.target.closest('.sortable');
      if (sortTh) {
        const col = sortTh.getAttribute('data-col');
        if (txPage.sortCol === col) txPage.sortAsc = !txPage.sortAsc;
        else { txPage.sortCol = col; txPage.sortAsc = true; }
        txPage.page = 0;
        renderTransactionsPage();
        return;
      }
      // Pagination
      if (e.target.id === 'txp-prev') { txPage.page--; renderTransactionsPage(); return; }
      if (e.target.id === 'txp-next') { txPage.page++; renderTransactionsPage(); return; }
      // v1.6.0 — receipt-icon click in the payee cell. Opens a read-only
      // modal with thumbnails; clicks inside the grid open the lightbox /
      // PDF embed from receipts.js.
      const rcptBtn = e.target.closest('[data-action="showTxReceipts"]');
      if (rcptBtn) {
        e.preventDefault();
        e.stopPropagation();
        const tx = state.tx.find(t => t.import_id === rcptBtn.getAttribute('data-arg1'));
        if (tx) _openTxReceiptsModal(tx);
        return;
      }
      // Edit button
      const editBtn = e.target.closest('.tx-edit-btn[data-import-id]');
      if (editBtn) {
        const tx = state.tx.find(t => t.import_id === editBtn.getAttribute('data-import-id'));
        if (tx) openEditModal(tx);
        return;
      }
      // Duplicate button
      const dupBtn = e.target.closest('.tx-edit-btn[data-duplicate-id]');
      if (dupBtn) {
        const tx = state.tx.find(t => t.import_id === dupBtn.getAttribute('data-duplicate-id'));
        if (tx) duplicateTx(tx);
        return;
      }
      // Delete button
      const delBtn = e.target.closest('.btn-delete-sm[data-delete-id]');
      if (delBtn) { deleteTx(delBtn.getAttribute('data-delete-id')); return; }
      // Export button
      if (e.target.id === 'txp-export' || e.target.closest('#txp-export')) {
        exportTransactions();
        return;
      }
      // Tag chip toggle
      const tagChip = e.target.closest('.txp-tag-chip');
      if (tagChip) {
        const tag = tagChip.getAttribute('data-tag');
        const idx = txPage.filterTags.indexOf(tag);
        if (idx >= 0) txPage.filterTags.splice(idx, 1);
        else txPage.filterTags.push(tag);
        txPage.page = 0;
        renderTransactionsPage();
        return;
      }
      // Category drill-down
      const catLink = e.target.closest('.cat-link');
      if (catLink) {
        txPage.filterCategory = catLink.getAttribute('data-cat');
        txPage.page = 0;
        renderTransactionsPage();
        return;
      }
      // Reset filters
      if (e.target.id === 'txp-reset') {
        txPage.filterType = ''; txPage.filterAccount = ''; txPage.filterCategory = '';
        txPage.filterTags = []; txPage.filterDateFrom = ''; txPage.filterDateTo = '';
        txPage.filterAmountMin = ''; txPage.filterAmountMax = ''; txPage.filterPayee = '';
        txPage.filterUncategorized = false;
        txPage.page = 0; txPage.selected.clear();
        renderTransactionsPage();
        return;
      }
      // Save filter preset
      if (e.target.id === 'txp-save-preset') {
        const name = await uiPrompt(t('pages.txbulk.prompt.preset_name', {}, 'Preset name:'));
        if (!name) return;
        const presets = loadFilterPresets();
        presets.push({ name, ...getCurrentFilterState() });
        saveFilterPresets(presets);
        renderTransactionsPage();
        return;
      }
      // Delete preset
      if (e.target.id === 'txp-delete-preset') {
        const sel = contentEl.querySelector('#txp-presets');
        const idx = parseInt(sel?.value);
        if (isNaN(idx)) { uiAlert(t('pages.txbulk.alert.select_preset', {}, 'Select a preset first.')); return; }
        const presets = loadFilterPresets();
        if (await uiConfirm(t('pages.txbulk.confirm.delete_preset', { name: presets[idx]?.name }, `Delete preset "${presets[idx]?.name}"?`), { type: 'destructive' })) {
          presets.splice(idx, 1);
          saveFilterPresets(presets);
          renderTransactionsPage();
        }
        return;
      }
      // Bulk delete
      if (e.target.id === 'bulk-delete') {
        if (!(await uiConfirm(t('pages.txbulk.confirm.delete_tx', { count: txPage.selected.size }, `Delete ${txPage.selected.size} transactions? This cannot be undone.`), { type: 'destructive' }))) return;
        bulkDeleteSelected();
        return;
      }
      // Bulk tag
      if (e.target.id === 'bulk-tag') {
        openBulkTagModal();
        return;
      }
      // Bulk edit dropdown — toggles a small menu under the button.
      // The menu is dismissed on outside-click via a one-shot listener
      // installed when the menu opens, so we don't leak handlers.
      if (e.target.closest('#bulk-edit')) {
        const menu = contentEl.querySelector('#bulk-edit-menu');
        if (menu) {
          const wasHidden = menu.hidden;
          menu.hidden = !wasHidden;
          if (wasHidden) {
            const dismiss = (ev) => {
              if (!ev.target.closest('.bulk-edit-wrap')) {
                menu.hidden = true;
                document.removeEventListener('click', dismiss, true);
              }
            };
            // Defer so this same click doesn't immediately dismiss us.
            setTimeout(() => document.addEventListener('click', dismiss, true), 0);
          }
        }
        return;
      }
      // Bulk edit menu items
      const opBtn = e.target.closest('[data-bulk-op]');
      if (opBtn) {
        const menu = contentEl.querySelector('#bulk-edit-menu');
        if (menu) menu.hidden = true;
        const op = opBtn.dataset.bulkOp;
        if (op === 'property') openBulkPropertyModal();
        else if (op === 'property-remove') openBulkPropertyRemoveModal();
        else if (op === 'subscription') openBulkSubscriptionModal();
        else if (op === 'subscription-unlink') openBulkSubscriptionUnlinkModal();
        else if (op === 'payee') openBulkPayeeModal();
        else if (op === 'account') openBulkAccountModal();
        return;
      }
      // Bulk clear selection
      if (e.target.id === 'bulk-clear') {
        txPage.selected.clear();
        updateSelectionUI(contentEl);
        return;
      }
    });
    contentEl.addEventListener('change', (e) => {
      const id = e.target.id;
      // Row checkbox
      if (e.target.classList.contains('tx-select')) {
        const txId = e.target.getAttribute('data-id');
        if (e.target.checked) txPage.selected.add(txId); else txPage.selected.delete(txId);
        updateSelectionUI(contentEl);
        return;
      }
      // Select-all checkbox
      if (id === 'txp-select-all') {
        const rows = contentEl.querySelectorAll('.tx-select');
        rows.forEach(cb => {
          const txId = cb.getAttribute('data-id');
          if (e.target.checked) txPage.selected.add(txId); else txPage.selected.delete(txId);
        });
        updateSelectionUI(contentEl);
        return;
      }
      // Preset dropdown
      if (id === 'txp-presets') {
        const idx = parseInt(e.target.value);
        if (!isNaN(idx)) {
          const presets = loadFilterPresets();
          if (presets[idx]) applyFilterPreset(presets[idx]);
        }
        return;
      }
      txPage.page = 0;
      if (id === 'txp-type') { txPage.filterType = e.target.value; renderTransactionsPage(); }
      else if (id === 'txp-account') { txPage.filterAccount = e.target.value; renderTransactionsPage(); }
      else if (id === 'txp-category') { txPage.filterCategory = e.target.value; renderTransactionsPage(); }
      else if (id === 'txp-date-from') { txPage.filterDateFrom = e.target.value; renderTransactionsPage(); }
      else if (id === 'txp-date-to') { txPage.filterDateTo = e.target.value; renderTransactionsPage(); }
      else if (id === 'txp-amt-min') { txPage.filterAmountMin = e.target.value; renderTransactionsPage(); }
      else if (id === 'txp-amt-max') { txPage.filterAmountMax = e.target.value; renderTransactionsPage(); }
      else if (id === 'txp-payee') { txPage.filterPayee = e.target.value; renderTransactionsPage(); }
      else if (id === 'txp-uncat') { txPage.filterUncategorized = e.target.checked; renderTransactionsPage(); }
    });
    // Enter key triggers filter on amount/payee fields immediately
    contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target.id === 'txp-amt-min' || e.target.id === 'txp-amt-max' || e.target.id === 'txp-payee')) {
        e.preventDefault();
        e.target.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    // Debounced input for payee search only (amounts use change/Enter)
    let txpInputTimer = null;
    contentEl.addEventListener('input', (e) => {
      const id = e.target.id;
      if (id === 'txp-payee') {
        clearTimeout(txpInputTimer);
        txpInputTimer = setTimeout(() => {
          txPage.filterPayee = e.target.value;
          txPage.page = 0;
          renderTransactionsPage();
        }, 400);
      }
    });
    contentEl._delegated = true;
  }
}

// ─── Selection UI (lightweight DOM patch, no full re-render) ────────────

function updateSelectionUI(contentEl) {
  const count = txPage.selected.size;

  // Update row checkboxes + highlight
  contentEl.querySelectorAll('.tx-select').forEach(cb => {
    const id = cb.getAttribute('data-id');
    const checked = txPage.selected.has(id);
    cb.checked = checked;
    cb.closest('tr').classList.toggle('row-selected', checked);
  });

  // Update select-all checkbox
  const selectAll = contentEl.querySelector('#txp-select-all');
  if (selectAll) {
    const allCbs = contentEl.querySelectorAll('.tx-select');
    selectAll.checked = allCbs.length > 0 && [...allCbs].every(cb => cb.checked);
  }

  // Update or insert/remove bulk bar
  let bar = contentEl.querySelector('.bulk-bar');
  if (count > 0) {
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'bulk-bar';
      // Insert before the .section that contains the table
      const section = contentEl.querySelector('.section');
      if (section) contentEl.insertBefore(bar, section);
    }
    bar.innerHTML = `
      <span class="bulk-count">${count} selected</span>
      <button id="bulk-tag" class="bulk-btn">${t('txp.bulk_tag', {}, 'Tag')}</button>
      <div class="bulk-edit-wrap" style="position:relative;display:inline-block;">
        <button id="bulk-edit" class="bulk-btn">${t('txp.bulk_edit', {}, 'Edit')} <span style="font-size:9px;">▾</span></button>
        <div id="bulk-edit-menu" class="bulk-edit-menu" hidden>
          <button data-bulk-op="property" class="bulk-edit-item">${t('txp.bulk_op.property', {}, 'Set Property…')}</button>
          <button data-bulk-op="property-remove" class="bulk-edit-item">${t('txp.bulk_op.property_remove', {}, 'Remove Property…')}</button>
          <button data-bulk-op="subscription" class="bulk-edit-item">${t('txp.bulk_op.subscription', {}, 'Link Subscription…')}</button>
          <button data-bulk-op="subscription-unlink" class="bulk-edit-item">${t('txp.bulk_op.subscription_unlink', {}, 'Unlink Subscription')}</button>
          <button data-bulk-op="payee" class="bulk-edit-item">${t('txp.bulk_op.payee', {}, 'Change Payee…')}</button>
          <button data-bulk-op="account" class="bulk-edit-item">${t('txp.bulk_op.account', {}, 'Move to Account…')}</button>
        </div>
      </div>
      <button id="bulk-delete" class="bulk-btn bulk-btn-danger">${t('txp.bulk_delete', {}, 'Delete')}</button>
      <button id="bulk-clear" class="bulk-btn">${t('txp.bulk_clear', {}, 'Deselect All')}</button>
    `;
  } else if (bar) {
    bar.remove();
  }
}

// ─── Bulk Operations (E6) ───────────────────────────────────────────────

async function bulkDeleteSelected() {
  const ids = [...txPage.selected];
  try {
    const res = await fetch('/api/tx/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ import_ids: ids }),
    });
    const data = await res.json();
    if (data.error) {
      // 409 = at least one selected row hangs on a side log; the batch is
      // refused whole, so name the offenders instead of the raw id list.
      const err = res.status === 409
        ? t('tx.delete.protected',
            { lines: describeBlockedLines(data.blocked) || data.error },
            data.error)
        : data.error;
      uiAlert(t('pages.txbulk.err.delete_failed', { err }, `Bulk delete failed: ${err}`));
      return;
    }
    txPage.selected.clear();
    refreshData();
  } catch (e) {
    uiAlert(t('pages.txbulk.err.delete_failed', { err: e.message }, `Bulk delete failed: ${e.message}`));
  }
}

function openBulkTagModal() {
  const allTags = [...new Set(state.tx.flatMap(t => (t.tags || '').split(';').filter(Boolean)))].sort();
  // DP-M6: rides the shared bulk shell (which rides openModal) instead
  // of a fourth hand-rolled overlay with its own leaking esc handler.
  const tagChip = (cls, tag) => `<label style="display:flex;align-items:center;gap:4px;font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:6px;cursor:pointer;"><input type="checkbox" class="${cls}" value="${escapeHtml(tag)}"> ${escapeHtml(tag)}</label>`;
  const overlay = _bulkModalShell({
    title: `Bulk <span class="accent">Tag</span>`,
    applyLabel: t('common.actions.apply', {}, 'Apply'),
    bodyHtml: `
      <div class="mb-12">
        <label class="fs-12 lbl-block">Add tags:</label>
        <div id="bulk-tag-add" style="display:flex;flex-wrap:wrap;gap:4px;">
          ${allTags.map(tag => tagChip('bulk-add-tag', tag)).join('')}
        </div>
      </div>
      <div class="mb-12">
        <label class="fs-12 lbl-block">Remove tags:</label>
        <div id="bulk-tag-remove" style="display:flex;flex-wrap:wrap;gap:4px;">
          ${allTags.map(tag => tagChip('bulk-remove-tag', tag)).join('')}
        </div>
      </div>`,
  });

  overlay.querySelector('.bulk-modal-apply').addEventListener('click', async () => {
    const addTags = [...overlay.querySelectorAll('.bulk-add-tag:checked')].map(c => c.value);
    const removeTags = [...overlay.querySelectorAll('.bulk-remove-tag:checked')].map(c => c.value);
    if (!addTags.length && !removeTags.length) { uiAlert(t('pages.txbulk.alert.no_tags', {}, 'Select at least one tag to add or remove.')); return; }
    const statusEl = overlay.querySelector('#bulk-modal-status');
    statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('pages.txbulk.spinner.applying', {}, 'Applying...')}</div>`;
    try {
      const res = await fetch('/api/tx/batch-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_ids: [...txPage.selected], add_tags: addTags, remove_tags: removeTags }),
      });
      const data = await res.json();
      if (data.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(data.error)}</div>`; return; }
      overlay._close();
      txPage.selected.clear();
      refreshData();
    } catch (e) {
      statusEl.innerHTML = `<div class="atx-status error">${t('pages.txbulk.err.apply_failed', { err: escapeHtml(e.message) }, `Failed: ${escapeHtml(e.message)}`)}</div>`;
    }
  });
}

// ── Bulk Edit modals (v2026-05-15.5) ────────────────────────────────────
// Shared helper: build a centered modal shell on top of the central
// openModal() (DP-M6 — the old local shell leaked its esc handler on
// every click-out/cancel close). Returns the overlay so each modal can
// wire its own '.bulk-modal-apply' handler; close via overlay._close().
function _bulkModalShell({ title, bodyHtml, applyLabel }) {
  const { overlay } = openModal({
    title,
    maxWidth: '480px',
    bodyHtml: `
      <p class="fs-12 c-mut" style="margin:8px 0 16px;">${txPage.selected.size} transactions selected</p>
      ${bodyHtml}
      <div id="bulk-modal-status"></div>
      <div class="form-actions">
        <button type="button" data-modal-cancel>${t('common.actions.cancel', {}, 'Cancel')}</button>
        <button type="button" class="bulk-modal-apply" style="background:var(--accent);color:var(--bg);">${applyLabel}</button>
      </div>`,
  });
  return overlay;
}

function _setBulkStatus(overlay, kind, msg) {
  const el = overlay.querySelector('#bulk-modal-status');
  if (!el) return;
  if (!kind) { el.innerHTML = ''; return; }
  const html = kind === 'busy'
    ? `<div class="atx-status warning"><span class="atx-spinner"></span>${msg}</div>`
    : `<div class="atx-status ${kind === 'success' ? 'success' : 'error'}">${msg}</div>`;
  el.innerHTML = html;
}

function openBulkPropertyModal() {
  // Property assignment = adding the property's cost_tag
  // via the existing /api/tx/batch-tag endpoint. Same convention as the
  // Add-TX Property-Picker — property_id stays out of transactions.csv;
  // only the resolved tag lands on the row, so the cost-of-living report
  // picks it up via the standard tag filter.
  fetch('/api/properties/list', { method: 'POST' })
    .then(r => r.ok ? r.json() : { properties: [] })
    .then(data => {
      const rows = (data.properties || []).filter(p => p.active !== false);
      const opts = rows.length
        ? rows.map(p => `<option value="${escapeHtml(p.cost_tag || '')}" data-name="${escapeHtml(p.name || p.property_id)}">${escapeHtml(p.name || p.property_id)}${p.cost_tag ? ` (${escapeHtml(p.cost_tag)})` : ''}</option>`).join('')
        : `<option value="">${escapeHtml(t('txp.bulk_op.property_empty', {}, 'No active properties'))}</option>`;
      const overlay = _bulkModalShell({
        title: `${t('txp.bulk_op.property_title', {}, 'Set Property')}`,
        bodyHtml: `
          <label class="fs-12 lbl-block">${t('txp.bulk_op.property_label', {}, 'Property')}</label>
          <select id="bulk-prop-select" class="input-std">${opts}</select>
          <p class="fs-11 c-mut" style="margin:10px 0 0;">${t('txp.bulk_op.property_hint', {}, "Adds the property's cost_tag to every selected transaction.")}</p>`,
        applyLabel: t('common.actions.apply', {}, 'Apply'),
      });
      overlay.querySelector('.bulk-modal-apply').addEventListener('click', async () => {
        const tag = overlay.querySelector('#bulk-prop-select').value;
        if (!tag) { _setBulkStatus(overlay, 'error', t('txp.bulk_op.property_empty', {}, 'No active properties')); return; }
        _setBulkStatus(overlay, 'busy', t('pages.txbulk.spinner.applying', {}, 'Applying...'));
        try {
          const res = await fetch('/api/tx/batch-tag', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ import_ids: [...txPage.selected], add_tags: [tag], remove_tags: [] }),
          });
          const out = await res.json();
          if (out.error) { _setBulkStatus(overlay, 'error', escapeHtml(out.error)); return; }
          overlay._close();
          txPage.selected.clear();
          refreshData();
        } catch (e) { _setBulkStatus(overlay, 'error', escapeHtml(e.message)); }
      });
    })
    .catch(e => uiAlert(t('txp.bulk_op.property_load_failed', { err: e.message }, `Could not load properties: ${e.message}`)));
}

function openBulkPropertyRemoveModal() {
  // Reverse of openBulkPropertyModal. Lets the user pick a property and
  // strips that property's cost_tag from every selected TX via the same
  // /api/tx/batch-tag endpoint (remove_tags). "All properties" sends
  // every active cost_tag at once so a single click clears any property
  // assignment regardless of which one was set.
  fetch('/api/properties/list', { method: 'POST' })
    .then(r => r.ok ? r.json() : { properties: [] })
    .then(data => {
      const rows = (data.properties || []).filter(p => p.active !== false && p.cost_tag);
      const allTags = rows.map(p => p.cost_tag).join(',');
      const allLabel = t('txp.bulk_op.property_remove_all', {}, 'All properties');
      const opts = rows.length
        ? `<option value="${escapeHtml(allTags)}">${escapeHtml(allLabel)}</option>`
          + rows.map(p => `<option value="${escapeHtml(p.cost_tag)}">${escapeHtml(p.name || p.property_id)} (${escapeHtml(p.cost_tag)})</option>`).join('')
        : `<option value="">${escapeHtml(t('txp.bulk_op.property_empty', {}, 'No active properties'))}</option>`;
      const overlay = _bulkModalShell({
        title: `${t('txp.bulk_op.property_remove_title', {}, 'Remove Property')}`,
        bodyHtml: `
          <label class="fs-12 lbl-block">${t('txp.bulk_op.property_remove_label', {}, 'Property to remove')}</label>
          <select id="bulk-prop-remove-select" class="input-std">${opts}</select>
          <p class="fs-11 c-mut" style="margin:10px 0 0;">${t('txp.bulk_op.property_remove_hint', {}, "Strips the property's cost_tag from every selected transaction. Other tags are untouched.")}</p>`,
        applyLabel: t('common.actions.apply', {}, 'Apply'),
      });
      overlay.querySelector('.bulk-modal-apply').addEventListener('click', async () => {
        const raw = overlay.querySelector('#bulk-prop-remove-select').value;
        if (!raw) { _setBulkStatus(overlay, 'error', t('txp.bulk_op.property_empty', {}, 'No active properties')); return; }
        const tags = raw.split(',').map(s => s.trim()).filter(Boolean);
        _setBulkStatus(overlay, 'busy', t('pages.txbulk.spinner.applying', {}, 'Applying...'));
        try {
          const res = await fetch('/api/tx/batch-tag', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ import_ids: [...txPage.selected], add_tags: [], remove_tags: tags }),
          });
          const out = await res.json();
          if (out.error) { _setBulkStatus(overlay, 'error', escapeHtml(out.error)); return; }
          overlay._close();
          txPage.selected.clear();
          refreshData();
        } catch (e) { _setBulkStatus(overlay, 'error', escapeHtml(e.message)); }
      });
    })
    .catch(e => uiAlert(t('txp.bulk_op.property_load_failed', { err: e.message }, `Could not load properties: ${e.message}`)));
}

function openBulkSubscriptionModal() {
  fetch('/api/subscriptions/active_for_picker', { method: 'POST' })
    .then(r => r.ok ? r.json() : { subscriptions: [] })
    .then(data => {
      const subs = data.subscriptions || [];
      const opts = subs.length
        ? subs.map(s => {
            const label = s.group ? `${s.group} · ${s.name}` : s.name;
            return `<option value="${escapeHtml(s.subscription_id)}">${escapeHtml(label)}</option>`;
          }).join('')
        : `<option value="">${escapeHtml(t('txp.bulk_op.subscription_empty', {}, 'No active subscriptions'))}</option>`;
      const overlay = _bulkModalShell({
        title: `${t('txp.bulk_op.subscription_title', {}, 'Link Subscription')}`,
        bodyHtml: `
          <label class="fs-12 lbl-block">${t('txp.bulk_op.subscription_label', {}, 'Subscription')}</label>
          <select id="bulk-sub-select" class="input-std">${opts}</select>
          <p class="fs-11 c-mut" style="margin:10px 0 0;">${t('txp.bulk_op.subscription_hint', {}, 'Transactions already linked to a different subscription are skipped.')}</p>`,
        applyLabel: t('common.actions.apply', {}, 'Apply'),
      });
      overlay.querySelector('.bulk-modal-apply').addEventListener('click', async () => {
        const subId = overlay.querySelector('#bulk-sub-select').value;
        if (!subId) { _setBulkStatus(overlay, 'error', t('txp.bulk_op.subscription_empty', {}, 'No active subscriptions')); return; }
        _setBulkStatus(overlay, 'busy', t('pages.txbulk.spinner.applying', {}, 'Applying...'));
        try {
          const res = await fetch('/api/tx/batch-link-subscription', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ import_ids: [...txPage.selected], subscription_id: subId }),
          });
          const out = await res.json();
          if (out.error) { _setBulkStatus(overlay, 'error', escapeHtml(out.error)); return; }
          const linked = out.linked || 0;
          const skipped = (out.skipped || []).length;
          const missing = (out.missing || []).length;
          const summary = t('txp.bulk_op.subscription_summary',
            { linked, skipped, missing },
            `${linked} linked, ${skipped} already linked, ${missing} missing.`);
          _setBulkStatus(overlay, linked > 0 ? 'success' : 'error', escapeHtml(summary));
          if (linked > 0) {
            setTimeout(() => { overlay._close(); txPage.selected.clear(); refreshData(); }, 900);
          }
        } catch (e) { _setBulkStatus(overlay, 'error', escapeHtml(e.message)); }
      });
    })
    .catch(e => uiAlert(t('txp.bulk_op.subscription_load_failed', { err: e.message }, `Could not load subscriptions: ${e.message}`)));
}

function openBulkSubscriptionUnlinkModal() {
  // Reverse of openBulkSubscriptionModal. No picker — every TX is
  // linked to at most one subscription, so the action is unambiguous:
  // strip whatever link exists on the selected rows. TXs without a
  // link are reported under ``already_unlinked`` for transparency.
  const overlay = _bulkModalShell({
    title: `${t('txp.bulk_op.subscription_unlink_title', {}, 'Unlink Subscription')}`,
    bodyHtml: `
      <p class="fs-12 c-mut m-0">${t('txp.bulk_op.subscription_unlink_hint', {}, 'Removes the subscription link from every selected transaction. The transactions themselves stay untouched.')}</p>`,
    applyLabel: t('txp.bulk_op.subscription_unlink_apply', {}, 'Unlink'),
  });
  overlay.querySelector('.bulk-modal-apply').addEventListener('click', async () => {
    _setBulkStatus(overlay, 'busy', t('pages.txbulk.spinner.applying', {}, 'Applying...'));
    try {
      const res = await fetch('/api/tx/batch-unlink-subscription', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_ids: [...txPage.selected] }),
      });
      const out = await res.json();
      if (out.error) { _setBulkStatus(overlay, 'error', escapeHtml(out.error)); return; }
      const unlinked = out.unlinked || 0;
      const already = (out.already_unlinked || []).length;
      const summary = t('txp.bulk_op.subscription_unlink_summary',
        { unlinked, already },
        `${unlinked} unlinked, ${already} had no link.`);
      _setBulkStatus(overlay, unlinked > 0 ? 'success' : 'error', escapeHtml(summary));
      if (unlinked > 0) {
        setTimeout(() => { overlay._close(); txPage.selected.clear(); refreshData(); }, 900);
      }
    } catch (e) { _setBulkStatus(overlay, 'error', escapeHtml(e.message)); }
  });
}

function openBulkPayeeModal() {
  // Pull payees off state.tx for the autocomplete datalist — same source
  // as the Add-TX form. Avoids a round-trip and keeps suggestions in
  // sync with what's actually in use.
  const knownPayees = [...new Set(state.tx.map(t => t.payee || '').filter(Boolean))].sort();
  const overlay = _bulkModalShell({
    title: `${t('txp.bulk_op.payee_title', {}, 'Change Payee')}`,
    bodyHtml: `
      <label class="fs-12 lbl-block">${t('txp.bulk_op.payee_label', {}, 'New payee')}</label>
      <input type="text" id="bulk-payee-input" list="bulk-payee-list" autocomplete="off" class="input-std">
      <datalist id="bulk-payee-list">${knownPayees.map(p => `<option value="${escapeHtml(p)}">`).join('')}</datalist>
      <p class="fs-11 c-mut" style="margin:10px 0 0;">${t('txp.bulk_op.payee_hint', {}, 'Overwrites the payee on every selected transaction. import_id stays the same so linked rows (subscriptions, fuel, utilities) remain intact.')}</p>`,
    applyLabel: t('common.actions.apply', {}, 'Apply'),
  });
  setTimeout(() => overlay.querySelector('#bulk-payee-input')?.focus(), 0);
  overlay.querySelector('.bulk-modal-apply').addEventListener('click', async () => {
    const payee = overlay.querySelector('#bulk-payee-input').value.trim();
    if (!payee) { _setBulkStatus(overlay, 'error', t('txp.bulk_op.payee_required', {}, 'Enter a payee.')); return; }
    _setBulkStatus(overlay, 'busy', t('pages.txbulk.spinner.applying', {}, 'Applying...'));
    try {
      const res = await fetch('/api/tx/batch-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_ids: [...txPage.selected], payee }),
      });
      const out = await res.json();
      if (out.error) { _setBulkStatus(overlay, 'error', escapeHtml(out.error)); return; }
      overlay._close();
      txPage.selected.clear();
      refreshData();
    } catch (e) { _setBulkStatus(overlay, 'error', escapeHtml(e.message)); }
  });
}

function openBulkAccountModal() {
  // Use the already-loaded state.accounts — refreshData() refreshes it after
  // every mutation, so it's always live. Filter to active accounts so
  // the user can't accidentally move TXs to an archived one.
  const accounts = (state.accounts || []).filter(a => (a.status || 'active') === 'active');
  const selectedIds = [...txPage.selected];
  // Pre-flight: tally currencies in the selection so we can warn the
  // user before they pick a mismatching target. Cheaper than waiting
  // for the server 409.
  const currencies = new Set();
  for (const tx of state.tx) {
    if (selectedIds.includes(tx.import_id)) {
      const c = (tx.currency || '').trim();
      if (c) currencies.add(c);
    }
  }
  const opts = accounts.map(a => {
    const ccy = (a.currency || '').trim();
    const blocked = currencies.size === 1 && ccy && !currencies.has(ccy);
    return `<option value="${escapeHtml(a.alias)}" data-ccy="${escapeHtml(ccy)}"${blocked ? ' disabled' : ''}>${escapeHtml(a.alias)} — ${escapeHtml(a.name)} (${escapeHtml(ccy)})${blocked ? ' ✕' : ''}</option>`;
  }).join('');
  const ccyHint = currencies.size === 1
    ? t('txp.bulk_op.account_currency_hint', { ccy: [...currencies][0] }, `Selected TXs are all in ${[...currencies][0]} — non-matching accounts are disabled.`)
    : t('txp.bulk_op.account_mixed_hint', { ccys: [...currencies].join(', ') }, `Selection mixes currencies (${[...currencies].join(', ')}). The server will refuse unless all TXs match the target's currency.`);
  const overlay = _bulkModalShell({
    title: `${t('txp.bulk_op.account_title', {}, 'Move to Account')}`,
    bodyHtml: `
      <label class="fs-12 lbl-block">${t('txp.bulk_op.account_label', {}, 'Target account')}</label>
      <select id="bulk-acc-select" class="input-std">${opts}</select>
      <p class="fs-11 c-mut" style="margin:10px 0 0;">${escapeHtml(ccyHint)}</p>`,
    applyLabel: t('common.actions.apply', {}, 'Apply'),
  });
  overlay.querySelector('.bulk-modal-apply').addEventListener('click', async () => {
    const account = overlay.querySelector('#bulk-acc-select').value;
    if (!account) { _setBulkStatus(overlay, 'error', t('txp.bulk_op.account_required', {}, 'Pick an account.')); return; }
    _setBulkStatus(overlay, 'busy', t('pages.txbulk.spinner.applying', {}, 'Applying...'));
    try {
      const res = await fetch('/api/tx/batch-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_ids: [...txPage.selected], account }),
      });
      const out = await res.json();
      if (res.status === 409 && out.currency_conflicts) {
        const n = out.currency_conflicts.length;
        _setBulkStatus(overlay, 'error', escapeHtml(
          t('txp.bulk_op.account_conflict', { n },
            `${n} TX(s) don't match the target currency — no rows moved.`)
        ));
        return;
      }
      if (out.error) { _setBulkStatus(overlay, 'error', escapeHtml(out.error)); return; }
      overlay._close();
      txPage.selected.clear();
      refreshData();
    } catch (e) { _setBulkStatus(overlay, 'error', escapeHtml(e.message)); }
  });
}

function exportTransactions() {
  const data = (txPage._filtered || state.tx).map(t => ({
    Date: t.date,
    Account: t.account,
    Type: t.type,
    Payee: t.payee || '',
    Category: t.category || '',
    Amount: t.amount,
    Currency: t.currency,
    Tags: t.tags || '',
    Note: t.note || '',
    'Transfer To': t.transfer_to_account || '',
  }));
  const filters = [txPage.filterType, txPage.filterAccount].filter(Boolean).join('_') || 'all';
  exportXlsx(data, `transactions_${filters}_${localTodayIso()}`, 'Transactions');
}

// ─── v1.6.0 receipts read-only preview modal ──────────────────────────

function _openTxReceiptsModal(tx) {
  const urls = parseReceiptList(tx.receipt_url || '');
  if (!urls.length) return;
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `
    <div class="modal-content modal-receipts">
      <h3>${escapeHtml(t('receipts.modal.title', {}, 'Attachments'))}</h3>
      <div class="hint-sm mb-8">${escapeHtml(tx.payee || tx.account || '')} · ${escapeHtml(tx.date || '')}</div>
      <div id="tx-receipts-grid"></div>
      <div class="modal-footer">
        <div class="btn-right">
          <button data-receipts-close>${escapeHtml(t('common.actions.close', {}, 'Close'))}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    if (ov.parentNode) ov.parentNode.removeChild(ov);
  };
  // DP-M6: expose the instance handle so the global closeModal() shim and
  // stale-overlay dedupe paths can close this modal without leaking onKey.
  ov._close = close;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-receipts-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  // Render the grid in read-only mode — receipts.js wires the tile click
  // into openReceiptViewer (lightbox for images, embed for PDFs).
  renderAttachmentGrid(document.getElementById('tx-receipts-grid'), urls, { editable: false });
}

