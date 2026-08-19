// dashboard/subscriptions.js — Subscriptions subsystem (Phase 1).
//
// Phase 1 is pure master-CRUD: list active and archived subscriptions
// grouped by category, an Add/Edit modal with all fields, and a delete
// path that mirrors the property/vehicle precondition (refuse when log
// entries exist — server-side enforced regardless).
//
// Phase 2 (later) will add per-charge linkage to existing transactions
// and a renewal-calendar widget; the schema and the subscription_log.csv
// already make room for that.

let _subscriptionsList = [];
let _subscriptionsLoaded = false;
let _subsAccountsCache = null;
let _subsLogAll = null;        // cache of /api/subscriptions/log_all rows
let _subsGroupChart = null;    // Chart.js instances, destroyed on re-render
let _subsTimeChart = null;
let _subsChartsGen = 0;        // generation counter, see _initSubsCharts

// User-facing filter for the list pills. Defaults to 'active' so the
// page opens on the things the user is actually paying for; the pill
// row also exposes an "all" option for bookkeeping.
let _subscriptionsFilter = 'active';

// View mode for the list body: 'table' (default, Excel-style) or
// 'cards' (mobile-friendly). Persisted so the choice survives reloads.
let _subsViewMode = localStorage.getItem('subsViewMode') === 'cards' ? 'cards' : 'table';

// Sort state for the table view. dir: 1 = ascending, -1 = descending.
let _subsSort = { key: 'name', dir: 1 };

// Default starter set for the "group" dropdown. The user can type a
// new value too — the input is a free text field with a datalist.
const _SUBSCRIPTION_GROUPS_DEFAULT = [
  'AI', 'Cloud', 'Domains', 'Entertainment',
  'Hosting', 'Productivity', 'Wordpress',
];

// DP-M7: currency list now comes from the shared knownCurrencies()
// helper at render time (module-level snapshot would miss accounts
// loaded after boot).
const _BILLING_PRESETS = [
  { months: 1,  labelKey: 'page.subscriptions.cycle.monthly',    fallback: 'Monthly' },
  { months: 3,  labelKey: 'page.subscriptions.cycle.quarterly',  fallback: 'Quarterly' },
  { months: 6,  labelKey: 'page.subscriptions.cycle.semiannual', fallback: 'Semi-annual' },
  { months: 12, labelKey: 'page.subscriptions.cycle.yearly',     fallback: 'Yearly' },
  { months: 24, labelKey: 'page.subscriptions.cycle.biennial',   fallback: 'Every 2 years' },
  { months: 36, labelKey: 'page.subscriptions.cycle.triennial',  fallback: 'Every 3 years' },
];

// ─── Data loading ────────────────────────────────────────────────────────────

async function loadSubscriptionsList() {
  // Rides core.js's single-flight fetcher so the page, the renewals widget
  // and the alerts sweep share one round-trip when they render together.
  const data = await fetchSubscriptionsList();
  if (!data) throw new Error('subscriptions/list failed');
  _subscriptionsList = data.subscriptions || [];
  _subscriptionsLoaded = true;
  return _subscriptionsList;
}

async function _loadSubsAccountsCache() {
  // Reuse the same /api/tx/context source as the property module so the
  // account dropdown in the modal stays in sync with the rest of the app
  // (status, currency, owner). Empty-on-failure keeps the modal usable.
  if (_subsAccountsCache) return _subsAccountsCache;
  try {
    const resp = await fetch('/api/tx/context', { method: 'POST' });
    if (!resp.ok) throw new Error(`tx/context ${resp.status}`);
    const data = await resp.json();
    _subsAccountsCache = Array.isArray(data.accounts) ? data.accounts : [];
  } catch (err) {
    console.warn('[subscriptions] account cache load failed:', err);
    _subsAccountsCache = [];
  }
  return _subsAccountsCache;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// M-F1 (Sprint 18) — block javascript: / data: / vbscript: / file: schemes
// in subscription URLs. Returns the URL unchanged when its scheme parses
// to http or https (or the URL is scheme-relative); returns '' for any
// non-navigable or attacker-controlled scheme. Used in the card renderer
// so paste-and-click of `javascript:alert(1)` never lands in `<a href>`.
function _safeHref(url) {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (!trimmed) return '';
  // Allow protocol-relative // and root-relative / paths.
  if (trimmed.startsWith('//') || trimmed.startsWith('/')) return trimmed;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? trimmed : '';
  } catch (_e) {
    return '';
  }
}

function _fmtAmount(amount, currency) {
  // Subscriptions are quoted in their *own* currency, not the dashboard
  // display currency — converting here would lose information ("the
  // €23.99 charge" matters more than "≈ 60k TZS today"). The Phase-1
  // total at the top is the only spot that aggregates, and there we
  // group per-currency so no FX conversion is needed.
  const n = Number(amount) || 0;
  const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  return `${fmt.format(n)} ${escapeHtml(currency || '')}`.trim();
}

function _cycleLabel(months) {
  const m = Number(months) || 1;
  const preset = _BILLING_PRESETS.find(p => p.months === m);
  if (preset) return t(preset.labelKey, {}, preset.fallback);
  return t('page.subscriptions.cycle.every_n', { n: m }, `Every ${m} months`);
}

function _statusBadge(sub) {
  const active = (sub.active || '').toLowerCase() === 'true';
  if (!active && sub.cancelled_on) {
    return `<span class="sub-pill sub-pill-cancelled" title="${escapeHtml(sub.cancelled_on)}">${escapeHtml(t('page.subscriptions.status.cancelled', { date: sub.cancelled_on }, `Cancelled ${sub.cancelled_on}`))}</span>`;
  }
  if (!active) {
    return `<span class="sub-pill sub-pill-inactive">${escapeHtml(t('page.subscriptions.status.inactive', {}, 'Inactive'))}</span>`;
  }
  return `<span class="sub-pill sub-pill-active">${escapeHtml(t('page.subscriptions.status.active', {}, 'Active'))}</span>`;
}

function _filterSubs(rows, filter) {
  if (filter === 'all') return rows;
  if (filter === 'inactive') {
    return rows.filter(r => (r.active || '').toLowerCase() !== 'true');
  }
  return rows.filter(r => (r.active || '').toLowerCase() === 'true');
}

// The cache below only helps once a response is in hand. _initSubsCharts
// fires on every filter/sort/view click and awaits this — two clicks in
// quick succession both missed the cache and both hit the network. The
// in-flight promise makes the second one piggyback instead; it is cleared
// on settle so a failure does not stick a rejected promise in the module.
let _subsLogAllInFlight = null;

