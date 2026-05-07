// ─── Vehicles Page (Block G) ──────────────────────────────────────────
//
// Single-page module: KPI tiles + heat-mapped fuel-log table + 3 charts.
// State lives at top of file (lazy-loaded on first render); shared
// helpers (formatCurrency, t, escapeHtml, displayCurrency, toDisplay)
// come from core.js / dashboard.js / i18n.js.

let vehiclesCharts = [];
let fuelLog = [];
let vehicleList = [];
let fuelReconciliation = { unlinked_fuel_txs: [], orphaned_log_entries: [], duplicate_links: [], dismissed_count: 0, dismissed_entries: [], has_findings: false };
let fuelLogLoaded = false;
// Period filter for KPIs + charts. 'all' is the default since the
// vehicle history is short enough that all-time is the useful baseline.
let vehiclesPeriod = 'all'; // 'month_3' | 'year' | 'all'

// ─── Data loader ─────────────────────────────────────────────────────

async function loadVehiclesData() {
  try {
    const res = await fetch('/api/fuel/list', { method: 'POST' });
    if (!res.ok) throw new Error(res.statusText);
    const json = await res.json();
    fuelLog = json.entries || [];
    vehicleList = json.vehicles || [];
    fuelReconciliation = json.reconciliation || { unlinked_fuel_txs: [], orphaned_log_entries: [], duplicate_links: [], dismissed_count: 0, dismissed_entries: [], has_findings: false };
    fuelLogLoaded = true;
  } catch (e) {
    console.warn('Failed to load fuel log:', e);
    fuelLog = []; vehicleList = []; fuelLogLoaded = true;
    fuelReconciliation = { unlinked_fuel_txs: [], orphaned_log_entries: [], duplicate_links: [], dismissed_count: 0, dismissed_entries: [], has_findings: false };
  }
}

// ─── Filtering + small helpers ───────────────────────────────────────

function filterFuelEntries() {
  // Always sort by date asc for stable timeline rendering
  let entries = [...fuelLog].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (vehiclesPeriod === 'all') return entries;
  // year:YYYY — calendar-year filter, derived from the data on render
  if (vehiclesPeriod.startsWith('year:')) {
    const yr = vehiclesPeriod.slice(5);
    return entries.filter(e => (e.date || '').startsWith(yr));
  }
  // Rolling cut-offs from "now" — useful for cross-year windows
  const cutoff = new Date();
  if (vehiclesPeriod === 'month_3') {
    cutoff.setMonth(cutoff.getMonth() - 3);
  } else if (vehiclesPeriod === 'year') {
    cutoff.setFullYear(cutoff.getFullYear() - 1);
  }
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return entries.filter(e => (e.date || '') >= cutoffStr);
}

// Distinct calendar years present in the loaded fuel log, newest first.
// Used to build the year-filter buttons in renderVehicleControls() so the
// list adapts as new years arrive without needing a code change.
function availableYears() {
  const years = new Set();
  for (const e of fuelLog) {
    const y = (e.date || '').slice(0, 4);
    if (/^\d{4}$/.test(y)) years.add(y);
  }
  return Array.from(years).sort().reverse();
}

// Heatmap color: green (good) → yellow → red (bad). Pass reversed=true
// when "lower is better" (consumption, price/km) so red marks high values.
function heatmapColor(value, values, reversed = true) {
  if (value == null || isNaN(value)) return 'transparent';
  const valid = values.filter(v => v != null && !isNaN(v));
  if (valid.length === 0) return 'transparent';
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (max === min) return 'rgba(15,173,113,0.18)';
  let pct = (value - min) / (max - min);
  if (reversed) pct = 1 - pct;
  if (pct >= 0.66) return 'rgba(15,173,113,0.18)';   // green
  if (pct >= 0.33) return 'rgba(232,147,12,0.18)';   // yellow / warn
  return 'rgba(232,69,60,0.18)';                     // red / negative
}

// Convert a TZS-native fuel amount into the active dashboard currency.
function toDisplayTzs(amountTzs) {
  return toDisplay(amountTzs, 'TZS');
}

// ─── Main entry — called by core.js navigateTo ───────────────────────

async function renderVehiclesPage() {
  const content = document.getElementById('vehicles-content');
  if (!content) return;

  // Tear down any charts left over from a previous render
  vehiclesCharts.forEach(c => c.destroy());
  vehiclesCharts = [];

  if (!fuelLogLoaded) {
    content.innerHTML = `<div class="report-section" style="text-align:center;color:var(--text-dim);">${t('common.loading', {}, 'Loading…')}</div>`;
    await loadVehiclesData();
  }

  const entries = filterFuelEntries();
  const vehicle = vehicleList[0] || null; // single-vehicle assumption for now

  // Update subtitle with light meta info
  const meta = document.getElementById('vehicles-meta');
  if (meta) {
    if (vehicle && entries.length > 0) {
      const first = entries[0].date;
      const last = entries[entries.length - 1].date;
      meta.textContent = t('page.vehicles.meta', { name: vehicle.name, n: entries.length, from: first, to: last },
        `${vehicle.name} · ${entries.length} entries · ${first} → ${last}`);
    } else if (vehicle) {
      meta.textContent = t('page.vehicles.empty', { name: vehicle.name }, `${vehicle.name} · no fuel entries yet`);
    } else {
      meta.textContent = t('page.vehicles.no_vehicles', {}, 'No vehicles configured');
    }
  }

  content.innerHTML = `
    ${renderVehicleControls()}
    ${renderReconciliationBanner()}
    ${renderVehicleKpis(entries)}
    ${renderVehicleCharts()}
    ${renderVehicleTable(entries)}
  `;

  // Charts must be instantiated after their canvas elements exist in DOM
  drawVehicleCharts(entries);
  bindVehicleControls();
}

// ─── Sub-renderers ────────────────────────────────────────────────────

function renderVehicleControls() {
  // Build the tab list dynamically: "All time" first, then one button
  // per calendar year (newest first), then the rolling windows.
  const periods = [['all', t('page.vehicles.period.all', {}, 'All time')]];
  for (const yr of availableYears()) {
    periods.push([`year:${yr}`, yr]);
  }
  periods.push(['year', t('page.vehicles.period.year', {}, 'Last 12 months')]);
  periods.push(['month_3', t('page.vehicles.period.quarter', {}, 'Last 3 months')]);

  const tabs = periods.map(([key, label]) => {
    const active = vehiclesPeriod === key ? 'background:var(--accent);color:var(--bg);border-color:var(--accent);' : '';
    return `<button class="vh-period-tab" data-period="${escapeHtml(key)}" style="padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);cursor:pointer;font-size:12px;${active}">${escapeHtml(label)}</button>`;
  }).join('');

  return `
    <div class="report-section" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${tabs}</div>
      <div style="display:flex;gap:8px;">
        <button id="vh-add-vehicle-btn" style="padding:8px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;font-weight:600;">+ ${t('page.vehicles.add_vehicle_button', {}, 'Add Vehicle')}</button>
        <button id="vh-add-btn" style="padding:8px 16px;background:var(--accent);color:var(--bg);border:none;border-radius:var(--radius-xs);cursor:pointer;font-weight:600;">+ ${t('page.vehicles.add_button', {}, 'Add Fuel Entry')}</button>
      </div>
    </div>
  `;
}

