// ─── Cash Count (spec: docs/superpowers/specs/2026-07-19-cash-count-design.md) ───
// Count physical cash, enter the counted balance, and the backend books the
// discrepancy via /api/cashcount/confirm. The modal opens from the Accounts
// card on the Dashboard. The Settings tab renderer lives here too (dispatched
// from pages-settings.js) so the whole subsystem stays in one file.

let _ccCtx = null;       // /api/cashcount/context payload while the modal is open
let _ccInstance = null;  // openModal() handle

function _ccDaysAgo(dateStr) {
  const days = Math.max(0, Math.floor(
    (Date.now() - new Date(dateStr + 'T00:00:00').getTime()) / 86400000));
  if (days === 0) return t('cashcount.today', {}, 'today');
  return t('cashcount.days_ago', { n: days }, `${days}d ago`);
}

// TZS renders with 0 decimals in formatCurrency — inside the count modal a
// hidden fractional book balance would silently book a sub-unit diff, so
// show 2 decimals whenever the value has cents.
function _ccFmtAmount(v, currency) {
  const cents = Math.round(v * 100) / 100;
  if (Math.round(cents) !== cents) {
    return cents.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return formatCurrency(v, currency);
}

// Live diff preview for one input; returns the parsed value (NaN = invalid).
function _ccUpdateDiff(idx) {
  const acc = _ccCtx.accounts[idx];
  const input = _ccInstance.modal.querySelector(`[data-cc-input="${idx}"]`);
  const cell = _ccInstance.modal.querySelector(`[data-cc-diff="${idx}"]`);
  const raw = input.value.trim();
  if (!raw) { cell.textContent = ''; cell.className = 'td-amount'; return null; }
  const counted = parseAmountInput(raw);
  if (isNaN(counted) || counted < 0) {
    cell.textContent = '?';
    cell.className = 'td-amount c-warn';
    return NaN;
  }
  const diff = Math.round((counted - acc.expected) * 100) / 100;
  if (diff === 0) {
    cell.textContent = t('cashcount.matches', {}, 'matches');
    cell.className = 'td-amount c-mut';
  } else {
    cell.textContent = (diff > 0 ? '+' : '') + _ccFmtAmount(diff, acc.currency);
    cell.className = 'td-amount ' + (diff < 0 ? 'cc-diff-neg' : 'cc-diff-pos');
  }
  return counted;
}

async function openCashCountModal() {
  let ctx;
  try {
    const res = await fetch('/api/cashcount/context', { method: 'POST' });
    ctx = await res.json();
    if (!res.ok || !ctx.success) throw new Error(ctx.error || res.statusText);
  } catch (err) {
    uiAlert(t('cashcount.load_failed', {}, 'Could not load cash count data: ') + err.message);
    return;
  }
  if (!ctx.accounts.length) {
    uiAlert(t('cashcount.no_accounts', {}, 'No accounts configured — see Settings → Cash Count.'));
    return;
  }
  _ccCtx = ctx;
  const today = localTodayIso();
  const rowsHtml = ctx.accounts.map((a, i) => `
    <tr>
      <td>${escapeHtml(a.name)} <span class="acc-currency">${escapeHtml(a.currency)}</span></td>
      <td class="td-amount" data-cc-expected="${i}">${_ccFmtAmount(a.expected, a.currency)}</td>
      <td class="fs-11 c-mut">${a.last_counted ? _ccDaysAgo(a.last_counted) : t('cashcount.never', {}, 'never')}</td>
      <td><input type="text" class="input-sm" data-cc-input="${i}" inputmode="decimal" autocomplete="off"></td>
      <td class="td-amount" data-cc-diff="${i}"></td>
    </tr>`).join('');
  const bodyHtml = `
    <label class="lbl-block mb-8">${t('common.table.date', {}, 'Date')}
      <input type="date" class="input-std" name="date" value="${today}" required></label>
    <div class="cc-table-wrap">
      <table class="cc-table">
        <thead><tr>
          <th class="th-left">${t('cashcount.col_account', {}, 'Account')}</th>
          <th>${t('cashcount.col_expected', {}, 'Book balance')}</th>
          <th>${t('cashcount.col_last', {}, 'Last counted')}</th>
          <th>${t('cashcount.col_counted', {}, 'Counted')}</th>
          <th>${t('cashcount.col_diff', {}, 'Diff')}</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="fs-11 c-mut mt-8">${t('cashcount.hint', {}, 'Leave an account empty to skip it. A zero diff is logged without booking.')}</div>`;
  _ccInstance = openModal({
    title: t('cashcount.title', {}, 'Cash Count'),
    bodyHtml,
    maxWidth: '640px',
    submitLabel: t('cashcount.book', {}, 'Book'),
    onSubmit: _ccSubmit,
    onClose: () => { _ccCtx = null; _ccInstance = null; },
  });
  _ccInstance.modal.querySelectorAll('[data-cc-input]').forEach(inp => {
    inp.addEventListener('input', () => _ccUpdateDiff(Number(inp.dataset.ccInput)));
  });
}
window.openCashCountModal = openCashCountModal;

async function _ccSubmit(form) {
  // Capture the handles at submit start — the user can close the modal
  // (Esc/backdrop/×) while the confirm request is in flight; onClose nulls
  // the module state, but the outcome must still be applied + refreshed.
  const inst = _ccInstance;
  const ctx = _ccCtx;
  try {
    const rows = [];
    for (let i = 0; i < ctx.accounts.length; i++) {
      const a = ctx.accounts[i];
      const input = inst.modal.querySelector(`[data-cc-input="${i}"]`);
      if (input.disabled || !input.value.trim()) continue;
      const counted = parseAmountInput(input.value.trim());
      if (isNaN(counted) || counted < 0) {
        uiAlert(t('cashcount.bad_amount', { name: a.name }, `Invalid amount for ${a.name}`));
        return;
      }
      rows.push({ account: a.alias, counted, expected_client: a.expected });
    }
    if (!rows.length) {
      uiAlert(t('cashcount.nothing_entered', {}, 'Enter at least one counted balance.'));
      return;
    }
    const payload = {
      date: new FormData(form).get('date'),
      // Fresh per attempt on purpose: the server-side stale-expected check
      // is the resubmit guard; client_id only covers transport retries.
      client_id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
      rows,
    };
    const res = await fetch('/api/cashcount/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || res.statusText);

    // Modal may have been closed mid-flight — keep data effects, skip DOM.
    const closed = !inst.modal.isConnected;
    let staleCount = 0;
    (data.results || []).forEach(r => {
      const idx = ctx.accounts.findIndex(a => a.alias === r.account);
      if (idx < 0) return;
      const cur = ctx.accounts[idx].currency;
      if (r.status === 'booked' || r.status === 'logged_only') {
        ctx.accounts[idx].expected = r.counted;
      } else if (r.status === 'rejected_stale') {
        staleCount++;
        ctx.accounts[idx].expected = r.expected;
      } else if (r.status === 'rejected_invalid') {
        staleCount++;
      }
      if (closed) return;
      const input = inst.modal.querySelector(`[data-cc-input="${idx}"]`);
      const diffCell = inst.modal.querySelector(`[data-cc-diff="${idx}"]`);
      const expCell = inst.modal.querySelector(`[data-cc-expected="${idx}"]`);
      if (r.status === 'booked' || r.status === 'logged_only') {
        expCell.textContent = _ccFmtAmount(r.counted, cur);
        input.disabled = true;
        diffCell.textContent = r.status === 'booked'
          ? t('cashcount.booked', {}, 'booked ✓')
          : t('cashcount.logged', {}, 'logged ✓');
        diffCell.className = 'td-amount c-mut';
      } else if (r.status === 'rejected_stale') {
        expCell.textContent = _ccFmtAmount(r.expected, cur);
        _ccUpdateDiff(idx);
      } else if (r.status === 'rejected_invalid') {
        diffCell.textContent = r.error || 'invalid';
        diffCell.className = 'td-amount c-warn';
      }
    });
    // Booked/logged rows changed data — refresh regardless of stale rows.
    await refreshData();
    if (closed) return;
    if (staleCount) {
      uiAlert(t('cashcount.stale_hint', {},
        'The book balance changed for some accounts — values refreshed. Re-check and book again.'));
      return; // keep modal open
    }
    inst.close();
  } catch (err) {
    uiAlert(t('cashcount.failed', {}, 'Cash count failed: ') + err.message);
  }
}

// ── Settings → Cash Count ───────────────────────────────────────────────

function renderCashCountTab() {
  const container = document.getElementById('settings-tab-content');
  const cfg = (window.DEFAULTS && window.DEFAULTS.cash_count) || {};
  const selected = new Set(cfg.accounts || []);
  const eligible = (state.accounts || []).filter(a =>
    a.owner === 'self' && a.status === 'active' && a.type !== 'pass_through');
  const catOpts = (type, current) => (state.categories || [])
    .filter(c => c.type === type && c.active !== 'false')
    .map(c => `<option value="${escapeHtml(c.path)}" ${c.path === current ? 'selected' : ''}>${escapeHtml(c.path)}</option>`)
    .join('');
  container.innerHTML = `
    <div class="fw-600 mb-8">${t('settings.cashcount.title', {}, 'Cash Count')}</div>
    <div class="fs-11 c-mut mb-12">${t('settings.cashcount.intro', {}, 'Accounts offered in the count modal and the categories that receive the discrepancy bookings.')}</div>
    <div class="lbl-block mb-8">${t('settings.cashcount.accounts_label', {}, 'Accounts in the count modal')}</div>
    ${eligible.map(a => `
      <label class="chk-row">
        <input type="checkbox" data-cc-acc="${escapeHtml(a.alias)}" ${selected.has(a.alias) ? 'checked' : ''}>
        ${escapeHtml(a.name)} <span class="c-mut fs-11">(${escapeHtml(a.alias)})</span>
      </label>`).join('')}
    <div class="grid-2col mt-16">
      <label class="lbl-block">${t('settings.cashcount.expense_cat', {}, 'Shortfall category (expense)')}
        <select id="cc-expense-cat" class="input-std">${catOpts('expense', cfg.expense_category)}</select></label>
      <label class="lbl-block">${t('settings.cashcount.income_cat', {}, 'Surplus category (income)')}
        <select id="cc-income-cat" class="input-std">${catOpts('income', cfg.income_category)}</select></label>
    </div>
    <div class="form-actions">
      <button class="btn-accent" data-action="saveCashCountSettings">${t('common.actions.save', {}, 'Save')}</button>
      <span id="cc-settings-status" class="fs-11 c-mut"></span>
    </div>`;
}
window.renderCashCountTab = renderCashCountTab;

async function saveCashCountSettings() {
  const container = document.getElementById('settings-tab-content');
  const status = document.getElementById('cc-settings-status');
  const accounts = [...container.querySelectorAll('[data-cc-acc]')]
    .filter(cb => cb.checked).map(cb => cb.dataset.ccAcc);
  const payload = { config: {
    accounts,
    expense_category: document.getElementById('cc-expense-cat').value,
    income_category: document.getElementById('cc-income-cat').value,
  } };
  try {
    const res = await fetch('/api/cashcount/settings/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
    window.DEFAULTS.cash_count = data.config;
    // Targeted re-render — never boot(), it resets settingsTab.
    renderCashCountTab();
    document.getElementById('cc-settings-status').textContent =
      t('settings.cashcount.saved', {}, 'Saved ✓');
  } catch (err) {
    status.textContent = t('settings.cashcount.save_failed', {}, 'Save failed: ') + err.message;
  }
}
window.saveCashCountSettings = saveCashCountSettings;
