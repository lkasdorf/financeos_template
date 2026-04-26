// ─── Settings: Default Currency ──────────────────────────────────────────

function renderCurrencyTab() {
  const container = document.getElementById('settings-tab-content');
  const saved = localStorage.getItem('lp-default-currency') || 'TZS';
  const currencies = ['TZS', 'EUR', 'USD', 'PLN'];
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
  `;
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
    boot(); // re-render dashboard
  } else {
    document.getElementById('fx-status').innerHTML = '<div class="atx-status warning">No valid overrides entered.</div>';
  }
}

async function resetFxRates() {
  await loadFxRates();
  updateFxInfo();
  document.getElementById('fx-status').innerHTML = '<div class="atx-status success">Rates reset to ' + fxSource + '.</div>';
  renderFxRatesTab();
  boot();
}

// ─── Settings: Budgets ──────────────────────────────────────────────────

async function renderBudgetsTab() {
  const container = document.getElementById('settings-tab-content');
  const enabled = localStorage.getItem('lp-budgets-enabled') === 'true';

  if (!enabled) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px 0;">
        <h3 style="margin-bottom:8px;">${t('settings.budgets.disabled_title', {}, 'Budget Tracking')}</h3>
        <p class="c-mut fs-12" style="margin-bottom:16px;">${t('settings.budgets.disabled_desc_html', {}, 'Track monthly spending limits per category.<br>Disabled by default — enable to start using it.')}</p>
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
      <h3 style="margin:0;">${t('settings.budgets.title', {}, 'Budgets')}</h3>
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
  container.querySelector('#budgets-disable-btn').addEventListener('click', () => {
    if (confirm(t('settings.budgets.confirm_disable', {}, 'Disable budget tracking? Your budgets will be preserved.'))) {
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
      if (!confirm(t('settings.budgets.confirm_delete', {}, 'Delete this budget?'))) return;
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
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const currencies = ['TZS', 'EUR', 'USD', 'PLN'];

  overlay.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <h3>${isEdit ? t('settings.budgets.modal.title_edit', {}, 'Edit <span class="accent">Budget</span>') : t('settings.budgets.modal.title_add', {}, 'Add <span class="accent">Budget</span>')}</h3>
      <div style="display:grid;gap:12px;margin-top:16px;">
        <div>
          <label class="fs-12">${t('settings.budgets.modal.label_category', {}, 'Category (prefix match)')}</label>
          <input type="text" id="budget-category" list="budget-cat-list" value="${escapeHtml(budget?.category || '')}" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
          <datalist id="budget-cat-list">${catOptions.map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label class="fs-12">${t('settings.budgets.modal.label_monthly_limit', {}, 'Monthly Limit')}</label>
            <input type="text" inputmode="numeric" id="budget-amount" value="${budget?.amount || ''}" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
          </div>
          <div>
            <label class="fs-12">${t('common.col.currency', {}, 'Currency')}</label>
            <select id="budget-currency" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
              ${currencies.map(c => `<option value="${c}" ${budget?.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
      <div id="budget-modal-status"></div>
      <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;">
        <button onclick="this.closest('.modal-overlay').remove()">${t('common.actions.cancel', {}, 'Cancel')}</button>
        <button id="budget-save-btn" style="background:var(--accent);color:var(--bg);">${t('common.actions.save', {}, 'Save')}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

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

      overlay.remove();
      renderBudgetsTab();
    } catch (e) {
      statusEl.innerHTML = `<div class="atx-status error">${t('common.save_failed', { msg: escapeHtml(e.message) }, `Save failed: ${escapeHtml(e.message)}`)}</div>`;
    }
  });

  const handler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler); } };
  document.addEventListener('keydown', handler);
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
      <h3 style="margin:0;">${t('settings.goals.title', {}, 'Savings Goals')}</h3>
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
          const color = pct >= 75 ? 'var(--positive)' : pct >= 25 ? 'var(--warn, #f59e0b)' : 'var(--negative)';
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
      if (!confirm(t('settings.goals.confirm_delete', {}, 'Delete this goal?'))) return;
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
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.innerHTML = `
    <div class="modal" style="max-width:420px;">
      <h3>${isEdit ? t('settings.goals.modal.title_edit', {}, 'Edit <span class="accent">Goal</span>') : t('settings.goals.modal.title_add', {}, 'Add <span class="accent">Goal</span>')}</h3>
      <div style="display:grid;gap:12px;margin-top:16px;">
        <div>
          <label class="fs-12">${t('common.col.name', {}, 'Name')}</label>
          <input type="text" id="goal-name" value="${escapeHtml(goal?.name || '')}" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label class="fs-12">${t('common.col.account', {}, 'Account')}</label>
            <select id="goal-account" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
              ${accounts.map(a => `<option value="${a.alias}" ${goal?.account === a.alias ? 'selected' : ''}>${a.alias} (${a.currency})</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="fs-12">${t('common.col.currency', {}, 'Currency')}</label>
            <select id="goal-currency" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
              ${currencies.map(c => `<option value="${c}" ${goal?.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label class="fs-12">${t('settings.goals.modal.label_target_amount', {}, 'Target Amount')}</label>
            <input type="text" inputmode="numeric" id="goal-target" value="${goal?.target || ''}" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
          </div>
          <div>
            <label class="fs-12">${t('common.label.deadline_optional', {}, 'Deadline (optional)')}</label>
            <input type="date" id="goal-deadline" value="${goal?.deadline || ''}" style="width:100%;padding:7px 12px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);">
          </div>
        </div>
      </div>
      <div id="goal-modal-status"></div>
      <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;">
        <button onclick="this.closest('.modal-overlay').remove()">${t('common.actions.cancel', {}, 'Cancel')}</button>
        <button id="goal-save-btn" style="background:var(--accent);color:var(--bg);">${t('common.actions.save', {}, 'Save')}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

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

      overlay.remove();
      renderGoalsTab();
    } catch (e) {
      statusEl.innerHTML = `<div class="atx-status error">${t('common.save_failed', { msg: escapeHtml(e.message) }, `Save failed: ${escapeHtml(e.message)}`)}</div>`;
    }
  });

  const handler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler); } };
  document.addEventListener('keydown', handler);
}

// ─── Settings: Backup & Export ──────────────────────────────────────────

function renderBackupTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `
    <div class="section">
      <div class="section-title">${t('settings.backup.title', {}, 'Backup & Export')}</div>
      <p class="hint-md mb-16">${t('settings.backup.hint_html', {}, 'Backups are stored in <code>data/backups/</code>. Max 30 per file, older ones auto-pruned.')}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-save" onclick="triggerBackup('transactions')">${t('settings.backup.btn_transactions', {}, 'Backup Transactions')}</button>
        <button class="btn-save" onclick="triggerBackup('scheduled')">${t('settings.backup.btn_scheduled', {}, 'Backup Scheduled')}</button>
        <button class="btn-save" onclick="triggerBackup('third_party')">${t('settings.backup.btn_debts', {}, 'Backup Debts')}</button>
        <button onclick="triggerBackup('all')">${t('settings.backup.btn_all', {}, 'Backup All')}</button>
      </div>
      <div class="section-title" style="margin-top:24px;">${t('settings.backup.full_title', {}, 'Download full backup')}</div>
      <p class="hint-md mb-16">${t('settings.backup.full_hint_html', {}, 'Bundle the entire <code>data/</code> directory (excluding rolling backups) into a single ZIP for off-device storage or migration to another machine.')}</p>
      <div>
        <button class="btn-save" onclick="downloadFullBackup()">${t('settings.backup.btn_download_zip', {}, 'Download full backup (.zip)')}</button>
      </div>
      <div id="backup-status" class="mt-16"></div>
      <div id="backup-list" style="margin-top:24px;"></div>
    </div>
  `;
  loadBackupList();
}

async function downloadFullBackup() {
  const statusEl = document.getElementById('backup-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${escapeHtml(t('settings.backup.zip_building', {}, 'Building ZIP archive...'))}</div>`;
  try {
    const res = await fetch('/api/backup/export', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    // Prefer the server-supplied filename from Content-Disposition; fall back to timestamp.
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `financeos-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    const sizeKb = blob.size / 1024;
    const sizeStr = sizeKb < 1024 ? `${sizeKb.toFixed(1)} KB` : `${(sizeKb / 1024).toFixed(1)} MB`;
    statusEl.innerHTML = `<div class="atx-status success">${escapeHtml(t('settings.backup.zip_done', { filename, size: sizeStr }, `Downloaded ${filename} (${sizeStr})`))}</div>`;
  } catch (e) {
    statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.backup.zip_failed', { msg: e.message }, `ZIP export failed: ${e.message}`))}</div>`;
  }
}

async function triggerBackup(target) {
  const statusEl = document.getElementById('backup-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${escapeHtml(t('settings.backup.creating', {}, 'Creating backup...'))}</div>`;
  try {
    const targets = target === 'all' ? ['transactions', 'scheduled', 'third_party'] : [target];
    const results = [];
    // Inner loop var renamed to `target_` to avoid shadowing the global t() i18n function.
    for (const target_ of targets) {
      const res = await fetch('/api/backup/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: target_ }) });
      const data = await res.json();
      results.push(data.message || data.error || target_);
    }
    statusEl.innerHTML = `<div class="atx-status success">${results.join('<br>')}</div>`;
    loadBackupList();
  } catch (e) {
    statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.backup.failed', { msg: e.message }, `Backup failed: ${e.message}`))}</div>`;
  }
}

async function loadBackupList() {
  const listEl = document.getElementById('backup-list');
  try {
    const res = await fetch('/api/backup/list', { method: 'POST' });
    const data = await res.json();
    const backups = data.backups || [];
    if (backups.length === 0) {
      listEl.innerHTML = `<p class="hint-md">${escapeHtml(t('settings.backup.empty', {}, 'No backups found.'))}</p>`;
      return;
    }
    listEl.innerHTML = `
      <div class="section-title">${t('settings.backup.list_title', { n: backups.length }, `Recent Backups (${backups.length})`)}</div>
      <table class="tx-table">
        <thead><tr><th>${t('settings.backup.col_file', {}, 'File')}</th><th>${t('settings.backup.col_size', {}, 'Size')}</th><th>${t('settings.backup.col_date', {}, 'Date')}</th></tr></thead>
        <tbody>${backups.slice(0, 20).map(b => `<tr>
          <td class="fs-11">${escapeHtml(b.name)}</td>
          <td class="label-sm">${b.size}</td>
          <td class="label-sm">${b.date}</td>
        </tr>`).join('')}</tbody>
      </table>
    `;
  } catch (e) {
    listEl.innerHTML = `<p style="color:var(--negative);font-size:12px;">${escapeHtml(t('settings.backup.load_failed', {}, 'Could not load backup list.'))}</p>`;
  }
}

// ─── Settings: Accounts Management ──────────────────────────────────────

async function renderAccountsSettingsTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.accounts.loading', {}, 'Loading accounts...'))}</div>`;

  let accounts = [];
  try {
    const res = await fetch('/api/tx/context', { method: 'POST' });
    const data = await res.json();
    accounts = data.accounts || [];
  } catch (e) {
    container.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.accounts.load_failed', {}, 'Failed to load accounts'))}</div>`;
    return;
  }

  const activeItems = accounts.filter(a => a.status === 'active');
  const archivedItems = accounts.filter(a => a.status === 'archived');
  const groups = [
    { label: t('settings.accounts.group_active_count', { n: activeItems.length }, `Active (${activeItems.length})`), items: activeItems },
    { label: t('settings.accounts.group_archived_count', { n: archivedItems.length }, `Archived (${archivedItems.length})`), items: archivedItems },
  ];

  const editLabel = t('common.actions.edit', {}, 'Edit');
  let html = '';
  for (const g of groups) {
    if (!g.items.length) continue;
    const rows = g.items.map(a => `<tr>
      <td><strong>${escapeHtml(a.alias)}</strong></td>
      <td>${escapeHtml(a.name)}</td>
      <td>${a.currency}</td>
      <td>${a.type}</td>
      <td>${a.owner}</td>
      <td>${a.status}</td>
      <td>${a.initial_balance || 0}</td>
      <td>${a.initial_balance_date || ''}</td>
      <td><button class="tx-edit-btn" onclick="showAccountEditModal('${escapeHtml(a.alias)}')">${editLabel}</button></td>
    </tr>`).join('');
    html += `
      <div class="section" class="mb-20">
        <div class="section-title">${g.label}</div>
        <table class="tx-table">
          <thead><tr><th>${t('settings.accounts.col_alias', {}, 'Alias')}</th><th>${t('common.col.name', {}, 'Name')}</th><th>${t('common.col.currency', {}, 'Currency')}</th><th>${t('common.col.type', {}, 'Type')}</th><th>${t('settings.accounts.col_owner', {}, 'Owner')}</th><th>${t('settings.accounts.col_status', {}, 'Status')}</th><th>${t('settings.accounts.col_balance', {}, 'Balance')}</th><th>${t('settings.accounts.col_since', {}, 'Since')}</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }
  container.innerHTML = html;
}

async function showAccountEditModal(alias) {
  const acc = state.accounts.find(a => a.alias === alias);
  if (!acc) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${t('settings.accounts.modal.title', { alias: escapeHtml(alias) }, `Edit <span class="accent">${escapeHtml(alias)}</span>`)}</h3>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>${t('settings.accounts.modal.label_alias', {}, 'Alias')}</label>
          <input type="text" id="acc-edit-alias" value="${escapeHtml(alias)}">
        </div>
        <div class="atx-field" class="fx2"><label>${t('common.col.name', {}, 'Name')}</label>
          <input type="text" id="acc-edit-name" value="${escapeHtml(acc.name)}">
        </div>
        <div class="atx-field" class="fx1"><label>${t('common.label.status', {}, 'Status')}</label>
          <select id="acc-edit-status">
            <option value="active" ${acc.status === 'active' ? 'selected' : ''}>${t('common.status.active', {}, 'Active')}</option>
            <option value="archived" ${acc.status === 'archived' ? 'selected' : ''}>${t('settings.accounts.modal.opt_archived', {}, 'Archived')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>${t('settings.accounts.modal.label_initial_balance', {}, 'Initial Balance')}</label>
          <input type="text" id="acc-edit-balance" value="${acc.initial_balance || 0}">
        </div>
        <div class="atx-field" class="fx1"><label>${t('settings.accounts.modal.label_initial_balance_date', {}, 'Initial Balance Date')}</label>
          <input type="date" id="acc-edit-baldate" value="${acc.initial_balance_date || ''}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.accounts.modal.label_notes', {}, 'Notes')}</label>
          <input type="text" id="acc-edit-notes" value="${escapeHtml(acc.notes || '')}">
        </div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:8px;">${t('settings.accounts.modal.meta_html', { currency: escapeHtml(acc.currency), type: escapeHtml(acc.type), owner: escapeHtml(acc.owner) }, `Currency: ${acc.currency} · Type: ${acc.type} · Owner: ${acc.owner}`)}</div>
      <div id="acc-edit-status-msg"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button onclick="closeModal()">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" onclick="saveAccountEdit('${escapeHtml(alias)}')">${t('common.actions.save', {}, 'Save')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function saveAccountEdit(alias) {
  const newAlias = document.getElementById('acc-edit-alias').value.trim().toLowerCase();
  const updated = {
    name: document.getElementById('acc-edit-name').value.trim(),
    status: document.getElementById('acc-edit-status').value,
    initial_balance: parseAmountInputStr(document.getElementById('acc-edit-balance').value),
    initial_balance_date: document.getElementById('acc-edit-baldate').value,
    notes: document.getElementById('acc-edit-notes').value.trim(),
  };
  const statusEl = document.getElementById('acc-edit-status-msg');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;
  try {
    // Rename first if alias changed
    let currentAlias = alias;
    if (newAlias && newAlias !== alias) {
      const renameRes = await fetch('/api/accounts/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_alias: alias, new_alias: newAlias }),
      });
      const renameData = await renameRes.json();
      if (renameData.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(renameData.error)}</div>`; return; }
      currentAlias = newAlias;
    }
    // Then update other fields
    const res = await fetch('/api/accounts/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: currentAlias, updated }),
    });
    const data = await res.json();
    if (data.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(data.error)}</div>`; return; }
    closeModal();
    boot();
  } catch (e) {
    statusEl.innerHTML = `<div class="atx-status error">${t('common.save_failed', { msg: escapeHtml(e.message) }, `Save failed: ${escapeHtml(e.message)}`)}</div>`;
  }
}


// ─── Edit TX Modal ────────────────────────────────────────────────────────

function openEditModal(tx) {
  // Ensure context is loaded for dropdowns
  loadTxContext().then(ctx => renderEditModal(tx, ctx));
}

function renderEditModal(tx, ctx) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  const isTransfer = tx.type === 'transfer';
  const activeAccounts = ctx.accounts.filter(a => a.status === 'active');

  // Account options
  const accOptions = activeAccounts.map(a =>
    `<option value="${a.alias}" ${tx.account === a.alias ? 'selected' : ''}>${a.alias} — ${a.name}</option>`
  ).join('');

  // Transfer-to options
  const trOptions = activeAccounts.map(a =>
    `<option value="${a.alias}" ${tx.transfer_to_account === a.alias ? 'selected' : ''}>${a.alias} — ${a.name}</option>`
  ).join('');

  // Category options — rendered dynamically so type changes update the list.
  // Always include the currently saved category even if it doesn't match the
  // selected type (marked as mismatched). Prevents the dropdown showing
  // "Select..." for legitimate edge-case categories (e.g. Cash Discrepancy
  // booked as income against an expense-typed category).
  function buildCatOptions(forType, savedPath) {
    const wanted = forType === 'transfer' ? null : forType;
    const matching = ctx.categories.filter(c => c.active && (!wanted || c.type === wanted));
    const matchingPaths = new Set(matching.map(c => c.path));
    let html = matching.map(c =>
      `<option value="${c.path}" ${savedPath === c.path ? 'selected' : ''}>${c.path}</option>`
    ).join('');
    if (savedPath && !matchingPaths.has(savedPath)) {
      html = `<option value="${savedPath}" selected>${t('editx.type_mismatch', { path: savedPath }, `&#9888; ${savedPath} (type mismatch)`)}</option>` + html;
    }
    return html;
  }
  const catOptions = buildCatOptions(tx.type, tx.category);

  overlay.innerHTML = `
    <div class="modal">
      <h3>${t('editx.title', {}, 'Edit <span class="accent">Transaction</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field" class="fx1">
          <label>${t('common.label.date', {}, 'Date')}</label>
          <input type="date" id="edit-date" value="${tx.date}">
        </div>
        <div class="atx-field" class="fx1">
          <label>${t('common.col.type', {}, 'Type')}</label>
          <select id="edit-type">
            <option value="expense" ${tx.type === 'expense' ? 'selected' : ''}>${t('common.type.expense', {}, 'Expense')}</option>
            <option value="income" ${tx.type === 'income' ? 'selected' : ''}>${t('common.type.income', {}, 'Income')}</option>
            <option value="transfer" ${tx.type === 'transfer' ? 'selected' : ''}>${t('common.type.transfer', {}, 'Transfer')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1">
          <label>${t('common.col.account', {}, 'Account')}</label>
          <select id="edit-account">
            <option value="">${t('common.select_placeholder', {}, 'Select...')}</option>
            ${accOptions}
          </select>
        </div>
        <div class="atx-field" class="fx1">
          <label>${t('common.col.amount', {}, 'Amount')}</label>
          <input type="text" id="edit-amount" value="${tx.amount}">
        </div>
      </div>
      <div id="edit-payee-row" class="atx-row" style="display:${isTransfer ? 'none' : 'flex'}">
        <div class="atx-field" class="fx1">
          <label>${t('common.col.payee', {}, 'Payee')}</label>
          <input type="text" id="edit-payee" value="${escapeHtml(tx.payee || '')}">
        </div>
        <div class="atx-field" class="fx1">
          <label>${t('common.col.category', {}, 'Category')}</label>
          <select id="edit-category">
            <option value="">${t('common.select_placeholder', {}, 'Select...')}</option>
            ${catOptions}
          </select>
        </div>
      </div>
      <div id="edit-transfer-row" class="atx-row" style="display:${isTransfer ? 'flex' : 'none'}">
        <div class="atx-field" class="fx1">
          <label>${t('atx.m.label_transfer_to', {}, 'Transfer to')}</label>
          <select id="edit-transfer-to">
            <option value="">${t('common.select_placeholder', {}, 'Select...')}</option>
            ${trOptions}
          </select>
        </div>
        <div class="atx-field" class="fx1">
          <label>${t('editx.label_transfer_amount', {}, 'Transfer amount (cross-currency)')}</label>
          <input type="text" id="edit-transfer-amount" value="${tx.transfer_to_amount || ''}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1">
          <label>${t('common.label.note', {}, 'Note')}</label>
          <textarea id="edit-note" rows="2" style="resize:vertical;min-height:44px;">${escapeHtml(tx.note || '')}</textarea>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1">
          <label>${t('common.col.tags', {}, 'Tags')}</label>
          <div id="edit-tags" class="tag-picker">
            ${(ctx.tags || []).filter(tag => tag.active).map(tag =>
              `<label><input type="checkbox" value="${tag.tag}" ${(tx.tags || '').split(';').includes(tag.tag) ? 'checked' : ''}><span>${tag.tag}</span></label>`
            ).join('')}
          </div>
        </div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:4px;">
        ${t('editx.meta_html', { id: escapeHtml(tx.import_id), currency: escapeHtml(tx.currency) }, `Import ID: ${tx.import_id} &middot; Currency: ${tx.currency}`)}
      </div>
      <div id="edit-status"></div>
      <div class="modal-footer">
        <div class="btn-left">
          <button class="btn-delete" onclick="deleteTx('${tx.import_id}')">${t('common.actions.delete', {}, 'Delete')}</button>
        </div>
        <div class="btn-right">
          <button class="edit-duplicate-btn" data-import-id="${tx.import_id}">${t('common.actions.duplicate', {}, 'Duplicate')}</button>
          <button onclick="closeModal()">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" onclick="saveTxEdit('${tx.import_id}')">${t('common.actions.save', {}, 'Save')}</button>
        </div>
      </div>
    </div>
  `;

  // Type change handler
  document.body.appendChild(overlay);
  document.getElementById('edit-type').addEventListener('change', (e) => {
    const nextType = e.target.value;
    document.getElementById('edit-payee-row').style.display = nextType === 'transfer' ? 'none' : 'flex';
    document.getElementById('edit-transfer-row').style.display = nextType === 'transfer' ? 'flex' : 'none';
    const catSel = document.getElementById('edit-category');
    if (catSel) catSel.innerHTML = `<option value="">${t('common.select_placeholder', {}, 'Select...')}</option>` + buildCatOptions(nextType, catSel.value);
  });

  // Duplicate button: uses current form state (user-editable) rather than the
  // original tx, so mid-edit tweaks are kept in the duplicate too.
  const dupBtn = overlay.querySelector('.edit-duplicate-btn');
  if (dupBtn) dupBtn.addEventListener('click', () => {
    const current = {
      type: document.getElementById('edit-type').value,
      account: document.getElementById('edit-account').value,
      amount: parseAmountInputStr(document.getElementById('edit-amount').value),
      currency: tx.currency,
      payee: document.getElementById('edit-payee').value,
      category: document.getElementById('edit-category').value,
      note: document.getElementById('edit-note').value,
      tags: Array.from(document.querySelectorAll('#edit-tags input:checked')).map(c => c.value).join(';'),
      transfer_to_account: document.getElementById('edit-transfer-to').value,
      transfer_to_amount: parseAmountInputStr(document.getElementById('edit-transfer-amount').value),
    };
    duplicateTx(current);
  });

  // Close on Escape
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

function closeModal() {
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) {
    document.removeEventListener('keydown', overlay._escHandler);
    overlay.remove();
  }
}

async function saveTxEdit(importId) {
  const updated = {
    date: document.getElementById('edit-date').value,
    type: document.getElementById('edit-type').value,
    account: document.getElementById('edit-account').value,
    amount: parseAmountInputStr(document.getElementById('edit-amount').value),
    payee: document.getElementById('edit-payee').value,
    category: document.getElementById('edit-category').value,
    note: document.getElementById('edit-note').value,
    tags: Array.from(document.querySelectorAll('#edit-tags input:checked')).map(c => c.value).join(';'),
    transfer_to_account: document.getElementById('edit-transfer-to').value,
    transfer_to_amount: parseAmountInputStr(document.getElementById('edit-transfer-amount').value),
  };

  const statusEl = document.getElementById('edit-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

  try {
    const res = await fetch('/api/tx/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ import_id: importId, updated }),
    });
    const data = await res.json();
    if (data.error) {
      statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(data.error)}</div>`;
      return;
    }
    closeModal();
    // Reload data
    boot();
  } catch (e) {
    statusEl.innerHTML = `<div class="atx-status error">${t('common.save_failed', { msg: escapeHtml(e.message) }, `Save failed: ${escapeHtml(e.message)}`)}</div>`;
  }
}

function showBusyOverlay(message) {
  let overlay = document.getElementById('busy-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'busy-overlay';
    overlay.className = 'busy-overlay';
    overlay.innerHTML = `
      <div class="busy-box">
        <div class="busy-spinner"></div>
        <div class="busy-msg" id="busy-msg"></div>
      </div>`;
    document.body.appendChild(overlay);
  }
  document.getElementById('busy-msg').textContent = message || t('common.busy.working', {}, 'Working...');
  overlay.classList.add('show');
}

function hideBusyOverlay() {
  const overlay = document.getElementById('busy-overlay');
  if (overlay) overlay.classList.remove('show');
}

async function deleteTx(importId) {
  if (!confirm(t('editx.confirm_delete', {}, 'Delete this transaction? This cannot be undone.'))) return;

  // statusEl only exists when the edit modal is open; inline table delete has no modal
  const statusEl = document.getElementById('edit-status');
  if (statusEl) {
    statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('editx.status_deleting', {}, 'Deleting...')}</div>`;
  }
  showBusyOverlay(t('editx.busy_deleting', {}, 'Deleting transaction...'));

  try {
    const res = await fetch('/api/tx/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ import_id: importId }),
    });
    const data = await res.json();
    if (data.error) {
      hideBusyOverlay();
      if (statusEl) {
        statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(data.error)}</div>`;
      } else {
        alert(t('editx.err_delete', { msg: data.error }, `Delete failed: ${data.error}`));
      }
      return;
    }
    closeModal();
    await boot();
    hideBusyOverlay();
  } catch (e) {
    hideBusyOverlay();
    if (statusEl) {
      statusEl.innerHTML = `<div class="atx-status error">${t('editx.err_delete', { msg: escapeHtml(e.message) }, `Delete failed: ${escapeHtml(e.message)}`)}</div>`;
    } else {
      alert(t('editx.err_delete', { msg: e.message }, `Delete failed: ${e.message}`));
    }
  }
}