function renderReconciliationBanner() {
  // Three concrete findings, each with its own short detail line.
  // Plus a discrete "X dismissed" line when the user has previously
  // suppressed entries — so they always have a route back to restore
  // them, even when there are no active findings.
  const r = fuelReconciliation;
  if (!r) return '';
  const dismissedCount = r.dismissed_count || 0;
  if (!r.has_findings && dismissedCount === 0) return '';

  const lines = [];
  if (r.unlinked_fuel_txs && r.unlinked_fuel_txs.length > 0) {
    const newest = r.unlinked_fuel_txs[0];
    lines.push(`
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:6px 0;">
        <div>
          <strong>${r.unlinked_fuel_txs.length}</strong>
          ${t('page.vehicles.recon.unlinked', {}, 'fuel TX(s) without log entry')}
          <span style="color:var(--text-dim);font-size:11px;margin-left:8px;">
            ${t('page.vehicles.recon.unlinked_hint', {}, 'newest:')} ${escapeHtml(newest.date)} · ${escapeHtml(newest.payee || '')} · ${escapeHtml(newest.account || '')}
          </span>
        </div>
        <button class="vh-recon-show" data-kind="unlinked" style="padding:4px 10px;font-size:11px;background:transparent;color:var(--accent-dim);border:1px solid var(--accent-dim);border-radius:var(--radius-xs);cursor:pointer;">${t('common.actions.details', {}, 'Details')}</button>
      </div>
    `);
  }
  if (r.orphaned_log_entries && r.orphaned_log_entries.length > 0) {
    const newest = r.orphaned_log_entries[0];
    lines.push(`
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:6px 0;">
        <div>
          <strong>${r.orphaned_log_entries.length}</strong>
          ${t('page.vehicles.recon.orphans', {}, 'orphaned log entr(y/ies)')}
          <span style="color:var(--text-dim);font-size:11px;margin-left:8px;">
            ${t('page.vehicles.recon.orphan_hint', {}, 'newest:')} ${escapeHtml(newest.fuel_id)} · ${escapeHtml(newest.date)}
          </span>
        </div>
        <button class="vh-recon-show" data-kind="orphans" style="padding:4px 10px;font-size:11px;background:transparent;color:var(--negative);border:1px solid var(--negative);border-radius:var(--radius-xs);cursor:pointer;">${t('common.actions.details', {}, 'Details')}</button>
      </div>
    `);
  }
  if (r.duplicate_links && r.duplicate_links.length > 0) {
    lines.push(`
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:6px 0;">
        <div>
          <strong>${r.duplicate_links.length}</strong>
          ${t('page.vehicles.recon.duplicates', {}, 'duplicate TX link(s) — needs manual fix')}
        </div>
        <button class="vh-recon-show" data-kind="duplicates" style="padding:4px 10px;font-size:11px;background:transparent;color:var(--negative);border:1px solid var(--negative);border-radius:var(--radius-xs);cursor:pointer;">${t('common.actions.details', {}, 'Details')}</button>
      </div>
    `);
  }
  if (dismissedCount > 0) {
    // Dimmer styling than the warning lines: dismissals are intentional,
    // not unresolved issues. The button is the only way back to undo a
    // dismissal from the UI (CLI fallback was the only path before).
    lines.push(`
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:6px 0;border-top:1px dashed var(--border);margin-top:4px;color:var(--text-dim);font-size:12px;">
        <div>
          <strong>${dismissedCount}</strong>
          ${t('page.vehicles.recon.dismissed', {}, 'dismissed entr(y/ies) — hidden from the unlinked list')}
        </div>
        <button class="vh-recon-show" data-kind="dismissed" style="padding:4px 10px;font-size:11px;background:transparent;color:var(--text-dim);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;">${t('page.vehicles.recon.dismissed_view', {}, 'View / restore')}</button>
      </div>
    `);
  }
  // Style the wrapper neutrally when there are only dismissals (no
  // active findings): no warning border / amber tint, just a plain
  // info card. Otherwise keep the existing warn styling.
  const onlyDismissed = !r.has_findings && dismissedCount > 0;
  const wrapperStyle = onlyDismissed
    ? 'border-left:3px solid var(--border);'
    : 'border-left:3px solid var(--warn);background:rgba(232,147,12,0.06);';
  const headerLabel = onlyDismissed
    ? t('page.vehicles.recon.title_clean', {}, 'Reconciliation — all clear')
    : `⚠ ${t('page.vehicles.recon.title', {}, 'Reconciliation findings')}`;
  return `
    <div class="report-section" style="${wrapperStyle}">
      <div style="font-weight:600;margin-bottom:4px;">${headerLabel}</div>
      ${lines.join('')}
    </div>
  `;
}

function renderVehicleKpis(entries) {
  const n = entries.length;
  const totalLiters = entries.reduce((s, e) => s + (parseFloat(e.liters) || 0), 0);
  const totalCost = entries.reduce((s, e) => s + (parseFloat(e.total_cost) || 0), 0);
  const totalDistance = entries.reduce((s, e) => s + (e.distance_km || 0), 0);
  const avgPriceL = totalLiters > 0 ? totalCost / totalLiters : 0;

  // Distance + litres aggregated only over entries with valid consumption
  const fullEntries = entries.filter(e => e.consume_l_100km != null && e.distance_km);
  const fullDist = fullEntries.reduce((s, e) => s + (e.distance_km || 0), 0);
  const fullLiters = fullEntries.reduce((s, e) => s + (parseFloat(e.liters) || 0), 0);
  const avgConsume = fullDist > 0 ? (fullLiters / fullDist * 100) : 0;
  const avgPriceKm = totalDistance > 0 ? totalCost / totalDistance : 0;

  // Average cost per calendar month, span-based: counts every month
  // between the first and last entry inclusively, even months without
  // a fueling. Reads as "monthly fuel budget" rather than "average of
  // months I actually filled up", which would over-state the figure.
  let monthSpan = 0;
  if (entries.length > 0) {
    const dates = entries.map(e => e.date).filter(Boolean).sort();
    const [fy, fm] = dates[0].split('-').map(Number);
    const [ly, lm] = dates[dates.length - 1].split('-').map(Number);
    if (fy && fm && ly && lm) monthSpan = (ly * 12 + lm) - (fy * 12 + fm) + 1;
  }
  const avgPerMonth = monthSpan > 0 ? totalCost / monthSpan : 0;

  const cur = displayCurrency;

  return `
    <div class="report-section">
      <div class="income-grid">
        <div class="income-cell">
          <div class="ic-label">${t('page.vehicles.kpi.entries', {}, 'Tankungen')}</div>
          <div class="ic-value">${n}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('page.vehicles.kpi.distance', {}, 'Distance')}</div>
          <div class="ic-value">${totalDistance.toLocaleString()}<span class="ic-cur">km</span></div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('page.vehicles.kpi.fuel', {}, 'Total Fuel')}</div>
          <div class="ic-value">${totalLiters.toFixed(1)}<span class="ic-cur">L</span></div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('page.vehicles.kpi.cost', {}, 'Total Cost')}</div>
          <div class="ic-value">${formatCurrency(toDisplayTzs(totalCost), cur)}<span class="ic-cur">${cur}</span></div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('page.vehicles.kpi.avg_per_month', {}, 'Ø Cost / Month')}</div>
          <div class="ic-value">${formatCurrency(toDisplayTzs(avgPerMonth), cur)}<span class="ic-cur">${cur}</span></div>
          <div class="ic-count">${t('page.vehicles.kpi.month_sub', { n: monthSpan }, `over ${monthSpan} month${monthSpan === 1 ? '' : 's'}`)}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('page.vehicles.kpi.avg_consume', {}, 'Ø Consumption')}</div>
          <div class="ic-value" style="color:var(--accent);">${avgConsume.toFixed(2)}<span class="ic-cur">L/100km</span></div>
          <div class="ic-count">${t('page.vehicles.kpi.consume_sub', { n: fullEntries.length }, `${fullEntries.length} full-tank fills`)}</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('page.vehicles.kpi.avg_price_l', {}, 'Ø Price / L')}</div>
          <div class="ic-value">${formatCurrency(toDisplayTzs(avgPriceL), cur)}<span class="ic-cur">${cur}</span></div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${t('page.vehicles.kpi.avg_price_km', {}, 'Ø Cost / km')}</div>
          <div class="ic-value">${formatCurrency(toDisplayTzs(avgPriceKm), cur)}<span class="ic-cur">${cur}</span></div>
        </div>
      </div>
    </div>
  `;
}

