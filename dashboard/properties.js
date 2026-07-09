// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ Properties Page — LUKU + Water tracking (Phase 2 of utilities subsystem) ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Mirrors the vehicles.js architecture: load list → activate one →
// fetch details → render KPIs + 4 charts + 2 tables. State is module-
// scoped so navigating away and back doesn't trigger an unnecessary
// re-fetch (charts are torn down on re-render to avoid memory leaks).

let propertiesList = [];
let activePropertyId = null;
let propertyDetails = null;
let propertyCharts = [];
// Period filter applied to charts + log tables. 'all' shows the full
// history (default); 'this_year' restricts to the current calendar
// year; 'last_3m' restricts to the rolling last-90-day window. KPIs
// stay computed against the full history because YTD already implies
// "this year" — clamping them to the period filter would double-clamp.
let propertyPeriod = 'all';
// Account cache (alias, name, status, currency, type) populated lazily so
// the Add-LUKU/Water modals can render the account dropdown without a
// per-modal round-trip. Refreshed each time the page is rendered.
let _propsAccountsCache = [];

// Tags cache mirrors the same lazy-load pattern as accounts so the
// LUKU/Water modal tag-pickers don't trigger a round-trip on open.
let _propsTagsCache = [];

// Mirrors config/defaults.json `auto_tag.by_account`. Used purely for UX
// hinting in the LUKU/Water modal — server-side `apply_auto_tags` stays
// authoritative; the server still appends/dedupes regardless of what the
// client renders. If config/defaults.json drifts, the worst case is the
// modal hint is stale, never that data is wrong.
// X-M2 (CODE_REVIEW_2026-06-12): derived from config/defaults.json:
// auto_tag.by_account (already in window.DEFAULTS after loadDefaults())
// instead of hardcoding the upstream account → business-tag pairs into
// shipped code. Template forks with an empty auto_tag config simply get
// no hint — same graceful degradation as before.
function _propsAccountAutotag(alias) {
  const byAccount =
    (window.DEFAULTS && window.DEFAULTS.auto_tag && window.DEFAULTS.auto_tag.by_account) || {};
  return byAccount[(alias || '').toLowerCase()] || '';
}

// Read the user's preferred display currency from core.js shared state.
// Properties data is always TZS in source, but the global currency
// switcher affects headline KPI rendering. DR-M1: the previous
// typeof-guards referenced phantom globals (toDisplayCurrency /
// currentCurrency) and always fell back to raw TZS.
function _propsToDisplay(amountTzs) {
  return toDisplay(amountTzs, 'TZS');
}

function _propsCurrencySymbol() {
  return ({ TZS: 'TZS', EUR: '€', USD: '$' })[displayCurrency] || displayCurrency;
}

function _propsFmt(value, opts = {}) {
  const num = Number(value);
  if (!isFinite(num)) return '–';
  const fractionDigits = opts.decimals ?? 0;
  return num.toLocaleString('de-DE', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

// ── Data loaders ────────────────────────────────────────────────────────────

// SWR (stale-while-revalidate) cache for the Properties page payload.
// Tanzania-Frankfurt RTT is ~800ms even after the combined endpoint —
// caching the last successful response keeps the page interactive on
// cold open while a fresh fetch reconciles in the background.
const _PROPS_CACHE_KEY_PREFIX = 'financeos.propsPageCache.';
const _PROPS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 24h — purely a stale ceiling

function _propsCacheKey(propertyId) {
  // Empty string is a legitimate cache key — server picks the first
  // active property when none is hinted, and the cached pick is still
  // a useful render hint for the next cold open.
  return `${_PROPS_CACHE_KEY_PREFIX}${propertyId || ''}`;
}

function _readPropsCache(propertyId) {
  try {
    const raw = localStorage.getItem(_propsCacheKey(propertyId));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== 'object') return null;
    if (Date.now() - (entry.ts || 0) > _PROPS_CACHE_TTL_MS) return null;
    return entry.data || null;
  } catch (err) {
    // Quota-exceeded / parse errors are non-fatal — just skip the cache.
    return null;
  }
}

function _writePropsCache(propertyId, data) {
  try {
    localStorage.setItem(_propsCacheKey(propertyId), JSON.stringify({
      ts: Date.now(), data,
    }));
  } catch (err) {
    // Storage quota hit — silently drop. The page still renders fresh
    // from the network; we just lose the next cold-open speedup.
  }
}

function _invalidatePropsCache(propertyId = null) {
  // Property-targeted edits clear just their key; structural changes
  // (CRUD on properties.csv) sweep every key under the prefix.
  try {
    if (propertyId !== null) {
      localStorage.removeItem(_propsCacheKey(propertyId));
      localStorage.removeItem(_propsCacheKey(''));  // server-picked alias
      return;
    }
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(_PROPS_CACHE_KEY_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch (err) {
    // No-op — cache stays, will get superseded on next write.
  }
}

// Combined loader — fetches properties list + active-property details +
// account/tag cache in one round-trip. Used by renderPropertiesPage()
// to collapse cold opens from 2 sequential RTTs to 1. Granular endpoints
// (loadPropertiesList / loadPropertyDetails / _loadPropsAccountsCache)
// stay live for partial refreshes after edits.
async function loadPropertiesPage(propertyId = '') {
  const resp = await fetch('/api/properties/page', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(propertyId ? { property_id: propertyId } : {}),
  });
  if (!resp.ok) throw new Error(`properties/page ${resp.status}`);
  const data = await resp.json();
  _writePropsCache(propertyId, data);
  // Server may have resolved to a different active property than we hinted
  // (e.g. empty hint → server picks first active). Cache that key too so a
  // direct request for the resolved id is also a cache hit next time.
  const resolved = data.active_property_id || '';
  if (resolved && resolved !== propertyId) {
    _writePropsCache(resolved, data);
  }
  propertiesList = data.properties || [];
  _propsAccountsCache = Array.isArray(data.accounts) ? data.accounts : [];
  _propsTagsCache = Array.isArray(data.tags) ? data.tags.filter(t => t.active) : [];
  return { details: data.details || null, activeId: resolved };
}

// Apply a /api/properties/page payload to module state without going to
// the network. Used by the SWR path so the cached payload renders
// instantly, then the live fetch reconciles via the same code path.
function _applyPropertiesPagePayload(data) {
  propertiesList = data.properties || [];
  _propsAccountsCache = Array.isArray(data.accounts) ? data.accounts : [];
  _propsTagsCache = Array.isArray(data.tags) ? data.tags.filter(t => t.active) : [];
  return { details: data.details || null, activeId: data.active_property_id || '' };
}

async function loadPropertiesList() {
  const resp = await fetch('/api/properties/list', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!resp.ok) throw new Error(`properties/list ${resp.status}`);
  const data = await resp.json();
  propertiesList = data.properties || [];
  return propertiesList;
}

async function _loadPropsAccountsCache() {
  // Pulled from /api/tx/context which is the canonical source for the
  // account list across the dashboard. Quietly fall back to an empty
  // array on failure so the modal still opens with the property's
  // default_account preselected. Tags ride along on the same response
  // since /api/tx/context already returns them — avoids a second probe.
  try {
    const resp = await fetch('/api/tx/context', { method: 'POST' });
    if (!resp.ok) throw new Error(`tx/context ${resp.status}`);
    const data = await resp.json();
    _propsAccountsCache = Array.isArray(data.accounts) ? data.accounts : [];
    _propsTagsCache = Array.isArray(data.tags) ? data.tags.filter(t => t.active) : [];
  } catch (err) {
    console.warn('[properties] account cache load failed:', err);
    _propsAccountsCache = [];
    _propsTagsCache = [];
  }
}

async function loadPropertyDetails(propertyId) {
  const resp = await fetch('/api/properties/details', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ property_id: propertyId }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`properties/details ${resp.status}: ${text}`);
  }
  return await resp.json();
}

// ── Cost-overview helpers (v2026-05-12.7) ───────────────────────────────────
//
// cost_overview comes from /api/properties/details and aggregates every
// TX carrying the property's cost_tag (e.g. Property_<X>) into buckets +
// by_month + by_category + tx_list. utilities_electricity and
// utilities_water buckets overlap with the LUKU/Water logs, so "other"
// = everything except those two buckets.

// "Other" = everything that's not represented by its own dedicated KPI
// card / stack series. Rent + Service Charges got promoted to top-level
// in v2026-05-12.8, Maintenance followed in v2026-05-12.9 — each pulled
// out so it stops drowning the donut + Other-log signal. Order in the
// set is irrelevant; this is a lookup table.
const _OTHER_EXCLUDE_BUCKETS = new Set([
  'utilities_electricity',
  'utilities_water',
  'rent',
  'service_charges',
  'maintenance',
  'staff',
]);

function _isOtherBucket(bucket) {
  return !_OTHER_EXCLUDE_BUCKETS.has(bucket || '');
}

function _costOverviewYearTotals(co, year) {
  // Returns per-bucket sums for the given calendar year by walking
  // cost_overview.by_month. Rent + Service Charges + Maintenance are
  // broken out as top-level fields because they're typically the
  // three biggest non-utility line items for a rented property and
  // each deserves its own KPI card + stack series rather than being
  // swallowed by "Other".
  const prefix = String(year);
  let total = 0;
  let electricity = 0;
  let water = 0;
  let rent = 0;
  let serviceCharges = 0;
  let maintenance = 0;
  let staff = 0;
  for (const m of (co?.by_month || [])) {
    if (!String(m.month || '').startsWith(prefix)) continue;
    total += Number(m.total || 0);
    electricity += Number(m.utilities_electricity || 0);
    water += Number(m.utilities_water || 0);
    rent += Number(m.rent || 0);
    serviceCharges += Number(m.service_charges || 0);
    maintenance += Number(m.maintenance || 0);
    staff += Number(m.staff || 0);
  }
  const other = total - electricity - water - rent - serviceCharges - maintenance - staff;
  return {
    total,
    electricity,
    water,
    rent,
    service_charges: serviceCharges,
    maintenance,
    staff,
    other,
  };
}

function _clampCostOverviewToPeriod(co, period) {
  // Returns a shallow-cloned cost_overview whose by_month + tx_list +
  // by_category + totals are clamped to the period window. Used so the
  // Monthly Cost Breakdown chart, Other-by-Category donut, and Other
  // Costs log table all honor the active period pill.
  if (!co || period === 'all') return co;
  const w = _periodCutoff(period);
  const fromMonth = w?.from ? w.from.slice(0, 7) : '';
  const toMonth = w?.to ? w.to.slice(0, 7) : '';
  const inMonth = (m) => {
    const mk = String(m.month || '');
    if (fromMonth && mk < fromMonth) return false;
    if (toMonth && mk > toMonth) return false;
    return true;
  };
  const inDate = (iso) => {
    const d = iso || '';
    if (w?.from && d < w.from) return false;
    if (w?.to && d > w.to) return false;
    return true;
  };
  const byMonth = (co.by_month || []).filter(inMonth);
  const txList = (co.tx_list || []).filter((r) => inDate(r.date));
  // Re-aggregate totals from the filtered by_month so headline figures
  // in this period match the chart. Recomputing from tx_list would
  // double-walk; by_month already has bucket sums.
  const totals = { grand_total: 0 };
  for (const m of byMonth) {
    for (const [k, v] of Object.entries(m)) {
      if (k === 'month' || k === 'total') continue;
      totals[k] = (totals[k] || 0) + Number(v || 0);
    }
    totals.grand_total += Number(m.total || 0);
  }
  // Re-aggregate by_category from the filtered tx_list. We preserve the
  // bucket from the full cost_overview so the donut keeps its color
  // mapping stable across period switches.
  const bucketByCategory = new Map();
  for (const c of (co.by_category || [])) {
    bucketByCategory.set(c.category, c.bucket);
  }
  const byCatMap = new Map();
  for (const tx of txList) {
    const cat = tx.category || '';
    const amount = Number(tx.amount || 0);
    const entry = byCatMap.get(cat) || {
      category: cat,
      amount: 0,
      count: 0,
      bucket: bucketByCategory.get(cat) || 'other',
    };
    entry.amount += amount;
    entry.count += 1;
    byCatMap.set(cat, entry);
  }
  const byCategory = Array.from(byCatMap.values()).sort((a, b) => b.amount - a.amount);
  return { ...co, by_month: byMonth, tx_list: txList, totals, by_category: byCategory };
}

