// ─── Settings: Finance Sub-Tabs (Currency, FX, Budgets, Goals) ───────────
//
// Extracted from forms.js (Code-Review HIGH 1, forms.js God-Module split,
// step 2a/3: Finance settings island ~465 LOC). External dependencies stay
// in core.js / i18n.js: t, escapeHtml, fxRates, fxDate, fxSource, state,
// loadAccounts, loadCategories, applyI18n. All functions remain on the
// global scope so onclick="..." string handlers in the rendered HTML
// keep working unchanged.

// ─── Settings: Default Currency ──────────────────────────────────────────

function renderCurrencyTab() {
  const container = document.getElementById('settings-tab-content');
  const saved = localStorage.getItem('lp-default-currency') || 'TZS';
  const currencies = knownCurrencies(); // DP-M7
  container.innerHTML = `
    <div class="section">
      <div class="section-title">${t('settings.currency.title', {}, 'Default Display Currency')}</div>
      <p class="hint-md mb-16">${t('settings.currency.hint', {}, 'This currency is used on page load. You can still switch temporarily via the header toggle.')}</p>
      <div class="flex-row gap-sm">
        <select id="set-default-cur" style="padding:10px 16px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);">
          ${currencies.map(c => `<option value="${c}" ${c === saved ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <button class="btn-save" onclick="saveDefaultCurrency()">${t('common.actions.save', {}, 'Save')}</button>
      </div>
      <div id="set-cur-status" class="mt-12"></div>
    </div>
  `;
}

function saveDefaultCurrency() {
  const cur = document.getElementById('set-default-cur').value;
  localStorage.setItem('lp-default-currency', cur);
  displayCurrency = cur;
  document.querySelectorAll('.currency-switcher button').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === cur);
  });
  updateFxInfo();
  document.getElementById('set-cur-status').innerHTML = `<div class="atx-status success">${escapeHtml(t('settings.currency.saved', { currency: cur }, `Saved. Dashboard will use ${cur} on next load.`))}</div>`;
}

// ─── Settings: FX Rates ─────────────────────────────────────────────────

function renderFxRatesTab() {
  const container = document.getElementById('settings-tab-content');
  const mainCurrencies = ['EUR', 'USD', 'PLN', 'TRY'];
  const overridePhNone = t('settings.fxrates.override_placeholder_none', {}, 'n/a');
  const rows = mainCurrencies.map(c => {
    const rate = fxRates[c] || '';
    return `<tr>
      <td><strong>${c}</strong></td>
      <td style="font-variant-numeric:tabular-nums;">${rate ? formatCurrency(rate, 'TZS') : '—'}</td>
      <td><input type="text" id="fx-override-${c}" placeholder="${rate || overridePhNone}" style="width:120px;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);"></td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="section">
      <div class="section-title">${t('settings.fxrates.title', {}, 'Exchange Rates')} <span class="hint">${t('settings.fxrates.subtitle', {}, '(TZS per 1 unit)')}</span></div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px;">${t('settings.fxrates.source_line', { source: fxSource, date: fxDate }, `Source: ${fxSource} · Updated: ${fxDate}`)}</p>
      <table class="tx-table">
        <thead><tr><th>${t('common.col.currency', {}, 'Currency')}</th><th class="amt">${t('settings.fxrates.col_rate', {}, 'Current Rate')}</th><th>${t('settings.fxrates.col_override', {}, 'Override')}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn-save" onclick="applyFxOverrides()">${t('settings.fxrates.apply', {}, 'Apply Overrides')}</button>
        <button onclick="resetFxRates()">${t('settings.fxrates.reset', {}, 'Reset to Live')}</button>
      </div>
      <div id="fx-status" class="mt-12"></div>
    </div>

    <div class="section mt-24">
      <div class="section-title">${t('settings.fxbackfill.title', {}, 'Backfill historical rates')}</div>
      <p class="hint-md mb-16" style="line-height:1.5;">
        ${t('settings.fxbackfill.hint', {}, 'Fill gaps in <code>data/fx_rates_history.csv</code> from Bank of Tanzania (EUR/USD) and Frankfurter (PLN/TRY via EUR cross-rate). Existing rows are never overwritten. Leave both fields empty to fetch only new dates since the last entry.')}
      </p>
      <div class="atx-row" style="align-items:flex-end;gap:12px;flex-wrap:wrap;">
        <div class="atx-field" style="min-width:160px;">
          <label>${t('settings.fxbackfill.since', {}, 'Since (optional)')}</label>
          <input type="date" id="fx-bf-since" placeholder="auto">
        </div>
        <div class="atx-field" style="min-width:160px;">
          <label>${t('settings.fxbackfill.until', {}, 'Until (optional)')}</label>
          <input type="date" id="fx-bf-until" placeholder="today">
        </div>
        <button class="btn-save" id="fx-bf-run" onclick="runFxBackfill()">${t('settings.fxbackfill.run', {}, 'Run backfill')}</button>
      </div>
      <div id="fx-bf-status" class="mt-12"></div>
    </div>
  `;

  // If a backfill job is still running from a previous tab visit (or from
  // an earlier session), resume polling so the user sees its result.
  _fxBackfillResumeIfActive();
}

// Background-job pattern: kick off via POST → localStorage stores the
// job_id so navigating away/back resumes polling → poll every 3s until
// status flips to done/error. The user can leave the Settings page
// (or even close the browser) and the backend keeps running; coming
// back to Settings → Currency picks up the same job and shows its result.
const _FX_JOB_KEY = 'lp-fx-backfill-job-id';
let _fxPollTimer = null;

async function runFxBackfill() {
  const sinceEl = document.getElementById('fx-bf-since');
  const untilEl = document.getElementById('fx-bf-until');
  const body = {};
  if (sinceEl.value) body.since = sinceEl.value;
  if (untilEl.value) body.until = untilEl.value;

  _fxBackfillSetRunningUI();

  try {
    const res = await fetch('/api/fx/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    if (data.status === 'done') {
      // Trivial range — backend short-circuited and returned the summary
      // synchronously without spawning a job. Render directly.
      _fxBackfillRenderResult(data);
      return;
    }
    if (data.job_id) {
      try { localStorage.setItem(_FX_JOB_KEY, data.job_id); } catch { /* ignore */ }
      _fxBackfillStartPolling(data.job_id);
    }
  } catch (e) {
    _fxBackfillRenderError(String(e.message || e));
  }
}

function _fxBackfillSetRunningUI() {
  const statusEl = document.getElementById('fx-bf-status');
  const btn = document.getElementById('fx-bf-run');
  if (btn) btn.disabled = true;
  if (statusEl) {
    statusEl.innerHTML = `<div class="atx-status">${escapeHtml(t('settings.fxbackfill.running', {}, 'Fetching… you can leave this page; the dashboard will pick up where it left off when you come back.'))}</div>`;
  }
}

function _fxBackfillStartPolling(jobId) {
  if (_fxPollTimer) clearInterval(_fxPollTimer);
  const tick = async () => {
    try {
      const res = await fetch('/api/fx/backfill/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });
      const data = await res.json();
      if (res.status === 404) {
        // Server restarted between kick-off and poll → job is gone.
        try { localStorage.removeItem(_FX_JOB_KEY); } catch { /* ignore */ }
        _fxBackfillStopPolling();
        _fxBackfillRenderError(t('settings.fxbackfill.lost', {}, 'Job lost (server restarted). Re-run the backfill.'));
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (data.status === 'running') return;
      _fxBackfillStopPolling();
      try { localStorage.removeItem(_FX_JOB_KEY); } catch { /* ignore */ }
      if (data.status === 'error') {
        _fxBackfillRenderError(data.error || 'unknown error');
      } else {
        _fxBackfillRenderResult(data);
      }
    } catch (e) {
      // Transient network error — keep polling, the next tick may succeed.
      console.warn('fx backfill poll failed:', e);
    }
  };
  tick();
  _fxPollTimer = setInterval(tick, 3000);
}

function _fxBackfillStopPolling() {
  if (_fxPollTimer) {
    clearInterval(_fxPollTimer);
    _fxPollTimer = null;
  }
  const btn = document.getElementById('fx-bf-run');
  if (btn) btn.disabled = false;
}

function _fxBackfillRenderResult(data) {
  const statusEl = document.getElementById('fx-bf-status');
  const btn = document.getElementById('fx-bf-run');
  if (btn) btn.disabled = false;
  if (!statusEl) return;
  const summary = t(
    'settings.fxbackfill.done',
    data,
    `Done. ${data.since} → ${data.until}: +${data.new_dates} new, ${data.updated_dates} filled, ${data.total} total rows.`,
  );
  let html = `<div class="atx-status success">${escapeHtml(summary)}</div>`;
  if (data.frankfurter_warning) {
    html += `<div class="atx-status warning" style="margin-top:8px;font-size:11px;">Frankfurter: ${escapeHtml(data.frankfurter_warning)} — PLN/TRY cells skipped.</div>`;
  }
  statusEl.innerHTML = html;
}

function _fxBackfillRenderError(msg) {
  const statusEl = document.getElementById('fx-bf-status');
  const btn = document.getElementById('fx-bf-run');
  if (btn) btn.disabled = false;
  if (statusEl) {
    statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.fxbackfill.error', { error: msg }, `Backfill failed: ${msg}`))}</div>`;
  }
}

