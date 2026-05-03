// ─── AI Costs Report ─────────────────────────────────────────────────────

// ─── Bills Report ────────────────────────────────────────────────────────

// Label getters are evaluated at render time so they pick up the active
// locale. Keep the English words in the fallback so a missing translation
// still produces a readable column.
const BILLS_CATEGORIES = [
  { key: 'Bills:Rent', get label() { return t('reports.bills.cat.rent', {}, 'Rent'); }, color: '#f07070' },
  { key: 'Bills:Electricity', get label() { return t('reports.bills.cat.electricity', {}, 'Electricity'); }, color: '#f0a060' },
  { key: 'Bills:Water', get label() { return t('reports.bills.cat.water', {}, 'Water'); }, color: '#5eb8e0' },
  { key: 'Bills:Internet', get label() { return t('reports.bills.cat.internet', {}, 'Internet'); }, color: '#5dd4a0' },
];

function renderBillsReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];

  const savedMode = out.getAttribute('data-bills-mode') || 'monthly';
  const savedYear = out.getAttribute('data-bills-year') || years[years.length - 1] || '2026';
  const savedCur = out.getAttribute('data-bills-cur') || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.mode', {}, 'Mode')}</label>
        <select id="bl-mode">
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.toolbar.monthly', {}, 'Monthly')}</option>
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.toolbar.yearly', {}, 'Yearly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="bl-year">
          ${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
        <label>${t('common.col.currency', {}, 'Currency')}</label>
        <select id="bl-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="bl-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('bl-mode');
  const yearEl = document.getElementById('bl-year');
  const curEl = document.getElementById('bl-currency');

  function update() {
    out.setAttribute('data-bills-mode', modeEl.value);
    out.setAttribute('data-bills-year', yearEl.value);
    out.setAttribute('data-bills-cur', curEl.value);
    yearEl.style.display = modeEl.value === 'yearly' ? 'none' : '';
    destroyReportCharts();
    const cur = curEl.value;
    const filtered = state.tx.filter(tx =>
      tx.type === 'expense' &&
      tx.category && BILLS_CATEGORIES.some(bc => tx.category === bc.key)
    ).map(tx => ({ ...tx, amount: convertTo(tx.amount, tx.currency, cur) }));
    if (modeEl.value === 'monthly') renderBillsMonthly(filtered, yearEl.value, cur);
    else renderBillsYearly(filtered, cur);
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

function renderBillsMonthly(filtered, year, currency) {
  const englishMonthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const names = englishMonthShort.map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    const row = { ym, label: monthLabel(ym), total: 0, count: 0 };
    for (const bc of BILLS_CATEGORIES) row[bc.key] = 0;
    for (const tx of filtered) {
      if (tx.date && tx.date.startsWith(ym)) {
        row.total += tx.amount;
        row.count++;
        if (row[tx.category] !== undefined) row[tx.category] += tx.amount;
      }
    }
    months.push(row);
  }

  const grandTotal = months.reduce((s, m) => s + m.total, 0);
  const activeMonths = months.filter(m => m.total > 0).length;
  const avgPerMonth = activeMonths > 0 ? grandTotal / activeMonths : 0;

  // Per-category totals
  const catTotals = BILLS_CATEGORIES.map(bc => ({
    ...bc,
    total: months.reduce((s, m) => s + m[bc.key], 0),
  }));

  const activeMonthsLabel = activeMonths === 1
    ? t('reports.shared.active_months_one', {}, '1 active month')
    : t('reports.shared.active_months_many', { n: activeMonths }, `${activeMonths} active months`);

  const content = document.getElementById('bl-content');
  content.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${escapeHtml(t('reports.bills.title_year', { year, currency }, `Bills ${year} — ${currency}`))}</div>
      <div class="income-grid">
        <div class="income-cell">
          <div class="ic-label">${t('reports.shared.year_total', {}, 'Year Total')}</div>
          <div class="ic-value c-neg">${formatCurrency(grandTotal, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${escapeHtml(activeMonthsLabel)}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.shared.avg_per_month', {}, 'Avg / Month')}</div>
          <div class="ic-value c-neg">${formatCurrency(avgPerMonth, currency)}<span class="ic-cur">${currency}</span></div>
        </div>
        ${catTotals.map(c => `
          <div class="income-cell">
            <div class="ic-label">${escapeHtml(c.label)}</div>
            <div class="ic-value ${c.total === 0 ? 'zero' : ''}" style="color:${c.total > 0 ? c.color : 'var(--muted)'}">${formatCurrency(c.total, currency)}<span class="ic-cur">${currency}</span></div>
          </div>
        `).join('')}
      </div>
      <div class="income-grid mt-8">
        ${months.map(m => `
          <div class="income-cell">
            <div class="ic-label">${m.label}</div>
            <div class="ic-value ${m.total === 0 ? 'zero' : ''}" style="color:${m.total > 0 ? 'var(--negative)' : 'var(--muted)'}">${formatCurrency(m.total, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${BILLS_CATEGORIES.map(bc => m[bc.key] > 0 ? `${bc.label.slice(0,4)} ${formatCurrency(m[bc.key], currency)}` : '').filter(Boolean).join(' · ')}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="report-section">
      <div class="chart-row">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.bills.monthly_stacked', {}, 'Monthly Bills (stacked)')}</div>
          <div class="chart-canvas-box"><canvas id="bl-bar-chart"></canvas></div>
        </div>
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.bills.breakdown_by_category', {}, 'Breakdown by Category')}</div>
          <div class="chart-canvas-box"><canvas id="bl-cat-chart"></canvas></div>
        </div>
      </div>
    </div>
  `;

  // Stacked bar per category
  const barCtx = document.getElementById('bl-bar-chart');
  if (barCtx) {
    const chart = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: names,
        datasets: BILLS_CATEGORIES.map(bc => ({
          label: bc.label,
          data: months.map(m => m[bc.key]),
          backgroundColor: bc.color,
          borderWidth: 0,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, padding: 12, font: { size: 10 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } },
        },
        scales: {
          x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
          y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
        },
      },
    });
    reportCharts.push(chart);
  }

  // Horizontal bar — category totals
  const catCtx = document.getElementById('bl-cat-chart');
  if (catCtx) {
    const chart = new Chart(catCtx, {
      type: 'bar',
      data: {
        labels: catTotals.map(c => c.label),
        datasets: [{
          data: catTotals.map(c => c.total),
          backgroundColor: catTotals.map(c => c.color),
          borderWidth: 0,
        }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, currency) + ' ' + currency } } },
        scales: {
          x: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
          y: { grid: { display: false } },
        },
      },
    });
    reportCharts.push(chart);
  }
}

