// Custom Reports — filter engine + aggregations.
// Pure functions only. No DOM access. Consumed by the builder (live counter)
// and the runner (KPI / chart / pie / top-N rendering).

// ── Filter ──────────────────────────────────────────────────────────────

function applyCustomReportFilters(reportDef, allTx) {
  // Returns the subset of allTx that matches reportDef.
  // Honors per-block include/exclude mode and the report-level AND/OR match_mode.
  // Tx whose `tags` field is a semicolon-joined string are split lazily.
  const filters = reportDef.filters || {};
  const matchMode = reportDef.match_mode === 'OR' ? 'OR' : 'AND';

  // Default: exclude custody accounts and non-P&L categories (transfers,
  // reimbursements) to stay consistent with Fixed Reports. Users opt into
  // raw mode by setting exclude_operational_noise = false — useful when
  // auditing custody flows directly.
  const excludeOpNoise = reportDef.exclude_operational_noise !== false;
  const custodyAliases = excludeOpNoise ? getCustodyAliases() : null;
  const nonPnl = excludeOpNoise ? getNonPnlCategories() : null;

  // Pre-compute value sets for each filter block. Empty include block = no
  // constraint; empty exclude block also = no constraint.
  const blocks = {};
  for (const key of ['categories', 'tags', 'accounts', 'payees']) {
    const block = filters[key] || { mode: 'include', values: [] };
    blocks[key] = {
      mode: block.mode === 'exclude' ? 'exclude' : 'include',
      set: new Set(block.values || []),
      empty: !(block.values && block.values.length),
    };
  }

  const txTags = t => (t.tags || '').split(';').map(s => s.trim()).filter(Boolean);

  return allTx.filter(t => {
    if (excludeOpNoise && !isOperationalTx(t, custodyAliases, nonPnl)) return false;

    const checks = {
      categories: blocks.categories.empty ? null : blocks.categories.set.has(t.category),
      accounts:   blocks.accounts.empty   ? null : blocks.accounts.set.has(t.account),
      payees:     blocks.payees.empty     ? null : blocks.payees.set.has(t.payee),
      tags:       blocks.tags.empty       ? null : txTags(t).some(tag => blocks.tags.set.has(tag)),
    };

    // Apply mode (include / exclude) per block.
    const evaluated = {};
    for (const key of ['categories', 'tags', 'accounts', 'payees']) {
      if (checks[key] === null) { evaluated[key] = null; continue; }
      evaluated[key] = blocks[key].mode === 'exclude' ? !checks[key] : checks[key];
    }

    const active = Object.values(evaluated).filter(v => v !== null);
    if (active.length === 0) return true;  // no filters set → match everything

    return matchMode === 'AND' ? active.every(Boolean) : active.some(Boolean);
  });
}

function getFilteredTxCount(reportDef, allTx) {
  return applyCustomReportFilters(reportDef, allTx).length;
}

// ── Period window ───────────────────────────────────────────────────────
// Translates a preset (current/ytd/last12/all/custom) into a [from, to] ISO
// date range. Either bound may be null (meaning "open").

function computePeriodWindow(preset, customRange) {
  const now = new Date();
  const today = localIsoDate(now);
  const year = String(now.getFullYear());

  if (preset === 'all') return { from: null, to: null };
  if (preset === 'custom') {
    return {
      from: (customRange && customRange.from) || null,
      to:   (customRange && customRange.to)   || null,
    };
  }
  if (preset === 'ytd') return { from: year + '-01-01', to: today };
  if (preset === 'last12') {
    const past = new Date(now);
    past.setMonth(past.getMonth() - 12);
    past.setDate(past.getDate() + 1);  // inclusive of "12 months back"
    return { from: localIsoDate(past), to: today };
  }
  // 'current' default — current calendar year
  return { from: year + '-01-01', to: year + '-12-31' };
}

function filterByDateRange(tx, from, to) {
  if (!from && !to) return tx;
  return tx.filter(t => {
    const d = t.date || '';
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  });
}

// ── Aggregations ────────────────────────────────────────────────────────

function aggregateByPeriod(filteredTx, view) {
  // view: 'monthly' → bucket by YYYY-MM, 'yearly' → bucket by YYYY.
  // Returns Map(bucket → { income, expense, net }) sorted by key ascending.
  const buckets = new Map();
  for (const t of filteredTx) {
    if (!t.date) continue;
    const key = view === 'monthly' ? t.date.slice(0, 7) : t.date.slice(0, 4);
    if (!buckets.has(key)) buckets.set(key, { income: 0, expense: 0, net: 0 });
    const b = buckets.get(key);
    const amt = parseFloat(t.amount) || 0;
    if (t.type === 'income') { b.income += amt; b.net += amt; }
    else if (t.type === 'expense') { b.expense += amt; b.net -= amt; }
  }
  return new Map([...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function aggregateByDimension(filteredTx, dimension) {
  // dimension: 'category' | 'payee' | 'account' | 'tag'
  // Returns array of {label, value} (value = sum of expense amounts).
  // Tags are exploded — a TX with two tags contributes its full amount to each.
  const totals = new Map();
  // Local alias so the loop var `tx` doesn't shadow the global i18n t().
  const untaggedLabel = t('custom.label.untagged', {}, '(untagged)');
  const noneLabel = t('custom.label.none', {}, '(none)');
  for (const tx of filteredTx) {
    if (tx.type !== 'expense') continue;  // pie/topN focus on expenses
    const amt = parseFloat(tx.amount) || 0;
    if (dimension === 'tag') {
      const tags = (tx.tags || '').split(';').map(s => s.trim()).filter(Boolean);
      if (tags.length === 0) {
        totals.set(untaggedLabel, (totals.get(untaggedLabel) || 0) + amt);
      } else {
        for (const tag of tags) {
          totals.set(tag, (totals.get(tag) || 0) + amt);
        }
      }
    } else {
      const label = (tx[dimension] || noneLabel) + '';
      totals.set(label, (totals.get(label) || 0) + amt);
    }
  }
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function aggregateTopN(filteredTx, dimension, n) {
  return aggregateByDimension(filteredTx, dimension).slice(0, n);
}
