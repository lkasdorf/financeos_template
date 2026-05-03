// ─── Edit TX Modal ────────────────────────────────────────────────────────
//
// Extracted from forms.js (Code-Review HIGH 1, forms.js God-Module split,
// step 3/3). Companion file: forms-add-tx.js. External dependencies:
// loadTxContext (forms-add-tx.js), t / escapeHtml (i18n.js / core.js),
// state, applyI18n. All functions stay on the global scope so onclick=
// handlers in the rendered HTML keep working unchanged.


function openEditModal(tx) {
  // Ensure context is loaded for dropdowns
  loadTxContext().then(ctx => renderEditModal(tx, ctx));
}

function renderEditModal(tx, ctx) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  const isTransfer = tx.type === 'transfer';
  const activeAccounts = ctx.accounts.filter(a => a.status === 'active');

  // Account options
  const accOptions = activeAccounts.map(a =>
    `<option value="${a.alias}" ${tx.account === a.alias ? 'selected' : ''}>${a.alias} — ${a.name}</option>`
  ).join('');

  // Transfer-to options
  const trOptions = activeAccounts.map(a =>
    `<option value="${a.alias}" ${tx.transfer_to_account === a.alias ? 'selected' : ''}>${a.alias} — ${a.name}</option>`
  ).join('');

  // Category options — rendered dynamically so type changes update the list.
  // Always include the currently saved category even if it doesn't match the
  // selected type (marked as mismatched). Prevents the dropdown showing
  // "Select..." for legitimate edge-case categories (e.g. Cash Discrepancy
  // booked as income against an expense-typed category).
  function buildCatOptions(forType, savedPath) {
    const wanted = forType === 'transfer' ? null : forType;
    const matching = ctx.categories.filter(c => c.active && (!wanted || c.type === wanted));
    const matchingPaths = new Set(matching.map(c => c.path));
    let html = matching.map(c =>
      `<option value="${c.path}" ${savedPath === c.path ? 'selected' : ''}>${c.path}</option>`
    ).join('');
    if (savedPath && !matchingPaths.has(savedPath)) {
      html = `<option value="${savedPath}" selected>${t('editx.type_mismatch', { path: savedPath }, `&#9888; ${savedPath} (type mismatch)`)}</option>` + html;
    }
    return html;
  }
  const catOptions = buildCatOptions(tx.type, tx.category);

  overlay.innerHTML = `
    <div class="modal">
      <h3>${t('editx.title', {}, 'Edit <span class="accent">Transaction</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field fx1">
          <label>${t('common.label.date', {}, 'Date')}</label>
          <input type="date" id="edit-date" value="${tx.date}">
        </div>
        <div class="atx-field fx1">
          <label>${t('common.col.type', {}, 'Type')}</label>
          <select id="edit-type">
            <option value="expense" ${tx.type === 'expense' ? 'selected' : ''}>${t('common.type.expense', {}, 'Expense')}</option>
            <option value="income" ${tx.type === 'income' ? 'selected' : ''}>${t('common.type.income', {}, 'Income')}</option>
            <option value="transfer" ${tx.type === 'transfer' ? 'selected' : ''}>${t('common.type.transfer', {}, 'Transfer')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1">
          <label>${t('common.col.account', {}, 'Account')}</label>
          <select id="edit-account">
            <option value="">${t('common.select_placeholder', {}, 'Select...')}</option>
            ${accOptions}
          </select>
        </div>
        <div class="atx-field fx1">
          <label>${t('common.col.amount', {}, 'Amount')}</label>
          <input type="text" id="edit-amount" value="${tx.amount}">
        </div>
      </div>
      <div id="edit-payee-row" class="atx-row" style="display:${isTransfer ? 'none' : 'flex'}">
        <div class="atx-field fx1">
          <label>${t('common.col.payee', {}, 'Payee')}</label>
          <input type="text" id="edit-payee" value="${escapeHtml(tx.payee || '')}">
        </div>
        <div class="atx-field fx1">
          <label>${t('common.col.category', {}, 'Category')}</label>
          <select id="edit-category">
            <option value="">${t('common.select_placeholder', {}, 'Select...')}</option>
            ${catOptions}
          </select>
        </div>
      </div>
      <div id="edit-transfer-row" class="atx-row" style="display:${isTransfer ? 'flex' : 'none'}">
        <div class="atx-field fx1">
          <label>${t('atx.m.label_transfer_to', {}, 'Transfer to')}</label>
          <select id="edit-transfer-to">
            <option value="">${t('common.select_placeholder', {}, 'Select...')}</option>
            ${trOptions}
          </select>
        </div>
        <div class="atx-field fx1">
          <label>${t('editx.label_transfer_amount', {}, 'Transfer amount (cross-currency)')}</label>
          <input type="text" id="edit-transfer-amount" value="${tx.transfer_to_amount || ''}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1">
          <label>${t('common.label.note', {}, 'Note')}</label>
          <textarea id="edit-note" rows="2" style="resize:vertical;min-height:44px;">${escapeHtml(tx.note || '')}</textarea>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1">
          <label>${t('common.col.tags', {}, 'Tags')}</label>
          <div id="edit-tags" class="tag-picker">
            ${(ctx.tags || []).filter(tag => tag.active).map(tag =>
              `<label><input type="checkbox" value="${tag.tag}" ${(tx.tags || '').split(';').includes(tag.tag) ? 'checked' : ''}><span>${tag.tag}</span></label>`
            ).join('')}
          </div>
        </div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:4px;">
        ${t('editx.meta_html', { id: escapeHtml(tx.import_id), currency: escapeHtml(tx.currency) }, `Import ID: ${tx.import_id} &middot; Currency: ${tx.currency}`)}
      </div>
      <div id="edit-status"></div>
      <div class="modal-footer">
        <div class="btn-left">
          <button class="btn-delete" data-action="deleteTx" data-arg1="${tx.import_id}">${t('common.actions.delete', {}, 'Delete')}</button>
        </div>
        <div class="btn-right">
          <button class="edit-duplicate-btn" data-import-id="${tx.import_id}">${t('common.actions.duplicate', {}, 'Duplicate')}</button>
          <button data-action="closeModal">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" data-action="saveTxEdit" data-arg1="${tx.import_id}">${t('common.actions.save', {}, 'Save')}</button>
        </div>
      </div>
    </div>
  `;

  // Type change handler
  document.body.appendChild(overlay);
  document.getElementById('edit-type').addEventListener('change', (e) => {
    const nextType = e.target.value;
    document.getElementById('edit-payee-row').style.display = nextType === 'transfer' ? 'none' : 'flex';
    document.getElementById('edit-transfer-row').style.display = nextType === 'transfer' ? 'flex' : 'none';
    const catSel = document.getElementById('edit-category');
    if (catSel) catSel.innerHTML = `<option value="">${t('common.select_placeholder', {}, 'Select...')}</option>` + buildCatOptions(nextType, catSel.value);
  });

  // Duplicate button: uses current form state (user-editable) rather than the
  // original tx, so mid-edit tweaks are kept in the duplicate too.
  const dupBtn = overlay.querySelector('.edit-duplicate-btn');
  if (dupBtn) dupBtn.addEventListener('click', () => {
    const current = {
      type: document.getElementById('edit-type').value,
      account: document.getElementById('edit-account').value,
      amount: parseAmountInputStr(document.getElementById('edit-amount').value),
      currency: tx.currency,
      payee: document.getElementById('edit-payee').value,
      category: document.getElementById('edit-category').value,
      note: document.getElementById('edit-note').value,
      tags: Array.from(document.querySelectorAll('#edit-tags input:checked')).map(c => c.value).join(';'),
      transfer_to_account: document.getElementById('edit-transfer-to').value,
      transfer_to_amount: parseAmountInputStr(document.getElementById('edit-transfer-amount').value),
    };
    duplicateTx(current);
  });

  // Close on Escape
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