// ── Period filter ───────────────────────────────────────────────────────────

function _periodCutoff(period) {
  // Returns { from, to } ISO-date window (inclusive on both ends) for the
  // active period, or null when 'all' is active. `from` and `to` may be
  // null individually for half-open windows (e.g. 'this_year' has no upper
  // bound, since future-dated rows would be ignored anyway).
  if (period === 'this_year') {
    const y = new Date().getFullYear();
    return { from: `${y}-01-01`, to: null };
  }
  if (period === 'last_3m') {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return { from: d.toISOString().slice(0, 10), to: null };
  }
  const yearMatch = /^year:(\d{4})$/.exec(period);
  if (yearMatch) {
    const yr = yearMatch[1];
    return { from: `${yr}-01-01`, to: `${yr}-12-31` };
  }
  return null;
}

function _filterByPeriod(rows, period) {
  const w = _periodCutoff(period);
  if (!w) return rows;
  return rows.filter((r) => {
    const d = r.date || '';
    if (w.from && d < w.from) return false;
    if (w.to && d > w.to) return false;
    return true;
  });
}

function _propsYearFromPeriod(period) {
  const m = /^year:(\d{4})$/.exec(period || '');
  return m ? Number(m[1]) : null;
}

function _availablePropertyYears() {
  // Years derived from the loaded property's logs. Used to render the
  // dynamic year-pills in the period selector. Excludes the current year
  // (already covered by the rolling 'this_year' pill).
  const years = new Set();
  if (!propertyDetails) return [];
  for (const r of propertyDetails.luku_log || []) {
    const y = (r.date || '').slice(0, 4);
    if (/^\d{4}$/.test(y)) years.add(y);
  }
  for (const r of propertyDetails.water_log || []) {
    const y = (r.date || '').slice(0, 4);
    if (/^\d{4}$/.test(y)) years.add(y);
  }
  // Property-tagged TX (cost_tag) may exist for years that have no
  // LUKU/Water purchases (e.g. a year with only repairs). Include those
  // years in the period pills so the user can filter to them.
  for (const y of (propertyDetails.cost_overview?.available_years || [])) {
    if (/^\d{4}$/.test(y)) years.add(y);
  }
  years.delete(String(new Date().getFullYear()));
  return Array.from(years).sort().reverse();
}

function _recomputeKpisForYear(details, year) {
  // For year:YYYY mode, server-computed KPIs (which are YTD = current year)
  // no longer match the selected window, so we recompute the headline
  // figures client-side from the full luku/water logs filtered to that
  // calendar year. days_since_* is intentionally nulled — "days ago"
  // relative to today is meaningless when looking at a past year.
  const yearStr = String(year);
  const luku = (details.luku_log || []).filter((r) => (r.date || '').startsWith(yearStr));
  const water = (details.water_log || []).filter((r) => (r.date || '').startsWith(yearStr));
  const num = (v) => Number(v || 0);
  const sum = (arr, key) => arr.reduce((acc, r) => acc + num(r[key]), 0);
  const stromTotal = sum(luku, 'total_price');
  const kwhTotal = sum(luku, 'units_kwh');
  const waterTotal = sum(water, 'total_price');
  const lukuPrices = luku.map((r) => num(r.price_per_unit)).filter((v) => v > 0);
  const avgPrice = lukuPrices.length ? lukuPrices.reduce((a, b) => a + b, 0) / lukuPrices.length : 0;
  const latestLuku = luku.length ? luku.map((r) => r.date).sort().slice(-1)[0] : null;
  const latestWater = water.length ? water.map((r) => r.date).sort().slice(-1)[0] : null;
  // Property Total / Other Costs for the selected year come from the
  // full cost_overview (unclamped — we explicitly want the year, not
  // whatever the period filter would shrink it to).
  const yearTotals = _costOverviewYearTotals(details.cost_overview, year);
  return {
    ...(details.kpis || {}),
    strom_ytd: stromTotal,
    kwh_ytd: kwhTotal,
    wasser_ytd: waterTotal,
    avg_tzs_per_kwh: avgPrice,
    avg_strom_monthly: stromTotal / 12,
    avg_wasser_monthly: waterTotal / 12,
    latest_luku_date: latestLuku,
    latest_water_date: latestWater,
    days_since_luku: null,
    days_since_water: null,
    total_ytd: yearTotals.total,
    other_ytd: yearTotals.other,
    rent_ytd: yearTotals.rent,
    service_charges_ytd: yearTotals.service_charges,
    maintenance_ytd: yearTotals.maintenance,
    staff_ytd: yearTotals.staff,
  };
}

function _applyPeriodToDetails(details, period) {
  // Returns a shallow-cloned details object whose chart-data + log-table
  // arrays are clamped to the active period. For rolling periods
  // ('last_3m' / 'this_year') KPIs stay untouched — server-side YTD already
  // represents "this year" and rolling averages use their own rolling-12
  // window. For year:YYYY KPIs are recomputed client-side so the headline
  // figures actually reflect the selected calendar year.
  if (period === 'all') return details;
  const w = _periodCutoff(period);
  const fromMonth = w?.from ? w.from.slice(0, 7) : '';
  const toMonth = w?.to ? w.to.slice(0, 7) : '';
  const inWindow = (m) => {
    if (!m || !m.month) return false;
    if (fromMonth && m.month < fromMonth) return false;
    if (toMonth && m.month > toMonth) return false;
    return true;
  };
  const inDateWindow = (iso) => {
    const d = iso || '';
    if (w?.from && d < w.from) return false;
    if (w?.to && d > w.to) return false;
    return true;
  };
  const year = _propsYearFromPeriod(period);
  return {
    ...details,
    luku_log: _filterByPeriod(details.luku_log || [], period),
    water_log: _filterByPeriod(details.water_log || [], period),
    monthly_luku: (details.monthly_luku || []).filter(inWindow),
    monthly_water: (details.monthly_water || []).filter(inWindow),
    purchase_freq: (details.purchase_freq || []).filter(inWindow),
    price_trend: (details.price_trend || []).filter((p) => inDateWindow(p.date)),
    cost_overview: _clampCostOverviewToPeriod(details.cost_overview, period),
    // YTD-cumulative + yearly + seasonality stay full-history — they
    // are explicitly comparison views (current vs. previous, year-over-year),
    // so clamping them by period would erase the comparison baseline.
    kpis: year ? _recomputeKpisForYear(details, year) : details.kpis,
  };
}

function renderPeriodPills() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px;';
  const yearPills = _availablePropertyYears().map((y) => ({ id: `year:${y}`, label: String(y) }));
  const periods = [
    { id: 'last_3m', label: t('page.properties.period.last_3m', {}, 'Last 3 months') },
    { id: 'this_year', label: t('page.properties.period.this_year', {}, 'This year') },
    ...yearPills,
    { id: 'all', label: t('page.properties.period.all', {}, 'All time') },
  ];
  for (const p of periods) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.period = p.id;
    const active = p.id === propertyPeriod;
    btn.style.cssText = `padding:6px 12px;border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};border-radius:8px;background:${active ? 'var(--accent)' : 'transparent'};color:${active ? 'var(--bg)' : 'inherit'};cursor:pointer;font-size:12px;font-weight:${active ? '600' : '500'};`;
    btn.textContent = p.label;
    wrap.appendChild(btn);
  }
  return wrap;
}

// ── Page entry ──────────────────────────────────────────────────────────────

// Apply the resolved page state to the DOM. Pure render — never fetches.
// Called by both the SWR cache fast-path and the network slow-path so a
// background refresh's swap-in goes through the exact same code.
function _paintPropertiesPage(root) {
  if (!propertiesList.length) {
    root.innerHTML = `
      <div class="empty-state">
        <h3>${escapeHtml(t('page.properties.empty.title', {}, 'No properties configured'))}</h3>
        <p>${escapeHtml(t('page.properties.empty.body', {}, 'Add a property via Settings → Properties, or edit data/properties.csv directly.'))}</p>
      </div>`;
    return;
  }
  if (!propertyDetails) {
    return;  // bail — caller will surface an error banner
  }
  localStorage.setItem('financeos.activePropertyId', activePropertyId);

  // If the active year-pill points at a year the freshly loaded property
  // has no data for, fall back to 'all' so the selector doesn't render
  // with no active pill (and a confusing empty drilldown).
  const activeYear = _propsYearFromPeriod(propertyPeriod);
  if (activeYear && !_availablePropertyYears().includes(String(activeYear))) {
    propertyPeriod = 'all';
  }

  root.innerHTML = '';
  root.appendChild(renderPropertySelector());
  root.appendChild(renderPeriodPills());
  // Apply the active period filter to both the rendered drilldown
  // (charts + log tables) and the chart-draw step. KPIs render against
  // the full-history details so YTD/rolling-12 stays sensible.
  const filtered = _applyPeriodToDetails(propertyDetails, propertyPeriod);
  root.appendChild(renderDrilldown(filtered));
  bindPropertyControls();
  // Charts must be drawn AFTER canvases are in the DOM. Deferring to the
  // next animation frame lets the browser paint once before Chart.js
  // reads canvas/parent dimensions — without this, the constructor's
  // size measurement forces a synchronous layout recompute across all
  // 10 charts on the Properties page (visible as "Forced reflow took
  // ~45ms" in DevTools). The user-perceived order is unchanged: the
  // page is still interactive within the same frame.
  requestAnimationFrame(() => drawPropertyCharts(filtered));
}

// Resolve the active property id from the freshly loaded list. Falls
// back to first-active when the hinted id is no longer valid.
function _resolveActivePropertyId(hintedId, serverPick) {
  const exists = (id) => propertiesList.some((p) => p.property_id === id);
  if (serverPick && exists(serverPick)) return serverPick;
  if (exists(hintedId)) return hintedId;
  return propertiesList.length ? propertiesList[0].property_id : '';
}

async function renderPropertiesPage() {
  const root = document.getElementById('properties-content');
  if (!root) return;

  // Hint the server about which property to populate so the combined
  // endpoint can pre-build the details payload without us needing a
  // second round-trip. Falls back to "" (server picks first active).
  const remembered = localStorage.getItem('financeos.activePropertyId');
  const hintedId = activePropertyId || remembered || '';

  // SWR fast-path — paint cached state immediately so the page is
  // interactive within milliseconds, then revalidate in the background.
  // The cached payload was the full server response from last visit, so
  // we can hydrate every module-level cache (propertiesList, accounts,
  // tags) without doing any partial-rehydration gymnastics.
  const cached = _readPropsCache(hintedId);
  let renderedFromCache = false;
  if (cached) {
    const applied = _applyPropertiesPagePayload(cached);
    if (propertiesList.length) {
      const resolvedId = _resolveActivePropertyId(hintedId, applied.activeId);
      activePropertyId = resolvedId;
      if (applied.details && applied.details.property?.property_id === resolvedId) {
        propertyDetails = applied.details;
        _paintPropertiesPage(root);
        renderedFromCache = true;
      }
    }
  }

  if (!renderedFromCache) {
    root.innerHTML = `<div class="page-loading">${escapeHtml(t('page.properties.loading', {}, 'Loading properties…'))}</div>`;
  }

  let pageData;
  try {
    pageData = await loadPropertiesPage(hintedId);
  } catch (err) {
    console.error('[properties] page load failed:', err);
    // Only surface the error banner when there was no cached render to
    // fall back to. With a cache hit, the user already sees a working
    // (possibly slightly stale) page; logging the error is enough.
    if (!renderedFromCache) {
      root.innerHTML = `<div class="error-banner">${escapeHtml(t('page.properties.err_list', { msg: err.message }, `Could not load properties: ${err.message}`))}</div>`;
    }
    return;
  }

  const resolvedId = _resolveActivePropertyId(hintedId, pageData.activeId);
  activePropertyId = resolvedId;

  // Use the bundled details when they match the resolved property;
  // otherwise the user must have switched mid-flight — fall back to a
  // targeted details fetch so the page still renders correctly.
  if (pageData.details && pageData.details.property?.property_id === activePropertyId) {
    propertyDetails = pageData.details;
  } else {
    try {
      propertyDetails = await loadPropertyDetails(activePropertyId);
    } catch (err) {
      console.error('[properties] details fallback failed:', err);
      if (!renderedFromCache) {
        root.innerHTML = `<div class="error-banner">${escapeHtml(t('page.properties.err_details', { msg: err.message }, `Could not load property details: ${err.message}`))}</div>`;
      }
      return;
    }
  }

  _paintPropertiesPage(root);
}

