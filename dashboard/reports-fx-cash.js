// ─── FX Exposure Report ─────────────────────────────────────────────────

function renderFXExposureReport() {
  const out = document.getElementById('report-output');

  // Use computeBalances() for correct current balances (respects transfer_to_amount)
  const selfAccounts = state.accounts.filter(a => a.owner === 'self' && a.status === 'active');
  const balances = computeBalances(state.tx, state.accounts);
  const byCurrency = {};
  for (const a of selfAccounts) {
    if (!byCurrency[a.currency]) byCurrency[a.currency] = { balance: 0, accounts: [] };
    const bal = balances[a.alias] || 0;
    byCurrency[a.currency].balance += bal;
    byCurrency[a.currency].accounts.push({ alias: a.alias, name: a.name, balance: bal });
  }

  const currencies = Object.keys(byCurrency).sort();
  // Convert all to TZS for comparison
  const rows = currencies.map(c => {
    const inTZS = convertTo(byCurrency[c].balance, c, 'TZS');
    return { currency: c, native: byCurrency[c].balance, inTZS, accounts: byCurrency[c].accounts };
  });
  const totalTZS = rows.reduce((s, r) => s + r.inTZS, 0);

  // Monthly balance evolution per currency (last 12 months)
  const now = new Date();
  const monthKeys = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  // Build running balances per currency per month-end (same logic as the
  // Account Balances report). DR-M3: one shared sweep instead of
  // months × accounts × state.tx full scans.
  const monthlyByCur = {};
  for (const c of currencies) monthlyByCur[c] = [];

  const fxSnapshots = computeMonthlyBalances(selfAccounts, monthKeys);
  monthKeys.forEach((mk, mi) => {
    const curBal = {};
    for (const c of currencies) curBal[c] = 0;
    for (const a of selfAccounts) {
      const bal = fxSnapshots[mi][a.alias];
      if (bal === undefined) continue;
      curBal[a.currency] += bal;
    }
    for (const c of currencies) monthlyByCur[c].push(convertTo(curBal[c], c, 'TZS'));
  });

  const fxPalette = { TZS: chartPalette()[10], EUR: chartPalette()[0], USD: chartPalette()[1], PLN: chartPalette()[11] };

  out.innerHTML = `
    <div class="report-view">
      <div id="fx-content"></div>
    </div>
  `;

  const content = document.getElementById('fx-content');
  content.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${t('reports.fx.section.current_balances', {}, 'FX Exposure — Current Balances (all converted to TZS)')}</div>
      <div class="income-grid">
        ${rows.map(r => {
          const pct = totalTZS > 0 ? (r.inTZS / totalTZS * 100).toFixed(1) : '0.0';
          return `
          <div class="income-cell">
            <div class="ic-label">${r.currency}</div>
            <div class="ic-value" style="color:${fxPalette[r.currency] || 'var(--text)'}">${formatCurrency(r.native, r.currency)}<span class="ic-cur">${r.currency}</span></div>
            <div class="ic-count">${t('reports.fx.tile.detail', { pct, tzs: formatCurrency(r.inTZS, 'TZS') }, `${pct}% · ${formatCurrency(r.inTZS, 'TZS')} TZS`)}</div>
          </div>`;
        }).join('')}
        <div class="income-cell">
          <div class="ic-label">${t('reports.fx.tile.total_tzs', {}, 'Total (TZS)')}</div>
          <div class="ic-value">${formatCurrency(totalTZS, 'TZS')}<span class="ic-cur">TZS</span></div>
        </div>
      </div>
    </div>
    <div class="report-section">
      <div class="report-section-title">${t('reports.fx.section.account_breakdown', {}, 'Account Breakdown')}</div>
      <table class="tx-table">
        <thead><tr>
          <th>${t('common.col.account', {}, 'Account')}</th>
          <th>${t('common.col.currency', {}, 'Currency')}</th>
          <th class="amt">${t('reports.fx.col.balance', {}, 'Balance')}</th>
          <th class="amt">${t('reports.fx.col.in_tzs', {}, 'In TZS')}</th>
          <th>${t('reports.fx.col.share', {}, 'Share')}</th>
        </tr></thead>
        <tbody>
          ${rows.flatMap(r => r.accounts.map(a => {
            const aTZS = convertTo(a.balance, r.currency, 'TZS');
            const pct = totalTZS > 0 ? (aTZS / totalTZS * 100).toFixed(1) : '0.0';
            return `<tr>
              <td>${escapeHtml(a.name)}</td>
              <td>${r.currency}</td>
              <td class="amt">${formatCurrency(a.balance, r.currency)}</td>
              <td class="amt">${formatCurrency(aTZS, 'TZS')}</td>
              <td>${pct}%</td>
            </tr>`;
          })).join('')}
        </tbody>
      </table>
    </div>
    <div class="report-section">
      <div class="chart-row">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.fx.chart.distribution', {}, 'Currency Distribution')}</div>
          <div class="chart-canvas-box"><canvas id="fx-pie-chart"></canvas></div>
        </div>
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.fx.chart.trend_12m', {}, '12-Month Balance Trend (in TZS)')}</div>
          <div class="chart-canvas-box"><canvas id="fx-line-chart"></canvas></div>
        </div>
      </div>
    </div>
  `;

  // Pie chart
  const pieCtx = document.getElementById('fx-pie-chart');
  if (pieCtx) {
    const chart = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: rows.map(r => r.currency),
        datasets: [{ data: rows.map(r => r.inTZS), backgroundColor: rows.map(r => fxPalette[r.currency] || cssVar('--muted')), borderWidth: 2 }],
      },
      options: {
        ...CHART_BASE,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatCurrency(ctx.raw, 'TZS')} TZS (${(ctx.raw / totalTZS * 100).toFixed(1)}%)` } },
        },
      },
    });
    reportCharts.push(chart);
  }

  // Stacked area line chart
  const lineCtx = document.getElementById('fx-line-chart');
  if (lineCtx) {
    const chart = new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: monthKeys.map(mk => monthLabel(mk)),
        datasets: currencies.map(c => ({
          label: c,
          data: monthlyByCur[c],
          borderColor: fxPalette[c] || cssVar('--muted'),
          backgroundColor: (fxPalette[c] || cssVar('--muted')) + '20',
          fill: true, tension: 0.3, pointRadius: 3,
        })),
      },
      options: {
        ...CHART_BASE,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, 'TZS')} TZS` } },
        },
        scales: {
          x: { grid: { color: cssVar('--chart-grid') } },
          y: { stacked: true, ticks: currencyTicks('TZS'), grid: { color: cssVar('--chart-grid') } },
        },
      },
    });
    reportCharts.push(chart);
  }
}

// ─── Net Worth Trend Report ─────────────────────────────────────────────

function renderNetWorthTrendReport() {
  const out = document.getElementById('report-output');
  const selfAccounts = state.accounts.filter(a => a.owner === 'self' && a.status === 'active');
  const currencies = [...new Set(selfAccounts.map(a => a.currency))];

  // DR-M4: toolbar rendering/persistence/wiring live in reportToolbar()
  const tb = reportToolbar(out, 'nw', [
    { key: 'cur', label: t('reports.nw.toolbar.display_currency', {}, 'Display Currency'),
      options: currencies, def: 'TZS' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="nw-content"></div>
    </div>
  `;

  function update() {
    destroyReportCharts();
    const dispCur = tb.get('cur');

    // Build monthly net worth snapshots from earliest data to now
    const allMonths = new Set();
    for (const tx of state.tx) { if (tx.date) allMonths.add(tx.date.slice(0, 7)); }
    const sortedMonths = [...allMonths].sort();
    if (sortedMonths.length === 0) { document.getElementById('nw-content').innerHTML = `<p>${t('reports.nw.empty', {}, 'No data.')}</p>`; return; }

    const dataPoints = [];
    // DR-M3: one shared sweep instead of months × accounts × state.tx
    // full scans (the old nested loops re-read the whole TX array
    // hundreds of times per render / currency switch).
    const nwSnapshots = computeMonthlyBalances(selfAccounts, sortedMonths);
    sortedMonths.forEach((mk, mi) => {
      let totalNW = 0;
      for (const a of selfAccounts) {
        const bal = nwSnapshots[mi][a.alias];
        if (bal === undefined) continue;
        totalNW += convertTo(bal, a.currency, dispCur);
      }
      dataPoints.push({ month: mk, nw: totalNW });
    });

    const currentNW = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].nw : 0;
    const prevNW = dataPoints.length > 1 ? dataPoints[dataPoints.length - 2].nw : currentNW;
    const delta = currentNW - prevNW;
    const deltaPct = prevNW !== 0 ? (delta / Math.abs(prevNW) * 100) : 0;
    const maxNW = Math.max(...dataPoints.map(d => d.nw));
    const minNW = Math.min(...dataPoints.map(d => d.nw));

    const content = document.getElementById('nw-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.nw.title', { currency: dispCur }, `Net Worth Trend — ${dispCur}`)}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.nw.tile.current', {}, 'Current Net Worth')}</div>
            <div class="ic-value" style="color:${currentNW >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(currentNW, dispCur)}<span class="ic-cur">${dispCur}</span></div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.nw.tile.vs_last_month', {}, 'vs. Last Month')}</div>
            <div class="ic-value" style="color:${delta >= 0 ? 'var(--positive)' : 'var(--negative)'}">${delta >= 0 ? '+' : ''}${formatCurrency(delta, dispCur)}<span class="ic-cur">${dispCur}</span></div>
            <div class="ic-count">${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.nw.tile.all_time_high', {}, 'All-time High')}</div>
            <div class="ic-value c-pos">${formatCurrency(maxNW, dispCur)}<span class="ic-cur">${dispCur}</span></div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.nw.tile.all_time_low', {}, 'All-time Low')}</div>
            <div class="ic-value c-neg">${formatCurrency(minNW, dispCur)}<span class="ic-cur">${dispCur}</span></div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap" style="max-width:100%">
          <div class="report-section-title">${t('reports.nw.chart.over_time', {}, 'Net Worth Over Time')}</div>
          <div class="chart-canvas-box" style="height:350px"><canvas id="nw-line-chart"></canvas></div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.nw.section.monthly_snapshots', {}, 'Monthly Snapshots')}</div>
        <table class="tx-table">
          <thead><tr>
            <th>${t('common.label.month', {}, 'Month')}</th>
            <th class="amt">${t('reports.nw.col.net_worth', {}, 'Net Worth')}</th>
            <th class="amt">${t('common.label.change', {}, 'Change')}</th>
            <th>%</th>
          </tr></thead>
          <tbody>
            ${dataPoints.slice().reverse().map((d, i, arr) => {
              const prev = i < arr.length - 1 ? arr[i + 1].nw : d.nw;
              const ch = d.nw - prev;
              const chPct = prev !== 0 ? (ch / Math.abs(prev) * 100) : 0;
              return `<tr>
                <td>${monthLabel(d.month)}</td>
                <td class="amt">${formatCurrency(d.nw, dispCur)}</td>
                <td class="amt" style="color:${ch >= 0 ? 'var(--positive)' : 'var(--negative)'}">${ch >= 0 ? '+' : ''}${formatCurrency(ch, dispCur)}</td>
                <td style="color:${ch >= 0 ? 'var(--positive)' : 'var(--negative)'}; font-size:12px">${chPct >= 0 ? '+' : ''}${chPct.toFixed(1)}%</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    const ctx = document.getElementById('nw-line-chart');
    if (ctx) {
      const chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: dataPoints.map(d => monthLabel(d.month)),
          datasets: [{
            label: t('reports.nw.col.net_worth', {}, 'Net Worth'),
            data: dataPoints.map(d => d.nw),
            borderColor: cssVar('--positive'), backgroundColor: chartTint(cssVar('--positive'), 0.1),
            fill: true, tension: 0.3, pointRadius: 3,
          }],
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, dispCur) + ' ' + dispCur } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') }, ticks: { maxTicksLimit: 18 } },
            y: { ticks: currencyTicks(dispCur), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}

// ─── Cash Runway Report ─────────────────────────────────────────────────

function renderRunwayReport() {
  const out = document.getElementById('report-output');
  const currencies = reportCurrencies();

  // DR-M4: toolbar rendering/persistence/wiring live in reportToolbar()
  const tb = reportToolbar(out, 'rw', [
    { key: 'cur', label: t('reports.toolbar.currency', {}, 'Currency'),
      options: currencies, def: 'TZS' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="rw-content"></div>
    </div>
  `;

  function update() {
    destroyReportCharts();
    const dispCur = tb.get('cur');

    // Current net worth in display currency
    const selfAccounts = state.accounts.filter(a => a.owner === 'self' && a.status === 'active');
    const balances = computeBalances(state.tx, state.accounts);
    let totalNW = 0;
    for (const a of selfAccounts) {
      totalNW += convertTo(balances[a.alias] || 0, a.currency, dispCur);
    }

    // Calculate monthly burn rates for the last 12 months
    const custodyAliases = getCustodyAliases();
    const nonPnl = getNonPnlCategories();
    const now = new Date();
    const monthlyBurn = [];
    for (let i = 1; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      let expenses = 0, income = 0, colExpenses = 0;
      for (const t of state.tx) {
        if (!t.date || !t.date.startsWith(ym)) continue;
        if (!isOperationalTx(t, custodyAliases, nonPnl)) continue;
        const amt = convertTo(t.amount, t.currency, dispCur);
        if (t.type === 'expense') {
          expenses += amt;
          if (!isColExcludedCategory(t.category)) colExpenses += amt;
        } else if (t.type === 'income') {
          income += amt;
        }
      }
      monthlyBurn.push({ month: ym, expenses, income, colExpenses, net: income - expenses });
    }
    monthlyBurn.reverse();

    const avgExpense = monthlyBurn.length > 0 ? monthlyBurn.reduce((s, m) => s + m.expenses, 0) / monthlyBurn.length : 0;
    const avgIncome = monthlyBurn.length > 0 ? monthlyBurn.reduce((s, m) => s + m.income, 0) / monthlyBurn.length : 0;
    const avgColExpense = monthlyBurn.length > 0 ? monthlyBurn.reduce((s, m) => s + m.colExpenses, 0) / monthlyBurn.length : 0;
    const avgNet = avgIncome - avgExpense;
    const last3Expense = monthlyBurn.slice(-3).reduce((s, m) => s + m.expenses, 0) / Math.min(3, monthlyBurn.length);
    const last3Net = monthlyBurn.slice(-3).reduce((s, m) => s + m.net, 0) / Math.min(3, monthlyBurn.length);

    // Runway calculations
    const runwayNoIncome = avgExpense > 0 ? totalNW / avgExpense : Infinity;
    const runwayEssentials = avgColExpense > 0 ? totalNW / avgColExpense : Infinity;
    const runwayWithIncome = avgNet < 0 ? totalNW / Math.abs(avgNet) : Infinity;
    const runwayRecent = last3Expense > 0 ? totalNW / last3Expense : Infinity;

    const fmtRunway = (months) => {
      if (months === Infinity || months > 999) return t('reports.runway.fmt.indefinite', {}, 'Indefinite');
      if (months < 0) return t('reports.runway.fmt.na', {}, 'N/A');
      const y = Math.floor(months / 12);
      const m = Math.round(months % 12);
      return y > 0
        ? t('reports.runway.fmt.years_months', { y, m }, `${y}y ${m}m`)
        : t('reports.runway.fmt.months_only', { m }, `${m} months`);
    };

    const runwayColor = (months) => {
      if (months === Infinity || months > 24) return 'var(--positive)';
      if (months > 6) return 'var(--warn)';
      return 'var(--negative)';
    };

    // Project forward 12 months
    const projections = [];
    let projBal = totalNW;
    for (let i = 1; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      projBal += avgNet;
      projections.push({ month: label, balance: projBal });
    }

    const content = document.getElementById('rw-content');
    const nonEssCats = getNonEssentialCategories();
    const nonEssSize = nonEssCats.size;
    const catWord = nonEssSize === 1
      ? t('reports.runway.explainer.cat_singular', {}, 'category is')
      : t('reports.runway.explainer.cat_plural', {}, 'categories are');
    const nonEssList = [...nonEssCats].sort().slice(0, 8).map(c => escapeHtml(c)).join(', ');
    const nonEssMore = nonEssSize > 8 ? t('reports.runway.explainer.more', {}, ', …') : '';
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.runway.section.title', { currency: dispCur }, `Cash Runway Analysis — ${dispCur}`)}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.runway.tile.net_worth', {}, 'Current Net Worth')}</div>
            <div class="ic-value" style="color:${totalNW >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(totalNW, dispCur)}<span class="ic-cur">${dispCur}</span></div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.runway.tile.no_income', {}, 'Runway (no income)')}</div>
            <div class="ic-value" style="color:${runwayColor(runwayNoIncome)}">${fmtRunway(runwayNoIncome)}</div>
            <div class="ic-count">${t('reports.runway.tile.no_income_sub', { amt: formatCurrency(avgExpense, dispCur) }, `At avg ${formatCurrency(avgExpense, dispCur)}/mo burn`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.runway.tile.essentials', {}, 'Runway (essentials only, no income)')}</div>
            <div class="ic-value" style="color:${runwayColor(runwayEssentials)}">${fmtRunway(runwayEssentials)}</div>
            <div class="ic-count">${t('reports.runway.tile.essentials_sub', { amt: formatCurrency(avgColExpense, dispCur), n: nonEssSize }, `Cost-of-living only: ${formatCurrency(avgColExpense, dispCur)}/mo — ${nonEssSize} categories flagged non-essential (Settings → Categories)`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.runway.tile.with_income', {}, 'Runway (with income)')}</div>
            <div class="ic-value" style="color:${runwayColor(runwayWithIncome)}">${fmtRunway(runwayWithIncome)}</div>
            <div class="ic-count">${avgNet >= 0 ? t('reports.runway.net.positive', {}, 'Net positive — growing') : t('reports.runway.net.burn', { amt: formatCurrency(Math.abs(avgNet), dispCur) }, `Net burn ${formatCurrency(Math.abs(avgNet), dispCur)}/mo`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.runway.tile.recent', {}, 'Runway (last 3 mo pace)')}</div>
            <div class="ic-value" style="color:${runwayColor(runwayRecent)}">${fmtRunway(runwayRecent)}</div>
            <div class="ic-count">${t('reports.runway.tile.recent_sub', { amt: formatCurrency(last3Expense, dispCur) }, `Recent pace: ${formatCurrency(last3Expense, dispCur)}/mo`)}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <details class="c-mut2" style="font-size:12px;line-height:1.5;">
          <summary class="ptr fw-600 c-text">${t('reports.runway.explainer.summary', {}, 'How these runway figures are calculated')}</summary>
          <div class="mt-8">
            ${t('reports.runway.explainer.net_worth', { currency: dispCur }, `<strong>Net worth</strong> = sum of your active own accounts (non-custody, non-pass-through), converted to ${dispCur}.`)}<br>
            ${t('reports.runway.explainer.no_income', {}, '<strong>Runway (no income)</strong> = net worth ÷ avg. monthly expenses over last 12 months. All operational expenses counted (custody and non-PnL excluded).')}<br>
            ${t('reports.runway.explainer.essentials', { n: nonEssSize, cat_word: catWord, list: nonEssList, more: nonEssMore }, `<strong>Runway (essentials only, no income)</strong> = net worth ÷ avg. monthly essential expenses. Uses the <code>essential</code> flag from Settings → Categories. Currently ${nonEssSize} ${catWord} flagged non-essential and excluded here: ${nonEssList}${nonEssMore}.`)}<br>
            ${t('reports.runway.explainer.with_income', {}, '<strong>Runway (with income)</strong> = net worth ÷ avg. monthly net burn (expenses − income). Infinite if net positive.')}<br>
            ${t('reports.runway.explainer.recent', {}, '<strong>Runway (last 3 mo pace)</strong> = net worth ÷ avg. last-3-months expenses. More sensitive to recent trend.')}<br>
            ${t('reports.runway.explainer.footer', {}, '<em style="opacity:0.8;">Edit which categories count as essential in Settings → Categories → Essential column.</em>')}
          </div>
        </details>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.runway.section.burn_rate', {}, 'Monthly Burn Rate (Last 12 Months)')}</div>
        <table class="tx-table">
          <thead><tr><th>${t('common.label.month', {}, 'Month')}</th><th class="amt">${t('common.label.income', {}, 'Income')}</th><th class="amt">${t('common.label.expenses', {}, 'Expenses')}</th><th class="amt">${t('common.label.net', {}, 'Net')}</th></tr></thead>
          <tbody>
            ${monthlyBurn.map(m => `<tr>
              <td>${monthLabel(m.month)}</td>
              <td class="amt c-pos">${formatCurrency(m.income, dispCur)}</td>
              <td class="amt c-neg">${formatCurrency(m.expenses, dispCur)}</td>
              <td class="amt" style="color:${m.net >= 0 ? 'var(--positive)' : 'var(--negative)'}">${m.net >= 0 ? '+' : ''}${formatCurrency(m.net, dispCur)}</td>
            </tr>`).join('')}
            <tr class="row-total">
              <td>${t('reports.runway.row.average', {}, 'Average')}</td>
              <td class="amt">${formatCurrency(avgIncome, dispCur)}</td>
              <td class="amt">${formatCurrency(avgExpense, dispCur)}</td>
              <td class="amt" style="color:${avgNet >= 0 ? 'var(--positive)' : 'var(--negative)'}">${avgNet >= 0 ? '+' : ''}${formatCurrency(avgNet, dispCur)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.runway.chart.burn_trend', {}, 'Burn Rate Trend')}</div>
            <div class="chart-canvas-box"><canvas id="rw-burn-chart"></canvas></div>
          </div>
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.runway.chart.projection', {}, '12-Month Projection')}</div>
            <div class="chart-canvas-box"><canvas id="rw-proj-chart"></canvas></div>
          </div>
        </div>
      </div>
    `;

    const burnCtx = document.getElementById('rw-burn-chart');
    if (burnCtx) {
      const chart = new Chart(burnCtx, {
        type: 'bar',
        data: {
          labels: monthlyBurn.map(m => monthLabel(m.month)),
          datasets: [
            { label: t('common.label.income', {}, 'Income'), data: monthlyBurn.map(m => m.income), backgroundColor: cssVar('--positive'), borderWidth: 0 },
            { label: t('common.label.expenses', {}, 'Expenses'), data: monthlyBurn.map(m => m.expenses), backgroundColor: cssVar('--negative'), borderWidth: 0 },
          ],
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, dispCur)} ${dispCur}` } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: currencyTicks(dispCur), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }

    const projCtx = document.getElementById('rw-proj-chart');
    if (projCtx) {
      const nowLabel = t('reports.runway.chart.now', {}, 'Now');
      const allPoints = [{ month: '__NOW__', balance: totalNW }, ...projections];
      const chart = new Chart(projCtx, {
        type: 'line',
        data: {
          labels: allPoints.map(p => p.month === '__NOW__' ? nowLabel : monthLabel(p.month)),
          datasets: [{
            label: t('reports.runway.chart.proj_balance', {}, 'Projected Balance'),
            data: allPoints.map(p => p.balance),
            borderColor: allPoints[allPoints.length - 1].balance >= 0 ? cssVar('--positive') : cssVar('--negative'),
            backgroundColor: allPoints[allPoints.length - 1].balance >= 0 ? chartTint(cssVar('--positive'), 0.1) : chartTint(cssVar('--negative'), 0.1),
            fill: true, tension: 0.2, pointRadius: 4,
          }],
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, dispCur) + ' ' + dispCur } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: currencyTicks(dispCur), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}
// ─── FX History Report ──────────────────────────────────────────────────

function renderFxHistoryReport() {
  const out = document.getElementById('report-output');
  if (!fxHistory.length) {
    out.innerHTML = `<div class="report-section"><p>${t('reports.fxh.empty.no_data', {}, 'No historical FX data available.')}</p></div>`;
    return;
  }

  const currencies = ['EUR', 'USD', 'PLN', 'TRY'];
  const curLabels = {
    EUR: t('reports.fxh.cur_name.eur', {}, 'Euro'),
    USD: t('reports.fxh.cur_name.usd', {}, 'US Dollar'),
    PLN: t('reports.fxh.cur_name.pln', {}, 'Polish Zloty'),
    TRY: t('reports.fxh.cur_name.try', {}, 'Turkish Lira'),
  };
  const curColors = { EUR: chartPalette()[0], USD: chartPalette()[1], PLN: chartPalette()[11], TRY: chartPalette()[6] };

  // Determine available year range
  const firstYear = parseInt(fxHistory[0].date.slice(0, 4));
  const lastYear = parseInt(fxHistory[fxHistory.length - 1].date.slice(0, 4));
  const rangeOptions = [
    { v: '3m', l: t('reports.fxh.range.3m', {}, 'Last 3 Months') },
    { v: '6m', l: t('reports.fxh.range.6m', {}, 'Last 6 Months') },
    { v: '12m', l: t('reports.fxh.range.12m', {}, 'Last 12 Months') },
  ];
  for (let y = lastYear; y >= firstYear; y--) rangeOptions.push({ v: String(y), l: String(y) });
  rangeOptions.push({ v: 'all', l: t('reports.fxh.range.all', {}, 'All Time') });

  // DR-M4: toolbar rendering/persistence/wiring live in reportToolbar()
  const tb = reportToolbar(out, 'fxh', [
    { key: 'cur', label: t('reports.toolbar.currency', {}, 'Currency'), def: 'all',
      options: [
        { v: 'all', l: t('reports.fxh.currencies.all', {}, 'All Currencies') },
        ...currencies.map(c => ({ v: c, l: `${curLabels[c]} (${c})` })),
      ] },
    { key: 'range', label: t('reports.fxh.toolbar.period', {}, 'Period'),
      options: rangeOptions, def: '12m' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="fxh-content"></div>
    </div>
  `;

  function update() {
    destroyReportCharts();

    const selectedCurs = tb.get('cur') === 'all' ? currencies : [tb.get('cur')];

    // Filter data by range
    let data = fxHistory;
    const rangeVal = tb.get('range');
    if (rangeVal === '3m' || rangeVal === '6m' || rangeVal === '12m') {
      const nDays = rangeVal === '3m' ? 90 : rangeVal === '6m' ? 180 : 365;
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - nDays);
      const cutoffStr = localIsoDate(cutoff);
      data = data.filter(r => r.date >= cutoffStr);
    } else if (rangeVal !== 'all') {
      data = data.filter(r => r.date.startsWith(rangeVal));
    }

    if (!data.length) {
      document.getElementById('fxh-content').innerHTML = `<p>${t('reports.fxh.empty.no_period', {}, 'No data for selected period.')}</p>`;
      return;
    }

    // Current rate and change stats
    const latest = data[data.length - 1];
    const first = data[0];
    const kpiCards = selectedCurs.map(c => {
      const cur = latest[c];
      const prev = first[c];
      const change = prev ? ((cur - prev) / prev * 100) : 0;
      const arrow = change > 0 ? '&#9650;' : change < 0 ? '&#9660;' : '—';
      const color = change > 0 ? 'var(--income-color, #22c55e)' : change < 0 ? 'var(--expense-color, #ef4444)' : 'var(--muted)';
      return `<div class="income-cell">
        <div class="ic-label">${t('reports.fxh.kpi.label', { name: curLabels[c], code: c }, `${curLabels[c]} (${c}/TZS)`)}</div>
        <div class="ic-value">${formatCurrency(cur, 'TZS')}</div>
        <div class="ic-count" style="color:${color}">${arrow} ${Math.abs(change).toFixed(1)}% ${t('reports.fxh.kpi.vs', { date: first.date.slice(0, 7) }, `vs ${first.date.slice(0, 7)}`)}</div>
      </div>`;
    }).join('');

    // Table — aggregate to monthly (last rate of month) if > 90 days, otherwise show daily
    const useMonthly = data.length > 90;
    let tableData;
    if (useMonthly) {
      const byMonth = {};
      for (const r of data) {
        const ym = r.date.slice(0, 7);
        // Keep last entry per month (data is sorted chronologically)
        byMonth[ym] = { date: ym };
        for (const c of selectedCurs) byMonth[ym][c] = r[c];
      }
      tableData = Object.values(byMonth);
    } else {
      tableData = data;
    }
    const tableRows = tableData.map(r => `<tr>
      <td>${r.date}</td>
      ${selectedCurs.map(c => `<td class="amt">${formatCurrency(r[c], 'TZS')}</td>`).join('')}
    </tr>`).join('');

    const content = document.getElementById('fxh-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="income-grid">${kpiCards}</div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.fxh.chart.rate_trend', {}, 'Rate Trend — TZS per 1 Unit')}</div>
        <div class="chart-canvas-box"><canvas id="fxh-line-chart"></canvas></div>
      </div>
      ${selectedCurs.length === 1 ? `
      <div class="report-section">
        <div class="report-section-title">${t('reports.fxh.chart.mom', {}, 'Month-over-Month Change (%)')}</div>
        <div class="chart-canvas-box"><canvas id="fxh-mom-chart"></canvas></div>
      </div>` : ''}
      <div class="report-section">
        <div class="report-section-title">${useMonthly ? t('reports.fxh.section.monthly', {}, 'Month-End Rates (TZS per 1 unit)') : t('reports.fxh.section.daily', {}, 'Daily Rates (TZS per 1 unit)')}</div>
        <div class="table-scroll-wrapper"><table class="tx-table nowrap">
          <thead><tr>
            <th>${t('common.label.month', {}, 'Month')}</th>
            ${selectedCurs.map(c => `<th class="t-right">${c}</th>`).join('')}
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table></div>
      </div>
    `;

    // Line chart
    const lineCtx = document.getElementById('fxh-line-chart');
    if (lineCtx) {
      const chart = new Chart(lineCtx, {
        type: 'line',
        data: {
          labels: data.map(r => r.date.slice(0, 7)),
          datasets: selectedCurs.map(c => ({
            label: t('reports.fxh.dataset.rate', { code: c }, `1 ${c} in TZS`),
            data: data.map(r => r[c]),
            borderColor: curColors[c],
            backgroundColor: curColors[c] + '20',
            fill: selectedCurs.length === 1,
            tension: 0.3,
            pointRadius: data.length > 90 ? 0 : selectedCurs.length === 1 ? 3 : 2,
            borderWidth: 2,
          })),
        },
        options: {
          ...CHART_BASE,
          plugins: {
            legend: { display: selectedCurs.length > 1, position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, 'TZS')}` } },
          },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: currencyTicks('TZS'), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }

    // Month-over-month change chart (single currency only)
    if (selectedCurs.length === 1) {
      const momCtx = document.getElementById('fxh-mom-chart');
      if (momCtx && data.length > 1) {
        const c = selectedCurs[0];
        const changes = data.slice(1).map((r, i) => {
          const prev = data[i][c];
          return prev ? ((r[c] - prev) / prev * 100) : 0;
        });
        const chart = new Chart(momCtx, {
          type: 'bar',
          data: {
            labels: data.slice(1).map(r => r.date.slice(0, 7)),
            datasets: [{
              label: t('reports.fxh.dataset.mom', {}, 'MoM Change %'),
              data: changes,
              backgroundColor: changes.map(v => v >= 0 ? '#22c55e80' : '#ef444480'),
              borderColor: changes.map(v => v >= 0 ? cssVar('--positive') : cssVar('--negative')),
              borderWidth: 1,
            }],
          },
          options: {
            ...CHART_BASE,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: c => `${c.raw >= 0 ? '+' : ''}${c.raw.toFixed(2)}%` } },
            },
            scales: {
              x: { grid: { color: cssVar('--chart-grid') } },
              y: { ticks: { callback: v => v.toFixed(1) + '%' }, grid: { color: cssVar('--chart-grid') } },
            },
          },
        });
        reportCharts.push(chart);
      }
    }
  }

  tb.wire(update);
}

// ─── Cash Discrepancy Report ─────────────────────────────────────────────

function renderCashDiscrepancyReport() {
  const out = document.getElementById('report-output');
  const currency = state.primaryCurrency;

  // All Cash Discrepancy transactions (expense + income sides) per
  // config/reports.json. Empty arrays → empty filter, report shows zeros.
  const cdCfg = window.REPORTS_CONFIG?.cash_discrepancy || {};
  const expCats = new Set(cdCfg.expense_categories || []);
  const incCats = new Set(cdCfg.income_categories || []);
  const discTx = state.tx.filter(t =>
    expCats.has(t.category) || incCats.has(t.category)
  ).map(t => ({ ...t, amountConv: convertToTZS(t.amount, t.currency) }));

  // rc.17 — actionable empty state when no TX in the entire dataset match
  // the configured Cash Discrepancy expense / income categories.
  if (discTx.length === 0) {
    out.innerHTML = '<div class="report-view"><div class="report-section" id="cd-empty-host"></div></div>';
    renderReportEmptyState({
      containerId: 'cd-empty-host',
      filterId: 'cash_discrepancy',
      filterLabel: t('reports.cashdisc.title', {}, 'Cash Discrepancy'),
    });
    return;
  }

  // Group by year
  const byYear = {};
  for (const t of discTx) {
    const y = (t.date || '').slice(0, 4);
    if (!y) continue;
    if (!byYear[y]) byYear[y] = { expense: 0, income: 0, count: 0 };
    if (t.type === 'expense') byYear[y].expense += t.amountConv;
    else if (t.type === 'income') byYear[y].income += t.amountConv;
    byYear[y].count += 1;
  }
  const years = Object.keys(byYear).sort().reverse();

  // Totals
  const totalExpense = discTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amountConv, 0);
  const totalIncome = discTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amountConv, 0);
  const totalNet = totalIncome - totalExpense;

  // Display values in chosen primary currency
  const toDisp = (v) => convertTo(v, 'TZS', currency);

  const yearRows = years.map(y => {
    const d = byYear[y];
    const net = d.income - d.expense;
    const netCls = net >= 0 ? 'income' : 'expense';
    return `<tr>
      <td>${y}</td>
      <td>${d.count}</td>
      <td class="amt expense">−${formatCurrency(toDisp(d.expense), currency)} ${currency}</td>
      <td class="amt income">+${formatCurrency(toDisp(d.income), currency)} ${currency}</td>
      <td class="amt ${netCls}">${net >= 0 ? '+' : '−'}${formatCurrency(Math.abs(toDisp(net)), currency)} ${currency}</td>
    </tr>`;
  }).join('');

  const txRows = discTx.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(t => {
    const sign = t.type === 'expense' ? '−' : '+';
    const cls = t.type === 'expense' ? 'expense' : 'income';
    return `<tr>
      <td>${fmtDate(t.date)}</td>
      <td>${t.account}</td>
      <td class="fs-10 c-mut2">${t.type}</td>
      <td>${escapeHtml(t.category)}</td>
      <td>${escapeHtml(t.note || '')}</td>
      <td class="amt ${cls}">${sign}${formatCurrency(t.amount, t.currency)} ${t.currency}</td>
    </tr>`;
  }).join('');

  const netCls = totalNet >= 0 ? 'income' : 'expense';

  const expenseCount = discTx.filter(t => t.type === 'expense').length;
  const incomeCount = discTx.filter(t => t.type === 'income').length;
  const emptyMsg = t('reports.cashdisc.empty', {}, 'No bookings');
  out.innerHTML = `
    <div class="report-view">
      <div class="month-summary mb-16">
        <div class="summary-card">
          <div class="label">${t('reports.cashdisc.tile.shortfall', {}, 'Shortfalls')}</div>
          <div class="value negative">−${formatCurrency(toDisp(totalExpense), currency)}<span class="cur">${currency}</span></div>
          <div class="meta">${t('reports.cashdisc.tile.bookings_n', { n: expenseCount }, `${expenseCount} bookings`)}</div>
        </div>
        <div class="summary-card">
          <div class="label">${t('reports.cashdisc.tile.surplus', {}, 'Surpluses')}</div>
          <div class="value positive">+${formatCurrency(toDisp(totalIncome), currency)}<span class="cur">${currency}</span></div>
          <div class="meta">${t('reports.cashdisc.tile.bookings_n', { n: incomeCount }, `${incomeCount} bookings`)}</div>
        </div>
        <div class="summary-card">
          <div class="label">${t('reports.cashdisc.tile.net', {}, 'Net Balance')}</div>
          <div class="value ${totalNet >= 0 ? 'positive' : 'negative'}">${totalNet >= 0 ? '+' : '−'}${formatCurrency(Math.abs(toDisp(totalNet)), currency)}<span class="cur">${currency}</span></div>
          <div class="meta">${t('reports.cashdisc.tile.bookings_total', { n: discTx.length }, `${discTx.length} bookings total`)}</div>
        </div>
      </div>

      <h4 class="mt-16">${t('reports.cashdisc.section.yearly', {}, 'Per Year')}</h4>
      <div class="table-wrap">
        <table class="tx-table">
          <thead><tr><th>${t('reports.cashdisc.col.year', {}, 'Year')}</th><th>${t('reports.cashdisc.col.count', {}, 'Count')}</th><th>${t('reports.cashdisc.col.shortfall', {}, 'Shortfalls')}</th><th>${t('reports.cashdisc.col.surplus', {}, 'Surpluses')}</th><th>${t('reports.cashdisc.col.net', {}, 'Net')}</th></tr></thead>
          <tbody>${yearRows || `<tr><td colspan="5" class="c-mut2">${emptyMsg}</td></tr>`}</tbody>
        </table>
      </div>

      <h4 class="mt-24">${t('reports.cashdisc.section.detail', {}, 'Single Bookings')}</h4>
      <div class="table-wrap">
        <table class="tx-table">
          <thead><tr><th>${t('reports.cashdisc.col.date', {}, 'Date')}</th><th>${t('reports.cashdisc.col.account', {}, 'Account')}</th><th>${t('reports.cashdisc.col.type', {}, 'Type')}</th><th>${t('reports.cashdisc.col.category', {}, 'Category')}</th><th>${t('reports.cashdisc.col.note', {}, 'Note')}</th><th>${t('reports.cashdisc.col.amount', {}, 'Amount')}</th></tr></thead>
          <tbody>${txRows || `<tr><td colspan="6" class="c-mut2">${emptyMsg}</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── Cashflow Forecast Report (F3) ────────────────────────────────────────
//
// Deterministic 90-day projection from data/scheduled.csv. Expands each active
// recurring template forward via its `frequency` (monthly:<day> or
// weekly:<weekday>) and aggregates into 30/60/90-day cashflow buckets. Pass-
// through accounts (configured pass-through aliases) contribute both the expense leg and the
// auto-reimbursement income leg, so they net to zero in the cashflow curve
// while staying visible in the volume figures.

const CASHFORECAST_WEEKDAY_MAP = {
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
  sun: 0, sunday: 0,
};

// Parse an 'MM-DD' token → [month 1-12, day 1-31], or null when malformed
// (mirrors cron_sched._parse_md; day capping happens at the call sites).
function cashforecastParseMd(spec) {
  const parts = String(spec).split('-');
  if (parts.length !== 2) return null;
  const month = parseInt(parts[0], 10);
  const day = parseInt(parts[1], 10);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return [month, day];
}

// Return the next occurrence date strictly AFTER `fromDate` for the given
// frequency string. Mirrors scripts/cron_sched.py:calculate_next_run logic
// (DR-M7: yearly:/quarterly: were missing here although cron_sched and
// scheduled.csv support them — quarterly entries lost occurrences in the
// 90d window and were reported as 'unrecognized').
function cashforecastAdvance(frequency, fromDate) {
  if (!frequency) return null;
  const f = String(frequency).trim();

  if (f.startsWith('weekly:')) {
    const name = f.slice(7).trim().toLowerCase();
    const target = CASHFORECAST_WEEKDAY_MAP[name];
    if (target === undefined) return null; // Unknown weekday -> skip
    const d = new Date(fromDate);
    let daysAhead = (target - d.getDay() + 7) % 7;
    if (daysAhead === 0) daysAhead = 7; // Always next occurrence
    d.setDate(d.getDate() + daysAhead);
    return d;
  }

  if (f.startsWith('yearly:')) {
    const md = cashforecastParseMd(f.slice(7).trim());
    if (!md) return null;
    const [month, day] = md;
    const from = new Date(fromDate);
    // Try this calendar year first; if the target has already passed,
    // roll to next year. Day capped so yearly:02-29 lands on Feb 28
    // outside leap years.
    for (const year of [from.getFullYear(), from.getFullYear() + 1]) {
      const lastDay = new Date(year, month, 0).getDate();
      const candidate = new Date(year, month - 1, Math.min(day, lastDay));
      if (candidate > from) return candidate;
    }
    return null;
  }

  if (f.startsWith('quarterly:')) {
    const md = cashforecastParseMd(f.slice(10).trim());
    if (!md) return null;
    const [anchorMonth, day] = md;
    // MM anchors the set of 4 months sharing the same offset within a
    // quarter (03 → Mar/Jun/Sep/Dec). Walk chronologically for the first
    // candidate strictly after fromDate.
    const months = [0, 1, 2, 3]
      .map((k) => ((anchorMonth - 1 + 3 * k) % 12) + 1)
      .sort((a, b) => a - b);
    const from = new Date(fromDate);
    for (const year of [from.getFullYear(), from.getFullYear() + 1]) {
      for (const month of months) {
        const lastDay = new Date(year, month, 0).getDate();
        const candidate = new Date(year, month - 1, Math.min(day, lastDay));
        if (candidate > from) return candidate;
      }
    }
    return null;
  }

  if (!f.startsWith('monthly:')) return null;
  const spec = f.slice(8).trim();

  const d = new Date(fromDate);
  const nextMonth = d.getMonth() === 11 ? 0 : d.getMonth() + 1;
  const nextYear = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
  const lastDay = new Date(nextYear, nextMonth + 1, 0).getDate();

  let day;
  if (spec === 'last') {
    day = lastDay;
  } else {
    const n = parseInt(spec, 10);
    if (!Number.isFinite(n)) return null;
    day = Math.min(n, lastDay); // Cap day-31 in February etc.
  }
  return new Date(nextYear, nextMonth, day);
}

function cashforecastIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function cashforecastFormatShort(d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function cashforecastMedian(arr) {
  if (!arr || !arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function cashforecastPercentile(arr, p) {
  if (!arr || !arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

// Income categories modeled separately via user-adjustable occurrence counts
// (because they're lumpy and don't fit a smooth rolling avg). Built per call
// so it picks up the current businesses.json — for each configured entity we
// model its dividends + reimbursement separately, and Interest is universal.
function getCashforecastSpecialIncome() {
  const items = [];
  for (const e of getBusinessEntities()) {
    const ic = e.income_categories || {};
    if (ic.dividends) {
      items.push({ cat: ic.dividends, key: `${e.id}_div`, label: `${e.label} Div.` });
    }
    if (ic.reimbursement) {
      items.push({ cat: ic.reimbursement, key: `${e.id}_reimb`, label: `${e.label} Reimb.` });
    }
  }
  // Interest is universal, not business-specific.
  items.push({ cat: 'Income:Interest', key: 'int', label: 'Interest' });
  return items;
}

async function renderCashflowForecastReport() {
  const out = document.getElementById('report-output');

  // Read persisted user inputs for the 3 special income categories. Empty
  // string / non-integer -> "not set yet", use computed default.
  const readCount = (key) => {
    const raw = out.getAttribute('data-cf-' + key);
    if (raw == null || raw === '') return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const specialIncome = getCashforecastSpecialIncome();
  const userCounts = Object.fromEntries(specialIncome.map(s => [s.key, readCount(s.key)]));

  out.innerHTML = `<div class="report-view"><div class="report-section"><div class="c-mut2">Loading scheduled transactions…</div></div></div>`;

  let scheduled = [];
  try {
    const res = await fetch('/api/scheduled/list', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      scheduled = Array.isArray(data) ? data : (data && data.scheduled) || [];
    }
  } catch (e) { /* no scheduled data available */ }

  destroyReportCharts();

  const active = (scheduled || []).filter(s => String(s.active).toLowerCase() === 'true');
  const cur = displayCurrency;

  // ── Reference maps ─────────────────────────────────────────────────────
  const passThroughMap = {};
  for (const a of state.accounts || []) {
    if (a.type === 'pass_through' && a.pass_through_payee) passThroughMap[a.alias] = a.pass_through_payee;
  }

  const categoryTypeMap = {};
  for (const c of state.categories || []) {
    if (c.path) categoryTypeMap[c.path] = c.type;
  }

  // Categories already covered by an active scheduled template. Those drop
  // out of the statistical projection baseline so we don't double-count
  // between the Scheduled layer and the Projection layer.
  const scheduledCats = new Set();
  for (const s of active) {
    if (s.category) scheduledCats.add(s.category);
  }

  // The 3 special income categories (Dividends / K-Reimbursements / Interest)
  // that use user-adjustable occurrence counts instead of a smooth average.
  const SPECIAL_CAT_SET = new Set(specialIncome.map(s => s.cat));

  // ── Horizon ────────────────────────────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 90);
  const HORIZON_DAYS = 90;

  // ── Starting balance: current net position in display currency ─────────
  // Excludes pass-through (always 0) and custody (not personal wealth).
  let startingBalance = 0;
  for (const a of (state.accounts || [])) {
    if (a.owner !== 'self' || a.status !== 'active') continue;
    if (a.type === 'pass_through') continue;
    startingBalance += convertTo(state.balances[a.alias] || 0, a.currency, cur);
  }

  // ── Expand scheduled occurrences in the 90-day window ──────────────────
  const occurrences = [];
  const invalidFreq = [];
  for (const s of active) {
    if (!s.next_run) continue;
    const nextRunDate = new Date(s.next_run + 'T00:00:00');
    if (Number.isNaN(nextRunDate.getTime())) continue;

    let safety = 0;
    let walker = new Date(nextRunDate);
    while (walker <= horizon && safety < 400) {
      safety++;
      if (walker >= today) occurrences.push({ date: new Date(walker), entry: s });
      const next = cashforecastAdvance(s.frequency, walker);
      if (!next || next <= walker) {
        invalidFreq.push(s);
        break;
      }
      walker = next;
    }
  }

  // Bucket scheduled into byDate + 30/60/90 horizon buckets. Type comes from
  // the category (matches cron_sched.py behavior post-fix).
  const byDate = {};
  const buckets = {
    30: { income: 0, expense: 0, count: 0 },
    60: { income: 0, expense: 0, count: 0 },
    90: { income: 0, expense: 0, count: 0 },
  };
  // Pass-through volume: amount flowing through pass-through accounts
  // (business reimbursable spend), which nets to 0 cashflow but useful to
  // see separately for planning.
  const ptVolume = {
    30: { total: 0, byAccount: {}, count: 0 },
    60: { total: 0, byAccount: {}, count: 0 },
    90: { total: 0, byAccount: {}, count: 0 },
  };
  for (const occ of occurrences) {
    const amtRaw = Number(occ.entry.amount || 0);
    if (!Number.isFinite(amtRaw) || amtRaw <= 0) continue;
    const amt = convertTo(amtRaw, occ.entry.currency || 'TZS', cur);
    const ds = cashforecastIsoDate(occ.date);
    if (!byDate[ds]) byDate[ds] = { income: 0, expense: 0, items: [] };

    const isPT = Object.prototype.hasOwnProperty.call(passThroughMap, occ.entry.account);
    const isIncome = categoryTypeMap[occ.entry.category] === 'income';

    if (isPT) {
      byDate[ds].expense += amt;
      byDate[ds].income += amt;
    } else if (isIncome) {
      byDate[ds].income += amt;
    } else {
      byDate[ds].expense += amt;
    }
    byDate[ds].items.push({ ...occ.entry, _amt: amt, _isPT: isPT, _isIncome: isIncome });

    const daysOut = Math.round((occ.date - today) / 86400000);
    for (const h of [30, 60, 90]) {
      if (daysOut <= h) {
        if (isPT) {
          buckets[h].expense += amt;
          buckets[h].income += amt;
          ptVolume[h].total += amt;
          ptVolume[h].count++;
          ptVolume[h].byAccount[occ.entry.account] = (ptVolume[h].byAccount[occ.entry.account] || 0) + amt;
        } else if (isIncome) {
          buckets[h].income += amt;
        } else {
          buckets[h].expense += amt;
        }
        buckets[h].count++;
      }
    }
  }

  // ── Historical analysis (last 24 months for seasonality, 12 for stats) ─
  // The projection baseline models the user's personal cashflow, so we
  // exclude pass-through accounts (business reimbursable flow) — those are
  // already surfaced separately in the Pass-Through Volume section and
  // don't affect the user's real bank balance.
  const custodyAliases = getCustodyAliases();
  const nonPnlCats = getNonPnlCategories();
  const ptAliases = new Set(Object.keys(passThroughMap));

  const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthsBack24 = [];
  for (let i = 24; i >= 1; i--) {
    const d = new Date(firstOfThisMonth);
    d.setMonth(d.getMonth() - i);
    monthsBack24.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthSet24 = new Set(monthsBack24);
  const last12 = monthsBack24.slice(-12);
  const last12Set = new Set(last12);

  // Per-YM totals for non-scheduled / non-special / operational TX
  const monthlyExpense = {};
  const monthlyIncomeNonSpecial = {};
  const specialStats = {}; // cat -> { amounts: [], count: N }
  for (const s of specialIncome) specialStats[s.cat] = { amounts: [], count: 0 };

  for (const t of (state.tx || [])) {
    if (!t.date) continue;
    const ym = t.date.slice(0, 7);
    if (!monthSet24.has(ym)) continue;
    if (!isOperationalTx(t, custodyAliases, nonPnlCats)) continue;
    if (ptAliases.has(t.account)) continue; // pass-through flow, not user's cashflow
    if (scheduledCats.has(t.category)) continue; // Covered by Scheduled layer

    const amt = convertTo(Number(t.amount) || 0, t.currency || 'TZS', cur);

    if (t.type === 'expense') {
      monthlyExpense[ym] = (monthlyExpense[ym] || 0) + amt;
    } else if (t.type === 'income') {
      if (SPECIAL_CAT_SET.has(t.category)) {
        if (last12Set.has(ym)) {
          specialStats[t.category].amounts.push(amt);
          specialStats[t.category].count++;
        }
      } else {
        monthlyIncomeNonSpecial[ym] = (monthlyIncomeNonSpecial[ym] || 0) + amt;
      }
    }
  }

  // Overall 12-month percentiles for the confidence band
  const last12ExpTotals = last12.map(ym => monthlyExpense[ym] || 0);
  const overallExpMedian = cashforecastMedian(last12ExpTotals);
  const overallExpP25 = cashforecastPercentile(last12ExpTotals, 25);
  const overallExpP75 = cashforecastPercentile(last12ExpTotals, 75);

  const last12IncTotals = last12.map(ym => monthlyIncomeNonSpecial[ym] || 0);
  const overallIncMedian = cashforecastMedian(last12IncTotals);

  // Seasonal medians: group last 24 months by calendar-month number, take
  // median. Fall back to overall median when a calendar slot has no data.
  const expByCalendarMonth = {};
  const incByCalendarMonth = {};
  for (let m = 1; m <= 12; m++) {
    expByCalendarMonth[m] = [];
    incByCalendarMonth[m] = [];
  }
  for (const ym of monthsBack24) {
    const mm = parseInt(ym.slice(5, 7), 10);
    expByCalendarMonth[mm].push(monthlyExpense[ym] || 0);
    incByCalendarMonth[mm].push(monthlyIncomeNonSpecial[ym] || 0);
  }
  const expMedianByMonth = {};
  const incMedianByMonth = {};
  for (let m = 1; m <= 12; m++) {
    expMedianByMonth[m] = expByCalendarMonth[m].length ? cashforecastMedian(expByCalendarMonth[m]) : overallExpMedian;
    incMedianByMonth[m] = incByCalendarMonth[m].length ? cashforecastMedian(incByCalendarMonth[m]) : overallIncMedian;
  }

  // Special income stats (last 12 months) — used for toolbar + projection
  const specialInfo = specialIncome.map(s => {
    const stats = specialStats[s.cat];
    const medAmt = cashforecastMedian(stats.amounts);
    const defaultCount = Math.max(0, Math.round(stats.count * HORIZON_DAYS / 365));
    const userVal = userCounts[s.key];
    const appliedCount = userVal != null ? userVal : defaultCount;
    return { ...s, count12mo: stats.count, medianAmount: medAmt, defaultCount, appliedCount };
  });

  const specialDailyContribution = specialInfo.reduce(
    (sum, info) => sum + (info.appliedCount * info.medianAmount) / HORIZON_DAYS, 0,
  );

  // ── Build curves: scheduled / projection / P25 band / P75 band ────────
  const labels = [];
  const cumScheduled = [];
  const cumProjected = [];
  const cumOptimistic = []; // Low-expense scenario = UPPER band
  const cumPessimistic = []; // High-expense scenario = LOWER band
  const dailyNet = [];

  let runSched = startingBalance;
  let runProj = startingBalance;
  let runOpt = startingBalance;
  let runPes = startingBalance;

  // Scale factors for P25/P75: apply the overall P25/P75 ratio to the
  // seasonal month-specific median, so we keep seasonality in the band too.
  const expScaleP25 = overallExpMedian > 0 ? overallExpP25 / overallExpMedian : 1;
  const expScaleP75 = overallExpMedian > 0 ? overallExpP75 / overallExpMedian : 1;

  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const ds = cashforecastIsoDate(d);
    labels.push(cashforecastFormatShort(d));

    const dayEntry = byDate[ds];
    const schedNet = dayEntry ? (dayEntry.income - dayEntry.expense) : 0;
    dailyNet.push(schedNet);

    runSched += schedNet;
    cumScheduled.push(runSched);

    if (i === 0) {
      runProj += schedNet;
      runOpt += schedNet;
      runPes += schedNet;
      cumProjected.push(runProj);
      cumOptimistic.push(runOpt);
      cumPessimistic.push(runPes);
      continue;
    }

    const month = d.getMonth() + 1;
    const daysInMonth = new Date(d.getFullYear(), month, 0).getDate();
    const dailyExp = expMedianByMonth[month] / daysInMonth;
    const dailyInc = incMedianByMonth[month] / daysInMonth;
    const commonDelta = schedNet + specialDailyContribution + dailyInc;

    runProj += commonDelta - dailyExp;
    cumProjected.push(runProj);

    const dailyExpLow = (expMedianByMonth[month] * expScaleP25) / daysInMonth;
    const dailyExpHigh = (expMedianByMonth[month] * expScaleP75) / daysInMonth;
    runOpt += commonDelta - dailyExpLow;
    runPes += commonDelta - dailyExpHigh;
    cumOptimistic.push(runOpt);
    cumPessimistic.push(runPes);
  }

  // ── Upcoming scheduled rows (table) ────────────────────────────────────
  const rows = [];
  for (const occ of occurrences) {
    const amtRaw = Number(occ.entry.amount || 0);
    if (!Number.isFinite(amtRaw) || amtRaw <= 0) continue;
    const amt = convertTo(amtRaw, occ.entry.currency || 'TZS', cur);
    const isPT = Object.prototype.hasOwnProperty.call(passThroughMap, occ.entry.account);
    const isIncome = categoryTypeMap[occ.entry.category] === 'income';
    rows.push({
      date: cashforecastIsoDate(occ.date),
      name: occ.entry.name || occ.entry.payee || occ.entry.sched_id,
      account: occ.entry.account,
      amount: amt,
      amountOrig: amtRaw,
      currency: occ.entry.currency || 'TZS',
      isPT,
      isIncome,
      category: occ.entry.category || '',
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  // ── KPI cell: scheduled end-balance + projection end-balance ──────────
  const kpi = (h) => {
    const b = buckets[h];
    const schedEnd = cumScheduled[h];
    const projEnd = cumProjected[h];
    const schedNet = b.income - b.expense;
    return `
      <div class="income-cell">
        <div class="ic-label">${h} days</div>
        <div class="ic-value ${schedEnd >= 0 ? 'c-pos' : 'c-neg'}">${formatCurrency(schedEnd, cur)}<span class="ic-cur">${cur}</span></div>
        <div class="ic-count">Scheduled end-balance · ${b.count} TX · net ${schedNet >= 0 ? '+' : ''}${formatCurrency(schedNet, cur)}</div>
        <div class="ic-count" style="margin-top:4px;padding-top:4px;border-top:1px dashed var(--border);">
          With projection: <span class="${projEnd >= 0 ? 'c-pos' : 'c-neg'}">${formatCurrency(projEnd, cur)}</span> ${cur}
        </div>
      </div>
    `;
  };

  // ── Toolbar for special income counts ──────────────────────────────────
  const toolbar = `
    <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;">
      ${specialInfo.map(info => `
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label class="label-sm">${info.label}</label>
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="number" min="0" max="50" step="1" class="cf-input" data-key="${info.key}" value="${info.appliedCount}" style="width:64px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);">
            <span class="c-mut2 fs-11">
              × ${formatCurrency(info.medianAmount, cur)} ${cur}
              <br><span style="opacity:0.7;">hist: ${info.count12mo}/12mo · default ${info.defaultCount}</span>
            </span>
          </div>
        </div>
      `).join('')}
      <button id="cf-reset" style="padding:6px 12px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);cursor:pointer;">Reset defaults</button>
    </div>
  `;

  const invalidFreqRows = invalidFreq.length > 0
    ? `<div class="report-section"><div class="c-mut2 fs-12">Skipped (unrecognized frequency): ${invalidFreq.map(s => escapeHtml(s.sched_id + ' ' + (s.frequency || ''))).join(', ')}</div></div>`
    : '';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-section">
        <div class="report-section-title">Projection parameters</div>
        ${toolbar}
      </div>
      <div class="report-section">
        <div class="report-section-title">Projected Net Position — ${cur}</div>
        <div class="income-grid">
          ${kpi(30)}
          ${kpi(60)}
          ${kpi(90)}
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">Cumulative Net Position (start ${formatCurrency(startingBalance, cur)} ${cur}, +90 days)</div>
        <div class="chart-canvas-box" style="height:360px;"><canvas id="cashforecast-chart"></canvas></div>
        <details class="c-mut2" style="font-size:12px;margin-top:8px;line-height:1.6;">
          <summary class="ptr fw-600 c-text">How this forecast is calculated</summary>
          <div class="mt-8">
            <strong>Starting point:</strong> ${formatCurrency(startingBalance, cur)} ${cur} — the sum of your own active non-pass-through accounts right now, converted to ${cur}.<br><br>
            <strong>① Scheduled layer (solid line):</strong> ${active.length} active scheduled templates expanded forward over 90 days — concrete, dated, certain events. Pass-through templates count both legs (expense + auto-reimbursement) so their net cashflow is zero. Income direction is derived from the category's type.<br><br>
            <strong>② Projection layer (dashed line):</strong> adds a statistical baseline on top of the Scheduled layer for categories NOT already covered by a scheduled template. Specifically:
            <ul style="margin:4px 0 4px 20px;padding:0;">
              <li><strong>Expenses:</strong> median of the last 12 months' totals per calendar month (so May uses May-history median for seasonal realism). Excludes pass-through accounts (business reimbursable flow isn't your cashflow), ${scheduledCats.size} category already covered by active scheduled templates, and the ${specialIncome.length} special income categories. Overall median ${formatCurrency(overallExpMedian, cur)} ${cur}/mo.</li>
              <li><strong>Variable income:</strong> same seasonal-median treatment, overall median ${formatCurrency(overallIncMedian, cur)} ${cur}/mo.</li>
              <li><strong>Special income (user-adjustable above):</strong> ${specialInfo.map(i => `${i.label} ${i.appliedCount}× @ ${formatCurrency(i.medianAmount, cur)}`).join(' · ')}. Median amount computed from last 12 months of each category; count defaults are proportional to horizon but you can override.</li>
            </ul>
            <strong>③ Confidence band:</strong> shaded area = realistic range where your expenses could fall within historical variance. Upper bound uses P25 monthly expenses (optimistic months), lower bound uses P75 (pessimistic months). P25 ${formatCurrency(overallExpP25, cur)} · P75 ${formatCurrency(overallExpP75, cur)} ${cur}/mo.<br><br>
            <strong>Not counted in cashflow:</strong> pass-through TX (business reimbursable money, shown separately below · Volume section). They don't affect your personal bank balance even though they run through your pass-through accounts.<br><br>
            <strong>Essential vs. luxury:</strong> not used in this report (this is a cashflow forecast, not an essentials-only view). For the essentials-only runway analysis, see the Cash Runway report.
          </div>
        </details>
      </div>
      ${ptVolume[90].count > 0 ? `
      <div class="report-section">
        <div class="report-section-title">Pass-Through Volume <span class="hint">business reimbursable flow — not counted in cashflow above</span></div>
        <div class="income-grid">
          ${[30, 60, 90].map(h => {
            const pv = ptVolume[h];
            const accList = Object.entries(pv.byAccount).sort((a, b) => b[1] - a[1])
              .map(([a, v]) => `${escapeHtml(a)} ${formatCurrency(v, cur)}`).join(' · ');
            return `
              <div class="income-cell">
                <div class="ic-label">${h} days</div>
                <div class="ic-value c-mut">${formatCurrency(pv.total, cur)}<span class="ic-cur">${cur}</span></div>
                <div class="ic-count">${pv.count} TX · ${accList || '—'}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      ` : ''}
      <div class="report-section">
        <div class="report-section-title">Upcoming Scheduled Transactions (${rows.length})</div>
        <table class="tx-table">
          <thead><tr><th>Date</th><th>Template</th><th>Account</th><th>Category</th><th class="amt">Amount</th></tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${escapeHtml(r.date)}</td>
                <td><strong>${escapeHtml(r.name)}</strong>${r.isPT ? ' <span class="tag">pass-through</span>' : r.isIncome ? ' <span class="tag c-pos">income</span>' : ''}</td>
                <td>${escapeHtml(r.account)}</td>
                <td class="cat">${escapeHtml(r.category)}</td>
                <td class="amt">${formatCurrency(r.amount, cur)} ${cur}${r.currency !== cur ? ` <span class="c-mut2">(${formatCurrency(r.amountOrig, r.currency)} ${r.currency})</span>` : ''}</td>
              </tr>
            `).join('') || '<tr><td colspan="5" class="c-mut2">No occurrences in the next 90 days.</td></tr>'}
          </tbody>
        </table>
      </div>
      ${invalidFreqRows}
    </div>
  `;

  // Wire up the toolbar inputs: each change persists to dataset + re-renders
  out.querySelectorAll('.cf-input').forEach(input => {
    input.addEventListener('change', () => {
      const key = input.getAttribute('data-key');
      const n = parseInt(input.value, 10);
      const val = Number.isFinite(n) && n >= 0 ? n : 0;
      out.setAttribute('data-cf-' + key, String(val));
      renderCashflowForecastReport();
    });
  });
  const resetBtn = document.getElementById('cf-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      // Clear every persisted user-override regardless of which businesses
      // are currently configured — covers the case where an entity was
      // removed from businesses.json but stale data-cf-* attributes remain.
      for (const s of specialIncome) {
        out.removeAttribute('data-cf-' + s.key);
      }
      renderCashflowForecastReport();
    });
  }

  // ── Chart ──────────────────────────────────────────────────────────────
  // Order matters for fill: band (upper + lower with fill=-1) sits behind
  // the main lines. Scheduled = solid violet. Projection = dashed blue.
  const ctx = document.getElementById('cashforecast-chart');
  if (ctx) {
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Optimistic (P25 expenses)',
            data: cumOptimistic,
            borderColor: chartTint(chartPalette()[3], 0.25),
            backgroundColor: 'transparent',
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
          },
          {
            label: 'Pessimistic (P75 expenses)',
            data: cumPessimistic,
            borderColor: chartTint(chartPalette()[3], 0.25),
            backgroundColor: chartTint(chartPalette()[3], 0.12),
            borderWidth: 1,
            pointRadius: 0,
            fill: '-1',
            tension: 0.15,
          },
          {
            label: 'Scheduled only',
            data: cumScheduled,
            borderColor: chartPalette()[2],
            backgroundColor: 'transparent',
            borderWidth: 2,
            fill: false,
            tension: 0.15,
            pointRadius: dailyNet.map(n => n !== 0 ? 4 : 0),
            pointBackgroundColor: dailyNet.map(n => n > 0 ? cssVar('--positive') : n < 0 ? cssVar('--negative') : 'transparent'),
            pointBorderColor: 'transparent',
          },
          {
            label: 'With projection (median)',
            data: cumProjected,
            borderColor: chartPalette()[3],
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [6, 4],
            fill: false,
            tension: 0.15,
            pointRadius: 0,
          },
        ],
      },
      options: {
        ...CHART_BASE,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              usePointStyle: true,
              pointStyle: 'line',
              padding: 12,
              font: { size: 11 },
              filter: (item) => item.text !== 'Optimistic (P25 expenses)', // Hide one band line from legend
            },
          },
          tooltip: {
            callbacks: {
              label: (c) => {
                const v = c.parsed.y;
                return `${c.dataset.label}: ${formatCurrency(v, cur)} ${cur}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxTicksLimit: 10, autoSkip: true },
          },
          y: {
            ticks: currencyTicks(cur),
            grid: {
              color: (c) => c.tick.value === 0 ? chartTint(cssVar('--negative'), 0.5) : cssVar('--chart-grid'),
              lineWidth: (c) => c.tick.value === 0 ? 2 : 1,
            },
          },
        },
      },
    });
    reportCharts.push(chart);
  }
}


// ─── Budget vs. Actual Report ────────────────────────────────────────────

