// ─── Reconciliation Page ─────────────────────────────────────────────────

const RECON_INDEX_URL = '../data/crdb_data/recon_index.json';
let reconTab = 'reports';

async function renderReconciliationPage() {
  const contentEl = document.getElementById('recon-content');

  contentEl.innerHTML = `
    <div class="atx-tabs mb-20">
      <button ${reconTab === 'reports' ? 'class="active"' : ''} data-recon-tab="reports">${t('pages.recon.tab.reports', {}, 'Reports')}</button>
      <button ${reconTab === 'import' ? 'class="active"' : ''} data-recon-tab="import">${t('pages.recon.tab.import', {}, 'Import')}</button>
    </div>
    <div id="recon-tab-content"></div>
  `;

  // Tab delegation
  if (!contentEl._delegated) {
    contentEl.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-recon-tab]');
      if (tabBtn) {
        reconTab = tabBtn.getAttribute('data-recon-tab');
        renderReconciliationPage();
        return;
      }
      // Book selected button
      if (e.target.closest('#recon-book-btn')) { bookReconSuggestions(); return; }
      // Select all checkbox
      if (e.target.id === 'recon-select-all') {
        const checked = e.target.checked;
        contentEl.querySelectorAll('.recon-row-check').forEach(c => c.checked = checked);
        return;
      }
    });
    contentEl._delegated = true;
  }

  if (reconTab === 'reports') await renderReconReports(document.getElementById('recon-tab-content'));
  else await renderReconImport(document.getElementById('recon-tab-content'));
}

async function renderReconReports(container) {
  container.innerHTML = `<div class="loading">${t('pages.recon.loading_reports', {}, 'Loading reconciliation data...')}</div>`;

  let index = [];
  try {
    const res = await fetch(RECON_INDEX_URL);
    if (res.ok) index = await res.json();
  } catch (e) { /* empty index */ }

  if (index.length === 0) {
    container.innerHTML = `
      <div class="section empty-state">
        <div class="empty-state-icon">&#x1F4CB;</div>
        <div class="empty-state-title">${t('pages.recon.empty.no_reports', {}, 'No reconciliation reports yet')}</div>
        <div class="empty-state-desc">Place CRDB bank statements in <code>data/crdb_data/</code> and run<br>a reconciliation via Claude Code. Results will appear here.</div>
      </div>
    `;
    return;
  }

  const selectedId = container.getAttribute('data-recon-selected') || index[0].id;

  container.innerHTML = `
    <div class="report-toolbar mb-16">
      <label>Period</label>
      <select id="recon-select">
        ${index.map(r => `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''}>${r.label}</option>`).join('')}
      </select>
    </div>
    <div id="recon-detail"></div>
  `;

  document.getElementById('recon-select').addEventListener('change', (e) => {
    container.setAttribute('data-recon-selected', e.target.value);
    renderReconReports(container);
  });

  const selected = index.find(r => r.id === selectedId) || index[0];

  try {
    const res = await fetch('../data/crdb_data/' + selected.file);
    if (!res.ok) throw new Error('Not found');
    const md = await res.text();
    const html = renderMarkdown(md);
    document.getElementById('recon-detail').innerHTML = `<div class="section">${html}</div>`;
  } catch (e) {
    document.getElementById('recon-detail').innerHTML = `<div class="error">Could not load ${selected.file}</div>`;
  }
}

// ─── CRDB Auto-Import ───────────────────────────────────────────────────

let reconSuggestions = [];