function renderBillsYearly(filtered, currency) {
  const years = getAvailableYears();
  const data = [];
  for (const y of years) {
    const row = { year: y, total: 0, count: 0 };
    for (const bc of BILLS_CATEGORIES) row[bc.key] = 0;
    for (const tx of filtered) {
      if (tx.date && tx.date.startsWith(y)) {
        row.total += tx.amount;
        row.count++;
        if (row[tx.category] !== undefined) row[tx.category] += tx.amount;
      }
    }
    data.push(row);
  }

  const grandTotal = data.reduce((s, d) => s + d.total, 0);
  const catTotals = BILLS_CATEGORIES.map(bc => ({
    ...bc,
    total: data.reduce((s, d) => s + d[bc.key], 0),
  }));

  const content = document.getElementById('bl-content');
  content.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${escapeHtml(t('reports.bills.title_yearly', { currency }, `Bills by Year — ${currency}`))}</div>
      <div class="income-grid">
        <div class="income-cell">
          <div class="ic-label">${t('reports.bills.all_time_total', {}, 'All-time Total')}</div>
          <div class="ic-value c-neg">${formatCurrency(grandTotal, currency)}<span class="ic-cur">${currency}</span></div>
        </div>
        ${catTotals.map(c => `
          <div class="income-cell">
            <div class="ic-label">${escapeHtml(c.label)}</div>
            <div class="ic-value ${c.total === 0 ? 'zero' : ''}" style="color:${c.total > 0 ? c.color : 'var(--muted)'}">${formatCurrency(c.total, currency)}<span class="ic-cur">${currency}</span></div>
          </div>
        `).join('')}
      </div>
      <div class="income-grid mt-8">
        ${data.map(d => `
          <div class="income-cell">
            <div class="ic-label">${d.year}</div>
            <div class="ic-value ${d.total === 0 ? 'zero' : ''}" style="color:${d.total > 0 ? 'var(--negative)' : 'var(--muted)'}">${formatCurrency(d.total, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${BILLS_CATEGORIES.map(bc => d[bc.key] > 0 ? `${bc.label.slice(0,4)} ${formatCurrency(d[bc.key], currency)}` : '').filter(Boolean).join(' · ')}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="report-section">
      <div class="chart-wrap">
        <div class="report-section-title">${t('reports.bills.yearly_stacked', {}, 'Yearly Bills (stacked)')}</div>
        <div class="chart-canvas-box"><canvas id="bl-year-chart"></canvas></div>
      </div>
    </div>
  `;

  const ctx = document.getElementById('bl-year-chart');
  if (ctx) {
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.year),
        datasets: BILLS_CATEGORIES.map(bc => ({
          label: bc.label,
          data: data.map(d => d[bc.key]),
          backgroundColor: bc.color,
          borderWidth: 0,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, padding: 12, font: { size: 10 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } },
        },
        scales: {
          x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
          y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
        },
      },
    });
    reportCharts.push(chart);
  }
}
// ─── Automobile Costs Report ────────────────────────────────────────────

function renderAutomobileReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();

  const savedMode = out.getAttribute('data-auto-mode') || 'monthly';
  const savedYear = out.getAttribute('data-auto-year') || years[years.length - 1] || '2026';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.mode', {}, 'Mode')}</label>
        <select id="au-mode">
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.toolbar.monthly', {}, 'Monthly')}</option>
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.toolbar.yearly', {}, 'Yearly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="au-year">
          ${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      </div>
      <div id="au-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('au-mode');
  const yearEl = document.getElementById('au-year');

  // Running cost categories (exclude one-off Purchase)
  const RUNNING_CATS = ['Automobile:Petrol', 'Automobile:Toll', 'Automobile:Parking', 'Automobile:Maintenance', 'Automobile:Insurance', 'Automobile:Registration', 'Automobile:Accessories', 'Automobile:Car Rental', 'Automobile'];
  const CAT_COLORS = {
    'Automobile:Petrol': '#ef4444',
    'Automobile:Toll': '#f59e0b',
    'Automobile:Parking': '#8b5cf6',
    'Automobile:Maintenance': '#3b82f6',
    'Automobile:Insurance': '#10b981',
    'Automobile:Registration': '#06b6d4',
    'Automobile:Accessories': '#84cc16',
    'Automobile:Car Rental': '#ec4899',
    'Automobile': '#6b7280',
  };
  // CAT_SHORT is a getter-object so labels pick up the active locale at
  // render time without having to rebuild the map on setLocale.
  const CAT_SHORT = {
    get 'Automobile:Petrol'() { return t('reports.auto.cat.petrol', {}, 'Petrol'); },
    get 'Automobile:Toll'() { return t('reports.auto.cat.toll', {}, 'Toll'); },
    get 'Automobile:Parking'() { return t('reports.auto.cat.parking', {}, 'Parking'); },
    get 'Automobile:Maintenance'() { return t('reports.auto.cat.maintenance', {}, 'Maintenance'); },
    get 'Automobile:Insurance'() { return t('reports.auto.cat.insurance', {}, 'Insurance'); },
    get 'Automobile:Registration'() { return t('reports.auto.cat.registration', {}, 'Registration'); },
    get 'Automobile:Accessories'() { return t('reports.auto.cat.accessories', {}, 'Accessories'); },
    get 'Automobile:Car Rental'() { return t('reports.auto.cat.car_rental', {}, 'Car Rental'); },
    get 'Automobile'() { return t('reports.auto.cat.other', {}, 'Other'); },
  };

  const custodyAliases = getCustodyAliases();
  const allAutoTx = state.tx.filter(tx => tx.type === 'expense' && tx.category && tx.category.startsWith('Automobile') && !custodyAliases.has(tx.account)).map(tx => ({
    ...tx, amount: convertToTZS(tx.amount, tx.currency)
  }));

  function update() {
    out.setAttribute('data-auto-mode', modeEl.value);
    out.setAttribute('data-auto-year', yearEl.value);
    yearEl.style.display = modeEl.value === 'yearly' ? 'none' : '';
    destroyReportCharts();

    if (modeEl.value === 'monthly') renderAutoMonthly(allAutoTx, yearEl.value);
    else renderAutoYearly(allAutoTx);
  }

  function renderAutoMonthly(allTx, year) {
    const yearTx = allTx.filter(tx => tx.date && tx.date.startsWith(year));
    const runningTx = yearTx.filter(tx => tx.category !== 'Automobile:Purchase');
    const purchaseTx = yearTx.filter(tx => tx.category === 'Automobile:Purchase');
    const purchaseTotal = purchaseTx.reduce((s, tx) => s + tx.amount, 0);

    // Monthly data per category
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      const row = { ym, label: monthLabel(ym) };
      let total = 0;
      for (const cat of RUNNING_CATS) {
        const sum = runningTx.filter(tx => tx.date && tx.date.startsWith(ym) && tx.category === cat).reduce((s, tx) => s + tx.amount, 0);
        row[cat] = sum;
        total += sum;
      }
      row.total = total;
      row.count = runningTx.filter(tx => tx.date && tx.date.startsWith(ym)).length;
      months.push(row);
    }

    // Petrol data for trend line
    const petrolMonths = months.map(m => m['Automobile:Petrol'] || 0);
    const petrolTotal = petrolMonths.reduce((s, v) => s + v, 0);
    const petrolCount = runningTx.filter(tx => tx.category === 'Automobile:Petrol' && tx.date.startsWith(year)).length;

    const runningTotal = months.reduce((s, m) => s + m.total, 0);
    const activeMonths = months.filter(m => m.total > 0).length;
    const avgPerMonth = activeMonths > 0 ? runningTotal / activeMonths : 0;
    const grandTotal = runningTotal + purchaseTotal;

    // Category totals for year
    const catTotals = RUNNING_CATS.map(cat => ({
      cat, label: CAT_SHORT[cat], total: runningTx.filter(tx => tx.category === cat).reduce((s, tx) => s + tx.amount, 0),
      count: runningTx.filter(tx => tx.category === cat).length,
    })).filter(c => c.total > 0);

    const englishMonthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const names = englishMonthShort.map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
    const petrolLabel = t('reports.auto.cat.petrol', {}, 'Petrol');
    const content = document.getElementById('au-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${escapeHtml(t('reports.auto.title_year', { year }, `Automobile Costs ${year} (TZS)`))}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.auto.grand_total', {}, 'Grand Total')}</div>
            <div class="ic-value" style="color:#f59e0b">${formatCurrency(grandTotal, 'TZS')}<span class="ic-cur">TZS</span></div>
            <div class="ic-count">${t('reports.shared.tx_count', { n: yearTx.length }, `${yearTx.length} TX`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.auto.running_costs', {}, 'Running Costs')}</div>
            <div class="ic-value">${formatCurrency(runningTotal, 'TZS')}<span class="ic-cur">TZS</span></div>
            <div class="ic-count">${t('reports.auto.avg_per_month_short', { amount: formatCurrency(avgPerMonth, 'TZS') }, `avg ${formatCurrency(avgPerMonth, 'TZS')} / month`)}</div>
          </div>
          ${purchaseTotal > 0 ? `<div class="income-cell">
            <div class="ic-label">${t('reports.auto.purchase', {}, 'Purchase')}</div>
            <div class="ic-value c-mut">${formatCurrency(purchaseTotal, 'TZS')}<span class="ic-cur">TZS</span></div>
            <div class="ic-count">${t('reports.auto.purchase_excluded', { n: purchaseTx.length }, `${purchaseTx.length} TX (excluded from charts)`)}</div>
          </div>` : ''}
          <div class="income-cell">
            <div class="ic-label" style="color:#ef4444">&#9632; ${escapeHtml(petrolLabel)}</div>
            <div class="ic-value" style="color:#ef4444">${formatCurrency(petrolTotal, 'TZS')}<span class="ic-cur">TZS</span></div>
            <div class="ic-count">${t('reports.auto.petrol_fillups', { n: petrolCount, amount: formatCurrency(petrolCount > 0 ? petrolTotal / petrolCount : 0, 'TZS') }, `${petrolCount} fill-ups · avg ${formatCurrency(petrolCount > 0 ? petrolTotal / petrolCount : 0, 'TZS')} / fill`)}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.auto.chart_running_costs', {}, 'Running Costs by Category (excl. Purchase)')}</div>
            <div class="chart-canvas-box"><canvas id="au-stack-chart"></canvas></div>
          </div>
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.auto.chart_breakdown', {}, 'Category Breakdown')}</div>
            <div class="chart-canvas-box"><canvas id="au-pie-chart"></canvas></div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.auto.chart_petrol_trend', {}, 'Petrol Cost Trend')}</div>
          <div class="chart-canvas-box"><canvas id="au-petrol-chart"></canvas></div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.auto.monthly_detail', {}, 'Monthly Detail (TZS)')}</div>
        <div class="table-scroll-wrapper"><table class="tx-table nowrap">
          <thead><tr>
            <th>${t('common.label.month', {}, 'Month')}</th>
            ${catTotals.map(c => `<th class="t-right">${escapeHtml(c.label)}</th>`).join('')}
            <th class="num-right">${t('reports.shared.total_label', {}, 'Total')}</th>
          </tr></thead>
          <tbody>
            ${months.map(m => `<tr>
              <td>${m.label}</td>
              ${catTotals.map(c => `<td class="amt" style="color:${CAT_COLORS[c.cat]}">${formatCurrency(m[c.cat] || 0, 'TZS')}</td>`).join('')}
              <td class="amt fw-700">${formatCurrency(m.total, 'TZS')}</td>
            </tr>`).join('')}
            <tr style="font-weight:700;border-top:2px solid var(--border);">
              <td>${t('reports.shared.total_label', {}, 'Total')}</td>
              ${catTotals.map(c => `<td class="amt" style="color:${CAT_COLORS[c.cat]}">${formatCurrency(c.total, 'TZS')}</td>`).join('')}
              <td class="amt">${formatCurrency(runningTotal, 'TZS')}</td>
            </tr>
          </tbody>
        </table></div>
      </div>
    `;

    // Stacked bar chart (running costs only)
    const stackCtx = document.getElementById('au-stack-chart');
    if (stackCtx) {
      const activeCats = catTotals.filter(c => c.total > 0);
      const chart = new Chart(stackCtx, {
        type: 'bar',
        data: {
          labels: names,
          datasets: activeCats.map(c => ({
            label: c.label,
            data: months.map(m => m[c.cat] || 0),
            backgroundColor: CAT_COLORS[c.cat],
            borderWidth: 0,
          })),
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, 'TZS')} TZS` } },
          },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }

    // Pie chart
    const pieCtx = document.getElementById('au-pie-chart');
    if (pieCtx) {
      const chart = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
          labels: catTotals.map(c => c.label),
          datasets: [{ data: catTotals.map(c => c.total), backgroundColor: catTotals.map(c => CAT_COLORS[c.cat]), borderWidth: 0 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.label}: ${formatCurrency(c.raw, 'TZS')} TZS (${(c.raw / runningTotal * 100).toFixed(1)}%)` } },
          },
        },
      });
      reportCharts.push(chart);
    }

    // Petrol trend line
    const petrolCtx = document.getElementById('au-petrol-chart');
    if (petrolCtx) {
      const chart = new Chart(petrolCtx, {
        type: 'line',
        data: {
          labels: names,
          datasets: [{
            label: petrolLabel,
            data: petrolMonths,
            borderColor: '#ef4444',
            backgroundColor: '#ef444420',
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => `${petrolLabel}: ${formatCurrency(c.raw, 'TZS')} TZS` } },
          },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  function renderAutoYearly(allTx) {
    const allYears = getAvailableYears();
    const data = allYears.map(y => {
      const yearTx = allTx.filter(tx => tx.date && tx.date.startsWith(y));
      const running = yearTx.filter(tx => tx.category !== 'Automobile:Purchase').reduce((s, tx) => s + tx.amount, 0);
      const purchase = yearTx.filter(tx => tx.category === 'Automobile:Purchase').reduce((s, tx) => s + tx.amount, 0);
      const petrol = yearTx.filter(tx => tx.category === 'Automobile:Petrol').reduce((s, tx) => s + tx.amount, 0);
      const byCat = {};
      for (const cat of RUNNING_CATS) {
        byCat[cat] = yearTx.filter(tx => tx.category === cat).reduce((s, tx) => s + tx.amount, 0);
      }
      return { year: y, running, purchase, petrol, total: running + purchase, count: yearTx.length, byCat };
    });

    const activeCats = RUNNING_CATS.filter(cat => data.some(d => d.byCat[cat] > 0));

    const content = document.getElementById('au-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${escapeHtml(t('reports.auto.title_yearly', {}, 'Automobile Costs by Year (TZS)'))}</div>
        <div class="table-scroll-wrapper"><table class="tx-table nowrap">
          <thead><tr>
            <th>${t('reports.toolbar.year', {}, 'Year')}</th>
            ${activeCats.map(cat => `<th class="t-right">${escapeHtml(CAT_SHORT[cat])}</th>`).join('')}
            <th class="t-right">${t('reports.auto.col_running', {}, 'Running')}</th>
            <th class="t-right">${t('reports.auto.purchase', {}, 'Purchase')}</th>
            <th class="num-right">${t('reports.shared.total_label', {}, 'Total')}</th>
          </tr></thead>
          <tbody>
            ${data.map(d => `<tr>
              <td style="font-weight:500;">${d.year}</td>
              ${activeCats.map(cat => `<td class="amt" style="color:${CAT_COLORS[cat]}">${formatCurrency(d.byCat[cat] || 0, 'TZS')}</td>`).join('')}
              <td class="amt">${formatCurrency(d.running, 'TZS')}</td>
              <td class="amt c-mut">${formatCurrency(d.purchase, 'TZS')}</td>
              <td class="amt fw-700">${formatCurrency(d.total, 'TZS')}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.auto.chart_yearly_running', {}, 'Running Costs by Year')}</div>
            <div class="chart-canvas-box"><canvas id="au-year-stack"></canvas></div>
          </div>
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.auto.chart_petrol_trend', {}, 'Petrol Cost Trend')}</div>
            <div class="chart-canvas-box"><canvas id="au-year-petrol"></canvas></div>
          </div>
        </div>
      </div>
    `;

    // Yearly stacked bar
    const stackCtx = document.getElementById('au-year-stack');
    if (stackCtx) {
      const chart = new Chart(stackCtx, {
        type: 'bar',
        data: {
          labels: data.map(d => d.year),
          datasets: activeCats.map(cat => ({
            label: CAT_SHORT[cat],
            data: data.map(d => d.byCat[cat] || 0),
            backgroundColor: CAT_COLORS[cat],
            borderWidth: 0,
          })),
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, 'TZS')} TZS` } },
          },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }

    // Yearly petrol line
    const petrolCtx = document.getElementById('au-year-petrol');
    if (petrolCtx) {
      const yrPetrolLabel = t('reports.auto.cat.petrol', {}, 'Petrol');
      const chart = new Chart(petrolCtx, {
        type: 'line',
        data: {
          labels: data.map(d => d.year),
          datasets: [{
            label: yrPetrolLabel,
            data: data.map(d => d.petrol),
            borderColor: '#ef4444',
            backgroundColor: '#ef444420',
            fill: true,
            tension: 0.3,
            pointRadius: 5,
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${yrPetrolLabel}: ${formatCurrency(c.raw, 'TZS')} TZS` } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  update();
}
