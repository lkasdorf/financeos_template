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
        <div class="atx-field" class="fx2"><label>${t('reports.debtOverview.col.person', {}, 'Person')}</label>
          <input type="text" id="dm-person" value="${escapeHtml(item?.person_name || '')}" placeholder="${escapeHtml(t('pages.debt.modal.person_placeholder', {}, 'PersonA'))}">
        </div>
        <div class="atx-field" class="fx1"><label>${t('reports.debtOverview.col.direction', {}, 'Direction')}</label>
          <select id="dm-type">
            <option value="owed_by_me" ${!item || item.type === 'owed_by_me' ? 'selected' : ''}>${t('pages.debt.direction.owed_by_me', {}, 'I owe them')}</option>
            <option value="owed_to_me" ${item?.type === 'owed_to_me' ? 'selected' : ''}>${t('pages.debt.direction.owed_to_me', {}, 'They owe me')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>Amount</label>
          <input type="text" id="dm-amount" value="${item ? item.original_amount : ''}" placeholder="1200" ${isEdit ? 'disabled' : ''}>
        </div>
        <div class="atx-field" class="fx05"><label>Currency</label>
          <select id="dm-currency">
            <option value="TZS" ${item?.currency === 'TZS' ? 'selected' : ''}>TZS</option>
            <option value="EUR" ${item?.currency === 'EUR' ? 'selected' : ''}>EUR</option>
            <option value="USD" ${item?.currency === 'USD' ? 'selected' : ''}>USD</option>
            <option value="PLN" ${item?.currency === 'PLN' ? 'selected' : ''}>PLN</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>${t('common.label.note', {}, 'Note')}</label>
          <input type="text" id="dm-note" value="${escapeHtml(item?.note || '')}" placeholder="${escapeHtml(t('pages.debt.note_placeholder', {}, 'Reason for the debt'))}">
        </div>
      </div>
      ${isEdit ? '' : `
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>Account (origination TX)</label>
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
          <button onclick="closeModal()">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" onclick="saveDebt(${isEdit ? `'${editId}'` : 'null'})">${isEdit ? t('pages.debt.btn.save_edit', {}, 'Save') : t('pages.debt.btn.save_new', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
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
            <button class="btn-save" onclick="topUpExistingDebt('${existing.id}', ${parseFloat(data.amount)}, '${escapeHtml(data.note)}')">Top up +${formatCurrency(parseFloat(data.amount), data.currency)}</button>
            <button onclick="document.getElementById('dm-status').innerHTML='<input type=\\'hidden\\' id=\\'dm-topup-confirmed\\'>'; saveDebt(null);">${t('pages.debt.btn.create_new', {}, 'Create new')}</button>
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
  if (!confirm(t('pages.debt.confirm.delete', { id: debtId }, `Delete debt "${debtId}"?`))) return;
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
        <div class="atx-field" class="fx1"><label>${dirLabel}</label>
          <select id="pay-account">${accOptions}</select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>Payment Amount</label>
          <input type="text" id="pay-amount" placeholder="${debt.amount}" autofocus>
        </div>
        <div class="atx-field" class="fx05"><label>Currency</label>
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
        <div class="atx-field" class="fx1"><label>Note (optional)</label>
          <input type="text" id="pay-note" placeholder="e.g. cash, transfer, partial">
        </div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:12px;">${t('pages.debt.autotx_hint_short', { type: debt.type === 'owed_by_me' ? t('pages.debt.type_word.expense', {}, 'expense') : t('pages.debt.type_word.income', {}, 'income') }, `A ${debt.type === 'owed_by_me' ? 'expense' : 'income'} transaction will be created automatically.`)}</div>
      <div id="pay-status"></div>
      <div class="modal-footer">
        <div class="btn-left">
          <button onclick="payDebtFull('${debtId}')" class="hint-sm">Pay full amount</button>
        </div>
        <div class="btn-right">
          <button onclick="closeModal()">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" onclick="submitPayment('${debtId}')">Record Payment</button>
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
        ? `<div style="color:var(--muted);padding:20px 0;text-align:center;">${t('pages.debt.payments.empty', {}, 'No payments recorded yet.')}</div>`
        : `<table class="tx-table"><thead><tr><th>Date</th><th class="amt">Paid</th><th class="amt">Converted</th><th>Note</th></tr></thead><tbody>
          ${payments.map(p => `<tr>
            <td>${fmtDate(p.date)}</td>
            <td class="amt">${formatCurrency(parseFloat(p.amount), p.currency)} ${p.currency}</td>
            <td class="amt" class="c-pos">${formatCurrency(parseFloat(p.converted_amount), debt.currency)} ${debt.currency}</td>
            <td class="hint-sm">${escapeHtml(p.note || '')}</td>
          </tr>`).join('')}
        </tbody></table>`
      }
      <div class="modal-footer" class="mt-16">
        <div class="btn-left"></div>
        <div class="btn-right"><button onclick="closeModal()">Close</button></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

function renderDebtSummary() {
  const open = (state.thirdParty || []).filter(tp => tp.settled !== 'true');
  if (open.length === 0) return '';

  const cur = displayCurrency !== 'TZS' ? displayCurrency : 'TZS';
  let totalOwed = 0, totalOwe = 0;
  for (const tp of open) {
    const amt = convertTo(tp.amount, tp.currency, cur);
    if (tp.type === 'owed_to_me') totalOwed += amt;
    else totalOwe += amt;
  }
  const net = totalOwed - totalOwe;

  const items = open.map(tp => {
    const isOwed = tp.type === 'owed_to_me';
    const amt = convertTo(tp.amount, tp.currency, cur);
    return `<span style="font-size:10px;color:${isOwed ? 'var(--positive)' : 'var(--negative)'}">${escapeHtml(tp.person_name)}: ${isOwed ? '+' : '-'}${formatCurrency(amt, cur)}</span>`;
  }).join(' · ');

  return `
    <section class="section">
      <div class="section-title">${t('dashboard.debt.title', {}, 'Debts &amp; Receivables')} <a href="#debts" style="font-size:10px;font-weight:400;margin-left:8px;">${t('dashboard.debt.details_link', {}, 'details &rarr;')}</a></div>
      <div class="networth">
        <div class="networth-card">
          <div class="nw-label">${t('dashboard.debt.owed_to_you', {}, 'Owed to You')}</div>
          <div class="nw-value" class="c-pos">${formatCurrency(totalOwed, cur)}<span class="nw-currency">${cur}</span></div>
        </div>
        <div class="networth-card">
          <div class="nw-label">${t('dashboard.debt.you_owe', {}, 'You Owe')}</div>
          <div class="nw-value" class="c-neg">${formatCurrency(totalOwe, cur)}<span class="nw-currency">${cur}</span></div>
        </div>
        <div class="networth-card">
          <div class="nw-label">${t('dashboard.debt.net', {}, 'Net')}</div>
          <div class="nw-value" style="color:${net >= 0 ? 'var(--positive)' : 'var(--negative)'}">${net >= 0 ? '+' : '-'}${formatCurrency(Math.abs(net), cur)}<span class="nw-currency">${cur}</span></div>
          <div class="nw-breakdown">${items}</div>
        </div>
      </div>
    </section>
  `;
}

// ─── Savings Goals Widget ────────────────────────────────────────────��──

function renderSavingsGoals() {
  const goals = (state.savingsGoals || []).filter(g => g.active !== false);
  if (goals.length === 0) return '';

  const items = goals.map(g => {
    const acc = state.accounts.find(a => a.alias === g.account);
    const bal = acc ? (state.balances[g.account] || 0) : 0;
    const cur = g.currency || (acc ? acc.currency : 'TZS');
    const target = g.target || 0;
    const pct = target > 0 ? Math.min((bal / target) * 100, 100) : 0;
    const color = pct >= 75 ? 'var(--positive)' : pct >= 25 ? 'var(--warn, #f59e0b)' : 'var(--negative)';
    const deadlineInfo = g.deadline ? `<span class="c-mut" style="font-size:10px;"> · ${t('dashboard.savings.by_deadline', { date: g.deadline }, `by ${g.deadline}`)}</span>` : '';

    return `
      <div class="goal-item">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <span style="font-weight:600;font-size:12px;">${escapeHtml(g.name)}</span>
          <span style="font-size:11px;">${formatCurrency(bal, cur)} / ${formatCurrency(target, cur)} <span class="c-mut">${cur}</span>${deadlineInfo}</span>
        </div>
        <div class="goal-bar-bg">
          <div class="goal-bar-fill" style="width:${pct.toFixed(1)}%;background:${color};"></div>
        </div>
        <div style="font-size:10px;color:${color};margin-top:2px;">${pct.toFixed(0)}% · ${escapeHtml(g.account)}</div>
      </div>
    `;
  }).join('');

  return `
    <section class="section">
      <div class="section-title">${t('dashboard.savings.title', {}, 'Savings Goals')} <a href="#settings" style="font-size:10px;font-weight:400;margin-left:8px;">${t('dashboard.savings.manage_link', {}, 'manage &rarr;')}</a></div>
      ${items}
    </section>
  `;
}

// ─── Budget Tracker Widget ──────────────────────────────────────────────

function renderBudgetTracker() {
  // Feature toggle — disabled by default
  if (localStorage.getItem('lp-budgets-enabled') !== 'true') return '';
  const budgets = state.budgets || [];
  if (budgets.length === 0) return '';

  const month = state.currentMonth; // 'YYYY-MM'
  const cur = displayCurrency;

  // Calculate spent per budget category in current month
  const monthTx = state.tx.filter(t => t.type === 'expense' && t.date && t.date.startsWith(month));

  const items = budgets.map(b => {
    const matching = monthTx.filter(t => (t.category || '').startsWith(b.category));
    const spent = matching.reduce((s, t) => s + convertTo(t.amount, t.currency, cur), 0);
    const target = convertTo(b.amount, b.currency, cur);
    const rawPct = target > 0 ? (spent / target) * 100 : 0;
    const pct = Math.min(rawPct, 100);
    const color = rawPct > 85 ? 'var(--negative)' : rawPct > 60 ? 'var(--warn, #f59e0b)' : 'var(--positive)';
    const overBudget = spent > target;
    return { ...b, spent, target, pct, rawPct, color, overBudget };
  }).sort((a, b) => b.rawPct - a.rawPct);

  const totalSpent = items.reduce((s, i) => s + i.spent, 0);
  const totalBudget = items.reduce((s, i) => s + i.target, 0);
  const totalRawPct = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const totalPct = Math.min(totalRawPct, 100);

  const monthLabel = new Date(month + '-01').toLocaleDateString(getLocaleTag(), { month: 'long', year: 'numeric' });

  // Bullet chart: 3 color zones + spending bar + target marker
  function bulletChart(rawPct) {
    // Scale: if over budget, zones shrink proportionally so bar can extend
    const scale = rawPct > 100 ? Math.min(rawPct, 130) : 100;
    const goodW = (60 / scale) * 100;
    const warnW = (25 / scale) * 100;
    const dangerW = (15 / scale) * 100;
    const overW = scale > 100 ? ((scale - 100) / scale) * 100 : 0;
    const barW = Math.min(rawPct / scale * 100, 100);
    const targetLeft = (100 / scale) * 100;
    return `<div class="bullet-chart">
      <div class="bullet-zone bullet-zone-good" style="width:${goodW.toFixed(1)}%"></div>
      <div class="bullet-zone bullet-zone-warn" style="width:${warnW.toFixed(1)}%"></div>
      <div class="bullet-zone bullet-zone-danger" style="width:${dangerW.toFixed(1)}%"></div>
      ${overW > 0 ? `<div class="bullet-zone bullet-zone-over" style="width:${overW.toFixed(1)}%"></div>` : ''}
      <div class="bullet-bar" style="width:${barW.toFixed(1)}%"></div>
      <div class="bullet-target" style="left:${targetLeft.toFixed(1)}%"></div>
    </div>`;
  }

  return `
    <section class="section">
      <div class="section-title">${t('dashboard.budget.title', { month: monthLabel }, `Budget Tracker — ${monthLabel}`)} <a href="#settings" onclick="settingsTab='budgets'" style="font-size:10px;font-weight:400;margin-left:8px;">${t('dashboard.budget.manage_link', {}, 'manage &rarr;')}</a></div>
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">
          <span style="font-weight:600;">${t('dashboard.budget.overall', {}, 'Overall')}</span>
          <span>${formatCurrency(totalSpent, cur)} / ${formatCurrency(totalBudget, cur)} ${cur} <strong style="color:${totalRawPct > 85 ? 'var(--negative)' : totalRawPct > 60 ? 'var(--warn, #f59e0b)' : 'var(--positive)'}">${totalRawPct.toFixed(0)}%</strong></span>
        </div>
        ${bulletChart(totalRawPct)}
      </div>
      ${items.map(i => `
        <div class="budget-item">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
            <span style="font-size:12px;">${escapeHtml(i.category)}</span>
            <span style="font-size:11px;">${formatCurrency(i.spent, cur)} / ${formatCurrency(i.target, cur)} ${cur} <strong style="color:${i.color}">${i.rawPct.toFixed(0)}%</strong>${i.overBudget ? ` <span style="color:var(--negative);font-size:10px;">${t('dashboard.budget.over_label', {}, 'over!')}</span>` : ''}</span>
          </div>
          ${bulletChart(i.rawPct)}
        </div>
      `).join('')}
    </section>
  `;
}

// Calculate monthly net worth snapshots for the last N months
function netWorthMonthly(months) {
  const selfActive = state.accounts.filter(a => a.owner === 'self' && a.status === 'active' && a.type !== 'pass_through');
  const now = new Date();
  const result = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0); // last day of month
    const cutoff = d.toISOString().slice(0, 10);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    // Compute balances up to cutoff
    let total = 0;
    for (const acc of selfActive) {
      let bal = acc.initial_balance;
      for (const t of state.tx) {
        if (t.date > cutoff) continue;
        if (t.type === 'expense' && t.account === acc.alias) bal -= t.amount;
        else if (t.type === 'income' && t.account === acc.alias) bal += t.amount;
        else if (t.type === 'transfer' && t.account === acc.alias) bal -= t.amount;
        else if (t.type === 'transfer' && t.transfer_to_account === acc.alias) bal += (t.transfer_to_amount > 0 ? t.transfer_to_amount : t.amount);
      }
      total += toDisplay(bal, acc.currency);
    }
    result.push({ ym, total });
  }
  return result;
}

function renderNetWorth() {
  const nw = netWorthByCurrency(state.accounts, state.balances);
  const entries = Object.entries(nw).sort((a, b) => b[1].total - a[1].total);
  const debts = debtsByCurrency(state.thirdParty);

  // Net worth trend (6 months, in display currency)
  const trend = netWorthMonthly(6);
  const trendValues = trend.map(t => t.total);
  const trendLabels = trend.map(t => monthLabel(t.ym));
  const trendSpark = sparklineSvg(trendValues, 120, 32);
  const trendChange = trendValues.length >= 2 ? trendValues[trendValues.length - 1] - trendValues[0] : 0;
  const trendCur = displayCurrency !== 'TZS' ? displayCurrency : 'TZS';

  const cards = entries.map(([cur, info]) => {
    const debt = debts[cur] || { net: 0, owedToMe: 0, owedByMe: 0 };
    const hasDebts = debt.owedToMe !== 0 || debt.owedByMe !== 0;
    const adjusted = info.total + debt.net;
    const balanceBlock = hasDebts ? `
      <div class="nw-breakdown" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border,#334155);">
        <div>${t('dashboard.networth.debt_owed_to_me', { amount: formatCurrency(debt.owedToMe, cur) }, `+ Owed to me: ${formatCurrency(debt.owedToMe, cur)}`)}</div>
        <div>${t('dashboard.networth.debt_owed_by_me', { amount: formatCurrency(debt.owedByMe, cur) }, `− Owed by me: ${formatCurrency(debt.owedByMe, cur)}`)}</div>
        <div style="margin-top:4px;color:var(--text,#e2e8f0);font-weight:600;">
          ${t('dashboard.networth.debt_balance', { amount: formatCurrency(adjusted, cur), currency: cur }, `= Balance: ${formatCurrency(adjusted, cur)} ${cur}`)}
        </div>
      </div>
    ` : '';
    return `
    <div class="networth-card">
      <div class="nw-label">${t('dashboard.networth.card_label', { currency: cur }, `Net Worth ${cur}`)}</div>
      <div class="nw-value">${formatCurrency(info.total, cur)}<span class="nw-currency">${cur}</span></div>
      <div class="nw-breakdown">${info.accounts === 1
        ? t('dashboard.networth.across_one', {}, 'across 1 account')
        : t('dashboard.networth.across_many', { n: info.accounts }, `across ${info.accounts} accounts`)}</div>
      ${balanceBlock}
    </div>
  `;
  }).join('');

  const trendCard = trendValues.length >= 2 ? `
    <div class="networth-card">
      <div class="nw-label">${t('dashboard.networth.trend_label', { currency: trendCur }, `6-Month Trend ${trendCur}`)}</div>
      <div style="display:flex;align-items:center;gap:12px;">
        ${trendSpark}
        <span style="font-size:14px;font-weight:600;color:${trendChange >= 0 ? 'var(--positive)' : 'var(--negative)'};">
          ${trendChange >= 0 ? '+' : ''}${formatCurrency(trendChange, trendCur)}
        </span>
      </div>
      <div class="nw-breakdown">${trendLabels[0]} → ${trendLabels[trendLabels.length - 1]}</div>
    </div>
  ` : '';

  return `
    <section class="section">
      <div class="section-title">${t('dashboard.networth.title', {}, 'Net Worth')} <span class="hint">${t('dashboard.networth.hint', {}, '(owner=self, active, excl. pass-through)')}</span></div>
      <div class="networth">${cards}${trendCard}</div>
    </section>
  `;
}

function renderAccounts() {
  const groups = {
    self: [],
    custody: [],
    archived: [],
  };
  for (const a of state.accounts) {
    if (a.status === 'archived') groups.archived.push(a);
    else if (a.owner !== 'self') groups.custody.push(a);
    else groups.self.push(a);
  }
  groups.self.sort((a, b) => Math.abs(state.balances[b.alias] || 0) - Math.abs(state.balances[a.alias] || 0));
  groups.custody.sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name));
  groups.archived.sort((a, b) => a.name.localeCompare(b.name));

  const renderRow = (a) => {
    const bal = state.balances[a.alias] || 0;
    const showCur = displayCurrency !== 'TZS' ? displayCurrency : a.currency;
    const showBal = displayCurrency !== 'TZS' ? toDisplay(bal, a.currency) : bal;
    const balClass = showBal < 0 ? 'negative' : '';
    const tag = a.type === 'pass_through' ? '<span class="label-xs" style="margin-left:6px;">PT</span>' : '';
    const nativeHint = (displayCurrency !== 'TZS' && a.currency !== displayCurrency) ? `<span class="label-xs" style="margin-left:4px;">(${a.currency})</span>` : '';
    const spark = sparklineSvg(accountDailyBalances(a.alias, 30), 72, 22);
    return `
      <tr>
        <td><span class="acc-alias" style="margin:0;font-size:10px;">${a.alias}</span>${tag}</td>
        <td class="fs-11">${escapeHtml(a.name)}</td>
        <td style="padding:4px 8px;">${spark}</td>
        <td class="amt ${balClass}">${formatCurrency(showBal, showCur)}${nativeHint}<span class="acc-currency">${showCur}</span></td>
      </tr>
    `;
  };

  const renderTable = (rows, label) => `
    <div class="accounts-group">
      <div class="group-label">${label}</div>
      <table class="tx-table" class="mb-0">
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  const leftCol = renderTable(groups.self.map(renderRow).join(''), t('dashboard.accounts.self_group', { n: groups.self.length }, `Own Accounts (${groups.self.length})`));

  let rightParts = '';
  if (groups.custody.length) {
    rightParts += renderTable(groups.custody.map(r => {
      const bal = state.balances[r.alias] || 0;
      const showCur = displayCurrency !== 'TZS' ? displayCurrency : r.currency;
      const showBal = displayCurrency !== 'TZS' ? toDisplay(bal, r.currency) : bal;
      const balClass = showBal < 0 ? 'negative' : '';
      const spark = sparklineSvg(accountDailyBalances(r.alias, 30), 72, 22);
      return `<tr>
        <td><span class="acc-alias" style="margin:0;font-size:10px;">${r.alias}</span></td>
        <td class="fs-11">${escapeHtml(r.name)}<span class="label-xs" style="margin-left:6px;">${r.owner}</span></td>
        <td style="padding:4px 8px;">${spark}</td>
        <td class="amt ${balClass}">${formatCurrency(showBal, showCur)}<span class="acc-currency">${showCur}</span></td>
      </tr>`;
    }).join(''), t('dashboard.accounts.custody_group', { n: groups.custody.length }, `Custody (${groups.custody.length})`));
  }
  if (groups.archived.length) {
    rightParts += renderTable(groups.archived.map(r => {
      const bal = state.balances[r.alias] || 0;
      const showCur = displayCurrency !== 'TZS' ? displayCurrency : r.currency;
      const showBal = displayCurrency !== 'TZS' ? toDisplay(bal, r.currency) : bal;
      return `<tr style="opacity:0.5;">
        <td><span class="acc-alias" style="margin:0;font-size:10px;">${r.alias}</span></td>
        <td class="fs-11">${escapeHtml(r.name)}</td>
        <td class="amt">${formatCurrency(showBal, showCur)}<span class="acc-currency">${showCur}</span></td>
      </tr>`;
    }).join(''), t('dashboard.accounts.archived_group', { n: groups.archived.length }, `Archived (${groups.archived.length})`));
  }

  return `
    <section class="section">
      <div class="section-title">${t('dashboard.accounts.title', {}, 'Accounts')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div>${leftCol}</div>
        <div>${rightParts}</div>
      </div>
    </section>
  `;
}

function renderMonthSection() {
  const ym = state.currentMonth;
  const cur = displayCurrency !== 'TZS' ? displayCurrency : state.primaryCurrency;
  const sum = sumByMonth(state.tx, ym, cur);
  return `
    <section class="section">
      <div class="section-title">${t('dashboard.month.title', {}, 'Monthly Summary')} <span class="hint">${cur} · ${t('dashboard.month.hint_body', {}, 'incl. reimbursements, excl. transfers')}${displayCurrency !== 'TZS' ? ' · ' + t('dashboard.fx_converted', {}, 'FX-converted') : ''}</span></div>
      <div class="month-nav">
        <button data-nav="prev">${t('dashboard.month.nav_prev', {}, '← prev')}</button>
        <span class="current">${monthLabel(ym)}</span>
        <button data-nav="next">${t('dashboard.month.nav_next', {}, 'next →')}</button>
        <button data-nav="current">${t('dashboard.month.nav_today', {}, 'today')}</button>
      </div>
      <div class="month-summary">
        <div class="summary-card">
          <div class="label">${t('dashboard.month.card_income', {}, 'Income')}</div>
          <div class="value positive">${formatCurrency(sum.income, cur)}<span class="cur">${cur}</span></div>
        </div>
        <div class="summary-card">
          <div class="label">${t('dashboard.month.card_expenses', {}, 'Expenses')}</div>
          <div class="value negative">${formatCurrency(sum.expense, cur)}<span class="cur">${cur}</span></div>
        </div>
        <div class="summary-card">
          <div class="label">${t('dashboard.month.card_net', {}, 'Net')}</div>
          <div class="value ${sum.net >= 0 ? 'positive' : 'negative'}">${formatCurrency(sum.net, cur)}<span class="cur">${cur}</span></div>
        </div>
        <div class="summary-card">
          <div class="label">${t('dashboard.month.card_transactions', {}, 'Transactions')}</div>
          <div class="value">${sum.count}</div>
          <div class="meta">${t('dashboard.month.in_month', { month: monthLabel(ym) }, `in ${monthLabel(ym)}`)}</div>
        </div>
      </div>
    </section>
  `;
}

function renderChartsSection() {
  const cur = displayCurrency !== 'TZS' ? displayCurrency : state.primaryCurrency;
  return `
    <section class="section">
      <div class="section-title">${t('dashboard.charts.analysis_title', {}, 'Analysis')} <span class="hint" id="charts-hint">${cur}${displayCurrency !== 'TZS' ? ' · ' + t('dashboard.fx_converted', {}, 'FX-converted') : ''}</span></div>
      <div class="chart-row">
        <div class="chart-wrap">
          <div class="section-title" class="mb-12" id="cat-chart-title">${t('dashboard.charts.categories_title', { month: monthLabel(state.currentMonth) }, `Top 8 Categories — ${monthLabel(state.currentMonth)}`)}</div>
          <div class="chart-canvas-box"><canvas id="cat-chart"></canvas></div>
        </div>
        <div class="chart-wrap">
          <div class="section-title" class="mb-12">${t('dashboard.charts.cashflow_title', {}, 'Cashflow — Last 12 Months')}</div>
          <div class="chart-canvas-box"><canvas id="cashflow-chart"></canvas></div>
        </div>
      </div>
    </section>
  `;
}

function renderRecentTx() {
  const sorted = state.tx.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 20);
  const rows = sorted.map(tx => {
    const tags = (tx.tags || '').split(';').filter(Boolean).map(x => `<span class="tag-chip">${escapeHtml(x)}</span>`).join('');
    const label = tx.type === 'transfer'
      ? t('dashboard.recent.transfer_to', { account: tx.transfer_to_account || '?' }, `→ ${tx.transfer_to_account || '?'}`)
      : escapeHtml(tx.payee || '');
    const catOrType = tx.type === 'transfer'
      ? t('dashboard.recent.transfer_category', {}, 'Transfer')
      : escapeHtml(tx.category || '');
    return `
      <tr>
        <td>${fmtDate(tx.date)}</td>
        <td>${tx.account}</td>
        <td>${label}</td>
        <td class="cat">${catOrType}${tags ? '<br>' + tags : ''}</td>
        <td class="amt ${tx.type}">${formatCurrency(tx.amount, tx.currency)}</td>
        <td class="hint-sm">${tx.currency}</td>
      </tr>
    `;
  }).join('');
  return `
    <section class="section">
      <div class="section-title">${t('dashboard.recent.title', {}, 'Recent Transactions')}</div>
      <table class="tx-table">
        <thead>
          <tr><th>${t('dashboard.recent.col_date', {}, 'Date')}</th><th>${t('dashboard.recent.col_account', {}, 'Account')}</th><th>${t('dashboard.recent.col_payee', {}, 'Payee / Target')}</th><th>${t('dashboard.recent.col_category', {}, 'Category / Tags')}</th><th class="amt">${t('dashboard.recent.col_amount', {}, 'Amount')}</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}


// ─── Accounts Overview ───────────────────────────────────────────────────

function renderAccountsOverview() {
  const content = document.getElementById('accounts-overview-content');
  if (!content || !state.accounts.length) return;

  const cur = displayCurrency;
  const groups = [
    { label: t('accounts_overview.group.own', {}, 'Own Accounts'), accounts: state.accounts.filter(a => a.owner === 'self' && a.status === 'active' && a.type !== 'pass_through') },
    { label: t('accounts_overview.group.passthrough', {}, 'Pass-Through'), accounts: state.accounts.filter(a => a.owner === 'self' && a.status === 'active' && a.type === 'pass_through') },
    { label: t('accounts_overview.group.custody', {}, 'Custody'), accounts: state.accounts.filter(a => a.owner !== 'self' && a.status === 'active') },
    { label: t('accounts_overview.group.archived', {}, 'Archived'), accounts: state.accounts.filter(a => a.status === 'archived') },
  ];

  // Net Worth (same logic as dashboard)
  const nw = netWorthByCurrency(state.accounts, state.balances);
  const nwTotal = Object.values(nw).reduce((s, v) => s + v.total, 0);

  let html = '';
  for (const g of groups) {
    if (!g.accounts.length) continue;
    const rows = g.accounts.map(a => {
      const bal = state.balances[a.alias] || 0;
      const converted = a.currency === cur ? bal : convertTo(bal, a.currency, cur);
      const balClass = bal < 0 ? 'negative' : '';
      const ownerBadge = a.owner !== 'self' ? `<span style="font-size:10px;color:var(--muted);margin-left:6px;">(${a.owner})</span>` : '';
      return `<tr class="ptr" onclick="history.pushState(null,'','#account:${a.alias}');navigateTo('account:${a.alias}')">
        <td><strong>${escapeHtml(a.name)}</strong>${ownerBadge}<br><span class="label-sm">${a.alias}</span></td>
        <td class="label-sm">${a.currency}</td>
        <td class="label-sm">${a.type}</td>
        <td class="amt ${balClass}" class="fw-500">${formatCurrency(bal, a.currency)}<span class="acc-currency">${a.currency}</span></td>
        ${a.currency !== cur ? `<td class="amt" class="label-sm">${formatCurrency(converted, cur)} ${cur}</td>` : `<td></td>`}
      </tr>`;
    }).join('');

    html += `
      <div class="section">
        <div class="section-title">${g.label}</div>
        <table class="tx-table">
          <thead><tr><th>${t('accounts_overview.col_account', {}, 'Account')}</th><th>${t('accounts_overview.col_currency', {}, 'Currency')}</th><th>${t('accounts_overview.col_type', {}, 'Type')}</th><th class="amt">${t('accounts_overview.col_balance', {}, 'Balance')}</th><th class="amt"></th></tr></thead>
          <tbody>
            ${rows}
            ${(() => {
              const byCur = {};
              g.accounts.forEach(a => {
                if (!byCur[a.currency]) byCur[a.currency] = 0;
                byCur[a.currency] += state.balances[a.alias] || 0;
              });
              // Rename map var to avoid shadowing the global t() function.
              return Object.entries(byCur).map(([c, total]) =>
                `<tr style="font-weight:600;border-top:1px solid var(--border);">
                  <td colspan="3">${t('accounts_overview.total_label', { group: g.label, currency: c }, `Total ${g.label} (${c})`)}</td>
                  <td class="amt" colspan="2">${formatCurrency(total, c)}<span class="acc-currency">${c}</span></td>
                </tr>`
              ).join('');
            })()}
          </tbody>
        </table>
      </div>
    `;
  }

  // Net Worth summary at bottom (matches dashboard exactly — reuses dashboard.networth.* keys)
  html += `
    <div class="section">
      <div class="section-title">${t('dashboard.networth.title', {}, 'Net Worth')} <span class="hint">${t('dashboard.networth.hint', {}, '(owner=self, active, excl. pass-through)')}</span></div>
      <div class="income-grid">
        ${Object.entries(nw).map(([c, v]) => `
          <div class="income-cell">
            <div class="ic-label">${c}</div>
            <div class="ic-value">${formatCurrency(v.total, c)}<span class="ic-cur">${c}</span></div>
            <div class="ic-count">${t(v.accounts === 1 ? 'accounts_overview.account_count_one' : 'accounts_overview.account_count_many', { n: v.accounts }, v.accounts === 1 ? '1 account' : `${v.accounts} accounts`)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  content.innerHTML = html;
}

// ─── Account Detail ──────────────────────────────────────────────────────

function renderAccountPage() {
  const alias = accountPage.alias;
  const acc = state.accounts.find(a => a.alias === alias);
  if (!acc) return;

  const bal = state.balances[alias] || 0;
  const headerEl = document.getElementById('account-header');
  const contentEl = document.getElementById('account-content');

  // Header
  const metaBits = [];
  metaBits.push(acc.currency);
  metaBits.push(acc.type);
  if (acc.owner !== 'self') metaBits.push(t('accp.meta_owner', { owner: acc.owner }, `owner: ${acc.owner}`));
  if (acc.status === 'archived') metaBits.push(t('accp.meta_archived', {}, 'archived'));

  headerEl.innerHTML = `
    <div style="display:flex;align-items:center;margin-bottom:12px;">
      <button class="report-back" onclick="history.pushState(null,'','#accounts');navigateTo('accounts');" style="margin:0;">${t('accp.back', {}, '← Accounts')}</button>
      <div style="margin-left:auto;display:flex;gap:8px;">
        <button onclick="exportAccountTx('${alias}')" style="padding:6px 14px;font-size:12px;">${t('accp.export_xlsx', {}, 'Export XLSX')}</button>
        <button class="btn-save" onclick="navigateToAddTxWithAccount('${alias}')" style="padding:8px 14px;font-size:12px;">${t('accp.add_tx', {}, '+ Add TX')}</button>
      </div>
    </div>
    <h2>${escapeHtml(acc.name)} <span class="accent">${alias}</span></h2>
    <div class="page-meta">
      <span class="bal">${formatCurrency(bal, acc.currency)} ${acc.currency}</span>
      <span>${metaBits.join(' · ')}</span>
    </div>
    <div class="accp-primary-cta">
      <button class="primary-action-btn" onclick="navigateToAddTxWithAccount('${alias}')">${t('accp.add_tx', {}, '+ Add TX')}</button>
    </div>
  `;

  // All TX for this account (source or transfer target), unfiltered — needed
  // for the running-balance calculation.
  const allAccountTx = state.tx.filter(t =>
    t.account === alias || (t.type === 'transfer' && t.transfer_to_account === alias)
  ).sort((a, b) => {
    const c = (b.date || '').localeCompare(a.date || '');
    if (c !== 0) return c;
    return (b._ord || 0) - (a._ord || 0);
  });

  // Apply current account-page filters
  const txForAccount = applyTxFilterSort(allAccountTx, accountPage, { includeAccount: alias }).sort((a, b) => {
    const c = (b.date || '').localeCompare(a.date || '');
    if (c !== 0) return c;
    return (b._ord || 0) - (a._ord || 0);
  });

  const total = txForAccount.length;
  const pageSize = accountPage.PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(accountPage.page, totalPages - 1);
  const start = currentPage * pageSize;
  const slice = txForAccount.slice(start, start + pageSize);

  // Calculate effect of a TX on this account's balance
  function txEffect(t) {
    const isTransferIn = t.type === 'transfer' && t.transfer_to_account === alias && t.account !== alias;
    if (isTransferIn) return parseFloat(t.transfer_to_amount || t.amount) || 0;
    if (t.type === 'transfer') return -(parseFloat(t.amount) || 0);
    if (t.type === 'income') return parseFloat(t.amount) || 0;
    return -(parseFloat(t.amount) || 0); // expense
  }

  // Running balance computed on the UNFILTERED list (newest → oldest) so that
  // filtered rows still show the true account balance at each point in time.
  const balByImportId = new Map();
  let walkBal = bal;
  for (const t of allAccountTx) {
    balByImportId.set(t.import_id, walkBal);
    walkBal -= txEffect(t);
  }

  // Table — map var renamed from `t` to `tx` so the global t() i18n function
  // is not shadowed inside the callback (same pattern as renderRecentTx).
  const editLabel = t('tx.actions.edit', {}, 'Edit');
  const duplicateLabel = t('tx.actions.duplicate', {}, 'Duplicate');
  const deleteLabel = t('tx.actions.delete', {}, 'Delete');
  const transferLabel = t('dashboard.recent.transfer_category', {}, 'Transfer');
  const rows = slice.map(tx => {
    const rowBal = balByImportId.get(tx.import_id) || 0;

    const tags = (tx.tags || '').split(';').filter(Boolean).map(x => `<span class="tag-chip">${escapeHtml(x)}</span>`).join('');
    const isTransferIn = tx.type === 'transfer' && tx.transfer_to_account === alias && tx.account !== alias;
    let label, typeClass;
    if (tx.type === 'transfer') {
      if (isTransferIn) {
        label = `← ${tx.account}`;
        typeClass = 'income';
      } else {
        label = `→ ${tx.transfer_to_account || '?'}`;
        typeClass = 'transfer';
      }
    } else {
      label = escapeHtml(tx.payee || '');
      typeClass = tx.type;
    }
    const catOrType = tx.type === 'transfer' ? transferLabel : escapeHtml(tx.category || '');
    const balClass = rowBal >= 0 ? '' : 'negative';
    const noteFull = tx.note || '';
    const noteShort = noteFull.length > 80 ? noteFull.slice(0, 79) + '…' : noteFull;
    const note = noteFull ? `<div class="tx-note" title="${escapeHtml(noteFull)}">${escapeHtml(noteShort)}</div>` : '';
    return `
      <tr>
        <td>${fmtDate(tx.date)}</td>
        <td>${label}${note}</td>
        <td class="cat">${catOrType}${tags ? '<br>' + tags : ''}</td>
        <td class="amt ${typeClass}">${formatCurrency(tx.amount, tx.currency)}</td>
        <td class="amt ${balClass}" style="font-size:12px;">${formatCurrency(rowBal, acc.currency)}</td>
        <td class="tx-actions"><button class="tx-edit-btn icon-btn" data-import-id="${escapeHtml(tx.import_id)}" title="${editLabel}" aria-label="${editLabel}">✎</button><button class="tx-edit-btn icon-btn" data-duplicate-id="${escapeHtml(tx.import_id)}" title="${duplicateLabel}" aria-label="${duplicateLabel}">⧉</button><button class="tx-edit-btn icon-btn btn-delete-sm" data-delete-id="${escapeHtml(tx.import_id)}" title="${deleteLabel}" aria-label="${deleteLabel}">✕</button></td>
      </tr>
    `;
  }).join('');

  // Build filter toolbar (same fields as TX page, minus Account)
  const types = ['expense', 'income', 'transfer'];
  const allCats = [...new Set(allAccountTx.map(t => t.category).filter(Boolean))].sort();
  const topCats = [...new Set(allCats.map(c => c.split(':')[0]))].sort();
  const allTags = [...new Set(allAccountTx.flatMap(t => (t.tags || '').split(';').filter(Boolean)))].sort();
  const allPayees = [...new Set(allAccountTx.map(t => t.payee).filter(Boolean))].sort();
  const hasActiveFilters = accountPage.filterType || accountPage.filterCategory || accountPage.filterTags.length > 0 || accountPage.filterDateFrom || accountPage.filterDateTo || accountPage.filterAmountMin || accountPage.filterAmountMax || accountPage.filterPayee;

  const filterBar = `
    <div class="report-toolbar" style="flex-wrap:wrap;gap:6px 12px;margin-bottom:12px;">
      <label>${t('tx.filter.type', {}, 'Type')}</label>
      <select id="accp-type">
        <option value="">${t('tx.filter.all', {}, 'All')}</option>
        ${types.map(tt => `<option value="${tt}" ${accountPage.filterType === tt ? 'selected' : ''}>${tt}</option>`).join('')}
      </select>
      <label>${t('tx.filter.category', {}, 'Category')}</label>
      <select id="accp-category">
        <option value="">${t('tx.filter.all', {}, 'All')}</option>
        ${topCats.map(top => {
          const subs = allCats.filter(c => c === top || c.startsWith(top + ':'));
          const topOpt = `<option value="${top}" ${accountPage.filterCategory === top ? 'selected' : ''}>${t('tx.filter.category_all_suffix', { name: top }, `${top} (all)`)}</option>`;
          const subOpts = subs.filter(c => c !== top).map(c => `<option value="${c}" ${accountPage.filterCategory === c ? 'selected' : ''}>&nbsp;&nbsp;— ${c}</option>`).join('');
          return topOpt + subOpts;
        }).join('')}
      </select>
    </div>
    ${allTags.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:12px;">
      <span class="fs-12 c-mut2" style="margin-right:4px;">${t('tx.filter.tags', {}, 'Tags')}</span>
      ${allTags.map(tag => `<button class="accp-tag-chip ${accountPage.filterTags.includes(tag) ? 'active' : ''}" data-tag="${escapeHtml(tag)}" style="padding:3px 10px;font-size:10px;border-radius:12px;">${escapeHtml(tag)}</button>`).join('')}
    </div>` : ''}
    <div class="report-toolbar" style="flex-wrap:wrap;gap:6px 12px;margin-bottom:12px;">
      <label>${t('tx.filter.from', {}, 'From')}</label>
      <input type="date" id="accp-date-from" value="${accountPage.filterDateFrom}" style="padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
      <label>${t('tx.filter.to', {}, 'To')}</label>
      <input type="date" id="accp-date-to" value="${accountPage.filterDateTo}" style="padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
      <label>${t('tx.filter.payee', {}, 'Payee')}</label>
      <input type="text" id="accp-payee" list="accp-payee-list" value="${escapeHtml(accountPage.filterPayee)}" placeholder="${t('search.placeholder', {}, 'Search...')}" autocomplete="off" style="width:180px;padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
      <datalist id="accp-payee-list">${allPayees.map(p => `<option value="${escapeHtml(p)}">`).join('')}</datalist>
      <label>${t('tx.filter.amount', {}, 'Amount')}</label>
      <input type="text" id="accp-amt-min" value="${escapeHtml(String(accountPage.filterAmountMin || ''))}" placeholder="${t('tx.filter.amount_min', {}, 'min')}" style="width:90px;padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
      <input type="text" id="accp-amt-max" value="${escapeHtml(String(accountPage.filterAmountMax || ''))}" placeholder="${t('tx.filter.amount_max', {}, 'max')}" style="width:90px;padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
      ${hasActiveFilters ? `<button id="accp-reset" style="padding:5px 12px;font-size:12px;">${t('accp.reset_filters', {}, 'Reset filters')}</button>` : ''}
    </div>
  `;

  const txCountKey = total === 1 ? 'accp.tx_count_one' : 'accp.tx_count_many';
  const txCountFb = total === 1 ? '1 Transaction' : `${total} Transactions`;
  contentEl.innerHTML = `
    <div class="section">
      ${filterBar}
      <div class="section-title">${t(txCountKey, { n: total }, txCountFb)}${hasActiveFilters ? ` <span class="hint">${t('accp.filtered_from', { n: allAccountTx.length }, `(filtered from ${allAccountTx.length})`)}</span>` : ''}</div>
      <table class="tx-table">
        <thead>
          <tr><th>${t('tx.table.col_date', {}, 'Date')}</th><th>${t('tx.table.col_payee_transfer', {}, 'Payee / Transfer')}</th><th>${t('tx.table.col_category_tags', {}, 'Category / Tags')}</th><th class="amt">${t('tx.table.col_amount', {}, 'Amount')}</th><th class="amt">${t('tx.table.col_balance', {}, 'Balance')}</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${totalPages > 1 ? `
        <div class="pagination">
          <button id="acc-prev" ${currentPage === 0 ? 'disabled' : ''}>${t('tx.pagination.prev', {}, '← Previous')}</button>
          <span class="page-info">${t('tx.pagination.page_info', { start: start + 1, end: Math.min(start + pageSize, total), total }, `${start + 1}–${Math.min(start + pageSize, total)} of ${total}`)}</span>
          <button id="acc-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>${t('tx.pagination.next', {}, 'Next →')}</button>
        </div>
      ` : ''}
    </div>
  `;

  // Event delegation for account detail page (registered once)
  if (!contentEl._delegated) {
    contentEl.addEventListener('click', (e) => {
      if (e.target.id === 'acc-prev') { accountPage.page--; renderAccountPage(); return; }
      if (e.target.id === 'acc-next') { accountPage.page++; renderAccountPage(); return; }
      // Tag chip toggle
      const tagChip = e.target.closest('.accp-tag-chip');
      if (tagChip) {
        const tag = tagChip.getAttribute('data-tag');
        const idx = accountPage.filterTags.indexOf(tag);
        if (idx >= 0) accountPage.filterTags.splice(idx, 1);
        else accountPage.filterTags.push(tag);
        accountPage.page = 0;
        renderAccountPage();
        return;
      }
      // Reset filters
      if (e.target.id === 'accp-reset') {
        accountPage.filterType = ''; accountPage.filterCategory = '';
        accountPage.filterTags = []; accountPage.filterDateFrom = '';
        accountPage.filterDateTo = ''; accountPage.filterAmountMin = '';
        accountPage.filterAmountMax = ''; accountPage.filterPayee = '';
        accountPage.page = 0;
        renderAccountPage();
        return;
      }
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
    contentEl.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === 'accp-type') { accountPage.filterType = e.target.value; accountPage.page = 0; renderAccountPage(); }
      else if (id === 'accp-category') { accountPage.filterCategory = e.target.value; accountPage.page = 0; renderAccountPage(); }
      else if (id === 'accp-date-from') { accountPage.filterDateFrom = e.target.value; accountPage.page = 0; renderAccountPage(); }
      else if (id === 'accp-date-to') { accountPage.filterDateTo = e.target.value; accountPage.page = 0; renderAccountPage(); }
      else if (id === 'accp-amt-min') { accountPage.filterAmountMin = e.target.value; accountPage.page = 0; renderAccountPage(); }
      else if (id === 'accp-amt-max') { accountPage.filterAmountMax = e.target.value; accountPage.page = 0; renderAccountPage(); }
      else if (id === 'accp-payee') { accountPage.filterPayee = e.target.value; accountPage.page = 0; renderAccountPage(); }
    });
    contentEl._delegated = true;
  }
}

function exportAccountTx(alias) {
  const txForAccount = state.tx.filter(t =>
    t.account === alias || (t.type === 'transfer' && t.transfer_to_account === alias)
  ).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const data = txForAccount.map(t => ({
    Date: t.date,
    Type: t.type,
    Payee: t.payee || '',
    Category: t.category || '',
    Amount: t.amount,
    Currency: t.currency,
    Tags: t.tags || '',
    Note: t.note || '',
  }));
  exportXlsx(data, `account_${alias}_${new Date().toISOString().slice(0,10)}`, alias);
}

// ─── Reconciliation Page ─────────────────────────────────────────────────

const RECON_INDEX_URL = '../data/crdb_data/recon_index.json';
let reconTab = 'reports';

async function renderReconciliationPage() {
  const contentEl = document.getElementById('recon-content');

  contentEl.innerHTML = `
    <div class="atx-tabs mb-20">
      <button ${reconTab === 'reports' ? 'class="active"' : ''} data-recon-tab="reports">${t('pages.recon.tab.reports', {}, 'Reports')}</button>
      <button ${reconTab === 'import' ? 'class="active"' : ''} data-recon-tab="import">${t('pages.recon.tab.import', {}, 'Import')}</button>
    </div>
    <div id="recon-tab-content"></div>
  `;

  // Tab delegation
  if (!contentEl._delegated) {
    contentEl.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-recon-tab]');
      if (tabBtn) {
        reconTab = tabBtn.getAttribute('data-recon-tab');
        renderReconciliationPage();
        return;
      }
      // Book selected button
      if (e.target.closest('#recon-book-btn')) { bookReconSuggestions(); return; }
      // Select all checkbox
      if (e.target.id === 'recon-select-all') {
        const checked = e.target.checked;
        contentEl.querySelectorAll('.recon-row-check').forEach(c => c.checked = checked);
        return;
      }
    });
    contentEl._delegated = true;
  }

  if (reconTab === 'reports') await renderReconReports(document.getElementById('recon-tab-content'));
  else await renderReconImport(document.getElementById('recon-tab-content'));
}

