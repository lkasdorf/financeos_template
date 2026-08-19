// ─── AI Costs Report ─────────────────────────────────────────────────────

// ─── Bills Report ────────────────────────────────────────────────────────

// Bills bucket metadata. The category list per bucket comes from
// config/reports.json (window.REPORTS_CONFIG.bills.buckets) so users with
// renamed categories can still drive the report — see Settings → Reports.
// Color + i18n label keys stay here. Getters re-read REPORTS_CONFIG every
// call so a Settings save takes effect on the next render without a reload.
const BILLS_BUCKET_META = [
  { id: 'rent',        get label() { return t('reports.bills.cat.rent', {}, 'Rent'); },               get color() { return chartPalette()[11]; } },
  { id: 'electricity', get label() { return t('reports.bills.cat.electricity', {}, 'Electricity'); }, get color() { return chartPalette()[1]; } },
  { id: 'water',       get label() { return t('reports.bills.cat.water', {}, 'Water'); },             get color() { return chartPalette()[3]; } },
  { id: 'internet',    get label() { return t('reports.bills.cat.internet', {}, 'Internet'); },       get color() { return chartPalette()[8]; } },
];
function billsBuckets() {
  return BILLS_BUCKET_META.map(meta => ({
    ...meta,
    categories: getReportCategories('bills', meta.id),
  }));
}
function billsAllCategories() {
  return billsBuckets().flatMap(b => b.categories);
}

// Automobile bucket metadata. Same pattern as BILLS_BUCKET_META — colors and
// localized labels live here, the actual category list per bucket lives in
// config/reports.json (window.REPORTS_CONFIG.automobile.buckets). 'purchase'
// is the one-off bucket; everything else is a "running" cost bucket.
const AUTO_BUCKET_META = [
  { id: 'purchase',     get label() { return t('reports.auto.cat.purchase',     {}, 'Purchase');     }, get color() { return chartPalette()[11]; }, running: false },
  { id: 'petrol',       get label() { return t('reports.auto.cat.petrol',       {}, 'Petrol');       }, get color() { return chartPalette()[6]; }, running: true  },
  { id: 'toll',         get label() { return t('reports.auto.cat.toll',         {}, 'Toll');         }, get color() { return chartPalette()[1]; }, running: true  },
  { id: 'parking',      get label() { return t('reports.auto.cat.parking',      {}, 'Parking');      }, get color() { return chartPalette()[2]; }, running: true  },
  { id: 'maintenance',  get label() { return t('reports.auto.cat.maintenance',  {}, 'Maintenance');  }, get color() { return chartPalette()[0]; }, running: true  },
  { id: 'insurance',    get label() { return t('reports.auto.cat.insurance',    {}, 'Insurance');    }, get color() { return chartPalette()[10]; }, running: true  },
  { id: 'registration', get label() { return t('reports.auto.cat.registration', {}, 'Registration'); }, get color() { return chartPalette()[3]; }, running: true  },
  { id: 'accessories',  get label() { return t('reports.auto.cat.accessories',  {}, 'Accessories');  }, get color() { return chartPalette()[5]; }, running: true  },
  { id: 'car_rental',   get label() { return t('reports.auto.cat.car_rental',   {}, 'Car Rental');   }, get color() { return chartPalette()[4]; }, running: true  },
  { id: 'other',        get label() { return t('reports.auto.cat.other',        {}, 'Other');        }, get color() { return chartPalette()[9]; }, running: true  },
];
function autoBuckets() {
  return AUTO_BUCKET_META.map(meta => ({
    ...meta,
    categories: getReportCategories('automobile', meta.id),
  }));
}
function autoRunningBuckets() {
  return autoBuckets().filter(b => b.running);
}
function autoPurchaseCategories() {
  return new Set(getReportCategories('automobile', 'purchase'));
}
function autoAllCategories() {
  return autoBuckets().flatMap(b => b.categories);
}

function renderBillsReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();

  // DR-M4: toolbar rendering/persistence/wiring live in reportToolbar()
  // (reports-shared.js). reportId 'bills' + keys mode/year/cur keep the
  // legacy data-bills-* attributes, so saved UI state survives.
  const tb = reportToolbar(out, 'bills', [
    { key: 'mode', label: t('reports.toolbar.mode', {}, 'Mode'), def: 'monthly',
      options: [
        { v: 'monthly', l: t('reports.toolbar.monthly', {}, 'Monthly') },
        { v: 'yearly', l: t('reports.toolbar.yearly', {}, 'Yearly') },
      ] },
    { key: 'year', label: t('reports.toolbar.year', {}, 'Year'),
      options: years, def: years[years.length - 1] || '2026' },
    { key: 'cur', label: t('common.col.currency', {}, 'Currency'),
      options: reportCurrencies(), def: 'TZS' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="bl-content"></div>
    </div>
  `;

  function update() {
    tb.el('year').style.display = tb.get('mode') === 'yearly' ? 'none' : '';
    destroyReportCharts();
    const cur = tb.get('cur');
    const billsCats = new Set(billsAllCategories());
    // DR-M6: exclude custody accounts like the Automobile report below —
    // bills paid from custody money aren't Leon's operational cost.
    const custodyAliases = getCustodyAliases();
    const filtered = state.tx.filter(tx =>
      tx.type === 'expense' && tx.category && billsCats.has(tx.category) &&
      !custodyAliases.has(tx.account)
    ).map(tx => ({ ...tx, amount: convertTo(tx.amount, tx.currency, cur) }));
    // rc.17 — actionable empty state when no TX in the entire dataset match
    // any of the configured Bills bucket categories.
    if (filtered.length === 0) {
      renderReportEmptyState({
        containerId: 'bl-content',
        filterId: 'bills',
        filterLabel: t('reports.bills.title', {}, 'Bills Overview'),
      });
      return;
    }
    if (tb.get('mode') === 'monthly') renderBillsMonthly(filtered, tb.get('year'), cur);
    else renderBillsYearly(filtered, cur);
  }

  tb.wire(update);
}

function renderBillsMonthly(filtered, year, currency) {
  const englishMonthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const names = englishMonthShort.map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
  const buckets = billsBuckets();
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    const row = { ym, label: monthLabel(ym), total: 0, count: 0 };
    for (const bc of buckets) row[bc.id] = 0;
    for (const tx of filtered) {
      if (tx.date && tx.date.startsWith(ym)) {
        row.total += tx.amount;
        row.count++;
        const bucket = buckets.find(b => b.categories.includes(tx.category));
        if (bucket) row[bucket.id] += tx.amount;
      }
    }
    months.push(row);
  }

  const grandTotal = months.reduce((s, m) => s + m.total, 0);
  const activeMonths = months.filter(m => m.total > 0).length;
  const avgPerMonth = activeMonths > 0 ? grandTotal / activeMonths : 0;

  // Per-bucket totals
  const catTotals = buckets.map(bc => ({
    ...bc,
    total: months.reduce((s, m) => s + m[bc.id], 0),
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
      <div class="income-grid ig-uniform mt-8">
        ${months.map(m => `
          <div class="income-cell${isFutureYm(m.ym) ? ' ic-future' : ''}">
            <div class="ic-label">${m.label}</div>
            <div class="ic-value ${m.total === 0 ? 'zero' : ''}" style="color:${m.total > 0 ? 'var(--negative)' : 'var(--muted)'}">${formatCurrency(m.total, currency)}<span class="ic-cur">${currency}</span></div>
            ${isFutureYm(m.ym) ? '' : `<div class="ic-count">${buckets.map(bc => m[bc.id] > 0 ? `${bc.label.slice(0,4)} ${formatCurrency(m[bc.id], currency)}` : '').filter(Boolean).join(' · ')}</div>`}
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
        datasets: buckets.map(bc => ({
          label: bc.label,
          data: months.map(m => m[bc.id]),
          backgroundColor: bc.color,
          borderWidth: 0,
        })),
      },
      options: {
        ...CHART_BASE,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, padding: 12, font: { size: 10 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } },
        },
        scales: {
          x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
          y: { stacked: true, ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
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
        indexAxis: 'y', ...CHART_BASE,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, currency) + ' ' + currency } } },
        scales: {
          x: { ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
          y: { grid: { display: false } },
        },
      },
    });
    reportCharts.push(chart);
  }
}