// ─── Add TX Page ──────────────────────────────────────────────────────────

// returnRoute: optional hash (e.g. '#account:crdb') to navigate back to after
// a successful booking. Set by navigateToAddTxWithAccount(), cleared by
// returnFromAddTx() and by any "fresh" entry to the Add-TX page (FAB, sidebar
// nav, keyboard "n").
let addTxState = { mode: 'freetext', preview: null, context: null, loading: false, prefillAccount: null, prefillTx: null, returnRoute: null };

async function loadTxContext() {
  if (addTxState.context) return addTxState.context;
  try {
    const res = await fetch('/api/tx/context', { method: 'POST' });
    addTxState.context = await res.json();
  } catch (e) {
    addTxState.context = { accounts: [], categories: [], tags: [], payees: [] };
  }
  return addTxState.context;
}

function navigateToAddTxWithAccount(alias) {
  addTxState.mode = 'manual';
  addTxState.preview = null;
  addTxState.prefillAccount = alias;
  addTxState.returnRoute = '#account:' + alias;
  history.pushState(null, '', '#add-tx');
  navigateTo('add-tx');
}

// Navigate back from the Add-TX page to the route stored in
// addTxState.returnRoute (set by navigateToAddTxWithAccount). Clears the
// return state so subsequent direct entries to Add-TX do not keep showing
// the back bar. Falls back to Dashboard if no return route is set.
function returnFromAddTx() {
  const route = addTxState.returnRoute || '#dashboard';
  addTxState.returnRoute = null;
  addTxState.prefillAccount = null;
  history.pushState(null, '', route);
  navigateTo(route.replace(/^#/, ''));
}

// Duplicate an existing TX: open the Add TX manual form pre-filled with the
// source TX's fields, but with date=today and no import_id (so it becomes a
// fresh transaction on save).
function duplicateTx(tx) {
  if (!tx) return;
  closeModal();
  const today = new Date().toISOString().slice(0, 10);
  addTxState.mode = 'manual';
  addTxState.preview = null;
  addTxState.prefillTx = {
    date: today,
    type: tx.type || 'expense',
    account: tx.account || '',
    amount: tx.amount != null ? String(tx.amount) : '',
    payee: tx.payee || '',
    category: tx.category || '',
    note: tx.note || '',
    tags: (tx.tags || '').split(';').filter(Boolean),
    transfer_to_account: tx.transfer_to_account || '',
    transfer_to_amount: tx.transfer_to_amount ? String(tx.transfer_to_amount) : '',
  };
  history.pushState(null, '', '#add-tx');
  navigateTo('add-tx');
}

async function renderAddTxPage() {
  const content = document.getElementById('add-tx-content');
  if (!content) return;
  const today = new Date().toISOString().slice(0, 10);

  // Load quick expenses for chips — skip entirely if the feature is disabled.
  let qeChipsHtml = '';
  if (isFeatureEnabled('quick_expenses')) {
    try {
      const qeRes = await fetch('/api/quickexp/list', { method: 'POST' });
      const qeData = await qeRes.json();
      const activeQe = (qeData.quick_expenses || []).filter(q => q.active === 'true');
      if (activeQe.length > 0) {
        qeChipsHtml = `
          <div class="qe-chips-label">${t('atx.qe_chips_label', {}, 'Quick Expenses')}</div>
          <div class="qe-chips">
            ${activeQe.map(q => `<button class="qe-chip" onclick="applyQuickExpense('${escapeHtml(q.id)}')" data-qe='${JSON.stringify(q).replace(/'/g, "&#39;")}'><span class="qe-icon"><svg><use href="#i-zap"/></svg></span>${escapeHtml(q.name)}</button>`).join('')}
          </div>
        `;
      }
    } catch (e) { /* silently skip if API not available */ }
  }

  // Back bar: only shown when the user arrived via a context-aware entry
  // point that stored a return route (e.g. the prominent + Add TX button
  // on an Account detail page). Returns to that route on click.
  const backBar = addTxState.returnRoute ? `
    <div class="atx-return-bar" style="margin-bottom:12px;">
      <button class="report-back" onclick="returnFromAddTx()" style="margin:0;">${t('add_tx.back', {}, '← Back')}</button>
    </div>
  ` : '';

  content.innerHTML = `
    ${backBar}
    <div class="atx-section">
      ${qeChipsHtml}
      <div class="atx-tabs">
        <button class="${addTxState.mode === 'freetext' ? 'active' : ''}" onclick="switchTxMode('freetext')">${t('atx.tab_freetext', {}, 'Free-text')}</button>
        <button class="${addTxState.mode === 'manual' ? 'active' : ''}" onclick="switchTxMode('manual')">${t('atx.tab_manual', {}, 'Manual')}</button>
      </div>

      <!-- Free-text mode -->
      <div id="atx-freetext" style="display:${addTxState.mode === 'freetext' ? 'block' : 'none'}">
        <div class="atx-row">
          <div class="atx-field" style="flex:4">
            <label>${t('atx.free.label_transaction', {}, 'Transaction')}</label>
            <input type="text" id="atx-raw-input" class="atx-freetext-input"
              placeholder="${t('atx.free.placeholder', {}, '45k Jumbo cash')}" autocomplete="off"
              onkeydown="if(event.key==='Enter')submitFreeText()">
          </div>
          <div class="atx-field" class="fx1">
            <label>${t('common.label.date', {}, 'Date')}</label>
            <input type="date" id="atx-freetext-date" value="${today}">
          </div>
        </div>
        <div class="atx-hint">${t('atx.free.examples_html', {}, 'Examples: <code>45k Jumbo cash</code> &middot; <code>transfer 500k crdb zu sav</code> &middot; <code>250k Tanesco kft</code>')}</div>
        <div class="atx-actions">
          <button onclick="submitFreeText()">${t('atx.free.btn_parse', {}, 'Parse &rarr;')}</button>
        </div>
      </div>

      <!-- Manual mode -->
      <div id="atx-manual" style="display:${addTxState.mode === 'manual' ? 'block' : 'none'}">
        <div class="atx-row">
          <div class="atx-field" class="fx1">
            <label>${t('common.label.date', {}, 'Date')}</label>
            <input type="date" id="atx-m-date" value="${today}">
          </div>
          <div class="atx-field" class="fx1">
            <label>${t('common.col.type', {}, 'Type')}</label>
            <div class="atx-type-btns" id="atx-type-btns">
              <button class="active" data-type="expense" onclick="setTxType('expense')">${t('common.type.expense', {}, 'Expense')}</button>
              <button data-type="income" onclick="setTxType('income')">${t('common.type.income', {}, 'Income')}</button>
              <button data-type="transfer" onclick="setTxType('transfer')">${t('common.type.transfer', {}, 'Transfer')}</button>
            </div>
          </div>
        </div>
        <div class="atx-row">
          <div class="atx-field" class="fx1">
            <label>${t('common.col.account', {}, 'Account')}</label>
            <select id="atx-m-account"><option value="">${t('common.loading', {}, 'Loading...')}</option></select>
          </div>
          <div class="atx-field" class="fx1">
            <label>${t('common.col.amount', {}, 'Amount')}</label>
            <input type="text" id="atx-m-amount" placeholder="${t('atx.m.placeholder_amount', {}, '45000')}">
          </div>
        </div>
        <div class="atx-row" id="atx-m-payee-row">
          <div class="atx-field" class="fx1">
            <label>${t('common.col.payee', {}, 'Payee')}</label>
            <div class="ac-wrapper">
              <input type="text" id="atx-m-payee" placeholder="${t('atx.m.placeholder_payee', {}, 'Jumbo')}" autocomplete="off">
              <div class="ac-list" id="atx-payee-ac"></div>
            </div>
          </div>
          <div class="atx-field" class="fx1">
            <label>${t('common.col.category', {}, 'Category')}</label>
            <select id="atx-m-category"><option value="">${t('common.loading', {}, 'Loading...')}</option></select>
          </div>
        </div>
        <div id="atx-splits-area"></div>
        <div class="atx-row" id="atx-m-payee-row-split-btn" style="margin-top:-8px;margin-bottom:8px;">
          <button onclick="addSplitLine()" style="font-size:11px;padding:5px 12px;">${t('atx.m.btn_add_split', {}, '+ Split')}</button>
          <span id="atx-split-info" style="font-size:11px;color:var(--muted);margin-left:8px;"></span>
        </div>
        <div class="atx-row" id="atx-m-transfer-row" style="display:none">
          <div class="atx-field" class="fx1">
            <label>${t('atx.m.label_transfer_to', {}, 'Transfer to')}</label>
            <select id="atx-m-transfer-to"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option></select>
          </div>
          <div class="atx-field" class="fx1">
            <label>${t('atx.m.label_transfer_amount', {}, 'Transfer amount (if cross-currency)')}</label>
            <input type="text" id="atx-m-transfer-amount" placeholder="${t('atx.m.placeholder_optional', {}, 'Optional')}">
          </div>
        </div>
        <div class="atx-row">
          <div class="atx-field" class="fx1">
            <label>${t('common.label.note', {}, 'Note')}</label>
            <textarea id="atx-m-note" rows="2" placeholder="${t('atx.m.placeholder_optional', {}, 'Optional')}" style="resize:vertical;min-height:44px;"></textarea>
          </div>
        </div>
        <div class="atx-row">
          <div class="atx-field" class="fx1">
            <label>${t('common.col.tags', {}, 'Tags')}</label>
            <div id="atx-m-tags" class="tag-picker"></div>
          </div>
        </div>
        <div class="atx-actions">
          <button onclick="submitManual()">${t('atx.m.btn_preview', {}, 'Preview &rarr;')}</button>
        </div>
      </div>

      <!-- Preview + Status area -->
      <div id="atx-preview-area"></div>
      <div id="atx-status-area"></div>
    </div>
  `;

  // Load context for dropdowns
  loadTxContext().then(ctx => populateTxDropdowns(ctx));
}

function switchTxMode(mode) {
  addTxState.mode = mode;
  addTxState.preview = null;
  renderAddTxPage();
}

function applyQuickExpense(qeId) {
  // Find the chip element and parse its data
  const chip = document.querySelector(`.qe-chip[onclick*="'${qeId}'"]`);
  if (!chip) return;
  const qe = JSON.parse(chip.getAttribute('data-qe'));

  // Switch to manual mode and pre-fill
  addTxState.mode = 'manual';
  addTxState.preview = null;
  renderAddTxPage().then(() => {
    // Wait for dropdowns to load, then fill
    setTimeout(() => {
      const accSel = document.getElementById('atx-m-account');
      const payeeInput = document.getElementById('atx-m-payee');
      const catSel = document.getElementById('atx-m-category');
      const amountInput = document.getElementById('atx-m-amount');

      // Set type (default: expense)
      const qeType = qe.type || 'expense';
      setTxType(qeType);

      const noteInput = document.getElementById('atx-m-note');
      if (noteInput && qe.note) noteInput.value = qe.note;
      if (accSel && qe.account) accSel.value = qe.account;
      if (payeeInput && qe.payee) payeeInput.value = qe.payee;
      if (catSel && qe.category) {
        filterCategories(qeType);
        catSel.value = qe.category;
      }
      // Focus amount field since that's the only thing to fill
      if (amountInput) amountInput.focus();

      // Apply tags if any
      if (qe.tags) {
        const tagNames = qe.tags.split(';');
        tagNames.forEach(tag => {
          const cb = document.querySelector(`#atx-m-tags input[value="${tag}"]`);
          if (cb) cb.checked = true;
        });
      }
    }, 300);
  });
}

