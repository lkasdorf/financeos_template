// ─── Edit TX Modal ────────────────────────────────────────────────────────
//
// Extracted from forms.js (Code-Review HIGH 1, forms.js God-Module split,
// step 3/3). Companion file: forms-add-tx.js. External dependencies:
// loadTxContext (forms-add-tx.js), t / escapeHtml (i18n.js / core.js),
// state, applyI18n. All functions stay on the global scope so onclick=
// handlers in the rendered HTML keep working unchanged.


// v1.6.0 receipt attachments — modal-scoped state. Reset on every open so
// closing and re-opening the modal can never bleed state across TXs.
let _editRcptUrls = [];       // current URL list (existing kept + freshly uploaded)
let _editRcptNewFiles = [];   // new File objects, uploaded inside saveTxEdit
let _editRcptToDelete = [];   // existing URLs marked for delete on save
let _editRcptDetach = null;   // attachFilePickerAndPaste detach handle

function openEditModal(tx) {
  // Ensure context is loaded for dropdowns. When the subscriptions
  // feature is on, fetch the existing link in parallel so the modal
  // can pre-select the dropdown — this avoids a second render pass
  // after the modal is already on screen.
  const ctxP = loadTxContext();
  const linkP = isFeatureEnabled('subscriptions')
    ? fetch('/api/subscriptions/log_for_tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_import_id: tx.import_id }),
      }).then(r => r.json()).then(d => d.subscription_id || '').catch(() => '')
    : Promise.resolve('');
  Promise.all([ctxP, linkP]).then(([ctx, currentSubId]) => {
    renderEditModal(tx, ctx, currentSubId);
  });
}

