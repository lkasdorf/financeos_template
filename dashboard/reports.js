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
    desc: 'All expenses tagged House_A_costs — monthly and yearly',
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
    desc: 'Restaurant visits — personal vs. business split, top restaurants, monthly trends',
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
    desc: 'Business expenses (any BUSINESS_* tag) vs. personal — adjusted cashflow view',
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
  {
    id: 'budgetactual',
    category: 'Overview',
    title: 'Budget vs. Actual',
    desc: 'Per-category spending against monthly budgets — variance, over-budget alerts, current/last month/YTD/year views',
    render: renderBudgetActualReport,
  },
];

// Per-entity Business Reimbursements reports — generated from
// config/businesses.json so each configured entity gets its own card. With
// no entities (public-template default) the section is empty and the report
// list shows only the static REPORTS above. Entity-specific titles/descs
// avoid an i18n round-trip and stay correct as forks add their own labels.
function getBusinessReimbursementReports() {
  return getBusinessEntities().map(e => ({
    id: `business-reimb-${e.id}`,
    category: 'Business',
    title: t('reports.kf.list.title', { label: e.label }, `${e.label} Reimbursements`),
    desc: t('reports.kf.list.desc', { label: e.label }, `All pass-through expenses via ${e.label} accounts — monthly totals, categories, open items`),
    render: () => renderBusinessReimbursementsReport(e.id),
  }));
}

// Returns the static REPORTS array merged with the dynamic per-entity
// reimbursement reports. All consumers (list rendering, lookup-by-id, export
// filename derivation) must use this helper so dynamic entries stay in sync.
function getAllReports() {
  return [...REPORTS, ...getBusinessReimbursementReports()];
}

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

  // Group built-in reports + dynamic per-entity reports by category
  const categories = {};
  for (const r of getAllReports()) {
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
    const res = await fetch('/api/custom-reports/list', { method: 'POST' });
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
  const totalCount = getAllReports().length + customCount;
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


function renderReportDetail() {
  const report = getAllReports().find(r => r.id === activeReportId);
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

