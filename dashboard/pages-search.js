
// ─── Search Page ─────────────────────────────────────────────────────────

let searchDebounceTimer = null;

function renderSearchPage() {
  const contentEl = document.getElementById('search-content');
  const globalInput = document.getElementById('global-search');
  const query = globalInput ? globalInput.value.trim() : '';
  contentEl.innerHTML = `
    <div class="section">
      <div id="search-result-count" style="margin-bottom:12px;color:var(--muted);font-size:13px;">${query ? '' : 'Type in the search field to find transactions'}</div>
      <div id="search-results"></div>
    </div>
  `;
  if (query) executeSearch(query);
}

// Wire global search input (once, after DOM ready)
document.addEventListener('DOMContentLoaded', () => {
  const gs = document.getElementById('global-search');
  if (!gs) return;
  gs.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    const q = gs.value.trim();
    // Navigate to search page if not already there
    const searchPage = document.getElementById('page-search');
    if (!searchPage || !searchPage.classList.contains('active')) {
      if (q) {
        history.pushState(null, '', '#search');
        navigateTo('search');
        return; // navigateTo calls renderSearchPage which calls executeSearch
      }
      return;
    }
    searchDebounceTimer = setTimeout(() => executeSearch(q), 300);
  });
  gs.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = gs.value.trim();
      if (q) {
        history.pushState(null, '', '#search');
        navigateTo('search');
      }
    }
  });
});

