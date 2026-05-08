// Shared state (declared early in core.js to avoid TDZ across modules)
var catChart = null, cashflowChart = null;
var settingsTab = 'categories';
var reportCharts = [];

// Feature flags — defaults are all-on so the app works if config/features.json is missing.
// Values get overwritten by loadFeatures() before boot() runs.
window.FEATURES = { metals: true, pwa: true, crdb_recon: true, debt_tracking: true, vehicles: true };
async function loadFeatures() {
  try {
    const res = await fetch('../config/features.json', { cache: 'no-store' });
    if (res.ok) Object.assign(window.FEATURES, await res.json());
  } catch { /* keep defaults */ }
}
function isFeatureEnabled(key) { return window.FEATURES[key] !== false; }

// Reports config — maps the 8 category-driven reports to user-chosen category names.
// Defaults match the canonical category set shipped with the template.
// Overwritten by loadReportsConfig() if config/reports.json is present.
// Match modes: "exact" (default) — tx.category equals one of categories;
// "prefix" — tx.category.startsWith one of categories.
window.REPORTS_CONFIG = {
  dining_out:    { categories: ['Food:Dining out'] },
  ai_costs:      { match: 'prefix', categories: ['Subscriptions:AI'] },
  vice_spending: { categories: ['Leisure:Alcohol', 'Leisure:Smoking', 'Leisure:Vaping'] },
  bank_fees:     { match: 'prefix', categories: ['Fees:'] },
  cash_discrepancy: {
    expense_categories: ['Other Expenses:Cash Discrepancy'],
    income_categories:  ['Income:Cash Discrepancy'],
  },
  bills: {
    buckets: {
      rent:        { categories: ['Bills:Rent'] },
      electricity: { categories: ['Bills:Electricity'] },
      water:       { categories: ['Bills:Water'] },
      internet:    { categories: ['Bills:Internet'] },
    },
  },
  automobile: {
    buckets: {
      purchase:     { categories: ['Automobile:Purchase'] },
      petrol:       { categories: ['Automobile:Petrol'] },
      maintenance:  { categories: ['Automobile:Maintenance'] },
      toll:         { categories: ['Automobile:Toll'] },
      parking:      { categories: ['Automobile:Parking'] },
      insurance:    { categories: ['Automobile:Insurance'] },
      registration: { categories: ['Automobile:Registration'] },
      accessories:  { categories: ['Automobile:Accessories'] },
      car_rental:   { categories: ['Automobile:Car Rental'] },
      other:        { categories: ['Automobile'] },
    },
  },
  discretionary_fixed: {
    fixed_prefixes: ['Rent', 'Bills:', 'Subscriptions:', 'Insurance:', 'Fees:'],
  },
  // Income Sources Breakdown bucket mapping. Per-business rules in
  // config/businesses.json (when configured) take precedence; this is the
  // generic fallback for everyone else. An empty `salary` bucket means the
  // report has no Salary column in the public template by default — users
  // configure their salary category via Settings → Reports so it gets its
  // own column instead of disappearing into "Other".
  income_sources: {
    buckets: {
      salary:            { categories: [] },
      interest:          { categories: ['Income:Interest'] },
      dividends:         { categories: ['Income:Dividends'] },
      investments_sales: { categories: ['Income:Investments', 'Income:Sales'] },
      reimbursement:     { categories: ['Income:Reimbursement'] },
      refunds:           { categories: ['Income:Refund'] },
    },
  },
};
async function loadReportsConfig() {
  try {
    const res = await fetch('../config/reports.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      // Strip _comment if present, deep-merge top-level keys.
      delete data._comment;
      Object.assign(window.REPORTS_CONFIG, data);
    }
  } catch { /* keep defaults */ }
}
// Returns true if tx.category matches one of the categories in the given report (or bucket).
// reportKey: e.g. "dining_out", "bills". bucketKey (optional): e.g. "rent" for bills.rent.
function matchesReportCategory(tx, reportKey, bucketKey) {
  if (!tx || !tx.category) return false;
  const cfg = window.REPORTS_CONFIG[reportKey];
  if (!cfg) return false;
  const node = bucketKey ? (cfg.buckets && cfg.buckets[bucketKey]) : cfg;
  if (!node || !node.categories) return false;
  const mode = node.match || cfg.match || 'exact';
  if (mode === 'prefix') {
    return node.categories.some(p => tx.category.startsWith(p));
  }
  return node.categories.includes(tx.category);
}
// Returns the flat list of categories for a report (or bucket). Useful for filter UIs.
function getReportCategories(reportKey, bucketKey) {
  const cfg = window.REPORTS_CONFIG[reportKey];
  if (!cfg) return [];
  if (bucketKey) {
    return (cfg.buckets && cfg.buckets[bucketKey] && cfg.buckets[bucketKey].categories) || [];
  }
  return cfg.categories || [];
}

// System defaults — fallback values match config/defaults.json so the app works if the file is missing.
// Object.assign is shallow merge: defaults.json must contain complete sub-objects (currency, server, etc.).
window.DEFAULTS = {
  server: { default_port: 8080, default_bind: '127.0.0.1', dashboard_path: '/dashboard/' },
  backup: { max_per_file: 30 },
  currency: {
    primary: 'TZS',
    fallback_tzs_per_usd: 2650,
    fx_api_url: 'https://open.er-api.com/v6/latest/USD',
    // Same-origin proxy for goldprice.org. The browser cannot fetch
    // https://data-asg.goldprice.org/... directly because that origin
    // refuses CORS for our Tailscale hostname. The server-side
    // /api/metals/spot handler reuses cron_metals.fetch_spot() and
    // mirrors the upstream JSON shape ({items:[{xauPrice,xagPrice}]}).
    metals_spot_api_url: '/api/metals/spot',
  },
  auto_tag: { by_account: {}, by_payee: {} },
  pass_through: { reimbursement_categories: {} },
};
// Smart default currency for first-load — overwritten by config/smart_defaults.json
// when that file is present. The hardcoded fallback matches the upstream's
// primary currency; forks override via the JSON file or the setup wizard.
window.SMART_DEFAULTS = {
  ui: { default_display_currency: window.DEFAULTS.currency.primary || 'USD' },
};
async function loadDefaults() {
  try {
    const res = await fetch('../config/defaults.json', { cache: 'no-store' });
    if (res.ok) Object.assign(window.DEFAULTS, await res.json());
  } catch { /* keep defaults */ }
}

// Branding — display name (plain + html) + accent color, loaded from
// config/branding.json. Hardcoded fallback matches the upstream branding so a
// missing or malformed config file degrades gracefully rather than wiping the
// brand entirely.
window.BRANDING = {
  display_name: 'FinanceOS',
  display_name_html: 'FinanceOS',
  accent_color: '#1e40af',
};
async function loadBranding() {
  try {
    const res = await fetch('../config/branding.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      Object.assign(window.BRANDING, data);
      // Sidebar logo + mobile-topbar + page heading bind via [data-brand-html],
      // which reads display_name_html. Older config files (and the CLI/web
      // wizard before rc.11) only wrote display_name. Mirror it here so the
      // sidebar updates without requiring a manual config-file edit.
      if (data.display_name && !data.display_name_html) {
        window.BRANDING.display_name_html = data.display_name;
      }
    }
  } catch { /* keep defaults */ }
}
function applyBranding() {
  const name = window.BRANDING.display_name || 'FinanceOS';
  const nameHtml = window.BRANDING.display_name_html || name;
  document.title = name;
  document.querySelectorAll('[data-brand]').forEach(el => { el.textContent = name; });
  document.querySelectorAll('[data-brand-html]').forEach(el => { el.innerHTML = nameHtml; });
  // Accent color — propagated as both --accent-color (legacy) and --accent
  // (newer chart/report styles) on :root, plus the derived variants so
  // hover glows / subtle backgrounds / lighter accent recolor with the
  // chosen accent instead of leaving residual blue everywhere.
  const accent = window.BRANDING.accent_color || '#1e40af';
  const root = document.documentElement.style;
  root.setProperty('--accent-color', accent);
  root.setProperty('--accent', accent);
  const rgb = _hexToRgb(accent);
  if (rgb) {
    root.setProperty('--accent-glow', `rgba(${rgb.r},${rgb.g},${rgb.b},0.07)`);
    root.setProperty('--accent-subtle', `rgba(${rgb.r},${rgb.g},${rgb.b},0.04)`);
    // Slightly lighter accent for "dim" usages — blend 25% with white.
    const dim = _blendHex(accent, '#ffffff', 0.25);
    if (dim) root.setProperty('--accent-dim', dim);
  }
}

// Parse "#rrggbb" / "#rgb" into {r,g,b} 0..255. Returns null on bad input
// so applyBranding can short-circuit the derived-variants block.
function _hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

