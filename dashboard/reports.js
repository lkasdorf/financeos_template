// ─── Reports Engine ──────────────────────────────────────────────────────

const REPORTS = [
  {
    id: 'income',
    category: 'Income',
    title: 'Income Analysis',
    desc: 'Monthly and yearly income breakdown with charts — real income vs. reimbursements',
    render: renderIncomeReport,
  },
  {
    id: 'incexp',
    category: 'Income',
    title: 'Income vs. Expense Summary',
    desc: 'Side-by-side comparison of income and expenses with net balance — monthly and yearly',
    render: renderIncExpReport,
  },
  {
    id: 'house4c',
    category: 'Expenses',
    title: 'House 4C Costs',
    desc: 'All expenses tagged House_A_costs (SBR rental house District) — monthly and yearly',
    render: renderHouse4CReport,
  },
  {
    id: 'bills',
    category: 'Expenses',
    title: 'Bills Overview',
    desc: 'Rent, electricity, water & internet — total and per category breakdown',
    render: renderBillsReport,
  },
  {
    id: 'ai',
    category: 'Expenses',
    title: 'AI Costs',
    desc: 'Subscriptions:AI spending — monthly and yearly breakdown with charts',
    render: renderAICostsReport,
  },
  {
    id: 'automobile',
    category: 'Expenses',
    title: 'Automobile Costs',
    desc: 'All vehicle expenses — petrol, maintenance, toll, parking, insurance, purchases',
    render: renderAutomobileReport,
  },
  {
    id: 'dining',
    category: 'Expenses',
    title: 'Dining Out',
    desc: 'Restaurant visits — private vs. ExampleCo split, top restaurants, monthly trends',
    render: renderDiningReport,
  },
  {
    id: 'catbreakdown',
    category: 'Expenses',
    title: 'Category Breakdown',
    desc: 'Expense distribution across all categories — treemap view, monthly and yearly',
    render: renderCategoryBreakdownReport,
  },
  {
    id: 'balances',
    category: 'Overview',
    title: 'Account Balances Over Time',
    desc: 'Running balance per account over time — line chart showing balance trajectory',
    render: renderBalancesReport,
  },
  {
    id: 'toppayees',
    category: 'Overview',
    title: 'Top Payees',
    desc: 'Biggest payees by total spending — yearly ranking with charts',
    render: renderTopPayeesReport,
  },
  {
    id: 'exampleco',
    category: 'Business',
    title: 'ExampleCo Reimbursements',
    desc: 'All pass-through expenses via ExampleCo accounts — monthly totals, categories, open items',
    render: renderExampleCoReport,
  },
  {
    id: 'savingsrate',
    category: 'Overview',
    title: 'Savings Rate Trend',
    desc: 'Monthly savings rate (Income - Expenses) / Income — trend line over time',
    render: renderSavingsRateReport,
  },
  {
    id: 'subscriptions',
    category: 'Expenses',
    title: 'Subscription Tracker',
    desc: 'All recurring subscriptions — AI, streaming, hosting, services — monthly fixed costs',
    render: renderSubscriptionReport,
  },
  {
    id: 'weekday',
    category: 'Overview',
    title: 'Weekday vs. Weekend',
    desc: 'Spending patterns by day of week — are weekends more expensive?',
    render: renderWeekdayReport,
  },
  {
    id: 'recurring',
    category: 'Expenses',
    title: 'Recurring Expense Tracker',
    desc: 'Month-over-month comparison of recurring bills and subscriptions — highlights price changes',
    render: renderRecurringReport,
  },
  {
    id: 'vices',
    category: 'Expenses',
    title: 'Vice Spending',
    desc: 'Cigarettes, vaping & alcohol — monthly and yearly breakdown with category split',
    render: renderViceSpendingReport,
  },
  {
    id: 'bankfees',
    category: 'Expenses',
    title: 'Bank Fees',
    desc: 'All bank and transaction fees — ATM, transfer, card fees by account and month',
    render: renderBankFeesReport,
  },
  {
    id: 'cashdigital',
    category: 'Overview',
    title: 'Cash vs. Digital',
    desc: 'Spending split by payment method — cash vs. bank/mobile money/card over time',
    render: renderCashDigitalReport,
  },
  {
    id: 'fxexposure',
    category: 'Overview',
    title: 'FX Exposure',
    desc: 'Asset distribution across currencies (TZS, EUR, USD, PLN) — balance over time',
    render: renderFXExposureReport,
  },
  {
    id: 'monthcomp',
    category: 'Overview',
    title: 'Monthly Comparison',
    desc: 'This month vs. last month — category-by-category delta analysis',
    render: renderMonthlyComparisonReport,
  },
  {
    id: 'networth',
    category: 'Overview',
    title: 'Net Worth Trend',
    desc: 'Total net worth (all currencies converted) over time — the single most important number',
    render: renderNetWorthTrendReport,
  },
  {
    id: 'fixedvar',
    category: 'Overview',
    title: 'Discretionary vs. Fixed',
    desc: 'Fixed costs (rent, bills, subscriptions) vs. variable spending — budget flexibility analysis',
    render: renderFixedVarReport,
  },
  {
    id: 'largest',
    category: 'Overview',
    title: 'Largest Transactions',
    desc: 'Top single transactions by amount — outlier detection and anomaly review',
    render: renderLargestTxReport,
  },
  {
    id: 'bizpersonal',
    category: 'Business',
    title: 'Business vs. Personal',
    desc: 'ExampleCo/KSD business expenses vs. personal — adjusted cashflow view',
    render: renderBizPersonalReport,
  },
  {
    id: 'seasonal',
    category: 'Overview',
    title: 'Seasonal Heatmap',
    desc: 'Month × category heatmap across all years — spot seasonal spending patterns',
    render: renderSeasonalReport,
  },
  {
    id: 'runway',
    category: 'Overview',
    title: 'Cash Runway',
    desc: 'At current burn rate, how many months do savings last? Risk indicator with trend',
    render: renderRunwayReport,
  },
  {
    id: 'cashforecast',
    category: 'Overview',
    title: 'Cashflow Forecast',
    desc: '90-day projection starting from current net worth. Combines scheduled TX (certain) + seasonal 12-month expense median + user-adjustable special income (Dividends/K-Reimbursements/Interest). Pass-through flow shown separately.',
    render: renderCashflowForecastReport,
  },
  {
    id: 'expensetrend',
    category: 'Expenses',
    title: 'Expense Trend Sparklines',
    desc: 'Top expense categories with 12-month sparkline trends and month-over-month change',
    render: renderExpenseTrendReport,
  },
  {
    id: 'incomesources',
    category: 'Income',
    title: 'Income Sources Breakdown',
    desc: 'Income diversification over time — salary, reimbursements, and other sources',
    render: renderIncomeSourcesReport,
  },
  {
    id: 'debtoverview',
    category: 'Overview',
    title: 'Debt Overview',
    desc: 'Open debts, repayment progress, net position, and payment history',
    render: renderDebtOverviewReport,
  },
  {
    id: 'yoy',
    category: 'Overview',
    title: 'Year-over-Year Comparison',
    desc: 'Same month across different years — spot trends and anomalies',
    render: renderYoYReport,
  },
  {
    id: 'ptaudit',
    category: 'Business',
    title: 'Pass-Through Audit',
    desc: 'Verify pass-through accounts have matching counter-entries — flag missing or mismatched pairs',
    render: renderPassThroughAuditReport,
  },
  {
    id: 'staffcosts',
    category: 'Expenses',
    title: 'Staff Costs',
    desc: 'All Staff: categories aggregated — salary, bonus, rent, teachers — monthly and yearly',
    render: renderStaffCostsReport,
  },
  {
    id: 'savingsgoals',
    category: 'Overview',
    title: 'Savings Goals History',
    desc: 'Track savings goal progress over time — actual balance vs. linear target path with monthly detail',
    render: renderSavingsGoalsHistoryReport,
  },
  {
    id: 'fxhistory',
    category: 'Overview',
    title: 'Exchange Rates History',
    desc: 'Historical monthly FX rates — EUR, USD, PLN, TRY against TZS with trend charts',
    render: renderFxHistoryReport,
  },
  {
    id: 'costofliving',
    category: 'Overview',
    title: 'Cost of Living',
    desc: 'Essential expenses only — excludes every category flagged as non-essential in Settings → Categories (discretionary/luxury)',
    render: renderCostOfLivingReport,
  },
  {
    id: 'cashdiscrepancy',
    category: 'Expenses',
    title: 'Cash Discrepancy Log',
    desc: 'Kassenkorrekturen — Fehlbeträge vs. Überschüsse, Netto-Saldo pro Jahr und alle Einzelbuchungen',
    render: renderCashDiscrepancyReport,
  },
];

let activeReportId = null;
// reportCharts declared in core.js

function destroyReportCharts() {
  for (const c of reportCharts) c.destroy();
  reportCharts = [];
}

function renderReportsPage() {
  if (activeReportId) {
    renderReportDetail();
  } else {
    renderReportsList();
  }
}

