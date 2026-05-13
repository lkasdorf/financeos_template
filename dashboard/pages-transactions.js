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

  // Sum of filtered amounts
  const sumIncome = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const sumExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

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
  const rows = slice.map(tx => {
    const isChecked = txPage.selected.has(tx.import_id);
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
    return `
      <tr class="${isChecked ? 'row-selected' : ''}">
        <td class="td-chk"><input type="checkbox" class="tx-select" data-id="${escapeHtml(tx.import_id)}" ${isChecked ? 'checked' : ''}></td>
        <td>${fmtDate(tx.date)}</td>
        <td>${escapeHtml(tx.account)}</td>
        <td class="fs-10 c-mut2">${tx.type}</td>
        <td>${payeeLabel}${receiptIcon}${note}</td>
        <td class="cat">${catOrType}</td>
        <td>${tags}</td>
        <td class="amt ${typeClass}">${formatCurrency(tx.amount, tx.currency)}</td>
        <td class="hint-sm">${tx.currency}</td>
        <td class="amt c-mut2" title="${escapeHtml(fxTitle)}">${tx.currency === 'EUR' ? '' : formatCurrency(convertToEur(tx.amount, tx.currency, tx.date), 'EUR') + ' €'}</td>
        <td class="tx-actions">${receiptUrls.length ? `<button class="tx-edit-btn icon-btn" data-action="showTxReceipts" data-arg1="${escapeHtml(tx.import_id)}" title="${escapeHtml(t('receipts.tx_list.btn_title', {}, 'Show attachments'))}" aria-label="${escapeHtml(t('receipts.tx_list.btn_title', {}, 'Show attachments'))}">📎</button>` : ''}<button class="tx-edit-btn icon-btn" data-import-id="${escapeHtml(tx.import_id)}" title="${editLabel}" aria-label="${editLabel}">✎</button><button class="tx-edit-btn icon-btn" data-duplicate-id="${escapeHtml(tx.import_id)}" title="${duplicateLabel}" aria-label="${duplicateLabel}">⧉</button><button class="tx-edit-btn icon-btn btn-delete-sm" data-delete-id="${escapeHtml(tx.import_id)}" title="${deleteLabel}" aria-label="${deleteLabel}">✕</button></td>
      </tr>
    `;
  }).join('');

  const hasActiveFilters = txPage.filterType || txPage.filterAccount || txPage.filterCategory || txPage.filterTags.length > 0 || txPage.filterDateFrom || txPage.filterDateTo || txPage.filterAmountMin || txPage.filterAmountMax || txPage.filterPayee || txPage.filterUncategorized;

  // Count of uncategorized TX (both type and category empty), used in the
  // toggle label so the user sees how much triage work is left at a glance.
  const uncategorizedCount = state.tx.filter(t => !t.type && !t.category).length;

  contentEl.innerHTML = `
    <div class="report-toolbar" style="flex-wrap:wrap;gap:6px 12px;margin-bottom:12px;">
      <label>${t('tx.filter.type', {}, 'Type')}</label>
      <select id="txp-type">
        <option value="">${t('tx.filter.all', {}, 'All')}</option>
        ${types.map(tt => `<option value="${tt}" ${txPage.filterType === tt ? 'selected' : ''}>${tt}</option>`).join('')}
      </select>
      <label>${t('tx.filter.account', {}, 'Account')}</label>
      <select id="txp-account">
        <option value="">${t('tx.filter.all', {}, 'All')}</option>
        ${accounts.map(a => `<option value="${a}" ${txPage.filterAccount === a ? 'selected' : ''}>${a}</option>`).join('')}
      </select>
      <label>${t('tx.filter.category', {}, 'Category')}</label>
      <select id="txp-category">
        <option value="">${t('tx.filter.all', {}, 'All')}</option>
        ${topCats.map(top => {
          const subs = allCats.filter(c => c === top || c.startsWith(top + ':'));
          const topOpt = `<option value="${top}" ${txPage.filterCategory === top ? 'selected' : ''}>${t('tx.filter.category_all_suffix', { name: top }, `${top} (all)`)}</option>`;
          const subOpts = subs.filter(c => c !== top).map(c => `<option value="${c}" ${txPage.filterCategory === c ? 'selected' : ''}>&nbsp;&nbsp;— ${c}</option>`).join('');
          return topOpt + subOpts;
        }).join('')}
      </select>
      ${uncategorizedCount > 0 ? `
      <label style="display:flex;gap:4px;align-items:center;cursor:pointer;margin-left:8px;">
        <input type="checkbox" id="txp-uncat" ${txPage.filterUncategorized ? 'checked' : ''}>
        <span class="fs-12">${t('txp.uncategorized_only', { n: uncategorizedCount }, `Uncategorized only (${uncategorizedCount})`)}</span>
      </label>
      ` : ''}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:12px;">
      <span class="fs-12 c-mut2" style="margin-right:4px;">${t('tx.filter.tags', {}, 'Tags')}</span>
      ${allTags.map(tag => `<button class="txp-tag-chip ${txPage.filterTags.includes(tag) ? 'active' : ''}" data-tag="${escapeHtml(tag)}" style="padding:3px 10px;font-size:10px;border-radius:12px;">${escapeHtml(tag)}</button>`).join('')}
    </div>
    <div class="report-toolbar" style="flex-wrap:wrap;gap:6px 12px;margin-bottom:16px;">
      <label>${t('tx.filter.from', {}, 'From')}</label>
      <input type="date" id="txp-date-from" value="${txPage.filterDateFrom}" style="padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
      <label>${t('tx.filter.to', {}, 'To')}</label>
      <input type="date" id="txp-date-to" value="${txPage.filterDateTo}" style="padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
      <label>${t('tx.filter.payee', {}, 'Payee')}</label>
      <input type="text" id="txp-payee" list="txp-payee-list" value="${escapeHtml(txPage.filterPayee)}" placeholder="${t('search.placeholder', {}, 'Search...')}" autocomplete="off" style="width:200px;padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
      <datalist id="txp-payee-list">${allPayees.map(p => `<option value="${escapeHtml(p)}">`).join('')}</datalist>
      <label>${t('tx.filter.amount', {}, 'Amount')}</label>
      <input type="text" inputmode="numeric" id="txp-amt-min" value="${escapeHtml(txPage.filterAmountMin)}" placeholder="${t('tx.filter.amount_min', {}, 'min')}" style="width:110px;padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
      <span class="c-mut">–</span>
      <input type="text" inputmode="numeric" id="txp-amt-max" value="${escapeHtml(txPage.filterAmountMax)}" placeholder="${t('tx.filter.amount_max', {}, 'max')}" style="width:110px;padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
      ${hasActiveFilters ? `<button id="txp-reset" style="padding:5px 12px;font-size:11px;">${t('txp.reset', {}, 'Reset')}</button>` : ''}
      ${hasActiveFilters ? `<button id="txp-save-preset" style="padding:5px 12px;font-size:11px;" title="${t('txp.save_preset_title', {}, 'Save current filters as preset')}">${t('txp.save_preset', {}, 'Save Preset')}</button>` : ''}
      <select id="txp-presets" style="padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
        <option value="">${t('txp.presets_default', {}, 'Presets')}</option>
        ${loadFilterPresets().map((p, i) => `<option value="${i}">${escapeHtml(p.name)}</option>`).join('')}
      </select>
      ${loadFilterPresets().length > 0 ? `<button id="txp-delete-preset" style="padding:4px 8px;font-size:10px;color:var(--muted);" title="${t('txp.delete_preset_title', {}, 'Delete selected preset')}" aria-label="${t('txp.delete_preset_title', {}, 'Delete selected preset')}">×</button>` : ''}
      <button id="txp-export" style="margin-left:auto;padding:6px 14px;">${t('txp.export_xlsx', {}, 'Export XLSX')}</button>
    </div>
    ${hasActiveFilters ? `
    <div class="income-grid mb-16" style="grid-template-columns:repeat(3,1fr);">
      <div class="income-cell"><div class="ic-label">${t('txp.sum_income', {}, 'Income')}</div><div class="ic-value c-pos">${formatCurrency(sumIncome, 'TZS')}</div></div>
      <div class="income-cell"><div class="ic-label">${t('txp.sum_expenses', {}, 'Expenses')}</div><div class="ic-value c-neg">${formatCurrency(sumExpense, 'TZS')}</div></div>
      <div class="income-cell"><div class="ic-label">${t('txp.sum_net', {}, 'Net')}</div><div class="ic-value" style="color:${sumIncome - sumExpense >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(sumIncome - sumExpense, 'TZS')}</div></div>
    </div>
    ` : ''}
    ${txPage.selected.size > 0 ? `
    <div class="bulk-bar">
      <span class="bulk-count">${t('txp.bulk_count', { n: txPage.selected.size }, `${txPage.selected.size} selected`)}</span>
      <button id="bulk-tag" class="bulk-btn">${t('txp.bulk_tag', {}, 'Tag')}</button>
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
      <button id="bulk-tag" class="bulk-btn">Tag</button>
      <button id="bulk-delete" class="bulk-btn bulk-btn-danger">Delete</button>
      <button id="bulk-clear" class="bulk-btn">Deselect All</button>
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
    if (data.error) { uiAlert(t('pages.txbulk.err.delete_failed', { err: data.error }, `Bulk delete failed: ${data.error}`)); return; }
    txPage.selected.clear();
    boot();
  } catch (e) {
    uiAlert(t('pages.txbulk.err.delete_failed', { err: e.message }, `Bulk delete failed: ${e.message}`));
  }
}