function executeSearch(query) {
  const countEl = document.getElementById('search-result-count');
  const resultsEl = document.getElementById('search-results');
  if (!query) {
    countEl.textContent = t('pages.search.placeholder', {}, 'Type to search across transactions, accounts, payees and debts');
    resultsEl.innerHTML = '';
    return;
  }
  const q = query.toLowerCase();
  let html = '';
  let totalHits = 0;

  // 1. Accounts
  const matchedAccounts = state.accounts.filter(a =>
    (a.alias || '').toLowerCase().includes(q)
    || (a.name || '').toLowerCase().includes(q)
    || (a.currency || '').toLowerCase().includes(q)
    || (a.owner || '').toLowerCase().includes(q)
  );
  if (matchedAccounts.length > 0) {
    totalHits += matchedAccounts.length;
    html += `<div class="section mb-24">
      <div class="section-title">Accounts (${matchedAccounts.length})</div>
      <table class="tx-table"><thead><tr><th>Alias</th><th>Name</th><th>Currency</th><th>Type</th><th>Balance</th></tr></thead><tbody>
      ${matchedAccounts.map(a => {
        const bal = state.balances[a.alias] || 0;
        return `<tr class="ptr" data-action="gotoAccountDetail" data-arg1="${escapeHtml(a.alias)}">
          <td><strong>${escapeHtml(a.alias)}</strong></td>
          <td>${escapeHtml(a.name)}</td>
          <td>${a.currency}</td>
          <td>${a.type}</td>
          <td class="amt fw-500">${formatCurrency(bal, a.currency)} ${a.currency}</td>
        </tr>`;
      }).join('')}
      </tbody></table></div>`;
  }

  // 2. Debts
  const matchedDebts = (state.thirdParty || []).filter(d =>
    (d.person_name || '').toLowerCase().includes(q)
    || (d.note || '').toLowerCase().includes(q)
    || String(d.original_amount).includes(q)
  );
  if (matchedDebts.length > 0) {
    totalHits += matchedDebts.length;
    html += `<div class="section mb-24">
      <div class="section-title">Debts (${matchedDebts.length})</div>
      <table class="tx-table"><thead><tr><th>Person</th><th>Direction</th><th>Original</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>
      ${matchedDebts.map(d => {
        const isOwed = d.type === 'owed_to_me';
        const color = isOwed ? 'var(--positive)' : 'var(--negative)';
        const settled = String(d.settled) === 'true';
        return `<tr style="cursor:pointer;${settled ? 'opacity:0.5;' : ''}" data-action="gotoDebtsPage">
          <td><strong>${escapeHtml(d.person_name)}</strong></td>
          <td style="color:${color};font-size:11px;">${isOwed ? 'owes you' : 'you owe'}</td>
          <td class="amt">${formatCurrency(d.original_amount, d.currency)} ${d.currency}</td>
          <td class="amt" style="color:${color};font-weight:500;">${settled ? '0' : formatCurrency(d.amount, d.currency) + ' ' + d.currency}</td>
          <td>${settled ? 'settled' : 'open'}</td>
        </tr>`;
      }).join('')}
      </tbody></table></div>`;
  }

  // 3. Transactions
  const matchedTx = state.tx.filter(t => {
    return (t.payee || '').toLowerCase().includes(q)
      || (t.category || '').toLowerCase().includes(q)
      || (t.note || '').toLowerCase().includes(q)
      || (t.tags || '').toLowerCase().includes(q)
      || String(t.amount).includes(q)
      || (t.account || '').toLowerCase().includes(q)
      || (t.import_id || '').toLowerCase().includes(q);
  });
  const shownTx = matchedTx.slice(0, 200);
  totalHits += matchedTx.length;

  if (shownTx.length > 0) {
    // Pre-resolve action-label translations so the map's `t` (= transaction)
    // doesn't shadow the global i18n t() function.
    const titleEdit = t('pages.actions.title.edit', {}, 'Edit');
    const titleDuplicate = t('pages.actions.title.duplicate', {}, 'Duplicate');
    const titleDelete = t('pages.actions.title.delete', {}, 'Delete');
    html += `<div class="section">
      <div class="section-title">Transactions (${matchedTx.length}${matchedTx.length > 200 ? ', showing 200' : ''})</div>
      <table class="tx-table"><thead><tr>
        <th>Date</th><th>Account</th><th>Payee</th><th>Category</th><th>Note</th><th>Amount</th><th>Cur</th><th></th>
      </tr></thead><tbody>
      ${shownTx.map(t => {
        const typeClass = t.type || '';
        // Plain hash anchor — the dispatcher leaves real fragment links
        // alone, so the browser's hashchange listener (in core.js) handles
        // the navigation without needing a JS handler here.
        const accLink = `<a href="#account:${escapeHtml(t.account)}" style="color:var(--accent);text-decoration:none;border-bottom:1px dashed var(--border);">${escapeHtml(t.account || '')}</a>`;
        return `<tr>
          <td>${fmtDate(t.date)}</td>
          <td>${accLink}</td>
          <td>${escapeHtml(t.payee || '')}</td>
          <td class="cat">${escapeHtml(t.category || '')}</td>
          <td><span class="tx-note" title="${escapeHtml(t.note || '')}">${escapeHtml(t.note || '')}</span></td>
          <td class="amt ${typeClass}">${formatCurrency(t.amount, t.currency)}</td>
          <td>${escapeHtml(t.currency || '')}</td>
          <td class="tx-actions"><button class="tx-edit-btn icon-btn" data-import-id="${escapeHtml(t.import_id)}" title="${titleEdit}" aria-label="${titleEdit}">✎</button><button class="tx-edit-btn icon-btn" data-duplicate-id="${escapeHtml(t.import_id)}" title="${titleDuplicate}" aria-label="${titleDuplicate}">⧉</button><button class="tx-edit-btn icon-btn btn-delete-sm" data-delete-id="${escapeHtml(t.import_id)}" title="${titleDelete}" aria-label="${titleDelete}">✕</button></td>
        </tr>`;
      }).join('')}
      </tbody></table></div>`;
  }

  countEl.textContent = totalHits === 0
    ? t('pages.search.empty.no_results', { query: escapeHtml(query) }, `No results for '${escapeHtml(query)}'`)
    : `${totalHits} result${totalHits !== 1 ? 's' : ''} for '${escapeHtml(query)}'`;

  resultsEl.innerHTML = html;

  // Event delegation for search results (registered once)
  if (!resultsEl._delegated) {
    resultsEl.addEventListener('click', (e) => {
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
    resultsEl._delegated = true;
  }
}

