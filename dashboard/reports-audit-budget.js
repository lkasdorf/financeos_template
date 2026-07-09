// ─── R5: Pass-Through Audit ─────────────────────────────────────────────

function renderPassThroughAuditReport() {
  const out = document.getElementById('report-output');

  // DR-M4: toolbar rendering/persistence/wiring live in reportToolbar().
  const tb = reportToolbar(out, 'pt', [
    { key: 'cur', label: t('reports.toolbar.currency', {}, 'Currency'),
      options: reportCurrencies(), def: 'TZS' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="pt-content"></div>
    </div>
  `;

  function update() {
    const currency = tb.get('cur');
    destroyReportCharts();

    // Find pass-through accounts
    const ptAccounts = state.accounts.filter(a => a.type === 'pass_through');
    if (ptAccounts.length === 0) {
      document.getElementById('pt-content').innerHTML = `<div class="empty-state"><p>${t('reports.pt.empty', {}, 'No pass-through accounts configured.')}</p></div>`;
      return;
    }

    const issues = [];
    const summary = [];

    for (const pta of ptAccounts) {
      const acctTx = state.tx.filter(tx => tx.account === pta.alias);
      // Outflows: expenses AND transfers out (both reduce the balance and need reimbursement)
      const expenses = acctTx.filter(tx => tx.type === 'expense' || tx.type === 'transfer');
      const incomes = acctTx.filter(tx => tx.type === 'income');

      let matched = 0, unmatched = 0, mismatchAmt = 0;

      // Multi-pass matching: exact → window → batch → extended window
      // Issues are only emitted AFTER all passes complete.
      const WINDOW_DAYS = 7;
      function daysDiff(d1, d2) {
        if (!d1 || !d2) return Infinity;
        const a = new Date(d1), b = new Date(d2);
        return Math.abs(a - b) / 86400000;
      }

      const usedIncomes = new Set();
      const dateOffsetPairs = []; // {exp, inc, days} for date-offset reporting

      // Pass 1: exact date + exact amount
      for (const exp of expenses) {
        const expAmt = parseFloat(exp.amount) || 0;
        const match = incomes.find(inc => {
          if (usedIncomes.has(inc.import_id)) return false;
          return inc.date === exp.date && Math.abs((parseFloat(inc.amount) || 0) - expAmt) < 0.01;
        });
        if (match) { matched++; usedIncomes.add(match.import_id); exp._matched = true; }
      }

      // Pass 2: window match ±7 days
      for (const exp of expenses) {
        if (exp._matched) continue;
        const expAmt = parseFloat(exp.amount) || 0;
        let bestMatch = null, bestDays = Infinity;
        for (const inc of incomes) {
          if (usedIncomes.has(inc.import_id)) continue;
          const dd = daysDiff(exp.date, inc.date);
          if (Math.abs((parseFloat(inc.amount) || 0) - expAmt) < 0.01 && dd <= WINDOW_DAYS && dd < bestDays) {
            bestMatch = inc; bestDays = dd;
          }
        }
        if (bestMatch) {
          matched++;
          usedIncomes.add(bestMatch.import_id);
          exp._matched = true;
          if (bestDays > 0) dateOffsetPairs.push({ exp, inc: bestMatch, days: bestDays });
        }
      }

      // Pass 3: batch matching — multiple expenses sum to one income
      const remainingExp = expenses.filter(e => !e._matched);
      const orphanIncomes = incomes.filter(inc => !usedIncomes.has(inc.import_id));
      const sortedOrphans = [...orphanIncomes].sort((a, b) => (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0));

      // DR-M2: enumerate combinations of size 2..5 directly instead of
      // scanning all 2^n bitmasks once per size (~19×2^20 iterations per
      // orphan income — seconds of main-thread freeze on every report
      // open and currency switch). Real batch reimbursements rarely
      // cover more than a handful of expenses; C(20, 2..5) ≈ 22k
      // combinations is instant and keeps the smallest-subset-first
      // preference of the old size-ascending scan.
      function findSubsetSum(items, target, tolerance) {
        const n = items.length;
        if (n > 20) return null;
        const amounts = items.map(it => parseFloat(it.amount) || 0);
        const maxSize = Math.min(n, 5);
        const idx = [];
        function combos(start, size, sum) {
          if (idx.length === size) return Math.abs(sum - target) < tolerance;
          for (let i = start; i <= n - (size - idx.length); i++) {
            idx.push(i);
            if (combos(i + 1, size, sum + amounts[i])) return true;
            idx.pop();
          }
          return false;
        }
        for (let size = 2; size <= maxSize; size++) {
          idx.length = 0;
          if (combos(0, size, 0)) return idx.map(i => items[i]);
        }
        return null;
      }

      const batchMatched = new Set();
      const batchUsedIncomes = new Set();
      for (const inc of sortedOrphans) {
        const incAmt = parseFloat(inc.amount) || 0;
        const candidates = remainingExp.filter(e => !batchMatched.has(e.import_id));
        if (candidates.length === 0 || candidates.length > 20) continue;
        const subset = findSubsetSum(candidates, incAmt, 0.02);
        if (subset && subset.length >= 2) {
          matched += subset.length;
          for (const e of subset) { batchMatched.add(e.import_id); e._matched = true; }
          batchUsedIncomes.add(inc.import_id);
          usedIncomes.add(inc.import_id);
          issues.push({
            account: pta.alias, accountName: pta.name,
            date: inc.date, amount: incAmt, nativeCurrency: pta.currency,
            convertedAmount: convertTo(incAmt, pta.currency, currency),
            payee: inc.payee, category: inc.category,
            type: 'batch_match',
            batchExpenses: subset.map(e => ({
              date: e.date, amount: parseFloat(e.amount) || 0,
              payee: e.payee, category: e.category,
            })),
            importId: inc.import_id,
          });
        }
      }

      // Pass 4: extended window ±14 days for remaining 1:1 pairs
      const stillUnmatched = remainingExp.filter(e => !batchMatched.has(e.import_id));
      const stillOrphan = orphanIncomes.filter(inc => !batchUsedIncomes.has(inc.import_id));
      const extUsed = new Set();
      for (const exp of stillUnmatched) {
        const expAmt = parseFloat(exp.amount) || 0;
        let bestMatch = null, bestDays = Infinity;
        for (const inc of stillOrphan) {
          if (extUsed.has(inc.import_id)) continue;
          const dd = daysDiff(exp.date, inc.date);
          if (Math.abs((parseFloat(inc.amount) || 0) - expAmt) < 0.01 && dd <= 14 && dd < bestDays) {
            bestMatch = inc; bestDays = dd;
          }
        }
        if (bestMatch) {
          matched++;
          extUsed.add(bestMatch.import_id);
          exp._matched = true;
          dateOffsetPairs.push({ exp, inc: bestMatch, days: bestDays });
        }
      }

      // === Emit issues AFTER all passes ===
      // Date offsets (informational)
      for (const pair of dateOffsetPairs) {
        const expAmt = parseFloat(pair.exp.amount) || 0;
        issues.push({
          account: pta.alias, accountName: pta.name,
          date: pair.exp.date, amount: expAmt, nativeCurrency: pta.currency,
          convertedAmount: convertTo(expAmt, pta.currency, currency),
          payee: pair.exp.payee, category: pair.exp.category,
          type: 'date_offset',
          matchDate: pair.inc.date, daysDiff: pair.days,
          importId: pair.exp.import_id,
        });
      }

      // Truly unmatched expenses (not matched by any pass)
      for (const exp of expenses) {
        if (exp._matched) continue;
        const expAmt = parseFloat(exp.amount) || 0;
        unmatched++;
        mismatchAmt += convertTo(expAmt, pta.currency, currency);
        issues.push({
          account: pta.alias, accountName: pta.name,
          date: exp.date, amount: expAmt, nativeCurrency: pta.currency,
          convertedAmount: convertTo(expAmt, pta.currency, currency),
          payee: exp.payee, category: exp.category,
          type: 'missing_income',
          importId: exp.import_id,
        });
      }

      // Truly orphan incomes (not matched by any pass)
      const finalOrphans = orphanIncomes.filter(inc => !batchUsedIncomes.has(inc.import_id) && !extUsed.has(inc.import_id));
      for (const inc of finalOrphans) {
        const incAmt = parseFloat(inc.amount) || 0;
        issues.push({
          account: pta.alias, accountName: pta.name,
          date: inc.date, amount: incAmt, nativeCurrency: pta.currency,
          convertedAmount: convertTo(incAmt, pta.currency, currency),
          payee: inc.payee, category: inc.category,
          type: 'orphan_income',
          importId: inc.import_id,
        });
      }

      // Balance check
      const totalExp = expenses.reduce((s, tx) => s + (parseFloat(tx.amount) || 0), 0);
      const totalInc = incomes.reduce((s, tx) => s + (parseFloat(tx.amount) || 0), 0);
      const balance = totalInc - totalExp;

      const dateOffsetCount = issues.filter(i => i.account === pta.alias && i.type === 'date_offset').length;
      const batchCount = issues.filter(i => i.account === pta.alias && i.type === 'batch_match').length;
      const realOrphanCount = finalOrphans.length;
      summary.push({
        alias: pta.alias,
        name: pta.name,
        currency: pta.currency,
        expenses: expenses.length,
        incomes: incomes.length,
        matched,
        unmatched,
        dateOffsets: dateOffsetCount,
        batchMatches: batchCount,
        orphanIncomes: realOrphanCount,
        totalExp,
        totalInc,
        balance,
        balanceConverted: convertTo(balance, pta.currency, currency),
        unmatchedAmt: mismatchAmt,
      });
    }

    const hardIssues = issues.filter(i => i.type === 'missing_income' || i.type === 'orphan_income');
    const dateOffsets = issues.filter(i => i.type === 'date_offset');
    const batchMatches = issues.filter(i => i.type === 'batch_match');
    const totalIssues = hardIssues.length;
    // Account-level balance check: if totals of expenses and incomes match on every
    // pass-through account, the reimbursements happened — per-TX matching gaps are
    // just algorithmic (batches, round-number reimbursements covering multiple TXs).
    const balanceOk = summary.every(s => Math.abs(s.balance) < 0.01);
    const healthColor = totalIssues === 0
      ? 'var(--positive)'
      : balanceOk
        ? 'var(--muted)'
        : totalIssues <= 3 ? 'var(--warn)' : 'var(--negative)';
    const healthLabel = totalIssues === 0
      ? t('reports.pt.health.all_clear', {}, 'All Clear')
      : balanceOk
        ? t('reports.pt.health.balance_ok', {}, 'Balance OK — matching incomplete')
        : totalIssues <= 3 ? t('reports.pt.health.minor', {}, 'Minor Issues') : t('reports.pt.health.needs_attention', {}, 'Needs Attention');

    const content = document.getElementById('pt-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="flex-row gap-md" style="flex-wrap:wrap;">
          <div class="summary-card fld-col">
            <div class="label-xs">${t('reports.pt.card.balance', {}, 'Account Balance')}</div>
            <div style="font-size:18px;font-weight:700;color:${balanceOk ? 'var(--positive)' : 'var(--negative)'};">
              ${balanceOk ? t('reports.pt.balance.ok', {}, 'OK (zero delta)') : t('reports.pt.balance.unbalanced', {}, 'UNBALANCED')}
            </div>
          </div>
          <div class="summary-card fld-col">
            <div class="label-xs">${t('reports.pt.card.status', {}, 'Health Status')}</div>
            <div style="font-size:18px;font-weight:700;color:${healthColor};">${healthLabel}</div>
          </div>
          <div class="summary-card fld-col">
            <div class="label-xs">${balanceOk ? t('reports.pt.card.unmatched', {}, 'Unmatched TXs') : t('reports.pt.card.hard_issues', {}, 'Hard Issues')}</div>
            <div style="font-size:18px;font-weight:700;color:${healthColor};">${totalIssues}</div>
          </div>
          <div class="summary-card fld-col">
            <div class="label-xs">${t('reports.pt.card.batch_matched', {}, 'Batch Matched')}</div>
            <div style="font-size:18px;font-weight:700;color:var(--positive);">${batchMatches.length}</div>
          </div>
          <div class="summary-card fld-col">
            <div class="label-xs">${t('reports.pt.card.date_offsets', {}, 'Date Offsets')}</div>
            <div style="font-size:18px;font-weight:700;color:var(--muted);">${dateOffsets.length}</div>
          </div>
          <div class="summary-card fld-col">
            <div class="label-xs">${t('reports.pt.card.accounts_checked', {}, 'Accounts Checked')}</div>
            <div style="font-size:18px;font-weight:700;">${ptAccounts.length}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.pt.section.summary', { currency }, `Account Summary (${currency})`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table">
          <thead><tr>
            <th>${t('common.col.account', {}, 'Account')}</th>
            <th class="t-right">${t('common.label.expenses', {}, 'Expenses')}</th>
            <th class="t-right">${t('reports.pt.col.incomes', {}, 'Incomes')}</th>
            <th class="t-right">${t('reports.pt.col.matched', {}, 'Matched')}</th>
            <th class="t-right">${t('reports.pt.col.date_offset', {}, 'Date Offset')}</th>
            <th class="t-right">${t('reports.pt.col.unmatched', {}, 'Unmatched')}</th>
            <th class="t-right">${t('reports.pt.col.balance', {}, 'Balance')}</th>
            <th>${t('reports.pt.col.status', {}, 'Status')}</th>
          </tr></thead>
          <tbody>
            ${summary.map(s => {
              const balColor = Math.abs(s.balance) < 0.01 ? 'var(--positive)' : 'var(--negative)';
              const issueCount = s.unmatched + s.orphanIncomes;
              const status = issueCount === 0
                ? '✓'
                : issueCount === 1
                  ? t('reports.pt.status.issues_one', { n: 1 }, '1 issue')
                  : t('reports.pt.status.issues_many', { n: issueCount }, `${issueCount} issues`);
              return `<tr>
                <td class="fw-500">${escapeHtml(s.name)} <span style="color:var(--muted);font-size:9px;">(${s.alias})</span></td>
                <td class="amt">${s.expenses}</td>
                <td class="amt">${s.incomes}</td>
                <td class="amt c-pos">${s.matched}</td>
                <td class="amt c-mut">${s.dateOffsets || 0}</td>
                <td class="amt" style="color:${s.unmatched > 0 ? 'var(--negative)' : 'var(--muted)'};">${s.unmatched}</td>
                <td class="amt" style="color:${balColor};">${formatCurrency(s.balanceConverted, currency)}</td>
                <td style="color:${s.unmatched === 0 && s.orphanIncomes === 0 ? 'var(--positive)' : 'var(--negative)'};">${status}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>
      ${hardIssues.length > 0 ? `
      <div class="report-section">
        <div class="report-section-title">${balanceOk ? t('reports.pt.section.unmatched', { n: hardIssues.length }, `Unmatched TXs (${hardIssues.length}) — Balance is zero, matching algorithm could not pair these 1:1 (likely covered by batch reimbursements)`) : t('reports.pt.section.hard', { n: hardIssues.length }, `Hard Issues (${hardIssues.length}) — Missing Counter-Entries or Orphan Incomes`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table">
          <thead><tr>
            <th>${t('common.col.account', {}, 'Account')}</th>
            <th>${t('common.label.date', {}, 'Date')}</th>
            <th>${t('common.col.type', {}, 'Type')}</th>
            <th class="t-right">${t('common.col.amount', {}, 'Amount')}</th>
            <th>${t('common.col.payee', {}, 'Payee')}</th>
            <th>${t('common.col.category', {}, 'Category')}</th>
            <th>${t('reports.pt.col.import_id', {}, 'Import ID')}</th>
          </tr></thead>
          <tbody>
            ${hardIssues.map(iss => {
              const typeLabel = iss.type === 'missing_income' ? t('reports.pt.issue.missing', {}, 'Missing Counter-Entry') : t('reports.pt.issue.orphan', {}, 'Orphan Income');
              const typeColor = iss.type === 'missing_income' ? 'var(--negative)' : 'var(--warn)';
              return `<tr>
                <td>${iss.account}</td>
                <td>${fmtDate(iss.date)}</td>
                <td style="color:${typeColor};font-size:10px;font-weight:500;">${typeLabel}</td>
                <td class="amt">${formatCurrency(iss.convertedAmount, currency)} <span class="acc-currency">${currency}</span></td>
                <td>${escapeHtml(iss.payee || '')}</td>
                <td class="fs-10">${escapeHtml(iss.category || '')}</td>
                <td class="hint-sm">${iss.importId || ''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>` : ''}
      ${batchMatches.length > 0 ? `
      <div class="report-section">
        <div class="report-section-title">${t('reports.pt.section.batch', { n: batchMatches.length }, `Batch Matches (${batchMatches.length}) — Multiple Expenses Reimbursed as One`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table">
          <thead><tr>
            <th>${t('common.col.account', {}, 'Account')}</th>
            <th>${t('reports.pt.col.income_date', {}, 'Income Date')}</th>
            <th class="t-right">${t('reports.kf.col.reimbursed', {}, 'Reimbursed')}</th>
            <th>${t('reports.pt.col.expenses_covered', {}, 'Expenses Covered')}</th>
          </tr></thead>
          <tbody>
            ${batchMatches.map(bm => `<tr>
              <td>${bm.account}</td>
              <td>${fmtDate(bm.date)}</td>
              <td class="amt" style="color:var(--positive);font-weight:500;">${formatCurrency(bm.convertedAmount, currency)} <span class="acc-currency">${currency}</span></td>
              <td class="fs-10">
                ${bm.batchExpenses.map(e =>
                  `<div style="margin:1px 0;">${fmtDate(e.date)} · ${formatCurrency(convertTo(e.amount, bm.nativeCurrency, currency), currency)} ${currency} · ${escapeHtml(e.payee || '')} · <span class="c-mut">${escapeHtml(e.category || '')}</span></div>`
                ).join('')}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : ''}
      ${dateOffsets.length > 0 ? `
      <div class="report-section">
        <div class="report-section-title">${t('reports.pt.section.date_offsets', { n: dateOffsets.length }, `Date Offsets (${dateOffsets.length}) — Matched by Amount, Dates Differ (MMEX Legacy)`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table">
          <thead><tr>
            <th>${t('common.col.account', {}, 'Account')}</th>
            <th>${t('reports.pt.col.expense_date', {}, 'Expense Date')}</th>
            <th>${t('reports.pt.col.income_date', {}, 'Income Date')}</th>
            <th>${t('reports.pt.col.offset', {}, 'Offset')}</th>
            <th class="t-right">${t('common.col.amount', {}, 'Amount')}</th>
            <th>${t('common.col.payee', {}, 'Payee')}</th>
            <th>${t('common.col.category', {}, 'Category')}</th>
          </tr></thead>
          <tbody>
            ${dateOffsets.map(iss => `<tr>
              <td>${iss.account}</td>
              <td>${fmtDate(iss.date)}</td>
              <td>${fmtDate(iss.matchDate)}</td>
              <td class="label-xs">${iss.daysDiff.toFixed(0)}d</td>
              <td class="amt">${formatCurrency(iss.convertedAmount, currency)} <span class="acc-currency">${currency}</span></td>
              <td>${escapeHtml(iss.payee || '')}</td>
              <td class="fs-10">${escapeHtml(iss.category || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : ''}
    `;
  }

  tb.wire(update);
}
// ─── Savings Goals History Report ──────────────────────────────────────────

function renderSavingsGoalsHistoryReport() {
  const out = document.getElementById('report-output');
  const goals = (state.savingsGoals || []).filter(g => g.active);

  if (!goals.length) {
    out.innerHTML = `<div class="report-view"><p>${t('reports.savingsGoalsHistory.empty', {}, 'No active savings goals configured. Add goals in Settings &rarr; Goals.')}</p></div>`;
    return;
  }

  // DR-M4: toolbar rendering/persistence/wiring live in reportToolbar().
  // Goal names were rendered unescaped in the old template — kept as-is.
  const tb = reportToolbar(out, 'sgh', [
    { key: 'goal', label: t('reports.toolbar.goal', {}, 'Goal'),
      options: goals.map(g => ({ v: g.id, l: g.name })), def: goals[0].id },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="sgh-content"></div>
    </div>
  `;

  function update() {
    destroyReportCharts();

    const goal = goals.find(g => g.id === tb.get('goal')) || goals[0];
    const currency = goal.currency || 'TZS';
    const target = goal.target || 0;
    const acctAlias = goal.account || '';
    const deadline = goal.deadline || '';

    // Find matching account by alias
    const acctObj = state.accounts.find(a => a.alias === acctAlias);
    const alias = acctObj ? acctObj.alias : acctAlias;

    // Determine start: goal.start_date or earliest TX on this account
    let startDate = goal.start_date || '';
    if (!startDate) {
      for (const t of state.tx) {
        if (!t.date) continue;
        if ((t.account === alias || t.transfer_to_account === alias) && (!startDate || t.date < startDate)) startDate = t.date;
      }
    }
    if (!startDate) startDate = new Date().toISOString().slice(0, 10);

    // Build month-by-month balances from transactions
    const startYM = startDate.slice(0, 7);
    const now = new Date();
    const endYM = deadline ? Math.max(
      new Date(deadline).getTime(),
      now.getTime()
    ) : now.getTime();
    const endDate = new Date(endYM);
    const endYMStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;

    // Collect all relevant TX sorted by date (account or transfer target)
    const acctTx = state.tx.filter(t => {
      if (!t.date) return false;
      return t.account === alias || t.transfer_to_account === alias;
    }).sort((a, b) => a.date.localeCompare(b.date));

    // Get initial balance from accounts.csv
    const initialBalance = acctObj ? (acctObj.initial_balance || 0) : 0;

    // Build month list from start to deadline (or now, whichever is later)
    const months = [];
    let ym = startYM;
    while (ym <= endYMStr) {
      months.push(ym);
      const [y, m] = ym.split('-').map(Number);
      const nm = m === 12 ? 1 : m + 1;
      const ny = m === 12 ? y + 1 : y;
      ym = `${ny}-${String(nm).padStart(2, '0')}`;
    }

    // Compute cumulative balance at end of each month (same logic as core.js)
    const balanceByMonth = [];
    let cumBalance = initialBalance;
    let sortedTxIdx = 0;

    for (const month of months) {
      while (sortedTxIdx < acctTx.length && acctTx[sortedTxIdx].date.slice(0, 7) <= month) {
        const t = acctTx[sortedTxIdx];
        if (t.type === 'expense' && t.account === alias) cumBalance -= t.amount;
        else if (t.type === 'income' && t.account === alias) cumBalance += t.amount;
        else if (t.type === 'transfer' && t.account === alias) cumBalance -= t.amount;
        else if (t.type === 'transfer' && t.transfer_to_account === alias) cumBalance += (t.transfer_to_amount > 0 ? t.transfer_to_amount : t.amount);
        sortedTxIdx++;
      }

      const isFuture = month > `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      balanceByMonth.push({ ym: month, label: monthLabel(month), balance: isFuture ? null : cumBalance });
    }

    // Compute linear target path
    const startMonth = months[0];
    const deadlineMonth = deadline ? deadline.slice(0, 7) : months[months.length - 1];
    const totalMonths = months.indexOf(deadlineMonth) >= 0 ? months.indexOf(deadlineMonth) + 1 : months.length;
    const startBalance = initialBalance;
    const monthlyTargetIncrease = totalMonths > 1 ? (target - startBalance) / (totalMonths - 1) : 0;

    const targetByMonth = months.map((m, i) => {
      if (i >= totalMonths) return target;
      return startBalance + monthlyTargetIncrease * i;
    });

    // Current values
    const currentMonthYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const latestData = [...balanceByMonth].reverse().find(m => m.balance !== null);
    const currentBalance = latestData ? latestData.balance : initialBalance;
    const pctComplete = target > 0 ? (currentBalance / target * 100) : 0;

    // Expected balance now (on the linear path)
    const currentMonthIdx = months.indexOf(currentMonthYM);
    const expectedNow = currentMonthIdx >= 0 ? targetByMonth[currentMonthIdx] : target;
    const aheadBehind = currentBalance - expectedNow;

    // Remaining monthly rate needed
    const remainingMonths = months.filter(m => m > currentMonthYM && m <= deadlineMonth).length;
    const neededMonthlyRate = remainingMonths > 0 ? (target - currentBalance) / remainingMonths : 0;

    // Ahead/behind in months
    let aheadMonths = 0;
    if (aheadBehind > 0 && monthlyTargetIncrease > 0) {
      aheadMonths = aheadBehind / monthlyTargetIncrease;
    } else if (aheadBehind < 0 && monthlyTargetIncrease > 0) {
      aheadMonths = aheadBehind / monthlyTargetIncrease;
    }

    const content = document.getElementById('sgh-content');
    const paceN = Math.abs(aheadMonths).toFixed(1);
    const paceText = aheadBehind >= 0
      ? t('reports.savingsGoalsHistory.tile.pace_ahead', { n: paceN }, `${paceN} months ahead`)
      : t('reports.savingsGoalsHistory.tile.pace_behind', { n: paceN }, `${paceN} months behind`);
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.savingsGoalsHistory.section.title', { name: escapeHtml(goal.name), currency }, `${escapeHtml(goal.name)} — ${currency}`)}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.savingsGoalsHistory.tile.current_target', {}, 'Current / Target')}</div>
            <div class="ic-value">${formatCurrency(currentBalance, currency)}</div>
            <div class="ic-count">${t('reports.savingsGoalsHistory.tile.current_target_sub', { target: formatCurrency(target, currency), pct: pctComplete.toFixed(1) }, `of ${formatCurrency(target, currency)} (${pctComplete.toFixed(1)}%)`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${aheadBehind >= 0 ? t('reports.savingsGoalsHistory.tile.ahead', {}, 'Ahead of Schedule') : t('reports.savingsGoalsHistory.tile.behind', {}, 'Behind Schedule')}</div>
            <div class="ic-value" style="color:${aheadBehind >= 0 ? 'var(--positive)' : 'var(--negative)'}">
              ${aheadBehind >= 0 ? '+' : ''}${formatCurrency(aheadBehind, currency)}
            </div>
            <div class="ic-count">${paceText}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.savingsGoalsHistory.tile.needed_rate', {}, 'Needed Monthly Rate')}</div>
            <div class="ic-value">${remainingMonths > 0 ? formatCurrency(neededMonthlyRate, currency) : t('reports.savingsGoalsHistory.tile.target_reached', {}, 'Target reached!')}</div>
            <div class="ic-count">${remainingMonths > 0 ? t('reports.savingsGoalsHistory.tile.months_remaining', { n: remainingMonths }, `${remainingMonths} months remaining`) : deadline ? t('reports.savingsGoalsHistory.tile.deadline', { date: deadline }, `Deadline: ${deadline}`) : ''}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.savingsGoalsHistory.chart.title', {}, 'Balance vs. Target Path')}</div>
          <div class="chart-canvas-box" style="height:340px;"><canvas id="sgh-line-chart"></canvas></div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.savingsGoalsHistory.section.monthly_detail', {}, 'Monthly Detail')}</div>
        <table class="tx-table">
          <thead><tr>
            <th>${t('common.label.month', {}, 'Month')}</th>
            <th class="amt">${t('reports.savingsGoalsHistory.col.balance', {}, 'Balance')}</th>
            <th class="amt">${t('reports.savingsGoalsHistory.col.delta_prior', {}, 'Δ vs. Prior')}</th>
            <th class="amt">${t('reports.savingsGoalsHistory.col.target', {}, 'Target')}</th>
            <th class="amt">${t('reports.savingsGoalsHistory.col.deviation', {}, 'Deviation')}</th>
          </tr></thead>
          <tbody>
            ${[...balanceByMonth].reverse().filter(m => m.balance !== null).map((m, i, arr) => {
              const prev = arr[i + 1];
              const delta = prev ? m.balance - prev.balance : m.balance - initialBalance;
              const mIdx = months.indexOf(m.ym);
              const tgt = targetByMonth[mIdx] || 0;
              const dev = m.balance - tgt;
              return `<tr>
                <td>${m.label}</td>
                <td class="amt">${formatCurrency(m.balance, currency)}</td>
                <td class="amt" style="color:${delta >= 0 ? 'var(--positive)' : 'var(--negative)'}">${delta >= 0 ? '+' : ''}${formatCurrency(delta, currency)}</td>
                <td class="amt">${formatCurrency(tgt, currency)}</td>
                <td class="amt" style="color:${dev >= 0 ? 'var(--positive)' : 'var(--negative)'}; font-weight:500">${dev >= 0 ? '+' : ''}${formatCurrency(dev, currency)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Dual-line chart: actual vs target
    const chartCtx = document.getElementById('sgh-line-chart');
    if (chartCtx) {
      const actualData = balanceByMonth.map(m => m.balance);
      const targetData = targetByMonth.slice(0, months.length);
      const labels = balanceByMonth.map(m => m.label);

      // Build fill dataset for deviation area
      const chart = new Chart(chartCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: t('reports.savingsGoalsHistory.dataset.actual', {}, 'Actual Balance'),
              data: actualData,
              borderColor: cssVar('--accent'),
              backgroundColor: cssVar('--accent-glow'),
              fill: false,
              tension: 0.3,
              pointRadius: 3,
              pointHoverRadius: 6,
              borderWidth: 2.5,
              spanGaps: false,
            },
            {
              label: t('reports.savingsGoalsHistory.dataset.target_path', {}, 'Target Path'),
              data: targetData,
              borderColor: cssVar('--muted'),
              borderDash: [6, 4],
              borderWidth: 2,
              pointRadius: 0,
              fill: false,
              tension: 0,
            },
            {
              label: t('reports.savingsGoalsHistory.dataset.target_100', {}, 'Target (100%)'),
              data: months.map(() => target),
              borderColor: chartTint(cssVar('--positive'), 0.3),
              borderDash: [3, 6],
              borderWidth: 1,
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: {
          ...CHART_BASE,
          plugins: {
            legend: {
              position: 'top',
              labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } },
            },
            tooltip: {
              callbacks: {
                label: ctx => {
                  if (ctx.raw == null) return null;
                  return ctx.dataset.label + ': ' + formatCurrency(ctx.raw, currency) + ' ' + currency;
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } },
            y: {
              grid: { color: cssVar('--chart-grid') },
              ticks: currencyTicks(currency),
            },
          },
          interaction: { mode: 'index', intersect: false },
        },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}

// ─── Cost of Living Report ──────────────────────────────────────────────

function renderCostOfLivingReport() {
  const out = document.getElementById('report-output');
  const years = getAvailableYears();
  const custodyAliases = getCustodyAliases();
  const nonPnl = getNonPnlCategories();

  // Cost-of-living filter lives in core.js (isCostOfLivingTx + helpers)
  // so the Runway report can reuse the exact same definition.

  // DR-M4: toolbar rendering/persistence/wiring live in reportToolbar().
  const tb = reportToolbar(out, 'col', [
    { key: 'mode', label: t('reports.col.toolbar.mode', {}, 'Mode'), def: 'monthly',
      options: [
        { v: 'monthly', l: t('reports.col.toolbar.monthly', {}, 'Monthly') },
        { v: 'yearly', l: t('reports.col.toolbar.yearly', {}, 'Yearly') },
      ] },
    { key: 'year', label: t('reports.toolbar.year', {}, 'Year'),
      options: years, def: years[years.length - 1] || '2026' },
    { key: 'cur', label: t('reports.toolbar.currency', {}, 'Currency'),
      options: ['TZS', 'EUR', 'USD'], def: 'TZS' },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="col-content"></div>
    </div>
  `;

  // Cost of living category groups for breakdown.
  // label/desc are looked up lazily via t() so locale switches render immediately.
  const COL_GROUPS = [
    { key: 'groceries', match: c => c === 'Food:Groceries' || c === 'Food', color: chartPalette()[10] },
    { key: 'housing', match: c => c.startsWith('Bills:'), color: chartPalette()[0] },
    { key: 'home', match: c => c.startsWith('Home:'), color: chartPalette()[3] },
    { key: 'health', match: c => c.startsWith('Healthcare:') || c === 'Healthcare', color: chartPalette()[11] },
    { key: 'transport', match: c => c.startsWith('Transport') || (c.startsWith('Automobile:') && c !== 'Automobile:Purchase'), color: chartPalette()[1] },
    { key: 'subscriptions', match: c => c.startsWith('Subscriptions:'), color: chartPalette()[2] },
    { key: 'leisure', match: c => c.startsWith('Leisure') || c === 'Leisure', color: chartPalette()[4] },
    { key: 'personal', match: c => c.startsWith('Personal:'), color: chartPalette()[7] },
    { key: 'kids', match: c => c.startsWith('Kids:') || c === 'Kids', color: chartPalette()[6] },
    { key: 'pet', match: c => c.startsWith('Pet:') || c === 'Pet', color: chartPalette()[5] },
    { key: 'other', match: () => true, color: chartPalette()[9] },
  ];
  const colGroupLabel = k => t(`reports.col.group.${k}.label`, {}, k);
  const colGroupDesc = k => t(`reports.col.group.${k}.desc`, {}, '');

  function classifyGroup(cat) {
    for (const g of COL_GROUPS) {
      if (g.match(cat)) return g.key;
    }
    return 'other';
  }

  function update() {
    tb.el('year').style.display = tb.get('mode') === 'yearly' ? 'none' : '';
    destroyReportCharts();

    const currency = tb.get('cur');
    const colTx = state.tx
      .filter(t => isCostOfLivingTx(t, custodyAliases, nonPnl))
      .map(t => ({ ...t, amount: convertTo(t.amount, t.currency, currency) }));

    if (tb.get('mode') === 'monthly') renderColMonthly(colTx, tb.get('year'), currency);
    else renderColYearly(colTx, currency);
  }

  function renderColMonthly(tx, year, currency) {
    const yearTx = tx.filter(t => t.date && t.date.startsWith(year));

    // Detect visit months: any month where a TX has a tag containing "Visit"
    const visitMonths = new Set();
    for (const t of state.tx) {
      if (!t.date || !t.date.startsWith(year)) continue;
      const tags = (t.tags || '').split(';');
      if (tags.some(tag => tag.includes('Visit'))) visitMonths.add(t.date.slice(0, 7));
    }

    const months = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      const monthTx = yearTx.filter(t => t.date.startsWith(ym));
      const row = { ym, label: monthLabel(ym), total: 0, count: monthTx.length, hasVisit: visitMonths.has(ym) };
      for (const g of COL_GROUPS) row[g.key] = 0;
      for (const t of monthTx) {
        row[classifyGroup(t.category)] += t.amount;
        row.total += t.amount;
      }
      months.push(row);
    }

    // Calculate visit-tagged spending per month
    for (const m of months) {
      m.visitSpend = 0;
      if (m.hasVisit) {
        for (const t of yearTx) {
          if (!t.date || !t.date.startsWith(m.ym)) continue;
          const tags = (t.tags || '').split(';');
          if (tags.some(tag => tag.includes('Visit'))) m.visitSpend += t.amount;
        }
      }
    }

    const grandTotal = months.reduce((s, m) => s + m.total, 0);
    const totalVisitSpend = months.reduce((s, m) => s + m.visitSpend, 0);
    const activeMonths = months.filter(m => m.total > 0).length;
    const avgPerMonth = activeMonths > 0 ? grandTotal / activeMonths : 0;
    const avgExclVisit = activeMonths > 0 ? (grandTotal - totalVisitSpend) / activeMonths : 0;

    // Group totals for pie + table
    const groupTotals = COL_GROUPS.map(g => ({
      ...g, total: months.reduce((s, m) => s + m[g.key], 0),
    })).filter(g => g.total > 0);

    // What was excluded
    const allExpTx = state.tx.filter(t =>
      t.type === 'expense' && t.date && t.date.startsWith(year) &&
      !custodyAliases.has(t.account) && !nonPnl.has(t.category)
    );
    const totalAllExp = allExpTx.reduce((s, t) => s + convertTo(t.amount, t.currency, currency), 0);
    const excludedTotal = totalAllExp - grandTotal;

    const names = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => t(`common.months.short.${m}`, {}, ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]));
    const content = document.getElementById('col-content');
    const excludedList = [...getNonEssentialCategories()].sort().map(c => escapeHtml(c)).join(' · ') || `<em>${t('reports.col.excluded.none', {}, 'none')}</em>`;
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.col.monthly.title', { year, currency }, `Cost of Living ${year} (${currency})`)}</div>
        <div class="income-grid">
          <div class="income-cell">
            <div class="ic-label">${t('reports.col.tile.living', {}, 'Living Expenses')}</div>
            <div class="ic-value c-info">${formatCurrency(grandTotal, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.col.tile.living_sub', { count: yearTx.length }, `${yearTx.length} TX`)}</div>
          </div>
          <div class="income-cell">
            <div class="ic-label">${t('reports.col.tile.avg', {}, 'Avg / Month')}</div>
            <div class="ic-value">${formatCurrency(avgPerMonth, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.col.tile.avg_sub', { n: activeMonths }, `${activeMonths} active months`)}</div>
          </div>
          ${visitMonths.size > 0 ? `<div class="income-cell">
            <div class="ic-label">${t('reports.col.tile.avg_no_visitors', {}, 'Avg excl. Visitors')}</div>
            <div class="ic-value" style="color:var(--positive)">${formatCurrency(avgExclVisit, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.col.tile.avg_no_visitors_sub', { amt: formatCurrency(totalVisitSpend, currency) }, `${formatCurrency(totalVisitSpend, currency)} visitor spending removed`)}</div>
          </div>` : ''}
          <div class="income-cell">
            <div class="ic-label c-mut">${t('reports.col.tile.excluded', {}, 'Excluded')}</div>
            <div class="ic-value c-mut">${formatCurrency(excludedTotal, currency)}<span class="ic-cur">${currency}</span></div>
            <div class="ic-count">${t('reports.col.tile.excluded_sub', {}, 'Dining, Staff, Permits, Fines, Purchase, Loans, Cash Diff')}</div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.col.chart.stack', {}, 'Monthly Breakdown by Category')}</div>
            <div class="chart-canvas-box"><canvas id="col-stack-chart"></canvas></div>
          </div>
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.col.chart.pie', {}, 'Category Distribution')}</div>
            <div class="chart-canvas-box"><canvas id="col-pie-chart"></canvas></div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="chart-wrap">
          <div class="report-section-title">${t('reports.col.chart.trend', {}, 'Monthly Total Trend')}</div>
          <div class="chart-canvas-box"><canvas id="col-trend-chart"></canvas></div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t('reports.col.section.monthly_detail', { currency }, `Monthly Detail (${currency})`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table nowrap">
          <thead><tr>
            <th>${t('common.label.month', {}, 'Month')}</th>
            ${groupTotals.map(g => `<th class="t-right" title="${escapeHtml(colGroupDesc(g.key))}"><span style="border-bottom:1px dotted var(--muted);cursor:help;">${colGroupLabel(g.key)}</span></th>`).join('')}
            <th class="num-right">${t('reports.col.col.total', {}, 'Total')}</th>
          </tr></thead>
          <tbody>
            ${months.map(m => `<tr style="${m.hasVisit ? 'background:var(--warn-bg);' : ''}">
              <td>${m.label}${m.hasVisit ? ` <span title="${t('reports.col.visitor.marker_title', {}, 'Visitor month')}" style="color:var(--warn);font-size:10px;">&#9679;</span>` : ''}</td>
              ${groupTotals.map(g => `<td class="amt" style="color:${g.color}">${formatCurrency(m[g.key], currency)}</td>`).join('')}
              <td class="amt fw-700">${formatCurrency(m.total, currency)}</td>
            </tr>`).join('')}
            <tr class="row-total">
              <td>${t('reports.col.row.total', {}, 'Total')}</td>
              ${groupTotals.map(g => `<td class="amt" style="color:${g.color}">${formatCurrency(g.total, currency)}</td>`).join('')}
              <td class="amt">${formatCurrency(grandTotal, currency)}</td>
            </tr>
          </tbody>
        </table></div>
      </div>
      <div class="report-section">
        <details class="c-mut2" style="font-size:12px;line-height:1.5;">
          <summary class="ptr fw-600 c-text">${t('reports.col.legend.title', {}, 'What counts in each column?')}</summary>
          <div class="mt-8">
            ${COL_GROUPS.map(g => `<div style="padding:3px 0;"><strong style="color:${g.color};">${colGroupLabel(g.key)}:</strong> ${escapeHtml(colGroupDesc(g.key))}</div>`).join('')}
            <div style="margin-top:8px;opacity:0.8;"><em>${t('reports.col.legend.footer', {}, 'Hover a column header in the tables above for the same info inline.')}</em></div>
          </div>
        </details>
        <div class="report-section-title" style="color:var(--muted);font-size:0.85em;margin-top:12px;">${t('reports.col.excluded.monthly_line', { list: excludedList }, `Excluded (non-essential, from Settings → Categories): ${excludedList}`)}</div>
        ${visitMonths.size > 0 ? `<div style="color:var(--muted);font-size:0.85em;margin-top:6px;">
          <span class="c-warn">&#9679;</span> ${t('reports.col.visitor.line_prefix', {}, 'Visitor months:')} ${months.filter(m => m.hasVisit).map(m => t('reports.col.visitor.line_cell', { month: m.label, amt: formatCurrency(m.visitSpend, currency) }, `${m.label} (${formatCurrency(m.visitSpend, currency)} visitor-tagged)`)).join(' · ')}
          ${t('reports.col.visitor.line_suffix', {}, '— "Avg excl. Visitors" subtracts only Visit-tagged TX, not the entire month.')}
        </div>` : ''}
      </div>
    `;

    // Stacked bar
    const stackCtx = document.getElementById('col-stack-chart');
    if (stackCtx) {
      const chart = new Chart(stackCtx, {
        type: 'bar',
        data: {
          labels: names,
          datasets: groupTotals.map(g => ({
            label: colGroupLabel(g.key),
            data: months.map(m => m[g.key]),
            backgroundColor: g.color,
            borderWidth: 0,
          })),
        },
        options: {
          ...CHART_BASE,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, currency)} ${currency}` } },
          },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }

    // Doughnut
    const pieCtx = document.getElementById('col-pie-chart');
    if (pieCtx) {
      const chart = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
          labels: groupTotals.map(g => colGroupLabel(g.key)),
          datasets: [{ data: groupTotals.map(g => g.total), backgroundColor: groupTotals.map(g => g.color), borderWidth: 0 }],
        },
        options: {
          ...CHART_BASE,
          plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.label}: ${formatCurrency(c.raw, currency)} ${currency} (${(c.raw / grandTotal * 100).toFixed(1)}%)` } },
          },
        },
      });
      reportCharts.push(chart);
    }

    // Trend line
    const trendCtx = document.getElementById('col-trend-chart');
    if (trendCtx) {
      const chart = new Chart(trendCtx, {
        type: 'line',
        data: {
          labels: names,
          datasets: [{
            label: t('reports.col.dataset.label', {}, 'Cost of Living'),
            data: months.map(m => m.total),
            borderColor: cssVar('--accent'),
            backgroundColor: cssVar('--accent-glow'),
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            borderWidth: 2,
          }],
        },
        options: {
          ...CHART_BASE,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => `${formatCurrency(c.raw, currency)} ${currency}` } },
          },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  function renderColYearly(tx, currency) {
    const allYears = getAvailableYears();

    const data = allYears.map(y => {
      const yearTx = tx.filter(t => t.date && t.date.startsWith(y));
      const row = { year: y, total: 0, count: yearTx.length };
      for (const g of COL_GROUPS) row[g.key] = 0;
      for (const t of yearTx) {
        row[classifyGroup(t.category)] += t.amount;
        row.total += t.amount;
      }
      return row;
    });

    const groupTotals = COL_GROUPS.map(g => ({
      ...g, total: data.reduce((s, d) => s + d[g.key], 0),
    })).filter(g => g.total > 0);

    const content = document.getElementById('col-content');
    content.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t('reports.col.yearly.title', { currency }, `Cost of Living by Year (${currency})`)}</div>
        <div class="table-scroll-wrapper"><table class="tx-table nowrap">
          <thead><tr>
            <th>${t('common.col.year', {}, 'Year')}</th>
            ${groupTotals.map(g => `<th class="t-right" title="${escapeHtml(colGroupDesc(g.key))}"><span style="border-bottom:1px dotted var(--muted);cursor:help;">${colGroupLabel(g.key)}</span></th>`).join('')}
            <th class="num-right">${t('reports.col.col.total', {}, 'Total')}</th>
            <th class="t-right">${t('reports.col.col.avg_month', {}, 'Avg/Month')}</th>
          </tr></thead>
          <tbody>
            ${data.map(d => {
              const activeMonths = Math.max(1, d.year === new Date().getFullYear().toString() ? new Date().getMonth() + 1 : 12);
              return `<tr>
              <td class="fw-500">${d.year}</td>
              ${groupTotals.map(g => `<td class="amt" style="color:${g.color}">${formatCurrency(d[g.key], currency)}</td>`).join('')}
              <td class="amt fw-700">${formatCurrency(d.total, currency)}</td>
              <td class="amt c-mut">${formatCurrency(d.total / activeMonths, currency)}</td>
            </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>
      <div class="report-section">
        <div class="chart-row">
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.col.chart.year_stack', {}, 'Yearly Breakdown')}</div>
            <div class="chart-canvas-box"><canvas id="col-year-stack"></canvas></div>
          </div>
          <div class="chart-wrap">
            <div class="report-section-title">${t('reports.col.chart.year_trend', {}, 'Total Cost of Living Trend')}</div>
            <div class="chart-canvas-box"><canvas id="col-year-trend"></canvas></div>
          </div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title" style="color:var(--muted);font-size:0.85em;">${t('reports.col.excluded.yearly_line', {}, 'Excluded: Dining out · Staff · Permits · Fines · Travel · Car Purchase · Loans · Cash Discrepancy')}</div>
      </div>
    `;

    const stackCtx = document.getElementById('col-year-stack');
    if (stackCtx) {
      const chart = new Chart(stackCtx, {
        type: 'bar',
        data: {
          labels: data.map(d => d.year),
          datasets: groupTotals.map(g => ({
            label: colGroupLabel(g.key),
            data: data.map(d => d[g.key]),
            backgroundColor: g.color,
            borderWidth: 0,
          })),
        },
        options: {
          ...CHART_BASE,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw, currency)} ${currency}` } },
          },
          scales: {
            x: { stacked: true, grid: { color: cssVar('--chart-grid') } },
            y: { stacked: true, ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }

    const trendCtx = document.getElementById('col-year-trend');
    if (trendCtx) {
      const chart = new Chart(trendCtx, {
        type: 'line',
        data: {
          labels: data.map(d => d.year),
          datasets: [{
            label: t('reports.col.dataset.label', {}, 'Cost of Living'),
            data: data.map(d => d.total),
            borderColor: cssVar('--accent'),
            backgroundColor: cssVar('--accent-glow'),
            fill: true,
            tension: 0.3,
            pointRadius: 5,
            borderWidth: 2,
          }],
        },
        options: {
          ...CHART_BASE,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${formatCurrency(c.raw, currency)} ${currency}` } } },
          scales: {
            x: { grid: { color: cssVar('--chart-grid') } },
            y: { ticks: currencyTicks(currency), grid: { color: cssVar('--chart-grid') } },
          },
        },
      });
      reportCharts.push(chart);
    }
  }

  tb.wire(update);
}

function renderBudgetActualReport() {
  const out = document.getElementById('report-output');
  const budgets = state.budgets || [];

  if (budgets.length === 0) {
    out.innerHTML = `
      <div class="report-view">
        <div class="empty-state" style="padding:48px 24px;text-align:center;">
          <div class="empty-state-icon" style="font-size:32px;margin-bottom:12px;">&#x1F4CA;</div>
          <div class="empty-state-title fw-600 mb-6">${t('reports.budget.empty_title', {}, 'No budgets defined')}</div>
          <div class="empty-state-desc c-mut fs-12 mb-16">${t('reports.budget.empty_desc', {}, 'Add monthly budgets in Settings → Budgets to see this report.')}</div>
          <a href="#settings" data-action="presetSettingsTab" data-arg1="budgets" style="padding:6px 14px;background:var(--accent);color:var(--bg);font-size:12px;text-decoration:none;border-radius:4px;">${t('reports.budget.go_settings', {}, 'Open Settings')}</a>
        </div>
      </div>
    `;
    return;
  }

  // DR-M4: toolbar rendering/persistence/wiring live in reportToolbar().
  // Period choice stays persisted as data-budget-* so re-renders preserve it.
  const years = getAvailableYears();
  const tb = reportToolbar(out, 'budget', [
    { key: 'period', label: t('reports.toolbar.period', {}, 'Period'), def: 'current',
      options: [
        { v: 'current', l: t('reports.budget.period_current', {}, 'Current month') },
        { v: 'last', l: t('reports.budget.period_last', {}, 'Last month') },
        { v: 'ytd', l: t('reports.budget.period_ytd', {}, 'Year to date') },
        { v: 'year', l: t('reports.budget.period_year', {}, 'Full year') },
      ] },
    { key: 'year', label: t('reports.toolbar.year', {}, 'Year'),
      options: years, def: years[years.length - 1] || String(new Date().getFullYear()) },
  ]);

  out.innerHTML = `
    <div class="report-view">
      ${tb.html}
      <div id="bud-content"></div>
    </div>
  `;

  function update() {
    const needsYear = tb.get('period') === 'year' || tb.get('period') === 'ytd';
    tb.el('year').style.display = needsYear ? '' : 'none';
    // The factory renders each label directly before its select, so the
    // year label toggles via previousElementSibling (was #bud-year-lbl).
    tb.el('year').previousElementSibling.style.display = needsYear ? '' : 'none';
    destroyReportCharts();
    renderBudgetActualBody(tb.get('period'), tb.get('year'));
  }

  tb.wire(update);
}

function renderBudgetActualBody(period, year) {
  const container = document.getElementById('bud-content');
  const cur = displayCurrency;
  const budgets = state.budgets || [];

  // Resolve period → (label, monthFilter, multiplier)
  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1; // 1-12
  let periodLabel, txFilter, multiplier, monthsInPeriod;

  if (period === 'current') {
    const ym = state.currentMonth || `${todayYear}-${String(todayMonth).padStart(2, '0')}`;
    periodLabel = new Date(ym + '-01').toLocaleDateString(getLocaleTag(), { month: 'long', year: 'numeric' });
    txFilter = (t) => t.date && t.date.startsWith(ym);
    multiplier = 1;
    monthsInPeriod = 1;
  } else if (period === 'last') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    periodLabel = d.toLocaleDateString(getLocaleTag(), { month: 'long', year: 'numeric' });
    txFilter = (t) => t.date && t.date.startsWith(ym);
    multiplier = 1;
    monthsInPeriod = 1;
  } else if (period === 'ytd') {
    const y = parseInt(year, 10);
    // If selected year is the current year → through today's month. Otherwise → full year (12 months).
    const monthsElapsed = y === todayYear ? todayMonth : 12;
    periodLabel = `${t('reports.budget.period_ytd', {}, 'Year to date')} ${y} (${monthsElapsed} ${monthsElapsed === 1 ? t('reports.budget.month', {}, 'month') : t('reports.budget.months', {}, 'months')})`;
    txFilter = (t) => {
      if (!t.date || !t.date.startsWith(String(y))) return false;
      const m = parseInt(t.date.slice(5, 7), 10);
      return m >= 1 && m <= monthsElapsed;
    };
    multiplier = monthsElapsed;
    monthsInPeriod = monthsElapsed;
  } else {
    // Full year
    const y = String(year);
    periodLabel = `${t('reports.budget.period_year', {}, 'Full year')} ${y}`;
    txFilter = (t) => t.date && t.date.startsWith(y);
    multiplier = 12;
    monthsInPeriod = 12;
  }

  // Compute per-budget actuals. DR-M6: exclude custody accounts and
  // non-P&L categories via the shared filter (like every other report) —
  // custody spending (e.g. groceries booked for someone else's money)
  // must not inflate 'Actual' or fire over-budget alerts.
  const custodyAliases = getCustodyAliases();
  const nonPnl = getNonPnlCategories();
  const expenses = state.tx.filter(tx =>
    tx.type === 'expense' && txFilter(tx) && isOperationalTx(tx, custodyAliases, nonPnl)
  );

  const items = budgets.map(b => {
    const matching = expenses.filter(t => (t.category || '').startsWith(b.category));
    const actual = matching.reduce((s, t) => s + convertTo(t.amount, t.currency, cur), 0);
    const budgetForPeriod = convertTo(b.amount * multiplier, b.currency, cur);
    const variance = actual - budgetForPeriod;
    const pct = budgetForPeriod > 0 ? (actual / budgetForPeriod) * 100 : 0;
    let status = 'ok';
    if (pct >= 100) status = 'over';
    else if (pct >= 80) status = 'warn';
    return { ...b, actual, budget: budgetForPeriod, variance, pct, status, txCount: matching.length };
  }).sort((a, b) => b.pct - a.pct);

  const totalBudget = items.reduce((s, i) => s + i.budget, 0);
  const totalActual = items.reduce((s, i) => s + i.actual, 0);
  const totalVariance = totalActual - totalBudget;
  const totalPct = totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0;
  const overCount = items.filter(i => i.status === 'over').length;

  const statusColors = {
    ok: 'var(--positive)',
    warn: 'var(--warn)',
    over: 'var(--negative)',
  };
  const statusLabels = {
    ok: t('reports.budget.status_ok', {}, 'On track'),
    warn: t('reports.budget.status_warn', {}, 'Watch'),
    over: t('reports.budget.status_over', {}, 'Over'),
  };

  container.innerHTML = `
    <div style="margin-bottom:8px;color:var(--muted);font-size:11px;">${escapeHtml(periodLabel)}${monthsInPeriod > 1 ? ` · ${t('reports.budget.budget_x_months', { n: monthsInPeriod }, `Budget = monthly × ${monthsInPeriod}`)}` : ''}</div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="label">${t('reports.budget.kpi_budget', {}, 'Total Budget')}</div>
        <div class="value">${formatCurrency(totalBudget, cur)} <span class="cur">${cur}</span></div>
      </div>
      <div class="kpi-card">
        <div class="label">${t('reports.budget.kpi_actual', {}, 'Total Actual')}</div>
        <div class="value">${formatCurrency(totalActual, cur)} <span class="cur">${cur}</span></div>
      </div>
      <div class="kpi-card">
        <div class="label">${t('reports.budget.kpi_variance', {}, 'Variance')}</div>
        <div class="value ${totalVariance > 0 ? 'negative' : 'positive'}">${totalVariance > 0 ? '+' : ''}${formatCurrency(totalVariance, cur)} <span class="cur">${cur}</span></div>
        <div class="delta">${totalPct.toFixed(0)}% ${t('reports.budget.of_budget', {}, 'of budget')}</div>
      </div>
      <div class="kpi-card">
        <div class="label">${t('reports.budget.kpi_over', {}, 'Over budget')}</div>
        <div class="value ${overCount > 0 ? 'negative' : 'positive'}">${overCount} / ${items.length}</div>
      </div>
    </div>

    <section class="section mb-24">
      <div class="section-title">${t('reports.budget.chart_title', {}, 'Budget vs. Actual per Category')}</div>
      <div style="position:relative;height:${Math.max(180, items.length * 36 + 60)}px;">
        <canvas id="bud-chart"></canvas>
      </div>
    </section>

    <section class="section">
      <div class="section-title">${t('reports.budget.table_title', {}, 'Detail')}</div>
      <table class="tx-table" style="width:100%;">
        <thead>
          <tr>
            <th>${t('common.col.category', {}, 'Category')}</th>
            <th class="amt">${t('reports.budget.col_budget', {}, 'Budget')}</th>
            <th class="amt">${t('reports.budget.col_actual', {}, 'Actual')}</th>
            <th class="amt">${t('reports.budget.col_variance', {}, 'Variance')}</th>
            <th class="amt">${t('reports.budget.col_pct', {}, '%')}</th>
            <th>${t('reports.budget.col_status', {}, 'Status')}</th>
            <th class="amt">${t('reports.budget.col_tx', {}, 'TX')}</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(i => `
            <tr>
              <td>${escapeHtml(i.category)}</td>
              <td class="amt">${formatCurrency(i.budget, cur)}</td>
              <td class="amt">${formatCurrency(i.actual, cur)}</td>
              <td class="amt" style="color:${i.variance > 0 ? 'var(--negative)' : 'var(--positive)'};">${i.variance > 0 ? '+' : ''}${formatCurrency(i.variance, cur)}</td>
              <td class="amt"><strong style="color:${statusColors[i.status]};">${i.pct.toFixed(0)}%</strong></td>
              <td><span style="display:inline-block;padding:2px 8px;font-size:10px;font-weight:600;background:${statusColors[i.status]};color:var(--bg);border-radius:3px;">${statusLabels[i.status]}</span></td>
              <td class="amt c-mut fs-11">${i.txCount}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr style="font-weight:600;border-top:2px solid var(--border);">
            <td>${t('common.total', {}, 'Total')}</td>
            <td class="amt">${formatCurrency(totalBudget, cur)}</td>
            <td class="amt">${formatCurrency(totalActual, cur)}</td>
            <td class="amt" style="color:${totalVariance > 0 ? 'var(--negative)' : 'var(--positive)'};">${totalVariance > 0 ? '+' : ''}${formatCurrency(totalVariance, cur)}</td>
            <td class="amt">${totalPct.toFixed(0)}%</td>
            <td></td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </section>
  `;

  // Bar chart: horizontal, two bars per category
  const ctx = document.getElementById('bud-chart');
  if (ctx) {
    // Status colors resolved at render time so theme switches re-render right
    const cPos = cssVar('--positive'), cWarn = cssVar('--warn'),
          cNeg = cssVar('--negative'), cMut = cssVar('--muted');
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: items.map(i => i.category),
        datasets: [
          {
            label: t('reports.budget.kpi_budget', {}, 'Total Budget'),
            data: items.map(i => i.budget),
            backgroundColor: chartTint(cMut, 0.55),
            borderColor: cMut,
            borderWidth: 1,
          },
          {
            label: t('reports.budget.kpi_actual', {}, 'Total Actual'),
            data: items.map(i => i.actual),
            backgroundColor: items.map(i => i.status === 'over' ? chartTint(cNeg, 0.7) : i.status === 'warn' ? chartTint(cWarn, 0.7) : chartTint(cPos, 0.7)),
            borderColor: items.map(i => i.status === 'over' ? cNeg : i.status === 'warn' ? cWarn : cPos),
            borderWidth: 1,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        ...CHART_BASE,
        plugins: {
          legend: { position: 'top', labels: { font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (c) => `${c.dataset.label}: ${formatCurrency(c.parsed.x, cur)} ${cur}`,
            },
          },
        },
        scales: {
          x: {
            ticks: currencyTicks(cur),
            grid: { color: cssVar('--chart-grid') },
          },
          y: {
            grid: { display: false },
            ticks: { font: { size: 11 } },
          },
        },
      },
    });
    reportCharts.push(chart);
  }
}