async function _loadSubsLogAll() {
  if (_subsLogAll) return _subsLogAll;
  if (_subsLogAllInFlight) return _subsLogAllInFlight;
  _subsLogAllInFlight = (async () => {
    const resp = await fetch('/api/subscriptions/log_all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!resp.ok) throw new Error(`subscriptions/log_all ${resp.status}`);
    _subsLogAll = (await resp.json()).log || [];
    return _subsLogAll;
  })();
  try {
    return await _subsLogAllInFlight;
  } finally {
    _subsLogAllInFlight = null;
  }
}

// KPI strip: count, FX-normalized monthly cost, yearly projection and
// the nearest renewal. All FX math happens here in the frontend where
// the live rates live — the API stays currency-per-row.
function _renderKpis(active) {
  const todayIso = localTodayIso();
  let monthly = 0;
  active.forEach(s => { monthly += toDisplay(Number(s.amount_monthly) || 0, s.currency); });

  const overdue = active.filter(s => s.next_renewal && s.next_renewal < todayIso);
  const upcoming = active
    .filter(s => s.next_renewal && s.next_renewal >= todayIso)
    .sort((a, b) => a.next_renewal.localeCompare(b.next_renewal))[0] || null;

  let nextVal = '—', nextSub = '';
  if (overdue.length) {
    nextVal = t('page.subscriptions.kpi.overdue_n', { n: overdue.length }, `${overdue.length} overdue`);
    nextSub = overdue.slice(0, 2).map(s => s.name).join(', ');
  } else if (upcoming) {
    const days = Math.round((new Date(upcoming.next_renewal) - new Date(todayIso)) / 86400000);
    nextVal = t('page.subscriptions.kpi.next_in_days', { name: upcoming.name, n: days }, `${upcoming.name} in ${days}d`);
    nextSub = upcoming.next_renewal;
  }

  const cards = [
    [t('page.subscriptions.kpi.active', {}, 'Active subscriptions'), String(active.length), ''],
    [t('page.subscriptions.kpi.monthly', { cur: displayCurrency }, `Monthly cost (≈ ${displayCurrency})`),
      `${formatCurrency(monthly, displayCurrency)} ${displayCurrency}`, ''],
    [t('page.subscriptions.kpi.yearly', {}, 'Yearly projection'),
      `${formatCurrency(monthly * 12, displayCurrency)} ${displayCurrency}`, ''],
    [t('page.subscriptions.kpi.next', {}, 'Next renewal'), nextVal, nextSub],
  ].map(([label, value, sub]) => `
    <div class="kpi-card" style="min-width:180px;">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value)}</div>
      ${sub ? `<div class="delta">${escapeHtml(sub)}</div>` : ''}
    </div>`).join('');
  return `<div class="kpi-grid" style="margin-bottom:14px;display:flex;flex-wrap:wrap;gap:12px;">${cards}</div>`;
}

function _renderChartsSection() {
  return `
    <div class="report-section mb-12">
      <div class="grid-2col">
        <div>
          <h3 class="label-sm m-0 mb-6">${escapeHtml(t('page.subscriptions.chart.by_group', {}, 'Monthly cost by group'))}</h3>
          <div class="sub-chart-box"><canvas id="subs-group-chart"></canvas></div>
        </div>
        <div>
          <h3 class="label-sm m-0 mb-6">${escapeHtml(t('page.subscriptions.chart.over_time', {}, 'Linked charges over time'))}</h3>
          <div class="sub-chart-box"><canvas id="subs-time-chart"></canvas></div>
        </div>
      </div>
      <div id="subs-chart-hint" class="c-mut fs-12 mt-8" hidden></div>
    </div>`;
}

async function _initSubsCharts(active) {
  // renderSubscriptionsPage fires this fire-and-forget via requestAnimationFrame
  // on every filter/sort/view click, and this function awaits a network fetch
  // (_loadSubsLogAll) before building the time chart. Two overlapping
  // invocations can race past the destroy-on-entry below and both end up
  // constructing a Chart on the same canvas ("Canvas is already in use").
  // The generation counter lets a stale (superseded) invocation detect it
  // was overtaken and bail instead of touching the DOM/chart instances.
  const gen = ++_subsChartsGen;

  if (_subsGroupChart) { _subsGroupChart.destroy(); _subsGroupChart = null; }
  if (_subsTimeChart) { _subsTimeChart.destroy(); _subsTimeChart = null; }

  // Donut: FX-normalized monthly cost per group.
  const byGroup = new Map();
  active.forEach(s => {
    const g = (s.group || '').trim() || t('page.subscriptions.group.uncategorized', {}, 'Uncategorized');
    byGroup.set(g, (byGroup.get(g) || 0) + toDisplay(Number(s.amount_monthly) || 0, s.currency));
  });
  const groupCtx = document.getElementById('subs-group-chart');
  if (groupCtx && byGroup.size) {
    const labels = [...byGroup.keys()];
    _subsGroupChart = new Chart(groupCtx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: labels.map(l => byGroup.get(l)), backgroundColor: chartPalette(), borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.raw, displayCurrency)} ${displayCurrency}` } },
        },
      },
    });
  }

  // Bar: linked charges summed per month (display currency).
  let log = [];
  let logFailed = false;
  try {
    log = await _loadSubsLogAll();
  } catch (e) {
    // A failed fetch is not an empty log. Reporting "no linked charges
    // yet" here told the user their data was missing when the request
    // simply did not come back.
    logFailed = true;
    console.warn('[subscriptions] log_all failed:', e);
  }
  // A newer invocation may have started (and already destroyed/rebuilt the
  // charts) while this one was awaiting the fetch above — bail so the stale
  // call doesn't clobber the fresher render or double-construct a chart.
  if (gen !== _subsChartsGen) return;
  const hint = document.getElementById('subs-chart-hint');
  if (logFailed) {
    if (hint) {
      hint.hidden = false;
      hint.textContent = t('page.subscriptions.chart.log_error', {},
        'Could not load the charge log — the chart is unavailable, not empty.');
    }
    return;
  }
  if (!log.length) {
    if (hint) {
      hint.hidden = false;
      hint.textContent = t('page.subscriptions.chart.no_log', {},
        'No linked charges yet — charts fill up as TXs get linked to subscriptions.');
    }
    return;
  }
  const byMonth = new Map();
  log.forEach(r => {
    const ym = (r.date || '').slice(0, 7);
    if (!ym) return;
    byMonth.set(ym, (byMonth.get(ym) || 0) + toDisplay(parseFloat(r.amount) || 0, r.currency || 'TZS'));
  });
  const months = [...byMonth.keys()].sort();
  const timeCtx = document.getElementById('subs-time-chart');
  if (timeCtx && months.length) {
    // Defensive: destroy any chart Chart.js already has bound to this canvas
    // (belt-and-suspenders alongside the generation guard above — Chart.js
    // v4's Chart.getChart() is the supported way to look this up).
    const existing = Chart.getChart(timeCtx);
    if (existing) existing.destroy();
    _subsTimeChart = new Chart(timeCtx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [{ data: months.map(m => byMonth.get(m)), backgroundColor: cssVar('--accent'), borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `${formatCurrency(ctx.raw, displayCurrency)} ${displayCurrency}` } },
        },
        scales: {
          x: { grid: { display: false } },
          y: { ticks: { callback: (v) => formatCurrency(v, displayCurrency) }, grid: { color: cssVar('--chart-grid') } },
        },
      },
    });
  }
}

// ─── Render ──────────────────────────────────────────────────────────────────

async function renderSubscriptionsPage() {
  const root = document.getElementById('subscriptions-content');
  if (!root) return;
  // The detail view's chart lives on a canvas inside #subscriptions-content,
  // which this render is about to overwrite — destroy it before its canvas
  // goes away, mirroring destroyReportCharts() in the reports sub-route.
  if (_subDetailChart) { _subDetailChart.destroy(); _subDetailChart = null; }

  if (!_subscriptionsLoaded) {
    root.innerHTML = `<div class="report-section t-center c-mut">${t('common.loading', {}, 'Loading…')}</div>`;
    try {
      await loadSubscriptionsList();
    } catch (err) {
      root.innerHTML = `<div class="error-banner">${escapeHtml(t('page.subscriptions.err_list', { msg: err.message }, `Could not load subscriptions: ${err.message}`))}</div>`;
      return;
    }
  }

  const visible = _filterSubs(_subscriptionsList, _subscriptionsFilter);
  const active = _filterSubs(_subscriptionsList, 'active');
  const meta = document.getElementById('subscriptions-meta');
  if (meta) {
    meta.textContent = t(
      'page.subscriptions.meta',
      { active: active.length, total: _subscriptionsList.length },
      `${active.length} active · ${_subscriptionsList.length} total`,
    );
  }

  root.innerHTML = `
    ${_renderKpis(active)}
    ${_renderChartsSection()}
    ${_renderToolbar()}
    ${_subsViewMode === 'cards' ? _renderList(visible) : _renderTable(visible)}
  `;

  _bindSubscriptionsControls();
  // Charts after layout, mirroring dashboard.js's initCharts deferral.
  requestAnimationFrame(() => _initSubsCharts(active));
}

function _renderToolbar() {
  const filterTabs = [
    ['active',   t('page.subscriptions.filter.active',   {}, 'Active')],
    ['inactive', t('page.subscriptions.filter.inactive', {}, 'Inactive')],
    ['all',      t('page.subscriptions.filter.all',      {}, 'All')],
  ].map(([key, label]) => {
    const cur = _subscriptionsFilter === key;
    const style = cur
      ? 'background:var(--accent);color:#fff;border-color:var(--accent);'
      : 'background:var(--surface);color:var(--text);';
    return `<button class="sub-filter-tab" data-filter="${escapeHtml(key)}" style="padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;font-size:12px;${style}">${escapeHtml(label)}</button>`;
  }).join('');

  const viewTabs = [
    ['table', t('page.subscriptions.view.table', {}, 'Table')],
    ['cards', t('page.subscriptions.view.cards', {}, 'Cards')],
  ].map(([key, label]) => {
    const cur = _subsViewMode === key;
    const style = cur
      ? 'background:var(--accent);color:#fff;border-color:var(--accent);'
      : 'background:var(--surface);color:var(--text);';
    return `<button class="sub-view-tab" data-view="${escapeHtml(key)}" style="padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;font-size:12px;${style}">${escapeHtml(label)}</button>`;
  }).join('');

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${filterTabs}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        ${viewTabs}
        <button id="sub-add-btn" style="padding:8px 14px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius-xs);cursor:pointer;font-weight:600;">+ ${escapeHtml(t('page.subscriptions.add_button', {}, 'Add subscription'))}</button>
      </div>
    </div>
  `;
}

function _renderList(rows) {
  if (!rows.length) {
    if (_subscriptionsList.length === 0) {
      return `
        <div class="report-section" style="text-align:center;padding:36px 16px;">
          <div style="font-size:15px;font-weight:600;margin-bottom:6px;">${escapeHtml(t('page.subscriptions.empty.title', {}, 'No subscriptions yet'))}</div>
          <div style="color:var(--muted);font-size:13px;max-width:480px;margin:0 auto;">${escapeHtml(t('page.subscriptions.empty.body', {}, 'Click "Add subscription" to track Netflix, ChatGPT, hosting, domains, or any recurring service.'))}</div>
        </div>
      `;
    }
    return `<div class="report-section" style="text-align:center;color:var(--muted);padding:24px;">${escapeHtml(t('page.subscriptions.filter.empty', {}, 'No subscriptions match this filter.'))}</div>`;
  }

  // Group by `group`, then render group-headed sections. Within a group,
  // active rows come before archived ones (the service-layer already
  // sorts by active rank, group, name — the JS sort below preserves
  // that order while collecting same-group rows together).
  const groups = new Map();
  rows.forEach(r => {
    const g = (r.group || '').trim() || t('page.subscriptions.group.uncategorized', {}, 'Uncategorized');
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  });

  const sections = Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, items]) => `
      <div class="report-section" style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:10px;">
          <h3 style="margin:0;font-size:14px;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);">${escapeHtml(group)}</h3>
          <span class="label-sm">${escapeHtml(t('page.subscriptions.group.count', { n: items.length }, `${items.length} entries`))}</span>
        </div>
        <div class="sub-group-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">
          ${items.map(_renderSubscriptionCard).join('')}
        </div>
      </div>
    `).join('');

  return sections;
}