// ── Selector strip (one pill per property) ──────────────────────────────────

function renderPropertySelector() {
  const wrap = document.createElement('div');
  wrap.className = 'vehicle-selector';
  const ytdLabel = t('page.properties.ytd_short', {}, 'YTD');
  // Period chip strip (mirrors the Vehicles "Last 3M / This Year / All"
  // tabs). Filtering itself happens client-side in renderDrilldown when
  // the active period changes — see _filterByPeriod().
  const today = new Date().toISOString().slice(0, 10);
  for (const p of propertiesList) {
    const pill = document.createElement('button');
    pill.type = 'button';
    const archived = (p.end_date || '').trim() && p.end_date <= today;
    pill.className = 'vehicle-pill' + (p.property_id === activePropertyId ? ' active' : '') + (archived ? ' archived' : '');
    if (archived) pill.style.opacity = '0.7';
    pill.dataset.propertyId = p.property_id;
    const ytdStrom = _propsFmt(_propsToDisplay(p.kpis?.strom_ytd || 0));
    const ytdWater = _propsFmt(_propsToDisplay(p.kpis?.wasser_ytd || 0));
    const lifecycle = _renderLifecycleBadge(p.start_date, p.end_date);
    pill.innerHTML = `
      <span class="vehicle-pill-name">${escapeHtml(p.name || p.property_id)}${lifecycle}</span>
      <span class="vehicle-pill-meta">${ytdStrom} ${_propsCurrencySymbol()} · ${ytdWater} ${_propsCurrencySymbol()} ${escapeHtml(ytdLabel)}</span>`;
    wrap.appendChild(pill);
  }
  return wrap;
}

// ── Drilldown body ──────────────────────────────────────────────────────────

function renderDrilldown(details) {
  const wrap = document.createElement('div');
  wrap.className = 'property-drilldown';

  // Inject Property-Total + Other-Costs YTD into kpis before render so
  // the KPI grid stays a pure renderer. _recomputeKpisForYear already
  // overrides server-side YTD for year:YYYY mode — for other periods
  // we re-derive from the UNCLAMPED cost_overview against the current
  // year (or selected year). Using the clamped details.cost_overview
  // here would understate totals for rolling windows like 'last_3m'
  // that don't cover the full calendar year.
  const ytdYear = _propsYearFromPeriod(propertyPeriod) || new Date().getFullYear();
  const yearTotals = _costOverviewYearTotals(propertyDetails?.cost_overview, ytdYear);
  const enrichedKpis = {
    ...details.kpis,
    total_ytd: details.kpis?.total_ytd ?? yearTotals.total,
    other_ytd: details.kpis?.other_ytd ?? yearTotals.other,
    rent_ytd: details.kpis?.rent_ytd ?? yearTotals.rent,
    service_charges_ytd: details.kpis?.service_charges_ytd ?? yearTotals.service_charges,
    maintenance_ytd: details.kpis?.maintenance_ytd ?? yearTotals.maintenance,
    staff_ytd: details.kpis?.staff_ytd ?? yearTotals.staff,
  };

  wrap.appendChild(renderDrilldownHeader(details));
  wrap.appendChild(renderKpiGrid(enrichedKpis));
  wrap.appendChild(renderChartsGrid());
  wrap.appendChild(renderLogsSection(details));
  return wrap;
}

function renderDrilldownHeader(details) {
  const prop = details.property;
  const div = document.createElement('div');
  div.className = 'property-header';
  const meta = `${escapeHtml(prop.address || '')} · ${escapeHtml(t('page.properties.default_short', {}, 'Default'))} ${escapeHtml(prop.default_account)} · ${escapeHtml(t('page.properties.meter_short', {}, 'Meter'))} ${escapeHtml(prop.electricity_meter || '–')} / ${escapeHtml(prop.water_meter || '–')}`;
  const lifecycleBadge = _renderLifecycleBadge(prop.start_date, prop.end_date);
  div.innerHTML = `
    <div class="property-meta">
      <h3>${escapeHtml(prop.name)} ${lifecycleBadge}</h3>
      <div class="muted">${meta}</div>
    </div>
    <div class="property-actions">
      <button type="button" id="btn-add-luku" class="btn-accent">+ ${escapeHtml(t('page.properties.add_luku', {}, 'Buy Electricity'))}</button>
      <button type="button" id="btn-add-water" class="btn-accent">+ ${escapeHtml(t('page.properties.add_water', {}, 'Pay Water'))}</button>
      <button type="button" id="btn-property-excel" style="padding:8px 14px;background:transparent;color:var(--muted);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;font-weight:500;">${escapeHtml(t('page.properties.excel_export', {}, 'Excel Export'))}</button>
    </div>`;
  return div;
}

function renderKpiGrid(kpis) {
  const cur = _propsCurrencySymbol();
  const yearMode = _propsYearFromPeriod(propertyPeriod);
  const ytdYear = yearMode || new Date().getFullYear();
  const avgNote = yearMode
    ? t('page.properties.kpi.year_average', { year: yearMode }, `${yearMode} average`)
    : t('page.properties.kpi.rolling_12', {}, 'rolling 12m');
  const lukuDays = kpis.days_since_luku;
  const waterDays = kpis.days_since_water;
  const cards = [
    { label: t('page.properties.kpi.total_ytd', { year: ytdYear }, `Property Total ${ytdYear}`), val: _propsFmt(_propsToDisplay(kpis.total_ytd || 0)), unit: cur },
    { label: t('page.properties.kpi.rent_ytd', { year: ytdYear }, `Rent ${ytdYear}`), val: _propsFmt(_propsToDisplay(kpis.rent_ytd || 0)), unit: cur },
    { label: t('page.properties.kpi.service_charges_ytd', { year: ytdYear }, `Service Charges ${ytdYear}`), val: _propsFmt(_propsToDisplay(kpis.service_charges_ytd || 0)), unit: cur },
    { label: t('page.properties.kpi.maintenance_ytd', { year: ytdYear }, `Maintenance ${ytdYear}`), val: _propsFmt(_propsToDisplay(kpis.maintenance_ytd || 0)), unit: cur },
    { label: t('page.properties.kpi.staff_ytd', { year: ytdYear }, `Staff ${ytdYear}`), val: _propsFmt(_propsToDisplay(kpis.staff_ytd || 0)), unit: cur },
    { label: t('page.properties.kpi.electricity_ytd', { year: ytdYear }, `Electricity ${ytdYear}`), val: _propsFmt(_propsToDisplay(kpis.strom_ytd)), unit: cur },
    { label: t('page.properties.kpi.water_ytd', { year: ytdYear }, `Water ${ytdYear}`), val: _propsFmt(_propsToDisplay(kpis.wasser_ytd)), unit: cur },
    { label: t('page.properties.kpi.other_ytd', { year: ytdYear }, `Other Costs ${ytdYear}`), val: _propsFmt(_propsToDisplay(kpis.other_ytd || 0)), unit: cur },
    { label: t('page.properties.kpi.kwh_ytd', { year: ytdYear }, `kWh ${ytdYear}`), val: _propsFmt(kpis.kwh_ytd, { decimals: 0 }), unit: 'kWh' },
    { label: t('page.properties.kpi.avg_price', {}, 'Avg Price/kWh'), val: _propsFmt(kpis.avg_tzs_per_kwh, { decimals: 2 }), unit: 'TZS' },
    { label: t('page.properties.kpi.avg_electricity_month', {}, 'Avg Electricity / Month'), val: _propsFmt(_propsToDisplay(kpis.avg_strom_monthly)), unit: cur, note: avgNote },
    { label: t('page.properties.kpi.avg_water_month', {}, 'Avg Water / Month'), val: _propsFmt(_propsToDisplay(kpis.avg_wasser_monthly)), unit: cur, note: avgNote },
    { label: t('page.properties.kpi.last_luku', {}, 'Last LUKU Entry'), val: kpis.latest_luku_date || '–', unit: '', note: lukuDays != null ? t('page.properties.kpi.days_ago', { n: lukuDays }, `${lukuDays} days ago`) : '' },
    { label: t('page.properties.kpi.last_water', {}, 'Last Water Entry'), val: kpis.latest_water_date || '–', unit: '', note: waterDays != null ? t('page.properties.kpi.days_ago', { n: waterDays }, `${waterDays} days ago`) : '' },
  ];
  const grid = document.createElement('div');
  grid.className = 'kpi-grid kpi-grid-properties';
  for (const c of cards) {
    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.innerHTML = `
      <div class="label">${escapeHtml(c.label)}</div>
      <div class="value">${escapeHtml(String(c.val))} <span class="cur">${escapeHtml(c.unit)}</span></div>
      ${c.note ? `<div class="delta">${escapeHtml(c.note)}</div>` : ''}`;
    grid.appendChild(card);
  }
  return grid;
}

function renderChartsGrid() {
  const wrap = document.createElement('div');
  wrap.className = 'charts-grid charts-grid-properties';
  wrap.innerHTML = `
    <div class="chart-card" style="grid-column:1/-1;">
      <h4>${escapeHtml(t('page.properties.chart.monthly_breakdown', {}, 'Monthly Cost Breakdown — Electricity / Water / Other'))}</h4>
      <canvas id="chart-monthly-breakdown"></canvas>
    </div>
    <div class="chart-card">
      <h4>${escapeHtml(t('page.properties.chart.other_categories', {}, 'Other Costs by Category'))}</h4>
      <canvas id="chart-other-categories"></canvas>
    </div>
    <div class="chart-card">
      <h4>${escapeHtml(t('page.properties.chart.luku_cost', {}, 'Monthly Electricity Costs'))}</h4>
      <canvas id="chart-luku-cost"></canvas>
    </div>
    <div class="chart-card">
      <h4>${escapeHtml(t('page.properties.chart.luku_kwh', {}, 'Monthly Electricity Consumption'))}</h4>
      <canvas id="chart-luku-kwh"></canvas>
    </div>
    <div class="chart-card">
      <h4>${escapeHtml(t('page.properties.chart.water_cost', {}, 'Monthly Water Costs'))}</h4>
      <canvas id="chart-water-cost"></canvas>
    </div>
    <div class="chart-card">
      <h4>${escapeHtml(t('page.properties.chart.yearly', {}, 'Yearly Comparison Electricity vs. Water'))}</h4>
      <canvas id="chart-yearly"></canvas>
    </div>
    <div class="chart-card">
      <h4>${escapeHtml(t('page.properties.chart.price_trend', {}, 'Price per kWh — Trend'))}</h4>
      <canvas id="chart-price-trend"></canvas>
    </div>
    <div class="chart-card">
      <h4>${escapeHtml(t('page.properties.chart.ytd_electricity', {}, 'YTD Cumulative Electricity — Current vs. Previous Year'))}</h4>
      <canvas id="chart-ytd-electricity"></canvas>
    </div>
    <div class="chart-card">
      <h4>${escapeHtml(t('page.properties.chart.ytd_water', {}, 'YTD Cumulative Water — Current vs. Previous Year'))}</h4>
      <canvas id="chart-ytd-water"></canvas>
    </div>
    <div class="chart-card">
      <h4>${escapeHtml(t('page.properties.chart.purchase_freq', {}, 'LUKU Purchases per Month'))}</h4>
      <canvas id="chart-purchase-freq"></canvas>
    </div>
    <div class="chart-card" style="grid-column:1/-1;">
      <h4>${escapeHtml(t('page.properties.chart.heatmap', {}, 'Seasonality (Year × Month)'))}</h4>
      <div id="chart-heatmap" style="overflow-x:auto;"></div>
    </div>`;
  return wrap;
}