async function renderReportsList() {
  const listEl = document.getElementById('reports-list-view');
  const detailEl = document.getElementById('reports-detail-view');
  listEl.style.display = '';
  detailEl.style.display = 'none';

  // Group built-in reports by category
  const categories = {};
  for (const r of REPORTS) {
    if (!categories[r.category]) categories[r.category] = [];
    categories[r.category].push(r);
  }

  // Category + report title/desc translation: keys follow the convention
  // `reports.category.<Category>` / `reports.<id>.title` / `reports.<id>.desc`.
  // English values are kept as fallbacks so missing translations don't break
  // the UI — fork-users can ship a partial locale file and gradually complete.
  const categoryLabel = (cat) => t(`reports.category.${cat}`, {}, cat);
  const reportTitle = (r) => t(`reports.${r.id}.title`, {}, r.title);
  const reportDesc = (r) => t(`reports.${r.id}.desc`, {}, r.desc);

  let html = Object.entries(categories).map(([cat, reports]) => `
    <div class="report-category">
      <div class="report-category-label">${escapeHtml(categoryLabel(cat))}</div>
      <div class="report-cards">
        ${reports.map(r => `
          <div class="report-card" data-report="${r.id}">
            <div class="rc-title">${escapeHtml(reportTitle(r))}</div>
            <div class="rc-desc">${escapeHtml(reportDesc(r))}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  // Append saved custom reports as a "Custom" category
  let customCount = 0;
  try {
    const res = await fetch('/api/custom-reports/list', { method: 'POST', body: '{}' });
    const data = await res.json();
    const custom = (data.reports || []).slice().sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
    customCount = custom.length;
    if (custom.length) {
      html += `
        <div class="report-category">
          <div class="report-category-label">${escapeHtml(t('reports.category.Custom', {}, 'Custom'))}</div>
          <div class="report-cards">
            ${custom.map(r => `
              <div class="report-card" data-cr-view-id="${r.id}">
                <div class="rc-title">${escapeHtml(r.name)}</div>
                <div class="rc-desc">${escapeHtml(r.description || t('reports.custom_match_desc', { mode: r.match_mode || 'AND' }, `Match ${r.match_mode || 'AND'}`))}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
  } catch {} // silent — custom reports are optional

  listEl.innerHTML = html;
  const totalCount = REPORTS.length + customCount;
  const meta = t('reports.meta_count', { n: totalCount }, `${totalCount} reports available`);
  const customSuffix = customCount
    ? t('reports.meta_custom_suffix', { custom: customCount }, ` (${customCount} custom)`)
    : '';
  document.getElementById('reports-meta').textContent = meta + customSuffix;

  // Event delegation for report cards + back button (registered once)
  const pageContent = listEl.parentElement;
  if (!pageContent._delegated) {
    pageContent.addEventListener('click', (e) => {
      const customCard = e.target.closest('.report-card[data-cr-view-id]');
      if (customCard) { location.hash = '#custom-reports/view/' + customCard.getAttribute('data-cr-view-id'); return; }
      const card = e.target.closest('.report-card[data-report]');
      if (card) { activeReportId = card.getAttribute('data-report'); renderReportsPage(); return; }
      if (e.target.closest('#report-back-btn')) { activeReportId = null; destroyReportCharts(); renderReportsPage(); return; }
      if (e.target.closest('#report-export-btn')) { exportReportTables(); return; }
      if (e.target.closest('#report-pdf-btn')) { exportReportPDF(); return; }
    });
    pageContent._delegated = true;
  }
}

function exportReportTables() {
  const output = document.getElementById('report-output');
  if (!output) return;
  const tables = output.querySelectorAll('table');
  if (tables.length === 0) { alert(t('reports.export.err_no_tables', {}, 'No tables to export in this report.')); return; }
  if (typeof XLSX === 'undefined') { alert(t('reports.export.err_no_xlsx', {}, 'XLSX library not loaded')); return; }

  const wb = XLSX.utils.book_new();
  tables.forEach((table, i) => {
    const ws = XLSX.utils.table_to_sheet(table);
    const name = `Sheet${i + 1}`;
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  const report = REPORTS.find(r => r.id === activeReportId);
  const title = report ? report.title.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30) : 'report';
  XLSX.writeFile(wb, `${title}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// Export the current report as PDF. Shows an options modal first (orientation,
// page size, include charts), then triggers window.print() with the selected
// settings applied via body classes and an injected @page rule.
function exportReportPDF() {
  const detailEl = document.getElementById('reports-detail-view');
  if (!detailEl || detailEl.style.display === 'none') {
    alert(t('reports.export.err_no_report', {}, 'Open a report first.'));
    return;
  }
  openPDFExportModal();
}

// Opens the PDF options modal. On confirm, runs runPDFExport(opts).
function openPDFExportModal() {
  // Remember last choices across opens within the session
  const prefs = window._pdfPrefs || { orientation: 'portrait', pageSize: 'A4', includeCharts: true };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay pdf-modal-overlay';
  overlay.innerHTML = `
    <div class="modal pdf-modal">
      <h3>${t('reports.pdf.title', {}, 'PDF <span class="accent">Export</span>')}</h3>
      <div class="pdf-opt-group">
        <div class="pdf-opt-label">${t('reports.pdf.label_orientation', {}, 'Orientation')}</div>
        <div class="pdf-seg" data-field="orientation">
          <button type="button" data-val="portrait" class="${prefs.orientation === 'portrait' ? 'active' : ''}">${t('reports.pdf.opt_portrait', {}, 'Portrait')}</button>
          <button type="button" data-val="landscape" class="${prefs.orientation === 'landscape' ? 'active' : ''}">${t('reports.pdf.opt_landscape', {}, 'Landscape')}</button>
        </div>
        <div class="pdf-opt-hint">${t('reports.pdf.hint_orientation', {}, 'Landscape fits wide tables (7+ columns) and side-by-side charts better.')}</div>
      </div>
      <div class="pdf-opt-group">
        <div class="pdf-opt-label">${t('reports.pdf.label_page_size', {}, 'Page Size')}</div>
        <div class="pdf-seg" data-field="pageSize">
          <button type="button" data-val="A4" class="${prefs.pageSize === 'A4' ? 'active' : ''}">A4</button>
          <button type="button" data-val="Letter" class="${prefs.pageSize === 'Letter' ? 'active' : ''}">Letter</button>
          <button type="button" data-val="A3" class="${prefs.pageSize === 'A3' ? 'active' : ''}">A3</button>
        </div>
      </div>
      <div class="pdf-opt-group">
        <label class="pdf-toggle">
          <input type="checkbox" id="pdf-include-charts" ${prefs.includeCharts ? 'checked' : ''}>
          <span>${t('reports.pdf.include_charts', {}, 'Include charts')}</span>
        </label>
        <div class="pdf-opt-hint">${t('reports.pdf.hint_include_charts', {}, 'Uncheck for a numbers-only report (smaller file, faster print).')}</div>
      </div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button type="button" class="pdf-btn-cancel">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button type="button" class="pdf-btn-generate btn-save">${t('reports.pdf.btn_generate', {}, 'Generate PDF')}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const readOpts = () => ({
    orientation: overlay.querySelector('.pdf-seg[data-field="orientation"] .active')?.dataset.val || 'portrait',
    pageSize: overlay.querySelector('.pdf-seg[data-field="pageSize"] .active')?.dataset.val || 'A4',
    includeCharts: overlay.querySelector('#pdf-include-charts').checked,
  });

  // Segmented-button toggling
  overlay.querySelectorAll('.pdf-seg').forEach(seg => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-val]');
      if (!btn) return;
      seg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const close = () => overlay.remove();
  overlay.querySelector('.pdf-btn-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const onEsc = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);

  overlay.querySelector('.pdf-btn-generate').addEventListener('click', () => {
    const opts = readOpts();
    window._pdfPrefs = opts;
    document.removeEventListener('keydown', onEsc);
    close();
    runPDFExport(opts);
  });
}

// Applies the chosen options, injects branded print header, triggers
// window.print(), and cleans up on afterprint.
function runPDFExport(opts) {
  const detailEl = document.getElementById('reports-detail-view');
  const report = REPORTS.find(r => r.id === activeReportId);
  const reportTitle = report
    ? t(`reports.${report.id}.title`, {}, report.title)
    : t('reports.fallback_title', {}, 'Report');

  const existingHeader = detailEl.querySelector('.print-header');
  if (existingHeader) existingHeader.remove();

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const currency = (typeof state !== 'undefined' && state.currency) ? state.currency : '';
  const versionEl = document.querySelector('footer span');
  const version = versionEl ? versionEl.textContent.replace(/.*?(v\d[\w.-]*).*/, '$1') : '';
  const pageLabel = `${opts.pageSize} · ${opts.orientation.charAt(0).toUpperCase() + opts.orientation.slice(1)}`;

  const header = document.createElement('div');
  header.className = 'print-header';
  header.innerHTML = `
    <div class="print-brand">Leon<em>Pesa</em></div>
    <div class="print-meta">
      <div class="print-report-name">${escapeHtml(reportTitle)}</div>
      <div class="print-meta-line">
        ${t('reports.print.generated', {}, 'Generated')} ${stamp}
        ${currency ? ` · ${currency}` : ''}
        ${version ? ` · ${version}` : ''}
        &nbsp;·&nbsp; ${pageLabel}
      </div>
    </div>
  `;
  detailEl.insertBefore(header, detailEl.firstChild);

  // Inject @page rule for chosen size+orientation. @page can't live inside
  // a class-scoped selector, so we swap the whole rule via a <style> tag.
  let pageStyle = document.getElementById('pdf-page-style');
  if (!pageStyle) {
    pageStyle = document.createElement('style');
    pageStyle.id = 'pdf-page-style';
    document.head.appendChild(pageStyle);
  }
  const margin = opts.orientation === 'landscape' ? '10mm 12mm' : '12mm 12mm';
  pageStyle.textContent = `@page { size: ${opts.pageSize} ${opts.orientation}; margin: ${margin}; }`;

  const root = document.documentElement;
  const wasDark = root.classList.contains('dark');
  if (wasDark) root.classList.remove('dark');
  document.body.classList.add('printing-report');
  if (opts.orientation === 'landscape') document.body.classList.add('pdf-landscape');
  if (!opts.includeCharts) document.body.classList.add('pdf-no-charts');

  // Chart.js canvases must re-layout for the print container dimensions.
  // Also auto-fit any tables that measure wider than the printable area —
  // the small-font CSS rules handle most cases, but pathological column
  // counts still need a transform scale to not clip at the page edge.
  const onBeforePrint = () => {
    for (const c of reportCharts) {
      try { c.resize(); } catch { /* ignore — chart may be destroyed */ }
    }
    autoFitWideTables(opts);
  };
  window.addEventListener('beforeprint', onBeforePrint);

  const cleanup = () => {
    document.body.classList.remove('printing-report', 'pdf-landscape', 'pdf-no-charts');
    if (wasDark) root.classList.add('dark');
    header.remove();
    if (pageStyle) pageStyle.remove();
    // Remove any auto-fit scaling
    document.querySelectorAll('[data-print-scale]').forEach(el => {
      el.removeAttribute('data-print-scale');
      el.style.removeProperty('--print-scale');
    });
    window.removeEventListener('afterprint', cleanup);
    window.removeEventListener('beforeprint', onBeforePrint);
    for (const c of reportCharts) {
      try { c.resize(); } catch { /* ignore */ }
    }
  };
  window.addEventListener('afterprint', cleanup);

  setTimeout(() => window.print(), 50);
}

// Measures each table wrapper and applies transform: scale() if its
// natural width exceeds the printable page width. Called from
// `beforeprint` — by then the print media rules are active, so the
// measurement reflects the shrunken-font print layout.
function autoFitWideTables(opts) {
  const sizes = {
    A4: { short: 210, long: 297 },
    Letter: { short: 216, long: 279 },
    A3: { short: 297, long: 420 },
  };
  const dims = sizes[opts.pageSize] || sizes.A4;
  const pageWidthMM = opts.orientation === 'landscape' ? dims.long : dims.short;
  const marginMM = opts.orientation === 'landscape' ? 28 : 28;
  const contentPx = (pageWidthMM - marginMM) * 3.7795; // mm → CSS px @ 96dpi

  const wrappers = document.querySelectorAll('#report-output .table-scroll-wrapper');
  for (const w of wrappers) {
    w.removeAttribute('data-print-scale');
    w.style.removeProperty('--print-scale');
    const table = w.querySelector('table');
    if (!table) continue;
    const natural = table.scrollWidth;
    if (natural > contentPx + 4) {
      const scale = Math.max(0.55, (contentPx - 4) / natural);
      w.setAttribute('data-print-scale', '1');
      w.style.setProperty('--print-scale', scale.toFixed(3));
    }
  }
}

function renderReportDetail() {
  const report = REPORTS.find(r => r.id === activeReportId);
  if (!report) return;

  const listEl = document.getElementById('reports-list-view');
  const detailEl = document.getElementById('reports-detail-view');
  listEl.style.display = 'none';
  detailEl.style.display = '';
  const catLabel = t(`reports.category.${report.category}`, {}, report.category);
  const titleLabel = t(`reports.${report.id}.title`, {}, report.title);
  const descLabel = t(`reports.${report.id}.desc`, {}, report.desc);
  document.getElementById('reports-meta').textContent = catLabel + ' / ' + titleLabel;

  destroyReportCharts();
  detailEl.innerHTML = `
    <div style="display:flex;align-items:center;margin-bottom:12px;">
      <button class="report-back" id="report-back-btn" style="margin:0;">${t('reports.detail.back', {}, '&larr; Back to Reports')}</button>
      <button id="report-pdf-btn" style="margin-left:auto;padding:6px 14px;">${t('reports.detail.btn_pdf', {}, 'Export PDF')}</button>
      <button id="report-export-btn" style="margin-left:8px;padding:6px 14px;">${t('reports.detail.btn_xlsx', {}, 'Export XLSX')}</button>
    </div>
    <div class="report-detail-title">${escapeHtml(titleLabel)}</div>
    <div class="report-detail-desc">${escapeHtml(descLabel)}</div>
    <div id="report-output"></div>
  `;

  report.render();
}

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
          <div class="ic-count">${t('reports.income.tile.reimb_subtitle', {}, 'ExampleCo, KSD pass-through')}</div>
        </div>
      </div>
      <div class="income-grid" class="mt-8">
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
          <div class="ic-count">${t('reports.income.tile.reimb_subtitle', {}, 'ExampleCo, KSD pass-through')}</div>
        </div>
      </div>
      <div class="income-grid" class="mt-8">
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
      <div class="income-grid" class="mt-8">
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

// ─── House 4C Report ─────────────────────────────────────────────────────

function renderHouse4CReport() {
  renderExpenseReport({
    filterId: 'house4c',
    filterLabel: t('reports.filter_label.house4c', {}, 'House 4C Costs'),
    filterFn: (tx) => tx.type === 'expense' && tx.tags && tx.tags.split(';').includes('House_A_costs'),
    colorMain: '#f0a060',
    showTransactions: true,
    showCategoryBreakdown: true,
    sinceDate: '2024-04-01',
  });
}

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
          <div class="ic-value" class="c-neg">${formatCurrency(grandTotal, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${escapeHtml(activeMonthsLabel)}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.shared.avg_per_month', {}, 'Avg / Month')}</div>
          <div class="ic-value" class="c-neg">${formatCurrency(avgPerMonth, currency)}<span class="ic-cur">${currency}</span></div>
        </div>
        ${catTotals.map(c => `
          <div class="income-cell">
            <div class="ic-label">${escapeHtml(c.label)}</div>
            <div class="ic-value ${c.total === 0 ? 'zero' : ''}" style="color:${c.total > 0 ? c.color : 'var(--muted)'}">${formatCurrency(c.total, currency)}<span class="ic-cur">${currency}</span></div>
          </div>
        `).join('')}
      </div>
      <div class="income-grid" class="mt-8">
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
          <div class="ic-value" class="c-neg">${formatCurrency(grandTotal, currency)}<span class="ic-cur">${currency}</span></div>
        </div>
        ${catTotals.map(c => `
          <div class="income-cell">
            <div class="ic-label">${escapeHtml(c.label)}</div>
            <div class="ic-value ${c.total === 0 ? 'zero' : ''}" style="color:${c.total > 0 ? c.color : 'var(--muted)'}">${formatCurrency(c.total, currency)}<span class="ic-cur">${currency}</span></div>
          </div>
        `).join('')}
      </div>
      <div class="income-grid" class="mt-8">
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

// ─── AI Costs Report ─────────────────────────────────────────────────────

function renderAICostsReport() {
  renderExpenseReport({
    filterId: 'ai',
    filterLabel: t('reports.filter_label.ai', {}, 'AI Subscriptions'),
    filterFn: (tx) => tx.type === 'expense' && tx.category && tx.category.startsWith('Subscriptions:AI'),
    colorMain: '#1e40af',
    showTransactions: true,
  });
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
            <div class="ic-value" style="color:var(--muted)">${formatCurrency(purchaseTotal, 'TZS')}<span class="ic-cur">TZS</span></div>
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
        <div class="table-scroll-wrapper"><table class="tx-table" style="white-space:nowrap;">
          <thead><tr>
            <th>${t('common.label.month', {}, 'Month')}</th>
            ${catTotals.map(c => `<th style="text-align:right;">${escapeHtml(c.label)}</th>`).join('')}
            <th style="text-align:right;font-weight:700;">${t('reports.shared.total_label', {}, 'Total')}</th>
          </tr></thead>
          <tbody>
            ${months.map(m => `<tr>
              <td>${m.label}</td>
              ${catTotals.map(c => `<td class="amt" style="color:${CAT_COLORS[c.cat]}">${formatCurrency(m[c.cat] || 0, 'TZS')}</td>`).join('')}
              <td class="amt" style="font-weight:700;">${formatCurrency(m.total, 'TZS')}</td>
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
        <div class="table-scroll-wrapper"><table class="tx-table" style="white-space:nowrap;">
          <thead><tr>
            <th>${t('reports.toolbar.year', {}, 'Year')}</th>
            ${activeCats.map(cat => `<th style="text-align:right;">${escapeHtml(CAT_SHORT[cat])}</th>`).join('')}
            <th style="text-align:right;">${t('reports.auto.col_running', {}, 'Running')}</th>
            <th style="text-align:right;">${t('reports.auto.purchase', {}, 'Purchase')}</th>
            <th style="text-align:right;font-weight:700;">${t('reports.shared.total_label', {}, 'Total')}</th>
          </tr></thead>
          <tbody>
            ${data.map(d => `<tr>
              <td style="font-weight:500;">${d.year}</td>
              ${activeCats.map(cat => `<td class="amt" style="color:${CAT_COLORS[cat]}">${formatCurrency(d.byCat[cat] || 0, 'TZS')}</td>`).join('')}
              <td class="amt">${formatCurrency(d.running, 'TZS')}</td>
              <td class="amt" style="color:var(--muted)">${formatCurrency(d.purchase, 'TZS')}</td>
              <td class="amt" style="font-weight:700;">${formatCurrency(d.total, 'TZS')}</td>
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

    // Filter: Food:Dining out expenses (all currencies, convert to TZS)
    const custodyAliases = getCustodyAliases();
    const diningTx = state.tx.filter(tx =>
      tx.type === 'expense' && tx.category === 'Food:Dining out' && !custodyAliases.has(tx.account)
    );

    if (modeEl.value === 'monthly') renderDiningMonthly(diningTx, yearEl.value);
    else renderDiningYearly(diningTx);
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  update();
}

function classifyDining(tx) {
  // ExampleCo = paid via kft/kfu/kfc or tagged BUSINESS_ExampleCo
  const tags = (tx.tags || '').split(';');
  if (['kft', 'kfu', 'kfc'].includes(tx.account) || tags.includes('BUSINESS_ExampleCo')) return 'exampleco';
  return 'private';
}

function renderDiningMonthly(diningTx, year) {
  const colorPrivate = '#1e40af';
  const colorExampleCo = '#f59e0b';
  const englishMonthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const names = englishMonthShort.map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
  const unknownLabel = t('reports.shared.unknown', {}, '(unknown)');
  const labelPrivate = t('reports.dining.cls_private', {}, 'Private');
  const labelExampleCo = t('reports.dining.cls_exampleco', {}, 'ExampleCo');

  const months = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    let priv = 0, kaff = 0, privCount = 0, kaffCount = 0;
    const byRestaurant = {};
    for (const tx of diningTx) {
      if (!tx.date || !tx.date.startsWith(ym)) continue;
      const amt = convertToTZS(tx.amount, tx.currency);
      const cls = classifyDining(tx);
      if (cls === 'exampleco') { kaff += amt; kaffCount++; }
      else { priv += amt; privCount++; }
      const r = tx.payee || unknownLabel;
      if (!byRestaurant[r]) byRestaurant[r] = { priv: 0, kaff: 0 };
      if (cls === 'exampleco') byRestaurant[r].kaff += amt;
      else byRestaurant[r].priv += amt;
    }
    months.push({ ym, label: monthLabel(ym), priv, kaff, total: priv + kaff, privCount, kaffCount, count: privCount + kaffCount, byRestaurant });
  }

  const totPriv = months.reduce((s, m) => s + m.priv, 0);
  const totKaff = months.reduce((s, m) => s + m.kaff, 0);
  const totAll = totPriv + totKaff;
  const totCount = months.reduce((s, m) => s + m.count, 0);
  const activeMonths = months.filter(m => m.total > 0).length;
  const avgPerMonth = activeMonths > 0 ? totAll / activeMonths : 0;

  // Top restaurants across year
  const allRestaurants = {};
  for (const m of months) {
    for (const [r, v] of Object.entries(m.byRestaurant)) {
      if (!allRestaurants[r]) allRestaurants[r] = { priv: 0, kaff: 0 };
      allRestaurants[r].priv += v.priv;
      allRestaurants[r].kaff += v.kaff;
    }
  }
  const topRestaurants = Object.entries(allRestaurants)
    .map(([name, v]) => ({ name, priv: v.priv, kaff: v.kaff, total: v.priv + v.kaff }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const totPrivCount = months.reduce((s, m) => s + m.privCount, 0);
  const totKaffCount = months.reduce((s, m) => s + m.kaffCount, 0);
  const content = document.getElementById('dn-content');
  content.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${escapeHtml(t('reports.dining.title_monthly', { year }, `Dining Out ${year} (all amounts in TZS)`))}</div>
      <div class="income-grid">
        <div class="income-cell">
          <div class="ic-label">${t('reports.shared.total_label', {}, 'Total')}</div>
          <div class="ic-value" class="c-text">${formatCurrency(totAll, 'TZS')}<span class="ic-cur">TZS</span></div>
          <div class="ic-count">${escapeHtml(t('reports.dining.visits_avg', { n: totCount, amount: formatCurrency(avgPerMonth, 'TZS') }, `${totCount} visits · avg ${formatCurrency(avgPerMonth, 'TZS')} / month`))}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label" style="color:${colorPrivate}">${t('reports.dining.tile_private_label', {}, '&#9632; Private')}</div>
          <div class="ic-value" style="color:${colorPrivate}">${formatCurrency(totPriv, 'TZS')}<span class="ic-cur">TZS</span></div>
          <div class="ic-count">${escapeHtml(t('reports.dining.tile_tx_pct', { n: totPrivCount, pct: totAll > 0 ? Math.round(totPriv / totAll * 100) : 0 }, `${totPrivCount} TX · ${totAll > 0 ? Math.round(totPriv / totAll * 100) : 0}%`))}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label" style="color:${colorExampleCo}">${t('reports.dining.tile_exampleco_label', {}, '&#9632; ExampleCo')}</div>
          <div class="ic-value" style="color:${colorExampleCo}">${formatCurrency(totKaff, 'TZS')}<span class="ic-cur">TZS</span></div>
          <div class="ic-count">${escapeHtml(t('reports.dining.tile_tx_pct', { n: totKaffCount, pct: totAll > 0 ? Math.round(totKaff / totAll * 100) : 0 }, `${totKaffCount} TX · ${totAll > 0 ? Math.round(totKaff / totAll * 100) : 0}%`))}</div>
        </div>
      </div>
      <div class="income-grid" class="mt-8">
        ${months.map(m => {
          const visitsLabel = t('reports.dining.monthly_tile_count', { n: m.count }, `${m.count} visits`);
          const kaffPctLabel = m.kaff > 0
            ? ` · <span style="color:${colorExampleCo}">${t('reports.dining.monthly_tile_exampleco_pct', { pct: Math.round(m.kaff / m.total * 100) }, `${Math.round(m.kaff / m.total * 100)}% ExampleCo`)}</span>`
            : '';
          return `
          <div class="income-cell">
            <div class="ic-label">${m.label}</div>
            <div class="ic-value ${m.total === 0 ? 'zero' : ''}">${formatCurrency(m.total, 'TZS')}<span class="ic-cur">TZS</span></div>
            <div class="ic-count">${escapeHtml(visitsLabel)}${kaffPctLabel}</div>
          </div>
        `;
        }).join('')}
      </div>
    </div>
    <div class="report-section">
      <div class="chart-wrap" class="mb-16">
        <div class="report-section-title">${t('reports.dining.chart_monthly_split', {}, 'Monthly — Private vs. ExampleCo')}</div>
        <div class="chart-canvas-box"><canvas id="dn-stacked-chart"></canvas></div>
      </div>
      <div class="chart-wrap">
        <div class="report-section-title">${t('reports.dining.chart_top_restaurants', {}, 'Top Restaurants — Private vs. ExampleCo')}</div>
        <div class="chart-canvas-box" style="height:${Math.max(280, topRestaurants.length * 36 + 60)}px;"><canvas id="dn-restaurant-chart"></canvas></div>
      </div>
    </div>
    <div class="report-section">
      <div class="chart-wrap">
        <div class="report-section-title">${t('reports.dining.chart_pie', {}, 'Private vs. ExampleCo Split')}</div>
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
            <td><span style="color:${cls === 'exampleco' ? colorExampleCo : colorPrivate};font-size:11px;font-weight:500">${escapeHtml(cls === 'exampleco' ? labelExampleCo : labelPrivate)}</span></td>
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
          { label: labelPrivate, data: months.map(m => m.priv), backgroundColor: colorPrivate, borderWidth: 0, borderRadius: 3 },
          { label: labelExampleCo, data: months.map(m => m.kaff), backgroundColor: colorExampleCo, borderWidth: 0, borderRadius: 3 },
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

  // Top restaurants horizontal bar (stacked private/exampleco)
  const restCtx = document.getElementById('dn-restaurant-chart');
  if (restCtx && topRestaurants.length > 0) {
    const chart = new Chart(restCtx, {
      type: 'bar',
      data: {
        labels: topRestaurants.map(r => r.name.length > 18 ? r.name.slice(0, 17) + '…' : r.name),
        datasets: [
          { label: labelPrivate, data: topRestaurants.map(r => r.priv), backgroundColor: colorPrivate, borderWidth: 0, borderRadius: 3 },
          { label: labelExampleCo, data: topRestaurants.map(r => r.kaff), backgroundColor: colorExampleCo, borderWidth: 0, borderRadius: 3 },
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
        labels: [labelPrivate, labelExampleCo],
        datasets: [{ data: [totPriv, totKaff], backgroundColor: [colorPrivate, colorExampleCo], borderWidth: 2, borderColor: '#fff' }],
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
  const colorPrivate = '#1e40af';
  const colorExampleCo = '#f59e0b';
  const labelPrivate = t('reports.dining.cls_private', {}, 'Private');
  const labelExampleCo = t('reports.dining.cls_exampleco', {}, 'ExampleCo');
  const years = getAvailableYears();

  const yearData = years.map(y => {
    let priv = 0, kaff = 0, privCount = 0, kaffCount = 0;
    for (const tx of diningTx) {
      if (!tx.date || !tx.date.startsWith(y)) continue;
      const amt = convertToTZS(tx.amount, tx.currency);
      if (classifyDining(tx) === 'exampleco') { kaff += amt; kaffCount++; }
      else { priv += amt; privCount++; }
    }
    return { year: y, priv, kaff, total: priv + kaff, privCount, kaffCount, count: privCount + kaffCount };
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
              { n: d.count, privPct: Math.round(d.total > 0 ? d.priv / d.total * 100 : 0), kaffPct: Math.round(d.total > 0 ? d.kaff / d.total * 100 : 0), privColor: colorPrivate, kaffColor: colorExampleCo },
              `${d.count} visits · <span style="color:${colorPrivate}">${Math.round(d.total > 0 ? d.priv / d.total * 100 : 0)}% priv</span> · <span style="color:${colorExampleCo}">${Math.round(d.total > 0 ? d.kaff / d.total * 100 : 0)}% ExampleCo</span>`)}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="report-section">
      <div class="chart-wrap">
        <div class="report-section-title">${t('reports.dining.chart_yearly_split', {}, 'Yearly — Private vs. ExampleCo')}</div>
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
          { label: labelPrivate, data: yearData.map(d => d.priv), backgroundColor: colorPrivate, borderWidth: 0, borderRadius: 4 },
          { label: labelExampleCo, data: yearData.map(d => d.kaff), backgroundColor: colorExampleCo, borderWidth: 0, borderRadius: 4 },
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
          <div class="ic-value" class="c-pos">${formatCurrency(totInc, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.incexp.tile.avg_per_month', { amount: formatCurrency(avgInc, currency) }, `Avg ${formatCurrency(avgInc, currency)} / month`)}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.incexp.tile.total_expenses', {}, 'Total Expenses')}</div>
          <div class="ic-value" class="c-neg">${formatCurrency(totExp, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.incexp.tile.avg_per_month', { amount: formatCurrency(avgExp, currency) }, `Avg ${formatCurrency(avgExp, currency)} / month`)}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.incexp.tile.net_balance', {}, 'Net Balance')}</div>
          <div class="ic-value" style="color:${totNet >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(totNet, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.incexp.net.detail', { verdict: netVerdict, pct: savingsPct }, `${netVerdict} · Savings rate ${savingsPct}%`)}</div>
        </div>
      </div>
      <div class="income-grid" class="mt-8">
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
          <div class="ic-value" class="c-pos">${formatCurrency(totInc, currency)}<span class="ic-cur">${currency}</span></div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.incexp.tile.all_expenses', {}, 'All-time Expenses')}</div>
          <div class="ic-value" class="c-neg">${formatCurrency(totExp, currency)}<span class="ic-cur">${currency}</span></div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('reports.incexp.tile.all_net', {}, 'All-time Net')}</div>
          <div class="ic-value" style="color:${totNet >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(totNet, currency)}<span class="ic-cur">${currency}</span></div>
          <div class="ic-count">${t('reports.incexp.net.detail', { verdict: netVerdict, pct: savingsPct }, `${netVerdict} · Savings rate ${savingsPct}%`)}</div>
        </div>
      </div>
      <div class="income-grid" class="mt-8">
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
            <div class="ic-value" class="c-neg">${formatCurrency(grandTotal, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.tp.tile.total_detail', { n: expenses.length, payees: sorted.length }, `${expenses.length} TX to ${sorted.length} payees`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.tp.tile.top1', {}, '#1 Payee')}</div>
            <div class="ic-value" class="c-text">${escapeHtml(top20[0]?.name || '—')}</div>
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

function exportExampleCoAccounting(year) {
  const examplecoAccounts = ['kft', 'kfu'];
  const expenses = state.tx.filter(t =>
    (t.type === 'expense' || t.type === 'transfer') && examplecoAccounts.includes(t.account) && t.date && t.date.startsWith(year)
  ).sort((a, b) => a.date.localeCompare(b.date));

  const detail = expenses.map(t => ({
    Date: t.date,
    Account: t.account,
    Payee: t.payee || '',
    Category: t.category || '',
    Amount: t.amount,
    Currency: t.currency,
    'Amount TZS': convertToTZS(t.amount, t.currency),
    Note: t.note || '',
    Tags: t.tags || '',
  }));

  // Monthly summary
  const months = {};
  for (const t of expenses) {
    const ym = t.date.slice(0, 7);
    if (!months[ym]) months[ym] = { Month: ym, Expenses: 0, TX_Count: 0 };
    months[ym].Expenses += convertToTZS(t.amount, t.currency);
    months[ym].TX_Count++;
  }
  const summary = Object.values(months).sort((a, b) => a.Month.localeCompare(b.Month));
  summary.push({
    Month: 'TOTAL',
    Expenses: summary.reduce((s, m) => s + m.Expenses, 0),
    TX_Count: summary.reduce((s, m) => s + m.TX_Count, 0),
  });

  // Category breakdown
  const cats = {};
  for (const t of expenses) {
    const c = t.category || '(other)';
    cats[c] = (cats[c] || 0) + convertToTZS(t.amount, t.currency);
  }
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ Category: c, 'Amount TZS': v }));

  if (typeof XLSX === 'undefined') { alert(t('reports.export.err_no_xlsx', {}, 'XLSX library not loaded')); return; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Monthly Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catRows), 'By Category');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'All Transactions');
  XLSX.writeFile(wb, `ExampleCo_Business_${year}.xlsx`);
}

// ─── ExampleCo Reimbursements Report ─────────────────────────────────────────

function renderExampleCoReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const savedYear = out.getAttribute('data-kf-year') || years[years.length - 1] || '2026';
  const savedMode = out.getAttribute('data-kf-mode') || 'monthly';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.mode', {}, 'Mode')}</label>
        <select id="kf-mode">
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.toolbar.monthly', {}, 'Monthly')}</option>
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.toolbar.yearly', {}, 'Yearly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="kf-year">${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
      </div>
      <div id="kf-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('kf-mode');
  const yearEl = document.getElementById('kf-year');

  function update() {
    out.setAttribute('data-kf-mode', modeEl.value);
    out.setAttribute('data-kf-year', yearEl.value);
    yearEl.style.display = modeEl.value === 'yearly' ? 'none' : '';
    destroyReportCharts();

    const year = yearEl.value;
    const examplecoAccounts = ['kft', 'kfu'];

    // Expenses on ExampleCo accounts (the actual spending)
    const kafExpenses = state.tx.filter(tx => (tx.type === 'expense' || tx.type === 'transfer') && examplecoAccounts.includes(tx.account));
    // Reimbursements (income on exampleco accounts)
    const kafReimb = state.tx.filter(tx => tx.type === 'income' && examplecoAccounts.includes(tx.account));

    if (modeEl.value === 'monthly') {
      const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        .map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
      const otherLabel = t('reports.shared.other', {}, '(other)');
      const months = [];
      for (let m = 1; m <= 12; m++) {
        const ym = `${year}-${String(m).padStart(2, '0')}`;
        let exp = 0, reimb = 0, expCount = 0;
        const byCat = {};
        for (const tx of kafExpenses) {
          if (!tx.date || !tx.date.startsWith(ym)) continue;
          const amt = convertToTZS(tx.amount, tx.currency);
          exp += amt; expCount++;
          const cat = tx.category || otherLabel;
          byCat[cat] = (byCat[cat] || 0) + amt;
        }
        for (const tx of kafReimb) {
          if (!tx.date || !tx.date.startsWith(ym)) continue;
          reimb += convertToTZS(tx.amount, tx.currency);
        }
        months.push({ ym, label: monthLabel(ym), exp, reimb, net: reimb - exp, expCount, byCat });
      }

      const totExp = months.reduce((s, m) => s + m.exp, 0);
      const totReimb = months.reduce((s, m) => s + m.reimb, 0);
      const totNet = totReimb - totExp;

      // Top categories across year
      const allCats = {};
      for (const m of months) for (const [c, v] of Object.entries(m.byCat)) allCats[c] = (allCats[c] || 0) + v;
      const topCats = Object.entries(allCats).sort((a, b) => b[1] - a[1]).slice(0, 10);

      const balanceDetail = totNet >= 0
        ? t('reports.kf.tile.fully_reimbursed', {}, 'Fully reimbursed')
        : t('reports.kf.tile.outstanding', { amount: formatCurrency(Math.abs(totNet), 'TZS') }, `Outstanding: ${formatCurrency(Math.abs(totNet), 'TZS')}`);
      const totCount = months.reduce((s, m) => s + m.expCount, 0);

      const content = document.getElementById('kf-content');
      content.innerHTML = `
        <div class="report-section">
          <div class="report-section-title">${t('reports.kf.monthly.title', { year }, `ExampleCo Pass-Through ${year} (all amounts in TZS)`)}</div>
          <div class="income-grid">
            <div class="income-cell">
              <div class="ic-label">${t('reports.incexp.tile.total_expenses', {}, 'Total Expenses')}</div>
              <div class="ic-value" class="c-neg">${formatCurrency(totExp, 'TZS')}<span class="ic-cur">TZS</span></div>
              <div class="ic-count">${t('reports.shared.tx_count', { n: totCount }, `${totCount} TX`)}</div>
            </div>
            <div class="income-cell">
              <div class="ic-label">${t('reports.kf.tile.total_reimbursed', {}, 'Total Reimbursed')}</div>
              <div class="ic-value" class="c-pos">${formatCurrency(totReimb, 'TZS')}<span class="ic-cur">TZS</span></div>
            </div>
            <div class="income-cell">
              <div class="ic-label">${t('reports.kf.tile.balance', {}, 'Balance')}</div>
              <div class="ic-value" style="color:${totNet >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(totNet, 'TZS')}<span class="ic-cur">TZS</span></div>
              <div class="ic-count">${balanceDetail}</div>
            </div>
          </div>
        </div>
        <div class="report-section">
          <div class="chart-row">
            <div class="chart-wrap">
              <div class="report-section-title">${t('reports.kf.chart.monthly', {}, 'Monthly Expenses vs. Reimbursements')}</div>
              <div class="chart-canvas-box"><canvas id="kf-monthly-chart"></canvas></div>
            </div>
            <div class="chart-wrap">
              <div class="report-section-title">${t('reports.kf.chart.cats', {}, 'Expense Categories')}</div>
              <div class="chart-canvas-box" style="height:${Math.max(260, topCats.length * 28 + 60)}px;"><canvas id="kf-cat-chart"></canvas></div>
            </div>
          </div>
        </div>
        <div class="report-section">
          <div class="report-section-title">${t('reports.kf.section.monthly_detail', {}, 'Monthly Detail')}</div>
          <table class="tx-table"><thead><tr>
            <th>${t('common.label.month', {}, 'Month')}</th>
            <th class="amt">${t('common.label.expenses', {}, 'Expenses')}</th>
            <th class="amt">${t('reports.kf.col.reimbursed', {}, 'Reimbursed')}</th>
            <th class="amt">${t('common.label.net', {}, 'Net')}</th>
            <th>${t('reports.wd.col.tx', {}, 'TX')}</th>
            <th></th>
          </tr></thead><tbody>
            ${months.filter(m => m.exp > 0 || m.reimb > 0).map(m => {
              const hasGap = Math.abs(m.net) > 1;
              return `<tr style="${hasGap ? 'background:var(--warning-bg, rgba(245,158,11,0.08));' : ''}">
              <td>${m.label}</td>
              <td class="amt expense">${formatCurrency(m.exp, 'TZS')}</td>
              <td class="amt income">${formatCurrency(m.reimb, 'TZS')}</td>
              <td class="amt" style="color:${m.net >= 0 ? 'var(--positive)' : 'var(--negative)'}; font-weight:${hasGap ? '700' : '400'}">${formatCurrency(m.net, 'TZS')}</td>
              <td>${m.expCount}</td>
              <td>${hasGap ? `<button class="kf-drill-btn" data-ym="${m.ym}" style="font-size:11px;padding:2px 8px;cursor:pointer;">${t('reports.kf.detail_btn', {}, 'Details')}</button>` : ''}</td>
            </tr>`;
            }).join('')}
          </tbody></table>
          <div id="kf-drill-detail"></div>
        </div>
        <div class="report-section">
          <div style="display:flex;align-items:center;margin-bottom:12px;">
            <div class="report-section-title" style="margin:0;">${t('reports.kf.section.tx_detail', {}, 'Transaction Detail')}</div>
            <button onclick="exportExampleCoAccounting('${year}')" style="margin-left:auto;padding:6px 14px;">${t('reports.kf.export_btn', {}, 'Export for Accounting')}</button>
          </div>
          <table class="tx-table" id="kf-tx-detail"><thead><tr>
            <th>${t('common.label.date', {}, 'Date')}</th>
            <th>${t('common.col.account', {}, 'Account')}</th>
            <th>${t('common.col.payee', {}, 'Payee')}</th>
            <th>${t('common.col.category', {}, 'Category')}</th>
            <th class="amt">${t('common.col.amount', {}, 'Amount')}</th>
            <th>${t('common.col.currency', {}, 'Currency')}</th>
            <th>${t('common.label.note', {}, 'Note')}</th>
          </tr></thead><tbody>
            ${kafExpenses.filter(tx => tx.date && tx.date.startsWith(year)).sort((a, b) => a.date.localeCompare(b.date)).map(tx => `<tr>
              <td>${fmtDate(tx.date)}</td>
              <td>${tx.account}</td>
              <td>${escapeHtml(tx.payee || '')}</td>
              <td class="cat">${escapeHtml(tx.category || '')}</td>
              <td class="amt expense">${formatCurrency(tx.amount, tx.currency)}</td>
              <td class="hint-sm">${tx.currency}</td>
              <td class="hint-sm">${escapeHtml(tx.note || '')}</td>
            </tr>`).join('')}
          </tbody></table>
        </div>
      `;

      // Monthly chart
      const mCtx = document.getElementById('kf-monthly-chart');
      if (mCtx) {
        const chart = new Chart(mCtx, {
          type: 'bar',
          data: {
            labels: names,
            datasets: [
              { label: t('common.label.expenses', {}, 'Expenses'), data: months.map(m => m.exp), backgroundColor: '#e8453c', borderWidth: 0, borderRadius: 3 },
              { label: t('reports.kf.dataset.reimbursed', {}, 'Reimbursed'), data: months.map(m => m.reimb), backgroundColor: '#10b981', borderWidth: 0, borderRadius: 3 },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } } },
              tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, 'TZS') + ' TZS' } } },
            scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: cssVar('--chart-grid') } } } },
        });
        reportCharts.push(chart);
      }

      // Category chart
      const cCtx = document.getElementById('kf-cat-chart');
      if (cCtx && topCats.length > 0) {
        const palette = ['#1e40af', '#e8453c', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];
        const chart = new Chart(cCtx, {
          type: 'bar',
          data: {
            labels: topCats.map(([c]) => c.length > 22 ? c.slice(0, 21) + '…' : c),
            datasets: [{ data: topCats.map(([, v]) => v), backgroundColor: palette.slice(0, topCats.length), borderWidth: 0, borderRadius: 3 }],
          },
          options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, 'TZS') + ' TZS' } } },
            scales: { x: { ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: cssVar('--chart-grid') } }, y: { grid: { display: false }, ticks: { font: { size: 11 }, autoSkip: false } } } },
        });
        reportCharts.push(chart);
      }

      // Drill-down: show unmatched TX for months with net ≠ 0
      document.querySelectorAll('.kf-drill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const ym = btn.getAttribute('data-ym');
          const mExp = kafExpenses.filter(tx => tx.date && tx.date.startsWith(ym));
          const mRei = kafReimb.filter(tx => tx.date && tx.date.startsWith(ym));

          // Match by amount: pair expense with reimbursement of same amount on same account
          const usedRei = new Set();
          const matched = [];
          const unmatchedExp = [];
          for (const e of mExp) {
            const eAmt = convertToTZS(e.amount, e.currency);
            let found = false;
            for (let i = 0; i < mRei.length; i++) {
              if (usedRei.has(i)) continue;
              const rAmt = convertToTZS(mRei[i].amount, mRei[i].currency);
              if (Math.abs(eAmt - rAmt) < 1 && e.account === mRei[i].account) {
                matched.push({ exp: e, rei: mRei[i] });
                usedRei.add(i);
                found = true;
                break;
              }
            }
            if (!found) unmatchedExp.push(e);
          }
          const unmatchedRei = mRei.filter((_, i) => !usedRei.has(i));

          const txTableHead = `<th>${t('common.label.date', {}, 'Date')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('common.col.payee', {}, 'Payee')}</th><th>${t('common.col.category', {}, 'Category')}</th><th class="amt">${t('common.col.amount', {}, 'Amount')}</th><th>${t('common.label.note', {}, 'Note')}</th>`;
          const detail = document.getElementById('kf-drill-detail');
          detail.innerHTML = `
            <div class="report-section" style="margin-top:16px;">
              <div class="report-section-title">${t('reports.kf.unmatched_title', { month: monthLabel(ym) }, `Unmatched TX — ${monthLabel(ym)}`)}</div>
              ${unmatchedExp.length ? `<div style="margin-bottom:8px;font-weight:500;color:var(--negative);">${t('reports.kf.unmatched.exp_without', { n: unmatchedExp.length }, `Expenses without Reimbursement (${unmatchedExp.length})`)}</div>
              <table class="tx-table"><thead><tr>${txTableHead}</tr></thead><tbody>
                ${unmatchedExp.map(tx => `<tr>
                  <td>${fmtDate(tx.date)}</td><td>${tx.account}</td><td>${escapeHtml(tx.payee||'')}</td>
                  <td class="cat">${escapeHtml(tx.category||'')}</td><td class="amt expense">${formatCurrency(tx.amount, tx.currency)} ${tx.currency}</td>
                  <td class="hint-sm">${escapeHtml(tx.note||'')}</td>
                </tr>`).join('')}
              </tbody></table>` : ''}
              ${unmatchedRei.length ? `<div style="margin:12px 0 8px;font-weight:500;color:var(--positive);">${t('reports.kf.unmatched.rei_without', { n: unmatchedRei.length }, `Reimbursements without Expense (${unmatchedRei.length})`)}</div>
              <table class="tx-table"><thead><tr>${txTableHead}</tr></thead><tbody>
                ${unmatchedRei.map(tx => `<tr>
                  <td>${fmtDate(tx.date)}</td><td>${tx.account}</td><td>${escapeHtml(tx.payee||'')}</td>
                  <td class="cat">${escapeHtml(tx.category||'')}</td><td class="amt income">${formatCurrency(tx.amount, tx.currency)} ${tx.currency}</td>
                  <td class="hint-sm">${escapeHtml(tx.note||'')}</td>
                </tr>`).join('')}
              </tbody></table>` : ''}
              ${!unmatchedExp.length && !unmatchedRei.length ? `<p>${t('reports.kf.unmatched.all_matched', {}, 'All TX matched.')}</p>` : ''}
              <div style="margin-top:8px;color:var(--muted);font-size:0.85em;">${t('reports.kf.unmatched.summary', { m: matched.length, e: unmatchedExp.length, r: unmatchedRei.length }, `Matched: ${matched.length} pairs · Unmatched: ${unmatchedExp.length} expenses, ${unmatchedRei.length} reimbursements`)}</div>
            </div>
          `;
        });
      });
    } else {
      // Yearly mode
      const yearData = years.map(y => {
        let exp = 0, reimb = 0, count = 0;
        for (const tx of kafExpenses) {
          if (!tx.date || !tx.date.startsWith(y)) continue;
          exp += convertToTZS(tx.amount, tx.currency); count++;
        }
        for (const tx of kafReimb) {
          if (!tx.date || !tx.date.startsWith(y)) continue;
          reimb += convertToTZS(tx.amount, tx.currency);
        }
        return { year: y, exp, reimb, net: reimb - exp, count };
      });

      const content = document.getElementById('kf-content');
      content.innerHTML = `
        <div class="report-section">
          <div class="report-section-title">${t('reports.kf.yearly.title', {}, 'ExampleCo Pass-Through — Yearly (TZS)')}</div>
          <div class="income-grid">
            ${yearData.map(d => `
              <div class="income-cell">
                <div class="ic-label">${d.year}</div>
                <div class="ic-value" class="c-neg">${formatCurrency(d.exp, 'TZS')}<span class="ic-cur">TZS</span></div>
                <div class="ic-count">${t('reports.kf.yearly_detail', { count: d.count, reimb: formatCurrency(d.reimb, 'TZS'), net: `<span style="color:${d.net >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(d.net, 'TZS')}</span>` }, `${d.count} TX · Reimb: ${formatCurrency(d.reimb, 'TZS')} · Net: ${formatCurrency(d.net, 'TZS')}`)}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="report-section">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.kf.chart.yearly', {}, 'Yearly Expenses vs. Reimbursements')}</div>
            <div class="chart-canvas-box"><canvas id="kf-yearly-chart"></canvas></div>
          </div>
        </div>
      `;

      const ctx = document.getElementById('kf-yearly-chart');
      if (ctx) {
        const chart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: yearData.map(d => d.year),
            datasets: [
              { label: t('common.label.expenses', {}, 'Expenses'), data: yearData.map(d => d.exp), backgroundColor: '#e8453c', borderWidth: 0, borderRadius: 4 },
              { label: t('reports.kf.dataset.reimbursed', {}, 'Reimbursed'), data: yearData.map(d => d.reimb), backgroundColor: '#10b981', borderWidth: 0, borderRadius: 4 },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 12 } } },
              tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, 'TZS') + ' TZS' } } },
            scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: cssVar('--chart-grid') } } } },
        });
        reportCharts.push(chart);
      }
    }
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  update();
}

// ─── Savings Rate Trend Report ────────────────────────────────────────────

function renderSavingsRateReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];

  const savedCur = out.getAttribute('data-sr-cur') || 'TZS';
  const savedYear = out.getAttribute('data-sr-year') || 'all';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="sr-currency">${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="sr-year">
          <option value="all" ${savedYear === 'all' ? 'selected' : ''}>${t('reports.toolbar.all_years', {}, 'All Years')}</option>
          ${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      </div>
      <div id="sr-content"></div>
    </div>
  `;

  const curEl = document.getElementById('sr-currency');
  const yearEl = document.getElementById('sr-year');

  function update() {
    out.setAttribute('data-sr-cur', curEl.value);
    out.setAttribute('data-sr-year', yearEl.value);
    destroyReportCharts();
    const currency = curEl.value;
    const yearFilter = yearEl.value;
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
            <div class="ic-value" class="c-pos">${bestMonth ? bestMonth.rate.toFixed(1) + '%' : '—'}</div>
            <div class="ic-count">${bestMonth ? bestMonth.label : ''}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.savingsRate.tile.worst', {}, 'Worst Month')}</div>
            <div class="ic-value" class="c-neg">${worstMonth ? worstMonth.rate.toFixed(1) + '%' : '—'}</div>
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
              borderColor: '#1e40af',
              backgroundColor: 'rgba(67,97,238,0.1)',
              fill: true,
              tension: 0.35,
              pointRadius: 3,
              pointHoverRadius: 6,
              borderWidth: 2.5,
            },
            {
              label: t('reports.savingsRate.dataset.zero_line', {}, '0% Line'),
              data: allMonths.map(() => 0),
              borderColor: 'rgba(0,0,0,0.15)',
              borderDash: [4, 4],
              borderWidth: 1,
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
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
            { label: t('common.label.income', {}, 'Income'), data: allMonths.map(m => m.income), backgroundColor: '#10b981', borderWidth: 0, borderRadius: 2 },
            { label: t('common.label.expenses', {}, 'Expenses'), data: allMonths.map(m => m.expense), backgroundColor: '#e8453c', borderWidth: 0, borderRadius: 2 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, currency) + ' ' + currency } } },
          scales: { x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } }, y: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } } },
        },
      });
      reportCharts.push(chart);
    }
  }

  curEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  update();
}

