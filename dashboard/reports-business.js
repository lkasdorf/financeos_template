function exportBusinessAccounting(entityId, year) {
  const entity = getBusinessByTag(getBusinessEntities().find(e => e.id === entityId)?.tag) || getBusinessEntities().find(e => e.id === entityId);
  if (!entity) { uiAlert(t('reports.kf.err.no_entity', { id: entityId }, `Business entity '${entityId}' not configured`)); return; }
  // Pass-through accounts only — custody-style accounts are excluded
  // because they aren't reimbursed; only accounts with type=pass_through
  // generate the expense → reimbursement counter-entry pairs that this
  // export is built around. Filter is config-driven via accounts.csv.
  const accountAliases = (entity.accounts || []).filter(alias => {
    const acc = (state.accounts || []).find(a => a.alias === alias);
    return acc && acc.type === 'pass_through';
  });
  const expenses = state.tx.filter(t =>
    (t.type === 'expense' || t.type === 'transfer') && accountAliases.includes(t.account) && t.date && t.date.startsWith(year)
  ).sort((a, b) => a.date.localeCompare(b.date));

  const detail = expenses.map(t => ({
    Date: t.date,
    Account: t.account,
    Payee: t.payee || '',
    Category: t.category || '',
    Amount: t.amount,
    Currency: t.currency,
    'Amount TZS': convertToTZS(t.amount, t.currency),
    Note: t.note || '',
    Tags: t.tags || '',
  }));

  // Monthly summary
  const months = {};
  for (const t of expenses) {
    const ym = t.date.slice(0, 7);
    if (!months[ym]) months[ym] = { Month: ym, Expenses: 0, TX_Count: 0 };
    months[ym].Expenses += convertToTZS(t.amount, t.currency);
    months[ym].TX_Count++;
  }
  const summary = Object.values(months).sort((a, b) => a.Month.localeCompare(b.Month));
  summary.push({
    Month: 'TOTAL',
    Expenses: summary.reduce((s, m) => s + m.Expenses, 0),
    TX_Count: summary.reduce((s, m) => s + m.TX_Count, 0),
  });

  // Category breakdown
  const cats = {};
  for (const t of expenses) {
    const c = t.category || '(other)';
    cats[c] = (cats[c] || 0) + convertToTZS(t.amount, t.currency);
  }
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ Category: c, 'Amount TZS': v }));

  if (typeof XLSX === 'undefined') { uiAlert(t('reports.export.err_no_xlsx', {}, 'XLSX library not loaded')); return; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Monthly Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catRows), 'By Category');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'All Transactions');
  const safeLabel = entity.label.replace(/[^A-Za-z0-9_]/g, '');
  XLSX.writeFile(wb, `${safeLabel}_Business_${year}.xlsx`);
}

// ─── Business Reimbursements Report (per-entity) ──────────────────────────
// Renders one report instance for a given business entity from
// config/businesses.json. Lookups, account filtering, and exported
// filename all derive from the entity definition.

