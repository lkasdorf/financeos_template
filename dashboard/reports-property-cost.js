// ─── Cost of Living per Property Report ─────────────────────────────────
//
// Aggregates every TX carrying a property's cost_tag (auto-applied by
// utilities.py since v2026-05-10.9, plus the historical legacy-tag
// bridge backfilled by `scripts/utilities_tag_backfill.py`) into coarse
// buckets so the user can answer "what does this house cost me, warm?"
// without manually summing 30 categories.
//
// Backend lives at POST /api/properties/cost_overview — the report is a
// thin renderer over that response.

const PROPCOST_BUCKETS = [
  { id: 'rent',                  get color() { return chartPalette()[7]; }, getLabel: () => t('reports.propcost.bucket.rent', {}, 'Rent') },
  { id: 'service_charges',       get color() { return chartPalette()[1]; }, getLabel: () => t('reports.propcost.bucket.service_charges', {}, 'Service charges') },
  { id: 'utilities_electricity', get color() { return chartPalette()[0]; }, getLabel: () => t('reports.propcost.bucket.electricity', {}, 'Electricity') },
  { id: 'utilities_water',       get color() { return chartPalette()[3]; }, getLabel: () => t('reports.propcost.bucket.water', {}, 'Water') },
  { id: 'utilities_other',       get color() { return chartPalette()[8]; }, getLabel: () => t('reports.propcost.bucket.utilities_other', {}, 'Other utilities') },
  { id: 'maintenance',           get color() { return chartPalette()[2]; }, getLabel: () => t('reports.propcost.bucket.maintenance', {}, 'Maintenance') },
  { id: 'staff',                 get color() { return chartPalette()[5]; }, getLabel: () => t('reports.propcost.bucket.staff', {}, 'Staff') },
  { id: 'household',             get color() { return chartPalette()[6]; }, getLabel: () => t('reports.propcost.bucket.household', {}, 'Household') },
  { id: 'legal',                 get color() { return chartPalette()[4]; }, getLabel: () => t('reports.propcost.bucket.legal', {}, 'Legal & fees') },
  { id: 'other',                 get color() { return chartPalette()[9]; }, getLabel: () => t('reports.propcost.bucket.other', {}, 'Other') },
];

let _propCostState = {
  propertyId: null,
  year: 'all',
  data: null,
  chart: null,
};

async function renderCostPerPropertyReport() {
  // The reports framework (reports.js renderReportDetail) already
  // injected the title + description + Back/Export buttons into the
  // detail view; our renderer only needs to fill the inner #report-output.
  const root = document.getElementById('report-output');
  if (!root) return;
  root.innerHTML = `<div class="page-loading">${t('reports.propcost.loading', {}, 'Loading cost overview…')}</div>`;

  // Pre-load the property list so the selector can render before we
  // resolve the active property.
  let properties;
  try {
    const res = await fetch('/api/properties/list', { method: 'POST' });
    properties = (await res.json()).properties || [];
  } catch (err) {
    root.innerHTML = `<div class="error-banner">${escapeHtml(err.message)}</div>`;
    return;
  }
  if (!properties.length) {
    root.innerHTML = `<div class="empty-state">
      <h3>${escapeHtml(t('reports.propcost.empty.title', {}, 'No properties configured'))}</h3>
      <p>${escapeHtml(t('reports.propcost.empty.body', {}, 'Add a property via Settings → Properties to populate this report.'))}</p>
    </div>`;
    return;
  }

  // Persist the active property across visits so the user's last
  // selection survives navigation away and back.
  if (!_propCostState.propertyId) {
    const remembered = localStorage.getItem('financeos.propCost.propertyId');
    const exists = (id) => properties.some((p) => p.property_id === id);
    _propCostState.propertyId = exists(remembered) ? remembered : properties[0].property_id;
  }
  try {
    await _propCostFetch();
  } catch (err) {
    root.innerHTML = `<div class="error-banner">${escapeHtml(t('reports.propcost.error.api', { msg: err.message }, `Cost overview failed: ${err.message}. The server may need to be restarted to pick up the new /api/properties/cost_overview endpoint.`))}</div>`;
    return;
  }
  _propCostRender(properties);
}

async function _propCostFetch() {
  const res = await fetch('/api/properties/cost_overview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      property_id: _propCostState.propertyId,
      year: _propCostState.year === 'all' ? '' : _propCostState.year,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(text.slice(0, 200));
  }
  _propCostState.data = await res.json();
}

