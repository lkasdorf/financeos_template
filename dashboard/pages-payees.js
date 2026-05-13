// ─── Payees Page ─────────────────────────────────────────────────────────
//
// Extracted from forms.js (Code-Review HIGH 1, forms.js God-Module split,
// step 1/3: Payees island ~340 LOC). External dependencies stay in
// forms.js / core.js / i18n.js: loadTxContext, closeModal, t, escapeHtml,
// fmtDate, formatCurrency, state.tx. All eight functions remain on the
// global scope so onclick="..." string handlers in the rendered HTML
// keep working unchanged.

async function renderPayeesPage() {
  const content = document.getElementById('settings-tab-content') || document.getElementById('payees-content');
  const meta = document.getElementById('payees-meta');
  if (!content) return;
  content.innerHTML = `<div class="loading">${escapeHtml(t('settings.payees.loading', {}, 'Loading payees...'))}</div>`;

  let payees = [];
  try {
    const res = await fetch('/api/payees/list', { method: 'POST' });
    const data = await res.json();
    payees = data.payees || [];
  } catch (e) {
    content.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.payees.load_failed', {}, 'Failed to load payees'))}</div>`;
    return;
  }

  if (meta) meta.textContent = t('settings.payees.count', { n: payees.length }, `${payees.length} payees registered`);

  // Group by group field. The internal key for the catch-all stays the
  // literal 'Other' so grouping logic (isOther check, rename/delete gating)
  // remains stable regardless of locale; only the heading text is i18n'd.
  const groupOtherKey = 'Other';
  const groupOtherLabel = t('payees.group_other', {}, 'Other');
  const groups = {};
  payees.forEach(p => {
    const g = p.group || groupOtherKey;
    if (!groups[g]) groups[g] = [];
    groups[g].push(p);
  });

  const labelEdit = t('common.actions.edit', {}, 'Edit');
  const labelDelete = t('common.actions.delete', {}, 'Delete');
  const labelRename = t('common.actions.rename', {}, 'Rename');

  let html = `
    <div class="flex-row gap-md mb-20">
      <input type="text" id="payee-search" placeholder="${t('settings.payees.search_placeholder', {}, 'Search payees...')}" style="flex:1;padding:10px 14px;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:inherit;font-size:13px;border-radius:2px;">
      <button class="btn-save" data-action="showPayeeModal" style="padding:10px 20px;">${t('settings.payees.add', {}, '+ Add Payee')}</button>
      <button data-action="addPayeeGroup" style="padding:10px 20px;">${t('settings.payees.add_group', {}, '+ Add Group')}</button>
    </div>
  `;

  for (const [group, items] of Object.entries(groups)) {
    const isOther = group === groupOtherKey;
    const displayGroup = isOther ? groupOtherLabel : group;
    html += `<div class="section mb-24">
      <div class="section-title">${escapeHtml(displayGroup)} <span style="color:var(--muted);font-weight:400;font-size:11px;">(${items.length})</span>
        ${!isOther ? `<span style="display:inline-flex;gap:6px;margin-left:12px;">
          <button class="tx-edit-btn" data-action="renamePayeeGroup" data-arg1="${escapeHtml(group)}">${labelRename}</button>
          <button class="tx-edit-btn btn-delete-sm" data-action="deletePayeeGroup" data-arg1="${escapeHtml(group)}">${labelDelete}</button>
        </span>` : ''}
      </div>
      <table class="tx-table payee-table">
        <thead><tr>
          <th>${t('common.col.payee', {}, 'Payee')}</th><th>${t('settings.payees.col_aliases', {}, 'Aliases')}</th><th>${t('settings.payees.col_default_category', {}, 'Default Category')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('settings.payees.col_auto_tag', {}, 'Auto-Tag')}</th><th></th>
        </tr></thead><tbody>`;
    items.forEach(p => {
      html += `<tr data-payee-id="${escapeHtml(p.id)}">
        <td><strong><a href="#" data-action="showPayeeTxOverlay" data-arg1="${escapeHtml(p.payee)}" style="color:var(--text);text-decoration:none;border-bottom:1px dashed var(--border);">${escapeHtml(p.payee)}</a></strong>${p.notes ? `<br><span class="hint-sm">${escapeHtml(p.notes)}</span>` : ''}</td>
        <td class="sub-text">${escapeHtml((p.aliases || []).join(', '))}</td>
        <td class="cat">${escapeHtml(p.default_category)}</td>
        <td>${escapeHtml(p.default_account || '')}</td>
        <td>${p.auto_tag ? `<span class="tag-chip">${escapeHtml(p.auto_tag)}</span>` : ''}</td>
        <td><button class="tx-edit-btn" data-action="showPayeeModal" data-arg1="${escapeHtml(p.id)}" title="${labelEdit}">${labelEdit}</button></td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }

  content.innerHTML = html;

  // Wire search
  document.getElementById('payee-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    content.querySelectorAll('.payee-table tbody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

}

// ── Payee Group Management ───────────────────────────────────────────────

async function addPayeeGroup() {
  /** Create a new empty group — opens Add Payee modal with the new group pre-selected. */
  const name = await uiPrompt(t('payees.prompt_new_group', {}, 'New group name:'));
  if (!name || !name.trim()) return;
  // Open the Add Payee modal and pre-fill the group
  showPayeeModal().then(() => {
    setTimeout(() => {
      const sel = document.getElementById('pm-group-select');
      if (sel) {
        // Switch to new-group input and fill it
        sel.style.display = 'none';
        const newInput = document.getElementById('pm-group-new');
        if (newInput) { newInput.style.display = ''; newInput.value = name.trim(); }
      }
    }, 200);
  });
}

// Re-group payees in parallel via Promise.allSettled. Sequential awaits
// would mean N round-trips for N matching payees and a partial-failure
// in the middle would leave the group half-renamed. Promise.allSettled
// fires them concurrently and reports the count that failed so the user
// at least knows to retry.
async function _bulkRegroup(filterFn, newGroup, errKey, errFallback) {
  const res = await fetch('/api/payees/list', { method: 'POST' });
  const data = await res.json();
  const toUpdate = (data.payees || []).filter(filterFn);
  const ops = toUpdate.map(p =>
    fetch('/api/payees/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, updated: { ...p, group: newGroup } }),
    })
  );
  const results = await Promise.allSettled(ops);
  const failed = results.filter(r => r.status === 'rejected'
    || (r.value && !r.value.ok)).length;
  if (failed > 0) {
    uiAlert(t(errKey, { failed, total: toUpdate.length }, errFallback(failed, toUpdate.length)));
  }
  renderPayeesPage();
}

async function renamePayeeGroup(oldName) {
  /** Rename a payee group — updates all payees in that group via the API. */
  const newName = await uiPrompt(t('payees.prompt_rename_group', { name: oldName }, `Rename group "${oldName}" to:`), oldName);
  if (!newName || newName.trim() === oldName) return;
  try {
    await _bulkRegroup(
      p => p.group === oldName,
      newName.trim(),
      'payees.err_rename_partial',
      (f, total) => `Rename failed for ${f} of ${total} payees`
    );
  } catch (e) {
    uiAlert(t('payees.err_rename', { msg: e.message }, `Rename failed: ${e.message}`));
  }
}

async function deletePayeeGroup(groupName) {
  /** Delete a group — moves all payees in that group to "Other" (no group). */
  const otherLabel = t('payees.group_other', {}, 'Other');
  if (!(await uiConfirm(t('payees.confirm_delete_group', { name: groupName, other: otherLabel }, `Delete group "${groupName}"? All ${groupName} payees will be moved to "${otherLabel}".`), { type: 'destructive' }))) return;
  try {
    await _bulkRegroup(
      p => p.group === groupName,
      '',
      'payees.err_delete_partial',
      (f, total) => `Delete failed for ${f} of ${total} payees`
    );
  } catch (e) {
    uiAlert(t('payees.err_delete', { msg: e.message }, `Delete failed: ${e.message}`));
  }
}

async function showPayeeTxOverlay(payeeName) {
  // Build set of matching names: payee name + aliases
  const ctx = await loadTxContext();
  const matchNames = new Set([payeeName.toLowerCase()]);
  if (ctx.payees) {
    const entry = ctx.payees.find(p => p.payee === payeeName);
    if (entry) {
      (entry.aliases || []).forEach(a => matchNames.add(a.toLowerCase()));
    }
  }

  const allMatching = state.tx.filter(tx => matchNames.has((tx.payee || '').toLowerCase()) && !tx.is_auto_generated);
  const limit = 10;
  const txs = allMatching
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, limit);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  const shownLabel = txs.length < limit
    ? String(txs.length)
    : t('payees.overlay.last_n', { n: limit }, `Last ${limit}`);
  const aliasSuffix = matchNames.size > 1
    ? t('payees.overlay.hint_aliases_suffix', {}, ' (incl. aliases)')
    : '';

  overlay.innerHTML = `
    <div class="modal" style="width:640px;">
      <h3>${t('payees.overlay.title', { name: escapeHtml(payeeName) }, `<span class="accent">${escapeHtml(payeeName)}</span> — Recent Transactions`)}</h3>
      <div class="hint-md mb-16">${t('payees.overlay.hint', { shown: escapeHtml(shownLabel), total: allMatching.length }, `${shownLabel} of ${allMatching.length} transactions`)}${aliasSuffix}</div>
      ${txs.length === 0 ? `<div class="empty-state compact"><div class="empty-state-icon">&#x1F50D;</div><div class="empty-state-desc">${t('payees.overlay.empty', {}, 'No transactions found.')}</div></div>` : `
      <table class="tx-table mb-0">
        <thead><tr><th>${t('common.label.date', {}, 'Date')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('common.col.category', {}, 'Category')}</th><th>${t('common.label.note', {}, 'Note')}</th><th class="amt">${t('common.col.amount', {}, 'Amount')}</th></tr></thead>
        <tbody>
          ${txs.map(tx => {
            const amtClass = tx.type === 'income' ? 'income' : tx.type === 'transfer' ? 'transfer' : 'expense';
            const sign = tx.type === 'income' ? '+' : tx.type === 'transfer' ? '' : '-';
            return `<tr>
              <td>${fmtDate(tx.date)}</td>
              <td class="fs-12">${escapeHtml(tx.account)}</td>
              <td class="cat fs-12">${escapeHtml(tx.category || '')}</td>
              <td style="font-size:11px;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(tx.note || '')}</td>
              <td class="amt ${amtClass}">${sign}${formatCurrency(tx.amount, tx.currency)} ${tx.currency}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`}
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right"><button data-action="closeModal">${t('common.actions.close', {}, 'Close')}</button></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function showPayeeModal(editId) {
  const ctx = await loadTxContext();
  let payee = null;
  let allPayees = [];
  try {
    const res = await fetch('/api/payees/list', { method: 'POST' });
    const data = await res.json();
    allPayees = data.payees || [];
    if (editId) payee = allPayees.find(p => p.id === editId);
  } catch (e) { console.warn('[payees:silent-catch]', e); }

  const isEdit = !!payee;
  const accOptions = ctx.accounts.filter(a => a.status === 'active').map(a =>
    `<option value="${escapeHtml(a.alias)}" ${payee && payee.default_account === a.alias ? 'selected' : ''}>${escapeHtml(a.alias)} — ${escapeHtml(a.name)}</option>`
  ).join('');
  const catOptions = ctx.categories.filter(c => c.active).map(c =>
    `<option value="${c.path}" ${payee && payee.default_category === c.path ? 'selected' : ''}>${c.path}</option>`
  ).join('');

  // Extract unique groups
  const existingGroups = [...new Set(allPayees.map(p => p.group).filter(Boolean))].sort();
  const currentGroup = payee?.group || '';
  const groupOptions = existingGroups.map(g =>
    `<option value="${escapeHtml(g)}" ${g === currentGroup ? 'selected' : ''}>${escapeHtml(g)}</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? t('settings.payees.modal.title_edit', {}, 'Edit <span class="accent">Payee</span>') : t('settings.payees.modal.title_add', {}, 'Add <span class="accent">Payee</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.payees.modal.label_payee_name', {}, 'Payee Name')}</label>
          <input type="text" id="pm-payee" value="${escapeHtml(payee?.payee || '')}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.payees.modal.label_aliases', {}, 'Aliases (comma-separated)')}</label>
          <input type="text" id="pm-aliases" value="${escapeHtml((payee?.aliases || []).join(', '))}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.payees.modal.label_default_category', {}, 'Default Category')}</label>
          <select id="pm-category"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option>${catOptions}</select>
        </div>
        <div class="atx-field"><label>${t('settings.payees.modal.label_default_account', {}, 'Default Account')}</label>
          <select id="pm-account"><option value="">${t('settings.payees.modal.opt_account_none', {}, 'None')}</option>${accOptions}</select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.payees.modal.label_auto_tag', {}, 'Auto-Tag')}</label>
          <input type="text" id="pm-autotag" value="${escapeHtml(payee?.auto_tag || '')}">
        </div>
        <div class="atx-field"><label>${t('settings.payees.modal.label_group', {}, 'Group')}</label>
          <select id="pm-group-select" onchange="if(this.value==='__new__'){this.style.display='none';document.getElementById('pm-group-new').style.display='';document.getElementById('pm-group-new').focus();}">
            <option value="">${t('settings.payees.modal.opt_group_none', {}, 'No group')}</option>
            ${groupOptions}
            <option value="__new__">${t('settings.payees.modal.opt_group_new', {}, '+ New group...')}</option>
          </select>
          <input type="text" id="pm-group-new" placeholder="${t('settings.payees.modal.placeholder_group_new', {}, 'New group name')}" style="display:none;" value="">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.payees.modal.label_notes', {}, 'Notes')}</label>
          <input type="text" id="pm-notes" value="${escapeHtml(payee?.notes || '')}">
        </div>
      </div>
      <div id="pm-status"></div>
      <div class="modal-footer">
        <div class="btn-left">
          ${isEdit ? `<button class="btn-delete" data-action="deletePayee" data-arg1="${escapeHtml(editId)}">${t('common.actions.delete', {}, 'Delete')}</button>` : ''}
        </div>
        <div class="btn-right">
          <button data-action="closeModal">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" data-action="savePayee" data-arg1="${isEdit ? escapeHtml(editId) : ''}">${isEdit ? t('common.actions.save', {}, 'Save') : t('common.actions.add', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function savePayee(editId) {
  const data = {
    payee: document.getElementById('pm-payee').value.trim(),
    aliases: document.getElementById('pm-aliases').value.split(',').map(a => a.trim()).filter(Boolean),
    default_category: document.getElementById('pm-category').value,
    default_account: document.getElementById('pm-account').value,
    auto_tag: document.getElementById('pm-autotag').value.trim(),
    group: (document.getElementById('pm-group-new').style.display !== 'none'
      ? document.getElementById('pm-group-new').value.trim()
      : (document.getElementById('pm-group-select').value === '__new__' ? '' : document.getElementById('pm-group-select').value)),
    notes: document.getElementById('pm-notes').value.trim(),
  };
  if (!data.payee) { document.getElementById('pm-status').innerHTML = `<div class="atx-status error">${t('settings.payees.modal.err_name_required', {}, 'Payee name is required')}</div>`; return; }

  const statusEl = document.getElementById('pm-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

  try {
    const endpoint = editId ? '/api/payees/update' : '/api/payees/add';
    const body = editId ? { id: editId, updated: data } : data;
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderPayeesPage();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

async function deletePayee(id) {
  if (!(await uiConfirm(t('settings.payees.modal.confirm_delete', {}, 'Delete this payee?'), { type: 'destructive' }))) return;
  try {
    await fetch('/api/payees/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    closeModal();
    renderPayeesPage();
  } catch (e) { console.warn('[payees:silent-catch]', e); }
}