async function renderReconImport(container) {
  container.innerHTML = `<div class="loading">${t('pages.recon.loading_bankfiles', {}, 'Loading bank files...')}</div>`;

  // Fetch available XLS files
  let files = [];
  try {
    const res = await fetch('/api/recon/files', { method: 'POST' });
    const data = await res.json();
    files = data.files || [];
  } catch (e) {
    container.innerHTML = '<div class="error">Could not load bank files. Is the server running?</div>';
    return;
  }

  if (files.length === 0) {
    container.innerHTML = `
      <div class="section">
        <div class="section-title">${t('pages.recon.empty.no_statements', {}, 'No bank statements found')}</div>
        <p class="hint-md">Place CRDB XLS files in <code>data/crdb_data/</code> to import unmatched transactions.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="report-toolbar mb-16">
      <label>Bank Statement</label>
      <select id="recon-file-select">
        ${files.map((f, i) => `<option value="${escapeHtml(f.name)}" ${i === 0 ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
      </select>
      <button class="btn-save" id="recon-scan-btn" style="padding:8px 16px;">${t('pages.recon.btn.scan_unmatched', {}, 'Scan for Unmatched')}</button>
    </div>
    <div id="recon-import-status"></div>
    <div id="recon-import-results"></div>
  `;

  document.getElementById('recon-scan-btn').addEventListener('click', () => {
    const filename = document.getElementById('recon-file-select').value;
    if (filename) scanForSuggestions(filename);
  });
}

async function scanForSuggestions(filename) {
  const statusEl = document.getElementById('recon-import-status');
  const resultsEl = document.getElementById('recon-import-results');
  statusEl.innerHTML = `<div class="atx-status warning"><span class="atx-spinner"></span>${t('pages.recon.spinner.scanning', {}, 'Scanning bank statement...')}</div>`;
  resultsEl.innerHTML = '';

  try {
    const res = await fetch('/api/recon/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
    const data = await res.json();
    if (data.error) { statusEl.innerHTML = `<div class="atx-status error">${escapeHtml(data.error)}</div>`; return; }

    reconSuggestions = data.suggestions || [];
    const total = data.total_bank_rows || 0;
    const matched = data.matched || 0;

    statusEl.innerHTML = `
      <div class="income-grid mb-16">
        <div class="income-cell"><div class="ic-label">Bank Rows</div><div class="ic-value c-text">${total}</div></div>
        <div class="income-cell"><div class="ic-label">${t('pages.recon.label.already_booked', {}, 'Already Booked')}</div><div class="ic-value c-pos">${matched}</div></div>
        <div class="income-cell"><div class="ic-label">Unmatched</div><div class="ic-value ${reconSuggestions.length > 0 ? 'c-neg' : 'c-pos'}">${reconSuggestions.length}</div></div>
      </div>
    `;

    if (reconSuggestions.length === 0) {
      resultsEl.innerHTML = '<div class="section"><p class="hint-md">All bank transactions are already booked.</p></div>';
      return;
    }

    const rows = reconSuggestions.map((s, i) => {
      const confClass = s.match_confidence === 'high' ? 'c-pos' : s.match_confidence === 'medium' ? 'style="color:var(--warn)"' : 'c-neg';
      const confLabel = s.match_confidence === 'high' ? 'high' : s.match_confidence === 'medium' ? 'med' : 'none';
      return `<tr>
        <td><input type="checkbox" class="recon-row-check" data-idx="${i}" checked></td>
        <td>${fmtDate(s.date)}</td>
        <td class="fs-10 c-mut2" style="max-width:200px;white-space:normal;">${escapeHtml(s.bank_details)}</td>
        <td class="amt ${s.type}">${formatCurrency(s.amount, 'TZS')}</td>
        <td><input type="text" value="${escapeHtml(s.payee)}" data-field="payee" data-idx="${i}" class="fs-11" style="width:120px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);"></td>
        <td><input type="text" value="${escapeHtml(s.category)}" data-field="category" data-idx="${i}" class="fs-11" style="width:140px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text);"></td>
        <td><span class="fs-10 ${confClass}">${confLabel}</span></td>
      </tr>`;
    }).join('');

    resultsEl.innerHTML = `
      <div class="section">
        <div class="section-title">Import Suggestions <span class="hint">${reconSuggestions.length} rows — edit payee/category, then book</span></div>
        <table class="tx-table">
          <thead><tr>
            <th><input type="checkbox" id="recon-select-all" checked></th>
            <th>Date</th><th>Bank Details</th><th class="amt">Amount</th><th>Payee</th><th>Category</th><th>Match</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="flex-row gap-sm mt-16">
          <button class="btn-save" id="recon-book-btn" style="padding:10px 24px;">${t('pages.recon.btn.book_selected', {}, 'Book Selected')}</button>
          <span class="hint-sm mt-8" id="recon-book-status"></span>
        </div>
      </div>
    `;

    // Wire inline edits back to reconSuggestions
    resultsEl.querySelectorAll('input[data-field]').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.getAttribute('data-idx'));
        const field = inp.getAttribute('data-field');
        if (reconSuggestions[idx]) reconSuggestions[idx][field] = inp.value;
      });
    });

  } catch (e) {
    statusEl.innerHTML = `<div class="atx-status error">${t('pages.recon.err.scan_failed', { err: escapeHtml(e.message) }, `Scan failed: ${escapeHtml(e.message)}`)}</div>`;
  }
}

async function bookReconSuggestions() {
  const statusEl = document.getElementById('recon-book-status');
  const checkboxes = document.querySelectorAll('.recon-row-check:checked');
  const indices = Array.from(checkboxes).map(c => parseInt(c.getAttribute('data-idx')));

  if (indices.length === 0) { statusEl.textContent = t('pages.recon.err.no_rows_selected', {}, 'No rows selected.'); return; }

  // Build TX lines from selected suggestions
  const lines = indices.map(i => {
    const s = reconSuggestions[i];
    return {
      date: s.date,
      account: 'crdb',
      type: s.type,
      amount: String(s.amount),
      currency: 'TZS',
      payee: s.payee || '(unknown)',
      category: s.category || '',
      note: 'CRDB import: ' + (s.bank_details || '').slice(0, 60),
      tags: '',
    };
  }).filter(l => l.payee && l.category); // skip incomplete

  if (lines.length === 0) {
    statusEl.textContent = t('pages.recon.err.fill_required', {}, 'Fill in payee and category for selected rows first.');
    return;
  }

  if (lines.length < indices.length) {
    const skipped = indices.length - lines.length;
    if (!(await uiConfirm(t('pages.recon.confirm.skipped_rows', { skipped, count: lines.length }, `${skipped} row(s) have empty payee/category and will be skipped. Book ${lines.length} rows?`)))) return;
  }

  statusEl.innerHTML = `<span class="atx-spinner"></span>${t('pages.recon.spinner.booking', {}, 'Booking...')}`;

  try {
    const res = await fetch('/api/tx/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines, raw_input: '(CRDB import)' }),
    });
    const data = await res.json();
    if (data.error) { statusEl.textContent = t('pages.recon.err.generic_prefix', { err: data.error }, `Error: ${data.error}`); return; }
    statusEl.innerHTML = `<span class="c-pos">${t('pages.recon.ok.booked', { count: lines.length, ids: data.import_ids.join(', ') }, `Booked ${lines.length} transactions. IDs: ${data.import_ids.join(', ')}`)}</span>`;
    // Reload data
    setTimeout(() => boot(), 500);
  } catch (e) {
    statusEl.textContent = t('pages.recon.err.booking_failed', { err: e.message }, `Booking failed: ${e.message}`);
  }
}

function renderMarkdown(md) {
  let html = '';
  const lines = md.split('\n');
  let inTable = false;
  let tableRows = [];

  function flushTable() {
    if (tableRows.length < 2) { inTable = false; tableRows = []; return; }
    const headers = tableRows[0];
    const dataRows = tableRows.slice(2); // skip separator
    html += '<table class="tx-table"><thead><tr>' +
      headers.map(h => `<th>${h.trim()}</th>`).join('') +
      '</tr></thead><tbody>';
    for (const row of dataRows) {
      html += '<tr>' + row.map(c => {
        const v = c.trim();
        const isNum = /^[\d.,\-]+\s*(TZS|EUR|USD)?$/.test(v) || v === '**0,00**' || v.startsWith('**');
        return `<td${isNum ? ' class="amt"' : ''}>${v.replace(/\*\*/g, '')}</td>`;
      }).join('') + '</tr>';
    }
    html += '</tbody></table>';
    inTable = false;
    tableRows = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.slice(1, -1).split('|');
      if (!inTable) inTable = true;
      tableRows.push(cells);
      continue;
    }
    if (inTable) flushTable();
    if (trimmed.startsWith('# ')) {
      html += `<div class="report-section-title" style="font-size:14px;margin:24px 0 12px;">${trimmed.slice(2)}</div>`;
    } else if (trimmed.startsWith('## ')) {
      html += `<div class="report-section-title" style="margin:20px 0 8px;">${trimmed.slice(3)}</div>`;
    } else if (trimmed.startsWith('### ')) {
      html += `<div style="font-size:11px;color:var(--muted-soft);margin:16px 0 6px;letter-spacing:0.04em;">${trimmed.slice(4)}</div>`;
    } else if (trimmed === '') {
      // skip
    } else {
      let t = trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code style="color:var(--accent-dim)">$1</code>');
      html += `<p style="font-size:12px;color:var(--muted-soft);margin:4px 0;line-height:1.6;">${t}</p>`;
    }
  }
  if (inTable) flushTable();
  return html;
}

