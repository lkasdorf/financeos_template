// ─── Receipts module (v1.6.0) — file attachments on transactions ──────
//
// Public API:
//   uploadReceipts(files)             → Promise<Array<{url, thumb_url, mime, kind, size}>>
//   deleteReceipts(urls)              → Promise<number>   // count actually removed
//   parseReceiptList(str)             → string[]          // semicolon codec
//   serializeReceiptList(arr)         → string
//   getThumbUrl(url)                  → string            // derived, no API call
//   getKindFromUrl(url)               → 'image' | 'pdf'
//   renderAttachmentGrid(el, urls, opts)
//   openReceiptViewer(url)            → switches between lightbox and PDF embed
//   attachFilePickerAndPaste(spec)    → wires <input type="file">, drag-drop, paste
//
// The module is intentionally framework-free — same patterns work in the
// Add-TX form, Edit-TX form, and the read-only TX-list preview modal.

const _RECEIPT_URL_PREFIX = '/data/receipts/';
const _RECEIPT_MAX_BYTES = 10 * 1024 * 1024;        // mirror serve.py
const _RECEIPT_MAX_FILES_PER_REQUEST = 5;
const _RECEIPT_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);
const _RECEIPT_PDF_EXTS = new Set(['pdf']);
const _RECEIPT_ACCEPT_MIME = 'image/*,application/pdf,.heic,.heif';

// ── Codec helpers ─────────────────────────────────────────────────────

function parseReceiptList(str) {
  if (!str) return [];
  return String(str).split(';').map(s => s.trim()).filter(Boolean);
}

function serializeReceiptList(arr) {
  if (!arr || !arr.length) return '';
  return arr.filter(Boolean).join(';');
}

// Derive the thumbnail URL from an original receipt URL. Mirrors the server
// layout: data/receipts/YYYY/MM/<hex>.<ext> → data/receipts/thumbs/<hex>.jpg.
// Returns '' for PDFs (no thumbnail exists — caller renders an icon).
function getThumbUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (getKindFromUrl(url) !== 'image') return '';
  const m = url.match(/\/([^/]+)\.[^/.]+$/);
  if (!m) return '';
  return _RECEIPT_URL_PREFIX + 'thumbs/' + m[1] + '.jpg';
}

function getKindFromUrl(url) {
  if (!url || typeof url !== 'string') return 'image';
  const m = url.match(/\.([^/.]+)$/);
  const ext = m ? m[1].toLowerCase() : '';
  if (_RECEIPT_PDF_EXTS.has(ext)) return 'pdf';
  return 'image';
}

// ── API calls ─────────────────────────────────────────────────────────

// Upload one or more File / Blob objects. Returns the saved-files array
// (each entry has url, thumb_url, mime, kind, size). On partial success
// the server replies 207 with both `saved` and `errors` — the caller gets
// the saved array but `result.errors` is attached to the thrown error so a
// UI can surface "3 uploaded, 1 failed" cleanly.
async function uploadReceipts(files) {
  if (!files || !files.length) return [];
  if (files.length > _RECEIPT_MAX_FILES_PER_REQUEST) {
    throw new Error(t('receipts.upload.too_many', { max: _RECEIPT_MAX_FILES_PER_REQUEST }, `Max ${_RECEIPT_MAX_FILES_PER_REQUEST} files per upload`));
  }
  const fd = new FormData();
  for (const f of files) {
    if (f.size > _RECEIPT_MAX_BYTES) {
      throw new Error(t('receipts.upload.max_size', { name: f.name }, `${f.name}: file too large (max 10 MB)`));
    }
    fd.append('files', f, f.name || 'receipt');
  }
  const res = await fetch('/api/receipts/upload', { method: 'POST', body: fd });
  let data;
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok && res.status !== 207) {
    const msg = data.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (data.errors && data.errors.length) {
    // Partial success: throw so the caller decides whether to keep the
    // saved ones or roll back. Attach both arrays for a smart UI.
    const err = new Error(data.errors.map(e => `${e.filename || '?'}: ${e.error}`).join('; '));
    err.saved = data.saved || [];
    err.errors = data.errors;
    throw err;
  }
  return data.saved || [];
}