function renderEditModal(tx, ctx, currentSubId = '') {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  const isTransfer = tx.type === 'transfer';
  const activeAccounts = ctx.accounts.filter(a => a.status === 'active');

  // Account options
  const accOptions = activeAccounts.map(a =>
    `<option value="${escapeHtml(a.alias)}" ${tx.account === a.alias ? 'selected' : ''}>${escapeHtml(a.alias)} — ${escapeHtml(a.name)}</option>`
  ).join('');

  // Transfer-to options
  const trOptions = activeAccounts.map(a =>
    `<option value="${escapeHtml(a.alias)}" ${tx.transfer_to_account === a.alias ? 'selected' : ''}>${escapeHtml(a.alias)} — ${escapeHtml(a.name)}</option>`
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
      `<option value="${escapeHtml(c.path)}" ${savedPath === c.path ? 'selected' : ''}>${escapeHtml(c.path)}</option>`
    ).join('');
    if (savedPath && !matchingPaths.has(savedPath)) {
      const safePath = escapeHtml(savedPath);
      html = `<option value="${safePath}" selected>${t('editx.type_mismatch', { path: safePath }, `&#9888; ${safePath} (type mismatch)`)}</option>` + html;
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
              `<label><input type="checkbox" value="${escapeHtml(tag.tag)}" ${(tx.tags || '').split(';').includes(tag.tag) ? 'checked' : ''}><span>${escapeHtml(tag.tag)}</span></label>`
            ).join('')}
          </div>
        </div>
      </div>
      <!-- v1.6.0 receipt attachments — Photos + PDFs with drag-drop + paste support. -->
      <div class="atx-row" id="edit-receipts-row">
        <div class="atx-field fx1">
          <label>${t('receipts.upload.cta', {}, 'Attachments (optional)')}</label>
          <div id="edit-receipt-dropzone" class="receipt-dropzone">
            <input type="file" id="edit-receipt-input" multiple accept="image/*,application/pdf,.heic,.heif" hidden>
            <button type="button" class="receipt-pick-btn" data-action="editReceiptPick">${t('receipts.upload.pick_btn', {}, 'Pick files')}</button>
            <span class="hint-sm">${t('receipts.upload.dropzone', {}, 'or drop files / paste a screenshot')}</span>
          </div>
          <div id="edit-receipt-grid" class="receipt-grid-host"></div>
        </div>
      </div>
      ${tx.type !== 'transfer' ? `
      <!-- Property picker. Pre-selection is computed by loadPropertyPicker
           after the API call returns (it owns the cost_tag ↔ property_id
           map). data-original holds the resolved property_id once known
           so the submit handler can suppress no-op updates. -->
      <div class="atx-row" id="edit-property-row" hidden>
        <div class="atx-field fx1">
          <label>${t('atx.m.label_property', {}, 'Link to property')}</label>
          <select id="edit-property" data-original="">
            <option value="">${t('atx.m.property_none', {}, '— none —')}</option>
          </select>
        </div>
      </div>
      ` : ''}
      ${(isFeatureEnabled('subscriptions') && tx.type !== 'transfer') ? `
      <div class="atx-row" id="edit-sub-row">
        <div class="atx-field fx1">
          <label>${t('atx.m.label_subscription', {}, 'Link to subscription')}</label>
          <select id="edit-subscription" data-original="${escapeHtml(currentSubId)}">
            <option value="">${t('atx.m.subscription_none', {}, '— none —')}</option>
          </select>
        </div>
      </div>
      ` : ''}
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

  // v1.6.0 — initialise receipt-attachment state from the TX, then wire
  // the dropzone, file-input, and paste handler. Reset on every open so
  // a previous modal's pending state doesn't bleed in.
  _editRcptUrls = parseReceiptList(tx.receipt_url || '');
  _editRcptNewFiles = [];
  _editRcptToDelete = [];
  _renderEditReceiptGrid();
  _initEditReceiptPickers();

  // Populate subscription picker (if rendered) and pre-select current
  // link. The select keeps its current value if the API errors out
  // so the modal still works without subscriptions data.
  const subSel = document.getElementById('edit-subscription');
  if (subSel) {
    fetch('/api/subscriptions/active_for_picker', { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        const rows = data.subscriptions || [];
        // If the existing link points to an inactive sub, append a
        // synthetic option so it stays selectable instead of silently
        // unlinking on save. Marked with a small "(inactive)" suffix.
        const known = new Set(rows.map(r => r.subscription_id));
        const opts = [`<option value="">${t('atx.m.subscription_none', {}, '— none —')}</option>`];
        for (const r of rows) {
          const label = r.group ? `${r.group} · ${r.name}` : r.name;
          opts.push(`<option value="${escapeHtml(r.subscription_id)}">${escapeHtml(label)}</option>`);
        }
        if (currentSubId && !known.has(currentSubId)) {
          opts.push(`<option value="${escapeHtml(currentSubId)}">${escapeHtml(currentSubId)} (inactive)</option>`);
        }
        subSel.innerHTML = opts.join('');
        subSel.value = currentSubId || '';
      })
      .catch(() => { /* leave the placeholder */ });
  }

  // Property picker: pre-select the property whose cost_tag is already
  // attached to the TX, if any. Reuses the Add-TX loader so the
  // cost_tag ↔ property_id map is single-sourced.
  const propSel = document.getElementById('edit-property');
  if (propSel) {
    const existingTags = (tx.tags || '').split(';').filter(Boolean);
    fetch('/api/properties/list', { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        const rows = (data.properties || []).filter(p => p.active !== false);
        if (!rows.length) {
          // No active properties — keep the row hidden.
          return;
        }
        const byTag = {};
        for (const r of rows) {
          const tag = (r.cost_tag || '').trim();
          if (tag) byTag[tag] = r;
        }
        const opts = [`<option value="">${t('atx.m.property_none', {}, '— none —')}</option>`];
        for (const r of rows) {
          opts.push(`<option value="${escapeHtml(r.property_id)}">${escapeHtml(r.name || r.property_id)}</option>`);
        }
        propSel.innerHTML = opts.join('');
        const matched = existingTags.map(t => byTag[t]).find(Boolean);
        const initial = matched ? matched.property_id : '';
        propSel.value = initial;
        propSel.dataset.original = initial;
        const row = propSel.closest('.atx-row');
        if (row) row.hidden = false;
      })
      .catch(() => { /* leave hidden */ });
  }

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
  // v1.6.0 — detach the receipt pickers so a re-open doesn't double-bind.
  if (_editRcptDetach) { _editRcptDetach(); _editRcptDetach = null; }
}

// ─── v1.6.0 receipt attachments (Edit-TX) ─────────────────────────────