function renderVehicleCharts() {
  // Two rows of charts. Top: trend over time. Bottom: cross-cuts (year
  // comparison + station distribution). Auto-fit grid keeps everything
  // readable on narrower screens.
  const card = (titleKey, fallback, canvasId) => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">${t(titleKey, {}, fallback)}</div>
      <div style="height:220px;"><canvas id="${canvasId}"></canvas></div>
    </div>
  `;
  return `
    <div class="report-section">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px;">
        ${card('page.vehicles.chart.price_l', 'Price per Liter', 'vh-chart-price')}
        ${card('page.vehicles.chart.consume', 'Consumption (L/100km, full-tank)', 'vh-chart-consume')}
        ${card('page.vehicles.chart.monthly', 'Monthly Cost', 'vh-chart-monthly')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px;margin-top:16px;">
        ${card('page.vehicles.chart.annual', 'Year-on-Year Cost (Jan–Dec)', 'vh-chart-annual')}
        ${card('page.vehicles.chart.stations', 'Cost by Station', 'vh-chart-stations')}
      </div>
    </div>
  `;
}

function renderVehicleTable(entries) {
  if (entries.length === 0) {
    return `<div class="report-section" style="text-align:center;color:var(--text-dim);">${t('page.vehicles.empty_table', {}, 'No fuel entries in this period.')}</div>`;
  }
  const consumes = entries.map(e => e.consume_l_100km);
  const pricesPerKm = entries.map(e => e.price_per_km);
  const cur = displayCurrency;

  // Newest first for table readability — chart side keeps date asc.
  const tableEntries = [...entries].reverse();

  const rows = tableEntries.map(e => {
    const distance = e.distance_km != null ? Math.round(e.distance_km).toLocaleString() : '—';
    const consume = e.consume_l_100km != null ? e.consume_l_100km.toFixed(2) : '—';
    const priceL = e.price_per_liter != null ? formatCurrency(toDisplayTzs(e.price_per_liter), cur) : '—';
    const priceKm = e.price_per_km != null ? formatCurrency(toDisplayTzs(e.price_per_km), cur) : '—';
    const days = e.days_between != null ? e.days_between : '—';
    const cBg = heatmapColor(e.consume_l_100km, consumes);
    const kBg = heatmapColor(e.price_per_km, pricesPerKm);
    const totalCostDisp = formatCurrency(toDisplayTzs(parseFloat(e.total_cost) || 0), cur);
    const txLink = e.tx_import_id
      ? `<a class="vh-tx-link" data-tx-id="${escapeHtml(e.tx_import_id)}" title="${escapeHtml(e.tx_import_id)} — click to open">${escapeHtml(e.tx_import_id.slice(0, 8))}…</a>`
      : `<span style="color:var(--text-dim);">—</span>`;
    // Heat-map cells get extra inline padding so the colored band has
    // visual breathing room and does not bleed into the neighboring text.
    const cBgStyle = e.consume_l_100km != null ? `background:${cBg};font-weight:600;` : '';
    const kBgStyle = e.price_per_km != null ? `background:${kBg};` : '';
    return `
      <tr>
        <td class="vh-cell-date">${escapeHtml(e.date)}</td>
        <td class="vh-cell-num">${(parseFloat(e.odometer_km) || 0).toLocaleString()}</td>
        <td class="vh-cell-num">${(parseFloat(e.liters) || 0).toFixed(2)}</td>
        <td class="vh-cell-num"><span class="vh-amount">${totalCostDisp}</span><span class="vh-cur">${cur}</span></td>
        <td class="vh-cell-text">${escapeHtml(e.station || '')}</td>
        <td class="vh-cell-num">${distance}</td>
        <td class="vh-cell-num vh-cell-heat" style="${cBgStyle}">${consume}</td>
        <td class="vh-cell-num">${priceL}</td>
        <td class="vh-cell-num vh-cell-heat" style="${kBgStyle}">${priceKm}</td>
        <td class="vh-cell-num">${days}</td>
        <td class="vh-cell-mid">${e.full_tank === 'true' ? '<span class="c-pos">✓</span>' : ''}</td>
        <td class="vh-cell-mid vh-cell-tx">${txLink}</td>
        <td class="vh-cell-mid nowrap">
          <button class="vh-edit-btn" data-fuel-id="${escapeHtml(e.fuel_id)}" title="${t('page.vehicles.fuel.edit', {}, 'Edit fuel entry')}" aria-label="${t('page.vehicles.fuel.edit', {}, 'Edit fuel entry')}">✎</button>
          <button class="vh-del-btn" data-fuel-id="${escapeHtml(e.fuel_id)}" title="${t('page.vehicles.fuel.delete', {}, 'Delete fuel entry')}" aria-label="${t('page.vehicles.fuel.delete', {}, 'Delete fuel entry')}">×</button>
        </td>
      </tr>
    `;
  }).join('');

  // Scoped styles: only this render injects them, so the table feels
  // distinct from generic data tables elsewhere in the dashboard.
  // Padding values target ~36 px row height — generous enough that
  // adjacent right-aligned and left-aligned columns never collide.
  const styles = `
    <style>
      .vh-fuel-table { width:100%; border-collapse:collapse; font-size:12.5px; }
      .vh-fuel-table thead th {
        text-align:left; padding:10px 14px; font-weight:600;
        background:var(--surface); border-bottom:2px solid var(--border);
        color:var(--text-dim); text-transform:uppercase; font-size:10.5px;
        letter-spacing:0.04em; white-space:nowrap;
      }
      .vh-fuel-table thead th.num { text-align:right; }
      .vh-fuel-table thead th.mid { text-align:center; }
      .vh-fuel-table tbody td {
        padding:9px 14px; border-bottom:1px solid var(--border);
        white-space:nowrap;
      }
      .vh-fuel-table tbody tr:hover { background:var(--accent-glow); }
      .vh-fuel-table tbody tr:last-child td { border-bottom:none; }
      .vh-fuel-table .vh-cell-num { text-align:right; font-variant-numeric:tabular-nums; }
      .vh-fuel-table .vh-cell-text { text-align:left; }
      .vh-fuel-table .vh-cell-mid { text-align:center; }
      .vh-fuel-table .vh-cell-date { text-align:left; color:var(--text-dim); font-variant-numeric:tabular-nums; }
      .vh-fuel-table .vh-cell-heat { font-weight:600; }
      .vh-fuel-table .vh-cell-tx { font-family:monospace; font-size:10.5px; }
      .vh-fuel-table .vh-tx-link { color:var(--accent-dim); cursor:pointer; text-decoration:none; }
      .vh-fuel-table .vh-tx-link:hover { color:var(--accent); text-decoration:underline; }
      .vh-fuel-table .vh-amount { margin-right:5px; }
      .vh-fuel-table .vh-cur { color:var(--text-dim); font-size:10px; text-transform:uppercase; }
      .vh-fuel-table .vh-del-btn,
      .vh-fuel-table .vh-edit-btn {
        padding:4px 9px; background:transparent; color:var(--text-dim);
        border:1px solid var(--border); border-radius:var(--radius-xs);
        cursor:pointer; font-size:13px; line-height:1; margin-right:4px;
        transition:color .12s, border-color .12s, background .12s;
      }
      .vh-fuel-table .vh-edit-btn:hover {
        color:var(--accent); border-color:var(--accent); background:var(--accent-glow);
      }
      .vh-fuel-table .vh-del-btn:hover {
        color:var(--negative); border-color:var(--negative); background:rgba(232,69,60,0.06);
      }
    </style>
  `;

  return `
    ${styles}
    <div class="report-section" style="padding:0;overflow:hidden;">
      <div style="overflow-x:auto;">
        <table class="vh-fuel-table">
          <thead>
            <tr>
              <th>${t('page.vehicles.col.date', {}, 'Date')}</th>
              <th class="num">${t('page.vehicles.col.odometer', {}, 'Odometer (km)')}</th>
              <th class="num">${t('page.vehicles.col.liters', {}, 'L')}</th>
              <th class="num">${t('page.vehicles.col.cost', {}, 'Cost')}</th>
              <th>${t('page.vehicles.col.station', {}, 'Station')}</th>
              <th class="num">${t('page.vehicles.col.distance', {}, 'Distance')}</th>
              <th class="num">${t('page.vehicles.col.consume', {}, 'L/100km')}</th>
              <th class="num">${t('page.vehicles.col.price_l', {}, 'Price/L')}</th>
              <th class="num">${t('page.vehicles.col.price_km', {}, 'Cost/km')}</th>
              <th class="num">${t('page.vehicles.col.days', {}, 'Days')}</th>
              <th class="mid">${t('page.vehicles.col.full', {}, 'Full')}</th>
              <th class="mid">${t('page.vehicles.col.tx', {}, 'TX')}</th>
              <th class="mid"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── Charts ──────────────────────────────────────────────────────────

function drawVehicleCharts(entries) {
  if (entries.length === 0) return;
  drawPriceChart(entries);
  drawConsumeChart(entries);
  drawMonthlyChart(entries);
  // Bottom-row cross-cuts use the FULL fuel log (not the period filter),
  // because year-comparison and station-distribution only become useful
  // when you can see history across the period the user just filtered out.
  drawAnnualChart(fuelLog);
  drawStationsChart(fuelLog);
}

function drawPriceChart(entries) {
  const ctx = document.getElementById('vh-chart-price');
  if (!ctx) return;
  const cur = displayCurrency;
  const labels = entries.map(e => e.date);
  const data = entries.map(e => e.price_per_liter != null ? toDisplayTzs(e.price_per_liter) : null);
  const chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{
      label: `${cur}/L`,
      data,
      borderColor: 'var(--accent)',
      backgroundColor: 'rgba(30,64,175,0.08)',
      tension: 0.3,
      pointRadius: 3,
      fill: true,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${formatCurrency(c.raw, cur)} ${cur}/L` } },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, maxTicksLimit: 8 } },
        y: { ticks: { callback: v => formatCurrency(v, cur), font: { size: 10 } } },
      },
    },
  });
  vehiclesCharts.push(chart);
}

function drawConsumeChart(entries) {
  const ctx = document.getElementById('vh-chart-consume');
  if (!ctx) return;
  // Skip rows without valid consumption (first entry per vehicle, partial fills)
  const valid = entries.filter(e => e.consume_l_100km != null);
  const labels = valid.map(e => e.date);
  const data = valid.map(e => e.consume_l_100km);
  const chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{
      label: 'L/100km',
      data,
      borderColor: 'var(--warn)',
      backgroundColor: 'rgba(232,147,12,0.10)',
      tension: 0.3,
      pointRadius: 3,
      fill: true,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.raw.toFixed(2)} L/100km` } },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, maxTicksLimit: 8 } },
        y: { ticks: { callback: v => v.toFixed(1), font: { size: 10 } } },
      },
    },
  });
  vehiclesCharts.push(chart);
}