// ─── Subscription Tracker Report ──────────────────────────────────────────

function renderSubscriptionReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const savedYear = out.getAttribute('data-sub-year') || years[years.length - 1] || '2026';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="sub-year">${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
      </div>
      <div id="sub-content"></div>
    </div>
  `;

  const yearEl = document.getElementById('sub-year');

  function update() {
    out.setAttribute('data-sub-year', yearEl.value);
    destroyReportCharts();
    const year = yearEl.value;

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
    const palette = ['#1e40af', '#e8453c', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];

    const content = document.getElementById('sub-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${escapeHtml(t('reports.sub.title', { year, currency: cur }, `Subscriptions ${year} — ${cur}`))}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.shared.year_total', {}, 'Year Total')}</div>
            <div class="ic-value" class="c-neg">${formatCurrency(grandTotal, cur)}<span class="ic-cur">${cur}</span></div>
            <div class="ic-count">${escapeHtml(t('reports.sub.tile_year_total_detail', { n: subTx.length, services: sorted.length }, `${subTx.length} TX across ${sorted.length} services`))}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.sub.tile_est_monthly', {}, 'Est. Monthly')}</div>
            <div class="ic-value" style="color:var(--warn)">${formatCurrency(monthlyEst, cur)}<span class="ic-cur">${cur}</span></div>
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
        data: { labels: names, datasets: [{ data: monthlyTotals, backgroundColor: '#8b5cf6', borderWidth: 0, borderRadius: 3 }] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, cur) + ' ' + cur } } },
          scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => formatCurrency(v, cur) }, grid: { color: cssVar('--chart-grid') } } } },
      });
      reportCharts.push(chart);
    }

    // Pie by type
    const pieCtx = document.getElementById('sub-pie-chart');
    if (pieCtx && catSorted.length > 0) {
      const chart = new Chart(pieCtx, {
        type: 'doughnut',
        data: { labels: catSorted.map(([c]) => c), datasets: [{ data: catSorted.map(([, v]) => v), backgroundColor: palette.slice(0, catSorted.length), borderWidth: 2, borderColor: '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '55%',
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => ctx.label + ': ' + formatCurrency(ctx.raw, cur) + ' ' + cur } } } },
      });
      reportCharts.push(chart);
    }
  }

  yearEl.addEventListener('change', update);
  update();
}

// ─── Weekday vs. Weekend Report ───────────────────────────────────────────

function renderWeekdayReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];

  const savedYear = out.getAttribute('data-wd-year') || years[years.length - 1] || '2026';
  const savedCur = out.getAttribute('data-wd-cur') || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="wd-year">${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="wd-currency">${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </div>
      <div id="wd-content"></div>
    </div>
  `;

  const yearEl = document.getElementById('wd-year');
  const curEl = document.getElementById('wd-currency');

  function update() {
    out.setAttribute('data-wd-year', yearEl.value);
    out.setAttribute('data-wd-cur', curEl.value);
    destroyReportCharts();

    const year = yearEl.value;
    const currency = curEl.value;
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

    const palette = ['#1e40af', '#e8453c', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

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
            <div class="ic-value" style="color:#f59e0b">${formatCurrency(weekendTotal, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.wd.tile.detail_of_total', { n: weekendCount, pct: weekendPct }, `${weekendCount} TX · ${weekendPct}% of total`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.wd.tile.avg_per_tx', {}, 'Avg per Transaction')}</div>
            <div class="ic-value" class="c-text">${formatCurrency(weekdayAvgPerDay, currency)}<span class="ic-cur">${wdSuffix}</span></div>
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
          ${[1,2,3,4,5,6,0].map(i => `<tr style="${i === 0 || i === 6 ? 'background:rgba(245,158,11,0.04)' : ''}">
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
            backgroundColor: orderedDays.map(i => i === 0 || i === 6 ? '#f59e0b' : '#1e40af'),
            borderWidth: 0, borderRadius: 4 }],
        },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, currency) + ' ' + currency } } },
          scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } } } },
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
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 10 } } },
            tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, currency) + ' ' + currency } } },
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } } } },
      });
      reportCharts.push(chart);
    }

    // Pie
    const pieCtx = document.getElementById('wd-pie-chart');
    if (pieCtx) {
      const chart = new Chart(pieCtx, {
        type: 'doughnut',
        data: { labels: [t('reports.wd.pie.weekday_label', {}, 'Weekday (Mon–Fri)'), t('reports.wd.pie.weekend_label', {}, 'Weekend (Sat–Sun)')], datasets: [{ data: [weekdayTotal, weekendTotal], backgroundColor: ['#1e40af', '#f59e0b'], borderWidth: 2, borderColor: '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '58%',
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 12 } } },
            tooltip: { callbacks: { label: ctx => ctx.label + ': ' + formatCurrency(ctx.raw, currency) + ' ' + currency + ' (' + (ctx.raw / totalExpenses * 100).toFixed(1) + '%)' } } } },
      });
      reportCharts.push(chart);
    }
  }

  yearEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

// ─── Recurring Expense Tracker (E2) ─────────────────────────────────────

function renderRecurringReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const savedYear = out.getAttribute('data-rec-year') || years[years.length - 1] || '2026';
  const savedMinMonths = out.getAttribute('data-rec-min') || '2';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="rec-year">${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <label>${t('reports.rec.label_min_months', {}, 'Min. Months')}</label>
        <select id="rec-min-months">
          ${[2, 3, 4, 6].map(n => `<option value="${n}" ${String(n) === savedMinMonths ? 'selected' : ''}>${t('reports.rec.opt_min_months', { n }, `${n}+`)}</option>`).join('')}
        </select>
      </div>
      <div id="rec-content"></div>
    </div>
  `;

  const yearEl = document.getElementById('rec-year');
  const minEl = document.getElementById('rec-min-months');

  function update() {
    out.setAttribute('data-rec-year', yearEl.value);
    out.setAttribute('data-rec-min', minEl.value);
    destroyReportCharts();
    const year = yearEl.value;
    const minMonths = parseInt(minEl.value) || 2;
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
            <div class="ic-value" style="color:var(--negative);">${increased}</div>
            <div class="ic-count">${t('reports.rec.vs_previous_month', {}, 'vs. previous month')}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.rec.tile_price_decreases', {}, 'Price Decreases')}</div>
            <div class="ic-value" style="color:var(--positive);">${decreased}</div>
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
                  else if (prevVal != null && val < prevVal * 0.95) cls = ' style="color:var(--positive);"';
                  return `<td class="amt"${cls}>${formatCurrency(val, cur)}</td>`;
                }).join('')}
                <td class="amt">${formatCurrency(p.avg, cur)}</td>
                <td class="amt"><strong>${formatCurrency(p.total, cur)}</strong></td>
                <td>${p.trend === 'up' ? `<span style="color:var(--negative);font-weight:600;">▲ +${p.changePercent.toFixed(0)}%</span>` : p.trend === 'down' ? `<span style="color:var(--positive);">▼ ${p.changePercent.toFixed(0)}%</span>` : '<span class="c-mut">—</span>'}</td>
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
    const palette = ['#1e40af', '#e8453c', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
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
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, cur) + ' ' + cur } },
          },
          scales: {
            x: { grid: { display: false } },
            y: { ticks: { callback: v => formatCurrency(v, cur) }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  yearEl.addEventListener('change', update);
  minEl.addEventListener('change', update);
  update();
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
  const savedMode = out.getAttribute('data-cd-mode') || 'monthly';
  const savedYear = out.getAttribute('data-cd-year') || years[years.length - 1] || '2026';
  const savedCur = out.getAttribute('data-cd-cur') || 'TZS';
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.mode', {}, 'Mode')}</label>
        <select id="cd-mode">
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.toolbar.monthly', {}, 'Monthly')}</option>
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.toolbar.yearly', {}, 'Yearly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="cd-year">
          ${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="cd-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="cd-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('cd-mode');
  const yearEl = document.getElementById('cd-year');
  const curEl = document.getElementById('cd-currency');

  function update() {
    out.setAttribute('data-cd-mode', modeEl.value);
    out.setAttribute('data-cd-year', yearEl.value);
    out.setAttribute('data-cd-cur', curEl.value);
    yearEl.style.display = modeEl.value === 'yearly' ? 'none' : '';
    destroyReportCharts();
    const currency = curEl.value;
    const custodyAliases = getCustodyAliases();
    const expenses = state.tx.filter(tx => tx.type === 'expense' && !custodyAliases.has(tx.account)).map(tx => ({
      ...tx, amount: convertTo(tx.amount, tx.currency, currency),
      method: acctMethod[tx.account] || 'Other',
    }));

    if (modeEl.value === 'monthly') renderCDMonthly(expenses, yearEl.value, currency);
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
            <div class="ic-value" style="color:#f59e0b">${formatCurrency(totCash, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.cd.tile.pct_of_total', { pct: cashPctYear }, `${cashPctYear}% of total`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.cd.tile.digital', {}, 'Digital Spending')}</div>
            <div class="ic-value" style="color:#3b82f6">${formatCurrency(totDigital, currency)}<span class="ic-cur">${currency}</span></div>
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
              <div class="ic-count" style="font-size:10px;">${t('reports.cd.month_detail', { pct: m.cashPct.toFixed(0), cash: formatCurrency(m.cash, currency), digital: formatCurrency(m.digital, currency) }, `Cash ${m.cashPct.toFixed(0)}% · ${formatCurrency(m.cash, currency)} / ${formatCurrency(m.digital, currency)}`)}</div>
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
            { label: t('reports.cd.dataset.cash', {}, 'Cash'), data: months.map(m => m.cash), backgroundColor: '#f59e0b', borderWidth: 0 },
            { label: t('reports.cd.dataset.digital', {}, 'Digital'), data: months.map(m => m.digital), backgroundColor: '#3b82f6', borderWidth: 0 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
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
            borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)',
            fill: true, tension: 0.3, pointRadius: 4,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
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
            { label: t('reports.cd.dataset.cash', {}, 'Cash'), data: data.map(d => d.cash), backgroundColor: '#f59e0b', borderWidth: 0 },
            { label: t('reports.cd.dataset.digital', {}, 'Digital'), data: data.map(d => d.digital), backgroundColor: '#3b82f6', borderWidth: 0 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

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

  // Build running balances per currency per month-end (same logic as Account Balances report)
  const monthlyByCur = {};
  for (const c of currencies) monthlyByCur[c] = [];

  for (const mk of monthKeys) {
    const endOfMonth = mk + '-31';
    const curBal = {};
    for (const c of currencies) curBal[c] = 0;

    for (const a of selfAccounts) {
      const ibDate = a.initial_balance_date || '2000-01-01';
      if (endOfMonth < ibDate) continue;
      let bal = a.initial_balance || 0;
      for (const tx of state.tx) {
        if (!tx.date || tx.date > endOfMonth) continue;
        if (tx.date < ibDate) continue;
        if (tx.account === a.alias) {
          if (tx.type === 'income') bal += tx.amount;
          else if (tx.type === 'expense') bal -= tx.amount;
          else if (tx.type === 'transfer') bal -= tx.amount;
        }
        if (tx.type === 'transfer' && tx.transfer_to_account === a.alias) {
          bal += tx.transfer_to_amount > 0 ? tx.transfer_to_amount : tx.amount;
        }
      }
      curBal[a.currency] += bal;
    }
    for (const c of currencies) monthlyByCur[c].push(convertTo(curBal[c], c, 'TZS'));
  }

  const fxPalette = { TZS: '#10b981', EUR: '#3b82f6', USD: '#f59e0b', PLN: '#e8453c' };

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
        datasets: [{ data: rows.map(r => r.inTZS), backgroundColor: rows.map(r => fxPalette[r.currency] || '#6b7280'), borderWidth: 2 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
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
          borderColor: fxPalette[c] || '#6b7280',
          backgroundColor: (fxPalette[c] || '#6b7280') + '20',
          fill: true, tension: 0.3, pointRadius: 3,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, 'TZS')} TZS` } },
        },
        scales: {
          x: { grid: { color: cssVar('--chart-grid') } },
          y: { stacked: true, ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: cssVar('--chart-grid') } },
        },
      },
    });
    reportCharts.push(chart);
  }
}

// ─── Monthly Comparison Report ──────────────────────────────────────────

function renderMonthlyComparisonReport() {
  const out = document.getElementById('report-output');
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];

  // Build list of all months with data
  const allMonths = new Set();
  for (const tx of state.tx) { if (tx.date) allMonths.add(tx.date.slice(0, 7)); }
  const sortedMonths = [...allMonths].sort().reverse();

  const savedCur = out.getAttribute('data-mc-cur') || 'TZS';
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const savedMonth = out.getAttribute('data-mc-month') || currentYM;

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
            <div class="ic-value" style="color:var(--muted)">${formatCurrency(prevTotal, currency)}<span class="ic-cur">${currency}</span></div>
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
              <td class="amt" style="color:var(--muted)">${formatCurrency(r.prev, currency)}</td>
              <td class="amt" style="color:${deltaColor(r.delta)}">${r.delta >= 0 ? '+' : ''}${formatCurrency(r.delta, currency)}</td>
              <td style="color:${deltaColor(r.delta)};font-size:12px;">${deltaIcon(r.delta)} ${Math.abs(r.deltaPct).toFixed(0)}%</td>
            </tr>`).join('')}
            <tr style="font-weight:700;border-top:2px solid var(--border);">
              <td>${t('reports.shared.total_label', {}, 'Total')}</td>
              <td class="amt">${formatCurrency(thisTotal, currency)}</td>
              <td class="amt" style="color:var(--muted)">${formatCurrency(prevTotal, currency)}</td>
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
            { label: monthLabel(thisYM), data: top10.map(r => r.this), backgroundColor: '#3b82f6', borderWidth: 0 },
            { label: monthLabel(prevYM), data: top10.map(r => r.prev), backgroundColor: '#94a3b8', borderWidth: 0 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
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
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false },
            tooltip: { callbacks: { label: ctx => `${ctx.raw >= 0 ? '+' : ''}${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
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

// ─── Net Worth Trend Report ─────────────────────────────────────────────

function renderNetWorthTrendReport() {
  const out = document.getElementById('report-output');
  const selfAccounts = state.accounts.filter(a => a.owner === 'self' && a.status === 'active');
  const currencies = [...new Set(selfAccounts.map(a => a.currency))];
  const savedCur = out.getAttribute('data-nw-cur') || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.nw.toolbar.display_currency', {}, 'Display Currency')}</label>
        <select id="nw-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="nw-content"></div>
    </div>
  `;

  const curEl = document.getElementById('nw-currency');

  function update() {
    out.setAttribute('data-nw-cur', curEl.value);
    destroyReportCharts();
    const dispCur = curEl.value;

    // Build monthly net worth snapshots from earliest data to now
    const allMonths = new Set();
    for (const tx of state.tx) { if (tx.date) allMonths.add(tx.date.slice(0, 7)); }
    const sortedMonths = [...allMonths].sort();
    if (sortedMonths.length === 0) { document.getElementById('nw-content').innerHTML = `<p>${t('reports.nw.empty', {}, 'No data.')}</p>`; return; }

    const dataPoints = [];
    for (const mk of sortedMonths) {
      const endOfMonth = mk + '-31';
      let totalNW = 0;
      for (const a of selfAccounts) {
        const ibDate = a.initial_balance_date || '2000-01-01';
        if (endOfMonth < ibDate) continue;
        let bal = a.initial_balance || 0;
        for (const tx of state.tx) {
          if (!tx.date || tx.date > endOfMonth || tx.date < ibDate) continue;
          if (tx.account === a.alias) {
            if (tx.type === 'income') bal += tx.amount;
            else if (tx.type === 'expense') bal -= tx.amount;
            else if (tx.type === 'transfer') bal -= tx.amount;
          }
          if (tx.type === 'transfer' && tx.transfer_to_account === a.alias) {
            bal += tx.transfer_to_amount > 0 ? tx.transfer_to_amount : tx.amount;
          }
        }
        totalNW += convertTo(bal, a.currency, dispCur);
      }
      dataPoints.push({ month: mk, nw: totalNW });
    }

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
            <div class="ic-value" style="color:var(--positive)">${formatCurrency(maxNW, dispCur)}<span class="ic-cur">${dispCur}</span></div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.nw.tile.all_time_low', {}, 'All-time Low')}</div>
            <div class="ic-value" style="color:var(--negative)">${formatCurrency(minNW, dispCur)}<span class="ic-cur">${dispCur}</span></div>
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
            borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)',
            fill: true, tension: 0.3, pointRadius: 3,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, dispCur) + ' ' + dispCur } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') }, ticks: { maxTicksLimit: 18 } },
            y: { ticks: { callback: v => formatCurrency(v, dispCur) }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  curEl.addEventListener('change', update);
  update();
}

// ─── Discretionary vs. Fixed Report ─────────────────────────────────────

function renderFixedVarReport() {
  // Fixed categories: Rent, Bills:*, Subscriptions:*, Insurance:*, Fees:*
  const FIXED_PREFIXES = ['Rent', 'Bills:', 'Subscriptions:', 'Insurance:', 'Fees:'];
  const isFixed = (cat) => {
    if (!cat) return false;
    return FIXED_PREFIXES.some(p => cat === p || cat.startsWith(p));
  };

  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];
  const savedMode = out.getAttribute('data-fv-mode') || 'monthly';
  const savedYear = out.getAttribute('data-fv-year') || years[years.length - 1] || '2026';
  const savedCur = out.getAttribute('data-fv-cur') || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.mode', {}, 'Mode')}</label>
        <select id="fv-mode">
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.toolbar.monthly', {}, 'Monthly')}</option>
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.toolbar.yearly', {}, 'Yearly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="fv-year">
          ${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
        <label>${t('common.col.currency', {}, 'Currency')}</label>
        <select id="fv-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="fv-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('fv-mode');
  const yearEl = document.getElementById('fv-year');
  const curEl = document.getElementById('fv-currency');

  function update() {
    out.setAttribute('data-fv-mode', modeEl.value);
    out.setAttribute('data-fv-year', yearEl.value);
    out.setAttribute('data-fv-cur', curEl.value);
    yearEl.style.display = modeEl.value === 'yearly' ? 'none' : '';
    destroyReportCharts();
    const currency = curEl.value;
    const custodyAliases = getCustodyAliases();
    const expenses = state.tx.filter(tx => tx.type === 'expense' && !custodyAliases.has(tx.account)).map(tx => ({
      ...tx, amount: convertTo(tx.amount, tx.currency, currency),
      bucket: isFixed(tx.category) ? 'Fixed' : 'Discretionary',
    }));

    if (modeEl.value === 'monthly') renderFVMonthly(expenses, yearEl.value, currency);
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
      <div class="report-section">
        <div class="report-section-title">${escapeHtml(t('reports.fv.title_monthly', { year, currency }, `Fixed vs. Discretionary ${year} — ${currency}`))}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.fv.tile_fixed_costs', {}, 'Fixed Costs')}</div>
            <div class="ic-value" style="color:#e8453c">${formatCurrency(totFixed, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${escapeHtml(t('reports.fv.pct_of_spending', { pct: fixedPctYear }, `${fixedPctYear}% of spending`))}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.fv.cat_discretionary', {}, 'Discretionary')}</div>
            <div class="ic-value" style="color:#3b82f6">${formatCurrency(totDisc, currency)}<span class="ic-cur">${currency}</span></div>
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
              <div class="ic-count" style="font-size:10px;">${escapeHtml(t('reports.fv.monthly_tile_detail', { pct: m.fixedPct.toFixed(0), fixed: formatCurrency(m.fixed, currency), disc: formatCurrency(m.disc, currency) }, `Fixed ${m.fixedPct.toFixed(0)}% · ${formatCurrency(m.fixed, currency)} / ${formatCurrency(m.disc, currency)}`))}</div>
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
            { label: labelFixed, data: months.map(m => m.fixed), backgroundColor: '#e8453c', borderWidth: 0 },
            { label: labelDisc, data: months.map(m => m.disc), backgroundColor: '#3b82f6', borderWidth: 0 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
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
          datasets: [{ data: topFixed.map(([, v]) => v), backgroundColor: '#e8453c', borderWidth: 0 }],
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

    const content = document.getElementById('fv-content');
    content.innerHTML = `
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
            { label: labelFixed, data: data.map(d => d.fixed), backgroundColor: '#e8453c', borderWidth: 0 },
            { label: labelDisc, data: data.map(d => d.disc), backgroundColor: '#3b82f6', borderWidth: 0 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

// ─── Largest Transactions Report ────────────────────────────────────────

function renderLargestTxReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];
  const savedYear = out.getAttribute('data-lt-year') || 'all';
  const savedCur = out.getAttribute('data-lt-cur') || 'TZS';
  const savedType = out.getAttribute('data-lt-type') || 'expense';
  const savedCount = out.getAttribute('data-lt-count') || '50';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="lt-year">
          <option value="all" ${savedYear === 'all' ? 'selected' : ''}>${t('reports.lt.opt_all_time', {}, 'All Time')}</option>
          ${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
        <label>${t('common.col.type', {}, 'Type')}</label>
        <select id="lt-type">
          <option value="expense" ${savedType === 'expense' ? 'selected' : ''}>${t('reports.lt.type_expenses', {}, 'Expenses')}</option>
          <option value="income" ${savedType === 'income' ? 'selected' : ''}>${t('common.type.income', {}, 'Income')}</option>
          <option value="all" ${savedType === 'all' ? 'selected' : ''}>${t('reports.lt.type_all', {}, 'All')}</option>
        </select>
        <label>${t('reports.lt.label_show', {}, 'Show')}</label>
        <select id="lt-count">
          <option value="20" ${savedCount === '20' ? 'selected' : ''}>${t('reports.lt.opt_top_n', { n: 20 }, 'Top 20')}</option>
          <option value="50" ${savedCount === '50' ? 'selected' : ''}>${t('reports.lt.opt_top_n', { n: 50 }, 'Top 50')}</option>
          <option value="100" ${savedCount === '100' ? 'selected' : ''}>${t('reports.lt.opt_top_n', { n: 100 }, 'Top 100')}</option>
        </select>
        <label>${t('common.col.currency', {}, 'Currency')}</label>
        <select id="lt-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="lt-content"></div>
    </div>
  `;

  const yearEl = document.getElementById('lt-year');
  const typeEl = document.getElementById('lt-type');
  const countEl = document.getElementById('lt-count');
  const curEl = document.getElementById('lt-currency');

  function update() {
    out.setAttribute('data-lt-year', yearEl.value);
    out.setAttribute('data-lt-type', typeEl.value);
    out.setAttribute('data-lt-count', countEl.value);
    out.setAttribute('data-lt-cur', curEl.value);
    destroyReportCharts();
    const currency = curEl.value;
    const limit = parseInt(countEl.value);

    const custodyAliases = getCustodyAliases();
    let filtered = state.tx.filter(tx => {
      if (typeEl.value !== 'all' && tx.type !== typeEl.value) return false;
      if (tx.type === 'transfer') return false;
      if (yearEl.value !== 'all' && (!tx.date || !tx.date.startsWith(yearEl.value))) return false;
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
            <div class="ic-value" style="color:#e8453c">${top.length > 0 ? formatCurrency(top[0].converted, currency) : '0'}<span class="ic-cur">${currency}</span></div>
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
              <td>${tx.account}</td>
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
          datasets: [{ data: top.slice(0, 20).map(tx => tx.converted), backgroundColor: '#e8453c', borderWidth: 0 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, currency) + ' ' + currency } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') }, ticks: { maxRotation: 45, font: { size: 10 } } },
            y: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  yearEl.addEventListener('change', update);
  typeEl.addEventListener('change', update);
  countEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

// ─── Business vs. Personal Report ───────────────────────────────────────

function renderBizPersonalReport() {
  const BIZ_TAGS = ['BUSINESS_ExampleCo', 'BUSINESS_B'];
  const isBusiness = (t) => t.tags && BIZ_TAGS.some(bt => t.tags.split(';').includes(bt));

  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];
  const savedMode = out.getAttribute('data-bp-mode') || 'monthly';
  const savedYear = out.getAttribute('data-bp-year') || years[years.length - 1] || '2026';
  const savedCur = out.getAttribute('data-bp-cur') || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.mode', {}, 'Mode')}</label>
        <select id="bp-mode">
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.toolbar.monthly', {}, 'Monthly')}</option>
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.toolbar.yearly', {}, 'Yearly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="bp-year">
          ${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="bp-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="bp-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('bp-mode');
  const yearEl = document.getElementById('bp-year');
  const curEl = document.getElementById('bp-currency');

  function update() {
    out.setAttribute('data-bp-mode', modeEl.value);
    out.setAttribute('data-bp-year', yearEl.value);
    out.setAttribute('data-bp-cur', curEl.value);
    yearEl.style.display = modeEl.value === 'yearly' ? 'none' : '';
    destroyReportCharts();
    const currency = curEl.value;

    if (modeEl.value === 'monthly') renderBPMonthly(currency, yearEl.value);
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
            <div class="ic-value" style="color:#f59e0b">${formatCurrency(totBizExp, currency)}<span class="ic-cur">${currency}</span></div>
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
              <div class="ic-count" style="font-size:10px;">${t('reports.bp.cell_detail', { biz: formatCurrency(m.bizExp, currency), pers: formatCurrency(m.persExp, currency) }, `Biz ${formatCurrency(m.bizExp, currency)} / Pers ${formatCurrency(m.persExp, currency)}`)}</div>
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
            { label: t('reports.bp.dataset.biz', {}, 'Business'), data: months.map(m => m.bizExp), backgroundColor: '#f59e0b', borderWidth: 0 },
            { label: t('reports.bp.dataset.pers', {}, 'Personal'), data: months.map(m => m.persExp), backgroundColor: '#6366f1', borderWidth: 0 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
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
            { label: t('reports.bp.dataset.biz', {}, 'Business'), data: data.map(d => d.bizExp), backgroundColor: '#f59e0b', borderWidth: 0 },
            { label: t('reports.bp.dataset.pers', {}, 'Personal'), data: data.map(d => d.persExp), backgroundColor: '#6366f1', borderWidth: 0 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

// ─── Seasonal Heatmap Report ────────────────────────────────────────────

function renderSeasonalReport() {
  const out = document.getElementById('report-output');
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];
  const savedCur = out.getAttribute('data-sh-cur') || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="sh-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="sh-content"></div>
    </div>
  `;

  const curEl = document.getElementById('sh-currency');

  function update() {
    out.setAttribute('data-sh-cur', curEl.value);
    destroyReportCharts();
    const currency = curEl.value;
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
            <div class="ic-value" style="color:#e8453c">${monthNames[peakMonth]}</div>
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
                  <td class="amt" style="font-weight:600;">${formatCurrency(rowTotal, currency)}</td>
                </tr>`;
              }).join('')}
              <tr style="font-weight:700;border-top:2px solid var(--border);">
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

    const stackPalette = ['#1e40af', '#e8453c', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#a855f7'];
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
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 10 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)} ${currency}` } } },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  curEl.addEventListener('change', update);
  update();
}

// ─── Cash Runway Report ─────────────────────────────────────────────────

function renderRunwayReport() {
  const out = document.getElementById('report-output');
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];
  const savedCur = out.getAttribute('data-rw-cur') || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="rw-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="rw-content"></div>
    </div>
  `;

  const curEl = document.getElementById('rw-currency');

  function update() {
    out.setAttribute('data-rw-cur', curEl.value);
    destroyReportCharts();
    const dispCur = curEl.value;

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
      if (months > 6) return '#f59e0b';
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
          <summary style="cursor:pointer;font-weight:600;color:var(--text);">${t('reports.runway.explainer.summary', {}, 'How these runway figures are calculated')}</summary>
          <div style="margin-top:8px;">
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
              <td class="amt" style="color:var(--positive)">${formatCurrency(m.income, dispCur)}</td>
              <td class="amt" style="color:var(--negative)">${formatCurrency(m.expenses, dispCur)}</td>
              <td class="amt" style="color:${m.net >= 0 ? 'var(--positive)' : 'var(--negative)'}">${m.net >= 0 ? '+' : ''}${formatCurrency(m.net, dispCur)}</td>
            </tr>`).join('')}
            <tr style="font-weight:700;border-top:2px solid var(--border);">
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
            { label: t('common.label.income', {}, 'Income'), data: monthlyBurn.map(m => m.income), backgroundColor: '#10b981', borderWidth: 0 },
            { label: t('common.label.expenses', {}, 'Expenses'), data: monthlyBurn.map(m => m.expenses), backgroundColor: '#e8453c', borderWidth: 0 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, dispCur)} ${dispCur}` } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: { callback: v => formatCurrency(v, dispCur) }, grid: { color: cssVar('--chart-grid') } },
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
            borderColor: allPoints[allPoints.length - 1].balance >= 0 ? '#10b981' : '#e8453c',
            backgroundColor: allPoints[allPoints.length - 1].balance >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(232,69,60,0.1)',
            fill: true, tension: 0.2, pointRadius: 4,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, dispCur) + ' ' + dispCur } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: { callback: v => formatCurrency(v, dispCur) }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  curEl.addEventListener('change', update);
  update();
}

// ─── Vice Spending Report ───────────────────────────────────────────────

function renderViceSpendingReport() {
  const VICE_CATEGORIES = ['Leisure:Alcohol', 'Leisure:Smoking', 'Leisure:Vaping'];
  renderExpenseReport({
    filterId: 'vices',
    filterLabel: t('reports.filter_label.vices', {}, 'Vice Spending'),
    filterFn: (tx) => tx.type === 'expense' && tx.category && VICE_CATEGORIES.includes(tx.category),
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
    filterFn: (tx) => tx.type === 'expense' && tx.category && tx.category.startsWith('Fees:'),
    colorMain: '#6b7280',
    showTransactions: true,
    showCategoryBreakdown: true,
    stackCategories: true,
  });
}

// ─── R1: Expense Trend Sparklines ───────────────────────────────────────

function renderExpenseTrendReport() {
  const out = document.getElementById('report-output');
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];
  const savedCur = out.getAttribute('data-et-cur') || 'TZS';
  const savedN = out.getAttribute('data-et-n') || '12';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('common.col.currency', {}, 'Currency')}</label>
        <select id="et-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <label>${t('reports.et.label_months', {}, 'Months')}</label>
        <select id="et-months">
          ${[6, 12, 18, 24].map(n => `<option value="${n}" ${String(n) === savedN ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
      <div id="et-content"></div>
    </div>
  `;

  const curEl = document.getElementById('et-currency');
  const monthsEl = document.getElementById('et-months');

  function update() {
    const currency = curEl.value;
    const numMonths = parseInt(monthsEl.value, 10);
    out.setAttribute('data-et-cur', currency);
    out.setAttribute('data-et-n', String(numMonths));
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
        <td style="font-weight:500;">${idx + 1}</td>
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
            <th style="text-align:right;">${t('reports.shared.total_label', {}, 'Total')}</th>
            <th style="text-align:right;">${t('reports.et.col_avg_mo', {}, 'Avg/Mo')}</th>
            <th style="text-align:right;">${t('reports.et.col_last_mo', {}, 'Last Mo')}</th>
            <th style="text-align:right;">${t('reports.et.col_mom', {}, 'MoM')}</th>
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
    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#6b7280'];
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
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 10 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, currency)} ${currency}` } },
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

  curEl.addEventListener('change', update);
  monthsEl.addEventListener('change', update);
  update();
}

// ─── R2: Income Sources Breakdown ───────────────────────────────────────

function renderIncomeSourcesReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];
  const savedMode = out.getAttribute('data-is-mode') || 'monthly';
  const savedYear = out.getAttribute('data-is-year') || years[years.length - 1] || '2026';
  const savedCur = out.getAttribute('data-is-cur') || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.mode', {}, 'Mode')}</label>
        <select id="is-mode">
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.toolbar.monthly', {}, 'Monthly')}</option>
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.toolbar.yearly', {}, 'Yearly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="is-year">
          ${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="is-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="is-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('is-mode');
  const yearEl = document.getElementById('is-year');
  const curEl = document.getElementById('is-currency');

  function update() {
    out.setAttribute('data-is-mode', modeEl.value);
    out.setAttribute('data-is-year', yearEl.value);
    out.setAttribute('data-is-cur', curEl.value);
    yearEl.style.display = modeEl.value === 'yearly' ? 'none' : '';
    destroyReportCharts();

    const currency = curEl.value;
    const incomeTx = state.tx.filter(tx => tx.type === 'income').map(tx => ({
      ...tx, amount: convertTo(tx.amount, tx.currency, currency)
    }));

    // Classify income sources — exclude custody and non-operational
    const custodyAliases = getCustodyAliases();
    const nonPnl = getNonPnlCategories();
    const filteredIncome = incomeTx.filter(tx => isOperationalTx(tx, custodyAliases, nonPnl));

    // Sources are identified by stable keys; display labels are resolved
    // lazily via t() so the chart legend + table headers follow the locale.
    function classifySource(tx) {
      if (tx.category === 'Income:ExampleCo Reimbursement') return 'exampleco_reimb';
      if (tx.category === 'Income:KSD Reimbursement') return 'ksd_reimb';
      if (tx.category === 'Income:ExampleCo Salary') return 'exampleco_salary';
      if (tx.category === 'Income:ExampleCo Dividends') return 'exampleco_dividends';
      if (tx.category && tx.category.startsWith('Income:KSD')) return 'ksd_income';
      if (tx.category === 'Income:Interest') return 'interest';
      if (tx.category === 'Income:Investments' || tx.category === 'Income:Sales') return 'investments_sales';
      if (tx.category === 'Income:Reimbursement') return 'reimbursement';
      if (tx.category === 'Income:Refund') return 'refunds';
      return 'other';
    }

    const sourceColors = {
      exampleco_salary: '#3b82f6',
      exampleco_dividends: '#2563eb',
      ksd_income: '#8b5cf6',
      exampleco_reimb: '#f59e0b',
      ksd_reimb: '#eab308',
      reimbursement: '#a3e635',
      refunds: '#94a3b8',
      interest: '#10b981',
      investments_sales: '#06b6d4',
      other: '#6b7280',
    };
    const sourceOrder = ['exampleco_salary', 'exampleco_dividends', 'ksd_income', 'exampleco_reimb', 'ksd_reimb', 'reimbursement', 'refunds', 'interest', 'investments_sales', 'other'];
    // Fallback labels — used if a translation is missing; also the source of truth for EN.
    const sourceFallback = {
      exampleco_salary: 'ExampleCo Salary',
      exampleco_dividends: 'ExampleCo Dividends',
      ksd_income: 'KSD Income',
      exampleco_reimb: 'ExampleCo Reimb.',
      ksd_reimb: 'KSD Reimb.',
      reimbursement: 'Reimbursement',
      refunds: 'Refunds',
      interest: 'Interest',
      investments_sales: 'Investments & Sales',
      other: 'Other Income',
    };
    const sourceLabel = (k) => t(`reports.incsrc.source.${k}`, {}, sourceFallback[k] || k);

    if (modeEl.value === 'monthly') {
      const year = yearEl.value;
      const months = [];
      for (let m = 1; m <= 12; m++) {
        const ym = `${year}-${String(m).padStart(2, '0')}`;
        const monthTx = filteredIncome.filter(tx => tx.date && tx.date.startsWith(ym));
        const bySource = {};
        for (const s of sourceOrder) bySource[s] = 0;
        for (const tx of monthTx) bySource[classifySource(tx)] += tx.amount;
        months.push({ ym, ...bySource, total: monthTx.reduce((sum, tx) => sum + tx.amount, 0) });
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
          <div class="table-scroll-wrapper"><table class="tx-table" style="white-space:nowrap;">
            <thead><tr>
              <th>${t('common.label.month', {}, 'Month')}</th>
              ${sourceOrder.map(s => `<th style="text-align:right;">${sourceLabel(s)}</th>`).join('')}
              <th style="text-align:right;font-weight:700;">${t('reports.shared.total_label', {}, 'Total')}</th>
              ${showEurCol ? `<th style="text-align:right;">EUR</th><th style="text-align:right;">${t('reports.incsrc.col.rate', {}, 'Rate')}</th>` : ''}
            </tr></thead>
            <tbody>
              ${months.map((m, i) => {
                const eurVal = showEurCol && m.total ? m.total / monthRates[i] : 0;
                return `<tr>
                <td>${monthLabel(m.ym)}</td>
                ${sourceOrder.map(s => `<td class="amt" style="color:${sourceColors[s]}">${formatCurrency(m[s], currency)}</td>`).join('')}
                <td class="amt" style="font-weight:700;">${formatCurrency(m.total, currency)}</td>
                ${showEurCol ? `<td class="amt" style="color:#059669;font-weight:500;">${m.total ? formatCurrency(eurVal, 'EUR') : '—'}</td><td class="amt" style="color:var(--muted);font-size:0.85em;">${m.total ? monthRates[i].toFixed(0) : ''}</td>` : ''}
              </tr>`;
              }).join('')}
              <tr style="font-weight:700;border-top:2px solid var(--border);">
                <td>${t('reports.shared.total_label', {}, 'Total')}</td>
                ${sourceOrder.map(s => `<td class="amt" style="color:${sourceColors[s]}">${formatCurrency(months.reduce((sum, m) => sum + m[s], 0), currency)}</td>`).join('')}
                <td class="amt">${formatCurrency(months.reduce((sum, m) => sum + m.total, 0), currency)}</td>
                ${showEurCol ? (() => {
                  const totalEur = months.reduce((sum, m, i) => sum + (m.total ? m.total / monthRates[i] : 0), 0);
                  return `<td class="amt" style="color:#059669;">${formatCurrency(totalEur, 'EUR')}</td><td></td>`;
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
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
              tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, currency)} ${currency}` } },
            },
            scales: {
              x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
              y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
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
            responsive: true, maintainAspectRatio: false,
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
          <div class="table-scroll-wrapper"><table class="tx-table" style="white-space:nowrap;">
            <thead><tr>
              <th>${t('common.col.year', {}, 'Year')}</th>
              ${sourceOrder.map(s => `<th style="text-align:right;">${sourceLabel(s)}</th>`).join('')}
              <th style="text-align:right;font-weight:700;">${t('reports.shared.total_label', {}, 'Total')}</th>
              ${showEurCol ? '<th style="text-align:right;">EUR</th>' : ''}
            </tr></thead>
            <tbody>
              ${yearData.map(d => {
                const curRate = (fxRates['EUR'] || 1) / (fxRates[currency] || 1);
                const eurVal = d.total ? d.total / curRate : 0;
                return `<tr>
                <td style="font-weight:500;">${d.year}</td>
                ${sourceOrder.map(s => `<td class="amt" style="color:${sourceColors[s]}">${formatCurrency(d[s], currency)}</td>`).join('')}
                <td class="amt" style="font-weight:700;">${formatCurrency(d.total, currency)}</td>
                ${showEurCol ? `<td class="amt" style="color:#059669;font-weight:500;">${d.total ? formatCurrency(eurVal, 'EUR') : '—'}</td>` : ''}
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
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
              tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, currency)} ${currency}` } },
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
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

// ─── R3: Debt Overview Report ───────────────────────────────────────────

function renderDebtOverviewReport() {
  const out = document.getElementById('report-output');
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];
  const savedCur = out.getAttribute('data-do-cur') || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="do-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="do-content"></div>
    </div>
  `;

  const curEl = document.getElementById('do-currency');

  function update() {
    const currency = curEl.value;
    out.setAttribute('data-do-cur', currency);
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
        <td style="font-weight:500;">${escapeHtml(d.person_name)}</td>
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
        <td style="font-size:11px;">${isOwed ? t('reports.debtOverview.direction.owed_to_me_past', {}, 'owed you') : t('reports.debtOverview.direction.owed_by_me_past', {}, 'you owed')}</td>
        <td class="amt">${formatCurrency(orig, currency)}</td>
        <td class="hint-sm">${fmtDate(d.date_created)}</td>
        <td class="hint-sm">${fmtDate(d.date_settled)}</td>
      </tr>`;
    });

    const content = document.getElementById('do-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="flex-row gap-md" style="flex-wrap:wrap;">
          <div class="summary-card" style="flex:1;min-width:140px;">
            <div class="label-xs">${t('reports.debtOverview.card.owed_to_you', {}, 'Owed to You')}</div>
            <div class="amt" style="font-size:18px;color:var(--positive);font-weight:700;">${formatCurrency(totalOwedToMe, currency)} <span class="acc-currency">${currency}</span></div>
          </div>
          <div class="summary-card" style="flex:1;min-width:140px;">
            <div class="label-xs">${t('reports.debtOverview.card.you_owe', {}, 'You Owe')}</div>
            <div class="amt" style="font-size:18px;color:var(--negative);font-weight:700;">${formatCurrency(totalOwedByMe, currency)} <span class="acc-currency">${currency}</span></div>
          </div>
          <div class="summary-card" style="flex:1;min-width:140px;">
            <div class="label-xs">${t('reports.debtOverview.card.net_position', {}, 'Net Position')}</div>
            <div class="amt" style="font-size:18px;color:${netPosition >= 0 ? 'var(--positive)' : 'var(--negative)'};font-weight:700;">${netPosition >= 0 ? '+' : ''}${formatCurrency(netPosition, currency)} <span class="acc-currency">${currency}</span></div>
          </div>
          <div class="summary-card" style="flex:1;min-width:140px;">
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
            <th>${t('reports.debtOverview.col.person', {}, 'Person')}</th><th>${t('reports.debtOverview.col.direction', {}, 'Direction')}</th><th style="text-align:right;">${t('reports.debtOverview.col.original', {}, 'Original')}</th>
            <th style="text-align:right;">${t('reports.debtOverview.col.remaining', {}, 'Remaining')}</th><th style="text-align:right;">${t('reports.debtOverview.col.paid', {}, 'Paid')}</th>
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
          <thead><tr><th>${t('reports.debtOverview.col.person', {}, 'Person')}</th><th>${t('reports.debtOverview.col.direction', {}, 'Direction')}</th><th style="text-align:right;">${t('reports.debtOverview.col.amount', {}, 'Amount')}</th><th>${t('reports.debtOverview.col.created', {}, 'Created')}</th><th>${t('reports.debtOverview.col.settled', {}, 'Settled')}</th></tr></thead>
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
              backgroundColor: open.map(d => d.type === 'owed_to_me' ? '#10b981' : '#e8453c'),
              borderWidth: 0, borderRadius: 3,
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: c => `${c.raw >= 0 ? t('reports.debtOverview.chart.tooltip.owes_you', {}, 'Owes you') : t('reports.debtOverview.chart.tooltip.you_owe', {}, 'You owe')}: ${formatCurrency(Math.abs(c.raw), currency)} ${currency}` } },
            },
            scales: {
              x: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
              y: { grid: { display: false } },
            },
          },
        });
        reportCharts.push(chart);
      }
    }
  }

  curEl.addEventListener('change', update);
  update();
}