function renderLogsSection(details) {
  const wrap = document.createElement('div');
  wrap.className = 'property-logs';
  const tDate = t('common.table.date', {}, 'Date');
  const tAccount = t('common.table.account', {}, 'Account');
  const tTx = t('common.table.tx', {}, 'TX');
  const tEntries = (n) => t('page.properties.entries', { n }, `${n} entries`);
  // Other property costs = cost_overview.tx_list filtered to non-utility
  // buckets. Capped to keep the table scannable; the user can drill into
  // the underlying TX via the TX-id link.
  const otherCosts = (details.cost_overview?.tx_list || [])
    .filter((tx) => _isOtherBucket(_lookupBucketForCategory(details.cost_overview, tx.category)));
  wrap.innerHTML = `
    <div class="logs-grid">
      <div class="log-block">
        <h4>${escapeHtml(t('page.properties.luku_log', {}, 'LUKU Log'))} <span class="muted">(${escapeHtml(tEntries(details.luku_log.length))})</span></h4>
        <div class="table-scroll">
          <table class="data-table" id="table-luku-log">
            <thead><tr>
              <th>${escapeHtml(tDate)}</th>
              <th class="num">${escapeHtml(t('page.properties.bought_short', {}, 'Bought'))}</th>
              <th class="num">${escapeHtml(t('page.properties.consumption_short', {}, 'Used'))}</th>
              <th class="num">TZS</th>
              <th class="num">${escapeHtml(t('page.properties.reading_short', {}, 'Reading'))}</th>
              <th>${escapeHtml(tAccount)}</th>
              <th>${escapeHtml(tTx)}</th>
              <th></th>
            </tr></thead>
            <tbody>${renderLukuRows(details.luku_log)}</tbody>
          </table>
        </div>
      </div>
      <div class="log-block">
        <h4>${escapeHtml(t('page.properties.water_log', {}, 'Water Log'))} <span class="muted">(${escapeHtml(tEntries(details.water_log.length))})</span></h4>
        <div class="table-scroll">
          <table class="data-table" id="table-water-log">
            <thead><tr>
              <th>${escapeHtml(tDate)}</th>
              <th class="num">TZS</th>
              <th>${escapeHtml(t('page.properties.control_short', {}, 'Control'))}</th>
              <th>${escapeHtml(tAccount)}</th>
              <th>${escapeHtml(tTx)}</th>
              <th></th>
            </tr></thead>
            <tbody>${renderWaterRows(details.water_log)}</tbody>
          </table>
        </div>
      </div>
      <div class="log-block" style="grid-column:1/-1;">
        <h4>${escapeHtml(t('page.properties.other_log', {}, 'Other Property Costs'))} <span class="muted">(${escapeHtml(tEntries(otherCosts.length))})</span></h4>
        <div class="table-scroll">
          <table class="data-table" id="table-other-log">
            <thead><tr>
              <th>${escapeHtml(tDate)}</th>
              <th>${escapeHtml(t('common.table.category', {}, 'Category'))}</th>
              <th>${escapeHtml(t('common.table.payee', {}, 'Payee'))}</th>
              <th>${escapeHtml(t('common.table.note', {}, 'Note'))}</th>
              <th class="num">TZS</th>
              <th>${escapeHtml(tAccount)}</th>
              <th>${escapeHtml(tTx)}</th>
            </tr></thead>
            <tbody>${renderOtherCostsRows(otherCosts)}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  return wrap;
}

function _lookupBucketForCategory(co, category) {
  // Lookup helper used by Other-Costs filtering. We map each TX's
  // category back to its bucket via cost_overview.by_category so the
  // filter agrees with the server-side _classify_cost_bucket logic
  // (Bills:Electricity / Bills:Water excluded as those are in the
  // LUKU + Water log blocks above).
  if (!co || !category) return 'other';
  for (const c of (co.by_category || [])) {
    if (c.category === category) return c.bucket || 'other';
  }
  return 'other';
}

function renderOtherCostsRows(rows) {
  if (!rows.length) {
    return `<tr><td colspan="7" class="muted">${escapeHtml(t('page.properties.empty_log', {}, 'No entries'))}</td></tr>`;
  }
  const sorted = [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return sorted.map((r) => {
    const txLink = r.import_id
      ? `<a href="#transactions" data-tx-id="${escapeHtml(r.import_id)}" class="tx-link">${escapeHtml(String(r.import_id).slice(0, 8))}</a>`
      : '<span class="muted">–</span>';
    const note = r.note ? escapeHtml(r.note) : '<span class="muted">–</span>';
    return `<tr>
      <td>${escapeHtml(r.date || '')}</td>
      <td>${escapeHtml(r.category || '')}</td>
      <td>${escapeHtml(r.payee || '')}</td>
      <td>${note}</td>
      <td class="num">${_propsFmt(Number(r.amount || 0))}</td>
      <td>${escapeHtml(r.account || '–')}</td>
      <td>${txLink}</td>
    </tr>`;
  }).join('');
}

function renderLukuRows(rows) {
  if (!rows.length) return `<tr><td colspan="8" class="muted">${escapeHtml(t('page.properties.empty_log', {}, 'No entries'))}</td></tr>`;
  // Newest first for in-screen scanning.
  const sorted = [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const editTitle = t('page.properties.edit', {}, 'Edit');
  const delTitle = t('page.properties.delete_cascade', {}, 'Delete (cascades TX)');
  return sorted.map((r) => {
    const txLink = r.tx_import_id
      ? `<a href="#transactions" data-tx-id="${escapeHtml(r.tx_import_id)}" class="tx-link">${escapeHtml(r.tx_import_id.slice(0, 8))}</a>`
      : '<span class="muted">–</span>';
    const reading = r.meter_reading_kwh
      ? _propsFmt(r.meter_reading_kwh, { decimals: 1 })
      : '<span class="muted">–</span>';
    const consumption = r.consumption_kwh
      ? _propsFmt(r.consumption_kwh, { decimals: 1 })
      : '<span class="muted">–</span>';
    return `<tr data-luku-id="${escapeHtml(r.luku_id)}">
      <td>${escapeHtml(r.date)}</td>
      <td class="num">${_propsFmt(r.units_kwh, { decimals: 1 })}</td>
      <td class="num">${consumption}</td>
      <td class="num">${_propsFmt(r.total_price)}</td>
      <td class="num">${reading}</td>
      <td>${escapeHtml(r.account || '–')}</td>
      <td>${txLink}</td>
      <td class="nowrap">
        <button type="button" class="btn-icon btn-luku-edit" data-luku-id="${escapeHtml(r.luku_id)}" title="${escapeHtml(editTitle)}">✎</button>
        <button type="button" class="btn-icon btn-luku-delete" data-luku-id="${escapeHtml(r.luku_id)}" title="${escapeHtml(delTitle)}">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function renderWaterRows(rows) {
  if (!rows.length) return `<tr><td colspan="6" class="muted">${escapeHtml(t('page.properties.empty_log', {}, 'No entries'))}</td></tr>`;
  const sorted = [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const editTitle = t('page.properties.edit', {}, 'Edit');
  const delTitle = t('page.properties.delete_cascade', {}, 'Delete (cascades TX)');
  return sorted.map((r) => {
    const txLink = r.tx_import_id
      ? `<a href="#transactions" data-tx-id="${escapeHtml(r.tx_import_id)}" class="tx-link">${escapeHtml(r.tx_import_id.slice(0, 8))}</a>`
      : '<span class="muted">–</span>';
    return `<tr data-water-id="${escapeHtml(r.water_id)}">
      <td>${escapeHtml(r.date)}</td>
      <td class="num">${_propsFmt(r.total_price, { decimals: 2 })}</td>
      <td>${escapeHtml(r.control_number || '–')}</td>
      <td>${escapeHtml(r.account || '–')}</td>
      <td>${txLink}</td>
      <td class="nowrap">
        <button type="button" class="btn-icon btn-water-edit" data-water-id="${escapeHtml(r.water_id)}" title="${escapeHtml(editTitle)}">✎</button>
        <button type="button" class="btn-icon btn-water-delete" data-water-id="${escapeHtml(r.water_id)}" title="${escapeHtml(delTitle)}">✕</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Charts ──────────────────────────────────────────────────────────────────

// Tracks the pending rAF id for the staged chart-init schedule. A second
// _paintPropertiesPage (e.g. SWR background revalidate) calls
// _destroyPropertyCharts and we want to cancel any not-yet-run batches
// from the previous render before they draw onto canvases that just got
// replaced.
let _propertyChartsRafId = null;

function _destroyPropertyCharts() {
  if (_propertyChartsRafId !== null) {
    cancelAnimationFrame(_propertyChartsRafId);
    _propertyChartsRafId = null;
  }
  for (const c of propertyCharts) { try { c.destroy(); } catch (_) {} }
  propertyCharts = [];
}

function _avg(values) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function _avgLineDataset(label, avg, length) {
  return {
    label, type: 'line', data: Array(length).fill(avg),
    borderColor: cssVar('--muted-soft'), borderWidth: 2, borderDash: [6, 4],
    pointRadius: 0, fill: false, tension: 0,
  };
}

function drawPropertyCharts(details) {
  _destroyPropertyCharts();
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js not loaded — skipping property charts');
    return;
  }

  // Initialising 10 Chart.js instances + 1 seasonality heatmap in one
  // go cost ~70ms of rAF-handler time (Chrome flags >50ms). Splitting
  // across 3 animation frames keeps each batch under the threshold and
  // lets the browser paint the above-the-fold charts immediately while
  // the long-tail ones come up over the next two frames (16-32ms later,
  // not user-perceivable).
  const batches = [
    () => {
      // Above-the-fold: the headline stacked-cost view + first donut.
      drawMonthlyBreakdownChart(details.cost_overview || { by_month: [] });
      drawOtherCategoryChart(details.cost_overview || { by_category: [] });
      drawLukuCostChart(details.monthly_luku);
    },
    () => {
      // Mid-page time-series.
      drawLukuKwhChart(details.monthly_luku);
      drawWaterCostChart(details.monthly_water);
      drawYearlyChart(details.yearly);
      drawPriceTrendChart(details.price_trend || []);
    },
    () => {
      // Long-tail comparison + seasonality.
      drawYtdElectricityChart(details.ytd_cumulative || {});
      drawYtdWaterChart(details.ytd_cumulative || {});
      drawPurchaseFreqChart(details.purchase_freq || []);
      renderSeasonalityHeatmap(details.seasonality || { years: [], strom: {}, water: {} });
    },
  ];

  let idx = 0;
  function runBatch() {
    _propertyChartsRafId = null;
    if (idx >= batches.length) return;
    batches[idx++]();
    if (idx < batches.length) {
      _propertyChartsRafId = requestAnimationFrame(runBatch);
    }
  }
  // First batch runs synchronously — we're already inside an rAF from
  // _paintPropertiesPage, so the above-the-fold charts hit the same
  // frame and appear instantly. Subsequent batches chain via rAF.
  runBatch();
}

function drawMonthlyBreakdownChart(co) {
  // Stacked bar: Rent / Service Charges / Maintenance / Electricity /
  // Water / Other per month. Uses the (period-clamped)
  // cost_overview.by_month so the chart honors the active period pill.
  // Colors mirror the dashboard-wide bucket palette
  // (reports-property-cost.js) so the same bucket gets the same hue
  // wherever it appears. "Other" is grey-muted because it's the
  // residual long-tail, not a named line item.
  const ctx = document.getElementById('chart-monthly-breakdown');
  if (!ctx) return;
  const months = co.by_month || [];
  if (!months.length) return;
  const labels = _propLabels(months.map((m) => ({ month: m.month })));
  const rent = months.map((m) => Number(m.rent || 0));
  const serviceCharges = months.map((m) => Number(m.service_charges || 0));
  const maintenance = months.map((m) => Number(m.maintenance || 0));
  const staff = months.map((m) => Number(m.staff || 0));
  const electricity = months.map((m) => Number(m.utilities_electricity || 0));
  const water = months.map((m) => Number(m.utilities_water || 0));
  const other = months.map((m) => {
    const total = Number(m.total || 0);
    return Math.max(
      0,
      total
        - Number(m.rent || 0)
        - Number(m.service_charges || 0)
        - Number(m.maintenance || 0)
        - Number(m.staff || 0)
        - Number(m.utilities_electricity || 0)
        - Number(m.utilities_water || 0),
    );
  });
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: t('page.properties.chart.legend.rent', {}, 'Rent'),
          data: rent.map(_propsToDisplay),
          backgroundColor: chartPalette()[7],
          stack: 'cost',
        },
        {
          label: t('page.properties.chart.legend.service_charges', {}, 'Service Charges'),
          data: serviceCharges.map(_propsToDisplay),
          backgroundColor: chartPalette()[1],
          stack: 'cost',
        },
        {
          label: t('page.properties.chart.legend.maintenance', {}, 'Maintenance'),
          data: maintenance.map(_propsToDisplay),
          backgroundColor: chartPalette()[2],
          stack: 'cost',
        },
        {
          label: t('page.properties.chart.legend.staff', {}, 'Staff'),
          data: staff.map(_propsToDisplay),
          backgroundColor: chartPalette()[5],
          stack: 'cost',
        },
        {
          label: t('page.properties.chart.legend.electricity_short', {}, 'Electricity'),
          data: electricity.map(_propsToDisplay),
          backgroundColor: chartPalette()[0],
          stack: 'cost',
        },
        {
          label: t('page.properties.chart.legend.water_short', {}, 'Water'),
          data: water.map(_propsToDisplay),
          backgroundColor: chartPalette()[3],
          stack: 'cost',
        },
        {
          label: t('page.properties.chart.legend.other', {}, 'Other'),
          data: other.map(_propsToDisplay),
          backgroundColor: chartPalette()[9],
          stack: 'cost',
        },
      ],
    },
    options: {
      ..._baseChartOptions(_propsCurrencySymbol()),
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => _propsFmt(v) } },
      },
    },
  });
  propertyCharts.push(chart);
}

function drawOtherCategoryChart(co) {
  // Donut of the top 8 non-utility categories. Long-tail beyond 8 is
  // folded into a single "rest" slice to keep the legend readable.
  const ctx = document.getElementById('chart-other-categories');
  if (!ctx) return;
  const rows = (co.by_category || []).filter((c) => _isOtherBucket(c.bucket));
  if (!rows.length) return;
  const TOP = 8;
  const top = rows.slice(0, TOP);
  const restAmount = rows.slice(TOP).reduce((acc, c) => acc + Number(c.amount || 0), 0);
  const labels = top.map((c) => c.category);
  const data = top.map((c) => _propsToDisplay(Number(c.amount || 0)));
  if (restAmount > 0) {
    labels.push(t('page.properties.chart.other_rest', {}, 'Other (rest)'));
    data.push(_propsToDisplay(restAmount));
  }
  const palette = chartPalette();
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: labels.map((_, i) => palette[i % palette.length]),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx2) => `${ctx2.label}: ${_propsFmt(ctx2.parsed)} ${_propsCurrencySymbol()}`,
          },
        },
      },
    },
  });
  propertyCharts.push(chart);
}

function drawPriceTrendChart(rows) {
  const ctx = document.getElementById('chart-price-trend');
  if (!ctx) return;
  const labels = rows.map((r) => r.date);
  const data = rows.map((r) => r.price_per_kwh);
  if (!data.length) return;
  const median = (() => {
    const sorted = [...data].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  })();
  propertyCharts.push(new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: t('page.properties.chart.legend.price_per_kwh', {}, 'TZS / kWh'), data, borderColor: chartPalette()[2], backgroundColor: chartTint(chartPalette()[2], 0.12), fill: true, tension: 0.15, pointRadius: 2 },
        _avgLineDataset(t('page.properties.chart.legend.median', { value: _propsFmt(median, { decimals: 2 }) }, `Median ${_propsFmt(median, { decimals: 2 })}`), median, labels.length),
      ],
    },
    options: {
      ..._baseChartOptions('TZS/kWh'),
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { beginAtZero: false },
      },
    },
  }));
}

// Format ISO dates as short "Mon DD" labels so the YTD x-axis stays
// readable. Chart.js's autoSkip keeps the rendered count low even on a
// 365-element label array.
const _SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function _shortLabels(isoDays) {
  return isoDays.map((d) => {
    const [, m, dd] = d.split('-');
    return `${_SHORT_MONTHS[parseInt(m, 10) - 1]} ${dd}`;
  });
}

function drawYtdElectricityChart(ytd) {
  const ctx = document.getElementById('chart-ytd-electricity');
  if (!ctx || !ytd.days || !ytd.days.length) return;
  const cur = _propsCurrencySymbol();
  const labels = _shortLabels(ytd.days);
  propertyCharts.push(new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: t('page.properties.chart.ytd.current', {}, 'Current Year'), data: ytd.current_strom, borderColor: chartPalette()[0], backgroundColor: 'rgba(52,152,219,0.18)', fill: true, tension: 0, pointRadius: 0, borderWidth: 2 },
        { label: t('page.properties.chart.ytd.previous', {}, 'Previous Year'), data: ytd.previous_strom, borderColor: chartPalette()[0], borderDash: [5, 4], fill: false, tension: 0, pointRadius: 0, borderWidth: 1.5 },
      ],
    },
    options: {
      ..._baseChartOptions(cur),
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { beginAtZero: true },
      },
    },
  }));
}

function drawYtdWaterChart(ytd) {
  const ctx = document.getElementById('chart-ytd-water');
  if (!ctx || !ytd.days || !ytd.days.length) return;
  const cur = _propsCurrencySymbol();
  const labels = _shortLabels(ytd.days);
  propertyCharts.push(new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: t('page.properties.chart.ytd.current', {}, 'Current Year'), data: ytd.current_water, borderColor: chartPalette()[3], backgroundColor: 'rgba(26,188,156,0.18)', fill: true, tension: 0, pointRadius: 0, borderWidth: 2 },
        { label: t('page.properties.chart.ytd.previous', {}, 'Previous Year'), data: ytd.previous_water, borderColor: chartPalette()[3], borderDash: [5, 4], fill: false, tension: 0, pointRadius: 0, borderWidth: 1.5 },
      ],
    },
    options: {
      ..._baseChartOptions(cur),
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { beginAtZero: true },
      },
    },
  }));
}

function drawPurchaseFreqChart(rows) {
  const ctx = document.getElementById('chart-purchase-freq');
  if (!ctx || !rows.length) return;
  const labels = _propLabels(rows);
  const data = rows.map((m) => m.count);
  const nonZero = data.filter((v) => v > 0);
  const avg = _avg(nonZero);
  propertyCharts.push(new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: t('page.properties.chart.purchase_freq.bars', {}, 'Purchases'), data, backgroundColor: chartPalette()[1] },
        _avgLineDataset(`Ø ${avg.toFixed(1)}`, avg, labels.length),
      ],
    },
    options: _baseChartOptions(''),
  }));
}

function renderSeasonalityHeatmap(season) {
  const root = document.getElementById('chart-heatmap');
  if (!root) return;
  if (!season.years || !season.years.length) {
    root.innerHTML = `<div style="padding:20px;color:var(--muted);">${escapeHtml(t('page.properties.chart.heatmap.empty', {}, 'No data yet.'))}</div>`;
    return;
  }
  const monthLabels = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const cur = _propsCurrencySymbol();

  // Compute max for each metric so the colour scale is per-metric
  // (else the warm Strom-numbers would always dominate Wasser).
  let maxStrom = 0;
  let maxWater = 0;
  for (const y of season.years) {
    const s = season.strom[String(y)] || [];
    const w = season.water[String(y)] || [];
    for (const v of s) maxStrom = Math.max(maxStrom, v || 0);
    for (const v of w) maxWater = Math.max(maxWater, v || 0);
  }

  const cell = (val, max, hueA, hueB) => {
    const intensity = max > 0 ? Math.min(1, (val || 0) / max) : 0;
    const bg = val > 0
      ? `hsla(${hueA}, ${hueB}%, ${85 - intensity * 50}%, ${0.15 + intensity * 0.85})`
      : 'transparent';
    return `<td style="padding:6px 8px;text-align:right;background:${bg};font-variant-numeric:tabular-nums;font-size:11px;">${val > 0 ? _propsFmt(_propsToDisplay(val), { decimals: 0 }) : '–'}</td>`;
  };

  const tableHtml = (title, grid, max, hueA, hueB) => {
    const rows = season.years.map((y) => {
      const row = grid[String(y)] || Array(12).fill(0);
      const total = row.reduce((s, v) => s + v, 0);
      return `<tr>
        <td style="padding:6px 8px;font-weight:600;">${y}</td>
        ${row.map((v) => cell(v, max, hueA, hueB)).join('')}
        <td style="padding:6px 10px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;font-size:11px;">${_propsFmt(_propsToDisplay(total), { decimals: 0 })}</td>
      </tr>`;
    }).join('');
    return `<div style="margin-top:10px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:600;margin-bottom:4px;">${escapeHtml(title)}</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:660px;">
        <thead><tr>
          <th style="text-align:left;padding:4px 8px;color:var(--muted);font-weight:500;">Year</th>
          ${monthLabels.map((m) => `<th style="text-align:right;padding:4px 8px;color:var(--muted);font-weight:500;">${m}</th>`).join('')}
          <th style="text-align:right;padding:4px 10px;color:var(--muted);font-weight:600;">Σ ${cur}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  };

  root.innerHTML =
    tableHtml(t('page.properties.chart.heatmap.electricity', {}, 'Electricity (TZS)'), season.strom, maxStrom, 28, 90) +
    tableHtml(t('page.properties.chart.heatmap.water', {}, 'Water (TZS)'), season.water, maxWater, 175, 70);
}

function _propLabels(monthlySeries) {
  return monthlySeries.map((m) => {
    const [y, mo] = m.month.split('-');
    return `${mo}/${y.slice(2)}`;
  });
}

function drawLukuCostChart(monthly) {
  const ctx = document.getElementById('chart-luku-cost');
  if (!ctx) return;
  const labels = _propLabels(monthly);
  const data = monthly.map((m) => m.total_price);
  const nonZero = data.filter((v) => v > 0);
  const avg = _avg(nonZero);
  propertyCharts.push(new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: t('page.properties.chart.legend.electricity_cost', {}, 'Electricity Cost'), data, backgroundColor: chartPalette()[0] },
        _avgLineDataset(`Ø ${_propsFmt(avg)} TZS`, avg, labels.length),
      ],
    },
    options: _baseChartOptions('TZS'),
  }));
}