// Resume polling on tab open if there's an active job from a previous
// page-load. Called from renderFxRatesTab right after the tab DOM is
// in place.
function _fxBackfillResumeIfActive() {
  let jobId = null;
  try { jobId = localStorage.getItem(_FX_JOB_KEY); } catch { /* ignore */ }
  if (!jobId) return;
  _fxBackfillSetRunningUI();
  _fxBackfillStartPolling(jobId);
}

async function applyFxOverrides() {
  const mainCurrencies = ['EUR', 'USD', 'PLN', 'TRY'];
  let applied = 0;
  for (const c of mainCurrencies) {
    const input = document.getElementById('fx-override-' + c);
    if (input && input.value.trim()) {
      const val = parseFloat(input.value.trim());
      if (!isNaN(val) && val > 0) {
        fxRates[c] = val;
        applied++;
      }
    }
  }
  if (applied > 0) {
    fxSource = 'manual-override';
    updateFxInfo();
    document.getElementById('fx-status').innerHTML = `<div class="atx-status success">${applied} rate(s) overridden. Dashboard recalculated.</div>`;
    // H-14 (Sprint 13) — boot() resets settingsTab to 'categories' on
    // its way through navigateTo('settings'), which would yank the user
    // off the FX Rates sub-tab they just acted on. Save → boot → restore
    // → re-render, same pattern the accounts-edit save uses.
    const wasTab = (typeof settingsTab !== 'undefined') ? settingsTab : 'currency';
    await refreshData();
    settingsTab = wasTab;
    renderSettingsPage();
  } else {
    document.getElementById('fx-status').innerHTML = '<div class="atx-status warning">No valid overrides entered.</div>';
  }
}