// Linear blend between two hex colors. amount ∈ [0,1] is the weight of `b`.
// Used to compute --accent-dim from --accent + a 25% white blend.
function _blendHex(aHex, bHex, amount) {
  const a = _hexToRgb(aHex), bb = _hexToRgb(bHex);
  if (!a || !bb) return null;
  const w = Math.max(0, Math.min(1, amount));
  const mix = (x, y) => Math.round(x * (1 - w) + y * w);
  const toHex = n => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(a.r, bb.r))}${toHex(mix(a.g, bb.g))}${toHex(mix(a.b, bb.b))}`;
}
async function loadSmartDefaults() {
  try {
    const res = await fetch('../config/smart_defaults.json', { cache: 'no-store' });
    if (res.ok) Object.assign(window.SMART_DEFAULTS, await res.json());
  } catch { /* keep defaults */ }
}

// Business entities — defines tag-based business buckets for reports.
// Loaded from config/businesses.json. Public template ships with empty
// entities[] so business-specific reports (Reimbursements, Income-source
// breakdown, Dining split) hide gracefully. Forks add their own entities
// to enable per-business reporting without code changes.
window.BUSINESSES = { entities: [] };
async function loadBusinesses() {
  try {
    const res = await fetch('../config/businesses.json', { cache: 'no-store' });
    if (res.ok) Object.assign(window.BUSINESSES, await res.json());
  } catch { /* keep defaults */ }
}

// Helpers consumed by reports.js. All tolerate missing config gracefully —
// when entities[] is empty the helpers return empty results and reports
// can short-circuit to a "no business entities configured" state.
function getBusinessEntities() {
  return Array.isArray(window.BUSINESSES?.entities) ? window.BUSINESSES.entities : [];
}
function getBusinessTags() {
  return getBusinessEntities().map(e => e.tag).filter(Boolean);
}
function getBusinessAccountAliases() {
  const out = new Set();
  for (const e of getBusinessEntities()) {
    (e.accounts || []).forEach(a => out.add(a));
  }
  return out;
}
function getBusinessByTag(tag) {
  return getBusinessEntities().find(e => e.tag === tag) || null;
}
function getBusinessByAccount(alias) {
  return getBusinessEntities().find(e => (e.accounts || []).includes(alias)) || null;
}
function hasBusinessEntities() {
  return getBusinessEntities().length > 0;
}

function applyFeatureFlags() {
  document.querySelectorAll('[data-feature]').forEach(el => {
    if (!isFeatureEnabled(el.dataset.feature)) el.style.display = 'none';
  });
}

var state = {
  tx: [],
  accounts: [],
  categories: [],
  thirdParty: [],
  savingsGoals: [],
  budgets: [],
  balances: {},
  currentMonth: null,  // 'YYYY-MM'
  primaryCurrency: window.DEFAULTS.currency.primary,
  alerts: [],
};

// ─── Theme ──────────────────────────────────────────────────────────────

function applyTheme(theme) {
  const saved = theme || localStorage.getItem('lp-theme') || 'auto';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved === 'dark' || (saved === 'auto' && prefersDark);
  document.documentElement.classList.toggle('dark', isDark);
  // Update chart colors if charts are already initialized
  if (catChart || cashflowChart) updateChartTheme();
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  const next = isDark ? 'light' : 'dark';
  localStorage.setItem('lp-theme', next);
  applyTheme(next);
}

// Apply immediately to prevent flash of wrong theme
applyTheme();

// Listen for system theme changes (when set to auto)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((localStorage.getItem('lp-theme') || 'auto') === 'auto') applyTheme();
});

// Wire toggle button after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.addEventListener('click', toggleTheme);
});

// ─── Data Source Configuration ────────────────────────────────────────────

const TX_URL = '../data/transactions.csv';
const ACCOUNTS_URL = '../data/accounts.csv';
const CATEGORIES_URL = '../data/categories.csv';
const FX_CSV_URL = '../data/fx_rates.csv';
const FX_HISTORY_URL = '../data/fx_rates_history.csv';
const THIRD_PARTY_URL = '../data/third_party.csv';
// `let` (not const): re-assigned by boot() after loadDefaults() picks up config/defaults.json overrides.
let FX_API_URL = window.DEFAULTS.currency.fx_api_url;
const METALS_PORTFOLIO_URL = '../data/metals_portfolio.csv';
const METALS_SPOT_CSV_URL = '../data/metal_spot_fallback.csv';
const METALS_HISTORY_URL = '../data/metal_price_history.csv';
let METALS_SPOT_API = window.DEFAULTS.currency.metals_spot_api_url;

document.getElementById('source-tag').textContent = 'LIVE';
document.getElementById('source-tag').classList.remove('preview');
document.getElementById('source-label').textContent = 'data/transactions.csv';

// ─── Date Formatting ────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d || d.length < 10) return d || '';
  const day = d.slice(8, 10), mon = d.slice(5, 7), year = d.slice(0, 4);
  // DE: DD.MM.YYYY (norm); otherwise keep the legacy DD/MM/YYYY shape the user is
  // used to (not the US MM/DD/YYYY convention).
  return (typeof window !== 'undefined' && window.LOCALE === 'de')
    ? `${day}.${mon}.${year}`
    : `${day}/${mon}/${year}`;
}
function convertToTZS(amount, currency) { if (currency === 'TZS' || !currency) return amount; const rate = fxRates[currency]; return rate ? amount * rate : amount; }

// ─── FX Rates ────────────────────────────────────────────────────────────

// fxRates: { TZS: 1, EUR: 2880, USD: 2650, ... } = TZS per 1 unit of currency
let fxRates = { TZS: 1 };
let fxDate = '';
let fxSource = '';
let displayCurrency = localStorage.getItem('lp-default-currency') || window.SMART_DEFAULTS.ui.default_display_currency;

// Precious metals state
let metalSpot = { gold: 0, silver: 0 }; // EUR per troy ounce
let metalSpotDate = '';
let metalSpotSource = '';
var metalsPortfolio = [];
var metalPriceHistory = [];
var metalsCharts = [];

async function loadFxRates() {
  // Try live API first
  try {
    const res = await fetch(FX_API_URL, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const json = await res.json();
      if (json.result === 'success' && json.rates) {
        const usdRates = json.rates; // e.g. { TZS: 2650, EUR: 0.92, ... }
        const tzsPerUsd = usdRates.TZS || window.DEFAULTS.currency.fallback_tzs_per_usd;
        fxRates = { TZS: 1 };
        for (const [cur, ratePerUsd] of Object.entries(usdRates)) {
          fxRates[cur] = tzsPerUsd / ratePerUsd;
        }
        fxDate = json.time_last_update_utc ? json.time_last_update_utc.slice(0, 16) : new Date().toISOString().slice(0, 10);
        fxSource = 'live';
        return;
      }
    }
  } catch (e) { /* fall through to CSV */ }

  // Fallback: CSV
  try {
    const rows = await loadCsv(FX_CSV_URL);
    fxRates = { TZS: 1 };
    for (const row of rows) {
      if (row.currency && row.tzs_per_unit) {
        fxRates[row.currency] = parseFloat(row.tzs_per_unit);
      }
    }
    fxDate = rows[0]?.updated || '?';
    fxSource = 'csv-fallback';
  } catch (e) {
    fxDate = 'unavailable';
    fxSource = 'none';
  }
}

// ─── Precious Metals Loaders ──────────────────────────────────────────

async function loadMetalPrices() {
  try {
    // No spoofed Origin/Referer headers — we now hit our own
    // /api/metals/spot proxy, which calls goldprice.org server-side.
    // POST because serve.py routes API endpoints under do_POST only.
    const res = await fetch(METALS_SPOT_API, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.items && json.items[0]) {
        const item = json.items[0];
        metalSpot.gold = item.xauPrice || 0;
        metalSpot.silver = item.xagPrice || 0;
        metalSpotDate = new Date().toISOString().slice(0, 10);
        metalSpotSource = 'live';
        return;
      }
    }
  } catch (e) { /* fall through to CSV */ }

  try {
    const rows = await loadCsv(METALS_SPOT_CSV_URL);
    for (const row of rows) {
      if (row.metal === 'gold') metalSpot.gold = parseFloat(row.price_per_oz_eur) || 0;
      if (row.metal === 'silver') metalSpot.silver = parseFloat(row.price_per_oz_eur) || 0;
    }
    metalSpotDate = rows[0]?.updated || '?';
    metalSpotSource = 'csv-fallback';
  } catch (e) {
    metalSpotDate = 'unavailable';
    metalSpotSource = 'none';
  }
}

async function loadMetalsData() {
  try {
    const rows = await loadCsv(METALS_PORTFOLIO_URL);
    metalsPortfolio = rows.map(r => ({
      ...r,
      weight_g: parseFloat(r.weight_g) || 0,
      qty: parseInt(r.qty) || 0,
      purchase_price_eur: parseFloat(r.purchase_price_eur) || 0,
      current_unit_price_eur: parseFloat(r.current_unit_price_eur) || 0,
    }));
  } catch (e) { metalsPortfolio = []; }

  try {
    const rows = await loadCsv(METALS_HISTORY_URL);
    metalPriceHistory = rows.map(r => ({
      date: r.date,
      gold: parseFloat(r.gold_oz_eur) || 0,
      silver: parseFloat(r.silver_oz_eur) || 0,
    }));
  } catch (e) { metalPriceHistory = []; }
}

function convertTo(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return amount;
  const tzsPerFrom = fxRates[fromCurrency] || 1;
  const tzsPerTo = fxRates[toCurrency] || 1;
  return amount * tzsPerFrom / tzsPerTo;
}

// Convenience wrapper around convertTo() that targets the global
// displayCurrency selector. Kept as its own export so callers reading
// "amount displayed for the user" don't have to thread displayCurrency
// through manually.
function toDisplay(amount, nativeCurrency) {
  return convertTo(amount, nativeCurrency, displayCurrency);
}

// ─── Historical FX Rates ────────────────────────────────────────────────
// Array of { date: 'YYYY-MM-DD', EUR: 3030, USD: 2564, PLN: 709, TRY: 58 }
var fxHistory = [];

async function loadFxHistory() {
  try {
    const rows = await loadCsv(FX_HISTORY_URL);
    fxHistory = rows.map(r => ({
      date: r.date,
      EUR: parseFloat(r.EUR) || 0,
      USD: parseFloat(r.USD) || 0,
      PLN: parseFloat(r.PLN) || 0,
      TRY: parseFloat(r.TRY) || 0,
    }));
  } catch (e) { fxHistory = []; }
}

// Get TZS-per-unit rate for a currency at a given YYYY-MM (uses last available day in that month)
function getHistoricalRate(currency, ym) {
  if (currency === 'TZS') return 1;
  if (!fxHistory.length) return fxRates[currency] || 1;
  // Find last entry whose date starts with ym, or closest earlier entry
  let best = null;
  for (const row of fxHistory) {
    if (row.date.startsWith(ym) || row.date < ym) best = row;
  }
  if (!best) best = fxHistory[0];
  return best[currency] || fxRates[currency] || 1;
}

// Get TZS-per-unit rate for a currency on a specific YYYY-MM-DD.
// Tries exact-date match first, then falls back to the latest entry within
// the same month, then to the latest entry on/before that date.
function getHistoricalRateOnDate(currency, date) {
  if (currency === 'TZS') return 1;
  if (!fxHistory.length) return fxRates[currency] || 1;
  const ym = (date || '').slice(0, 7);
  let exact = null, sameMonth = null, earlier = null;
  for (const row of fxHistory) {
    if (row.date === date) exact = row;
    if (ym && row.date.startsWith(ym)) sameMonth = row;
    if (date && row.date <= date) earlier = row;
  }
  const best = exact || sameMonth || earlier || fxHistory[0];
  return best[currency] || fxRates[currency] || 1;
}

// Convert an amount in `currency` on `date` to EUR using historical rates.
function convertToEur(amount, currency, date) {
  if (!amount) return 0;
  if (currency === 'EUR') return amount;
  const eurRate = getHistoricalRateOnDate('EUR', date); // TZS per EUR
  if (!eurRate) return 0;
  if (currency === 'TZS') return amount / eurRate;
  const ccyRate = getHistoricalRateOnDate(currency, date); // TZS per ccy
  return (amount * ccyRate) / eurRate;
}

function updateFxInfo() {
  const el = document.getElementById('fx-info');
  if (displayCurrency === 'TZS') {
    el.innerHTML = '';
    return;
  }
  const rates = [];
  if (displayCurrency !== 'TZS') rates.push(`<span class="fx-rate">1 ${displayCurrency} = ${formatCurrency(fxRates[displayCurrency] || 0, 'TZS')} TZS</span>`);
  const sourceLabel = fxSource === 'live' ? 'live' : fxSource === 'csv-fallback' ? 'offline' : 'n/a';
  el.innerHTML = `FX: ${rates.join(' · ')} · ${sourceLabel} · ${fxDate}`;
}

// ─── CSV Loader ───────────────────────────────────────────────────────────

async function loadCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const parsed = Papa.parse(text, {
    header: true,
    dynamicTyping: false,  // manual conversion below
    skipEmptyLines: true,
  });
  return parsed.data;
}

async function loadAllData() {
  const [tx, accounts, categories, thirdParty] = await Promise.all([
    loadCsv(TX_URL),
    loadCsv(ACCOUNTS_URL),
    loadCsv(CATEGORIES_URL),
    loadCsv(THIRD_PARTY_URL).catch(e => { console.warn('third_party.csv not loaded:', e.message); return []; }),
  ]);
  // Convert numeric fields and assign CSV row order (for stable sort tiebreaks)
  for (let i = 0; i < tx.length; i++) {
    const t = tx[i];
    t.amount = parseFloat(t.amount) || 0;
    t.transfer_to_amount = parseFloat(t.transfer_to_amount) || 0;
    t._ord = i;
  }
  for (const a of accounts) {
    a.initial_balance = parseFloat(a.initial_balance) || 0;
  }
  for (const tp of thirdParty) {
    tp.amount = parseFloat(tp.amount) || 0;
    tp.original_amount = parseFloat(tp.original_amount) || tp.amount;
  }
  return { tx, accounts, categories, thirdParty };
}

// ─── Amount Input Parser ─────────────────────────────────────────────────
// Accepts user amount inputs in all common formats and returns a Number (or NaN).
//   "45k"          -> 45000
//   "2.5m"         -> 2500000
//   "125,069.48"   -> 125069.48   (US: comma=thousands, dot=decimal)
//   "125.069,48"   -> 125069.48   (EU: dot=thousands, comma=decimal)
//   "125069.48"    -> 125069.48
//   "125069,48"    -> 125069.48
//   "1 234,56"     -> 1234.56
function parseAmountInput(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;
  // Strip spaces (thousands separator in some locales)
  s = s.replace(/\s+/g, '');
  // k / m suffix
  const suffixMatch = s.match(/^([-+]?[\d.,]+)\s*([km])$/i);
  if (suffixMatch) {
    const base = parseAmountInput(suffixMatch[1]);
    if (isNaN(base)) return NaN;
    return base * (suffixMatch[2].toLowerCase() === 'k' ? 1000 : 1000000);
  }
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Whichever appears LAST is the decimal separator, the other is thousands.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Only comma → treat as decimal separator (EU style)
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

// Convenience: parse and return as plain string (for API payloads); empty string on NaN.
function parseAmountInputStr(raw) {
  const n = parseAmountInput(raw);
  return isNaN(n) ? '' : String(n);
}

// ─── Calculation Helpers ─────────────────────────────────────────────────

function computeBalances(tx, accounts) {
  const balances = {};
  for (const a of accounts) {
    balances[a.alias] = a.initial_balance;
  }
  for (const t of tx) {
    if (t.type === 'expense') {
      if (balances[t.account] !== undefined) balances[t.account] -= t.amount;
    } else if (t.type === 'income') {
      if (balances[t.account] !== undefined) balances[t.account] += t.amount;
    } else if (t.type === 'transfer') {
      if (balances[t.account] !== undefined) balances[t.account] -= t.amount;
      if (t.transfer_to_account && balances[t.transfer_to_account] !== undefined) {
        const toAmt = t.transfer_to_amount > 0 ? t.transfer_to_amount : t.amount;
        balances[t.transfer_to_account] += toAmt;
      }
    }
  }
  return balances;
}

// Source of truth for "does this account count toward Net Worth?".
// Reads the per-account `include_in_net_worth` flag from accounts.csv
// (added 2026-05-03). If the column is missing — older CSV, freshly
// imported template, etc. — we fall back to the legacy heuristic:
// owner=self AND status=active AND type != pass_through.
function isInNetWorth(a) {
  const v = a && a.include_in_net_worth;
  if (v === 'true' || v === true) return true;
  if (v === 'false' || v === false) return false;
  return a && a.owner === 'self' && a.status === 'active' && a.type !== 'pass_through';
}

function netWorthByCurrency(accounts, balances) {
  if (displayCurrency !== 'TZS') {
    // Aggregate all into display currency
    let total = 0, count = 0;
    for (const a of accounts) {
      if (!isInNetWorth(a)) continue;
      total += toDisplay(balances[a.alias] || 0, a.currency);
      count++;
    }
    return { [displayCurrency]: { total, accounts: count } };
  }
  const result = {};
  for (const a of accounts) {
    if (!isInNetWorth(a)) continue;
    if (!result[a.currency]) result[a.currency] = { total: 0, accounts: 0 };
    result[a.currency].total += balances[a.alias] || 0;
    result[a.currency].accounts += 1;
  }
  return result;
}

// Aggregate open debts by currency. Returns the net effect on personal wealth:
//   owed_to_me  → asset    (positive)
//   owed_by_me  → liability (negative)
// Respects displayCurrency — when switched, everything converted into one bucket.
function debtsByCurrency(thirdParty) {
  const openDebts = (thirdParty || []).filter(d => d.settled !== 'true' && d.settled !== true);

  if (displayCurrency !== 'TZS') {
    let net = 0, owedToMe = 0, owedByMe = 0;
    for (const d of openDebts) {
      const amt = toDisplay(parseFloat(d.amount) || 0, d.currency);
      if (d.type === 'owed_to_me') { owedToMe += amt; net += amt; }
      else if (d.type === 'owed_by_me') { owedByMe += amt; net -= amt; }
    }
    return { [displayCurrency]: { net, owedToMe, owedByMe } };
  }

  const result = {};
  for (const d of openDebts) {
    const cur = d.currency || 'TZS';
    if (!result[cur]) result[cur] = { net: 0, owedToMe: 0, owedByMe: 0 };
    const amt = parseFloat(d.amount) || 0;
    if (d.type === 'owed_to_me') { result[cur].owedToMe += amt; result[cur].net += amt; }
    else if (d.type === 'owed_by_me') { result[cur].owedByMe += amt; result[cur].net -= amt; }
  }
  return result;
}

function custodyByCurrencyOwner(accounts, balances) {
  const result = {};  // key = `${owner}-${currency}`
  for (const a of accounts) {
    if (a.owner === 'self') continue;
    if (a.status !== 'active') continue;
    const key = `${a.owner}|${a.currency}`;
    if (!result[key]) result[key] = { owner: a.owner, currency: a.currency, total: 0, accounts: [] };
    result[key].total += balances[a.alias] || 0;
    result[key].accounts.push(a.alias);
  }
  return Object.values(result);
}

function sumByMonth(tx, yearMonth, currency) {
  let income = 0, expense = 0, count = 0;
  const convertMode = displayCurrency !== 'TZS';
  for (const t of tx) {
    if (!t.date || !t.date.startsWith(yearMonth)) continue;
    if (!convertMode && t.currency !== currency) continue;
    const amt = convertMode ? toDisplay(t.amount, t.currency) : t.amount;
    count++;
    if (t.type === 'expense') expense += amt;
    else if (t.type === 'income') {
      income += amt;
    }
  }
  return { income, expense, net: income - expense, count };
}

function topCategoriesForMonth(tx, yearMonth, currency, n = 8) {
  const totals = {};
  const convertMode = displayCurrency !== 'TZS';
  for (const t of tx) {
    if (!t.date || !t.date.startsWith(yearMonth)) continue;
    if (!convertMode && t.currency !== currency) continue;
    if (t.type !== 'expense') continue;
    const cat = t.category || '(no category)';
    const amt = convertMode ? toDisplay(t.amount, t.currency) : t.amount;
    totals[cat] = (totals[cat] || 0) + amt;
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function cashflowLastMonths(tx, monthsBack, currency) {
  const now = new Date();
  const result = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const { income, expense } = sumByMonth(tx, ym, currency);
    result.push({ month: ym, income, expense, net: income - expense });
  }
  return result;
}

function dataDateRange(tx) {
  if (tx.length === 0) return { min: null, max: null };
  let min = tx[0].date, max = tx[0].date;
  for (const t of tx) {
    if (t.date < min) min = t.date;
    if (t.date > max) max = t.date;
  }
  return { min, max };
}

// Daily balance snapshots for an account over the last N days (for sparklines)
function accountDailyBalances(alias, days) {
  const acc = state.accounts.find(a => a.alias === alias);
  if (!acc) return [];
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - days + 1);
  const startStr = startDate.toISOString().slice(0, 10);

  // Start from initial balance, apply all TX up to startDate
  let bal = acc.initial_balance;
  const sorted = state.tx.filter(t => t.account === alias || (t.type === 'transfer' && t.transfer_to_account === alias));
  for (const t of sorted) {
    if (t.date >= startStr) continue;
    if (t.type === 'expense' && t.account === alias) bal -= t.amount;
    else if (t.type === 'income' && t.account === alias) bal += t.amount;
    else if (t.type === 'transfer' && t.account === alias) bal -= t.amount;
    else if (t.type === 'transfer' && t.transfer_to_account === alias) bal += (t.transfer_to_amount > 0 ? t.transfer_to_amount : t.amount);
  }

  // Walk day by day, applying TX on each date
  const result = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const ds = d.toISOString().slice(0, 10);
    for (const t of sorted) {
      if (t.date !== ds) continue;
      if (t.type === 'expense' && t.account === alias) bal -= t.amount;
      else if (t.type === 'income' && t.account === alias) bal += t.amount;
      else if (t.type === 'transfer' && t.account === alias) bal -= t.amount;
      else if (t.type === 'transfer' && t.transfer_to_account === alias) bal += (t.transfer_to_amount > 0 ? t.transfer_to_amount : t.amount);
    }
    result.push(bal);
  }
  return result;
}

// Generate an inline SVG sparkline from an array of values
function sparklineSvg(values, width, height, color) {
  if (!values || values.length < 2) return '';
  const w = width || 80;
  const h = height || 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const endVal = values[values.length - 1];
  const startVal = values[0];
  const lineColor = color || (endVal >= startVal ? 'var(--positive)' : 'var(--negative)');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle;"><polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function formatCurrency(value, currency) {
  // TZS ohne Dezimalen, EUR/USD/PLN/TRY mit 2 Dezimalen. Locale-Tag kommt aus
  // i18n.js → getLocaleTag() (en-US / de-DE), damit DE 1.234,56 statt 1,234.56
  // rendert. Fallback auf en-US wenn i18n.js noch nicht geladen ist.
  const decimals = currency === 'TZS' ? 0 : 2;
  const tag = typeof getLocaleTag === 'function' ? getLocaleTag() : 'en-US';
  const formatted = Math.abs(value).toLocaleString(tag, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return value < 0 ? `-${formatted}` : formatted;
}

function monthLabel(yearMonth) {
  const [y, m] = yearMonth.split('-');
  const idx = parseInt(m, 10);
  // Short month names come from i18n (common.months.short.{1..12}). Fallback
  // array mirrors the EN keys so monthLabel() works even if i18n isn't loaded.
  const fallback = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const name = (typeof t === 'function') ? t(`common.months.short.${idx}`, {}, fallback[idx]) : fallback[idx];
  return `${name} ${y}`;
}


// ─── Operational-Tx Filter Helpers ───────────────────────────────────
// Used by Fixed Reports and Custom Reports to exclude custody accounts
// (any account where owner != 'self') and non-P&L categories (transfers,
// custody movements) so income/expense KPIs reflect only self-relevant
// activity.

function getNonPnlCategories() {
  return new Set(state.categories.filter(c => c.pnl === 'false').map(c => c.path));
}

function getCustodyAliases() {
  return new Set(state.accounts.filter(a => a.owner !== 'self').map(a => a.alias));
}

function isOperationalTx(t, custodyAliases, nonPnl) {
  if (custodyAliases.has(t.account)) return false;
  if (nonPnl && nonPnl.has(t.category)) return false;
  return true;
}

// ─── Cost-of-Living Filter (shared, flag-driven) ─────────────────────────
// Which categories count as "essential cost of living" is configured via
// the `essential` flag in data/categories.csv (editable in Settings →
// Categories). Used by the Cost-of-Living report and the Runway report's
// essentials-only runway calculation. Single source of truth — no
// duplicated exclusion lists anywhere.
//
// Rationale for the default assignment:
//   - Automobile:* (except Purchase) stays essential because those are
//     costs the user would have to cover if the company stopped paying.
//   - Rent, bills, groceries, healthcare, transport, basic subscriptions
//     are essentials regardless of who's covering them right now.
//   - Dining out, staff salaries, travel, permits/fines, car purchase,
//     outgoing loans, cash discrepancies default to non-essential.

let _colExcludedCache = null;
let _colCacheSource = null;

function _rebuildColCache() {
  const cats = state.categories || [];
  if (cats === _colCacheSource) return;
  _colCacheSource = cats;
  _colExcludedCache = new Set();
  for (const c of cats) {
    // Explicit false (string or boolean) marks the category as non-essential
    if (c.essential === 'false' || c.essential === false) {
      _colExcludedCache.add(c.path);
    }
  }
}

function isColExcludedCategory(cat) {
  if (!cat) return true;
  _rebuildColCache();
  return _colExcludedCache.has(cat);
}

// Returns the set of non-essential category paths. Useful for UI labels
// like "Excluded from Cost of Living: <list>" so descriptions stay
// dynamic as the user edits the flags.
function getNonEssentialCategories() {
  _rebuildColCache();
  return new Set(_colExcludedCache);
}

// Returns true iff the transaction counts as essential cost-of-living
// spending — operational expense, not custody, not non-PnL, not luxury.
function isCostOfLivingTx(t, custodyAliases, nonPnl) {
  if (t.type !== 'expense') return false;
  if (!isOperationalTx(t, custodyAliases, nonPnl)) return false;
  return !isColExcludedCategory(t.category);
}

// ─── Page Navigation + Interaction (from original app.js) ────────────

// ─── Interaction ─────────────────────────────────────────────────────────

// Month nav: single delegated listener on dashboard container
let monthNavWired = false;
function wireMonthNav() {
  if (monthNavWired) return;
  const dash = document.getElementById('dashboard');
  if (!dash) return;
  dash.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (!btn) return;
    const nav = btn.getAttribute('data-nav');
    const [y, m] = state.currentMonth.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    if (nav === 'prev') d.setMonth(d.getMonth() - 1);
    else if (nav === 'next') d.setMonth(d.getMonth() + 1);
    else if (nav === 'current') { const n = new Date(); d.setFullYear(n.getFullYear(), n.getMonth(), 1); }
    state.currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    render('month');
  });
  monthNavWired = true;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ─── Delegated Click Dispatcher (replaces onclick="fn('${userdata}')") ──
//
// Inline onclick handlers with interpolated user data (e.g. payee names
// like "L'Étoile") would break the JS string and could execute injected
// code. Migration target — same pattern pages-transactions.js has used
// since its initial split:
//   `<button data-action="showPayeeModal" data-arg1="${escapeHtml(p.id)}">Edit</button>`
//
// One document-level click listener handles every callsite. Render
// functions don't have to wire anything per scope — re-renders just
// replace the buttons, and the next click hits this same listener.
// The dispatcher looks up window[action]; only globally-defined
// functions can be invoked. Up to 5 string args (data-arg1..data-arg5)
// are passed through. Receivers expecting booleans must parse the
// string ('true'/'false').
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = window[el.dataset.action];
  if (typeof fn !== 'function') return;
  const args = [];
  for (let i = 1; i <= 5; i++) {
    const v = el.dataset['arg' + i];
    if (v === undefined) break;
    args.push(v);
  }
  // Suppress the default for buttons and dummy-href anchors (where the
  // default would just scroll to top), but let real fragment links
  // (`href="#settings"`) navigate naturally — the hashchange listener
  // already routes them to navigateTo.
  const href = el.getAttribute && el.getAttribute('href');
  if (!(el.tagName === 'A' && href && href !== '#')) {
    e.preventDefault();
  }
  fn.apply(null, args);
});

// ─── Excel Export ────────────────────────────────────────────────────────

/**
 * Export data as XLSX file download.
 * @param {Array<Object>} rows - Array of plain objects (each = one row)
 * @param {string} filename - e.g. 'transactions_2026-04'
 * @param {string} [sheetName] - worksheet name, default 'Data'
 */
function exportXlsx(rows, filename, sheetName) {
  if (!rows || rows.length === 0) return;
  if (typeof XLSX === 'undefined') { uiAlert(t('reports.export.err_no_xlsx', {}, 'XLSX library not loaded')); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Data');
  XLSX.writeFile(wb, (filename || 'export') + '.xlsx');
}

// ─── Page Navigation ─────────────────────────────────────────────────────

let accountPage = {
  alias: null, page: 0, PAGE_SIZE: 100,
  sortCol: 'date', sortAsc: false,
  filterType: '', filterCategory: '', filterTags: [],
  filterDateFrom: '', filterDateTo: '', filterAmountMin: '', filterAmountMax: '',
  filterPayee: '',
};

// Shared TX filter/sort helper. `opts.includeAccount = alias` treats both
// direct-account and transfer-target rows as belonging to that alias and
// skips the account filter itself. Otherwise `f.filterAccount` is honored
// like the main TX page.
function applyTxFilterSort(txList, f, opts) {
  opts = opts || {};
  let filtered = txList.slice();
  if (opts.includeAccount) {
    const alias = opts.includeAccount;
    filtered = filtered.filter(t => t.account === alias || (t.type === 'transfer' && t.transfer_to_account === alias));
  } else if (f.filterAccount) {
    filtered = filtered.filter(t => t.account === f.filterAccount || (t.type === 'transfer' && t.transfer_to_account === f.filterAccount));
  }
  if (f.filterType) filtered = filtered.filter(t => t.type === f.filterType);
  if (f.filterCategory) {
    const fc = f.filterCategory;
    if (fc.includes(':')) {
      filtered = filtered.filter(t => (t.category || '') === fc);
    } else {
      filtered = filtered.filter(t => {
        const c = t.category || '';
        return c === fc || c.startsWith(fc + ':');
      });
    }
  }
  if (f.filterTags && f.filterTags.length > 0) filtered = filtered.filter(t => {
    const txTags = (t.tags || '').split(';').filter(Boolean);
    return f.filterTags.some(ft => txTags.includes(ft));
  });
  if (f.filterDateFrom) filtered = filtered.filter(t => t.date >= f.filterDateFrom);
  if (f.filterDateTo) filtered = filtered.filter(t => t.date <= f.filterDateTo);
  if (f.filterAmountMin !== '' && f.filterAmountMin != null) filtered = filtered.filter(t => t.amount >= parseFloat(f.filterAmountMin));
  if (f.filterAmountMax !== '' && f.filterAmountMax != null) filtered = filtered.filter(t => t.amount <= parseFloat(f.filterAmountMax));
  if (f.filterPayee) {
    const pq = f.filterPayee.toLowerCase();
    filtered = filtered.filter(t => (t.payee || '').toLowerCase().includes(pq));
  }
  return filtered;
}

function navigateTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav > li > a[data-page]').forEach(a => a.classList.remove('active'));
  // Clear More menu active state
  const moreBtn = document.getElementById('nav-more-btn');
  if (moreBtn) moreBtn.classList.remove('active');
  document.querySelectorAll('.nav-more-menu a').forEach(a => a.classList.remove('active'));

  if (pageId.startsWith('account:')) {
    const alias = pageId.replace('account:', '');
    const page = document.getElementById('page-account');
    if (page) page.classList.add('active');
    // Highlight Accounts in sidebar
    const accLink = document.querySelector('.sidebar-nav > li > a[data-page="accounts"]');
    if (accLink) accLink.classList.add('active');
    // Reset filters when switching to a different account
    if (accountPage.alias !== alias) {
      accountPage.filterType = ''; accountPage.filterCategory = '';
      accountPage.filterTags = []; accountPage.filterDateFrom = '';
      accountPage.filterDateTo = ''; accountPage.filterAmountMin = '';
      accountPage.filterAmountMax = ''; accountPage.filterPayee = '';
    }
    accountPage.alias = alias;
    accountPage.page = 0;
    if (state.tx.length) renderAccountPage();
  } else {
    const page = document.getElementById('page-' + pageId);
    const link = document.querySelector(`.sidebar-nav > li > a[data-page="${pageId}"]`);
    if (page) page.classList.add('active');
    if (link) link.classList.add('active');
    // Highlight More button if a More-menu page is active
    const moreMenuLink = document.querySelector(`.nav-more-menu a[data-page="${pageId}"]`);
    if (moreMenuLink && moreBtn) { moreBtn.classList.add('active'); moreMenuLink.classList.add('active'); }
    if (pageId === 'reports' && state.tx.length) { activeReportId = null; destroyReportCharts(); renderReportsPage(); }
    if (pageId.startsWith('reports/')) {
      // Sub-route: jump straight to a specific report by id (e.g. #reports/budgetactual).
      // Activates the same page shell as the list and lets renderReportsPage()
      // dispatch to renderReportDetail() because activeReportId is set.
      const reportPage = document.getElementById('page-reports');
      if (reportPage) reportPage.classList.add('active');
      const reportLink = document.querySelector('.sidebar-nav > li > a[data-page="reports"]');
      if (reportLink) reportLink.classList.add('active');
      const moreReportLink = document.querySelector('.nav-more-menu a[data-page="reports"]');
      if (moreReportLink && moreBtn) { moreBtn.classList.add('active'); moreReportLink.classList.add('active'); }
      if (state.tx.length) {
        const reportId = pageId.slice('reports/'.length);
        const exists = typeof getAllReports === 'function' && getAllReports().some(r => r.id === reportId);
        activeReportId = exists ? reportId : null;
        destroyReportCharts();
        renderReportsPage();
      }
    }
    if (pageId === 'transactions' && state.tx.length) {
      txPage.page = 0; txPage.filterType = ''; txPage.filterAccount = '';
      txPage.filterCategory = ''; txPage.filterTags = [];
      txPage.filterDateFrom = ''; txPage.filterDateTo = '';
      txPage.filterAmountMin = ''; txPage.filterAmountMax = '';
      txPage.filterPayee = ''; txPage.selected = new Set();
      renderTransactionsPage();
    }
    if (pageId === 'accounts') renderAccountsOverview();
    // Feature-gated pages: bounce to dashboard when the flag is off.
    if (pageId === 'debts') {
      if (!isFeatureEnabled('debt_tracking')) { location.hash = '#dashboard'; return; }
      renderDebtsPage();
    }
    if (pageId === 'reconciliation') {
      if (!isFeatureEnabled('crdb_recon')) { location.hash = '#dashboard'; return; }
      reconTab = 'reports'; renderReconciliationPage();
    }
    if (pageId === 'metals') {
      if (!isFeatureEnabled('metals')) { location.hash = '#dashboard'; return; }
      renderMetalsPage();
    }
    if (pageId === 'vehicles') {
      if (!isFeatureEnabled('vehicles')) { location.hash = '#dashboard'; return; }
      renderVehiclesPage();
    }
    if (pageId === 'add-tx') renderAddTxPage();
    if (pageId === 'payees') { settingsTab = 'payees'; navigateTo('settings'); return; }
    if (pageId === 'search') renderSearchPage();
    if (pageId === 'alerts') renderAlertsPage();
    if (pageId === 'custom-reports') renderCustomReportsPage();
    if (pageId.startsWith('custom-reports/')) {
      // Sub-routes: builder/new, builder/edit/<id>. Activate the same page
      // shell as the list (page-custom-reports) and let the dispatcher pick.
      const crPage = document.getElementById('page-custom-reports');
      if (crPage) crPage.classList.add('active');
      const crLink = document.querySelector('.sidebar-nav > li > a[data-page="custom-reports"]');
      if (crLink) crLink.classList.add('active');
      const moreCrLink = document.querySelector('.nav-more-menu a[data-page="custom-reports"]');
      if (moreCrLink && moreBtn) { moreBtn.classList.add('active'); moreCrLink.classList.add('active'); }
      dispatchCustomReportsRoute(pageId);
    }
    if (pageId === 'settings') { settingsTab = 'categories'; renderSettingsPage(); }
    if (pageId === 'faq' || pageId.startsWith('faq/')) {
      const faqPage = document.getElementById('page-faq');
      if (faqPage) faqPage.classList.add('active');
      const faqLink = document.querySelector('.sidebar-nav > li > a[data-page="faq"]');
      if (faqLink) faqLink.classList.add('active');
      const moreFaqLink = document.querySelector('.nav-more-menu a[data-page="faq"]');
      if (moreFaqLink && moreBtn) { moreBtn.classList.add('active'); moreFaqLink.classList.add('active'); }
      if (typeof renderFaqPage === 'function') renderFaqPage();
    }
  }
}

document.querySelectorAll('.sidebar-nav > li > a[data-page]').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const page = a.getAttribute('data-page');
    // Clear stale Add-TX return state on "fresh" sidebar navigation so the
    // back bar only appears when the user actually came from a detail page.
    if (page === 'add-tx' && typeof addTxState !== 'undefined') {
      addTxState.returnRoute = null;
      addTxState.prefillAccount = null;
    }
    history.pushState(null, '', '#' + page);
    navigateTo(page);
  });
});

// (Accounts toggle removed — now a normal page)

// ── Mobile hamburger drawer + FAB ──
(function() {
  const burger = document.getElementById('mobile-burger');
  const backdrop = document.getElementById('drawer-backdrop');
  const sidebar = document.getElementById('sidebar');
  const fab = document.getElementById('fab-add-tx');

  // Use the modern `inert` attribute instead of aria-hidden so a focused
  // child (e.g. the active nav link) doesn't trigger the
  // "aria-hidden on a focused element" a11y warning. Inert removes the
  // sub-tree from focus order AND the a11y tree, which is what we
  // actually want when the off-screen mobile drawer is closed.
  // Desktop never runs in drawer-open mode, so we only flag inert when
  // we're below the mobile breakpoint AND the drawer is closed.
  function syncSidebarInert() {
    if (!sidebar) return;
    const mobile = window.matchMedia('(max-width: 768px)').matches;
    const open = document.body.classList.contains('drawer-open');
    if (mobile && !open) sidebar.setAttribute('inert', '');
    else sidebar.removeAttribute('inert');
  }
  const openDrawer = () => {
    document.body.classList.add('drawer-open');
    syncSidebarInert();
  };
  const closeDrawer = () => {
    document.body.classList.remove('drawer-open');
    syncSidebarInert();
  };
  // Drop any leftover aria-hidden — third-party extensions or older
  // builds may have stamped it on the sidebar.
  if (sidebar) sidebar.removeAttribute('aria-hidden');
  syncSidebarInert();
  window.addEventListener('resize', syncSidebarInert);

  if (burger) {
    burger.addEventListener('click', (e) => {
      e.preventDefault();
      if (document.body.classList.contains('drawer-open')) closeDrawer(); else openDrawer();
    });
  }
  if (backdrop) backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  // Close drawer on nav item tap (so the new page is unobstructed)
  if (sidebar) {
    sidebar.querySelectorAll('a[data-page]').forEach(a => {
      a.addEventListener('click', () => closeDrawer());
    });
  }

  // FAB → Add TX
  if (fab) {
    fab.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof addTxState !== 'undefined') {
        addTxState.returnRoute = null;
        addTxState.prefillAccount = null;
      }
      history.pushState(null, '', '#add-tx');
      navigateTo('add-tx');
    });
  }
})();

window.addEventListener('hashchange', () => {
  const hash = location.hash.replace('#', '') || 'dashboard';
  navigateTo(hash);
});

// ── Modal a11y polyfill ────────────────────────────────────────────
// Every dynamically-created `.modal-overlay` gets role="dialog" plus
// aria-modal="true" stamped on its inner `.modal`, and the first
// heading (h1..h4) gets wired as aria-labelledby. This way screen
// readers announce the modal as a dialog without us having to touch
// the 17+ render helpers that build modal templates by hand.
//
// Focus management: on add, snapshot the previously-focused element,
// focus the first focusable inside the modal, and trap Tab/Shift+Tab
// so keyboard users cannot escape the dialog while it is open. On
// remove, restore focus to the previously-focused element.
const MODAL_FOCUSABLE_SEL =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function modalFocusables(modal) {
  return Array.from(modal.querySelectorAll(MODAL_FOCUSABLE_SEL))
    .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
}
// Modal stack so nested modals (uiConfirm fired from inside an edit
// modal, etc.) restore focus to the *previous* modal's last focused
// element rather than to a stale snapshot — and so closing the outer
// modal first doesn't drop keyboard context.
window.__modalStack = window.__modalStack || [];

function installModalA11y(node) {
  const modal = node.querySelector('.modal');
  if (!modal) return;
  if (!modal.hasAttribute('role')) modal.setAttribute('role', 'dialog');
  if (!modal.hasAttribute('aria-modal')) modal.setAttribute('aria-modal', 'true');
  const heading = modal.querySelector('h1, h2, h3, h4');
  if (heading && !modal.hasAttribute('aria-labelledby')) {
    if (!heading.id) heading.id = 'm-h-' + Math.random().toString(36).slice(2, 9);
    modal.setAttribute('aria-labelledby', heading.id);
  }

  // Inject a universal close ✕ button in the top-right of every modal
  // (UX backlog "close-✕"). Dispatches an Escape keydown on the
  // overlay — bubbles up to document so legacy modals with a global
  // Escape handler (closeModal) fire, AND directly hits ui-helpers
  // that listen on overlay. Skip if the modal already has one (e.g.
  // a hand-rolled close button or repeat-install).
  if (!modal.querySelector(':scope > .modal-close-x') && !modal.hasAttribute('data-no-close-x')) {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close-x';
    closeBtn.setAttribute('aria-label', (typeof t === 'function' ? t('aria.icon_close', {}, 'Close') : 'Close'));
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Dispatch Escape — bubbles to document for legacy modals with a
      // global _escHandler, and fires directly on overlay for the ui-
      // helpers that listen on overlay. Every modal in this codebase
      // implements Escape, so this is reliable.
      const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      node.dispatchEvent(ev);
    });
    modal.insertBefore(closeBtn, modal.firstChild);
  }

  // Save previously-focused element so we can restore on close. Push on
  // a stack so nested modals don't lose the outer modal's focus state.
  node._prevFocus = document.activeElement;
  window.__modalStack.push(node);

  // Focus management: prefer an [autofocus] hint over the first
  // focusable so dialog helpers can encode "Enter = OK" or "Enter =
  // Cancel" muscle memory by marking the right button. Defer one frame
  // so any inline setTimeout(focus) calls inside the modal's render
  // code still win. If no focusable exists at all, focus the modal
  // itself so screen readers announce it and Tab still works.
  requestAnimationFrame(() => {
    if (!node.isConnected) return;
    if (document.activeElement && modal.contains(document.activeElement)) return;
    const focusables = modalFocusables(modal);
    const target = modal.querySelector('[autofocus]') || focusables[0];
    if (target) {
      target.focus();
    } else {
      if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
      modal.focus();
    }
  });

  // Trap Tab so focus cannot leave the modal. Listen on the overlay
  // (capture=false) — the existing per-modal Escape handler stays
  // independent and is wired on document.
  node._tabHandler = (e) => {
    if (e.key !== 'Tab') return;
    const focusables = modalFocusables(modal);
    if (focusables.length === 0) { e.preventDefault(); return; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !modal.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  node.addEventListener('keydown', node._tabHandler);
}
function teardownModalA11y(node) {
  if (node._tabHandler) {
    node.removeEventListener('keydown', node._tabHandler);
    node._tabHandler = null;
  }
  // Pop this node from the stack (regardless of order — outer modal may
  // have closed first if e.g. Escape race) and try to restore focus to
  // the most recent still-connected ancestor's snapshot.
  const stackIdx = window.__modalStack.indexOf(node);
  if (stackIdx !== -1) window.__modalStack.splice(stackIdx, 1);

  const cur = document.activeElement;
  const focusInValidPlace = cur && cur !== document.body && cur !== document.documentElement;
  if (!focusInValidPlace) {
    // Walk back through the stack for a still-connected target, then
    // fall through to this node's own snapshot.
    const candidates = [];
    for (let i = window.__modalStack.length - 1; i >= 0; i--) {
      const outer = window.__modalStack[i];
      if (outer._prevFocus) candidates.push(outer._prevFocus);
    }
    candidates.push(node._prevFocus);
    for (const target of candidates) {
      if (target && typeof target.focus === 'function' && target.isConnected) {
        try { target.focus(); break; } catch (_) {}
      }
    }
  }
  node._prevFocus = null;
}
function stampTablistA11y(root) {
  const lists = root.classList && root.classList.contains('atx-tabs')
    ? [root]
    : Array.from(root.querySelectorAll('.atx-tabs'));
  for (const list of lists) {
    if (!list.hasAttribute('role')) list.setAttribute('role', 'tablist');
    const buttons = list.querySelectorAll(':scope > button');
    buttons.forEach((b) => {
      if (!b.hasAttribute('role')) b.setAttribute('role', 'tab');
      const isActive = b.classList.contains('active');
      b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      // Roving tabindex: only the active tab is in the tab order; the
      // rest are reachable via Arrow keys (handled by the keydown
      // listener below).
      b.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    // If no button is active (initial render edge case), make the
    // first one focusable so keyboard users can still enter the strip.
    if (!list.querySelector(':scope > button[tabindex="0"]')) {
      const first = list.querySelector(':scope > button');
      if (first) first.setAttribute('tabindex', '0');
    }
  }
}
// Body-level observer: only fires on direct children of body (where
// modals are appended). No subtree to keep this cheap.
new MutationObserver((records) => {
  for (const r of records) {
    for (const node of r.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.classList && node.classList.contains('modal-overlay')) {
        installModalA11y(node);
        stampTablistA11y(node);
      }
    }
    for (const node of r.removedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (!node.classList || !node.classList.contains('modal-overlay')) continue;
      teardownModalA11y(node);
    }
  }
}).observe(document.body, { childList: true });

// ── i18n-aware confirm/prompt/alert helpers ────────────────────────
// Replace native window.confirm/prompt/alert dialogs (whose OK/Cancel
// labels live in the *browser* locale, not the dashboard locale) with
// modal-based promises styled like the rest of the dashboard. The
// MutationObserver above picks them up automatically for role/dialog
// stamping and focus trap.
function _uiEscapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function _uiBuildOverlay(innerHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = innerHtml;
  document.body.appendChild(overlay);
  return overlay;
}
function _uiBodyHtml(message) {
  const safe = _uiEscapeHtml(message).replace(/\n/g, '<br>');
  return `<div class="hint-md mb-16 ui-dialog-body">${safe}</div>`;
}
// Promise-based replacement for window.alert. Always resolves true once
// dismissed; callers can ignore the return value (fire-and-forget).
// opts.type: 'default' | 'info' | 'warning' | 'error' — colours the
// title to telegraph severity. Default falls back to a neutral title.
function uiAlert(message, opts = {}) {
  const type = opts.type || 'default';
  const okLabel = opts.okLabel || (typeof t === 'function'
    ? t('ui.dialog.ok', {}, 'OK') : 'OK');
  const titleKey = type === 'error' ? 'ui.dialog.error_title'
    : type === 'warning' ? 'ui.dialog.warning_title'
    : type === 'info' ? 'ui.dialog.info_title'
    : 'ui.dialog.alert_title';
  const titleFallback = type === 'error' ? 'Error'
    : type === 'warning' ? 'Warning'
    : type === 'info' ? 'Info'
    : 'Notice';
  const title = opts.title || (typeof t === 'function'
    ? t(titleKey, {}, titleFallback) : titleFallback);
  const typeClass = type !== 'default' ? ` ui-dialog-${type}` : '';
  const okClass = type === 'warning' ? 'btn-warn'
    : type === 'error' ? 'btn-delete'
    : 'btn-save';
  return new Promise((resolve) => {
    const overlay = _uiBuildOverlay(`
      <div class="modal ui-dialog${typeClass}">
        <h3>${_uiEscapeHtml(title)}</h3>
        ${_uiBodyHtml(message)}
        <div class="atx-row ui-dialog-actions">
          <button type="button" class="${okClass}" data-ui-ok autofocus>${_uiEscapeHtml(okLabel)}</button>
        </div>
      </div>
    `);
    const close = () => { overlay.remove(); resolve(true); };
    // Scope keydown to the overlay (not document) so a uiAlert mounted
    // over another form doesn't intercept the form's Enter/Escape. The
    // focused OK button handles Enter natively via native button
    // activation; we only wire Escape here.
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-ui-ok]').addEventListener('click', close);
  });
}
// Promise-based replacement for window.confirm. Resolves true on OK,
// false on Cancel/Escape/backdrop. Callers must `await` the result.
// opts.type: 'default' | 'destructive' | 'warning'. Backwards-compat:
// opts.danger === true is sugar for type='destructive'. Destructive
// blocks backdrop-dismiss + autofocuses Cancel; warning uses the
// amber `.btn-warn` style but still allows backdrop-dismiss.
function uiConfirm(message, opts = {}) {
  const type = opts.type || (opts.danger === true ? 'destructive' : 'default');
  const isDestructive = type === 'destructive';
  const isWarning = type === 'warning';
  const okLabel = opts.okLabel || (typeof t === 'function'
    ? t('ui.dialog.ok', {}, 'OK') : 'OK');
  const cancelLabel = opts.cancelLabel || (typeof t === 'function'
    ? t('common.actions.cancel', {}, 'Cancel') : 'Cancel');
  const titleKey = isDestructive ? 'ui.dialog.destructive_title'
    : isWarning ? 'ui.dialog.warning_title'
    : 'ui.dialog.confirm_title';
  const titleFallback = isDestructive ? 'Confirm Deletion'
    : isWarning ? 'Warning'
    : 'Confirm';
  const title = opts.title || (typeof t === 'function'
    ? t(titleKey, {}, titleFallback) : titleFallback);
  const typeClass = isDestructive ? ' ui-dialog-error'
    : isWarning ? ' ui-dialog-warning'
    : '';
  const okClass = isDestructive ? 'btn-delete' : isWarning ? 'btn-warn' : 'btn-save';
  return new Promise((resolve) => {
    // Default-focus & primary-vs-cancel hierarchy:
    // - default / warning: OK is the safe primary action → autofocus
    //   on OK so Enter immediately confirms (matches native confirm).
    // - destructive: autofocus on Cancel as the safer default
    //   (Material/HIG). User must explicitly Tab + Enter or click OK.
    const overlay = _uiBuildOverlay(`
      <div class="modal ui-dialog${typeClass}">
        <h3>${_uiEscapeHtml(title)}</h3>
        ${_uiBodyHtml(message)}
        <div class="atx-row ui-dialog-actions">
          <button type="button" class="btn-secondary" data-ui-cancel${isDestructive ? ' autofocus' : ''}>${_uiEscapeHtml(cancelLabel)}</button>
          <button type="button" class="${okClass}" data-ui-ok${isDestructive ? '' : ' autofocus'}>${_uiEscapeHtml(okLabel)}</button>
        </div>
      </div>
    `);
    const finish = (ok) => {
      overlay.remove();
      resolve(ok);
    };
    // Scope keydown to overlay so other modals stacked behind don't
    // lose Enter/Escape. Enter is handled natively by the focused
    // button. We only wire Escape here.
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    // Backdrop click cancels — except for destructive variants where
    // accidental outside-clicks would silently undo intent (UX-Reviewer
    // #2). For destructive, user must use Cancel button or Escape.
    if (!isDestructive) {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
    }
    overlay.querySelector('[data-ui-cancel]').addEventListener('click', () => finish(false));
    overlay.querySelector('[data-ui-ok]').addEventListener('click', () => finish(true));
  });
}
// Promise-based replacement for window.prompt. Resolves to the trimmed
// input string on OK, or null on Cancel/Escape/backdrop (matches the
// native API's contract — null means "user cancelled").
function uiPrompt(message, defaultValue = '', opts = {}) {
  const okLabel = opts.okLabel || (typeof t === 'function'
    ? t('ui.dialog.ok', {}, 'OK') : 'OK');
  const cancelLabel = opts.cancelLabel || (typeof t === 'function'
    ? t('common.actions.cancel', {}, 'Cancel') : 'Cancel');
  const title = opts.title || (typeof t === 'function'
    ? t('ui.dialog.prompt_title', {}, 'Input') : 'Input');
  return new Promise((resolve) => {
    const overlay = _uiBuildOverlay(`
      <div class="modal ui-dialog">
        <h3>${_uiEscapeHtml(title)}</h3>
        ${_uiBodyHtml(message)}
        <div class="atx-row"><div class="atx-field">
          <input type="text" data-ui-input value="${_uiEscapeHtml(defaultValue)}" autocomplete="off" autofocus>
        </div></div>
        <div class="atx-row ui-dialog-actions">
          <button type="button" class="btn-secondary" data-ui-cancel>${_uiEscapeHtml(cancelLabel)}</button>
          <button type="button" class="btn-save" data-ui-ok>${_uiEscapeHtml(okLabel)}</button>
        </div>
      </div>
    `);
    const input = overlay.querySelector('[data-ui-input]');
    const finish = (val) => {
      overlay.remove();
      resolve(val);
    };
    const submit = () => finish((input.value || '').trim());
    // Scope keydown to overlay so other modals stacked behind don't
    // lose Enter/Escape. Enter inside the input submits, Escape on
    // either overlay or input cancels.
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
    overlay.querySelector('[data-ui-cancel]').addEventListener('click', () => finish(null));
    overlay.querySelector('[data-ui-ok]').addEventListener('click', submit);
  });
}
window.uiAlert = uiAlert;
window.uiConfirm = uiConfirm;
window.uiPrompt = uiPrompt;

// ── Tab strip a11y (.atx-tabs) ─────────────────────────────────────
// Single delegated keydown listener that turns every .atx-tabs button
// strip into a WAI tablist with arrow-key navigation. Buttons retain
// their existing click handlers; we intercept ArrowLeft/Right/Home/
// End to move focus, then DEBOUNCE activation by 150ms so a rapid
// arrow-sweep doesn't trigger a re-render per keypress on tabs that
// re-fetch (Settings → Categories, Reconciliation → Reports etc.) —
// WAI APG explicitly allows manual/debounced activation when content
// load is expensive.
let _tabActivateTimer = null;
let _tabActivateTarget = null;
function _scheduleTabActivation(target) {
  _tabActivateTarget = target;
  if (_tabActivateTimer) clearTimeout(_tabActivateTimer);
  _tabActivateTimer = setTimeout(() => {
    const next = _tabActivateTarget;
    _tabActivateTimer = null;
    _tabActivateTarget = null;
    if (!next || !next.isConnected) return;
    const nextDataKey = next.dataset.action || next.dataset.reconTab || next.dataset.period || next.textContent.trim();
    next.click();
    // After .click() most tab handlers re-render the page, detaching
    // `next`. Look up the freshly-rendered .active button by data-key
    // and refocus so keyboard focus follows the activated tab.
    requestAnimationFrame(() => {
      const refreshed = (document.body.contains(next) ? next : null)
        || Array.from(document.querySelectorAll('.atx-tabs > button.active'))
          .find(b => (b.dataset.action || b.dataset.reconTab || b.dataset.period || b.textContent.trim()) === nextDataKey);
      if (refreshed && refreshed !== document.activeElement) refreshed.focus();
    });
  }, 150);
}
document.addEventListener('keydown', (e) => {
  const btn = e.target instanceof Element ? e.target.closest('.atx-tabs > button') : null;
  if (!btn) return;
  // Enter/Space activate immediately (skip debounce for explicit user
  // intent — matches WAI APG manual-activation semantics).
  if (e.key === 'Enter' || e.key === ' ') {
    if (_tabActivateTimer) { clearTimeout(_tabActivateTimer); _tabActivateTimer = null; _tabActivateTarget = null; }
    return; // let native button activation fire
  }
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const buttons = Array.from(btn.parentElement.querySelectorAll(':scope > button'))
    .filter(b => !b.disabled && b.offsetParent !== null);
  if (buttons.length === 0) return;
  const idx = buttons.indexOf(btn);
  let next;
  if (e.key === 'ArrowLeft') next = buttons[(idx - 1 + buttons.length) % buttons.length];
  else if (e.key === 'ArrowRight') next = buttons[(idx + 1) % buttons.length];
  else if (e.key === 'Home') next = buttons[0];
  else if (e.key === 'End') next = buttons[buttons.length - 1];
  if (!next || next === btn) return;
  e.preventDefault();
  next.focus();
  _scheduleTabActivation(next);
});

// Mobile: detect horizontally scrollable tables and show fade edge
function updateScrollFades() {
  document.querySelectorAll('.tx-table').forEach(table => {
    const section = table.closest('.section');
    if (!section) return;
    const scrollable = table.scrollWidth > table.clientWidth + 4;
    const atEnd = table.scrollLeft + table.clientWidth >= table.scrollWidth - 4;
    section.classList.toggle('scroll-fade', scrollable && !atEnd);
    if (!table._fadeWired) {
      table.addEventListener('scroll', () => {
        const end = table.scrollLeft + table.clientWidth >= table.scrollWidth - 4;
        section.classList.toggle('scroll-fade', !end);
      }, { passive: true });
      table._fadeWired = true;
    }
  });
}
window.addEventListener('resize', updateScrollFades);
// Run after each page render via MutationObserver. The observer is the
// only practical trigger on a hash-routed SPA, but a naive subtree-true
// childList listener fires on every innerHTML= write across the dashboard
// and runs querySelectorAll('.tx-table') on each one — visible Pi lag.
// Debounce via rAF so a burst of mutations from one render coalesces
// into a single fade update, and skip mutations that did not actually
// add/remove any element nodes (text-only changes never affect tables).
let scrollFadesScheduled = false;
function scheduleScrollFadesUpdate() {
  if (scrollFadesScheduled) return;
  scrollFadesScheduled = true;
  requestAnimationFrame(() => {
    scrollFadesScheduled = false;
    updateScrollFades();
  });
}
new MutationObserver(records => {
  let didFades = false;
  for (const r of records) {
    if (r.addedNodes.length || r.removedNodes.length) {
      if (!didFades) { scheduleScrollFadesUpdate(); didFades = true; }
      // Stamp tablist a11y on any added node that contains an .atx-tabs strip.
      // Cheap querySelector check — skips text nodes and unrelated subtrees.
      for (const node of r.addedNodes) {
        if (node instanceof HTMLElement) stampTablistA11y(node);
      }
    }
  }
}).observe(document.querySelector('.content-area') || document.body, { childList: true, subtree: true });

// ─── Keyboard Shortcuts ─────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Skip when typing in inputs, textareas, selects, or contenteditable
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
  // Skip when a modal is open (modal has its own Escape handler)
  if (document.querySelector('.modal-overlay')) return;

  if (e.key === '/' || (e.ctrlKey && e.key === 'k')) {
    // Focus search
    e.preventDefault();
    const gs = document.getElementById('global-search');
    if (gs) { gs.focus(); gs.select(); }
  } else if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
    // New TX
    e.preventDefault();
    if (typeof addTxState !== 'undefined') {
      addTxState.returnRoute = null;
      addTxState.prefillAccount = null;
    }
    history.pushState(null, '', '#add-tx');
    navigateTo('add-tx');
  } else if (e.key === 'd' && !e.ctrlKey && !e.metaKey) {
    // Dashboard
    e.preventDefault();
    history.pushState(null, '', '#dashboard');
    navigateTo('dashboard');
  } else if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
    // Reports
    e.preventDefault();
    history.pushState(null, '', '#reports');
    navigateTo('reports');
  } else if (e.key === 't' && !e.ctrlKey && !e.metaKey) {
    // Transactions
    e.preventDefault();
    history.pushState(null, '', '#transactions');
    navigateTo('transactions');
  } else if (e.key === 'R' && !e.ctrlKey && !e.metaKey) {
    // Refresh data (Shift+R)
    e.preventDefault();
    refreshData();
  } else if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
    // Show shortcuts help
    e.preventDefault();
    showShortcutsHelp();
  }
});

function showShortcutsHelp() {
  if (document.querySelector('.modal-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px;">
      <h3>Keyboard <span class="accent">Shortcuts</span></h3>
      <table class="tx-table" style="margin-top:12px;">
        <tbody>
          <tr><td><kbd>/</kbd> or <kbd>Ctrl+K</kbd></td><td>Search</td></tr>
          <tr><td><kbd>n</kbd></td><td>New Transaction</td></tr>
          <tr><td><kbd>d</kbd></td><td>Dashboard</td></tr>
          <tr><td><kbd>r</kbd></td><td>Reports</td></tr>
          <tr><td><kbd>t</kbd></td><td>Transactions</td></tr>
          <tr><td><kbd>Shift+R</kbd></td><td>Refresh Data</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Close Modal</td></tr>
          <tr><td><kbd>?</kbd></td><td>This Help</td></tr>
        </tbody>
      </table>
      <div style="margin-top:16px;text-align:right;">
        <button onclick="this.closest('.modal-overlay').remove()">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  // Close on Escape
  const handler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler); } };
  document.addEventListener('keydown', handler);
}

function populateAccountsSidebar() {
  const sub = document.getElementById('accounts-sub');
  if (!sub || !state.accounts.length) return;

  // Group: active self, then custody, then archived
  const groups = [
    { label: 'Own', accounts: state.accounts.filter(a => a.owner === 'self' && a.status === 'active') },
    { label: 'Custody', accounts: state.accounts.filter(a => a.owner !== 'self' && a.status === 'active') },
    { label: 'Archived', accounts: state.accounts.filter(a => a.status === 'archived') },
  ];

  let html = '';
  for (const g of groups) {
    if (!g.accounts.length) continue;
    html += `<li><span class="sub-group-label">${g.label}</span></li>`;
    for (const a of g.accounts) {
      const bal = state.balances[a.alias] || 0;
      const fmtBal = formatCurrency(bal, a.currency);
      html += `<li><a href="#account:${a.alias}" data-alias="${a.alias}">${a.alias}<span class="sub-balance">${fmtBal}</span></a></li>`;
    }
  }
  sub.innerHTML = html;

  // Wire click handlers
  sub.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const alias = a.getAttribute('data-alias');
      history.pushState(null, '', '#account:' + alias);
      navigateTo('account:' + alias);
    });
  });
}


// ─── Health Status ───────────────────────────────────────────────────────

async function loadHealthStatus() {
  const el = document.getElementById('footer-status');
  if (!el) return;

  let h;
  try {
    const res = await fetch('/api/health', { method: 'POST', signal: AbortSignal.timeout(5000) });
    if (!res.ok) { el.innerHTML = '<span class="c-mut">health n/a</span>'; return; }
    h = await res.json();
  } catch (e) {
    el.innerHTML = '<span class="c-mut">status unavailable</span>';
    return;
  }

  const parts = [];
  const dot = ' <span class="c-mut">·</span> ';

  // Server location
  if (h.is_pi) {
    parts.push('<span class="c-pos">Pi</span>');
  } else {
    parts.push('<span class="c-mut2">Local</span>');
  }

  // Git
  if (h.git_last_commit) {
    parts.push(`<span class="c-mut" title="${escapeHtml(h.git_last_commit)}">${escapeHtml(h.git_last_commit.split(' ')[0])}</span>`);
  }
  if (h.git_dirty_files > 0) {
    parts.push(`<span style="color:var(--warn)">${h.git_dirty_files} uncommitted</span>`);
  }

  // Data size
  if (h.data_size) {
    parts.push(`<span class="c-mut">${h.data_files} files · ${h.data_size}</span>`);
  }

  // Show immediately (without waiting for Pi ping)
  el.innerHTML = parts.join(dot);

  // Peer health probe in background (only when running locally and a peer
  // URL is configured in defaults.json#dev.peer_health_url). Lets a dev
  // machine check that the always-on host is alive and on the same commit.
  // Empty config (template default) skips the probe entirely.
  const peerUrl = window.DEFAULTS?.dev?.peer_health_url || '';
  if (!h.is_pi && peerUrl) {
    const piSpan = document.createElement('span');
    piSpan.className = 'c-mut';
    piSpan.textContent = ' · Pi ...';
    el.appendChild(piSpan);

    try {
      const piRes = await fetch(`${peerUrl}/api/health`, {
        method: 'POST', signal: AbortSignal.timeout(8000),
      });
      if (piRes.ok) {
        const piData = await piRes.json();
        const synced = piData.git_last_commit && h.git_last_commit &&
          piData.git_last_commit.split(' ')[0] === h.git_last_commit.split(' ')[0];
        if (synced) {
          piSpan.innerHTML = ` ${dot} <span class="c-pos">Pi synced</span>`;
        } else {
          piSpan.innerHTML = ` ${dot} <span style="color:var(--warn)" title="Pi: ${escapeHtml(piData.git_last_commit || '?')}">Pi behind</span>`;
        }
      } else {
        piSpan.innerHTML = ` ${dot} <span class="c-neg">Pi error</span>`;
      }
    } catch (e) {
      piSpan.innerHTML = ` ${dot} <span class="c-neg">Pi offline</span>`;
    }
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────

async function boot() {
  try {
    // Load feature flags + system/UX defaults + locale strings in parallel before first render.
    // Defaults overrides re-sync state values that were initialized from window.DEFAULTS placeholders.
    await Promise.all([loadFeatures(), loadDefaults(), loadSmartDefaults(), loadBranding(), loadBusinesses(), loadLocale(), loadReportsConfig()]);
    applyFeatureFlags();
    applyBranding();
    applyI18n();
    state.primaryCurrency = window.DEFAULTS.currency.primary;
    FX_API_URL = window.DEFAULTS.currency.fx_api_url;
    METALS_SPOT_API = window.DEFAULTS.currency.metals_spot_api_url;
    if (!localStorage.getItem('lp-default-currency')) {
      displayCurrency = window.SMART_DEFAULTS.ui.default_display_currency;
    }

    const loaders = [loadAllData(), loadFxRates(), loadFxHistory()];
    if (isFeatureEnabled('metals')) loaders.push(loadMetalPrices(), loadMetalsData());
    const [{ tx, accounts, categories, thirdParty }] = await Promise.all(loaders);
    state.tx = tx;
    state.accounts = accounts;
    state.categories = categories;
    state.thirdParty = thirdParty || [];
    state.balances = computeBalances(tx, accounts);

    // Load savings goals (non-blocking, falls back to empty)
    try {
      const goalsRes = await fetch('/api/goals/list', { method: 'POST' });
      state.savingsGoals = (await goalsRes.json()).goals || [];
    } catch { state.savingsGoals = []; }

    try {
      const budgetsRes = await fetch('/api/budgets/list', { method: 'POST' });
      state.budgets = (await budgetsRes.json()).budgets || [];
    } catch { state.budgets = []; }

    // Wire currency switcher
    document.querySelectorAll('#currency-switcher button').forEach(btn => {
      btn.addEventListener('click', () => {
        displayCurrency = btn.getAttribute('data-cur');
        document.querySelectorAll('#currency-switcher button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateFxInfo();
        render();
        // (sidebar accounts removed)
      });
    });
    updateFxInfo();

    // Default month: latest month with data, fallback to today
    const range = dataDateRange(tx);
    const now = new Date();
    const todayYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (range.max && range.max.slice(0, 7) < todayYM) {
      state.currentMonth = range.max.slice(0, 7);
    } else {
      state.currentMonth = todayYM;
    }

    // Meta
    document.getElementById('date-range').textContent = range.min && range.max
      ? t('common.stats.data_range', { from: range.min, to: range.max }, `Data from ${range.min} to ${range.max}`)
      : t('common.stats.no_data', {}, 'no data');
    document.getElementById('tx-count').textContent = t('common.stats.tx_count', { n: tx.length }, `${tx.length} transactions`);
    document.getElementById('footer-updated').textContent = t('common.stats.updated', { ts: new Date().toLocaleString(getLocaleTag()) }, `Updated: ${new Date().toLocaleString(getLocaleTag())}`);

    render();
    populateAccountsSidebar();
    computeAlerts();
    loadScheduledPreview();
    loadMonthForecast();
    loadHealthStatus();

    // Hash-based routing on start
    const startPage = location.hash.replace('#', '') || 'dashboard';
    navigateTo(startPage);
  } catch (err) {
    console.error(err);
    document.getElementById('dashboard').innerHTML = `
      <div class="error">
        <strong>Error loading data:</strong><br>
        ${escapeHtml(err.message)}<br><br>
        <span style="font-size:10px;">
          Dashboard requires an HTTP server (not file://). Start e.g.<br>
          <code>python -m http.server 8080</code> in repo root, then open <code>http://localhost:8080/dashboard/</code>
        </span>
      </div>
    `;
  }
}

// ─── Refresh Data ───────────────────────────────────────────────────────

async function refreshData() {
  const btn = document.getElementById('refresh-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
  try {
    const loaders = [loadAllData(), loadFxRates(), loadFxHistory()];
    if (isFeatureEnabled('metals')) loaders.push(loadMetalPrices(), loadMetalsData());
    const [{ tx, accounts, categories, thirdParty }] = await Promise.all(loaders);
    state.tx = tx;
    state.accounts = accounts;
    state.categories = categories;
    state.thirdParty = thirdParty || [];
    state.balances = computeBalances(tx, accounts);

    try {
      const goalsRes = await fetch('/api/goals/list', { method: 'POST' });
      state.savingsGoals = (await goalsRes.json()).goals || [];
    } catch { state.savingsGoals = []; }

    try {
      const budgetsRes = await fetch('/api/budgets/list', { method: 'POST' });
      state.budgets = (await budgetsRes.json()).budgets || [];
    } catch { state.budgets = []; }

    // Update meta
    const range = dataDateRange(tx);
    document.getElementById('date-range').textContent = range.min && range.max
      ? t('common.stats.data_range', { from: range.min, to: range.max }, `Data from ${range.min} to ${range.max}`)
      : t('common.stats.no_data', {}, 'no data');
    document.getElementById('tx-count').textContent = t('common.stats.tx_count', { n: tx.length }, `${tx.length} transactions`);
    document.getElementById('footer-updated').textContent = t('common.stats.updated', { ts: new Date().toLocaleString(getLocaleTag()) }, `Updated: ${new Date().toLocaleString(getLocaleTag())}`);

    updateFxInfo();
    render();
    populateAccountsSidebar();
    computeAlerts();
    loadScheduledPreview();
    loadMonthForecast();
    loadHealthStatus();

    // Re-render the currently active page
    const activePage = document.querySelector('.page.active');
    if (activePage) {
      const pageId = activePage.id.replace('page-', '');
      if (pageId !== 'dashboard') navigateTo(pageId);
    }
  } catch (err) {
    console.error('Refresh failed:', err);
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  }
}

// Wire refresh button
document.getElementById('refresh-btn')?.addEventListener('click', refreshData);

// Surgical state refresh for category flag changes (essential / pnl / active).
// Settings → Categories writes go straight to categories.csv via the API but
// don't touch the in-memory state.categories array used by reports, the
// dashboard, and the transactions page. Without this, toggling the essential
// flag would only show up in the Reports tab after a manual Refresh-button
// click. Cheaper than refreshData() because we re-load only the categories
// CSV and skip TX / accounts / FX / goals / budgets / health.
async function reloadCategories() {
  try {
    state.categories = await loadCsv(CATEGORIES_URL);
  } catch (e) {
    console.warn('reloadCategories failed:', e.message);
    return;
  }
  // Re-render the currently active page so flag changes show up immediately
  // for the (rare but possible) case that the user is on a non-Settings page
  // when this is called. Settings re-renders its own Categories tab.
  const activePage = document.querySelector('.page.active');
  if (!activePage) return;
  const pageId = activePage.id.replace('page-', '');
  if (pageId === 'dashboard') {
    if (typeof render === 'function') render();
  } else if (pageId === 'reports' && state.tx.length) {
    if (typeof destroyReportCharts === 'function') destroyReportCharts();
    if (typeof renderReportsPage === 'function') renderReportsPage();
  } else if (pageId === 'transactions' && state.tx.length) {
    if (typeof renderTransactionsPage === 'function') renderTransactionsPage();
  } else if (pageId === 'account' && typeof renderAccountPage === 'function') {
    renderAccountPage();
  }
}