function renderBusinessReimbursementsReport(entityId) {
  const entity = getBusinessEntities().find(e => e.id === entityId);
  const out = document.getElementById('report-output');
  if (!entity) {
    out.innerHTML = `<div class="report-view"><div class="report-section"><div class="c-mut2">${escapeHtml(t('reports.kf.err.no_entity', { id: entityId }, `Business entity '${entityId}' not configured`))}</div></div></div>`;
    return;
  }
  // Pass-through accounts only — see exportBusinessAccounting comment.
  const businessAccounts = (entity.accounts || []).filter(alias => {
    const acc = (state.accounts || []).find(a => a.alias === alias);
    return acc && acc.type === 'pass_through';
  });
  const years = getAvailableYears();
  const savedYear = out.getAttribute('data-kf-year') || years[years.length - 1] || '2026';
  const savedMode = out.getAttribute('data-kf-mode') || 'monthly';

  out.innerHTML = `
    <div class="report-view">
      <div class="report-toolbar">
        <label>${t('reports.toolbar.mode', {}, 'Mode')}</label>
        <select id="kf-mode">
          <option value="monthly" ${savedMode === 'monthly' ? 'selected' : ''}>${t('reports.toolbar.monthly', {}, 'Monthly')}</option>
          <option value="yearly" ${savedMode === 'yearly' ? 'selected' : ''}>${t('reports.toolbar.yearly', {}, 'Yearly')}</option>
        </select>
        <label>${t('reports.toolbar.year', {}, 'Year')}</label>
        <select id="kf-year">${years.map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
      </div>
      <div id="kf-content"></div>
    </div>
  `;

  const modeEl = document.getElementById('kf-mode');
  const yearEl = document.getElementById('kf-year');

  function update() {
    out.setAttribute('data-kf-mode', modeEl.value);
    out.setAttribute('data-kf-year', yearEl.value);
    yearEl.style.display = modeEl.value === 'yearly' ? 'none' : '';
    destroyReportCharts();

    const year = yearEl.value;

    // Expenses on the entity's pass-through accounts (the actual spending).
    const bizExpenses = state.tx.filter(tx => (tx.type === 'expense' || tx.type === 'transfer') && businessAccounts.includes(tx.account));
    // Reimbursements (income on the same accounts).
    const bizReimb = state.tx.filter(tx => tx.type === 'income' && businessAccounts.includes(tx.account));

    if (modeEl.value === 'monthly') {
      const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        .map((en, i) => t(`common.months.short.${i + 1}`, {}, en));
      const otherLabel = t('reports.shared.other', {}, '(other)');
      const months = [];
      for (let m = 1; m <= 12; m++) {
        const ym = `${year}-${String(m).padStart(2, '0')}`;
        let exp = 0, reimb = 0, expCount = 0;
        const byCat = {};
        for (const tx of bizExpenses) {
          if (!tx.date || !tx.date.startsWith(ym)) continue;
          const amt = convertToTZS(tx.amount, tx.currency);
          exp += amt; expCount++;
          const cat = tx.category || otherLabel;
          byCat[cat] = (byCat[cat] || 0) + amt;
        }
        for (const tx of bizReimb) {
          if (!tx.date || !tx.date.startsWith(ym)) continue;
          reimb += convertToTZS(tx.amount, tx.currency);
        }
        months.push({ ym, label: monthLabel(ym), exp, reimb, net: reimb - exp, expCount, byCat });
      }

      const totExp = months.reduce((s, m) => s + m.exp, 0);
      const totReimb = months.reduce((s, m) => s + m.reimb, 0);
      const totNet = totReimb - totExp;

      // Top categories across year
      const allCats = {};
      for (const m of months) for (const [c, v] of Object.entries(m.byCat)) allCats[c] = (allCats[c] || 0) + v;
      const topCats = Object.entries(allCats).sort((a, b) => b[1] - a[1]).slice(0, 10);

      const balanceDetail = totNet >= 0
        ? t('reports.kf.tile.fully_reimbursed', {}, 'Fully reimbursed')
        : t('reports.kf.tile.outstanding', { amount: formatCurrency(Math.abs(totNet), 'TZS') }, `Outstanding: ${formatCurrency(Math.abs(totNet), 'TZS')}`);
      const totCount = months.reduce((s, m) => s + m.expCount, 0);

      const content = document.getElementById('kf-content');
      content.innerHTML = `
        <div class="report-section">
          <div class="report-section-title">${t('reports.kf.monthly.title', { label: entity.label, year }, `${entity.label} Pass-Through ${year} (all amounts in TZS)`)}</div>
          <div class="income-grid">
            <div class="income-cell">
              <div class="ic-label">${t('reports.incexp.tile.total_expenses', {}, 'Total Expenses')}</div>
              <div class="ic-value c-neg">${formatCurrency(totExp, 'TZS')}<span class="ic-cur">TZS</span></div>
              <div class="ic-count">${t('reports.shared.tx_count', { n: totCount }, `${totCount} TX`)}</div>
            </div>
            <div class="income-cell">
              <div class="ic-label">${t('reports.kf.tile.total_reimbursed', {}, 'Total Reimbursed')}</div>
              <div class="ic-value c-pos">${formatCurrency(totReimb, 'TZS')}<span class="ic-cur">TZS</span></div>
            </div>
            <div class="income-cell">
              <div class="ic-label">${t('reports.kf.tile.balance', {}, 'Balance')}</div>
              <div class="ic-value" style="color:${totNet >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(totNet, 'TZS')}<span class="ic-cur">TZS</span></div>
              <div class="ic-count">${balanceDetail}</div>
            </div>
          </div>
        </div>
        <div class="report-section">
          <div class="chart-row">
            <div class="chart-wrap">
              <div class="report-section-title">${t('reports.kf.chart.monthly', {}, 'Monthly Expenses vs. Reimbursements')}</div>
              <div class="chart-canvas-box"><canvas id="kf-monthly-chart"></canvas></div>
            </div>
            <div class="chart-wrap">
              <div class="report-section-title">${t('reports.kf.chart.cats', {}, 'Expense Categories')}</div>
              <div class="chart-canvas-box" style="height:${Math.max(260, topCats.length * 28 + 60)}px;"><canvas id="kf-cat-chart"></canvas></div>
            </div>
          </div>
        </div>
        <div class="report-section">
          <div class="report-section-title">${t('reports.kf.section.monthly_detail', {}, 'Monthly Detail')}</div>
          <table class="tx-table"><thead><tr>
            <th>${t('common.label.month', {}, 'Month')}</th>
            <th class="amt">${t('common.label.expenses', {}, 'Expenses')}</th>
            <th class="amt">${t('reports.kf.col.reimbursed', {}, 'Reimbursed')}</th>
            <th class="amt">${t('common.label.net', {}, 'Net')}</th>
            <th>${t('reports.wd.col.tx', {}, 'TX')}</th>
            <th></th>
          </tr></thead><tbody>
            ${months.filter(m => m.exp > 0 || m.reimb > 0).map(m => {
              const hasGap = Math.abs(m.net) > 1;
              return `<tr style="${hasGap ? 'background:var(--warning-bg, rgba(245,158,11,0.08));' : ''}">
              <td>${m.label}</td>
              <td class="amt expense">${formatCurrency(m.exp, 'TZS')}</td>
              <td class="amt income">${formatCurrency(m.reimb, 'TZS')}</td>
              <td class="amt" style="color:${m.net >= 0 ? 'var(--positive)' : 'var(--negative)'}; font-weight:${hasGap ? '700' : '400'}">${formatCurrency(m.net, 'TZS')}</td>
              <td>${m.expCount}</td>
              <td>${hasGap ? `<button class="kf-drill-btn" data-ym="${m.ym}" style="font-size:11px;padding:2px 8px;cursor:pointer;">${t('reports.kf.detail_btn', {}, 'Details')}</button>` : ''}</td>
            </tr>`;
            }).join('')}
          </tbody></table>
          <div id="kf-drill-detail"></div>
        </div>
        <div class="report-section">
          <div style="display:flex;align-items:center;margin-bottom:12px;">
            <div class="report-section-title" style="margin:0;">${t('reports.kf.section.tx_detail', {}, 'Transaction Detail')}</div>
            <button data-action="exportBusinessAccounting" data-arg1="${escapeHtml(entityId)}" data-arg2="${escapeHtml(year)}" style="margin-left:auto;padding:6px 14px;">${t('reports.kf.export_btn', {}, 'Export for Accounting')}</button>
          </div>
          <table class="tx-table" id="kf-tx-detail"><thead><tr>
            <th>${t('common.label.date', {}, 'Date')}</th>
            <th>${t('common.col.account', {}, 'Account')}</th>
            <th>${t('common.col.payee', {}, 'Payee')}</th>
            <th>${t('common.col.category', {}, 'Category')}</th>
            <th class="amt">${t('common.col.amount', {}, 'Amount')}</th>
            <th>${t('common.col.currency', {}, 'Currency')}</th>
            <th>${t('common.label.note', {}, 'Note')}</th>
          </tr></thead><tbody>
            ${bizExpenses.filter(tx => tx.date && tx.date.startsWith(year)).sort((a, b) => a.date.localeCompare(b.date)).map(tx => `<tr>
              <td>${fmtDate(tx.date)}</td>
              <td>${escapeHtml(tx.account)}</td>
              <td>${escapeHtml(tx.payee || '')}</td>
              <td class="cat">${escapeHtml(tx.category || '')}</td>
              <td class="amt expense">${formatCurrency(tx.amount, tx.currency)}</td>
              <td class="hint-sm">${tx.currency}</td>
              <td class="hint-sm">${escapeHtml(tx.note || '')}</td>
            </tr>`).join('')}
          </tbody></table>
        </div>
      `;

      // Monthly chart
      const mCtx = document.getElementById('kf-monthly-chart');
      if (mCtx) {
        const chart = new Chart(mCtx, {
          type: 'bar',
          data: {
            labels: names,
            datasets: [
              { label: t('common.label.expenses', {}, 'Expenses'), data: months.map(m => m.exp), backgroundColor: '#e8453c', borderWidth: 0, borderRadius: 3 },
              { label: t('reports.kf.dataset.reimbursed', {}, 'Reimbursed'), data: months.map(m => m.reimb), backgroundColor: '#10b981', borderWidth: 0, borderRadius: 3 },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } } },
              tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, 'TZS') + ' TZS' } } },
            scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: cssVar('--chart-grid') } } } },
        });
        reportCharts.push(chart);
      }

      // Category chart
      const cCtx = document.getElementById('kf-cat-chart');
      if (cCtx && topCats.length > 0) {
        const palette = ['#1e40af', '#e8453c', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];
        const chart = new Chart(cCtx, {
          type: 'bar',
          data: {
            labels: topCats.map(([c]) => c.length > 22 ? c.slice(0, 21) + '…' : c),
            datasets: [{ data: topCats.map(([, v]) => v), backgroundColor: palette.slice(0, topCats.length), borderWidth: 0, borderRadius: 3 }],
          },
          options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, 'TZS') + ' TZS' } } },
            scales: { x: { ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: cssVar('--chart-grid') } }, y: { grid: { display: false }, ticks: { font: { size: 11 }, autoSkip: false } } } },
        });
        reportCharts.push(chart);
      }

      // Drill-down: show unmatched TX for months with net ≠ 0
      document.querySelectorAll('.kf-drill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const ym = btn.getAttribute('data-ym');
          const mExp = bizExpenses.filter(tx => tx.date && tx.date.startsWith(ym));
          const mRei = bizReimb.filter(tx => tx.date && tx.date.startsWith(ym));

          // Match by amount: pair expense with reimbursement of same amount on same account
          const usedRei = new Set();
          const matched = [];
          const unmatchedExp = [];
          for (const e of mExp) {
            const eAmt = convertToTZS(e.amount, e.currency);
            let found = false;
            for (let i = 0; i < mRei.length; i++) {
              if (usedRei.has(i)) continue;
              const rAmt = convertToTZS(mRei[i].amount, mRei[i].currency);
              if (Math.abs(eAmt - rAmt) < 1 && e.account === mRei[i].account) {
                matched.push({ exp: e, rei: mRei[i] });
                usedRei.add(i);
                found = true;
                break;
              }
            }
            if (!found) unmatchedExp.push(e);
          }
          const unmatchedRei = mRei.filter((_, i) => !usedRei.has(i));

          const txTableHead = `<th>${t('common.label.date', {}, 'Date')}</th><th>${t('common.col.account', {}, 'Account')}</th><th>${t('common.col.payee', {}, 'Payee')}</th><th>${t('common.col.category', {}, 'Category')}</th><th class="amt">${t('common.col.amount', {}, 'Amount')}</th><th>${t('common.label.note', {}, 'Note')}</th>`;
          const detail = document.getElementById('kf-drill-detail');
          detail.innerHTML = `
            <div class="report-section" style="margin-top:16px;">
              <div class="report-section-title">${t('reports.kf.unmatched_title', { month: monthLabel(ym) }, `Unmatched TX — ${monthLabel(ym)}`)}</div>
              ${unmatchedExp.length ? `<div style="margin-bottom:8px;font-weight:500;color:var(--negative);">${t('reports.kf.unmatched.exp_without', { n: unmatchedExp.length }, `Expenses without Reimbursement (${unmatchedExp.length})`)}</div>
              <table class="tx-table"><thead><tr>${txTableHead}</tr></thead><tbody>
                ${unmatchedExp.map(tx => `<tr>
                  <td>${fmtDate(tx.date)}</td><td>${escapeHtml(tx.account)}</td><td>${escapeHtml(tx.payee||'')}</td>
                  <td class="cat">${escapeHtml(tx.category||'')}</td><td class="amt expense">${formatCurrency(tx.amount, tx.currency)} ${tx.currency}</td>
                  <td class="hint-sm">${escapeHtml(tx.note||'')}</td>
                </tr>`).join('')}
              </tbody></table>` : ''}
              ${unmatchedRei.length ? `<div style="margin:12px 0 8px;font-weight:500;color:var(--positive);">${t('reports.kf.unmatched.rei_without', { n: unmatchedRei.length }, `Reimbursements without Expense (${unmatchedRei.length})`)}</div>
              <table class="tx-table"><thead><tr>${txTableHead}</tr></thead><tbody>
                ${unmatchedRei.map(tx => `<tr>
                  <td>${fmtDate(tx.date)}</td><td>${escapeHtml(tx.account)}</td><td>${escapeHtml(tx.payee||'')}</td>
                  <td class="cat">${escapeHtml(tx.category||'')}</td><td class="amt income">${formatCurrency(tx.amount, tx.currency)} ${tx.currency}</td>
                  <td class="hint-sm">${escapeHtml(tx.note||'')}</td>
                </tr>`).join('')}
              </tbody></table>` : ''}
              ${!unmatchedExp.length && !unmatchedRei.length ? `<p>${t('reports.kf.unmatched.all_matched', {}, 'All TX matched.')}</p>` : ''}
              <div style="margin-top:8px;color:var(--muted);font-size:0.85em;">${t('reports.kf.unmatched.summary', { m: matched.length, e: unmatchedExp.length, r: unmatchedRei.length }, `Matched: ${matched.length} pairs · Unmatched: ${unmatchedExp.length} expenses, ${unmatchedRei.length} reimbursements`)}</div>
            </div>
          `;
        });
      });
    } else {
      // Yearly mode
      const yearData = years.map(y => {
        let exp = 0, reimb = 0, count = 0;
        for (const tx of bizExpenses) {
          if (!tx.date || !tx.date.startsWith(y)) continue;
          exp += convertToTZS(tx.amount, tx.currency); count++;
        }
        for (const tx of bizReimb) {
          if (!tx.date || !tx.date.startsWith(y)) continue;
          reimb += convertToTZS(tx.amount, tx.currency);
        }
        return { year: y, exp, reimb, net: reimb - exp, count };
      });

      const content = document.getElementById('kf-content');
      content.innerHTML = `
        <div class="report-section">
          <div class="report-section-title">${t('reports.kf.yearly.title', { label: entity.label }, `${entity.label} Pass-Through — Yearly (TZS)`)}</div>
          <div class="income-grid">
            ${yearData.map(d => `
              <div class="income-cell">
                <div class="ic-label">${d.year}</div>
                <div class="ic-value c-neg">${formatCurrency(d.exp, 'TZS')}<span class="ic-cur">TZS</span></div>
                <div class="ic-count">${t('reports.kf.yearly_detail', { count: d.count, reimb: formatCurrency(d.reimb, 'TZS'), net: `<span style="color:${d.net >= 0 ? 'var(--positive)' : 'var(--negative)'}">${formatCurrency(d.net, 'TZS')}</span>` }, `${d.count} TX · Reimb: ${formatCurrency(d.reimb, 'TZS')} · Net: ${formatCurrency(d.net, 'TZS')}`)}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="report-section">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.kf.chart.yearly', {}, 'Yearly Expenses vs. Reimbursements')}</div>
            <div class="chart-canvas-box"><canvas id="kf-yearly-chart"></canvas></div>
          </div>
        </div>
      `;

      const ctx = document.getElementById('kf-yearly-chart');
      if (ctx) {
        const chart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: yearData.map(d => d.year),
            datasets: [
              { label: t('common.label.expenses', {}, 'Expenses'), data: yearData.map(d => d.exp), backgroundColor: '#e8453c', borderWidth: 0, borderRadius: 4 },
              { label: t('reports.kf.dataset.reimbursed', {}, 'Reimbursed'), data: yearData.map(d => d.reimb), backgroundColor: '#10b981', borderWidth: 0, borderRadius: 4 },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 12 } } },
              tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw, 'TZS') + ' TZS' } } },
            scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => formatCurrency(v, 'TZS') }, grid: { color: cssVar('--chart-grid') } } } },
        });
        reportCharts.push(chart);
      }
    }
  }

  modeEl.addEventListener('change', update);
  yearEl.addEventListener('change', update);
  update();
}

