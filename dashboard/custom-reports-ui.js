
// ── Custom Reports ────────────────────────────────────────────────────────
// Phase B: list page (renderCustomReportsPage).
// Phase C: builder (renderCustomReportsBuilder) for new/edit. Sub-routes
// #custom-reports/new and #custom-reports/edit/<id> route through
// dispatchCustomReportsRoute, called from core.js navigateTo.
// The runner (#custom-reports/view/<id>) is stubbed for Phase D.

let customReportsCache = [];        // server-side list, alphabetically sorted
let customReportsContext = null;     // { tags: [...], payees: [...] } from /api/tx/context
let customReportsBuilderDef = null;  // working draft in the builder
let customReportsBuilderOriginalId = null;  // null when creating new

function dispatchCustomReportsRoute(pageId) {
  // pageId is e.g. 'custom-reports', 'custom-reports/new',
  // 'custom-reports/edit/cr_xxx', 'custom-reports/view/cr_xxx'
  const parts = pageId.split('/').slice(1);  // drop 'custom-reports'
  const action = parts[0] || 'list';
  const id = parts[1] || null;

  if (action === 'new') return renderCustomReportsBuilder(null);
  if (action === 'edit' && id) return renderCustomReportsBuilder(id);
  if (action === 'view' && id) return renderCustomReportRun(id);
  return renderCustomReportsPage();
}

async function renderCustomReportsPage() {
  const contentEl = document.getElementById('custom-reports-content');
  const metaEl = document.getElementById('custom-reports-meta');
  contentEl.innerHTML = `<div class="section"><div class="hint-md">${t('pages.custom.list.loading', {}, 'Loading…')}</div></div>`;

  try {
    const res = await fetch('/api/custom-reports/list', { method: 'POST' });
    const data = await res.json();
    customReportsCache = (data.reports || []).slice().sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
  } catch (e) {
    contentEl.innerHTML = `<div class="section"><div class="hint-md c-neg">${t('pages.custom.list.err.load', { err: escapeHtml(String(e)) }, `Failed to load custom reports: ${escapeHtml(String(e))}`)}</div></div>`;
    return;
  }

  metaEl.textContent = `${customReportsCache.length} custom report${customReportsCache.length !== 1 ? 's' : ''}`;

  const headerHtml = `
    <div class="section" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <div class="hint-md">${escapeHtml(t('crb.intro', {}, 'Build reports with custom filters across categories, tags, accounts, and payees. Saved reports also appear on the Reports page.'))}</div>
      <button id="cr-new-btn" class="btn-primary nowrap">${t('pages.custom.list.btn_new', {}, '+ New Custom Report')}</button>
    </div>
  `;

  let cardsHtml = '';
  if (customReportsCache.length === 0) {
    cardsHtml = `
      <div class="section empty-state">
        <div class="empty-state-icon">&#x1F4CA;</div>
        <div class="empty-state-title">${t('pages.custom.list.empty', {}, 'No custom reports yet')}</div>
        <div class="empty-state-desc">${t('pages.custom.list.empty_hint', {}, 'Click "+ New Custom Report" to create your first one.')}</div>
      </div>
    `;
  } else {
    cardsHtml = `
      <div class="report-category">
        <div class="report-category-label">${escapeHtml(t('crb.saved', {}, 'Saved Reports'))}</div>
        <div class="report-cards">
          ${customReportsCache.map(r => renderCustomReportCard(r)).join('')}
        </div>
      </div>
    `;
  }

  contentEl.innerHTML = headerHtml + cardsHtml;

  // Event delegation registered once per content element
  if (!contentEl._crDelegated) {
    contentEl.addEventListener('click', handleCustomReportsClick);
    contentEl._crDelegated = true;
  }
}

function renderCustomReportCard(r) {
  const desc = r.description || `Match ${r.match_mode || 'AND'} • ${describeFilterSummary(r)}`;
  return `
    <div class="report-card" data-cr-id="${escapeHtml(r.id)}" style="display:flex;flex-direction:column;gap:8px;">
      <div class="rc-title">${escapeHtml(r.name)}</div>
      <div class="rc-desc">${escapeHtml(desc)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;">
        <button class="btn-secondary" data-cr-action="open" data-cr-id="${escapeHtml(r.id)}">${t('pages.custom.card.open', {}, 'Open')}</button>
        <button class="btn-secondary" data-cr-action="edit" data-cr-id="${escapeHtml(r.id)}">${t('pages.actions.title.edit', {}, 'Edit')}</button>
        <button class="btn-secondary" data-cr-action="duplicate" data-cr-id="${escapeHtml(r.id)}">${t('pages.actions.title.duplicate', {}, 'Duplicate')}</button>
        <button class="btn-secondary c-neg" data-cr-action="delete" data-cr-id="${escapeHtml(r.id)}">${t('pages.actions.title.delete', {}, 'Delete')}</button>
      </div>
    </div>
  `;
}

function describeFilterSummary(r) {
  const parts = [];
  const f = r.filters || {};
  for (const key of ['categories', 'tags', 'accounts', 'payees']) {
    const block = f[key] || {};
    const n = (block.values || []).length;
    if (n > 0) {
      const verb = block.mode === 'exclude' ? 'excl.' : '';
      parts.push(`${n} ${key}${verb ? ' ' + verb : ''}`);
    }
  }
  return parts.length ? parts.join(' • ') : 'no filters';
}

