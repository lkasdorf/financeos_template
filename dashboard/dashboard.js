// ─── Rendering ─────────────────────────────────────────────────────────────
// state declared in core.js

// Render dashboard sections. scope: null=full rebuild, 'month'=month+charts only
function render(scope) {
  const dash = document.getElementById('dashboard');
  const full = !scope;

  if (full) {
    // Destroy charts before replacing their canvas elements
    if (catChart) { catChart.destroy(); catChart = null; }
    if (cashflowChart) { cashflowChart.destroy(); cashflowChart = null; }
    dash.innerHTML = `
      <div id="dash-nw">${renderNetWorth()}</div>
      <div id="dash-forecast"></div>
      <div id="dash-goals">${renderSavingsGoals()}</div>
      <div id="dash-budgets">${renderBudgetTracker()}</div>
      <div id="dash-ds">${renderDebtSummary()}</div>
      <div id="dash-sched">${renderScheduledPreview()}</div>
      <div id="dash-acc">${renderAccounts()}</div>
      <div id="dash-month">${renderMonthSection()}</div>
      <div id="dash-charts">${renderChartsSection()}</div>
      <div id="dash-recent">${renderRecentTx()}</div>
    `;
    initCharts();
    wireMonthNav();
    return;
  }

  if (scope === 'month') {
    // Only update month-dependent sections, keep charts alive
    document.getElementById('dash-month').innerHTML = renderMonthSection();
    const budgetsEl = document.getElementById('dash-budgets');
    if (budgetsEl) budgetsEl.innerHTML = renderBudgetTracker();
    wireMonthNav();
    updateChartData();
  }
}