function _renderTable(rows) {
  // Empty states are shared with the cards view.
  if (!rows.length) return _renderList(rows);
  const todayIso = localTodayIso();
  const sortIcon = (key) =>
    _subsSort.key === key ? (_subsSort.dir === 1 ? ' ▲' : ' ▼') : '';

  const sorted = [...rows].sort((a, b) => {
    const k = _subsSort.key;
    let va, vb;
    if (k === 'amount') { va = Number(a.amount) || 0; vb = Number(b.amount) || 0; }
    else if (k === 'monthly') {
      va = toDisplay(Number(a.amount_monthly) || 0, a.currency);
      vb = toDisplay(Number(b.amount_monthly) || 0, b.currency);
    } else if (k === 'cycle') {
      va = Number(a.billing_months) || 1; vb = Number(b.billing_months) || 1;
    } else {
      va = (a[k] || '').toLowerCase(); vb = (b[k] || '').toLowerCase();
    }
    if (va < vb) return -1 * _subsSort.dir;
    if (va > vb) return 1 * _subsSort.dir;
    return 0;
  });

  const actionBtn = (cls, sid, label) => {
    const btnClass = cls === 'sub-delete' ? 'sub-delete tx-edit-btn btn-delete-sm' : 'sub-edit tx-edit-btn';
    return `<button class="${btnClass}" data-sid="${escapeHtml(sid)}">${escapeHtml(label)}</button>`;
  };

  const body = sorted.map(sub => {
    const sid = sub.subscription_id;
    const monthlyDisp = toDisplay(Number(sub.amount_monthly) || 0, sub.currency);
    const overdue = sub.next_renewal && sub.next_renewal < todayIso
      && (sub.active || '').toLowerCase() === 'true';
    return `
      <tr class="sub-row" data-sid="${escapeHtml(sid)}">
        <td class="fw-600">${escapeHtml(sub.name || sid)}</td>
        <td>${escapeHtml(sub.group || '')}</td>
        <td class="td-amount">${escapeHtml(_fmtAmount(sub.amount, sub.currency))}</td>
        <td>${escapeHtml(_cycleLabel(sub.billing_months))}</td>
        <td class="td-amount">${escapeHtml(formatCurrency(monthlyDisp, displayCurrency))} ${escapeHtml(displayCurrency)}</td>
        <td${overdue ? ' class="c-neg fw-600"' : ''}>${escapeHtml(sub.next_renewal || '—')}</td>
        <td>${escapeHtml(sub.account || '—')}</td>
        <td>${_statusBadge(sub)}</td>
        <td class="t-right">
          ${actionBtn('sub-edit', sid, t('common.actions.edit', {}, 'Edit'))}
          ${actionBtn('sub-delete', sid, t('common.actions.delete', {}, 'Delete'))}
        </td>
      </tr>`;
  }).join('');

  const th = (key, label, extraCls = '') =>
    `<th class="sortable${extraCls}" data-sort="${key}">${escapeHtml(label)}${sortIcon(key)}</th>`;

  return `
    <div class="report-section tbl-wrap">
      <table class="tx-table">
        <thead><tr>
          ${th('name', t('page.subscriptions.table.name', {}, 'Name'))}
          ${th('group', t('page.subscriptions.table.group', {}, 'Group'))}
          ${th('amount', t('common.col.amount', {}, 'Amount'), ' t-right')}
          ${th('cycle', t('page.subscriptions.table.cycle', {}, 'Cycle'))}
          ${th('monthly', t('page.subscriptions.table.monthly_eq', {}, '≈ / month'), ' t-right')}
          ${th('next_renewal', t('page.subscriptions.table.next_renewal', {}, 'Next renewal'))}
          ${th('account', t('common.col.account', {}, 'Account'))}
          <th>${escapeHtml(t('page.subscriptions.table.status', {}, 'Status'))}</th>
          <th></th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function _renderSubscriptionCard(sub) {
  const monthly = Number(sub.amount_monthly) || 0;
  const sameAsCharge = Math.abs(monthly - (Number(sub.amount) || 0)) < 0.005;
  const monthlyLine = sameAsCharge ? '' : `<div class="label-sm">≈ ${escapeHtml(_fmtAmount(monthly, sub.currency))} ${escapeHtml(t('page.subscriptions.card.per_month', {}, '/ month'))}</div>`;

  const renewalLine = sub.next_renewal
    ? `<div class="label-sm">${escapeHtml(t('page.subscriptions.card.renews_on', { date: sub.next_renewal }, `Renews ${sub.next_renewal}`))}</div>`
    : '';
  const accountLine = sub.account
    ? `<div class="label-sm">${escapeHtml(t('page.subscriptions.card.via', { account: sub.account }, `via ${sub.account}`))}</div>`
    : '';
  // M-F1 (Sprint 18) — refuse javascript:/data:/vbscript: URLs in the
  // subscription card. escapeHtml protects against breaking out of the
  // attribute but does NOT block the browser from navigating to a
  // javascript: URI; one paste-and-click on a malicious sub URL would
  // execute attacker JS in the dashboard origin. _safeHref strips any
  // non-http(s) scheme to the empty string.
  const urlLine = sub.url && _safeHref(sub.url)
    ? `<a href="${escapeHtml(_safeHref(sub.url))}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:var(--accent);text-decoration:none;" title="${escapeHtml(sub.url)}">${escapeHtml(t('page.subscriptions.card.account_url', {}, 'Account ↗'))}</a>`
    : '';

  return `
    <div class="sub-card" data-sid="${escapeHtml(sub.subscription_id)}" style="padding:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div class="fw-600 fs-13" style="line-height:1.2;"><a href="#subscriptions/${encodeURIComponent(sub.subscription_id)}" style="color:inherit;text-decoration:none;">${escapeHtml(sub.name || sub.subscription_id)}</a></div>
          ${sub.provider ? `<div class="label-sm">${escapeHtml(sub.provider)}</div>` : ''}
        </div>
        ${_statusBadge(sub)}
      </div>
      <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:flex-end;gap:8px;">
        <div>
          <div style="font-size:14px;font-weight:600;">${escapeHtml(_fmtAmount(sub.amount, sub.currency))}</div>
          <div class="label-sm">${escapeHtml(_cycleLabel(sub.billing_months))}</div>
          ${monthlyLine}
        </div>
        <div class="t-right">
          ${renewalLine}
          ${accountLine}
          ${urlLine}
        </div>
      </div>
      <div style="margin-top:10px;display:flex;gap:6px;justify-content:flex-end;">
        <button class="sub-history" data-sid="${escapeHtml(sub.subscription_id)}" style="padding:4px 10px;font-size:11px;background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;">${escapeHtml(t('page.subscriptions.card.history', {}, 'History'))}</button>
        <button class="sub-edit" data-sid="${escapeHtml(sub.subscription_id)}" style="padding:4px 10px;font-size:11px;background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;">${escapeHtml(t('common.actions.edit', {}, 'Edit'))}</button>
        <button class="sub-delete" data-sid="${escapeHtml(sub.subscription_id)}" style="padding:4px 10px;font-size:11px;background:var(--surface-2);color:var(--negative);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;">${escapeHtml(t('common.actions.delete', {}, 'Delete'))}</button>
      </div>
      <div class="sub-history-panel" data-sid="${escapeHtml(sub.subscription_id)}" hidden style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:11px;"></div>
    </div>
  `;
}

// Shared history-table builder: used by the inline card panel and the
// drilldown page. `withNote` adds the note column (drilldown only —
// the inline panel stays compact).
function _historyTableHtml(log, withNote = false) {
  const rows = log.map((r, i) => {
    const prev = log[i + 1];
    let delta = '';
    if (prev) {
      const a = parseFloat(r.amount) || 0;
      const b = parseFloat(prev.amount) || 0;
      if (b > 0) {
        const pct = ((a - b) / b) * 100;
        if (Math.abs(pct) >= 0.5) {
          const cls = pct > 5 ? 'c-neg' : (pct < -5 ? 'c-pos' : '');
          const sign = pct > 0 ? '+' : '';
          delta = `<span class="${cls} fs-10" style="margin-left:6px;">${sign}${pct.toFixed(1)}%</span>`;
        }
      }
    }
    const txShort = (r.tx_import_id || '').slice(0, 8);
    return `
      <tr>
        <td>${escapeHtml(r.date || '')}</td>
        <td class="t-right">${escapeHtml(_fmtAmount(parseFloat(r.amount) || 0, r.currency || ''))}${delta}</td>
        <td>${escapeHtml(r.account || '')}</td>
        ${withNote ? `<td>${escapeHtml(r.note || '')}</td>` : ''}
        <td><a class="sub-tx-link" data-tx-id="${escapeHtml(r.tx_import_id || '')}" style="color:var(--accent-dim);cursor:pointer;font-family:monospace;font-size:10px;">${escapeHtml(txShort)}…</a></td>
      </tr>
    `;
  }).join('');
  // Compact inline-style for card panel; padded tx-table class for full-width drilldown page.
  const tableTag = withNote ? '<table class="tx-table">' : '<table style="width:100%;border-collapse:collapse;">';
  return `
    ${tableTag}
      <thead><tr style="color:var(--muted);text-align:left;">
        <th>${escapeHtml(t('common.col.date', {}, 'Date'))}</th>
        <th class="t-right">${escapeHtml(t('common.col.amount', {}, 'Amount'))}</th>
        <th>${escapeHtml(t('common.col.account', {}, 'Account'))}</th>
        ${withNote ? `<th>${escapeHtml(t('page.subscriptions.detail.col_note', {}, 'Note'))}</th>` : ''}
        <th>${escapeHtml(t('common.col.tx', {}, 'TX'))}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function _loadSubscriptionHistory(subId, panel) {
  panel.innerHTML = `<div class="c-mut">${escapeHtml(t('page.subscriptions.history.loading', {}, 'Loading…'))}</div>`;
  try {
    const res = await fetch('/api/subscriptions/log_for_subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription_id: subId }),
    });
    const data = await res.json();
    const log = data.log || [];
    if (!log.length) {
      panel.innerHTML = `<div class="c-mut">${escapeHtml(t('page.subscriptions.history.empty', {}, 'No charges linked yet. Link a TX to this subscription via the Add-TX or Edit-TX picker.'))}</div>`;
      return;
    }
    panel.innerHTML = _historyTableHtml(log);
  } catch (e) {
    panel.innerHTML = `<div class="c-neg">${escapeHtml(t('page.subscriptions.history.err', { msg: e.message }, `Could not load: ${e.message}`))}</div>`;
  }
}

