// ─── Add TX Page ──────────────────────────────────────────────────────────
//
// Extracted from forms.js (Code-Review HIGH 1, forms.js God-Module split,
// step 3/3). Companion file: forms-edit-tx.js. Hosts the Add TX page,
// free-text + manual modes, split lines, preview & confirm, plus the
// shared loadTxContext() helper. Boot trigger (boot() call) lives at
// the bottom — this is the last defer script in the dashboard chain.


// returnRoute: optional hash (e.g. '#account:crdb') to navigate back to after
// a successful booking. Set by navigateToAddTxWithAccount(), cleared by
// returnFromAddTx() and by any "fresh" entry to the Add-TX page (FAB, sidebar
// nav, keyboard "n").
let addTxState = { mode: 'freetext', preview: null, context: null, loading: false, prefillAccount: null, prefillTx: null, returnRoute: null };

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
  addTxState.mode = 'manual';
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
  addTxState.mode = 'manual';
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
            ${activeQe.map(q => `<button class="qe-chip" data-action="applyQuickExpense" data-arg1="${escapeHtml(q.id)}" data-qe='${JSON.stringify(q).replace(/'/g, "&#39;")}'><span class="qe-icon"><svg><use href="#i-zap"/></svg></span>${escapeHtml(q.name)}</button>`).join('')}
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
      <div class="atx-tabs">
        <button class="${addTxState.mode === 'freetext' ? 'active' : ''}" data-action="switchTxMode" data-arg1="freetext">${t('atx.tab_freetext', {}, 'Free-text')}</button>
        <button class="${addTxState.mode === 'manual' ? 'active' : ''}" data-action="switchTxMode" data-arg1="manual">${t('atx.tab_manual', {}, 'Manual')}</button>
      </div>

      <!-- Free-text mode -->
      <div id="atx-freetext" style="display:${addTxState.mode === 'freetext' ? 'block' : 'none'}">
        <div class="atx-row">
          <div class="atx-field" style="flex:4">
            <label>${t('atx.free.label_transaction', {}, 'Transaction')}</label>
            <input type="text" id="atx-raw-input" class="atx-freetext-input"
              placeholder="${t('atx.free.placeholder', {}, '45k Jumbo cash')}" autocomplete="off"
              onkeydown="if(event.key==='Enter')submitFreeText()">
          </div>
          <div class="atx-field fx1">
            <label>${t('common.label.date', {}, 'Date')}</label>
            <input type="date" id="atx-freetext-date" value="${today}">
          </div>
        </div>
        <div class="atx-hint">${t('atx.free.examples_html', {}, 'Examples: <code>45k Jumbo cash</code> &middot; <code>transfer 500k crdb zu sav</code> &middot; <code>250k Tanesco kft</code>')}</div>
        <div class="atx-actions">
          <button data-action="submitFreeText">${t('atx.free.btn_parse', {}, 'Parse &rarr;')}</button>
        </div>
      </div>

      <!-- Manual mode -->
      <div id="atx-manual" style="display:${addTxState.mode === 'manual' ? 'block' : 'none'}">
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
              <input type="text" id="atx-m-payee" placeholder="${t('atx.m.placeholder_payee', {}, 'Jumbo')}" autocomplete="off">
              <div class="ac-list" id="atx-payee-ac"></div>
            </div>
          </div>
          <div class="atx-field fx1">
            <label>${t('common.col.category', {}, 'Category')}</label>
            <select id="atx-m-category"><option value="">${t('common.loading', {}, 'Loading...')}</option></select>
          </div>
        </div>
        <div id="atx-splits-area"></div>
        <div class="atx-row" id="atx-m-payee-row-split-btn" style="margin-top:-8px;margin-bottom:8px;">
          <button data-action="addSplitLine" style="font-size:11px;padding:5px 12px;">${t('atx.m.btn_add_split', {}, '+ Split')}</button>
          <span id="atx-split-info" style="font-size:11px;color:var(--muted);margin-left:8px;"></span>
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
}

function switchTxMode(mode) {
  addTxState.mode = mode;
  addTxState.preview = null;
  renderAddTxPage();
}