function drawLukuKwhChart(monthly) {
  const ctx = document.getElementById('chart-luku-kwh');
  if (!ctx) return;
  const labels = _propLabels(monthly);
  const data = monthly.map((m) => m.units_kwh);
  const nonZero = data.filter((v) => v > 0);
  const avg = _avg(nonZero);
  propertyCharts.push(new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: t('page.properties.chart.legend.consumption', {}, 'Consumption'), data, borderColor: chartPalette()[1], backgroundColor: chartTint(chartPalette()[1], 0.15), fill: true, tension: 0.2 },
        _avgLineDataset(`Ø ${_propsFmt(avg, { decimals: 0 })} kWh`, avg, labels.length),
      ],
    },
    options: _baseChartOptions('kWh'),
  }));
}

function drawWaterCostChart(monthly) {
  const ctx = document.getElementById('chart-water-cost');
  if (!ctx) return;
  const labels = _propLabels(monthly);
  const data = monthly.map((m) => m.total_price);
  const nonZero = data.filter((v) => v > 0);
  const avg = _avg(nonZero);
  propertyCharts.push(new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: t('page.properties.chart.legend.water_cost', {}, 'Water Cost'), data, backgroundColor: chartPalette()[3] },
        _avgLineDataset(`Ø ${_propsFmt(avg)} TZS`, avg, labels.length),
      ],
    },
    options: _baseChartOptions('TZS'),
  }));
}