function _renderEditReceiptGrid() {
  const host = document.getElementById('edit-receipt-grid');
  if (!host) return;
  const removeLabel = escapeHtml(t('receipts.modal.remove', {}, 'Remove'));
  const tiles = [];

  // Existing server-side URLs — show server thumbnail, click opens viewer.
  _editRcptUrls.forEach((url, idx) => {
    const kind = getKindFromUrl(url);
    const thumb = kind === 'image' ? getThumbUrl(url) : '';
    const body = kind === 'image'
      ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy">`
      : `<div class="receipt-tile-pdf">📄<span class="receipt-tile-pdf-label">PDF</span></div>`;
    tiles.push(`<div class="receipt-tile" data-rcpt-kind="existing" data-arg1="${idx}" data-rcpt-url="${escapeHtml(url)}"><div class="receipt-tile-body">${body}</div><button type="button" class="receipt-tile-remove" data-rcpt-action="remove-existing" data-arg1="${idx}" title="${removeLabel}">×</button></div>`);
  });

  // Pending new files — blob-preview, will be uploaded on save.
  _editRcptNewFiles.forEach((f, idx) => {
    const isImage = (f.type || '').startsWith('image/');
    const preview = isImage ? URL.createObjectURL(f) : '';
    const body = isImage
      ? `<img src="${preview}" alt="" loading="lazy">`
      : `<div class="receipt-tile-pdf">📄<span class="receipt-tile-pdf-label">PDF</span></div>`;
    tiles.push(`<div class="receipt-tile receipt-tile-pending" data-rcpt-kind="pending" data-arg1="${idx}"><div class="receipt-tile-body">${body}</div><button type="button" class="receipt-tile-remove" data-rcpt-action="remove-pending" data-arg1="${idx}" title="${removeLabel}">×</button><div class="receipt-tile-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div></div>`);
  });

  if (!tiles.length) {
    host.innerHTML = `<div class="receipt-grid-empty hint-sm">${escapeHtml(t('receipts.modal.empty', {}, 'No attachments'))}</div>`;
  } else {
    host.innerHTML = `<div class="receipt-grid">${tiles.join('')}</div>`;
  }

  host.onclick = (e) => {
    const removeBtn = e.target.closest('[data-rcpt-action]');
    if (removeBtn) {
      e.stopPropagation();
      const action = removeBtn.getAttribute('data-rcpt-action');
      const idx = Number(removeBtn.getAttribute('data-arg1'));
      if (action === 'remove-existing') {
        const url = _editRcptUrls[idx];
        if (url) _editRcptToDelete.push(url);
        _editRcptUrls.splice(idx, 1);
      } else if (action === 'remove-pending') {
        _editRcptNewFiles.splice(idx, 1);
      }
      _renderEditReceiptGrid();
      return;
    }
    // Click on a non-remove area of an existing tile = open viewer
    const tile = e.target.closest('[data-rcpt-kind="existing"]');
    if (tile) {
      const url = tile.getAttribute('data-rcpt-url');
      if (url) openReceiptViewer(url);
    }
  };
}

function _initEditReceiptPickers() {
  const input = document.getElementById('edit-receipt-input');
  const drop = document.getElementById('edit-receipt-dropzone');
  if (!input || !drop) return;
  if (typeof window !== 'undefined') window.editReceiptPick = () => input.click();
  if (_editRcptDetach) _editRcptDetach();
  // Scope paste handler to the modal overlay so Ctrl+V works while any
  // field in the modal has focus.
  const pasteRoot = document.querySelector('.modal-overlay') || document.body;
  _editRcptDetach = attachFilePickerAndPaste({
    fileInput: input,
    dropZone: drop,
    pasteRoot: pasteRoot,
    onFiles: (files) => {
      const used = _editRcptUrls.length + _editRcptNewFiles.length;
      const room = 5 - used;
      if (room <= 0) {
        const status = document.getElementById('edit-status');
        if (status) status.innerHTML = `<div class="atx-status error">${escapeHtml(t('receipts.upload.too_many', { max: 5 }, 'Max 5 attachments per transaction'))}</div>`;
        return;
      }
      _editRcptNewFiles.push(...files.slice(0, room));
      _renderEditReceiptGrid();
    },
  });
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

  // Subscription link: only send the field when the picker actually
  // exists (feature on, non-transfer TX) AND the value differs from
  // the link the modal opened with. This way an unrelated edit (e.g.
  // category change) never accidentally re-writes the log row.
  const subSel = document.getElementById('edit-subscription');
  if (subSel) {
    const original = subSel.dataset.original || '';
    const current = subSel.value || '';
    if (original !== current) {
      updated.subscription_id = current;
    }
  }

  // Property link: same change-detection pattern. Backend re-resolves
  // the cost_tag and rewrites the tags field so we never have to send
  // the tag itself from the client.
  const propSelSave = document.getElementById('edit-property');
  if (propSelSave) {
    const originalProp = propSelSave.dataset.original || '';
    const currentProp = propSelSave.value || '';
    if (originalProp !== currentProp) {
      updated.property_id = currentProp;
    }
  }

  const statusEl = document.getElementById('edit-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

  // v1.6.0 receipts — upload new files, then delete removed ones. If the
  // upload fails we abort and leave the TX as-is so the user can fix the
  // file issue without losing the rest of the edits. Deletes are best-
  // effort (orphan files cost nothing) so a deletion failure doesn't
  // block the save itself.
  try {
    if (_editRcptNewFiles.length) {
      statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${escapeHtml(t('receipts.upload.uploading', {}, 'Uploading attachments...'))}</div>`;
      const saved = await uploadReceipts(_editRcptNewFiles);
      _editRcptUrls.push(...saved.map(s => s.url));
      _editRcptNewFiles = [];
    }
  } catch (uploadErr) {
    statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(t('receipts.upload.error_generic', { msg: uploadErr.message }, `Attachment upload failed: ${uploadErr.message}`))}</div>`;
    return;
  }
  if (_editRcptToDelete.length) {
    try { await deleteReceipts(_editRcptToDelete); } catch (e) { /* orphan-file is non-fatal */ }
    _editRcptToDelete = [];
  }
  updated.receipt_url = serializeReceiptList(_editRcptUrls);

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
    refreshData();
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
    await refreshData();
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

