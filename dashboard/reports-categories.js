// ─── Category Breakdown Report ────────────────────────────────────────────

function renderCategoryBreakdownReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];

  const savedYear = out.getAttribute('data-cb-year') || years[years.length - 1] || '2026';
  const savedCur = out.getAttribute('data-cb-cur') || 'TZS';
  const savedMode = out.getAttribute('data-cb-mode') || 'yearly';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.mode', {}, 'Mode')}</label>
        <select id="cb-mode">
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.cb.mode_full_year', {}, 'Full Year')}</option>
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.toolbar.monthly', {}, 'Monthly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="cb-year">${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <label>${t('common.col.currency', {}, 'Currency')}</label>
        <select id="cb-currency">${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </div>
      <div id="cb-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('cb-mode');
  const yearEl = document.getElementById('cb-year');
  const curEl = document.getElementById('cb-currency');

  function update() {
    out.setAttribute('data-cb-mode', modeEl.value);
    out.setAttribute('data-cb-year', yearEl.value);
    out.setAttribute('data-cb-cur', curEl.value);
    destroyReportCharts();

    const year = yearEl.value;
    const currency = curEl.value;
    const custodyAliases = getCustodyAliases();
    const nonPnl = getNonPnlCategories();
    const uncatLabel = t('reports.shared.uncategorized', {}, '(uncategorized)');
    const expenses = state.tx.filter(tx => tx.type === 'expense' && tx.date && tx.date.startsWith(year) && isOperationalTx(tx, custodyAliases, nonPnl)).map(tx => ({ ...tx, amount: convertTo(tx.amount, tx.currency, currency) }));

    // Group by top-level category
    const byTop = {};
    const bySub = {};
    for (const tx of expenses) {
      const cat = tx.category || uncatLabel;
      const top = cat.split(':')[0];
      byTop[top] = (byTop[top] || 0) + tx.amount;
      bySub[cat] = (bySub[cat] || 0) + tx.amount;
    }

    const topSorted = Object.entries(byTop).sort((a, b) => b[1] - a[1]);
    const subSorted = Object.entries(bySub).sort((a, b) => b[1] - a[1]);
    const grandTotal = topSorted.reduce((s, [, v]) => s + v, 0);

    const palette = ['#1e40af', '#e8453c', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#e11d48'];

    // Build per-month totals and per-month subcategory maps (used in both modes)
    const englishMonthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const names = englishMonthShort.map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
    const monthTotals = new Array(12).fill(0);
    const monthCounts = new Array(12).fill(0);
    const monthBySub = Array.from({ length: 12 }, () => ({}));
    for (const tx of expenses) {
      const m = parseInt(tx.date.slice(5, 7), 10) - 1;
      if (m < 0 || m > 11) continue;
      monthTotals[m] += tx.amount;
      monthCounts[m] += 1;
      const cat = tx.category || uncatLabel;
      monthBySub[m][cat] = (monthBySub[m][cat] || 0) + tx.amount;
    }
    const activeMonths = monthTotals.filter(v => v > 0).length;
    const avgPerMonth = activeMonths > 0 ? grandTotal / activeMonths : 0;
    const topCategoryName = topSorted.length > 0 ? topSorted[0][0] : '—';
    const topCategoryAmount = topSorted.length > 0 ? topSorted[0][1] : 0;

    const activeMonthsLabel = activeMonths === 1
      ? t('reports.shared.active_months_one', {}, '1 active month')
      : t('reports.shared.active_months_many', { n: activeMonths }, `${activeMonths} active months`);

    if (modeEl.value === 'yearly') {
      const content = document.getElementById('cb-content');
      content.innerHTML = `
        <div class="report-section">
          <div class="report-section-title">${escapeHtml(t('reports.cb.title_yearly', { year, currency }, `Expense Breakdown ${year} — ${currency}`))}</div>
          <div class="income-grid">
            <div class="income-cell">
              <div class="ic-label">${t('reports.shared.year_total', {}, 'Year Total')}</div>
              <div class="ic-value" style="color:var(--negative)">${formatCurrency(grandTotal, currency)}<span class="ic-cur">${currency}</span></div>
              <div class="ic-count">${t('reports.shared.tx_count', { n: expenses.length }, `${expenses.length} TX`)}</div>
            </div>
            <div class="income-cell">
              <div class="ic-label">${t('reports.shared.avg_per_month', {}, 'Avg / Month')}</div>
              <div class="ic-value">${formatCurrency(avgPerMonth, currency)}<span class="ic-cur">${currency}</span></div>
              <div class="ic-count">${escapeHtml(activeMonthsLabel)}</div>
            </div>
            <div class="income-cell">
              <div class="ic-label">${t('reports.cb.top_category', {}, 'Top Category')}</div>
              <div class="ic-value" style="font-size:16px">${escapeHtml(topCategoryName)}</div>
              <div class="ic-count">${t('reports.cb.top_category_pct', { amount: formatCurrency(topCategoryAmount, currency), currency, pct: grandTotal > 0 ? (topCategoryAmount / grandTotal * 100).toFixed(1) : 0 }, `${formatCurrency(topCategoryAmount, currency)} ${currency} (${grandTotal > 0 ? (topCategoryAmount / grandTotal * 100).toFixed(1) : 0}%)`)}</div>
            </div>
            <div class="income-cell">
              <div class="ic-label">${t('reports.cb.categories_label', {}, 'Categories')}</div>
              <div class="ic-value">${topSorted.length}<span class="ic-cur">${t('reports.cb.categories_unit', {}, 'top')}</span></div>
              <div class="ic-count">${t('reports.cb.subcategories_count', { n: subSorted.length }, `${subSorted.length} subcategories`)}</div>
            </div>
          </div>
          <div class="income-grid mt-8">
            ${names.map((n, i) => `
              <div class="income-cell">
                <div class="ic-label">${n}</div>
                <div class="ic-value ${monthTotals[i] === 0 ? 'zero' : ''}">${formatCurrency(monthTotals[i], currency)}<span class="ic-cur">${currency}</span></div>
                <div class="ic-count">${t('reports.shared.tx_count', { n: monthCounts[i] }, `${monthCounts[i]} TX`)}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="report-section">
          <div class="chart-row">
            <div class="chart-wrap">
              <div class="report-section-title">${t('reports.cb.chart_by_top_category', {}, 'By Top Category')}</div>
              <div class="chart-canvas-box" style="height:260px;max-width:360px;margin:0 auto;"><canvas id="cb-pie"></canvas></div>
            </div>
            <div class="chart-wrap">
              <div class="report-section-title">${t('reports.cb.chart_all_categories', {}, 'All Categories')}</div>
              <div class="chart-canvas-box" style="height:${Math.max(300, subSorted.length * 24 + 60)}px;"><canvas id="cb-bar"></canvas></div>
            </div>
          </div>
        </div>
        <div class="report-section">
          <div class="report-section-title">${t('reports.cb.detail_heading', {}, 'Category Detail')}</div>
          <table class="tx-table"><thead><tr><th>${t('common.col.category', {}, 'Category')}</th><th class="amt">${t('common.col.amount', {}, 'Amount')}</th><th class="amt">${t('reports.cb.col_pct_total', {}, '% of Total')}</th><th>${t('reports.cb.col_tx', {}, 'TX')}</th></tr></thead><tbody>
            ${subSorted.map(([cat, amount]) => {
              const count = expenses.filter(tx => tx.category === cat).length;
              return `<tr><td>${escapeHtml(cat)}</td><td class="amt">${formatCurrency(amount, currency)} ${currency}</td><td class="amt">${(amount / grandTotal * 100).toFixed(1)}%</td><td>${count}</td></tr>`;
            }).join('')}
          </tbody></table>
        </div>
      `;

      // Doughnut
      const pieCtx = document.getElementById('cb-pie');
      if (pieCtx) {
        const chart = new Chart(pieCtx, {
          type: 'doughnut',
          data: {
            labels: topSorted.map(([c]) => c),
            datasets: [{ data: topSorted.map(([, v]) => v), backgroundColor: palette.slice(0, topSorted.length), borderWidth: 2, borderColor: '#fff' }],
          },
          options: { responsive: true, maintainAspectRatio: false, cutout: '55%',
            plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
              tooltip: { callbacks: { label: ctx => ctx.label + ': ' + formatCurrency(ctx.raw, currency) + ' ' + currency + ' (' + (ctx.raw / grandTotal * 100).toFixed(1) + '%)' } } } },
        });
        reportCharts.push(chart);
      }

      // Horizontal bar
      const barCtx = document.getElementById('cb-bar');
      if (barCtx) {
        const top20 = subSorted.slice(0, 20);
        const chart = new Chart(barCtx, {
          type: 'bar',
          data: {
            labels: top20.map(([c]) => c.length > 24 ? c.slice(0, 23) + '…' : c),
            datasets: [{ data: top20.map(([, v]) => v), backgroundColor: '#1e40af', borderWidth: 0, borderRadius: 3 }],
          },
          options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, currency) + ' ' + currency } } },
            scales: { x: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } }, y: { grid: { display: false }, ticks: { font: { size: 11 }, autoSkip: false } } } },
        });
        reportCharts.push(chart);
      }
    } else {
      // Monthly mode — stacked chart by top-category + per-month filterable subcategory table
      const topCats = topSorted.slice(0, 8).map(([c]) => c);
      const monthlyData = {};
      for (const cat of topCats) monthlyData[cat] = new Array(12).fill(0);
      for (const tx of expenses) {
        const m = parseInt(tx.date.slice(5, 7), 10) - 1;
        const top = (tx.category || '').split(':')[0];
        if (monthlyData[top]) monthlyData[top][m] += tx.amount;
      }

      const savedMonth = out.getAttribute('data-cb-month') || 'all';

      const content = document.getElementById('cb-content');
      content.innerHTML = `
        <div class="report-section">
          <div class="report-section-title">${escapeHtml(t('reports.cb.title_monthly', { year, currency }, `Monthly Category Breakdown ${year} — ${currency}`))}</div>
          <div class="income-grid">
            <div class="income-cell">
              <div class="ic-label">${t('reports.shared.year_total', {}, 'Year Total')}</div>
              <div class="ic-value" style="color:var(--negative)">${formatCurrency(grandTotal, currency)}<span class="ic-cur">${currency}</span></div>
              <div class="ic-count">${t('reports.shared.tx_count', { n: expenses.length }, `${expenses.length} TX`)}</div>
            </div>
            <div class="income-cell">
              <div class="ic-label">${t('reports.shared.avg_per_month', {}, 'Avg / Month')}</div>
              <div class="ic-value">${formatCurrency(avgPerMonth, currency)}<span class="ic-cur">${currency}</span></div>
              <div class="ic-count">${escapeHtml(activeMonthsLabel)}</div>
            </div>
            <div class="income-cell">
              <div class="ic-label">${t('reports.cb.top_category', {}, 'Top Category')}</div>
              <div class="ic-value" style="font-size:16px">${escapeHtml(topCategoryName)}</div>
              <div class="ic-count">${formatCurrency(topCategoryAmount, currency)} ${currency}</div>
            </div>
            <div class="income-cell">
              <div class="ic-label">${t('reports.cb.subcategories_label', {}, 'Subcategories')}</div>
              <div class="ic-value">${subSorted.length}<span class="ic-cur">${t('reports.cb.subcategories_unit', {}, 'used')}</span></div>
              <div class="ic-count">${t('reports.cb.top_category_count', { n: topSorted.length }, `${topSorted.length} top categories`)}</div>
            </div>
          </div>
          <div class="income-grid mt-8">
            ${names.map((n, i) => `
              <div class="income-cell cb-month-cell" data-month="${i + 1}" style="cursor:pointer;${savedMonth === String(i + 1) ? 'outline:2px solid var(--accent);outline-offset:-2px;' : ''}">
                <div class="ic-label">${n}</div>
                <div class="ic-value ${monthTotals[i] === 0 ? 'zero' : ''}">${formatCurrency(monthTotals[i], currency)}<span class="ic-cur">${currency}</span></div>
                <div class="ic-count">${t('reports.shared.tx_count', { n: monthCounts[i] }, `${monthCounts[i]} TX`)}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="report-section">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.cb.chart_top_by_month', {}, 'Top Categories by Month')}</div>
            <div class="chart-canvas-box" style="height:340px;"><canvas id="cb-stacked"></canvas></div>
          </div>
        </div>
        <div class="report-section">
          <div class="report-toolbar">
            <label>${t('reports.cb.detail_for_label', {}, 'Detail for')}</label>
            <select id="cb-month-filter">
              <option value="all" ${savedMonth === 'all' ? 'selected' : ''}>${t('reports.cb.mode_full_year', {}, 'Full Year')}</option>
              ${names.map((n, i) => `<option value="${i + 1}" ${savedMonth === String(i + 1) ? 'selected' : ''}>${n} ${year}</option>`).join('')}
            </select>
          </div>
          <div id="cb-month-detail"></div>
        </div>
      `;

      const ctx = document.getElementById('cb-stacked');
      if (ctx) {
        const chart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: names,
            datasets: topCats.map((cat, i) => ({ label: cat, data: monthlyData[cat], backgroundColor: palette[i], borderWidth: 0, borderRadius: 2 })),
          },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } } },
              tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, currency) + ' ' + currency } } },
            scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } } } },
        });
        reportCharts.push(chart);
      }

      function renderMonthDetail() {
        const sel = out.getAttribute('data-cb-month') || 'all';
        const detailBox = document.getElementById('cb-month-detail');
        let entries, total, count, title;
        if (sel === 'all') {
          entries = subSorted;
          total = grandTotal;
          count = expenses.length;
          title = t('reports.cb.all_subcats_title', { year }, `All Subcategories ${year}`);
        } else {
          const mi = parseInt(sel, 10) - 1;
          entries = Object.entries(monthBySub[mi]).sort((a, b) => b[1] - a[1]);
          total = monthTotals[mi];
          count = monthCounts[mi];
          title = t('reports.cb.month_subcats_title', { month: names[mi], year }, `${names[mi]} ${year} Subcategories`);
        }
        if (entries.length === 0) {
          detailBox.innerHTML = `<div class="report-section-title">${escapeHtml(title)}</div><div style="color:var(--muted);padding:12px 0">${t('reports.cb.no_expenses', {}, 'No expenses in this period.')}</div>`;
          return;
        }
        detailBox.innerHTML = `
          <div class="report-section-title">${escapeHtml(t('reports.cb.detail_header_fmt', { title, total: formatCurrency(total, currency), currency, count }, `${title} — ${formatCurrency(total, currency)} ${currency} (${count} TX)`))}</div>
          <table class="tx-table"><thead><tr><th>${t('common.col.category', {}, 'Category')}</th><th class="amt">${t('common.col.amount', {}, 'Amount')}</th><th class="amt">${t('reports.cb.col_pct_period', {}, '% of Period')}</th><th>${t('reports.cb.col_tx', {}, 'TX')}</th></tr></thead><tbody>
            ${entries.map(([cat, amount]) => {
              const c = (sel === 'all')
                ? expenses.filter(tx => tx.category === cat).length
                : expenses.filter(tx => tx.category === cat && parseInt(tx.date.slice(5, 7), 10) === parseInt(sel, 10)).length;
              return `<tr><td>${escapeHtml(cat)}</td><td class="amt">${formatCurrency(amount, currency)} ${currency}</td><td class="amt">${total > 0 ? (amount / total * 100).toFixed(1) : 0}%</td><td>${c}</td></tr>`;
            }).join('')}
          </tbody></table>
        `;
      }

      renderMonthDetail();

      const monthFilter = document.getElementById('cb-month-filter');
      monthFilter.addEventListener('change', () => {
        out.setAttribute('data-cb-month', monthFilter.value);
        update();
      });
      content.querySelectorAll('.cb-month-cell').forEach(cell => {
        cell.addEventListener('click', () => {
          const cur = out.getAttribute('data-cb-month') || 'all';
          const clicked = cell.getAttribute('data-month');
          out.setAttribute('data-cb-month', cur === clicked ? 'all' : clicked);
          update();
        });
      });
    }
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