// Pairwise gap scan over the linked history. Anchoring on consecutive
// pairs (not a fixed grid from the first charge) keeps slow drift in the
// actual charge day from producing false positives. History before the
// first linked charge is deliberately out of scope — pre-linking months
// would all read as "missing" (the pre-2026-05 era was never linked).
//
// The tolerance is one cycle plus half a cycle, capped at 45 days: a
// multiplicative 1.5× reads fine monthly (16 days late) but lets a yearly
// subscription drift half a year before anyone hears about it. The cap
// makes long cycles as sensitive as short ones without re-tightening the
// monthly case, where a two-week slip is normal.
//
// A flagged gap is not automatically a missing charge: past the tolerance
// but short of two cycles means the charge came late. Reporting that as
// "1 charge missing" (the old floor did) sent the user hunting for a
// payment that was never skipped.
function _detectPaymentGaps(sub, logDesc) {
  const asc = [...logDesc].reverse();
  if (asc.length < 2) return [];
  const months = Math.max(1, parseInt(sub.billing_months, 10) || 1);
  const cycleDays = months * 30.44;
  const tolerance = cycleDays + Math.min(cycleDays / 2, 45);
  const gaps = [];
  for (let i = 1; i < asc.length; i++) {
    const prev = new Date(asc[i - 1].date);
    const cur = new Date(asc[i].date);
    if (isNaN(prev) || isNaN(cur)) continue;
    const gapDays = (cur - prev) / 86400000;
    if (gapDays > tolerance) {
      gaps.push({
        after: asc[i - 1].date,
        before: asc[i].date,
        missed: Math.max(0, Math.round(gapDays / cycleDays) - 1),
        lateDays: Math.round(gapDays - cycleDays),
      });
    }
  }
  return gaps;
}

