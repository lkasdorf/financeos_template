// ── Debt Modals ──────────────────────────────────────────────────────────

async function showDebtModal(editId) {
  let item = null;
  if (editId) {
    item = (state.thirdParty || []).find(d => d.id === editId);
  }
  const isEdit = !!item;

  // Load accounts for the TX-origination dropdown (new debts only)
  let accOptions = '';
  if (!isEdit) {
    try {
      const ctx = await loadTxContext();
      const active = ctx.accounts.filter(a => a.status === 'active');
      accOptions = active.map(a =>
        `<option value="${a.alias}">${a.alias} — ${a.name} [${a.currency}]</option>`
      ).join('');
    } catch (e) { accOptions = ''; }
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? t('pages.debt.modal.title_edit', {}, 'Edit') : t('pages.debt.modal.title_add', {}, 'Add')} <span class="accent">${t('pages.debt.modal.title_noun', {}, 'Debt')}</span></h3>
      <div class="atx-row">
        <div class="atx-field fx2"><label>${t('reports.debtOverview.col.person', {}, 'Person')}</label>
          <input type="text" id="dm-person" value="${escapeHtml(item?.person_name || '')}" placeholder="${escapeHtml(t('pages.debt.modal.person_placeholder', {}, 'John Doe'))}">
        </div>
        <div class="atx-field fx1"><label>${t('reports.debtOverview.col.direction', {}, 'Direction')}</label>
          <select id="dm-type">
            <option value="owed_by_me" ${!item || item.type === 'owed_by_me' ? 'selected' : ''}>${t('pages.debt.direction.owed_by_me', {}, 'I owe them')}</option>
            <option value="owed_to_me" ${item?.type === 'owed_to_me' ? 'selected' : ''}>${t('pages.debt.direction.owed_to_me', {}, 'They owe me')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>Amount</label>
          <input type="text" id="dm-amount" value="${item ? item.original_amount : ''}" placeholder="1200" ${isEdit ? 'disabled' : ''}>
        </div>
        <div class="atx-field fx05"><label>Currency</label>
          <select id="dm-currency">
            <option value="TZS" ${item?.currency === 'TZS' ? 'selected' : ''}>TZS</option>
            <option value="EUR" ${item?.currency === 'EUR' ? 'selected' : ''}>EUR</option>
            <option value="USD" ${item?.currency === 'USD' ? 'selected' : ''}>USD</option>
            <option value="PLN" ${item?.currency === 'PLN' ? 'selected' : ''}>PLN</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('common.label.note', {}, 'Note')}</label>
          <input type="text" id="dm-note" value="${escapeHtml(item?.note || '')}" placeholder="${escapeHtml(t('pages.debt.note_placeholder', {}, 'Reason for the debt'))}">
        </div>
      </div>
      ${isEdit ? '' : `
      <div class="atx-row">
        <div class="atx-field fx1"><label>Account (origination TX)</label>
          <select id="dm-account">${accOptions}</select>
        </div>
      </div>
      <div class="atx-row">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);">
          <input type="checkbox" id="dm-skip-tx"> Don't create transaction (backfill / historical entry)
        </label>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:8px;">
        ${t('pages.debt.autotx_hint', {}, 'A matching <strong>expense</strong> (you lend) or <strong>income</strong> (you borrow) TX will be created automatically unless you opt out.')}
      </div>`}
      <div id="dm-status"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button data-action="closeModal">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" data-action="saveDebt" data-arg1="${isEdit ? escapeHtml(editId) : ''}">${isEdit ? t('pages.debt.btn.save_edit', {}, 'Save') : t('pages.debt.btn.save_new', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

// Sentinel-input wrapper used by the topup-or-new dialog. Sets a hidden
// flag in #dm-status that saveDebt() reads to skip the "open debt found"
// prompt the second time around, then re-enters saveDebt with editId=null.
function confirmCreateNewDebt() {
  const status = document.getElementById('dm-status');
  if (status) {
    status.innerHTML = '<input type="hidden" id="dm-topup-confirmed">';
  }
  saveDebt(null);
}

async function saveDebt(editId) {
  const accEl = document.getElementById('dm-account');
  const skipEl = document.getElementById('dm-skip-tx');
  const data = {
    person_name: document.getElementById('dm-person').value.trim(),
    type: document.getElementById('dm-type').value,
    amount: document.getElementById('dm-amount').value.trim(),
    currency: document.getElementById('dm-currency').value,
    note: document.getElementById('dm-note').value.trim(),
    account: accEl ? accEl.value : '',
    skip_tx: skipEl ? skipEl.checked : false,
  };
  if (!data.person_name || !data.amount) {
    document.getElementById('dm-status').innerHTML = `<div class="atx-status error">${t('pages.debt.err.person_amount_required', {}, 'Person and amount required')}</div>`;
    return;
  }
  const statusEl = document.getElementById('dm-status');

  // Check for existing open debt for same person (only when adding new)
  if (!editId) {
    const existing = (state.thirdParty || []).find(d =>
      d.person_name.toLowerCase() === data.person_name.toLowerCase() &&
      d.type === data.type &&
      d.currency === data.currency &&
      String(d.settled) !== 'true'
    );
    if (existing && !document.getElementById('dm-topup-confirmed')) {
      statusEl.innerHTML = `
        <div class="atx-status warning" style="display:flex;flex-direction:column;gap:8px;">
          <span>${escapeHtml(existing.person_name)} has an open debt (${formatCurrency(existing.amount, existing.currency)} ${existing.currency}). Top up or create new?</span>
          <div style="display:flex;gap:8px;">
            <button class="btn-save" data-action="topUpExistingDebt" data-arg1="${existing.id}" data-arg2="${parseFloat(data.amount)}" data-arg3="${escapeHtml(data.note)}">Top up +${formatCurrency(parseFloat(data.amount), data.currency)}</button>
            <button data-action="confirmCreateNewDebt">${t('pages.debt.btn.create_new', {}, 'Create new')}</button>
          </div>
        </div>`;
      return;
    }
  }

  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.spinner.saving', {}, 'Saving...')}</div>`;
  try {
    const endpoint = editId ? '/api/debts/update' : '/api/debts/add';
    const body = editId ? { id: editId, updated: { person_name: data.person_name, type: data.type, note: data.note } } : data;
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderDebtsPage();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

async function topUpExistingDebt(debtId, amount, note) {
  const statusEl = document.getElementById('dm-status');
  const accEl = document.getElementById('dm-account');
  const skipEl = document.getElementById('dm-skip-tx');
  const account = accEl ? accEl.value : '';
  const skip_tx = skipEl ? skipEl.checked : false;
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('pages.debt.spinner.toppingup', {}, 'Topping up...')}</div>`;
  try {
    const res = await fetch('/api/debts/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: debtId, amount, note, account, skip_tx }),
    });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderDebtsPage();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

async function deleteDebt(debtId) {
  if (!(await uiConfirm(t('pages.debt.confirm.delete', { id: debtId }, `Delete debt "${debtId}"?`), { type: 'destructive' }))) return;
  try {
    await fetch('/api/debts/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: debtId }) });
    renderDebtsPage();
  } catch (e) {}
}

async function showPayDebtModal(debtId) {
  const debt = (state.thirdParty || []).find(d => d.id === debtId);
  if (!debt) return;

  // Load accounts for dropdown
  const ctx = await loadTxContext();
  const activeAccounts = ctx.accounts.filter(a => a.status === 'active');
  const accOptions = activeAccounts.map(a =>
    `<option value="${a.alias}">${a.alias} — ${a.name} [${a.currency}]</option>`
  ).join('');

  const dirLabel = debt.type === 'owed_by_me' ? 'Pay from account' : 'Receive into account';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>Pay <span class="accent">${escapeHtml(debt.person_name)}</span></h3>
      <div style="margin-bottom:16px;font-size:12px;color:var(--muted);">
        Open: <strong class="c-text">${formatCurrency(debt.amount, debt.currency)} ${debt.currency}</strong>
        of ${formatCurrency(debt.original_amount, debt.currency)} ${debt.currency}
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${dirLabel}</label>
          <select id="pay-account">${accOptions}</select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>Payment Amount</label>
          <input type="text" id="pay-amount" placeholder="${debt.amount}" autofocus>
        </div>
        <div class="atx-field fx05"><label>Currency</label>
          <select id="pay-currency" onchange="updatePayConversion('${debtId}')">
            <option value="${debt.currency}" selected>${debt.currency}</option>
            ${debt.currency !== 'TZS' ? '<option value="TZS">TZS</option>' : ''}
            ${debt.currency !== 'EUR' ? '<option value="EUR">EUR</option>' : ''}
            ${debt.currency !== 'USD' ? '<option value="USD">USD</option>' : ''}
            ${debt.currency !== 'PLN' ? '<option value="PLN">PLN</option>' : ''}
          </select>
        </div>
      </div>
      <div id="pay-conversion" style="font-size:11px;color:var(--muted);margin-bottom:12px;"></div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>Note (optional)</label>
          <input type="text" id="pay-note" placeholder="e.g. cash, transfer, partial">
        </div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:12px;">${t('pages.debt.autotx_hint_short', { type: debt.type === 'owed_by_me' ? t('pages.debt.type_word.expense', {}, 'expense') : t('pages.debt.type_word.income', {}, 'income') }, `A ${debt.type === 'owed_by_me' ? 'expense' : 'income'} transaction will be created automatically.`)}</div>
      <div id="pay-status"></div>
      <div class="modal-footer">
        <div class="btn-left">
          <button data-action="payDebtFull" data-arg1="${debtId}" class="hint-sm">Pay full amount</button>
        </div>
        <div class="btn-right">
          <button data-action="closeModal">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" data-action="submitPayment" data-arg1="${debtId}">Record Payment</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

function updatePayConversion(debtId) {
  const debt = (state.thirdParty || []).find(d => d.id === debtId);
  if (!debt) return;
  const payCur = document.getElementById('pay-currency').value;
  const el = document.getElementById('pay-conversion');
  if (payCur === debt.currency) {
    el.innerHTML = '';
  } else {
    const rate1 = fxRates[payCur] || 1;
    const rate2 = fxRates[debt.currency] || 1;
    el.innerHTML = `FX: 1 ${payCur} = ${(rate1 / rate2).toFixed(4)} ${debt.currency} — payment will be converted to ${debt.currency}`;
  }
}

function payDebtFull(debtId) {
  const debt = (state.thirdParty || []).find(d => d.id === debtId);
  if (!debt) return;
  document.getElementById('pay-amount').value = debt.amount;
  document.getElementById('pay-currency').value = debt.currency;
  document.getElementById('pay-conversion').innerHTML = '';
}

async function submitPayment(debtId) {
  const debt = (state.thirdParty || []).find(d => d.id === debtId);
  if (!debt) return;

  const amount = parseAmountInput(document.getElementById('pay-amount').value);
  const currency = document.getElementById('pay-currency').value;
  const account = document.getElementById('pay-account').value;
  const note = document.getElementById('pay-note').value.trim();

  if (!amount || amount <= 0) {
    document.getElementById('pay-status').innerHTML = `<div class="atx-status error">${t('pages.debt.err.amount_invalid', {}, 'Enter a valid amount')}</div>`;
    return;
  }
  if (!account) {
    document.getElementById('pay-status').innerHTML = `<div class="atx-status error">${t('pages.debt.err.account_required', {}, 'Select an account')}</div>`;
    return;
  }

  // Convert to debt currency
  let converted = amount;
  if (currency !== debt.currency) {
    converted = convertTo(amount, currency, debt.currency);
  }

  // Cap at remaining
  if (converted > debt.amount) {
    converted = debt.amount;
  }

  const txType = debt.type === 'owed_by_me' ? 'expense' : 'income';
  const statusEl = document.getElementById('pay-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>Recording ${formatCurrency(amount, currency)} ${currency}${currency !== debt.currency ? ` (= ${formatCurrency(converted, debt.currency)} ${debt.currency})` : ''} — creating ${txType} on ${account}...</div>`;

  try {
    const res = await fetch('/api/debts/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ debt_id: debtId, amount, currency, converted_amount: converted, note, account }),
    });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderDebtsPage();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

async function showDebtHistory(debtId) {
  const debt = (state.thirdParty || []).find(d => d.id === debtId);
  if (!debt) return;

  let payments = [];
  try {
    const res = await fetch('/api/debts/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ debt_id: debtId }),
    });
    const data = await res.json();
    payments = data.payments || [];
  } catch (e) {}

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  const totalPaid = payments.reduce((s, p) => s + (parseFloat(p.converted_amount) || 0), 0);

  overlay.innerHTML = `
    <div class="modal">
      <h3><span class="accent">${escapeHtml(debt.person_name)}</span> — Payment History</h3>
      <div class="hint-md mb-16">
        Original: ${formatCurrency(debt.original_amount, debt.currency)} ${debt.currency} ·
        Paid: ${formatCurrency(totalPaid, debt.currency)} ${debt.currency} ·
        Remaining: ${formatCurrency(debt.amount, debt.currency)} ${debt.currency}
      </div>
      ${payments.length === 0
        ? `<div class="empty-state compact"><div class="empty-state-icon">&#x1F4B8;</div><div class="empty-state-desc">${t('pages.debt.payments.empty', {}, 'No payments recorded yet.')}</div></div>`
        : `<table class="tx-table"><thead><tr><th>Date</th><th class="amt">Paid</th><th class="amt">Converted</th><th>Note</th></tr></thead><tbody>
          ${payments.map(p => `<tr>
            <td>${fmtDate(p.date)}</td>
            <td class="amt">${formatCurrency(parseFloat(p.amount), p.currency)} ${p.currency}</td>
            <td class="amt c-pos">${formatCurrency(parseFloat(p.converted_amount), debt.currency)} ${debt.currency}</td>
            <td class="hint-sm">${escapeHtml(p.note || '')}</td>
          </tr>`).join('')}
        </tbody></table>`
      }
      <div class="modal-footer mt-16">
        <div class="btn-left"></div>
        <div class="btn-right"><button data-action="closeModal">Close</button></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