function setTxType(type) {
  document.querySelectorAll('#atx-type-btns button').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-type') === type);
  });
  const payeeRow = document.getElementById('atx-m-payee-row');
  const transferRow = document.getElementById('atx-m-transfer-row');
  if (type === 'transfer') {
    payeeRow.style.display = 'none';
    transferRow.style.display = 'flex';
  } else {
    payeeRow.style.display = 'flex';
    transferRow.style.display = 'none';
  }
  // Filter category dropdown by type
  filterCategories(type);
}

function populateTxDropdowns(ctx) {
  if (!ctx) return;
  const accSel = document.getElementById('atx-m-account');
  const catSel = document.getElementById('atx-m-category');
  const trSel = document.getElementById('atx-m-transfer-to');
  if (!accSel) return;

  // Accounts: group by type, only active
  const activeAccounts = ctx.accounts.filter(a => a.status === 'active');
  const groups = {};
  activeAccounts.forEach(a => {
    const g = a.type;
    if (!groups[g]) groups[g] = [];
    groups[g].push(a);
  });

  accSel.innerHTML = `<option value="">${t('atx.dropdown.select_account', {}, 'Select account...')}</option>`;
  for (const [type, accs] of Object.entries(groups).sort()) {
    const og = document.createElement('optgroup');
    og.label = type;
    accs.forEach(a => {
      const o = document.createElement('option');
      o.value = a.alias;
      o.textContent = `${a.alias} — ${a.name}`;
      og.appendChild(o);
    });
    accSel.appendChild(og);
  }

  // Transfer-to dropdown (same accounts)
  if (trSel) {
    trSel.innerHTML = `<option value="">${t('atx.dropdown.select_target', {}, 'Select target...')}</option>`;
    activeAccounts.forEach(a => {
      const o = document.createElement('option');
      o.value = a.alias;
      o.textContent = `${a.alias} — ${a.name}`;
      trSel.appendChild(o);
    });
  }

  // Categories
  if (catSel) {
    catSel.innerHTML = `<option value="">${t('atx.dropdown.select_category', {}, 'Select category...')}</option>`;
    ctx.categories.filter(c => c.active).forEach(c => {
      const o = document.createElement('option');
      o.value = c.path;
      o.textContent = c.path;
      o.setAttribute('data-type', c.type);
      catSel.appendChild(o);
    });
    filterCategories('expense');
  }

  // Tags
  const tagPicker = document.getElementById('atx-m-tags');
  if (tagPicker && ctx.tags) {
    tagPicker.innerHTML = ctx.tags.filter(t => t.active).map(t =>
      `<label><input type="checkbox" value="${t.tag}"><span>${t.tag}</span></label>`
    ).join('');
  }

  // Payee autocomplete
  setupPayeeAutocomplete(ctx);

  // Prefill account if set (from Account Detail → Add TX)
  if (addTxState.prefillAccount) {
    accSel.value = addTxState.prefillAccount;
    addTxState.prefillAccount = null;
  }

  // Prefill full TX fields when duplicating an existing transaction
  if (addTxState.prefillTx) {
    const p = addTxState.prefillTx;
    addTxState.prefillTx = null;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el != null && v != null) el.value = v; };
    // Switch type pill/select first so the right field rows are visible
    setVal('atx-m-type', p.type);
    const typeSel = document.getElementById('atx-m-type');
    if (typeSel) typeSel.dispatchEvent(new Event('change'));
    setVal('atx-m-date', p.date);
    setVal('atx-m-account', p.account);
    setVal('atx-m-amount', p.amount);
    setVal('atx-m-payee', p.payee);
    setVal('atx-m-category', p.category);
    setVal('atx-m-note', p.note);
    setVal('atx-m-transfer-to', p.transfer_to_account);
    setVal('atx-m-transfer-amount', p.transfer_to_amount);
    // Restore tag checkboxes
    const tagBoxes = document.querySelectorAll('#atx-m-tags input[type="checkbox"]');
    tagBoxes.forEach(cb => { cb.checked = p.tags.includes(cb.value); });
  }
}

function filterCategories(txType) {
  const catSel = document.getElementById('atx-m-category');
  if (!catSel) return;
  const catType = txType === 'transfer' ? null : txType;
  Array.from(catSel.options).forEach(o => {
    if (!o.value) return; // keep placeholder
    const oType = o.getAttribute('data-type');
    o.style.display = (!catType || oType === catType) ? '' : 'none';
  });
}

function setupPayeeAutocomplete(ctx) {
  const input = document.getElementById('atx-m-payee');
  const list = document.getElementById('atx-payee-ac');
  if (!input || !list || !ctx.payees) return;

  const payees = ctx.payees;
  let selIdx = -1;

  function filter(q) {
    if (!q) { list.classList.remove('open'); return; }
    const lq = q.toLowerCase();
    const matches = payees.filter(p =>
      p.payee.toLowerCase().includes(lq) ||
      (p.aliases || []).some(a => a.toLowerCase().includes(lq))
    ).slice(0, 10);
    if (!matches.length) { list.classList.remove('open'); return; }
    selIdx = -1;
    list.innerHTML = matches.map((p, i) =>
      `<div class="ac-item" data-idx="${i}" data-payee="${escapeHtml(p.payee)}" data-cat="${escapeHtml(p.default_category)}" data-acc="${escapeHtml(p.default_account)}">
        <span>${escapeHtml(p.payee)}</span>
        <span class="ac-meta">${escapeHtml(p.default_category || '')}</span>
      </div>`
    ).join('');
    list.classList.add('open');
  }

  function pick(item) {
    input.value = item.dataset.payee;
    list.classList.remove('open');
    // Auto-fill category
    const cat = item.dataset.cat;
    if (cat) {
      const catSel = document.getElementById('atx-m-category');
      if (catSel) { catSel.value = cat; }
    }
    // Auto-fill account
    const acc = item.dataset.acc;
    if (acc) {
      const accSel = document.getElementById('atx-m-account');
      if (accSel) { accSel.value = acc; }
    }
  }

  input.addEventListener('input', () => filter(input.value));
  input.addEventListener('focus', () => { if (input.value) filter(input.value); });

  input.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('.ac-item');
    if (!items.length || !list.classList.contains('open')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(selIdx + 1, items.length - 1); items.forEach((it, i) => it.classList.toggle('selected', i === selIdx)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); items.forEach((it, i) => it.classList.toggle('selected', i === selIdx)); }
    else if (e.key === 'Enter' && selIdx >= 0) { e.preventDefault(); pick(items[selIdx]); }
    else if (e.key === 'Escape') { list.classList.remove('open'); }
  });

  list.addEventListener('click', (e) => {
    const item = e.target.closest('.ac-item');
    if (item) pick(item);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.ac-wrapper')) list.classList.remove('open');
  });
}