async function loadMonthForecast() {
  const container = document.getElementById('dash-forecast');
  if (!container) return;

  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth(); // 0-indexed
  const today = now.getDate();
  const daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
  const daysLeft = daysInMonth - today;
  const ym = `${curYear}-${String(curMonth + 1).padStart(2, '0')}`;
  const cur = displayCurrency !== 'TZS' ? displayCurrency : 'TZS';

  // Current month actuals so far
  let incomeActual = 0, expenseActual = 0;
  for (const t of state.tx) {
    if (!t.date || !t.date.startsWith(ym)) continue;
    const amt = toDisplay(t.amount, t.currency);
    if (t.type === 'income') incomeActual += amt;
    else if (t.type === 'expense') expenseActual += amt;
  }

  // Average daily expense from the month so far
  const avgDailyExp = today > 0 ? expenseActual / today : 0;
  const projectedExp = expenseActual + avgDailyExp * daysLeft;

  // Scheduled TX remaining this month
  let schedIncome = 0, schedExpense = 0;
  try {
    const res = await fetch('/api/scheduled/list', { method: 'POST' });
    if (res.ok) {
      // API returns { scheduled: [...] }; tolerate a bare array for safety.
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data && data.scheduled) || [];
      for (const s of items) {
        if (s.active !== true && s.active !== 'true') continue;
        if (!s.next_run || !s.next_run.startsWith(ym)) continue;
        if (s.next_run <= now.toISOString().slice(0, 10)) continue; // already due/booked
        const amt = toDisplay(parseFloat(s.amount) || 0, s.currency || 'TZS');
        // Scheduled TX on pass-through accounts generate expense + income
        const acc = state.accounts.find(a => a.alias === s.account);
        if (acc && acc.type === 'pass_through') {
          schedExpense += amt;
          schedIncome += amt;
        } else {
          schedExpense += amt; // assume expense by default
        }
      }
    }
  } catch (e) { /* no scheduled data */ }

  // 6-month average monthly income (for projecting salary + reimbursements)
  let avgMonthlyIncome = 0;
  const avgMonths = 6;
  const monthlyIncTotals = [];
  for (let i = 1; i <= avgMonths; i++) {
    const d = new Date(curYear, curMonth - i, 1);
    const prevYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let mInc = 0;
    for (const t of state.tx) {
      if (t.type !== 'income' || !t.date || !t.date.startsWith(prevYm)) continue;
      mInc += toDisplay(t.amount, t.currency);
    }
    if (mInc > 0) monthlyIncTotals.push(mInc);
  }
  if (monthlyIncTotals.length > 0) {
    avgMonthlyIncome = monthlyIncTotals.reduce((s, v) => s + v, 0) / monthlyIncTotals.length;
  }

  // Projected income: use 6-month average as expectation, or actual if already higher
  const expectedRemaining = Math.max(0, avgMonthlyIncome - incomeActual) + schedIncome;
  const projectedInc = incomeActual + expectedRemaining;

  const totalProjExp = projectedExp + schedExpense;
  const finalNet = projectedInc - totalProjExp;

  container.innerHTML = `
    <section class="section">
      <div class="section-title">${t('dashboard.forecast.title', {}, 'Month Forecast')} <span class="hint">${monthLabel(ym)} · ${t('dashboard.forecast.days_left', { n: daysLeft }, `${daysLeft} days left`)} · ${cur}</span></div>
      <div class="income-grid" style="grid-template-columns:repeat(auto-fill, minmax(150px, 1fr));">
        <div class="income-cell">
          <div class="ic-label">${t('dashboard.forecast.income_actual', {}, 'Income (actual)')}</div>
          <div class="ic-value">${formatCurrency(incomeActual, cur)}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('dashboard.forecast.expenses_actual', {}, 'Expenses (actual)')}</div>
          <div class="ic-value c-neg">${formatCurrency(expenseActual, cur)}</div>
          <div class="ic-count">${t('dashboard.forecast.day_avg', { amount: formatCurrency(avgDailyExp, cur) }, `${formatCurrency(avgDailyExp, cur)}/day avg`)}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('dashboard.forecast.projected_income', {}, 'Projected Income')}</div>
          <div class="ic-value">${formatCurrency(projectedInc, cur)}</div>
          <div class="ic-count">${schedIncome > 0
            ? t('dashboard.forecast.based_on_avg_with_sched', { n: monthlyIncTotals.length, sched: formatCurrency(schedIncome, cur) }, `based on ${monthlyIncTotals.length}-month avg + ${formatCurrency(schedIncome, cur)} sched.`)
            : t('dashboard.forecast.based_on_avg', { n: monthlyIncTotals.length }, `based on ${monthlyIncTotals.length}-month avg`)}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('dashboard.forecast.projected_expenses', {}, 'Projected Expenses')}</div>
          <div class="ic-value c-neg">${formatCurrency(totalProjExp, cur)}</div>
          <div class="ic-count">${schedExpense > 0
            ? t('dashboard.forecast.pace_with_sched', { sched: formatCurrency(schedExpense, cur) }, `pace + ${formatCurrency(schedExpense, cur)} scheduled`)
            : t('dashboard.forecast.pace_no_sched', {}, 'pace + no scheduled')}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('dashboard.forecast.projected_net', {}, 'Projected Net')}</div>
          <div class="ic-value" style="color:${finalNet >= 0 ? 'var(--positive)' : 'var(--negative)'};">${finalNet >= 0 ? '+' : ''}${formatCurrency(finalNet, cur)}</div>
          <div class="ic-count">${t('dashboard.forecast.end_of_month', { month: monthLabel(ym) }, `end of ${monthLabel(ym)}`)}</div>
        </div>
      </div>
    </section>
  `;
}

function renderScheduledPreview() {
  // Returns a placeholder; actual content loaded async after boot
  return `<div id="dash-sched-inner"></div>`;
}