async function resetFxRates() {
  await loadFxRates();
  updateFxInfo();
  document.getElementById('fx-status').innerHTML = '<div class="atx-status success">Rates reset to ' + fxSource + '.</div>';
  renderFxRatesTab();
  // H-14 — same boot+restore pattern as applyFxOverrides above.
  const wasTab = (typeof settingsTab !== 'undefined') ? settingsTab : 'currency';
  await refreshData();
  settingsTab = wasTab;
  renderSettingsPage();
}

// ─── Settings: Budgets ──────────────────────────────────────────────────

async function renderBudgetsTab() {
  const container = document.getElementById('settings-tab-content');
  const enabled = localStorage.getItem('lp-budgets-enabled') === 'true';

  if (!enabled) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px 0;">
        <h3 class="mb-8">${t('settings.budgets.disabled_title', {}, 'Budget Tracking')}</h3>
        <p class="c-mut fs-12 mb-16">${t('settings.budgets.disabled_desc_html', {}, 'Track monthly spending limits per category.<br>Disabled by default — enable to start using it.')}</p>
        <button id="budgets-enable-btn" style="padding:8px 24px;background:var(--accent);color:var(--bg);font-size:13px;">${t('settings.budgets.enable', {}, 'Enable Budgets')}</button>
      </div>
    `;
    container.querySelector('#budgets-enable-btn').addEventListener('click', () => {
      localStorage.setItem('lp-budgets-enabled', 'true');
      renderBudgetsTab();
    });
    return;
  }

  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.budgets.loading', {}, 'Loading budgets...'))}</div>`;

  let budgets = [];
  try {
    const res = await fetch('/api/budgets/list', { method: 'POST' });
    budgets = (await res.json()).budgets || [];
  } catch { /* empty */ }

  // Rename map var `t` to `tx` to avoid shadowing the global t() i18n function.
  const allCats = [...new Set(state.tx.map(tx => tx.category).filter(Boolean))].sort();
  const topCats = [...new Set(allCats.map(c => c.split(':')[0]))].sort();
  // Combine top-level and full categories for dropdown
  const catOptions = [...new Set([...topCats, ...allCats])].sort();

  const labelEdit = t('common.actions.edit', {}, 'Edit');
  const labelDelete = t('common.actions.delete', {}, 'Delete');

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 class="m-0">${t('settings.budgets.title', {}, 'Budgets')}</h3>
      <div style="display:flex;gap:8px;">
        <button id="budget-add-btn" style="padding:6px 16px;">${t('settings.budgets.add', {}, '+ Add Budget')}</button>
        <button id="budgets-disable-btn" style="padding:6px 12px;font-size:11px;color:var(--muted);">${t('settings.budgets.disable', {}, 'Disable')}</button>
      </div>
    </div>
    <div id="budgets-status"></div>
    ${budgets.length === 0 ? `<div class="empty-state"><div class="empty-state-icon">&#x1F4CA;</div><div class="empty-state-title">${t('settings.budgets.empty_title', {}, 'No budgets yet')}</div><div class="empty-state-desc">${t('settings.budgets.empty_desc', {}, 'Set monthly spending limits per category to track your budget.')}</div></div>` : `
    <table class="tx-table">
      <thead><tr><th>${t('common.col.category', {}, 'Category')}</th><th class="amt">${t('settings.budgets.col_budget', {}, 'Budget')}</th><th>${t('common.col.currency', {}, 'Currency')}</th><th>${t('settings.budgets.col_period', {}, 'Period')}</th><th>${t('settings.budgets.col_actions', {}, 'Actions')}</th></tr></thead>
      <tbody>
        ${budgets.map(b => `<tr>
          <td><strong>${escapeHtml(b.category)}</strong></td>
          <td class="amt">${formatCurrency(b.amount, b.currency)}</td>
          <td>${b.currency}</td>
          <td class="fs-12">${b.period}</td>
          <td>
            <button class="tx-edit-btn budget-edit-btn" data-budget-id="${escapeHtml(b.id)}">${labelEdit}</button>
            <button class="tx-edit-btn btn-delete-sm budget-del-btn" data-budget-id="${escapeHtml(b.id)}">${labelDelete}</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`}
  `;

  // Disable toggle
  container.querySelector('#budgets-disable-btn').addEventListener('click', async () => {
    if (await uiConfirm(t('settings.budgets.confirm_disable', {}, 'Disable budget tracking? Your budgets will be preserved.'))) {
      localStorage.setItem('lp-budgets-enabled', 'false');
      renderBudgetsTab();
    }
  });

  // Add budget
  container.querySelector('#budget-add-btn').addEventListener('click', () => {
    showBudgetModal(null, catOptions);
  });

  // Edit / Delete
  container.querySelectorAll('.budget-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const b = budgets.find(x => x.id === btn.getAttribute('data-budget-id'));
      if (b) showBudgetModal(b, catOptions);
    });
  });
  container.querySelectorAll('.budget-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const bid = btn.getAttribute('data-budget-id');
      if (!(await uiConfirm(t('settings.budgets.confirm_delete', {}, 'Delete this budget?'), { type: 'destructive' }))) return;
      try {
        await fetch('/api/budgets/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: bid }),
        });
        const res = await fetch('/api/budgets/list', { method: 'POST' });
        state.budgets = (await res.json()).budgets || [];
        renderBudgetsTab();
      } catch (e) {
        container.querySelector('#budgets-status').innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.budgets.delete_failed', { msg: e.message }, `Delete failed: ${e.message}`))}</div>`;
      }
    });
  });
}

