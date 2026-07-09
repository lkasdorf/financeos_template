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

// ─── Report Scaffolding Factories (DR-M4) ────────────────────────────────
// The ~12 report modules used to copy the same scaffolding per report:
// a hand-built toolbar with data-attribute persistence + per-select
// 'change' wiring (32 blocks / 66 listener lines), the currency list
// derivation (20 word-identical sites), the standard Chart.js options
// pair (~69 sites) and the currency y-axis tick formatter (~60 sites).
// Single point of fix for all four lives here.

// Distinct currencies across active self-owned accounts — the option list
// every report currency switcher renders.
function reportCurrencies() {
  return [...new Set(state.accounts
    .filter(a => a.owner === 'self' && a.status === 'active')
    .map(a => a.currency))];
}

// Standard Chart.js sizing options — spread as `...CHART_BASE` at the top
// of every chart's `options` object.
const CHART_BASE = { responsive: true, maintainAspectRatio: false };

// Standard currency axis ticks: `ticks: currencyTicks(currency)`.
function currencyTicks(currency) {
  return { callback: v => formatCurrency(v, currency) };
}

// Declarative toolbar factory.
//
// fields: [{ key, label, options, def, id? }]
//   key     — persistence suffix; the value is saved as
//             data-<reportId>-<key> on `out` (survives re-renders)
//   label   — already-translated label text
//   options — array of { v, l } (value/label) or plain strings
//   def     — fallback value when nothing is persisted yet
//   id      — DOM id override (defaults to <reportId>-<key>)
//
// Returns { html, wire, get, el }:
//   html         — toolbar markup to embed in the report template
//   wire(update) — call AFTER out.innerHTML is set: binds the selects,
//                  persists all values + re-runs update() on every
//                  change, then runs update() once for the initial render
//   get(key)     — current value of a field (valid after wire())
//   el(key)      — the underlying <select>, e.g. for visibility toggles
function reportToolbar(out, reportId, fields, { extraHtml = '' } = {}) {
  const saved = {};
  for (const f of fields) {
    saved[f.key] = out.getAttribute(`data-${reportId}-${f.key}`) ?? f.def;
  }
  const idOf = f => f.id || `${reportId}-${f.key}`;
  const fieldHtml = fields.map(f => `
        <label>${f.label}</label>
        <select id="${idOf(f)}">
          ${f.options.map(o => {
            const v = (o && typeof o === 'object') ? o.v : o;
            const l = (o && typeof o === 'object') ? o.l : o;
            return `<option value="${escapeHtml(String(v))}" ${String(v) === String(saved[f.key]) ? 'selected' : ''}>${l}</option>`;
          }).join('')}
        </select>`).join('');
  const els = {};
  function wire(update) {
    for (const f of fields) els[f.key] = document.getElementById(idOf(f));
    const persist = () => {
      for (const f of fields) out.setAttribute(`data-${reportId}-${f.key}`, els[f.key].value);
    };
    for (const f of fields) {
      els[f.key].addEventListener('change', () => { persist(); update(); });
    }
    persist();
    update();
  }
  return {
    html: `
      <div class="report-toolbar">${fieldHtml}
        ${extraHtml}
      </div>`,
    wire,
    get: k => els[k].value,
    el: k => els[k],
  };
}


// ─── Month-End Balance Sweep (DR-M3) ─────────────────────────────────────
// Single-pass month-end balances for a set of accounts. The Net-Worth-
// Trend and FX-Exposure reports used to re-scan the FULL state.tx array
// once per month × account (~720 full scans per render / currency
// switch); one date-sorted sweep with running balances is
// O(TX + months × accounts).
//
// monthKeys must be ascending 'YYYY-MM' strings. Returns one snapshot
// object per month key, mapping alias → NATIVE end-of-month balance
// (callers convert). Accounts whose initial_balance_date lies after the
// month's end carry no entry in that snapshot — same skip semantics as
// the old per-month loops.
function computeMonthlyBalances(accounts, monthKeys) {
  const balances = {};
  const ibDates = {};
  for (const a of accounts) {
    balances[a.alias] = a.initial_balance || 0;
    ibDates[a.alias] = a.initial_balance_date || '2000-01-01';
  }
  const txs = state.tx
    .filter(t => t.date && (balances[t.account] !== undefined ||
      (t.type === 'transfer' && balances[t.transfer_to_account] !== undefined)))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

  const snapshots = [];
  let i = 0;
  for (const mk of monthKeys) {
    const endOfMonth = mk + '-31';
    while (i < txs.length && txs[i].date <= endOfMonth) {
      const t = txs[i];
      if (balances[t.account] !== undefined && t.date >= ibDates[t.account]) {
        if (t.type === 'income') balances[t.account] += t.amount;
        else if (t.type === 'expense') balances[t.account] -= t.amount;
        else if (t.type === 'transfer') balances[t.account] -= t.amount;
      }
      if (t.type === 'transfer' && balances[t.transfer_to_account] !== undefined
          && t.date >= ibDates[t.transfer_to_account]) {
        balances[t.transfer_to_account] += t.transfer_to_amount > 0 ? t.transfer_to_amount : t.amount;
      }
      i++;
    }
    const snap = {};
    for (const a of accounts) {
      if (endOfMonth < ibDates[a.alias]) continue;
      snap[a.alias] = balances[a.alias];
    }
    snapshots.push(snap);
  }
  return snapshots;
}