function drawYearlyChart(yearly) {
  const ctx = document.getElementById('chart-yearly');
  if (!ctx) return;
  const labels = yearly.map((y) => String(y.year));
  const elec = yearly.map((y) => y.electricity);
  const water = yearly.map((y) => y.water);
  propertyCharts.push(new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: t('page.properties.chart.legend.electricity_short', {}, 'Electricity'), data: elec, backgroundColor: chartPalette()[0] },
        { label: t('page.properties.chart.legend.water_short', {}, 'Water'), data: water, backgroundColor: chartPalette()[3] },
      ],
    },
    options: { ..._baseChartOptions('TZS'), scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } },
  }));
}

function _baseChartOptions(unit) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { boxWidth: 12 } },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${_propsFmt(ctx.parsed.y, { decimals: unit === 'kWh' ? 1 : 0 })} ${unit}`,
        },
      },
    },
    scales: { y: { beginAtZero: true } },
  };
}

// ── Controls / event delegation ─────────────────────────────────────────────

function bindPropertyControls() {
  const root = document.getElementById('properties-content');
  if (!root) return;

  // Property selector pills
  root.querySelectorAll('.vehicle-pill').forEach((pill) => {
    pill.addEventListener('click', async () => {
      const id = pill.dataset.propertyId;
      if (id === activePropertyId) return;
      activePropertyId = id;
      await renderPropertiesPage();
    });
  });

  // Period pills — re-render in place (no re-fetch, the details
  // payload already has the full history; we just reapply the filter).
  root.querySelectorAll('button[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.period;
      if (next === propertyPeriod) return;
      propertyPeriod = next;
      // Re-render without re-fetching — propertyDetails already in memory.
      const filtered = _applyPeriodToDetails(propertyDetails, propertyPeriod);
      // Replace the children below the selector + period strip.
      // Easier: nuke the page-content and rebuild.
      const r = document.getElementById('properties-content');
      r.innerHTML = '';
      r.appendChild(renderPropertySelector());
      r.appendChild(renderPeriodPills());
      r.appendChild(renderDrilldown(filtered));
      bindPropertyControls();
      drawPropertyCharts(filtered);
    });
  });

  // Excel export
  const xlsBtn = document.getElementById('btn-property-excel');
  if (xlsBtn) {
    xlsBtn.addEventListener('click', () => downloadPropertyExcel(activePropertyId));
  }

  // Add-LUKU / Add-Water modals
  const lukuBtn = document.getElementById('btn-add-luku');
  if (lukuBtn) lukuBtn.addEventListener('click', () => openLukuModal());
  const waterBtn = document.getElementById('btn-add-water');
  if (waterBtn) waterBtn.addEventListener('click', () => openWaterModal());

  // Edit + Delete buttons (delegated through the page root).
  // F-H7 (CODE_REVIEW_2026-06-12): #properties-content persists across
  // re-renders, but bindPropertyControls() runs on every paint (twice per
  // visit via the SWR cache+network pattern) AND on every period-pill
  // click — the stacked listeners made one delete click open N confirm
  // dialogs and fire N destructive POSTs. Replace the handler instead of
  // stacking it.
  if (root._fosClickHandler) {
    root.removeEventListener('click', root._fosClickHandler);
  }
  root._fosClickHandler = async (ev) => {
    // ── Edit ──
    const lukuEdit = ev.target.closest('.btn-luku-edit');
    if (lukuEdit) {
      const id = lukuEdit.dataset.lukuId;
      const row = propertyDetails.luku_log.find((r) => r.luku_id === id);
      if (row) openLukuModal(row);
      return;
    }
    const waterEdit = ev.target.closest('.btn-water-edit');
    if (waterEdit) {
      const id = waterEdit.dataset.waterId;
      const row = propertyDetails.water_log.find((r) => r.water_id === id);
      if (row) openWaterModal(row);
      return;
    }
    // ── Delete ──
    const lukuBtn = ev.target.closest('.btn-luku-delete');
    if (lukuBtn) {
      const id = lukuBtn.dataset.lukuId;
      const row = propertyDetails.luku_log.find((r) => r.luku_id === id);
      const summary = row
        ? `${row.date} · ${_propsFmt(row.units_kwh, { decimals: 1 })} kWh · ${_propsFmt(row.total_price)} TZS`
        : id;
      const confirmFn = typeof window.uiConfirm === 'function' ? window.uiConfirm : (m) => Promise.resolve(window.confirm(m));
      const title = t('page.properties.confirm.delete_luku.title', {}, 'Delete LUKU entry?');
      const body = t('page.properties.confirm.delete_luku.body', { summary },
        `${summary}\n\nThe linked TX (and any reimbursement counter-entry) will be deleted as well.`);
      const ok = await confirmFn(body, { title, danger: true });
      if (!ok) return;
      try {
        const resp = await fetch('/api/properties/luku/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ luku_id: id }),
        });
        if (!resp.ok) throw new Error(await resp.text());
        // Global state.tx is loaded once at boot from data/transactions.csv;
        // utility deletes cascade the linked expense (+ reimburse) TX on disk
        // but in-memory state stays stale until we explicitly refresh it.
        // Without this, the Transactions page / Dashboard Recent TX / account
        // balances keep showing the deleted TX until a full page reload.
        _invalidatePropsCache(activePropertyId);
        await refreshData();
        await renderPropertiesPage();
      } catch (err) {
        const alertFn = typeof window.uiAlert === 'function' ? window.uiAlert : (m) => Promise.resolve(window.alert(m));
        await alertFn(t('page.properties.alert.delete_failed', { msg: err.message }, `Delete failed: ${err.message}`));
      }
      return;
    }
    const waterBtn = ev.target.closest('.btn-water-delete');
    if (waterBtn) {
      const id = waterBtn.dataset.waterId;
      const row = propertyDetails.water_log.find((r) => r.water_id === id);
      const summary = row ? `${row.date} · ${_propsFmt(row.total_price, { decimals: 2 })} TZS` : id;
      const confirmFn = typeof window.uiConfirm === 'function' ? window.uiConfirm : (m) => Promise.resolve(window.confirm(m));
      const title = t('page.properties.confirm.delete_water.title', {}, 'Delete Water entry?');
      const body = t('page.properties.confirm.delete_water.body', { summary },
        `${summary}\n\nThe linked TX (and any reimbursement counter-entry) will be deleted as well.`);
      const ok = await confirmFn(body, { title, danger: true });
      if (!ok) return;
      try {
        const resp = await fetch('/api/properties/water/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ water_id: id }),
        });
        if (!resp.ok) throw new Error(await resp.text());
        _invalidatePropsCache(activePropertyId);
        await refreshData();
        await renderPropertiesPage();
      } catch (err) {
        const alertFn = typeof window.uiAlert === 'function' ? window.uiAlert : (m) => Promise.resolve(window.alert(m));
        await alertFn(t('page.properties.alert.delete_failed', { msg: err.message }, `Delete failed: ${err.message}`));
      }
      return;
    }
  };
  root.addEventListener('click', root._fosClickHandler);
}

async function downloadPropertyExcel(propertyId) {
  if (!propertyId) return;
  try {
    const resp = await fetch('/api/properties/excel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property_id: propertyId }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const cd = resp.headers.get('Content-Disposition') || '';
    let filename = 'property.xlsx';
    const match = /filename="([^"]+)"/.exec(cd);
    if (match) filename = match[1];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    const alertFn = typeof window.uiAlert === 'function' ? window.uiAlert : (m) => Promise.resolve(window.alert(m));
    await alertFn(t('page.properties.alert.excel_failed', { msg: err.message }, `Excel export failed: ${err.message}`));
  }
}

// ── Add LUKU / Water Modals ─────────────────────────────────────────────────

// Single overlay element reused across both modals; tearing down + re-
// opening keeps form state from leaking between sessions.
let _propsModalInstance = null;

// DP-M6: props modals ride the central openModal() lifecycle; this
// wrapper only keeps the module-local handle so the booking flows can
// close programmatically after a successful submit.
function _closePropsModal() {
  if (_propsModalInstance) {
    const inst = _propsModalInstance;
    _propsModalInstance = null;
    inst.close();
  }
}

function _propsTodayIso() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function _propsAccountOptions(prop, selected) {
  // Active accounts only. Falls back to the property's default account
  // if the cache is empty (rare — happens when /api/tx/context fails).
  const list = _propsAccountsCache.filter(
    (a) => (a.status || 'active') !== 'archived',
  );
  const def = prop.default_account || '';
  const sel = selected || def;
  const opts = list.map((a) => {
    const isSelected = a.alias === sel ? ' selected' : '';
    return `<option value="${escapeHtml(a.alias)}"${isSelected}>${escapeHtml(a.alias)} — ${escapeHtml(a.name || '')}</option>`;
  });
  if (!opts.length) {
    opts.push(`<option value="${escapeHtml(def)}" selected>${escapeHtml(def)}</option>`);
  }
  return opts.join('');
}

function _buildPropsModal(title, bodyHtml, onSubmit) {
  _closePropsModal();
  // DP-M6: shell + lifecycle come from the central openModal() —
  // esc/click-out/✕/cancel cleanup, the DP-H1 submit lock (LUKU/Water
  // submits create real TX rows plus pass-through reimbursement; a
  // second click during the request used to book everything twice)
  // and initial focus all live there.
  _propsModalInstance = openModal({
    title: escapeHtml(title),
    bodyHtml,
    maxWidth: '560px',
    submitLabel: t('page.properties.modal.submit', {}, 'Book'),
    onSubmit: async (form) => {
      try {
        await onSubmit(form);
      } catch (err) {
        const alertFn = typeof window.uiAlert === 'function' ? window.uiAlert : (m) => Promise.resolve(window.alert(m));
        await alertFn(t('page.properties.alert.book_failed', { msg: err.message }, `Booking failed: ${err.message}`));
      }
    },
  });
}

// Tiny field renderer kept inline so the modal HTML reads naturally.
// Injects the name attribute into the first <input>/<select>/<textarea> tag
// of the inputHtml string — caller writes plain HTML without remembering
// to add name= every time.
const _propsField = (name, labelText, inputHtml, full = false) => {
  const withName = inputHtml.replace(
    /^<(input|select|textarea)(\s|>)/,
    `<$1 name="${name}"$2`,
  );
  return `<label style="display:flex;flex-direction:column;gap:4px;${full ? 'grid-column:1/-1;' : ''}">
    <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">${escapeHtml(labelText)}</span>
    ${withName}
  </label>`;
};

// Build the tag-picker block for LUKU/Water modals. Auto-tags (property
// cost_tag + account-by-tag) render as a muted hint above the picker so
// the user sees them but can't toggle them off — server applies them
// regardless. The picker exposes only "extras" the user can add on top
// (e.g. a landlord-relevant cost tag for repairs the landlord should see).
function _propsTagPickerBlock({ prop, existingTagsCsv = '', accountAlias = '' }) {
  const propAuto = (prop?.cost_tag || '').trim();
  const acctAuto = _propsAccountAutotag(accountAlias);
  const autoSet = new Set([propAuto, acctAuto].filter(Boolean));
  const existing = new Set(
    (existingTagsCsv || '').split(';').map(s => s.trim()).filter(Boolean)
  );
  // Pre-check anything already set on the row (edit case) that isn't an
  // auto-tag — auto-tags re-apply server-side, no need to round-trip them.
  const checkboxes = _propsTagsCache.length
    ? _propsTagsCache.map(tg => {
        if (autoSet.has(tg.tag)) return '';
        const checked = existing.has(tg.tag) ? 'checked' : '';
        return `<label><input type="checkbox" value="${escapeHtml(tg.tag)}" ${checked}><span>${escapeHtml(tg.tag)}</span></label>`;
      }).filter(Boolean).join('')
    : '';
  const autoLabel = t('page.properties.modal.tags_auto', {}, 'Auto');
  const autoHtml = autoSet.size
    ? `<div style="font-size:11px;color:var(--muted);margin-bottom:6px;"><strong>${escapeHtml(autoLabel)}:</strong> ${[...autoSet].map(escapeHtml).join(', ')}</div>`
    : '';
  const tagsLabel = t('common.col.tags', {}, 'Tags');
  return `
    <div class="atx-row" style="margin-top:4px;">
      <div class="atx-field fx1">
        <label>${escapeHtml(tagsLabel)}</label>
        ${autoHtml}
        <div class="tag-picker" id="props-tag-picker">${checkboxes || `<span style="font-size:12px;color:var(--muted);">${escapeHtml(t('page.properties.modal.tags_none', {}, 'No additional tags defined.'))}</span>`}</div>
      </div>
    </div>`;
}

function _propsCollectPickerTags(formEl) {
  const picker = formEl.querySelector('#props-tag-picker');
  if (!picker) return [];
  return Array.from(picker.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

function openLukuModal(existing = null) {
  if (!propertyDetails) return;
  const prop = propertyDetails.property;
  const isEdit = !!existing;
  const date = existing?.date || _propsTodayIso();
  const kwh = existing?.units_kwh ?? '';
  const cost = existing?.total_price ?? '';
  const meter = existing?.meter || prop.electricity_meter || '';
  const meterReading = existing?.meter_reading_kwh ?? '';
  const note = existing?.note || '';
  const accSelect = _propsAccountOptions(prop, existing?.account);
  const inputCss = 'padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:inherit;font:inherit;';
  const body = `
    <div class="grid-2col">
      ${_propsField('date', t('common.table.date', {}, 'Date'), `<input type="date" value="${escapeHtml(date)}" required style="${inputCss}">`)}
      ${_propsField('account', t('common.table.account', {}, 'Account'), `<select style="${inputCss}">${accSelect}</select>`)}
      ${_propsField('units_kwh', t('page.properties.units', {}, 'kWh (units)'), `<input type="number" value="${escapeHtml(kwh)}" step="0.01" min="0.01" required placeholder="e.g. 1820.3" style="${inputCss}">`)}
      ${_propsField('total_price', t('page.properties.cost_tzs', {}, 'Cost (TZS)'), `<input type="number" value="${escapeHtml(cost)}" step="0.01" min="0.01" required placeholder="e.g. 650000" style="${inputCss}">`)}
      ${_propsField('meter_reading_kwh', t('page.properties.meter_reading', {}, 'Meter reading after purchase (kWh)'), `<input type="number" value="${escapeHtml(meterReading)}" step="0.01" min="0" placeholder="e.g. 1850.3" style="${inputCss}">`, true)}
      ${_propsField('meter', t('page.properties.meter', {}, 'Meter Nr.'), `<input type="text" value="${escapeHtml(meter)}" placeholder="Electricity meter number" style="${inputCss}">`)}
      ${_propsField('note', t('page.properties.note', {}, 'Note (optional)'), `<input type="text" value="${escapeHtml(note)}" placeholder="free text" style="${inputCss}">`)}
    </div>
    ${_propsTagPickerBlock({ prop, existingTagsCsv: existing?.tags || '', accountAlias: existing?.account || prop.default_account })}
    <p style="margin:14px 0 0;font-size:12px;color:var(--muted);line-height:1.45;">${escapeHtml(t('page.properties.luku_hint', {}, 'Creates LUKU log + expense TX (Bills:Electricity, configured payee). Pass-through accounts automatically generate a reimbursement counter-entry.'))}</p>`;
  const title = isEdit
    ? t('page.properties.modal.edit_luku', {}, 'Edit Electricity Entry')
    : t('page.properties.modal.add_luku', {}, 'Buy Electricity Token');
  _buildPropsModal(title, body, async (form) => {
    const fd = new FormData(form);
    const payload = {
      property_id: prop.property_id,
      date: fd.get('date'),
      units_kwh: Number(fd.get('units_kwh')),
      total_price: Number(fd.get('total_price')),
      account: fd.get('account') || prop.default_account,
      meter: fd.get('meter') || '',
      meter_reading_kwh: fd.get('meter_reading_kwh') || '',
      note: fd.get('note') || '',
      tags: _propsCollectPickerTags(form),
    };
    let url = '/api/properties/luku/add';
    if (isEdit) {
      url = '/api/properties/luku/update';
      payload.luku_id = existing.luku_id;
    }
    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(await resp.text());
    _closePropsModal();
    _invalidatePropsCache(activePropertyId);
    await refreshData();
    await renderPropertiesPage();
  });
}

function openWaterModal(existing = null) {
  if (!propertyDetails) return;
  const prop = propertyDetails.property;
  const isEdit = !!existing;
  const date = existing?.date || _propsTodayIso();
  const cost = existing?.total_price ?? '';
  const control = existing?.control_number || prop.water_control_number || '';
  const meter = existing?.meter || prop.water_meter || '';
  const note = existing?.note || '';
  const accSelect = _propsAccountOptions(prop, existing?.account);
  const inputCss = 'padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:inherit;font:inherit;';
  const body = `
    <div class="grid-2col">
      ${_propsField('date', t('common.table.date', {}, 'Date'), `<input type="date" value="${escapeHtml(date)}" required style="${inputCss}">`)}
      ${_propsField('account', t('common.table.account', {}, 'Account'), `<select style="${inputCss}">${accSelect}</select>`)}
      ${_propsField('total_price', t('page.properties.amount_tzs', {}, 'Amount (TZS)'), `<input type="number" value="${escapeHtml(cost)}" step="0.01" min="0.01" required placeholder="e.g. 28553.71" style="${inputCss}">`, true)}
      ${_propsField('control_number', t('page.properties.control_number', {}, 'Control Nr.'), `<input type="text" value="${escapeHtml(control)}" placeholder="control number" style="${inputCss}">`)}
      ${_propsField('meter', t('page.properties.meter', {}, 'Meter'), `<input type="text" value="${escapeHtml(meter)}" placeholder="Water meter" style="${inputCss}">`)}
      ${_propsField('note', t('page.properties.note', {}, 'Note (optional)'), `<input type="text" value="${escapeHtml(note)}" placeholder="free text" style="${inputCss}">`, true)}
    </div>
    ${_propsTagPickerBlock({ prop, existingTagsCsv: existing?.tags || '', accountAlias: existing?.account || prop.default_account })}
    <p style="margin:14px 0 0;font-size:12px;color:var(--muted);line-height:1.45;">${escapeHtml(t('page.properties.water_hint', {}, 'Creates Water log + expense TX (Bills:Water, configured payee). Pass-through accounts automatically generate a reimbursement counter-entry.'))}</p>`;
  const title = isEdit
    ? t('page.properties.modal.edit_water', {}, 'Edit Water Entry')
    : t('page.properties.modal.add_water', {}, 'Pay Water Bill');
  _buildPropsModal(title, body, async (form) => {
    const fd = new FormData(form);
    const payload = {
      property_id: prop.property_id,
      date: fd.get('date'),
      total_price: Number(fd.get('total_price')),
      account: fd.get('account') || prop.default_account,
      control_number: fd.get('control_number') || '',
      meter: fd.get('meter') || '',
      note: fd.get('note') || '',
      tags: _propsCollectPickerTags(form),
    };
    let url = '/api/properties/water/add';
    if (isEdit) {
      url = '/api/properties/water/update';
      payload.water_id = existing.water_id;
    }
    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(await resp.text());
    _closePropsModal();
    _invalidatePropsCache(activePropertyId);
    await refreshData();
    await renderPropertiesPage();
  });
}

// ── Settings → Properties (CRUD list) ───────────────────────────────────────

async function renderPropertiesSettingsTab() {
  const container = document.getElementById('settings-tab-content');
  if (!container) return;
  // M-T1 (Sprint 22) — Properties Settings UI used hardcoded strings.
  // The i18n keys (config/i18n/{en,de}.json) were already in place;
  // they just weren't wired up, so a DE-locale user saw the whole
  // Properties tab in English. Every label, button, badge, modal
  // title, and tooltip below now goes through t().
  container.innerHTML = `<div class="loading">${t('settings.properties.loading', {}, 'Loading properties…')}</div>`;
  try {
    await Promise.all([loadPropertiesList(), _loadPropsAccountsCache()]);
  } catch (err) {
    container.innerHTML = `<div class="error-banner">${escapeHtml(err.message)}</div>`;
    return;
  }
  // Pull log counts so the Delete button can reflect the cascade-block.
  const lukuCounts = {};
  const waterCounts = {};
  for (const p of propertiesList) {
    lukuCounts[p.property_id] = p.kpis?.luku_count || 0;
    waterCounts[p.property_id] = p.kpis?.water_count || 0;
  }

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <h3 class="m-0">${t('settings.properties.heading', {}, 'Properties')}</h3>
      <button type="button" class="btn-secondary" id="btn-property-add">
        <svg width="14" height="14" style="vertical-align:-2px;"><use href="#i-plus"/></svg>
        ${t('settings.properties.add', {}, 'Add Property')}
      </button>
    </div>
    <table class="data-table" style="width:100%;">
      <thead><tr>
        <th>${t('settings.properties.col.id', {}, 'ID')}</th>
        <th>${t('settings.properties.col.name', {}, 'Name')}</th>
        <th>${t('settings.properties.col.address', {}, 'Address')}</th>
        <th>${t('settings.properties.col.account', {}, 'Account')}</th>
        <th>${t('settings.properties.col.currency', {}, 'Currency')}</th>
        <th>${t('settings.properties.col.logs', {}, 'Logs (LUKU / Water)')}</th>
        <th>${t('settings.properties.col.status', {}, 'Status')}</th>
        <th>${t('settings.properties.col.actions', {}, 'Actions')}</th>
      </tr></thead>
      <tbody>${_renderPropertyRows(propertiesList, lukuCounts, waterCounts)}</tbody>
    </table>`;

  document.getElementById('btn-property-add').addEventListener('click', () => {
    openPropertyModal();
  });
  container.querySelectorAll('[data-prop-edit]').forEach((b) => {
    b.addEventListener('click', () => {
      const pid = b.dataset.propEdit;
      const prop = propertiesList.find((p) => p.property_id === pid);
      openPropertyModal(prop);
    });
  });
  container.querySelectorAll('[data-prop-toggle]').forEach((b) => {
    b.addEventListener('click', async () => {
      const pid = b.dataset.propToggle;
      const prop = propertiesList.find((p) => p.property_id === pid);
      const newActive = (prop.active || 'true') === 'true' ? 'false' : 'true';
      try {
        const resp = await fetch('/api/properties/update', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ property_id: pid, active: newActive }),
        });
        if (!resp.ok) throw new Error(await resp.text());
        _invalidatePropsCache();
        await renderPropertiesSettingsTab();
      } catch (err) {
        const alertFn = typeof window.uiAlert === 'function' ? window.uiAlert : (m) => Promise.resolve(window.alert(m));
        await alertFn(t('settings.properties.err_archive', { msg: err.message }, `Status change failed: ${err.message}`));
      }
    });
  });
  container.querySelectorAll('[data-prop-delete]').forEach((b) => {
    b.addEventListener('click', async () => {
      const pid = b.dataset.propDelete;
      const prop = propertiesList.find((p) => p.property_id === pid);
      const confirmFn = typeof window.uiConfirm === 'function' ? window.uiConfirm : (m) => Promise.resolve(window.confirm(m));
      const cTitle = t('page.properties.confirm.delete_property.title', {}, 'Delete property?');
      const cBody = t('page.properties.confirm.delete_property.body', { name: prop.name },
        `Delete property "${prop.name}"?\n\nLog entries must be empty first, otherwise the server will refuse.`);
      const ok = await confirmFn(cBody, { title: cTitle, danger: true });
      if (!ok) return;
      try {
        const resp = await fetch('/api/properties/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ property_id: pid }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${resp.status}`);
        }
        _invalidatePropsCache();
        await renderPropertiesSettingsTab();
      } catch (err) {
        const alertFn = typeof window.uiAlert === 'function' ? window.uiAlert : (m) => Promise.resolve(window.alert(m));
        await alertFn(t('page.properties.alert.delete_failed', { msg: err.message }, `Delete failed: ${err.message}`));
      }
    });
  });
}

