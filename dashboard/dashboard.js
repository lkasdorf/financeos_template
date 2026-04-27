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

  container.innerHTML = `
    <section class="section">
      <div class="section-title">${t('dashboard.upcoming.title', {}, 'Upcoming Payments')} <span class="hint">${overdue.length > 0
        ? t('dashboard.upcoming.overdue_count', { n: overdue.length }, `${overdue.length} overdue`)
        : t('dashboard.upcoming.next_week', {}, 'next 7 days')}</span></div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;box-shadow:var(--shadow);">
        ${overdue.map(s => renderItem(s, true)).join('')}
        ${upcoming.map(s => renderItem(s, false)).join('')}
      </div>
    </section>
  `;
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
      <button class="tx-edit-btn" onclick="showPayDebtModal('${tp.id}')" title="Record payment" class="c-acc">Pay</button>
      <button class="tx-edit-btn" onclick="showDebtHistory('${tp.id}')" title="Payment history">History</button>
      <button class="tx-edit-btn" onclick="showDebtModal('${tp.id}')" title="Edit">Edit</button>
      <button class="tx-edit-btn" onclick="deleteDebt('${tp.id}')" title="Delete" class="c-neg">Delete</button>
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
        ${isSettled ? '<span style="color:var(--positive);">0</span>' : `${formatCurrency(showAmt, cur)}<span class="acc-currency">${cur}</span>`}
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
      <button class="btn-save" onclick="showDebtModal()" style="padding:8px 16px;font-size:11px;">+ Add Debt</button>
    </div>
    <div class="income-grid" class="mb-20">
      <div class="income-cell">
        <div class="ic-label">Owed to You</div>
        <div class="ic-value" class="c-pos">${formatCurrency(totalOwed, cur)}<span class="ic-cur">${cur}</span></div>
        <div class="ic-count">${open.filter(tp => tp.type === 'owed_to_me').length} open</div>
      </div>
      <div class="income-cell">
        <div class="ic-label">You Owe</div>
        <div class="ic-value" class="c-neg">${formatCurrency(totalOwe, cur)}<span class="ic-cur">${cur}</span></div>
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
      <div class="section" class="mb-24">
        <div class="section-title">Open</div>
        <table class="tx-table"><thead><tr><th>Person</th><th>Direction</th><th class="amt">Original</th><th class="amt">Outstanding</th><th>Since</th><th>Note</th><th></th></tr></thead>
        <tbody>${open.map(tp => renderRow(tp, false)).join('')}</tbody></table>
      </div>
    `;
  }

  if (settled.length > 0) {
    html += `
      <div class="section">
        <div class="section-title" style="color:var(--muted)">Settled</div>
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

// Apply Chart.js global defaults (theme-aware, called on init and theme change)
function setChartDefaults() {
  Chart.defaults.color = cssVar('--chart-text') || '#8a8b83';
  Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.borderColor = cssVar('--chart-border') || '#e2e4ea';
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(23,26,35,0.92)';
  Chart.defaults.plugins.tooltip.titleColor = '#fff';
  Chart.defaults.plugins.tooltip.bodyColor = '#fff';
  Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.1)';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.titleFont = { size: 12, weight: '600' };
  Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };
  Chart.defaults.plugins.tooltip.displayColors = true;
  Chart.defaults.plugins.tooltip.boxPadding = 4;
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

