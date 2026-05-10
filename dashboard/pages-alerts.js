// ─── Alerts Page ─────────────────────────────────────────────────────────

async function computeAlerts() {
  const alerts = [];
  const today = new Date().toISOString().slice(0, 10);

  // 1. Overdue Scheduled TX
  try {
    const res = await fetch('/api/scheduled/list', { method: 'POST' });
    if (res.ok) {
      // API returns { scheduled: [...] }; tolerate a bare array for safety.
      const data = await res.json();
      const scheduled = Array.isArray(data) ? data : (data && data.scheduled) || [];
      scheduled.forEach(s => {
        if (s.active === true || s.active === 'true') {
          if (s.next_run && s.next_run <= today) {
            alerts.push({
              type: 'scheduled',
              severity: 'warning',
              title: 'Overdue Scheduled TX: ' + (s.name || s.sched_id),
              detail: `Due since ${s.next_run} — ${s.payee || ''} ${formatCurrency(s.amount, s.currency)}`,
              link: '#settings'
            });
          }
        }
      });
    }
  } catch (e) { /* API not available */ }

  // 2. Negative Balances
  if (state.accounts && state.balances) {
    state.accounts.forEach(acc => {
      if (acc.owner === 'self' && acc.status === 'active' && acc.type !== 'credit_card') {
        const bal = state.balances[acc.alias];
        if (bal !== undefined && (bal < -0.01 || (acc.type === 'pass_through' && Math.abs(bal) > 0.01))) {
          alerts.push({
            type: 'balance',
            severity: 'warning',
            title: 'Negative Balance: ' + (acc.name || acc.alias),
            detail: `${formatCurrency(bal, acc.currency)} ${acc.currency}`,
            link: '#account:' + acc.alias
          });
        }
      }
    });
  }

  // 3. Old Open Debts (> 30 days)
  if (state.thirdParty) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);
    state.thirdParty.forEach(d => {
      const settled = d.settled === true || d.settled === 'true' || d.settled === 'TRUE';
      if (!settled && d.date_created && d.date_created <= cutoff) {
        alerts.push({
          type: 'debt',
          severity: 'info',
          title: 'Open Debt > 30 days: ' + (d.party || d.description || d.id),
          detail: `Created ${d.date_created} — ${formatCurrency(d.amount_original || d.amount, d.currency)}`,
          link: '#debts'
        });
      }
    });
  }

  // 4. High Monthly Spending (current month > 150% of avg last 3 months)
  if (state.tx.length && state.accounts) {
    const now = new Date();
    const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const selfAliases = new Set(state.accounts.filter(a => a.owner === 'self').map(a => a.alias));

    const selfExpenses = state.tx.filter(t => t.type === 'expense' && selfAliases.has(t.account));

    // Get monthly totals for last 4 months (current + 3 prior)
    const monthTotals = {};
    selfExpenses.forEach(t => {
      const ym = (t.date || '').slice(0, 7);
      if (!ym) return;
      // Convert to TZS for comparison
      let amt = parseFloat(t.amount) || 0;
      const rate = fxRates[t.currency] || 1;
      amt *= rate;
      monthTotals[ym] = (monthTotals[ym] || 0) + amt;
    });

    const curTotal = monthTotals[curYM] || 0;
    // Get 3 months before current
    const priorMonths = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (monthTotals[ym] !== undefined) priorMonths.push(monthTotals[ym]);
    }
    if (priorMonths.length >= 2 && curTotal > 0) {
      const avg = priorMonths.reduce((a, b) => a + b, 0) / priorMonths.length;
      if (avg > 0 && curTotal > avg * 1.5) {
        const pct = Math.round((curTotal / avg) * 100);
        alerts.push({
          type: 'spending',
          severity: 'warning',
          title: 'High Monthly Spending',
          detail: `Current month is ${pct}% of the ${priorMonths.length}-month average (${formatCurrency(curTotal, 'TZS')} vs avg ${formatCurrency(Math.round(avg), 'TZS')})`,
          link: '#reports'
        });
      }
    }
  }


  // 5. Fuel reconciliation findings (only if vehicles feature enabled)
  if (typeof isFeatureEnabled === 'function' && isFeatureEnabled('vehicles')) {
    try {
      const res = await fetch('/api/fuel/list', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const r = data.reconciliation || {};
        const unlinked = (r.unlinked_fuel_txs || []).length;
        const orphans = (r.orphaned_log_entries || []).length;
        const dupes = (r.duplicate_links || []).length;
        if (unlinked > 0) {
          const newest = r.unlinked_fuel_txs[0];
          alerts.push({
            type: 'fuel',
            severity: 'info',
            title: `${unlinked} fuel TX${unlinked === 1 ? '' : 's'} without log entry`,
            detail: `Newest: ${newest.date} · ${newest.payee || ''} · ${newest.account || ''} — open Vehicles to backfill.`,
            link: '#vehicles',
          });
        }
        if (orphans > 0) {
          const newest = r.orphaned_log_entries[0];
          alerts.push({
            type: 'fuel',
            severity: 'warning',
            title: `${orphans} orphaned fuel log entr${orphans === 1 ? 'y' : 'ies'}`,
            detail: `Newest: ${newest.fuel_id} · ${newest.date} — linked TX is missing.`,
            link: '#vehicles',
          });
        }
        if (dupes > 0) {
          alerts.push({
            type: 'fuel',
            severity: 'warning',
            title: `${dupes} duplicate fuel TX link${dupes === 1 ? '' : 's'}`,
            detail: 'Two fuel-log rows share an import_id — needs manual cleanup in data/fuel_log.csv.',
            link: '#vehicles',
          });
        }
      }
    } catch (e) { /* feature disabled or API down */ }
  }


  // 6. Over-budget categories (current month, only when budgets enabled)
  if (localStorage.getItem('lp-budgets-enabled') === 'true' && Array.isArray(state.budgets) && state.budgets.length && state.tx) {
    const month = state.currentMonth;
    if (month) {
      const monthExpenses = state.tx.filter(t => t.type === 'expense' && t.date && t.date.startsWith(month));
      state.budgets.forEach(b => {
        const matching = monthExpenses.filter(t => (t.category || '').startsWith(b.category));
        const spent = matching.reduce((s, t) => s + convertToTZS(t.amount, t.currency), 0);
        const targetTzs = convertToTZS(b.amount, b.currency);
        if (targetTzs > 0 && spent > targetTzs) {
          const pct = Math.round((spent / targetTzs) * 100);
          alerts.push({
            type: 'budget',
            severity: 'warning',
            title: `Over budget: ${b.category} (${pct}%)`,
            detail: `${formatCurrency(spent, 'TZS')} TZS spent vs ${formatCurrency(targetTzs, 'TZS')} TZS budget for ${month}`,
            link: '#reports/budgetactual',
          });
        }
      });
    }
  }

  // 6. Property drift alerts (LUKU/Water — kWh spike, missed water, …)
  // Computed server-side because the math needs the full LUKU + Water
  // history and the dashboard would otherwise have to fetch it just
  // for this aggregate.
  try {
    const res = await fetch('/api/properties/alerts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (res.ok) {
      const data = await res.json();
      const propAlerts = Array.isArray(data.alerts) ? data.alerts : [];
      for (const a of propAlerts) alerts.push(a);
    }
  } catch (e) { /* API not available — ignore */ }

  // Migration nudge: pre-1.3.0 installs never wrote `config/reports.json`,
  // which means several reports filter on stale category names and silently
  // return empty. The setup-step-6 wizard creates this file for fresh
  // installs; existing 1.2.x users need a one-time pointer to Settings →
  // Reports. The alert is dismissable per-install (localStorage flag) so
  // it never shouts twice.
  if (
    Array.isArray(state.tx) && state.tx.length > 0
    && !localStorage.getItem('financeos.reports-config-banner-dismissed')
  ) {
    try {
      const res = await fetch('/api/reports-config/get', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.file_exists === false) {
          alerts.push({
            type: 'reports_config_migration',
            severity: 'info',
            title: t('alerts.reports_config.title', {}, 'Reports may filter the wrong categories'),
            detail: t(
              'alerts.reports_config.detail',
              {},
              'Some reports filter by category — open Settings → Reports to map yours, or click Dismiss if you don\'t use those reports.',
            ),
            link: '#settings/reports',
            dismissable: 'reports-config-banner-dismissed',
          });
        }
      }
    } catch (e) { /* offline or endpoint missing — ignore */ }
  }

  state.alerts = alerts;
  updateAlertsBadge();
}