function drawMonthlyChart(entries) {
  const ctx = document.getElementById('vh-chart-monthly');
  if (!ctx) return;
  const cur = displayCurrency;
  // Aggregate cost per YYYY-MM bucket
  const byMonth = {};
  for (const e of entries) {
    const ym = (e.date || '').slice(0, 7);
    if (!ym) continue;
    byMonth[ym] = (byMonth[ym] || 0) + (parseFloat(e.total_cost) || 0);
  }
  const months = Object.keys(byMonth).sort();
  const data = months.map(m => toDisplayTzs(byMonth[m]));
  const chart = new Chart(ctx, {
    type: 'bar',
    data: { labels: months.map(monthLabel), datasets: [{
      label: cur,
      data,
      backgroundColor: 'rgba(30,64,175,0.7)',
      borderWidth: 0,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${formatCurrency(c.raw, cur)} ${cur}` } },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 45 } },
        y: { ticks: { callback: v => formatCurrency(v, cur), font: { size: 10 } } },
      },
    },
  });
  vehiclesCharts.push(chart);
}

function drawAnnualChart(allEntries) {
  const ctx = document.getElementById('vh-chart-annual');
  if (!ctx || allEntries.length === 0) return;
  const cur = displayCurrency;

  // Group by year → 12-element array of monthly totals (Jan=0, Dec=11)
  const byYear = {};
  for (const e of allEntries) {
    const yr = (e.date || '').slice(0, 4);
    const mo = parseInt((e.date || '').slice(5, 7), 10);
    if (!/^\d{4}$/.test(yr) || isNaN(mo)) continue;
    if (!byYear[yr]) byYear[yr] = new Array(12).fill(0);
    byYear[yr][mo - 1] += parseFloat(e.total_cost) || 0;
  }
  const years = Object.keys(byYear).sort();
  // A small palette that walks through hue space — readable in both
  // light and dark theme since saturation stays modest.
  const palette = ['#1e40af', '#0fad71', '#e8930c', '#9333ea', '#dc2626', '#0891b2'];
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    .map((m, i) => (typeof t === 'function') ? t(`common.months.short.${i + 1}`, {}, m) : m);
  const datasets = years.map((yr, i) => ({
    label: yr,
    data: byYear[yr].map(v => toDisplayTzs(v)),
    borderColor: palette[i % palette.length],
    backgroundColor: palette[i % palette.length] + '22',
    tension: 0.25,
    pointRadius: 3,
    fill: false,
    spanGaps: false,
  }));
  const chart = new Chart(ctx, {
    type: 'line',
    data: { labels: monthLabels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 }, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: c => `${c.dataset.label}: ${formatCurrency(c.raw, cur)} ${cur}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { ticks: { callback: v => formatCurrency(v, cur), font: { size: 10 } } },
      },
    },
  });
  vehiclesCharts.push(chart);
}

function drawStationsChart(allEntries) {
  const ctx = document.getElementById('vh-chart-stations');
  if (!ctx || allEntries.length === 0) return;
  const cur = displayCurrency;

  // Aggregate cost + count per station name
  const byStation = {};
  for (const e of allEntries) {
    const name = (e.station || '').trim() || '(unknown)';
    if (!byStation[name]) byStation[name] = { cost: 0, count: 0 };
    byStation[name].cost += parseFloat(e.total_cost) || 0;
    byStation[name].count += 1;
  }
  const sorted = Object.entries(byStation).sort((a, b) => b[1].cost - a[1].cost);
  const labels = sorted.map(([name]) => name);
  const data = sorted.map(([, v]) => toDisplayTzs(v.cost));
  const counts = sorted.map(([, v]) => v.count);
  // Same palette as the annual chart so colors stay consistent across
  // the page; first slice always gets the primary accent.
  const palette = ['#1e40af', '#0fad71', '#e8930c', '#9333ea', '#dc2626', '#0891b2', '#64748b'];
  const colors = labels.map((_, i) => palette[i % palette.length]);
  const total = data.reduce((s, v) => s + v, 0);
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 }, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: c => {
              const pct = total > 0 ? (c.raw / total * 100).toFixed(1) : '0.0';
              const fillN = counts[c.dataIndex];
              return `${c.label}: ${formatCurrency(c.raw, cur)} ${cur} (${pct}% · ${fillN} fill${fillN === 1 ? '' : 's'})`;
            },
          },
        },
      },
    },
  });
  vehiclesCharts.push(chart);
}