async function handleCustomReportsClick(e) {
  if (e.target.closest('#cr-new-btn')) {
    location.hash = '#custom-reports/new';
    return;
  }

  const actionBtn = e.target.closest('[data-cr-action]');
  if (!actionBtn) return;
  const action = actionBtn.getAttribute('data-cr-action');
  const id = actionBtn.getAttribute('data-cr-id');
  if (!id) return;

  if (action === 'open') {
    location.hash = '#custom-reports/view/' + id;
    return;
  }
  if (action === 'edit') {
    location.hash = '#custom-reports/edit/' + id;
    return;
  }
  if (action === 'duplicate') {
    await duplicateCustomReport(id);
    return;
  }
  if (action === 'delete') {
    const r = customReportsCache.find(x => x.id === id);
    if (!r) return;
    if (!(await uiConfirm(t('pages.custom.confirm.delete', { name: r.name }, `Delete custom report "${r.name}"?`), { type: 'destructive' }))) return;
    await deleteCustomReport(id);
    return;
  }
}

async function duplicateCustomReport(id) {
  try {
    const res = await fetch('/api/custom-reports/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) { uiAlert(t('pages.custom.err.duplicate_failed', { err: data.error || res.status }, `Duplicate failed: ${data.error || res.status}`)); return; }
    await renderCustomReportsPage();
  } catch (e) {
    uiAlert(t('pages.custom.err.duplicate_failed', { err: String(e) }, `Duplicate failed: ${e}`));
  }
}

async function deleteCustomReport(id) {
  try {
    const res = await fetch('/api/custom-reports/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) { uiAlert(t('pages.custom.err.delete_failed', { err: data.error || res.status }, `Delete failed: ${data.error || res.status}`)); return; }
    await renderCustomReportsPage();
  } catch (e) {
    uiAlert(t('pages.custom.err.delete_failed', { err: String(e) }, `Delete failed: ${e}`));
  }
}

// ── Builder ─────────────────────────────────────────────────────────────

function emptyCustomReportDef() {
  return {
    name: '',
    description: '',
    match_mode: 'AND',
    exclude_operational_noise: true,
    filters: {
      categories: { mode: 'include', values: [] },
      tags:       { mode: 'include', values: [] },
      accounts:   { mode: 'include', values: [] },
      payees:     { mode: 'include', values: [] },
    },
    period: { default_view: 'monthly', default_preset: 'current', custom_range: null },
    widgets: {
      pie:   { enabled: false, dimension: 'category' },
      top_n: { enabled: false, dimension: 'payee', n: 10 },
    },
  };
}

async function ensureCustomReportsContext() {
  // Cache tags + payees lookup for the builder; refreshes only if missing.
  if (customReportsContext) return customReportsContext;
  const res = await fetch('/api/tx/context', { method: 'POST' });
  const data = await res.json();
  customReportsContext = {
    tags: (data.tags || []).filter(t => t.active !== false).map(t => t.tag || t).filter(Boolean),
    payees: (data.payees || []).map(p => p.payee || p).filter(Boolean).sort((a, b) => a.localeCompare(b)),
  };
  return customReportsContext;
}

async function renderCustomReportsBuilder(reportId) {
  const contentEl = document.getElementById('custom-reports-content');
  const metaEl = document.getElementById('custom-reports-meta');
  metaEl.textContent = reportId ? t('pages.custom.builder.title_edit', {}, 'Editing report') : t('pages.custom.builder.title_new', {}, 'New report');
  contentEl.innerHTML = `<div class="section"><div class="hint-md">${t('pages.custom.builder.loading', {}, 'Loading…')}</div></div>`;

  try {
    await ensureCustomReportsContext();
  } catch (e) {
    contentEl.innerHTML = `<div class="section"><div class="hint-md c-neg">${t('pages.custom.builder.err.refdata', { err: escapeHtml(String(e)) }, `Failed to load reference data: ${escapeHtml(String(e))}`)}</div></div>`;
    return;
  }

  if (reportId) {
    // Load existing report for editing — may need a fresh list fetch
    if (!customReportsCache.length) {
      const res = await fetch('/api/custom-reports/list', { method: 'POST' });
      const data = await res.json();
      customReportsCache = data.reports || [];
    }
    const existing = customReportsCache.find(r => r.id === reportId);
    if (!existing) {
      contentEl.innerHTML = `<div class="section"><div class="hint-md c-neg">${t('pages.custom.runner.err.not_found', {}, 'Report not found.')}</div></div>`;
      return;
    }
    customReportsBuilderDef = JSON.parse(JSON.stringify(existing));  // deep clone
    customReportsBuilderOriginalId = reportId;
  } else {
    customReportsBuilderDef = emptyCustomReportDef();
    customReportsBuilderOriginalId = null;
  }

  contentEl.innerHTML = renderBuilderHtml();
  attachBuilderHandlers();
  refreshBuilderMatchCounter();
}

function renderBuilderHtml() {
  const def = customReportsBuilderDef;
  const ctx = customReportsContext || { tags: [], payees: [] };
  const accounts = (state.accounts || []).filter(a => a.status !== 'archived');
  const categories = (state.categories || []).filter(c => c.active === 'true' || c.active === true);

  // Build tree groups for categories: top-level path tokens (before colon).
  const catGroups = {};
  for (const c of categories) {
    const path = c.path || '';
    const top = path.split(':')[0];
    if (!catGroups[top]) catGroups[top] = [];
    catGroups[top].push(path);
  }
  const sortedGroups = Object.keys(catGroups).sort();

  const isEdit = !!customReportsBuilderOriginalId;

  return `
    <div class="section" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <div class="flex-row gap-sm">
        <button class="btn-secondary" id="cr-builder-back">&larr; Back to list</button>
        <strong style="font-size:15px;">${isEdit ? t('pages.custom.builder.heading_edit', {}, 'Edit Custom Report') : t('pages.custom.builder.heading_new', {}, 'New Custom Report')}</strong>
      </div>
      <div style="display:flex;gap:12px;align-items:center;">
        <span class="hint-md">${escapeHtml(t('crb.matches', {}, 'Matches:'))} <strong id="cr-match-count" class="c-acc">…</strong> ${escapeHtml(t('crb.matches_unit', {}, 'tx'))}</span>
        <button class="btn-secondary" id="cr-builder-cancel">${t('common.actions.cancel', {}, 'Cancel')}</button>
        <button class="btn-primary"   id="cr-builder-save">${isEdit ? t('pages.custom.builder.btn.save_edit', {}, 'Save changes') : t('pages.custom.builder.btn.save_new', {}, 'Create report')}</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">${escapeHtml(t('crb.section.basics', {}, 'Basics'))}</div>
      <div style="display:grid;grid-template-columns:120px 1fr;gap:8px 12px;align-items:center;">
        <label for="cr-f-name">${escapeHtml(t('common.col.name', {}, 'Name'))}</label>
        <input type="text" id="cr-f-name" value="${escapeHtml(def.name)}" placeholder="e.g. Bills without Internet"
               style="padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:13px;">
        <label for="cr-f-desc">${escapeHtml(t('common.label.description', {}, 'Description'))}</label>
        <input type="text" id="cr-f-desc" value="${escapeHtml(def.description || '')}" placeholder="optional"
               style="padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:13px;">
        <label>${escapeHtml(t('crb.match_mode', {}, 'Match mode'))}</label>
        <div style="display:flex;gap:14px;">
          <label class="chk-row">
            <input type="radio" name="cr-f-match" value="AND" ${def.match_mode === 'AND' ? 'checked' : ''}> AND (all blocks)
          </label>
          <label class="chk-row">
            <input type="radio" name="cr-f-match" value="OR" ${def.match_mode === 'OR' ? 'checked' : ''}> OR (any block)
          </label>
        </div>
        <label>${escapeHtml(t('crb.operational_only', {}, 'Operational only'))}</label>
        <div style="display:flex;gap:14px;align-items:center;">
          <label class="chk-row">
            <input type="checkbox" id="cr-f-opnoise" ${def.exclude_operational_noise !== false ? 'checked' : ''}>
            Exclude custody accounts and transfers/reimbursements
          </label>
          <span class="hint-sm" style="font-size:10px;color:var(--text-muted);">${escapeHtml(t('crb.operational_only_hint', {}, 'Matches Fixed Reports behavior. Uncheck to audit custody flows.'))}</span>
        </div>
      </div>
    </div>

    ${renderFilterBlock('categories', 'Categories', renderCategoriesTreeHtml(sortedGroups, catGroups))}
    ${renderFilterBlock('tags',       'Tags',       renderChipsHtml('tags', ctx.tags))}
    ${renderFilterBlock('accounts',   'Accounts',   renderAccountsHtml(accounts))}
    ${renderFilterBlock('payees',     'Payees',     renderPayeesHtml(ctx.payees))}

    <div class="section">
      <div class="section-title">${escapeHtml(t('crb.section.period', {}, 'Period'))}</div>
      <div style="display:grid;grid-template-columns:120px 1fr;gap:8px 12px;align-items:center;">
        <label>${escapeHtml(t('crb.default_view', {}, 'Default view'))}</label>
        <div style="display:flex;gap:14px;">
          <label class="chk-row">
            <input type="radio" name="cr-f-view" value="monthly" ${def.period.default_view === 'monthly' ? 'checked' : ''}> Monthly
          </label>
          <label class="chk-row">
            <input type="radio" name="cr-f-view" value="yearly" ${def.period.default_view === 'yearly' ? 'checked' : ''}> Yearly
          </label>
        </div>
        <label for="cr-f-preset">${escapeHtml(t('crb.default_preset', {}, 'Default preset'))}</label>
        <select id="cr-f-preset" style="padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:13px;max-width:240px;">
          <option value="current" ${def.period.default_preset === 'current' ? 'selected' : ''}>${escapeHtml(t('crb.preset.current', {}, 'Current period'))}</option>
          <option value="ytd"     ${def.period.default_preset === 'ytd'     ? 'selected' : ''}>${escapeHtml(t('reports.budget.period_ytd', {}, 'Year to date'))}</option>
          <option value="last12"  ${def.period.default_preset === 'last12'  ? 'selected' : ''}>${escapeHtml(t('reports.fxh.range.12m', {}, 'Last 12 months'))}</option>
          <option value="all"     ${def.period.default_preset === 'all'     ? 'selected' : ''}>${escapeHtml(t('reports.fxh.range.all', {}, 'All time'))}</option>
          <option value="custom"  ${def.period.default_preset === 'custom'  ? 'selected' : ''}>${escapeHtml(t('crb.preset.custom', {}, 'Custom range'))}</option>
        </select>
        <div id="cr-f-range-row" style="display:${def.period.default_preset === 'custom' ? 'contents' : 'none'};">
          <label>${escapeHtml(t('crb.preset.custom', {}, 'Custom range'))}</label>
          <div class="flex-row gap-sm">
            <input type="date" id="cr-f-range-from" value="${(def.period.custom_range && def.period.custom_range.from) || ''}"
                   class="input-sm">
            <span class="hint-md">to</span>
            <input type="date" id="cr-f-range-to" value="${(def.period.custom_range && def.period.custom_range.to) || ''}"
                   class="input-sm">
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">${escapeHtml(t('crb.section.widgets', {}, 'Widgets'))}</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
          <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
            <input type="checkbox" id="cr-f-pie-on" ${def.widgets.pie.enabled ? 'checked' : ''}> Pie breakdown
          </label>
          <label class="flex-row gap-xs">
            Dimension:
            <select id="cr-f-pie-dim" class="input-sm">
              <option value="category" ${def.widgets.pie.dimension === 'category' ? 'selected' : ''}>${escapeHtml(t('crb.by.category', {}, 'by Category'))}</option>
              <option value="payee"    ${def.widgets.pie.dimension === 'payee'    ? 'selected' : ''}>${escapeHtml(t('crb.by.payee', {}, 'by Payee'))}</option>
              <option value="account"  ${def.widgets.pie.dimension === 'account'  ? 'selected' : ''}>${escapeHtml(t('crb.by.account', {}, 'by Account'))}</option>
              <option value="tag"      ${def.widgets.pie.dimension === 'tag'      ? 'selected' : ''}>${escapeHtml(t('crb.by.tag', {}, 'by Tag'))}</option>
            </select>
          </label>
        </div>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
          <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
            <input type="checkbox" id="cr-f-topn-on" ${def.widgets.top_n.enabled ? 'checked' : ''}> Top-N list
          </label>
          <label class="flex-row gap-xs">
            Dimension:
            <select id="cr-f-topn-dim" class="input-sm">
              <option value="payee"    ${def.widgets.top_n.dimension === 'payee'    ? 'selected' : ''}>${escapeHtml(t('settings.tab.payees', {}, 'Payees'))}</option>
              <option value="category" ${def.widgets.top_n.dimension === 'category' ? 'selected' : ''}>${escapeHtml(t('settings.tab.categories', {}, 'Categories'))}</option>
              <option value="account"  ${def.widgets.top_n.dimension === 'account'  ? 'selected' : ''}>${escapeHtml(t('nav.accounts', {}, 'Accounts'))}</option>
              <option value="tag"      ${def.widgets.top_n.dimension === 'tag'      ? 'selected' : ''}>${escapeHtml(t('settings.tab.tags', {}, 'Tags'))}</option>
            </select>
          </label>
          <label class="flex-row gap-xs">
            N:
            <input type="number" id="cr-f-topn-n" min="3" max="50" value="${def.widgets.top_n.n || 10}"
                   style="width:60px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:12px;">
          </label>
        </div>
      </div>
    </div>
  `;
}

function renderFilterBlock(key, label, innerHtml) {
  const block = customReportsBuilderDef.filters[key];
  const count = (block.values || []).length;
  return `
    <div class="section" data-cr-block="${key}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
        <div class="section-title m-0">${label} <span class="hint-md" style="font-weight:normal;">(${count} selected)</span></div>
        <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;">
          <button data-cr-mode="${key}|include" class="cr-mode-btn ${block.mode === 'include' ? 'active' : ''}"
                  style="padding:4px 10px;font-size:11px;background:${block.mode === 'include' ? 'var(--accent)' : 'transparent'};color:${block.mode === 'include' ? '#fff' : 'var(--text)'};border:0;cursor:pointer;">${escapeHtml(t('crb.include', {}, 'Include'))}</button>
          <button data-cr-mode="${key}|exclude" class="cr-mode-btn ${block.mode === 'exclude' ? 'active' : ''}"
                  style="padding:4px 10px;font-size:11px;background:${block.mode === 'exclude' ? 'var(--negative)' : 'transparent'};color:${block.mode === 'exclude' ? '#fff' : 'var(--text)'};border:0;cursor:pointer;">${escapeHtml(t('crb.exclude', {}, 'Exclude'))}</button>
        </div>
      </div>
      ${innerHtml}
    </div>
  `;
}

function renderCategoriesTreeHtml(sortedGroups, catGroups) {
  const selected = new Set(customReportsBuilderDef.filters.categories.values);
  let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px 18px;max-height:340px;overflow-y:auto;padding:4px 2px;">';
  for (const top of sortedGroups) {
    const children = catGroups[top].slice().sort();
    // The "top" pseudo-entry gets no checkbox if a same-named real category
    // exists (it's already in children); otherwise it's a header only.
    const topAsCategory = children.includes(top);
    const realChildren = children.filter(p => p !== top);
    const groupHeader = topAsCategory
      ? `<label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-weight:600;">
           <input type="checkbox" data-cr-cat="${escapeHtml(top)}" ${selected.has(top) ? 'checked' : ''}> ${escapeHtml(top)}
         </label>`
      : `<div style="font-weight:600;font-size:12px;color:var(--muted);">${escapeHtml(top)}</div>`;

    html += `<div data-cr-cat-group="${escapeHtml(top)}" style="display:flex;flex-direction:column;gap:4px;">`;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
               ${groupHeader}
               <button data-cr-cat-toggle="${escapeHtml(top)}" class="btn-secondary" style="font-size:10px;padding:2px 6px;">${escapeHtml(t('crb.select_all', {}, 'all'))}</button>
             </div>`;
    for (const path of realChildren) {
      html += `<label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-size:12px;padding-left:14px;">
        <input type="checkbox" data-cr-cat="${escapeHtml(path)}" ${selected.has(path) ? 'checked' : ''}>
        ${escapeHtml(path.replace(top + ':', ''))}
      </label>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderChipsHtml(key, items) {
  // Generic chip selector for tags. Click chip to toggle.
  const selected = new Set(customReportsBuilderDef.filters[key].values);
  if (items.length === 0) {
    return `<div class="hint-md">${t('pages.custom.builder.empty.no_items', { category: key }, `No ${key} available.`)}</div>`;
  }
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;">` +
    items.map(item => {
      const on = selected.has(item);
      return `<button data-cr-chip="${key}|${escapeHtml(item)}"
        style="padding:4px 10px;border-radius:999px;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : 'transparent'};color:${on ? '#fff' : 'var(--text)'};font-size:11px;cursor:pointer;">${escapeHtml(item)}</button>`;
    }).join('') + '</div>';
}

function renderAccountsHtml(accounts) {
  // Group by owner type for clarity
  const groups = {
    'Self':    accounts.filter(a => a.owner === 'self' && a.type !== 'pass_through'),
    'Pass-through': accounts.filter(a => a.type === 'pass_through'),
    'Custody': accounts.filter(a => a.owner !== 'self' && a.type !== 'pass_through'),
  };
  const selected = new Set(customReportsBuilderDef.filters.accounts.values);
  let html = '';
  for (const [label, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    html += `<div class="mb-8">`;
    html += `<div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:4px;">${label}</div>`;
    html += `<div style="display:flex;flex-wrap:wrap;gap:6px;">`;
    for (const a of items) {
      const on = selected.has(a.alias);
      html += `<button data-cr-chip="accounts|${escapeHtml(a.alias)}"
        title="${escapeHtml(a.name)}"
        style="padding:4px 10px;border-radius:999px;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : 'transparent'};color:${on ? '#fff' : 'var(--text)'};font-size:11px;cursor:pointer;">${escapeHtml(a.alias)}</button>`;
    }
    html += `</div></div>`;
  }
  return html || `<div class="hint-md">${t('pages.custom.builder.empty.no_accounts', {}, 'No accounts available.')}</div>`;
}

function renderPayeesHtml(payees) {
  const selected = customReportsBuilderDef.filters.payees.values;
  return `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <input type="text" id="cr-f-payee-search" placeholder="${escapeHtml(t('pages.custom.builder.search_payees', {}, 'Search payees…'))}"
             style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;font-size:12px;">
      <div id="cr-f-payee-list" style="max-height:200px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:6px;padding:4px 2px;">
        ${renderPayeeChips(payees, '')}
      </div>
      <div id="cr-f-payee-selected" style="display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid var(--border);padding-top:6px;${selected.length ? '' : 'display:none;'}">
        ${selected.map(p => `<span style="padding:3px 8px;border-radius:999px;background:var(--accent);color:#fff;font-size:11px;display:inline-flex;align-items:center;gap:4px;">${escapeHtml(p)}<button data-cr-chip="payees|${escapeHtml(p)}" style="background:transparent;border:0;color:#fff;cursor:pointer;font-weight:bold;line-height:1;" aria-label="${t('aria.icon_remove', {}, 'Remove')} ${escapeHtml(p)}">×</button></span>`).join('')}
      </div>
    </div>
  `;
}

function renderPayeeChips(payees, query) {
  const selected = new Set(customReportsBuilderDef.filters.payees.values);
  const q = (query || '').toLowerCase().trim();
  const filtered = q ? payees.filter(p => p.toLowerCase().includes(q)) : payees;
  if (filtered.length === 0) return `<div class="hint-md">${t('pages.custom.builder.empty.no_matches', {}, 'No matches.')}</div>`;
  return filtered.slice(0, 80).map(p => {
    const on = selected.has(p);
    return `<button data-cr-chip="payees|${escapeHtml(p)}"
      style="padding:3px 8px;border-radius:999px;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : 'transparent'};color:${on ? '#fff' : 'var(--text)'};font-size:11px;cursor:pointer;">${escapeHtml(p)}</button>`;
  }).join('');
}

function attachBuilderHandlers() {
  const root = document.getElementById('custom-reports-content');
  if (!root || root._crBuilderDelegated) return;
  root.addEventListener('click', onBuilderClick);
  root.addEventListener('change', onBuilderChange);
  root.addEventListener('input',  onBuilderInput);
  root._crBuilderDelegated = true;
}

async function onBuilderClick(e) {
  // Back / Cancel / Save
  if (e.target.closest('#cr-builder-back')) { location.hash = '#custom-reports'; return; }
  if (e.target.closest('#cr-builder-cancel')) {
    if (!(await uiConfirm(t('pages.custom.builder.confirm.discard', {}, 'Discard changes?')))) return;
    location.hash = '#custom-reports'; return;
  }
  if (e.target.closest('#cr-builder-save')) { saveBuilderDraft(); return; }

  // Mode toggle (include/exclude)
  const modeBtn = e.target.closest('[data-cr-mode]');
  if (modeBtn) {
    const [key, mode] = modeBtn.getAttribute('data-cr-mode').split('|');
    customReportsBuilderDef.filters[key].mode = mode;
    rerenderBuilder();
    return;
  }

  // Chip toggle (tags / accounts / payees)
  const chip = e.target.closest('[data-cr-chip]');
  if (chip) {
    const [key, value] = chip.getAttribute('data-cr-chip').split('|');
    const arr = customReportsBuilderDef.filters[key].values;
    const idx = arr.indexOf(value);
    if (idx === -1) arr.push(value); else arr.splice(idx, 1);
    rerenderBuilder();
    return;
  }

  // "all" button next to a category group → toggle every child path
  const catToggle = e.target.closest('[data-cr-cat-toggle]');
  if (catToggle) {
    const top = catToggle.getAttribute('data-cr-cat-toggle');
    const root = document.getElementById('custom-reports-content');
    const checkboxes = root.querySelectorAll(`[data-cr-cat-group="${cssEscape(top)}"] input[type="checkbox"][data-cr-cat]`);
    const allOn = [...checkboxes].every(cb => cb.checked);
    const newState = !allOn;
    const arr = customReportsBuilderDef.filters.categories.values;
    checkboxes.forEach(cb => {
      const path = cb.getAttribute('data-cr-cat');
      const idx = arr.indexOf(path);
      if (newState && idx === -1) arr.push(path);
      if (!newState && idx !== -1) arr.splice(idx, 1);
    });
    rerenderBuilder();
    return;
  }
}

function onBuilderChange(e) {
  const t = e.target;
  // Category checkbox
  if (t.matches('input[type="checkbox"][data-cr-cat]')) {
    const path = t.getAttribute('data-cr-cat');
    const arr = customReportsBuilderDef.filters.categories.values;
    const idx = arr.indexOf(path);
    if (t.checked && idx === -1) arr.push(path);
    if (!t.checked && idx !== -1) arr.splice(idx, 1);
    rerenderBuilder();
    return;
  }
  if (t.name === 'cr-f-match') { customReportsBuilderDef.match_mode = t.value; refreshBuilderMatchCounter(); return; }
  if (t.id === 'cr-f-opnoise') { customReportsBuilderDef.exclude_operational_noise = t.checked; refreshBuilderMatchCounter(); return; }
  if (t.name === 'cr-f-view')  { customReportsBuilderDef.period.default_view = t.value; return; }
  if (t.id === 'cr-f-preset')  {
    customReportsBuilderDef.period.default_preset = t.value;
    document.getElementById('cr-f-range-row').style.display = t.value === 'custom' ? 'contents' : 'none';
    return;
  }
  if (t.id === 'cr-f-range-from' || t.id === 'cr-f-range-to') {
    if (!customReportsBuilderDef.period.custom_range) customReportsBuilderDef.period.custom_range = {};
    if (t.id === 'cr-f-range-from') customReportsBuilderDef.period.custom_range.from = t.value;
    if (t.id === 'cr-f-range-to')   customReportsBuilderDef.period.custom_range.to   = t.value;
    return;
  }
  if (t.id === 'cr-f-pie-on')   { customReportsBuilderDef.widgets.pie.enabled = t.checked; return; }
  if (t.id === 'cr-f-pie-dim')  { customReportsBuilderDef.widgets.pie.dimension = t.value; return; }
  if (t.id === 'cr-f-topn-on')  { customReportsBuilderDef.widgets.top_n.enabled = t.checked; return; }
  if (t.id === 'cr-f-topn-dim') { customReportsBuilderDef.widgets.top_n.dimension = t.value; return; }
  if (t.id === 'cr-f-topn-n')   { customReportsBuilderDef.widgets.top_n.n = parseInt(t.value, 10) || 10; return; }
}

function onBuilderInput(e) {
  const t = e.target;
  if (t.id === 'cr-f-name') { customReportsBuilderDef.name = t.value; return; }
  if (t.id === 'cr-f-desc') { customReportsBuilderDef.description = t.value; return; }
  if (t.id === 'cr-f-payee-search') {
    const list = document.getElementById('cr-f-payee-list');
    if (list) list.innerHTML = renderPayeeChips(customReportsContext.payees, t.value);
    return;
  }
}

function rerenderBuilder() {
  // Re-render the whole shell (cheap; lets us update counts + chip states).
  // Keeps the search-input value if present.
  const searchEl = document.getElementById('cr-f-payee-search');
  const searchVal = searchEl ? searchEl.value : '';
  const contentEl = document.getElementById('custom-reports-content');
  contentEl.innerHTML = renderBuilderHtml();
  if (searchVal) {
    const newSearch = document.getElementById('cr-f-payee-search');
    if (newSearch) {
      newSearch.value = searchVal;
      const list = document.getElementById('cr-f-payee-list');
      if (list) list.innerHTML = renderPayeeChips(customReportsContext.payees, searchVal);
    }
  }
  refreshBuilderMatchCounter();
}

function refreshBuilderMatchCounter() {
  const el = document.getElementById('cr-match-count');
  if (!el) return;
  if (!state.tx || !state.tx.length) { el.textContent = '–'; return; }
  try {
    const n = getFilteredTxCount(customReportsBuilderDef, state.tx);
    el.textContent = n.toLocaleString(getLocaleTag());
  } catch (e) {
    el.textContent = '?';
  }
}

async function saveBuilderDraft() {
  const def = customReportsBuilderDef;
  if (!def.name || !def.name.trim()) { uiAlert(t('pages.custom.builder.err.name_required', {}, 'Name is required.')); return; }
  if (def.period.default_preset === 'custom') {
    const r = def.period.custom_range || {};
    if (!r.from || !r.to) { uiAlert(t('pages.custom.builder.err.custom_range', {}, 'Custom date range needs both From and To.')); return; }
  }

  const isEdit = !!customReportsBuilderOriginalId;
  const url  = isEdit ? '/api/custom-reports/update' : '/api/custom-reports/add';
  const body = isEdit ? { id: customReportsBuilderOriginalId, updated: def } : def;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { uiAlert(t('pages.custom.builder.err.save_failed', { err: data.error || res.status }, `Save failed: ${data.error || res.status}`)); return; }
    customReportsCache = [];  // force refresh on next list view
    location.hash = '#custom-reports';
  } catch (e) {
    uiAlert(t('pages.custom.builder.err.save_failed', { err: String(e) }, `Save failed: ${e}`));
  }
}

// Minimal CSS-escape helper for attribute selectors (handles spaces, colons).
function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
}

// ── Runner ──────────────────────────────────────────────────────────────

let customReportsRunState = {};   // per-report ephemeral overrides (view/preset)
let customReportsRunCharts = [];  // Chart.js instances for cleanup

function destroyCustomReportCharts() {
  for (const c of customReportsRunCharts) { try { c.destroy(); } catch {} }
  customReportsRunCharts = [];
}

async function renderCustomReportRun(id) {
  const contentEl = document.getElementById('custom-reports-content');
  const metaEl = document.getElementById('custom-reports-meta');
  contentEl.innerHTML = `<div class="section"><div class="hint-md">${t('pages.custom.runner.loading', {}, 'Loading…')}</div></div>`;
  destroyCustomReportCharts();

  // Make sure we have the report list
  if (!customReportsCache.length) {
    try {
      const res = await fetch('/api/custom-reports/list', { method: 'POST' });
      const data = await res.json();
      customReportsCache = data.reports || [];
    } catch (e) {
      contentEl.innerHTML = `<div class="section"><div class="hint-md c-neg">${t('pages.custom.runner.err.load', { err: escapeHtml(String(e)) }, `Failed to load reports: ${escapeHtml(String(e))}`)}</div></div>`;
      return;
    }
  }
  const report = customReportsCache.find(r => r.id === id);
  if (!report) {
    contentEl.innerHTML = `<div class="section"><div class="hint-md c-neg">${t('pages.custom.runner.err.not_found', {}, 'Report not found.')}</div></div>`;
    return;
  }
  metaEl.textContent = report.name;

  // Initialize per-session overrides from saved defaults if not present
  if (!customReportsRunState[id]) {
    customReportsRunState[id] = {
      view:   report.period.default_view   || 'monthly',
      preset: report.period.default_preset || 'current',
    };
  }
  const runState = customReportsRunState[id];

  contentEl.innerHTML = renderCustomReportRunHtml(report, runState);
  attachCustomReportRunHandlers(report, runState);
  drawCustomReportContent(report, runState);
}

function renderCustomReportRunHtml(report, runState) {
  // Static shell — toolbars + named slots that drawCustomReportContent populates.
  return `
    <div class="section" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <div class="flex-row gap-sm">
        <button class="btn-secondary" id="cr-run-back">&larr; Back</button>
        <strong style="font-size:15px;">${escapeHtml(report.name)}</strong>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <button class="btn-secondary" id="cr-run-edit" title="${t('pages.custom.runner.title.edit_tooltip', {}, 'Edit this report')}">${t('pages.actions.title.edit', {}, 'Edit')}</button>
        <select id="cr-run-view" class="input-sm">
          <option value="monthly" ${runState.view === 'monthly' ? 'selected' : ''}>${escapeHtml(t('reports.toolbar.monthly', {}, 'Monthly'))}</option>
          <option value="yearly"  ${runState.view === 'yearly'  ? 'selected' : ''}>${escapeHtml(t('reports.toolbar.yearly', {}, 'Yearly'))}</option>
        </select>
        <select id="cr-run-preset" class="input-sm">
          <option value="current" ${runState.preset === 'current' ? 'selected' : ''}>${escapeHtml(t('crb.preset.current_year', {}, 'Current year'))}</option>
          <option value="ytd"     ${runState.preset === 'ytd'     ? 'selected' : ''}>${escapeHtml(t('reports.budget.period_ytd', {}, 'Year to date'))}</option>
          <option value="last12"  ${runState.preset === 'last12'  ? 'selected' : ''}>${escapeHtml(t('reports.fxh.range.12m', {}, 'Last 12 months'))}</option>
          <option value="all"     ${runState.preset === 'all'     ? 'selected' : ''}>${escapeHtml(t('reports.fxh.range.all', {}, 'All time'))}</option>
          <option value="custom"  ${runState.preset === 'custom'  ? 'selected' : ''}>${escapeHtml(t('crb.preset.custom', {}, 'Custom range'))}</option>
        </select>
      </div>
    </div>

    ${report.description ? `<div class="section" style="padding:10px 14px;"><div class="hint-md">${escapeHtml(report.description)}</div></div>` : ''}

    <div id="cr-run-kpi"></div>
    <div id="cr-run-chart"></div>
    <div id="cr-run-pie"></div>
    <div id="cr-run-topn"></div>
    <div id="cr-run-list"></div>
  `;
}

function attachCustomReportRunHandlers(report, runState) {
  document.getElementById('cr-run-back').addEventListener('click', () => {
    location.hash = '#custom-reports';
  });
  document.getElementById('cr-run-edit').addEventListener('click', () => {
    location.hash = '#custom-reports/edit/' + report.id;
  });
  document.getElementById('cr-run-view').addEventListener('change', (e) => {
    runState.view = e.target.value;
    drawCustomReportContent(report, runState);
  });
  document.getElementById('cr-run-preset').addEventListener('change', (e) => {
    runState.preset = e.target.value;
    drawCustomReportContent(report, runState);
  });
}

function drawCustomReportContent(report, runState) {
  destroyCustomReportCharts();
  const cur = (typeof displayCurrency !== 'undefined' && displayCurrency) || 'TZS';

  // 1. Filter by report definition
  const allTx = state.tx || [];
  const filteredTx = applyCustomReportFilters(report, allTx);

  // 2. Apply period window
  const window = computePeriodWindow(runState.preset, report.period.custom_range);
  const periodTx = filterByDateRange(filteredTx, window.from, window.to);

  // 3. Convert each TX amount to display currency for aggregations
  const converted = periodTx.map(t => ({
    ...t,
    amount: convertTo(parseFloat(t.amount) || 0, t.currency || 'TZS', cur),
  }));

  drawCustomReportKpi(converted, cur, window);
  drawCustomReportChart(converted, runState.view, cur);
  if (report.widgets.pie && report.widgets.pie.enabled) {
    drawCustomReportPie(converted, report.widgets.pie.dimension, cur);
  } else {
    document.getElementById('cr-run-pie').innerHTML = '';
  }
  if (report.widgets.top_n && report.widgets.top_n.enabled) {
    drawCustomReportTopN(converted, report.widgets.top_n.dimension, report.widgets.top_n.n || 10, cur);
  } else {
    document.getElementById('cr-run-topn').innerHTML = '';
  }
  drawCustomReportList(converted, cur);
}

function drawCustomReportKpi(tx, cur, window) {
  let income = 0, expense = 0;
  for (const t of tx) {
    if (t.type === 'income')       income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  const net = income - expense;
  const rangeLbl = (window.from || window.to)
    ? `${window.from || '…'} → ${window.to || '…'}`
    : 'all time';
  document.getElementById('cr-run-kpi').innerHTML = `
    <div class="report-section">
      <div class="report-section-title">Summary — ${rangeLbl}</div>
      <div class="income-grid">
        <div class="income-cell">
          <div class="ic-label">${escapeHtml(t('common.label.income', {}, 'Income'))}</div>
          <div class="ic-value c-pos">${formatCurrency(income, cur)}<span class="ic-cur">${cur}</span></div>
          <div class="ic-count">${tx.filter(t => t.type === 'income').length} TX</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${escapeHtml(t('common.type.expense', {}, 'Expense'))}</div>
          <div class="ic-value c-neg">${formatCurrency(expense, cur)}<span class="ic-cur">${cur}</span></div>
          <div class="ic-count">${tx.filter(t => t.type === 'expense').length} TX</div>
        </div>
        <div class="income-cell">
          <div class="ic-label">${escapeHtml(t('common.label.net', {}, 'Net'))}</div>
          <div class="ic-value" style="color:${net >= 0 ? 'var(--positive)' : 'var(--negative)'};">${formatCurrency(net, cur)}<span class="ic-cur">${cur}</span></div>
          <div class="ic-count">${tx.length} TX total</div>
        </div>
      </div>
    </div>
  `;
}

function drawCustomReportChart(tx, view, cur) {
  const buckets = aggregateByPeriod(tx, view);
  const labels = [...buckets.keys()];
  if (labels.length === 0) {
    document.getElementById('cr-run-chart').innerHTML = `
      <div class="report-section"><div class="empty-state compact"><div class="empty-state-icon">&#x1F4DD;</div><div class="empty-state-desc">${t('pages.custom.runner.empty.no_tx', {}, 'No transactions in this period.')}</div></div></div>
    `;
    return;
  }
  document.getElementById('cr-run-chart').innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${view === 'monthly' ? 'Monthly' : 'Yearly'} breakdown — ${cur}</div>
      <div style="position:relative;height:280px;"><canvas id="cr-run-chart-canvas"></canvas></div>
    </div>
  `;
  const incomeData  = labels.map(k => buckets.get(k).income);
  const expenseData = labels.map(k => buckets.get(k).expense);
  const ctx = document.getElementById('cr-run-chart-canvas');
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: view === 'monthly' ? labels.map(k => monthLabel(k)) : labels,
      datasets: [
        { label: t('pages.custom.runner.dataset.income', {}, 'Income'),  data: incomeData,  backgroundColor: chartTint(cssVar('--positive'), 0.7) },
        { label: t('pages.custom.runner.dataset.expense', {}, 'Expense'), data: expenseData, backgroundColor: chartTint(cssVar('--negative'), 0.7) },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatCurrency(c.parsed.y, cur)} ${cur}` } },
      },
      scales: {
        x: { stacked: false },
        y: { beginAtZero: true, ticks: { callback: (v) => formatCurrency(v, cur) } },
      },
    },
  });
  customReportsRunCharts.push(chart);
}