async function deleteReceipts(urls) {
  if (!urls || !urls.length) return 0;
  const res = await fetch('/api/receipts/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: urls }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const data = await res.json().catch(() => ({}));
  return data.removed || 0;
}

// ── Rendering ─────────────────────────────────────────────────────────

// Render a grid of thumbnails into `container`. The grid is rebuilt from
// scratch on every call — callers pass the current url list, not a diff.
//
// opts:
//   editable: boolean  — when true, each tile gets a remove (×) button
//   onChange: (newUrls) => void  — fired after a remove click
function renderAttachmentGrid(container, urls, opts) {
  opts = opts || {};
  const list = (urls || []).filter(Boolean);
  if (!list.length) {
    container.innerHTML = `<div class="receipt-grid-empty hint-sm">${escapeHtml(t('receipts.modal.empty', {}, 'No attachments'))}</div>`;
    return;
  }
  const html = list.map((url, idx) => {
    const kind = getKindFromUrl(url);
    const thumb = kind === 'image' ? getThumbUrl(url) : '';
    const safeUrl = escapeHtml(url);
    const removeBtn = opts.editable
      ? `<button type="button" class="receipt-tile-remove" data-action="receiptRemove" data-arg1="${idx}" title="${escapeHtml(t('receipts.modal.remove', {}, 'Remove'))}">×</button>`
      : '';
    const tileBody = kind === 'image'
      ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(t('receipts.tx_list.icon_alt', {}, 'receipt'))}" loading="lazy">`
      : `<div class="receipt-tile-pdf">📄<span class="receipt-tile-pdf-label">PDF</span></div>`;
    return `<div class="receipt-tile" data-action="receiptOpen" data-arg1="${safeUrl}" title="${safeUrl}">${tileBody}${removeBtn}</div>`;
  }).join('');
  container.innerHTML = `<div class="receipt-grid">${html}</div>`;

  // Wire removal directly — these tiles are rebuilt on every render so a
  // delegated dispatch on container is enough.
  if (opts.editable && opts.onChange) {
    container.onclick = (ev) => {
      const removeBtn = ev.target.closest('[data-action="receiptRemove"]');
      if (removeBtn) {
        ev.stopPropagation();
        const idx = Number(removeBtn.getAttribute('data-arg1'));
        const next = list.slice();
        next.splice(idx, 1);
        opts.onChange(next);
        return;
      }
      const tile = ev.target.closest('[data-action="receiptOpen"]');
      if (tile) {
        openReceiptViewer(tile.getAttribute('data-arg1'));
      }
    };
  } else {
    container.onclick = (ev) => {
      const tile = ev.target.closest('[data-action="receiptOpen"]');
      if (tile) openReceiptViewer(tile.getAttribute('data-arg1'));
    };
  }
}

// Route to the correct viewer based on file kind.
function openReceiptViewer(url) {
  if (!url) return;
  if (getKindFromUrl(url) === 'pdf') {
    openPdfEmbed(url);
  } else {
    openLightbox(url);
  }
}

