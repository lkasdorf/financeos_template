function renderIncomeReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];

  // Default state from data attributes or defaults
  const savedMode = out.getAttribute('data-mode') || 'monthly';
  const savedYear = out.getAttribute('data-year') || years[years.length - 1] || '2026';
  const savedCur = out.getAttribute('data-cur') || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.mode', {}, 'Mode')}</label>
        <select id="ri-mode">
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.toolbar.monthly', {}, 'Monthly')}</option>
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.toolbar.yearly', {}, 'Yearly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="ri-year">
          ${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="ri-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="ri-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('ri-mode');
  const yearEl = document.getElementById('ri-year');
  const curEl = document.getElementById('ri-currency');

  function update() {
    out.setAttribute('data-mode', modeEl.value);
    out.setAttribute('data-year', yearEl.value);
    out.setAttribute('data-cur', curEl.value);
    // Show/hide year selector depending on mode
    yearEl.parentElement.querySelector('label:nth-of-type(2)');
    yearEl.style.display = modeEl.value === 'yearly' ? 'none' : '';
    destroyReportCharts();
    if (modeEl.value === 'monthly') renderIncomeMonthly(yearEl.value, curEl.value);
    else renderIncomeYearly(curEl.value);
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

function renderIncomeMonthly(year, currency) {
  const incomeTx = getIncomeTransactions(currency);
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    let total = 0, count = 0, real = 0, reimb = 0;
    const byCat = {};
    for (const tx of incomeTx) {
      if (tx.date && tx.date.startsWith(ym)) {
        total += tx.amount;
        count++;
        if (tx.category && tx.category.includes('Reimbursement')) reimb += tx.amount;
        else real += tx.amount;
        const cat = tx.category || t('reports.shared.uncategorized', {}, '(uncategorized)');
        byCat[cat] = (byCat[cat] || 0) + tx.amount;
      }
    }
    months.push({ ym, label: monthLabel(ym), total, count, real, reimb, byCat });
  }

  const grandTotal = months.reduce((s, m) => s + m.total, 0);
  const grandCount = months.reduce((s, m) => s + m.count, 0);
  const activeMonths = months.filter(m => m.total > 0).length;
  const avgPerMonth = activeMonths > 0 ? grandTotal / activeMonths : 0;
  // Localized short month names (common.months.short.{1..12}).
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    .map((en, i) => t(`common.months.short.${i + 1}`, {}, en));

  // Split: real income vs reimbursements
  let realTotal = 0, reimbTotal = 0;
  for (const tx of incomeTx) {
    if (tx.date && tx.date.startsWith(year)) {
      if (tx.category && tx.category.includes('Reimbursement')) reimbTotal += tx.amount;
      else realTotal += tx.amount;
    }
  }

  // Collect all income categories across the year
  const allCats = {};
  for (const m of months) {
    for (const [cat, val] of Object.entries(m.byCat)) {
      allCats[cat] = (allCats[cat] || 0) + val;
    }
  }
  const topCats = Object.entries(allCats).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const content = document.getElementById('ri-content');
  const activeMonthsLabel = activeMonths === 1
    ? t('reports.shared.active_months_one', { n: activeMonths }, '1 active month')
    : t('reports.shared.active_months_many', { n: activeMonths }, `${activeMonths} active months`);
  content.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${t('reports.income.monthly.title', { year, currency }, `Income ${year} — ${currency}`)}</div>
      <div class="income-grid">
        <div class="income-cell">
          <div class="ic-label">${t('reports.shared.year_total', {}, 'Year Total')}</div>
          <div class="ic-value">${formatCurrency(grandTotal, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.shared.tx_count', { n: grandCount }, `${grandCount} TX`)}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.shared.avg_per_month', {}, 'Avg / Month')}</div>
          <div class="ic-value">${formatCurrency(avgPerMonth, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${activeMonthsLabel}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.income.tile.real_income', {}, 'Real Income')}</div>
          <div class="ic-value">${formatCurrency(realTotal, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.income.tile.real_subtitle', {}, 'Salary, interest, other')}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.income.tile.reimbursements', {}, 'Reimbursements')}</div>
          <div class="ic-value" style="color:var(--info)">${formatCurrency(reimbTotal, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.income.tile.reimb_subtitle', {}, 'Business pass-through')}</div>
        </div>
      </div>
      <div class="income-grid mt-8">
        ${months.map(m => `
          <div class="income-cell">
            <div class="ic-label">${m.label}</div>
            <div class="ic-value ${m.total === 0 ? 'zero' : ''}">${formatCurrency(m.total, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.shared.tx_count', { n: m.count }, `${m.count} TX`)}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="report-section">
      <div class="chart-row">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.income.chart.by_month', {}, 'Income by Month')}</div>
          <div class="chart-canvas-box"><canvas id="ri-bar-chart"></canvas></div>
        </div>
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.income.chart.by_category', { n: 8 }, 'Income by Category (Top 8)')}</div>
          <div class="chart-canvas-box"><canvas id="ri-cat-chart"></canvas></div>
        </div>
      </div>
    </div>
  `;

  // Stacked bar chart — real income vs reimbursements
  const barCtx = document.getElementById('ri-bar-chart');
  if (barCtx) {
    const chart = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: names,
        datasets: [
          { label: t('reports.income.dataset.real', {}, 'Real Income'), data: months.map(m => m.real), backgroundColor: '#10b981', borderWidth: 0 },
          { label: t('reports.income.dataset.reimb', {}, 'Reimbursements'), data: months.map(m => m.reimb), backgroundColor: '#3b82f6', borderWidth: 0 },
        ],
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

  // Horizontal bar — by category
  const catCtx = document.getElementById('ri-cat-chart');
  if (catCtx) {
    const chart = new Chart(catCtx, {
      type: 'bar',
      data: {
        labels: topCats.map(([c]) => c.length > 28 ? c.slice(0, 27) + '...' : c),
        datasets: [{
          data: topCats.map(([, v]) => v),
          backgroundColor: '#1e40af',
          borderWidth: 0,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, currency) + ' ' + currency } } },
        scales: {
          x: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
          y: { grid: { display: false } },
        },
      },
    });
    reportCharts.push(chart);
  }

  // Transaction list for the selected year
  const yearTx = incomeTx.filter(tx => tx.date && tx.date.startsWith(year)).sort((a, b) => b.date.localeCompare(a.date));
  if (yearTx.length > 0) {
    const txSection = document.createElement('div');
    txSection.className = 'report-section';
    txSection.innerHTML = `
      <div class="report-section-title">${t('reports.income.tx_heading', { year, n: yearTx.length }, `Income Transactions ${year} (${yearTx.length})`)}</div>
      <table class="tx-table"><thead><tr>
        <th>${t('common.label.date', {}, 'Date')}</th>
        <th>${t('common.col.payee', {}, 'Payee')}</th>
        <th>${t('common.col.category', {}, 'Category')}</th>
        <th>${t('common.col.amount', {}, 'Amount')}</th>
        <th>${t('common.col.native', {}, 'Native')}</th>
      </tr></thead><tbody>
        ${yearTx.map(tx => `<tr>
          <td>${fmtDate(tx.date)}</td>
          <td>${escapeHtml(tx.payee || '')}</td>
          <td class="sub-text">${escapeHtml(tx.category || '')}</td>
          <td style="text-align:right;font-weight:500;color:var(--positive)">${formatCurrency(tx.amount, currency)} ${currency}</td>
          <td style="text-align:right;font-size:11px;color:var(--muted)">${tx.currency !== currency ? formatCurrency(tx.originalAmount || 0, tx.currency) + ' ' + tx.currency : ''}</td>
        </tr>`).join('')}
      </tbody></table>
    `;
    content.appendChild(txSection);
  }
}

function renderIncomeYearly(currency) {
  const incomeTx = getIncomeTransactions(currency);
  const years = getAvailableYears();
  const data = [];
  for (const y of years) {
    let total = 0, count = 0, real = 0, reimb = 0;
    for (const tx of incomeTx) {
      if (tx.date && tx.date.startsWith(y)) {
        total += tx.amount; count++;
        if (tx.category && tx.category.includes('Reimbursement')) reimb += tx.amount;
        else real += tx.amount;
      }
    }
    data.push({ year: y, total, count, real, reimb });
  }

  const grandTotal = data.reduce((s, d) => s + d.total, 0);
  const grandReal = data.reduce((s, d) => s + d.real, 0);
  const grandReimb = data.reduce((s, d) => s + d.reimb, 0);

  const content = document.getElementById('ri-content');
  content.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${t('reports.income.yearly.title', { currency }, `Income by Year — ${currency}`)}</div>
      <div class="income-grid">
        <div class="income-cell">
          <div class="ic-label">${t('reports.income.tile.grand_total', {}, 'Grand Total')}</div>
          <div class="ic-value">${formatCurrency(grandTotal, currency)}<span class="ic-cur">${currency}</span></div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.income.tile.real_income', {}, 'Real Income')}</div>
          <div class="ic-value">${formatCurrency(grandReal, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.income.tile.real_subtitle', {}, 'Salary, interest, other')}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.income.tile.reimbursements', {}, 'Reimbursements')}</div>
          <div class="ic-value" style="color:var(--info)">${formatCurrency(grandReimb, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.income.tile.reimb_subtitle', {}, 'Business pass-through')}</div>
        </div>
      </div>
      <div class="income-grid mt-8">
        ${data.map(d => `
          <div class="income-cell">
            <div class="ic-label">${d.year}</div>
            <div class="ic-value ${d.total === 0 ? 'zero' : ''}">${formatCurrency(d.total, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.income.yearly.cell_detail', { n: d.count, real: formatCurrency(d.real, currency), reimb: formatCurrency(d.reimb, currency) }, `${d.count} TX · Real ${formatCurrency(d.real, currency)} · Reimb ${formatCurrency(d.reimb, currency)}`)}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="report-section">
      <div class="chart-wrap">
        <div class="report-section-title">${t('reports.income.chart.by_year', {}, 'Income by Year')}</div>
        <div class="chart-canvas-box"><canvas id="ri-year-chart"></canvas></div>
      </div>
    </div>
  `;

  const ctx = document.getElementById('ri-year-chart');
  if (ctx) {
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.year),
        datasets: [{
          data: data.map(d => d.total),
          backgroundColor: '#1e40af',
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, currency) + ' ' + currency } } },
        scales: {
          x: { grid: { color: cssVar('--chart-grid') } },
          y: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
        },
      },
    });
    reportCharts.push(chart);
  }
}
// ─── Household Report ─────────────────────────────────────────────────────

function renderHouseholdReport() {
  renderExpenseReport({
    filterId: 'household',
    filterLabel: t('reports.filter_label.household', {}, 'Household Costs'),
    filterFn: (tx) => tx.type === 'expense' && tx.tags && tx.tags.split(';').includes('Household_costs'),
    colorMain: '#f0a060',
    showTransactions: true,
    showCategoryBreakdown: true,
    sinceDate: '2024-04-01',
  });
}


// ─── AI Costs Report ─────────────────────────────────────────────────────

function renderAICostsReport() {
  renderExpenseReport({
    filterId: 'ai',
    filterLabel: t('reports.filter_label.ai', {}, 'AI Subscriptions'),
    filterFn: (tx) => tx.type === 'expense' && matchesReportCategory(tx, 'ai_costs'),
    colorMain: '#1e40af',
    showTransactions: true,
  });
}


// ─── Dining Out Report ──────────────────────────────────────────────────

function renderDiningReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();

  const savedMode = out.getAttribute('data-dining-mode') || 'monthly';
  const savedYear = out.getAttribute('data-dining-year') || years[years.length - 1] || '2026';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.mode', {}, 'Mode')}</label>
        <select id="dn-mode">
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.toolbar.monthly', {}, 'Monthly')}</option>
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.toolbar.yearly', {}, 'Yearly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="dn-year">
          ${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      </div>
      <div id="dn-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('dn-mode');
  const yearEl = document.getElementById('dn-year');

  function update() {
    out.setAttribute('data-dining-mode', modeEl.value);
    out.setAttribute('data-dining-year', yearEl.value);
    yearEl.style.display = modeEl.value === 'yearly' ? 'none' : '';
    destroyReportCharts();

    // Filter: Dining-out expenses per config/reports.json (all currencies → TZS)
    const custodyAliases = getCustodyAliases();
    const diningTx = state.tx.filter(tx =>
      tx.type === 'expense' && matchesReportCategory(tx, 'dining_out') && !custodyAliases.has(tx.account)
    );

    if (modeEl.value === 'monthly') renderDiningMonthly(diningTx, yearEl.value);
    else renderDiningYearly(diningTx);
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  update();
}

function classifyDining(tx) {
  // Business = paid via any account belonging to a configured business
  // entity (entities[].accounts) OR carrying any of the configured
  // BUSINESS_* tags. Aggregates across all entities into a single
  // "Business" bucket for the dining split — per-entity breakdown lives
  // in the Reimbursements report.
  const bizAliases = getBusinessAccountAliases();
  if (bizAliases.has(tx.account)) return 'business';
  const tags = (tx.tags || '').split(';');
  for (const bt of getBusinessTags()) {
    if (tags.includes(bt)) return 'business';
  }
  return 'personal';
}

function renderDiningMonthly(diningTx, year) {
  // Colors come from the first configured business entity so single-entity
  // setups keep a consistent visual; multi-business setups aggregate under
  // that primary color (per-entity breakdown is in the Reimbursements
  // report). Falls back to a static color for forks with no business
  // entities.
  const colorPersonal = '#1e40af';
  const colorBusiness = (getBusinessEntities()[0]?.color) || '#f59e0b';
  const englishMonthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const names = englishMonthShort.map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
  const unknownLabel = t('reports.shared.unknown', {}, '(unknown)');
  const labelPersonal = t('reports.dining.cls_personal', {}, 'Personal');
  const labelBusiness = t('reports.dining.cls_business', {}, 'Business');

  const months = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    let pers = 0, biz = 0, persCount = 0, bizCount = 0;
    const byRestaurant = {};
    for (const tx of diningTx) {
      if (!tx.date || !tx.date.startsWith(ym)) continue;
      const amt = convertToTZS(tx.amount, tx.currency);
      const cls = classifyDining(tx);
      if (cls === 'business') { biz += amt; bizCount++; }
      else { pers += amt; persCount++; }
      const r = tx.payee || unknownLabel;
      if (!byRestaurant[r]) byRestaurant[r] = { pers: 0, biz: 0 };
      if (cls === 'business') byRestaurant[r].biz += amt;
      else byRestaurant[r].pers += amt;
    }
    months.push({ ym, label: monthLabel(ym), pers, biz, total: pers + biz, persCount, bizCount, count: persCount + bizCount, byRestaurant });
  }

  const totPers = months.reduce((s, m) => s + m.pers, 0);
  const totBiz = months.reduce((s, m) => s + m.biz, 0);
  const totAll = totPers + totBiz;
  const totCount = months.reduce((s, m) => s + m.count, 0);
  const activeMonths = months.filter(m => m.total > 0).length;
  const avgPerMonth = activeMonths > 0 ? totAll / activeMonths : 0;

  // Top restaurants across year
  const allRestaurants = {};
  for (const m of months) {
    for (const [r, v] of Object.entries(m.byRestaurant)) {
      if (!allRestaurants[r]) allRestaurants[r] = { pers: 0, biz: 0 };
      allRestaurants[r].pers += v.pers;
      allRestaurants[r].biz += v.biz;
    }
  }
  const topRestaurants = Object.entries(allRestaurants)
    .map(([name, v]) => ({ name, pers: v.pers, biz: v.biz, total: v.pers + v.biz }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const totPersCount = months.reduce((s, m) => s + m.persCount, 0);
  const totBizCount = months.reduce((s, m) => s + m.bizCount, 0);
  const content = document.getElementById('dn-content');
  content.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${escapeHtml(t('reports.dining.title_monthly', { year }, `Dining Out ${year} (all amounts in TZS)`))}</div>
      <div class="income-grid">
        <div class="income-cell">
          <div class="ic-label">${t('reports.shared.total_label', {}, 'Total')}</div>
          <div class="ic-value c-text">${formatCurrency(totAll, 'TZS')}<span class="ic-cur">TZS</span></div>
          <div class="ic-count">${escapeHtml(t('reports.dining.visits_avg', { n: totCount, amount: formatCurrency(avgPerMonth, 'TZS') }, `${totCount} visits · avg ${formatCurrency(avgPerMonth, 'TZS')} / month`))}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label" style="color:${colorPersonal}">${t('reports.dining.tile_personal_label', {}, '&#9632; Personal')}</div>
          <div class="ic-value" style="color:${colorPersonal}">${formatCurrency(totPers, 'TZS')}<span class="ic-cur">TZS</span></div>
          <div class="ic-count">${escapeHtml(t('reports.dining.tile_tx_pct', { n: totPersCount, pct: totAll > 0 ? Math.round(totPers / totAll * 100) : 0 }, `${totPersCount} TX · ${totAll > 0 ? Math.round(totPers / totAll * 100) : 0}%`))}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label" style="color:${colorBusiness}">${t('reports.dining.tile_business_label', {}, '&#9632; Business')}</div>
          <div class="ic-value" style="color:${colorBusiness}">${formatCurrency(totBiz, 'TZS')}<span class="ic-cur">TZS</span></div>
          <div class="ic-count">${escapeHtml(t('reports.dining.tile_tx_pct', { n: totBizCount, pct: totAll > 0 ? Math.round(totBiz / totAll * 100) : 0 }, `${totBizCount} TX · ${totAll > 0 ? Math.round(totBiz / totAll * 100) : 0}%`))}</div>
        </div>
      </div>
      <div class="income-grid mt-8">
        ${months.map(m => {
          const visitsLabel = t('reports.dining.monthly_tile_count', { n: m.count }, `${m.count} visits`);
          const bizPctLabel = m.biz > 0
            ? ` · <span style="color:${colorBusiness}">${t('reports.dining.monthly_tile_business_pct', { pct: Math.round(m.biz / m.total * 100) }, `${Math.round(m.biz / m.total * 100)}% Business`)}</span>`
            : '';
          return `
          <div class="income-cell">
            <div class="ic-label">${m.label}</div>
            <div class="ic-value ${m.total === 0 ? 'zero' : ''}">${formatCurrency(m.total, 'TZS')}<span class="ic-cur">TZS</span></div>
            <div class="ic-count">${escapeHtml(visitsLabel)}${bizPctLabel}</div>
          </div>
        `;
        }).join('')}
      </div>
    </div>
    <div class="report-section">
      <div class="chart-wrap mb-16">
        <div class="report-section-title">${t('reports.dining.chart_monthly_split', {}, 'Monthly — Personal vs. Business')}</div>
        <div class="chart-canvas-box"><canvas id="dn-stacked-chart"></canvas></div>
      </div>
      <div class="chart-wrap">
        <div class="report-section-title">${t('reports.dining.chart_top_restaurants', {}, 'Top Restaurants — Personal vs. Business')}</div>
        <div class="chart-canvas-box" style="height:${Math.max(280, topRestaurants.length * 36 + 60)}px;"><canvas id="dn-restaurant-chart"></canvas></div>
      </div>
    </div>
    <div class="report-section">
      <div class="chart-wrap">
        <div class="report-section-title">${t('reports.dining.chart_pie', {}, 'Personal vs. Business Split')}</div>
        <div class="chart-canvas-box" style="height:220px;max-width:320px;margin:0 auto;"><canvas id="dn-pie-chart"></canvas></div>
      </div>
    </div>
    <div class="report-section">
      <div class="report-section-title">${escapeHtml(t('reports.dining.all_tx_title', { year }, `All Dining Transactions ${year}`))}</div>
      <table class="tx-table"><thead><tr><th>${t('common.label.date', {}, 'Date')}</th><th>${t('reports.dining.col_restaurant', {}, 'Restaurant')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('reports.dining.col_source', {}, 'Source')}</th><th class="amt">${t('reports.dining.col_amount_tzs', {}, 'Amount (TZS)')}</th><th>${t('common.label.note', {}, 'Note')}</th></tr></thead><tbody>
        ${diningTx.filter(tx => tx.date && tx.date.startsWith(year)).sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(tx => {
          const cls = classifyDining(tx);
          const amt = convertToTZS(tx.amount, tx.currency);
          return `<tr>
            <td>${fmtDate(tx.date)}</td>
            <td>${escapeHtml(tx.payee || '')}</td>
            <td class="fs-11">${tx.account}</td>
            <td><span style="color:${cls === 'business' ? colorBusiness : colorPersonal};font-size:11px;font-weight:500">${escapeHtml(cls === 'business' ? labelBusiness : labelPersonal)}</span></td>
            <td class="amt">${formatCurrency(amt, 'TZS')}</td>
            <td style="font-size:11px;color:var(--muted)">${escapeHtml(tx.note || '')}</td>
          </tr>`;
        }).join('')}
      </tbody></table>
    </div>
  `;

  // Stacked bar chart
  const stackedCtx = document.getElementById('dn-stacked-chart');
  if (stackedCtx) {
    const chart = new Chart(stackedCtx, {
      type: 'bar',
      data: {
        labels: names,
        datasets: [
          { label: labelPersonal, data: months.map(m => m.pers), backgroundColor: colorPersonal, borderWidth: 0, borderRadius: 3 },
          { label: labelBusiness, data: months.map(m => m.biz), backgroundColor: colorBusiness, borderWidth: 0, borderRadius: 3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 11 } } }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, 'TZS') + ' TZS' } } },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: 'rgba(0,0,0,0.04)' } },
        },
      },
    });
    reportCharts.push(chart);
  }

  // Top restaurants horizontal bar (stacked personal/business)
  const restCtx = document.getElementById('dn-restaurant-chart');
  if (restCtx && topRestaurants.length > 0) {
    const chart = new Chart(restCtx, {
      type: 'bar',
      data: {
        labels: topRestaurants.map(r => r.name.length > 18 ? r.name.slice(0, 17) + '…' : r.name),
        datasets: [
          { label: labelPersonal, data: topRestaurants.map(r => r.pers), backgroundColor: colorPersonal, borderWidth: 0, borderRadius: 3 },
          { label: labelBusiness, data: topRestaurants.map(r => r.biz), backgroundColor: colorBusiness, borderWidth: 0, borderRadius: 3 },
        ],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { left: 0 } },
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 11 } } }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, 'TZS') + ' TZS' } } },
        scales: {
          x: { stacked: true, ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: cssVar('--chart-grid') } },
          y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 }, autoSkip: false } },
        },
      },
    });
    reportCharts.push(chart);
  }

  // Pie chart
  const pieCtx = document.getElementById('dn-pie-chart');
  if (pieCtx) {
    const chart = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: [labelPersonal, labelBusiness],
        datasets: [{ data: [totPers, totBiz], backgroundColor: [colorPersonal, colorBusiness], borderWidth: 2, borderColor: '#fff' }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 20, font: { size: 12 } } },
          tooltip: { callbacks: { label: ctx => ctx.label + ': ' + formatCurrency(ctx.raw, 'TZS') + ' TZS (' + Math.round(ctx.raw / totAll * 100) + '%)' } },
        },
        cutout: '60%',
      },
    });
    reportCharts.push(chart);
  }
}

function renderDiningYearly(diningTx) {
  const colorPersonal = '#1e40af';
  const colorBusiness = (getBusinessEntities()[0]?.color) || '#f59e0b';
  const labelPersonal = t('reports.dining.cls_personal', {}, 'Personal');
  const labelBusiness = t('reports.dining.cls_business', {}, 'Business');
  const years = getAvailableYears();

  const yearData = years.map(y => {
    let pers = 0, biz = 0, persCount = 0, bizCount = 0;
    for (const tx of diningTx) {
      if (!tx.date || !tx.date.startsWith(y)) continue;
      const amt = convertToTZS(tx.amount, tx.currency);
      if (classifyDining(tx) === 'business') { biz += amt; bizCount++; }
      else { pers += amt; persCount++; }
    }
    return { year: y, pers, biz, total: pers + biz, persCount, bizCount, count: persCount + bizCount };
  });

  const content = document.getElementById('dn-content');
  content.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${t('reports.dining.title_yearly_heading', {}, 'Dining Out — Yearly (all amounts in TZS)')}</div>
      <div class="income-grid">
        ${yearData.map(d => `
          <div class="income-cell">
            <div class="ic-label">${d.year}</div>
            <div class="ic-value ${d.total === 0 ? 'zero' : ''}">${formatCurrency(d.total, 'TZS')}<span class="ic-cur">TZS</span></div>
            <div class="ic-count">${t('reports.dining.yearly_tile_detail',
              { n: d.count, persPct: Math.round(d.total > 0 ? d.pers / d.total * 100 : 0), bizPct: Math.round(d.total > 0 ? d.biz / d.total * 100 : 0), persColor: colorPersonal, bizColor: colorBusiness },
              `${d.count} visits · <span style="color:${colorPersonal}">${Math.round(d.total > 0 ? d.pers / d.total * 100 : 0)}% pers</span> · <span style="color:${colorBusiness}">${Math.round(d.total > 0 ? d.biz / d.total * 100 : 0)}% biz</span>`)}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="report-section">
      <div class="chart-wrap">
        <div class="report-section-title">${t('reports.dining.chart_yearly_split', {}, 'Yearly — Personal vs. Business')}</div>
        <div class="chart-canvas-box"><canvas id="dn-yearly-chart"></canvas></div>
      </div>
    </div>
  `;

  const ctx = document.getElementById('dn-yearly-chart');
  if (ctx) {
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: yearData.map(d => d.year),
        datasets: [
          { label: labelPersonal, data: yearData.map(d => d.pers), backgroundColor: colorPersonal, borderWidth: 0, borderRadius: 4 },
          { label: labelBusiness, data: yearData.map(d => d.biz), backgroundColor: colorBusiness, borderWidth: 0, borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 12 } } }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, 'TZS') + ' TZS' } } },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: 'rgba(0,0,0,0.04)' } },
        },
      },
    });
    reportCharts.push(chart);
  }
}

// ─── Income vs. Expense Report ───────────────────────────────────────────

function renderIncExpReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];

  const savedMode = out.getAttribute('data-ie-mode') || 'monthly';
  const savedYear = out.getAttribute('data-ie-year') || years[years.length - 1] || '2026';
  const savedCur = out.getAttribute('data-ie-cur') || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.mode', {}, 'Mode')}</label>
        <select id="ie-mode">
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.toolbar.monthly', {}, 'Monthly')}</option>
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.toolbar.yearly', {}, 'Yearly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="ie-year">
          ${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="ie-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="ie-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('ie-mode');
  const yearEl = document.getElementById('ie-year');
  const curEl = document.getElementById('ie-currency');

  function update() {
    out.setAttribute('data-ie-mode', modeEl.value);
    out.setAttribute('data-ie-year', yearEl.value);
    out.setAttribute('data-ie-cur', curEl.value);
    yearEl.style.display = modeEl.value === 'yearly' ? 'none' : '';
    destroyReportCharts();
    if (modeEl.value === 'monthly') renderIncExpMonthly(yearEl.value, curEl.value);
    else renderIncExpYearly(curEl.value);
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

function renderIncExpMonthly(year, currency) {
  const custodyAliases = getCustodyAliases();
  const nonPnl = getNonPnlCategories();
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    let income = 0, expense = 0, incCount = 0, expCount = 0;
    for (const tx of state.tx) {
      if (!tx.date || !tx.date.startsWith(ym)) continue;
      if (!isOperationalTx(tx, custodyAliases, nonPnl)) continue;
      const amt = convertTo(tx.amount, tx.currency, currency);
      if (tx.type === 'income') { income += amt; incCount++; }
      else if (tx.type === 'expense') { expense += amt; expCount++; }
    }
    months.push({ ym, label: monthLabel(ym), income, expense, net: income - expense, count: incCount + expCount });
  }

  const totInc = months.reduce((s, m) => s + m.income, 0);
  const totExp = months.reduce((s, m) => s + m.expense, 0);
  const totNet = totInc - totExp;
  const activeMonths = months.filter(m => m.income > 0 || m.expense > 0).length;
  const avgInc = activeMonths > 0 ? totInc / activeMonths : 0;
  const avgExp = activeMonths > 0 ? totExp / activeMonths : 0;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    .map((en, i) => t(`common.months.short.${i + 1}`, {}, en));

  const savingsPct = totInc > 0 ? Math.round(totNet / totInc * 100) : 0;
  const netVerdict = totNet >= 0
    ? t('reports.incexp.net.surplus', {}, 'Surplus')
    : t('reports.incexp.net.deficit', {}, 'Deficit');

  const content = document.getElementById('ie-content');
  content.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${t('reports.incexp.monthly.title', { year, currency }, `Income vs. Expenses ${year} — ${currency}`)}</div>
      <div class="income-grid">
        <div class="income-cell">
          <div class="ic-label">${t('reports.incexp.tile.total_income', {}, 'Total Income')}</div>
          <div class="ic-value c-pos">${formatCurrency(totInc, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.incexp.tile.avg_per_month', { amount: formatCurrency(avgInc, currency) }, `Avg ${formatCurrency(avgInc, currency)} / month`)}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.incexp.tile.total_expenses', {}, 'Total Expenses')}</div>
          <div class="ic-value c-neg">${formatCurrency(totExp, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.incexp.tile.avg_per_month', { amount: formatCurrency(avgExp, currency) }, `Avg ${formatCurrency(avgExp, currency)} / month`)}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.incexp.tile.net_balance', {}, 'Net Balance')}</div>
          <div class="ic-value" style="color:${totNet >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(totNet, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.incexp.net.detail', { verdict: netVerdict, pct: savingsPct }, `${netVerdict} · Savings rate ${savingsPct}%`)}</div>
        </div>
      </div>
      <div class="income-grid mt-8">
        ${months.map(m => `
          <div class="income-cell">
            <div class="ic-label">${m.label}</div>
            <div class="ic-value ${m.net === 0 ? 'zero' : ''}" style="color:${m.net > 0 ? 'var(--positive)' : m.net < 0 ? 'var(--negative)' : 'var(--muted)'}">${formatCurrency(m.net, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.incexp.cell_detail', { income: formatCurrency(m.income, currency), expense: formatCurrency(m.expense, currency) }, `+${formatCurrency(m.income, currency)} / -${formatCurrency(m.expense, currency)}`)}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="report-section">
      <div class="chart-row">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.incexp.chart.monthly', {}, 'Monthly Comparison')}</div>
          <div class="chart-canvas-box"><canvas id="ie-bar-chart"></canvas></div>
        </div>
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.incexp.chart.net_trend', {}, 'Net Balance Trend')}</div>
          <div class="chart-canvas-box"><canvas id="ie-net-chart"></canvas></div>
        </div>
      </div>
    </div>
  `;

  // Grouped bar: income vs expense
  const barCtx = document.getElementById('ie-bar-chart');
  if (barCtx) {
    const chart = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: names,
        datasets: [
          { label: t('common.label.income', {}, 'Income'), data: months.map(m => m.income), backgroundColor: '#10b981', borderWidth: 0 },
          { label: t('common.label.expenses', {}, 'Expenses'), data: months.map(m => m.expense), backgroundColor: '#e8453c', borderWidth: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, padding: 12, font: { size: 10 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } },
        },
        scales: {
          x: { grid: { color: cssVar('--chart-grid') } },
          y: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
        },
      },
    });
    reportCharts.push(chart);
  }

  // Net balance line
  const netCtx = document.getElementById('ie-net-chart');
  if (netCtx) {
    const chart = new Chart(netCtx, {
      type: 'bar',
      data: {
        labels: names,
        datasets: [{
          label: t('common.label.net', {}, 'Net'),
          data: months.map(m => m.net),
          backgroundColor: months.map(m => m.net >= 0 ? 'rgba(93,212,160,0.7)' : 'rgba(240,112,112,0.7)'),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${t('common.label.net', {}, 'Net')}: ${formatCurrency(ctx.raw, currency)} ${currency}` } },
        },
        scales: {
          x: { grid: { color: cssVar('--chart-grid') } },
          y: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
        },
      },
    });
    reportCharts.push(chart);
  }
}

function renderIncExpYearly(currency) {
  const custodyAliases = getCustodyAliases();
  const nonPnl = getNonPnlCategories();
  const years = getAvailableYears();
  const data = [];
  for (const y of years) {
    let income = 0, expense = 0, count = 0;
    for (const tx of state.tx) {
      if (!tx.date || !tx.date.startsWith(y)) continue;
      if (!isOperationalTx(tx, custodyAliases, nonPnl)) continue;
      const amt = convertTo(tx.amount, tx.currency, currency);
      if (tx.type === 'income') { income += amt; count++; }
      else if (tx.type === 'expense') { expense += amt; count++; }
    }
    data.push({ year: y, income, expense, net: income - expense, count });
  }

  const totInc = data.reduce((s, d) => s + d.income, 0);
  const totExp = data.reduce((s, d) => s + d.expense, 0);
  const totNet = totInc - totExp;
  const savingsPct = totInc > 0 ? Math.round(totNet / totInc * 100) : 0;
  const netVerdict = totNet >= 0
    ? t('reports.incexp.net.surplus', {}, 'Surplus')
    : t('reports.incexp.net.deficit', {}, 'Deficit');

  const content = document.getElementById('ie-content');
  content.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${t('reports.incexp.yearly.title', { currency }, `Income vs. Expenses by Year — ${currency}`)}</div>
      <div class="income-grid">
        <div class="income-cell">
          <div class="ic-label">${t('reports.incexp.tile.all_income', {}, 'All-time Income')}</div>
          <div class="ic-value c-pos">${formatCurrency(totInc, currency)}<span class="ic-cur">${currency}</span></div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.incexp.tile.all_expenses', {}, 'All-time Expenses')}</div>
          <div class="ic-value c-neg">${formatCurrency(totExp, currency)}<span class="ic-cur">${currency}</span></div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.incexp.tile.all_net', {}, 'All-time Net')}</div>
          <div class="ic-value" style="color:${totNet >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(totNet, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.incexp.net.detail', { verdict: netVerdict, pct: savingsPct }, `${netVerdict} · Savings rate ${savingsPct}%`)}</div>
        </div>
      </div>
      <div class="income-grid mt-8">
        ${data.map(d => `
          <div class="income-cell">
            <div class="ic-label">${d.year}</div>
            <div class="ic-value" style="color:${d.net >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(d.net, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.incexp.cell_detail', { income: formatCurrency(d.income, currency), expense: formatCurrency(d.expense, currency) }, `+${formatCurrency(d.income, currency)} / -${formatCurrency(d.expense, currency)}`)}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="report-section">
      <div class="chart-wrap">
        <div class="report-section-title">${t('reports.incexp.chart.yearly', {}, 'Yearly Comparison')}</div>
        <div class="chart-canvas-box"><canvas id="ie-year-chart"></canvas></div>
      </div>
    </div>
  `;

  const ctx = document.getElementById('ie-year-chart');
  if (ctx) {
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.year),
        datasets: [
          { label: t('common.label.income', {}, 'Income'), data: data.map(d => d.income), backgroundColor: '#10b981', borderWidth: 0 },
          { label: t('common.label.expenses', {}, 'Expenses'), data: data.map(d => d.expense), backgroundColor: '#e8453c', borderWidth: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, padding: 12, font: { size: 10 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } },
        },
        scales: {
          x: { grid: { color: cssVar('--chart-grid') } },
          y: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
        },
      },
    });
    reportCharts.push(chart);
  }
}