async function renderReconReports(container) {
  container.innerHTML = `<div class="loading">${t('pages.recon.loading_reports', {}, 'Loading reconciliation data...')}</div>`;

  let index = [];
  try {
    const res = await fetch(RECON_INDEX_URL);
    if (res.ok) index = await res.json();
  } catch (e) { /* empty index */ }

  if (index.length === 0) {
    container.innerHTML = `
      <div class="section empty-state">
        <div class="empty-state-icon">&#x1F4CB;</div>
        <div class="empty-state-title">${t('pages.recon.empty.no_reports', {}, 'No reconciliation reports yet')}</div>
        <div class="empty-state-desc">Place CRDB bank statements in <code>data/crdb_data/</code> and run<br>a reconciliation via Claude Code. Results will appear here.</div>
      </div>
    `;
    return;
  }

  const selectedId = container.getAttribute('data-recon-selected') || index[0].id;

  container.innerHTML = `
    <div class="report-toolbar mb-16">
      <label>Period</label>
      <select id="recon-select">
        ${index.map(r => `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''}>${r.label}</option>`).join('')}
      </select>
    </div>
    <div id="recon-detail"></div>
  `;

  document.getElementById('recon-select').addEventListener('change', (e) => {
    container.setAttribute('data-recon-selected', e.target.value);
    renderReconReports(container);
  });

  const selected = index.find(r => r.id === selectedId) || index[0];

  try {
    const res = await fetch('../data/crdb_data/' + selected.file);
    if (!res.ok) throw new Error('Not found');
    const md = await res.text();
    const html = renderMarkdown(md);
    document.getElementById('recon-detail').innerHTML = `<div class="section">${html}</div>`;
  } catch (e) {
    document.getElementById('recon-detail').innerHTML = `<div class="error">Could not load ${selected.file}</div>`;
  }
}