function renderBillsYearly(filtered, currency) {
  const years = getAvailableYears();
  const buckets = billsBuckets();
  const data = [];
  for (const y of years) {
    const row = { year: y, total: 0, count: 0 };
    for (const bc of buckets) row[bc.id] = 0;
    for (const tx of filtered) {
      if (tx.date && tx.date.startsWith(y)) {
        row.total += tx.amount;
        row.count++;
        const bucket = buckets.find(b => b.categories.includes(tx.category));
        if (bucket) row[bucket.id] += tx.amount;
      }
    }
    data.push(row);
  }

  const grandTotal = data.reduce((s, d) => s + d.total, 0);
  const catTotals = buckets.map(bc => ({
    ...bc,
    total: data.reduce((s, d) => s + d[bc.id], 0),
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
            <div class="ic-count">${buckets.map(bc => d[bc.id] > 0 ? `${bc.label.slice(0,4)} ${formatCurrency(d[bc.id], currency)}` : '').filter(Boolean).join(' · ')}</div>
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
        datasets: buckets.map(bc => ({
          label: bc.label,
          data: data.map(d => d[bc.id]),
          backgroundColor: bc.color,
          borderWidth: 0,
        })),
      },
      options: {
        ...CHART_BASE,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, padding: 12, font: { size: 10 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } },
        },
        scales: {
          x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
          y: { stacked: true, ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
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

  // DR-M4: toolbar rendering/persistence/wiring live in reportToolbar()
  // (reports-shared.js). reportId 'auto' + keys mode/year keep the legacy
  // data-auto-* attributes, so saved UI state survives.
  const tb = reportToolbar(out, 'auto', [
    { key: 'mode', label: t('reports.toolbar.mode', {}, 'Mode'), def: 'monthly',
      options: [
        { v: 'monthly', l: t('reports.toolbar.monthly', {}, 'Monthly') },
        { v: 'yearly', l: t('reports.toolbar.yearly', {}, 'Yearly') },
      ] },
    { key: 'year', label: t('reports.toolbar.year', {}, 'Year'),
      options: years, def: years[years.length - 1] || '2026' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="au-content"></div>
    </div>
  `;

  // Bucket-based: running buckets exclude purchase, all categories driven by
  // window.REPORTS_CONFIG.automobile.buckets so users with renamed categories
  // (e.g. "Tankstelle" instead of "Automobile:Petrol") can still drive the
  // report via Settings → Reports.
  const runningBuckets = autoRunningBuckets();
  const purchaseCats = autoPurchaseCategories();
  const allAutoCats = new Set(autoAllCategories());

  // Per-bucket lookups for chart colors and short labels (legacy cat-string
  // keys are gone — buckets now map id → meta).
  const BUCKET_BY_ID = Object.fromEntries(autoBuckets().map(b => [b.id, b]));
  // Reverse lookup: for any tx category, return its bucket id (or null).
  function bucketIdFor(category) {
    for (const b of autoBuckets()) {
      if (b.categories.includes(category)) return b.id;
    }
    return null;
  }

  const custodyAliases = getCustodyAliases();
  const allAutoTx = state.tx.filter(tx =>
    tx.type === 'expense' && tx.category && allAutoCats.has(tx.category) && !custodyAliases.has(tx.account)
  ).map(tx => ({ ...tx, amount: convertToTZS(tx.amount, tx.currency) }));

  // rc.17 — actionable empty state when no TX in the entire dataset match
  // any of the configured Automobile bucket categories.
  if (allAutoTx.length === 0) {
    renderReportEmptyState({
      containerId: 'au-content',
      filterId: 'automobile',
      filterLabel: t('reports.automobile.title', {}, 'Automobile'),
    });
    return;
  }

  function update() {
    tb.el('year').style.display = tb.get('mode') === 'yearly' ? 'none' : '';
    destroyReportCharts();

    if (tb.get('mode') === 'monthly') renderAutoMonthly(allAutoTx, tb.get('year'));
    else renderAutoYearly(allAutoTx);
  }

  function renderAutoMonthly(allTx, year) {
    const yearTx = allTx.filter(tx => tx.date && tx.date.startsWith(year));
    const runningTx = yearTx.filter(tx => !purchaseCats.has(tx.category));
    const purchaseTx = yearTx.filter(tx => purchaseCats.has(tx.category));
    const purchaseTotal = purchaseTx.reduce((s, tx) => s + tx.amount, 0);

    // Monthly data per bucket
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      const row = { ym, label: monthLabel(ym) };
      let total = 0;
      for (const bucket of runningBuckets) row[bucket.id] = 0;
      for (const tx of runningTx) {
        if (tx.date && tx.date.startsWith(ym)) {
          const bid = bucketIdFor(tx.category);
          if (bid && row[bid] !== undefined) {
            row[bid] += tx.amount;
            total += tx.amount;
          }
        }
      }
      row.total = total;
      row.count = runningTx.filter(tx => tx.date && tx.date.startsWith(ym)).length;
      months.push(row);
    }

    // Petrol data for trend line (bucket id 'petrol')
    const petrolMonths = months.map(m => m.petrol || 0);
    const petrolTotal = petrolMonths.reduce((s, v) => s + v, 0);
    const petrolCount = runningTx.filter(tx => bucketIdFor(tx.category) === 'petrol' && tx.date.startsWith(year)).length;

    const runningTotal = months.reduce((s, m) => s + m.total, 0);
    const activeMonths = months.filter(m => m.total > 0).length;
    const avgPerMonth = activeMonths > 0 ? runningTotal / activeMonths : 0;
    const grandTotal = runningTotal + purchaseTotal;

    // Per-bucket totals for the year
    const catTotals = runningBuckets.map(bucket => ({
      cat: bucket.id, label: bucket.label,
      total: runningTx.filter(tx => bucketIdFor(tx.category) === bucket.id).reduce((s, tx) => s + tx.amount, 0),
      count: runningTx.filter(tx => bucketIdFor(tx.category) === bucket.id).length,
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
            <div class="ic-value c-warn">${formatCurrency(grandTotal, 'TZS')}<span class="ic-cur">TZS</span></div>
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
              ${catTotals.map(c => `<td class="amt" style="color:${BUCKET_BY_ID[c.cat]?.color}">${formatCurrency(m[c.cat] || 0, 'TZS')}</td>`).join('')}
              <td class="amt fw-700">${formatCurrency(m.total, 'TZS')}</td>
            </tr>`).join('')}
            <tr class="row-total">
              <td>${t('reports.shared.total_label', {}, 'Total')}</td>
              ${catTotals.map(c => `<td class="amt" style="color:${BUCKET_BY_ID[c.cat]?.color}">${formatCurrency(c.total, 'TZS')}</td>`).join('')}
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
            backgroundColor: BUCKET_BY_ID[c.cat]?.color,
            borderWidth: 0,
          })),
        },
        options: {
          ...CHART_BASE,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, 'TZS')} TZS` } },
          },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: currencyTicks('TZS'), grid: { color: cssVar('--chart-grid') } },
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
          datasets: [{ data: catTotals.map(c => c.total), backgroundColor: catTotals.map(c => BUCKET_BY_ID[c.cat]?.color), borderWidth: 0 }],
        },
        options: {
          ...CHART_BASE,
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
            borderColor: cssVar('--negative'),
            backgroundColor: chartTint(cssVar('--negative'), 0.13),
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            borderWidth: 2,
          }],
        },
        options: {
          ...CHART_BASE,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => `${petrolLabel}: ${formatCurrency(c.raw, 'TZS')} TZS` } },
          },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: currencyTicks('TZS'), grid: { color: cssVar('--chart-grid') } },
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
      const running = yearTx.filter(tx => !purchaseCats.has(tx.category)).reduce((s, tx) => s + tx.amount, 0);
      const purchase = yearTx.filter(tx => purchaseCats.has(tx.category)).reduce((s, tx) => s + tx.amount, 0);
      const petrol = yearTx.filter(tx => bucketIdFor(tx.category) === 'petrol').reduce((s, tx) => s + tx.amount, 0);
      const byCat = {};
      for (const bucket of runningBuckets) {
        byCat[bucket.id] = yearTx.filter(tx => bucketIdFor(tx.category) === bucket.id).reduce((s, tx) => s + tx.amount, 0);
      }
      return { year: y, running, purchase, petrol, total: running + purchase, count: yearTx.length, byCat };
    });

    // Active buckets = those with non-zero spend in at least one year.
    const activeBuckets = runningBuckets.filter(b => data.some(d => d.byCat[b.id] > 0));

    const content = document.getElementById('au-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${escapeHtml(t('reports.auto.title_yearly', {}, 'Automobile Costs by Year (TZS)'))}</div>
        <div class="table-scroll-wrapper"><table class="tx-table nowrap">
          <thead><tr>
            <th>${t('reports.toolbar.year', {}, 'Year')}</th>
            ${activeBuckets.map(b => `<th class="t-right">${escapeHtml(b.label)}</th>`).join('')}
            <th class="t-right">${t('reports.auto.col_running', {}, 'Running')}</th>
            <th class="t-right">${t('reports.auto.purchase', {}, 'Purchase')}</th>
            <th class="num-right">${t('reports.shared.total_label', {}, 'Total')}</th>
          </tr></thead>
          <tbody>
            ${data.map(d => `<tr>
              <td class="fw-500">${d.year}</td>
              ${activeBuckets.map(b => `<td class="amt" style="color:${b.color}">${formatCurrency(d.byCat[b.id] || 0, 'TZS')}</td>`).join('')}
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
          datasets: activeBuckets.map(b => ({
            label: b.label,
            data: data.map(d => d.byCat[b.id] || 0),
            backgroundColor: b.color,
            borderWidth: 0,
          })),
        },
        options: {
          ...CHART_BASE,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, 'TZS')} TZS` } },
          },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: currencyTicks('TZS'), grid: { color: cssVar('--chart-grid') } },
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
            borderColor: cssVar('--negative'),
            backgroundColor: chartTint(cssVar('--negative'), 0.13),
            fill: true,
            tension: 0.3,
            pointRadius: 5,
            borderWidth: 2,
          }],
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${yrPetrolLabel}: ${formatCurrency(c.raw, 'TZS')} TZS` } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: currencyTicks('TZS'), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}
