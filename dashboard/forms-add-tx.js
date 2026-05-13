// ─── Add TX Page ──────────────────────────────────────────────────────────
//
// Extracted from forms.js (Code-Review HIGH 1, forms.js God-Module split,
// step 3/3). Companion file: forms-edit-tx.js. Hosts the Add TX page,
// split lines, preview & confirm, plus the shared loadTxContext() helper.
// Boot trigger (boot() call) lives at the bottom — this is the last defer
// script in the dashboard chain.


// returnRoute: optional hash (e.g. '#account:crdb') to navigate back to after
// a successful booking. Set by navigateToAddTxWithAccount(), cleared by
// returnFromAddTx() and by any "fresh" entry to the Add-TX page (FAB, sidebar
// nav, keyboard "n").
let addTxState = { preview: null, context: null, loading: false, prefillAccount: null, prefillTx: null, returnRoute: null };

// v1.6.0 receipt attachments — pending File objects, uploaded inside
// submitManual() right before /api/tx/manual is called. Reset after a
// successful confirm. Max 5 files mirrors the server-side cap.
let _atxReceiptFiles = [];
let _atxReceiptDetach = null;

async function loadTxContext() {
  if (addTxState.context) return addTxState.context;
  try {
    const res = await fetch('/api/tx/context', { method: 'POST' });
    addTxState.context = await res.json();
  } catch (e) {
    addTxState.context = { accounts: [], categories: [], tags: [], payees: [] };
  }
  return addTxState.context;
}

function navigateToAddTxWithAccount(alias) {
  addTxState.preview = null;
  addTxState.prefillAccount = alias;
  addTxState.returnRoute = '#account:' + alias;
  history.pushState(null, '', '#add-tx');
  navigateTo('add-tx');
}