function closeModal() {
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) {
    document.removeEventListener('keydown', overlay._escHandler);
    overlay.remove();
  }
}

async function saveTxEdit(importId) {
  const updated = {
    date: document.getElementById('edit-date').value,
    type: document.getElementById('edit-type').value,
    account: document.getElementById('edit-account').value,
    amount: parseAmountInputStr(document.getElementById('edit-amount').value),
    payee: document.getElementById('edit-payee').value,
    category: document.getElementById('edit-category').value,
    note: document.getElementById('edit-note').value,
    tags: Array.from(document.querySelectorAll('#edit-tags input:checked')).map(c => c.value).join(';'),
    transfer_to_account: document.getElementById('edit-transfer-to').value,
    transfer_to_amount: parseAmountInputStr(document.getElementById('edit-transfer-amount').value),
  };

  const statusEl = document.getElementById('edit-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

  try {
    const res = await fetch('/api/tx/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ import_id: importId, updated }),
    });
    const data = await res.json();
    if (data.error) {
      statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(data.error)}</div>`;
      return;
    }
    closeModal();
    // Reload data
    boot();
  } catch (e) {
    statusEl.innerHTML = `<div class="atx-status error">${t('common.save_failed', { msg: escapeHtml(e.message) }, `Save failed: ${escapeHtml(e.message)}`)}</div>`;
  }
}

function showBusyOverlay(message) {
  let overlay = document.getElementById('busy-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'busy-overlay';
    overlay.className = 'busy-overlay';
    overlay.innerHTML = `
      <div class="busy-box">
        <div class="busy-spinner"></div>
        <div class="busy-msg" id="busy-msg"></div>
      </div>`;
    document.body.appendChild(overlay);
  }
  document.getElementById('busy-msg').textContent = message || t('common.busy.working', {}, 'Working...');
  overlay.classList.add('show');
}

function hideBusyOverlay() {
  const overlay = document.getElementById('busy-overlay');
  if (overlay) overlay.classList.remove('show');
}

async function deleteTx(importId) {
  if (!(await uiConfirm(t('editx.confirm_delete', {}, 'Delete this transaction? This cannot be undone.'), { type: 'destructive' }))) return;

  // statusEl only exists when the edit modal is open; inline table delete has no modal
  const statusEl = document.getElementById('edit-status');
  if (statusEl) {
    statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('editx.status_deleting', {}, 'Deleting...')}</div>`;
  }
  showBusyOverlay(t('editx.busy_deleting', {}, 'Deleting transaction...'));

  try {
    const res = await fetch('/api/tx/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ import_id: importId }),
    });
    const data = await res.json();
    if (data.error) {
      hideBusyOverlay();
      if (statusEl) {
        statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(data.error)}</div>`;
      } else {
        uiAlert(t('editx.err_delete', { msg: data.error }, `Delete failed: ${data.error}`));
      }
      return;
    }
    closeModal();
    await boot();
    hideBusyOverlay();
  } catch (e) {
    hideBusyOverlay();
    if (statusEl) {
      statusEl.innerHTML = `<div class="atx-status error">${t('editx.err_delete', { msg: escapeHtml(e.message) }, `Delete failed: ${escapeHtml(e.message)}`)}</div>`;
    } else {
      uiAlert(t('editx.err_delete', { msg: e.message }, `Delete failed: ${e.message}`));
    }
  }
}