// ─── Event bindings ──────────────────────────────────────────────────

function bindVehicleControls() {
  document.querySelectorAll('.vh-period-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      vehiclesPeriod = btn.dataset.period;
      renderVehiclesPage();
    });
  });
  const addBtn = document.getElementById('vh-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => openFuelModal());
  const addVehicleBtn = document.getElementById('vh-add-vehicle-btn');
  if (addVehicleBtn) addVehicleBtn.addEventListener('click', () => openVehicleModal());
  document.querySelectorAll('.vh-del-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteFuelEntry(btn.dataset.fuelId));
  });
  document.querySelectorAll('.vh-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const entry = fuelLog.find(e => e.fuel_id === btn.dataset.fuelId);
      if (entry) openFuelModal(entry);
    });
  });
  document.querySelectorAll('.vh-recon-show').forEach(btn => {
    btn.addEventListener('click', () => showReconciliationDetails(btn.dataset.kind));
  });
  // Wire TX-link clicks to the dashboard's standard edit modal so the
  // user can inspect, edit, or delete the linked transaction without
  // leaving the Vehicles page.
  document.querySelectorAll('.vh-tx-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const txId = link.dataset.txId;
      const tx = (state.tx || []).find(t => t.import_id === txId);
      if (tx && typeof openEditModal === 'function') {
        openEditModal(tx);
      } else {
        uiAlert(t('page.vehicles.tx_not_found', { id: txId }, `Transaction ${txId} not found in the loaded state — try reloading the page.`));
      }
    });
  });
}

// ─── Reconciliation details modal ────────────────────────────────────

