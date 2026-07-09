// ─── Savings Rate Trend Report ────────────────────────────────────────────

function renderSavingsRateReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();

  const tb = reportToolbar(out, 'sr', [
    { key: 'cur', label: t('reports.toolbar.currency', {}, 'Currency'),
      options: reportCurrencies(), def: 'TZS' },
    { key: 'year', label: t('reports.toolbar.year', {}, 'Year'),
      options: [{ v: 'all', l: t('reports.toolbar.all_years', {}, 'All Years') }, ...years], def: 'all' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="sr-content"></div>
    </div>
  `;

  function update() {
    destroyReportCharts();
    const currency = tb.get('cur');
    const yearFilter = tb.get('year');
    const yearsToScan = yearFilter === 'all' ? years : [yearFilter];

    // Collect all months across selected years
    const custodyAliases = getCustodyAliases();
    const nonPnl = getNonPnlCategories();
    const allMonths = [];
    for (const year of yearsToScan) {
      for (let m = 1; m <= 12; m++) {
        const ym = `${year}-${String(m).padStart(2, '0')}`;
        let income = 0, expense = 0;
        for (const t of state.tx) {
          if (!t.date || !t.date.startsWith(ym)) continue;
          if (!isOperationalTx(t, custodyAliases, nonPnl)) continue;
          const amt = convertTo(t.amount, t.currency, currency);
          if (t.type === 'income') income += amt;
          else if (t.type === 'expense') expense += amt;
        }
        if (income > 0 || expense > 0) {
          const savings = income - expense;
          const rate = income > 0 ? (savings / income * 100) : 0;
          allMonths.push({ ym, label: monthLabel(ym), income, expense, savings, rate });
        }
      }
    }

    const avgRate = allMonths.length > 0 ? allMonths.reduce((s, m) => s + m.rate, 0) / allMonths.length : 0;
    const bestMonth = allMonths.reduce((best, m) => m.rate > (best?.rate || -999) ? m : best, null);
    const worstMonth = allMonths.reduce((worst, m) => m.rate < (worst?.rate || 999) ? m : worst, null);

    const content = document.getElementById('sr-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.savingsRate.section.title', { currency }, `Savings Rate — ${currency}`)}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.savingsRate.tile.avg', {}, 'Average Savings Rate')}</div>
            <div class="ic-value" style="color:${avgRate >= 0 ? 'var(--positive)' : 'var(--negative)'}">${avgRate.toFixed(1)}%</div>
            <div class="ic-count">${t('reports.savingsRate.tile.avg_count', { n: allMonths.length }, `${allMonths.length} months tracked`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.savingsRate.tile.best', {}, 'Best Month')}</div>
            <div class="ic-value c-pos">${bestMonth ? bestMonth.rate.toFixed(1) + '%' : '—'}</div>
            <div class="ic-count">${bestMonth ? bestMonth.label : ''}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.savingsRate.tile.worst', {}, 'Worst Month')}</div>
            <div class="ic-value c-neg">${worstMonth ? worstMonth.rate.toFixed(1) + '%' : '—'}</div>
            <div class="ic-count">${worstMonth ? worstMonth.label : ''}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.savingsRate.chart.over_time', {}, 'Savings Rate Over Time')}</div>
          <div class="chart-canvas-box" style="height:320px;"><canvas id="sr-line-chart"></canvas></div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.savingsRate.chart.monthly_incexp', {}, 'Monthly Income vs. Expenses')}</div>
          <div class="chart-canvas-box" style="height:300px;"><canvas id="sr-bar-chart"></canvas></div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.savingsRate.section.monthly_detail', {}, 'Monthly Detail')}</div>
        <table class="tx-table"><thead><tr><th>${t('common.label.month', {}, 'Month')}</th><th class="amt">${t('common.label.income', {}, 'Income')}</th><th class="amt">${t('common.label.expenses', {}, 'Expenses')}</th><th class="amt">${t('reports.savingsRate.col.savings', {}, 'Savings')}</th><th class="amt">${t('reports.savingsRate.col.rate', {}, 'Rate')}</th></tr></thead><tbody>
          ${[...allMonths].reverse().map(m => `<tr>
            <td>${m.label}</td>
            <td class="amt income">${formatCurrency(m.income, currency)}</td>
            <td class="amt expense">${formatCurrency(m.expense, currency)}</td>
            <td class="amt" style="color:${m.savings >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(m.savings, currency)}</td>
            <td class="amt" style="color:${m.rate >= 0 ? 'var(--positive)' : 'var(--negative)'}; font-weight:500">${m.rate.toFixed(1)}%</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
    `;

    // Line chart — savings rate
    const lineCtx = document.getElementById('sr-line-chart');
    if (lineCtx) {
      const chart = new Chart(lineCtx, {
        type: 'line',
        data: {
          labels: allMonths.map(m => m.label),
          datasets: [
            {
              label: t('reports.savingsRate.dataset.rate', {}, 'Savings Rate %'),
              data: allMonths.map(m => m.rate),
              borderColor: cssVar('--accent'),
              backgroundColor: cssVar('--accent-glow'),
              fill: true,
              tension: 0.35,
              pointRadius: 3,
              pointHoverRadius: 6,
              borderWidth: 2.5,
            },
            {
              label: t('reports.savingsRate.dataset.zero_line', {}, '0% Line'),
              data: allMonths.map(() => 0),
              borderColor: cssVar('--muted'),
              borderDash: [4, 4],
              borderWidth: 1,
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.dataset.label === t('reports.savingsRate.dataset.zero_line', {}, '0% Line') ? null : ctx.raw.toFixed(1) + '%' } } },
          scales: { x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } }, y: { ticks: { callback: v => v + '%' }, grid: { color: cssVar('--chart-grid') } } },
          interaction: { mode: 'index', intersect: false },
        },
      });
      reportCharts.push(chart);
    }

    // Bar chart — income vs expenses
    const barCtx = document.getElementById('sr-bar-chart');
    if (barCtx) {
      const chart = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: allMonths.map(m => m.label),
          datasets: [
            { label: t('common.label.income', {}, 'Income'), data: allMonths.map(m => m.income), backgroundColor: cssVar('--positive'), borderWidth: 0, borderRadius: 2 },
            { label: t('common.label.expenses', {}, 'Expenses'), data: allMonths.map(m => m.expense), backgroundColor: cssVar('--negative'), borderWidth: 0, borderRadius: 2 },
          ],
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, currency) + ' ' + currency } } },
          scales: { x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } }, y: { ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } } },
        },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}

// ─── Subscription Tracker Report ──────────────────────────────────────────

function renderSubscriptionReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();

  const tb = reportToolbar(out, 'sub', [
    { key: 'year', label: t('reports.toolbar.year', {}, 'Year'),
      options: years, def: years[years.length - 1] || '2026' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="sub-content"></div>
    </div>
  `;

  function update() {
    destroyReportCharts();
    const year = tb.get('year');

    // Filter subscriptions (all Subscriptions:* categories)
    const custodyAliases = getCustodyAliases();
    const subTx = state.tx.filter(tx =>
      tx.type === 'expense' && tx.category && tx.category.startsWith('Subscriptions:') && tx.date && tx.date.startsWith(year) && !custodyAliases.has(tx.account)
    );

    // Group by payee — convert all to display currency
    const cur = displayCurrency;
    const byPayee = {};
    for (const tx of subTx) {
      const key = tx.payee || tx.category;
      if (!byPayee[key]) byPayee[key] = { total: 0, count: 0, category: tx.category, months: new Set() };
      byPayee[key].total += convertTo(tx.amount, tx.currency, cur);
      byPayee[key].count++;
      byPayee[key].months.add(tx.date.slice(5, 7));
    }

    const sorted = Object.entries(byPayee).map(([name, d]) => ({
      name, ...d,
      avgPerMonth: d.months.size > 0 ? d.total / d.months.size : 0,
      monthCount: d.months.size,
    })).sort((a, b) => b.total - a.total);

    const grandTotal = sorted.reduce((s, p) => s + p.total, 0);
    const monthlyEst = sorted.reduce((s, p) => s + (p.monthCount > 0 ? p.total / p.monthCount : 0), 0);

    // Monthly totals for chart
    const englishMonthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const names = englishMonthShort.map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
    const monthlyTotals = new Array(12).fill(0);
    for (const tx of subTx) {
      const m = parseInt(tx.date.slice(5, 7), 10) - 1;
      monthlyTotals[m] += convertTo(tx.amount, tx.currency, cur);
    }

    // By subcategory for pie
    const byCat = {};
    for (const tx of subTx) {
      const sub = tx.category.split(':')[1] || tx.category;
      byCat[sub] = (byCat[sub] || 0) + convertTo(tx.amount, tx.currency, cur);
    }
    const catSorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const palette = chartPalette();

    const content = document.getElementById('sub-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${escapeHtml(t('reports.sub.title', { year, currency: cur }, `Subscriptions ${year} — ${cur}`))}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.shared.year_total', {}, 'Year Total')}</div>
            <div class="ic-value c-neg">${formatCurrency(grandTotal, cur)}<span class="ic-cur">${cur}</span></div>
            <div class="ic-count">${escapeHtml(t('reports.sub.tile_year_total_detail', { n: subTx.length, services: sorted.length }, `${subTx.length} TX across ${sorted.length} services`))}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.sub.tile_est_monthly', {}, 'Est. Monthly')}</div>
            <div class="ic-value c-warn">${formatCurrency(monthlyEst, cur)}<span class="ic-cur">${cur}</span></div>
            <div class="ic-count">${t('reports.sub.tile_est_monthly_detail', {}, 'Based on active months per service')}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.sub.chart_monthly', {}, 'Monthly Subscription Costs')}</div>
            <div class="chart-canvas-box"><canvas id="sub-bar-chart"></canvas></div>
          </div>
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.sub.chart_by_type', {}, 'By Type')}</div>
            <div class="chart-canvas-box" style="height:240px;max-width:320px;margin:0 auto;"><canvas id="sub-pie-chart"></canvas></div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.sub.all_heading', {}, 'All Subscriptions')}</div>
        <table class="tx-table"><thead><tr><th>${t('reports.sub.col_service', {}, 'Service')}</th><th>${t('common.col.category', {}, 'Category')}</th><th>${t('reports.sub.col_months_active', {}, 'Months Active')}</th><th class="amt">${t('reports.shared.avg_per_month', {}, 'Avg / Month')}</th><th class="amt">${t('reports.shared.year_total', {}, 'Year Total')}</th></tr></thead><tbody>
          ${sorted.map(s => `<tr>
            <td><strong>${escapeHtml(s.name)}</strong></td>
            <td class="cat">${escapeHtml(s.category)}</td>
            <td>${s.monthCount}</td>
            <td class="amt">${formatCurrency(s.avgPerMonth, cur)} ${cur}</td>
            <td class="amt">${formatCurrency(s.total, cur)} ${cur}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
    `;

    // Monthly bar
    const barCtx = document.getElementById('sub-bar-chart');
    if (barCtx) {
      const chart = new Chart(barCtx, {
        type: 'bar',
        data: { labels: names, datasets: [{ data: monthlyTotals, backgroundColor: chartPalette()[2], borderWidth: 0, borderRadius: 3 }] },
        options: { ...CHART_BASE,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, cur) + ' ' + cur } } },
          scales: { x: { grid: { display: false } }, y: { ticks: currencyTicks(cur), grid: { color: cssVar('--chart-grid') } } } },
      });
      reportCharts.push(chart);
    }

    // Pie by type
    const pieCtx = document.getElementById('sub-pie-chart');
    if (pieCtx && catSorted.length > 0) {
      const chart = new Chart(pieCtx, {
        type: 'doughnut',
        data: { labels: catSorted.map(([c]) => c), datasets: [{ data: catSorted.map(([, v]) => v), backgroundColor: palette.slice(0, catSorted.length), borderWidth: 2, borderColor: cssVar('--surface') }] },
        options: { ...CHART_BASE, cutout: '55%',
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => ctx.label + ': ' + formatCurrency(ctx.raw, cur) + ' ' + cur } } } },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}