// ─── R4: Year-over-Year Comparison ──────────────────────────────────────

function renderYoYReport() {
  const out = document.getElementById('report-output');
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];
  const savedCur = out.getAttribute('data-yoy-cur') || 'TZS';
  const savedMonth = out.getAttribute('data-yoy-month') || String(new Date().getMonth() + 1);

  // Long-form month names via common.months.long.{1..12}, EN fallback kept
  // in case a locale omits a key.
  const monthFallback = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthNames = monthFallback.map((en, i) => t(`common.months.long.${i + 1}`, {}, en));

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('common.label.month', {}, 'Month')}</label>
        <select id="yoy-month">
          ${monthNames.map((n, i) => `<option value="${i + 1}" ${String(i + 1) === savedMonth ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="yoy-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="yoy-content"></div>
    </div>
  `;

  const monthEl = document.getElementById('yoy-month');
  const curEl = document.getElementById('yoy-currency');

  function update() {
    const month = parseInt(monthEl.value, 10);
    const currency = curEl.value;
    out.setAttribute('data-yoy-month', String(month));
    out.setAttribute('data-yoy-cur', currency);
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
            <th style="text-align:right;">${t('common.label.income', {}, 'Income')}</th>
            <th style="text-align:right;">${t('common.label.expenses', {}, 'Expenses')}</th>
            <th style="text-align:right;">${t('common.label.net', {}, 'Net')}</th>
            <th style="text-align:right;">${t('reports.yoy.col.tx_count', {}, 'TX Count')}</th>
          </tr></thead>
          <tbody>
            ${yearStats.map((ys, i) => {
              const prevYs = i > 0 ? yearStats[i - 1] : null;
              const expChange = prevYs && prevYs.expenses > 0 ? ((ys.expenses - prevYs.expenses) / prevYs.expenses * 100) : null;
              const changeStr = expChange !== null ? ` <span style="color:${expChange > 0 ? 'var(--negative)' : 'var(--positive)'};font-size:9px;">(${expChange > 0 ? '+' : ''}${expChange.toFixed(0)}%)</span>` : '';
              return `<tr>
                <td style="font-weight:700;">${ys.year}</td>
                <td class="amt" style="color:var(--positive)">${formatCurrency(ys.income, currency)}</td>
                <td class="amt" style="color:var(--negative)">${formatCurrency(ys.expenses, currency)}${changeStr}</td>
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
            ${years.map(y => `<th style="text-align:right;">${y}</th>`).join('')}
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
            { label: t('common.label.income', {}, 'Income'), data: yearStats.map(ys => ys.income), backgroundColor: '#10b981', borderWidth: 0 },
            { label: t('common.label.expenses', {}, 'Expenses'), data: yearStats.map(ys => ys.expenses), backgroundColor: '#e8453c', borderWidth: 0 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, currency)} ${currency}` } },
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

  monthEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
}

// ─── R5: Pass-Through Audit ─────────────────────────────────────────────

function renderPassThroughAuditReport() {
  const out = document.getElementById('report-output');
  const currencies = [...new Set(state.accounts.filter(a => a.owner === 'self' && a.status === 'active').map(a => a.currency))];
  const savedCur = out.getAttribute('data-pt-cur') || 'TZS';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="pt-currency">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="pt-content"></div>
    </div>
  `;

  const curEl = document.getElementById('pt-currency');

  function update() {
    const currency = curEl.value;
    out.setAttribute('data-pt-cur', currency);
    destroyReportCharts();

    // Find pass-through accounts
    const ptAccounts = state.accounts.filter(a => a.type === 'pass_through');
    if (ptAccounts.length === 0) {
      document.getElementById('pt-content').innerHTML = `<div class="empty-state"><p>${t('reports.pt.empty', {}, 'No pass-through accounts configured.')}</p></div>`;
      return;
    }

    const issues = [];
    const summary = [];

    for (const pta of ptAccounts) {
      const acctTx = state.tx.filter(tx => tx.account === pta.alias);
      // Outflows: expenses AND transfers out (both reduce the balance and need reimbursement)
      const expenses = acctTx.filter(tx => tx.type === 'expense' || tx.type === 'transfer');
      const incomes = acctTx.filter(tx => tx.type === 'income');

      let matched = 0, unmatched = 0, mismatchAmt = 0;

      // Multi-pass matching: exact → window → batch → extended window
      // Issues are only emitted AFTER all passes complete.
      const WINDOW_DAYS = 7;
      function daysDiff(d1, d2) {
        if (!d1 || !d2) return Infinity;
        const a = new Date(d1), b = new Date(d2);
        return Math.abs(a - b) / 86400000;
      }

      const usedIncomes = new Set();
      const dateOffsetPairs = []; // {exp, inc, days} for date-offset reporting

      // Pass 1: exact date + exact amount
      for (const exp of expenses) {
        const expAmt = parseFloat(exp.amount) || 0;
        const match = incomes.find(inc => {
          if (usedIncomes.has(inc.import_id)) return false;
          return inc.date === exp.date && Math.abs((parseFloat(inc.amount) || 0) - expAmt) < 0.01;
        });
        if (match) { matched++; usedIncomes.add(match.import_id); exp._matched = true; }
      }

      // Pass 2: window match ±7 days
      for (const exp of expenses) {
        if (exp._matched) continue;
        const expAmt = parseFloat(exp.amount) || 0;
        let bestMatch = null, bestDays = Infinity;
        for (const inc of incomes) {
          if (usedIncomes.has(inc.import_id)) continue;
          const dd = daysDiff(exp.date, inc.date);
          if (Math.abs((parseFloat(inc.amount) || 0) - expAmt) < 0.01 && dd <= WINDOW_DAYS && dd < bestDays) {
            bestMatch = inc; bestDays = dd;
          }
        }
        if (bestMatch) {
          matched++;
          usedIncomes.add(bestMatch.import_id);
          exp._matched = true;
          if (bestDays > 0) dateOffsetPairs.push({ exp, inc: bestMatch, days: bestDays });
        }
      }

      // Pass 3: batch matching — multiple expenses sum to one income
      const remainingExp = expenses.filter(e => !e._matched);
      const orphanIncomes = incomes.filter(inc => !usedIncomes.has(inc.import_id));
      const sortedOrphans = [...orphanIncomes].sort((a, b) => (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0));

      function findSubsetSum(items, target, tolerance) {
        const n = items.length;
        if (n > 20) return null;
        for (let size = 2; size <= n; size++) {
          for (let mask = 1; mask < (1 << n); mask++) {
            let bits = 0;
            for (let tmp = mask; tmp; tmp &= tmp - 1) bits++;
            if (bits !== size) continue;
            let sum = 0;
            const selected = [];
            for (let i = 0; i < n; i++) {
              if (mask & (1 << i)) {
                sum += parseFloat(items[i].amount) || 0;
                selected.push(items[i]);
              }
            }
            if (Math.abs(sum - target) < tolerance) return selected;
          }
        }
        return null;
      }

      const batchMatched = new Set();
      const batchUsedIncomes = new Set();
      for (const inc of sortedOrphans) {
        const incAmt = parseFloat(inc.amount) || 0;
        const candidates = remainingExp.filter(e => !batchMatched.has(e.import_id));
        if (candidates.length === 0 || candidates.length > 20) continue;
        const subset = findSubsetSum(candidates, incAmt, 0.02);
        if (subset && subset.length >= 2) {
          matched += subset.length;
          for (const e of subset) { batchMatched.add(e.import_id); e._matched = true; }
          batchUsedIncomes.add(inc.import_id);
          usedIncomes.add(inc.import_id);
          issues.push({
            account: pta.alias, accountName: pta.name,
            date: inc.date, amount: incAmt, nativeCurrency: pta.currency,
            convertedAmount: convertTo(incAmt, pta.currency, currency),
            payee: inc.payee, category: inc.category,
            type: 'batch_match',
            batchExpenses: subset.map(e => ({
              date: e.date, amount: parseFloat(e.amount) || 0,
              payee: e.payee, category: e.category,
            })),
            importId: inc.import_id,
          });
        }
      }

      // Pass 4: extended window ±14 days for remaining 1:1 pairs
      const stillUnmatched = remainingExp.filter(e => !batchMatched.has(e.import_id));
      const stillOrphan = orphanIncomes.filter(inc => !batchUsedIncomes.has(inc.import_id));
      const extUsed = new Set();
      for (const exp of stillUnmatched) {
        const expAmt = parseFloat(exp.amount) || 0;
        let bestMatch = null, bestDays = Infinity;
        for (const inc of stillOrphan) {
          if (extUsed.has(inc.import_id)) continue;
          const dd = daysDiff(exp.date, inc.date);
          if (Math.abs((parseFloat(inc.amount) || 0) - expAmt) < 0.01 && dd <= 14 && dd < bestDays) {
            bestMatch = inc; bestDays = dd;
          }
        }
        if (bestMatch) {
          matched++;
          extUsed.add(bestMatch.import_id);
          exp._matched = true;
          dateOffsetPairs.push({ exp, inc: bestMatch, days: bestDays });
        }
      }

      // === Emit issues AFTER all passes ===
      // Date offsets (informational)
      for (const pair of dateOffsetPairs) {
        const expAmt = parseFloat(pair.exp.amount) || 0;
        issues.push({
          account: pta.alias, accountName: pta.name,
          date: pair.exp.date, amount: expAmt, nativeCurrency: pta.currency,
          convertedAmount: convertTo(expAmt, pta.currency, currency),
          payee: pair.exp.payee, category: pair.exp.category,
          type: 'date_offset',
          matchDate: pair.inc.date, daysDiff: pair.days,
          importId: pair.exp.import_id,
        });
      }

      // Truly unmatched expenses (not matched by any pass)
      for (const exp of expenses) {
        if (exp._matched) continue;
        const expAmt = parseFloat(exp.amount) || 0;
        unmatched++;
        mismatchAmt += convertTo(expAmt, pta.currency, currency);
        issues.push({
          account: pta.alias, accountName: pta.name,
          date: exp.date, amount: expAmt, nativeCurrency: pta.currency,
          convertedAmount: convertTo(expAmt, pta.currency, currency),
          payee: exp.payee, category: exp.category,
          type: 'missing_income',
          importId: exp.import_id,
        });
      }

      // Truly orphan incomes (not matched by any pass)
      const finalOrphans = orphanIncomes.filter(inc => !batchUsedIncomes.has(inc.import_id) && !extUsed.has(inc.import_id));
      for (const inc of finalOrphans) {
        const incAmt = parseFloat(inc.amount) || 0;
        issues.push({
          account: pta.alias, accountName: pta.name,
          date: inc.date, amount: incAmt, nativeCurrency: pta.currency,
          convertedAmount: convertTo(incAmt, pta.currency, currency),
          payee: inc.payee, category: inc.category,
          type: 'orphan_income',
          importId: inc.import_id,
        });
      }

      // Balance check
      const totalExp = expenses.reduce((s, tx) => s + (parseFloat(tx.amount) || 0), 0);
      const totalInc = incomes.reduce((s, tx) => s + (parseFloat(tx.amount) || 0), 0);
      const balance = totalInc - totalExp;

      const dateOffsetCount = issues.filter(i => i.account === pta.alias && i.type === 'date_offset').length;
      const batchCount = issues.filter(i => i.account === pta.alias && i.type === 'batch_match').length;
      const realOrphanCount = finalOrphans.length;
      summary.push({
        alias: pta.alias,
        name: pta.name,
        currency: pta.currency,
        expenses: expenses.length,
        incomes: incomes.length,
        matched,
        unmatched,
        dateOffsets: dateOffsetCount,
        batchMatches: batchCount,
        orphanIncomes: realOrphanCount,
        totalExp,
        totalInc,
        balance,
        balanceConverted: convertTo(balance, pta.currency, currency),
        unmatchedAmt: mismatchAmt,
      });
    }

    const hardIssues = issues.filter(i => i.type === 'missing_income' || i.type === 'orphan_income');
    const dateOffsets = issues.filter(i => i.type === 'date_offset');
    const batchMatches = issues.filter(i => i.type === 'batch_match');
    const totalIssues = hardIssues.length;
    // Account-level balance check: if totals of expenses and incomes match on every
    // pass-through account, the reimbursements happened — per-TX matching gaps are
    // just algorithmic (batches, round-number reimbursements covering multiple TXs).
    const balanceOk = summary.every(s => Math.abs(s.balance) < 0.01);
    const healthColor = totalIssues === 0
      ? 'var(--positive)'
      : balanceOk
        ? 'var(--muted)'
        : totalIssues <= 3 ? 'var(--warning, #f59e0b)' : 'var(--negative)';
    const healthLabel = totalIssues === 0
      ? t('reports.pt.health.all_clear', {}, 'All Clear')
      : balanceOk
        ? t('reports.pt.health.balance_ok', {}, 'Balance OK — matching incomplete')
        : totalIssues <= 3 ? t('reports.pt.health.minor', {}, 'Minor Issues') : t('reports.pt.health.needs_attention', {}, 'Needs Attention');

    const content = document.getElementById('pt-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="flex-row gap-md" style="flex-wrap:wrap;">
          <div class="summary-card" style="flex:1;min-width:140px;">
            <div class="label-xs">${t('reports.pt.card.balance', {}, 'Account Balance')}</div>
            <div style="font-size:18px;font-weight:700;color:${balanceOk ? 'var(--positive)' : 'var(--negative)'};">
              ${balanceOk ? t('reports.pt.balance.ok', {}, 'OK (zero delta)') : t('reports.pt.balance.unbalanced', {}, 'UNBALANCED')}
            </div>
          </div>
          <div class="summary-card" style="flex:1;min-width:140px;">
            <div class="label-xs">${t('reports.pt.card.status', {}, 'Health Status')}</div>
            <div style="font-size:18px;font-weight:700;color:${healthColor};">${healthLabel}</div>
          </div>
          <div class="summary-card" style="flex:1;min-width:140px;">
            <div class="label-xs">${balanceOk ? t('reports.pt.card.unmatched', {}, 'Unmatched TXs') : t('reports.pt.card.hard_issues', {}, 'Hard Issues')}</div>
            <div style="font-size:18px;font-weight:700;color:${healthColor};">${totalIssues}</div>
          </div>
          <div class="summary-card" style="flex:1;min-width:140px;">
            <div class="label-xs">${t('reports.pt.card.batch_matched', {}, 'Batch Matched')}</div>
            <div style="font-size:18px;font-weight:700;color:var(--positive);">${batchMatches.length}</div>
          </div>
          <div class="summary-card" style="flex:1;min-width:140px;">
            <div class="label-xs">${t('reports.pt.card.date_offsets', {}, 'Date Offsets')}</div>
            <div style="font-size:18px;font-weight:700;color:var(--muted);">${dateOffsets.length}</div>
          </div>
          <div class="summary-card" style="flex:1;min-width:140px;">
            <div class="label-xs">${t('reports.pt.card.accounts_checked', {}, 'Accounts Checked')}</div>
            <div style="font-size:18px;font-weight:700;">${ptAccounts.length}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.pt.section.summary', { currency }, `Account Summary (${currency})`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table">
          <thead><tr>
            <th>${t('common.col.account', {}, 'Account')}</th>
            <th style="text-align:right;">${t('common.label.expenses', {}, 'Expenses')}</th>
            <th style="text-align:right;">${t('reports.pt.col.incomes', {}, 'Incomes')}</th>
            <th style="text-align:right;">${t('reports.pt.col.matched', {}, 'Matched')}</th>
            <th style="text-align:right;">${t('reports.pt.col.date_offset', {}, 'Date Offset')}</th>
            <th style="text-align:right;">${t('reports.pt.col.unmatched', {}, 'Unmatched')}</th>
            <th style="text-align:right;">${t('reports.pt.col.balance', {}, 'Balance')}</th>
            <th>${t('reports.pt.col.status', {}, 'Status')}</th>
          </tr></thead>
          <tbody>
            ${summary.map(s => {
              const balColor = Math.abs(s.balance) < 0.01 ? 'var(--positive)' : 'var(--negative)';
              const issueCount = s.unmatched + s.orphanIncomes;
              const status = issueCount === 0
                ? '✓'
                : issueCount === 1
                  ? t('reports.pt.status.issues_one', { n: 1 }, '1 issue')
                  : t('reports.pt.status.issues_many', { n: issueCount }, `${issueCount} issues`);
              return `<tr>
                <td style="font-weight:500;">${escapeHtml(s.name)} <span style="color:var(--muted);font-size:9px;">(${s.alias})</span></td>
                <td class="amt">${s.expenses}</td>
                <td class="amt">${s.incomes}</td>
                <td class="amt" style="color:var(--positive);">${s.matched}</td>
                <td class="amt" style="color:var(--muted);">${s.dateOffsets || 0}</td>
                <td class="amt" style="color:${s.unmatched > 0 ? 'var(--negative)' : 'var(--muted)'};">${s.unmatched}</td>
                <td class="amt" style="color:${balColor};">${formatCurrency(s.balanceConverted, currency)}</td>
                <td style="color:${s.unmatched === 0 && s.orphanIncomes === 0 ? 'var(--positive)' : 'var(--negative)'};">${status}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>
      ${hardIssues.length > 0 ? `
      <div class="report-section">
        <div class="report-section-title">${balanceOk ? t('reports.pt.section.unmatched', { n: hardIssues.length }, `Unmatched TXs (${hardIssues.length}) — Balance is zero, matching algorithm could not pair these 1:1 (likely covered by batch reimbursements)`) : t('reports.pt.section.hard', { n: hardIssues.length }, `Hard Issues (${hardIssues.length}) — Missing Counter-Entries or Orphan Incomes`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table">
          <thead><tr>
            <th>${t('common.col.account', {}, 'Account')}</th>
            <th>${t('common.label.date', {}, 'Date')}</th>
            <th>${t('common.col.type', {}, 'Type')}</th>
            <th style="text-align:right;">${t('common.col.amount', {}, 'Amount')}</th>
            <th>${t('common.col.payee', {}, 'Payee')}</th>
            <th>${t('common.col.category', {}, 'Category')}</th>
            <th>${t('reports.pt.col.import_id', {}, 'Import ID')}</th>
          </tr></thead>
          <tbody>
            ${hardIssues.map(iss => {
              const typeLabel = iss.type === 'missing_income' ? t('reports.pt.issue.missing', {}, 'Missing Counter-Entry') : t('reports.pt.issue.orphan', {}, 'Orphan Income');
              const typeColor = iss.type === 'missing_income' ? 'var(--negative)' : 'var(--warning, #f59e0b)';
              return `<tr>
                <td>${iss.account}</td>
                <td>${fmtDate(iss.date)}</td>
                <td style="color:${typeColor};font-size:10px;font-weight:500;">${typeLabel}</td>
                <td class="amt">${formatCurrency(iss.convertedAmount, currency)} <span class="acc-currency">${currency}</span></td>
                <td>${escapeHtml(iss.payee || '')}</td>
                <td style="font-size:10px;">${escapeHtml(iss.category || '')}</td>
                <td class="hint-sm">${iss.importId || ''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>` : ''}
      ${batchMatches.length > 0 ? `
      <div class="report-section">
        <div class="report-section-title">${t('reports.pt.section.batch', { n: batchMatches.length }, `Batch Matches (${batchMatches.length}) — Multiple Expenses Reimbursed as One`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table">
          <thead><tr>
            <th>${t('common.col.account', {}, 'Account')}</th>
            <th>${t('reports.pt.col.income_date', {}, 'Income Date')}</th>
            <th style="text-align:right;">${t('reports.kf.col.reimbursed', {}, 'Reimbursed')}</th>
            <th>${t('reports.pt.col.expenses_covered', {}, 'Expenses Covered')}</th>
          </tr></thead>
          <tbody>
            ${batchMatches.map(bm => `<tr>
              <td>${bm.account}</td>
              <td>${fmtDate(bm.date)}</td>
              <td class="amt" style="color:var(--positive);font-weight:500;">${formatCurrency(bm.convertedAmount, currency)} <span class="acc-currency">${currency}</span></td>
              <td style="font-size:10px;">
                ${bm.batchExpenses.map(e =>
                  `<div style="margin:1px 0;">${fmtDate(e.date)} · ${formatCurrency(convertTo(e.amount, bm.nativeCurrency, currency), currency)} ${currency} · ${escapeHtml(e.payee || '')} · <span style="color:var(--muted);">${escapeHtml(e.category || '')}</span></div>`
                ).join('')}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : ''}
      ${dateOffsets.length > 0 ? `
      <div class="report-section">
        <div class="report-section-title">${t('reports.pt.section.date_offsets', { n: dateOffsets.length }, `Date Offsets (${dateOffsets.length}) — Matched by Amount, Dates Differ (MMEX Legacy)`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table">
          <thead><tr>
            <th>${t('common.col.account', {}, 'Account')}</th>
            <th>${t('reports.pt.col.expense_date', {}, 'Expense Date')}</th>
            <th>${t('reports.pt.col.income_date', {}, 'Income Date')}</th>
            <th>${t('reports.pt.col.offset', {}, 'Offset')}</th>
            <th style="text-align:right;">${t('common.col.amount', {}, 'Amount')}</th>
            <th>${t('common.col.payee', {}, 'Payee')}</th>
            <th>${t('common.col.category', {}, 'Category')}</th>
          </tr></thead>
          <tbody>
            ${dateOffsets.map(iss => `<tr>
              <td>${iss.account}</td>
              <td>${fmtDate(iss.date)}</td>
              <td>${fmtDate(iss.matchDate)}</td>
              <td style="color:var(--muted);font-size:10px;">${iss.daysDiff.toFixed(0)}d</td>
              <td class="amt">${formatCurrency(iss.convertedAmount, currency)} <span class="acc-currency">${currency}</span></td>
              <td>${escapeHtml(iss.payee || '')}</td>
              <td style="font-size:10px;">${escapeHtml(iss.category || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : ''}
    `;
  }

  curEl.addEventListener('change', update);
  update();
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

// ─── Savings Goals History Report ──────────────────────────────────────────

function renderSavingsGoalsHistoryReport() {
  const out = document.getElementById('report-output');
  const goals = (state.savingsGoals || []).filter(g => g.active);

  if (!goals.length) {
    out.innerHTML = `<div class="report-view"><p>${t('reports.savingsGoalsHistory.empty', {}, 'No active savings goals configured. Add goals in Settings &rarr; Goals.')}</p></div>`;
    return;
  }

  const savedGoal = out.getAttribute('data-sgh-goal') || goals[0].id;

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.goal', {}, 'Goal')}</label>
        <select id="sgh-goal">${goals.map(g => `<option value="${g.id}" ${g.id === savedGoal ? 'selected' : ''}>${g.name}</option>`).join('')}</select>
      </div>
      <div id="sgh-content"></div>
    </div>
  `;

  const goalEl = document.getElementById('sgh-goal');

  function update() {
    out.setAttribute('data-sgh-goal', goalEl.value);
    destroyReportCharts();

    const goal = goals.find(g => g.id === goalEl.value) || goals[0];
    const currency = goal.currency || 'TZS';
    const target = goal.target || 0;
    const acctAlias = goal.account || '';
    const deadline = goal.deadline || '';

    // Find matching account by alias
    const acctObj = state.accounts.find(a => a.alias === acctAlias);
    const alias = acctObj ? acctObj.alias : acctAlias;

    // Determine start: goal.start_date or earliest TX on this account
    let startDate = goal.start_date || '';
    if (!startDate) {
      for (const t of state.tx) {
        if (!t.date) continue;
        if ((t.account === alias || t.transfer_to_account === alias) && (!startDate || t.date < startDate)) startDate = t.date;
      }
    }
    if (!startDate) startDate = new Date().toISOString().slice(0, 10);

    // Build month-by-month balances from transactions
    const startYM = startDate.slice(0, 7);
    const now = new Date();
    const endYM = deadline ? Math.max(
      new Date(deadline).getTime(),
      now.getTime()
    ) : now.getTime();
    const endDate = new Date(endYM);
    const endYMStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;

    // Collect all relevant TX sorted by date (account or transfer target)
    const acctTx = state.tx.filter(t => {
      if (!t.date) return false;
      return t.account === alias || t.transfer_to_account === alias;
    }).sort((a, b) => a.date.localeCompare(b.date));

    // Get initial balance from accounts.csv
    const initialBalance = acctObj ? (acctObj.initial_balance || 0) : 0;

    // Build month list from start to deadline (or now, whichever is later)
    const months = [];
    let ym = startYM;
    while (ym <= endYMStr) {
      months.push(ym);
      const [y, m] = ym.split('-').map(Number);
      const nm = m === 12 ? 1 : m + 1;
      const ny = m === 12 ? y + 1 : y;
      ym = `${ny}-${String(nm).padStart(2, '0')}`;
    }

    // Compute cumulative balance at end of each month (same logic as core.js)
    const balanceByMonth = [];
    let cumBalance = initialBalance;
    let sortedTxIdx = 0;

    for (const month of months) {
      while (sortedTxIdx < acctTx.length && acctTx[sortedTxIdx].date.slice(0, 7) <= month) {
        const t = acctTx[sortedTxIdx];
        if (t.type === 'expense' && t.account === alias) cumBalance -= t.amount;
        else if (t.type === 'income' && t.account === alias) cumBalance += t.amount;
        else if (t.type === 'transfer' && t.account === alias) cumBalance -= t.amount;
        else if (t.type === 'transfer' && t.transfer_to_account === alias) cumBalance += (t.transfer_to_amount > 0 ? t.transfer_to_amount : t.amount);
        sortedTxIdx++;
      }

      const isFuture = month > `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      balanceByMonth.push({ ym: month, label: monthLabel(month), balance: isFuture ? null : cumBalance });
    }

    // Compute linear target path
    const startMonth = months[0];
    const deadlineMonth = deadline ? deadline.slice(0, 7) : months[months.length - 1];
    const totalMonths = months.indexOf(deadlineMonth) >= 0 ? months.indexOf(deadlineMonth) + 1 : months.length;
    const startBalance = initialBalance;
    const monthlyTargetIncrease = totalMonths > 1 ? (target - startBalance) / (totalMonths - 1) : 0;

    const targetByMonth = months.map((m, i) => {
      if (i >= totalMonths) return target;
      return startBalance + monthlyTargetIncrease * i;
    });

    // Current values
    const currentMonthYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const latestData = [...balanceByMonth].reverse().find(m => m.balance !== null);
    const currentBalance = latestData ? latestData.balance : initialBalance;
    const pctComplete = target > 0 ? (currentBalance / target * 100) : 0;

    // Expected balance now (on the linear path)
    const currentMonthIdx = months.indexOf(currentMonthYM);
    const expectedNow = currentMonthIdx >= 0 ? targetByMonth[currentMonthIdx] : target;
    const aheadBehind = currentBalance - expectedNow;

    // Remaining monthly rate needed
    const remainingMonths = months.filter(m => m > currentMonthYM && m <= deadlineMonth).length;
    const neededMonthlyRate = remainingMonths > 0 ? (target - currentBalance) / remainingMonths : 0;

    // Ahead/behind in months
    let aheadMonths = 0;
    if (aheadBehind > 0 && monthlyTargetIncrease > 0) {
      aheadMonths = aheadBehind / monthlyTargetIncrease;
    } else if (aheadBehind < 0 && monthlyTargetIncrease > 0) {
      aheadMonths = aheadBehind / monthlyTargetIncrease;
    }

    const content = document.getElementById('sgh-content');
    const paceN = Math.abs(aheadMonths).toFixed(1);
    const paceText = aheadBehind >= 0
      ? t('reports.savingsGoalsHistory.tile.pace_ahead', { n: paceN }, `${paceN} months ahead`)
      : t('reports.savingsGoalsHistory.tile.pace_behind', { n: paceN }, `${paceN} months behind`);
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.savingsGoalsHistory.section.title', { name: escapeHtml(goal.name), currency }, `${escapeHtml(goal.name)} — ${currency}`)}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.savingsGoalsHistory.tile.current_target', {}, 'Current / Target')}</div>
            <div class="ic-value">${formatCurrency(currentBalance, currency)}</div>
            <div class="ic-count">${t('reports.savingsGoalsHistory.tile.current_target_sub', { target: formatCurrency(target, currency), pct: pctComplete.toFixed(1) }, `of ${formatCurrency(target, currency)} (${pctComplete.toFixed(1)}%)`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${aheadBehind >= 0 ? t('reports.savingsGoalsHistory.tile.ahead', {}, 'Ahead of Schedule') : t('reports.savingsGoalsHistory.tile.behind', {}, 'Behind Schedule')}</div>
            <div class="ic-value" style="color:${aheadBehind >= 0 ? 'var(--positive)' : 'var(--negative)'}">
              ${aheadBehind >= 0 ? '+' : ''}${formatCurrency(aheadBehind, currency)}
            </div>
            <div class="ic-count">${paceText}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.savingsGoalsHistory.tile.needed_rate', {}, 'Needed Monthly Rate')}</div>
            <div class="ic-value">${remainingMonths > 0 ? formatCurrency(neededMonthlyRate, currency) : t('reports.savingsGoalsHistory.tile.target_reached', {}, 'Target reached!')}</div>
            <div class="ic-count">${remainingMonths > 0 ? t('reports.savingsGoalsHistory.tile.months_remaining', { n: remainingMonths }, `${remainingMonths} months remaining`) : deadline ? t('reports.savingsGoalsHistory.tile.deadline', { date: deadline }, `Deadline: ${deadline}`) : ''}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.savingsGoalsHistory.chart.title', {}, 'Balance vs. Target Path')}</div>
          <div class="chart-canvas-box" style="height:340px;"><canvas id="sgh-line-chart"></canvas></div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.savingsGoalsHistory.section.monthly_detail', {}, 'Monthly Detail')}</div>
        <table class="tx-table">
          <thead><tr>
            <th>${t('common.label.month', {}, 'Month')}</th>
            <th class="amt">${t('reports.savingsGoalsHistory.col.balance', {}, 'Balance')}</th>
            <th class="amt">${t('reports.savingsGoalsHistory.col.delta_prior', {}, 'Δ vs. Prior')}</th>
            <th class="amt">${t('reports.savingsGoalsHistory.col.target', {}, 'Target')}</th>
            <th class="amt">${t('reports.savingsGoalsHistory.col.deviation', {}, 'Deviation')}</th>
          </tr></thead>
          <tbody>
            ${[...balanceByMonth].reverse().filter(m => m.balance !== null).map((m, i, arr) => {
              const prev = arr[i + 1];
              const delta = prev ? m.balance - prev.balance : m.balance - initialBalance;
              const mIdx = months.indexOf(m.ym);
              const tgt = targetByMonth[mIdx] || 0;
              const dev = m.balance - tgt;
              return `<tr>
                <td>${m.label}</td>
                <td class="amt">${formatCurrency(m.balance, currency)}</td>
                <td class="amt" style="color:${delta >= 0 ? 'var(--positive)' : 'var(--negative)'}">${delta >= 0 ? '+' : ''}${formatCurrency(delta, currency)}</td>
                <td class="amt">${formatCurrency(tgt, currency)}</td>
                <td class="amt" style="color:${dev >= 0 ? 'var(--positive)' : 'var(--negative)'}; font-weight:500">${dev >= 0 ? '+' : ''}${formatCurrency(dev, currency)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Dual-line chart: actual vs target
    const chartCtx = document.getElementById('sgh-line-chart');
    if (chartCtx) {
      const actualData = balanceByMonth.map(m => m.balance);
      const targetData = targetByMonth.slice(0, months.length);
      const labels = balanceByMonth.map(m => m.label);

      // Build fill dataset for deviation area
      const chart = new Chart(chartCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: t('reports.savingsGoalsHistory.dataset.actual', {}, 'Actual Balance'),
              data: actualData,
              borderColor: '#1e40af',
              backgroundColor: 'rgba(30,64,175,0.08)',
              fill: false,
              tension: 0.3,
              pointRadius: 3,
              pointHoverRadius: 6,
              borderWidth: 2.5,
              spanGaps: false,
            },
            {
              label: t('reports.savingsGoalsHistory.dataset.target_path', {}, 'Target Path'),
              data: targetData,
              borderColor: '#9ca3af',
              borderDash: [6, 4],
              borderWidth: 2,
              pointRadius: 0,
              fill: false,
              tension: 0,
            },
            {
              label: t('reports.savingsGoalsHistory.dataset.target_100', {}, 'Target (100%)'),
              data: months.map(() => target),
              borderColor: 'rgba(16,185,129,0.3)',
              borderDash: [3, 6],
              borderWidth: 1,
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } },
            },
            tooltip: {
              callbacks: {
                label: ctx => {
                  if (ctx.raw == null) return null;
                  return ctx.dataset.label + ': ' + formatCurrency(ctx.raw, currency) + ' ' + currency;
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } },
            y: {
              grid: { color: cssVar('--chart-grid') },
              ticks: { callback: v => formatCurrency(v, currency) },
            },
          },
          interaction: { mode: 'index', intersect: false },
        },
      });
      reportCharts.push(chart);
    }
  }

  goalEl.addEventListener('change', update);
  update();
}

// ─── Cost of Living Report ──────────────────────────────────────────────

function renderCostOfLivingReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const custodyAliases = getCustodyAliases();
  const nonPnl = getNonPnlCategories();

  const currencies = ['TZS', 'EUR', 'USD'];
  const savedMode = out.getAttribute('data-col-mode') || 'monthly';
  const savedYear = out.getAttribute('data-col-year') || years[years.length - 1] || '2026';
  const savedCur = out.getAttribute('data-col-cur') || 'TZS';

  // Cost-of-living filter lives in core.js (isCostOfLivingTx + helpers)
  // so the Runway report can reuse the exact same definition.

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.col.toolbar.mode', {}, 'Mode')}</label>
        <select id="col-mode">
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.col.toolbar.monthly', {}, 'Monthly')}</option>
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.col.toolbar.yearly', {}, 'Yearly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="col-year">
          ${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="col-cur">
          ${currencies.map(c => `<option value="${c}" ${c === savedCur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div id="col-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('col-mode');
  const yearEl = document.getElementById('col-year');
  const curEl = document.getElementById('col-cur');

  // Cost of living category groups for breakdown.
  // label/desc are looked up lazily via t() so locale switches render immediately.
  const COL_GROUPS = [
    { key: 'groceries', match: c => c === 'Food:Groceries' || c === 'Food', color: '#22c55e' },
    { key: 'housing', match: c => c.startsWith('Bills:'), color: '#3b82f6' },
    { key: 'home', match: c => c.startsWith('Home:'), color: '#06b6d4' },
    { key: 'health', match: c => c.startsWith('Healthcare:') || c === 'Healthcare', color: '#ef4444' },
    { key: 'transport', match: c => c.startsWith('Transport') || (c.startsWith('Automobile:') && c !== 'Automobile:Purchase'), color: '#f59e0b' },
    { key: 'subscriptions', match: c => c.startsWith('Subscriptions:'), color: '#8b5cf6' },
    { key: 'leisure', match: c => c.startsWith('Leisure') || c === 'Leisure', color: '#ec4899' },
    { key: 'personal', match: c => c.startsWith('Personal:'), color: '#a855f7' },
    { key: 'kids', match: c => c.startsWith('Kids:') || c === 'Kids', color: '#f97316' },
    { key: 'pet', match: c => c.startsWith('Pet:') || c === 'Pet', color: '#84cc16' },
    { key: 'other', match: () => true, color: '#6b7280' },
  ];
  const colGroupLabel = k => t(`reports.col.group.${k}.label`, {}, k);
  const colGroupDesc = k => t(`reports.col.group.${k}.desc`, {}, '');

  function classifyGroup(cat) {
    for (const g of COL_GROUPS) {
      if (g.match(cat)) return g.key;
    }
    return 'other';
  }

  function update() {
    out.setAttribute('data-col-mode', modeEl.value);
    out.setAttribute('data-col-year', yearEl.value);
    out.setAttribute('data-col-cur', curEl.value);
    yearEl.style.display = modeEl.value === 'yearly' ? 'none' : '';
    destroyReportCharts();

    const currency = curEl.value;
    const colTx = state.tx
      .filter(t => isCostOfLivingTx(t, custodyAliases, nonPnl))
      .map(t => ({ ...t, amount: convertTo(t.amount, t.currency, currency) }));

    if (modeEl.value === 'monthly') renderColMonthly(colTx, yearEl.value, currency);
    else renderColYearly(colTx, currency);
  }

  function renderColMonthly(tx, year, currency) {
    const yearTx = tx.filter(t => t.date && t.date.startsWith(year));

    // Detect visit months: any month where a TX has a tag containing "Visit"
    const visitMonths = new Set();
    for (const t of state.tx) {
      if (!t.date || !t.date.startsWith(year)) continue;
      const tags = (t.tags || '').split(';');
      if (tags.some(tag => tag.includes('Visit'))) visitMonths.add(t.date.slice(0, 7));
    }

    const months = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      const monthTx = yearTx.filter(t => t.date.startsWith(ym));
      const row = { ym, label: monthLabel(ym), total: 0, count: monthTx.length, hasVisit: visitMonths.has(ym) };
      for (const g of COL_GROUPS) row[g.key] = 0;
      for (const t of monthTx) {
        row[classifyGroup(t.category)] += t.amount;
        row.total += t.amount;
      }
      months.push(row);
    }

    // Calculate visit-tagged spending per month
    for (const m of months) {
      m.visitSpend = 0;
      if (m.hasVisit) {
        for (const t of yearTx) {
          if (!t.date || !t.date.startsWith(m.ym)) continue;
          const tags = (t.tags || '').split(';');
          if (tags.some(tag => tag.includes('Visit'))) m.visitSpend += t.amount;
        }
      }
    }

    const grandTotal = months.reduce((s, m) => s + m.total, 0);
    const totalVisitSpend = months.reduce((s, m) => s + m.visitSpend, 0);
    const activeMonths = months.filter(m => m.total > 0).length;
    const avgPerMonth = activeMonths > 0 ? grandTotal / activeMonths : 0;
    const avgExclVisit = activeMonths > 0 ? (grandTotal - totalVisitSpend) / activeMonths : 0;

    // Group totals for pie + table
    const groupTotals = COL_GROUPS.map(g => ({
      ...g, total: months.reduce((s, m) => s + m[g.key], 0),
    })).filter(g => g.total > 0);

    // What was excluded
    const allExpTx = state.tx.filter(t =>
      t.type === 'expense' && t.date && t.date.startsWith(year) &&
      !custodyAliases.has(t.account) && !nonPnl.has(t.category)
    );
    const totalAllExp = allExpTx.reduce((s, t) => s + convertTo(t.amount, t.currency, currency), 0);
    const excludedTotal = totalAllExp - grandTotal;

    const names = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => t(`common.months.short.${m}`, {}, ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]));
    const content = document.getElementById('col-content');
    const excludedList = [...getNonEssentialCategories()].sort().map(c => escapeHtml(c)).join(' · ') || `<em>${t('reports.col.excluded.none', {}, 'none')}</em>`;
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.col.monthly.title', { year, currency }, `Cost of Living ${year} (${currency})`)}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.col.tile.living', {}, 'Living Expenses')}</div>
            <div class="ic-value" style="color:#3b82f6">${formatCurrency(grandTotal, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.col.tile.living_sub', { count: yearTx.length }, `${yearTx.length} TX`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.col.tile.avg', {}, 'Avg / Month')}</div>
            <div class="ic-value">${formatCurrency(avgPerMonth, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.col.tile.avg_sub', { n: activeMonths }, `${activeMonths} active months`)}</div>
          </div>
          ${visitMonths.size > 0 ? `<div class="income-cell">
            <div class="ic-label">${t('reports.col.tile.avg_no_visitors', {}, 'Avg excl. Visitors')}</div>
            <div class="ic-value" style="color:#059669">${formatCurrency(avgExclVisit, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.col.tile.avg_no_visitors_sub', { amt: formatCurrency(totalVisitSpend, currency) }, `${formatCurrency(totalVisitSpend, currency)} visitor spending removed`)}</div>
          </div>` : ''}
          <div class="income-cell">
            <div class="ic-label" style="color:var(--muted)">${t('reports.col.tile.excluded', {}, 'Excluded')}</div>
            <div class="ic-value" style="color:var(--muted)">${formatCurrency(excludedTotal, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.col.tile.excluded_sub', {}, 'Dining, Staff, Permits, Fines, Purchase, Loans, Cash Diff')}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.col.chart.stack', {}, 'Monthly Breakdown by Category')}</div>
            <div class="chart-canvas-box"><canvas id="col-stack-chart"></canvas></div>
          </div>
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.col.chart.pie', {}, 'Category Distribution')}</div>
            <div class="chart-canvas-box"><canvas id="col-pie-chart"></canvas></div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.col.chart.trend', {}, 'Monthly Total Trend')}</div>
          <div class="chart-canvas-box"><canvas id="col-trend-chart"></canvas></div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.col.section.monthly_detail', { currency }, `Monthly Detail (${currency})`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table" style="white-space:nowrap;">
          <thead><tr>
            <th>${t('common.label.month', {}, 'Month')}</th>
            ${groupTotals.map(g => `<th style="text-align:right;" title="${escapeHtml(colGroupDesc(g.key))}"><span style="border-bottom:1px dotted var(--muted);cursor:help;">${colGroupLabel(g.key)}</span></th>`).join('')}
            <th style="text-align:right;font-weight:700;">${t('reports.col.col.total', {}, 'Total')}</th>
          </tr></thead>
          <tbody>
            ${months.map(m => `<tr style="${m.hasVisit ? 'background:var(--warning-bg, rgba(245,158,11,0.08));' : ''}">
              <td>${m.label}${m.hasVisit ? ` <span title="${t('reports.col.visitor.marker_title', {}, 'Visitor month')}" style="color:#f59e0b;font-size:10px;">&#9679;</span>` : ''}</td>
              ${groupTotals.map(g => `<td class="amt" style="color:${g.color}">${formatCurrency(m[g.key], currency)}</td>`).join('')}
              <td class="amt" style="font-weight:700;">${formatCurrency(m.total, currency)}</td>
            </tr>`).join('')}
            <tr style="font-weight:700;border-top:2px solid var(--border);">
              <td>${t('reports.col.row.total', {}, 'Total')}</td>
              ${groupTotals.map(g => `<td class="amt" style="color:${g.color}">${formatCurrency(g.total, currency)}</td>`).join('')}
              <td class="amt">${formatCurrency(grandTotal, currency)}</td>
            </tr>
          </tbody>
        </table></div>
      </div>
      <div class="report-section">
        <details class="c-mut2" style="font-size:12px;line-height:1.5;">
          <summary style="cursor:pointer;font-weight:600;color:var(--text);">${t('reports.col.legend.title', {}, 'What counts in each column?')}</summary>
          <div style="margin-top:8px;">
            ${COL_GROUPS.map(g => `<div style="padding:3px 0;"><strong style="color:${g.color};">${colGroupLabel(g.key)}:</strong> ${escapeHtml(colGroupDesc(g.key))}</div>`).join('')}
            <div style="margin-top:8px;opacity:0.8;"><em>${t('reports.col.legend.footer', {}, 'Hover a column header in the tables above for the same info inline.')}</em></div>
          </div>
        </details>
        <div class="report-section-title" style="color:var(--muted);font-size:0.85em;margin-top:12px;">${t('reports.col.excluded.monthly_line', { list: excludedList }, `Excluded (non-essential, from Settings → Categories): ${excludedList}`)}</div>
        ${visitMonths.size > 0 ? `<div style="color:var(--muted);font-size:0.85em;margin-top:6px;">
          <span style="color:#f59e0b;">&#9679;</span> ${t('reports.col.visitor.line_prefix', {}, 'Visitor months:')} ${months.filter(m => m.hasVisit).map(m => t('reports.col.visitor.line_cell', { month: m.label, amt: formatCurrency(m.visitSpend, currency) }, `${m.label} (${formatCurrency(m.visitSpend, currency)} visitor-tagged)`)).join(' · ')}
          ${t('reports.col.visitor.line_suffix', {}, '— "Avg excl. Visitors" subtracts only Visit-tagged TX, not the entire month.')}
        </div>` : ''}
      </div>
    `;

    // Stacked bar
    const stackCtx = document.getElementById('col-stack-chart');
    if (stackCtx) {
      const chart = new Chart(stackCtx, {
        type: 'bar',
        data: {
          labels: names,
          datasets: groupTotals.map(g => ({
            label: colGroupLabel(g.key),
            data: months.map(m => m[g.key]),
            backgroundColor: g.color,
            borderWidth: 0,
          })),
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, currency)} ${currency}` } },
          },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }

    // Doughnut
    const pieCtx = document.getElementById('col-pie-chart');
    if (pieCtx) {
      const chart = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
          labels: groupTotals.map(g => colGroupLabel(g.key)),
          datasets: [{ data: groupTotals.map(g => g.total), backgroundColor: groupTotals.map(g => g.color), borderWidth: 0 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.label}: ${formatCurrency(c.raw, currency)} ${currency} (${(c.raw / grandTotal * 100).toFixed(1)}%)` } },
          },
        },
      });
      reportCharts.push(chart);
    }

    // Trend line
    const trendCtx = document.getElementById('col-trend-chart');
    if (trendCtx) {
      const chart = new Chart(trendCtx, {
        type: 'line',
        data: {
          labels: names,
          datasets: [{
            label: t('reports.col.dataset.label', {}, 'Cost of Living'),
            data: months.map(m => m.total),
            borderColor: '#3b82f6',
            backgroundColor: '#3b82f620',
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
            tooltip: { callbacks: { label: c => `${formatCurrency(c.raw, currency)} ${currency}` } },
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

  function renderColYearly(tx, currency) {
    const allYears = getAvailableYears();

    const data = allYears.map(y => {
      const yearTx = tx.filter(t => t.date && t.date.startsWith(y));
      const row = { year: y, total: 0, count: yearTx.length };
      for (const g of COL_GROUPS) row[g.key] = 0;
      for (const t of yearTx) {
        row[classifyGroup(t.category)] += t.amount;
        row.total += t.amount;
      }
      return row;
    });

    const groupTotals = COL_GROUPS.map(g => ({
      ...g, total: data.reduce((s, d) => s + d[g.key], 0),
    })).filter(g => g.total > 0);

    const content = document.getElementById('col-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.col.yearly.title', { currency }, `Cost of Living by Year (${currency})`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table" style="white-space:nowrap;">
          <thead><tr>
            <th>${t('common.col.year', {}, 'Year')}</th>
            ${groupTotals.map(g => `<th style="text-align:right;" title="${escapeHtml(colGroupDesc(g.key))}"><span style="border-bottom:1px dotted var(--muted);cursor:help;">${colGroupLabel(g.key)}</span></th>`).join('')}
            <th style="text-align:right;font-weight:700;">${t('reports.col.col.total', {}, 'Total')}</th>
            <th style="text-align:right;">${t('reports.col.col.avg_month', {}, 'Avg/Month')}</th>
          </tr></thead>
          <tbody>
            ${data.map(d => {
              const activeMonths = Math.max(1, d.year === new Date().getFullYear().toString() ? new Date().getMonth() + 1 : 12);
              return `<tr>
              <td style="font-weight:500;">${d.year}</td>
              ${groupTotals.map(g => `<td class="amt" style="color:${g.color}">${formatCurrency(d[g.key], currency)}</td>`).join('')}
              <td class="amt" style="font-weight:700;">${formatCurrency(d.total, currency)}</td>
              <td class="amt" style="color:var(--muted);">${formatCurrency(d.total / activeMonths, currency)}</td>
            </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.col.chart.year_stack', {}, 'Yearly Breakdown')}</div>
            <div class="chart-canvas-box"><canvas id="col-year-stack"></canvas></div>
          </div>
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.col.chart.year_trend', {}, 'Total Cost of Living Trend')}</div>
            <div class="chart-canvas-box"><canvas id="col-year-trend"></canvas></div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title" style="color:var(--muted);font-size:0.85em;">${t('reports.col.excluded.yearly_line', {}, 'Excluded: Dining out · Staff · Permits · Fines · Travel · Car Purchase · Loans · Cash Discrepancy')}</div>
      </div>
    `;

    const stackCtx = document.getElementById('col-year-stack');
    if (stackCtx) {
      const chart = new Chart(stackCtx, {
        type: 'bar',
        data: {
          labels: data.map(d => d.year),
          datasets: groupTotals.map(g => ({
            label: colGroupLabel(g.key),
            data: data.map(d => d[g.key]),
            backgroundColor: g.color,
            borderWidth: 0,
          })),
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, currency)} ${currency}` } },
          },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }

    const trendCtx = document.getElementById('col-year-trend');
    if (trendCtx) {
      const chart = new Chart(trendCtx, {
        type: 'line',
        data: {
          labels: data.map(d => d.year),
          datasets: [{
            label: t('reports.col.dataset.label', {}, 'Cost of Living'),
            data: data.map(d => d.total),
            borderColor: '#3b82f6',
            backgroundColor: '#3b82f620',
            fill: true,
            tension: 0.3,
            pointRadius: 5,
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${formatCurrency(c.raw, currency)} ${currency}` } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: { callback: v => formatCurrency(v, currency) }, grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  curEl.addEventListener('change', update);
  update();
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
  const curColors = { EUR: '#3b82f6', USD: '#10b981', PLN: '#f59e0b', TRY: '#ef4444' };

  const savedCur = out.getAttribute('data-fxh-cur') || 'all';
  const savedRange = out.getAttribute('data-fxh-range') || '12m';

  // Determine available year range
  const firstYear = parseInt(fxHistory[0].date.slice(0, 4));
  const lastYear = parseInt(fxHistory[fxHistory.length - 1].date.slice(0, 4));
  const rangeOptions = [
    { value: '3m', label: t('reports.fxh.range.3m', {}, 'Last 3 Months') },
    { value: '6m', label: t('reports.fxh.range.6m', {}, 'Last 6 Months') },
    { value: '12m', label: t('reports.fxh.range.12m', {}, 'Last 12 Months') },
  ];
  for (let y = lastYear; y >= firstYear; y--) rangeOptions.push({ value: String(y), label: String(y) });
  rangeOptions.push({ value: 'all', label: t('reports.fxh.range.all', {}, 'All Time') });

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.currency', {}, 'Currency')}</label>
        <select id="fxh-cur">
          <option value="all" ${savedCur === 'all' ? 'selected' : ''}>${t('reports.fxh.currencies.all', {}, 'All Currencies')}</option>
          ${currencies.map(c => `<option value="${c}" ${savedCur === c ? 'selected' : ''}>${curLabels[c]} (${c})</option>`).join('')}
        </select>
        <label>${t('reports.fxh.toolbar.period', {}, 'Period')}</label>
        <select id="fxh-range">
          ${rangeOptions.map(o => `<option value="${o.value}" ${savedRange === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
      <div id="fxh-content"></div>
    </div>
  `;

  const curEl = document.getElementById('fxh-cur');
  const rangeEl = document.getElementById('fxh-range');

  function update() {
    out.setAttribute('data-fxh-cur', curEl.value);
    out.setAttribute('data-fxh-range', rangeEl.value);
    destroyReportCharts();

    const selectedCurs = curEl.value === 'all' ? currencies : [curEl.value];

    // Filter data by range
    let data = fxHistory;
    const rangeVal = rangeEl.value;
    if (rangeVal === '3m' || rangeVal === '6m' || rangeVal === '12m') {
      const nDays = rangeVal === '3m' ? 90 : rangeVal === '6m' ? 180 : 365;
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - nDays);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
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
        <div class="table-scroll-wrapper"><table class="tx-table" style="white-space:nowrap;">
          <thead><tr>
            <th>${t('common.label.month', {}, 'Month')}</th>
            ${selectedCurs.map(c => `<th style="text-align:right;">${c}</th>`).join('')}
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
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: selectedCurs.length > 1, position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, 'TZS')}` } },
          },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: cssVar('--chart-grid') } },
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
              borderColor: changes.map(v => v >= 0 ? '#22c55e' : '#ef4444'),
              borderWidth: 1,
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
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

  curEl.addEventListener('change', update);
  rangeEl.addEventListener('change', update);
  update();
}

// ─── Cash Discrepancy Report ─────────────────────────────────────────────

function renderCashDiscrepancyReport() {
  const out = document.getElementById('report-output');
  const currency = state.primaryCurrency;

  // All Cash Discrepancy transactions (both expense and income side)
  const discTx = state.tx.filter(t =>
    (t.category === 'Other Expenses:Cash Discrepancy' || t.category === 'Income:Cash Discrepancy')
  ).map(t => ({ ...t, amountConv: convertToTZS(t.amount, t.currency) }));

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
      <div class="month-summary" style="margin-bottom:16px;">
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

      <h4 style="margin-top:16px;">${t('reports.cashdisc.section.yearly', {}, 'Per Year')}</h4>
      <div class="table-wrap">
        <table class="tx-table">
          <thead><tr><th>${t('reports.cashdisc.col.year', {}, 'Year')}</th><th>${t('reports.cashdisc.col.count', {}, 'Count')}</th><th>${t('reports.cashdisc.col.shortfall', {}, 'Shortfalls')}</th><th>${t('reports.cashdisc.col.surplus', {}, 'Surpluses')}</th><th>${t('reports.cashdisc.col.net', {}, 'Net')}</th></tr></thead>
          <tbody>${yearRows || `<tr><td colspan="5" class="c-mut2">${emptyMsg}</td></tr>`}</tbody>
        </table>
      </div>

      <h4 style="margin-top:24px;">${t('reports.cashdisc.section.detail', {}, 'Single Bookings')}</h4>
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
// through accounts (kft/kfu/ksdu) contribute both the expense leg and the
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

// Return the next occurrence date strictly AFTER `fromDate` for the given
// frequency string. Mirrors scripts/cron_sched.py:calculate_next_run logic.
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

// Three income categories that are modeled separately via user-adjustable
// occurrence counts (since they're lumpy and don't fit a smooth rolling avg).
const CASHFORECAST_SPECIAL_INCOME = [
  { cat: 'Income:ExampleCo Dividends', key: 'div', label: 'Dividends' },
  { cat: 'Income:ExampleCo Reimbursement', key: 'reimb', label: 'K-Reimbursements' },
  { cat: 'Income:Interest', key: 'int', label: 'Interest' },
];

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
  const userCounts = { div: readCount('div'), reimb: readCount('reimb'), int: readCount('int') };

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
  const SPECIAL_CAT_SET = new Set(CASHFORECAST_SPECIAL_INCOME.map(s => s.cat));

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
  // Pass-through volume: amount flowing through PT accounts (ExampleCo/KSD),
  // which nets to 0 cashflow but useful to see separately for planning.
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
  // The projection baseline models LEON's personal cashflow, so we exclude
  // pass-through accounts (ExampleCo/KSD business flow) — those are already
  // surfaced separately in the Pass-Through Volume section and don't
  // affect Leon's real bank balance.
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
  for (const s of CASHFORECAST_SPECIAL_INCOME) specialStats[s.cat] = { amounts: [], count: 0 };

  for (const t of (state.tx || [])) {
    if (!t.date) continue;
    const ym = t.date.slice(0, 7);
    if (!monthSet24.has(ym)) continue;
    if (!isOperationalTx(t, custodyAliases, nonPnlCats)) continue;
    if (ptAliases.has(t.account)) continue; // ExampleCo/KSD flow, not Leon's cashflow
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
  const specialInfo = CASHFORECAST_SPECIAL_INCOME.map(s => {
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
          <label style="font-size:11px;color:var(--muted);">${info.label}</label>
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="number" min="0" max="50" step="1" class="cf-input" data-key="${info.key}" value="${info.appliedCount}" style="width:64px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);">
            <span class="c-mut2" style="font-size:11px;">
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
    ? `<div class="report-section"><div class="c-mut2" style="font-size:12px;">Skipped (unrecognized frequency): ${invalidFreq.map(s => escapeHtml(s.sched_id + ' ' + (s.frequency || ''))).join(', ')}</div></div>`
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
          <summary style="cursor:pointer;font-weight:600;color:var(--text);">How this forecast is calculated</summary>
          <div style="margin-top:8px;">
            <strong>Starting point:</strong> ${formatCurrency(startingBalance, cur)} ${cur} — the sum of your own active non-pass-through accounts right now, converted to ${cur}.<br><br>
            <strong>① Scheduled layer (solid line):</strong> ${active.length} active scheduled templates expanded forward over 90 days — concrete, dated, certain events. Pass-through templates count both legs (expense + auto-reimbursement) so their net cashflow is zero. Income direction is derived from the category's type.<br><br>
            <strong>② Projection layer (dashed line):</strong> adds a statistical baseline on top of the Scheduled layer for categories NOT already covered by a scheduled template. Specifically:
            <ul style="margin:4px 0 4px 20px;padding:0;">
              <li><strong>Expenses:</strong> median of the last 12 months' totals per calendar month (so May uses May-history median for seasonal realism). Excludes pass-through accounts (ExampleCo/KSD business flow isn't your cashflow), ${scheduledCats.size} category already covered by active scheduled templates, and the 3 special income categories. Overall median ${formatCurrency(overallExpMedian, cur)} ${cur}/mo.</li>
              <li><strong>Variable income:</strong> same seasonal-median treatment, overall median ${formatCurrency(overallIncMedian, cur)} ${cur}/mo.</li>
              <li><strong>Special income (user-adjustable above):</strong> ${specialInfo.map(i => `${i.label} ${i.appliedCount}× @ ${formatCurrency(i.medianAmount, cur)}`).join(' · ')}. Median amount computed from last 12 months of each category; count defaults are proportional to horizon but you can override.</li>
            </ul>
            <strong>③ Confidence band:</strong> shaded area = realistic range where your expenses could fall within historical variance. Upper bound uses P25 monthly expenses (optimistic months), lower bound uses P75 (pessimistic months). P25 ${formatCurrency(overallExpP25, cur)} · P75 ${formatCurrency(overallExpP75, cur)} ${cur}/mo.<br><br>
            <strong>Not counted in cashflow:</strong> pass-through TX (ExampleCo/KSD money, shown separately below · Volume section). They don't affect your personal bank balance even though they run through your pass-through accounts.<br><br>
            <strong>Essential vs. luxury:</strong> not used in this report (this is a cashflow forecast, not an essentials-only view). For the essentials-only runway analysis, see the Cash Runway report.
          </div>
        </details>
      </div>
      ${ptVolume[90].count > 0 ? `
      <div class="report-section">
        <div class="report-section-title">Pass-Through Volume <span class="hint">ExampleCo/KSD flow — not counted in cashflow above</span></div>
        <div class="income-grid">
          ${[30, 60, 90].map(h => {
            const pv = ptVolume[h];
            const accList = Object.entries(pv.byAccount).sort((a, b) => b[1] - a[1])
              .map(([a, v]) => `${escapeHtml(a)} ${formatCurrency(v, cur)}`).join(' · ');
            return `
              <div class="income-cell">
                <div class="ic-label">${h} days</div>
                <div class="ic-value" style="color:var(--muted);">${formatCurrency(pv.total, cur)}<span class="ic-cur">${cur}</span></div>
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
                <td><strong>${escapeHtml(r.name)}</strong>${r.isPT ? ' <span class="tag">pass-through</span>' : r.isIncome ? ' <span class="tag" style="color:var(--positive);">income</span>' : ''}</td>
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
      out.removeAttribute('data-cf-div');
      out.removeAttribute('data-cf-reimb');
      out.removeAttribute('data-cf-int');
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
            borderColor: 'rgba(14, 165, 233, 0.25)',
            backgroundColor: 'transparent',
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
          },
          {
            label: 'Pessimistic (P75 expenses)',
            data: cumPessimistic,
            borderColor: 'rgba(14, 165, 233, 0.25)',
            backgroundColor: 'rgba(14, 165, 233, 0.12)',
            borderWidth: 1,
            pointRadius: 0,
            fill: '-1',
            tension: 0.15,
          },
          {
            label: 'Scheduled only',
            data: cumScheduled,
            borderColor: '#8b5cf6',
            backgroundColor: 'transparent',
            borderWidth: 2,
            fill: false,
            tension: 0.15,
            pointRadius: dailyNet.map(n => n !== 0 ? 4 : 0),
            pointBackgroundColor: dailyNet.map(n => n > 0 ? '#10b981' : n < 0 ? '#e8453c' : 'transparent'),
            pointBorderColor: 'transparent',
          },
          {
            label: 'With projection (median)',
            data: cumProjected,
            borderColor: '#0ea5e9',
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
        responsive: true,
        maintainAspectRatio: false,
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
            ticks: { callback: v => formatCurrency(v, cur) },
            grid: {
              color: (c) => c.tick.value === 0 ? 'rgba(232, 69, 60, 0.5)' : cssVar('--chart-grid'),
              lineWidth: (c) => c.tick.value === 0 ? 2 : 1,
            },
          },
        },
      },
    });
    reportCharts.push(chart);
  }
}


boot();