let _subDetailChart = null;

function _initSubDetailChart(logDesc) {
  if (_subDetailChart) { _subDetailChart.destroy(); _subDetailChart = null; }
  const ctx = document.getElementById('sub-detail-chart');
  if (!ctx || logDesc.length < 2) return;
  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();
  const asc = [...logDesc].reverse();
  _subDetailChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: asc.map(r => r.date),
      datasets: [{
        data: asc.map(r => parseFloat(r.amount) || 0),
        borderColor: cssVar('--accent'),
        backgroundColor: chartTint(chartPalette()[0], 0.15),
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: cssVar('--chart-grid') } },
      },
    },
  });
}

// Drilldown page for one subscription (#subscriptions/<sub-id>).
// Renders into the same #subscriptions-content shell as the list; the
// back link is a plain hash change so navigateTo re-renders the list.
async function renderSubscriptionDetail(sid) {
  const root = document.getElementById('subscriptions-content');
  if (!root) return;
  // The list view's charts live on canvases inside #subscriptions-content,
  // which this render is about to overwrite — bail any in-flight list-chart
  // init and destroy the instances before their canvases go away, mirroring
  // destroyReportCharts() in the reports sub-route.
  _subsChartsGen++;
  if (_subsGroupChart) { _subsGroupChart.destroy(); _subsGroupChart = null; }
  if (_subsTimeChart) { _subsTimeChart.destroy(); _subsTimeChart = null; }
  root.innerHTML = `<div class="report-section t-center c-mut">${t('common.loading', {}, 'Loading…')}</div>`;
  try {
    if (!_subscriptionsLoaded) await loadSubscriptionsList();
  } catch (err) {
    root.innerHTML = `<div class="error-banner">${escapeHtml(t('page.subscriptions.err_list', { msg: err.message }, `Could not load subscriptions: ${err.message}`))}</div>`;
    return;
  }

  const backLink = `<div class="mb-8"><a href="#subscriptions" class="fs-12">${escapeHtml(t('page.subscriptions.detail.back', {}, '← All subscriptions'))}</a></div>`;
  const sub = _subscriptionsList.find(s => s.subscription_id === sid);
  if (!sub) {
    root.innerHTML = `${backLink}<div class="error-banner">${escapeHtml(t('page.subscriptions.detail.not_found', { id: sid }, `Subscription '${sid}' not found.`))}</div>`;
    return;
  }
  const meta = document.getElementById('subscriptions-meta');
  if (meta) meta.textContent = sub.name || sid;

  let log = [];
  try {
    const res = await fetch('/api/subscriptions/log_for_subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription_id: sid }),
    });
    log = (await res.json()).log || [];
  } catch (e) { console.warn('[subscriptions] detail log load failed:', e); }

  // KPIs stay in the subscription's own currency — the charge history
  // is a per-service view, converting would hide real price changes.
  const amounts = log.map(r => parseFloat(r.amount) || 0);
  const total = amounts.reduce((s, v) => s + v, 0);
  const avg = amounts.length ? total / amounts.length : 0;
  const first = log[log.length - 1];
  const last = log[0];
  const logCur = (last && last.currency) || sub.currency || '';
  let drift = '—';
  if (log.length >= 2) {
    const a = parseFloat(first.amount) || 0;
    const b = parseFloat(last.amount) || 0;
    if (a > 0) drift = `${b >= a ? '+' : ''}${(((b - a) / a) * 100).toFixed(1)}%`;
  }

  const urlLine = sub.url && _safeHref(sub.url)
    ? `<a href="${escapeHtml(_safeHref(sub.url))}" target="_blank" rel="noopener noreferrer" class="fs-11" style="color:var(--accent);text-decoration:none;">${escapeHtml(t('page.subscriptions.card.account_url', {}, 'Account ↗'))}</a>`
    : '';

  const kpi = (label, value, sub2 = '') => `
    <div class="kpi-card" style="min-width:180px;">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value)}</div>
      ${sub2 ? `<div class="delta">${escapeHtml(sub2)}</div>` : ''}
    </div>`;

  const gaps = _detectPaymentGaps(sub, log);
  const gapsHtml = log.length >= 2 ? `
    <div class="report-section mb-12">
      <h3 class="label-sm m-0 mb-6">${escapeHtml(t('page.subscriptions.detail.gaps_title', {}, 'Possible missing charges'))}</h3>
      ${gaps.length
        ? gaps.map(g => `<div class="fs-12 c-warn mb-4">${escapeHtml(g.missed
            ? t('page.subscriptions.detail.gap_row', { missed: g.missed, after: g.after, before: g.before }, `${g.missed} expected charge(s) missing between ${g.after} and ${g.before}`)
            : t('page.subscriptions.detail.gap_late', { days: g.lateDays, after: g.after, before: g.before }, `Charge ${g.lateDays} days late — ${g.after} → ${g.before}`))}</div>`).join('')
        : `<div class="fs-12 c-mut">${escapeHtml(t('page.subscriptions.detail.no_gaps', {}, 'No gaps in the linked history.'))}</div>`}
    </div>` : '';

  root.innerHTML = `
    ${backLink}
    <div class="report-section mb-12">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div>
          <div class="fw-600" style="font-size:16px;">${escapeHtml(sub.name || sid)}</div>
          <div class="label-sm">${escapeHtml([sub.provider, sub.group].filter(Boolean).join(' · '))}</div>
          <div class="label-sm">${escapeHtml(_fmtAmount(sub.amount, sub.currency))} · ${escapeHtml(_cycleLabel(sub.billing_months))}${sub.account ? ` · ${escapeHtml(t('page.subscriptions.card.via', { account: sub.account }, `via ${sub.account}`))}` : ''}</div>
          ${sub.next_renewal ? `<div class="label-sm">${escapeHtml(t('page.subscriptions.card.renews_on', { date: sub.next_renewal }, `Renews ${sub.next_renewal}`))}</div>` : ''}
        </div>
        <div class="flex-row gap-sm">
          ${urlLine}
          ${_statusBadge(sub)}
          <button class="sub-edit" data-sid="${escapeHtml(sid)}" style="padding:4px 10px;font-size:11px;background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;">${escapeHtml(t('common.actions.edit', {}, 'Edit'))}</button>
        </div>
      </div>
    </div>
    <div class="kpi-grid" style="margin-bottom:14px;display:flex;flex-wrap:wrap;gap:12px;">
      ${kpi(t('page.subscriptions.detail.lifetime', {}, 'Total paid (linked)'), _fmtAmount(total, logCur))}
      ${kpi(t('page.subscriptions.detail.avg', {}, 'Average charge'), _fmtAmount(avg, logCur))}
      ${kpi(t('page.subscriptions.detail.count', {}, 'Linked charges'), String(log.length))}
      ${kpi(t('page.subscriptions.detail.drift', {}, 'Price drift (first → last)'), drift, log.length >= 2 ? `${first.date} → ${last.date}` : '')}
    </div>
    ${log.length >= 2 ? `<div class="report-section mb-12"><div class="sub-chart-box"><canvas id="sub-detail-chart"></canvas></div></div>` : ''}
    ${gapsHtml}
    <div class="report-section fs-11">
      ${log.length
        ? _historyTableHtml(log, true)
        : `<div class="c-mut">${escapeHtml(t('page.subscriptions.history.empty', {}, 'No charges linked yet. Link a TX to this subscription via the Add-TX or Edit-TX picker.'))}</div>`}
    </div>
  `;

  _bindSubscriptionsControls();
  requestAnimationFrame(() => _initSubDetailChart(log));
}