function updateAlertsBadge() {
  const badge = document.getElementById('alerts-badge');
  const badgeTopbar = document.getElementById('alerts-badge-topbar');
  const count = state.alerts.length;
  if (badgeTopbar) {
    badgeTopbar.style.display = count > 0 ? 'inline-block' : 'none';
  }
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
  }
}

function renderAlertsPage() {
  const contentEl = document.getElementById('alerts-content');
  const alerts = state.alerts || [];

  if (alerts.length === 0) {
    contentEl.innerHTML = `
      <div class="section empty-state">
        <div class="empty-state-icon">&#x2705;</div>
        <div class="empty-state-title">All clear</div>
        <div class="empty-state-desc">${t('pages.alerts.empty', {}, 'No alerts or warnings right now.')}</div>
      </div>
    `;
    return;
  }

  // Group by severity: warning first, then info
  const warnings = alerts.filter(a => a.severity === 'warning');
  const infos = alerts.filter(a => a.severity === 'info');

  let html = '';
  const renderGroup = (items, label) => {
    if (items.length === 0) return '';
    const borderColor = items[0].severity === 'warning' ? 'var(--warn)' : 'var(--accent)';
    let h = `<div class="section"><h3>${label}</h3>`;
    items.forEach(a => {
      const dismissBtn = a.dismissable
        ? `<button type="button" class="alert-dismiss" data-dismiss-key="${escapeHtml(a.dismissable)}" aria-label="${escapeHtml(t('pages.alerts.dismiss', {}, 'Dismiss'))}" style="background:transparent;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:0 6px;line-height:1;align-self:flex-start;margin-left:8px;">×</button>`
        : '';
      h += `
        <div class="alert-card" data-link="${escapeHtml(a.link || '')}" role="link" tabindex="0" aria-label="${escapeHtml(a.title)}" style="display:flex;gap:0;margin-bottom:8px;border-radius:var(--radius);overflow:hidden;background:var(--surface);cursor:pointer;border:1px solid var(--border);transition:border-color 0.15s;">
          <div style="width:4px;min-height:100%;background:${borderColor};flex-shrink:0;"></div>
          <div style="padding:12px 16px;flex:1;display:flex;align-items:flex-start;">
            <div style="flex:1;">
              <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${escapeHtml(a.title)}</div>
              <div class="hint-md">${escapeHtml(a.detail)}</div>
            </div>
            ${dismissBtn}
          </div>
        </div>
      `;
    });
    h += '</div>';
    return h;
  };

  html += renderGroup(warnings, 'Warnings');
  html += renderGroup(infos, 'Info');
  contentEl.innerHTML = html;

  // Event delegation for alert cards. Keyboard users get Enter/Space
  // activation so the role="link"/tabindex="0" affordance works the
  // same as the mouse click.
  if (!contentEl._delegated) {
    const activate = (card) => { if (card) location.hash = card.getAttribute('data-link'); };
    contentEl.addEventListener('click', (e) => {
      // Dismiss-button clicks must NOT bubble up to the card link — handle
      // them first and stop propagation so we don't navigate AND dismiss.
      const dismiss = e.target.closest('.alert-dismiss');
      if (dismiss) {
        e.stopPropagation();
        const key = dismiss.dataset.dismissKey;
        if (key) localStorage.setItem(`financeos.${key}`, '1');
        // Re-render: drop the dismissed alert from state and refresh.
        if (Array.isArray(state.alerts)) {
          state.alerts = state.alerts.filter(a => a.dismissable !== key);
        }
        renderAlertsPage();
        if (typeof updateAlertsBadge === 'function') updateAlertsBadge();
        return;
      }
      activate(e.target.closest('.alert-card[data-link]'));
    });
    contentEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest && e.target.closest('.alert-card[data-link]');
      if (card) {
        e.preventDefault();
        activate(card);
      }
    });
    contentEl._delegated = true;
  }

  document.getElementById('alerts-meta').textContent = `${alerts.length} alert${alerts.length !== 1 ? 's' : ''}`;
}
