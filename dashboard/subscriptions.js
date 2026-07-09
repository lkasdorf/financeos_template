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

// User-facing filter for the list pills. Defaults to 'active' so the
// page opens on the things the user is actually paying for; the pill
// row also exposes an "all" option for bookkeeping.
let _subscriptionsFilter = 'active';

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
  const resp = await fetch('/api/subscriptions/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!resp.ok) throw new Error(`subscriptions/list ${resp.status}`);
  const data = await resp.json();
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

// Sum monthly equivalents per currency. Returns an array of
// {currency, total_monthly, total_yearly} objects so the UI can render
// one chip per currency without doing FX.
function _totalsByCurrency(rows) {
  const map = new Map();
  rows.forEach(r => {
    const cur = (r.currency || '').trim() || '—';
    const monthly = Number(r.amount_monthly) || 0;
    const prev = map.get(cur) || { currency: cur, total_monthly: 0, total_yearly: 0 };
    prev.total_monthly += monthly;
    prev.total_yearly += monthly * 12;
    map.set(cur, prev);
  });
  return Array.from(map.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}

// ─── Render ──────────────────────────────────────────────────────────────────

async function renderSubscriptionsPage() {
  const root = document.getElementById('subscriptions-content');
  if (!root) return;

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
  const totals = _totalsByCurrency(_filterSubs(_subscriptionsList, 'active'));
  const meta = document.getElementById('subscriptions-meta');
  if (meta) {
    const activeCount = _filterSubs(_subscriptionsList, 'active').length;
    meta.textContent = t(
      'page.subscriptions.meta',
      { active: activeCount, total: _subscriptionsList.length },
      `${activeCount} active · ${_subscriptionsList.length} total`,
    );
  }

  root.innerHTML = `
    ${_renderTotals(totals)}
    ${_renderToolbar()}
    ${_renderList(visible)}
  `;

  _bindSubscriptionsControls();
}

function _renderTotals(totals) {
  if (!totals.length) {
    return `<div class="report-section" style="margin-bottom:14px;">
      <div style="color:var(--muted);font-size:13px;">${escapeHtml(t('page.subscriptions.totals.empty', {}, 'No active subscriptions yet — add one to start tracking monthly cost.'))}</div>
    </div>`;
  }
  const chips = totals.map(tot => `
    <div class="kpi-card" style="min-width:180px;">
      <div class="kpi-label">${escapeHtml(t('page.subscriptions.totals.monthly_in', { currency: tot.currency }, `Monthly in ${tot.currency}`))}</div>
      <div class="kpi-value">${escapeHtml(_fmtAmount(tot.total_monthly, tot.currency))}</div>
      <div class="kpi-sub label-sm">${escapeHtml(t('page.subscriptions.totals.yearly_eq', { value: _fmtAmount(tot.total_yearly, tot.currency) }, `${_fmtAmount(tot.total_yearly, tot.currency)} / year`))}</div>
    </div>
  `).join('');
  return `<div class="kpi-grid" style="margin-bottom:14px;display:flex;flex-wrap:wrap;gap:12px;">${chips}</div>`;
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

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${filterTabs}</div>
      <button id="sub-add-btn" style="padding:8px 14px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius-xs);cursor:pointer;font-weight:600;">+ ${escapeHtml(t('page.subscriptions.add_button', {}, 'Add subscription'))}</button>
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
          <div style="font-weight:600;font-size:13px;line-height:1.2;">${escapeHtml(sub.name || sub.subscription_id)}</div>
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
    // Trend marker: percent vs previous (most recent first, so prev is index+1).
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
            delta = `<span class="${cls}" style="margin-left:6px;font-size:10px;">${sign}${pct.toFixed(1)}%</span>`;
          }
        }
      }
      const txShort = (r.tx_import_id || '').slice(0, 8);
      return `
        <tr>
          <td>${escapeHtml(r.date || '')}</td>
          <td class="t-right">${escapeHtml(_fmtAmount(parseFloat(r.amount) || 0, r.currency || ''))}${delta}</td>
          <td>${escapeHtml(r.account || '')}</td>
          <td><a class="sub-tx-link" data-tx-id="${escapeHtml(r.tx_import_id || '')}" style="color:var(--accent-dim);cursor:pointer;font-family:monospace;font-size:10px;">${escapeHtml(txShort)}…</a></td>
        </tr>
      `;
    }).join('');
    panel.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="color:var(--muted);text-align:left;">
          <th>${escapeHtml(t('common.col.date', {}, 'Date'))}</th>
          <th class="t-right">${escapeHtml(t('common.col.amount', {}, 'Amount'))}</th>
          <th>${escapeHtml(t('common.col.account', {}, 'Account'))}</th>
          <th>${escapeHtml(t('common.col.tx', {}, 'TX'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (e) {
    panel.innerHTML = `<div class="c-neg">${escapeHtml(t('page.subscriptions.history.err', { msg: e.message }, `Could not load: ${e.message}`))}</div>`;
  }
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

  const todayIso = new Date().toISOString().slice(0, 10);

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
    await renderSubscriptionsPage();
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
  await renderSubscriptionsPage();
}

// Expose to global scope so core.js navigateTo can call it.
window.renderSubscriptionsPage = renderSubscriptionsPage;