function _bindSubscriptionsControls() {
  const root = document.getElementById('subscriptions-content');
  if (!root || root._subsBound) return;
  root._subsBound = true;

  root.addEventListener('click', (ev) => {
    const filter = ev.target.closest('.sub-filter-tab');
    if (filter) {
      _subscriptionsFilter = filter.getAttribute('data-filter') || 'active';
      renderSubscriptionsPage();
      return;
    }
    const viewBtn = ev.target.closest('.sub-view-tab');
    if (viewBtn) {
      _subsViewMode = viewBtn.getAttribute('data-view') === 'cards' ? 'cards' : 'table';
      localStorage.setItem('subsViewMode', _subsViewMode);
      renderSubscriptionsPage();
      return;
    }
    const sortTh = ev.target.closest('th.sortable[data-sort]');
    if (sortTh) {
      const key = sortTh.getAttribute('data-sort');
      if (_subsSort.key === key) _subsSort.dir = -_subsSort.dir;
      else _subsSort = { key, dir: 1 };
      renderSubscriptionsPage();
      return;
    }
    const addBtn = ev.target.closest('#sub-add-btn');
    if (addBtn) {
      openSubscriptionModal();
      return;
    }
    const editBtn = ev.target.closest('.sub-edit');
    if (editBtn) {
      const sid = editBtn.getAttribute('data-sid');
      const sub = _subscriptionsList.find(s => s.subscription_id === sid);
      if (sub) openSubscriptionModal(sub);
      return;
    }
    const delBtn = ev.target.closest('.sub-delete');
    if (delBtn) {
      const sid = delBtn.getAttribute('data-sid');
      const sub = _subscriptionsList.find(s => s.subscription_id === sid);
      if (sub) _confirmDeleteSubscription(sub);
      return;
    }
    const histBtn = ev.target.closest('.sub-history');
    if (histBtn) {
      const sid = histBtn.getAttribute('data-sid');
      const panel = root.querySelector(`.sub-history-panel[data-sid="${sid}"]`);
      if (!panel) return;
      if (panel.hidden) {
        panel.hidden = false;
        // Lazy-load on first expand. Subsequent toggles re-use the
        // rendered HTML so the dropdown stays snappy.
        if (!panel._loaded) {
          panel._loaded = true;
          _loadSubscriptionHistory(sid, panel);
        }
      } else {
        panel.hidden = true;
      }
      return;
    }
    const txLink = ev.target.closest('.sub-tx-link');
    if (txLink) {
      const txId = txLink.getAttribute('data-tx-id');
      // Reuse the global TX state if we already have the row loaded
      // (Transactions page loads it eagerly). Otherwise fall back to
      // a hash route — the user lands on Transactions filtered to
      // this id.
      const tx = (window.state?.tx || []).find(t => t.import_id === txId);
      if (tx && typeof openEditModal === 'function') {
        openEditModal(tx);
      } else {
        location.hash = `#transactions?import_id=${encodeURIComponent(txId)}`;
      }
      return;
    }
    const row = ev.target.closest('tr.sub-row');
    if (row && !ev.target.closest('button, a')) {
      location.hash = '#subscriptions/' + encodeURIComponent(row.getAttribute('data-sid'));
      return;
    }
  });
}