function _propCostRender(properties) {
  const root = document.getElementById('report-output');
  if (!root) return;
  const data = _propCostState.data || {};
  // DR-M1: this used to reference phantom globals (currentCurrency /
  // toDisplayCurrency) behind typeof-guards — the header currency
  // switcher silently never affected this report. The real core.js API
  // is displayCurrency + toDisplay(v, nativeCurrency); source data is
  // always TZS.
  const cur = displayCurrency;
  const sym = ({ TZS: 'TZS', EUR: '€', USD: '$' })[cur] || cur;
  const fmt = (v) => Math.round(toDisplay(v || 0, 'TZS')).toLocaleString(getLocaleTag());

  if (_propCostState.chart) {
    try { _propCostState.chart.destroy(); } catch (_) {}
    _propCostState.chart = null;
  }

  const propertyOptions = properties.map((p) => `
    <option value="${escapeHtml(p.property_id)}" ${p.property_id === _propCostState.propertyId ? 'selected' : ''}>
      ${escapeHtml(p.name || p.property_id)}
    </option>
  `).join('');

  const years = (data.available_years || []);
  const yearPills = ['all', ...years].map((y) => {
    const label = y === 'all' ? t('reports.propcost.year.all', {}, 'All time') : y;
    const active = y === _propCostState.year;
    return `<button type="button" data-year="${escapeHtml(y)}" class="propcost-year-pill" style="padding:6px 12px;border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};border-radius:8px;background:${active ? 'var(--accent)' : 'transparent'};color:${active ? 'var(--bg)' : 'inherit'};cursor:pointer;font-size:12px;font-weight:${active ? '600' : '500'};">${escapeHtml(label)}</button>`;
  }).join('');

  const totals = data.totals || {};
  const grand = totals.grand_total || 0;
  const months = (data.by_month || []).length;
  const avgPerMonth = months > 0 ? grand / months : 0;

  // KPI tiles — grand total + monthly average + top bucket. Big numbers
  // first, the rest of the report drills into them.
  const topBucket = PROPCOST_BUCKETS
    .map((b) => ({ ...b, value: totals[b.id] || 0 }))
    .filter((b) => b.value > 0)
    .sort((a, b) => b.value - a.value)[0];
  const topBucketLabel = topBucket ? topBucket.getLabel() : '—';
  const topBucketValue = topBucket ? topBucket.value : 0;

  const kpiTiles = `
    <div class="report-kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0 24px;">
      ${_propCostKpiCard(t('reports.propcost.kpi.total', {}, 'Total'), `${fmt(grand)} ${sym}`, t('reports.propcost.kpi.total_note', { months: months || 0 }, `over ${months} months`))}
      ${_propCostKpiCard(t('reports.propcost.kpi.avg_month', {}, 'Avg / Month'), `${fmt(avgPerMonth)} ${sym}`, '')}
      ${_propCostKpiCard(topBucketLabel, `${fmt(topBucketValue)} ${sym}`, t('reports.propcost.kpi.top_bucket_note', {}, 'biggest cost line'))}
    </div>
  `;

  const bucketRows = PROPCOST_BUCKETS.map((b) => {
    const v = totals[b.id] || 0;
    if (v <= 0) return '';
    const pct = grand > 0 ? (v / grand * 100).toFixed(1) : '0.0';
    return `
      <tr>
        <td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${b.color};margin-right:6px;vertical-align:middle;"></span>${escapeHtml(b.getLabel())}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">${fmt(v)} ${sym}</td>
        <td style="text-align:right;color:var(--muted);font-variant-numeric:tabular-nums;">${pct}%</td>
      </tr>
    `;
  }).join('');

  const catRows = (data.by_category || []).slice(0, 25).map((c) => `
    <tr>
      <td>${escapeHtml(c.category)}</td>
      <td style="text-align:right;color:var(--muted);">${escapeHtml(c.bucket)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${fmt(c.amount)} ${sym}</td>
      <td style="text-align:right;color:var(--muted);">${c.count}</td>
    </tr>
  `).join('');

  const propLabel = data.property?.name || _propCostState.propertyId;
  const propAddr = data.property?.address || '';

  root.innerHTML = `
    <div class="report-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:16px;margin:16px 0 12px;">
      <div class="muted fs-13">${escapeHtml(propLabel)}${propAddr ? ' · ' + escapeHtml(propAddr) : ''}</div>
      <div class="flex-row gap-sm">
        <select id="propcost-property" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
          ${propertyOptions}
        </select>
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
      ${yearPills}
    </div>
    ${data.cost_tag ? '' : `
      <div class="alert-banner" style="background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--warn);padding:12px 16px;margin:12px 0;border-radius:var(--radius-xs);">
        <strong>${escapeHtml(t('reports.propcost.no_tag.title', {}, 'No cost tag set'))}</strong> —
        ${escapeHtml(t('reports.propcost.no_tag.body', {}, 'Open Settings → Properties and assign a cost_tag so transactions can be auto-tagged. The report needs that tag to aggregate costs.'))}
      </div>
    `}
    ${kpiTiles}
    <div class="report-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px;margin-bottom:18px;">
      <h4 style="margin:0 0 12px;">${escapeHtml(t('reports.propcost.chart.monthly', {}, 'Monthly composition'))}</h4>
      <div style="height:340px;"><canvas id="propcost-monthly-chart"></canvas></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:18px;">
      <div class="report-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px;">
        <h4 style="margin:0 0 12px;">${escapeHtml(t('reports.propcost.bucket_table', {}, 'By bucket'))}</h4>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr>
            <th style="text-align:left;padding:6px 0;border-bottom:1px solid var(--border);">${escapeHtml(t('reports.propcost.col.bucket', {}, 'Bucket'))}</th>
            <th class="td-amount">${escapeHtml(t('reports.propcost.col.amount', {}, 'Amount'))}</th>
            <th class="td-amount">%</th>
          </tr></thead>
          <tbody>${bucketRows || `<tr><td colspan="3" style="padding:12px;color:var(--muted);">${escapeHtml(t('reports.propcost.no_data', {}, 'No data for this period.'))}</td></tr>`}</tbody>
        </table>
      </div>
      <div class="report-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px;">
        <h4 style="margin:0 0 12px;">${escapeHtml(t('reports.propcost.cat_table', {}, 'By category (top 25)'))}</h4>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr>
            <th style="text-align:left;padding:6px 0;border-bottom:1px solid var(--border);">${escapeHtml(t('reports.propcost.col.category', {}, 'Category'))}</th>
            <th class="td-amount">${escapeHtml(t('reports.propcost.col.bucket_short', {}, 'Bucket'))}</th>
            <th class="td-amount">${escapeHtml(t('reports.propcost.col.amount', {}, 'Amount'))}</th>
            <th class="td-amount">${escapeHtml(t('reports.propcost.col.count', {}, '#'))}</th>
          </tr></thead>
          <tbody>${catRows || `<tr><td colspan="4" style="padding:12px;color:var(--muted);">${escapeHtml(t('reports.propcost.no_data', {}, 'No data for this period.'))}</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;

  _propCostDrawChart(data, sym, fmt);

  // Wire interactions — Back button is owned by the reports framework.
  const sel = document.getElementById('propcost-property');
  if (sel) sel.addEventListener('change', async (ev) => {
    _propCostState.propertyId = ev.target.value;
    _propCostState.year = 'all';
    localStorage.setItem('financeos.propCost.propertyId', _propCostState.propertyId);
    await _propCostFetch();
    _propCostRender(properties);
  });
  document.querySelectorAll('.propcost-year-pill').forEach((btn) => {
    btn.addEventListener('click', async () => {
      _propCostState.year = btn.dataset.year;
      await _propCostFetch();
      _propCostRender(properties);
    });
  });
}