// ─── Account Balances Over Time Report ────────────────────────────────────

function renderBalancesReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const savedYear = out.getAttribute('data-bal-year') || years[years.length - 1] || '2026';

  // Get active self accounts with transactions
  const selfAccounts = state.accounts.filter(a => a.owner === 'self' && a.status === 'active');

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="bal-year">${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
      </div>
      <div id="bal-content"></div>
    </div>
  `;

  const yearEl = document.getElementById('bal-year');

  function update() {
    out.setAttribute('data-bal-year', yearEl.value);
    destroyReportCharts();
    const year = yearEl.value;

    // For each account, compute running balance per month-end
    // Respects initial_balance_date: balance is null before that date
    const accountData = {};
    for (const acc of selfAccounts) {
      const ibDate = acc.initial_balance_date || '2000-01-01';
      const balances = [];
      for (let m = 1; m <= 12; m++) {
        const endOfMonth = `${year}-${String(m).padStart(2, '0')}-31`;
        // Account didn't exist yet in this month
        if (endOfMonth < ibDate) { balances.push(null); continue; }
        let bal = acc.initial_balance || 0;
        for (const tx of state.tx) {
          if (!tx.date || tx.date > endOfMonth) continue;
          if (tx.date < ibDate) continue; // TX before initial_balance_date already baked in
          if (tx.account === acc.alias) {
            if (tx.type === 'income') bal += tx.amount;
            else if (tx.type === 'expense') bal -= tx.amount;
            else if (tx.type === 'transfer') bal -= tx.amount;
          }
          if (tx.type === 'transfer' && tx.transfer_to_account === acc.alias) {
            bal += tx.transfer_to_amount > 0 ? tx.transfer_to_amount : tx.amount;
          }
        }
        balances.push(bal);
      }
      if (balances.some(b => b !== null && b !== 0)) {
        accountData[acc.alias] = { name: acc.name, currency: acc.currency, balances };
      }
    }

    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      .map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
    const palette = ['#1e40af', '#10b981', '#e8453c', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];

    // Group by currency
    const byCurrency = {};
    for (const [alias, data] of Object.entries(accountData)) {
      const cur = data.currency;
      if (!byCurrency[cur]) byCurrency[cur] = [];
      byCurrency[cur].push({ alias, ...data });
    }

    const content = document.getElementById('bal-content');
    let html = '';
    let chartIdx = 0;
    for (const [currency, accounts] of Object.entries(byCurrency).sort()) {
      const chartId = `bal-chart-${chartIdx++}`;
      html += `
        <div class="report-section">
          <div class="report-section-title">${t('reports.balances.section_title', { year, currency }, `Account Balances ${year} — ${currency}`)}</div>
          <div class="chart-wrap">
            <div class="chart-canvas-box" style="height:320px;"><canvas id="${chartId}"></canvas></div>
          </div>
        </div>
      `;
    }
    content.innerHTML = html;

    // Render charts
    chartIdx = 0;
    for (const [currency, accounts] of Object.entries(byCurrency).sort()) {
      const chartId = `bal-chart-${chartIdx++}`;
      const ctx = document.getElementById(chartId);
      if (!ctx) continue;
      const chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: names,
          datasets: accounts.map((acc, i) => ({
            label: `${acc.alias} (${acc.name})`,
            data: acc.balances,
            borderColor: palette[i % palette.length],
            backgroundColor: palette[i % palette.length] + '15',
            fill: false,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2,
          })),
        },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, currency) + ' ' + currency } } },
          scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } } },
          interaction: { mode: 'index', intersect: false },
        },
      });
      reportCharts.push(chart);
    }
  }

  yearEl.addEventListener('change', update);
  update();
}

// ─── Top Payees Report ────────────────────────────────────────────────────

function renderTopPayeesReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];

  const savedYear = out.getAttribute('data-tp-year') || years[years.length - 1] || '2026';
  const savedCur = out.getAttribute('data-tp-cur') || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="tp-year">${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="tp-currency">${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </div>
      <div id="tp-content"></div>
    </div>
  `;

  const yearEl = document.getElementById('tp-year');
  const curEl = document.getElementById('tp-currency');

  function update() {
    out.setAttribute('data-tp-year', yearEl.value);
    out.setAttribute('data-tp-cur', curEl.value);
    destroyReportCharts();

    const year = yearEl.value;
    const currency = curEl.value;
    const custodyAliases = getCustodyAliases();
    const expenses = state.tx.filter(tx => tx.type === 'expense' && tx.date && tx.date.startsWith(year) && tx.payee && !custodyAliases.has(tx.account)).map(tx => ({ ...tx, amount: convertTo(tx.amount, tx.currency, currency) }));

    const byPayee = {};
    for (const tx of expenses) {
      if (!byPayee[tx.payee]) byPayee[tx.payee] = { total: 0, count: 0, categories: {} };
      byPayee[tx.payee].total += tx.amount;
      byPayee[tx.payee].count++;
      const cat = (tx.category || '').split(':')[0];
      byPayee[tx.payee].categories[cat] = (byPayee[tx.payee].categories[cat] || 0) + tx.amount;
    }

    const sorted = Object.entries(byPayee).map(([name, d]) => ({
      name, ...d,
      topCat: Object.entries(d.categories).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
    })).sort((a, b) => b.total - a.total);

    const top20 = sorted.slice(0, 20);
    const grandTotal = expenses.reduce((s, tx) => s + tx.amount, 0);

    const content = document.getElementById('tp-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.tp.title', { year, currency }, `Top Payees ${year} — ${currency}`)}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.incexp.tile.total_expenses', {}, 'Total Expenses')}</div>
            <div class="ic-value c-neg">${formatCurrency(grandTotal, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.tp.tile.total_detail', { n: expenses.length, payees: sorted.length }, `${expenses.length} TX to ${sorted.length} payees`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.tp.tile.top1', {}, '#1 Payee')}</div>
            <div class="ic-value c-text">${escapeHtml(top20[0]?.name || '—')}</div>
            <div class="ic-count">${top20[0] ? formatCurrency(top20[0].total, currency) + ' ' + currency + ' (' + (top20[0].total / grandTotal * 100).toFixed(1) + '%)' : ''}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.tp.chart.top_n', { n: 20 }, 'Top 20 Payees by Spending')}</div>
          <div class="chart-canvas-box" style="height:${Math.max(300, top20.length * 30 + 60)}px;"><canvas id="tp-bar"></canvas></div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.tp.section.ranking', {}, 'Full Ranking')}</div>
        <table class="tx-table"><thead><tr>
          <th>#</th>
          <th>${t('common.col.payee', {}, 'Payee')}</th>
          <th>${t('reports.tp.col.main_cat', {}, 'Main Category')}</th>
          <th>${t('reports.wd.col.tx', {}, 'TX')}</th>
          <th class="amt">${t('reports.shared.total_label', {}, 'Total')}</th>
          <th class="amt">${t('reports.tp.col.pct_total', {}, '% of Total')}</th>
        </tr></thead><tbody>
          ${sorted.map((p, i) => `<tr>
            <td>${i + 1}</td>
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td class="cat">${escapeHtml(p.topCat)}</td>
            <td>${p.count}</td>
            <td class="amt">${formatCurrency(p.total, currency)} ${currency}</td>
            <td class="amt">${(p.total / grandTotal * 100).toFixed(1)}%</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
    `;

    const barCtx = document.getElementById('tp-bar');
    if (barCtx && top20.length > 0) {
      const chart = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: top20.map(p => p.name.length > 20 ? p.name.slice(0, 19) + '…' : p.name),
          datasets: [{ data: top20.map(p => p.total), backgroundColor: '#1e40af', borderWidth: 0, borderRadius: 3 }],
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, currency) + ' ' + currency } } },
          scales: { x: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } }, y: { grid: { display: false }, ticks: { font: { size: 11 }, autoSkip: false } } } },
      });
      reportCharts.push(chart);
    }
  }

  yearEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

