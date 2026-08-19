// ─── Shared Split-Line Renderer ───────────────────────────────────────────
// Add TX and the group mode of the Edit modal draw the same split rows.
//
// The original renderer lived in forms-add-tx.js and was unusable from a
// second caller for three reasons: it read the module-global `splitLines`,
// it hardcoded the container id, and its inline onchange handlers named
// that global as a string (`onchange="splitLines[3].amount=..."`). State
// arrives as an argument here and edits run through event delegation.
//
// Two details that look incidental but are not:
//   * The listener is attached once per container, not once per render —
//     innerHTML replaces the children, not the container, so re-attaching
//     would stack a new listener on every redraw.
//   * The listener reads the array off the element instead of closing over
//     it. Callers reassign their state array (Add TX does, when the last
//     split collapses back to a single line), and a captured reference
//     would keep writing into the discarded one.

function renderSplitRows({ containerId, lines, catOptionsHtml, onChange,
                           addAction, removeAction }) {
  const area = document.getElementById(containerId);
  if (!area) return;

  area._splitLines = lines;
  area._splitOnChange = onChange;

  const amountLabel = t('common.col.amount', {}, 'Amount');
  const removeTitle = t('atx.split.remove_title', {}, 'Remove');
  const noteLabel = t('atx.split.placeholder_note', {}, 'Note (optional)');

  let html = '<div class="split-block">';
  html += `<div class="split-block-heading">${t('atx.split.heading', {}, 'Split Lines')}</div>`;
  lines.forEach((s, i) => {
    html += `<div class="split-row">
      <div class="atx-field fx1"><input type="text" class="split-in" data-split-field="amount" data-split-idx="${i}" placeholder="${amountLabel}" value="${escapeHtml(s.amount || '')}"></div>
      <div class="atx-field fx2"><select class="split-in" data-split-field="category" data-split-idx="${i}">${catOptionsHtml}</select></div>
      <div class="atx-field fx2"><input type="text" class="split-in" data-split-field="note" data-split-idx="${i}" placeholder="${noteLabel}" value="${escapeHtml(s.note || '')}"></div>
      <button class="split-x-btn" data-action="${removeAction}" data-arg1="${i}" title="${removeTitle}" aria-label="${removeTitle}">&times;</button>
    </div>`;
  });
  html += `<button class="split-add-line-btn" data-action="${addAction}">${t('atx.split.btn_add_line', {}, '+ Add line')}</button>`;
  html += '</div>';
  area.innerHTML = html;

  // Selects can't carry their value through an HTML string — the option
  // list is cloned from the page's category dropdown, so the selection is
  // applied afterwards.
  area.querySelectorAll('select.split-in').forEach(sel => {
    const i = Number(sel.dataset.splitIdx);
    const line = lines[i];
    if (line && line.category) sel.value = line.category;
  });

  if (!area._splitDelegated) {
    area.addEventListener('change', (e) => {
      const el = e.target.closest('.split-in');
      if (!el) return;
      const current = area._splitLines || [];
      const i = Number(el.dataset.splitIdx);
      if (!current[i]) return;
      current[i][el.dataset.splitField] = el.value;
      if (typeof area._splitOnChange === 'function') area._splitOnChange();
    });
    area._splitDelegated = true;
  }
}
