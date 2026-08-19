function exportReportTables() {
  const output = document.getElementById('report-output');
  if (!output) return;
  const tables = output.querySelectorAll('table');
  if (tables.length === 0) { uiAlert(t('reports.export.err_no_tables', {}, 'No tables to export in this report.')); return; }
  if (typeof XLSX === 'undefined') { uiAlert(t('reports.export.err_no_xlsx', {}, 'XLSX library not loaded')); return; }

  const wb = XLSX.utils.book_new();
  tables.forEach((table, i) => {
    const ws = XLSX.utils.table_to_sheet(table);
    const name = `Sheet${i + 1}`;
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  const report = getAllReports().find(r => r.id === activeReportId);
  const title = report ? report.title.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30) : 'report';
  XLSX.writeFile(wb, `${title}_${localTodayIso()}.xlsx`);
}

// Export the current report as PDF. Shows an options modal first (orientation,
// page size, include charts), then triggers window.print() with the selected
// settings applied via body classes and an injected @page rule.
function exportReportPDF() {
  const detailEl = document.getElementById('reports-detail-view');
  if (!detailEl || detailEl.style.display === 'none') {
    uiAlert(t('reports.export.err_no_report', {}, 'Open a report first.'));
    return;
  }
  openPDFExportModal();
}

// Opens the PDF options modal. On confirm, runs runPDFExport(opts).
function openPDFExportModal() {
  // Remember last choices across opens within the session
  const prefs = window._pdfPrefs || { orientation: 'portrait', pageSize: 'A4', includeCharts: true };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay pdf-modal-overlay';
  overlay.innerHTML = `
    <div class="modal pdf-modal">
      <h3>${t('reports.pdf.title', {}, 'PDF <span class="accent">Export</span>')}</h3>
      <div class="pdf-opt-group">
        <div class="pdf-opt-label">${t('reports.pdf.label_orientation', {}, 'Orientation')}</div>
        <div class="pdf-seg" data-field="orientation">
          <button type="button" data-val="portrait" class="${prefs.orientation === 'portrait' ? 'active' : ''}">${t('reports.pdf.opt_portrait', {}, 'Portrait')}</button>
          <button type="button" data-val="landscape" class="${prefs.orientation === 'landscape' ? 'active' : ''}">${t('reports.pdf.opt_landscape', {}, 'Landscape')}</button>
        </div>
        <div class="pdf-opt-hint">${t('reports.pdf.hint_orientation', {}, 'Landscape fits wide tables (7+ columns) and side-by-side charts better.')}</div>
      </div>
      <div class="pdf-opt-group">
        <div class="pdf-opt-label">${t('reports.pdf.label_page_size', {}, 'Page Size')}</div>
        <div class="pdf-seg" data-field="pageSize">
          <button type="button" data-val="A4" class="${prefs.pageSize === 'A4' ? 'active' : ''}">A4</button>
          <button type="button" data-val="Letter" class="${prefs.pageSize === 'Letter' ? 'active' : ''}">Letter</button>
          <button type="button" data-val="A3" class="${prefs.pageSize === 'A3' ? 'active' : ''}">A3</button>
        </div>
      </div>
      <div class="pdf-opt-group">
        <label class="pdf-toggle">
          <input type="checkbox" id="pdf-include-charts" ${prefs.includeCharts ? 'checked' : ''}>
          <span>${t('reports.pdf.include_charts', {}, 'Include charts')}</span>
        </label>
        <div class="pdf-opt-hint">${t('reports.pdf.hint_include_charts', {}, 'Uncheck for a numbers-only report (smaller file, faster print).')}</div>
      </div>
      <div class="modal-footer">
        <div class="btn-left"></div>
        <div class="btn-right">
          <button type="button" class="pdf-btn-cancel">${t('common.actions.cancel', {}, 'Cancel')}</button>
          <button type="button" class="pdf-btn-generate btn-save">${t('reports.pdf.btn_generate', {}, 'Generate PDF')}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const readOpts = () => ({
    orientation: overlay.querySelector('.pdf-seg[data-field="orientation"] .active')?.dataset.val || 'portrait',
    pageSize: overlay.querySelector('.pdf-seg[data-field="pageSize"] .active')?.dataset.val || 'A4',
    includeCharts: overlay.querySelector('#pdf-include-charts').checked,
  });

  // Segmented-button toggling
  overlay.querySelectorAll('.pdf-seg').forEach(seg => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-val]');
      if (!btn) return;
      seg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const close = () => overlay.remove();
  overlay.querySelector('.pdf-btn-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const onEsc = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);

  overlay.querySelector('.pdf-btn-generate').addEventListener('click', () => {
    const opts = readOpts();
    window._pdfPrefs = opts;
    document.removeEventListener('keydown', onEsc);
    close();
    runPDFExport(opts);
  });
}

// Applies the chosen options, injects branded print header, triggers
// window.print(), and cleans up on afterprint.
function runPDFExport(opts) {
  const detailEl = document.getElementById('reports-detail-view');
  const report = getAllReports().find(r => r.id === activeReportId);
  const reportTitle = report
    ? t(`reports.${report.id}.title`, {}, report.title)
    : t('reports.fallback_title', {}, 'Report');

  const existingHeader = detailEl.querySelector('.print-header');
  if (existingHeader) existingHeader.remove();

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const currency = (typeof state !== 'undefined' && state.currency) ? state.currency : '';
  const versionEl = document.querySelector('footer span');
  const version = versionEl ? versionEl.textContent.replace(/.*?(v\d[\w.-]*).*/, '$1') : '';
  const pageLabel = `${opts.pageSize} · ${opts.orientation.charAt(0).toUpperCase() + opts.orientation.slice(1)}`;

  const header = document.createElement('div');
  header.className = 'print-header';
  header.innerHTML = `
    <div class="print-brand">FinanceOS</div>
    <div class="print-meta">
      <div class="print-report-name">${escapeHtml(reportTitle)}</div>
      <div class="print-meta-line">
        ${t('reports.print.generated', {}, 'Generated')} ${stamp}
        ${currency ? ` · ${currency}` : ''}
        ${version ? ` · ${version}` : ''}
        &nbsp;·&nbsp; ${pageLabel}
      </div>
    </div>
  `;
  detailEl.insertBefore(header, detailEl.firstChild);

  // Inject @page rule for chosen size+orientation. @page can't live inside
  // a class-scoped selector, so we swap the whole rule via a <style> tag.
  let pageStyle = document.getElementById('pdf-page-style');
  if (!pageStyle) {
    pageStyle = document.createElement('style');
    pageStyle.id = 'pdf-page-style';
    document.head.appendChild(pageStyle);
  }
  const margin = opts.orientation === 'landscape' ? '10mm 12mm' : '12mm 12mm';
  pageStyle.textContent = `@page { size: ${opts.pageSize} ${opts.orientation}; margin: ${margin}; }`;

  const root = document.documentElement;
  const wasDark = root.classList.contains('dark');
  if (wasDark) root.classList.remove('dark');
  document.body.classList.add('printing-report');
  if (opts.orientation === 'landscape') document.body.classList.add('pdf-landscape');
  if (!opts.includeCharts) document.body.classList.add('pdf-no-charts');

  // Chart.js canvases must re-layout for the print container dimensions.
  // Also auto-fit any tables that measure wider than the printable area —
  // the small-font CSS rules handle most cases, but pathological column
  // counts still need a transform scale to not clip at the page edge.
  const onBeforePrint = () => {
    for (const c of reportCharts) {
      try { c.resize(); } catch { /* ignore — chart may be destroyed */ }
    }
    autoFitWideTables(opts);
  };
  window.addEventListener('beforeprint', onBeforePrint);

  const cleanup = () => {
    document.body.classList.remove('printing-report', 'pdf-landscape', 'pdf-no-charts');
    if (wasDark) root.classList.add('dark');
    header.remove();
    if (pageStyle) pageStyle.remove();
    // Remove any auto-fit scaling
    document.querySelectorAll('[data-print-scale]').forEach(el => {
      el.removeAttribute('data-print-scale');
      el.style.removeProperty('--print-scale');
    });
    window.removeEventListener('afterprint', cleanup);
    window.removeEventListener('beforeprint', onBeforePrint);
    for (const c of reportCharts) {
      try { c.resize(); } catch { /* ignore */ }
    }
  };
  window.addEventListener('afterprint', cleanup);

  setTimeout(() => window.print(), 50);
}

// Measures each table wrapper and applies transform: scale() if its
// natural width exceeds the printable page width. Called from
// `beforeprint` — by then the print media rules are active, so the
// measurement reflects the shrunken-font print layout.
function autoFitWideTables(opts) {
  const sizes = {
    A4: { short: 210, long: 297 },
    Letter: { short: 216, long: 279 },
    A3: { short: 297, long: 420 },
  };
  const dims = sizes[opts.pageSize] || sizes.A4;
  const pageWidthMM = opts.orientation === 'landscape' ? dims.long : dims.short;
  const marginMM = opts.orientation === 'landscape' ? 28 : 28;
  const contentPx = (pageWidthMM - marginMM) * 3.7795; // mm → CSS px @ 96dpi

  const wrappers = document.querySelectorAll('#report-output .table-scroll-wrapper');
  for (const w of wrappers) {
    w.removeAttribute('data-print-scale');
    w.style.removeProperty('--print-scale');
    const table = w.querySelector('table');
    if (!table) continue;
    const natural = table.scrollWidth;
    if (natural > contentPx + 4) {
      const scale = Math.max(0.55, (contentPx - 4) / natural);
      w.setAttribute('data-print-scale', '1');
      w.style.setProperty('--print-scale', scale.toFixed(3));
    }
  }
}