async function loadScheduledPreview() {
  const container = document.getElementById('dash-sched-inner');
  if (!container) return;

  let items = [];
  try {
    const res = await fetch('/api/scheduled/list', { method: 'POST' });
    if (res.ok) {
      // API returns { scheduled: [...] }; tolerate a bare array for safety.
      const data = await res.json();
      items = Array.isArray(data) ? data : (data && data.scheduled) || [];
    }
  } catch (e) { return; }

  const active = (items || []).filter(s => s.active === true || s.active === 'true');
  if (active.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const overdue = active.filter(s => s.next_run && s.next_run <= today);
  const upcoming = active.filter(s => s.next_run && s.next_run > today && s.next_run <= nextWeek);

  if (overdue.length === 0 && upcoming.length === 0) return;

  const renderItem = (s, isOverdue) => {
    const color = isOverdue ? 'var(--negative)' : 'var(--muted-soft)';
    const dateLabel = isOverdue
      ? t('dashboard.upcoming.overdue_since', { date: fmtDate(s.next_run) }, `overdue since ${fmtDate(s.next_run)}`)
      : fmtDate(s.next_run);
    return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-soft);">
      <div style="flex:1;">
        <div class="fs-13">${escapeHtml(s.name || s.payee || s.sched_id)}</div>
        <div class="hint-sm">${escapeHtml(s.account || '')} · ${escapeHtml(s.category || '')}</div>
      </div>
      <div class="amt" style="color:${color};font-size:13px;font-variant-numeric:tabular-nums;">${formatCurrency(parseFloat(s.amount) || 0, s.currency || 'TZS')}<span class="hint-sm" style="margin-left:4px;">${s.currency || 'TZS'}</span></div>
      <div class="hint-sm" style="color:${color};min-width:90px;text-align:right;">${dateLabel}</div>
    </div>`;
  };

  // Render the "Run due now" CTA only when at least one entry is overdue.
  // The button opens a modal with the full TX preview from the API.
  const runDueBtn = overdue.length > 0
    ? `<button id="dash-sched-run-due" class="btn-primary" style="margin-left:auto;font-size:12px;padding:4px 10px;">${t('dashboard.upcoming.run_due', { n: overdue.length }, `Run ${overdue.length} due now`)}</button>`
    : '';

  container.innerHTML = `
    <section class="section">
      <div class="section-title" style="display:flex;align-items:center;gap:8px;">
        <span>${t('dashboard.upcoming.title', {}, 'Upcoming Payments')}</span>
        <span class="hint">${overdue.length > 0
          ? t('dashboard.upcoming.overdue_count', { n: overdue.length }, `${overdue.length} overdue`)
          : t('dashboard.upcoming.next_week', {}, 'next 7 days')}</span>
        ${runDueBtn}
      </div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;box-shadow:var(--shadow);">
        ${overdue.map(s => renderItem(s, true)).join('')}
        ${upcoming.map(s => renderItem(s, false)).join('')}
      </div>
    </section>
  `;

  const cta = document.getElementById('dash-sched-run-due');
  if (cta) cta.addEventListener('click', () => openSchedRunDueModal());
}

// ── Run Due Scheduled — modal with full TX preview + per-row checkboxes ──
//
// Two-step flow: POST /api/scheduled/preview-due → render rows with
// checkboxes → user selects which to book → POST /api/scheduled/run-due
// with selected_ids. The preview includes pass-through counter-lines so
// the user sees the full set of TXs that would land in transactions.csv.
async function openSchedRunDueModal() {
  let preview;
  try {
    const res = await fetch('/api/scheduled/preview-due', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    preview = await res.json();
  } catch (e) {
    const msg = t('sched.preview.error', { msg: e.message }, `Could not load preview: ${e.message}`);
    if (window.uiAlert) uiAlert(msg, { type: 'error' }); else alert(msg);
    return;
  }

  if (!preview.entries || preview.entries.length === 0) {
    const msg = t('sched.preview.none', {}, 'No scheduled transactions are due today.');
    if (window.uiAlert) uiAlert(msg, { type: 'info' });
    return;
  }

  const rowHtml = preview.entries.map((e) => {
    const p = e.primary;
    const pt = e.pass_through;
    const direction = p.type === 'income' ? '+' : '-';
    const ptHtml = pt
      ? `<div class="hint-sm" style="margin-top:4px;color:var(--muted-soft);">↳ ${t('sched.modal.auto_reimbursement', {}, 'auto reimbursement')}: + ${escapeHtml(pt.amount)} ${escapeHtml(pt.currency)} | ${escapeHtml(pt.payee)} | ${escapeHtml(pt.category)}</div>`
      : '';
    return `<label style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-soft);cursor:pointer;">
      <input type="checkbox" class="sched-run-due-row" data-sched-id="${escapeHtml(e.sched_id)}" checked style="margin-top:4px;flex-shrink:0;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;">${escapeHtml(e.name)} <span class="hint-sm" style="font-weight:400;">(${escapeHtml(e.frequency || '')})</span></div>
        <div class="hint-sm" style="margin-top:2px;">${direction} ${escapeHtml(p.amount)} ${escapeHtml(p.currency)} | ${escapeHtml(p.payee)} | ${escapeHtml(p.category)} | ${escapeHtml(p.account)}</div>
        ${ptHtml}
        <div class="hint-sm" style="margin-top:2px;color:var(--muted-soft);">${t('sched.modal.next_run_after', { date: e.next_run_after }, `next run after booking: ${e.next_run_after}`)}</div>
      </div>
    </label>`;
  }).join('');

  const warningsHtml = (preview.warnings && preview.warnings.length)
    ? `<div style="background:var(--warning-bg, #fff3cd);color:var(--warning-fg, #664d03);border:1px solid var(--warning-border, #ffe69c);border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:12px;">${preview.warnings.map(w => `⚠ ${escapeHtml(w)}`).join('<br>')}</div>`
    : '';

  const body = `
    ${warningsHtml}
    <p class="hint" style="margin:0 0 12px;">${t('sched.modal.intro', { date: preview.today, n: preview.entries.length }, `${preview.entries.length} scheduled entries are due as of ${preview.today}. Uncheck any you want to skip — selected entries will be booked atomically with a single git commit.`)}</p>
    <div style="max-height:50vh;overflow-y:auto;border-top:1px solid var(--border-soft);">${rowHtml}</div>
  `;

  // Build the modal using the project's inline-overlay pattern (matches
  // pages-debts.js / forms-edit-tx.js). closeModal() is the global helper
  // from forms-edit-tx.js — it removes the overlay element.
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  overlay.innerHTML = `
    <div class="modal" style="max-width:760px;">
      <h3>${t('sched.modal.title', {}, 'Run Due Scheduled Transactions')}</h3>
      ${body}
      <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
        <button id="sched-run-due-cancel" class="btn-secondary">${t('common.cancel', {}, 'Cancel')}</button>
        <button id="sched-run-due-confirm" class="btn-primary">${t('sched.modal.confirm', {}, 'Book selected')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Esc key closes the modal — matches the pattern in forms-edit-tx.js.
  const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', escHandler);
  overlay._escHandler = escHandler;

  const cancelBtn = overlay.querySelector('#sched-run-due-cancel');
  const confirmBtn = overlay.querySelector('#sched-run-due-confirm');
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal());
  if (confirmBtn) confirmBtn.addEventListener('click', async () => {
    const selected = Array.from(overlay.querySelectorAll('.sched-run-due-row:checked'))
      .map(cb => cb.getAttribute('data-sched-id'));
    if (selected.length === 0) {
      const msg = t('sched.modal.none_selected', {}, 'Select at least one entry, or cancel.');
      if (window.uiAlert) uiAlert(msg, { type: 'warning' });
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = t('sched.modal.booking', {}, 'Booking…');
    try {
      const res = await fetch('/api/scheduled/run-due', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_ids: selected }),
      });
      const summary = await res.json();
      if (!res.ok && res.status !== 207) throw new Error(summary.error || `HTTP ${res.status}`);
      closeModal();
      const msg = summary.commit_ok
        ? t('sched.modal.success', { n: summary.booked }, `Booked ${summary.booked} scheduled transaction(s).`)
        : t('sched.modal.partial', { n: summary.booked }, `Booked ${summary.booked} TX(s) but git commit failed — check logs.`);
      if (window.uiAlert) uiAlert(msg, { type: summary.commit_ok ? 'info' : 'warning' });
      // Refresh the dashboard so the upcoming-payments widget updates and
      // any new TXs appear in recent-transactions and balance summaries.
      if (typeof boot === 'function') boot();
    } catch (e) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = t('sched.modal.confirm', {}, 'Book selected');
      const msg = t('sched.modal.error', { msg: e.message }, `Booking failed: ${e.message}`);
      if (window.uiAlert) uiAlert(msg, { type: 'error' });
    }
  });
}