function drawCustomReportPie(tx, dimension, cur) {
  const data = aggregateByDimension(tx, dimension).slice(0, 12);  // cap for legibility
  if (data.length === 0) { document.getElementById('cr-run-pie').innerHTML = ''; return; }
  document.getElementById('cr-run-pie').innerHTML = `
    <div class="report-section">
      <div class="report-section-title">Expense breakdown by ${dimension}</div>
      <div style="position:relative;height:280px;"><canvas id="cr-run-pie-canvas"></canvas></div>
    </div>
  `;
  const palette = chartPalette();
  const ctx = document.getElementById('cr-run-pie-canvas');
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.label),
      datasets: [{ data: data.map(d => d.value), backgroundColor: palette.slice(0, data.length) }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${formatCurrency(c.parsed, cur)} ${cur}` } },
      },
    },
  });
  customReportsRunCharts.push(chart);
}

function drawCustomReportTopN(tx, dimension, n, cur) {
  const data = aggregateTopN(tx, dimension, n);
  if (data.length === 0) { document.getElementById('cr-run-topn').innerHTML = ''; return; }
  const total = data.reduce((s, d) => s + d.value, 0);
  document.getElementById('cr-run-topn').innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${escapeHtml(t('crb.topn.title', { n: data.length, dimension }, `Top ${data.length} ${dimension}s by expense`))}</div>
      <table class="tx-table">
        <thead><tr><th>#</th><th>${escapeHtml(dimension[0].toUpperCase() + dimension.slice(1))}</th><th class="t-right">${escapeHtml(t('common.col.amount', {}, 'Amount'))}</th><th class="t-right">${escapeHtml(t('reports.fx.col.share', {}, 'Share'))}</th></tr></thead>
        <tbody>
          ${data.map((d, i) => `<tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(d.label)}</td>
            <td class="t-right">${formatCurrency(d.value, cur)} ${cur}</td>
            <td class="t-right">${total > 0 ? ((d.value / total) * 100).toFixed(1) : '0.0'}%</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function drawCustomReportList(tx, cur) {
  const sorted = tx.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const limit = 100;
  const shown = sorted.slice(0, limit);
  const more = sorted.length - shown.length;
  document.getElementById('cr-run-list').innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${escapeHtml(t('crb.tx_table.title', { n: sorted.length }, `Transactions (${sorted.length})`))}${more > 0 ? escapeHtml(t('crb.tx_table.truncated', { n: limit }, ` — showing first ${limit}`)) : ''}</div>
      <table class="tx-table">
        <thead><tr><th>${escapeHtml(t('common.col.date', {}, 'Date'))}</th><th>${escapeHtml(t('common.col.type', {}, 'Type'))}</th><th>${escapeHtml(t('common.col.account', {}, 'Account'))}</th><th>${escapeHtml(t('common.col.payee', {}, 'Payee'))}</th><th>${escapeHtml(t('common.col.category', {}, 'Category'))}</th><th class="t-right">${escapeHtml(t('common.col.amount', {}, 'Amount'))}</th><th>${escapeHtml(t('settings.tab.tags', {}, 'Tags'))}</th></tr></thead>
        <tbody>
          ${shown.map(t => `<tr>
            <td>${escapeHtml(t.date || '')}</td>
            <td>${escapeHtml(t.type || '')}</td>
            <td>${escapeHtml(t.account || '')}</td>
            <td>${escapeHtml(t.payee || '')}</td>
            <td>${escapeHtml(t.category || '')}</td>
            <td style="text-align:right;color:${t.type === 'income' ? 'var(--positive)' : t.type === 'expense' ? 'var(--negative)' : 'var(--text)'};">${formatCurrency(t.amount, cur)} ${cur}</td>
            <td>${escapeHtml(t.tags || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