// Navigate back from the Add-TX page to the route stored in
// addTxState.returnRoute (set by navigateToAddTxWithAccount). Clears the
// return state so subsequent direct entries to Add-TX do not keep showing
// the back bar. Falls back to Dashboard if no return route is set.
function returnFromAddTx() {
  const route = addTxState.returnRoute || '#dashboard';
  addTxState.returnRoute = null;
  addTxState.prefillAccount = null;
  history.pushState(null, '', route);
  navigateTo(route.replace(/^#/, ''));
}

// Duplicate an existing TX: open the Add TX manual form pre-filled with the
// source TX's fields, but with date=today and no import_id (so it becomes a
// fresh transaction on save).
function duplicateTx(tx) {
  if (!tx) return;
  closeModal();
  const today = new Date().toISOString().slice(0, 10);
  addTxState.preview = null;
  addTxState.prefillTx = {
    date: today,
    type: tx.type || 'expense',
    account: tx.account || '',
    amount: tx.amount != null ? String(tx.amount) : '',
    payee: tx.payee || '',
    category: tx.category || '',
    note: tx.note || '',
    tags: (tx.tags || '').split(';').filter(Boolean),
    transfer_to_account: tx.transfer_to_account || '',
    transfer_to_amount: tx.transfer_to_amount ? String(tx.transfer_to_amount) : '',
  };
  history.pushState(null, '', '#add-tx');
  navigateTo('add-tx');
}

async function renderAddTxPage() {
  const content = document.getElementById('add-tx-content');
  if (!content) return;
  const today = new Date().toISOString().slice(0, 10);

  // Load quick expenses for chips — skip entirely if the feature is disabled.
  let qeChipsHtml = '';
  if (isFeatureEnabled('quick_expenses')) {
    try {
      const qeRes = await fetch('/api/quickexp/list', { method: 'POST' });
      const qeData = await qeRes.json();
      const activeQe = (qeData.quick_expenses || []).filter(q => q.active === 'true');
      if (activeQe.length > 0) {
        qeChipsHtml = `
          <div class="qe-chips-label">${t('atx.qe_chips_label', {}, 'Quick Expenses')}</div>
          <div class="qe-chips">
            ${activeQe.map(q => `<button class="qe-chip" data-action="applyQuickExpense" data-arg1="${escapeHtml(q.id)}" data-qe="${escapeHtml(JSON.stringify(q))}"><span class="qe-icon"><svg><use href="#i-zap"/></svg></span>${escapeHtml(q.name)}</button>`).join('')}
          </div>
        `;
      }
    } catch (e) { /* silently skip if API not available */ }
  }

  // Back bar: only shown when the user arrived via a context-aware entry
  // point that stored a return route (e.g. the prominent + Add TX button
  // on an Account detail page). Returns to that route on click.
  const backBar = addTxState.returnRoute ? `
    <div class="atx-return-bar" style="margin-bottom:12px;">
      <button class="report-back" data-action="returnFromAddTx" style="margin:0;">${t('add_tx.back', {}, '← Back')}</button>
    </div>
  ` : '';

  content.innerHTML = `
    ${backBar}
    <div class="atx-section">
      ${qeChipsHtml}

      <div id="atx-manual">
        <div class="atx-row">
          <div class="atx-field fx1">
            <label>${t('common.label.date', {}, 'Date')}</label>
            <input type="date" id="atx-m-date" value="${today}">
          </div>
          <div class="atx-field fx1">
            <label>${t('common.col.type', {}, 'Type')}</label>
            <div class="atx-type-btns" id="atx-type-btns">
              <button class="active" data-type="expense" data-action="setTxType" data-arg1="expense">${t('common.type.expense', {}, 'Expense')}</button>
              <button data-type="income" data-action="setTxType" data-arg1="income">${t('common.type.income', {}, 'Income')}</button>
              <button data-type="transfer" data-action="setTxType" data-arg1="transfer">${t('common.type.transfer', {}, 'Transfer')}</button>
            </div>
          </div>
        </div>
        <div class="atx-row">
          <div class="atx-field fx1">
            <label>${t('common.col.account', {}, 'Account')}</label>
            <select id="atx-m-account"><option value="">${t('common.loading', {}, 'Loading...')}</option></select>
          </div>
          <div class="atx-field fx1">
            <label>${t('common.col.amount', {}, 'Amount')}</label>
            <input type="text" id="atx-m-amount" placeholder="${t('atx.m.placeholder_amount', {}, '45000')}">
          </div>
        </div>
        <div class="atx-row" id="atx-m-payee-row">
          <div class="atx-field fx1">
            <label>${t('common.col.payee', {}, 'Payee')}</label>
            <div class="ac-wrapper">
              <input type="text" id="atx-m-payee" placeholder="${t('atx.m.placeholder_payee', {}, 'Whole Foods')}" autocomplete="off">
              <div class="ac-list" id="atx-payee-ac"></div>
            </div>
          </div>
          <div class="atx-field fx1">
            <label>${t('common.col.category', {}, 'Category')}</label>
            <select id="atx-m-category"><option value="">${t('common.loading', {}, 'Loading...')}</option></select>
          </div>
        </div>
        <div id="atx-splits-area"></div>
        <div class="atx-row" id="atx-m-payee-row-split-btn" style="margin-top:-8px;margin-bottom:8px;align-items:center;">
          <button data-action="addSplitLine" style="font-size:11px;padding:5px 12px;">${t('atx.m.btn_add_split', {}, '+ Split')}</button>
          <span id="atx-split-info" class="split-badge" hidden></span>
        </div>
        <div class="atx-row" id="atx-m-transfer-row" style="display:none">
          <div class="atx-field fx1">
            <label>${t('atx.m.label_transfer_to', {}, 'Transfer to')}</label>
            <select id="atx-m-transfer-to"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option></select>
          </div>
          <div class="atx-field fx1">
            <label>${t('atx.m.label_transfer_amount', {}, 'Transfer amount (if cross-currency)')}</label>
            <input type="text" id="atx-m-transfer-amount" placeholder="${t('atx.m.placeholder_optional', {}, 'Optional')}">
          </div>
        </div>
        <div class="atx-row">
          <div class="atx-field fx1">
            <label>${t('common.label.note', {}, 'Note')}</label>
            <textarea id="atx-m-note" rows="2" placeholder="${t('atx.m.placeholder_optional', {}, 'Optional')}" style="resize:vertical;min-height:44px;"></textarea>
          </div>
        </div>
        <div class="atx-row">
          <div class="atx-field fx1">
            <label>${t('common.col.tags', {}, 'Tags')}</label>
            <div id="atx-m-tags" class="tag-picker"></div>
          </div>
        </div>
        <!-- Property picker — auto-applies the property's cost_tag at write
             time so cost-of-living attribution stays a one-click choice
             instead of remembering tag names. Row hides itself if no
             active properties are defined. -->
        <div class="atx-row" id="atx-m-property-row" hidden>
          <div class="atx-field fx1">
            <label>${t('atx.m.label_property', {}, 'Link to property')}</label>
            <select id="atx-m-property">
              <option value="">${t('atx.m.property_none', {}, '— none —')}</option>
            </select>
            <div class="atx-field-hint" style="font-size:11px;color:var(--muted);margin-top:4px;">${t('atx.m.property_hint', {}, 'Attaches the property tag so the cost shows up in the per-property cost-of-living report.')}</div>
          </div>
        </div>
        ${isFeatureEnabled('subscriptions') ? `
        <div class="atx-row" id="atx-m-sub-row">
          <div class="atx-field fx1">
            <label>${t('atx.m.label_subscription', {}, 'Link to subscription')}</label>
            <select id="atx-m-subscription">
              <option value="">${t('atx.m.subscription_none', {}, '— none —')}</option>
            </select>
            <div class="atx-field-hint" id="atx-m-sub-hint" style="font-size:11px;color:var(--muted);margin-top:4px;" hidden></div>
          </div>
        </div>
        ` : ''}
        <!-- v1.6.0 receipt attachments — Photos + PDFs, drag-drop + paste-supported. -->
        <div class="atx-row" id="atx-m-receipts-row">
          <div class="atx-field fx1">
            <label>${t('receipts.upload.cta', {}, 'Attachments (optional)')}</label>
            <div id="atx-m-receipt-dropzone" class="receipt-dropzone">
              <input type="file" id="atx-m-receipt-input" multiple accept="image/*,application/pdf,.heic,.heif" hidden>
              <button type="button" class="receipt-pick-btn" data-action="atxReceiptPick">${t('receipts.upload.pick_btn', {}, 'Pick files')}</button>
              <span class="hint-sm">${t('receipts.upload.dropzone', {}, 'or drop files / paste a screenshot')}</span>
            </div>
            <div id="atx-m-receipt-grid" class="receipt-grid-host"></div>
          </div>
        </div>
        <div class="atx-actions">
          <button data-action="submitManual">${t('atx.m.btn_preview', {}, 'Preview &rarr;')}</button>
        </div>
      </div>

      <!-- Preview + Status area -->
      <div id="atx-preview-area"></div>
      <div id="atx-status-area"></div>
    </div>
  `;

  // Load context for dropdowns
  loadTxContext().then(ctx => populateTxDropdowns(ctx));

  // Property picker: fetch active properties so any non-utility
  // property cost (repairs, cleaning, rent paid outside the auto-payee
  // rules, etc.) can be tagged with one click.
  loadPropertyPicker('atx-m-property');

  // Subscription picker: fetch active subs and wire payee-based
  // auto-suggestion. Skipped silently if the feature is disabled or
  // the API fails — the form still works without the dropdown.
  if (isFeatureEnabled('subscriptions')) {
    loadSubscriptionPicker('atx-m-subscription');
    const payeeInput = document.getElementById('atx-m-payee');
    if (payeeInput) {
      payeeInput.addEventListener('input', () => {
        suggestSubscriptionFromPayee(payeeInput.value, 'atx-m-subscription', 'atx-m-sub-hint');
      });
      payeeInput.addEventListener('change', () => {
        suggestSubscriptionFromPayee(payeeInput.value, 'atx-m-subscription', 'atx-m-sub-hint');
      });
    }
  }
  _initAtxReceiptPickers();
}

// ─── v1.6.0 receipt attachments (Add-TX) ──────────────────────────────

function _renderAtxReceiptGrid() {
  const host = document.getElementById('atx-m-receipt-grid');
  if (!host) return;
  if (!_atxReceiptFiles.length) {
    host.innerHTML = '';
    return;
  }
  const removeLabel = escapeHtml(t('receipts.modal.remove', {}, 'Remove'));
  const tiles = _atxReceiptFiles.map((f, idx) => {
    const isImage = (f.type || '').startsWith('image/');
    // URL.createObjectURL is fine here — the blob URL is scoped to the
    // document and revoked automatically when the page unloads. We could
    // revoke on remove, but a few stale ones cost nothing on this side.
    const preview = isImage ? URL.createObjectURL(f) : '';
    const body = isImage
      ? `<img src="${preview}" alt="" loading="lazy">`
      : `<div class="receipt-tile-pdf">📄<span class="receipt-tile-pdf-label">PDF</span></div>`;
    return `<div class="receipt-tile receipt-tile-pending"><div class="receipt-tile-body">${body}</div><button type="button" class="receipt-tile-remove" data-arg1="${idx}" title="${removeLabel}">×</button><div class="receipt-tile-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div></div>`;
  }).join('');
  host.innerHTML = `<div class="receipt-grid">${tiles}</div>`;
  host.onclick = (e) => {
    const btn = e.target.closest('.receipt-tile-remove');
    if (!btn) return;
    const idx = Number(btn.getAttribute('data-arg1'));
    _atxReceiptFiles.splice(idx, 1);
    _renderAtxReceiptGrid();
  };
}

function _initAtxReceiptPickers() {
  const input = document.getElementById('atx-m-receipt-input');
  const drop = document.getElementById('atx-m-receipt-dropzone');
  if (!input || !drop) return;
  // The dropzone-button has data-action="atxReceiptPick" so the global
  // dispatcher in core.js will call atxReceiptPick() — wire that here.
  if (typeof window !== 'undefined') window.atxReceiptPick = () => input.click();
  if (_atxReceiptDetach) _atxReceiptDetach();
  // Paste handler scoped to the form root so Ctrl+V works while any
  // field has focus — wider than the dropzone so users don't have to
  // first click into the receipts box.
  const pasteRoot = document.getElementById('atx-m-form') || document.getElementById('page-add-tx') || document.body;
  _atxReceiptDetach = attachFilePickerAndPaste({
    fileInput: input,
    dropZone: drop,
    pasteRoot: pasteRoot,
    onFiles: (files) => {
      const room = 5 - _atxReceiptFiles.length;
      if (room <= 0) {
        showTxStatus('error', t('receipts.upload.too_many', { max: 5 }, 'Max 5 attachments per transaction'));
        return;
      }
      _atxReceiptFiles.push(...files.slice(0, room));
      _renderAtxReceiptGrid();
    },
  });
}

// Cached picker data so payee-suggest matches without re-hitting the API.
const _subPickerCache = { rows: null, byPayee: null };

// Cached active-properties list so the edit-form picker can map a
// Property_<X> tag back to its property_id without a second API call.
const _propertyPickerCache = { rows: null, byCostTag: null };

async function loadPropertyPicker(selectId, opts = {}) {
  // opts.preselectTag — Property_<X> tag string. If present and known,
  // pre-selects the matching <option> after the dropdown is populated.
  // Used by the edit form to reflect the current property assignment.
  const sel = document.getElementById(selectId);
  const row = sel ? sel.closest('.atx-row') : null;
  if (!sel) return;
  let rows = [];
  try {
    const res = await fetch('/api/properties/list', { method: 'POST' });
    const data = await res.json();
    rows = (data.properties || []).filter(p => p.active !== false);
  } catch (e) {
    // Silent — leave the picker hidden. Form still works.
  }
  _propertyPickerCache.rows = rows;
  _propertyPickerCache.byCostTag = {};
  for (const r of rows) {
    const tag = (r.cost_tag || '').trim();
    if (tag) _propertyPickerCache.byCostTag[tag] = r;
  }
  if (!rows.length) {
    // No active properties → hide the row entirely so we don't add
    // visual noise to the form.
    if (row) {
      row.hidden = true;
      row.dataset.hasOptions = '0';
    }
    return;
  }
  const opts2 = [`<option value="">${t('atx.m.property_none', {}, '— none —')}</option>`];
  for (const r of rows) {
    opts2.push(`<option value="${escapeHtml(r.property_id)}">${escapeHtml(r.name || r.property_id)}</option>`);
  }
  sel.innerHTML = opts2.join('');
  if (opts.preselectTag) {
    const match = _propertyPickerCache.byCostTag[opts.preselectTag];
    if (match) sel.value = match.property_id;
  }
  if (row) {
    row.dataset.hasOptions = '1';
    // Respect the current type — setTxType() may have hidden us
    // because a transfer was already selected when the picker
    // finished loading.
    const typeBtn = document.querySelector('#atx-type-btns button.active');
    const currentType = typeBtn ? typeBtn.getAttribute('data-type') : 'expense';
    row.hidden = currentType === 'transfer';
  }
}

async function loadSubscriptionPicker(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  try {
    const res = await fetch('/api/subscriptions/active_for_picker', { method: 'POST' });
    const data = await res.json();
    const rows = data.subscriptions || [];
    _subPickerCache.rows = rows;
    _subPickerCache.byPayee = {};
    for (const r of rows) {
      const key = (r.payee || '').toLowerCase().trim();
      if (key) _subPickerCache.byPayee[key] = r;
    }
    // Build options grouped visually by group prefix. We use plain
    // <option> rather than <optgroup> so the suggestion-pre-select
    // stays simple (optgroups need extra walking to find a child).
    const opts = [`<option value="">${t('atx.m.subscription_none', {}, '— none —')}</option>`];
    for (const r of rows) {
      const label = r.group
        ? `${r.group} · ${r.name}`
        : r.name;
      opts.push(`<option value="${escapeHtml(r.subscription_id)}">${escapeHtml(label)}</option>`);
    }
    sel.innerHTML = opts.join('');
  } catch (e) {
    // Silent — leave the dropdown with its single "none" placeholder.
  }
}

function suggestSubscriptionFromPayee(payeeValue, selectId, hintId) {
  const sel = document.getElementById(selectId);
  const hint = document.getElementById(hintId);
  if (!sel || !_subPickerCache.byPayee) return;
  // Don't override an explicit user choice. The dropdown switches
  // back to suggesting only when the user has cleared it.
  if (sel.value) {
    if (hint) { hint.hidden = true; hint.textContent = ''; }
    return;
  }
  const key = (payeeValue || '').toLowerCase().trim();
  const match = key ? _subPickerCache.byPayee[key] : null;
  if (match) {
    sel.value = match.subscription_id;
    if (hint) {
      hint.hidden = false;
      hint.textContent = t(
        'atx.m.subscription_suggested',
        { name: match.name },
        `Suggested from payee: ${match.name}. Clear to skip.`,
      );
    }
  } else if (hint) {
    hint.hidden = true;
    hint.textContent = '';
  }
}

function applyQuickExpense(qeId) {
  // The dispatcher passes the QE id verbatim. Find the matching chip via
  // dataset comparison rather than a selector with interpolation, so a
  // future QE id with CSS-special chars cannot break the lookup. The
  // full QE snapshot lives in data-qe on the chip.
  const chip = [...document.querySelectorAll('.qe-chip')].find(c => c.dataset.arg1 === qeId);
  if (!chip) return;
  const qe = JSON.parse(chip.getAttribute('data-qe'));

  // Pre-fill the Add-TX form from the chip
  addTxState.preview = null;
  renderAddTxPage().then(() => {
    // Wait for dropdowns to load, then fill
    setTimeout(() => {
      const accSel = document.getElementById('atx-m-account');
      const payeeInput = document.getElementById('atx-m-payee');
      const catSel = document.getElementById('atx-m-category');
      const amountInput = document.getElementById('atx-m-amount');

      // Set type (default: expense)
      const qeType = qe.type || 'expense';
      setTxType(qeType);

      const noteInput = document.getElementById('atx-m-note');
      if (noteInput && qe.note) noteInput.value = qe.note;
      if (accSel && qe.account) accSel.value = qe.account;
      if (payeeInput && qe.payee) payeeInput.value = qe.payee;
      if (catSel && qe.category) {
        filterCategories(qeType);
        catSel.value = qe.category;
      }
      // Focus amount field since that's the only thing to fill
      if (amountInput) amountInput.focus();

      // Apply tags if any
      if (qe.tags) {
        const tagNames = qe.tags.split(';');
        tagNames.forEach(tag => {
          const cb = document.querySelector(`#atx-m-tags input[value="${tag}"]`);
          if (cb) cb.checked = true;
        });
      }
    }, 300);
  });
}

function setTxType(type) {
  document.querySelectorAll('#atx-type-btns button').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-type') === type);
  });
  const payeeRow = document.getElementById('atx-m-payee-row');
  const transferRow = document.getElementById('atx-m-transfer-row');
  if (type === 'transfer') {
    payeeRow.style.display = 'none';
    transferRow.style.display = 'flex';
  } else {
    payeeRow.style.display = 'flex';
    transferRow.style.display = 'none';
  }
  // Property picker is meaningless on transfers (no cost event), hide
  // the row entirely. Only show it again when the picker actually has
  // active properties to offer — loadPropertyPicker() flips the flag.
  const propRow = document.getElementById('atx-m-property-row');
  if (propRow) {
    const hasOptions = propRow.dataset.hasOptions === '1';
    propRow.hidden = type === 'transfer' || !hasOptions;
  }
  // Filter category dropdown by type
  filterCategories(type);
}