// ─── Add / Edit modal ────────────────────────────────────────────────────────

async function openSubscriptionModal(existing = null) {
  const editing = existing && typeof existing === 'object' && existing.subscription_id;
  const s = editing ? existing : null;

  const accounts = await _loadSubsAccountsCache();
  // Active accounts only by default; fall back to "all" if the existing
  // subscription points at an archived account (so the dropdown still
  // shows the current value).
  const activeAccounts = accounts.filter(a => (a.status || '').toLowerCase() === 'active');
  const accountPool = (s && s.account && !activeAccounts.find(a => a.alias === s.account))
    ? accounts
    : activeAccounts;
  const accountOptions = accountPool.map(a => {
    const sel = s && s.account === a.alias ? ' selected' : '';
    return `<option value="${escapeHtml(a.alias)}"${sel}>${escapeHtml(a.alias)} — ${escapeHtml(a.name || '')}</option>`;
  }).join('');

  const currencyOptions = knownCurrencies() // DP-M7
    .map(c => `<option value="${c}"${s && s.currency === c ? ' selected' : ''}>${c}</option>`).join('');

  const cycleOptions = _BILLING_PRESETS
    .map(p => {
      const sel = s && Number(s.billing_months) === p.months ? ' selected' : '';
      return `<option value="${p.months}"${sel}>${escapeHtml(t(p.labelKey, {}, p.fallback))} (${p.months}m)</option>`;
    }).join('');

  // Group datalist: defaults + already-used groups, deduplicated.
  const groupOptions = Array.from(new Set([
    ..._SUBSCRIPTION_GROUPS_DEFAULT,
    ..._subscriptionsList.map(r => (r.group || '').trim()).filter(Boolean),
  ])).sort().map(g => `<option value="${escapeHtml(g)}"></option>`).join('');

  // DP-M6: close any stale overlay via its own handle so its Escape
  // listener is detached with it (a bare .remove() would strand it).
  const existingOverlay = document.querySelector('.modal-overlay');
  if (existingOverlay) (existingOverlay._close || existingOverlay.remove).call(existingOverlay);

  const titleVerb = editing
    ? t('page.subscriptions.modal.title_edit', {}, 'Edit')
    : t('page.subscriptions.modal.title_add', {}, 'Add');
  const saveLabel = editing
    ? t('page.subscriptions.modal.save_edit', {}, 'Update subscription')
    : t('page.subscriptions.modal.save_add', {}, 'Save subscription');

  const todayIso = localTodayIso();

  openModal({
    title: `${escapeHtml(titleVerb)} <span class="accent">${escapeHtml(t('page.subscriptions.modal.title_noun', {}, 'Subscription'))}</span>`,
    maxWidth: '680px',
    bodyHtml: `
      <div class="atx-row">
        <div class="atx-field fx2"><label>${escapeHtml(t('page.subscriptions.modal.name', {}, 'Name'))}</label>
          <input type="text" id="sm-name" placeholder="${escapeHtml(t('page.subscriptions.modal.name_ph', {}, 'e.g. Netflix, ChatGPT, web hosting'))}" value="${escapeHtml(s ? s.name || '' : '')}" required>
        </div>
        <div class="atx-field fx1"><label>${escapeHtml(t('page.subscriptions.modal.group', {}, 'Group'))}</label>
          <input type="text" id="sm-group" list="sm-group-list" placeholder="${escapeHtml(t('page.subscriptions.modal.group_ph', {}, 'AI / Hosting / …'))}" value="${escapeHtml(s ? s.group || '' : '')}">
          <datalist id="sm-group-list">${groupOptions}</datalist>
        </div>
        <div class="atx-field fx1"><label>${escapeHtml(t('page.subscriptions.modal.provider', {}, 'Provider'))}</label>
          <input type="text" id="sm-provider" placeholder="${escapeHtml(t('page.subscriptions.modal.provider_ph', {}, 'OpenAI, Hostinger, …'))}" value="${escapeHtml(s ? s.provider || '' : '')}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${escapeHtml(t('page.subscriptions.modal.amount', {}, 'Amount'))}</label>
          <input type="number" step="0.01" min="0" id="sm-amount" value="${escapeHtml(s ? s.amount || '' : '')}" required>
        </div>
        <div class="atx-field fx1"><label>${escapeHtml(t('page.subscriptions.modal.currency', {}, 'Currency'))}</label>
          <select id="sm-currency" required>${currencyOptions}</select>
        </div>
        <div class="atx-field fx1"><label>${escapeHtml(t('page.subscriptions.modal.cycle', {}, 'Billing cycle'))}</label>
          <select id="sm-cycle" required>${cycleOptions}</select>
        </div>
        <div class="atx-field fx1"><label>${escapeHtml(t('page.subscriptions.modal.next_renewal', {}, 'Next renewal'))}</label>
          <input type="date" id="sm-next-renewal" value="${escapeHtml(s ? s.next_renewal || '' : '')}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${escapeHtml(t('page.subscriptions.modal.account', {}, 'Account'))}</label>
          <select id="sm-account"><option value=""${s && !s.account ? ' selected' : ''}>—</option>${accountOptions}</select>
        </div>
        <div class="atx-field fx1"><label>${escapeHtml(t('page.subscriptions.modal.payee', {}, 'Payee'))}</label>
          <input type="text" id="sm-payee" placeholder="${escapeHtml(t('page.subscriptions.modal.payee_ph', {}, 'Charged-by name on TX'))}" value="${escapeHtml(s ? s.payee || '' : '')}">
        </div>
        <div class="atx-field fx2"><label>${escapeHtml(t('page.subscriptions.modal.url', {}, 'Account URL (optional)'))}</label>
          <input type="url" id="sm-url" placeholder="https://…" value="${escapeHtml(s ? s.url || '' : '')}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx1"><label>${escapeHtml(t('page.subscriptions.modal.start_date', {}, 'Start date'))}</label>
          <input type="date" id="sm-start" value="${escapeHtml(s ? (s.start_date || '') : todayIso)}">
        </div>
        <div class="atx-field fx1"><label>${escapeHtml(t('page.subscriptions.modal.active', {}, 'Status'))}</label>
          <select id="sm-active">
            <option value="true"${(!s || (s.active || '').toLowerCase() === 'true') ? ' selected' : ''}>${escapeHtml(t('page.subscriptions.status.active', {}, 'Active'))}</option>
            <option value="false"${s && (s.active || '').toLowerCase() !== 'true' ? ' selected' : ''}>${escapeHtml(t('page.subscriptions.status.inactive', {}, 'Inactive'))}</option>
          </select>
        </div>
        <div class="atx-field fx1"><label>${escapeHtml(t('page.subscriptions.modal.cancelled_on', {}, 'Cancelled on (optional)'))}</label>
          <input type="date" id="sm-cancelled" value="${escapeHtml(s ? s.cancelled_on || '' : '')}">
        </div>
        <div class="atx-field fx1"><label>${escapeHtml(t('page.subscriptions.modal.auto_tag', {}, 'Auto-tag'))}</label>
          <input type="text" id="sm-auto-tag" placeholder="Subscription_…" value="${escapeHtml(s ? s.auto_tag || '' : '')}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field fx2"><label>${escapeHtml(t('page.subscriptions.modal.notes', {}, 'Notes'))}</label>
          <input type="text" id="sm-notes" value="${escapeHtml(s ? s.notes || '' : '')}">
        </div>
      </div>
      <div class="modal-actions" style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;">
        <button id="sm-cancel" data-modal-cancel style="padding:8px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;">${escapeHtml(t('common.actions.cancel', {}, 'Cancel'))}</button>
        <button id="sm-save" style="padding:8px 14px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius-xs);cursor:pointer;font-weight:600;">${escapeHtml(saveLabel)}</button>
      </div>`,
  });

  document.getElementById('sm-save').addEventListener('click', () => _saveSubscriptionFromModal(editing ? s.subscription_id : null));
}