// ─── Generic Expense Report (reusable for tag-based and category-based) ──

function renderExpenseReport(opts) {
  // opts: { filterId, filterLabel, filterFn, colorMain }
  const out = document.getElementById('report-output');
  const years = getAvailableYears();

  // DR-M4 reference migration: toolbar rendering/persistence/wiring live
  // in reportToolbar(); this function keeps only its own update() logic.
  const tb = reportToolbar(out, opts.filterId, [
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
      <div id="re-content"></div>
    </div>
  `;

  function update() {
    tb.el('year').style.display = tb.get('mode') === 'yearly' ? 'none' : '';
    destroyReportCharts();

    const currency = tb.get('cur');
    const custodyAliases = getCustodyAliases();
    const nonPnl = getNonPnlCategories();
    const filtered = state.tx.filter(tx => opts.filterFn(tx) && isOperationalTx(tx, custodyAliases, nonPnl)).map(tx => ({
      ...tx,
      // DR-H1 (CODE_REVIEW_2026-07-08): keep the native amount alongside
      // the converted one — the TX lists used to format the CONVERTED
      // value with the ORIGINAL currency label ('45,000 TZS' in the EUR
      // view rendered as '14 TZS'). Mirrors getIncomeTransactions().
      originalAmount: tx.amount,
      amount: convertTo(tx.amount, tx.currency, currency)
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

    if (tb.get('mode') === 'monthly') {
      renderExpenseMonthly(filtered, tb.get('year'), currency, opts);
    } else {
      renderExpenseYearly(filtered, currency, opts);
    }
  }

  tb.wire(update);
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
      <div class="mb-16">
        <div style="font-weight:600;margin-bottom:6px;font-size:13px;">${escapeHtml(t('reports.empty.configured', {}, 'Currently configured for'))}:</div>
        <div style="line-height:2;">${configuredHtml}</div>
      </div>
      <div class="mb-20">
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
    const stackPalette = chartPalette();
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
        ...CHART_BASE,
        plugins: { legend: barLegend, tooltip: { callbacks: { label: ctx => (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + formatCurrency(ctx.raw, currency) + ' ' + currency } } },
        scales: {
          x: { stacked: barStacked, grid: { color: cssVar('--chart-grid') } },
          y: { stacked: barStacked, ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
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
        <td class="label-sm">${pct}%</td>
      </tr>`;
      const sorted = data.items.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      for (const tx of sorted) {
        catRows += `<tr>
          <td>${fmtDate(tx.date)}</td>
          <td>${escapeHtml(tx.payee || '')}</td>
          <td>${escapeHtml(tx.note || '')}</td>
          <td>${escapeHtml(tx.account)}</td>
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
            <tr class="row-total">
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
        <td>${escapeHtml(tx.account)}</td>
        <td>${escapeHtml(tx.payee || '')}</td>
        <td class="cat">${escapeHtml(tx.category || '')}${tags ? '<br>' + tags : ''}</td>
        <td>${escapeHtml(tx.note || '')}</td>
        <td class="amt expense">${formatCurrency(tx.amount, currency)} <span class="hint-sm">${escapeHtml(currency)}</span></td>
        <td class="hint-sm">${tx.currency !== currency ? `${formatCurrency(tx.originalAmount, tx.currency)} ${escapeHtml(tx.currency)}` : ''}</td>
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

  // Optional transaction list (yearly shows all)
  if (opts.showTransactions) {
    const allTx = filtered.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const txRows = allTx.map(tx => {
      const tags = (tx.tags || '').split(';').filter(Boolean).map(x => `<span class="tag-chip">${escapeHtml(x)}</span>`).join('');
      return `<tr>
        <td>${fmtDate(tx.date)}</td>
        <td>${escapeHtml(tx.account)}</td>
        <td>${escapeHtml(tx.payee || '')}</td>
        <td class="cat">${escapeHtml(tx.category || '')}${tags ? '<br>' + tags : ''}</td>
        <td>${escapeHtml(tx.note || '')}</td>
        <td class="amt expense">${formatCurrency(tx.amount, currency)} <span class="hint-sm">${escapeHtml(currency)}</span></td>
        <td class="hint-sm">${tx.currency !== currency ? `${formatCurrency(tx.originalAmount, tx.currency)} ${escapeHtml(tx.currency)}` : ''}</td>
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