function populateTxDropdowns(ctx) {
  if (!ctx) return;
  const accSel = document.getElementById('atx-m-account');
  const catSel = document.getElementById('atx-m-category');
  const trSel = document.getElementById('atx-m-transfer-to');
  if (!accSel) return;

  // Accounts: group by type, only active
  const activeAccounts = ctx.accounts.filter(a => a.status === 'active');
  const groups = {};
  activeAccounts.forEach(a => {
    const g = a.type;
    if (!groups[g]) groups[g] = [];
    groups[g].push(a);
  });

  accSel.innerHTML = `<option value="">${t('atx.dropdown.select_account', {}, 'Select account...')}</option>`;
  for (const [type, accs] of Object.entries(groups).sort()) {
    const og = document.createElement('optgroup');
    og.label = type;
    accs.forEach(a => {
      const o = document.createElement('option');
      o.value = a.alias;
      o.textContent = `${a.alias} — ${a.name}`;
      og.appendChild(o);
    });
    accSel.appendChild(og);
  }

  // Transfer-to dropdown (same accounts)
  if (trSel) {
    trSel.innerHTML = `<option value="">${t('atx.dropdown.select_target', {}, 'Select target...')}</option>`;
    activeAccounts.forEach(a => {
      const o = document.createElement('option');
      o.value = a.alias;
      o.textContent = `${a.alias} — ${a.name}`;
      trSel.appendChild(o);
    });
  }

  // Categories
  if (catSel) {
    catSel.innerHTML = `<option value="">${t('atx.dropdown.select_category', {}, 'Select category...')}</option>`;
    ctx.categories.filter(c => c.active).forEach(c => {
      const o = document.createElement('option');
      o.value = c.path;
      o.textContent = c.path;
      o.setAttribute('data-type', c.type);
      catSel.appendChild(o);
    });
    filterCategories('expense');
  }

  // Tags
  const tagPicker = document.getElementById('atx-m-tags');
  if (tagPicker && ctx.tags) {
    tagPicker.innerHTML = ctx.tags.filter(t => t.active).map(t =>
      `<label><input type="checkbox" value="${t.tag}"><span>${t.tag}</span></label>`
    ).join('');
  }

  // Payee autocomplete
  setupPayeeAutocomplete(ctx);

  // Prefill account if set (from Account Detail → Add TX)
  if (addTxState.prefillAccount) {
    accSel.value = addTxState.prefillAccount;
    addTxState.prefillAccount = null;
  }

  // Prefill full TX fields when duplicating an existing transaction
  if (addTxState.prefillTx) {
    const p = addTxState.prefillTx;
    addTxState.prefillTx = null;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el != null && v != null) el.value = v; };
    // Switch type pill/select first so the right field rows are visible
    setVal('atx-m-type', p.type);
    const typeSel = document.getElementById('atx-m-type');
    if (typeSel) typeSel.dispatchEvent(new Event('change'));
    setVal('atx-m-date', p.date);
    setVal('atx-m-account', p.account);
    setVal('atx-m-amount', p.amount);
    setVal('atx-m-payee', p.payee);
    setVal('atx-m-category', p.category);
    setVal('atx-m-note', p.note);
    setVal('atx-m-transfer-to', p.transfer_to_account);
    setVal('atx-m-transfer-amount', p.transfer_to_amount);
    // Restore tag checkboxes
    const tagBoxes = document.querySelectorAll('#atx-m-tags input[type="checkbox"]');
    tagBoxes.forEach(cb => { cb.checked = p.tags.includes(cb.value); });
  }
}