async function _saveSubscriptionFromModal(editingId) {
  const payload = {
    name:           document.getElementById('sm-name').value.trim(),
    group:          document.getElementById('sm-group').value.trim(),
    provider:       document.getElementById('sm-provider').value.trim(),
    amount:         document.getElementById('sm-amount').value.trim(),
    currency:       document.getElementById('sm-currency').value.trim(),
    billing_months: document.getElementById('sm-cycle').value.trim(),
    next_renewal:   document.getElementById('sm-next-renewal').value.trim(),
    account:        document.getElementById('sm-account').value.trim(),
    payee:          document.getElementById('sm-payee').value.trim(),
    url:            document.getElementById('sm-url').value.trim(),
    start_date:     document.getElementById('sm-start').value.trim(),
    active:         document.getElementById('sm-active').value.trim(),
    cancelled_on:   document.getElementById('sm-cancelled').value.trim(),
    auto_tag:       document.getElementById('sm-auto-tag').value.trim(),
    notes:          document.getElementById('sm-notes').value.trim(),
  };

  // Minimal client-side guard. The server validates again — this just
  // gives the user a faster error than the round-trip.
  if (!payload.name) { uiAlert(t('page.subscriptions.err.name_required', {}, 'Name is required')); return; }
  if (!payload.amount) { uiAlert(t('page.subscriptions.err.amount_required', {}, 'Amount is required')); return; }

  const url = editingId ? '/api/subscriptions/update' : '/api/subscriptions/add';
  if (editingId) payload.subscription_id = editingId;

  // withSubmitLock (DP-H1, CODE_REVIEW_2026-07-08): a double-click on
  // Save minted two subscriptions with fresh IDs.
  await withSubmitLock(document.getElementById('sm-save'), async () => {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        uiAlert(t('page.subscriptions.err.save', { msg: data.error || resp.status }, `Save failed: ${data.error || resp.status}`));
        return;
      }
    } catch (err) {
      uiAlert(t('page.subscriptions.err.save', { msg: err.message }, `Save failed: ${err.message}`));
      return;
    }

    closeModal();
    _subscriptionsLoaded = false;
    _subsLogAll = null;
    // Re-render the view the modal was opened from: a save from the
    // drilldown must not bounce the user back to the list.
    const detailMatch = location.hash.match(/^#subscriptions\/(.+)$/);
    if (detailMatch && typeof renderSubscriptionDetail === 'function') {
      await renderSubscriptionDetail(decodeHashSegment(detailMatch[1]));
    } else {
      await renderSubscriptionsPage();
    }
  });
}

async function _confirmDeleteSubscription(sub) {
  const confirmFn = typeof window.uiConfirm === 'function'
    ? window.uiConfirm
    : (m) => Promise.resolve(window.confirm(m));
  const ok = await confirmFn(
    t('page.subscriptions.confirm.delete', { name: sub.name || sub.subscription_id }, `Delete subscription "${sub.name || sub.subscription_id}"?`),
    { type: 'destructive' },
  );
  if (!ok) return;

  try {
    const resp = await fetch('/api/subscriptions/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription_id: sub.subscription_id }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      uiAlert(t('page.subscriptions.err.delete', { msg: data.error || resp.status }, `Delete failed: ${data.error || resp.status}`));
      return;
    }
  } catch (err) {
    uiAlert(t('page.subscriptions.err.delete', { msg: err.message }, `Delete failed: ${err.message}`));
    return;
  }

  _subscriptionsLoaded = false;
  _subsLogAll = null;
  await renderSubscriptionsPage();
}

// Expose to global scope so core.js navigateTo can call it.
window.renderSubscriptionsPage = renderSubscriptionsPage;
window.renderSubscriptionDetail = renderSubscriptionDetail;

// External writers (TX-link roll, cron roll) change subscriptions.csv
// behind this page's back — refreshData() calls this so the next render
// refetches instead of showing pre-roll dates from the session cache.
window.invalidateSubscriptionsCache = () => {
  _subscriptionsLoaded = false;
  _subsLogAll = null;
};