function showReconciliationDetails(kind) {
  // Inline-detail modal instead of a full sub-page: fewer clicks for the
  // user to triage findings, and the data is small enough that paging
  // would be over-engineering.
  const r = fuelReconciliation;
  let title = '';
  let rows = [];
  let intro = '';
  if (kind === 'unlinked') {
    title = t('page.vehicles.recon.unlinked_title', {}, 'Fuel TXs without a fuel-log entry');
    intro = t('page.vehicles.recon.unlinked_intro', {},
      'These transactions were booked under a fuel category but never went through the Vehicles tab, so litres / consumption are missing. Add them via Add Fuel Entry, or backfill in bulk via scripts/fuel_import.py.');
    rows = (r.unlinked_fuel_txs || []).map(t => `
      <tr>
        <td>${escapeHtml(t.date)}</td>
        <td class="t-right">${formatCurrency(parseFloat(t.amount) || 0, 'TZS')}</td>
        <td>${escapeHtml(t.payee || '')}</td>
        <td>${escapeHtml(t.account || '')}</td>
        <td>${escapeHtml(t.category || '')}</td>
        <td><a class="vh-tx-link-modal" data-tx-id="${escapeHtml(t.import_id)}" style="color:var(--accent-dim);cursor:pointer;font-family:monospace;font-size:10.5px;">${escapeHtml((t.import_id || '').slice(0, 8))}…</a></td>
        <td style="text-align:center;"><button class="vh-recon-dismiss" data-tx-id="${escapeHtml(t.import_id)}" title="Mark as not-vehicle-fuel (e.g. lawn mower) — removes from this list permanently" style="padding:3px 8px;font-size:10.5px;background:transparent;color:var(--text-dim);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;">Dismiss</button></td>
      </tr>
    `).join('');
  } else if (kind === 'orphans') {
    title = t('page.vehicles.recon.orphans_title', {}, 'Orphaned fuel-log entries');
    intro = t('page.vehicles.recon.orphans_intro', {},
      'These fuel-log rows reference a transaction that no longer exists. Likely the TX was deleted directly from the Transactions page. Use the row\'s edit button to either re-create the TX (Save will write a fresh one) or delete the orphan.');
    rows = (r.orphaned_log_entries || []).map(o => `
      <tr>
        <td>${escapeHtml(o.fuel_id)}</td>
        <td>${escapeHtml(o.date)}</td>
        <td class="t-right">${formatCurrency(parseFloat(o.total_cost) || 0, 'TZS')}</td>
        <td>${escapeHtml(o.station || '')}</td>
        <td style="font-family:monospace;font-size:10.5px;color:var(--text-dim);">${escapeHtml((o.tx_import_id || '').slice(0, 8))}…</td>
      </tr>
    `).join('');
  } else if (kind === 'duplicates') {
    title = t('page.vehicles.recon.dup_title', {}, 'Duplicate TX links');
    intro = t('page.vehicles.recon.dup_intro', {},
      'Two fuel-log rows reference the same transaction. Should not happen normally — check data/fuel_log.csv directly and delete one of the dupes.');
    rows = (r.duplicate_links || []).map(d => `
      <tr>
        <td>${escapeHtml(d.fuel_id)}</td>
        <td>${escapeHtml(d.date)}</td>
        <td style="font-family:monospace;font-size:10.5px;">${escapeHtml((d.tx_import_id || '').slice(0, 8))}…</td>
      </tr>
    `).join('');
  } else if (kind === 'dismissed') {
    title = t('page.vehicles.recon.dismissed_title', {}, 'Dismissed reconciliation entries');
    intro = t('page.vehicles.recon.dismissed_intro', {},
      'These TXs were marked as not-vehicle-fuel (lawn mower, generator, jerry-can …) and are excluded from the unlinked list. Click Restore to bring an entry back into the active reconciliation report — useful if a dismissal was made by mistake or the situation changed.');
    rows = (r.dismissed_entries || []).map(d => {
      const missingTx = d.tx_exists === false;
      const dateCell = missingTx
        ? `<span class="c-neg" title="TX no longer exists in transactions.csv">— deleted —</span>`
        : escapeHtml(d.date || '');
      const amountCell = missingTx
        ? '—'
        : formatCurrency(parseFloat(d.amount) || 0, 'TZS');
      return `
        <tr>
          <td>${escapeHtml(d.dismissed_at || '')}</td>
          <td>${dateCell}</td>
          <td class="t-right">${amountCell}</td>
          <td>${escapeHtml(d.payee || '')}</td>
          <td>${escapeHtml(d.account || '')}</td>
          <td>${escapeHtml(d.reason || '')}</td>
          <td><a class="vh-tx-link-modal" data-tx-id="${escapeHtml(d.import_id)}" style="color:var(--accent-dim);cursor:pointer;font-family:monospace;font-size:10.5px;">${escapeHtml((d.import_id || '').slice(0, 8))}…</a></td>
          <td style="text-align:center;"><button class="vh-recon-undismiss" data-tx-id="${escapeHtml(d.import_id)}" title="Restore this TX into the unlinked list" style="padding:3px 8px;font-size:10.5px;background:transparent;color:var(--accent-dim);border:1px solid var(--accent-dim);border-radius:var(--radius-xs);cursor:pointer;">Restore</button></td>
        </tr>
      `;
    }).join('');
  }
  if (!rows) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const headerCols = kind === 'unlinked'
    ? '<th>Date</th><th class="t-right">Amount</th><th>Payee</th><th>Account</th><th>Category</th><th>TX</th><th style="text-align:center;">Action</th>'
    : kind === 'orphans'
    ? '<th>fuel_id</th><th>Date</th><th class="t-right">Cost</th><th>Station</th><th>broken TX id</th>'
    : kind === 'dismissed'
    ? '<th>Dismissed at</th><th>TX date</th><th class="t-right">Amount</th><th>Payee</th><th>Account</th><th>Reason</th><th>TX</th><th style="text-align:center;">Action</th>'
    : '<th>fuel_id</th><th>Date</th><th>tx_import_id</th>';

  overlay.innerHTML = `
    <div class="modal" style="max-width:760px;">
      <h3>${title}</h3>
      <div style="font-size:12px;color:var(--text-dim);margin:8px 0 16px;">${intro}</div>
      <div style="max-height:50vh;overflow-y:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="border-bottom:2px solid var(--border);">${headerCols.replace(/<th/g, '<th style="text-align:left;padding:6px 10px;"').replace(/<th class="t-right"/g, '<th style="text-align:right;padding:6px 10px;"')}</tr></thead>
          <tbody>${rows.replace(/<td/g, '<td style="padding:6px 10px;border-bottom:1px solid var(--border);"')}</tbody>
        </table>
      </div>
      <div style="margin-top:16px;display:flex;justify-content:flex-end;">
        <button onclick="this.closest('.modal-overlay').remove()" style="padding:7px 16px;background:var(--accent);color:var(--bg);border:none;border-radius:var(--radius-xs);cursor:pointer;">${t('common.actions.close', {}, 'Close')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  // Wire TX-detail links inside the modal so users can jump straight
  // into the standard edit flow for an unlinked fuel TX.
  overlay.querySelectorAll('.vh-tx-link-modal').forEach(link => {
    link.addEventListener('click', () => {
      const txId = link.dataset.txId;
      const tx = (state.tx || []).find(t => t.import_id === txId);
      if (tx && typeof openEditModal === 'function') {
        overlay.remove();
        openEditModal(tx);
      }
    });
  });
  // Restore-buttons: undo a previous dismissal. Brings the TX back into
  // the unlinked list on the next reconcile run.
  overlay.querySelectorAll('.vh-recon-undismiss').forEach(btn => {
    btn.addEventListener('click', async () => {
      const txId = btn.dataset.txId;
      btn.disabled = true; btn.textContent = '…';
      try {
        const res = await fetch('/api/fuel/recon/undismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ import_id: txId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          uiAlert(err.error || t('page.vehicles.recon.restore_failed', {}, 'Restore failed'));
          btn.disabled = false; btn.textContent = 'Restore';
          return;
        }
        // Reload findings + close modal so the banner reflects the
        // restored entry showing up in the unlinked list again.
        overlay.remove();
        fuelLogLoaded = false;
        await loadVehiclesData();
        renderVehiclesPage();
      } catch (e) {
        uiAlert(String(e));
        btn.disabled = false; btn.textContent = 'Restore';
      }
    });
  });
  // Dismiss-buttons: mark TX as not-vehicle-fuel so reconcile drops it
  // permanently from the unlinked list. Optional reason via prompt for
  // future audit (lawn-mower / generator / friend's bike etc).
  overlay.querySelectorAll('.vh-recon-dismiss').forEach(btn => {
    btn.addEventListener('click', async () => {
      const txId = btn.dataset.txId;
      const reason = await uiPrompt(t('page.vehicles.recon.dismiss_prompt', {}, 'Optional reason (lawn mower, generator, …):'), '');
      if (reason === null) return; // user pressed cancel
      btn.disabled = true; btn.textContent = '…';
      try {
        const res = await fetch('/api/fuel/recon/dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ import_id: txId, reason: reason.trim() }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          uiAlert(err.error || t('page.vehicles.recon.dismiss_failed', {}, 'Dismiss failed'));
          btn.disabled = false; btn.textContent = 'Dismiss';
          return;
        }
        // Reload findings + close modal so the warning banner refreshes
        overlay.remove();
        fuelLogLoaded = false;
        await loadVehiclesData();
        renderVehiclesPage();
      } catch (e) {
        uiAlert(String(e));
        btn.disabled = false; btn.textContent = 'Dismiss';
      }
    });
  });
}

// ─── Add modal ───────────────────────────────────────────────────────

function openFuelModal(existing = null) {
  // Dual-mode modal: add (existing == null) or edit (existing == fuel row).
  // Edit mode prefills every field, swaps the API endpoint, and keeps the
  // same fuel_id when persisting so charts/tables don't reorder.
  if (vehicleList.length === 0) {
    uiAlert(t('page.vehicles.no_vehicles_alert', {}, 'No vehicles configured. Add a row to data/vehicles.csv first.'));
    return;
  }
  const isEdit = existing != null;
  const vehicle = vehicleList.find(v => v.vehicle_id === (existing?.vehicle_id || vehicleList[0].vehicle_id)) || vehicleList[0];
  const accounts = (state.accounts || []).filter(a => a.status === 'active');

  // Prefill values: edit uses the existing row, add uses sensible defaults
  // (today + last-known odometer + vehicle default_payee/account).
  const today = new Date().toISOString().slice(0, 10);
  const lastEntry = [...fuelLog].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const defaultOdo = lastEntry ? parseFloat(lastEntry.odometer_km) || 0 : 0;

  const preDate = isEdit ? existing.date : today;
  const preOdo = isEdit ? parseFloat(existing.odometer_km) || 0 : defaultOdo;
  const preLiters = isEdit ? existing.liters : '';
  const preCost = isEdit ? existing.total_cost : '';
  const preStation = isEdit ? existing.station : (vehicle.default_payee || '');
  const preAccount = isEdit ? existing.account : vehicle.default_account;
  const preFull = isEdit ? (existing.full_tank === 'true') : true;
  const preRemarks = isEdit ? (existing.remarks || '') : '';

  const accountOpts = accounts.map(a => `<option value="${escapeHtml(a.alias)}" ${a.alias === preAccount ? 'selected' : ''}>${escapeHtml(a.alias)} — ${escapeHtml(a.name)}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const titleHtml = isEdit
    ? t('page.vehicles.modal.title_edit', {}, 'Edit Fuel <span class="accent">Entry</span>')
    : t('page.vehicles.modal.title', {}, 'Add Fuel <span class="accent">Entry</span>');
  const subtitle = isEdit
    ? `${escapeHtml(vehicle.name)} · ${escapeHtml(existing.fuel_id)}`
    : escapeHtml(vehicle.name);

  overlay.innerHTML = `
    <div class="modal" style="max-width:480px;">
      <h3>${titleHtml}</h3>
      <div style="font-size:12px;color:var(--text-dim);margin-top:4px;">${subtitle}</div>
      <div style="display:grid;gap:12px;margin-top:16px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label class="fs-12">${t('page.vehicles.modal.date', {}, 'Date')}</label>
            <input type="date" id="fuel-date" value="${escapeHtml(String(preDate))}" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
          </div>
          <div>
            <label class="fs-12">${t('page.vehicles.modal.odometer', {}, 'Odometer (km)')}</label>
            <input type="number" id="fuel-odometer" value="${preOdo}" step="1" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label class="fs-12">${t('page.vehicles.modal.liters', {}, 'Liters')}</label>
            <input type="number" id="fuel-liters" placeholder="e.g. 50.00" step="0.01" value="${escapeHtml(String(preLiters))}" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
          </div>
          <div>
            <label class="fs-12">${t('page.vehicles.modal.cost', {}, 'Total Cost (TZS)')}</label>
            <input type="text" inputmode="numeric" id="fuel-cost" placeholder="e.g. 150k or 150000" value="${escapeHtml(String(preCost))}" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
          </div>
        </div>
        <div>
          <label class="fs-12">${t('page.vehicles.modal.station', {}, 'Station')}</label>
          <input type="text" id="fuel-station" value="${escapeHtml(preStation)}" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:end;">
          <div>
            <label class="fs-12">${t('page.vehicles.modal.account', {}, 'Account')}</label>
            <select id="fuel-account" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">${accountOpts}</select>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;padding-bottom:7px;">
            <input type="checkbox" id="fuel-full" ${preFull ? 'checked' : ''}>
            ${t('page.vehicles.modal.full_tank', {}, 'Full tank')}
          </label>
        </div>
        <div>
          <label class="fs-12">${t('page.vehicles.modal.remarks', {}, 'Remarks (optional)')}</label>
          <input type="text" id="fuel-remarks" value="${escapeHtml(preRemarks)}" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
        </div>
      </div>
      <div id="fuel-modal-status" style="margin-top:12px;font-size:12px;"></div>
      <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;">
        <button onclick="this.closest('.modal-overlay').remove()" style="padding:7px 16px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;">${t('common.actions.cancel', {}, 'Cancel')}</button>
        <button id="fuel-save-btn" style="padding:7px 16px;background:var(--accent);color:var(--bg);border:none;border-radius:var(--radius-xs);cursor:pointer;font-weight:600;">${isEdit ? t('common.actions.save_changes', {}, 'Save changes') : t('common.actions.save', {}, 'Save')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#fuel-save-btn').addEventListener('click', () => saveFuelEntry(overlay, vehicle, existing));
}

async function saveFuelEntry(overlay, vehicle, existing = null) {
  const status = overlay.querySelector('#fuel-modal-status');
  const date = overlay.querySelector('#fuel-date').value;
  const odometer = parseFloat(overlay.querySelector('#fuel-odometer').value);
  const liters = parseFloat(overlay.querySelector('#fuel-liters').value);
  const cost = parseAmountInput(overlay.querySelector('#fuel-cost').value);
  const station = overlay.querySelector('#fuel-station').value.trim();
  const account = overlay.querySelector('#fuel-account').value;
  const fullTank = overlay.querySelector('#fuel-full').checked;
  const remarks = overlay.querySelector('#fuel-remarks').value.trim();

  // Lightweight client-side validation; the server still re-validates
  if (!date || !odometer || !liters || !cost || !station) {
    status.innerHTML = `<span class="c-neg">${t('page.vehicles.modal.err_required', {}, 'All fields except remarks are required.')}</span>`;
    return;
  }

  const isEdit = existing != null;
  const endpoint = isEdit ? '/api/fuel/update' : '/api/fuel/add';
  const payload = {
    vehicle_id: vehicle.vehicle_id,
    date, odometer_km: odometer, liters, total_cost: cost,
    station, full_tank: fullTank, account, remarks,
  };
  if (isEdit) payload.fuel_id = existing.fuel_id;

  status.innerHTML = `<span style="color:var(--text-dim);">${t('common.saving', {}, 'Saving…')}</span>`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      status.innerHTML = `<span class="c-neg">${escapeHtml(json.error || 'Save failed')}</span>`;
      return;
    }
    overlay.remove();
    fuelLogLoaded = false;
    await loadVehiclesData();
    if (typeof loadAllData === 'function') {
      const reloaded = await loadAllData();
      if (reloaded) {
        state.tx = reloaded.tx;
        state.balances = computeBalances(state.tx, state.accounts);
      }
    }
    renderVehiclesPage();
  } catch (e) {
    status.innerHTML = `<span class="c-neg">${escapeHtml(String(e))}</span>`;
  }
}

// ─── Delete ──────────────────────────────────────────────────────────

async function deleteFuelEntry(fuelId) {
  const entry = fuelLog.find(e => e.fuel_id === fuelId);
  if (!entry) return;
  // Spell out the cascade so the user knows the linked TX (and any
  // pass-through reimbursement) goes too — this is the whole point of
  // the cascade.
  const txInfo = entry.tx_import_id
    ? `\n\n${t('page.vehicles.delete.tx_warn', {}, 'The linked transaction')} ${entry.tx_import_id.slice(0, 8)}…${entry.account === 'kft' || entry.account === 'kfu' ? ` ${t('page.vehicles.delete.reimb_warn', {}, '+ its pass-through reimbursement')}` : ''} ${t('page.vehicles.delete.also_deleted', {}, 'will also be deleted.')}`
    : '';
  // Format the cost so DE comma vs EN dot follows dashboard locale
  // (UX backlog "locale-aware numbers in dialog bodies").
  const costFmt = formatCurrency(entry.total_cost, 'TZS');
  const msg = `${t('page.vehicles.delete.confirm', {
    date: entry.date, liters: entry.liters, cost: costFmt, station: entry.station,
  }, `Delete fuel entry from ${entry.date} (${entry.liters} L · ${costFmt} TZS @ ${entry.station})?`)}${txInfo}`;
  if (!(await uiConfirm(msg, { type: 'destructive' }))) return;
  try {
    const res = await fetch('/api/fuel/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fuel_id: fuelId }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      uiAlert(json.error || t('page.vehicles.delete.failed', {}, 'Delete failed'));
      return;
    }
    fuelLogLoaded = false;
    await loadVehiclesData();
    if (typeof loadAllData === 'function') {
      const reloaded = await loadAllData();
      if (reloaded) {
        state.tx = reloaded.tx;
        state.balances = computeBalances(state.tx, state.accounts);
      }
    }
    renderVehiclesPage();
  } catch (e) {
    uiAlert(String(e));
  }
}

// ─── Add Vehicle Modal (rc.13) ────────────────────────────────────────
//
// Vehicles are stored in data/vehicles.csv with columns: vehicle_id, name,
// license_plate, currency, default_account, default_payee,
// default_category, tracking_start_date, active, notes. Until rc.13 the only
// way to add a new vehicle was to hand-edit the CSV; this modal POSTs to
// /api/vehicles/add and re-renders the page on success.
function openVehicleModal() {
  const accounts = (state.accounts || []).filter(a => a.status === 'active');
  const accountOptions = accounts.map(a => `<option value="${escapeHtml(a.alias)}">${escapeHtml(a.alias)} — ${escapeHtml(a.name || '')}</option>`).join('');

  // Common currency options — covers the canonical FinanceOS set. Users on
  // exotic currencies can still type into the input (it falls back to a text
  // input when "Other…" is chosen).
  const currencyOptions = ['TZS', 'EUR', 'USD', 'PLN', 'GBP', 'CHF']
    .map(c => `<option value="${c}">${c}</option>`).join('');

  const todayIso = new Date().toISOString().slice(0, 10);

  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal" style="max-width:640px;">
      <h3>${t('page.vehicles.vehicle_modal.title', {}, 'Add')} <span class="accent">${t('page.vehicles.vehicle_modal.title_noun', {}, 'Vehicle')}</span></h3>
      <div class="atx-row">
        <div class="atx-field fx2"><label>${t('page.vehicles.vehicle_modal.name', {}, 'Name')}</label>
          <input type="text" id="vm-name" placeholder="${escapeHtml(t('page.vehicles.vehicle_modal.name_placeholder', {}, 'Toyota Vehicle'))}" required>
        </div>
        <div class="atx-field fx1"><label>${t('page.vehicles.vehicle_modal.plate', {}, 'License plate')}</label>
          <input type="text" id="vm-plate" placeholder="ABC 123">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('page.vehicles.vehicle_modal.currency', {}, 'Currency')}</label>
          <select id="vm-currency" required>${currencyOptions}</select>
        </div>
        <div class="atx-field fx1"><label>${t('page.vehicles.vehicle_modal.default_account', {}, 'Default account')}</label>
          <select id="vm-account"><option value="">—</option>${accountOptions}</select>
        </div>
        <div class="atx-field fx1"><label>${t('page.vehicles.vehicle_modal.tracking_start', {}, 'Tracking start')}</label>
          <input type="date" id="vm-track-start" value="${todayIso}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${t('page.vehicles.vehicle_modal.default_payee', {}, 'Default payee')}</label>
          <input type="text" id="vm-payee" placeholder="${escapeHtml(t('page.vehicles.vehicle_modal.payee_placeholder', {}, 'Petrol station name'))}">
        </div>
        <div class="atx-field fx1"><label>${t('page.vehicles.vehicle_modal.default_category', {}, 'Default category')}</label>
          <input type="text" id="vm-category" value="Automobile:Petrol" placeholder="Automobile:Petrol">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx2"><label>${t('page.vehicles.vehicle_modal.notes', {}, 'Notes')}</label>
          <input type="text" id="vm-notes" placeholder="${escapeHtml(t('page.vehicles.vehicle_modal.notes_placeholder', {}, 'Optional — e.g. company car, lease end Aug 2027'))}">
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
        <button id="vm-cancel" class="btn-secondary">${t('common.cancel', {}, 'Cancel')}</button>
        <button id="vm-save" class="btn-primary">${t('page.vehicles.vehicle_modal.save', {}, 'Save vehicle')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', escHandler);
  overlay._escHandler = escHandler;

  overlay.querySelector('#vm-cancel').addEventListener('click', () => closeModal());
  overlay.querySelector('#vm-save').addEventListener('click', async () => {
    const payload = {
      name: overlay.querySelector('#vm-name').value.trim(),
      license_plate: overlay.querySelector('#vm-plate').value.trim(),
      currency: overlay.querySelector('#vm-currency').value,
      default_account: overlay.querySelector('#vm-account').value,
      default_payee: overlay.querySelector('#vm-payee').value.trim(),
      default_category: overlay.querySelector('#vm-category').value.trim(),
      tracking_start_date: overlay.querySelector('#vm-track-start').value,
      notes: overlay.querySelector('#vm-notes').value.trim(),
      active: 'true',
    };
    if (!payload.name) {
      uiAlert(t('page.vehicles.vehicle_modal.err_name', {}, 'Name is required.'), { type: 'warning' });
      return;
    }
    const saveBtn = overlay.querySelector('#vm-save');
    saveBtn.disabled = true;
    saveBtn.textContent = t('page.vehicles.vehicle_modal.saving', {}, 'Saving…');
    try {
      const res = await fetch('/api/vehicles/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      closeModal();
      uiAlert(t('page.vehicles.vehicle_modal.success', { id: data.vehicle_id }, `Vehicle saved (${data.vehicle_id}).`), { type: 'info' });
      // Reload vehicle list + re-render so the new vehicle shows up in
      // any subsequent fuel-entry dropdown.
      await loadVehiclesData();
      renderVehiclesPage();
    } catch (e) {
      saveBtn.disabled = false;
      saveBtn.textContent = t('page.vehicles.vehicle_modal.save', {}, 'Save vehicle');
      uiAlert(t('page.vehicles.vehicle_modal.err_save', { msg: e.message }, `Save failed: ${e.message}`), { type: 'error' });
    }
  });

  setTimeout(() => overlay.querySelector('#vm-name')?.focus(), 50);
}