function _propCostKpiCard(label, value, note) {
  return `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;">
      <div style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">${escapeHtml(label)}</div>
      <div style="font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;">${escapeHtml(value)}</div>
      ${note ? `<div style="color:var(--muted);font-size:11px;margin-top:4px;">${escapeHtml(note)}</div>` : ''}
    </div>
  `;
}

function _propCostDrawChart(data, sym, fmt) {
  const ctx = document.getElementById('propcost-monthly-chart');
  if (!ctx) return;
  const months = data.by_month || [];
  if (!months.length) return;
  const labels = months.map((m) => m.month);
  const datasets = PROPCOST_BUCKETS
    .filter((b) => months.some((m) => (m[b.id] || 0) > 0))
    .map((b) => ({
      label: b.getLabel(),
      data: months.map((m) => toDisplay(m[b.id] || 0, 'TZS')),
      backgroundColor: b.color,
      stack: 'cost',
    }));
  // Chart data is pre-converted via toDisplay() above — tooltip and
  // axis must only FORMAT, or the value would be converted twice.
  const fmtAxis = (v) => Math.round(v || 0).toLocaleString(getLocaleTag());
  // DR-M1: register in reportCharts too, so destroyReportCharts() kills
  // the chart when the user leaves via Back (the _propCostState handle
  // only covers same-report re-renders).
  _propCostState.chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      ...CHART_BASE,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtAxis(ctx.parsed.y)} ${sym}`,
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
        y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fmtAxis(v) } },
      },
    },
  });
  reportCharts.push(_propCostState.chart);
}