function openBulkTagModal() {
  const allTags = [...new Set(state.tx.flatMap(t => (t.tags || '').split(';').filter(Boolean)))].sort();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px;">
      <h3>Bulk <span class="accent">Tag</span></h3>
      <p class="fs-12 c-mut" style="margin:8px 0 16px;">${txPage.selected.size} transactions selected</p>
      <div style="margin-bottom:12px;">
        <label class="fs-12" style="display:block;margin-bottom:6px;">Add tags:</label>
        <div id="bulk-tag-add" style="display:flex;flex-wrap:wrap;gap:4px;">
          ${allTags.map(t => `<label style="display:flex;align-items:center;gap:4px;font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:6px;cursor:pointer;"><input type="checkbox" class="bulk-add-tag" value="${escapeHtml(t)}"> ${escapeHtml(t)}</label>`).join('')}
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <label class="fs-12" style="display:block;margin-bottom:6px;">Remove tags:</label>
        <div id="bulk-tag-remove" style="display:flex;flex-wrap:wrap;gap:4px;">
          ${allTags.map(t => `<label style="display:flex;align-items:center;gap:4px;font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:6px;cursor:pointer;"><input type="checkbox" class="bulk-remove-tag" value="${escapeHtml(t)}"> ${escapeHtml(t)}</label>`).join('')}
        </div>
      </div>
      <div id="bulk-tag-status"></div>
      <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;">
        <button onclick="this.closest('.modal-overlay').remove()">${t('common.actions.cancel', {}, 'Cancel')}</button>
        <button id="bulk-tag-apply" style="background:var(--accent);color:var(--bg);">${t('common.actions.apply', {}, 'Apply')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#bulk-tag-apply').addEventListener('click', async () => {
    const addTags = [...overlay.querySelectorAll('.bulk-add-tag:checked')].map(c => c.value);
    const removeTags = [...overlay.querySelectorAll('.bulk-remove-tag:checked')].map(c => c.value);
    if (!addTags.length && !removeTags.length) { uiAlert(t('pages.txbulk.alert.no_tags', {}, 'Select at least one tag to add or remove.')); return; }
    const statusEl = overlay.querySelector('#bulk-tag-status');
    statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('pages.txbulk.spinner.applying', {}, 'Applying...')}</div>`;
    try {
      const res = await fetch('/api/tx/batch-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_ids: [...txPage.selected], add_tags: addTags, remove_tags: removeTags }),
      });
      const data = await res.json();
      if (data.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(data.error)}</div>`; return; }
      overlay.remove();
      txPage.selected.clear();
      boot();
    } catch (e) {
      statusEl.innerHTML = `<div class="atx-status error">${t('pages.txbulk.err.apply_failed', { err: escapeHtml(e.message) }, `Failed: ${escapeHtml(e.message)}`)}</div>`;
    }
  });

  const handler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler); } };
  document.addEventListener('keydown', handler);
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
  exportXlsx(data, `transactions_${filters}_${new Date().toISOString().slice(0,10)}`, 'Transactions');
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
      <div class="hint-sm" style="margin-bottom:8px">${escapeHtml(tx.payee || tx.account || '')} · ${escapeHtml(tx.date || '')}</div>
      <div id="tx-receipts-grid"></div>
      <div class="modal-footer">
        <div class="btn-right">
          <button data-action="closeModal">${escapeHtml(t('common.actions.close', {}, 'Close'))}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    if (ov.parentNode) ov.parentNode.removeChild(ov);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-action="closeModal"]')) close();
  });
  document.addEventListener('keydown', onKey);
  // Render the grid in read-only mode — receipts.js wires the tile click
  // into openReceiptViewer (lightbox for images, embed for PDFs).
  renderAttachmentGrid(document.getElementById('tx-receipts-grid'), urls, { editable: false });
}