async function renderDebtsPage() {
  const content = document.getElementById('debts-content');
  if (!content) return;

  // Reload from API if available, fallback to state
  let all = state.thirdParty || [];
  try {
    const res = await fetch('/api/debts/list', { method: 'POST' });
    const data = await res.json();
    if (data.debts) {
      for (const d of data.debts) {
        d.amount = parseFloat(d.amount) || 0;
        d.original_amount = parseFloat(d.original_amount) || d.amount;
      }
      all = data.debts;
      state.thirdParty = all;
    }
  } catch (e) { /* use state fallback */ }

  const open = all.filter(tp => tp.settled !== 'true');
  const settled = all.filter(tp => tp.settled === 'true');
  const cur = displayCurrency !== 'TZS' ? displayCurrency : 'TZS';

  // Summary
  let totalOwed = 0, totalOwe = 0;
  for (const tp of open) {
    const amt = convertTo(tp.amount, tp.currency, cur);
    if (tp.type === 'owed_to_me') totalOwed += amt;
    else totalOwe += amt;
  }

  const renderRow = (tp, isSettled) => {
    const isOwed = tp.type === 'owed_to_me';
    const color = isOwed ? 'var(--positive)' : 'var(--negative)';
    const label = isOwed ? 'owes you' : 'you owe';
    const showAmt = convertTo(tp.amount, tp.currency, cur);
    const showOrig = convertTo(tp.original_amount, tp.currency, cur);
    const nativeHint = tp.currency !== cur ? `<span style="color:var(--muted);font-size:9px;margin-left:4px;">(${formatCurrency(tp.amount, tp.currency)} ${tp.currency})</span>` : '';
    const progress = tp.original_amount > 0 ? ((tp.original_amount - tp.amount) / tp.original_amount * 100).toFixed(0) : 0;
    const progressBar = !isSettled && tp.original_amount !== tp.amount
      ? `<div style="margin-top:4px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;width:80px;"><div style="height:100%;width:${progress}%;background:${color};border-radius:2px;"></div></div>`
      : '';
    const actions = isSettled ? '' : `
      <button class="tx-edit-btn c-acc" data-action="showPayDebtModal" data-arg1="${tp.id}" title="Record payment">Pay</button>
      <button class="tx-edit-btn" data-action="showDebtHistory" data-arg1="${tp.id}" title="Payment history">History</button>
      <button class="tx-edit-btn" data-action="showDebtModal" data-arg1="${tp.id}" title="Edit">Edit</button>
      <button class="tx-edit-btn c-neg" data-action="deleteDebt" data-arg1="${tp.id}" title="Delete">Delete</button>
    `;
    const nativeOrigHint = tp.currency !== cur ? `<div class="label-xs">${formatCurrency(tp.original_amount, tp.currency)} ${tp.currency}</div>` : '';
    const nativeOutHint = tp.currency !== cur ? `<div class="label-xs">${formatCurrency(tp.amount, tp.currency)} ${tp.currency}</div>` : '';
    const settledLabel = isSettled ? `<div class="label-xs">settled ${tp.date_settled ? fmtDate(tp.date_settled) : ''}</div>` : '';
    return `<tr${isSettled ? ' class="op-50"' : ''}>
      <td><strong>${escapeHtml(tp.person_name)}</strong></td>
      <td style="color:${color};font-size:11px;">${label}</td>
      <td class="amt" style="color:var(--muted-soft);">
        ${formatCurrency(showOrig, cur)}<span class="acc-currency">${cur}</span>
        ${nativeOrigHint}
      </td>
      <td class="amt" style="color:${color};font-weight:500;">
        ${isSettled ? '<span class="c-pos">0</span>' : `${formatCurrency(showAmt, cur)}<span class="acc-currency">${cur}</span>`}
        ${nativeOutHint}
        ${settledLabel}
        ${progressBar}
      </td>
      <td class="hint-sm">${fmtDate(tp.date_created)}</td>
      <td style="font-size:10px;color:var(--muted);max-width:200px;white-space:normal;">${escapeHtml(tp.note || '')}</td>
      <td>${actions}</td>
    </tr>`;
  };

  let html = `
    <div class="flex-row gap-md mb-20">
      <button class="btn-save" data-action="showDebtModal" style="padding:8px 16px;font-size:11px;">+ Add Debt</button>
    </div>
    <div class="income-grid mb-20">
      <div class="income-cell">
        <div class="ic-label">Owed to You</div>
        <div class="ic-value c-pos">${formatCurrency(totalOwed, cur)}<span class="ic-cur">${cur}</span></div>
        <div class="ic-count">${open.filter(tp => tp.type === 'owed_to_me').length} open</div>
      </div>
      <div class="income-cell">
        <div class="ic-label">You Owe</div>
        <div class="ic-value c-neg">${formatCurrency(totalOwe, cur)}<span class="ic-cur">${cur}</span></div>
        <div class="ic-count">${open.filter(tp => tp.type === 'owed_by_me').length} open</div>
      </div>
      <div class="income-cell">
        <div class="ic-label">Net</div>
        <div class="ic-value" style="color:${totalOwed - totalOwe >= 0 ? 'var(--positive)' : 'var(--negative)'}">${totalOwed - totalOwe >= 0 ? '+' : '-'}${formatCurrency(Math.abs(totalOwed - totalOwe), cur)}<span class="ic-cur">${cur}</span></div>
      </div>
    </div>
  `;

  if (open.length > 0) {
    html += `
      <div class="section mb-24">
        <div class="section-title">Open</div>
        <table class="tx-table"><thead><tr><th>Person</th><th>Direction</th><th class="amt">Original</th><th class="amt">Outstanding</th><th>Since</th><th>Note</th><th></th></tr></thead>
        <tbody>${open.map(tp => renderRow(tp, false)).join('')}</tbody></table>
      </div>
    `;
  }

  if (settled.length > 0) {
    html += `
      <div class="section">
        <div class="section-title c-mut">Settled</div>
        <table class="tx-table"><thead><tr><th>Person</th><th>Direction</th><th class="amt">Original</th><th class="amt">Outstanding</th><th>Since</th><th>Note</th><th></th></tr></thead>
        <tbody>${settled.map(tp => renderRow(tp, true)).join('')}</tbody></table>
      </div>
    `;
  }

  document.getElementById('debts-meta').textContent = `${open.length} open, ${settled.length} settled`;
  content.innerHTML = html;
}


