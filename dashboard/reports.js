// ─── Reports Engine ──────────────────────────────────────────────────────

// Helper: build a report descriptor with i18n-aware getters for title and desc.
// `t()` is called at render time so locale switches re-translate without
// rebuilding the array. Keys: reports.list.<id>.{title,desc}. The English
// strings here are the fallback used when the key is missing.
function _r(id, category, render, title, desc) {
  return {
    id, category, render,
    get title() { return t(`reports.list.${id}.title`, {}, title); },
    get desc()  { return t(`reports.list.${id}.desc`,  {}, desc); },
  };
}

const REPORTS = [
  _r('income', 'Income', renderIncomeReport,
    'Income Analysis',
    'Monthly and yearly income breakdown with charts — real income vs. reimbursements'),
  _r('incexp', 'Income', renderIncExpReport,
    'Income vs. Expense Summary',
    'Side-by-side comparison of income and expenses with net balance — monthly and yearly'),
  _r('household', 'Expenses', renderHouseholdReport,
    'Household Costs',
    'All expenses tagged Household_costs — monthly and yearly'),
  _r('bills', 'Expenses', renderBillsReport,
    'Bills Overview',
    'Rent, electricity, water & internet — total and per category breakdown'),
  _r('ai', 'Expenses', renderAICostsReport,
    'AI Costs',
    'Subscriptions:AI spending — monthly and yearly breakdown with charts'),
  _r('automobile', 'Expenses', renderAutomobileReport,
    'Automobile Costs',
    'All vehicle expenses — petrol, maintenance, toll, parking, insurance, purchases'),
  _r('dining', 'Expenses', renderDiningReport,
    'Dining Out',
    'Restaurant visits — personal vs. business split, top restaurants, monthly trends'),
  _r('catbreakdown', 'Expenses', renderCategoryBreakdownReport,
    'Category Breakdown',
    'Expense distribution across all categories — treemap view, monthly and yearly'),
  _r('balances', 'Overview', renderBalancesReport,
    'Account Balances Over Time',
    'Running balance per account over time — line chart showing balance trajectory'),
  _r('toppayees', 'Overview', renderTopPayeesReport,
    'Top Payees',
    'Biggest payees by total spending — yearly ranking with charts'),
  _r('savingsrate', 'Overview', renderSavingsRateReport,
    'Savings Rate Trend',
    'Monthly savings rate (Income - Expenses) / Income — trend line over time'),
  _r('subscriptions', 'Expenses', renderSubscriptionReport,
    'Subscription Tracker',
    'All recurring subscriptions — AI, streaming, hosting, services — monthly fixed costs'),
  _r('weekday', 'Overview', renderWeekdayReport,
    'Weekday vs. Weekend',
    'Spending patterns by day of week — are weekends more expensive?'),
  _r('recurring', 'Expenses', renderRecurringReport,
    'Recurring Expense Tracker',
    'Month-over-month comparison of recurring bills and subscriptions — highlights price changes'),
  _r('vices', 'Expenses', renderViceSpendingReport,
    'Vice Spending',
    'Cigarettes, vaping & alcohol — monthly and yearly breakdown with category split'),
  _r('bankfees', 'Expenses', renderBankFeesReport,
    'Bank Fees',
    'All bank and transaction fees — ATM, transfer, card fees by account and month'),
  _r('cashdigital', 'Overview', renderCashDigitalReport,
    'Cash vs. Digital',
    'Spending split by payment method — cash vs. bank/mobile money/card over time'),
  _r('fxexposure', 'Overview', renderFXExposureReport,
    'FX Exposure',
    'Asset distribution across currencies — balance over time'),
  _r('monthcomp', 'Overview', renderMonthlyComparisonReport,
    'Monthly Comparison',
    'This month vs. last month — category-by-category delta analysis'),
  _r('networth', 'Overview', renderNetWorthTrendReport,
    'Net Worth Trend',
    'Total net worth (all currencies converted) over time — the single most important number'),
  _r('fixedvar', 'Overview', renderFixedVarReport,
    'Discretionary vs. Fixed',
    'Fixed costs (rent, bills, subscriptions) vs. variable spending — budget flexibility analysis'),
  _r('largest', 'Overview', renderLargestTxReport,
    'Largest Transactions',
    'Top single transactions by amount — outlier detection and anomaly review'),
  _r('bizpersonal', 'Business', renderBizPersonalReport,
    'Business vs. Personal',
    'Business expenses (any BUSINESS_* tag) vs. personal — adjusted cashflow view'),
  _r('seasonal', 'Overview', renderSeasonalReport,
    'Seasonal Heatmap',
    'Month × category heatmap across all years — spot seasonal spending patterns'),
  _r('runway', 'Overview', renderRunwayReport,
    'Cash Runway',
    'At current burn rate, how many months do savings last? Risk indicator with trend'),
  _r('cashforecast', 'Overview', renderCashflowForecastReport,
    'Cashflow Forecast',
    '90-day projection from current net worth — scheduled TX, seasonal expense median, special income, pass-through flow'),
  _r('expensetrend', 'Expenses', renderExpenseTrendReport,
    'Expense Trend Sparklines',
    'Top expense categories with 12-month sparkline trends and month-over-month change'),
  _r('incomesources', 'Income', renderIncomeSourcesReport,
    'Income Sources Breakdown',
    'Income diversification over time — salary, reimbursements, and other sources'),
  _r('debtoverview', 'Overview', renderDebtOverviewReport,
    'Debt Overview',
    'Open debts, repayment progress, net position, and payment history'),
  _r('yoy', 'Overview', renderYoYReport,
    'Year-over-Year Comparison',
    'Same month across different years — spot trends and anomalies'),
  _r('ptaudit', 'Business', renderPassThroughAuditReport,
    'Pass-Through Audit',
    'Verify pass-through accounts have matching counter-entries — flag missing or mismatched pairs'),
  _r('staffcosts', 'Expenses', renderStaffCostsReport,
    'Staff Costs',
    'All Staff: categories aggregated — salary, bonus, rent, teachers — monthly and yearly'),
  _r('savingsgoals', 'Overview', renderSavingsGoalsHistoryReport,
    'Savings Goals History',
    'Track savings goal progress over time — actual balance vs. linear target path with monthly detail'),
  _r('fxhistory', 'Overview', renderFxHistoryReport,
    'Exchange Rates History',
    'Historical monthly FX rates — every tracked currency against the primary currency with trend charts'),
  _r('costofliving', 'Overview', renderCostOfLivingReport,
    'Cost of Living',
    'Essential expenses only — excludes every category flagged as non-essential in Settings → Categories (discretionary/luxury)'),
  _r('cashdiscrepancy', 'Expenses', renderCashDiscrepancyReport,
    'Cash Discrepancy Log',
    'Cash-register corrections — shortages vs. surpluses, net balance per year, full transaction list'),
  _r('budgetactual', 'Overview', renderBudgetActualReport,
    'Budget vs. Actual',
    'Per-category spending against monthly budgets — variance, over-budget alerts, current/last month/YTD/year views'),
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