function showBudgetModal(budget, catOptions) {
  const isEdit = !!budget;
  const currencies = knownCurrencies(); // DP-M7

  const { overlay } = openModal({
    title: isEdit ? t('settings.budgets.modal.title_edit', {}, 'Edit <span class="accent">Budget</span>') : t('settings.budgets.modal.title_add', {}, 'Add <span class="accent">Budget</span>'),
    maxWidth: '400px',
    bodyHtml: `
      <div style="display:grid;gap:12px;margin-top:16px;">
        <div>
          <label class="fs-12">${t('settings.budgets.modal.label_category', {}, 'Category (prefix match)')}</label>
          <input type="text" id="budget-category" list="budget-cat-list" value="${escapeHtml(budget?.category || '')}" class="input-std">
          <datalist id="budget-cat-list">${catOptions.map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
        </div>
        <div class="grid-2col">
          <div>
            <label class="fs-12">${t('settings.budgets.modal.label_monthly_limit', {}, 'Monthly Limit')}</label>
            <input type="text" inputmode="numeric" id="budget-amount" value="${budget?.amount || ''}" class="input-std">
          </div>
          <div>
            <label class="fs-12">${t('common.col.currency', {}, 'Currency')}</label>
            <select id="budget-currency" class="input-std">
              ${currencies.map(c => `<option value="${c}" ${budget?.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
      <div id="budget-modal-status"></div>
      <div class="form-actions">
        <button data-modal-cancel>${t('common.actions.cancel', {}, 'Cancel')}</button>
        <button id="budget-save-btn" style="background:var(--accent);color:var(--bg);">${t('common.actions.save', {}, 'Save')}</button>
      </div>`,
  });

  overlay.querySelector('#budget-save-btn').addEventListener('click', async () => {
    const category = overlay.querySelector('#budget-category').value.trim();
    const amount = parseAmountInput(overlay.querySelector('#budget-amount').value) || 0;
    const currency = overlay.querySelector('#budget-currency').value;
    const statusEl = overlay.querySelector('#budget-modal-status');

    if (!category) { statusEl.innerHTML = `<div class="atx-status error">${t('settings.budgets.modal.err_category_required', {}, 'Category is required')}</div>`; return; }
    if (amount <= 0) { statusEl.innerHTML = `<div class="atx-status error">${t('settings.budgets.modal.err_amount_positive', {}, 'Amount must be > 0')}</div>`; return; }

    statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

    try {
      const endpoint = isEdit ? '/api/budgets/update' : '/api/budgets/add';
      const body = isEdit
        ? { id: budget.id, updated: { category, amount, currency, period: 'monthly' } }
        : { category, amount, currency, period: 'monthly' };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(data.error)}</div>`; return; }

      const budgetsRes = await fetch('/api/budgets/list', { method: 'POST' });
      state.budgets = (await budgetsRes.json()).budgets || [];

      overlay._close();
      renderBudgetsTab();
    } catch (e) {
      statusEl.innerHTML = `<div class="atx-status error">${t('common.save_failed', { msg: escapeHtml(e.message) }, `Save failed: ${escapeHtml(e.message)}`)}</div>`;
    }
  });

}

