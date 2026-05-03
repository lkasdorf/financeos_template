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
          <div class="nw-value c-pos">${formatCurrency(totalOwed, cur)}<span class="nw-currency">${cur}</span></div>
        </div>
        <div class="networth-card">
          <div class="nw-label">${t('dashboard.debt.you_owe', {}, 'You Owe')}</div>
          <div class="nw-value c-neg">${formatCurrency(totalOwe, cur)}<span class="nw-currency">${cur}</span></div>
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
      <div class="section-title">${t('dashboard.budget.title', { month: monthLabel }, `Budget Tracker — ${monthLabel}`)} <a href="#settings" data-action="presetSettingsTab" data-arg1="budgets" style="font-size:10px;font-weight:400;margin-left:8px;">${t('dashboard.budget.manage_link', {}, 'manage &rarr;')}</a></div>
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
  // Same membership rule as the live total — driven by the per-account
  // include_in_net_worth flag with a legacy fallback (see core.js).
  const selfActive = state.accounts.filter(isInNetWorth);
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
      <div class="section-title">${t('dashboard.networth.title', {}, 'Net Worth')} <span class="hint">${t('dashboard.networth.hint', {}, '(per-account toggle in Settings → Accounts)')}</span></div>
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
      <table class="tx-table mb-0">
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
          <div class="section-title mb-12" id="cat-chart-title">${t('dashboard.charts.categories_title', { month: monthLabel(state.currentMonth) }, `Top 8 Categories — ${monthLabel(state.currentMonth)}`)}</div>
          <div class="chart-canvas-box"><canvas id="cat-chart"></canvas></div>
        </div>
        <div class="chart-wrap">
          <div class="section-title mb-12">${t('dashboard.charts.cashflow_title', {}, 'Cashflow — Last 12 Months')}</div>
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