function _renderPropertyRows(props, lukuCounts, waterCounts) {
  if (!props.length) {
    return `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px;">${t('settings.properties.empty', {}, 'No properties — click "Add Property" to create one.')}</td></tr>`;
  }
  const labelEdit = t('settings.properties.action.edit', {}, 'Edit');
  const labelDelete = t('settings.properties.action.delete', {}, 'Delete');
  const labelArchive = t('settings.properties.action.archive', {}, 'Archive');
  const labelActivate = t('settings.properties.action.activate', {}, 'Activate');
  const labelActive = t('settings.properties.status.active', {}, 'Active');
  const labelArchived = t('settings.properties.status.archived', {}, 'Archived');
  return props.map((p) => {
    const isActive = (p.active || 'true') === 'true';
    const lukuN = lukuCounts[p.property_id] || 0;
    const waterN = waterCounts[p.property_id] || 0;
    const blockDelete = lukuN > 0 || waterN > 0;
    const deleteAttrs = blockDelete
      ? `disabled title="${escapeHtml(t('settings.properties.action.delete_blocked', { l: lukuN, w: waterN }, `${lukuN} LUKU + ${waterN} water entries reference this property. Archive instead, or delete the entries first.`))}" style="opacity:0.4;cursor:not-allowed;"`
      : `title="${labelDelete}"`;
    const statusBadge = isActive
      ? `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:var(--accent-glow,rgba(70,89,155,0.15));color:var(--accent);font-size:11px;font-weight:600;">${labelActive}</span>`
      : `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:var(--border);color:var(--muted);font-size:11px;font-weight:600;">${labelArchived}</span>`;
    return `<tr>
      <td><code class="fs-11">${escapeHtml(p.property_id)}</code></td>
      <td>${escapeHtml(p.name || '')}</td>
      <td style="color:var(--muted);font-size:12px;">${escapeHtml(p.address || '–')}</td>
      <td>${escapeHtml(p.default_account || '–')}</td>
      <td>${escapeHtml(p.currency || '–')}</td>
      <td>${lukuN} / ${waterN}</td>
      <td>${statusBadge}</td>
      <td class="nowrap">
        <button type="button" class="btn-icon" data-prop-edit="${escapeHtml(p.property_id)}" title="${labelEdit}">✎</button>
        <button type="button" class="btn-icon" data-prop-toggle="${escapeHtml(p.property_id)}" title="${isActive ? labelArchive : labelActivate}">${isActive ? '📦' : '↻'}</button>
        <button type="button" class="btn-icon" data-prop-delete="${escapeHtml(p.property_id)}" ${deleteAttrs}>✕</button>
      </td>
    </tr>`;
  }).join('');
}