// ─── Settings: Savings Goals ────────────────────────────────────────────

async function renderGoalsTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.goals.loading', {}, 'Loading goals...'))}</div>`;

  let goals = [];
  try {
    const res = await fetch('/api/goals/list', { method: 'POST' });
    const data = await res.json();
    goals = data.goals || [];
  } catch { /* empty */ }

  const accounts = state.accounts.filter(a => a.status === 'active' && a.owner === 'self');
  const currencies = [...new Set(accounts.map(a => a.currency))];

  const labelEdit = t('common.actions.edit', {}, 'Edit');
  const labelDelete = t('common.actions.delete', {}, 'Delete');

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 class="m-0">${t('settings.goals.title', {}, 'Savings Goals')}</h3>
      <button id="goal-add-btn" style="padding:6px 16px;">${t('settings.goals.add', {}, '+ Add Goal')}</button>
    </div>
    <div id="goals-status"></div>
    ${goals.length === 0 ? `<div class="empty-state"><div class="empty-state-icon">&#x1F3AF;</div><div class="empty-state-title">${t('settings.goals.empty_title', {}, 'No savings goals yet')}</div><div class="empty-state-desc">${t('settings.goals.empty_desc', {}, 'Define a target amount and track your progress toward it.')}</div></div>` : `
    <table class="tx-table">
      <thead><tr><th>${t('common.col.name', {}, 'Name')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('settings.goals.col_target', {}, 'Target')}</th><th>${t('settings.goals.col_current', {}, 'Current')}</th><th>${t('settings.goals.col_progress', {}, 'Progress')}</th><th>${t('settings.goals.col_deadline', {}, 'Deadline')}</th><th>${t('settings.goals.col_actions', {}, 'Actions')}</th></tr></thead>
      <tbody>
        ${goals.map(g => {
          const bal = state.balances[g.account] || 0;
          const pct = g.target > 0 ? Math.min((bal / g.target) * 100, 100) : 0;
          const color = pct >= 75 ? 'var(--positive)' : pct >= 25 ? 'var(--warn)' : 'var(--negative)';
          return `<tr>
            <td><strong>${escapeHtml(g.name)}</strong></td>
            <td>${escapeHtml(g.account)}</td>
            <td class="amt">${formatCurrency(g.target, g.currency)} ${g.currency}</td>
            <td class="amt">${formatCurrency(bal, g.currency)} ${g.currency}</td>
            <td>
              <div class="goal-bar-bg" style="width:120px;display:inline-block;vertical-align:middle;">
                <div class="goal-bar-fill" style="width:${pct.toFixed(1)}%;background:${color};"></div>
              </div>
              <span style="font-size:11px;color:${color};margin-left:4px;">${pct.toFixed(0)}%</span>
            </td>
            <td class="fs-12">${g.deadline || '—'}</td>
            <td>
              <button class="tx-edit-btn goal-edit-btn" data-goal-id="${escapeHtml(g.id)}">${labelEdit}</button>
              <button class="tx-edit-btn btn-delete-sm goal-del-btn" data-goal-id="${escapeHtml(g.id)}">${labelDelete}</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`}
  `;

  // Add goal button
  container.querySelector('#goal-add-btn').addEventListener('click', () => {
    showGoalModal(null, accounts, currencies);
  });

  // Edit / Delete handlers
  container.querySelectorAll('.goal-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = goals.find(x => x.id === btn.getAttribute('data-goal-id'));
      if (g) showGoalModal(g, accounts, currencies);
    });
  });
  container.querySelectorAll('.goal-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const gid = btn.getAttribute('data-goal-id');
      if (!(await uiConfirm(t('settings.goals.confirm_delete', {}, 'Delete this goal?'), { type: 'destructive' }))) return;
      try {
        await fetch('/api/goals/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: gid }),
        });
        // Reload goals in state
        const res = await fetch('/api/goals/list', { method: 'POST' });
        state.savingsGoals = (await res.json()).goals || [];
        renderGoalsTab();
      } catch (e) {
        container.querySelector('#goals-status').innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.goals.delete_failed', { msg: e.message }, `Delete failed: ${e.message}`))}</div>`;
      }
    });
  });
}