// ─── Chart Initialization ─────────────────────────────────────────────────

// Read CSS variable from computed styles
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Apply Chart.js global defaults (theme-aware, called on init and theme change).
// All values track CSS variables so dark/light + print modes pick up the right
// palette without needing to re-render existing charts.
function setChartDefaults() {
  Chart.defaults.color = cssVar('--chart-text') || '#8a8b83';
  Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.borderColor = cssVar('--chart-border') || '#e2e4ea';
  // Tighter animation — 1000ms default feels sluggish on month/filter switches
  Chart.defaults.animation.duration = 400;
  Chart.defaults.animation.easing = 'easeOutQuart';

  // Tooltip — dark-on-light always for legibility, with denser body padding
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(23,26,35,0.94)';
  Chart.defaults.plugins.tooltip.titleColor = '#fff';
  Chart.defaults.plugins.tooltip.bodyColor = 'rgba(255,255,255,0.92)';
  Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.08)';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.titleFont = { size: 12, weight: '600' };
  Chart.defaults.plugins.tooltip.bodyFont = { size: 11.5 };
  Chart.defaults.plugins.tooltip.titleMarginBottom = 6;
  Chart.defaults.plugins.tooltip.displayColors = true;
  Chart.defaults.plugins.tooltip.boxPadding = 6;
  Chart.defaults.plugins.tooltip.usePointStyle = true;

  // Legend — smaller swatches, more breathing room, point-style markers
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.boxHeight = 8;
  Chart.defaults.plugins.legend.labels.padding = 14;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.font = { size: 11, weight: '500' };

  // Elements — thinner lines + softer curve, points visible only on hover
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.line.tension = 0.25;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hoverRadius = 5;
  Chart.defaults.elements.point.hitRadius = 12;
  Chart.defaults.elements.bar.borderRadius = 3;

  // Scales — subtle grid, no axis border, denser ticks. Property-by-property
  // assignment so we extend Chart.js defaults rather than replacing the whole
  // grid/ticks objects (which would drop any settings Chart.js itself sets).
  Chart.defaults.scale.grid.color = cssVar('--chart-grid') || 'rgba(0,0,0,0.06)';
  Chart.defaults.scale.grid.drawBorder = false;
  Chart.defaults.scale.grid.drawTicks = false;
  Chart.defaults.scale.ticks.padding = 8;
  Chart.defaults.scale.ticks.color = cssVar('--chart-text') || '#8a8b83';
  if (Chart.defaults.scale.border) Chart.defaults.scale.border.display = false;
}

