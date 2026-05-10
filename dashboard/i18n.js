// Lightweight i18n layer for the FinanceOS Dashboard.
//
// Pattern matches features.json / defaults.json: a JSON file per locale under
// config/i18n/<locale>.json, fetched on boot, cached in window.STRINGS.
// The English HTML defaults stay in place as the ultimate fallback — if a key
// is missing or the locale file fails to load, the user sees the original
// English string baked into the markup. Zero dependencies, zero build step.

window.LOCALE = 'en';                 // Current active locale code (overwritten by loadLocale)
window.AVAILABLE_LOCALES = ['en', 'de']; // Codes the dashboard knows about; extended as forks ship more files
window.STRINGS = {};                  // Flat key -> translated string map (loaded asynchronously)

const I18N_STORAGE_KEY = 'lp-locale';

// Resolve the locale to load: explicit user choice (localStorage) wins,
// otherwise the browser preference if known, otherwise English.
function resolveInitialLocale() {
  const stored = localStorage.getItem(I18N_STORAGE_KEY);
  if (stored && window.AVAILABLE_LOCALES.includes(stored)) return stored;
  const navLang = (navigator.language || 'en').slice(0, 2).toLowerCase();
  if (window.AVAILABLE_LOCALES.includes(navLang)) return navLang;
  return 'en';
}

// Fetch a locale file. Falls back to English silently on any error so the app
// never breaks just because a translation is missing.
async function loadLocale(locale) {
  const target = locale || resolveInitialLocale();
  try {
    const res = await fetch(`../config/i18n/${target}.json`, { cache: 'no-store' });
    if (res.ok) {
      window.STRINGS = await res.json();
      window.LOCALE = target;
      return;
    }
  } catch { /* fall through to English fallback */ }
  // If the requested locale failed and it wasn't already English, try English.
  if (target !== 'en') {
    try {
      const res = await fetch('../config/i18n/en.json', { cache: 'no-store' });
      if (res.ok) {
        window.STRINGS = await res.json();
        window.LOCALE = 'en';
        return;
      }
    } catch { /* keep empty STRINGS, t() will return the key */ }
  }
}

// Look up a key with optional {placeholder} interpolation.
// If the key is missing, return the supplied fallback (or the key itself).
function t(key, params = {}, fallback = null) {
  let str = window.STRINGS[key];
  if (str == null) str = fallback != null ? fallback : key;
  // Two interchangeable substitution syntaxes are in use across the
  // codebase: legacy single-brace `{name}` (accounts/accp/...) and the
  // Mustache-style double-brace `{{name}}` (alerts/properties/...). The
  // double-brace pattern MUST be matched first — otherwise the inner
  // `{name}` is consumed and the outer braces leak into the rendered
  // string (visible as e.g. "over {20} months" on the property report).
  return str
    .replace(/\{\{(\w+)\}\}/g, (m, name) => (name in params ? String(params[name]) : m))
    .replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

// Map the two-letter locale code to an IETF BCP-47 tag for Intl APIs.
// "en" → "en-US" (matches the legacy en-US formatting, 1,234.56),
// "de" → "de-DE" (1.234,56 and DD.MM.YYYY).
// Unknown locales fall through to en-US so toLocaleString never throws.
function getLocaleTag() {
  if (window.LOCALE === 'de') return 'de-DE';
  return 'en-US';
}

// Number formatter honoring the current locale. Thin wrapper around
// Number.prototype.toLocaleString so callers don't have to remember the tag.
// Pass minFrac / maxFrac for decimals, or omit for default (locale-native).
function formatNumber(value, { minFrac = 0, maxFrac = 2 } = {}) {
  if (value == null || Number.isNaN(value)) return '';
  return Number(value).toLocaleString(getLocaleTag(), {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  });
}

// Walk the DOM (or a sub-tree) and replace text content for [data-i18n]
// elements. Title attribute is handled via [data-i18n-title].
function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translated = window.STRINGS[key];
    if (translated == null) return;       // Keep HTML default — no translation provided
    el.textContent = translated;
  });
  scope.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    const translated = window.STRINGS[key];
    if (translated == null) return;
    el.setAttribute('title', translated);
  });
  // Placeholder attribute (input/textarea)
  scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const translated = window.STRINGS[key];
    if (translated == null) return;
    el.setAttribute('placeholder', translated);
  });
  // Accessible label (aria-label) — used by icon-only buttons
  scope.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria-label');
    const translated = window.STRINGS[key];
    if (translated == null) return;
    el.setAttribute('aria-label', translated);
  });
  // Rich-text replacement: translations may carry tiny inline markup
  // (e.g. <span class="accent"> for branded page titles). We pass the
  // string through a strict whitelist sanitizer before assigning to
  // innerHTML, so a future translation file (or accidental string) with
  // <script>/<img>/event handlers cannot inject DOM into the dashboard.
  scope.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    const translated = window.STRINGS[key];
    if (translated == null) return;
    el.replaceChildren(...sanitizeI18nHtml(translated));
  });
}

// Whitelist sanitizer for data-i18n-html values.
// Allowed tags: <span class="accent">, <em>, <strong>. Anything else is
// stripped down to its text content so a malicious translation can at
// worst inject plain text.
const I18N_HTML_ALLOWED = {
  SPAN:   { attrs: { class: new Set(['accent']) } },
  EM:     { attrs: {} },
  STRONG: { attrs: {} },
};

function sanitizeI18nHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  const out = [];
  for (const node of tpl.content.childNodes) {
    const sanitized = sanitizeI18nNode(node);
    if (sanitized) out.push(sanitized);
  }
  return out;
}

function sanitizeI18nNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const allowed = I18N_HTML_ALLOWED[node.tagName];
  if (!allowed) {
    // Disallowed tag — keep its descendants' text only (drop the wrapper).
    const frag = document.createDocumentFragment();
    for (const child of node.childNodes) {
      const sanitized = sanitizeI18nNode(child);
      if (sanitized) frag.appendChild(sanitized);
    }
    return frag;
  }
  const el = document.createElement(node.tagName);
  for (const attr of node.attributes) {
    const allowedValues = allowed.attrs[attr.name];
    if (allowedValues && allowedValues.has(attr.value)) {
      el.setAttribute(attr.name, attr.value);
    }
  }
  for (const child of node.childNodes) {
    const sanitized = sanitizeI18nNode(child);
    if (sanitized) el.appendChild(sanitized);
  }
  return el;
}

// Switch locales at runtime: persist the choice and reload the page.
// Why a full reload: most UI strings live inside JS render functions
// (pages-*.js, dashboard.js, forms.js, reports.js, custom-reports*.js) that call t() at render
// time and write the result via innerHTML. Re-running applyI18n() only
// updates static [data-i18n] markup; the dynamic cards stay in the boot
// language. A reload re-enters boot() with the new locale already in
// localStorage, so every render pulls from the correct STRINGS map. This
// stays robust as more JS blocks (B3.2..B3.5) get migrated to t() — no
// per-page re-render plumbing required.
async function setLocale(locale) {
  localStorage.setItem(I18N_STORAGE_KEY, locale);
  location.reload();
}
