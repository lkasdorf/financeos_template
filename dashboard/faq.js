// FAQ Page — fetches docs/faq.md, parses Markdown, renders with TOC sidebar.
// Self-contained minimal Markdown parser (no external dependency) covering the
// subset used in docs/faq.md: headings, paragraphs, lists, tables, code blocks,
// inline code, bold, italic, blockquotes, horizontal rules, and links.

(function () {
  let faqQuery = '';
  let faqActiveSection = '';

  // FAQ locale is independent of the app locale: the docs are linguistically
  // self-contained and a reader may want to flip between languages without
  // changing the rest of the dashboard. Default = follow window.LOCALE; an
  // explicit click on the locale toggle persists the override in lp-faq-locale.
  // The toggle is hidden when only one locale is available (e.g. an EN-only
  // template install with `window.AVAILABLE_LOCALES = ['en']`).
  const FAQ_LOCALE_KEY = 'lp-faq-locale';
  function availableLocales() {
    const list = Array.isArray(window.AVAILABLE_LOCALES) ? window.AVAILABLE_LOCALES : ['en'];
    return list.length ? list : ['en'];
  }
  function currentFaqLocale() {
    const locales = availableLocales();
    const override = localStorage.getItem(FAQ_LOCALE_KEY);
    if (override && locales.includes(override)) return override;
    if (locales.includes(window.LOCALE)) return window.LOCALE;
    return locales[0];
  }
  function setFaqLocale(locale) {
    if (!availableLocales().includes(locale)) return;
    localStorage.setItem(FAQ_LOCALE_KEY, locale);
    faqActiveSection = ''; // anchors are locale-specific (slugs differ between languages)
    renderFaqPage();
  }
  // Exposed so a future Settings → Language reset can clear this override.
  window.clearFaqLocaleOverride = function () {
    localStorage.removeItem(FAQ_LOCALE_KEY);
  };

  function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Slugify a heading text into a stable anchor id.
  function slugify(s) {
    return s.toLowerCase()
      .replace(/[äöüß]/g, c => ({ 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' }[c]))
      .replace(/[^a-z0-9\s-]/g, '')
      .trim().replace(/\s+/g, '-');
  }

  // Inline formatting: `code`, **bold**, *italic*, [text](url).
  // Order matters — run code spans first so their contents aren't re-parsed.
  function renderInline(text) {
    // Protect code spans by swapping in placeholders.
    const spans = [];
    text = text.replace(/`([^`]+)`/g, (_, c) => {
      spans.push(`<code>${escHtml(c)}</code>`);
      return `\x00CODE${spans.length - 1}\x00`;
    });
    text = escHtml(text);
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) =>
      `<a href="${escHtml(u)}" target="_blank" rel="noopener">${t}</a>`);
    text = text.replace(/\x00CODE(\d+)\x00/g, (_, i) => spans[+i]);
    return text;
  }

  // Block-level parser — returns { html, toc: [{level, text, id}] }.
  function parseMarkdown(md) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    const toc = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block
      if (/^```/.test(line)) {
        const lang = line.slice(3).trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push(`<pre class="faq-code"${lang ? ` data-lang="${escHtml(lang)}"` : ''}><code>${escHtml(buf.join('\n'))}</code></pre>`);
        continue;
      }

      // Heading
      const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (hMatch) {
        const level = hMatch[1].length;
        const text = hMatch[2].trim();
        const id = slugify(text);
        toc.push({ level, text, id });
        out.push(`<h${level} id="${id}" class="faq-h faq-h${level}">${renderInline(text)}</h${level}>`);
        i++;
        continue;
      }

      // Horizontal rule
      if (/^---+\s*$/.test(line)) { out.push('<hr class="faq-hr">'); i++; continue; }

      // Blockquote
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
        out.push(`<blockquote class="faq-quote">${renderInline(buf.join(' '))}</blockquote>`);
        continue;
      }

      // Table (pipe syntax with header separator row)
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|\s*$/.test(lines[i + 1])) {
        const headerCells = line.split('|').slice(1, -1).map(s => s.trim());
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          rows.push(lines[i].split('|').slice(1, -1).map(s => s.trim()));
          i++;
        }
        let html = '<table class="faq-table"><thead><tr>';
        headerCells.forEach(c => html += `<th>${renderInline(c)}</th>`);
        html += '</tr></thead><tbody>';
        rows.forEach(r => {
          html += '<tr>';
          r.forEach(c => html += `<td>${renderInline(c)}</td>`);
          html += '</tr>';
        });
        html += '</tbody></table>';
        out.push(html);
        continue;
      }

      // Unordered list
      if (/^\s*[-*]\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*[-*]\s+/, ''));
          i++;
        }
        out.push('<ul class="faq-list">' + buf.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ul>');
        continue;
      }

      // Ordered list
      if (/^\s*\d+\.\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        out.push('<ol class="faq-list">' + buf.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ol>');
        continue;
      }

      // Blank line
      if (!line.trim()) { i++; continue; }

      // Paragraph (accumulate consecutive non-block lines)
      const buf = [line];
      i++;
      while (i < lines.length
        && lines[i].trim()
        && !/^#{1,6}\s/.test(lines[i])
        && !/^```/.test(lines[i])
        && !/^---+\s*$/.test(lines[i])
        && !/^>\s?/.test(lines[i])
        && !/^\s*[-*]\s+/.test(lines[i])
        && !/^\s*\d+\.\s+/.test(lines[i])
        && !/^\s*\|.*\|\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      out.push(`<p class="faq-p">${renderInline(buf.join(' '))}</p>`);
    }

    return { html: out.join('\n'), toc };
  }

  // Build the TOC from H2 sections (primary nav) with H3 as sub-items.
  function renderToc(toc, activeId) {
    const sections = [];
    let current = null;
    toc.forEach(h => {
      if (h.level === 2) {
        current = { ...h, subs: [] };
        sections.push(current);
      } else if (h.level === 3 && current) {
        current.subs.push(h);
      }
    });
    const locale = currentFaqLocale();
    const locales = availableLocales();
    const toggleHtml = locales.length > 1 ? `
      <div class="faq-locale-toggle" role="group" aria-label="FAQ language">
        ${locales.map(loc => `<button type="button" class="faq-locale-btn ${loc === locale ? 'active' : ''}" data-faq-locale="${escHtml(loc)}">${escHtml(loc.toUpperCase())}</button>`).join('')}
      </div>` : '';
    return `<nav class="faq-toc">
      ${toggleHtml}
      <div class="faq-toc-search">
        <input type="search" id="faq-search" placeholder="${escHtml(t('faq.search.placeholder', {}, 'Search...'))}" value="${escHtml(faqQuery)}">
      </div>
      <ul class="faq-toc-list">
        ${sections.map(s => `
          <li class="faq-toc-item ${s.id === activeId ? 'active' : ''}">
            <a href="#faq/${s.id}" class="faq-toc-link" data-faq-anchor="${s.id}">${escHtml(s.text)}</a>
            ${s.subs.length ? `<ul class="faq-toc-sub">${s.subs.map(sub =>
              `<li><a href="#faq/${sub.id}" class="faq-toc-sub-link" data-faq-anchor="${sub.id}">${escHtml(sub.text)}</a></li>`
            ).join('')}</ul>` : ''}
          </li>
        `).join('')}
      </ul>
    </nav>`;
  }

  // Client-side filter: hide headings/content that don't match the query.
  function applySearchFilter(container, query) {
    const q = query.trim().toLowerCase();
    const blocks = container.querySelectorAll('.faq-body > *');
    if (!q) { blocks.forEach(b => b.style.display = ''); return; }

    // Group blocks by H3 sections: each H3 starts a section that includes itself
    // and every following element up to the next H2/H3.
    let currentSection = [];
    const sections = [];
    blocks.forEach(b => {
      if (b.classList.contains('faq-h2') || b.classList.contains('faq-h3')) {
        if (currentSection.length) sections.push(currentSection);
        currentSection = [b];
      } else {
        currentSection.push(b);
      }
    });
    if (currentSection.length) sections.push(currentSection);

    sections.forEach(sec => {
      const text = sec.map(e => e.textContent).join(' ').toLowerCase();
      const match = text.includes(q);
      sec.forEach(e => e.style.display = match ? '' : 'none');
    });

    // Hide H2 blocks whose subsequent H3 sections are all hidden.
    const h2s = container.querySelectorAll('.faq-h2');
    h2s.forEach(h2 => {
      let next = h2.nextElementSibling;
      let anyVisible = false;
      while (next && !next.classList.contains('faq-h2')) {
        if (next.style.display !== 'none') { anyVisible = true; break; }
        next = next.nextElementSibling;
      }
      h2.style.display = anyVisible ? '' : 'none';
    });
  }

  async function renderFaqPage() {
    const container = document.getElementById('faq-content');
    if (!container) return;
    container.innerHTML = `<div class="loading">${t('faq.loading', {}, 'Loading FAQ...')}</div>`;

    const locale = currentFaqLocale();
    // Try the locale-specific file first (e.g. /docs/faq.en.md), fall back to
    // the default /docs/faq.md on 404. This keeps the loader independent of
    // which language the default file is written in — the private repo's
    // faq.md is German with faq.en.md alongside; an EN-only template ships
    // only faq.md and the fallback covers it without surgical pipeline edits.
    const candidates = [`/docs/faq.${locale}.md`, '/docs/faq.md'];
    let md = '';
    let lastErr = null;
    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        md = await res.text();
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) {
      container.innerHTML = `<div class="atx-status error">${t('faq.error.load_failed', { err: escHtml(lastErr.message) }, `FAQ could not be loaded: ${escHtml(lastErr.message)}. Is <code>/docs/faq.md</code> reachable?`)}</div>`;
      return;
    }

    const { html, toc } = parseMarkdown(md);
    container.innerHTML = `
      <div class="faq-layout">
        ${renderToc(toc, faqActiveSection)}
        <div class="faq-body">${html}</div>
      </div>
    `;

    // Live search
    const search = document.getElementById('faq-search');
    if (search) {
      search.addEventListener('input', (e) => {
        faqQuery = e.target.value;
        applySearchFilter(container, faqQuery);
      });
      if (faqQuery) applySearchFilter(container, faqQuery);
    }

    // Locale toggle buttons
    container.querySelectorAll('[data-faq-locale]').forEach(btn => {
      btn.addEventListener('click', () => setFaqLocale(btn.getAttribute('data-faq-locale')));
    });

    // TOC links scroll into view + update active state
    container.querySelectorAll('[data-faq-anchor]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const id = link.getAttribute('data-faq-anchor');
        const target = document.getElementById(id);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          faqActiveSection = id;
          history.replaceState(null, '', `#faq/${id}`);
          container.querySelectorAll('.faq-toc-item').forEach(li => li.classList.remove('active'));
          const li = link.closest('.faq-toc-item');
          if (li) li.classList.add('active');
        }
      });
    });

    // Deep-link: if hash is #faq/<slug>, scroll to it.
    const hash = location.hash || '';
    const m = hash.match(/^#faq\/(.+)$/);
    if (m) {
      const target = document.getElementById(m[1]);
      if (target) setTimeout(() => target.scrollIntoView({ behavior: 'auto', block: 'start' }), 50);
    }
  }

  window.renderFaqPage = renderFaqPage;
})();