function showGoalModal(goal, accounts, currencies) {
  const isEdit = !!goal;

  const { overlay } = openModal({
    title: isEdit ? t('settings.goals.modal.title_edit', {}, 'Edit <span class="accent">Goal</span>') : t('settings.goals.modal.title_add', {}, 'Add <span class="accent">Goal</span>'),
    maxWidth: '420px',
    bodyHtml: `
      <div style="display:grid;gap:12px;margin-top:16px;">
        <div>
          <label class="fs-12">${t('common.col.name', {}, 'Name')}</label>
          <input type="text" id="goal-name" value="${escapeHtml(goal?.name || '')}" class="input-std">
        </div>
        <div class="grid-2col">
          <div>
            <label class="fs-12">${t('common.col.account', {}, 'Account')}</label>
            <select id="goal-account" class="input-std">
              ${accounts.map(a => `<option value="${escapeHtml(a.alias)}" ${goal?.account === a.alias ? 'selected' : ''}>${escapeHtml(a.alias)} (${escapeHtml(a.currency)})</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="fs-12">${t('common.col.currency', {}, 'Currency')}</label>
            <select id="goal-currency" class="input-std">
              ${currencies.map(c => `<option value="${c}" ${goal?.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid-2col">
          <div>
            <label class="fs-12">${t('settings.goals.modal.label_target_amount', {}, 'Target Amount')}</label>
            <input type="text" inputmode="numeric" id="goal-target" value="${goal?.target || ''}" class="input-std">
          </div>
          <div>
            <label class="fs-12">${t('common.label.deadline_optional', {}, 'Deadline (optional)')}</label>
            <input type="date" id="goal-deadline" value="${goal?.deadline || ''}" class="input-std">
          </div>
        </div>
      </div>
      <div id="goal-modal-status"></div>
      <div class="form-actions">
        <button data-modal-cancel>${t('common.actions.cancel', {}, 'Cancel')}</button>
        <button id="goal-save-btn" style="background:var(--accent);color:var(--bg);">${t('common.actions.save', {}, 'Save')}</button>
      </div>`,
  });

  // Auto-sync currency when account changes
  overlay.querySelector('#goal-account').addEventListener('change', (e) => {
    const acc = accounts.find(a => a.alias === e.target.value);
    if (acc) overlay.querySelector('#goal-currency').value = acc.currency;
  });

  overlay.querySelector('#goal-save-btn').addEventListener('click', async () => {
    const name = overlay.querySelector('#goal-name').value.trim();
    const account = overlay.querySelector('#goal-account').value;
    const currency = overlay.querySelector('#goal-currency').value;
    const target = parseAmountInput(overlay.querySelector('#goal-target').value) || 0;
    const deadline = overlay.querySelector('#goal-deadline').value;
    const statusEl = overlay.querySelector('#goal-modal-status');

    if (!name) { statusEl.innerHTML = `<div class="atx-status error">${t('settings.goals.modal.err_name_required', {}, 'Name is required')}</div>`; return; }
    if (target <= 0) { statusEl.innerHTML = `<div class="atx-status error">${t('settings.goals.modal.err_target_positive', {}, 'Target must be > 0')}</div>`; return; }

    statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

    try {
      const endpoint = isEdit ? '/api/goals/update' : '/api/goals/add';
      const body = isEdit
        ? { id: goal.id, updated: { name, account, currency, target, deadline } }
        : { name, account, currency, target, deadline };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(data.error)}</div>`; return; }

      // Reload goals in state
      const goalsRes = await fetch('/api/goals/list', { method: 'POST' });
      state.savingsGoals = (await goalsRes.json()).goals || [];

      overlay._close();
      renderGoalsTab();
    } catch (e) {
      statusEl.innerHTML = `<div class="atx-status error">${t('common.save_failed', { msg: escapeHtml(e.message) }, `Save failed: ${escapeHtml(e.message)}`)}</div>`;
    }
  });

}

// ─── Settings: Backup & Export ──────────────────────────────────────────

