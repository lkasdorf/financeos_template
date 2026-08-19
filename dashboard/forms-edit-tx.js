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

// Receipt-split group editing — same reset-on-open discipline. The total
// is pinned when group mode is entered: re-slicing a receipt across
// categories must not change what was paid, or the group stops matching
// its bank line in the next reconciliation.
let _editGroupTx = null;      // the TX the modal was opened on
let _editGroupRows = [];      // sibling rows of its receipt group
let _editGroupLines = [];     // editable {import_id?, amount, category, note}
let _editGroupTotal = 0;      // pinned group sum
let _editGroupCurrency = '';  // for formatting the remainder
let _editGroupNewId = '';     // group id minted when splitting a single TX

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
  // Members of this TX's receipt split, if any. Counter-entries carry the
  // same receipt_group but belong to the backend, so they are filtered out
  // — the group the user edits is the expense side only.
  const grp = (tx.receipt_group || '').trim();
  const groupRows = grp
    ? (state.tx || []).filter(r => (r.receipt_group || '').trim() === grp
                                   && !(r.counter_entry_id || '').trim())
    : [];

  Promise.all([ctxP, linkP]).then(([ctx, currentSubId]) => {
    renderEditModal(tx, ctx, currentSubId, groupRows);
  });
}

function renderEditModal(tx, ctx, currentSubId = '', groupRows = []) {
  const isTransfer = tx.type === 'transfer';
  // Group state is per-modal; reset it here so a previously opened split
  // cannot bleed into the next transaction's modal.
  _editGroupTx = tx;
  _editGroupRows = groupRows;
  _editGroupLines = [];
  _editGroupTotal = 0;
  _editGroupNewId = '';
  _editGroupCurrency = tx.currency || '';

  // A real split gets the mode toggle; a plain expense gets the offer to
  // become one. Transfers and income never do — a split describes one
  // purchase receipt across several categories.
  const canSplit = tx.type === 'expense' && !(tx.receipt_group || '').trim();
  const groupToggle = groupRows.length > 1 ? `
      <div class="atx-row" id="edit-group-toggle">
        <div class="flex-row gap-sm">
          <button type="button" class="btn-sm btn-accent" id="edit-mode-line" data-action="toggleGroupMode" data-arg1="">${escapeHtml(t('editx.group.toggle_line', {}, 'This line'))}</button>
          <button type="button" class="btn-sm" id="edit-mode-group" data-action="toggleGroupMode" data-arg1="${escapeHtml(tx.receipt_group || '')}">${escapeHtml(t('editx.group.toggle_group', { n: groupRows.length }, `Whole receipt (${groupRows.length} lines)`))}</button>
        </div>
      </div>` : (canSplit ? `
      <div class="atx-row" id="edit-group-toggle">
        <button type="button" class="btn-sm" id="edit-split-btn" data-action="splitSingleTx">${escapeHtml(t('editx.group.btn_split', {}, 'Split into categories'))}</button>
      </div>` : '');
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

  // DP-M6 Phase 2 — openModal() owns overlay/Escape/backdrop lifecycle;
  // the receipt-picker detach runs via onClose on every close path.
  const { overlay } = openModal({
    title: t('editx.title', {}, 'Edit <span class="accent">Transaction</span>'),
    maxWidth: '620px',
    onClose: () => {
      if (_editRcptDetach) { _editRcptDetach(); _editRcptDetach = null; }
    },
    bodyHtml: `
      ${groupToggle}
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
      <!-- Group mode: per-line amount/category move in here, the fields
           above stay single because they describe the whole receipt. -->
      <div id="edit-splits-area" hidden></div>
      <div class="atx-row" id="edit-split-info-row" hidden>
        <span id="edit-split-info" class="split-badge"></span>
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
          <button data-modal-cancel>${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" data-action="saveTxEdit" data-arg1="${tx.import_id}">${t('common.actions.save', {}, 'Save')}</button>
        </div>
      </div>`,
  });

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

}