// ─── CRDB Auto-Import ───────────────────────────────────────────────────

let reconSuggestions = [];

async function renderReconImport(container) {
  container.innerHTML = `<div class="loading">${t('pages.recon.loading_bankfiles', {}, 'Loading bank files...')}</div>`;

  // Fetch available XLS files
  let files = [];
  try {
    const res = await fetch('/api/recon/files', { method: 'POST' });
    const data = await res.json();
    files = data.files || [];
  } catch (e) {
    container.innerHTML = '<div class="error">Could not load bank files. Is the server running?</div>';
    return;
  }

  if (files.length === 0) {
    container.innerHTML = `
      <div class="section">
        <div class="section-title">${t('pages.recon.empty.no_statements', {}, 'No bank statements found')}</div>
        <p class="hint-md">Place CRDB XLS files in <code>data/crdb_data/</code> to import unmatched transactions.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="report-toolbar mb-16">
      <label>Bank Statement</label>
      <select id="recon-file-select">
        ${files.map((f, i) => `<option value="${escapeHtml(f.name)}" ${i === 0 ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
      </select>
      <button class="btn-save" id="recon-scan-btn" style="padding:8px 16px;">${t('pages.recon.btn.scan_unmatched', {}, 'Scan for Unmatched')}</button>
    </div>
    <div id="recon-import-status"></div>
    <div id="recon-import-results"></div>
  `;

  document.getElementById('recon-scan-btn').addEventListener('click', () => {
    const filename = document.getElementById('recon-file-select').value;
    if (filename) scanForSuggestions(filename);
  });
}

async function scanForSuggestions(filename) {
  const statusEl = document.getElementById('recon-import-status');
  const resultsEl = document.getElementById('recon-import-results');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('pages.recon.spinner.scanning', {}, 'Scanning bank statement...')}</div>`;
  resultsEl.innerHTML = '';

  try {
    const res = await fetch('/api/recon/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
    const data = await res.json();
    if (data.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(data.error)}</div>`; return; }

    reconSuggestions = data.suggestions || [];
    const total = data.total_bank_rows || 0;
    const matched = data.matched || 0;

    statusEl.innerHTML = `
      <div class="income-grid mb-16">
        <div class="income-cell"><div class="ic-label">Bank Rows</div><div class="ic-value c-text">${total}</div></div>
        <div class="income-cell"><div class="ic-label">${t('pages.recon.label.already_booked', {}, 'Already Booked')}</div><div class="ic-value c-pos">${matched}</div></div>
        <div class="income-cell"><div class="ic-label">Unmatched</div><div class="ic-value ${reconSuggestions.length > 0 ? 'c-neg' : 'c-pos'}">${reconSuggestions.length}</div></div>
      </div>
    `;

    if (reconSuggestions.length === 0) {
      resultsEl.innerHTML = '<div class="section"><p class="hint-md">All bank transactions are already booked.</p></div>';
      return;
    }

    const rows = reconSuggestions.map((s, i) => {
      const confClass = s.match_confidence === 'high' ? 'c-pos' : s.match_confidence === 'medium' ? 'style="color:var(--warn)"' : 'c-neg';
      const confLabel = s.match_confidence === 'high' ? 'high' : s.match_confidence === 'medium' ? 'med' : 'none';
      return `<tr>
        <td><input type="checkbox" class="recon-row-check" data-idx="${i}" checked></td>
        <td>${fmtDate(s.date)}</td>
        <td class="fs-10 c-mut2" style="max-width:200px;white-space:normal;">${escapeHtml(s.bank_details)}</td>
        <td class="amt ${s.type}">${formatCurrency(s.amount, 'TZS')}</td>
        <td><input type="text" value="${escapeHtml(s.payee)}" data-field="payee" data-idx="${i}" class="fs-11" style="width:120px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);"></td>
        <td><input type="text" value="${escapeHtml(s.category)}" data-field="category" data-idx="${i}" class="fs-11" style="width:140px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);"></td>
        <td><span class="fs-10 ${confClass}">${confLabel}</span></td>
      </tr>`;
    }).join('');

    resultsEl.innerHTML = `
      <div class="section">
        <div class="section-title">Import Suggestions <span class="hint">${reconSuggestions.length} rows — edit payee/category, then book</span></div>
        <table class="tx-table">
          <thead><tr>
            <th><input type="checkbox" id="recon-select-all" checked></th>
            <th>Date</th><th>Bank Details</th><th class="amt">Amount</th><th>Payee</th><th>Category</th><th>Match</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="flex-row gap-sm mt-16">
          <button class="btn-save" id="recon-book-btn" style="padding:10px 24px;">${t('pages.recon.btn.book_selected', {}, 'Book Selected')}</button>
          <span class="hint-sm mt-8" id="recon-book-status"></span>
        </div>
      </div>
    `;

    // Wire inline edits back to reconSuggestions
    resultsEl.querySelectorAll('input[data-field]').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.getAttribute('data-idx'));
        const field = inp.getAttribute('data-field');
        if (reconSuggestions[idx]) reconSuggestions[idx][field] = inp.value;
      });
    });

  } catch (e) {
    statusEl.innerHTML = `<div class="atx-status error">${t('pages.recon.err.scan_failed', { err: escapeHtml(e.message) }, `Scan failed: ${escapeHtml(e.message)}`)}</div>`;
  }
}

async function bookReconSuggestions() {
  const statusEl = document.getElementById('recon-book-status');
  const checkboxes = document.querySelectorAll('.recon-row-check:checked');
  const indices = Array.from(checkboxes).map(c => parseInt(c.getAttribute('data-idx')));

  if (indices.length === 0) { statusEl.textContent = t('pages.recon.err.no_rows_selected', {}, 'No rows selected.'); return; }

  // Build TX lines from selected suggestions
  const lines = indices.map(i => {
    const s = reconSuggestions[i];
    return {
      date: s.date,
      account: 'crdb',
      type: s.type,
      amount: String(s.amount),
      currency: 'TZS',
      payee: s.payee || '(unknown)',
      category: s.category || '',
      note: 'CRDB import: ' + (s.bank_details || '').slice(0, 60),
      tags: '',
    };
  }).filter(l => l.payee && l.category); // skip incomplete

  if (lines.length === 0) {
    statusEl.textContent = t('pages.recon.err.fill_required', {}, 'Fill in payee and category for selected rows first.');
    return;
  }

  if (lines.length < indices.length) {
    const skipped = indices.length - lines.length;
    if (!confirm(t('pages.recon.confirm.skipped_rows', { skipped, count: lines.length }, `${skipped} row(s) have empty payee/category and will be skipped. Book ${lines.length} rows?`))) return;
  }

  statusEl.innerHTML = `<span class="atx-spinner"></span>${t('pages.recon.spinner.booking', {}, 'Booking...')}`;

  try {
    const res = await fetch('/api/tx/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines, raw_input: '(CRDB import)' }),
    });
    const data = await res.json();
    if (data.error) { statusEl.textContent = t('pages.recon.err.generic_prefix', { err: data.error }, `Error: ${data.error}`); return; }
    statusEl.innerHTML = `<span class="c-pos">${t('pages.recon.ok.booked', { count: lines.length, ids: data.import_ids.join(', ') }, `Booked ${lines.length} transactions. IDs: ${data.import_ids.join(', ')}`)}</span>`;
    // Reload data
    setTimeout(() => boot(), 500);
  } catch (e) {
    statusEl.textContent = t('pages.recon.err.booking_failed', { err: e.message }, `Booking failed: ${e.message}`);
  }
}

function renderMarkdown(md) {
  let html = '';
  const lines = md.split('\n');
  let inTable = false;
  let tableRows = [];

  function flushTable() {
    if (tableRows.length < 2) { inTable = false; tableRows = []; return; }
    const headers = tableRows[0];
    const dataRows = tableRows.slice(2); // skip separator
    html += '<table class="tx-table"><thead><tr>' +
      headers.map(h => `<th>${h.trim()}</th>`).join('') +
      '</tr></thead><tbody>';
    for (const row of dataRows) {
      html += '<tr>' + row.map(c => {
        const v = c.trim();
        const isNum = /^[\d.,\-]+\s*(TZS|EUR|USD)?$/.test(v) || v === '**0,00**' || v.startsWith('**');
        return `<td${isNum ? ' class="amt"' : ''}>${v.replace(/\*\*/g, '')}</td>`;
      }).join('') + '</tr>';
    }
    html += '</tbody></table>';
    inTable = false;
    tableRows = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.slice(1, -1).split('|');
      if (!inTable) inTable = true;
      tableRows.push(cells);
      continue;
    }
    if (inTable) flushTable();
    if (trimmed.startsWith('# ')) {
      html += `<div class="report-section-title" style="font-size:14px;margin:24px 0 12px;">${trimmed.slice(2)}</div>`;
    } else if (trimmed.startsWith('## ')) {
      html += `<div class="report-section-title" style="margin:20px 0 8px;">${trimmed.slice(3)}</div>`;
    } else if (trimmed.startsWith('### ')) {
      html += `<div style="font-size:11px;color:var(--muted-soft);margin:16px 0 6px;letter-spacing:0.04em;">${trimmed.slice(4)}</div>`;
    } else if (trimmed === '') {
      // skip
    } else {
      let t = trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code style="color:var(--accent-dim)">$1</code>');
      html += `<p style="font-size:12px;color:var(--muted-soft);margin:4px 0;line-height:1.6;">${t}</p>`;
    }
  }
  if (inTable) flushTable();
  return html;
}

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
      payeeLabel = `${tx.account} → ${tx.transfer_to_account || '?'}`;
    } else {
      payeeLabel = escapeHtml(tx.payee || '');
    }
    const rawCat = tx.category || '';
    const catOrType = tx.type === 'transfer' ? transferLabel : (rawCat ? `<span class="cat-link" data-cat="${escapeHtml(rawCat)}">${escapeHtml(rawCat)}</span>` : '');
    const typeClass = tx.type;
    const noteFull = tx.note || '';
    const noteShort = noteFull.length > 80 ? noteFull.slice(0, 79) + '…' : noteFull;
    const note = noteFull ? `<div class="tx-note" title="${escapeHtml(noteFull)}">${escapeHtml(noteShort)}</div>` : '';
    const fxTitle = t('tx.fx_converted_title', { date: tx.date }, `Converted using FX rate on ${tx.date} (fallback: month rate)`);
    return `
      <tr class="${isChecked ? 'row-selected' : ''}">
        <td class="td-chk"><input type="checkbox" class="tx-select" data-id="${escapeHtml(tx.import_id)}" ${isChecked ? 'checked' : ''}></td>
        <td>${fmtDate(tx.date)}</td>
        <td>${tx.account}</td>
        <td class="fs-10 c-mut2">${tx.type}</td>
        <td>${payeeLabel}${note}</td>
        <td class="cat">${catOrType}</td>
        <td>${tags}</td>
        <td class="amt ${typeClass}">${formatCurrency(tx.amount, tx.currency)}</td>
        <td class="hint-sm">${tx.currency}</td>
        <td class="amt c-mut2" title="${escapeHtml(fxTitle)}">${tx.currency === 'EUR' ? '' : formatCurrency(convertToEur(tx.amount, tx.currency, tx.date), 'EUR') + ' €'}</td>
        <td class="tx-actions"><button class="tx-edit-btn icon-btn" data-import-id="${escapeHtml(tx.import_id)}" title="${editLabel}" aria-label="${editLabel}">✎</button><button class="tx-edit-btn icon-btn" data-duplicate-id="${escapeHtml(tx.import_id)}" title="${duplicateLabel}" aria-label="${duplicateLabel}">⧉</button><button class="tx-edit-btn icon-btn btn-delete-sm" data-delete-id="${escapeHtml(tx.import_id)}" title="${deleteLabel}" aria-label="${deleteLabel}">✕</button></td>
      </tr>
    `;
  }).join('');

  const hasActiveFilters = txPage.filterType || txPage.filterAccount || txPage.filterCategory || txPage.filterTags.length > 0 || txPage.filterDateFrom || txPage.filterDateTo || txPage.filterAmountMin || txPage.filterAmountMax || txPage.filterPayee || txPage.filterUncategorized;

  // Count of uncategorized TX (both type and category empty), used in the
  // toggle label so Leon sees how much triage work is left at a glance.
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
      ${loadFilterPresets().length > 0 ? `<button id="txp-delete-preset" style="padding:4px 8px;font-size:10px;color:var(--muted);" title="${t('txp.delete_preset_title', {}, 'Delete selected preset')}">×</button>` : ''}
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
    contentEl.addEventListener('click', (e) => {
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
        const name = prompt('Preset name:');
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
        if (isNaN(idx)) { alert(t('pages.txbulk.alert.select_preset', {}, 'Select a preset first.')); return; }
        const presets = loadFilterPresets();
        if (confirm(t('pages.txbulk.confirm.delete_preset', { name: presets[idx]?.name }, `Delete preset "${presets[idx]?.name}"?`))) {
          presets.splice(idx, 1);
          saveFilterPresets(presets);
          renderTransactionsPage();
        }
        return;
      }
      // Bulk delete
      if (e.target.id === 'bulk-delete') {
        if (!confirm(t('pages.txbulk.confirm.delete_tx', { count: txPage.selected.size }, `Delete ${txPage.selected.size} transactions? This cannot be undone.`))) return;
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
    if (data.error) { alert(t('pages.txbulk.err.delete_failed', { err: data.error }, `Bulk delete failed: ${data.error}`)); return; }
    txPage.selected.clear();
    boot();
  } catch (e) {
    alert(t('pages.txbulk.err.delete_failed', { err: e.message }, `Bulk delete failed: ${e.message}`));
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
    if (!addTags.length && !removeTags.length) { alert(t('pages.txbulk.alert.no_tags', {}, 'Select at least one tag to add or remove.')); return; }
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
    html += `<div class="section" class="mb-24">
      <div class="section-title">Accounts (${matchedAccounts.length})</div>
      <table class="tx-table"><thead><tr><th>Alias</th><th>Name</th><th>Currency</th><th>Type</th><th>Balance</th></tr></thead><tbody>
      ${matchedAccounts.map(a => {
        const bal = state.balances[a.alias] || 0;
        return `<tr class="ptr" onclick="history.pushState(null,'','#account:${a.alias}');navigateTo('account:${a.alias}');">
          <td><strong>${escapeHtml(a.alias)}</strong></td>
          <td>${escapeHtml(a.name)}</td>
          <td>${a.currency}</td>
          <td>${a.type}</td>
          <td class="amt" class="fw-500">${formatCurrency(bal, a.currency)} ${a.currency}</td>
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
    html += `<div class="section" class="mb-24">
      <div class="section-title">Debts (${matchedDebts.length})</div>
      <table class="tx-table"><thead><tr><th>Person</th><th>Direction</th><th>Original</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>
      ${matchedDebts.map(d => {
        const isOwed = d.type === 'owed_to_me';
        const color = isOwed ? 'var(--positive)' : 'var(--negative)';
        const settled = String(d.settled) === 'true';
        return `<tr style="cursor:pointer;${settled ? 'opacity:0.5;' : ''}" onclick="history.pushState(null,'','#debts');navigateTo('debts');">
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
        const accLink = `<a href="#account:${escapeHtml(t.account)}" onclick="event.preventDefault();event.stopPropagation();history.pushState(null,'','#account:${escapeHtml(t.account)}');navigateTo('account:${escapeHtml(t.account)}');" style="color:var(--accent);text-decoration:none;border-bottom:1px dashed var(--border);">${escapeHtml(t.account || '')}</a>`;
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

// ─── Alerts Page ─────────────────────────────────────────────────────────

async function computeAlerts() {
  const alerts = [];
  const today = new Date().toISOString().slice(0, 10);

  // 1. Overdue Scheduled TX
  try {
    const res = await fetch('/api/scheduled/list', { method: 'POST' });
    if (res.ok) {
      // API returns { scheduled: [...] }; tolerate a bare array for safety.
      const data = await res.json();
      const scheduled = Array.isArray(data) ? data : (data && data.scheduled) || [];
      scheduled.forEach(s => {
        if (s.active === true || s.active === 'true') {
          if (s.next_run && s.next_run <= today) {
            alerts.push({
              type: 'scheduled',
              severity: 'warning',
              title: 'Overdue Scheduled TX: ' + (s.name || s.sched_id),
              detail: `Due since ${s.next_run} — ${s.payee || ''} ${formatCurrency(s.amount, s.currency)}`,
              link: '#settings'
            });
          }
        }
      });
    }
  } catch (e) { /* API not available */ }

  // 2. Negative Balances
  if (state.accounts && state.balances) {
    state.accounts.forEach(acc => {
      if (acc.owner === 'self' && acc.status === 'active' && acc.type !== 'credit_card') {
        const bal = state.balances[acc.alias];
        if (bal !== undefined && (bal < -0.01 || (acc.type === 'pass_through' && Math.abs(bal) > 0.01))) {
          alerts.push({
            type: 'balance',
            severity: 'warning',
            title: 'Negative Balance: ' + (acc.name || acc.alias),
            detail: `${formatCurrency(bal, acc.currency)} ${acc.currency}`,
            link: '#account:' + acc.alias
          });
        }
      }
    });
  }

  // 3. Old Open Debts (> 30 days)
  if (state.thirdParty) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);
    state.thirdParty.forEach(d => {
      const settled = d.settled === true || d.settled === 'true' || d.settled === 'TRUE';
      if (!settled && d.date_created && d.date_created <= cutoff) {
        alerts.push({
          type: 'debt',
          severity: 'info',
          title: 'Open Debt > 30 days: ' + (d.party || d.description || d.id),
          detail: `Created ${d.date_created} — ${formatCurrency(d.amount_original || d.amount, d.currency)}`,
          link: '#debts'
        });
      }
    });
  }

  // 4. High Monthly Spending (current month > 150% of avg last 3 months)
  if (state.tx.length && state.accounts) {
    const now = new Date();
    const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const selfAliases = new Set(state.accounts.filter(a => a.owner === 'self').map(a => a.alias));

    const selfExpenses = state.tx.filter(t => t.type === 'expense' && selfAliases.has(t.account));

    // Get monthly totals for last 4 months (current + 3 prior)
    const monthTotals = {};
    selfExpenses.forEach(t => {
      const ym = (t.date || '').slice(0, 7);
      if (!ym) return;
      // Convert to TZS for comparison
      let amt = parseFloat(t.amount) || 0;
      const rate = fxRates[t.currency] || 1;
      amt *= rate;
      monthTotals[ym] = (monthTotals[ym] || 0) + amt;
    });

    const curTotal = monthTotals[curYM] || 0;
    // Get 3 months before current
    const priorMonths = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (monthTotals[ym] !== undefined) priorMonths.push(monthTotals[ym]);
    }
    if (priorMonths.length >= 2 && curTotal > 0) {
      const avg = priorMonths.reduce((a, b) => a + b, 0) / priorMonths.length;
      if (avg > 0 && curTotal > avg * 1.5) {
        const pct = Math.round((curTotal / avg) * 100);
        alerts.push({
          type: 'spending',
          severity: 'warning',
          title: 'High Monthly Spending',
          detail: `Current month is ${pct}% of the ${priorMonths.length}-month average (${formatCurrency(curTotal, 'TZS')} vs avg ${formatCurrency(Math.round(avg), 'TZS')})`,
          link: '#reports'
        });
      }
    }
  }

  state.alerts = alerts;
  updateAlertsBadge();
}

function updateAlertsBadge() {
  const badge = document.getElementById('alerts-badge');
  const badgeTopbar = document.getElementById('alerts-badge-topbar');
  const count = state.alerts.length;
  if (badgeTopbar) {
    badgeTopbar.style.display = count > 0 ? 'inline-block' : 'none';
  }
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
  }
}

function renderAlertsPage() {
  const contentEl = document.getElementById('alerts-content');
  const alerts = state.alerts || [];

  if (alerts.length === 0) {
    contentEl.innerHTML = `
      <div class="section empty-state">
        <div class="empty-state-icon">&#x2705;</div>
        <div class="empty-state-title">All clear</div>
        <div class="empty-state-desc">${t('pages.alerts.empty', {}, 'No alerts or warnings right now.')}</div>
      </div>
    `;
    return;
  }

  // Group by severity: warning first, then info
  const warnings = alerts.filter(a => a.severity === 'warning');
  const infos = alerts.filter(a => a.severity === 'info');

  let html = '';
  const renderGroup = (items, label) => {
    if (items.length === 0) return '';
    const borderColor = items[0].severity === 'warning' ? 'var(--warn)' : 'var(--accent)';
    let h = `<div class="section"><h3>${label}</h3>`;
    items.forEach(a => {
      h += `
        <div class="alert-card" data-link="${escapeHtml(a.link || '')}" style="display:flex;gap:0;margin-bottom:8px;border-radius:var(--radius);overflow:hidden;background:var(--surface);cursor:pointer;border:1px solid var(--border);transition:border-color 0.15s;">
          <div style="width:4px;min-height:100%;background:${borderColor};flex-shrink:0;"></div>
          <div style="padding:12px 16px;flex:1;">
            <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${escapeHtml(a.title)}</div>
            <div class="hint-md">${escapeHtml(a.detail)}</div>
          </div>
        </div>
      `;
    });
    h += '</div>';
    return h;
  };

  html += renderGroup(warnings, 'Warnings');
  html += renderGroup(infos, 'Info');
  contentEl.innerHTML = html;

  // Event delegation for alert cards
  if (!contentEl._delegated) {
    contentEl.addEventListener('click', (e) => {
      const card = e.target.closest('.alert-card[data-link]');
      if (card) location.hash = card.getAttribute('data-link');
    });
    contentEl._delegated = true;
  }

  document.getElementById('alerts-meta').textContent = `${alerts.length} alert${alerts.length !== 1 ? 's' : ''}`;
}

// ── Custom Reports ────────────────────────────────────────────────────────
// Phase B: list page (renderCustomReportsPage).
// Phase C: builder (renderCustomReportsBuilder) for new/edit. Sub-routes
// #custom-reports/new and #custom-reports/edit/<id> route through
// dispatchCustomReportsRoute, called from core.js navigateTo.
// The runner (#custom-reports/view/<id>) is stubbed for Phase D.

let customReportsCache = [];        // server-side list, alphabetically sorted
let customReportsContext = null;     // { tags: [...], payees: [...] } from /api/tx/context
let customReportsBuilderDef = null;  // working draft in the builder
let customReportsBuilderOriginalId = null;  // null when creating new

function dispatchCustomReportsRoute(pageId) {
  // pageId is e.g. 'custom-reports', 'custom-reports/new',
  // 'custom-reports/edit/cr_xxx', 'custom-reports/view/cr_xxx'
  const parts = pageId.split('/').slice(1);  // drop 'custom-reports'
  const action = parts[0] || 'list';
  const id = parts[1] || null;

  if (action === 'new') return renderCustomReportsBuilder(null);
  if (action === 'edit' && id) return renderCustomReportsBuilder(id);
  if (action === 'view' && id) return renderCustomReportRun(id);
  return renderCustomReportsPage();
}

async function renderCustomReportsPage() {
  const contentEl = document.getElementById('custom-reports-content');
  const metaEl = document.getElementById('custom-reports-meta');
  contentEl.innerHTML = `<div class="section"><div class="hint-md">${t('pages.custom.list.loading', {}, 'Loading…')}</div></div>`;

  try {
    const res = await fetch('/api/custom-reports/list', { method: 'POST', body: '{}' });
    const data = await res.json();
    customReportsCache = (data.reports || []).slice().sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
  } catch (e) {
    contentEl.innerHTML = `<div class="section"><div class="hint-md" style="color:var(--negative);">${t('pages.custom.list.err.load', { err: escapeHtml(String(e)) }, `Failed to load custom reports: ${escapeHtml(String(e))}`)}</div></div>`;
    return;
  }

  metaEl.textContent = `${customReportsCache.length} custom report${customReportsCache.length !== 1 ? 's' : ''}`;

  const headerHtml = `
    <div class="section" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <div class="hint-md">Build reports with custom filters across categories, tags, accounts, and payees. Saved reports also appear on the Reports page.</div>
      <button id="cr-new-btn" class="btn-primary" style="white-space:nowrap;">${t('pages.custom.list.btn_new', {}, '+ New Custom Report')}</button>
    </div>
  `;

  let cardsHtml = '';
  if (customReportsCache.length === 0) {
    cardsHtml = `
      <div class="section empty-state">
        <div class="empty-state-icon">&#x1F4CA;</div>
        <div class="empty-state-title">${t('pages.custom.list.empty', {}, 'No custom reports yet')}</div>
        <div class="empty-state-desc">${t('pages.custom.list.empty_hint', {}, 'Click "+ New Custom Report" to create your first one.')}</div>
      </div>
    `;
  } else {
    cardsHtml = `
      <div class="report-category">
        <div class="report-category-label">Saved Reports</div>
        <div class="report-cards">
          ${customReportsCache.map(r => renderCustomReportCard(r)).join('')}
        </div>
      </div>
    `;
  }

  contentEl.innerHTML = headerHtml + cardsHtml;

  // Event delegation registered once per content element
  if (!contentEl._crDelegated) {
    contentEl.addEventListener('click', handleCustomReportsClick);
    contentEl._crDelegated = true;
  }
}

function renderCustomReportCard(r) {
  const desc = r.description || `Match ${r.match_mode || 'AND'} • ${describeFilterSummary(r)}`;
  return `
    <div class="report-card" data-cr-id="${escapeHtml(r.id)}" style="display:flex;flex-direction:column;gap:8px;">
      <div class="rc-title">${escapeHtml(r.name)}</div>
      <div class="rc-desc">${escapeHtml(desc)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;">
        <button class="btn-secondary" data-cr-action="open" data-cr-id="${escapeHtml(r.id)}">${t('pages.custom.card.open', {}, 'Open')}</button>
        <button class="btn-secondary" data-cr-action="edit" data-cr-id="${escapeHtml(r.id)}">${t('pages.actions.title.edit', {}, 'Edit')}</button>
        <button class="btn-secondary" data-cr-action="duplicate" data-cr-id="${escapeHtml(r.id)}">${t('pages.actions.title.duplicate', {}, 'Duplicate')}</button>
        <button class="btn-secondary" data-cr-action="delete" data-cr-id="${escapeHtml(r.id)}" style="color:var(--negative);">${t('pages.actions.title.delete', {}, 'Delete')}</button>
      </div>
    </div>
  `;
}

function describeFilterSummary(r) {
  const parts = [];
  const f = r.filters || {};
  for (const key of ['categories', 'tags', 'accounts', 'payees']) {
    const block = f[key] || {};
    const n = (block.values || []).length;
    if (n > 0) {
      const verb = block.mode === 'exclude' ? 'excl.' : '';
      parts.push(`${n} ${key}${verb ? ' ' + verb : ''}`);
    }
  }
  return parts.length ? parts.join(' • ') : 'no filters';
}

async function handleCustomReportsClick(e) {
  if (e.target.closest('#cr-new-btn')) {
    location.hash = '#custom-reports/new';
    return;
  }

  const actionBtn = e.target.closest('[data-cr-action]');
  if (!actionBtn) return;
  const action = actionBtn.getAttribute('data-cr-action');
  const id = actionBtn.getAttribute('data-cr-id');
  if (!id) return;

  if (action === 'open') {
    location.hash = '#custom-reports/view/' + id;
    return;
  }
  if (action === 'edit') {
    location.hash = '#custom-reports/edit/' + id;
    return;
  }
  if (action === 'duplicate') {
    await duplicateCustomReport(id);
    return;
  }
  if (action === 'delete') {
    const r = customReportsCache.find(x => x.id === id);
    if (!r) return;
    if (!confirm(t('pages.custom.confirm.delete', { name: r.name }, `Delete custom report "${r.name}"?`))) return;
    await deleteCustomReport(id);
    return;
  }
}

async function duplicateCustomReport(id) {
  try {
    const res = await fetch('/api/custom-reports/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) { alert(t('pages.custom.err.duplicate_failed', { err: data.error || res.status }, `Duplicate failed: ${data.error || res.status}`)); return; }
    await renderCustomReportsPage();
  } catch (e) {
    alert(t('pages.custom.err.duplicate_failed', { err: String(e) }, `Duplicate failed: ${e}`));
  }
}

async function deleteCustomReport(id) {
  try {
    const res = await fetch('/api/custom-reports/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) { alert(t('pages.custom.err.delete_failed', { err: data.error || res.status }, `Delete failed: ${data.error || res.status}`)); return; }
    await renderCustomReportsPage();
  } catch (e) {
    alert(t('pages.custom.err.delete_failed', { err: String(e) }, `Delete failed: ${e}`));
  }
}

// ── Builder ─────────────────────────────────────────────────────────────

function emptyCustomReportDef() {
  return {
    name: '',
    description: '',
    match_mode: 'AND',
    exclude_operational_noise: true,
    filters: {
      categories: { mode: 'include', values: [] },
      tags:       { mode: 'include', values: [] },
      accounts:   { mode: 'include', values: [] },
      payees:     { mode: 'include', values: [] },
    },
    period: { default_view: 'monthly', default_preset: 'current', custom_range: null },
    widgets: {
      pie:   { enabled: false, dimension: 'category' },
      top_n: { enabled: false, dimension: 'payee', n: 10 },
    },
  };
}

async function ensureCustomReportsContext() {
  // Cache tags + payees lookup for the builder; refreshes only if missing.
  if (customReportsContext) return customReportsContext;
  const res = await fetch('/api/tx/context', { method: 'POST' });
  const data = await res.json();
  customReportsContext = {
    tags: (data.tags || []).filter(t => t.active !== false).map(t => t.tag || t).filter(Boolean),
    payees: (data.payees || []).map(p => p.payee || p).filter(Boolean).sort((a, b) => a.localeCompare(b)),
  };
  return customReportsContext;
}

async function renderCustomReportsBuilder(reportId) {
  const contentEl = document.getElementById('custom-reports-content');
  const metaEl = document.getElementById('custom-reports-meta');
  metaEl.textContent = reportId ? t('pages.custom.builder.title_edit', {}, 'Editing report') : t('pages.custom.builder.title_new', {}, 'New report');
  contentEl.innerHTML = `<div class="section"><div class="hint-md">${t('pages.custom.builder.loading', {}, 'Loading…')}</div></div>`;

  try {
    await ensureCustomReportsContext();
  } catch (e) {
    contentEl.innerHTML = `<div class="section"><div class="hint-md" style="color:var(--negative);">${t('pages.custom.builder.err.refdata', { err: escapeHtml(String(e)) }, `Failed to load reference data: ${escapeHtml(String(e))}`)}</div></div>`;
    return;
  }

  if (reportId) {
    // Load existing report for editing — may need a fresh list fetch
    if (!customReportsCache.length) {
      const res = await fetch('/api/custom-reports/list', { method: 'POST', body: '{}' });
      const data = await res.json();
      customReportsCache = data.reports || [];
    }
    const existing = customReportsCache.find(r => r.id === reportId);
    if (!existing) {
      contentEl.innerHTML = `<div class="section"><div class="hint-md" style="color:var(--negative);">${t('pages.custom.runner.err.not_found', {}, 'Report not found.')}</div></div>`;
      return;
    }
    customReportsBuilderDef = JSON.parse(JSON.stringify(existing));  // deep clone
    customReportsBuilderOriginalId = reportId;
  } else {
    customReportsBuilderDef = emptyCustomReportDef();
    customReportsBuilderOriginalId = null;
  }

  contentEl.innerHTML = renderBuilderHtml();
  attachBuilderHandlers();
  refreshBuilderMatchCounter();
}

function renderBuilderHtml() {
  const def = customReportsBuilderDef;
  const ctx = customReportsContext || { tags: [], payees: [] };
  const accounts = (state.accounts || []).filter(a => a.status !== 'archived');
  const categories = (state.categories || []).filter(c => c.active === 'true' || c.active === true);

  // Build tree groups for categories: top-level path tokens (before colon).
  const catGroups = {};
  for (const c of categories) {
    const path = c.path || '';
    const top = path.split(':')[0];
    if (!catGroups[top]) catGroups[top] = [];
    catGroups[top].push(path);
  }
  const sortedGroups = Object.keys(catGroups).sort();

  const isEdit = !!customReportsBuilderOriginalId;

  return `
    <div class="section" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn-secondary" id="cr-builder-back">&larr; Back to list</button>
        <strong style="font-size:15px;">${isEdit ? t('pages.custom.builder.heading_edit', {}, 'Edit Custom Report') : t('pages.custom.builder.heading_new', {}, 'New Custom Report')}</strong>
      </div>
      <div style="display:flex;gap:12px;align-items:center;">
        <span class="hint-md">Matches: <strong id="cr-match-count" style="color:var(--accent);">…</strong> tx</span>
        <button class="btn-secondary" id="cr-builder-cancel">${t('common.actions.cancel', {}, 'Cancel')}</button>
        <button class="btn-primary"   id="cr-builder-save">${isEdit ? t('pages.custom.builder.btn.save_edit', {}, 'Save changes') : t('pages.custom.builder.btn.save_new', {}, 'Create report')}</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Basics</div>
      <div style="display:grid;grid-template-columns:120px 1fr;gap:8px 12px;align-items:center;">
        <label for="cr-f-name">Name</label>
        <input type="text" id="cr-f-name" value="${escapeHtml(def.name)}" placeholder="e.g. Bills without Internet"
               style="padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:13px;">
        <label for="cr-f-desc">Description</label>
        <input type="text" id="cr-f-desc" value="${escapeHtml(def.description || '')}" placeholder="optional"
               style="padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:13px;">
        <label>Match mode</label>
        <div style="display:flex;gap:14px;">
          <label style="display:flex;gap:4px;align-items:center;cursor:pointer;">
            <input type="radio" name="cr-f-match" value="AND" ${def.match_mode === 'AND' ? 'checked' : ''}> AND (all blocks)
          </label>
          <label style="display:flex;gap:4px;align-items:center;cursor:pointer;">
            <input type="radio" name="cr-f-match" value="OR" ${def.match_mode === 'OR' ? 'checked' : ''}> OR (any block)
          </label>
        </div>
        <label>Operational only</label>
        <div style="display:flex;gap:14px;align-items:center;">
          <label style="display:flex;gap:4px;align-items:center;cursor:pointer;">
            <input type="checkbox" id="cr-f-opnoise" ${def.exclude_operational_noise !== false ? 'checked' : ''}>
            Exclude custody accounts and transfers/reimbursements
          </label>
          <span class="hint-sm" style="font-size:10px;color:var(--text-muted);">Matches Fixed Reports behavior. Uncheck to audit custody flows.</span>
        </div>
      </div>
    </div>

    ${renderFilterBlock('categories', 'Categories', renderCategoriesTreeHtml(sortedGroups, catGroups))}
    ${renderFilterBlock('tags',       'Tags',       renderChipsHtml('tags', ctx.tags))}
    ${renderFilterBlock('accounts',   'Accounts',   renderAccountsHtml(accounts))}
    ${renderFilterBlock('payees',     'Payees',     renderPayeesHtml(ctx.payees))}

    <div class="section">
      <div class="section-title">Period</div>
      <div style="display:grid;grid-template-columns:120px 1fr;gap:8px 12px;align-items:center;">
        <label>Default view</label>
        <div style="display:flex;gap:14px;">
          <label style="display:flex;gap:4px;align-items:center;cursor:pointer;">
            <input type="radio" name="cr-f-view" value="monthly" ${def.period.default_view === 'monthly' ? 'checked' : ''}> Monthly
          </label>
          <label style="display:flex;gap:4px;align-items:center;cursor:pointer;">
            <input type="radio" name="cr-f-view" value="yearly" ${def.period.default_view === 'yearly' ? 'checked' : ''}> Yearly
          </label>
        </div>
        <label for="cr-f-preset">Default preset</label>
        <select id="cr-f-preset" style="padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:13px;max-width:240px;">
          <option value="current" ${def.period.default_preset === 'current' ? 'selected' : ''}>Current period</option>
          <option value="ytd"     ${def.period.default_preset === 'ytd'     ? 'selected' : ''}>Year to date</option>
          <option value="last12"  ${def.period.default_preset === 'last12'  ? 'selected' : ''}>Last 12 months</option>
          <option value="all"     ${def.period.default_preset === 'all'     ? 'selected' : ''}>All time</option>
          <option value="custom"  ${def.period.default_preset === 'custom'  ? 'selected' : ''}>Custom range</option>
        </select>
        <div id="cr-f-range-row" style="display:${def.period.default_preset === 'custom' ? 'contents' : 'none'};">
          <label>Custom range</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="date" id="cr-f-range-from" value="${(def.period.custom_range && def.period.custom_range.from) || ''}"
                   style="padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:12px;">
            <span class="hint-md">to</span>
            <input type="date" id="cr-f-range-to" value="${(def.period.custom_range && def.period.custom_range.to) || ''}"
                   style="padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:12px;">
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Widgets</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
          <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
            <input type="checkbox" id="cr-f-pie-on" ${def.widgets.pie.enabled ? 'checked' : ''}> Pie breakdown
          </label>
          <label style="display:flex;gap:4px;align-items:center;">
            Dimension:
            <select id="cr-f-pie-dim" style="padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:12px;">
              <option value="category" ${def.widgets.pie.dimension === 'category' ? 'selected' : ''}>by Category</option>
              <option value="payee"    ${def.widgets.pie.dimension === 'payee'    ? 'selected' : ''}>by Payee</option>
              <option value="account"  ${def.widgets.pie.dimension === 'account'  ? 'selected' : ''}>by Account</option>
              <option value="tag"      ${def.widgets.pie.dimension === 'tag'      ? 'selected' : ''}>by Tag</option>
            </select>
          </label>
        </div>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
          <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
            <input type="checkbox" id="cr-f-topn-on" ${def.widgets.top_n.enabled ? 'checked' : ''}> Top-N list
          </label>
          <label style="display:flex;gap:4px;align-items:center;">
            Dimension:
            <select id="cr-f-topn-dim" style="padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:12px;">
              <option value="payee"    ${def.widgets.top_n.dimension === 'payee'    ? 'selected' : ''}>Payees</option>
              <option value="category" ${def.widgets.top_n.dimension === 'category' ? 'selected' : ''}>Categories</option>
              <option value="account"  ${def.widgets.top_n.dimension === 'account'  ? 'selected' : ''}>Accounts</option>
              <option value="tag"      ${def.widgets.top_n.dimension === 'tag'      ? 'selected' : ''}>Tags</option>
            </select>
          </label>
          <label style="display:flex;gap:4px;align-items:center;">
            N:
            <input type="number" id="cr-f-topn-n" min="3" max="50" value="${def.widgets.top_n.n || 10}"
                   style="width:60px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:12px;">
          </label>
        </div>
      </div>
    </div>
  `;
}

function renderFilterBlock(key, label, innerHtml) {
  const block = customReportsBuilderDef.filters[key];
  const count = (block.values || []).length;
  return `
    <div class="section" data-cr-block="${key}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
        <div class="section-title" style="margin:0;">${label} <span class="hint-md" style="font-weight:normal;">(${count} selected)</span></div>
        <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;">
          <button data-cr-mode="${key}|include" class="cr-mode-btn ${block.mode === 'include' ? 'active' : ''}"
                  style="padding:4px 10px;font-size:11px;background:${block.mode === 'include' ? 'var(--accent)' : 'transparent'};color:${block.mode === 'include' ? '#fff' : 'var(--text)'};border:0;cursor:pointer;">Include</button>
          <button data-cr-mode="${key}|exclude" class="cr-mode-btn ${block.mode === 'exclude' ? 'active' : ''}"
                  style="padding:4px 10px;font-size:11px;background:${block.mode === 'exclude' ? 'var(--negative)' : 'transparent'};color:${block.mode === 'exclude' ? '#fff' : 'var(--text)'};border:0;cursor:pointer;">Exclude</button>
        </div>
      </div>
      ${innerHtml}
    </div>
  `;
}

function renderCategoriesTreeHtml(sortedGroups, catGroups) {
  const selected = new Set(customReportsBuilderDef.filters.categories.values);
  let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px 18px;max-height:340px;overflow-y:auto;padding:4px 2px;">';
  for (const top of sortedGroups) {
    const children = catGroups[top].slice().sort();
    // The "top" pseudo-entry gets no checkbox if a same-named real category
    // exists (it's already in children); otherwise it's a header only.
    const topAsCategory = children.includes(top);
    const realChildren = children.filter(p => p !== top);
    const groupHeader = topAsCategory
      ? `<label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-weight:600;">
           <input type="checkbox" data-cr-cat="${escapeHtml(top)}" ${selected.has(top) ? 'checked' : ''}> ${escapeHtml(top)}
         </label>`
      : `<div style="font-weight:600;font-size:12px;color:var(--muted);">${escapeHtml(top)}</div>`;

    html += `<div data-cr-cat-group="${escapeHtml(top)}" style="display:flex;flex-direction:column;gap:4px;">`;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
               ${groupHeader}
               <button data-cr-cat-toggle="${escapeHtml(top)}" class="btn-secondary" style="font-size:10px;padding:2px 6px;">all</button>
             </div>`;
    for (const path of realChildren) {
      html += `<label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-size:12px;padding-left:14px;">
        <input type="checkbox" data-cr-cat="${escapeHtml(path)}" ${selected.has(path) ? 'checked' : ''}>
        ${escapeHtml(path.replace(top + ':', ''))}
      </label>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderChipsHtml(key, items) {
  // Generic chip selector for tags. Click chip to toggle.
  const selected = new Set(customReportsBuilderDef.filters[key].values);
  if (items.length === 0) {
    return `<div class="hint-md">${t('pages.custom.builder.empty.no_items', { category: key }, `No ${key} available.`)}</div>`;
  }
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;">` +
    items.map(item => {
      const on = selected.has(item);
      return `<button data-cr-chip="${key}|${escapeHtml(item)}"
        style="padding:4px 10px;border-radius:999px;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : 'transparent'};color:${on ? '#fff' : 'var(--text)'};font-size:11px;cursor:pointer;">${escapeHtml(item)}</button>`;
    }).join('') + '</div>';
}

function renderAccountsHtml(accounts) {
  // Group by owner type for clarity
  const groups = {
    'Self':    accounts.filter(a => a.owner === 'self' && a.type !== 'pass_through'),
    'Pass-through': accounts.filter(a => a.type === 'pass_through'),
    'Custody': accounts.filter(a => a.owner !== 'self' && a.type !== 'pass_through'),
  };
  const selected = new Set(customReportsBuilderDef.filters.accounts.values);
  let html = '';
  for (const [label, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    html += `<div style="margin-bottom:8px;">`;
    html += `<div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:4px;">${label}</div>`;
    html += `<div style="display:flex;flex-wrap:wrap;gap:6px;">`;
    for (const a of items) {
      const on = selected.has(a.alias);
      html += `<button data-cr-chip="accounts|${escapeHtml(a.alias)}"
        title="${escapeHtml(a.name)}"
        style="padding:4px 10px;border-radius:999px;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : 'transparent'};color:${on ? '#fff' : 'var(--text)'};font-size:11px;cursor:pointer;">${escapeHtml(a.alias)}</button>`;
    }
    html += `</div></div>`;
  }
  return html || `<div class="hint-md">${t('pages.custom.builder.empty.no_accounts', {}, 'No accounts available.')}</div>`;
}

function renderPayeesHtml(payees) {
  const selected = customReportsBuilderDef.filters.payees.values;
  return `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <input type="text" id="cr-f-payee-search" placeholder="${escapeHtml(t('pages.custom.builder.search_payees', {}, 'Search payees…'))}"
             style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:12px;">
      <div id="cr-f-payee-list" style="max-height:200px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:6px;padding:4px 2px;">
        ${renderPayeeChips(payees, '')}
      </div>
      <div id="cr-f-payee-selected" style="display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid var(--border);padding-top:6px;${selected.length ? '' : 'display:none;'}">
        ${selected.map(p => `<span style="padding:3px 8px;border-radius:999px;background:var(--accent);color:#fff;font-size:11px;display:inline-flex;align-items:center;gap:4px;">${escapeHtml(p)}<button data-cr-chip="payees|${escapeHtml(p)}" style="background:transparent;border:0;color:#fff;cursor:pointer;font-weight:bold;line-height:1;">×</button></span>`).join('')}
      </div>
    </div>
  `;
}

function renderPayeeChips(payees, query) {
  const selected = new Set(customReportsBuilderDef.filters.payees.values);
  const q = (query || '').toLowerCase().trim();
  const filtered = q ? payees.filter(p => p.toLowerCase().includes(q)) : payees;
  if (filtered.length === 0) return `<div class="hint-md">${t('pages.custom.builder.empty.no_matches', {}, 'No matches.')}</div>`;
  return filtered.slice(0, 80).map(p => {
    const on = selected.has(p);
    return `<button data-cr-chip="payees|${escapeHtml(p)}"
      style="padding:3px 8px;border-radius:999px;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : 'transparent'};color:${on ? '#fff' : 'var(--text)'};font-size:11px;cursor:pointer;">${escapeHtml(p)}</button>`;
  }).join('');
}

function attachBuilderHandlers() {
  const root = document.getElementById('custom-reports-content');
  if (!root || root._crBuilderDelegated) return;
  root.addEventListener('click', onBuilderClick);
  root.addEventListener('change', onBuilderChange);
  root.addEventListener('input',  onBuilderInput);
  root._crBuilderDelegated = true;
}

function onBuilderClick(e) {
  // Back / Cancel / Save
  if (e.target.closest('#cr-builder-back')) { location.hash = '#custom-reports'; return; }
  if (e.target.closest('#cr-builder-cancel')) {
    if (!confirm(t('pages.custom.builder.confirm.discard', {}, 'Discard changes?'))) return;
    location.hash = '#custom-reports'; return;
  }
  if (e.target.closest('#cr-builder-save')) { saveBuilderDraft(); return; }

  // Mode toggle (include/exclude)
  const modeBtn = e.target.closest('[data-cr-mode]');
  if (modeBtn) {
    const [key, mode] = modeBtn.getAttribute('data-cr-mode').split('|');
    customReportsBuilderDef.filters[key].mode = mode;
    rerenderBuilder();
    return;
  }

  // Chip toggle (tags / accounts / payees)
  const chip = e.target.closest('[data-cr-chip]');
  if (chip) {
    const [key, value] = chip.getAttribute('data-cr-chip').split('|');
    const arr = customReportsBuilderDef.filters[key].values;
    const idx = arr.indexOf(value);
    if (idx === -1) arr.push(value); else arr.splice(idx, 1);
    rerenderBuilder();
    return;
  }

  // "all" button next to a category group → toggle every child path
  const catToggle = e.target.closest('[data-cr-cat-toggle]');
  if (catToggle) {
    const top = catToggle.getAttribute('data-cr-cat-toggle');
    const root = document.getElementById('custom-reports-content');
    const checkboxes = root.querySelectorAll(`[data-cr-cat-group="${cssEscape(top)}"] input[type="checkbox"][data-cr-cat]`);
    const allOn = [...checkboxes].every(cb => cb.checked);
    const newState = !allOn;
    const arr = customReportsBuilderDef.filters.categories.values;
    checkboxes.forEach(cb => {
      const path = cb.getAttribute('data-cr-cat');
      const idx = arr.indexOf(path);
      if (newState && idx === -1) arr.push(path);
      if (!newState && idx !== -1) arr.splice(idx, 1);
    });
    rerenderBuilder();
    return;
  }
}

function onBuilderChange(e) {
  const t = e.target;
  // Category checkbox
  if (t.matches('input[type="checkbox"][data-cr-cat]')) {
    const path = t.getAttribute('data-cr-cat');
    const arr = customReportsBuilderDef.filters.categories.values;
    const idx = arr.indexOf(path);
    if (t.checked && idx === -1) arr.push(path);
    if (!t.checked && idx !== -1) arr.splice(idx, 1);
    rerenderBuilder();
    return;
  }
  if (t.name === 'cr-f-match') { customReportsBuilderDef.match_mode = t.value; refreshBuilderMatchCounter(); return; }
  if (t.id === 'cr-f-opnoise') { customReportsBuilderDef.exclude_operational_noise = t.checked; refreshBuilderMatchCounter(); return; }
  if (t.name === 'cr-f-view')  { customReportsBuilderDef.period.default_view = t.value; return; }
  if (t.id === 'cr-f-preset')  {
    customReportsBuilderDef.period.default_preset = t.value;
    document.getElementById('cr-f-range-row').style.display = t.value === 'custom' ? 'contents' : 'none';
    return;
  }
  if (t.id === 'cr-f-range-from' || t.id === 'cr-f-range-to') {
    if (!customReportsBuilderDef.period.custom_range) customReportsBuilderDef.period.custom_range = {};
    if (t.id === 'cr-f-range-from') customReportsBuilderDef.period.custom_range.from = t.value;
    if (t.id === 'cr-f-range-to')   customReportsBuilderDef.period.custom_range.to   = t.value;
    return;
  }
  if (t.id === 'cr-f-pie-on')   { customReportsBuilderDef.widgets.pie.enabled = t.checked; return; }
  if (t.id === 'cr-f-pie-dim')  { customReportsBuilderDef.widgets.pie.dimension = t.value; return; }
  if (t.id === 'cr-f-topn-on')  { customReportsBuilderDef.widgets.top_n.enabled = t.checked; return; }
  if (t.id === 'cr-f-topn-dim') { customReportsBuilderDef.widgets.top_n.dimension = t.value; return; }
  if (t.id === 'cr-f-topn-n')   { customReportsBuilderDef.widgets.top_n.n = parseInt(t.value, 10) || 10; return; }
}

function onBuilderInput(e) {
  const t = e.target;
  if (t.id === 'cr-f-name') { customReportsBuilderDef.name = t.value; return; }
  if (t.id === 'cr-f-desc') { customReportsBuilderDef.description = t.value; return; }
  if (t.id === 'cr-f-payee-search') {
    const list = document.getElementById('cr-f-payee-list');
    if (list) list.innerHTML = renderPayeeChips(customReportsContext.payees, t.value);
    return;
  }
}

function rerenderBuilder() {
  // Re-render the whole shell (cheap; lets us update counts + chip states).
  // Keeps the search-input value if present.
  const searchEl = document.getElementById('cr-f-payee-search');
  const searchVal = searchEl ? searchEl.value : '';
  const contentEl = document.getElementById('custom-reports-content');
  contentEl.innerHTML = renderBuilderHtml();
  if (searchVal) {
    const newSearch = document.getElementById('cr-f-payee-search');
    if (newSearch) {
      newSearch.value = searchVal;
      const list = document.getElementById('cr-f-payee-list');
      if (list) list.innerHTML = renderPayeeChips(customReportsContext.payees, searchVal);
    }
  }
  refreshBuilderMatchCounter();
}

function refreshBuilderMatchCounter() {
  const el = document.getElementById('cr-match-count');
  if (!el) return;
  if (!state.tx || !state.tx.length) { el.textContent = '–'; return; }
  try {
    const n = getFilteredTxCount(customReportsBuilderDef, state.tx);
    el.textContent = n.toLocaleString(getLocaleTag());
  } catch (e) {
    el.textContent = '?';
  }
}

async function saveBuilderDraft() {
  const def = customReportsBuilderDef;
  if (!def.name || !def.name.trim()) { alert(t('pages.custom.builder.err.name_required', {}, 'Name is required.')); return; }
  if (def.period.default_preset === 'custom') {
    const r = def.period.custom_range || {};
    if (!r.from || !r.to) { alert(t('pages.custom.builder.err.custom_range', {}, 'Custom date range needs both From and To.')); return; }
  }

  const isEdit = !!customReportsBuilderOriginalId;
  const url  = isEdit ? '/api/custom-reports/update' : '/api/custom-reports/add';
  const body = isEdit ? { id: customReportsBuilderOriginalId, updated: def } : def;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { alert(t('pages.custom.builder.err.save_failed', { err: data.error || res.status }, `Save failed: ${data.error || res.status}`)); return; }
    customReportsCache = [];  // force refresh on next list view
    location.hash = '#custom-reports';
  } catch (e) {
    alert(t('pages.custom.builder.err.save_failed', { err: String(e) }, `Save failed: ${e}`));
  }
}

// Minimal CSS-escape helper for attribute selectors (handles spaces, colons).
function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
}

// ── Runner ──────────────────────────────────────────────────────────────

let customReportsRunState = {};   // per-report ephemeral overrides (view/preset)
let customReportsRunCharts = [];  // Chart.js instances for cleanup

function destroyCustomReportCharts() {
  for (const c of customReportsRunCharts) { try { c.destroy(); } catch {} }
  customReportsRunCharts = [];
}

async function renderCustomReportRun(id) {
  const contentEl = document.getElementById('custom-reports-content');
  const metaEl = document.getElementById('custom-reports-meta');
  contentEl.innerHTML = `<div class="section"><div class="hint-md">${t('pages.custom.runner.loading', {}, 'Loading…')}</div></div>`;
  destroyCustomReportCharts();

  // Make sure we have the report list
  if (!customReportsCache.length) {
    try {
      const res = await fetch('/api/custom-reports/list', { method: 'POST', body: '{}' });
      const data = await res.json();
      customReportsCache = data.reports || [];
    } catch (e) {
      contentEl.innerHTML = `<div class="section"><div class="hint-md" style="color:var(--negative);">${t('pages.custom.runner.err.load', { err: escapeHtml(String(e)) }, `Failed to load reports: ${escapeHtml(String(e))}`)}</div></div>`;
      return;
    }
  }
  const report = customReportsCache.find(r => r.id === id);
  if (!report) {
    contentEl.innerHTML = `<div class="section"><div class="hint-md" style="color:var(--negative);">${t('pages.custom.runner.err.not_found', {}, 'Report not found.')}</div></div>`;
    return;
  }
  metaEl.textContent = report.name;

  // Initialize per-session overrides from saved defaults if not present
  if (!customReportsRunState[id]) {
    customReportsRunState[id] = {
      view:   report.period.default_view   || 'monthly',
      preset: report.period.default_preset || 'current',
    };
  }
  const runState = customReportsRunState[id];

  contentEl.innerHTML = renderCustomReportRunHtml(report, runState);
  attachCustomReportRunHandlers(report, runState);
  drawCustomReportContent(report, runState);
}

function renderCustomReportRunHtml(report, runState) {
  // Static shell — toolbars + named slots that drawCustomReportContent populates.
  return `
    <div class="section" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn-secondary" id="cr-run-back">&larr; Back</button>
        <strong style="font-size:15px;">${escapeHtml(report.name)}</strong>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <button class="btn-secondary" id="cr-run-edit" title="${t('pages.custom.runner.title.edit_tooltip', {}, 'Edit this report')}">${t('pages.actions.title.edit', {}, 'Edit')}</button>
        <select id="cr-run-view" style="padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:12px;">
          <option value="monthly" ${runState.view === 'monthly' ? 'selected' : ''}>Monthly</option>
          <option value="yearly"  ${runState.view === 'yearly'  ? 'selected' : ''}>Yearly</option>
        </select>
        <select id="cr-run-preset" style="padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:12px;">
          <option value="current" ${runState.preset === 'current' ? 'selected' : ''}>Current year</option>
          <option value="ytd"     ${runState.preset === 'ytd'     ? 'selected' : ''}>Year to date</option>
          <option value="last12"  ${runState.preset === 'last12'  ? 'selected' : ''}>Last 12 months</option>
          <option value="all"     ${runState.preset === 'all'     ? 'selected' : ''}>All time</option>
          <option value="custom"  ${runState.preset === 'custom'  ? 'selected' : ''}>Custom range</option>
        </select>
      </div>
    </div>

    ${report.description ? `<div class="section" style="padding:10px 14px;"><div class="hint-md">${escapeHtml(report.description)}</div></div>` : ''}

    <div id="cr-run-kpi"></div>
    <div id="cr-run-chart"></div>
    <div id="cr-run-pie"></div>
    <div id="cr-run-topn"></div>
    <div id="cr-run-list"></div>
  `;
}

function attachCustomReportRunHandlers(report, runState) {
  document.getElementById('cr-run-back').addEventListener('click', () => {
    location.hash = '#custom-reports';
  });
  document.getElementById('cr-run-edit').addEventListener('click', () => {
    location.hash = '#custom-reports/edit/' + report.id;
  });
  document.getElementById('cr-run-view').addEventListener('change', (e) => {
    runState.view = e.target.value;
    drawCustomReportContent(report, runState);
  });
  document.getElementById('cr-run-preset').addEventListener('change', (e) => {
    runState.preset = e.target.value;
    drawCustomReportContent(report, runState);
  });
}

function drawCustomReportContent(report, runState) {
  destroyCustomReportCharts();
  const cur = (typeof displayCurrency !== 'undefined' && displayCurrency) || 'TZS';

  // 1. Filter by report definition
  const allTx = state.tx || [];
  const filteredTx = applyCustomReportFilters(report, allTx);

  // 2. Apply period window
  const window = computePeriodWindow(runState.preset, report.period.custom_range);
  const periodTx = filterByDateRange(filteredTx, window.from, window.to);

  // 3. Convert each TX amount to display currency for aggregations
  const converted = periodTx.map(t => ({
    ...t,
    amount: convertTo(parseFloat(t.amount) || 0, t.currency || 'TZS', cur),
  }));

  drawCustomReportKpi(converted, cur, window);
  drawCustomReportChart(converted, runState.view, cur);
  if (report.widgets.pie && report.widgets.pie.enabled) {
    drawCustomReportPie(converted, report.widgets.pie.dimension, cur);
  } else {
    document.getElementById('cr-run-pie').innerHTML = '';
  }
  if (report.widgets.top_n && report.widgets.top_n.enabled) {
    drawCustomReportTopN(converted, report.widgets.top_n.dimension, report.widgets.top_n.n || 10, cur);
  } else {
    document.getElementById('cr-run-topn').innerHTML = '';
  }
  drawCustomReportList(converted, cur);
}

function drawCustomReportKpi(tx, cur, window) {
  let income = 0, expense = 0;
  for (const t of tx) {
    if (t.type === 'income')       income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  const net = income - expense;
  const rangeLbl = (window.from || window.to)
    ? `${window.from || '…'} → ${window.to || '…'}`
    : 'all time';
  document.getElementById('cr-run-kpi').innerHTML = `
    <div class="report-section">
      <div class="report-section-title">Summary — ${rangeLbl}</div>
      <div class="income-grid">
        <div class="income-cell">
          <div class="ic-label">Income</div>
          <div class="ic-value" style="color:var(--positive);">${formatCurrency(income, cur)}<span class="ic-cur">${cur}</span></div>
          <div class="ic-count">${tx.filter(t => t.type === 'income').length} TX</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">Expense</div>
          <div class="ic-value" style="color:var(--negative);">${formatCurrency(expense, cur)}<span class="ic-cur">${cur}</span></div>
          <div class="ic-count">${tx.filter(t => t.type === 'expense').length} TX</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">Net</div>
          <div class="ic-value" style="color:${net >= 0 ? 'var(--positive)' : 'var(--negative)'};">${formatCurrency(net, cur)}<span class="ic-cur">${cur}</span></div>
          <div class="ic-count">${tx.length} TX total</div>
        </div>
      </div>
    </div>
  `;
}

function drawCustomReportChart(tx, view, cur) {
  const buckets = aggregateByPeriod(tx, view);
  const labels = [...buckets.keys()];
  if (labels.length === 0) {
    document.getElementById('cr-run-chart').innerHTML = `
      <div class="report-section"><div class="hint-md" style="padding:12px;">${t('pages.custom.runner.empty.no_tx', {}, 'No transactions in this period.')}</div></div>
    `;
    return;
  }
  document.getElementById('cr-run-chart').innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${view === 'monthly' ? 'Monthly' : 'Yearly'} breakdown — ${cur}</div>
      <div style="position:relative;height:280px;"><canvas id="cr-run-chart-canvas"></canvas></div>
    </div>
  `;
  const incomeData  = labels.map(k => buckets.get(k).income);
  const expenseData = labels.map(k => buckets.get(k).expense);
  const ctx = document.getElementById('cr-run-chart-canvas');
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: view === 'monthly' ? labels.map(k => monthLabel(k)) : labels,
      datasets: [
        { label: t('pages.custom.runner.dataset.income', {}, 'Income'),  data: incomeData,  backgroundColor: 'rgba(34,197,94,0.7)' },
        { label: t('pages.custom.runner.dataset.expense', {}, 'Expense'), data: expenseData, backgroundColor: 'rgba(239,68,68,0.7)' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatCurrency(c.parsed.y, cur)} ${cur}` } },
      },
      scales: {
        x: { stacked: false },
        y: { beginAtZero: true, ticks: { callback: (v) => formatCurrency(v, cur) } },
      },
    },
  });
  customReportsRunCharts.push(chart);
}

function drawCustomReportPie(tx, dimension, cur) {
  const data = aggregateByDimension(tx, dimension).slice(0, 12);  // cap for legibility
  if (data.length === 0) { document.getElementById('cr-run-pie').innerHTML = ''; return; }
  document.getElementById('cr-run-pie').innerHTML = `
    <div class="report-section">
      <div class="report-section-title">Expense breakdown by ${dimension}</div>
      <div style="position:relative;height:280px;"><canvas id="cr-run-pie-canvas"></canvas></div>
    </div>
  `;
  const palette = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#14b8a6','#a855f7','#6b7280'];
  const ctx = document.getElementById('cr-run-pie-canvas');
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.label),
      datasets: [{ data: data.map(d => d.value), backgroundColor: palette.slice(0, data.length) }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${formatCurrency(c.parsed, cur)} ${cur}` } },
      },
    },
  });
  customReportsRunCharts.push(chart);
}

function drawCustomReportTopN(tx, dimension, n, cur) {
  const data = aggregateTopN(tx, dimension, n);
  if (data.length === 0) { document.getElementById('cr-run-topn').innerHTML = ''; return; }
  const total = data.reduce((s, d) => s + d.value, 0);
  document.getElementById('cr-run-topn').innerHTML = `
    <div class="report-section">
      <div class="report-section-title">Top ${data.length} ${dimension}s by expense</div>
      <table class="tx-table">
        <thead><tr><th>#</th><th>${dimension[0].toUpperCase() + dimension.slice(1)}</th><th style="text-align:right;">Amount</th><th style="text-align:right;">Share</th></tr></thead>
        <tbody>
          ${data.map((d, i) => `<tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(d.label)}</td>
            <td style="text-align:right;">${formatCurrency(d.value, cur)} ${cur}</td>
            <td style="text-align:right;">${total > 0 ? ((d.value / total) * 100).toFixed(1) : '0.0'}%</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function drawCustomReportList(tx, cur) {
  const sorted = tx.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const limit = 100;
  const shown = sorted.slice(0, limit);
  const more = sorted.length - shown.length;
  document.getElementById('cr-run-list').innerHTML = `
    <div class="report-section">
      <div class="report-section-title">Transactions (${sorted.length})${more > 0 ? ` — showing first ${limit}` : ''}</div>
      <table class="tx-table">
        <thead><tr><th>Date</th><th>Type</th><th>Account</th><th>Payee</th><th>Category</th><th style="text-align:right;">Amount</th><th>Tags</th></tr></thead>
        <tbody>
          ${shown.map(t => `<tr>
            <td>${escapeHtml(t.date || '')}</td>
            <td>${escapeHtml(t.type || '')}</td>
            <td>${escapeHtml(t.account || '')}</td>
            <td>${escapeHtml(t.payee || '')}</td>
            <td>${escapeHtml(t.category || '')}</td>
            <td style="text-align:right;color:${t.type === 'income' ? 'var(--positive)' : t.type === 'expense' ? 'var(--negative)' : 'var(--text)'};">${formatCurrency(t.amount, cur)} ${cur}</td>
            <td>${escapeHtml(t.tags || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