// ─── Weekday vs. Weekend Report ───────────────────────────────────────────

function renderWeekdayReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();

  const tb = reportToolbar(out, 'wd', [
    { key: 'year', label: t('reports.toolbar.year', {}, 'Year'),
      options: years, def: years[years.length - 1] || '2026' },
    { key: 'cur', label: t('reports.toolbar.currency', {}, 'Currency'),
      options: reportCurrencies(), def: 'TZS' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="wd-content"></div>
    </div>
  `;

  function update() {
    destroyReportCharts();

    const year = tb.get('year');
    const currency = tb.get('cur');
    const custodyAliases = getCustodyAliases();
    const expenses = state.tx.filter(tx => tx.type === 'expense' && tx.date && tx.date.startsWith(year) && !custodyAliases.has(tx.account)).map(tx => ({ ...tx, amount: convertTo(tx.amount, tx.currency, currency) }));

    // Localized weekday names, index = JS Date.getDay() (0=Sun..6=Sat).
    const enLongFallback = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const enShortFallback = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNames = enLongFallback.map((en, i) => t(`common.weekdays.long.${i}`, {}, en));
    const dayShort = enShortFallback.map((en, i) => t(`common.weekdays.short.${i}`, {}, en));
    const byDay = new Array(7).fill(null).map(() => ({ total: 0, count: 0, topCats: {} }));

    for (const tx of expenses) {
      const d = new Date(tx.date);
      const dow = d.getDay(); // 0=Sun
      byDay[dow].total += tx.amount;
      byDay[dow].count++;
      const top = (tx.category || '').split(':')[0];
      byDay[dow].topCats[top] = (byDay[dow].topCats[top] || 0) + tx.amount;
    }

    const totalExpenses = expenses.reduce((s, tx) => s + tx.amount, 0);
    const weekdayTotal = [1,2,3,4,5].reduce((s, i) => s + byDay[i].total, 0);
    const weekendTotal = byDay[0].total + byDay[6].total;
    const weekdayCount = [1,2,3,4,5].reduce((s, i) => s + byDay[i].count, 0);
    const weekendCount = byDay[0].count + byDay[6].count;
    const weekdayAvgPerDay = weekdayCount > 0 ? weekdayTotal / weekdayCount : 0;
    const weekendAvgPerDay = weekendCount > 0 ? weekendTotal / weekendCount : 0;

    // Top category per day
    const topCatPerDay = byDay.map(d => {
      const entries = Object.entries(d.topCats).sort((a, b) => b[1] - a[1]);
      return entries[0] ? entries[0][0] : '—';
    });

    // Hourly-like: by category stacked per day
    const allCats = {};
    for (const d of byDay) for (const c of Object.keys(d.topCats)) allCats[c] = true;
    const topCats = Object.keys(allCats).sort((a, b) => {
      const totA = byDay.reduce((s, d) => s + (d.topCats[a] || 0), 0);
      const totB = byDay.reduce((s, d) => s + (d.topCats[b] || 0), 0);
      return totB - totA;
    }).slice(0, 8);

    const palette = chartPalette();

    const wdSuffix = t('reports.wd.tile.wd_suffix', {}, 'WD');
    const weSuffix = t('reports.wd.tile.we_suffix', {}, 'WE');
    const avgComparison = weekendAvgPerDay > weekdayAvgPerDay
      ? `<span class="c-neg">${t('reports.wd.tile.weekend_higher', { pct: Math.round((weekendAvgPerDay / weekdayAvgPerDay - 1) * 100) }, `Weekend ${Math.round((weekendAvgPerDay / weekdayAvgPerDay - 1) * 100)}% higher`)}</span>`
      : `<span class="c-pos">${t('reports.wd.tile.weekday_higher', {}, 'Weekday higher')}</span>`;
    const weekdayPct = totalExpenses > 0 ? Math.round(weekdayTotal / totalExpenses * 100) : 0;
    const weekendPct = totalExpenses > 0 ? Math.round(weekendTotal / totalExpenses * 100) : 0;

    const content = document.getElementById('wd-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.wd.title', { year, currency }, `Weekday vs. Weekend ${year} — ${currency}`)}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.wd.tile.weekday_spending', {}, 'Weekday Spending')}</div>
            <div class="ic-value" style="color:#1e40af">${formatCurrency(weekdayTotal, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.wd.tile.detail_of_total', { n: weekdayCount, pct: weekdayPct }, `${weekdayCount} TX · ${weekdayPct}% of total`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.wd.tile.weekend_spending', {}, 'Weekend Spending')}</div>
            <div class="ic-value c-warn">${formatCurrency(weekendTotal, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.wd.tile.detail_of_total', { n: weekendCount, pct: weekendPct }, `${weekendCount} TX · ${weekendPct}% of total`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.wd.tile.avg_per_tx', {}, 'Avg per Transaction')}</div>
            <div class="ic-value c-text">${formatCurrency(weekdayAvgPerDay, currency)}<span class="ic-cur">${wdSuffix}</span></div>
            <div class="ic-count">${t('reports.wd.tile.vs_we', { amount: formatCurrency(weekendAvgPerDay, currency), suffix: weSuffix }, `vs. ${formatCurrency(weekendAvgPerDay, currency)} ${weSuffix}`)} · ${avgComparison}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.wd.chart.total', {}, 'Total Spending by Day of Week')}</div>
            <div class="chart-canvas-box"><canvas id="wd-bar-chart"></canvas></div>
          </div>
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.wd.chart.cat_mix', {}, 'Category Mix by Day')}</div>
            <div class="chart-canvas-box"><canvas id="wd-stacked-chart"></canvas></div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.wd.chart.wd_we', {}, 'Weekday vs. Weekend')}</div>
          <div class="chart-canvas-box" style="height:220px;max-width:300px;margin:0 auto;"><canvas id="wd-pie-chart"></canvas></div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.wd.section.detail', {}, 'Day of Week Detail')}</div>
        <table class="tx-table"><thead><tr>
          <th>${t('reports.wd.col.day', {}, 'Day')}</th>
          <th class="amt">${t('reports.shared.total_label', {}, 'Total')}</th>
          <th>${t('reports.wd.col.tx', {}, 'TX')}</th>
          <th class="amt">${t('reports.wd.col.avg_per_tx', {}, 'Avg / TX')}</th>
          <th>${t('reports.wd.col.top_cat', {}, 'Top Category')}</th>
          <th class="amt">${t('reports.wd.col.pct_week', {}, '% of Week')}</th>
        </tr></thead><tbody>
          ${[1,2,3,4,5,6,0].map(i => `<tr style="${i === 0 || i === 6 ? 'background:color-mix(in srgb, var(--warn) 4%, transparent)' : ''}">
            <td><strong>${dayNames[i]}</strong></td>
            <td class="amt">${formatCurrency(byDay[i].total, currency)}</td>
            <td>${byDay[i].count}</td>
            <td class="amt">${byDay[i].count > 0 ? formatCurrency(byDay[i].total / byDay[i].count, currency) : '—'}</td>
            <td class="cat">${topCatPerDay[i]}</td>
            <td class="amt">${totalExpenses > 0 ? (byDay[i].total / totalExpenses * 100).toFixed(1) + '%' : '—'}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
    `;

    // Bar chart by day
    const barCtx = document.getElementById('wd-bar-chart');
    if (barCtx) {
      const orderedDays = [1,2,3,4,5,6,0];
      const chart = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: orderedDays.map(i => dayShort[i]),
          datasets: [{ data: orderedDays.map(i => byDay[i].total),
            backgroundColor: orderedDays.map(i => i === 0 || i === 6 ? chartPalette()[1] : chartPalette()[0]),
            borderWidth: 0, borderRadius: 4 }],
        },
        options: { ...CHART_BASE,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, currency) + ' ' + currency } } },
          scales: { x: { grid: { display: false } }, y: { ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } } } },
      });
      reportCharts.push(chart);
    }

    // Stacked chart by category per day
    const stackCtx = document.getElementById('wd-stacked-chart');
    if (stackCtx) {
      const orderedDays = [1,2,3,4,5,6,0];
      const chart = new Chart(stackCtx, {
        type: 'bar',
        data: {
          labels: orderedDays.map(i => dayShort[i]),
          datasets: topCats.map((cat, ci) => ({
            label: cat, data: orderedDays.map(i => byDay[i].topCats[cat] || 0),
            backgroundColor: palette[ci], borderWidth: 0, borderRadius: 2,
          })),
        },
        options: { ...CHART_BASE,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 10 } } },
            tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, currency) + ' ' + currency } } },
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } } } },
      });
      reportCharts.push(chart);
    }

    // Pie
    const pieCtx = document.getElementById('wd-pie-chart');
    if (pieCtx) {
      const chart = new Chart(pieCtx, {
        type: 'doughnut',
        data: { labels: [t('reports.wd.pie.weekday_label', {}, 'Weekday (Mon–Fri)'), t('reports.wd.pie.weekend_label', {}, 'Weekend (Sat–Sun)')], datasets: [{ data: [weekdayTotal, weekendTotal], backgroundColor: [chartPalette()[0], chartPalette()[1]], borderWidth: 2, borderColor: cssVar('--surface') }] },
        options: { ...CHART_BASE, cutout: '58%',
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 12 } } },
            tooltip: { callbacks: { label: ctx => ctx.label + ': ' + formatCurrency(ctx.raw, currency) + ' ' + currency + ' (' + (ctx.raw / totalExpenses * 100).toFixed(1) + '%)' } } } },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}

// ─── Recurring Expense Tracker (E2) ─────────────────────────────────────

function renderRecurringReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();

  const tb = reportToolbar(out, 'rec', [
    { key: 'year', label: t('reports.toolbar.year', {}, 'Year'),
      options: years, def: years[years.length - 1] || '2026' },
    { key: 'min', label: t('reports.rec.label_min_months', {}, 'Min. Months'),
      options: [2, 3, 4, 6].map(n => ({ v: n, l: t('reports.rec.opt_min_months', { n }, `${n}+`) })), def: '2' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="rec-content"></div>
    </div>
  `;

  function update() {
    destroyReportCharts();
    const year = tb.get('year');
    const minMonths = parseInt(tb.get('min')) || 2;
    const cur = displayCurrency;
    const englishMonthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthNames = englishMonthShort.map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
    const noPayeeLabel = t('reports.rec.no_payee', {}, '(no payee)');

    // Filter expenses for the year
    const custodyAliases = getCustodyAliases();
    const expenses = state.tx.filter(tx =>
      tx.type === 'expense' && tx.date && tx.date.startsWith(year) && !custodyAliases.has(tx.account)
    );

    // Group by payee → month → total amount (converted to display currency)
    const byPayee = {};
    for (const tx of expenses) {
      const key = tx.payee || noPayeeLabel;
      if (!byPayee[key]) byPayee[key] = { months: {}, category: tx.category, count: 0 };
      const m = parseInt(tx.date.slice(5, 7), 10);
      byPayee[key].months[m] = (byPayee[key].months[m] || 0) + convertTo(tx.amount, tx.currency, cur);
      byPayee[key].count++;
    }

    // Filter to recurring payees (appear in >= minMonths distinct months)
    const recurring = Object.entries(byPayee)
      .filter(([, d]) => Object.keys(d.months).length >= minMonths)
      .map(([name, d]) => {
        const monthKeys = Object.keys(d.months).map(Number).sort((a, b) => a - b);
        const amounts = monthKeys.map(m => d.months[m]);
        const total = amounts.reduce((s, v) => s + v, 0);
        const avg = total / monthKeys.length;

        // Detect trend: compare last 2 months with amounts
        let trend = 'stable';
        let changePercent = 0;
        if (monthKeys.length >= 2) {
          const last = d.months[monthKeys[monthKeys.length - 1]];
          const prev = d.months[monthKeys[monthKeys.length - 2]];
          if (prev > 0) {
            changePercent = ((last - prev) / prev) * 100;
            if (changePercent > 5) trend = 'up';
            else if (changePercent < -5) trend = 'down';
          }
        }

        return { name, ...d, monthKeys, total, avg, trend, changePercent };
      })
      .sort((a, b) => b.total - a.total);

    const totalRecurring = recurring.reduce((s, p) => s + p.total, 0);
    const increased = recurring.filter(p => p.trend === 'up').length;
    const decreased = recurring.filter(p => p.trend === 'down').length;

    // Determine which months actually have data
    const activeMonths = [...new Set(expenses.map(tx => parseInt(tx.date.slice(5, 7), 10)))].sort((a, b) => a - b);

    const content = document.getElementById('rec-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${escapeHtml(t('reports.rec.title', { year, currency: cur }, `Recurring Expenses ${year} — ${cur}`))}</div>
        <div class="income-grid" style="grid-template-columns:repeat(4,1fr);">
          <div class="income-cell">
            <div class="ic-label">${t('reports.rec.tile_recurring_payees', {}, 'Recurring Payees')}</div>
            <div class="ic-value">${recurring.length}</div>
            <div class="ic-count">${escapeHtml(t('reports.rec.in_n_months', { n: minMonths }, `in ${minMonths}+ months`))}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.rec.tile_total_recurring', {}, 'Total Recurring')}</div>
            <div class="ic-value c-neg">${formatCurrency(totalRecurring, cur)}<span class="ic-cur">${cur}</span></div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.rec.tile_price_increases', {}, 'Price Increases')}</div>
            <div class="ic-value c-neg">${increased}</div>
            <div class="ic-count">${t('reports.rec.vs_previous_month', {}, 'vs. previous month')}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.rec.tile_price_decreases', {}, 'Price Decreases')}</div>
            <div class="ic-value c-pos">${decreased}</div>
            <div class="ic-count">${t('reports.rec.vs_previous_month', {}, 'vs. previous month')}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.rec.mom_compare_heading', {}, 'Month-over-Month Comparison')}</div>
        <div style="overflow-x:auto;">
          <table class="tx-table">
            <thead>
              <tr>
                <th>${t('common.col.payee', {}, 'Payee')}</th>
                <th>${t('common.col.category', {}, 'Category')}</th>
                ${activeMonths.map(m => `<th class="amt">${monthNames[m - 1]}</th>`).join('')}
                <th class="amt">${t('reports.rec.col_avg', {}, 'Avg')}</th>
                <th class="amt">${t('reports.shared.total_label', {}, 'Total')}</th>
                <th>${t('reports.rec.col_trend', {}, 'Trend')}</th>
              </tr>
            </thead>
            <tbody>
              ${recurring.map(p => `<tr>
                <td><strong>${escapeHtml(p.name)}</strong></td>
                <td class="cat">${escapeHtml(p.category || '')}</td>
                ${activeMonths.map(m => {
                  const val = p.months[m];
                  if (!val) return '<td class="amt c-mut">—</td>';
                  // Check if this month increased vs previous
                  const prevMonth = activeMonths[activeMonths.indexOf(m) - 1];
                  const prevVal = prevMonth ? p.months[prevMonth] : null;
                  let cls = '';
                  if (prevVal != null && val > prevVal * 1.05) cls = ' style="color:var(--negative);font-weight:600;"';
                  else if (prevVal != null && val < prevVal * 0.95) cls = '';
                  return `<td class="amt c-pos"${cls}>${formatCurrency(val, cur)}</td>`;
                }).join('')}
                <td class="amt">${formatCurrency(p.avg, cur)}</td>
                <td class="amt"><strong>${formatCurrency(p.total, cur)}</strong></td>
                <td>${p.trend === 'up' ? `<span style="color:var(--negative);font-weight:600;">▲ +${p.changePercent.toFixed(0)}%</span>` : p.trend === 'down' ? `<span class="c-pos">▼ ${p.changePercent.toFixed(0)}%</span>` : '<span class="c-mut">—</span>'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.rec.top8_chart_title', {}, 'Top 8 Recurring — Monthly Trend')}</div>
            <div class="chart-canvas-box"><canvas id="rec-trend-chart"></canvas></div>
          </div>
        </div>
      </div>
    `;

    // Trend chart: top 8 recurring payees, line per payee
    const top8 = recurring.slice(0, 8);
    const palette = chartPalette();
    const trendCtx = document.getElementById('rec-trend-chart');
    if (trendCtx && top8.length > 0) {
      const datasets = top8.map((p, i) => ({
        label: p.name,
        data: activeMonths.map(m => p.months[m] || null),
        borderColor: palette[i % palette.length],
        backgroundColor: palette[i % palette.length] + '20',
        tension: 0.3,
        pointRadius: 3,
        spanGaps: true,
      }));
      const chart = new Chart(trendCtx, {
        type: 'line',
        data: { labels: activeMonths.map(m => monthNames[m - 1]), datasets },
        options: {
          ...CHART_BASE,
          plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, cur) + ' ' + cur } },
          },
          scales: {
            x: { grid: { display: false } },
            y: { ticks: currencyTicks(cur), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}

// ─── Cash vs. Digital Report ────────────────────────────────────────────

function renderCashDigitalReport() {
  const CASH_TYPES = ['cash'];
  const DIGITAL_TYPES = ['bank', 'mobile_money', 'credit_card', 'savings'];
  // Build account→method lookup
  const acctMethod = {};
  for (const a of state.accounts) {
    if (CASH_TYPES.includes(a.type)) acctMethod[a.alias] = 'Cash';
    else if (DIGITAL_TYPES.includes(a.type)) acctMethod[a.alias] = 'Digital';
    else acctMethod[a.alias] = 'Other';
  }

  const out = document.getElementById('report-output');
  const years = getAvailableYears();

  const tb = reportToolbar(out, 'cd', [
    { key: 'mode', label: t('reports.toolbar.mode', {}, 'Mode'), def: 'monthly',
      options: [
        { v: 'monthly', l: t('reports.toolbar.monthly', {}, 'Monthly') },
        { v: 'yearly', l: t('reports.toolbar.yearly', {}, 'Yearly') },
      ] },
    { key: 'year', label: t('reports.toolbar.year', {}, 'Year'),
      options: years, def: years[years.length - 1] || '2026' },
    { key: 'cur', label: t('reports.toolbar.currency', {}, 'Currency'),
      options: reportCurrencies(), def: 'TZS' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="cd-content"></div>
    </div>
  `;

  function update() {
    tb.el('year').style.display = tb.get('mode') === 'yearly' ? 'none' : '';
    destroyReportCharts();
    const currency = tb.get('cur');
    const custodyAliases = getCustodyAliases();
    const expenses = state.tx.filter(tx => tx.type === 'expense' && !custodyAliases.has(tx.account)).map(tx => ({
      ...tx, amount: convertTo(tx.amount, tx.currency, currency),
      method: acctMethod[tx.account] || 'Other',
    }));

    if (tb.get('mode') === 'monthly') renderCDMonthly(expenses, tb.get('year'), currency);
    else renderCDYearly(expenses, currency);
  }

  function renderCDMonthly(expenses, year, currency) {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      .map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      let cash = 0, digital = 0, cashCount = 0, digitalCount = 0;
      for (const tx of expenses) {
        if (!tx.date || !tx.date.startsWith(ym)) continue;
        if (tx.method === 'Cash') { cash += tx.amount; cashCount++; }
        else { digital += tx.amount; digitalCount++; }
      }
      const total = cash + digital;
      months.push({ ym, label: monthLabel(ym), cash, digital, total, cashCount, digitalCount, cashPct: total > 0 ? (cash / total * 100) : 0 });
    }

    const totCash = months.reduce((s, m) => s + m.cash, 0);
    const totDigital = months.reduce((s, m) => s + m.digital, 0);
    const totAll = totCash + totDigital;
    const cashPctYear = totAll > 0 ? (totCash / totAll * 100).toFixed(1) : '0.0';
    const digitalPctYear = totAll > 0 ? (totDigital / totAll * 100).toFixed(1) : '0.0';

    const content = document.getElementById('cd-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.cd.monthly.title', { year, currency }, `Cash vs. Digital ${year} — ${currency}`)}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.cd.tile.cash', {}, 'Cash Spending')}</div>
            <div class="ic-value c-warn">${formatCurrency(totCash, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.cd.tile.pct_of_total', { pct: cashPctYear }, `${cashPctYear}% of total`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.cd.tile.digital', {}, 'Digital Spending')}</div>
            <div class="ic-value c-info">${formatCurrency(totDigital, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.cd.tile.pct_of_total', { pct: digitalPctYear }, `${digitalPctYear}% of total`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.incexp.tile.total_expenses', {}, 'Total Expenses')}</div>
            <div class="ic-value">${formatCurrency(totAll, currency)}<span class="ic-cur">${currency}</span></div>
          </div>
        </div>
        <div class="income-grid">
          ${months.map(m => `
            <div class="income-cell">
              <div class="ic-label">${m.label}</div>
              <div class="ic-value ${m.total === 0 ? 'zero' : ''}">${formatCurrency(m.total, currency)}<span class="ic-cur">${currency}</span></div>
              <div class="ic-count fs-10">${t('reports.cd.month_detail', { pct: m.cashPct.toFixed(0), cash: formatCurrency(m.cash, currency), digital: formatCurrency(m.digital, currency) }, `Cash ${m.cashPct.toFixed(0)}% · ${formatCurrency(m.cash, currency)} / ${formatCurrency(m.digital, currency)}`)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.cd.chart.monthly', {}, 'Monthly Cash vs. Digital')}</div>
            <div class="chart-canvas-box"><canvas id="cd-bar-chart"></canvas></div>
          </div>
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.cd.chart.cash_share', {}, 'Cash Share % Over Time')}</div>
            <div class="chart-canvas-box"><canvas id="cd-pct-chart"></canvas></div>
          </div>
        </div>
      </div>
    `;

    const barCtx = document.getElementById('cd-bar-chart');
    if (barCtx) {
      const chart = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: names,
          datasets: [
            { label: t('reports.cd.dataset.cash', {}, 'Cash'), data: months.map(m => m.cash), backgroundColor: chartPalette()[1], borderWidth: 0 },
            { label: t('reports.cd.dataset.digital', {}, 'Digital'), data: months.map(m => m.digital), backgroundColor: chartPalette()[0], borderWidth: 0 },
          ],
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }

    const pctCtx = document.getElementById('cd-pct-chart');
    if (pctCtx) {
      const chart = new Chart(pctCtx, {
        type: 'line',
        data: {
          labels: names,
          datasets: [{
            label: t('reports.cd.dataset.cash_pct', {}, 'Cash %'),
            data: months.map(m => m.cashPct),
            borderColor: chartPalette()[1], backgroundColor: chartTint(chartPalette()[1], 0.1),
            fill: true, tension: 0.3, pointRadius: 4,
          }],
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${t('reports.cd.dataset.cash', {}, 'Cash')}: ${ctx.raw.toFixed(1)}%` } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  function renderCDYearly(expenses, currency) {
    const years = getAvailableYears();
    const data = [];
    for (const y of years) {
      let cash = 0, digital = 0;
      for (const tx of expenses) {
        if (!tx.date || !tx.date.startsWith(y)) continue;
        if (tx.method === 'Cash') cash += tx.amount; else digital += tx.amount;
      }
      const total = cash + digital;
      data.push({ year: y, cash, digital, total, cashPct: total > 0 ? (cash / total * 100) : 0 });
    }

    const content = document.getElementById('cd-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.cd.yearly.title', { currency }, `Cash vs. Digital by Year — ${currency}`)}</div>
        <div class="income-grid">
          ${data.map(d => `
            <div class="income-cell">
              <div class="ic-label">${d.year}</div>
              <div class="ic-value">${formatCurrency(d.total, currency)}<span class="ic-cur">${currency}</span></div>
              <div class="ic-count">${t('reports.cd.year_detail', { pct: d.cashPct.toFixed(0), cash: formatCurrency(d.cash, currency), digital: formatCurrency(d.digital, currency) }, `Cash ${d.cashPct.toFixed(0)}%: ${formatCurrency(d.cash, currency)} / Digital: ${formatCurrency(d.digital, currency)}`)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.cd.chart.yearly', {}, 'Yearly Cash vs. Digital')}</div>
          <div class="chart-canvas-box"><canvas id="cd-year-chart"></canvas></div>
        </div>
      </div>
    `;

    const ctx = document.getElementById('cd-year-chart');
    if (ctx) {
      const chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.map(d => d.year),
          datasets: [
            { label: t('reports.cd.dataset.cash', {}, 'Cash'), data: data.map(d => d.cash), backgroundColor: chartPalette()[1], borderWidth: 0 },
            { label: t('reports.cd.dataset.digital', {}, 'Digital'), data: data.map(d => d.digital), backgroundColor: chartPalette()[0], borderWidth: 0 },
          ],
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}

// ─── Monthly Comparison Report ──────────────────────────────────────────

function renderMonthlyComparisonReport() {
  const out = document.getElementById('report-output');
  const currencies = reportCurrencies();

  // Build list of all months with data
  const allMonths = new Set();
  for (const tx of state.tx) { if (tx.date) allMonths.add(tx.date.slice(0, 7)); }
  const sortedMonths = [...allMonths].sort().reverse();

  const savedCur = out.getAttribute('data-mc-cur') || 'TZS';
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const savedMonth = out.getAttribute('data-mc-month') || currentYM;

  // DR-M4: deliberately NOT migrated to reportToolbar() — the freestanding
  // 'vs. previous month' label sits BETWEEN the two selects, and the factory
  // can only append extra markup after its fields (extraHtml). A partial
  // migration would leave one select on manual wiring; keep it hand-rolled.
  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.mc.toolbar.compare', {}, 'Compare')}</label>
        <select id="mc-month">
          ${sortedMonths.map(m => `<option value="${m}" ${m === savedMonth ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}
        </select>
        <label>${t('reports.mc.toolbar.vs_prev', {}, 'vs. previous month')}</label>
        <label style="margin-left:16px;">${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="mc-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="mc-content"></div>
    </div>
  `;

  const monthEl = document.getElementById('mc-month');
  const curEl = document.getElementById('mc-currency');

  function update() {
    out.setAttribute('data-mc-month', monthEl.value);
    out.setAttribute('data-mc-cur', curEl.value);
    destroyReportCharts();
    const currency = curEl.value;
    const thisYM = monthEl.value;

    // Calculate previous month
    const [y, m] = thisYM.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevYM = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const custodyAliases = getCustodyAliases();
    const nonPnl = getNonPnlCategories();
    const thisTx = state.tx.filter(tx => tx.type === 'expense' && tx.date && tx.date.startsWith(thisYM) && isOperationalTx(tx, custodyAliases, nonPnl))
      .map(tx => ({ ...tx, amount: convertTo(tx.amount, tx.currency, currency) }));
    const prevTx = state.tx.filter(tx => tx.type === 'expense' && tx.date && tx.date.startsWith(prevYM) && isOperationalTx(tx, custodyAliases, nonPnl))
      .map(tx => ({ ...tx, amount: convertTo(tx.amount, tx.currency, currency) }));

    // Aggregate by top-level category
    const thisTotal = thisTx.reduce((s, tx) => s + tx.amount, 0);
    const prevTotal = prevTx.reduce((s, tx) => s + tx.amount, 0);
    const totalDelta = thisTotal - prevTotal;
    const totalDeltaPct = prevTotal > 0 ? (totalDelta / prevTotal * 100) : 0;

    const otherLabel = t('reports.shared.other', {}, '(other)');
    const byCat = {};
    for (const tx of thisTx) {
      const cat = tx.category ? tx.category.split(':')[0] : otherLabel;
      if (!byCat[cat]) byCat[cat] = { this: 0, prev: 0 };
      byCat[cat].this += tx.amount;
    }
    for (const tx of prevTx) {
      const cat = tx.category ? tx.category.split(':')[0] : otherLabel;
      if (!byCat[cat]) byCat[cat] = { this: 0, prev: 0 };
      byCat[cat].prev += tx.amount;
    }

    const catRows = Object.entries(byCat)
      .map(([cat, v]) => ({ cat, ...v, delta: v.this - v.prev, deltaPct: v.prev > 0 ? ((v.this - v.prev) / v.prev * 100) : (v.this > 0 ? 100 : 0) }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const deltaColor = (d) => d > 0 ? 'var(--negative)' : d < 0 ? 'var(--positive)' : 'var(--muted)';
    const deltaIcon = (d) => d > 0 ? '&#9650;' : d < 0 ? '&#9660;' : '&#8212;';

    const content = document.getElementById('mc-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.mc.title', { thisMonth: monthLabel(thisYM), prevMonth: monthLabel(prevYM), currency }, `${monthLabel(thisYM)} vs. ${monthLabel(prevYM)} — ${currency}`)}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${monthLabel(thisYM)}</div>
            <div class="ic-value">${formatCurrency(thisTotal, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.shared.tx_count', { n: thisTx.length }, `${thisTx.length} TX`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${monthLabel(prevYM)}</div>
            <div class="ic-value c-mut">${formatCurrency(prevTotal, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.shared.tx_count', { n: prevTx.length }, `${prevTx.length} TX`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('common.label.change', {}, 'Change')}</div>
            <div class="ic-value" style="color:${deltaColor(totalDelta)}">${totalDelta >= 0 ? '+' : ''}${formatCurrency(totalDelta, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${totalDeltaPct >= 0 ? '+' : ''}${totalDeltaPct.toFixed(1)}%</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.mc.section.cat_comparison', {}, 'Category Comparison')}</div>
        <table class="tx-table">
          <thead><tr>
            <th>${t('common.col.category', {}, 'Category')}</th>
            <th class="amt">${monthLabel(thisYM)}</th>
            <th class="amt">${monthLabel(prevYM)}</th>
            <th class="amt">${t('reports.mc.col.delta', {}, 'Delta')}</th>
            <th>${t('common.label.change', {}, 'Change')}</th>
          </tr></thead>
          <tbody>
            ${catRows.map(r => `<tr>
              <td>${escapeHtml(r.cat)}</td>
              <td class="amt">${formatCurrency(r.this, currency)}</td>
              <td class="amt c-mut">${formatCurrency(r.prev, currency)}</td>
              <td class="amt" style="color:${deltaColor(r.delta)}">${r.delta >= 0 ? '+' : ''}${formatCurrency(r.delta, currency)}</td>
              <td style="color:${deltaColor(r.delta)};font-size:12px;">${deltaIcon(r.delta)} ${Math.abs(r.deltaPct).toFixed(0)}%</td>
            </tr>`).join('')}
            <tr class="row-total">
              <td>${t('reports.shared.total_label', {}, 'Total')}</td>
              <td class="amt">${formatCurrency(thisTotal, currency)}</td>
              <td class="amt c-mut">${formatCurrency(prevTotal, currency)}</td>
              <td class="amt" style="color:${deltaColor(totalDelta)}">${totalDelta >= 0 ? '+' : ''}${formatCurrency(totalDelta, currency)}</td>
              <td style="color:${deltaColor(totalDelta)};font-size:12px;">${deltaIcon(totalDelta)} ${Math.abs(totalDeltaPct).toFixed(0)}%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.mc.chart.side_by_side', {}, 'Side-by-Side Comparison')}</div>
            <div class="chart-canvas-box"><canvas id="mc-bar-chart"></canvas></div>
          </div>
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.mc.chart.biggest_changes', {}, 'Biggest Changes')}</div>
            <div class="chart-canvas-box"><canvas id="mc-delta-chart"></canvas></div>
          </div>
        </div>
      </div>
    `;

    // Grouped bar chart by category
    const top10 = catRows.slice(0, 10);
    const barCtx = document.getElementById('mc-bar-chart');
    if (barCtx) {
      const chart = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: top10.map(r => r.cat),
          datasets: [
            { label: monthLabel(thisYM), data: top10.map(r => r.this), backgroundColor: chartPalette()[0], borderWidth: 0 },
            { label: monthLabel(prevYM), data: top10.map(r => r.prev), backgroundColor: chartPalette()[9], borderWidth: 0 },
          ],
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }

    // Delta horizontal bar
    const deltaCtx = document.getElementById('mc-delta-chart');
    if (deltaCtx) {
      const chart = new Chart(deltaCtx, {
        type: 'bar',
        data: {
          labels: top10.map(r => r.cat),
          datasets: [{
            label: t('reports.mc.col.delta', {}, 'Delta'),
            data: top10.map(r => r.delta),
            backgroundColor: top10.map(r => r.delta >= 0 ? 'rgba(239,68,68,0.7)' : 'rgba(34,197,94,0.7)'),
            borderWidth: 0,
          }],
        },
        options: {
          indexAxis: 'y', ...CHART_BASE,
          plugins: { legend: { display: false },
            tooltip: { callbacks: { label: ctx => `${ctx.raw >= 0 ? '+' : ''}${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
            y: { grid: { display: false } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  monthEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

// ─── Seasonal Heatmap Report ────────────────────────────────────────────

function renderSeasonalReport() {
  const out = document.getElementById('report-output');

  const tb = reportToolbar(out, 'sh', [
    { key: 'cur', label: t('reports.toolbar.currency', {}, 'Currency'),
      options: reportCurrencies(), def: 'TZS' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="sh-content"></div>
    </div>
  `;

  function update() {
    destroyReportCharts();
    const currency = tb.get('cur');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      .map((en, i) => t(`common.months.short.${i + 1}`, {}, en));

    // Get top-level categories by total spending
    const custodyAliases = getCustodyAliases();
    const catTotals = {};
    const otherLabel = t('reports.shared.other', {}, '(other)');
    const expenses = state.tx.filter(tx => tx.type === 'expense' && !custodyAliases.has(tx.account)).map(tx => ({
      ...tx, amount: convertTo(tx.amount, tx.currency, currency),
      topCat: tx.category ? tx.category.split(':')[0] : otherLabel,
    }));
    for (const tx of expenses) catTotals[tx.topCat] = (catTotals[tx.topCat] || 0) + tx.amount;
    const topCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c);

    // Build heatmap data: category × month (averaged across years)
    const years = getAvailableYears();
    const numYears = years.length || 1;
    const heatData = {};
    for (const cat of topCats) {
      heatData[cat] = new Array(12).fill(0);
    }
    for (const tx of expenses) {
      if (!topCats.includes(tx.topCat) || !tx.date) continue;
      const m = parseInt(tx.date.slice(5, 7)) - 1;
      heatData[tx.topCat][m] += tx.amount;
    }
    // Average per year
    for (const cat of topCats) {
      for (let m = 0; m < 12; m++) heatData[cat][m] /= numYears;
    }

    // Find global max for color scaling
    let globalMax = 0;
    for (const cat of topCats) {
      for (let m = 0; m < 12; m++) {
        if (heatData[cat][m] > globalMax) globalMax = heatData[cat][m];
      }
    }

    // Also build total per month (across all expenses, averaged)
    const monthTotals = new Array(12).fill(0);
    for (const tx of expenses) {
      if (!tx.date) continue;
      const m = parseInt(tx.date.slice(5, 7)) - 1;
      monthTotals[m] += tx.amount;
    }
    for (let m = 0; m < 12; m++) monthTotals[m] /= numYears;
    const peakMonth = monthTotals.indexOf(Math.max(...monthTotals));
    const lowMonth = monthTotals.indexOf(Math.min(...monthTotals.filter(v => v > 0)));

    const heatColor = (val) => {
      if (globalMax === 0) return 'var(--surface-2)';
      const intensity = val / globalMax;
      const r = Math.round(220 + (239 - 220) * intensity);
      const g = Math.round(220 + (68 - 220) * intensity);
      const b = Math.round(220 + (68 - 220) * intensity);
      return `rgb(${r},${g},${b})`;
    };

    const titleKey = numYears === 1 ? 'reports.sh.title_one' : 'reports.sh.title_many';
    const titleFallback = numYears === 1
      ? `Seasonal Spending Patterns — ${currency} (avg/month across 1 year)`
      : `Seasonal Spending Patterns — ${currency} (avg/month across ${numYears} years)`;

    const content = document.getElementById('sh-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t(titleKey, { currency, n: numYears }, titleFallback)}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.sh.tile.peak_month', {}, 'Peak Month')}</div>
            <div class="ic-value c-neg">${monthNames[peakMonth]}</div>
            <div class="ic-count">${t('reports.sh.tile.avg_detail', { amount: formatCurrency(monthTotals[peakMonth], currency), currency }, `Avg ${formatCurrency(monthTotals[peakMonth], currency)} ${currency}`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.sh.tile.lowest_month', {}, 'Lowest Month')}</div>
            <div class="ic-value" style="color:#10b981">${monthNames[lowMonth]}</div>
            <div class="ic-count">${t('reports.sh.tile.avg_detail', { amount: formatCurrency(monthTotals[lowMonth], currency), currency }, `Avg ${formatCurrency(monthTotals[lowMonth], currency)} ${currency}`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.sh.tile.seasonal_spread', {}, 'Seasonal Spread')}</div>
            <div class="ic-value">${formatCurrency(monthTotals[peakMonth] - monthTotals[lowMonth], currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.sh.tile.diff_detail', {}, 'Difference peak to low')}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.sh.section.heatmap', {}, 'Heatmap — Category × Month (darker = higher spend)')}</div>
        <div style="overflow-x:auto;">
          <table class="tx-table" style="min-width:700px;">
            <thead>
              <tr>
                <th style="position:sticky;left:0;background:var(--surface);z-index:1;">${t('common.col.category', {}, 'Category')}</th>
                ${monthNames.map(n => `<th style="text-align:center;min-width:55px;">${n}</th>`).join('')}
                <th class="amt">${t('reports.sh.col.avg_total', {}, 'Avg Total')}</th>
              </tr>
            </thead>
            <tbody>
              ${topCats.map(cat => {
                const rowTotal = heatData[cat].reduce((s, v) => s + v, 0);
                return `<tr>
                  <td style="position:sticky;left:0;background:var(--surface);z-index:1;font-weight:600;">${escapeHtml(cat)}</td>
                  ${heatData[cat].map(v => `<td style="text-align:center;background:${heatColor(v)};color:${v / globalMax > 0.5 ? '#fff' : 'var(--text)'};font-size:11px;">${v > 0 ? formatCurrency(v, currency) : '—'}</td>`).join('')}
                  <td class="amt fw-600">${formatCurrency(rowTotal, currency)}</td>
                </tr>`;
              }).join('')}
              <tr class="row-total">
                <td style="position:sticky;left:0;background:var(--surface);z-index:1;">${t('reports.shared.total_label', {}, 'Total')}</td>
                ${monthTotals.map(v => `<td style="text-align:center;font-size:11px;">${formatCurrency(v, currency)}</td>`).join('')}
                <td class="amt">${formatCurrency(monthTotals.reduce((s, v) => s + v, 0), currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap" style="max-width:100%">
          <div class="report-section-title">${t('reports.sh.chart.avg_by_cat', {}, 'Average Monthly Spending by Category')}</div>
          <div class="chart-canvas-box" style="height:350px"><canvas id="sh-stack-chart"></canvas></div>
        </div>
      </div>
    `;

    const stackPalette = chartPalette();
    const ctx = document.getElementById('sh-stack-chart');
    if (ctx) {
      const chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: monthNames,
          datasets: topCats.map((cat, i) => ({
            label: cat,
            data: heatData[cat],
            backgroundColor: stackPalette[i % stackPalette.length],
            borderWidth: 0,
          })),
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 10 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}