function applyQuickExpense(qeId) {
  // The dispatcher passes the QE id verbatim. Find the matching chip via
  // dataset comparison rather than a selector with interpolation, so a
  // future QE id with CSS-special chars cannot break the lookup. The
  // full QE snapshot lives in data-qe on the chip.
  const chip = [...document.querySelectorAll('.qe-chip')].find(c => c.dataset.arg1 === qeId);
  if (!chip) return;
  const qe = JSON.parse(chip.getAttribute('data-qe'));

  // Switch to manual mode and pre-fill
  addTxState.mode = 'manual';
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

async function submitFreeText() {
  const input = document.getElementById('atx-raw-input');
  const dateInput = document.getElementById('atx-freetext-date');
  if (!input || !input.value.trim()) return;

  showTxLoading(t('txflow.free.parsing', {}, 'Parsing with Claude API...'));
  document.getElementById('atx-preview-area').innerHTML = '';

  try {
    const res = await fetch('/api/tx/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_input: input.value.trim(), date: dateInput.value }),
    });
    const data = await res.json();

    if (data.error) {
      if (data.code === 'NO_API_KEY') {
        const switchLink = `<a href="#" data-action="switchTxMode" data-arg1="manual">${t('txflow.free.switch_manual', {}, 'Switch to manual mode')}</a>`;
        showTxStatus('warning', escapeHtml(data.error) + ' ' + switchLink);
      } else {
        showTxStatus('error', escapeHtml(data.error));
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

// ─── Split Lines ──────────────────────────────────────────────────────────
let splitLines = [];

function addSplitLine() {
  // On first split, move main amount+category into split 0
  if (splitLines.length === 0) {
    const mainAmt = document.getElementById('atx-m-amount')?.value || '';
    const mainCat = document.getElementById('atx-m-category')?.value || '';
    splitLines.push({ amount: mainAmt, category: mainCat });
    // Clear main amount (total will be calculated)
    document.getElementById('atx-m-amount').value = '';
    document.getElementById('atx-m-amount').setAttribute('readonly', 'true');
    document.getElementById('atx-m-amount').style.opacity = '0.5';
    document.getElementById('atx-m-amount').placeholder = t('atx.split.auto_sum', {}, 'Auto (sum of splits)');
    // Hide main category
    document.getElementById('atx-m-category').style.display = 'none';
  }
  splitLines.push({ amount: '', category: '' });
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

  let html = '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin:8px 0;">';
  html += `<div style="font-size:11px;font-weight:500;margin-bottom:8px;">${t('atx.split.heading', {}, 'Split Lines')}</div>`;
  const amountLabel = t('common.col.amount', {}, 'Amount');
  const removeTitle = t('atx.split.remove_title', {}, 'Remove');
  splitLines.forEach((s, i) => {
    html += `<div class="atx-row" style="margin-bottom:6px;align-items:center;">
      <div class="atx-field fx1"><input type="text" placeholder="${amountLabel}" value="${escapeHtml(s.amount)}" onchange="splitLines[${i}].amount=this.value;updateSplitInfo()"></div>
      <div class="atx-field fx2"><select onchange="splitLines[${i}].category=this.value">${catOptionsHtml}</select></div>
      <button data-action="removeSplitLine" data-arg1="${i}" style="padding:4px 8px;font-size:11px;color:var(--negative);background:none;border:none;cursor:pointer;" title="${removeTitle}">&times;</button>
    </div>`;
  });
  html += `<button data-action="addSplitLine" style="font-size:11px;padding:4px 10px;margin-top:4px;">${t('atx.split.btn_add_line', {}, '+ Add line')}</button>`;
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
  if (splitLines.length < 2) { info.textContent = ''; return; }
  const total = splitLines.reduce((s, l) => s + (parseAmountInput(l.amount) || 0), 0);
  const totalStr = formatCurrency(total, 'TZS');
  info.textContent = splitLines.length === 1
    ? t('atx.split.info_one', { amount: totalStr }, `1 line, total: ${totalStr}`)
    : t('atx.split.info_many', { n: splitLines.length, amount: totalStr }, `${splitLines.length} lines, total: ${totalStr}`);
  // Update the read-only amount field
  const amtField = document.getElementById('atx-m-amount');
  if (amtField && amtField.hasAttribute('readonly')) {
    amtField.value = total || '';
  }
}

async function submitManual() {
  const type = document.querySelector('#atx-type-btns button.active')?.getAttribute('data-type') || 'expense';
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
  };

  // Attach splits if active
  if (splitLines.length >= 2) {
    formData.splits = splitLines.map(s => ({ amount: s.amount, category: s.category }));
    formData.splits = formData.splits.map(s => ({ amount: parseAmountInputStr(s.amount), category: s.category }));
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
    const rawInput = document.getElementById('atx-raw-input');
    if (rawInput) rawInput.value = '';
    const amountInput = document.getElementById('atx-m-amount');
    if (amountInput) amountInput.value = '';
    const payeeInput = document.getElementById('atx-m-payee');
    if (payeeInput) payeeInput.value = '';
    const noteInput = document.getElementById('atx-m-note');
    if (noteInput) noteInput.value = '';
    document.querySelectorAll('#atx-m-tags input:checked').forEach(c => c.checked = false);

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