// Full-screen image lightbox. ESC or backdrop click closes. The overlay is
// appended to <body> and removed on close so multiple opens don't stack.
function openLightbox(url) {
  const ov = document.createElement('div');
  ov.className = 'lightbox-overlay';
  ov.innerHTML = `
    <button type="button" class="lightbox-close" title="${escapeHtml(t('receipts.lightbox.close', {}, 'Close'))}">×</button>
    <img class="lightbox-img" src="${escapeHtml(url)}" alt="">
  `;
  const close = () => {
    document.removeEventListener('keydown', onKey);
    if (ov.parentNode) ov.parentNode.removeChild(ov);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.classList.contains('lightbox-close')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

// PDF preview via a native browser embed. Works in Chromium, Firefox, and
// Safari — no PDF.js dependency needed for rc.1. Layout mirrors the lightbox
// so the UX feels consistent.
function openPdfEmbed(url) {
  const ov = document.createElement('div');
  ov.className = 'lightbox-overlay';
  ov.innerHTML = `
    <button type="button" class="lightbox-close" title="${escapeHtml(t('receipts.lightbox.close', {}, 'Close'))}">×</button>
    <embed class="lightbox-pdf" src="${escapeHtml(url)}" type="application/pdf">
  `;
  const close = () => {
    document.removeEventListener('keydown', onKey);
    if (ov.parentNode) ov.parentNode.removeChild(ov);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.classList.contains('lightbox-close')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

// ── Input wiring (file input + drag-drop + clipboard paste) ───────────
//
// Wire three input channels into a single onFiles callback so the Add/Edit
// forms only have to keep one pending-files array. Returns a function that
// detaches all listeners (useful when the modal closes).
//
// spec:
//   fileInput:   HTMLInputElement  (required) — type="file" multiple
//   dropZone:    HTMLElement       (optional) — drag-and-drop target
//   pasteRoot:   HTMLElement       (optional) — Ctrl+V works while this has focus
//   onFiles:     (File[]) => void  (required) — called with each new batch
function attachFilePickerAndPaste(spec) {
  const onFiles = spec.onFiles || (() => {});
  const handlers = [];

  if (spec.fileInput) {
    const inputHandler = (e) => {
      const list = Array.from(e.target.files || []);
      if (list.length) onFiles(list);
      // Reset so re-selecting the same file fires onChange again.
      e.target.value = '';
    };
    spec.fileInput.addEventListener('change', inputHandler);
    handlers.push(() => spec.fileInput.removeEventListener('change', inputHandler));
  }

  if (spec.dropZone) {
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    const enter = (e) => { stop(e); spec.dropZone.classList.add('is-dragover'); };
    const leave = (e) => { stop(e); spec.dropZone.classList.remove('is-dragover'); };
    const drop = (e) => {
      stop(e);
      spec.dropZone.classList.remove('is-dragover');
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) onFiles(files);
    };
    spec.dropZone.addEventListener('dragenter', enter);
    spec.dropZone.addEventListener('dragover', enter);
    spec.dropZone.addEventListener('dragleave', leave);
    spec.dropZone.addEventListener('drop', drop);
    handlers.push(() => {
      spec.dropZone.removeEventListener('dragenter', enter);
      spec.dropZone.removeEventListener('dragover', enter);
      spec.dropZone.removeEventListener('dragleave', leave);
      spec.dropZone.removeEventListener('drop', drop);
    });
  }

  // Paste-support: User-Anforderung 2026-05-12. Listening on the pasteRoot
  // catches Ctrl+V while any form field inside it has focus. We pull image
  // blobs (and PDFs, though browsers rarely paste those) out of the
  // clipboard items list and route them through the same onFiles handler.
  if (spec.pasteRoot) {
    const pasteHandler = (e) => {
      const items = e.clipboardData?.items;
      if (!items || !items.length) return;
      const blobs = [];
      for (const item of items) {
        if (item.kind !== 'file') continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        // Give clipboard images a sane filename — browsers usually deliver
        // them as "image.png" with no metadata, which is fine.
        const ext = (blob.type.split('/')[1] || 'png').split(';')[0];
        const named = new File(
          [blob],
          blob.name && blob.name !== 'image.png' ? blob.name : `paste-${Date.now()}.${ext}`,
          { type: blob.type, lastModified: Date.now() },
        );
        blobs.push(named);
      }
      if (blobs.length) {
        e.preventDefault();  // stop the browser from also pasting text/HTML
        onFiles(blobs);
      }
    };
    spec.pasteRoot.addEventListener('paste', pasteHandler);
    handlers.push(() => spec.pasteRoot.removeEventListener('paste', pasteHandler));
  }

  return function detach() {
    handlers.forEach(fn => fn());
  };
}