function openPropertyModal(existing = null) {
  const isEdit = !!existing;
  const inputCss = 'padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:inherit;font:inherit;';
  const accSelect = _propsAccountOptions(existing || {}, existing?.default_account);
  const v = (k, fallback = '') => escapeHtml(existing?.[k] ?? fallback);
  // Active accounts loaded — currency dropdown comes from active account currencies.
  const currencies = Array.from(new Set(_propsAccountsCache.map((a) => a.currency).filter(Boolean)));
  if (!currencies.length) currencies.push('TZS', 'EUR', 'USD');
  const currentCurrency = existing?.currency || 'TZS';
  const curOpts = currencies.map((c) => `<option value="${c}"${c === currentCurrency ? ' selected' : ''}>${c}</option>`).join('');

  // M-T1 — modal field labels go through t() with English fallback.
  // Three new keys (cost_tag, start_date, end_date) were missing from
  // the original 35 i18n entries and got added in this sprint.
  const lblPropId = t('settings.properties.field.property_id', {}, 'Property ID');
  const lblName = t('settings.properties.field.name', {}, 'Name');
  const lblAddress = t('settings.properties.field.address', {}, 'Address');
  const lblOwner = t('settings.properties.field.owner', {}, 'Owner');
  const lblCurrency = t('settings.properties.field.currency', {}, 'Currency');
  const lblDefAcc = t('settings.properties.field.default_account', {}, 'Default Account');
  const lblElecPayee = t('settings.properties.field.electricity_payee', {}, 'Electricity Payee');
  const lblWaterPayee = t('settings.properties.field.water_payee', {}, 'Water Payee');
  const lblElecMeter = t('settings.properties.field.electricity_meter', {}, 'Electricity Meter');
  const lblWaterMeter = t('settings.properties.field.water_meter', {}, 'Water Meter');
  const lblWaterCtrl = t('settings.properties.field.water_control_number', {}, 'Water Control Number');
  const lblElecCat = t('settings.properties.field.electricity_category', {}, 'Electricity Category');
  const lblWaterCat = t('settings.properties.field.water_category', {}, 'Water Category');
  const lblCostTag = t('settings.properties.field.cost_tag', {}, 'Cost Tag');
  const lblStart = t('settings.properties.field.start_date', {}, 'Start (move-in)');
  const lblEnd = t('settings.properties.field.end_date', {}, 'End (move-out)');
  const lblActive = t('settings.properties.field.active', {}, 'Active');
  const lblNotes = t('settings.properties.field.notes', {}, 'Notes');

  const body = `
    <div class="grid-2col">
      ${_propsField('property_id', lblPropId, `<input type="text" value="${v('property_id')}" ${isEdit ? 'readonly' : 'required pattern="prop-[a-z0-9_-]+"'} placeholder="prop-myhouse" style="${inputCss}${isEdit ? 'background:var(--border);color:var(--muted);' : ''}">`)}
      ${_propsField('name', lblName, `<input type="text" value="${v('name')}" required placeholder="My House" style="${inputCss}">`)}
      ${_propsField('address', lblAddress, `<input type="text" value="${v('address')}" placeholder="123 Example Street" style="${inputCss}">`, true)}
      ${_propsField('owner', lblOwner, `<input type="text" value="${v('owner', 'self')}" placeholder="self" style="${inputCss}">`)}
      ${_propsField('currency', lblCurrency, `<select style="${inputCss}">${curOpts}</select>`)}
      ${_propsField('default_account', lblDefAcc, `<select style="${inputCss}">${accSelect}</select>`, true)}
      ${_propsField('electricity_payee', lblElecPayee, `<input type="text" value="${v('electricity_payee', '')}" style="${inputCss}">`)}
      ${_propsField('water_payee', lblWaterPayee, `<input type="text" value="${v('water_payee', '')}" style="${inputCss}">`)}
      ${_propsField('electricity_meter', lblElecMeter, `<input type="text" value="${v('electricity_meter')}" placeholder="LUKU meter number" style="${inputCss}">`)}
      ${_propsField('water_meter', lblWaterMeter, `<input type="text" value="${v('water_meter')}" placeholder="water meter number" style="${inputCss}">`)}
      ${_propsField('water_control_number', lblWaterCtrl, `<input type="text" value="${v('water_control_number')}" placeholder="water utility control nr" style="${inputCss}">`, true)}
      ${_propsField('electricity_category', lblElecCat, `<input type="text" value="${v('electricity_category', 'Bills:Electricity')}" style="${inputCss}">`)}
      ${_propsField('water_category', lblWaterCat, `<input type="text" value="${v('water_category', 'Bills:Water')}" style="${inputCss}">`)}
      ${_propsField('cost_tag', lblCostTag, `<input type="text" value="${v('cost_tag')}" placeholder="auto: Property_<id> — feeds the Cost-of-Living-per-Property report" style="${inputCss}">`, true)}
      ${_propsField('start_date', lblStart, `<input type="date" value="${v('start_date')}" style="${inputCss}">`)}
      ${_propsField('end_date', lblEnd, `<input type="date" value="${v('end_date')}" placeholder="leave empty if currently lived in" style="${inputCss}">`)}
      ${_propsField('active', lblActive, `<select style="${inputCss}"><option value="true"${(existing?.active || 'true') === 'true' ? ' selected' : ''}>true</option><option value="false"${existing?.active === 'false' ? ' selected' : ''}>false</option></select>`)}
      ${_propsField('notes', lblNotes, `<input type="text" value="${v('notes')}" placeholder="freitext" style="${inputCss}">`, true)}
    </div>`;

  const modalTitle = isEdit
    ? t('settings.properties.modal.title_edit', { name: existing.name }, `Edit ${existing.name}`)
    : t('settings.properties.modal.title_add', {}, 'Add Property');
  _buildPropsModal(modalTitle, body, async (form) => {
    const fd = new FormData(form);
    const payload = {};
    for (const k of [
      'property_id', 'name', 'address', 'owner', 'currency', 'default_account',
      'electricity_payee', 'water_payee', 'electricity_meter', 'water_meter',
      'water_control_number', 'electricity_category', 'water_category',
      'cost_tag', 'start_date', 'end_date', 'active', 'notes',
    ]) {
      payload[k] = (fd.get(k) || '').toString();
    }
    const url = isEdit ? '/api/properties/update' : '/api/properties/add';
    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${resp.status}`);
    }
    _closePropsModal();
    _invalidatePropsCache();
    await renderPropertiesSettingsTab();
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Render a small inline badge that summarizes the property's lifecycle:
// • empty start + empty end -> nothing (most installs, no clutter)
// • start_date set, no end_date -> muted "since YYYY"
// • both set, end in the past -> archived chip "ended YYYY-MM"
// • both set, end in the future -> "until YYYY-MM" (planned move-out)
// Used in the drilldown header h3 and in the property-selector pills.
function _renderLifecycleBadge(startDate, endDate) {
  const today = new Date().toISOString().slice(0, 10);
  const start = (startDate || '').trim();
  const end = (endDate || '').trim();
  if (!start && !end) return '';
  const baseStyle = 'display:inline-block;font-size:11px;font-weight:500;padding:2px 8px;border-radius:8px;margin-left:8px;vertical-align:middle;';
  if (end && end <= today) {
    return `<span class="lifecycle-badge lifecycle-archived" style="${baseStyle}background:color-mix(in srgb, var(--muted) 18%, transparent);color:var(--muted);">${escapeHtml(t('lifecycle.ended', { date: end.slice(0, 7) }, `ended ${end.slice(0, 7)}`))}</span>`;
  }
  if (end && end > today) {
    return `<span class="lifecycle-badge lifecycle-planned" style="${baseStyle}background:color-mix(in srgb, var(--warn) 18%, transparent);color:var(--warn);">${escapeHtml(t('lifecycle.until', { date: end.slice(0, 7) }, `until ${end.slice(0, 7)}`))}</span>`;
  }
  if (start) {
    return `<span class="lifecycle-badge lifecycle-since" style="${baseStyle}background:color-mix(in srgb, var(--accent) 12%, transparent);color:var(--muted);">${escapeHtml(t('lifecycle.since', { date: start.slice(0, 7) }, `since ${start.slice(0, 7)}`))}</span>`;
  }
  return '';
}

// Local fallback for escapeHtml — core.js exposes one too, but properties.js
// is loaded later and we don't want to depend on load order.
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