function filterCategories(txType) {
  const catSel = document.getElementById('atx-m-category');
  if (!catSel) return;
  const catType = txType === 'transfer' ? null : txType;
  Array.from(catSel.options).forEach(o => {
    if (!o.value) return; // keep placeholder
    const oType = o.getAttribute('data-type');
    o.style.display = (!catType || oType === catType) ? '' : 'none';
  });
}

function setupPayeeAutocomplete(ctx) {
  const input = document.getElementById('atx-m-payee');
  const list = document.getElementById('atx-payee-ac');
  if (!input || !list || !ctx.payees) return;

  const payees = ctx.payees;
  let selIdx = -1;

  function filter(q) {
    if (!q) { list.classList.remove('open'); return; }
    const lq = q.toLowerCase();
    const matches = payees.filter(p =>
      p.payee.toLowerCase().includes(lq) ||
      (p.aliases || []).some(a => a.toLowerCase().includes(lq))
    ).slice(0, 10);
    if (!matches.length) { list.classList.remove('open'); return; }
    selIdx = -1;
    list.innerHTML = matches.map((p, i) =>
      `<div class="ac-item" data-idx="${i}" data-payee="${escapeHtml(p.payee)}" data-cat="${escapeHtml(p.default_category)}" data-acc="${escapeHtml(p.default_account)}">
        <span>${escapeHtml(p.payee)}</span>
        <span class="ac-meta">${escapeHtml(p.default_category || '')}</span>
      </div>`
    ).join('');
    list.classList.add('open');
  }

  function pick(item) {
    input.value = item.dataset.payee;
    list.classList.remove('open');
    // Auto-fill category
    const cat = item.dataset.cat;
    if (cat) {
      const catSel = document.getElementById('atx-m-category');
      if (catSel) { catSel.value = cat; }
    }
    // Auto-fill account
    const acc = item.dataset.acc;
    if (acc) {
      const accSel = document.getElementById('atx-m-account');
      if (accSel) { accSel.value = acc; }
    }
  }

  input.addEventListener('input', () => filter(input.value));
  input.addEventListener('focus', () => { if (input.value) filter(input.value); });

  input.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('.ac-item');
    if (!items.length || !list.classList.contains('open')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(selIdx + 1, items.length - 1); items.forEach((it, i) => it.classList.toggle('selected', i === selIdx)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); items.forEach((it, i) => it.classList.toggle('selected', i === selIdx)); }
    else if (e.key === 'Enter' && selIdx >= 0) { e.preventDefault(); pick(items[selIdx]); }
    else if (e.key === 'Escape') { list.classList.remove('open'); }
  });

  list.addEventListener('click', (e) => {
    const item = e.target.closest('.ac-item');
    if (item) pick(item);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.ac-wrapper')) list.classList.remove('open');
  });
}