// DP-M6 Phase 2 — global close shim for dispatcher-invoked flows that close
// the modal from global scope (saveTxEdit, deleteTx, duplicateTx, saveDebt,
// savePayee, the settings save handlers, …). Overlays built
// via openModal() close through their instance _close(), which detaches
// the Escape listener and runs the modal's onClose cleanup. The legacy
// _escHandler branch covers any overlay not yet migrated.
function closeModal() {
  const overlay = document.querySelector('.modal-overlay');
  if (!overlay) return;
  if (overlay._close) { overlay._close(); return; }
  if (overlay._escHandler) document.removeEventListener('keydown', overlay._escHandler);
  overlay.remove();
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

// ─── Group mode ───────────────────────────────────────────────────────────
//
// The same modal serves two jobs: editing one line, and re-slicing a whole
// receipt. Rather than rendering a second modal, group mode hides the
// per-line fields (amount, category) and shows the split rows. Everything
// else — date, account, payee, tags, attachments — describes the receipt
// and is therefore group-wide by construction, which is exactly the
// invariant the recon adapter needs.

function _editFieldWrapper(id) {
  const el = document.getElementById(id);
  return el ? el.closest('.atx-field') : null;
}

function toggleGroupMode(receiptGroup) {
  const grp = (receiptGroup || '').trim();
  const amountWrap = _editFieldWrapper('edit-amount');
  const catWrap = _editFieldWrapper('edit-category');
  const area = document.getElementById('edit-splits-area');
  const infoRow = document.getElementById('edit-split-info-row');
  const saveBtn = document.querySelector('.btn-save');
  const lineBtn = document.getElementById('edit-mode-line');
  const groupBtn = document.getElementById('edit-mode-group');

  if (!grp) {
    // Back to single-line editing.
    _editGroupLines = [];
    _editGroupNewId = '';
    if (amountWrap) amountWrap.hidden = false;
    if (catWrap) catWrap.hidden = false;
    if (area) { area.hidden = true; area.innerHTML = ''; }
    if (infoRow) infoRow.hidden = true;
    if (saveBtn) {
      saveBtn.dataset.action = 'saveTxEdit';
      saveBtn.dataset.arg1 = _editGroupTx ? _editGroupTx.import_id : '';
      saveBtn.disabled = false;
    }
    if (lineBtn) lineBtn.classList.add('btn-accent');
    if (groupBtn) groupBtn.classList.remove('btn-accent');
    return;
  }

  const rows = _editGroupRows.length
    ? _editGroupRows
    : (state.tx || []).filter(r => (r.receipt_group || '').trim() === grp
                                   && !(r.counter_entry_id || '').trim());
  _editGroupLines = rows.map(r => ({
    import_id: r.import_id,
    amount: r.amount,
    category: r.category,
    note: r.note || '',
  }));
  _editGroupTotal = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  _editGroupCurrency = rows[0] ? rows[0].currency : _editGroupCurrency;

  if (amountWrap) amountWrap.hidden = true;
  if (catWrap) catWrap.hidden = true;
  if (area) area.hidden = false;
  if (infoRow) infoRow.hidden = false;
  if (saveBtn) {
    saveBtn.dataset.action = 'saveTxGroupEdit';
    saveBtn.dataset.arg1 = grp;
  }
  if (lineBtn) lineBtn.classList.remove('btn-accent');
  if (groupBtn) groupBtn.classList.add('btn-accent');
  renderEditSplitLines();
}

function renderEditSplitLines() {
  const catSel = document.getElementById('edit-category');
  renderSplitRows({
    containerId: 'edit-splits-area',
    lines: _editGroupLines,
    catOptionsHtml: catSel ? catSel.innerHTML : '',
    onChange: updateEditRemainder,
    addAction: 'addEditSplitLine',
    removeAction: 'removeEditSplitLine',
  });
  updateEditRemainder();
}

function updateEditRemainder() {
  const info = document.getElementById('edit-split-info');
  if (!info) return;
  const sum = _editGroupLines.reduce(
    (s, l) => s + (parseAmountInput(l.amount) || 0), 0);
  const rest = _editGroupTotal - sum;
  const balanced = Math.abs(rest) < 0.01;
  info.textContent = balanced
    ? t('editx.group.balanced', { amount: formatCurrency(_editGroupTotal, _editGroupCurrency) },
        `Balanced: ${_editGroupTotal}`)
    : t('editx.group.remainder', { amount: formatCurrency(rest, _editGroupCurrency) },
        `Remaining: ${rest}`);
  info.classList.toggle('mismatch', !balanced);
  info.classList.toggle('match', balanced);
  // The server enforces the same rule; blocking here saves a round-trip
  // and explains itself while the user is still typing.
  const saveBtn = document.querySelector('.btn-save');
  if (saveBtn && saveBtn.dataset.action === 'saveTxGroupEdit') {
    saveBtn.disabled = !balanced;
  }
}

function addEditSplitLine() {
  // Pre-fill with what is still unallocated: the common case is "one more
  // category on the same receipt", which then needs no typing and keeps
  // the sum invariant true by construction.
  const sum = _editGroupLines.reduce(
    (s, l) => s + (parseAmountInput(l.amount) || 0), 0);
  const rest = Math.max(_editGroupTotal - sum, 0);
  _editGroupLines.push({ amount: rest ? String(rest) : '', category: '', note: '' });
  renderEditSplitLines();
}

function removeEditSplitLine(idx) {
  if (_editGroupLines.length <= 1) return;
  const removed = _editGroupLines.splice(idx, 1)[0];
  // Hand the freed amount to the first remaining line, otherwise every
  // removal leaves the group unbalanced and the save button disabled.
  if (removed && _editGroupLines.length) {
    const freed = parseAmountInput(removed.amount) || 0;
    const first = _editGroupLines[0];
    first.amount = String((parseAmountInput(first.amount) || 0) + freed);
  }
  renderEditSplitLines();
}

function splitSingleTx() {
  // Mint a group id in the same shape build_manual_lines uses server-side.
  const rand = Math.random().toString(16).slice(2, 14).padEnd(12, '0');
  _editGroupNewId = `split-${rand}`;
  const amountEl = document.getElementById('edit-amount');
  const catEl = document.getElementById('edit-category');
  _editGroupTotal = parseAmountInput(amountEl.value) || 0;
  _editGroupCurrency = _editGroupTx ? _editGroupTx.currency : '';
  _editGroupLines = [{
    import_id: _editGroupTx ? _editGroupTx.import_id : '',
    amount: amountEl.value,
    category: catEl.value,
    note: document.getElementById('edit-note').value || '',
  }];

  const amountWrap = _editFieldWrapper('edit-amount');
  const catWrap = _editFieldWrapper('edit-category');
  if (amountWrap) amountWrap.hidden = true;
  if (catWrap) catWrap.hidden = true;
  document.getElementById('edit-splits-area').hidden = false;
  document.getElementById('edit-split-info-row').hidden = false;
  const saveBtn = document.querySelector('.btn-save');
  if (saveBtn) {
    saveBtn.dataset.action = 'saveTxGroupEdit';
    saveBtn.dataset.arg1 = '';
  }
  const splitBtn = document.getElementById('edit-split-btn');
  if (splitBtn) splitBtn.hidden = true;
  addEditSplitLine();
}

async function saveTxGroupEdit(receiptGroup) {
  const statusEl = document.getElementById('edit-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${escapeHtml(t('common.saving', {}, 'Saving...'))}</div>`;

  // Attachments first: an upload failure must not leave the group half
  // written, and the resulting URLs go onto every member.
  try {
    if (_editRcptNewFiles.length) {
      const saved = await uploadReceipts(_editRcptNewFiles);
      _editRcptUrls.push(...saved.map(s => s.url));
      _editRcptNewFiles = [];
      _renderEditReceiptGrid();
    }
  } catch (err) {
    statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(String(err && err.message || err))}</div>`;
    return;
  }

  const payload = {
    receipt_group: receiptGroup || _editGroupNewId,
    from_import_id: _editGroupNewId && _editGroupTx ? _editGroupTx.import_id : '',
    header: {
      date: document.getElementById('edit-date').value,
      account: document.getElementById('edit-account').value,
      payee: document.getElementById('edit-payee').value,
      note: document.getElementById('edit-note').value,
      tags: Array.from(document.querySelectorAll('#edit-tags input:checked')).map(c => c.value).join(';'),
      receipt_url: _editRcptUrls.join(';'),
    },
    lines: _editGroupLines.map(l => {
      const line = {
        amount: parseAmountInputStr(l.amount),
        category: l.category,
        note: l.note || '',
      };
      if (l.import_id) line.import_id = l.import_id;
      return line;
    }),
    client_id: `grp-${receiptGroup || _editGroupNewId}-${Date.now()}`,
  };

  let res, data;
  try {
    res = await fetch('/api/tx/group-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(String(err && err.message || err))}</div>`;
    return;
  }
  if (!res.ok) {
    // A 409 means one of the removed lines hangs on a fuel/utility/
    // subscription log. Naming it matters: the user has already taken
    // that row out of the form, so "a line is linked" alone leaves them
    // guessing which one to put back. The server ships category+amount
    // per blocked row for exactly this.
    const labels = describeBlockedLines(data.blocked);
    const msg = res.status === 409
      ? t('editx.group.protected', { lines: labels || data.error || '' },
          data.error || 'Line is linked elsewhere.')
      : (data.error || `HTTP ${res.status}`);
    statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(msg)}</div>`;
    return;
  }

  closeModal();
  // Every TX-mutating flow refreshes before re-rendering, otherwise the
  // list redraws from the pre-edit snapshot.
  await refreshData();
  renderTransactionsPage();
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
    // Detached files are removed only AFTER the TX row actually points
    // away from them (DC-M1): deleting before the update left dead
    // receipt links behind whenever the update itself failed. Orphaned
    // files from a failed update are harmless; dead links are not.
    if (_editRcptToDelete.length) {
      try { await deleteReceipts(_editRcptToDelete); } catch (e) { /* orphan-file is non-fatal */ }
      _editRcptToDelete = [];
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
      // 409 = a side log owns this row. Say where it can be deleted
      // instead, translated — data.error alone is English server text.
      const msg = res.status === 409
        ? t('tx.delete.protected',
            { lines: describeBlockedLines(data.blocked) || data.error },
            data.error)
        : data.error;
      if (statusEl) {
        statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(msg)}</div>`;
      } else {
        uiAlert(t('editx.err_delete', { msg }, `Delete failed: ${msg}`));
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