function showTxStatus(type, msg) {
  const area = document.getElementById('atx-status-area');
  if (area) area.innerHTML = `<div class="atx-status ${type}">${msg}</div>`;
}

function showTxLoading(msg) {
  const area = document.getElementById('atx-status-area');
  if (area) area.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${msg}</div>`;
}

async function submitFreeText() {
  const input = document.getElementById('atx-raw-input');
  const dateInput = document.getElementById('atx-freetext-date');
  if (!input || !input.value.trim()) return;

  showTxLoading(t('txflow.free.parsing', {}, 'Parsing with Claude API...'));
  document.getElementById('atx-preview-area').innerHTML = '';

  try {
    const res = await fetch('/api/tx/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_input: input.value.trim(), date: dateInput.value }),
    });
    const data = await res.json();

    if (data.error) {
      if (data.code === 'NO_API_KEY') {
        const switchLink = `<a href="#" onclick="switchTxMode('manual');return false;">${t('txflow.free.switch_manual', {}, 'Switch to manual mode')}</a>`;
        showTxStatus('warning', escapeHtml(data.error) + ' ' + switchLink);
      } else {
        showTxStatus('error', escapeHtml(data.error));
      }
      return;
    }

    addTxState.preview = data;
    renderTxPreview(data);
    document.getElementById('atx-status-area').innerHTML = '';
  } catch (e) {
    showTxStatus('error', t('txflow.request_failed', { msg: escapeHtml(e.message) }, `Request failed: ${escapeHtml(e.message)}`));
  }
}

// ─── Split Lines ──────────────────────────────────────────────────────────
let splitLines = [];

function addSplitLine() {
  // On first split, move main amount+category into split 0
  if (splitLines.length === 0) {
    const mainAmt = document.getElementById('atx-m-amount')?.value || '';
    const mainCat = document.getElementById('atx-m-category')?.value || '';
    splitLines.push({ amount: mainAmt, category: mainCat });
    // Clear main amount (total will be calculated)
    document.getElementById('atx-m-amount').value = '';
    document.getElementById('atx-m-amount').setAttribute('readonly', 'true');
    document.getElementById('atx-m-amount').style.opacity = '0.5';
    document.getElementById('atx-m-amount').placeholder = t('atx.split.auto_sum', {}, 'Auto (sum of splits)');
    // Hide main category
    document.getElementById('atx-m-category').style.display = 'none';
  }
  splitLines.push({ amount: '', category: '' });
  renderSplitLines();
}

function removeSplitLine(idx) {
  splitLines.splice(idx, 1);
  if (splitLines.length <= 1) {
    // Revert to single mode
    const remaining = splitLines[0] || {};
    splitLines = [];
    document.getElementById('atx-m-amount').value = remaining.amount || '';
    document.getElementById('atx-m-amount').removeAttribute('readonly');
    document.getElementById('atx-m-amount').style.opacity = '';
    document.getElementById('atx-m-amount').placeholder = t('atx.m.placeholder_amount', {}, '45000');
    document.getElementById('atx-m-category').style.display = '';
    document.getElementById('atx-m-category').value = remaining.category || '';
    document.getElementById('atx-splits-area').innerHTML = '';
    updateSplitInfo();
    return;
  }
  renderSplitLines();
}

function renderSplitLines() {
  const area = document.getElementById('atx-splits-area');
  const catSel = document.getElementById('atx-m-category');
  // Clone category options
  const catOptionsHtml = catSel ? catSel.innerHTML : '';

  let html = '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin:8px 0;">';
  html += `<div style="font-size:11px;font-weight:500;margin-bottom:8px;">${t('atx.split.heading', {}, 'Split Lines')}</div>`;
  const amountLabel = t('common.col.amount', {}, 'Amount');
  const removeTitle = t('atx.split.remove_title', {}, 'Remove');
  splitLines.forEach((s, i) => {
    html += `<div class="atx-row" style="margin-bottom:6px;align-items:center;">
      <div class="atx-field" class="fx1"><input type="text" placeholder="${amountLabel}" value="${escapeHtml(s.amount)}" onchange="splitLines[${i}].amount=this.value;updateSplitInfo()"></div>
      <div class="atx-field" class="fx2"><select onchange="splitLines[${i}].category=this.value">${catOptionsHtml}</select></div>
      <button onclick="removeSplitLine(${i})" style="padding:4px 8px;font-size:11px;color:var(--negative);background:none;border:none;cursor:pointer;" title="${removeTitle}">&times;</button>
    </div>`;
  });
  html += `<button onclick="addSplitLine()" style="font-size:11px;padding:4px 10px;margin-top:4px;">${t('atx.split.btn_add_line', {}, '+ Add line')}</button>`;
  html += '</div>';
  area.innerHTML = html;

  // Set selected categories
  const selects = area.querySelectorAll('select');
  splitLines.forEach((s, i) => {
    if (selects[i] && s.category) selects[i].value = s.category;
  });

  updateSplitInfo();
}

function updateSplitInfo() {
  const info = document.getElementById('atx-split-info');
  if (!info) return;
  if (splitLines.length < 2) { info.textContent = ''; return; }
  const total = splitLines.reduce((s, l) => s + (parseAmountInput(l.amount) || 0), 0);
  const totalStr = formatCurrency(total, 'TZS');
  info.textContent = splitLines.length === 1
    ? t('atx.split.info_one', { amount: totalStr }, `1 line, total: ${totalStr}`)
    : t('atx.split.info_many', { n: splitLines.length, amount: totalStr }, `${splitLines.length} lines, total: ${totalStr}`);
  // Update the read-only amount field
  const amtField = document.getElementById('atx-m-amount');
  if (amtField && amtField.hasAttribute('readonly')) {
    amtField.value = total || '';
  }
}

async function submitManual() {
  const type = document.querySelector('#atx-type-btns button.active')?.getAttribute('data-type') || 'expense';
  const formData = {
    date: document.getElementById('atx-m-date')?.value,
    account: document.getElementById('atx-m-account')?.value,
    type: type,
    amount: parseAmountInputStr(document.getElementById('atx-m-amount')?.value),
    payee: type !== 'transfer' ? (document.getElementById('atx-m-payee')?.value || '') : '',
    category: type !== 'transfer' ? (document.getElementById('atx-m-category')?.value || '') : '',
    note: document.getElementById('atx-m-note')?.value || '',
    tags: Array.from(document.querySelectorAll('#atx-m-tags input:checked')).map(c => c.value).join(';'),
    transfer_to_account: type === 'transfer' ? (document.getElementById('atx-m-transfer-to')?.value || '') : '',
    transfer_to_amount: type === 'transfer' ? parseAmountInputStr(document.getElementById('atx-m-transfer-amount')?.value) : '',
  };

  // Attach splits if active
  if (splitLines.length >= 2) {
    formData.splits = splitLines.map(s => ({ amount: s.amount, category: s.category }));
    formData.splits = formData.splits.map(s => ({ amount: parseAmountInputStr(s.amount), category: s.category }));
    formData.amount = splitLines.reduce((sum, s) => sum + (parseAmountInput(s.amount) || 0), 0).toString();
  }

  if (!formData.account) { showTxStatus('error', t('txflow.manual.err_no_account', {}, 'Please select an account')); return; }
  if (!formData.amount || formData.amount === '0') { showTxStatus('error', t('txflow.manual.err_no_amount', {}, 'Please enter an amount')); return; }

  showTxLoading(t('txflow.manual.building_preview', {}, 'Building preview...'));
  document.getElementById('atx-preview-area').innerHTML = '';

  try {
    const res = await fetch('/api/tx/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    const data = await res.json();

    if (data.error) {
      showTxStatus('error', escapeHtml(data.error));
      // Still show lines if available (for validation errors)
      if (data.lines) {
        addTxState.preview = data;
        renderTxPreview(data);
      }
      return;
    }

    addTxState.preview = data;
    renderTxPreview(data);
    document.getElementById('atx-status-area').innerHTML = '';
  } catch (e) {
    showTxStatus('error', t('txflow.request_failed', { msg: escapeHtml(e.message) }, `Request failed: ${escapeHtml(e.message)}`));
  }
}

function renderTxPreview(data) {
  const area = document.getElementById('atx-preview-area');
  if (!area || !data.lines || !data.lines.length) return;

  const fmt = (amount, currency) => formatCurrency(parseFloat(amount), currency) + ' ' + currency;

  let html = `<div class="atx-preview"><h3>${t('txflow.preview.heading', {}, 'Preview')}</h3>`;
  const autoBadge = t('txflow.preview.auto_badge', {}, 'auto');

  data.lines.forEach((line, i) => {
    const isAuto = line.is_auto_generated;
    const typeClass = line.type || 'expense';
    const prefix = line.type === 'expense' ? '-' : line.type === 'income' ? '+' : '';

    html += `
      <div class="atx-preview-line ${isAuto ? 'auto' : ''}">
        <div class="atx-line-num">#${i + 1}</div>
        <div class="atx-line-detail">
          <div class="atx-line-primary">
            ${fmtDate(line.date)} &middot; <strong>${escapeHtml(line.account)}</strong> &middot; ${escapeHtml(line.type)}
            ${isAuto ? `<span class="atx-auto-badge">${autoBadge}</span>` : ''}
          </div>
          <div class="atx-line-secondary">
            ${line.payee ? escapeHtml(line.payee) + ' &rarr; ' : ''}${escapeHtml(line.category || '')}
            ${line.transfer_to_account ? '&rarr; ' + escapeHtml(line.transfer_to_account) : ''}
          </div>
          ${line.note ? `<div class="atx-line-secondary">${escapeHtml(line.note)}</div>` : ''}
          ${line.tags ? `<div class="atx-line-tags">${escapeHtml(line.tags)}</div>` : ''}
        </div>
        <div class="atx-line-amount ${typeClass}">${prefix}${fmt(line.amount, line.currency)}</div>
      </div>
    `;
  });

  // Ambiguities
  if (data.ambiguities && data.ambiguities.length) {
    html += `<div class="atx-ambiguities"><strong>${t('txflow.preview.ambiguities_heading', {}, 'Ambiguities:')}</strong><ul>`;
    data.ambiguities.forEach(a => { html += `<li>${escapeHtml(a)}</li>`; });
    html += '</ul></div>';
  }

  // Confidence badge
  if (data.confidence && data.confidence !== 'high') {
    html += `<div class="atx-ambiguities" style="margin-top:8px">${t('txflow.preview.confidence_html', { level: escapeHtml(data.confidence) }, `Confidence: <strong>${escapeHtml(data.confidence)}</strong>`)}</div>`;
  }

  html += `
    <div class="atx-confirm-actions">
      <button class="btn-confirm" onclick="confirmTx()">${t('txflow.preview.confirm_book', {}, 'Confirm &amp; Book')}</button>
      <button onclick="cancelTxPreview()">${t('common.actions.cancel', {}, 'Cancel')}</button>
    </div>
  </div>`;

  area.innerHTML = html;
}

function cancelTxPreview() {
  addTxState.preview = null;
  document.getElementById('atx-preview-area').innerHTML = '';
  document.getElementById('atx-status-area').innerHTML = '';
}

// Check for potential duplicate transactions
function findDuplicateTx(lines) {
  const dupes = [];
  for (const line of lines) {
    if (line.type === 'transfer') continue; // transfers rarely duplicate
    const matches = state.tx.filter(t => {
      if (t.type !== line.type) return false;
      if ((t.payee || '').toLowerCase() !== (line.payee || '').toLowerCase()) return false;
      if (Math.abs(t.amount - (parseAmountInput(line.amount) || 0)) > 0.01) return false;
      // Date within ±1 day
      if (!t.date || !line.date) return false;
      const d1 = new Date(t.date), d2 = new Date(line.date);
      return Math.abs(d1 - d2) <= 86400000; // 1 day in ms
    });
    if (matches.length > 0) {
      dupes.push({ line, existing: matches[0] });
    }
  }
  return dupes;
}

async function confirmTx() {
  if (!addTxState.preview || !addTxState.preview.lines) return;

  // Duplicate check
  const dupes = findDuplicateTx(addTxState.preview.lines);
  if (dupes.length > 0) {
    const details = dupes.map(d => {
      const amountStr = formatCurrency(parseFloat(d.line.amount), d.line.currency);
      // Plain-text (confirm dialog), so decode the &bull; HTML entity to •
      return t('txflow.confirm.dup_line',
        { payee: d.line.payee, amount: amountStr, currency: d.line.currency, date: d.existing.date },
        `• ${d.line.payee} ${amountStr} ${d.line.currency} — existing on ${d.existing.date}`
      ).replace(/&bull;/g, '•');
    }).join('\n');
    const title = t('txflow.confirm.dup_title', {}, 'Possible duplicate(s) found:');
    const ask = t('txflow.confirm.dup_ask', {}, 'Book anyway?');
    if (!confirm(`${title}\n\n${details}\n\n${ask}`)) return;
  }

  showTxLoading(t('txflow.confirm.booking', {}, 'Booking...'));

  try {
    const res = await fetch('/api/tx/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lines: addTxState.preview.lines,
        raw_input: addTxState.preview.raw_input || '(manual)',
      }),
    });
    const data = await res.json();

    if (data.error) {
      showTxStatus('error', escapeHtml(data.error));
      return;
    }

    const ids = data.import_ids.join(', ');
    let msg = t('txflow.confirm.booked', { message: escapeHtml(data.message), ids: escapeHtml(ids) }, `Booked ${data.message}. Import IDs: ${ids}`);
    if (!data.git_committed) msg += t('txflow.confirm.git_failed', {}, ' (git commit failed)');
    showTxStatus('success', msg);

    addTxState.preview = null;
    document.getElementById('atx-preview-area').innerHTML = '';

    // Clear inputs
    const rawInput = document.getElementById('atx-raw-input');
    if (rawInput) rawInput.value = '';
    const amountInput = document.getElementById('atx-m-amount');
    if (amountInput) amountInput.value = '';
    const payeeInput = document.getElementById('atx-m-payee');
    if (payeeInput) payeeInput.value = '';
    const noteInput = document.getElementById('atx-m-note');
    if (noteInput) noteInput.value = '';
    document.querySelectorAll('#atx-m-tags input:checked').forEach(c => c.checked = false);

    // Reset splits
    splitLines = [];
    const splitsArea = document.getElementById('atx-splits-area');
    if (splitsArea) splitsArea.innerHTML = '';
    if (amountInput) { amountInput.removeAttribute('readonly'); amountInput.style.opacity = ''; amountInput.placeholder = t('atx.m.placeholder_amount', {}, '45000'); }
    const mainCat = document.getElementById('atx-m-category');
    if (mainCat) mainCat.style.display = '';
    updateSplitInfo();

    // Reload data so dashboard is fresh; if we have a return route (user
    // came from an Account detail page), navigate back there after boot()
    // has refreshed state so the destination renders with the new TX.
    setTimeout(async () => {
      await boot();
      if (addTxState.returnRoute) {
        const route = addTxState.returnRoute;
        addTxState.returnRoute = null;
        addTxState.prefillAccount = null;
        history.pushState(null, '', route);
        navigateTo(route.replace(/^#/, ''));
      }
    }, 500);
  } catch (e) {
    showTxStatus('error', t('txflow.confirm.err_booking', { msg: escapeHtml(e.message) }, `Booking failed: ${escapeHtml(e.message)}`));
  }
}


// ─── Payees Page ──────────────────────────────────────────────────────────

async function renderPayeesPage() {
  const content = document.getElementById('settings-tab-content') || document.getElementById('payees-content');
  const meta = document.getElementById('payees-meta');
  if (!content) return;
  content.innerHTML = `<div class="loading">${escapeHtml(t('settings.payees.loading', {}, 'Loading payees...'))}</div>`;

  let payees = [];
  try {
    const res = await fetch('/api/payees/list', { method: 'POST' });
    const data = await res.json();
    payees = data.payees || [];
  } catch (e) {
    content.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.payees.load_failed', {}, 'Failed to load payees'))}</div>`;
    return;
  }

  if (meta) meta.textContent = t('settings.payees.count', { n: payees.length }, `${payees.length} payees registered`);

  // Group by group field. The internal key for the catch-all stays the
  // literal 'Other' so grouping logic (isOther check, rename/delete gating)
  // remains stable regardless of locale; only the heading text is i18n'd.
  const groupOtherKey = 'Other';
  const groupOtherLabel = t('payees.group_other', {}, 'Other');
  const groups = {};
  payees.forEach(p => {
    const g = p.group || groupOtherKey;
    if (!groups[g]) groups[g] = [];
    groups[g].push(p);
  });

  const labelEdit = t('common.actions.edit', {}, 'Edit');
  const labelDelete = t('common.actions.delete', {}, 'Delete');
  const labelRename = t('common.actions.rename', {}, 'Rename');

  let html = `
    <div class="flex-row gap-md mb-20">
      <input type="text" id="payee-search" placeholder="${t('settings.payees.search_placeholder', {}, 'Search payees...')}" style="flex:1;padding:10px 14px;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:inherit;font-size:13px;border-radius:2px;">
      <button class="btn-save" onclick="showPayeeModal()" style="padding:10px 20px;">${t('settings.payees.add', {}, '+ Add Payee')}</button>
      <button onclick="addPayeeGroup()" style="padding:10px 20px;">${t('settings.payees.add_group', {}, '+ Add Group')}</button>
    </div>
  `;

  for (const [group, items] of Object.entries(groups)) {
    const isOther = group === groupOtherKey;
    const displayGroup = isOther ? groupOtherLabel : group;
    html += `<div class="section" class="mb-24">
      <div class="section-title">${escapeHtml(displayGroup)} <span style="color:var(--muted);font-weight:400;font-size:11px;">(${items.length})</span>
        ${!isOther ? `<span style="display:inline-flex;gap:6px;margin-left:12px;">
          <button class="tx-edit-btn" onclick="renamePayeeGroup('${escapeHtml(group)}')">${labelRename}</button>
          <button class="tx-edit-btn btn-delete-sm" onclick="deletePayeeGroup('${escapeHtml(group)}')">${labelDelete}</button>
        </span>` : ''}
      </div>
      <table class="tx-table payee-table">
        <thead><tr>
          <th>${t('common.col.payee', {}, 'Payee')}</th><th>${t('settings.payees.col_aliases', {}, 'Aliases')}</th><th>${t('settings.payees.col_default_category', {}, 'Default Category')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('settings.payees.col_auto_tag', {}, 'Auto-Tag')}</th><th></th>
        </tr></thead><tbody>`;
    items.forEach(p => {
      html += `<tr data-payee-id="${escapeHtml(p.id)}">
        <td><strong><a href="#" onclick="showPayeeTxOverlay('${escapeHtml(p.payee)}');return false;" style="color:var(--text);text-decoration:none;border-bottom:1px dashed var(--border);">${escapeHtml(p.payee)}</a></strong>${p.notes ? `<br><span class="hint-sm">${escapeHtml(p.notes)}</span>` : ''}</td>
        <td class="sub-text">${escapeHtml((p.aliases || []).join(', '))}</td>
        <td class="cat">${escapeHtml(p.default_category)}</td>
        <td>${escapeHtml(p.default_account || '')}</td>
        <td>${p.auto_tag ? `<span class="tag-chip">${escapeHtml(p.auto_tag)}</span>` : ''}</td>
        <td><button class="tx-edit-btn" onclick="showPayeeModal('${escapeHtml(p.id)}')" title="${labelEdit}">${labelEdit}</button></td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }

  content.innerHTML = html;

  // Wire search
  document.getElementById('payee-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    content.querySelectorAll('.payee-table tbody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

// ── Payee Group Management ───────────────────────────────────────────────

function addPayeeGroup() {
  /** Create a new empty group — opens Add Payee modal with the new group pre-selected. */
  const name = prompt(t('payees.prompt_new_group', {}, 'New group name:'));
  if (!name || !name.trim()) return;
  // Open the Add Payee modal and pre-fill the group
  showPayeeModal().then(() => {
    setTimeout(() => {
      const sel = document.getElementById('pm-group-select');
      if (sel) {
        // Switch to new-group input and fill it
        sel.style.display = 'none';
        const newInput = document.getElementById('pm-group-new');
        if (newInput) { newInput.style.display = ''; newInput.value = name.trim(); }
      }
    }, 200);
  });
}

async function renamePayeeGroup(oldName) {
  /** Rename a payee group — updates all payees in that group via the API. */
  const newName = prompt(t('payees.prompt_rename_group', { name: oldName }, `Rename group "${oldName}" to:`), oldName);
  if (!newName || newName.trim() === oldName) return;

  try {
    // Load all payees, find those in this group, update each
    const res = await fetch('/api/payees/list', { method: 'POST' });
    const data = await res.json();
    const toUpdate = (data.payees || []).filter(p => p.group === oldName);

    for (const p of toUpdate) {
      await fetch('/api/payees/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, updated: { ...p, group: newName.trim() } }),
      });
    }
    // Re-render the payees page to reflect changes
    renderPayeesPage();
  } catch (e) {
    alert(t('payees.err_rename', { msg: e.message }, `Rename failed: ${e.message}`));
  }
}

async function deletePayeeGroup(groupName) {
  /** Delete a group — moves all payees in that group to "Other" (no group). */
  const otherLabel = t('payees.group_other', {}, 'Other');
  if (!confirm(t('payees.confirm_delete_group', { name: groupName, other: otherLabel }, `Delete group "${groupName}"? All ${groupName} payees will be moved to "${otherLabel}".`))) return;

  try {
    const res = await fetch('/api/payees/list', { method: 'POST' });
    const data = await res.json();
    const toUpdate = (data.payees || []).filter(p => p.group === groupName);

    for (const p of toUpdate) {
      await fetch('/api/payees/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, updated: { ...p, group: '' } }),
      });
    }
    renderPayeesPage();
  } catch (e) {
    alert(t('payees.err_delete', { msg: e.message }, `Delete failed: ${e.message}`));
  }
}

async function showPayeeTxOverlay(payeeName) {
  // Build set of matching names: payee name + aliases
  const ctx = await loadTxContext();
  const matchNames = new Set([payeeName.toLowerCase()]);
  if (ctx.payees) {
    const entry = ctx.payees.find(p => p.payee === payeeName);
    if (entry) {
      (entry.aliases || []).forEach(a => matchNames.add(a.toLowerCase()));
    }
  }

  const allMatching = state.tx.filter(tx => matchNames.has((tx.payee || '').toLowerCase()) && !tx.is_auto_generated);
  const limit = 10;
  const txs = allMatching
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, limit);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  const shownLabel = txs.length < limit
    ? String(txs.length)
    : t('payees.overlay.last_n', { n: limit }, `Last ${limit}`);
  const aliasSuffix = matchNames.size > 1
    ? t('payees.overlay.hint_aliases_suffix', {}, ' (incl. aliases)')
    : '';

  overlay.innerHTML = `
    <div class="modal" style="width:640px;">
      <h3>${t('payees.overlay.title', { name: escapeHtml(payeeName) }, `<span class="accent">${escapeHtml(payeeName)}</span> — Recent Transactions`)}</h3>
      <div class="hint-md mb-16">${t('payees.overlay.hint', { shown: escapeHtml(shownLabel), total: allMatching.length }, `${shownLabel} of ${allMatching.length} transactions`)}${aliasSuffix}</div>
      ${txs.length === 0 ? `<div style="color:var(--muted);padding:20px 0;">${t('payees.overlay.empty', {}, 'No transactions found.')}</div>` : `
      <table class="tx-table" class="mb-0">
        <thead><tr><th>${t('common.label.date', {}, 'Date')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('common.col.category', {}, 'Category')}</th><th>${t('common.label.note', {}, 'Note')}</th><th class="amt">${t('common.col.amount', {}, 'Amount')}</th></tr></thead>
        <tbody>
          ${txs.map(tx => {
            const amtClass = tx.type === 'income' ? 'income' : tx.type === 'transfer' ? 'transfer' : 'expense';
            const sign = tx.type === 'income' ? '+' : tx.type === 'transfer' ? '' : '-';
            return `<tr>
              <td>${fmtDate(tx.date)}</td>
              <td class="fs-12">${tx.account}</td>
              <td class="cat" class="fs-12">${escapeHtml(tx.category || '')}</td>
              <td style="font-size:11px;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(tx.note || '')}</td>
              <td class="amt ${amtClass}">${sign}${formatCurrency(tx.amount, tx.currency)} ${tx.currency}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`}
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right"><button onclick="closeModal()">${t('common.actions.close', {}, 'Close')}</button></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function showPayeeModal(editId) {
  const ctx = await loadTxContext();
  let payee = null;
  let allPayees = [];
  try {
    const res = await fetch('/api/payees/list', { method: 'POST' });
    const data = await res.json();
    allPayees = data.payees || [];
    if (editId) payee = allPayees.find(p => p.id === editId);
  } catch (e) {}

  const isEdit = !!payee;
  const accOptions = ctx.accounts.filter(a => a.status === 'active').map(a =>
    `<option value="${a.alias}" ${payee && payee.default_account === a.alias ? 'selected' : ''}>${a.alias} — ${a.name}</option>`
  ).join('');
  const catOptions = ctx.categories.filter(c => c.active).map(c =>
    `<option value="${c.path}" ${payee && payee.default_category === c.path ? 'selected' : ''}>${c.path}</option>`
  ).join('');

  // Extract unique groups
  const existingGroups = [...new Set(allPayees.map(p => p.group).filter(Boolean))].sort();
  const currentGroup = payee?.group || '';
  const groupOptions = existingGroups.map(g =>
    `<option value="${escapeHtml(g)}" ${g === currentGroup ? 'selected' : ''}>${escapeHtml(g)}</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? t('settings.payees.modal.title_edit', {}, 'Edit <span class="accent">Payee</span>') : t('settings.payees.modal.title_add', {}, 'Add <span class="accent">Payee</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.payees.modal.label_payee_name', {}, 'Payee Name')}</label>
          <input type="text" id="pm-payee" value="${escapeHtml(payee?.payee || '')}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.payees.modal.label_aliases', {}, 'Aliases (comma-separated)')}</label>
          <input type="text" id="pm-aliases" value="${escapeHtml((payee?.aliases || []).join(', '))}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.payees.modal.label_default_category', {}, 'Default Category')}</label>
          <select id="pm-category"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option>${catOptions}</select>
        </div>
        <div class="atx-field"><label>${t('settings.payees.modal.label_default_account', {}, 'Default Account')}</label>
          <select id="pm-account"><option value="">${t('settings.payees.modal.opt_account_none', {}, 'None')}</option>${accOptions}</select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.payees.modal.label_auto_tag', {}, 'Auto-Tag')}</label>
          <input type="text" id="pm-autotag" value="${escapeHtml(payee?.auto_tag || '')}">
        </div>
        <div class="atx-field"><label>${t('settings.payees.modal.label_group', {}, 'Group')}</label>
          <select id="pm-group-select" onchange="if(this.value==='__new__'){this.style.display='none';document.getElementById('pm-group-new').style.display='';document.getElementById('pm-group-new').focus();}">
            <option value="">${t('settings.payees.modal.opt_group_none', {}, 'No group')}</option>
            ${groupOptions}
            <option value="__new__">${t('settings.payees.modal.opt_group_new', {}, '+ New group...')}</option>
          </select>
          <input type="text" id="pm-group-new" placeholder="${t('settings.payees.modal.placeholder_group_new', {}, 'New group name')}" style="display:none;" value="">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.payees.modal.label_notes', {}, 'Notes')}</label>
          <input type="text" id="pm-notes" value="${escapeHtml(payee?.notes || '')}">
        </div>
      </div>
      <div id="pm-status"></div>
      <div class="modal-footer">
        <div class="btn-left">
          ${isEdit ? `<button class="btn-delete" onclick="deletePayee('${editId}')">${t('common.actions.delete', {}, 'Delete')}</button>` : ''}
        </div>
        <div class="btn-right">
          <button onclick="closeModal()">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" onclick="savePayee(${isEdit ? `'${editId}'` : 'null'})">${isEdit ? t('common.actions.save', {}, 'Save') : t('common.actions.add', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function savePayee(editId) {
  const data = {
    payee: document.getElementById('pm-payee').value.trim(),
    aliases: document.getElementById('pm-aliases').value.split(',').map(a => a.trim()).filter(Boolean),
    default_category: document.getElementById('pm-category').value,
    default_account: document.getElementById('pm-account').value,
    auto_tag: document.getElementById('pm-autotag').value.trim(),
    group: (document.getElementById('pm-group-new').style.display !== 'none'
      ? document.getElementById('pm-group-new').value.trim()
      : (document.getElementById('pm-group-select').value === '__new__' ? '' : document.getElementById('pm-group-select').value)),
    notes: document.getElementById('pm-notes').value.trim(),
  };
  if (!data.payee) { document.getElementById('pm-status').innerHTML = `<div class="atx-status error">${t('settings.payees.modal.err_name_required', {}, 'Payee name is required')}</div>`; return; }

  const statusEl = document.getElementById('pm-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

  try {
    const endpoint = editId ? '/api/payees/update' : '/api/payees/add';
    const body = editId ? { id: editId, updated: data } : data;
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderPayeesPage();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

async function deletePayee(id) {
  if (!confirm(t('settings.payees.modal.confirm_delete', {}, 'Delete this payee?'))) return;
  try {
    await fetch('/api/payees/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    closeModal();
    renderPayeesPage();
  } catch (e) {}
}

// ─── Settings Page (Categories + Tags) ────────────────────────────────────

// settingsTab declared in core.js

async function renderSettingsPage() {
  const content = document.getElementById('settings-content');
  // Tab labels go through t() so translated strings show up after locale switch.
  // English fallback (third arg) keeps the label readable if the i18n key is missing.
  // Each tab can declare a feature flag; if disabled in config/features.json,
  // the tab is filtered out before render.
  const tabs = [
    { id: 'categories', label: t('settings.tab.categories', {}, 'Categories') },
    { id: 'tags', label: t('settings.tab.tags', {}, 'Tags') },
    { id: 'scheduled', label: t('settings.tab.scheduled', {}, 'Scheduled'), feature: 'scheduled_tx' },
    { id: 'quickexp', label: t('settings.tab.quickexp', {}, 'Quick Expenses'), feature: 'quick_expenses' },
    { id: 'atmfees', label: t('settings.tab.atmfees', {}, 'ATM Fees') },
    { id: 'payees', label: t('settings.tab.payees', {}, 'Payees') },
    { id: 'accounts', label: t('settings.tab.accounts', {}, 'Accounts') },
    { id: 'currency', label: t('settings.tab.currency', {}, 'Currency') },
    { id: 'fxrates', label: t('settings.tab.fxrates', {}, 'FX Rates') },
    { id: 'goals', label: t('settings.tab.goals', {}, 'Goals') },
    { id: 'budgets', label: t('settings.tab.budgets', {}, 'Budgets') },
    { id: 'backup', label: t('settings.tab.backup', {}, 'Backup') },
    { id: 'language', label: t('settings.tab.language', {}, 'Language') },
  ].filter(tab => !tab.feature || isFeatureEnabled(tab.feature));
  content.innerHTML = `
    <div class="atx-tabs" style="margin-bottom:24px;flex-wrap:wrap;">
      ${tabs.map(t => `<button class="${settingsTab === t.id ? 'active' : ''}" onclick="settingsTab='${t.id}';renderSettingsPage()">${t.label}</button>`).join('')}
    </div>
    <div id="settings-tab-content"></div>
  `;
  if (settingsTab === 'categories') renderCategoriesTab();
  else if (settingsTab === 'tags') renderTagsTab();
  else if (settingsTab === 'scheduled') renderScheduledTab();
  else if (settingsTab === 'quickexp') renderQuickExpTab();
  else if (settingsTab === 'atmfees') renderAtmFeesTab();
  else if (settingsTab === 'payees') renderPayeesPage();
  else if (settingsTab === 'accounts') renderAccountsSettingsTab();
  else if (settingsTab === 'currency') renderCurrencyTab();
  else if (settingsTab === 'fxrates') renderFxRatesTab();
  else if (settingsTab === 'goals') renderGoalsTab();
  else if (settingsTab === 'budgets') renderBudgetsTab();
  else if (settingsTab === 'backup') renderBackupTab();
  else if (settingsTab === 'language') renderLanguageTab();
}

// ─── Settings: Language ──────────────────────────────────────────────────
// B1 scope: minimal locale picker. Dropdown shows codes from window.AVAILABLE_LOCALES;
// only "en" is shipped in the template. Forks add config/i18n/<code>.json and append
// the code to AVAILABLE_LOCALES (in i18n.js) to make it selectable here.
async function renderLanguageTab() {
  const container = document.getElementById('settings-tab-content');
  const options = window.AVAILABLE_LOCALES.map(code => {
    const label = t(`settings.language.option.${code}`, {}, code.toUpperCase());
    const sel = code === window.LOCALE ? ' selected' : '';
    return `<option value="${code}"${sel}>${label}</option>`;
  }).join('');
  container.innerHTML = `
    <div style="max-width:560px;">
      <h3 style="margin:0 0 12px;">${t('settings.language.heading', {}, 'Interface Language')}</h3>
      <p class="c-mut" style="margin:0 0 16px;">${t('settings.language.description', {}, 'Choose the display language for the dashboard.')}</p>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <label for="locale-select" style="font-weight:600;">${t('settings.language.current_label', {}, 'Current locale:')}</label>
        <select id="locale-select" style="padding:6px 10px;">${options}</select>
      </div>
      <div class="c-mut" style="font-size:12px;">${t('settings.language.fallback_note', {}, 'Strings without a translation fall back to the English value baked into the HTML.')}</div>
    </div>
  `;
  // Switch locale, re-apply DOM, then re-render this tab so the new strings show up immediately.
  document.getElementById('locale-select').addEventListener('change', async (e) => {
    await setLocale(e.target.value);
    renderSettingsPage();
  });
}

async function renderCategoriesTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.categories.loading', {}, 'Loading categories...'))}</div>`;

  let categories = [];
  try {
    const res = await fetch('/api/categories/list', { method: 'POST' });
    const data = await res.json();
    categories = data.categories || [];
  } catch (e) { container.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.categories.load_failed', {}, 'Failed to load'))}</div>`; return; }

  // Group by top-level
  const groups = {};
  categories.forEach(c => {
    const top = c.path.split(':')[0];
    if (!groups[top]) groups[top] = [];
    groups[top].push(c);
  });

  // Cache common translations once per render to avoid re-lookup in the loop.
  const labelYes = t('common.yes', {}, 'Yes');
  const labelNo = t('common.no', {}, 'No');
  const labelLuxury = t('settings.categories.val_luxury', {}, 'Luxury');
  const labelActive = t('common.status.active', {}, 'Active');
  const labelInactive = t('common.status.inactive', {}, 'Inactive');
  const labelEdit = t('common.actions.edit', {}, 'Edit');

  let html = `
    <div class="flex-row gap-md mb-20">
      <span class="hint-md">${t('settings.categories.count', { n: categories.length }, `${categories.length} categories`)}</span>
      <button class="btn-save" onclick="showCategoryModal()" style="padding:8px 16px;font-size:11px;">${t('settings.categories.add', {}, '+ Add Category')}</button>
    </div>
  `;

  for (const [top, cats] of Object.entries(groups).sort()) {
    html += `<div class="section" class="mb-16">
      <div class="section-title">${escapeHtml(top)}</div>
      <table class="tx-table"><thead><tr><th>${t('settings.categories.col_path', {}, 'Path')}</th><th>${t('common.col.type', {}, 'Type')}</th><th>${t('settings.categories.col_pnl', {}, 'P&L')}</th><th>${t('settings.categories.col_essential', {}, 'Essential')}</th><th>${labelActive}</th><th>${t('settings.categories.col_note', {}, 'Note')}</th><th></th></tr></thead><tbody>`;
    cats.forEach(c => {
      const pnlVal = c.pnl === 'false' ? false : true;
      const essentialVal = !(c.essential === 'false' || c.essential === false);
      const essentialRelevant = c.type === 'expense';
      const isActive = c.active === 'true' || c.active === true;
      html += `<tr style="${c.active === 'false' || c.active === false ? 'opacity:0.5' : ''}">
        <td>${escapeHtml(c.path)}</td>
        <td class="fs-11">${c.type}</td>
        <td><span style="font-size:10px;color:${pnlVal ? 'var(--positive)' : 'var(--muted)'}">${pnlVal ? labelYes : labelNo}</span></td>
        <td><span style="font-size:10px;color:${!essentialRelevant ? 'var(--muted)' : essentialVal ? 'var(--positive)' : 'var(--warn)'}">${!essentialRelevant ? '—' : essentialVal ? labelYes : labelLuxury}</span></td>
        <td><button style="font-size:10px;padding:3px 8px;" onclick="toggleCategory('${escapeHtml(c.path)}', ${isActive})">${isActive ? labelActive : labelInactive}</button></td>
        <td class="hint-sm">${escapeHtml(c.note || '')}</td>
        <td><button class="tx-edit-btn" onclick="showCategoryModal('${escapeHtml(c.path)}')" title="${labelEdit}">${labelEdit}</button></td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }

  container.innerHTML = html;
}

async function toggleCategory(path, isActive) {
  await fetch('/api/categories/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, updated: { active: isActive ? 'false' : 'true' } }),
  });
  renderCategoriesTab();
  reloadCategories();
}

async function showCategoryModal(editPath) {
  let cat = null;
  if (editPath) {
    try {
      const res = await fetch('/api/categories/list', { method: 'POST' });
      const data = await res.json();
      cat = (data.categories || []).find(c => c.path === editPath);
    } catch (e) {}
  }
  const isEdit = !!cat;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? t('settings.categories.modal.title_edit', {}, 'Edit <span class="accent">Category</span>') : t('settings.categories.modal.title_add', {}, 'Add <span class="accent">Category</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.categories.modal.label_path', {}, 'Path (e.g. Food:Dining out)')}</label>
          <input type="text" id="cm-path" value="${escapeHtml(cat?.path || '')}" ${isEdit ? 'readonly style="opacity:0.6"' : ''}>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('common.col.type', {}, 'Type')}</label>
          <select id="cm-type">
            <option value="expense" ${cat?.type === 'expense' ? 'selected' : ''}>${t('common.type.expense', {}, 'Expense')}</option>
            <option value="income" ${cat?.type === 'income' ? 'selected' : ''}>${t('common.type.income', {}, 'Income')}</option>
          </select>
        </div>
        <div class="atx-field"><label>${t('common.status.active', {}, 'Active')}</label>
          <select id="cm-active">
            <option value="true" ${!cat || cat.active === 'true' || cat.active === true ? 'selected' : ''}>${t('common.status.active', {}, 'Active')}</option>
            <option value="false" ${cat && (cat.active === 'false' || cat.active === false) ? 'selected' : ''}>${t('common.status.inactive', {}, 'Inactive')}</option>
          </select>
        </div>
        <div class="atx-field"><label>${t('settings.categories.modal.label_pnl', {}, 'P&L Relevant')}</label>
          <select id="cm-pnl">
            <option value="true" ${!cat || cat.pnl !== 'false' ? 'selected' : ''}>${t('common.yes', {}, 'Yes')}</option>
            <option value="false" ${cat && cat.pnl === 'false' ? 'selected' : ''}>${t('settings.categories.modal.opt_pnl_no_balance', {}, 'No (Balance Sheet)')}</option>
          </select>
        </div>
        <div class="atx-field"><label>${t('settings.categories.modal.label_essential', {}, 'Essential (Cost of Living)')}</label>
          <select id="cm-essential">
            <option value="true" ${!cat || !(cat.essential === 'false' || cat.essential === false) ? 'selected' : ''}>${t('settings.categories.modal.opt_essential_yes', {}, 'Yes — counts as essential')}</option>
            <option value="false" ${cat && (cat.essential === 'false' || cat.essential === false) ? 'selected' : ''}>${t('settings.categories.modal.opt_essential_no', {}, 'No — discretionary / luxury')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('common.label.note', {}, 'Note')}</label>
          <input type="text" id="cm-note" value="${escapeHtml(cat?.note || '')}">
        </div>
      </div>
      <div id="cm-status"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button onclick="closeModal()">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" onclick="saveCategory(${isEdit ? `'${escapeHtml(editPath)}'` : 'null'})">${isEdit ? t('common.actions.save', {}, 'Save') : t('common.actions.add', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function saveCategory(editPath) {
  const path = editPath || document.getElementById('cm-path').value.trim();
  const data = {
    type: document.getElementById('cm-type').value,
    active: document.getElementById('cm-active').value,
    pnl: document.getElementById('cm-pnl').value,
    essential: document.getElementById('cm-essential').value,
    note: document.getElementById('cm-note').value.trim(),
  };
  if (!path) { document.getElementById('cm-status').innerHTML = `<div class="atx-status error">${t('settings.categories.modal.err_path_required', {}, 'Path is required')}</div>`; return; }

  const statusEl = document.getElementById('cm-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

  try {
    const endpoint = editPath ? '/api/categories/update' : '/api/categories/add';
    const body = editPath ? { path, updated: data } : { path, ...data };
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderCategoriesTab();
    addTxState.context = null; // Invalidate cached context
    reloadCategories();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

// ─── Tags Tab ─────────────────────────────────────────────────────────────

async function renderTagsTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.tags.loading', {}, 'Loading tags...'))}</div>`;

  let tags = [];
  try {
    const res = await fetch('/api/tags/list', { method: 'POST' });
    const data = await res.json();
    tags = data.tags || [];
  } catch (e) { container.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.categories.load_failed', {}, 'Failed to load'))}</div>`; return; }

  // Cache translations + rename map var from `t` to `tag` to avoid shadowing t().
  const labelActive = t('common.status.active', {}, 'Active');
  const labelInactive = t('common.status.inactive', {}, 'Inactive');
  const labelEdit = t('common.actions.edit', {}, 'Edit');
  const labelDelete = t('common.actions.delete', {}, 'Delete');
  const autoRuleManual = t('settings.tags.auto_rule_manual', {}, '(manual)');

  let html = `
    <div class="flex-row gap-md mb-20">
      <span class="hint-md">${t('settings.tags.count', { n: tags.length }, `${tags.length} tags`)}</span>
      <button class="btn-save" onclick="showTagModal()" style="padding:8px 16px;font-size:11px;">${t('settings.tags.add', {}, '+ Add Tag')}</button>
    </div>
    <div class="section">
      <table class="tx-table"><thead><tr><th>${t('settings.tags.col_tag', {}, 'Tag')}</th><th>${t('settings.tags.col_description', {}, 'Description')}</th><th>${t('settings.tags.col_auto_rule', {}, 'Auto-Rule')}</th><th>${labelActive}</th><th></th></tr></thead><tbody>
  `;
  tags.forEach(tag => {
    html += `<tr style="${tag.active === 'false' ? 'opacity:0.5' : ''}">
      <td><strong>${escapeHtml(tag.tag)}</strong></td>
      <td class="fs-11">${escapeHtml(tag.description || '')}</td>
      <td class="hint-sm">${escapeHtml(tag.auto_rule || autoRuleManual)}</td>
      <td><button style="font-size:10px;padding:3px 8px;" onclick="toggleTag('${escapeHtml(tag.tag)}', '${tag.active}')">${tag.active === 'true' ? labelActive : labelInactive}</button></td>
      <td>
        <button class="tx-edit-btn" onclick="showTagModal('${escapeHtml(tag.tag)}')" title="${labelEdit}">${labelEdit}</button>
        <button class="tx-edit-btn" onclick="deleteTag('${escapeHtml(tag.tag)}')" title="${labelDelete}" class="c-neg">${labelDelete}</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table></div>';

  container.innerHTML = html;
}

async function toggleTag(tag, active) {
  await fetch('/api/tags/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag, updated: { active: active === 'true' ? 'false' : 'true' } }),
  });
  renderTagsTab();
}

async function showTagModal(editTag) {
  let tag = null;
  if (editTag) {
    try {
      const res = await fetch('/api/tags/list', { method: 'POST' });
      const data = await res.json();
      tag = (data.tags || []).find(t => t.tag === editTag);
    } catch (e) {}
  }
  const isEdit = !!tag;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? t('settings.tags.modal.title_edit', {}, 'Edit <span class="accent">Tag</span>') : t('settings.tags.modal.title_add', {}, 'Add <span class="accent">Tag</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.tags.modal.label_tag_name', {}, 'Tag Name')}</label>
          <input type="text" id="tm-tag" value="${escapeHtml(tag?.tag || '')}" ${isEdit ? 'readonly style="opacity:0.6"' : ''}>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('common.label.description', {}, 'Description')}</label>
          <input type="text" id="tm-desc" value="${escapeHtml(tag?.description || '')}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field"><label>${t('settings.tags.modal.label_auto_rule', {}, 'Auto-Rule (e.g. "account in kft;kfu")')}</label>
          <input type="text" id="tm-rule" value="${escapeHtml(tag?.auto_rule || '')}">
        </div>
        <div class="atx-field"><label>${t('common.status.active', {}, 'Active')}</label>
          <select id="tm-active">
            <option value="true" ${!tag || tag.active === 'true' ? 'selected' : ''}>${t('common.status.active', {}, 'Active')}</option>
            <option value="false" ${tag?.active === 'false' ? 'selected' : ''}>${t('common.status.inactive', {}, 'Inactive')}</option>
          </select>
        </div>
      </div>
      <div id="tm-status"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button onclick="closeModal()">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" onclick="saveTag(${isEdit ? `'${escapeHtml(editTag)}'` : 'null'})">${isEdit ? t('common.actions.save', {}, 'Save') : t('common.actions.add', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function saveTag(editTag) {
  const tagName = editTag || document.getElementById('tm-tag').value.trim();
  const data = {
    description: document.getElementById('tm-desc').value.trim(),
    auto_rule: document.getElementById('tm-rule').value.trim(),
    active: document.getElementById('tm-active').value,
  };
  if (!tagName) { document.getElementById('tm-status').innerHTML = `<div class="atx-status error">${t('settings.tags.modal.err_tag_required', {}, 'Tag name is required')}</div>`; return; }

  const statusEl = document.getElementById('tm-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

  try {
    const endpoint = editTag ? '/api/tags/update' : '/api/tags/add';
    const body = editTag ? { tag: tagName, updated: data } : { tag: tagName, ...data };
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderTagsTab();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

async function deleteTag(tag) {
  if (!confirm(t('settings.tags.modal.confirm_delete', { tag }, `Delete tag "${tag}"?`))) return;
  try {
    await fetch('/api/tags/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag }) });
    renderTagsTab();
  } catch (e) {}
}

// ─── Scheduled Tab ────────────────────────────────────────────────────────

async function renderScheduledTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.scheduled.loading', {}, 'Loading scheduled...'))}</div>`;

  let items = [];
  try {
    const res = await fetch('/api/scheduled/list', { method: 'POST' });
    const data = await res.json();
    items = data.scheduled || [];
  } catch (e) { container.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.categories.load_failed', {}, 'Failed to load'))}</div>`; return; }

  const active = items.filter(s => s.active === 'true');
  const inactive = items.filter(s => s.active !== 'true');

  const labelActive = t('common.status.active', {}, 'Active');
  const labelInactive = t('common.status.inactive', {}, 'Inactive');
  const labelEdit = t('common.actions.edit', {}, 'Edit');
  const labelDelete = t('common.actions.delete', {}, 'Delete');

  let html = `
    <div class="flex-row gap-md mb-20">
      <span class="hint-md">${t('settings.scheduled.count_split', { active: active.length, inactive: inactive.length }, `${active.length} active, ${inactive.length} inactive`)}</span>
      <button class="btn-save" onclick="showScheduledModal()" style="padding:8px 16px;font-size:11px;">${t('settings.scheduled.add', {}, '+ Add Scheduled')}</button>
    </div>
    <div class="section">
      <table class="tx-table"><thead><tr>
        <th>${t('common.col.name', {}, 'Name')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('common.col.amount', {}, 'Amount')}</th><th>${t('common.col.payee', {}, 'Payee')}</th><th>${t('common.col.category', {}, 'Category')}</th><th>${t('settings.scheduled.col_frequency', {}, 'Frequency')}</th><th>${t('settings.scheduled.col_next_run', {}, 'Next Run')}</th><th>${t('settings.scheduled.col_last_run', {}, 'Last Run')}</th><th>${labelActive}</th><th></th>
      </tr></thead><tbody>
  `;
  items.forEach(s => {
    const overdue = s.active === 'true' && s.next_run && s.next_run <= new Date().toISOString().slice(0,10);
    html += `<tr style="${s.active !== 'true' ? 'opacity:0.5' : ''}">
      <td><strong>${escapeHtml(s.name)}</strong>${s.note ? `<br><span class="hint-sm">${escapeHtml(s.note)}</span>` : ''}</td>
      <td class="fs-11">${escapeHtml(s.account)}</td>
      <td style="font-size:11px;font-variant-numeric:tabular-nums">${formatCurrency(Number(s.amount), s.currency)} ${s.currency}</td>
      <td class="fs-11">${escapeHtml(s.payee)}</td>
      <td class="fs-10">${escapeHtml(s.category)}</td>
      <td class="fs-10">${escapeHtml(s.frequency)}</td>
      <td style="font-size:11px;${overdue ? 'color:var(--negative);font-weight:500' : ''}">${fmtDate(s.next_run)}${overdue ? ' !' : ''}</td>
      <td class="hint-sm">${fmtDate(s.last_run) || '—'}</td>
      <td><button style="font-size:10px;padding:3px 8px;" onclick="toggleScheduled('${s.sched_id}', '${s.active}')">${s.active === 'true' ? labelActive : labelInactive}</button></td>
      <td>
        <button class="tx-edit-btn" onclick="showScheduledModal('${s.sched_id}')" title="${labelEdit}">${labelEdit}</button>
        <button class="tx-edit-btn" onclick="deleteScheduled('${s.sched_id}')" title="${labelDelete}" class="c-neg">${labelDelete}</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  if (items.some(s => s.manual_tags)) {
    html += `<div style="font-size:10px;color:var(--muted);margin-top:8px;">${escapeHtml(t('settings.scheduled.footer_manual_tags', {}, 'Tags shown are manual only — auto-tags (Pass-Through, Payee-based) are applied at booking time.'))}</div>`;
  }
  container.innerHTML = html;
}

async function toggleScheduled(schedId, active) {
  await fetch('/api/scheduled/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sched_id: schedId, updated: { active: active === 'true' ? 'false' : 'true' } }),
  });
  renderScheduledTab();
}

async function showScheduledModal(editId) {
  const ctx = await loadTxContext();
  let item = null;
  if (editId) {
    try {
      const res = await fetch('/api/scheduled/list', { method: 'POST' });
      const data = await res.json();
      item = (data.scheduled || []).find(s => s.sched_id === editId);
    } catch (e) {}
  }
  const isEdit = !!item;
  const activeAccounts = ctx.accounts.filter(a => a.status === 'active');
  const accOptions = activeAccounts.map(a =>
    `<option value="${a.alias}" data-currency="${a.currency}" ${item && item.account === a.alias ? 'selected' : ''}>${a.alias} — ${a.name} [${a.currency}]</option>`
  ).join('');
  const catOptions = ctx.categories.filter(c => c.active).map(c =>
    `<option value="${c.path}" ${item && item.category === c.path ? 'selected' : ''}>${c.path}</option>`
  ).join('');
  const currencies = ['TZS', 'EUR', 'USD', 'PLN'];
  const selectedCur = item?.currency || 'TZS';
  const curOptions = currencies.map(c => `<option value="${c}" ${selectedCur === c ? 'selected' : ''}>${c}</option>`).join('');
  const existingTags = new Set((item?.manual_tags || '').split(';').map(t => t.trim()).filter(Boolean));
  const tagCheckboxes = (ctx.tags || []).filter(t => t.active).map(t =>
    `<label><input type="checkbox" value="${t.tag}" ${existingTags.has(t.tag) ? 'checked' : ''}><span>${escapeHtml(t.tag)}</span></label>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? t('settings.scheduled.modal.title_edit', {}, 'Edit <span class="accent">Scheduled Transaction</span>') : t('settings.scheduled.modal.title_add', {}, 'Add <span class="accent">Scheduled Transaction</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field" class="fx2"><label>${t('common.col.name', {}, 'Name')}</label>
          <input type="text" id="sm-name" value="${escapeHtml(item?.name || '')}" placeholder="${t('settings.scheduled.modal.placeholder_name', {}, 'PKO Leon Monthly Fee')}">
        </div>
        <div class="atx-field" class="fx1"><label>${t('common.status.active', {}, 'Active')}</label>
          <select id="sm-active">
            <option value="true" ${!item || item.active === 'true' ? 'selected' : ''}>${t('common.status.active', {}, 'Active')}</option>
            <option value="false" ${item?.active === 'false' ? 'selected' : ''}>${t('common.status.inactive', {}, 'Inactive')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>${t('common.col.account', {}, 'Account')}</label>
          <select id="sm-account"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option>${accOptions}</select>
        </div>
        <div class="atx-field" class="fx1"><label>${t('common.col.amount', {}, 'Amount')}</label>
          <input type="text" id="sm-amount" value="${escapeHtml(item?.amount || '')}" placeholder="${t('settings.scheduled.modal.placeholder_amount', {}, '900000')}">
        </div>
        <div class="atx-field" class="fx05"><label>${t('common.col.currency', {}, 'Currency')}</label>
          <select id="sm-currency">${curOptions}</select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>${t('common.col.payee', {}, 'Payee')}</label>
          <input type="text" id="sm-payee" value="${escapeHtml(item?.payee || '')}">
        </div>
        <div class="atx-field" class="fx1"><label>${t('common.col.category', {}, 'Category')}</label>
          <select id="sm-category"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option>${catOptions}</select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>${t('settings.scheduled.modal.label_frequency', {}, 'Frequency (e.g. monthly:1, monthly:30, monthly:last)')}</label>
          <input type="text" id="sm-frequency" value="${escapeHtml(item?.frequency || 'monthly:1')}" placeholder="${t('settings.scheduled.modal.placeholder_frequency', {}, 'monthly:1')}">
        </div>
        <div class="atx-field" class="fx1"><label>${t('settings.scheduled.modal.label_next_run', {}, 'Next Run (YYYY-MM-DD)')}</label>
          <input type="date" id="sm-next-run" value="${item?.next_run || ''}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>${t('common.label.note', {}, 'Note')}</label>
          <input type="text" id="sm-note" value="${escapeHtml(item?.note || '')}">
        </div>
        <div class="atx-field" class="fx1"><label>${t('settings.scheduled.modal.label_manual_tags', {}, 'Manual Tags')}</label>
          <div id="sm-tags" class="tag-picker">${tagCheckboxes}</div>
        </div>
      </div>
      <div id="sm-status"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button onclick="closeModal()">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" onclick="saveScheduled(${isEdit ? `'${editId}'` : 'null'})">${isEdit ? t('common.actions.save', {}, 'Save') : t('common.actions.add', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);

  // Auto-sync currency to the selected account's native currency. Only
  // overwrites when adding a new entry or when the user hasn't manually
  // picked a currency yet — avoids clobbering an intentional override.
  const accSel = document.getElementById('sm-account');
  const curSel = document.getElementById('sm-currency');
  if (accSel && curSel) {
    let curTouched = !!item; // Treat existing entries as user-set already
    curSel.addEventListener('change', () => { curTouched = true; });
    accSel.addEventListener('change', () => {
      if (curTouched) return;
      const opt = accSel.options[accSel.selectedIndex];
      const accCur = opt && opt.getAttribute('data-currency');
      if (accCur && currencies.includes(accCur)) curSel.value = accCur;
    });
  }
}

async function saveScheduled(editId) {
  const data = {
    name: document.getElementById('sm-name').value.trim(),
    account: document.getElementById('sm-account').value,
    amount: parseAmountInputStr(document.getElementById('sm-amount').value),
    currency: document.getElementById('sm-currency').value,
    payee: document.getElementById('sm-payee').value.trim(),
    category: document.getElementById('sm-category').value,
    frequency: document.getElementById('sm-frequency').value.trim(),
    next_run: document.getElementById('sm-next-run').value,
    note: document.getElementById('sm-note').value.trim(),
    manual_tags: Array.from(document.querySelectorAll('#sm-tags input:checked')).map(c => c.value).join(';'),
    active: document.getElementById('sm-active').value,
  };
  if (!data.name || !data.account || !data.amount) {
    document.getElementById('sm-status').innerHTML = `<div class="atx-status error">${t('settings.scheduled.modal.err_required', {}, 'Name, account, and amount are required')}</div>`;
    return;
  }

  const statusEl = document.getElementById('sm-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

  try {
    const endpoint = editId ? '/api/scheduled/update' : '/api/scheduled/add';
    const body = editId ? { sched_id: editId, updated: data } : data;
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderScheduledTab();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

async function deleteScheduled(schedId) {
  if (!confirm(t('settings.scheduled.modal.confirm_delete', { schedId }, `Delete scheduled "${schedId}"?`))) return;
  try {
    await fetch('/api/scheduled/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sched_id: schedId }) });
    renderScheduledTab();
  } catch (e) {}
}

// ─── Quick Expenses Settings Tab ─────────────────────────────────────────

async function renderQuickExpTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.quickexp.loading', {}, 'Loading quick expenses...'))}</div>`;

  let items = [];
  try {
    const res = await fetch('/api/quickexp/list', { method: 'POST' });
    const data = await res.json();
    items = data.quick_expenses || [];
  } catch (e) { container.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.categories.load_failed', {}, 'Failed to load'))}</div>`; return; }

  const active = items.filter(q => q.active === 'true');
  const inactive = items.filter(q => q.active !== 'true');

  const labelActive = t('common.status.active', {}, 'Active');
  const labelInactive = t('common.status.inactive', {}, 'Inactive');
  const labelEdit = t('common.actions.edit', {}, 'Edit');
  const labelDelete = t('common.actions.delete', {}, 'Delete');

  let html = `
    <div class="flex-row gap-md mb-20">
      <span class="hint-md">${t('settings.quickexp.count_split', { active: active.length, inactive: inactive.length }, `${active.length} active, ${inactive.length} inactive`)}</span>
      <button class="btn-save" onclick="showQuickExpModal()" style="padding:8px 16px;font-size:11px;">${t('settings.quickexp.add', {}, '+ Add Quick Expense')}</button>
    </div>
    <div class="section">
      <table class="tx-table"><thead><tr>
        <th>${t('common.col.name', {}, 'Name')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('common.col.payee', {}, 'Payee')}</th><th>${t('common.col.category', {}, 'Category')}</th><th>${t('common.col.tags', {}, 'Tags')}</th><th>${labelActive}</th><th></th>
      </tr></thead><tbody>
  `;
  items.forEach(q => {
    html += `<tr style="${q.active !== 'true' ? 'opacity:0.5' : ''}">
      <td><strong>${escapeHtml(q.name)}</strong></td>
      <td class="fs-11">${escapeHtml(q.account)}</td>
      <td class="fs-11">${escapeHtml(q.payee)}</td>
      <td class="fs-10">${escapeHtml(q.category)}</td>
      <td class="hint-sm">${escapeHtml(q.tags || '')}</td>
      <td><button style="font-size:10px;padding:3px 8px;" onclick="toggleQuickExp('${q.id}', '${q.active}')">${q.active === 'true' ? labelActive : labelInactive}</button></td>
      <td>
        <button class="tx-edit-btn" onclick="showQuickExpModal('${q.id}')" title="${labelEdit}">${labelEdit}</button>
        <button class="tx-edit-btn" onclick="deleteQuickExp('${q.id}')" title="${labelDelete}" class="c-neg">${labelDelete}</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

async function toggleQuickExp(qeId, active) {
  await fetch('/api/quickexp/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: qeId, updated: { active: active === 'true' ? 'false' : 'true' } }),
  });
  renderQuickExpTab();
}

async function showQuickExpModal(editId) {
  const ctx = await loadTxContext();
  let item = null;
  if (editId) {
    try {
      const res = await fetch('/api/quickexp/list', { method: 'POST' });
      const data = await res.json();
      item = (data.quick_expenses || []).find(q => q.id === editId);
    } catch (e) {}
  }
  const isEdit = !!item;
  const activeAccounts = ctx.accounts.filter(a => a.status === 'active');
  const accOptions = activeAccounts.map(a =>
    `<option value="${a.alias}" ${item && item.account === a.alias ? 'selected' : ''}>${a.alias} — ${a.name} [${a.currency}]</option>`
  ).join('');
  const catOptions = ctx.categories.filter(c => c.active).map(c =>
    `<option value="${c.path}" ${item && item.category === c.path ? 'selected' : ''}>${c.path}</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? t('settings.quickexp.modal.title_edit', {}, 'Edit <span class="accent">Quick Expense</span>') : t('settings.quickexp.modal.title_add', {}, 'Add <span class="accent">Quick Expense</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field" class="fx2"><label>${t('settings.quickexp.modal.label_name_chip', {}, 'Name (shown as chip)')}</label>
          <input type="text" id="qm-name" value="${escapeHtml(item?.name || '')}" placeholder="${t('settings.quickexp.modal.placeholder_name', {}, 'Vegetables')}">
        </div>
        <div class="atx-field" class="fx1"><label>${t('common.status.active', {}, 'Active')}</label>
          <select id="qm-active">
            <option value="true" ${!item || item.active === 'true' ? 'selected' : ''}>${t('common.status.active', {}, 'Active')}</option>
            <option value="false" ${item?.active === 'false' ? 'selected' : ''}>${t('common.status.inactive', {}, 'Inactive')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>${t('common.col.account', {}, 'Account')}</label>
          <select id="qm-account"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option>${accOptions}</select>
        </div>
        <div class="atx-field" class="fx1"><label>${t('common.col.payee', {}, 'Payee')}</label>
          <input type="text" id="qm-payee" value="${escapeHtml(item?.payee || '')}">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>${t('common.col.category', {}, 'Category')}</label>
          <select id="qm-category"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option>${catOptions}</select>
        </div>
        <div class="atx-field" class="fx1"><label>${t('common.col.tags', {}, 'Tags')}</label>
          <div id="qm-tags-wrap" style="display:flex;flex-wrap:wrap;gap:6px;padding:6px 0;">
            ${(ctx.tags || []).map(tag => {
              const checked = item && (item.tags || '').split(';').includes(tag.tag);
              return `<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;">
                <input type="checkbox" class="qm-tag-cb" value="${escapeHtml(tag.tag)}" ${checked ? 'checked' : ''}> ${escapeHtml(tag.tag)}
              </label>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>${t('common.col.type', {}, 'Type')}</label>
          <select id="qm-type">
            <option value="expense" ${!item || item.type !== 'income' ? 'selected' : ''}>${t('common.type.expense', {}, 'Expense')}</option>
            <option value="income" ${item?.type === 'income' ? 'selected' : ''}>${t('common.type.income', {}, 'Income')}</option>
          </select>
        </div>
        <div class="atx-field" class="fx1"><label>${t('common.label.note', {}, 'Note')}</label>
          <input type="text" id="qm-note" value="${escapeHtml(item?.note || '')}">
        </div>
      </div>
      <div id="qm-status"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button onclick="closeModal()">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" onclick="saveQuickExp(${isEdit ? `'${editId}'` : 'null'})">${isEdit ? t('common.actions.save', {}, 'Save') : t('common.actions.add', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function saveQuickExp(editId) {
  const data = {
    name: document.getElementById('qm-name').value.trim(),
    account: document.getElementById('qm-account').value,
    payee: document.getElementById('qm-payee').value.trim(),
    category: document.getElementById('qm-category').value,
    tags: [...document.querySelectorAll('.qm-tag-cb:checked')].map(cb => cb.value).join(';'),
    type: document.getElementById('qm-type').value,
    note: document.getElementById('qm-note').value.trim(),
    active: document.getElementById('qm-active').value,
  };
  if (!data.name || !data.account) {
    document.getElementById('qm-status').innerHTML = `<div class="atx-status error">${t('settings.quickexp.modal.err_required', {}, 'Name and account are required')}</div>`;
    return;
  }

  const statusEl = document.getElementById('qm-status');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('common.saving', {}, 'Saving...')}</div>`;

  try {
    const endpoint = editId ? '/api/quickexp/update' : '/api/quickexp/add';
    const body = editId ? { id: editId, updated: data } : data;
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderQuickExpTab();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

async function deleteQuickExp(qeId) {
  if (!confirm(t('settings.quickexp.modal.confirm_delete', { qeId }, `Delete quick expense "${qeId}"?`))) return;
  try {
    await fetch('/api/quickexp/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: qeId }) });
    renderQuickExpTab();
  } catch (e) {}
}

// ─── ATM Fees Settings Tab ───────────────────────────────────────────────

async function renderAtmFeesTab() {
  const container = document.getElementById('settings-tab-content');
  container.innerHTML = `<div class="loading">${escapeHtml(t('settings.atmfees.loading', {}, 'Loading ATM fees...'))}</div>`;

  let items = [];
  try {
    const res = await fetch('/api/atm-fees/list', { method: 'POST' });
    const data = await res.json();
    items = data.atm_fees || [];
  } catch (e) { container.innerHTML = `<div class="atx-status error">${escapeHtml(t('settings.atmfees.load_failed', { msg: e.message }, `Failed to load ATM fees: ${e.message}`))}</div>`; return; }

  const active = items.filter(i => i.active === 'true');
  const inactive = items.filter(i => i.active !== 'true');

  const labelActive = t('common.status.active', {}, 'Active');
  const labelInactive = t('common.status.inactive', {}, 'Inactive');
  const labelEdit = t('common.actions.edit', {}, 'Edit');
  const labelDelete = t('common.actions.delete', {}, 'Delete');

  let html = `
    <div class="flex-row gap-md mb-20">
      <span class="hint-md">${t('settings.atmfees.count_html', { active: active.length, inactive: inactive.length }, `${active.length} active, ${inactive.length} inactive — preset fees for <code>TX atm</code>`)}</span>
      <button class="btn-save" onclick="showAtmFeeModal()" style="padding:8px 16px;font-size:11px;">${t('settings.atmfees.add', {}, '+ Add ATM Fee')}</button>
    </div>
    <div class="section">
      <table class="tx-table"><thead><tr>
        <th>${t('settings.atmfees.col_bank', {}, 'Bank')}</th><th>${t('common.col.amount', {}, 'Amount')}</th><th>${t('common.col.currency', {}, 'Currency')}</th><th>${t('settings.atmfees.col_fee_net', {}, 'Fee (net)')}</th><th>${t('settings.atmfees.col_levy', {}, 'Levy')}</th><th>${t('settings.atmfees.col_vat', {}, 'VAT %')}</th><th>${t('settings.atmfees.col_total', {}, 'Total')}</th><th>${t('settings.atmfees.col_note', {}, 'Note')}</th><th>${labelActive}</th><th></th>
      </tr></thead><tbody>`;
  items.forEach(f => {
    const feeNet = parseFloat(f.fee_net) || 0;
    const levy = parseFloat(f.levy) || 0;
    const vatRate = parseFloat(f.vat_rate) || 0;
    const vat = feeNet * vatRate;
    const total = feeNet + levy + vat;
    html += `<tr>
      <td>${escapeHtml(f.bank)}</td>
      <td class="fs-10">${formatCurrency(parseFloat(f.amount) || 0, f.currency || 'TZS')}</td>
      <td class="fs-10">${escapeHtml(f.currency || 'TZS')}</td>
      <td class="fs-10">${formatCurrency(feeNet, f.currency || 'TZS')}</td>
      <td class="fs-10">${formatCurrency(levy, f.currency || 'TZS')}</td>
      <td class="fs-10">${(vatRate * 100).toFixed(1)}%</td>
      <td class="fs-10">${formatCurrency(total, f.currency || 'TZS')}</td>
      <td class="hint-sm">${escapeHtml(f.note || '')}</td>
      <td><button style="font-size:10px;padding:3px 8px;" onclick="toggleAtmFee('${f.id}', '${f.active}')">${f.active === 'true' ? labelActive : labelInactive}</button></td>
      <td>
        <button class="tx-edit-btn" onclick="showAtmFeeModal('${f.id}')" title="${labelEdit}">${labelEdit}</button>
        <button class="tx-edit-btn c-neg" onclick="deleteAtmFee('${f.id}')" title="${labelDelete}">${labelDelete}</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  html += `<div class="hint-sm" style="margin-top:12px;">${t('settings.atmfees.footer_html', {}, '<strong>How it works:</strong> <code>TX atm 400k crdb</code> looks up the matching row (bank + amount). Claude generates 4 bookings: transfer (amount, tag <code>ATM</code>), fee_net, levy, and VAT (= fee_net × vat_rate). Unknown amounts trigger a follow-up question.')}</div>`;
  container.innerHTML = html;
}

async function toggleAtmFee(feeId, active) {
  await fetch('/api/atm-fees/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: feeId, updated: { active: active === 'true' ? 'false' : 'true' } }),
  });
  renderAtmFeesTab();
}

async function showAtmFeeModal(editId) {
  const ctx = await loadTxContext();
  let item = null;
  if (editId) {
    try {
      const res = await fetch('/api/atm-fees/list', { method: 'POST' });
      const data = await res.json();
      item = (data.atm_fees || []).find(f => f.id === editId);
    } catch (e) {}
  }
  const isEdit = !!item;
  const activeAccounts = ctx.accounts.filter(a => a.status === 'active');
  // Bank selector = account alias — bank is free text but prefilled with common aliases
  const accOptions = activeAccounts.map(a =>
    `<option value="${a.alias}" ${item && item.bank === a.alias ? 'selected' : ''}>${a.alias} — ${a.name} [${a.currency}]</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? t('settings.atmfees.modal.title_edit', {}, 'Edit <span class="accent">ATM Fee</span>') : t('settings.atmfees.modal.title_add', {}, 'Add <span class="accent">ATM Fee</span>')}</h3>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>${t('settings.atmfees.modal.label_bank', {}, 'Bank (account alias)')}</label>
          <select id="af-bank"><option value="">${t('common.select_placeholder', {}, 'Select...')}</option>${accOptions}</select>
        </div>
        <div class="atx-field" class="fx1"><label>${t('common.status.active', {}, 'Active')}</label>
          <select id="af-active">
            <option value="true" ${!item || item.active === 'true' ? 'selected' : ''}>${t('common.status.active', {}, 'Active')}</option>
            <option value="false" ${item?.active === 'false' ? 'selected' : ''}>${t('common.status.inactive', {}, 'Inactive')}</option>
          </select>
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>${t('settings.atmfees.modal.label_withdrawal_amount', {}, 'Withdrawal amount')}</label>
          <input type="number" id="af-amount" step="1" value="${escapeHtml(item?.amount || '')}" placeholder="400000">
        </div>
        <div class="atx-field" class="fx1"><label>${t('common.col.currency', {}, 'Currency')}</label>
          <input type="text" id="af-currency" value="${escapeHtml(item?.currency || 'TZS')}" placeholder="TZS">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx1"><label>${t('settings.atmfees.modal.label_fee_net', {}, 'Fee (net, pre-VAT)')}</label>
          <input type="number" id="af-fee-net" step="0.01" value="${escapeHtml(item?.fee_net || '')}" placeholder="1864">
        </div>
        <div class="atx-field" class="fx1"><label>${t('settings.atmfees.modal.label_levy', {}, 'Levy / transaction tax')}</label>
          <input type="number" id="af-levy" step="0.01" value="${escapeHtml(item?.levy || '')}" placeholder="982">
        </div>
        <div class="atx-field" class="fx1"><label>${t('settings.atmfees.modal.label_vat_rate', {}, 'VAT rate')}</label>
          <input type="number" id="af-vat-rate" step="0.01" value="${escapeHtml(item?.vat_rate || '0.18')}" placeholder="0.18">
        </div>
      </div>
      <div class="atx-row">
        <div class="atx-field" class="fx2"><label>${t('common.label.note', {}, 'Note')}</label>
          <input type="text" id="af-note" value="${escapeHtml(item?.note || '')}" placeholder="${t('settings.atmfees.modal.placeholder_note', {}, 'Tier description, source, etc.')}">
        </div>
      </div>
      <div class="hint-sm" style="margin-top:8px;">
        ${t('settings.atmfees.modal.vat_hint', {}, "VAT = fee_net × vat_rate is computed at booking time — don't enter it separately.")}
      </div>
      <div id="af-status"></div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button onclick="closeModal()">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button class="btn-save" onclick="saveAtmFee(${isEdit ? `'${editId}'` : 'null'})">${isEdit ? t('common.actions.save', {}, 'Save') : t('common.actions.add', {}, 'Add')}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

async function saveAtmFee(editId) {
  const data = {
    bank: document.getElementById('af-bank').value,
    amount: document.getElementById('af-amount').value.trim(),
    currency: document.getElementById('af-currency').value.trim() || 'TZS',
    fee_net: document.getElementById('af-fee-net').value.trim() || '0',
    levy: document.getElementById('af-levy').value.trim() || '0',
    vat_rate: document.getElementById('af-vat-rate').value.trim() || '0',
    note: document.getElementById('af-note').value.trim(),
    active: document.getElementById('af-active').value,
  };
  const statusEl = document.getElementById('af-status');
  if (!data.bank || !data.amount) {
    statusEl.innerHTML = `<div class="atx-status error">${t('settings.atmfees.modal.err_required', {}, 'Bank and Amount are required')}</div>`;
    return;
  }
  const endpoint = editId ? '/api/atm-fees/update' : '/api/atm-fees/add';
  const body = editId ? { id: editId, updated: data } : data;
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(result.error)}</div>`; return; }
    closeModal();
    renderAtmFeesTab();
  } catch (e) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(e.message)}</div>`; }
}

async function deleteAtmFee(feeId) {
  if (!confirm(t('settings.atmfees.modal.confirm_delete', { feeId }, `Delete ATM fee preset "${feeId}"?`))) return;
  try {
    await fetch('/api/atm-fees/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: feeId }) });
    renderAtmFeesTab();
  } catch (e) {}
}

// ─── Boot (must be last — all modules loaded) ────────────────────────────
boot();