// ─── Vice Spending Report ───────────────────────────────────────────────

function renderViceSpendingReport() {
  renderExpenseReport({
    filterId: 'vices',
    filterLabel: t('reports.filter_label.vices', {}, 'Vice Spending'),
    filterFn: (tx) => tx.type === 'expense' && matchesReportCategory(tx, 'vice_spending'),
    colorMain: '#dc2626',
    showTransactions: true,
    showCategoryBreakdown: true,
    stackCategories: true,
  });
}

// ─── Bank Fees Report ───────────────────────────────────────────────────

function renderBankFeesReport() {
  renderExpenseReport({
    filterId: 'bankfees',
    filterLabel: t('reports.filter_label.bankfees', {}, 'Bank Fees'),
    filterFn: (tx) => tx.type === 'expense' && matchesReportCategory(tx, 'bank_fees'),
    colorMain: '#6b7280',
    showTransactions: true,
    showCategoryBreakdown: true,
    stackCategories: true,
  });
}


// ─── R6: Staff Costs Report ─────────────────────────────────────────────

function renderStaffCostsReport() {
  renderExpenseReport({
    filterId: 'staffcosts',
    filterLabel: t('reports.filter_label.staffcosts', {}, 'Staff Costs'),
    filterFn: (t) => t.type === 'expense' && t.category && t.category.startsWith('Staff:'),
    colorMain: '#0ea5e9',
    showTransactions: true,
    showCategoryBreakdown: true,
    stackCategories: true,
  });
}