function showTxStatus(type, msg) {
  const area = document.getElementById('atx-status-area');
  if (area) area.innerHTML = `<div class="atx-status ${type}">${msg}</div>`;
}

function showTxLoading(msg) {
  const area = document.getElementById('atx-status-area');
  if (area) area.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${msg}</div>`;
}

// ─── Split Lines ──────────────────────────────────────────────────────────
let splitLines = [];

function addSplitLine() {
  // On first split, move main amount+category into split 0.
  // Main note remains as fallback when a split-line note is empty.
  if (splitLines.length === 0) {
    const mainAmt = document.getElementById('atx-m-amount')?.value || '';
    const mainCat = document.getElementById('atx-m-category')?.value || '';
    splitLines.push({ amount: mainAmt, category: mainCat, note: '' });
    // Clear main amount (total will be calculated)
    document.getElementById('atx-m-amount').value = '';
    document.getElementById('atx-m-amount').setAttribute('readonly', 'true');
    document.getElementById('atx-m-amount').style.opacity = '0.5';
    document.getElementById('atx-m-amount').placeholder = t('atx.split.auto_sum', {}, 'Auto (sum of splits)');
    // Hide main category
    document.getElementById('atx-m-category').style.display = 'none';
  }
  splitLines.push({ amount: '', category: '', note: '' });
  renderSplitLines();
}

function removeSplitLine(idx) {
  splitLines.splice(idx, 1);
  if (splitLines.length <= 1) {
    // Revert to single mode
    const remaining = splitLines[0] || {};
    splitLines = [];
    document.getElementById('atx-m-amount').value = remaining.amount || '';
    document.getElementById('atx-m-amount').removeAttribute('readonly');
    document.getElementById('atx-m-amount').style.opacity = '';
    document.getElementById('atx-m-amount').placeholder = t('atx.m.placeholder_amount', {}, '45000');
    document.getElementById('atx-m-category').style.display = '';
    document.getElementById('atx-m-category').value = remaining.category || '';
    // Restore per-line note into main note field if present
    if (remaining.note) {
      const noteEl = document.getElementById('atx-m-note');
      if (noteEl) noteEl.value = remaining.note;
    }
    document.getElementById('atx-splits-area').innerHTML = '';
    updateSplitInfo();
    return;
  }
  renderSplitLines();
}

function renderSplitLines() {
  const area = document.getElementById('atx-splits-area');
  const catSel = document.getElementById('atx-m-category');
  // Clone category options
  const catOptionsHtml = catSel ? catSel.innerHTML : '';

  let html = '<div class="split-block">';
  html += `<div class="split-block-heading">${t('atx.split.heading', {}, 'Split Lines')}</div>`;
  const amountLabel = t('common.col.amount', {}, 'Amount');
  const removeTitle = t('atx.split.remove_title', {}, 'Remove');
  const noteLabel = t('atx.split.placeholder_note', {}, 'Note (optional)');
  splitLines.forEach((s, i) => {
    html += `<div class="split-row">
      <div class="atx-field fx1"><input type="text" placeholder="${amountLabel}" value="${escapeHtml(s.amount)}" onchange="splitLines[${i}].amount=this.value;updateSplitInfo()"></div>
      <div class="atx-field fx2"><select onchange="splitLines[${i}].category=this.value">${catOptionsHtml}</select></div>
      <div class="atx-field fx2"><input type="text" placeholder="${noteLabel}" value="${escapeHtml(s.note || '')}" onchange="splitLines[${i}].note=this.value"></div>
      <button class="split-x-btn" data-action="removeSplitLine" data-arg1="${i}" title="${removeTitle}" aria-label="${removeTitle}">&times;</button>
    </div>`;
  });
  html += `<button class="split-add-line-btn" data-action="addSplitLine">${t('atx.split.btn_add_line', {}, '+ Add line')}</button>`;
  html += '</div>';
  area.innerHTML = html;

  // Set selected categories
  const selects = area.querySelectorAll('select');
  splitLines.forEach((s, i) => {
    if (selects[i] && s.category) selects[i].value = s.category;
  });

  updateSplitInfo();
}

function updateSplitInfo() {
  const info = document.getElementById('atx-split-info');
  if (!info) return;
  if (splitLines.length < 2) {
    info.hidden = true;
    info.textContent = '';
    info.classList.remove('match', 'mismatch');
    return;
  }
  const total = splitLines.reduce((s, l) => s + (parseAmountInput(l.amount) || 0), 0);
  const totalStr = formatCurrency(total, 'TZS');
  const amtField = document.getElementById('atx-m-amount');
  const isReadonly = amtField && amtField.hasAttribute('readonly');
  if (isReadonly) {
    amtField.value = total || '';
  }
  // When the main-amount field is editable (read-only flag was lifted, e.g. user typed a target),
  // show diff vs. the typed target so user sees if splits balance.
  const target = !isReadonly ? parseAmountInput(amtField?.value || '') : 0;
  const lineLabel = splitLines.length === 1
    ? t('atx.split.lines_one', {}, '1 line')
    : t('atx.split.lines_many', { n: splitLines.length }, `${splitLines.length} lines`);
  info.hidden = false;
  if (target > 0) {
    const diff = total - target;
    const matched = Math.abs(diff) < 0.005;
    info.classList.toggle('match', matched);
    info.classList.toggle('mismatch', !matched);
    if (matched) {
      info.textContent = `Σ ${totalStr} · ${lineLabel} ✓`;
    } else {
      const sign = diff > 0 ? '+' : '−';
      info.textContent = `Σ ${totalStr} / ${formatCurrency(target, 'TZS')} · Δ ${sign}${formatCurrency(Math.abs(diff), 'TZS')}`;
    }
  } else {
    info.classList.remove('mismatch');
    info.classList.add('match');
    info.textContent = `Σ ${totalStr} · ${lineLabel}`;
  }
}

async function submitManual() {
  const type = document.querySelector('#atx-type-btns button.active')?.getAttribute('data-type') || 'expense';

  // v1.6.0 — upload any pending receipt attachments BEFORE building the
  // preview. If the upload fails, abort here so the user fixes the
  // attachment issue without losing form data. URLs come back as relative
  // paths starting with /data/receipts/...; they're stored verbatim in
  // transactions.csv:receipt_url as a semicolon-separated list.
  let receiptUrlStr = '';
  if (_atxReceiptFiles.length) {
    showTxLoading(t('receipts.upload.uploading', {}, 'Uploading attachments...'));
    try {
      const saved = await uploadReceipts(_atxReceiptFiles);
      receiptUrlStr = serializeReceiptList(saved.map(s => s.url));
    } catch (err) {
      showTxStatus('error', t('receipts.upload.error_generic', { msg: err.message }, `Attachment upload failed: ${err.message}`));
      return;
    }
  }

  const formData = {
    date: document.getElementById('atx-m-date')?.value,
    account: document.getElementById('atx-m-account')?.value,
    type: type,
    amount: parseAmountInputStr(document.getElementById('atx-m-amount')?.value),
    payee: type !== 'transfer' ? (document.getElementById('atx-m-payee')?.value || '') : '',
    category: type !== 'transfer' ? (document.getElementById('atx-m-category')?.value || '') : '',
    note: document.getElementById('atx-m-note')?.value || '',
    tags: Array.from(document.querySelectorAll('#atx-m-tags input:checked')).map(c => c.value).join(';'),
    transfer_to_account: type === 'transfer' ? (document.getElementById('atx-m-transfer-to')?.value || '') : '',
    transfer_to_amount: type === 'transfer' ? parseAmountInputStr(document.getElementById('atx-m-transfer-amount')?.value) : '',
    subscription_id: type !== 'transfer' ? (document.getElementById('atx-m-subscription')?.value || '') : '',
    property_id: type !== 'transfer' ? (document.getElementById('atx-m-property')?.value || '') : '',
    receipt_url: receiptUrlStr,
  };

  // Attach splits if active
  if (splitLines.length >= 2) {
    formData.splits = splitLines.map(s => ({
      amount: parseAmountInputStr(s.amount),
      category: s.category,
      note: s.note || '',
    }));
    formData.amount = splitLines.reduce((sum, s) => sum + (parseAmountInput(s.amount) || 0), 0).toString();
  }

  if (!formData.account) { showTxStatus('error', t('txflow.manual.err_no_account', {}, 'Please select an account')); return; }
  if (!formData.amount || formData.amount === '0') { showTxStatus('error', t('txflow.manual.err_no_amount', {}, 'Please enter an amount')); return; }

  showTxLoading(t('txflow.manual.building_preview', {}, 'Building preview...'));
  document.getElementById('atx-preview-area').innerHTML = '';

  try {
    const res = await fetch('/api/tx/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    const data = await res.json();

    if (data.error) {
      showTxStatus('error', escapeHtml(data.error));
      // Still show lines if available (for validation errors)
      if (data.lines) {
        addTxState.preview = data;
        renderTxPreview(data);
      }
      return;
    }

    addTxState.preview = data;
    renderTxPreview(data);
    document.getElementById('atx-status-area').innerHTML = '';
  } catch (e) {
    showTxStatus('error', t('txflow.request_failed', { msg: escapeHtml(e.message) }, `Request failed: ${escapeHtml(e.message)}`));
  }
}

function renderTxPreview(data) {
  const area = document.getElementById('atx-preview-area');
  if (!area || !data.lines || !data.lines.length) return;

  const fmt = (amount, currency) => formatCurrency(parseFloat(amount), currency) + ' ' + currency;

  let html = `<div class="atx-preview"><h3>${t('txflow.preview.heading', {}, 'Preview')}</h3>`;
  const autoBadge = t('txflow.preview.auto_badge', {}, 'auto');

  data.lines.forEach((line, i) => {
    const isAuto = line.is_auto_generated;
    const typeClass = line.type || 'expense';
    const prefix = line.type === 'expense' ? '-' : line.type === 'income' ? '+' : '';

    html += `
      <div class="atx-preview-line ${isAuto ? 'auto' : ''}">
        <div class="atx-line-num">#${i + 1}</div>
        <div class="atx-line-detail">
          <div class="atx-line-primary">
            ${fmtDate(line.date)} &middot; <strong>${escapeHtml(line.account)}</strong> &middot; ${escapeHtml(line.type)}
            ${isAuto ? `<span class="atx-auto-badge">${autoBadge}</span>` : ''}
          </div>
          <div class="atx-line-secondary">
            ${line.payee ? escapeHtml(line.payee) + ' &rarr; ' : ''}${escapeHtml(line.category || '')}
            ${line.transfer_to_account ? '&rarr; ' + escapeHtml(line.transfer_to_account) : ''}
          </div>
          ${line.note ? `<div class="atx-line-secondary">${escapeHtml(line.note)}</div>` : ''}
          ${line.tags ? `<div class="atx-line-tags">${escapeHtml(line.tags)}</div>` : ''}
          ${line.subscription_id ? `<div class="atx-line-secondary" style="color:var(--accent-dim);font-size:11px;">${t('atx.preview.linked_subscription', { id: line.subscription_id }, `→ linked to subscription: ${line.subscription_id}`)}</div>` : ''}
        </div>
        <div class="atx-line-amount ${typeClass}">${prefix}${fmt(line.amount, line.currency)}</div>
      </div>
    `;
  });

  // Ambiguities
  if (data.ambiguities && data.ambiguities.length) {
    html += `<div class="atx-ambiguities"><strong>${t('txflow.preview.ambiguities_heading', {}, 'Ambiguities:')}</strong><ul>`;
    data.ambiguities.forEach(a => { html += `<li>${escapeHtml(a)}</li>`; });
    html += '</ul></div>';
  }

  // Confidence badge
  if (data.confidence && data.confidence !== 'high') {
    html += `<div class="atx-ambiguities" style="margin-top:8px">${t('txflow.preview.confidence_html', { level: escapeHtml(data.confidence) }, `Confidence: <strong>${escapeHtml(data.confidence)}</strong>`)}</div>`;
  }

  html += `
    <div class="atx-confirm-actions">
      <button class="btn-confirm" data-action="confirmTx">${t('txflow.preview.confirm_book', {}, 'Confirm &amp; Book')}</button>
      <button data-action="cancelTxPreview">${t('common.actions.cancel', {}, 'Cancel')}</button>
    </div>
  </div>`;

  area.innerHTML = html;
}

function cancelTxPreview() {
  addTxState.preview = null;
  document.getElementById('atx-preview-area').innerHTML = '';
  document.getElementById('atx-status-area').innerHTML = '';
}

// Check for potential duplicate transactions
function findDuplicateTx(lines) {
  const dupes = [];
  for (const line of lines) {
    if (line.type === 'transfer') continue; // transfers rarely duplicate
    const matches = state.tx.filter(t => {
      if (t.type !== line.type) return false;
      if ((t.payee || '').toLowerCase() !== (line.payee || '').toLowerCase()) return false;
      if (Math.abs(t.amount - (parseAmountInput(line.amount) || 0)) > 0.01) return false;
      // Date within ±1 day
      if (!t.date || !line.date) return false;
      const d1 = new Date(t.date), d2 = new Date(line.date);
      return Math.abs(d1 - d2) <= 86400000; // 1 day in ms
    });
    if (matches.length > 0) {
      dupes.push({ line, existing: matches[0] });
    }
  }
  return dupes;
}

async function confirmTx() {
  if (!addTxState.preview || !addTxState.preview.lines) return;

  // Duplicate check
  const dupes = findDuplicateTx(addTxState.preview.lines);
  if (dupes.length > 0) {
    const details = dupes.map(d => {
      const amountStr = formatCurrency(parseFloat(d.line.amount), d.line.currency);
      // Plain-text (confirm dialog), so decode the &bull; HTML entity to •
      return t('txflow.confirm.dup_line',
        { payee: d.line.payee, amount: amountStr, currency: d.line.currency, date: d.existing.date },
        `• ${d.line.payee} ${amountStr} ${d.line.currency} — existing on ${d.existing.date}`
      ).replace(/&bull;/g, '•');
    }).join('\n');
    const title = t('txflow.confirm.dup_title', {}, 'Possible duplicate(s) found:');
    const ask = t('txflow.confirm.dup_ask', {}, 'Book anyway?');
    if (!(await uiConfirm(`${title}\n\n${details}\n\n${ask}`))) return;
  }

  showTxLoading(t('txflow.confirm.booking', {}, 'Booking...'));

  try {
    const res = await fetch('/api/tx/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lines: addTxState.preview.lines,
        raw_input: addTxState.preview.raw_input || '(manual)',
      }),
    });
    const data = await res.json();

    if (data.error) {
      showTxStatus('error', escapeHtml(data.error));
      return;
    }

    const ids = data.import_ids.join(', ');
    let msg = t('txflow.confirm.booked', { message: escapeHtml(data.message), ids: escapeHtml(ids) }, `Booked ${data.message}. Import IDs: ${ids}`);
    if (!data.git_committed) msg += t('txflow.confirm.git_failed', {}, ' (git commit failed)');
    showTxStatus('success', msg);

    addTxState.preview = null;
    document.getElementById('atx-preview-area').innerHTML = '';

    // Clear inputs
    const amountInput = document.getElementById('atx-m-amount');
    if (amountInput) amountInput.value = '';
    const payeeInput = document.getElementById('atx-m-payee');
    if (payeeInput) payeeInput.value = '';
    const noteInput = document.getElementById('atx-m-note');
    if (noteInput) noteInput.value = '';
    document.querySelectorAll('#atx-m-tags input:checked').forEach(c => c.checked = false);

    // v1.6.0 — drop any pending attachments. The successful confirm
    // already wrote their URLs to transactions.csv, so the local File
    // refs are no longer needed.
    _atxReceiptFiles = [];
    _renderAtxReceiptGrid();

    // Reset splits
    splitLines = [];
    const splitsArea = document.getElementById('atx-splits-area');
    if (splitsArea) splitsArea.innerHTML = '';
    if (amountInput) { amountInput.removeAttribute('readonly'); amountInput.style.opacity = ''; amountInput.placeholder = t('atx.m.placeholder_amount', {}, '45000'); }
    const mainCat = document.getElementById('atx-m-category');
    if (mainCat) mainCat.style.display = '';
    updateSplitInfo();

    // Reload data so dashboard is fresh; if we have a return route (user
    // came from an Account detail page), navigate back there after boot()
    // has refreshed state so the destination renders with the new TX.
    setTimeout(async () => {
      await boot();
      if (addTxState.returnRoute) {
        const route = addTxState.returnRoute;
        addTxState.returnRoute = null;
        addTxState.prefillAccount = null;
        history.pushState(null, '', route);
        navigateTo(route.replace(/^#/, ''));
      }
    }, 500);
  } catch (e) {
    showTxStatus('error', t('txflow.confirm.err_booking', { msg: escapeHtml(e.message) }, `Booking failed: ${escapeHtml(e.message)}`));
  }
}


// ─── Boot (must be last — all modules loaded) ────────────────────────────
boot();