// Update chart colors after theme change (called by applyTheme)
function updateChartTheme() {
  setChartDefaults();
  const grid = cssVar('--chart-grid') || 'rgba(0,0,0,0.06)';
  if (catChart) {
    catChart.options.scales.x.grid.color = grid;
    catChart.options.scales.x.ticks.color = cssVar('--chart-text');
    catChart.options.scales.y.ticks.color = cssVar('--chart-text');
    catChart.update('none');
  }
  if (cashflowChart) {
    cashflowChart.options.scales.x.grid.color = grid;
    cashflowChart.options.scales.y.grid.color = grid;
    cashflowChart.options.scales.x.ticks.color = cssVar('--chart-text');
    cashflowChart.options.scales.y.ticks.color = cssVar('--chart-text');
    cashflowChart.update('none');
  }
}

// Create chart instances (called once after full render)
function initCharts() {
  setChartDefaults();

  const chartCur = displayCurrency !== 'TZS' ? displayCurrency : state.primaryCurrency;
  const catData = topCategoriesForMonth(state.tx, state.currentMonth, chartCur, 8);
  const cashflowData = cashflowLastMonths(state.tx, 12, chartCur);

  const catCtx = document.getElementById('cat-chart');
  if (catCtx) {
    catChart = new Chart(catCtx, {
      type: 'bar',
      data: {
        labels: catData.map(([c]) => c.length > 24 ? c.slice(0, 23) + '…' : c),
        datasets: [{
          data: catData.map(([, v]) => v),
          backgroundColor: '#1e40af',
          borderColor: '#c8f060',
          borderWidth: 0,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => formatCurrency(ctx.raw, chartCur) + ' ' + chartCur,
            },
          },
        },
        scales: {
          x: { ticks: { callback: (v) => formatCurrency(v, chartCur) }, grid: { color: cssVar('--chart-grid') } },
          y: { grid: { display: false } },
        },
      },
    });
  }

  const cfCtx = document.getElementById('cashflow-chart');
  if (cfCtx) {
    cashflowChart = new Chart(cfCtx, {
      type: 'line',
      data: {
        labels: cashflowData.map(d => monthLabel(d.month)),
        datasets: [
          { label: t('dashboard.charts.cashflow_income', {}, 'Income'), data: cashflowData.map(d => d.income), borderColor: '#5dd4a0', backgroundColor: 'rgba(93,212,160,0.08)', fill: true, tension: 0.3, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2 },
          { label: t('dashboard.charts.cashflow_expenses', {}, 'Expenses'), data: cashflowData.map(d => d.expense), borderColor: '#f07070', backgroundColor: 'rgba(240,112,112,0.08)', fill: true, tension: 0.3, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2 },
          { label: t('dashboard.charts.cashflow_net', {}, 'Net'), data: cashflowData.map(d => d.net), borderColor: '#c8f060', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 2, pointHoverRadius: 5, borderWidth: 1.5, borderDash: [5, 3] },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, padding: 12, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, chartCur)} ${chartCur}`,
            },
          },
        },
        scales: {
          x: { grid: { color: cssVar('--chart-grid') } },
          y: { ticks: { callback: (v) => formatCurrency(v, chartCur) }, grid: { color: cssVar('--chart-grid') } },
        },
      },
    });
  }
}

// Update chart data in-place (no canvas rebuild)
function updateChartData() {
  const chartCur = displayCurrency !== 'TZS' ? displayCurrency : state.primaryCurrency;
  const catData = topCategoriesForMonth(state.tx, state.currentMonth, chartCur, 8);
  const cashflowData = cashflowLastMonths(state.tx, 12, chartCur);

  if (catChart) {
    catChart.data.labels = catData.map(([c]) => c.length > 24 ? c.slice(0, 23) + '…' : c);
    catChart.data.datasets[0].data = catData.map(([, v]) => v);
    catChart.options.scales.x.ticks.callback = (v) => formatCurrency(v, chartCur);
    catChart.options.plugins.tooltip.callbacks.label = (ctx) => formatCurrency(ctx.raw, chartCur) + ' ' + chartCur;
    catChart.update('none'); // skip animations for snappy response
  }

  if (cashflowChart) {
    cashflowChart.data.labels = cashflowData.map(d => monthLabel(d.month));
    cashflowChart.data.datasets[0].data = cashflowData.map(d => d.income);
    cashflowChart.data.datasets[1].data = cashflowData.map(d => d.expense);
    cashflowChart.data.datasets[2].data = cashflowData.map(d => d.net);
    cashflowChart.options.scales.y.ticks.callback = (v) => formatCurrency(v, chartCur);
    cashflowChart.options.plugins.tooltip.callbacks.label = (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, chartCur)} ${chartCur}`;
    cashflowChart.update('none');
  }

  // Update category chart title with current month
  const catTitle = document.getElementById('cat-chart-title');
  if (catTitle) catTitle.textContent = t('dashboard.charts.categories_title', { month: monthLabel(state.currentMonth) }, `Top 8 Categories — ${monthLabel(state.currentMonth)}`);
}

