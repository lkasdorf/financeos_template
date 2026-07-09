// ─── Discretionary vs. Fixed Report ─────────────────────────────────────

function renderFixedVarReport() {
  // Fixed-cost prefixes pulled from config/reports.json. Defaults match the
  // canonical category set: Rent, Bills:*, Subscriptions:*, Insurance:*, Fees:*.
  const FIXED_PREFIXES = (window.REPORTS_CONFIG?.discretionary_fixed?.fixed_prefixes) || [];
  const isFixed = (cat) => {
    if (!cat) return false;
    return FIXED_PREFIXES.some(p => cat === p || cat.startsWith(p));
  };

  // Banner shown when the report has expenses but none of them matched any
  // configured Fixed prefix — without this hint the user sees 100% Discretionary
  // and may not realise their prefix list doesn't match their category names.
  const noFixedWarning = (totFixed, totAll) => {
    if (totFixed > 0 || totAll <= 0) return '';
    const title = t('reports.fv.empty.title', {}, 'No expenses match your Fixed-cost prefixes');
    const body  = t('reports.fv.empty.body',  {}, 'All expenses are being classified as Discretionary because no category matched any of your Fixed prefixes. Adjust the prefix list in');
    const cta   = t('reports.fv.empty.cta',   {}, 'Settings → Reports');
    return `
      <div class="fv-empty-warning" style="background:var(--surface-soft, #fef3c7);border:1px solid var(--warn);border-radius:var(--radius-xs, 6px);padding:12px 14px;margin-bottom:14px;display:flex;gap:12px;align-items:flex-start;">
        <div style="font-size:20px;flex-shrink:0;line-height:1;">&#x26A0;&#xFE0F;</div>
        <div style="flex:1;min-width:0;">
          <div class="fw-600 mb-4">${escapeHtml(title)}</div>
          <div style="font-size:12px;line-height:1.45;">
            ${escapeHtml(body)}
            <a href="#settings" data-action="presetSettingsTab" data-arg1="reports" style="text-decoration:underline;font-weight:600;">${escapeHtml(cta)}</a>.
          </div>
        </div>
      </div>`;
  };

  const out = document.getElementById('report-output');
  const years = getAvailableYears();

  // DR-M4: toolbar rendering/persistence/wiring live in reportToolbar().
  const tb = reportToolbar(out, 'fv', [
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
      <div id="fv-content"></div>
    </div>
  `;

  function update() {
    tb.el('year').style.display = tb.get('mode') === 'yearly' ? 'none' : '';
    destroyReportCharts();
    const currency = tb.get('cur');
    const custodyAliases = getCustodyAliases();
    const expenses = state.tx.filter(tx => tx.type === 'expense' && !custodyAliases.has(tx.account)).map(tx => ({
      ...tx, amount: convertTo(tx.amount, tx.currency, currency),
      bucket: isFixed(tx.category) ? 'Fixed' : 'Discretionary',
    }));

    if (tb.get('mode') === 'monthly') renderFVMonthly(expenses, tb.get('year'), currency);
    else renderFVYearly(expenses, currency);
  }

  function renderFVMonthly(expenses, year, currency) {
    const englishMonthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const names = englishMonthShort.map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
    const labelFixed = t('reports.fv.cat_fixed', {}, 'Fixed');
    const labelDisc = t('reports.fv.cat_discretionary', {}, 'Discretionary');
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      let fixed = 0, disc = 0;
      for (const tx of expenses) {
        if (!tx.date || !tx.date.startsWith(ym)) continue;
        if (tx.bucket === 'Fixed') fixed += tx.amount; else disc += tx.amount;
      }
      months.push({ ym, label: monthLabel(ym), fixed, disc, total: fixed + disc, fixedPct: (fixed + disc) > 0 ? (fixed / (fixed + disc) * 100) : 0 });
    }

    const totFixed = months.reduce((s, m) => s + m.fixed, 0);
    const totDisc = months.reduce((s, m) => s + m.disc, 0);
    const totAll = totFixed + totDisc;
    const fixedPctYear = totAll > 0 ? (totFixed / totAll * 100).toFixed(1) : '0.0';

    // Top fixed categories
    const otherLabel = t('reports.shared.other', {}, '(other)');
    const fixedCats = {};
    for (const tx of expenses) {
      if (!tx.date || !tx.date.startsWith(year) || tx.bucket !== 'Fixed') continue;
      const cat = tx.category || otherLabel;
      fixedCats[cat] = (fixedCats[cat] || 0) + tx.amount;
    }
    const topFixed = Object.entries(fixedCats).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const content = document.getElementById('fv-content');
    content.innerHTML = `
      ${noFixedWarning(totFixed, totAll)}
      <div class="report-section">
        <div class="report-section-title">${escapeHtml(t('reports.fv.title_monthly', { year, currency }, `Fixed vs. Discretionary ${year} — ${currency}`))}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.fv.tile_fixed_costs', {}, 'Fixed Costs')}</div>
            <div class="ic-value c-neg">${formatCurrency(totFixed, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${escapeHtml(t('reports.fv.pct_of_spending', { pct: fixedPctYear }, `${fixedPctYear}% of spending`))}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.fv.cat_discretionary', {}, 'Discretionary')}</div>
            <div class="ic-value c-info">${formatCurrency(totDisc, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${escapeHtml(t('reports.fv.pct_of_spending', { pct: (100 - parseFloat(fixedPctYear)).toFixed(1) }, `${(100 - parseFloat(fixedPctYear)).toFixed(1)}% of spending`))}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.fv.tile_total_expenses', {}, 'Total Expenses')}</div>
            <div class="ic-value">${formatCurrency(totAll, currency)}<span class="ic-cur">${currency}</span></div>
          </div>
        </div>
        <div class="income-grid">
          ${months.map(m => `
            <div class="income-cell">
              <div class="ic-label">${m.label}</div>
              <div class="ic-value ${m.total === 0 ? 'zero' : ''}">${formatCurrency(m.total, currency)}<span class="ic-cur">${currency}</span></div>
              <div class="ic-count fs-10">${escapeHtml(t('reports.fv.monthly_tile_detail', { pct: m.fixedPct.toFixed(0), fixed: formatCurrency(m.fixed, currency), disc: formatCurrency(m.disc, currency) }, `Fixed ${m.fixedPct.toFixed(0)}% · ${formatCurrency(m.fixed, currency)} / ${formatCurrency(m.disc, currency)}`))}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.fv.chart_monthly', {}, 'Monthly Fixed vs. Discretionary')}</div>
            <div class="chart-canvas-box"><canvas id="fv-bar-chart"></canvas></div>
          </div>
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.fv.chart_top_fixed', {}, 'Top Fixed Cost Categories')}</div>
            <div class="chart-canvas-box"><canvas id="fv-fixed-chart"></canvas></div>
          </div>
        </div>
      </div>
    `;

    const barCtx = document.getElementById('fv-bar-chart');
    if (barCtx) {
      const chart = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: names,
          datasets: [
            { label: labelFixed, data: months.map(m => m.fixed), backgroundColor: chartPalette()[6], borderWidth: 0 },
            { label: labelDisc, data: months.map(m => m.disc), backgroundColor: chartPalette()[0], borderWidth: 0 },
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

    const fixedCtx = document.getElementById('fv-fixed-chart');
    if (fixedCtx) {
      const chart = new Chart(fixedCtx, {
        type: 'bar',
        data: {
          labels: topFixed.map(([c]) => c.length > 28 ? c.slice(0, 27) + '...' : c),
          datasets: [{ data: topFixed.map(([, v]) => v), backgroundColor: chartPalette()[6], borderWidth: 0 }],
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

  function renderFVYearly(expenses, currency) {
    const years = getAvailableYears();
    const labelFixed = t('reports.fv.cat_fixed', {}, 'Fixed');
    const labelDisc = t('reports.fv.cat_discretionary', {}, 'Discretionary');
    const data = [];
    for (const y of years) {
      let fixed = 0, disc = 0;
      for (const tx of expenses) {
        if (!tx.date || !tx.date.startsWith(y)) continue;
        if (tx.bucket === 'Fixed') fixed += tx.amount; else disc += tx.amount;
      }
      data.push({ year: y, fixed, disc, total: fixed + disc, fixedPct: (fixed + disc) > 0 ? (fixed / (fixed + disc) * 100) : 0 });
    }
    const totFixedAll = data.reduce((s, d) => s + d.fixed, 0);
    const totAllYears = data.reduce((s, d) => s + d.total, 0);

    const content = document.getElementById('fv-content');
    content.innerHTML = `
      ${noFixedWarning(totFixedAll, totAllYears)}
      <div class="report-section">
        <div class="report-section-title">${escapeHtml(t('reports.fv.title_yearly', { currency }, `Fixed vs. Discretionary by Year — ${currency}`))}</div>
        <div class="income-grid">
          ${data.map(d => `
            <div class="income-cell">
              <div class="ic-label">${d.year}</div>
              <div class="ic-value">${formatCurrency(d.total, currency)}<span class="ic-cur">${currency}</span></div>
              <div class="ic-count">${escapeHtml(t('reports.fv.yearly_tile_detail', { pct: d.fixedPct.toFixed(0), fixed: formatCurrency(d.fixed, currency), disc: formatCurrency(d.disc, currency) }, `Fixed ${d.fixedPct.toFixed(0)}%: ${formatCurrency(d.fixed, currency)} / Disc: ${formatCurrency(d.disc, currency)}`))}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.fv.chart_yearly', {}, 'Yearly Fixed vs. Discretionary')}</div>
          <div class="chart-canvas-box"><canvas id="fv-year-chart"></canvas></div>
        </div>
      </div>
    `;

    const ctx = document.getElementById('fv-year-chart');
    if (ctx) {
      const chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.map(d => d.year),
          datasets: [
            { label: labelFixed, data: data.map(d => d.fixed), backgroundColor: chartPalette()[6], borderWidth: 0 },
            { label: labelDisc, data: data.map(d => d.disc), backgroundColor: chartPalette()[0], borderWidth: 0 },
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

// ─── Largest Transactions Report ────────────────────────────────────────

function renderLargestTxReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();

  const tb = reportToolbar(out, 'lt', [
    { key: 'year', label: t('reports.toolbar.year', {}, 'Year'), def: 'all',
      options: [
        { v: 'all', l: t('reports.lt.opt_all_time', {}, 'All Time') },
        ...years,
      ] },
    { key: 'type', label: t('common.col.type', {}, 'Type'), def: 'expense',
      options: [
        { v: 'expense', l: t('reports.lt.type_expenses', {}, 'Expenses') },
        { v: 'income', l: t('common.type.income', {}, 'Income') },
        { v: 'all', l: t('reports.lt.type_all', {}, 'All') },
      ] },
    { key: 'count', label: t('reports.lt.label_show', {}, 'Show'), def: '50',
      options: [20, 50, 100].map(n => ({ v: n, l: t('reports.lt.opt_top_n', { n }, `Top ${n}`) })) },
    { key: 'cur', label: t('common.col.currency', {}, 'Currency'),
      options: reportCurrencies(), def: 'TZS' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="lt-content"></div>
    </div>
  `;

  function update() {
    destroyReportCharts();
    const currency = tb.get('cur');
    const limit = parseInt(tb.get('count'));
    const type = tb.get('type');
    const year = tb.get('year');

    const custodyAliases = getCustodyAliases();
    let filtered = state.tx.filter(tx => {
      if (type !== 'all' && tx.type !== type) return false;
      if (tx.type === 'transfer') return false;
      if (year !== 'all' && (!tx.date || !tx.date.startsWith(year))) return false;
      if (custodyAliases.has(tx.account)) return false;
      return true;
    }).map(tx => ({ ...tx, converted: convertTo(tx.amount, tx.currency, currency) }));

    filtered.sort((a, b) => b.converted - a.converted);
    const top = filtered.slice(0, limit);
    const totalTop = top.reduce((s, tx) => s + tx.converted, 0);
    const totalAll = filtered.reduce((s, tx) => s + tx.converted, 0);
    const topPct = totalAll > 0 ? (totalTop / totalAll * 100).toFixed(1) : '0.0';

    const content = document.getElementById('lt-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${escapeHtml(t('reports.lt.title', { n: top.length, currency }, `Top ${top.length} Transactions — ${currency}`))}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${escapeHtml(t('reports.lt.tile_top_total', { n: top.length }, `Top ${top.length} Total`))}</div>
            <div class="ic-value">${formatCurrency(totalTop, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${escapeHtml(t('reports.lt.tile_top_pct_of_all', { pct: topPct, n: filtered.length }, `${topPct}% of all ${filtered.length} TX`))}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.lt.tile_largest_single', {}, 'Largest Single TX')}</div>
            <div class="ic-value c-neg">${top.length > 0 ? formatCurrency(top[0].converted, currency) : '0'}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${top.length > 0 ? escapeHtml(top[0].payee || '') + ' · ' + fmtDate(top[0].date) : ''}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${escapeHtml(t('reports.lt.tile_average_top', { n: top.length }, `Average (Top ${top.length})`))}</div>
            <div class="ic-value">${formatCurrency(top.length > 0 ? totalTop / top.length : 0, currency)}<span class="ic-cur">${currency}</span></div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap" style="max-width:100%">
          <div class="report-section-title">${t('reports.lt.chart_amount_distribution', {}, 'Amount Distribution')}</div>
          <div class="chart-canvas-box"><canvas id="lt-bar-chart"></canvas></div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.lt.tx_list_heading', {}, 'Transaction List')}</div>
        <table class="tx-table">
          <thead><tr><th>#</th><th>${t('common.label.date', {}, 'Date')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('common.col.payee', {}, 'Payee')}</th><th>${t('common.col.category', {}, 'Category')}</th><th>${t('common.label.note', {}, 'Note')}</th><th class="amt">${t('reports.lt.col_original', {}, 'Original')}</th><th class="amt">${currency}</th></tr></thead>
          <tbody>
            ${top.map((tx, i) => `<tr>
              <td>${i + 1}</td>
              <td>${fmtDate(tx.date)}</td>
              <td>${escapeHtml(tx.account)}</td>
              <td>${escapeHtml(tx.payee || '')}</td>
              <td class="cat">${escapeHtml(tx.category || '')}</td>
              <td>${escapeHtml(tx.note || '')}</td>
              <td class="amt">${formatCurrency(tx.amount, tx.currency)} ${tx.currency}</td>
              <td class="amt expense">${formatCurrency(tx.converted, currency)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;

    const barCtx = document.getElementById('lt-bar-chart');
    if (barCtx && top.length > 0) {
      const chart = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: top.slice(0, 20).map((tx, i) => `#${i + 1} ${(tx.payee || '').slice(0, 15)}`),
          datasets: [{ data: top.slice(0, 20).map(tx => tx.converted), backgroundColor: chartPalette()[6], borderWidth: 0 }],
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, currency) + ' ' + currency } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') }, ticks: { maxRotation: 45, font: { size: 10 } } },
            y: { ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}

// ─── Business vs. Personal Report ───────────────────────────────────────

function renderBizPersonalReport() {
  // Tag list comes from config/businesses.json (entities[].tag) so the report
  // expands to whatever business entities the fork has configured. Empty list
  // means everything classifies as Personal.
  const bizTags = getBusinessTags();
  const isBusiness = (t) => t.tags && bizTags.some(bt => t.tags.split(';').includes(bt));

  const out = document.getElementById('report-output');
  const years = getAvailableYears();

  const tb = reportToolbar(out, 'bp', [
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
      <div id="bp-content"></div>
    </div>
  `;

  function update() {
    tb.el('year').style.display = tb.get('mode') === 'yearly' ? 'none' : '';
    destroyReportCharts();
    const currency = tb.get('cur');

    if (tb.get('mode') === 'monthly') renderBPMonthly(currency, tb.get('year'));
    else renderBPYearly(currency);
  }

  const custodyAliases = getCustodyAliases();

  function renderBPMonthly(currency, year) {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      .map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      let bizExp = 0, persExp = 0, bizInc = 0, persInc = 0;
      for (const tx of state.tx) {
        if (!tx.date || !tx.date.startsWith(ym)) continue;
        if (custodyAliases.has(tx.account)) continue;
        const amt = convertTo(tx.amount, tx.currency, currency);
        const biz = isBusiness(tx);
        if (tx.type === 'expense') { if (biz) bizExp += amt; else persExp += amt; }
        else if (tx.type === 'income') { if (biz) bizInc += amt; else persInc += amt; }
      }
      months.push({ ym, label: monthLabel(ym), bizExp, persExp, bizInc, persInc, persNet: persInc - persExp });
    }

    const totBizExp = months.reduce((s, m) => s + m.bizExp, 0);
    const totPersExp = months.reduce((s, m) => s + m.persExp, 0);
    const totBizInc = months.reduce((s, m) => s + m.bizInc, 0);
    const totPersInc = months.reduce((s, m) => s + m.persInc, 0);
    const totPersNet = totPersInc - totPersExp;
    const totAll = totBizExp + totPersExp;
    const bizPct = totAll > 0 ? (totBizExp / totAll * 100).toFixed(1) : '0.0';
    const persPct = (100 - parseFloat(bizPct)).toFixed(1);

    const content = document.getElementById('bp-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.bp.monthly.title', { year, currency }, `Business vs. Personal ${year} — ${currency}`)}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.bp.tile.biz_expenses', {}, 'Business Expenses')}</div>
            <div class="ic-value c-warn">${formatCurrency(totBizExp, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.bp.tile.biz_detail', { pct: bizPct, amount: formatCurrency(totBizInc, currency) }, `${bizPct}% of total · Reimbursed: ${formatCurrency(totBizInc, currency)}`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.bp.tile.pers_expenses', {}, 'Personal Expenses')}</div>
            <div class="ic-value" style="color:#6366f1">${formatCurrency(totPersExp, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.bp.tile.pers_pct_detail', { pct: persPct }, `${persPct}% of total`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.bp.tile.pers_net', {}, 'Personal Net (Inc - Exp)')}</div>
            <div class="ic-value" style="color:${totPersNet >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(totPersNet, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.bp.tile.pers_net_detail', {}, 'Adjusted for business')}</div>
          </div>
        </div>
        <div class="income-grid">
          ${months.map(m => `
            <div class="income-cell">
              <div class="ic-label">${m.label}</div>
              <div class="ic-value ${(m.bizExp + m.persExp) === 0 ? 'zero' : ''}">${formatCurrency(m.bizExp + m.persExp, currency)}<span class="ic-cur">${currency}</span></div>
              <div class="ic-count fs-10">${t('reports.bp.cell_detail', { biz: formatCurrency(m.bizExp, currency), pers: formatCurrency(m.persExp, currency) }, `Biz ${formatCurrency(m.bizExp, currency)} / Pers ${formatCurrency(m.persExp, currency)}`)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.bp.chart.monthly', {}, 'Monthly Business vs. Personal Expenses')}</div>
            <div class="chart-canvas-box"><canvas id="bp-bar-chart"></canvas></div>
          </div>
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.bp.chart.pers_cashflow', {}, 'Personal Net Cashflow (excl. Business)')}</div>
            <div class="chart-canvas-box"><canvas id="bp-net-chart"></canvas></div>
          </div>
        </div>
      </div>
    `;

    const barCtx = document.getElementById('bp-bar-chart');
    if (barCtx) {
      const chart = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: names,
          datasets: [
            { label: t('reports.bp.dataset.biz', {}, 'Business'), data: months.map(m => m.bizExp), backgroundColor: chartPalette()[1], borderWidth: 0 },
            { label: t('reports.bp.dataset.pers', {}, 'Personal'), data: months.map(m => m.persExp), backgroundColor: chartPalette()[7], borderWidth: 0 },
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

    const netCtx = document.getElementById('bp-net-chart');
    if (netCtx) {
      const chart = new Chart(netCtx, {
        type: 'bar',
        data: {
          labels: names,
          datasets: [{
            label: t('reports.bp.dataset.pers_net', {}, 'Personal Net'),
            data: months.map(m => m.persNet),
            backgroundColor: months.map(m => m.persNet >= 0 ? 'rgba(93,212,160,0.7)' : 'rgba(240,112,112,0.7)'),
            borderWidth: 0,
          }],
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, currency) + ' ' + currency } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  function renderBPYearly(currency) {
    const years = getAvailableYears();
    const data = [];
    for (const y of years) {
      let bizExp = 0, persExp = 0, bizInc = 0, persInc = 0;
      for (const tx of state.tx) {
        if (!tx.date || !tx.date.startsWith(y)) continue;
        if (custodyAliases.has(tx.account)) continue;
        const amt = convertTo(tx.amount, tx.currency, currency);
        const biz = isBusiness(tx);
        if (tx.type === 'expense') { if (biz) bizExp += amt; else persExp += amt; }
        else if (tx.type === 'income') { if (biz) bizInc += amt; else persInc += amt; }
      }
      data.push({ year: y, bizExp, persExp, persNet: persInc - persExp });
    }

    const content = document.getElementById('bp-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.bp.yearly.title', { currency }, `Business vs. Personal by Year — ${currency}`)}</div>
        <div class="income-grid">
          ${data.map(d => `
            <div class="income-cell">
              <div class="ic-label">${d.year}</div>
              <div class="ic-value">${formatCurrency(d.bizExp + d.persExp, currency)}<span class="ic-cur">${currency}</span></div>
              <div class="ic-count">${t('reports.bp.yearly_cell_detail', { biz: formatCurrency(d.bizExp, currency), pers: formatCurrency(d.persExp, currency), net: formatCurrency(d.persNet, currency) }, `Biz ${formatCurrency(d.bizExp, currency)} / Pers ${formatCurrency(d.persExp, currency)} / Net ${formatCurrency(d.persNet, currency)}`)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.bp.chart.yearly', {}, 'Yearly Business vs. Personal')}</div>
          <div class="chart-canvas-box"><canvas id="bp-year-chart"></canvas></div>
        </div>
      </div>
    `;

    const ctx = document.getElementById('bp-year-chart');
    if (ctx) {
      const chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.map(d => d.year),
          datasets: [
            { label: t('reports.bp.dataset.biz', {}, 'Business'), data: data.map(d => d.bizExp), backgroundColor: chartPalette()[1], borderWidth: 0 },
            { label: t('reports.bp.dataset.pers', {}, 'Personal'), data: data.map(d => d.persExp), backgroundColor: chartPalette()[7], borderWidth: 0 },
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

// ─── R1: Expense Trend Sparklines ───────────────────────────────────────

function renderExpenseTrendReport() {
  const out = document.getElementById('report-output');

  const tb = reportToolbar(out, 'et', [
    { key: 'cur', label: t('common.col.currency', {}, 'Currency'),
      options: reportCurrencies(), def: 'TZS' },
    { key: 'n', label: t('reports.et.label_months', {}, 'Months'),
      options: [6, 12, 18, 24], def: '12' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="et-content"></div>
    </div>
  `;

  function update() {
    const currency = tb.get('cur');
    const numMonths = parseInt(tb.get('n'), 10);
    destroyReportCharts();

    // Build month keys for the last N months
    const now = new Date();
    const monthKeys = [];
    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // Aggregate expenses by category per month
    const custodyAliases = getCustodyAliases();
    const expenses = state.tx.filter(tx => tx.type === 'expense' && !custodyAliases.has(tx.account));
    const catMonthly = {};
    const catTotals = {};
    for (const tx of expenses) {
      if (!tx.date || !tx.category) continue;
      const ym = tx.date.slice(0, 7);
      if (!monthKeys.includes(ym)) continue;
      const cat = tx.category;
      const amt = convertTo(tx.amount, tx.currency, currency);
      if (!catMonthly[cat]) catMonthly[cat] = {};
      catMonthly[cat][ym] = (catMonthly[cat][ym] || 0) + amt;
      catTotals[cat] = (catTotals[cat] || 0) + amt;
    }

    // Top N categories by total
    const topN = 15;
    const topCats = Object.entries(catTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([cat]) => cat);

    const content = document.getElementById('et-content');
    if (topCats.length === 0) {
      content.innerHTML = `<div class="empty-state"><p>${t('reports.et.no_data', {}, 'No expense data for this period.')}</p></div>`;
      return;
    }

    // Build table rows
    const rows = topCats.map((cat, idx) => {
      const data = catMonthly[cat] || {};
      const values = monthKeys.map(m => data[m] || 0);
      const total = values.reduce((s, v) => s + v, 0);
      const avg = total / numMonths;
      const lastMonth = values[values.length - 1] || 0;
      const prevMonth = values[values.length - 2] || 0;
      const change = prevMonth > 0 ? ((lastMonth - prevMonth) / prevMonth * 100) : (lastMonth > 0 ? 100 : 0);
      const changeColor = change > 10 ? 'var(--negative)' : change < -10 ? 'var(--positive)' : 'var(--muted)';
      const changeStr = change === 0 ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(0)}%`;
      const spark = sparklineSvg(values, 120, 24);

      return `<tr>
        <td class="fw-500">${idx + 1}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(cat)}</td>
        <td>${spark}</td>
        <td class="amt">${formatCurrency(total, currency)}</td>
        <td class="amt">${formatCurrency(avg, currency)}</td>
        <td class="amt">${formatCurrency(lastMonth, currency)}</td>
        <td class="amt" style="color:${changeColor};font-weight:500;">${changeStr}</td>
      </tr>`;
    });

    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${escapeHtml(t('reports.et.top_categories_title', { n: topCats.length, months: numMonths, currency }, `Top ${topCats.length} Expense Categories — Last ${numMonths} Months (${currency})`))}</div>
        <div class="table-scroll-wrapper"><table class="tx-table">
          <thead><tr>
            <th>#</th><th>${t('common.col.category', {}, 'Category')}</th><th>${t('reports.et.col_trend', {}, 'Trend')}</th>
            <th class="t-right">${t('reports.shared.total_label', {}, 'Total')}</th>
            <th class="t-right">${t('reports.et.col_avg_mo', {}, 'Avg/Mo')}</th>
            <th class="t-right">${t('reports.et.col_last_mo', {}, 'Last Mo')}</th>
            <th class="t-right">${t('reports.et.col_mom', {}, 'MoM')}</th>
          </tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table></div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.et.chart_title', {}, 'Top 8 Categories Over Time')}</div>
            <div class="chart-canvas-box"><canvas id="et-trend-chart"></canvas></div>
          </div>
        </div>
      </div>
    `;

    // Line chart for top 8
    const chartCats = topCats.slice(0, 8);
    const colors = chartPalette();
    const datasets = chartCats.map((cat, i) => ({
      label: cat.length > 25 ? cat.slice(0, 24) + '…' : cat,
      data: monthKeys.map(m => (catMonthly[cat] || {})[m] || 0),
      borderColor: colors[i % colors.length],
      backgroundColor: 'transparent',
      tension: 0.3,
      pointRadius: 2,
      borderWidth: 2,
    }));

    const ctx = document.getElementById('et-trend-chart');
    if (ctx) {
      const chart = new Chart(ctx, {
        type: 'line',
        data: { labels: monthKeys.map(m => monthLabel(m)), datasets },
        options: {
          ...CHART_BASE,
          plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 10 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, currency)} ${currency}` } },
          },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}

// ─── R2: Income Sources Breakdown ───────────────────────────────────────

function renderIncomeSourcesReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();

  const tb = reportToolbar(out, 'is', [
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
      <div id="is-content"></div>
    </div>
  `;

  function update() {
    tb.el('year').style.display = tb.get('mode') === 'yearly' ? 'none' : '';
    destroyReportCharts();

    const currency = tb.get('cur');
    // DR-M5: keep the native amount/currency alongside the converted one —
    // the EUR column must convert NATIVE values at the month's historical
    // rate instead of back-computing from the current-rate total.
    const incomeTx = state.tx.filter(tx => tx.type === 'income').map(tx => ({
      ...tx,
      nativeAmount: tx.amount,
      nativeCurrency: tx.currency,
      amount: convertTo(tx.amount, tx.currency, currency)
    }));

    // Classify income sources — exclude custody and non-operational
    const custodyAliases = getCustodyAliases();
    const nonPnl = getNonPnlCategories();
    const filteredIncome = incomeTx.filter(tx => isOperationalTx(tx, custodyAliases, nonPnl));

    // Sources are identified by stable keys; display labels are resolved
    // lazily via t() so the chart legend + table headers follow the locale.
    //
    // Keys come in two flavours:
    //   - per-business: `<entityId>_salary`, `<entityId>_dividends`,
    //     `<entityId>_reimb`, `<entityId>_income` — generated dynamically
    //     from config/businesses.json so additional businesses register
    //     automatically.
    //   - generic: interest, investments_sales, reimbursement, refunds, other —
    //     not tied to any business entity.
    //
    // Per-entity sub-source colors are derived from the entity's main color
    // so all of one business's income reads as one cluster in the chart.
    const businessEntities = getBusinessEntities();

    // Generic income-source buckets from config/reports.json. Defaults match
    // the canonical category set; users with renamed/added categories map
    // them in Settings → Reports. The `salary` bucket is empty by default —
    // configure it to lift your salary out of the "Other" column.
    const incBuckets = (window.REPORTS_CONFIG?.income_sources?.buckets) || {};

    function classifySource(tx) {
      const cat = tx.category || '';
      // Per-business rules win over generic buckets when configured.
      for (const e of businessEntities) {
        const ic = e.income_categories || {};
        if (ic.salary && cat === ic.salary) return `${e.id}_salary`;
        if (ic.dividends && cat === ic.dividends) return `${e.id}_dividends`;
        if (ic.reimbursement && cat === ic.reimbursement) return `${e.id}_reimb`;
        // income_prefix lets an entity claim every Income:<prefix>:* category
        // without enumerating each one individually in the config.
        if (e.income_prefix && cat.startsWith(e.income_prefix + ':')) return `${e.id}_income`;
        if (e.income_prefix && cat === e.income_prefix) return `${e.id}_income`;
      }
      // Generic-bucket lookup (config-driven). Iterate buckets in a fixed
      // priority order so a category mapped to multiple buckets resolves
      // deterministically.
      for (const bid of ['salary', 'interest', 'dividends', 'investments_sales', 'reimbursement', 'refunds']) {
        const cats = (incBuckets[bid] && incBuckets[bid].categories) || [];
        if (cats.includes(cat)) return bid;
      }
      return 'other';
    }

    // Static sub-types (per business) sorted by relative volume in the upstream data;
    // forks that don't ship businesses in the config simply skip the per-entity
    // section entirely.
    const subTypes = ['salary', 'dividends', 'reimb', 'income'];
    const businessKeys = [];
    const businessColors = {};
    const businessFallbacks = {};
    for (const e of businessEntities) {
      for (const sub of subTypes) {
        const key = `${e.id}_${sub}`;
        businessKeys.push(key);
        businessColors[key] = e.color || cssVar('--muted');
        businessFallbacks[key] = `${e.label} ${sub === 'reimb' ? 'Reimb.' : sub === 'income' ? 'Income' : sub.charAt(0).toUpperCase() + sub.slice(1)}`;
      }
    }

    const staticColors = {
      salary: chartPalette()[10],
      reimbursement: chartPalette()[5],
      refunds: chartPalette()[9],
      interest: chartPalette()[8],
      dividends: chartPalette()[3],
      investments_sales: chartPalette()[0],
      other: cssVar('--muted'),
    };
    const staticFallback = {
      salary: 'Salary',
      reimbursement: 'Reimbursement',
      refunds: 'Refunds',
      interest: 'Interest',
      dividends: 'Dividends',
      investments_sales: 'Investments & Sales',
      other: 'Other Income',
    };
    const sourceColors = { ...businessColors, ...staticColors };
    // The Salary column only shows up when at least one user category is mapped
    // to it (otherwise it would be a blank column for default empty-start
    // installs that haven't gone through the wizard's income-classification step).
    const salaryHasCategories = ((incBuckets.salary && incBuckets.salary.categories) || []).length > 0;
    const genericOrder = (salaryHasCategories ? ['salary'] : [])
      .concat(['reimbursement', 'refunds', 'interest', 'dividends', 'investments_sales', 'other']);
    const sourceOrder = [...businessKeys, ...genericOrder];
    const sourceFallback = { ...businessFallbacks, ...staticFallback };
    const sourceLabel = (k) => t(`reports.incsrc.source.${k}`, {}, sourceFallback[k] || k);

    if (tb.get('mode') === 'monthly') {
      const year = tb.get('year');
      const months = [];
      for (let m = 1; m <= 12; m++) {
        const ym = `${year}-${String(m).padStart(2, '0')}`;
        const monthTx = filteredIncome.filter(tx => tx.date && tx.date.startsWith(ym));
        const bySource = {};
        for (const s of sourceOrder) bySource[s] = 0;
        for (const tx of monthTx) bySource[classifySource(tx)] += tx.amount;
        // DR-M5: historical EUR value from native amounts. The previous
        // code divided the CURRENT-rate total by the HISTORICAL month
        // rate — mixing two rates, so 100 EUR of native income did not
        // show as 100 EUR. getHistoricalRate returns TZS-per-unit and
        // handles TZS (=1) and missing history (current rate) itself.
        const tzsPerEur = getHistoricalRate('EUR', ym);
        const eurHist = monthTx.reduce((sum, tx) =>
          sum + (tx.nativeAmount * getHistoricalRate(tx.nativeCurrency, ym)) / tzsPerEur, 0);
        months.push({ ym, ...bySource, eurHist, total: monthTx.reduce((sum, tx) => sum + tx.amount, 0) });
      }

      const showEurCol = currency !== 'EUR';

      // Compute historical EUR rate per month
      const monthRates = showEurCol ? months.map(m => {
        const tzsPerEur = getHistoricalRate('EUR', m.ym);
        const tzsPerCur = currency === 'TZS' ? 1 : getHistoricalRate(currency, m.ym);
        return tzsPerEur / tzsPerCur;  // currency units per 1 EUR
      }) : [];

      const content = document.getElementById('is-content');
      content.innerHTML = `
        <div class="report-section">
          <div class="report-section-title">${t('reports.incsrc.monthly.title', { year, currency }, `Income Sources — ${year} (${currency})`)}</div>
          <div class="table-scroll-wrapper"><table class="tx-table nowrap">
            <thead><tr>
              <th>${t('common.label.month', {}, 'Month')}</th>
              ${sourceOrder.map(s => `<th class="t-right">${sourceLabel(s)}</th>`).join('')}
              <th class="num-right">${t('reports.shared.total_label', {}, 'Total')}</th>
              ${showEurCol ? `<th class="t-right">EUR</th><th class="t-right">${t('reports.incsrc.col.rate', {}, 'Rate')}</th>` : ''}
            </tr></thead>
            <tbody>
              ${months.map((m, i) => {
                const eurVal = showEurCol && m.total ? m.eurHist : 0;
                return `<tr>
                <td>${monthLabel(m.ym)}</td>
                ${sourceOrder.map(s => `<td class="amt" style="color:${sourceColors[s]}">${formatCurrency(m[s], currency)}</td>`).join('')}
                <td class="amt fw-700">${formatCurrency(m.total, currency)}</td>
                ${showEurCol ? `<td class="amt" style="color:var(--positive);font-weight:500;">${m.total ? formatCurrency(eurVal, 'EUR') : '—'}</td><td class="amt" style="color:var(--muted);font-size:0.85em;">${m.total ? monthRates[i].toFixed(0) : ''}</td>` : ''}
              </tr>`;
              }).join('')}
              <tr class="row-total">
                <td>${t('reports.shared.total_label', {}, 'Total')}</td>
                ${sourceOrder.map(s => `<td class="amt" style="color:${sourceColors[s]}">${formatCurrency(months.reduce((sum, m) => sum + m[s], 0), currency)}</td>`).join('')}
                <td class="amt">${formatCurrency(months.reduce((sum, m) => sum + m.total, 0), currency)}</td>
                ${showEurCol ? (() => {
                  const totalEur = months.reduce((sum, m) => sum + (m.total ? m.eurHist : 0), 0);
                  return `<td class="amt" style="color:var(--positive);">${formatCurrency(totalEur, 'EUR')}</td><td></td>`;
                })() : ''}
              </tr>
            </tbody>
          </table></div>
        </div>
        <div class="report-section">
          <div class="chart-row">
            <div class="chart-wrap">
              <div class="report-section-title">${t('reports.incsrc.chart.stacked', {}, 'Monthly Stacked Breakdown')}</div>
              <div class="chart-canvas-box"><canvas id="is-stack-chart"></canvas></div>
            </div>
            <div class="chart-wrap">
              <div class="report-section-title">${t('reports.incsrc.chart.pie', { year }, `Source Distribution — ${year}`)}</div>
              <div class="chart-canvas-box"><canvas id="is-pie-chart"></canvas></div>
            </div>
          </div>
        </div>
      `;

      // Stacked bar chart
      const stackCtx = document.getElementById('is-stack-chart');
      if (stackCtx) {
        const chart = new Chart(stackCtx, {
          type: 'bar',
          data: {
            labels: months.map(m => monthLabel(m.ym)),
            datasets: sourceOrder.map(s => ({
              label: sourceLabel(s),
              data: months.map(m => m[s]),
              backgroundColor: sourceColors[s],
              borderWidth: 0,
            })),
          },
          options: {
            ...CHART_BASE,
            plugins: {
              legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
              tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, currency)} ${currency}` } },
            },
            scales: {
              x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
              y: { stacked: true, ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
            },
          },
        });
        reportCharts.push(chart);
      }

      // Pie chart
      const pieCtx = document.getElementById('is-pie-chart');
      if (pieCtx) {
        const totals = sourceOrder.map(s => months.reduce((sum, m) => sum + m[s], 0));
        const chart = new Chart(pieCtx, {
          type: 'doughnut',
          data: {
            labels: sourceOrder.map(sourceLabel),
            datasets: [{ data: totals, backgroundColor: sourceOrder.map(s => sourceColors[s]), borderWidth: 0 }],
          },
          options: {
            ...CHART_BASE,
            plugins: {
              legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 11 } } },
              tooltip: { callbacks: { label: c => `${c.label}: ${formatCurrency(c.raw, currency)} ${currency} (${(c.raw / totals.reduce((a, b) => a + b, 0) * 100).toFixed(1)}%)` } },
            },
          },
        });
        reportCharts.push(chart);
      }
    } else {
      // Yearly view
      const showEurCol = currency !== 'EUR';
      const allYears = getAvailableYears();
      const yearData = allYears.map(y => {
        const yearTx = filteredIncome.filter(tx => tx.date && tx.date.startsWith(y));
        const bySource = {};
        for (const s of sourceOrder) bySource[s] = 0;
        for (const tx of yearTx) bySource[classifySource(tx)] += tx.amount;
        return { year: y, ...bySource, total: yearTx.reduce((sum, tx) => sum + tx.amount, 0) };
      });

      const content = document.getElementById('is-content');
      const titleBase = t('reports.incsrc.yearly.title', { currency }, `Income Sources by Year (${currency})`);
      const titleSuffix = showEurCol ? t('reports.incsrc.yearly.title_eur_suffix', {}, ' · EUR at current rate') : '';
      content.innerHTML = `
        <div class="report-section">
          <div class="report-section-title">${titleBase}${titleSuffix}</div>
          <div class="table-scroll-wrapper"><table class="tx-table nowrap">
            <thead><tr>
              <th>${t('common.col.year', {}, 'Year')}</th>
              ${sourceOrder.map(s => `<th class="t-right">${sourceLabel(s)}</th>`).join('')}
              <th class="num-right">${t('reports.shared.total_label', {}, 'Total')}</th>
              ${showEurCol ? '<th class="t-right">EUR</th>' : ''}
            </tr></thead>
            <tbody>
              ${yearData.map(d => {
                const curRate = (fxRates['EUR'] || 1) / (fxRates[currency] || 1);
                const eurVal = d.total ? d.total / curRate : 0;
                return `<tr>
                <td class="fw-500">${d.year}</td>
                ${sourceOrder.map(s => `<td class="amt" style="color:${sourceColors[s]}">${formatCurrency(d[s], currency)}</td>`).join('')}
                <td class="amt fw-700">${formatCurrency(d.total, currency)}</td>
                ${showEurCol ? `<td class="amt" style="color:var(--positive);font-weight:500;">${d.total ? formatCurrency(eurVal, 'EUR') : '—'}</td>` : ''}
              </tr>`;
              }).join('')}
            </tbody>
          </table></div>
        </div>
        <div class="report-section">
          <div class="chart-row">
            <div class="chart-wrap">
              <div class="report-section-title">${t('reports.incsrc.chart.yearly_stacked', {}, 'Yearly Income Sources')}</div>
              <div class="chart-canvas-box"><canvas id="is-year-chart"></canvas></div>
            </div>
          </div>
        </div>
      `;

      const ctx = document.getElementById('is-year-chart');
      if (ctx) {
        const chart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: yearData.map(d => d.year),
            datasets: sourceOrder.map(s => ({
              label: sourceLabel(s),
              data: yearData.map(d => d[s]),
              backgroundColor: sourceColors[s],
              borderWidth: 0,
            })),
          },
          options: {
            ...CHART_BASE,
            plugins: {
              legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
              tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, currency)} ${currency}` } },
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
  }

  tb.wire(update);
}

// ─── R3: Debt Overview Report ───────────────────────────────────────────

function renderDebtOverviewReport() {
  const out = document.getElementById('report-output');

  const tb = reportToolbar(out, 'do', [
    { key: 'cur', label: t('reports.toolbar.currency', {}, 'Currency'),
      options: reportCurrencies(), def: 'TZS' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="do-content"></div>
    </div>
  `;

  function update() {
    const currency = tb.get('cur');
    destroyReportCharts();

    const all = state.thirdParty || [];
    const open = all.filter(d => d.settled !== 'true');
    const settled = all.filter(d => d.settled === 'true');

    let totalOwedToMe = 0, totalOwedByMe = 0;
    for (const d of open) {
      const amt = convertTo(parseFloat(d.amount) || 0, d.currency, currency);
      if (d.type === 'owed_to_me') totalOwedToMe += amt;
      else totalOwedByMe += amt;
    }
    const netPosition = totalOwedToMe - totalOwedByMe;

    // Build open debts table
    const openRows = open.map(d => {
      const orig = convertTo(parseFloat(d.original_amount) || 0, d.currency, currency);
      const remaining = convertTo(parseFloat(d.amount) || 0, d.currency, currency);
      const paid = orig - remaining;
      const progress = orig > 0 ? (paid / orig * 100) : 0;
      const isOwed = d.type === 'owed_to_me';
      const color = isOwed ? 'var(--positive)' : 'var(--negative)';
      const label = isOwed
        ? t('reports.debtOverview.direction.owed_to_me', {}, 'owes you')
        : t('reports.debtOverview.direction.owed_by_me', {}, 'you owe');
      const nativeHint = d.currency !== currency ? ` <span style="color:var(--muted);font-size:9px;">(${formatCurrency(parseFloat(d.amount) || 0, d.currency)} ${d.currency})</span>` : '';

      return `<tr>
        <td class="fw-500">${escapeHtml(d.person_name)}</td>
        <td style="color:${color};font-size:11px;">${label}</td>
        <td class="amt">${formatCurrency(orig, currency)}</td>
        <td class="amt" style="color:${color};font-weight:500;">${formatCurrency(remaining, currency)}${nativeHint}</td>
        <td class="amt">${formatCurrency(paid, currency)}</td>
        <td>
          <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;width:80px;">
            <div style="height:100%;width:${progress.toFixed(0)}%;background:${color};border-radius:3px;"></div>
          </div>
          <span style="font-size:9px;color:var(--muted);">${progress.toFixed(0)}%</span>
        </td>
        <td class="hint-sm">${fmtDate(d.date_created)}</td>
        <td style="font-size:10px;color:var(--muted);max-width:160px;white-space:normal;">${escapeHtml(d.note || '')}</td>
      </tr>`;
    });

    // Settled debts summary
    const settledRows = settled.map(d => {
      const orig = convertTo(parseFloat(d.original_amount) || 0, d.currency, currency);
      const isOwed = d.type === 'owed_to_me';
      return `<tr class="op-50">
        <td>${escapeHtml(d.person_name)}</td>
        <td class="fs-11">${isOwed ? t('reports.debtOverview.direction.owed_to_me_past', {}, 'owed you') : t('reports.debtOverview.direction.owed_by_me_past', {}, 'you owed')}</td>
        <td class="amt">${formatCurrency(orig, currency)}</td>
        <td class="hint-sm">${fmtDate(d.date_created)}</td>
        <td class="hint-sm">${fmtDate(d.date_settled)}</td>
      </tr>`;
    });

    const content = document.getElementById('do-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="flex-row gap-md" style="flex-wrap:wrap;">
          <div class="summary-card fld-col">
            <div class="label-xs">${t('reports.debtOverview.card.owed_to_you', {}, 'Owed to You')}</div>
            <div class="amt" style="font-size:18px;color:var(--positive);font-weight:700;">${formatCurrency(totalOwedToMe, currency)} <span class="acc-currency">${currency}</span></div>
          </div>
          <div class="summary-card fld-col">
            <div class="label-xs">${t('reports.debtOverview.card.you_owe', {}, 'You Owe')}</div>
            <div class="amt" style="font-size:18px;color:var(--negative);font-weight:700;">${formatCurrency(totalOwedByMe, currency)} <span class="acc-currency">${currency}</span></div>
          </div>
          <div class="summary-card fld-col">
            <div class="label-xs">${t('reports.debtOverview.card.net_position', {}, 'Net Position')}</div>
            <div class="amt" style="font-size:18px;color:${netPosition >= 0 ? 'var(--positive)' : 'var(--negative)'};font-weight:700;">${netPosition >= 0 ? '+' : ''}${formatCurrency(netPosition, currency)} <span class="acc-currency">${currency}</span></div>
          </div>
          <div class="summary-card fld-col">
            <div class="label-xs">${t('reports.debtOverview.card.open_total', {}, 'Open / Total')}</div>
            <div style="font-size:18px;font-weight:700;">${open.length} / ${all.length}</div>
          </div>
        </div>
      </div>
      ${open.length > 0 ? `
      <div class="report-section">
        <div class="report-section-title">${t('reports.debtOverview.section.open', { currency }, `Open Debts (${currency})`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table">
          <thead><tr>
            <th>${t('reports.debtOverview.col.person', {}, 'Person')}</th><th>${t('reports.debtOverview.col.direction', {}, 'Direction')}</th><th class="t-right">${t('reports.debtOverview.col.original', {}, 'Original')}</th>
            <th class="t-right">${t('reports.debtOverview.col.remaining', {}, 'Remaining')}</th><th class="t-right">${t('reports.debtOverview.col.paid', {}, 'Paid')}</th>
            <th>${t('reports.debtOverview.col.progress', {}, 'Progress')}</th><th>${t('reports.debtOverview.col.created', {}, 'Created')}</th><th>${t('reports.debtOverview.col.note', {}, 'Note')}</th>
          </tr></thead>
          <tbody>${openRows.join('')}</tbody>
        </table></div>
      </div>` : `<div class="report-section"><div class="empty-state"><p>${t('reports.debtOverview.empty.no_open', {}, 'No open debts.')}</p></div></div>`}
      ${open.length > 0 ? `
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.debtOverview.chart.by_person', {}, 'Open Debts by Person')}</div>
            <div class="chart-canvas-box"><canvas id="do-bar-chart"></canvas></div>
          </div>
        </div>
      </div>` : ''}
      ${settled.length > 0 ? `
      <div class="report-section">
        <div class="report-section-title">${t('reports.debtOverview.section.settled', { count: settled.length }, `Settled Debts (${settled.length})`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table">
          <thead><tr><th>${t('reports.debtOverview.col.person', {}, 'Person')}</th><th>${t('reports.debtOverview.col.direction', {}, 'Direction')}</th><th class="t-right">${t('reports.debtOverview.col.amount', {}, 'Amount')}</th><th>${t('reports.debtOverview.col.created', {}, 'Created')}</th><th>${t('reports.debtOverview.col.settled', {}, 'Settled')}</th></tr></thead>
          <tbody>${settledRows.join('')}</tbody>
        </table></div>
      </div>` : ''}
    `;

    // Bar chart for open debts
    if (open.length > 0) {
      const ctx = document.getElementById('do-bar-chart');
      if (ctx) {
        const chart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: open.map(d => d.person_name),
            datasets: [{
              data: open.map(d => {
                const amt = convertTo(parseFloat(d.amount) || 0, d.currency, currency);
                return d.type === 'owed_to_me' ? amt : -amt;
              }),
              backgroundColor: open.map(d => d.type === 'owed_to_me' ? cssVar('--positive') : cssVar('--negative')),
              borderWidth: 0, borderRadius: 3,
            }],
          },
          options: {
            ...CHART_BASE, indexAxis: 'y',
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: c => `${c.raw >= 0 ? t('reports.debtOverview.chart.tooltip.owes_you', {}, 'Owes you') : t('reports.debtOverview.chart.tooltip.you_owe', {}, 'You owe')}: ${formatCurrency(Math.abs(c.raw), currency)} ${currency}` } },
            },
            scales: {
              x: { ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
              y: { grid: { display: false } },
            },
          },
        });
        reportCharts.push(chart);
      }
    }
  }

  tb.wire(update);
}

// ─── R4: Year-over-Year Comparison ──────────────────────────────────────

function renderYoYReport() {
  const out = document.getElementById('report-output');

  // Long-form month names via common.months.long.{1..12}, EN fallback kept
  // in case a locale omits a key.
  const monthFallback = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthNames = monthFallback.map((en, i) => t(`common.months.long.${i + 1}`, {}, en));

  const tb = reportToolbar(out, 'yoy', [
    { key: 'month', label: t('common.label.month', {}, 'Month'),
      options: monthNames.map((n, i) => ({ v: i + 1, l: n })),
      def: String(new Date().getMonth() + 1) },
    { key: 'cur', label: t('reports.toolbar.currency', {}, 'Currency'),
      options: reportCurrencies(), def: 'TZS' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="yoy-content"></div>
    </div>
  `;

  function update() {
    const month = parseInt(tb.get('month'), 10);
    const currency = tb.get('cur');
    destroyReportCharts();

    const mm = String(month).padStart(2, '0');
    const allYears = getAvailableYears();
    // Filter to years that have data for this month
    const years = allYears.filter(y => {
      const ym = `${y}-${mm}`;
      return state.tx.some(tx => tx.date && tx.date.startsWith(ym));
    });

    if (years.length === 0) {
      document.getElementById('yoy-content').innerHTML = `<div class="empty-state"><p>${t('reports.yoy.empty', {}, 'No data for this month.')}</p></div>`;
      return;
    }

    // Aggregate per year
    const custodyAliases = getCustodyAliases();
    const nonPnl = getNonPnlCategories();
    const uncatLabel = t('reports.shared.uncategorized', {}, '(uncategorized)');
    const yearStats = years.map(y => {
      const ym = `${y}-${mm}`;
      const monthTx = state.tx.filter(tx => tx.date && tx.date.startsWith(ym) && isOperationalTx(tx, custodyAliases, nonPnl));
      let income = 0, expenses = 0;
      const catBreakdown = {};
      for (const tx of monthTx) {
        const amt = convertTo(tx.amount, tx.currency, currency);
        if (tx.type === 'income') income += amt;
        if (tx.type === 'expense') {
          expenses += amt;
          const cat = tx.category || uncatLabel;
          catBreakdown[cat] = (catBreakdown[cat] || 0) + amt;
        }
      }
      return { year: y, income, expenses, net: income - expenses, txCount: monthTx.length, catBreakdown };
    });

    // Collect all expense categories that appear
    const allCats = new Set();
    for (const ys of yearStats) for (const cat of Object.keys(ys.catBreakdown)) allCats.add(cat);
    const sortedCats = [...allCats].sort((a, b) => {
      const totA = yearStats.reduce((s, ys) => s + (ys.catBreakdown[a] || 0), 0);
      const totB = yearStats.reduce((s, ys) => s + (ys.catBreakdown[b] || 0), 0);
      return totB - totA;
    }).slice(0, 15);

    const monthDisplay = monthNames[month - 1];
    const content = document.getElementById('yoy-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.yoy.section.summary', { month: monthDisplay, currency }, `${monthDisplay} — Year-over-Year Summary (${currency})`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table">
          <thead><tr>
            <th>${t('common.col.year', {}, 'Year')}</th>
            <th class="t-right">${t('common.label.income', {}, 'Income')}</th>
            <th class="t-right">${t('common.label.expenses', {}, 'Expenses')}</th>
            <th class="t-right">${t('common.label.net', {}, 'Net')}</th>
            <th class="t-right">${t('reports.yoy.col.tx_count', {}, 'TX Count')}</th>
          </tr></thead>
          <tbody>
            ${yearStats.map((ys, i) => {
              const prevYs = i > 0 ? yearStats[i - 1] : null;
              const expChange = prevYs && prevYs.expenses > 0 ? ((ys.expenses - prevYs.expenses) / prevYs.expenses * 100) : null;
              const changeStr = expChange !== null ? ` <span style="color:${expChange > 0 ? 'var(--negative)' : 'var(--positive)'};font-size:9px;">(${expChange > 0 ? '+' : ''}${expChange.toFixed(0)}%)</span>` : '';
              return `<tr>
                <td class="fw-700">${ys.year}</td>
                <td class="amt c-pos">${formatCurrency(ys.income, currency)}</td>
                <td class="amt c-neg">${formatCurrency(ys.expenses, currency)}${changeStr}</td>
                <td class="amt" style="color:${ys.net >= 0 ? 'var(--positive)' : 'var(--negative)'};">${ys.net >= 0 ? '+' : ''}${formatCurrency(ys.net, currency)}</td>
                <td class="amt">${ys.txCount}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.yoy.section.top_cats', { month: monthDisplay, currency }, `Top Categories — ${monthDisplay} by Year (${currency})`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table">
          <thead><tr>
            <th>${t('common.col.category', {}, 'Category')}</th>
            ${years.map(y => `<th class="t-right">${y}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${sortedCats.map(cat => `<tr>
              <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(cat)}</td>
              ${years.map(y => {
                const ys = yearStats.find(s => s.year === y);
                const val = ys ? (ys.catBreakdown[cat] || 0) : 0;
                return `<td class="amt">${val > 0 ? formatCurrency(val, currency) : '—'}</td>`;
              }).join('')}
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.yoy.chart.incexp', { month: monthDisplay }, `Income vs. Expenses — ${monthDisplay}`)}</div>
            <div class="chart-canvas-box"><canvas id="yoy-bar-chart"></canvas></div>
          </div>
        </div>
      </div>
    `;

    const ctx = document.getElementById('yoy-bar-chart');
    if (ctx) {
      const chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: years,
          datasets: [
            { label: t('common.label.income', {}, 'Income'), data: yearStats.map(ys => ys.income), backgroundColor: cssVar('--positive'), borderWidth: 0 },
            { label: t('common.label.expenses', {}, 'Expenses'), data: yearStats.map(ys => ys.expenses), backgroundColor: cssVar('--negative'), borderWidth: 0 },
          ],
        },
        options: {
          ...CHART_BASE,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, currency)} ${currency}` } },
          },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}

