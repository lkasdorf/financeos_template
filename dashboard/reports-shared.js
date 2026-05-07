// ─── Shared Report Filters ──────────────────────────────────────────────
// Non-operational categories are marked pnl=false in categories.csv.
// Build the exclusion set dynamically from state.categories.

// ─── Income Report ───────────────────────────────────────────────────────

function getIncomeTransactions(currency) {
  const custodyAliases = getCustodyAliases();
  const nonPnl = getNonPnlCategories();
  return state.tx.filter(t => t.type === 'income' && isOperationalTx(t, custodyAliases, nonPnl)).map(t => ({
    ...t, originalAmount: t.amount, amount: convertTo(t.amount, t.currency, currency)
  }));
}

function getAvailableYears() {
  const years = new Set();
  for (const t of state.tx) {
    if (t.date) years.add(t.date.slice(0, 4));
  }
  return [...years].sort();
}


// ─── Generic Expense Report (reusable for tag-based and category-based) ──

function renderExpenseReport(opts) {
  // opts: { filterId, filterLabel, filterFn, colorMain }
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];

  const savedMode = out.getAttribute(`data-${opts.filterId}-mode`) || 'monthly';
  const savedYear = out.getAttribute(`data-${opts.filterId}-year`) || years[years.length - 1] || '2026';
  const savedCur = out.getAttribute(`data-${opts.filterId}-cur`) || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.mode', {}, 'Mode')}</label>
        <select id="re-mode">
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.toolbar.monthly', {}, 'Monthly')}</option>
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.toolbar.yearly', {}, 'Yearly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="re-year">
          ${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
        <label>${t('common.col.currency', {}, 'Currency')}</label>
        <select id="re-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="re-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('re-mode');
  const yearEl = document.getElementById('re-year');
  const curEl = document.getElementById('re-currency');

  function update() {
    out.setAttribute(`data-${opts.filterId}-mode`, modeEl.value);
    out.setAttribute(`data-${opts.filterId}-year`, yearEl.value);
    out.setAttribute(`data-${opts.filterId}-cur`, curEl.value);
    yearEl.style.display = modeEl.value === 'yearly' ? 'none' : '';
    destroyReportCharts();

    const currency = curEl.value;
    const custodyAliases = getCustodyAliases();
    const nonPnl = getNonPnlCategories();
    const filtered = state.tx.filter(tx => opts.filterFn(tx) && isOperationalTx(tx, custodyAliases, nonPnl)).map(tx => ({
      ...tx, amount: convertTo(tx.amount, tx.currency, currency)
    }));

    // rc.16 — when this report has no matches AT ALL across the entire TX
    // dataset (not just the current year/currency view), the user almost
    // certainly has different category names than the report defaults.
    // Render an actionable empty state with a deep link to Settings →
    // Reports instead of an empty chart that looks like a dead app.
    if (filtered.length === 0) {
      const allTimeMatches = state.tx.filter(tx => opts.filterFn(tx) && isOperationalTx(tx, custodyAliases, nonPnl));
      if (allTimeMatches.length === 0) {
        renderReportEmptyState(opts);
        return;
      }
    }

    if (modeEl.value === 'monthly') {
      renderExpenseMonthly(filtered, yearEl.value, currency, opts);
    } else {
      renderExpenseYearly(filtered, currency, opts);
    }
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

// Renders an actionable empty state when a category-driven report has zero
// matches in the entire TX dataset. Lists the categories the report is
// currently configured to look for (from window.REPORTS_CONFIG) plus a
// scrollable list of category names the user actually has in their data,
// with a CTA button that navigates to Settings → Reports for one-click fix.
//
// `opts.filterId` is the report ID (e.g. 'bills', 'ai', 'dining', 'vice',
// 'cd', 'automobile', 'fixedvar') — used both for the REPORTS_CONFIG
// lookup and the deep-link target.
function renderReportEmptyState(opts) {
  // opts.containerId defaults to 're-content' (the renderExpenseReport target)
  // but bucket-style and bespoke reports (Bills, Automobile, Discretionary,
  // Cash Discrepancy) pass their own container ID so the empty-state can
  // land inside their existing layout.
  const container = document.getElementById(opts.containerId || 're-content');
  if (!container) return;

  const reportId = opts.filterId || '';
  const cfg = (window.REPORTS_CONFIG && window.REPORTS_CONFIG[reportId]) || {};

  // Flatten the configured-categories list across the various shapes
  // (flat: cfg.categories, buckets: cfg.buckets[*].categories, two-set:
  // cfg.expense_categories + cfg.income_categories).
  const configuredCats = [];
  if (Array.isArray(cfg.categories)) configuredCats.push(...cfg.categories);
  if (cfg.buckets && typeof cfg.buckets === 'object') {
    for (const b of Object.values(cfg.buckets)) {
      if (b && Array.isArray(b.categories)) configuredCats.push(...b.categories);
    }
  }
  if (Array.isArray(cfg.expense_categories)) configuredCats.push(...cfg.expense_categories);
  if (Array.isArray(cfg.income_categories)) configuredCats.push(...cfg.income_categories);
  if (Array.isArray(cfg.fixed_prefixes)) configuredCats.push(...cfg.fixed_prefixes);

  // Distinct categories the user actually has on expense rows — gives them
  // a quick reference for which of their names to map.
  const userCats = new Set();
  for (const tx of state.tx) {
    if (tx.type === 'expense' && tx.category) userCats.add(tx.category);
  }
  const userCatList = [...userCats].sort();

  const configuredHtml = configuredCats.length > 0
    ? configuredCats.map(c => `<code style="background:var(--surface-soft, rgba(0,0,0,0.04));padding:2px 6px;border-radius:3px;font-size:12px;">${escapeHtml(c)}</code>`).join(' ')
    : `<span class="hint-sm">${escapeHtml(t('reports.empty.no_config', {}, '(none configured)'))}</span>`;

  const userHtml = userCatList.length > 0
    ? userCatList.slice(0, 30).map(c => `<code style="background:var(--surface-soft, rgba(0,0,0,0.04));padding:2px 6px;border-radius:3px;font-size:12px;">${escapeHtml(c)}</code>`).join(' ')
      + (userCatList.length > 30 ? ` <span class="hint-sm">+${userCatList.length - 30} ${t('reports.empty.more', {}, 'more')}</span>` : '')
    : `<span class="hint-sm">${escapeHtml(t('reports.empty.no_user_cats', {}, '(no expense categories in your data yet)'))}</span>`;

  container.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;box-shadow:var(--shadow);max-width:780px;">
      <h3 style="margin-top:0;">${escapeHtml(t('reports.empty.title', {}, 'No matching transactions'))}</h3>
      <p style="margin:0 0 16px;line-height:1.55;">
        ${escapeHtml(t('reports.empty.intro', { label: opts.filterLabel || reportId }, `This report (“${opts.filterLabel || reportId}”) filters expenses by category, but none of your transactions match the categories it is currently configured to look for. The category names in your data are different from the defaults.`))}
      </p>
      <div style="margin-bottom:16px;">
        <div style="font-weight:600;margin-bottom:6px;font-size:13px;">${escapeHtml(t('reports.empty.configured', {}, 'Currently configured for'))}:</div>
        <div style="line-height:2;">${configuredHtml}</div>
      </div>
      <div style="margin-bottom:20px;">
        <div style="font-weight:600;margin-bottom:6px;font-size:13px;">${escapeHtml(t('reports.empty.your_cats', {}, 'Your expense categories'))}:</div>
        <div style="line-height:2;">${userHtml}</div>
      </div>
      <a href="#settings/reports" class="btn-primary" style="display:inline-block;text-decoration:none;padding:10px 20px;border-radius:var(--radius-xs);font-weight:600;">
        ${escapeHtml(t('reports.empty.cta', {}, 'Fix in Settings → Reports'))}
      </a>
      <p class="hint-sm" style="margin:14px 0 0;">
        ${escapeHtml(t('reports.empty.cta_hint', {}, 'Or build a Custom Report from scratch with the exact filter you want.'))}
      </p>
    </div>
  `;
}

function renderExpenseMonthly(filtered, year, currency, opts) {
  const unknownLabel = t('reports.shared.unknown', {}, '(unknown)');
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    let total = 0, count = 0;
    const byPayee = {};
    for (const tx of filtered) {
      if (tx.date && tx.date.startsWith(ym)) {
        total += tx.amount;
        count++;
        const p = tx.payee || tx.category || unknownLabel;
        byPayee[p] = (byPayee[p] || 0) + tx.amount;
      }
    }
    months.push({ ym, label: monthLabel(ym), total, count, byPayee });
  }

  const grandTotal = months.reduce((s, m) => s + m.total, 0);
  const grandCount = months.reduce((s, m) => s + m.count, 0);
  const activeMonths = months.filter(m => m.total > 0).length;
  const avgPerMonth = activeMonths > 0 ? grandTotal / activeMonths : 0;
  const englishMonthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const names = englishMonthShort.map((en, i) => t(`common.months.short.${i + 1}`, {}, en));

  // Top payees across year
  const allPayees = {};
  for (const m of months) {
    for (const [p, v] of Object.entries(m.byPayee)) {
      allPayees[p] = (allPayees[p] || 0) + v;
    }
  }
  const topPayees = Object.entries(allPayees).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // All-time total (since inception) for reports with showCategoryBreakdown
  let allTimeTileHtml = '';
  if (opts.showCategoryBreakdown) {
    const sinceDate = opts.sinceDate || null;
    const allTimeFiltered = filtered.filter(t => t.date && (!sinceDate || t.date >= sinceDate));
    const allTimeTotal = allTimeFiltered.reduce((s, t) => s + t.amount, 0);
    const allTimeCount = allTimeFiltered.length;
    const firstDate = sinceDate || (allTimeFiltered.length > 0 ? allTimeFiltered.reduce((min, tx) => tx.date < min ? tx.date : min, allTimeFiltered[0].date) : '');
    const tileLabel = firstDate
      ? t('reports.shared.total_since', { date: fmtDate(firstDate) }, `Total since ${fmtDate(firstDate)}`)
      : t('reports.shared.total_label', {}, 'Total');
    allTimeTileHtml = `
        <div class="income-cell">
          <div class="ic-label">${escapeHtml(tileLabel)}</div>
          <div class="ic-value" style="color:${allTimeTotal > 0 ? opts.colorMain : 'var(--muted)'}">${formatCurrency(allTimeTotal, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.shared.tx_count', { n: allTimeCount }, `${allTimeCount} TX`)}</div>
        </div>`;
  }

  const activeMonthsLabel = activeMonths === 1
    ? t('reports.shared.active_months_one', {}, '1 active month')
    : t('reports.shared.active_months_many', { n: activeMonths }, `${activeMonths} active months`);
  const sectionTitle = t('reports.shared.section_title_year',
    { label: opts.filterLabel, year, currency },
    `${opts.filterLabel} ${year} — ${currency}`);

  const content = document.getElementById('re-content');
  content.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${escapeHtml(sectionTitle)}</div>
      <div class="income-grid">
        <div class="income-cell">
          <div class="ic-label">${t('reports.shared.year_total', {}, 'Year Total')}</div>
          <div class="ic-value" style="color:${grandTotal > 0 ? opts.colorMain : 'var(--muted)'}">${formatCurrency(grandTotal, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.shared.tx_count', { n: grandCount }, `${grandCount} TX`)}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.shared.avg_per_month', {}, 'Avg / Month')}</div>
          <div class="ic-value" style="color:${avgPerMonth > 0 ? opts.colorMain : 'var(--muted)'}">${formatCurrency(avgPerMonth, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${escapeHtml(activeMonthsLabel)}</div>
        </div>
        ${allTimeTileHtml}
      </div>
      <div class="income-grid mt-8">
        ${months.map(m => `
          <div class="income-cell">
            <div class="ic-label">${m.label}</div>
            <div class="ic-value ${m.total === 0 ? 'zero' : ''}" style="color:${m.total > 0 ? opts.colorMain : 'var(--muted)'}">${formatCurrency(m.total, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.shared.tx_count', { n: m.count }, `${m.count} TX`)}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="report-section">
      <div class="chart-row">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.shared.monthly_spending', {}, 'Monthly Spending')}</div>
          <div class="chart-canvas-box"><canvas id="re-bar-chart"></canvas></div>
        </div>
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.shared.top_payees_cats', {}, 'Top Payees / Categories')}</div>
          <div class="chart-canvas-box"><canvas id="re-payee-chart"></canvas></div>
        </div>
      </div>
    </div>
  `;

  const barCtx = document.getElementById('re-bar-chart');
  if (barCtx) {
    const stackPalette = ['#1e40af', '#e8453c', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];
    let barDatasets;
    let barLegend = { display: false };
    let barStacked = false;

    if (opts.stackCategories) {
      // Collect all categories and build per-category monthly data
      const otherLabel = t('reports.shared.other', {}, '(other)');
      const allCats = {};
      for (const tx of filtered) {
        if (tx.date && tx.date.startsWith(year)) {
          const cat = tx.category || otherLabel;
          allCats[cat] = (allCats[cat] || 0) + tx.amount;
        }
      }
      const sortedCats = Object.entries(allCats).sort((a, b) => b[1] - a[1]).map(([c]) => c);
      barDatasets = sortedCats.map((cat, i) => ({
        label: cat.split(':').pop(),
        data: months.map(m => {
          let sum = 0;
          for (const tx of filtered) {
            if (tx.date && tx.date.startsWith(m.ym) && tx.category === cat) sum += tx.amount;
          }
          return sum || 0;
        }),
        backgroundColor: stackPalette[i % stackPalette.length],
        borderWidth: 0,
      }));
      barLegend = { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } };
      barStacked = true;
    } else {
      barDatasets = [{ data: months.map(m => m.total), backgroundColor: opts.colorMain, borderWidth: 0 }];
    }

    const chart = new Chart(barCtx, {
      type: 'bar',
      data: { labels: names, datasets: barDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: barLegend, tooltip: { callbacks: { label: ctx => (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + formatCurrency(ctx.raw, currency) + ' ' + currency } } },
        scales: {
          x: { stacked: barStacked, grid: { color: cssVar('--chart-grid') } },
          y: { stacked: barStacked, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
        },
      },
    });
    reportCharts.push(chart);
  }

  const payeeCtx = document.getElementById('re-payee-chart');
  if (payeeCtx) {
    const chart = new Chart(payeeCtx, {
      type: 'bar',
      data: {
        labels: topPayees.map(([p]) => p.length > 28 ? p.slice(0, 27) + '...' : p),
        datasets: [{ data: topPayees.map(([, v]) => v), backgroundColor: opts.colorMain, borderWidth: 0 }],
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

  // Category breakdown list (for landlord / summary view)
  if (opts.showCategoryBreakdown) {
    const uncategorizedLabel = t('reports.shared.uncategorized', {}, '(uncategorized)');
    const txForYear = filtered.filter(tx => tx.date && tx.date.startsWith(year));
    const byCategory = {};
    for (const tx of txForYear) {
      const cat = tx.category || uncategorizedLabel;
      if (!byCategory[cat]) byCategory[cat] = { total: 0, items: [] };
      byCategory[cat].total += tx.amount;
      byCategory[cat].items.push(tx);
    }
    const sortedCats = Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total);
    const catTotal = sortedCats.reduce((s, [, v]) => s + v.total, 0);

    let catRows = '';
    for (const [cat, data] of sortedCats) {
      const pct = catTotal > 0 ? (data.total / catTotal * 100).toFixed(1) : '0.0';
      catRows += `<tr style="background:var(--surface-2);font-weight:600;">
        <td colspan="4">${escapeHtml(cat)}</td>
        <td class="amt expense">${formatCurrency(data.total, currency)}</td>
        <td style="color:var(--muted);font-size:11px;">${pct}%</td>
      </tr>`;
      const sorted = data.items.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      for (const tx of sorted) {
        catRows += `<tr>
          <td>${fmtDate(tx.date)}</td>
          <td>${escapeHtml(tx.payee || '')}</td>
          <td>${escapeHtml(tx.note || '')}</td>
          <td>${tx.account}</td>
          <td class="amt expense">${formatCurrency(tx.amount, currency)}</td>
          <td></td>
        </tr>`;
      }
    }

    const breakdownHtml = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.shared.category_breakdown_title', { year, currency }, `Category Breakdown ${year} — ${currency}`)}</div>
        <table class="tx-table">
          <thead><tr><th>${t('common.label.date', {}, 'Date')}</th><th>${t('common.col.payee', {}, 'Payee')}</th><th>${t('common.label.note', {}, 'Note')}</th><th>${t('common.col.account', {}, 'Account')}</th><th class="amt">${t('common.col.amount', {}, 'Amount')}</th><th></th></tr></thead>
          <tbody>
            ${catRows}
            <tr style="font-weight:700;border-top:2px solid var(--border);">
              <td colspan="4">${t('reports.shared.total_label', {}, 'Total')}</td>
              <td class="amt expense">${formatCurrency(catTotal, currency)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    document.getElementById('re-content').insertAdjacentHTML('beforeend', breakdownHtml);
  }

  // Optional transaction list
  if (opts.showTransactions) {
    const txForPeriod = filtered.filter(tx => tx.date && tx.date.startsWith(year)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const txRows = txForPeriod.map(tx => {
      const tags = (tx.tags || '').split(';').filter(Boolean).map(x => `<span class="tag-chip">${escapeHtml(x)}</span>`).join('');
      return `<tr>
        <td>${fmtDate(tx.date)}</td>
        <td>${tx.account}</td>
        <td>${escapeHtml(tx.payee || '')}</td>
        <td class="cat">${escapeHtml(tx.category || '')}${tags ? '<br>' + tags : ''}</td>
        <td>${escapeHtml(tx.note || '')}</td>
        <td class="amt expense">${formatCurrency(tx.amount, tx.currency)}</td>
        <td class="hint-sm">${tx.currency}</td>
      </tr>`;
    }).join('');
    const txHtml = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.shared.all_transactions', { n: txForPeriod.length }, `All Transactions (${txForPeriod.length})`)}</div>
        <table class="tx-table">
          <thead><tr><th>${t('common.label.date', {}, 'Date')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('common.col.payee', {}, 'Payee')}</th><th>${t('tx.table.col_category_tags', {}, 'Category / Tags')}</th><th>${t('common.label.note', {}, 'Note')}</th><th class="amt">${t('common.col.amount', {}, 'Amount')}</th><th></th></tr></thead>
          <tbody>${txRows}</tbody>
        </table>
      </div>
    `;
    document.getElementById('re-content').insertAdjacentHTML('beforeend', txHtml);
  }
}

function renderExpenseYearly(filtered, currency, opts) {
  const years = getAvailableYears();
  const data = [];
  for (const y of years) {
    let total = 0, count = 0;
    for (const tx of filtered) {
      if (tx.date && tx.date.startsWith(y)) { total += tx.amount; count++; }
    }
    data.push({ year: y, total, count });
  }

  const grandTotal = data.reduce((s, d) => s + d.total, 0);
  const yearlyTitle = t('reports.shared.section_title_yearly',
    { label: opts.filterLabel, currency, total: formatCurrency(grandTotal, currency) },
    `${opts.filterLabel} by Year — ${currency} (Total: ${formatCurrency(grandTotal, currency)} ${currency})`);

  const content = document.getElementById('re-content');
  content.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${escapeHtml(yearlyTitle)}</div>
      <div class="income-grid">
        ${data.map(d => `
          <div class="income-cell">
            <div class="ic-label">${d.year}</div>
            <div class="ic-value ${d.total === 0 ? 'zero' : ''}" style="color:${d.total > 0 ? opts.colorMain : 'var(--muted)'}">${formatCurrency(d.total, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.shared.tx_count', { n: d.count }, `${d.count} TX`)}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="report-section">
      <div class="chart-wrap">
        <div class="report-section-title">${t('reports.shared.yearly_spending', {}, 'Yearly Spending')}</div>
        <div class="chart-canvas-box"><canvas id="re-year-chart"></canvas></div>
      </div>
    </div>
  `;

  const ctx = document.getElementById('re-year-chart');
  if (ctx) {
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.year),
        datasets: [{ data: data.map(d => d.total), backgroundColor: opts.colorMain, borderWidth: 0 }],
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

  // Optional transaction list (yearly shows all)
  if (opts.showTransactions) {
    const allTx = filtered.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const txRows = allTx.map(tx => {
      const tags = (tx.tags || '').split(';').filter(Boolean).map(x => `<span class="tag-chip">${escapeHtml(x)}</span>`).join('');
      return `<tr>
        <td>${fmtDate(tx.date)}</td>
        <td>${tx.account}</td>
        <td>${escapeHtml(tx.payee || '')}</td>
        <td class="cat">${escapeHtml(tx.category || '')}${tags ? '<br>' + tags : ''}</td>
        <td>${escapeHtml(tx.note || '')}</td>
        <td class="amt expense">${formatCurrency(tx.amount, tx.currency)}</td>
        <td class="hint-sm">${tx.currency}</td>
      </tr>`;
    }).join('');
    const txHtml = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.shared.all_transactions', { n: allTx.length }, `All Transactions (${allTx.length})`)}</div>
        <table class="tx-table">
          <thead><tr><th>${t('common.label.date', {}, 'Date')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('common.col.payee', {}, 'Payee')}</th><th>${t('tx.table.col_category_tags', {}, 'Category / Tags')}</th><th>${t('common.label.note', {}, 'Note')}</th><th class="amt">${t('common.col.amount', {}, 'Amount')}</th><th></th></tr></thead>
          <tbody>${txRows}</tbody>
        </table>
      </div>
    `;
    document.getElementById('re-content').insertAdjacentHTML('beforeend', txHtml);
  }
}

