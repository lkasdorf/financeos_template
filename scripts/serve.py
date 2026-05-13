"""HTTP server for the FinanceOS Dashboard — the primary user interface.

Serves the single-page dashboard (dashboard/index.html) and provides a
REST API for all data operations. The server is designed to run always-on
on a Raspberry Pi (or locally on a dev machine) and handles both static
file serving and JSON API endpoints.

Architecture:
    - Extends Python's built-in http.server.SimpleHTTPRequestHandler
    - Static files: served from repo root with no-cache headers
    - API endpoints: all POST, routed via a simple path->handler dict
    - Data layer: delegates to tx_engine.py for all CSV read/write ops
    - Git integration: every data mutation triggers backup + git commit + push

API endpoint groups (71 endpoints total):
    /api/tx/*          Transaction CRUD (context, parse, manual, confirm, update, delete)
    /api/payees/*      Payee registry management
    /api/categories/*  Category CRUD
    /api/tags/*        Tag CRUD
    /api/scheduled/*   Scheduled/recurring transaction templates
    /api/debts/*       Debt tracking with payments
    /api/quickexp/*    Quick expense chip presets
    /api/accounts/*    Account settings and alias renaming
    /api/backup/*      Manual backup creation and listing

Usage:
    python scripts/serve.py               # Port 8080, auto-opens browser
    python scripts/serve.py --port 9090   # Custom port
    python scripts/serve.py --no-open     # Start server without opening browser
    python scripts/serve.py --bind 0.0.0.0  # Listen on all interfaces (Pi deployment)

On Windows: double-click start-dashboard.bat.
Stop: Ctrl+C in terminal.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import secrets
import socket
import sys
import threading
import time
import traceback
import webbrowser
from pathlib import Path

# ── Path Setup ──────────────────────────────────────────────────────────────
# Add scripts dir to sys.path so we can import sibling modules (tx_engine, backup)

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import auth
import backup
import fuel
import fuel_export
import fx_backfill
import receipts
import setup_core
import subscriptions
import tx_engine
import utilities
from config_loader import (
    get_auto_tags_config,
    get_default,
    get_reports_config,
    is_enabled,
    save_auto_tags_config,
    save_reports_config,
)

import re as _re

# Matches src="..." or href="..." pointing at a .js or .css file. Used to
# append a cache-busting ?v=<WIZARD_VERSION> query so a deploy invalidates
# every browser's 1-hour static-asset cache without forcing the user to
# hard-reload. The replacement skips absolute URLs (http://, https://, //,
# data:) and any path that already carries a query string.
_HTML_ASSET_RE = _re.compile(r'((?:src|href)=")([^"?]+\.(?:js|css))(")', _re.IGNORECASE)


def _inject_cache_bust(html: str, version: str) -> str:
    def repl(m):
        url = m.group(2)
        if url.startswith(("http://", "https://", "//", "data:")):
            return m.group(0)
        return f"{m.group(1)}{url}?v={version}{m.group(3)}"
    return _HTML_ASSET_RE.sub(repl, html)


# ── FX backfill job registry ────────────────────────────────────────────────
# In-memory map of job_id -> status dict. Survives across requests but not
# across server restart — that is acceptable for a feature that is normally
# either fast (a few seconds delta) or rare (multi-year seed). On restart
# the user just re-runs from Settings → Currency.

_fx_jobs: dict[str, dict] = {}
_fx_jobs_lock = threading.Lock()
_FX_JOB_TTL_SECONDS = 24 * 3600  # drop completed jobs after a day

# Sprint 7 — H-02/H-03 single-flight locks + size caps for the two big
# ZIP-export endpoints. Both are synchronous on the request handler
# thread, so a single chunky export can already starve the rest of the
# Pi for ~1 minute per 500 MB. These locks refuse parallel calls with
# HTTP 429 instead of stacking work and the caps refuse exports that
# would push the Pi past its memory budget.
_backup_export_lock = threading.Lock()
_receipts_export_lock = threading.Lock()
BACKUP_EXPORT_MAX_BYTES = 200 * 1024 * 1024     # 200 MB — covers data/ minus receipts/
RECEIPTS_EXPORT_MAX_BYTES = 500 * 1024 * 1024   # 500 MB — receipts archive can legitimately be big


def _fx_jobs_gc() -> None:
    """Drop jobs older than the TTL so the dict can't leak memory."""
    cutoff = time.time() - _FX_JOB_TTL_SECONDS
    with _fx_jobs_lock:
        for jid in list(_fx_jobs.keys()):
            if _fx_jobs[jid].get("finished_at", _fx_jobs[jid]["started_at"]) < cutoff:
                _fx_jobs.pop(jid, None)


def _fx_run_job(job_id: str, since, until) -> None:
    """Worker that runs the actual backfill and writes the result into _fx_jobs."""
    try:
        existing = fx_backfill._read_existing(fx_backfill.FX_HISTORY_PATH)
        bot_data = fx_backfill.fetch_bot_range(since, until)
        cross_data: dict = {}
        frankfurter_warning = None
        try:
            fr = fx_backfill.fetch_frankfurter_eur_to(fx_backfill.FRANKFURTER_CURRENCIES, since, until)
            cross_data = fx_backfill.derive_via_eur_cross_rate(
                fr, bot_data, fx_backfill.FRANKFURTER_CURRENCIES,
            )
        except Exception as e:
            frankfurter_warning = str(e)

        merged, new_dates, updated_dates = fx_backfill.merge(existing, bot_data, cross_data)

        if new_dates or updated_dates:
            try:
                backup.backup_file("fx_rates_history", fx_backfill.FX_HISTORY_PATH)
            except Exception:
                pass
            fx_backfill.write_csv(fx_backfill.FX_HISTORY_PATH, merged)

        with _fx_jobs_lock:
            _fx_jobs[job_id].update({
                "status": "done",
                "finished_at": time.time(),
                "new_dates": new_dates,
                "updated_dates": updated_dates,
                "total": len(merged),
                "frankfurter_warning": frankfurter_warning,
            })
    except Exception as e:
        with _fx_jobs_lock:
            _fx_jobs[job_id].update({
                "status": "error",
                "finished_at": time.time(),
                "error": str(e),
            })

# Map API paths to the feature flag that must be enabled to serve them.
FEATURE_GATED_ROUTES = {
    "/api/debts/list": "debt_tracking",
    "/api/debts/add": "debt_tracking",
    "/api/debts/update": "debt_tracking",
    "/api/debts/delete": "debt_tracking",
    "/api/debts/topup": "debt_tracking",
    "/api/debts/pay": "debt_tracking",
    "/api/debts/payments": "debt_tracking",
    "/api/recon/files": "crdb_recon",
    "/api/recon/suggestions": "crdb_recon",
    "/api/recon/adapters": "crdb_recon",
    "/api/scheduled/list": "scheduled_tx",
    "/api/scheduled/add": "scheduled_tx",
    "/api/scheduled/update": "scheduled_tx",
    "/api/scheduled/delete": "scheduled_tx",
    "/api/scheduled/preview-due": "scheduled_tx",
    "/api/scheduled/run-due": "scheduled_tx",
    "/api/quickexp/list": "quick_expenses",
    "/api/quickexp/add": "quick_expenses",
    "/api/quickexp/update": "quick_expenses",
    "/api/quickexp/delete": "quick_expenses",
    "/api/custom-reports/list": "custom_reports",
    "/api/custom-reports/add": "custom_reports",
    "/api/custom-reports/update": "custom_reports",
    "/api/custom-reports/delete": "custom_reports",
    "/api/custom-reports/duplicate": "custom_reports",
    "/api/vehicles/list": "vehicles",
    "/api/vehicles/add": "vehicles",
    "/api/vehicles/update": "vehicles",
    "/api/vehicles/delete": "vehicles",
    "/api/fuel/list": "vehicles",
    "/api/fuel/add": "vehicles",
    "/api/subscriptions/list": "subscriptions",
    "/api/subscriptions/details": "subscriptions",
    "/api/subscriptions/active_for_picker": "subscriptions",
    "/api/subscriptions/log_for_tx": "subscriptions",
    "/api/subscriptions/log_for_subscription": "subscriptions",
    "/api/subscriptions/add": "subscriptions",
    "/api/subscriptions/update": "subscriptions",
    "/api/subscriptions/delete": "subscriptions",
    "/api/fuel/update": "vehicles",
    "/api/fuel/delete": "vehicles",
    "/api/fuel/recon/dismiss": "vehicles",
    "/api/fuel/recon/undismiss": "vehicles",
    "/api/fuel/export": "vehicles",
}

REPO_ROOT = Path(__file__).resolve().parent.parent

# ── Environment Setup ───────────────────────────────────────────────────────
# Load `.env` for any FINANCEOS_* overrides shipped alongside the repo.
# Uses setdefault so real env vars take precedence over .env values.

_env_path = REPO_ROOT / ".env"
if _env_path.exists():
    for line in _env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

# System defaults loaded from config/defaults.json with hardcoded fallbacks.
# Restart required to pick up changes (lru_cache in config_loader).
def _read_app_version() -> str:
    """Extract the footer version (e.g. ``v2026-05-01.1``) from
    ``dashboard/index.html``. Used by ``/api/health`` and consumed by
    the PWA service worker to bust its shell cache when a new version
    ships. Falls back to ``unknown`` so missing footer never breaks
    the health endpoint.
    """
    import re
    idx = REPO_ROOT / "dashboard" / "index.html"
    try:
        text = idx.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r"v\d{4}-\d{2}-\d{2}(?:\.\d+)?", text)
        return m.group(0) if m else "unknown"
    except OSError:
        return "unknown"


DEFAULT_PORT = get_default("server.default_port", 8080)
DEFAULT_BIND = get_default("server.default_bind", "127.0.0.1")
DASHBOARD_PATH = get_default("server.dashboard_path", "/dashboard/")

# CORS allow-list. Replaces the previous wildcard `Access-Control-Allow-Origin: *`,
# which combined with `mode: none` auth (LAN/Tailscale default) would hand
# any page on the internet read access to the dashboard JSON. Same-origin
# requests don't send an Origin header and are unaffected. Override at
# startup via env FINANCEOS_CORS_HOSTS=host1,host2 if a new device joins
# the trusted Pi LAN.
# M-S7 (Sprint 16) — `localhost` + `127.0.0.1` stay in the default allowlist
# because the dev workflow opens the dashboard at http://localhost:8080.
# In production / Pi the binding is to LAN/Tailscale interfaces and the
# operator should drop these two via the env override (which replaces the
# whole list, doesn't extend it):
#   FINANCEOS_CORS_HOSTS=192.168.1.10,100.x.x.x,your-host,your-host.local
# Without that, a malicious page served from any other localhost server
# could drive cross-origin reads of the dashboard JSON.
_DEFAULT_CORS_HOSTS = (
    "localhost",
    "127.0.0.1",
    # "192.168.1.10",   # Add your Pi LAN IP here
    # "100.x.x.x",       # Add your Tailscale IP here
    # "your-host",       # Add your Pi hostname here
    # "your-host.local",
)


def _cors_allowed_hosts() -> tuple[str, ...]:
    env = os.environ.get("FINANCEOS_CORS_HOSTS")
    if env:
        return tuple(h.strip() for h in env.split(",") if h.strip())
    return _DEFAULT_CORS_HOSTS


class FinanceOSHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP request handler: tiered cache + JSON API endpoints.

    Extends SimpleHTTPRequestHandler to:
    1. Tier browser caching by path (libs long, app JS/CSS short, data/API none)
    2. Add CORS headers (dashboard may be loaded from different origins)
    3. Route POST requests to API handler methods
    """

    # Speak HTTP/1.1 so the browser can reuse one TCP connection for many
    # requests (12 scripts + CSS + /api POSTs). Over Tailscale with ~300 ms
    # RTT this removes the per-request handshake. Requires every response
    # to carry Content-Length (SimpleHTTPRequestHandler already does that
    # for static files; _respond_json sets it explicitly; do_OPTIONS now
    # sends Content-Length: 0).
    protocol_version = "HTTP/1.1"

    # Per-connection socket timeout. StreamRequestHandler.setup() reads
    # this and calls self.connection.settimeout(timeout), so a Slow-Loris
    # client that dribbles bytes cannot pin a worker thread forever — the
    # socket raises after 30 s of inactivity and the request thread exits.
    # Tuned high enough that legitimate Pi-over-Tailscale request bursts
    # (~300 ms RTT, occasional payloads) stay well clear.
    timeout = 30

    _STATIC_EXTS = (".js", ".css", ".woff", ".woff2", ".ttf", ".otf",
                    ".svg", ".png", ".jpg", ".jpeg", ".ico", ".webp")

    def _cache_policy_for_path(self, path: str) -> str:
        """Pick a Cache-Control header based on the request path.

        Third-party libs rarely change, so they get 7 days. App JS/CSS/fonts
        get 1 hour so a reload during a work session doesn't re-download
        ~1.4 MB, while deploys still become visible within the hour (or with
        a hard refresh). HTML, /data/* and /api/* stay no-store so CSV
        mutations are always instant.
        """
        p = path.split("?", 1)[0].split("#", 1)[0]

        if p.startswith("/dashboard/lib/"):
            return "public, max-age=604800"  # 7 days

        if (p.startswith("/dashboard/") or p.startswith("/pwa/")) \
                and p.endswith(self._STATIC_EXTS):
            return "public, max-age=3600"  # 1 hour

        return "no-store, no-cache, must-revalidate, max-age=0"

    def end_headers(self):
        """Inject cache headers based on request path (see _cache_policy_for_path)."""
        policy = self._cache_policy_for_path(self.path)
        self.send_header("Cache-Control", policy)
        if "no-store" in policy:
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        """Override default logging to use a cleaner format."""
        sys.stderr.write(f"  {self.address_string()} - {format % args}\n")

    def do_GET(self):
        """Serve static files, but block feature-gated paths when disabled."""
        # Block F: Basic-Auth gate. No-op when auth.json is missing or
        # mode='none', so the private repo behaves as before. Exempts
        # /api/health and (when uninitialized) the setup wizard assets
        # so a fresh install can still reach the wizard.
        if not auth.check_request(self):
            return
        # Block the PWA entry point and all its assets if the feature is off.
        if self.path.startswith("/pwa") and not is_enabled("pwa"):
            self.send_error(404, "PWA feature disabled")
            return
        # Block the CRDB reconciliation data tree (XLS + JSON + MD reports).
        if self.path.startswith("/data/crdb_data") and not is_enabled("crdb_recon"):
            self.send_error(404, "CRDB reconciliation disabled")
            return
        # Cache-bust JS/CSS asset references in HTML responses. The browser
        # caches /dashboard/*.{js,css} for 1 hour (see _cache_policy_for_path),
        # so a deploy that ships a new setup.js wouldn't reach the user until
        # the cache expired or they hard-reloaded. Appending ?v=<WIZARD_VERSION>
        # to every script/link reference in the served HTML changes the URL
        # on each release and forces a fresh fetch.
        if self._serve_html_with_cache_bust():
            return
        # Block the metals data files so the dashboard can't load them either.
        if (self.path.startswith("/data/metals_portfolio")
                or self.path.startswith("/data/metal_price_history")) and not is_enabled("metals"):
            self.send_error(404, "Metals feature disabled")
            return
        super().do_GET()

    def _serve_html_with_cache_bust(self) -> bool:
        """Serve an HTML file with ?v=<WIZARD_VERSION> appended to every
        script/link reference. Returns True if the request was handled.

        Only triggers for paths that resolve to an .html file (or a directory
        whose index.html exists). All other paths fall through to the normal
        static handler.
        """
        # Strip query/fragment, decode, and let the parent class translate
        # the URL to a filesystem path via its standard rules.
        try:
            from urllib.parse import unquote
            url_path = self.path.split("?", 1)[0].split("#", 1)[0]
            fs_path = self.translate_path(unquote(url_path))
        except Exception:
            return False

        path_obj = Path(fs_path)
        if path_obj.is_dir():
            # 2026-05-13 hotfix — directory hits without a trailing slash
            # (`/dashboard` instead of `/dashboard/`) used to fall through
            # to serving index.html at the un-slashed URL, which broke
            # every relative CSS/JS reference (`href="styles.css"` resolves
            # to `/styles.css` against `/dashboard`). SimpleHTTPRequestHandler
            # sends a 301 here, but we short-circuit it; replicate the
            # redirect ourselves so behind-a-proxy clients (Tailscale
            # Serve, Caddy) land on the canonical URL.
            if not url_path.endswith("/"):
                new_path = url_path + "/"
                try:
                    self.send_response(301)
                    self.send_header("Location", new_path)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return True
            path_obj = path_obj / "index.html"
        if not path_obj.is_file() or path_obj.suffix.lower() != ".html":
            return False
        # M-S1 (Sprint 16) — defense-in-depth jail-check. translate_path is
        # already safe against path traversal from URL components, but a
        # symlink inside REPO_ROOT pointing outside it could let cache-bust
        # serve arbitrary HTML from disk. Resolve to absolute and require
        # the result to live under REPO_ROOT.
        try:
            resolved = path_obj.resolve()
        except OSError:
            return False
        try:
            resolved.relative_to(REPO_ROOT)
        except ValueError:
            return False

        try:
            html = path_obj.read_text(encoding="utf-8")
        except OSError:
            return False

        rewritten = _inject_cache_bust(html, setup_core.WIZARD_VERSION).encode("utf-8")
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(rewritten)))
            self.end_headers()
            self.wfile.write(rewritten)
        except (BrokenPipeError, ConnectionResetError):
            pass  # client disconnected
        return True

    # ── CORS ─────────────────────────────────────────────────────────────

    def _send_cors_origin(self):
        """Echo the request Origin only when its host is allow-listed.

        Same-origin requests don't carry an Origin header and need no
        ACAO header at all. Cross-origin requests get ACAO + Vary:Origin
        only when the origin's hostname matches :data:`_DEFAULT_CORS_HOSTS`
        (or the env override). Anything else gets no header and the
        browser refuses the read — which is the goal: combined with
        `mode: none` auth, a wildcard ACAO would let any internet page
        siphon dashboard JSON.
        """
        origin = self.headers.get("Origin")
        if not origin:
            return
        try:
            from urllib.parse import urlparse
            host = (urlparse(origin).hostname or "").lower()
        except Exception:
            return
        if host in _cors_allowed_hosts():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _check_csrf(self) -> bool:
        """Block cross-origin browser CSRF attacks before any handler runs.

        Browser POSTs always carry an Origin header. A malicious page on
        evil.com that triggers a same-origin-credentialled POST to e.g.
        /api/tx/delete (auto-attached Basic auth or sessionless setup
        wizard) would land here with ``Origin: https://evil.com``. The
        browser blocks the *response* via CORS but the *side-effect*
        (delete TX, rename account, finalize wizard) already happened
        before the response goes out. So the only safe place to refuse
        is BEFORE dispatch.

        Decision matrix:
            - Origin missing → allow (CLI tool, curl, Pi cron — these
              don't share a browser session and aren't CSRF vectors).
            - Origin host matches :func:`_cors_allowed_hosts` → allow
              (same-origin browser or explicitly trusted host).
            - Origin host doesn't match → reject 403.

        Caller is expected to skip the check for /api/health (monitoring
        ping that must answer cross-origin so external uptime checkers
        work) — every other POST goes through this gate.

        Returns True if the request can proceed.
        """
        origin = self.headers.get("Origin", "")
        if not origin:
            return True
        from urllib.parse import urlparse
        try:
            host = (urlparse(origin).hostname or "").lower()
        except (ValueError, AttributeError):
            host = ""
        # Same-origin: the Origin's hostname matches the request's Host
        # header. Allow regardless of whether the hostname is in the
        # CORS allowlist — by definition the browser only sent this
        # request because the page itself is hosted on that origin, so
        # there's no third-party CSRF risk. Catches deployments via
        # Tailscale MagicDNS (your-host.tailnet.ts.net), Cloudflare
        # Tunnel, ngrok, custom domains etc. without forcing the
        # operator to extend FINANCEOS_CORS_HOSTS for every new
        # hostname they ever access the dashboard from.
        request_host = (self.headers.get("Host", "").split(":", 1)[0] or "").lower()
        if host and request_host and host == request_host:
            return True
        if host and host in _cors_allowed_hosts():
            return True
        # Log the rejection so operators see attack attempts; don't echo
        # any request body (could contain attacker-supplied junk).
        try:
            print(
                f"[csrf] reject POST {self.path} from Origin={origin!r}",
                file=sys.stderr,
            )
        except Exception:
            pass
        body = json.dumps({"error": "cross-origin request rejected"}).encode("utf-8")
        self.send_response(403)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass
        return False

    def do_OPTIONS(self):
        """Handle CORS preflight requests (needed for cross-origin API calls)."""
        self.send_response(200)
        self._send_cors_origin()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Empty body — HTTP/1.1 keep-alive needs an explicit Content-Length.
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ── Helpers ──────────────────────────────────────────────────────────

    def _read_json_body(self) -> dict:
        """Parse the POST request body as JSON.

        Reads from ``self._raw_body`` which ``do_POST`` populates up front —
        the body is drained from the socket before dispatch so handlers that
        ignore the body don't leak unconsumed bytes into the next request on
        a keep-alive connection (which would manifest as the next request's
        method getting prefixed with the leftover bytes, e.g. ``'{}POST'``
        -> 501 "Unsupported method").

        Returns:
            Parsed dict from JSON body, or empty dict if no body.
        """
        raw = getattr(self, "_raw_body", b"")
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _respond_json(self, status: int, data: dict):
        """Send a JSON response with CORS headers.

        Args:
            status: HTTP status code (200, 400, 404, 500, etc.)
            data: Dict to serialize as JSON response body.
        """
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._send_cors_origin()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ── POST Router ──────────────────────────────────────────────────────

    def do_POST(self):
        """Route POST requests to the appropriate API handler method."""
        # Block F: Basic-Auth gate (see do_GET for details).
        if not auth.check_request(self):
            return
        # Drain the request body up front so handlers that ignore it (e.g.
        # /api/custom-reports/list) don't leave bytes in the socket. On
        # HTTP/1.1 keep-alive connections, leftover body bytes prefix the
        # NEXT request's method line — surfaced as "Unsupported method
        # ('{}POST')" 501 errors when a /list call sent {body: '{}'} was
        # followed by an /add or /delete on the same connection. _read_json_body
        # now parses from self._raw_body instead of touching self.rfile, so
        # the read order is fully decoupled from handler logic.
        try:
            content_length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            content_length = 0
        # L-S3 (Sprint 23) — a negative or absurdly-large Content-Length
        # used to be coerced to 0 silently, which on keep-alive
        # connections could leak the actual body bytes into the next
        # request's parse. Now we reject explicitly with 400.
        if content_length < 0:
            self._respond_json(400, {"error": "Content-Length must be non-negative"})
            return
        # L-S2 (Sprint 23) — hard cap on request body so a malicious
        # `Content-Length: 5000000000` doesn't try to read 5 GB into
        # RAM. 60 MB covers the receipts-upload path (5 files × 10 MB
        # cap inside receipts.py, plus multipart overhead). Anything
        # bigger gets rejected before we touch self.rfile.
        MAX_BODY_BYTES = 60 * 1024 * 1024
        if content_length > MAX_BODY_BYTES:
            self._respond_json(413, {
                "error": "Request body too large",
                "limit_bytes": MAX_BODY_BYTES,
            })
            return
        self._raw_body = self.rfile.read(content_length) if content_length > 0 else b""
        # CSRF gate (C-06 from CODE_REVIEW_2026-05-12). All /api/* POSTs
        # except /api/health (monitoring exempt) must come from a
        # browser whose Origin is in the CORS allowlist, or from a
        # non-browser client that doesn't send Origin at all.
        bare_path = self.path.split("?", 1)[0]
        if bare_path != "/api/health" and not self._check_csrf():
            return
        routes = {
            "/api/tx/context": self.handle_tx_context,
            "/api/tx/manual": self.handle_tx_manual,
            "/api/tx/confirm": self.handle_tx_confirm,
            "/api/tx/update": self.handle_tx_update,
            "/api/tx/delete": self.handle_tx_delete,
            "/api/tx/batch-delete": self.handle_tx_batch_delete,
            "/api/tx/batch-tag": self.handle_tx_batch_tag,
            "/api/payees/list": self.handle_payees_list,
            "/api/payees/add": self.handle_payees_add,
            "/api/payees/update": self.handle_payees_update,
            "/api/payees/delete": self.handle_payees_delete,
            "/api/categories/list": self.handle_categories_list,
            "/api/categories/add": self.handle_categories_add,
            "/api/categories/update": self.handle_categories_update,
            "/api/tags/list": self.handle_tags_list,
            "/api/tags/add": self.handle_tags_add,
            "/api/tags/update": self.handle_tags_update,
            "/api/tags/delete": self.handle_tags_delete,
            "/api/scheduled/list": self.handle_scheduled_list,
            "/api/scheduled/add": self.handle_scheduled_add,
            "/api/scheduled/update": self.handle_scheduled_update,
            "/api/scheduled/delete": self.handle_scheduled_delete,
            "/api/scheduled/preview-due": self.handle_scheduled_preview_due,
            "/api/scheduled/run-due": self.handle_scheduled_run_due,
            "/api/debts/list": self.handle_debts_list,
            "/api/debts/add": self.handle_debts_add,
            "/api/debts/update": self.handle_debts_update,
            "/api/debts/delete": self.handle_debts_delete,
            "/api/debts/topup": self.handle_debts_topup,
            "/api/debts/pay": self.handle_debts_pay,
            "/api/debts/payments": self.handle_debts_payments,
            "/api/quickexp/list": self.handle_quickexp_list,
            "/api/quickexp/add": self.handle_quickexp_add,
            "/api/quickexp/update": self.handle_quickexp_update,
            "/api/quickexp/delete": self.handle_quickexp_delete,
            "/api/atm-fees/list": self.handle_atm_fees_list,
            "/api/atm-fees/add": self.handle_atm_fees_add,
            "/api/atm-fees/update": self.handle_atm_fees_update,
            "/api/atm-fees/delete": self.handle_atm_fees_delete,
            "/api/custom-reports/list": self.handle_custom_reports_list,
            "/api/custom-reports/add": self.handle_custom_reports_add,
            "/api/custom-reports/update": self.handle_custom_reports_update,
            "/api/custom-reports/delete": self.handle_custom_reports_delete,
            "/api/custom-reports/duplicate": self.handle_custom_reports_duplicate,
            "/api/budgets/list": self.handle_budgets_list,
            "/api/budgets/add": self.handle_budgets_add,
            "/api/budgets/update": self.handle_budgets_update,
            "/api/budgets/delete": self.handle_budgets_delete,
            "/api/goals/list": self.handle_goals_list,
            "/api/goals/add": self.handle_goals_add,
            "/api/goals/update": self.handle_goals_update,
            "/api/goals/delete": self.handle_goals_delete,
            "/api/accounts/add": self.handle_accounts_add,
            "/api/accounts/update": self.handle_accounts_update,
            "/api/accounts/rename": self.handle_accounts_rename,
            "/api/backup/create": self.handle_backup_create,
            "/api/backup/list": self.handle_backup_list,
            "/api/backup/export": self.handle_backup_export,
            "/api/recon/files": self.handle_recon_files,
            "/api/recon/suggestions": self.handle_recon_suggestions,
            "/api/recon/adapters": self.handle_recon_adapters,
            "/api/vehicles/list": self.handle_vehicles_list,
            "/api/vehicles/add": self.handle_vehicles_add,
            "/api/vehicles/update": self.handle_vehicles_update,
            "/api/vehicles/delete": self.handle_vehicles_delete,
            "/api/fuel/list": self.handle_fuel_list,
            "/api/fuel/add": self.handle_fuel_add,
            "/api/fuel/update": self.handle_fuel_update,
            "/api/fuel/delete": self.handle_fuel_delete,
            "/api/fuel/recon/dismiss": self.handle_fuel_recon_dismiss,
            "/api/fuel/recon/undismiss": self.handle_fuel_recon_undismiss,
            "/api/fuel/export": self.handle_fuel_export,
            "/api/properties/list": self.handle_properties_list,
            "/api/properties/details": self.handle_properties_details,
            "/api/properties/cost_overview": self.handle_properties_cost_overview,
            "/api/properties/excel": self.handle_properties_excel,
            "/api/properties/alerts": self.handle_properties_alerts,
            "/api/properties/add": self.handle_properties_add,
            "/api/properties/update": self.handle_properties_update,
            "/api/properties/delete": self.handle_properties_delete,
            "/api/properties/luku/add": self.handle_luku_add,
            "/api/properties/luku/update": self.handle_luku_update,
            "/api/properties/luku/delete": self.handle_luku_delete,
            "/api/properties/water/add": self.handle_water_add,
            "/api/properties/water/update": self.handle_water_update,
            "/api/properties/water/delete": self.handle_water_delete,
            "/api/subscriptions/list": self.handle_subscriptions_list,
            "/api/subscriptions/details": self.handle_subscriptions_details,
            "/api/subscriptions/active_for_picker": self.handle_subscriptions_picker,
            "/api/subscriptions/log_for_tx": self.handle_subscriptions_log_for_tx,
            "/api/subscriptions/log_for_subscription": self.handle_subscriptions_log_for_subscription,
            "/api/subscriptions/drift_alerts": self.handle_subscriptions_drift_alerts,
            "/api/subscriptions/add": self.handle_subscriptions_add,
            "/api/subscriptions/update": self.handle_subscriptions_update,
            "/api/subscriptions/delete": self.handle_subscriptions_delete,
            "/api/setup/status": self.handle_setup_status,
            "/api/setup/mmex-upload": self.handle_setup_mmex_upload,
            "/api/setup/finalize": self.handle_setup_finalize,
            "/api/reports-config/get": self.handle_reports_config_get,
            "/api/reports-config/save": self.handle_reports_config_save,
            "/api/auto-tags/get": self.handle_auto_tags_get,
            "/api/auto-tags/save": self.handle_auto_tags_save,
            "/api/auto-tags/backfill-prefix": self.handle_auto_tags_backfill_prefix,
            "/api/fx/backfill": self.handle_fx_backfill,
            "/api/fx/backfill/status": self.handle_fx_backfill_status,
            "/api/branding/get": self.handle_branding_get,
            "/api/branding/save": self.handle_branding_save,
            "/api/health": self.handle_health,
            "/api/metals/spot": self.handle_metals_spot,
            # v1.6.0 receipt attachments (Photos + PDFs on transactions).
            "/api/receipts/upload": self.handle_receipts_upload,
            "/api/receipts/delete": self.handle_receipts_delete,
            "/api/receipts/stats": self.handle_receipts_stats,
            "/api/receipts/export": self.handle_receipts_export,
        }
        # Feature-flag gate: refuse API calls for disabled features.
        gate = FEATURE_GATED_ROUTES.get(self.path)
        if gate and not is_enabled(gate):
            self._respond_json(404, {"error": f"feature '{gate}' disabled"})
            return

        handler = routes.get(self.path)
        if handler:
            try:
                handler()
            except BrokenPipeError:
                pass  # client disconnected before response was sent
            except Exception as e:
                # Don't leak Python internals (file paths, exception types,
                # stack traces) to the client. Log full detail server-side
                # under a short request ID, give the client just the ID so
                # support can correlate without a public crash dump.
                req_id = secrets.token_hex(4)
                print(
                    f"[serve] 500 req={req_id} path={self.path} {type(e).__name__}: {e}",
                    file=sys.stderr,
                )
                traceback.print_exc(file=sys.stderr)
                try:
                    self._respond_json(500, {
                        "error": "Internal server error",
                        "request_id": req_id,
                    })
                except BrokenPipeError:
                    pass
        else:
            self._respond_json(404, {"error": f"Unknown endpoint: {self.path}"})

    # ── API: /api/tx/context ─────────────────────────────────────────────

    def handle_tx_context(self):
        """Return account, category, tag, and payee lists for dashboard dropdowns.

        This is the first API call the dashboard makes on load — it provides
        all reference data needed to populate form selects and autocomplete.
        """
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()

        acc_list = []
        for alias, acc in sorted(accounts.items()):
            acc_list.append({
                "alias": alias,
                "name": acc["name"],
                "currency": acc["currency"],
                "type": acc["type"],
                "owner": acc["owner"],
                "status": acc["status"],
                "pass_through_payee": acc.get("pass_through_payee", ""),
                "initial_balance": acc.get("initial_balance", ""),
                "initial_balance_date": acc.get("initial_balance_date", ""),
                "notes": acc.get("notes", ""),
                "include_in_net_worth": acc.get("include_in_net_worth", ""),
            })

        cat_list = []
        for path, cat in sorted(categories.items()):
            cat_list.append({
                "path": path,
                "type": cat["type"],
                "active": cat.get("active", "true") == "true",
            })

        tags = tx_engine.load_tags()
        tag_list = [{"tag": t["tag"], "description": t.get("description", ""), "active": t.get("active", "true") == "true"} for t in tags]

        payees = tx_engine.load_payees()
        payee_list = [{"payee": p["payee"], "aliases": p.get("aliases", []), "default_category": p.get("default_category", ""), "default_account": p.get("default_account", "")} for p in payees]

        self._respond_json(200, {"accounts": acc_list, "categories": cat_list, "tags": tag_list, "payees": payee_list})

    # ── API: /api/tx/manual ──────────────────────────────────────────────

    def handle_tx_manual(self):
        """Build TX preview from structured form data.

        Used by the Add-TX page in the dashboard. Handles single lines,
        receipt splits, and pass-through counter-entries automatically.
        """
        body = self._read_json_body()
        result = tx_engine.build_manual_lines(body)
        if "error" in result:
            self._respond_json(400, result)
        else:
            self._respond_json(200, result)

    # ── API: /api/tx/confirm ─────────────────────────────────────────────

    def handle_tx_confirm(self):
        """Write confirmed transaction lines to CSV.

        This is the critical write path. The sequence is:
        1. Validate all lines against accounts/categories
        2. Log to prompt_log.csv (audit trail, offline queue)
        3. Backup transactions.csv (mandatory before any write)
        4. Append lines to transactions.csv
        5. Mark prompt as booked
        6. Auto-learn unknown payees into payees.json
        7. Git commit + push all changed files
        """
        body = self._read_json_body()
        lines = body.get("lines", [])
        raw_input = body.get("raw_input", "(manual)")

        if not lines:
            self._respond_json(400, {"error": "No lines to confirm"})
            return

        # Validate all user-created lines (skip auto-generated counter-entries)
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        errors = []
        for i, line in enumerate(lines):
            if line.get("is_auto_generated"):
                continue
            errs = tx_engine.validate_line(line, accounts, categories)
            if errs:
                errors.extend([f"Line {i+1}: {e}" for e in errs])

        if errors:
            self._respond_json(400, {"error": "; ".join(errors)})
            return

        # Log raw input to prompt_log for audit trail and offline queue recovery
        prompt_id = tx_engine.log_to_prompt_log(raw_input, json.dumps(lines, ensure_ascii=False))

        # Mandatory backup before writing (hard rule from CLAUDE.md)
        try:
            backup.backup_file("transactions", tx_engine.DATA_DIR / "transactions.csv")
        except Exception as e:
            self._respond_json(500, {"error": f"Backup failed: {e}"})
            return

        # Pre-scan for subscription links so we can back up the log
        # before the first write touches anything. Lines with
        # subscription_id are user-created (not auto-generated), so the
        # link only flows from the original expense, never from the
        # pass-through reimbursement counter-entry.
        sub_links = [
            l for l in lines
            if l.get("subscription_id") and not l.get("is_auto_generated")
        ]
        if sub_links:
            try:
                backup.backup_file(
                    "subscription_log",
                    tx_engine.DATA_DIR / "subscription_log.csv",
                )
            except Exception as e:
                self._respond_json(500, {
                    "error": f"subscription_log backup failed: {e}",
                })
                return

        # Append to transactions.csv
        try:
            tx_engine.append_transactions(lines)
        except Exception as e:
            self._respond_json(500, {"error": f"CSV write failed: {e}"})
            return

        # Mark the prompt_log entry as successfully booked
        tx_engine.mark_prompt_booked(prompt_id)

        # Mirror linked charges into subscription_log. Failures here
        # are logged but do NOT roll the TX back — the user can re-link
        # via the Edit-TX modal if a write breaks. Same trade-off as
        # auto_learn_payees below.
        sub_log_written = []
        for line in sub_links:
            try:
                log_id = subscriptions.append_subscription_log({
                    "date": line.get("date", ""),
                    "subscription_id": line.get("subscription_id", ""),
                    "amount": line.get("amount", ""),
                    "currency": line.get("currency", ""),
                    "account": line.get("account", ""),
                    "tx_import_id": line.get("import_id", ""),
                    "note": "",
                })
                sub_log_written.append(log_id)
            except Exception as exc:
                print(
                    f"[serve] subscription_log link failed for "
                    f"{line.get('import_id', '')}: {exc}",
                    file=sys.stderr,
                )

        # Auto-learn unknown payees for future autocomplete/defaults
        learned = tx_engine.auto_learn_payees(lines)

        # Git commit — include payees.json only if new payees were learned
        payees = [l.get("payee", "") for l in lines if l.get("payee") and not l.get("is_auto_generated")]
        summary = ", ".join(payees[:3]) or "manual entry"
        n_lines = len([l for l in lines if not l.get("is_auto_generated")])
        commit_msg = f"TX: {n_lines} Buchung{'en' if n_lines != 1 else ''} ({summary})"
        files = ["data/transactions.csv", "data/prompt_log.csv"]
        if learned:
            files.append("data/payees.json")
        if sub_log_written:
            files.append("data/subscription_log.csv")
        git_ok = tx_engine.git_commit(commit_msg, files=files)

        import_ids = [l["import_id"] for l in lines]
        msg = f"{len(lines)} transaction{'s' if len(lines) != 1 else ''} booked"
        if learned:
            msg += f" · New payee{'s' if len(learned) > 1 else ''}: {', '.join(learned)}"
        self._respond_json(200, {
            "success": True,
            "import_ids": import_ids,
            "message": msg,
            "git_committed": git_ok,
            "learned_payees": learned,
        })


    # ── API: Payees ──────────────────────────────────────────────────

    def handle_payees_list(self):
        """Return all payees from payees.json."""
        self._respond_json(200, {"payees": tx_engine.load_payees()})

    def handle_payees_add(self):
        """Add a new payee to payees.json with auto-generated slug ID."""
        body = self._read_json_body()
        if not body.get("payee"):
            self._respond_json(400, {"error": "payee name is required"})
            return
        pid = tx_engine.add_payee(body)
        tx_engine.git_commit(f"Payee add: {body['payee']}", ["data/payees.json"])
        self._respond_json(200, {"success": True, "id": pid})

    def handle_payees_update(self):
        """Update an existing payee's fields by its slug ID."""
        body = self._read_json_body()
        pid = body.get("id", "")
        updated = body.get("updated", {})
        if not pid:
            self._respond_json(400, {"error": "id is required"})
            return
        if not tx_engine.update_payee(pid, updated):
            self._respond_json(404, {"error": f"Payee '{pid}' not found"})
            return
        tx_engine.git_commit(f"Payee edit: {pid}", ["data/payees.json"])
        self._respond_json(200, {"success": True})

    def handle_payees_delete(self):
        """Remove a payee from payees.json by its slug ID."""
        body = self._read_json_body()
        pid = body.get("id", "")
        if not pid:
            self._respond_json(400, {"error": "id is required"})
            return
        if not tx_engine.delete_payee(pid):
            self._respond_json(404, {"error": f"Payee '{pid}' not found"})
            return
        tx_engine.git_commit(f"Payee delete: {pid}", ["data/payees.json"])
        self._respond_json(200, {"success": True})

    # ── API: Custom Reports ──────────────────────────────────────────

    def handle_custom_reports_list(self):
        """Return all stored custom report definitions."""
        self._respond_json(200, {"reports": tx_engine.load_custom_reports()})

    def handle_custom_reports_add(self):
        """Create a new custom report definition. Body: full definition (no id)."""
        body = self._read_json_body()
        try:
            entry = tx_engine.add_custom_report(body)
        except ValueError as e:
            self._respond_json(400, {"error": str(e)})
            return
        tx_engine.git_commit(
            f"Custom report add: {entry['name']}", ["data/custom_reports.json"]
        )
        self._respond_json(200, {"success": True, "report": entry})

    def handle_custom_reports_update(self):
        """Update an existing custom report. Body: {id, updated: {...partial...}}."""
        body = self._read_json_body()
        rid = body.get("id", "")
        updated = body.get("updated", {})
        if not rid:
            self._respond_json(400, {"error": "id is required"})
            return
        try:
            entry = tx_engine.update_custom_report(rid, updated)
        except ValueError as e:
            self._respond_json(400, {"error": str(e)})
            return
        if entry is None:
            self._respond_json(404, {"error": f"Custom report '{rid}' not found"})
            return
        tx_engine.git_commit(
            f"Custom report edit: {entry['name']}", ["data/custom_reports.json"]
        )
        self._respond_json(200, {"success": True, "report": entry})

    def handle_custom_reports_delete(self):
        """Delete a custom report by id."""
        body = self._read_json_body()
        rid = body.get("id", "")
        if not rid:
            self._respond_json(400, {"error": "id is required"})
            return
        if not tx_engine.delete_custom_report(rid):
            self._respond_json(404, {"error": f"Custom report '{rid}' not found"})
            return
        tx_engine.git_commit(
            f"Custom report delete: {rid}", ["data/custom_reports.json"]
        )
        self._respond_json(200, {"success": True})

    def handle_custom_reports_duplicate(self):
        """Duplicate a custom report. Body: {id, name?: optional new name}."""
        body = self._read_json_body()
        rid = body.get("id", "")
        new_name = body.get("name")
        if not rid:
            self._respond_json(400, {"error": "id is required"})
            return
        entry = tx_engine.duplicate_custom_report(rid, new_name)
        if entry is None:
            self._respond_json(404, {"error": f"Custom report '{rid}' not found"})
            return
        tx_engine.git_commit(
            f"Custom report duplicate: {entry['name']}", ["data/custom_reports.json"]
        )
        self._respond_json(200, {"success": True, "report": entry})

    # ── API: Budgets ─────────────────────────────────────────────────

    def handle_budgets_list(self):
        """Return all budgets."""
        self._respond_json(200, {"budgets": tx_engine.load_budgets()})

    def handle_budgets_add(self):
        """Add a new budget rule."""
        body = self._read_json_body()
        if not body.get("category"):
            self._respond_json(400, {"error": "category is required"})
            return
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        errors = tx_engine.validate_budget(body, accounts, categories)
        if errors:
            self._respond_json(400, {"errors": errors})
            return
        bid = tx_engine.add_budget(body)
        tx_engine.git_commit(f"Budget add: {body['category']}", ["data/budgets.json"])
        self._respond_json(200, {"success": True, "id": bid})

    def handle_budgets_update(self):
        """Update an existing budget."""
        body = self._read_json_body()
        bid = body.get("id", "")
        updated = body.get("updated", {})
        if not bid:
            self._respond_json(400, {"error": "id is required"})
            return
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        errors = tx_engine.validate_budget(updated, accounts, categories)
        if errors:
            self._respond_json(400, {"errors": errors})
            return
        if not tx_engine.update_budget(bid, updated):
            self._respond_json(404, {"error": f"Budget '{bid}' not found"})
            return
        tx_engine.git_commit(f"Budget edit: {bid}", ["data/budgets.json"])
        self._respond_json(200, {"success": True})

    def handle_budgets_delete(self):
        """Delete a budget."""
        body = self._read_json_body()
        bid = body.get("id", "")
        if not bid:
            self._respond_json(400, {"error": "id is required"})
            return
        if not tx_engine.delete_budget(bid):
            self._respond_json(404, {"error": f"Budget '{bid}' not found"})
            return
        tx_engine.git_commit(f"Budget delete: {bid}", ["data/budgets.json"])
        self._respond_json(200, {"success": True})

    # ── API: Savings Goals ───────────────────────────────────────────

    def handle_goals_list(self):
        """Return all savings goals."""
        self._respond_json(200, {"goals": tx_engine.load_savings_goals()})

    def handle_goals_add(self):
        """Add a new savings goal."""
        body = self._read_json_body()
        if not body.get("name"):
            self._respond_json(400, {"error": "name is required"})
            return
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        errors = tx_engine.validate_savings_goal(body, accounts, categories)
        if errors:
            self._respond_json(400, {"errors": errors})
            return
        gid = tx_engine.add_savings_goal(body)
        tx_engine.git_commit(f"Goal add: {body['name']}", ["data/savings_goals.json"])
        self._respond_json(200, {"success": True, "id": gid})

    def handle_goals_update(self):
        """Update an existing savings goal."""
        body = self._read_json_body()
        gid = body.get("id", "")
        updated = body.get("updated", {})
        if not gid:
            self._respond_json(400, {"error": "id is required"})
            return
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        errors = tx_engine.validate_savings_goal(updated, accounts, categories)
        if errors:
            self._respond_json(400, {"errors": errors})
            return
        if not tx_engine.update_savings_goal(gid, updated):
            self._respond_json(404, {"error": f"Goal '{gid}' not found"})
            return
        tx_engine.git_commit(f"Goal edit: {gid}", ["data/savings_goals.json"])
        self._respond_json(200, {"success": True})

    def handle_goals_delete(self):
        """Delete a savings goal."""
        body = self._read_json_body()
        gid = body.get("id", "")
        if not gid:
            self._respond_json(400, {"error": "id is required"})
            return
        if not tx_engine.delete_savings_goal(gid):
            self._respond_json(404, {"error": f"Goal '{gid}' not found"})
            return
        tx_engine.git_commit(f"Goal delete: {gid}", ["data/savings_goals.json"])
        self._respond_json(200, {"success": True})

    # ── API: Categories ──────────────────────────────────────────────

    def handle_categories_list(self):
        cats = tx_engine.load_categories()
        cat_list = [{"path": p, **c} for p, c in sorted(cats.items())]
        self._respond_json(200, {"categories": cat_list})

    def handle_categories_add(self):
        body = self._read_json_body()
        if not body.get("path"):
            self._respond_json(400, {"error": "path is required"})
            return
        if not tx_engine.add_category(body):
            self._respond_json(400, {"error": f"Category '{body['path']}' already exists"})
            return
        tx_engine.git_commit(f"Category add: {body['path']}", ["data/categories.csv"])
        self._respond_json(200, {"success": True})

    def handle_categories_update(self):
        body = self._read_json_body()
        path = body.get("path", "")
        updated = body.get("updated", {})
        if not path:
            self._respond_json(400, {"error": "path is required"})
            return
        if not tx_engine.update_category(path, updated):
            self._respond_json(404, {"error": f"Category '{path}' not found"})
            return
        tx_engine.git_commit(f"Category edit: {path}", ["data/categories.csv"])
        self._respond_json(200, {"success": True})

    # ── API: Tags ────────────────────────────────────────────────────

    def handle_tags_list(self):
        self._respond_json(200, {"tags": tx_engine.load_tags()})

    def handle_tags_add(self):
        body = self._read_json_body()
        if not body.get("tag"):
            self._respond_json(400, {"error": "tag name is required"})
            return
        if not tx_engine.add_tag(body):
            self._respond_json(400, {"error": f"Tag '{body['tag']}' already exists"})
            return
        tx_engine.git_commit(f"Tag add: {body['tag']}", ["data/tags.csv"])
        self._respond_json(200, {"success": True})

    def handle_tags_update(self):
        body = self._read_json_body()
        tag = body.get("tag", "")
        updated = body.get("updated", {})
        if not tag:
            self._respond_json(400, {"error": "tag name is required"})
            return
        if not tx_engine.update_tag(tag, updated):
            self._respond_json(404, {"error": f"Tag '{tag}' not found"})
            return
        tx_engine.git_commit(f"Tag edit: {tag}", ["data/tags.csv"])
        self._respond_json(200, {"success": True})

    def handle_tags_delete(self):
        body = self._read_json_body()
        tag = body.get("tag", "")
        if not tag:
            self._respond_json(400, {"error": "tag name is required"})
            return
        if not tx_engine.delete_tag(tag):
            self._respond_json(404, {"error": f"Tag '{tag}' not found"})
            return
        tx_engine.git_commit(f"Tag delete: {tag}", ["data/tags.csv"])
        self._respond_json(200, {"success": True})

    # ── API: Scheduled Transactions ──────────────────────────────────

    def handle_scheduled_list(self):
        """Return all scheduled transaction templates (active and inactive)."""
        self._respond_json(200, {"scheduled": tx_engine.load_scheduled()})

    def handle_scheduled_add(self):
        """Create a new scheduled transaction template with auto-generated sched_id."""
        body = self._read_json_body()
        if not body.get("name") or not body.get("account") or not body.get("amount"):
            self._respond_json(400, {"error": "name, account, and amount are required"})
            return
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        errors = tx_engine.validate_scheduled(body, accounts, categories)
        if errors:
            self._respond_json(400, {"errors": errors})
            return
        sched_id = tx_engine.add_scheduled(body)
        tx_engine.git_commit(f"Scheduled add: {body['name']}", ["data/scheduled.csv"])
        self._respond_json(200, {"success": True, "sched_id": sched_id})

    def handle_scheduled_update(self):
        body = self._read_json_body()
        sched_id = body.get("sched_id", "")
        updated = body.get("updated", {})
        if not sched_id:
            self._respond_json(400, {"error": "sched_id is required"})
            return
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        errors = tx_engine.validate_scheduled(updated, accounts, categories)
        if errors:
            self._respond_json(400, {"errors": errors})
            return
        if not tx_engine.update_scheduled(sched_id, updated):
            self._respond_json(404, {"error": f"Scheduled '{sched_id}' not found"})
            return
        tx_engine.git_commit(f"Scheduled edit: {sched_id}", ["data/scheduled.csv"])
        self._respond_json(200, {"success": True})

    def handle_scheduled_delete(self):
        body = self._read_json_body()
        sched_id = body.get("sched_id", "")
        if not sched_id:
            self._respond_json(400, {"error": "sched_id is required"})
            return
        if not tx_engine.delete_scheduled(sched_id):
            self._respond_json(404, {"error": f"Scheduled '{sched_id}' not found"})
            return
        tx_engine.git_commit(f"Scheduled delete: {sched_id}", ["data/scheduled.csv"])
        self._respond_json(200, {"success": True})

    def handle_scheduled_preview_due(self):
        """Return what would be booked if SCHED ran today, without writing.

        Body (optional): {"date": "YYYY-MM-DD"} to override today (used for
        backdated previews). Response mirrors cron_sched.build_preview().
        """
        from datetime import date as _date
        import cron_sched
        body = self._read_json_body() or {}
        target = body.get("date", "").strip()
        try:
            today = _date.fromisoformat(target) if target else _date.today()
        except ValueError:
            self._respond_json(400, {"error": "date must be YYYY-MM-DD"})
            return
        try:
            preview = cron_sched.build_preview(today)
        except Exception as exc:
            self._respond_json(500, {"error": f"build_preview failed: {exc}"})
            return
        self._respond_json(200, preview)

    def handle_scheduled_run_due(self):
        """Book due scheduled entries (optionally filtered to selected_ids).

        Body: {"selected_ids": ["sched-001", ...]} (omit or null to book all
        due). Response mirrors cron_sched.run_due() with HTTP 207 if TXs were
        written but the git commit failed (partial-success state).
        """
        from datetime import date as _date
        import cron_sched
        body = self._read_json_body() or {}
        selected = body.get("selected_ids", None)
        if selected is not None and not isinstance(selected, list):
            self._respond_json(400, {"error": "selected_ids must be an array of sched_id strings"})
            return
        target = body.get("date", "").strip()
        try:
            today = _date.fromisoformat(target) if target else _date.today()
        except ValueError:
            self._respond_json(400, {"error": "date must be YYYY-MM-DD"})
            return
        try:
            summary = cron_sched.run_due(today, selected_ids=selected, source="dashboard")
        except Exception as exc:
            self._respond_json(500, {"error": f"run_due failed: {exc}"})
            return
        # Partial success: TXs were appended but git_commit returned False.
        # 207 Multi-Status surfaces the write to the frontend without burying it
        # behind a generic 500.
        status = 200 if summary.get("commit_ok", False) or summary.get("booked", 0) == 0 else 207
        self._respond_json(status, summary)

    # ── API: /api/debts ─────────────────────────────────────────────────

    def handle_debts_list(self):
        """Return all debts/receivables from third_party.csv."""
        debts = tx_engine.load_debts()
        self._respond_json(200, {"debts": debts})

    def handle_debts_add(self):
        body = self._read_json_body()
        if not body.get("person_name") or not body.get("amount"):
            self._respond_json(400, {"error": "person_name and amount are required"})
            return
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        errors = tx_engine.validate_third_party(body, accounts, categories)
        if errors:
            self._respond_json(400, {"errors": errors})
            return
        # Backup-Pflicht: third_party.csv and transactions.csv may both mutate.
        backup.backup_file("third_party", tx_engine.DATA_DIR / "third_party.csv")
        backup.backup_file("transactions", tx_engine.DATA_DIR / "transactions.csv")
        result = tx_engine.add_debt(body)
        files = ["data/third_party.csv"]
        if result.get("import_id"):
            files.append("data/transactions.csv")
        tx_engine.git_commit(f"Debt add: {body['person_name']}", files)
        self._respond_json(200, {"success": True, **result})

    def handle_debts_update(self):
        body = self._read_json_body()
        debt_id = body.get("id", "")
        updated = body.get("updated", {})
        if not debt_id:
            self._respond_json(400, {"error": "id is required"})
            return
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        errors = tx_engine.validate_third_party(updated, accounts, categories)
        if errors:
            self._respond_json(400, {"errors": errors})
            return
        if not tx_engine.update_debt(debt_id, updated):
            self._respond_json(404, {"error": f"Debt '{debt_id}' not found"})
            return
        tx_engine.git_commit(f"Debt edit: {debt_id}", ["data/third_party.csv"])
        self._respond_json(200, {"success": True})

    def handle_debts_topup(self):
        body = self._read_json_body()
        debt_id = body.get("id", "")
        amount = float(body.get("amount", 0))
        note = body.get("note", "")
        account = body.get("account", "")
        skip_tx = bool(body.get("skip_tx", False))
        if not debt_id or not amount:
            self._respond_json(400, {"error": "id and amount are required"})
            return
        # Backup-Pflicht: third_party.csv mutates always; transactions.csv
        # mutates unless skip_tx is set.
        backup.backup_file("third_party", tx_engine.DATA_DIR / "third_party.csv")
        if not skip_tx:
            backup.backup_file("transactions", tx_engine.DATA_DIR / "transactions.csv")
        result = tx_engine.topup_debt(debt_id, amount, note, account, skip_tx)
        if not result:
            self._respond_json(404, {"error": f"Debt '{debt_id}' not found or already settled"})
            return
        files = ["data/third_party.csv"]
        if isinstance(result, dict) and result.get("import_id"):
            files.append("data/transactions.csv")
        tx_engine.git_commit(f"Debt top-up: {debt_id} +{amount}", files)
        self._respond_json(200, {"success": True, **(result if isinstance(result, dict) else {})})

    def handle_debts_delete(self):
        body = self._read_json_body()
        debt_id = body.get("id", "")
        if not debt_id:
            self._respond_json(400, {"error": "id is required"})
            return
        if not tx_engine.delete_debt(debt_id):
            self._respond_json(404, {"error": f"Debt '{debt_id}' not found"})
            return
        tx_engine.git_commit(f"Debt delete: {debt_id}", ["data/third_party.csv"])
        self._respond_json(200, {"success": True})

    def handle_debts_pay(self):
        """Record a payment against a debt.

        Creates a payment record in debt_payments.csv, reduces the debt
        amount, and optionally creates a matching TX in transactions.csv.
        Supports cross-currency payments (e.g. paying a TZS debt in USD).
        """
        body = self._read_json_body()
        debt_id = body.get("debt_id", "")
        amount = float(body.get("amount", 0))
        currency = body.get("currency", "")
        converted = float(body.get("converted_amount", 0))
        note = body.get("note", "")
        account = body.get("account", "")
        if not debt_id or not amount or not currency or not converted:
            self._respond_json(400, {"error": "debt_id, amount, currency, converted_amount required"})
            return
        if not account:
            self._respond_json(400, {"error": "account is required"})
            return
        # Backup-Pflicht: pay_debt writes to third_party.csv,
        # debt_payments.csv, and transactions.csv.
        backup.backup_file("third_party", tx_engine.DATA_DIR / "third_party.csv")
        backup.backup_file("debt_payments", tx_engine.DATA_DIR / "debt_payments.csv")
        backup.backup_file("transactions", tx_engine.DATA_DIR / "transactions.csv")
        result = tx_engine.pay_debt(debt_id, amount, currency, converted, note, account)
        if not result:
            self._respond_json(404, {"error": f"Debt '{debt_id}' not found"})
            return
        files = ["data/third_party.csv", "data/debt_payments.csv", "data/transactions.csv"]
        tx_engine.git_commit(
            f"Debt payment: {result['payment_id']} on {debt_id}",
            files,
        )
        self._respond_json(200, {"success": True, **result})

    def handle_debts_payments(self):
        body = self._read_json_body()
        debt_id = body.get("debt_id")
        payments = tx_engine.load_debt_payments(debt_id)
        self._respond_json(200, {"payments": payments})

    # ── API: /api/quickexp ────────────────────────────────────────────

    def handle_quickexp_list(self):
        self._respond_json(200, {"quick_expenses": tx_engine.load_quick_expenses()})

    def handle_quickexp_add(self):
        body = self._read_json_body()
        if not body.get("name") or not body.get("account"):
            self._respond_json(400, {"error": "name and account are required"})
            return
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        errors = tx_engine.validate_quick_expense(body, accounts, categories)
        if errors:
            self._respond_json(400, {"errors": errors})
            return
        qe_id = tx_engine.add_quick_expense(body)
        tx_engine.git_commit(f"Quick Expense add: {body['name']}", ["data/quick_expenses.csv"])
        self._respond_json(200, {"success": True, "id": qe_id})

    def handle_quickexp_update(self):
        body = self._read_json_body()
        qe_id = body.get("id", "")
        updated = body.get("updated", {})
        if not qe_id:
            self._respond_json(400, {"error": "id is required"})
            return
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        errors = tx_engine.validate_quick_expense(updated, accounts, categories)
        if errors:
            self._respond_json(400, {"errors": errors})
            return
        if not tx_engine.update_quick_expense(qe_id, updated):
            self._respond_json(404, {"error": f"Quick Expense '{qe_id}' not found"})
            return
        tx_engine.git_commit(f"Quick Expense edit: {qe_id}", ["data/quick_expenses.csv"])
        self._respond_json(200, {"success": True})

    def handle_quickexp_delete(self):
        body = self._read_json_body()
        qe_id = body.get("id", "")
        if not qe_id:
            self._respond_json(400, {"error": "id is required"})
            return
        if not tx_engine.delete_quick_expense(qe_id):
            self._respond_json(404, {"error": f"Quick Expense '{qe_id}' not found"})
            return
        tx_engine.git_commit(f"Quick Expense delete: {qe_id}", ["data/quick_expenses.csv"])
        self._respond_json(200, {"success": True})

    # ── API: /api/atm-fees ────────────────────────────────────────────

    def handle_atm_fees_list(self):
        self._respond_json(200, {"atm_fees": tx_engine.load_atm_fees()})

    def handle_atm_fees_add(self):
        body = self._read_json_body()
        if not body.get("bank") or not body.get("amount"):
            self._respond_json(400, {"error": "bank and amount are required"})
            return
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        errors = tx_engine.validate_atm_fee(body, accounts, categories)
        if errors:
            self._respond_json(400, {"errors": errors})
            return
        fee_id = tx_engine.add_atm_fee(body)
        tx_engine.git_commit(
            f"ATM fee add: {body['bank']} {body['amount']}",
            ["data/atm_fees.csv"],
        )
        self._respond_json(200, {"success": True, "id": fee_id})

    def handle_atm_fees_update(self):
        body = self._read_json_body()
        fee_id = body.get("id", "")
        updated = body.get("updated", {})
        if not fee_id:
            self._respond_json(400, {"error": "id is required"})
            return
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        errors = tx_engine.validate_atm_fee(updated, accounts, categories)
        if errors:
            self._respond_json(400, {"errors": errors})
            return
        if not tx_engine.update_atm_fee(fee_id, updated):
            self._respond_json(404, {"error": f"ATM fee '{fee_id}' not found"})
            return
        tx_engine.git_commit(f"ATM fee edit: {fee_id}", ["data/atm_fees.csv"])
        self._respond_json(200, {"success": True})

    def handle_atm_fees_delete(self):
        body = self._read_json_body()
        fee_id = body.get("id", "")
        if not fee_id:
            self._respond_json(400, {"error": "id is required"})
            return
        if not tx_engine.delete_atm_fee(fee_id):
            self._respond_json(404, {"error": f"ATM fee '{fee_id}' not found"})
            return
        tx_engine.git_commit(f"ATM fee delete: {fee_id}", ["data/atm_fees.csv"])
        self._respond_json(200, {"success": True})

    # ── API: /api/accounts/update ──────────────────────────────────────

    def handle_accounts_add(self):
        """Append a new account row to data/accounts.csv.

        Body: ``{alias, name, currency, type, owner, status?, pass_through_payee?,
        initial_balance?, initial_balance_date?, include_in_net_worth?, notes?}``.

        Required: alias, name, currency, type, owner. Optional fields fall
        back to sensible defaults (``status='active'``, ``initial_balance=0``,
        ``initial_balance_date=today``, ``include_in_net_worth='true'``).

        Validations:
          - alias is lowercase a-z / 0-9 / underscore, no spaces
          - alias must not already exist in accounts.csv
          - currency is uppercase 3-letter ISO-ish code
          - initial_balance must parse as a number (defaults to 0 if empty)

        Locking + atomic write + git commit mirror handle_accounts_update.
        """
        import csv
        import re as _re_local
        from datetime import date as _date_local
        from pathlib import Path as _Path_local

        body = self._read_json_body() or {}

        def _s(field: str, default: str = "") -> str:
            v = body.get(field)
            return (str(v).strip() if v is not None else "") or default

        alias = _s("alias").lower()
        name = _s("name")
        currency = _s("currency").upper()
        acc_type = _s("type")
        owner = _s("owner")

        # H-13 (Sprint 13) — input validation. The lowercase-letters/digits
        # rule was already enforced; the new constraint is a max length
        # so a runaway form submission can't drop a 10 KB alias into the
        # accounts.csv and into every TX render path that escapes it.
        if not alias or not _re_local.fullmatch(r"[a-z][a-z0-9_]{0,31}", alias):
            self._respond_json(400, {"error": "alias must be lowercase letters/digits/underscore, starting with a letter, max 32 chars"})
            return
        if not name:
            self._respond_json(400, {"error": "name is required"})
            return
        if len(name) > 64:
            self._respond_json(400, {"error": "name is too long (max 64 chars)"})
            return
        if not _re_local.fullmatch(r"[A-Z]{3}", currency):
            self._respond_json(400, {"error": "currency must be a 3-letter code (e.g. EUR, USD, TZS)"})
            return
        if not acc_type:
            self._respond_json(400, {"error": "type is required"})
            return
        if not owner:
            self._respond_json(400, {"error": "owner is required"})
            return

        status = _s("status", "active")
        if status not in ("active", "archived"):
            self._respond_json(400, {"error": "status must be 'active' or 'archived'"})
            return

        pass_through_payee = _s("pass_through_payee")

        initial_balance_raw = _s("initial_balance", "0")
        try:
            initial_balance = f"{float(initial_balance_raw.replace(',', '').strip()):.2f}"
        except ValueError:
            self._respond_json(400, {"error": "initial_balance must be a number"})
            return

        initial_balance_date = _s("initial_balance_date") or _date_local.today().isoformat()

        include_nw = _s("include_in_net_worth", "true").lower()
        if include_nw not in ("true", "false"):
            include_nw = "true"

        notes = _s("notes")

        accounts_path = _Path_local(__file__).parent.parent / "data" / "accounts.csv"

        with tx_engine.tx_write_lock():
            backup.backup_file("accounts", accounts_path)
            rows = []
            fieldnames = None
            with open(accounts_path, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                fieldnames = reader.fieldnames or []
                for row in reader:
                    if row.get("alias") == alias:
                        self._respond_json(409, {"error": f"alias '{alias}' already exists"})
                        return
                    rows.append(row)

            new_row = {
                "alias": alias,
                "name": name,
                "currency": currency,
                "type": acc_type,
                "owner": owner,
                "status": status,
                "pass_through_payee": pass_through_payee,
                "initial_balance": initial_balance,
                "initial_balance_date": initial_balance_date,
                "include_in_net_worth": include_nw,
                "notes": notes,
            }
            # Only keep keys that the CSV actually has (forward-compat).
            new_row = {k: new_row.get(k, "") for k in fieldnames}
            rows.append(new_row)

            tx_engine._atomic_csv_rewrite(accounts_path, list(fieldnames), rows)
            tx_engine.git_commit(f"Account add: {alias}", ["data/accounts.csv"])

        self._respond_json(200, {"success": True, "account": new_row})

    def handle_accounts_update(self):
        """Update account properties (name, currency, type, etc.) by alias.

        The alias itself cannot be changed here — use handle_accounts_rename
        for that, as it requires cascading updates across all data files.

        H-13 (Sprint 13): same field-shape validation as handle_accounts_add
        for every field present in `updated`. handle_accounts_add already
        enforced these on insert, but edit accepted arbitrary strings until
        now, so a stored-XSS payload could still land in name/notes via an
        edit. Errors short-circuit before the lock is taken.
        """
        import re as _re_local
        body = self._read_json_body()
        alias = body.get("alias", "")
        updated = body.get("updated", {})
        if not alias:
            self._respond_json(400, {"error": "alias is required"})
            return
        # Shape-check whichever fields the caller is changing.
        if "name" in updated:
            nv = (updated.get("name") or "").strip()
            if not nv:
                self._respond_json(400, {"error": "name cannot be empty"})
                return
            if len(nv) > 64:
                self._respond_json(400, {"error": "name is too long (max 64 chars)"})
                return
        if "currency" in updated:
            cv = (updated.get("currency") or "").strip().upper()
            if not _re_local.fullmatch(r"[A-Z]{3}", cv):
                self._respond_json(400, {"error": "currency must be a 3-letter code"})
                return
            updated["currency"] = cv
        if "status" in updated and updated["status"] not in ("active", "archived"):
            self._respond_json(400, {"error": "status must be 'active' or 'archived'"})
            return
        if "notes" in updated and len(updated.get("notes") or "") > 500:
            self._respond_json(400, {"error": "notes is too long (max 500 chars)"})
            return
        import csv
        from pathlib import Path
        accounts_path = Path(__file__).parent.parent / "data" / "accounts.csv"
        # Hold the cross-process tx_write_lock so a concurrent cron
        # (cron_sched / cron_commit) can't slip a write between our
        # backup snapshot, read, and atomic rewrite. Same defense the
        # rename cascade got in v2026-05-03.2 (commit 86db70d).
        with tx_engine.tx_write_lock():
            # Backup-Pflicht before modifying accounts.csv.
            backup.backup_file("accounts", accounts_path)
            rows = []
            found = False
            with open(accounts_path, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                fieldnames = reader.fieldnames
                for row in reader:
                    if row["alias"] == alias:
                        found = True
                        for k, v in updated.items():
                            if k in row and k != "alias":
                                row[k] = v
                    rows.append(row)
            if not found:
                self._respond_json(404, {"error": f"Account '{alias}' not found"})
                return
            tx_engine._atomic_csv_rewrite(accounts_path, list(fieldnames or []), rows)
            tx_engine.git_commit(f"Account edit: {alias}", ["data/accounts.csv"])
        self._respond_json(200, {"success": True})

    def handle_accounts_rename(self):
        """Rename an account alias across ALL data files.

        This is a cascading operation that updates the alias in:
        accounts.csv, transactions.csv (account + transfer_to_account),
        scheduled.csv, quick_expenses.csv, and payees.json.
        Creates a backup before modifying transaction data.
        """
        body = self._read_json_body()
        old_alias = body.get("old_alias", "").strip()
        new_alias = body.get("new_alias", "").strip()
        if not old_alias or not new_alias:
            self._respond_json(400, {"error": "old_alias and new_alias required"})
            return
        if old_alias == new_alias:
            self._respond_json(200, {"success": True, "message": "No change"})
            return
        import csv, json, re
        from pathlib import Path
        data_dir = Path(__file__).parent.parent / "data"

        # Hold the cross-process tx_write_lock for the full cascade so a
        # parallel cron_sched/cron_commit cannot interleave between the
        # accounts.csv rewrite and the transactions.csv / scheduled.csv /
        # quick_expenses.csv / payees.json updates.
        with tx_engine.tx_write_lock():
            # Check new alias doesn't already exist
            accounts_path = data_dir / "accounts.csv"
            rows = []
            fieldnames = None
            found = False
            with open(accounts_path, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                fieldnames = reader.fieldnames
                for row in reader:
                    if row["alias"] == new_alias:
                        self._respond_json(400, {"error": f"Alias '{new_alias}' already exists"})
                        return
                    if row["alias"] == old_alias:
                        found = True
                        row["alias"] = new_alias
                    rows.append(row)
            if not found:
                self._respond_json(404, {"error": f"Account '{old_alias}' not found"})
                return

            # M-S4 (Sprint 16) — staged-rewrite pattern. Previously the
            # cascade interleaved read+write per file, so a malformed
            # mid-list file (e.g. scheduled.csv) would surface as an
            # exception AFTER accounts.csv + transactions.csv had already
            # been rewritten — half-renamed state. Now we do every read
            # and in-memory transform first, fail loudly on any read
            # error, then apply all atomic writes in sequence. Write
            # failures (disk-full, permission-denied) still leave
            # half-state but every touched file has a fresh backup.
            sched_path = data_dir / "scheduled.csv"
            qe_path = data_dir / "quick_expenses.csv"
            payees_path = data_dir / "payees.json"

            # Phase 1 — read + transform every file. Collect pending
            # rewrites as (kind, path, args...) tuples. Any failure
            # raises before we have touched disk.
            pending: list[tuple] = []

            # accounts.csv — already read+transformed into `rows` above.
            pending.append(("csv", accounts_path, list(fieldnames or []), rows))

            tx_path = data_dir / "transactions.csv"
            tx_rows = []
            tx_fields = None
            with open(tx_path, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                tx_fields = reader.fieldnames
                for row in reader:
                    if row.get("account") == old_alias:
                        row["account"] = new_alias
                    if row.get("transfer_to_account") == old_alias:
                        row["transfer_to_account"] = new_alias
                    tx_rows.append(row)
            pending.append(("csv", tx_path, list(tx_fields or []), tx_rows))

            if sched_path.exists():
                s_rows = []
                with open(sched_path, newline="", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    s_fields = reader.fieldnames
                    for row in reader:
                        if row.get("account") == old_alias:
                            row["account"] = new_alias
                        s_rows.append(row)
                pending.append(("csv", sched_path, list(s_fields or []), s_rows))

            if qe_path.exists():
                q_rows = []
                with open(qe_path, newline="", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    q_fields = reader.fieldnames
                    for row in reader:
                        if row.get("account") == old_alias:
                            row["account"] = new_alias
                        q_rows.append(row)
                pending.append(("csv", qe_path, list(q_fields or []), q_rows))

            payees_changed = False
            payees_text = None
            if payees_path.exists():
                with open(payees_path, "r", encoding="utf-8") as f:
                    payees = json.load(f)
                for p in payees:
                    if p.get("default_account") == old_alias:
                        p["default_account"] = new_alias
                        payees_changed = True
                if payees_changed:
                    payees_text = json.dumps(payees, ensure_ascii=False, indent=2)
                    pending.append(("json", payees_path, payees_text))

            # Phase 2 — backups, then atomic writes. Every read has
            # already succeeded, so anything failing from here on is
            # a disk-level problem the backups already cover.
            backup.backup_file("accounts", accounts_path)
            backup.backup_file("transactions", tx_path)
            if sched_path.exists():
                backup.backup_file("scheduled", sched_path)
            if qe_path.exists():
                backup.backup_file("quick_expenses", qe_path)
            if payees_path.exists():
                backup.backup_file("payees", payees_path)

            for entry in pending:
                kind = entry[0]
                if kind == "csv":
                    _, target, fields, payload = entry
                    tx_engine._atomic_csv_rewrite(target, fields, payload)
                elif kind == "json":
                    _, target, text = entry
                    tx_engine._atomic_write_text(target, text)

            git_files = ["data/accounts.csv", "data/transactions.csv", "data/scheduled.csv",
                          "data/quick_expenses.csv", "data/payees.json"]
            tx_engine.git_commit(f"Account rename: {old_alias} → {new_alias}", git_files)
        self._respond_json(200, {"success": True})

    # ── API: /api/backup ─────────────────────────────────────────────

    def handle_backup_create(self):
        """Trigger a manual backup via the backup.py script (subprocess call)."""
        import subprocess
        body = self._read_json_body()
        target = body.get("target", "transactions")
        # H-04 (Sprint 7) — restrict to known backup stems before
        # handing the value to subprocess argv. Without this gate a
        # caller (post-auth) could pass arbitrary strings to backup.py
        # and turn the endpoint into a generic "run an arg through
        # python" surface.
        if target not in backup.BACKUP_TARGETS:
            self._respond_json(400, {
                "error": "Unknown backup target",
                "allowed": sorted(backup.BACKUP_TARGETS),
            })
            return
        script = str(Path(__file__).parent / "backup.py")
        # Suppress Windows console flash for child python (no-op on POSIX).
        # Use pythonw.exe on Windows so the child has no console at all
        # (python.exe still flashes briefly even with CREATE_NO_WINDOW).
        no_win = {"creationflags": 0x08000000} if sys.platform == "win32" else {}
        py = sys.executable
        if sys.platform == "win32":
            cand = Path(sys.executable).with_name("pythonw.exe")
            if cand.exists():
                py = str(cand)
        try:
            result = subprocess.run(
                [py, script, target],
                capture_output=True, text=True, timeout=30,
                cwd=str(Path(__file__).parent.parent),
                **no_win,
            )
            output = (result.stdout + result.stderr).strip()
            self._respond_json(200, {"success": True, "message": output})
        except Exception as e:
            req_id = secrets.token_hex(4)
            print(f"[serve] backup_create req={req_id}: {type(e).__name__}: {e}",
                  file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            self._respond_json(500, {"error": "Backup failed", "request_id": req_id})

    def handle_backup_list(self):
        """List all backup files with sizes and dates for the dashboard UI."""
        from pathlib import Path
        backup_dir = Path(__file__).parent.parent / "data" / "backups"
        backups = []
        if backup_dir.exists():
            for f in sorted(backup_dir.glob("*.csv"), key=lambda x: x.stat().st_mtime, reverse=True):
                stat = f.stat()
                size_kb = stat.st_size / 1024
                size_str = f"{size_kb:.1f} KB" if size_kb < 1024 else f"{size_kb/1024:.1f} MB"
                from datetime import datetime
                mtime = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M")
                backups.append({"name": f.name, "size": size_str, "date": mtime})
        self._respond_json(200, {"backups": backups})

    def handle_backup_export(self):
        """Stream a ZIP archive of the entire data/ directory.

        Excludes data/backups/ (already point-in-time snapshots, would inflate the
        archive without adding restore value), data/receipts/ (binary blobs that
        belong in the dedicated /api/receipts/export endpoint), and any
        __pycache__ directories. Filename embeds a UTC timestamp so multiple
        downloads do not collide.

        Hardening (Sprint 7, H-02):
          - Single-flight lock: a second call while one export is in flight
            gets HTTP 429 instead of stacking ZIP builds on the handler pool.
          - Pre-scan size cap: refuse upfront if the included files would
            exceed BACKUP_EXPORT_MAX_BYTES, so we never start a ZIP we know
            would OOM the Pi.
          - Receipts excluded by default: keeps this endpoint's worst case
            at the size of all CSV/JSON state, not the receipts library.

        Memory profile: ZIP is built into a SpooledTemporaryFile capped at
        16 MB — anything bigger spills to disk on the Pi instead of pinning
        the whole archive in RAM. Streamed back to the client in 64 KB
        chunks so wfile.write() never sees a multi-MB buffer either.
        """
        import tempfile
        import zipfile
        from datetime import datetime, timezone

        data_dir = Path(__file__).parent.parent / "data"
        if not data_dir.exists():
            self._respond_json(404, {"error": "data directory not found"})
            return

        # ── H-02 (Sprint 7) — single-flight gate ────────────────────────
        # The handler thread is held for the entire ZIP build + stream,
        # so a parallel call would just queue behind us anyway. Refusing
        # explicitly gives the client a clean 429 instead of an opaque
        # multi-minute wait.
        if not _backup_export_lock.acquire(blocking=False):
            self._respond_json(429, {
                "error": "Another backup export is already running. Try again in a moment.",
            })
            return

        try:
            def is_excluded(rel: Path) -> bool:
                parts = rel.parts
                if not parts:
                    return False
                # Rolling local snapshots (would inflate without restore value)
                # and the dedicated receipts library (separate endpoint).
                if parts[0] in ("backups", "receipts"):
                    return True
                if "__pycache__" in parts:
                    return True
                return False

            # ── H-02 — pre-scan size cap ────────────────────────────────
            # Sum included file sizes before opening the ZIP so we can
            # bail out cheaply if the export would breach the cap.
            included: list[Path] = []
            total_bytes = 0
            for path in data_dir.rglob("*"):
                if not path.is_file():
                    continue
                rel = path.relative_to(data_dir)
                if is_excluded(rel):
                    continue
                included.append(path)
                try:
                    total_bytes += path.stat().st_size
                except OSError:
                    pass
                if total_bytes > BACKUP_EXPORT_MAX_BYTES:
                    self._respond_json(413, {
                        "error": "Backup export would exceed the size cap",
                        "limit_bytes": BACKUP_EXPORT_MAX_BYTES,
                        "observed_bytes_at_refusal": total_bytes,
                    })
                    return

            spool = tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024)
            try:
                with zipfile.ZipFile(spool, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                    for path in included:
                        rel = path.relative_to(data_dir)
                        zf.write(path, arcname=str(rel))
                spool.seek(0, 2)
                size = spool.tell()
                spool.seek(0)
            except Exception as e:
                spool.close()
                self._respond_json(500, {"error": f"ZIP build failed: {e}"})
                return

            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")
            filename = f"financeos-backup-{stamp}.zip"
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self._send_cors_origin()
            self.send_header("Content-Length", str(size))
            self.end_headers()
            try:
                while True:
                    chunk = spool.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            finally:
                spool.close()
        finally:
            _backup_export_lock.release()

    # ── API: /api/recon/* ────────────────────────────────────────────
    # Bank-statement reconciliation. Adapters live in
    # scripts/reconciliation/ and self-register via the package
    # ``__init__``. Account → adapter routing comes from
    # ``config/reconciliation.json``. The pre-Block-D shape (no
    # ``account`` field, files always in ``data/crdb_data/``) still
    # works: omitting ``account`` defaults to ``crdb`` so existing
    # frontends keep functioning.

    def handle_recon_adapters(self):
        """List installed reconciliation adapters for the UI dropdown."""
        from reconciliation import list_adapters, load_recon_config

        cfg = load_recon_config()
        self._respond_json(200, {
            "adapters": list_adapters(),
            "default_adapter": cfg.get("default_adapter", ""),
            "account_adapters": cfg.get("account_adapters", {}),
        })

    def handle_recon_files(self):
        """List statement files for a given account / adapter.

        Query string: ``?account=<alias>`` (default: ``crdb``).
        Adapter is resolved via ``config/reconciliation.json``; files
        come from the adapter's ``data_subdir`` under ``data/``.
        """
        from urllib.parse import urlparse, parse_qs
        from reconciliation import get_adapter_for_account

        qs = parse_qs(urlparse(self.path).query)
        account = (qs.get("account", ["crdb"]) or ["crdb"])[0]
        # M-S3 (Sprint 16) — validate the alias against the live accounts
        # set before resolving an adapter. The adapter factory has its
        # own fallback path that would happily list files for an alias
        # nobody had heard of; refusing here keeps the surface tight.
        try:
            accounts_known = set(tx_engine.load_accounts().keys())
        except Exception:
            accounts_known = set()
        if accounts_known and account not in accounts_known:
            self._respond_json(400, {
                "error": f"unknown account alias: {account}",
            })
            return
        adapter = get_adapter_for_account(account)
        files = adapter.list_files(tx_engine.DATA_DIR)
        self._respond_json(200, {
            "files": files,
            "adapter": adapter.name,
            "account": account,
        })

    def handle_recon_suggestions(self):
        """Parse a statement file and return unmatched rows as suggestions.

        Expects: ``{ "filename": "...", "account": "crdb" }``
        ``account`` is optional and defaults to ``crdb``.
        """
        from reconciliation import get_adapter_for_account

        body = self._read_json_body()
        filename = body.get("filename", "")
        account = body.get("account", "crdb")
        if not filename:
            self._respond_json(400, {"error": "filename is required"})
            return

        adapter = get_adapter_for_account(account)
        # Path-traversal guard: filename must be a bare basename and must
        # appear in the adapter's whitelisted file listing. Without this,
        # `../transactions.csv` would resolve to any CSV in the repo.
        safe_name = Path(filename).name
        if safe_name != filename or safe_name in ("", ".", ".."):
            self._respond_json(400, {"error": "Invalid filename"})
            return
        allowed = {f.get("name") for f in adapter.list_files(tx_engine.DATA_DIR)}
        if safe_name not in allowed:
            self._respond_json(404, {"error": f"File not found: {safe_name}"})
            return
        stmt_path = tx_engine.DATA_DIR / adapter.data_subdir / safe_name
        if not stmt_path.exists():
            self._respond_json(404, {"error": f"File not found: {safe_name}"})
            return

        try:
            bank_rows = adapter.parse(str(stmt_path))
            tx_path = tx_engine.DATA_DIR / "transactions.csv"
            existing_tx: list[dict] = []
            if tx_path.exists():
                import csv as _csv
                with tx_path.open("r", newline="", encoding="utf-8") as f:
                    existing_tx = list(_csv.DictReader(f))
            suggestions = adapter.reconcile(str(stmt_path), existing_tx, account=account)
            self._respond_json(200, {
                "suggestions": [s.to_dict() for s in suggestions],
                "total_bank_rows": len(bank_rows),
                "matched": len(bank_rows) - len(suggestions),
                "adapter": adapter.name,
                "account": account,
                # parse_errors is populated by adapters that track per-row
                # parse failures (currently only crdb_tz). Empty list when
                # the adapter does not surface them.
                "parse_errors": getattr(adapter, "parse_errors", []),
            })
        except Exception as e:
            self._respond_json(500, {"error": f"Parse error: {e}"})

    # ── API: /api/vehicles/* + /api/fuel/* (Block G — Vehicles tab) ───
    # Vehicles list is read-only at the API level (edit data/vehicles.csv
    # directly for stammdaten changes). Fuel entries are CRUD via fuel.py,
    # which keeps the cascade to transactions.csv (expense + reimbursement)
    # in lockstep.

    def handle_vehicles_list(self):
        """Return all vehicles from data/vehicles.csv."""
        vehicles = list(fuel.load_vehicles().values())
        self._respond_json(200, {"vehicles": vehicles})

    def handle_vehicles_add(self):
        """Create a new vehicle row. Returns the assigned vehicle_id.

        Atomic: backup → rewrite vehicles.csv → git commit. Validates name +
        currency on the backend so a malformed POST cannot leave the file in
        a partially-written state.
        """
        body = self._read_json_body()
        try:
            vid = fuel.add_vehicle(body)
        except ValueError as exc:
            self._respond_json(400, {"error": str(exc)})
            return
        except Exception as exc:
            self._respond_json(500, {"error": f"add_vehicle failed: {exc}"})
            return
        tx_engine.git_commit(f"Vehicle add: {body.get('name', vid)}", ["data/vehicles.csv"])
        self._respond_json(200, {"success": True, "vehicle_id": vid})

    def handle_vehicles_update(self):
        """Patch fields on an existing vehicle row. `vehicle_id` is required."""
        body = self._read_json_body()
        vid = body.get("vehicle_id", "")
        if not vid:
            self._respond_json(400, {"error": "vehicle_id is required"})
            return
        try:
            ok = fuel.update_vehicle(vid, body)
        except Exception as exc:
            self._respond_json(500, {"error": f"update_vehicle failed: {exc}"})
            return
        if not ok:
            self._respond_json(404, {"error": f"Vehicle '{vid}' not found"})
            return
        tx_engine.git_commit(f"Vehicle edit: {vid}", ["data/vehicles.csv"])
        self._respond_json(200, {"success": True})

    def handle_vehicles_delete(self):
        """Remove a vehicle. Refuses when fuel_log entries reference the vid
        — the Settings UI blocks this client-side, but a server-side check
        protects against direct API calls and keeps historical reports
        intact. Caller is told to archive instead.
        """
        body = self._read_json_body()
        vid = body.get("vehicle_id", "")
        if not vid:
            self._respond_json(400, {"error": "vehicle_id is required"})
            return
        try:
            referencing = sum(1 for r in fuel.load_fuel_log() if r.get("vehicle_id") == vid)
        except Exception:
            referencing = 0
        if referencing > 0:
            self._respond_json(409, {
                "error": f"Vehicle '{vid}' has {referencing} fuel-log entries. Archive it instead, or delete the entries first.",
                "fuel_entries": referencing,
            })
            return
        try:
            ok = fuel.delete_vehicle(vid)
        except Exception as exc:
            self._respond_json(500, {"error": f"delete_vehicle failed: {exc}"})
            return
        if not ok:
            self._respond_json(404, {"error": f"Vehicle '{vid}' not found"})
            return
        tx_engine.git_commit(f"Vehicle delete: {vid}", ["data/vehicles.csv"])
        self._respond_json(200, {"success": True})

    def handle_fuel_list(self):
        """Return fuel entries with computed per-row metrics + summary totals
        plus a reconciliation report so the dashboard can surface findings
        (unlinked fuel TXs, orphaned log entries) without a second round-trip.
        """
        rows = fuel.load_fuel_log()
        vehicles = fuel.load_vehicles()
        enriched = fuel.enrich_fuel_log(rows)
        self._respond_json(200, {
            "entries": enriched,
            "summary": fuel.fuel_summary(enriched),
            "vehicles": list(vehicles.values()),
            "reconciliation": fuel.reconcile(rows, vehicles),
        })

    def handle_fuel_add(self):
        """Create a fuel entry and the linked expense (+ reimbursement) TX."""
        body = self._read_json_body()
        try:
            result = fuel.add_fuel_entry(
                date=body["date"],
                vehicle_id=body["vehicle_id"],
                odometer_km=float(body["odometer_km"]),
                liters=float(body["liters"]),
                total_cost=float(body["total_cost"]),
                station=body.get("station", "").strip(),
                full_tank=bool(body.get("full_tank", True)),
                account=(body.get("account") or "").strip() or None,
                remarks=body.get("remarks", "").strip(),
            )
        except (KeyError, ValueError) as exc:
            self._respond_json(400, {"error": str(exc)})
            return
        self._respond_json(200, {"success": True, **result})

    def handle_fuel_update(self):
        """Edit an existing fuel entry. Body: {fuel_id, ...partial fields}.

        Empty/null values are ignored so the client can send only the
        fields that actually changed. The cascade (TX delete + recreate)
        runs server-side; fuel_id and on-screen ordering stay stable.
        """
        body = self._read_json_body()
        fuel_id = body.get("fuel_id", "").strip()
        if not fuel_id:
            self._respond_json(400, {"error": "fuel_id is required"})
            return
        # Whitelist editable fields; ignore extras to keep the API contract tight.
        editable = (
            "date", "vehicle_id", "odometer_km", "liters", "total_cost",
            "station", "full_tank", "account", "remarks",
        )
        new_fields = {k: body.get(k) for k in editable if k in body}
        try:
            result = fuel.update_fuel_entry(fuel_id, **new_fields)
        except ValueError as exc:
            self._respond_json(400, {"error": str(exc)})
            return
        self._respond_json(200, {"success": True, **result})

    def handle_fuel_recon_dismiss(self):
        """Mark a TX as 'not vehicle fuel' so reconcile() ignores it.

        Body: {import_id, reason?}. Use case: lawn-mower fuel, generator
        fill-ups, jerry-cans for someone else — all booked under the
        same Automobile:Petrol category but not part of the fuel log.
        """
        body = self._read_json_body()
        import_id = body.get("import_id", "").strip()
        if not import_id:
            self._respond_json(400, {"error": "import_id is required"})
            return
        fuel.add_dismissed_recon(import_id, body.get("reason", ""))
        self._respond_json(200, {"success": True})

    def handle_fuel_recon_undismiss(self):
        """Re-include a previously dismissed TX. Body: {import_id}."""
        body = self._read_json_body()
        import_id = body.get("import_id", "").strip()
        if not import_id:
            self._respond_json(400, {"error": "import_id is required"})
            return
        ok = fuel.remove_dismissed_recon(import_id)
        if not ok:
            self._respond_json(404, {"error": f"'{import_id}' not in dismissed list"})
            return
        self._respond_json(200, {"success": True})

    def handle_fuel_export(self):
        """Stream a per-vehicle fuel-log workbook as .xlsx.

        Body: {vehicle_id}. Returns an Excel binary that mirrors the
        typical fuel-spreadsheet layout (Cost sheet, Table1, formulas,
        SUBTOTAL totals row) so users can drop the download into the
        spreadsheet workflow they already had before FinanceOS owned the
        fuel data.
        """
        body = self._read_json_body()
        vehicle_id = body.get("vehicle_id", "").strip()
        if not vehicle_id:
            self._respond_json(400, {"error": "vehicle_id is required"})
            return
        try:
            data, filename = fuel_export.build_vehicle_xlsx(vehicle_id)
        except ValueError as exc:
            self._respond_json(404, {"error": str(exc)})
            return
        except Exception as exc:
            req_id = secrets.token_hex(4)
            print(f"[serve] fuel_export req={req_id}: {type(exc).__name__}: {exc}",
                  file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            self._respond_json(500, {"error": "Export failed", "request_id": req_id})
            return
        self.send_response(200)
        self.send_header(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self._send_cors_origin()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ── API: /api/properties/* (Utilities Subsystem Phase 2) ─────────────

    def handle_properties_list(self):
        """Return all properties enriched with current-month + YTD KPIs.

        Response is the array used to render the Properties sidebar cards.
        Each entry carries the raw property fields (id, name, address,
        meters, defaults) plus a `kpis` sub-dict computed server-side so
        the frontend stays render-only.
        """
        try:
            properties = utilities.list_properties_with_summary()
        except Exception as exc:
            req_id = secrets.token_hex(4)
            print(
                f"[serve] properties_list req={req_id}: "
                f"{type(exc).__name__}: {exc}", file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            self._respond_json(500, {
                "error": "properties_list failed", "request_id": req_id,
            })
            return
        self._respond_json(200, {"properties": properties})

    def handle_properties_details(self):
        """Return per-property full data: logs, monthly series, KPIs.

        Body: {property_id}. The response is the single source of truth
        for the property drilldown page — the client never has to compute
        chart data or KPIs itself, which keeps the dashboard fast on
        weak Pi-served browsers.
        """
        body = self._read_json_body()
        property_id = body.get("property_id", "").strip()
        if not property_id:
            self._respond_json(400, {"error": "property_id is required"})
            return
        properties = utilities.load_properties()
        if property_id not in properties:
            self._respond_json(404, {"error": f"Property '{property_id}' not found"})
            return
        prop = properties[property_id]
        try:
            luku, water = utilities.filter_logs_by_property(property_id)
            # Enrich LUKU rows with consumption_kwh between purchases
            # so the dashboard can show "Verbrauch" alongside bought kWh
            # without computing it client-side.
            luku_enriched = utilities.enrich_luku_consumption(luku)
            kpis = utilities.property_kpis(luku, water)
            monthly_luku = utilities.monthly_luku_series(luku)
            monthly_water = utilities.monthly_water_series(water)
            yearly = utilities.yearly_comparison(luku, water)
            price_trend = utilities.price_per_kwh_series(luku)
            purchase_freq = utilities.luku_purchase_frequency(luku)
            ytd_cum = utilities.ytd_cumulative(luku, water)
            heatmap = utilities.seasonality_heatmap(luku, water)
            # Property-cost-tag-tagged TX aggregation — gives the
            # drilldown page a full Cost-of-Living view alongside the
            # LUKU/Water-only KPIs. Frontend clamps tx_list / by_month to
            # the active period filter and recomputes the headline figures.
            cost_overview = utilities.cost_overview(property_id)
        except Exception as exc:
            req_id = secrets.token_hex(4)
            print(
                f"[serve] properties_details req={req_id}: "
                f"{type(exc).__name__}: {exc}", file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            self._respond_json(500, {
                "error": "properties_details failed", "request_id": req_id,
            })
            return
        self._respond_json(200, {
            "property": prop,
            "kpis": kpis,
            "luku_log": luku_enriched,
            "water_log": water,
            "monthly_luku": monthly_luku,
            "monthly_water": monthly_water,
            "yearly": yearly,
            "price_trend": price_trend,
            "purchase_freq": purchase_freq,
            "ytd_cumulative": ytd_cum,
            "seasonality": heatmap,
            "cost_overview": cost_overview,
        })

    def handle_properties_excel(self):
        """Stream a per-property data-only workbook as .xlsx.

        Body: {property_id}. Layout: Summary + LUKU_Log + Water_Log +
        TX_Linked sheets. No charts (Dashboard owns those) — the export
        is for raw-data sharing, e.g. with the rental-property accountant
        who wants the kWh history without poking around the dashboard.
        """
        body = self._read_json_body()
        property_id = body.get("property_id", "").strip()
        if not property_id:
            self._respond_json(400, {"error": "property_id is required"})
            return
        try:
            import property_excel_export
            data, filename = property_excel_export.build_property_xlsx(property_id)
        except ValueError as exc:
            self._respond_json(404, {"error": str(exc)})
            return
        except Exception as exc:
            req_id = secrets.token_hex(4)
            print(
                f"[serve] properties_excel req={req_id}: "
                f"{type(exc).__name__}: {exc}", file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            self._respond_json(500, {
                "error": "Export failed", "request_id": req_id,
            })
            return
        self.send_response(200)
        self.send_header(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self._send_cors_origin()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_properties_cost_overview(self):
        """Return Cost-of-Living aggregation for one property.

        Body: {property_id, year}. `year` is optional — '' or 'all' means
        full history, '2024' filters to that calendar year. Aggregates
        every TX carrying the property's cost_tag into coarse buckets
        (rent, service charges, utilities, maintenance, staff, etc.) so
        the report tells a story instead of listing 30 categories.
        """
        body = self._read_json_body()
        property_id = (body.get("property_id") or "").strip()
        year = (body.get("year") or "").strip()
        if not property_id:
            self._respond_json(400, {"error": "property_id is required"})
            return
        try:
            overview = utilities.cost_overview(property_id, year)
        except ValueError as exc:
            self._respond_json(404, {"error": str(exc)})
            return
        except Exception as exc:
            req_id = secrets.token_hex(4)
            print(
                f"[serve] properties_cost_overview req={req_id}: "
                f"{type(exc).__name__}: {exc}", file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            self._respond_json(500, {
                "error": "cost_overview failed", "request_id": req_id,
            })
            return
        self._respond_json(200, overview)

    def handle_properties_alerts(self):
        """Return drift-alerts across all active properties.

        Used by the dashboard's computeAlerts() pipeline so utility
        anomalies (kWh-spike, missed water bill, price/kWh drift, LUKU
        overdue) surface in the same Alerts tab as the rest of the
        FinanceOS warnings.
        """
        try:
            alerts = utilities.compute_property_alerts()
        except Exception as exc:
            req_id = secrets.token_hex(4)
            print(
                f"[serve] properties_alerts req={req_id}: "
                f"{type(exc).__name__}: {exc}", file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            self._respond_json(500, {
                "error": "properties_alerts failed", "request_id": req_id,
            })
            return
        self._respond_json(200, {"alerts": alerts})

    def handle_properties_add(self):
        """Create a new property row. Body is the full property dict.

        Returns the assigned property_id. Validates name + currency on
        the server so a malformed POST cannot leave properties.csv in a
        partially-written state.
        """
        body = self._read_json_body()
        try:
            pid = utilities.add_property(body)
        except ValueError as exc:
            self._respond_json(400, {"error": str(exc)})
            return
        except Exception as exc:
            self._respond_json(500, {"error": f"add_property failed: {exc}"})
            return
        tx_engine.git_commit(
            f"Property add: {body.get('name', pid)}", ["data/properties.csv"]
        )
        self._respond_json(200, {"success": True, "property_id": pid})

    def handle_properties_update(self):
        """Patch fields on an existing property row. property_id required."""
        body = self._read_json_body()
        pid = body.get("property_id", "").strip()
        if not pid:
            self._respond_json(400, {"error": "property_id is required"})
            return
        try:
            ok = utilities.update_property(pid, body)
        except Exception as exc:
            self._respond_json(500, {"error": f"update_property failed: {exc}"})
            return
        if not ok:
            self._respond_json(404, {"error": f"Property '{pid}' not found"})
            return
        tx_engine.git_commit(f"Property edit: {pid}", ["data/properties.csv"])
        self._respond_json(200, {"success": True})

    def handle_properties_delete(self):
        """Remove a property. Refuses when LUKU/Water log entries reference it.

        The Settings UI blocks this client-side, but a server-side check
        protects against direct API calls and preserves historical
        aggregates. Caller is told how many entries block it.
        """
        body = self._read_json_body()
        pid = body.get("property_id", "").strip()
        if not pid:
            self._respond_json(400, {"error": "property_id is required"})
            return
        try:
            luku_ref = sum(
                1 for r in utilities.load_luku_log() if r.get("property_id") == pid
            )
            water_ref = sum(
                1 for r in utilities.load_water_log() if r.get("property_id") == pid
            )
        except Exception:
            luku_ref = water_ref = 0
        if luku_ref or water_ref:
            self._respond_json(409, {
                "error": (
                    f"Property '{pid}' has {luku_ref} LUKU + {water_ref} water "
                    f"entries. Archive it (active=false) instead, or delete "
                    f"the log entries first."
                ),
                "luku_entries": luku_ref,
                "water_entries": water_ref,
            })
            return
        try:
            ok = utilities.delete_property(pid)
        except Exception as exc:
            self._respond_json(500, {"error": f"delete_property failed: {exc}"})
            return
        if not ok:
            self._respond_json(404, {"error": f"Property '{pid}' not found"})
            return
        tx_engine.git_commit(f"Property delete: {pid}", ["data/properties.csv"])
        self._respond_json(200, {"success": True})

    # ── API: /api/subscriptions/* (Subscriptions Subsystem Phase 1) ─────────
    #
    # Phase 1 = master-CRUD only. The log-table is created with a header
    # but stays empty until Phase 2 wires up TX linking. The handlers
    # mirror the property-CRUD shape so the frontend can use the same
    # `apiPost(path, body)` wrapper, the same error-banner conventions,
    # and the same git-commit-after-write atomicity guarantee.

    def handle_subscriptions_list(self):
        """Return all subscriptions enriched with monthly/yearly equivalents."""
        try:
            rows = subscriptions.list_subscriptions_with_summary()
        except Exception as exc:
            req_id = secrets.token_hex(4)
            print(
                f"[serve] subscriptions_list req={req_id}: "
                f"{type(exc).__name__}: {exc}", file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            self._respond_json(500, {
                "error": "subscriptions_list failed", "request_id": req_id,
            })
            return
        self._respond_json(200, {"subscriptions": rows})

    def handle_subscriptions_details(self):
        """Return a single subscription by id (raw row, no enrichment).

        Used by the edit modal to pre-fill fields. The summary endpoint
        already carries the same data plus derived totals, so most UI
        flows can skip this — kept for parity with the properties API.
        """
        body = self._read_json_body()
        sid = (body.get("subscription_id") or "").strip()
        if not sid:
            self._respond_json(400, {"error": "subscription_id is required"})
            return
        subs = subscriptions.load_subscriptions()
        if sid not in subs:
            self._respond_json(404, {"error": f"Subscription '{sid}' not found"})
            return
        self._respond_json(200, {"subscription": subs[sid]})

    def handle_subscriptions_picker(self):
        """Return active subscriptions trimmed to picker-relevant fields.

        Powers the optional "Link to subscription" dropdown on the
        Add-TX and Edit-TX forms. Inactive rows are filtered out so
        cancelled subs never end up newly linked to a fresh charge.
        """
        try:
            rows = subscriptions.list_active_for_picker()
        except Exception as exc:
            req_id = secrets.token_hex(4)
            print(
                f"[serve] subscriptions_picker req={req_id}: "
                f"{type(exc).__name__}: {exc}", file=sys.stderr,
            )
            self._respond_json(500, {
                "error": "subscriptions_picker failed", "request_id": req_id,
            })
            return
        self._respond_json(200, {"subscriptions": rows})

    def handle_subscriptions_log_for_tx(self):
        """Return the subscription_log row linked to a TX, if any.

        Used by the Edit-TX modal to pre-select the picker dropdown
        when the user opens an already-linked transaction. Returns
        ``{subscription_id: ""}`` for unlinked TXs so the frontend
        does not need a separate not-found path.
        """
        body = self._read_json_body()
        tx_id = (body.get("tx_import_id") or "").strip()
        if not tx_id:
            self._respond_json(400, {"error": "tx_import_id is required"})
            return
        link = subscriptions.find_log_by_tx(tx_id) or {}
        self._respond_json(200, {
            "subscription_id": link.get("subscription_id", ""),
            "log_id": link.get("log_id", ""),
            "linked": bool(link),
        })

    def handle_subscriptions_log_for_subscription(self):
        """Return all log rows for a subscription, newest first."""
        body = self._read_json_body()
        sid = (body.get("subscription_id") or "").strip()
        if not sid:
            self._respond_json(400, {"error": "subscription_id is required"})
            return
        rows = subscriptions.list_log_for_subscription(sid)
        self._respond_json(200, {"log": rows})

    def handle_subscriptions_drift_alerts(self):
        """Phase 3 — surface subscriptions whose latest charge spiked.

        Body (optional): ``{"threshold_pct": 5.0}``. Default is 5 % which
        comfortably ignores currency-conversion jitter on the few non-TZS
        subscriptions while still catching the typical "annual price bump"
        Netflix and Spotify ship. Empty/zero is treated as the default —
        passing 0 would otherwise alert on every charge, which is noise.
        """
        body = self._read_json_body() or {}
        threshold = body.get("threshold_pct")
        try:
            threshold = float(threshold) if threshold is not None else subscriptions.DEFAULT_DRIFT_THRESHOLD_PCT
            if threshold <= 0:
                threshold = subscriptions.DEFAULT_DRIFT_THRESHOLD_PCT
        except (TypeError, ValueError):
            threshold = subscriptions.DEFAULT_DRIFT_THRESHOLD_PCT
        alerts = subscriptions.compute_drift_alerts(threshold_pct=threshold)
        self._respond_json(200, {"alerts": alerts, "threshold_pct": threshold})

    def handle_subscriptions_add(self):
        """Create a new subscription. Body is the full row dict.

        Required: name, currency, amount, billing_months. Returns the
        assigned subscription_id. Validation lives in the service-layer
        so a malformed POST cannot leave subscriptions.csv partially
        written.
        """
        body = self._read_json_body()
        try:
            sid = subscriptions.add_subscription(body)
        except ValueError as exc:
            self._respond_json(400, {"error": str(exc)})
            return
        except Exception as exc:
            self._respond_json(500, {"error": f"add_subscription failed: {exc}"})
            return
        tx_engine.git_commit(
            f"Subscription add: {body.get('name', sid)}",
            ["data/subscriptions.csv"],
        )
        self._respond_json(200, {"success": True, "subscription_id": sid})

    def handle_subscriptions_update(self):
        """Patch fields on an existing subscription row."""
        body = self._read_json_body()
        sid = (body.get("subscription_id") or "").strip()
        if not sid:
            self._respond_json(400, {"error": "subscription_id is required"})
            return
        try:
            ok = subscriptions.update_subscription(sid, body)
        except Exception as exc:
            self._respond_json(500, {
                "error": f"update_subscription failed: {exc}",
            })
            return
        if not ok:
            self._respond_json(404, {
                "error": f"Subscription '{sid}' not found",
            })
            return
        tx_engine.git_commit(
            f"Subscription edit: {sid}", ["data/subscriptions.csv"],
        )
        self._respond_json(200, {"success": True})

    def handle_subscriptions_delete(self):
        """Remove a subscription. Refuses when log entries reference it.

        Phase-1 log is empty so this rarely fires today, but the guard
        is in place from day one — same precondition the properties
        and vehicles endpoints enforce, so historical Phase-2 charges
        won't go missing.
        """
        body = self._read_json_body()
        sid = (body.get("subscription_id") or "").strip()
        if not sid:
            self._respond_json(400, {"error": "subscription_id is required"})
            return
        try:
            log_ref = sum(
                1 for r in subscriptions.load_subscription_log()
                if r.get("subscription_id") == sid
            )
        except Exception:
            log_ref = 0
        if log_ref:
            self._respond_json(409, {
                "error": (
                    f"Subscription '{sid}' has {log_ref} log entries. "
                    f"Archive it (active=false) instead, or delete the "
                    f"log entries first."
                ),
                "log_entries": log_ref,
            })
            return
        try:
            ok = subscriptions.delete_subscription(sid)
        except Exception as exc:
            self._respond_json(500, {
                "error": f"delete_subscription failed: {exc}",
            })
            return
        if not ok:
            self._respond_json(404, {
                "error": f"Subscription '{sid}' not found",
            })
            return
        tx_engine.git_commit(
            f"Subscription delete: {sid}", ["data/subscriptions.csv"],
        )
        self._respond_json(200, {"success": True})

    def handle_luku_add(self):
        """Create a LUKU log entry + linked expense (+ reimburse) TX.

        Body: {date, property_id, units_kwh, total_price, account?,
        meter?, note?}. Mirrors the TX-luku free-text flow but with a
        structured form payload from the Add-LUKU modal.
        """
        body = self._read_json_body()
        try:
            result = utilities.add_luku_entry(
                date=body["date"],
                property_id=body["property_id"],
                units_kwh=float(body["units_kwh"]),
                total_price=float(body["total_price"]),
                account=(body.get("account") or "").strip() or None,
                meter=body.get("meter", "").strip(),
                note=body.get("note", "").strip(),
            )
        except (KeyError, ValueError) as exc:
            self._respond_json(400, {"error": str(exc)})
            return
        except Exception as exc:
            req_id = secrets.token_hex(4)
            print(
                f"[serve] luku_add req={req_id}: {type(exc).__name__}: {exc}",
                file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            self._respond_json(500, {
                "error": "luku_add failed", "request_id": req_id,
            })
            return
        self._respond_json(200, {"success": True, **result})

    def handle_water_add(self):
        """Create a Water log entry + linked expense (+ reimburse) TX.

        Body: {date, property_id, total_price, account?, control_number?,
        meter?, note?}. Mirrors handle_luku_add for the simpler
        water-bill case (no kWh field).
        """
        body = self._read_json_body()
        try:
            result = utilities.add_water_entry(
                date=body["date"],
                property_id=body["property_id"],
                total_price=float(body["total_price"]),
                account=(body.get("account") or "").strip() or None,
                control_number=body.get("control_number", "").strip(),
                meter=body.get("meter", "").strip(),
                note=body.get("note", "").strip(),
            )
        except (KeyError, ValueError) as exc:
            self._respond_json(400, {"error": str(exc)})
            return
        except Exception as exc:
            req_id = secrets.token_hex(4)
            print(
                f"[serve] water_add req={req_id}: {type(exc).__name__}: {exc}",
                file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            self._respond_json(500, {
                "error": "water_add failed", "request_id": req_id,
            })
            return
        self._respond_json(200, {"success": True, **result})

    def handle_luku_update(self):
        """Edit a LUKU log entry. Body: {luku_id, ...partial fields}.

        Implementation cascades through utilities.update_luku_entry which
        delete-then-recreates so the TX import_id rotates cleanly when
        amount or account changes (no in-place TX edit pain).
        """
        body = self._read_json_body()
        luku_id = body.get("luku_id", "").strip()
        if not luku_id:
            self._respond_json(400, {"error": "luku_id is required"})
            return
        editable = (
            "date", "property_id", "units_kwh", "total_price",
            "account", "meter", "note",
        )
        new_fields = {}
        for k in editable:
            if k in body and body[k] not in (None, ""):
                new_fields[k] = body[k]
        try:
            result = utilities.update_luku_entry(luku_id, **new_fields)
        except ValueError as exc:
            self._respond_json(400, {"error": str(exc)})
            return
        self._respond_json(200, {"success": True, **result})

    def handle_water_update(self):
        """Edit a Water log entry. Body: {water_id, ...partial fields}."""
        body = self._read_json_body()
        water_id = body.get("water_id", "").strip()
        if not water_id:
            self._respond_json(400, {"error": "water_id is required"})
            return
        editable = (
            "date", "property_id", "total_price",
            "account", "control_number", "meter", "note",
        )
        new_fields = {}
        for k in editable:
            if k in body and body[k] not in (None, ""):
                new_fields[k] = body[k]
        try:
            result = utilities.update_water_entry(water_id, **new_fields)
        except ValueError as exc:
            self._respond_json(400, {"error": str(exc)})
            return
        self._respond_json(200, {"success": True, **result})

    def handle_luku_delete(self):
        """Delete a LUKU log entry by luku_id, cascading the linked TX(s).

        Body: {luku_id}. Cascade order is owned by utilities.delete_luku_entry:
        backup → reimburse-counter-entry (if pass-through) → expense TX →
        log row. Returns {tx_deleted, reimburse_deleted} so the dashboard
        can show what actually got removed.
        """
        body = self._read_json_body()
        luku_id = body.get("luku_id", "").strip()
        if not luku_id:
            self._respond_json(400, {"error": "luku_id is required"})
            return
        try:
            result = utilities.delete_luku_entry(luku_id)
        except ValueError as exc:
            self._respond_json(404, {"error": str(exc)})
            return
        self._respond_json(200, {"success": True, **result})

    def handle_water_delete(self):
        """Delete a Water log entry by water_id, cascading the linked TX(s)."""
        body = self._read_json_body()
        water_id = body.get("water_id", "").strip()
        if not water_id:
            self._respond_json(400, {"error": "water_id is required"})
            return
        try:
            result = utilities.delete_water_entry(water_id)
        except ValueError as exc:
            self._respond_json(404, {"error": str(exc)})
            return
        self._respond_json(200, {"success": True, **result})

    def handle_fuel_delete(self):
        """Delete a fuel entry by fuel_id, cascading the linked TX(s)."""
        body = self._read_json_body()
        fuel_id = body.get("fuel_id", "").strip()
        if not fuel_id:
            self._respond_json(400, {"error": "fuel_id is required"})
            return
        try:
            result = fuel.delete_fuel_entry(fuel_id)
        except ValueError as exc:
            self._respond_json(404, {"error": str(exc)})
            return
        self._respond_json(200, {"success": True, **result})

    # ── API: /api/setup/* — Web-Wizard (Block C.3) ────────────────────
    # Counterpart to scripts/setup.py CLI wizard. All three endpoints share
    # setup_core.run_setup() as the sole write layer; no duplicated logic.

    def handle_setup_status(self):
        """Report whether the repo has been initialized (gates the web wizard)."""
        import setup_core
        data_dir = REPO_ROOT / "data"
        state_file = data_dir / ".setup_state.json"
        tx_file = data_dir / "transactions.csv"

        initialized = False
        try:
            if state_file.exists():
                state = json.loads(state_file.read_text(encoding="utf-8"))
                initialized = state.get("initialized") is True
        except (OSError, json.JSONDecodeError):
            initialized = False

        # Hardened second guard: a populated transactions.csv means live data
        # exists even if the state file was wiped — refuse to overwrite.
        has_data = False
        try:
            if tx_file.exists() and tx_file.stat().st_size > 0:
                with tx_file.open("r", encoding="utf-8") as fh:
                    for i, _ in enumerate(fh):
                        if i >= 1:  # header + at least one data row
                            has_data = True
                            break
        except OSError:
            pass

        self._respond_json(200, {
            "initialized": initialized,
            "has_data": has_data,
            "default_currency": get_default("currency.default", "EUR"),
            "wizard_version": setup_core.WIZARD_VERSION,
            "account_types": setup_core.ACCOUNT_TYPES,
        })

    def handle_setup_mmex_upload(self):
        """Accept a base64-encoded .mmb upload, parse it, and stash staging on disk.

        Returns a staging summary plus a ``staging_id`` the client uses to call
        ``/api/setup/finalize``. Staging is written to ``tempfile.gettempdir()``
        so it survives across requests but is cleaned up on finalize.
        """
        import base64
        import tempfile
        import uuid

        if self._setup_refuse_if_initialized():
            return

        body = self._read_json_body()
        filename = (body.get("filename") or "upload.mmb").strip()
        content_b64 = body.get("content_b64", "")
        if not content_b64:
            self._respond_json(400, {"error": "content_b64 is required"})
            return

        try:
            blob = base64.b64decode(content_b64, validate=True)
        except Exception as e:
            self._respond_json(400, {"error": f"invalid base64: {e}"})
            return

        # 20 MB cap — .mmb files are typically <5 MB
        if len(blob) > 20 * 1024 * 1024:
            self._respond_json(413, {"error": "file too large (20 MB max)"})
            return

        # M-S2 (Sprint 16) — magic-byte check before handing the blob to
        # SQLite. Refuses obvious junk (HTML, zip, random text) up front,
        # avoids the cost of writing → opening → catching an obscure
        # sqlite3 error. The SQLite file format starts with the literal
        # bytes "SQLite format 3\x00" per https://sqlite.org/fileformat.html
        SQLITE_MAGIC = b"SQLite format 3\x00"
        if not blob.startswith(SQLITE_MAGIC):
            self._respond_json(400, {
                "error": "file does not look like a SQLite database (.mmb expected)",
            })
            return

        tmp_dir = Path(tempfile.gettempdir())
        mmb_path = tmp_dir / f"financeos-setup-{uuid.uuid4().hex}.mmb"
        try:
            mmb_path.write_bytes(blob)
            from importers.mmex import read_mmex
            staging = read_mmex(mmb_path)
        except Exception as e:
            self._respond_json(422, {"error": f"failed to read MMEX file: {e}"})
            return
        finally:
            try:
                mmb_path.unlink(missing_ok=True)
            except OSError:
                pass

        staging_id = uuid.uuid4().hex
        staging_path = tmp_dir / f"financeos-staging-{staging_id}.json"
        staging_path.write_text(
            json.dumps(staging, ensure_ascii=False),
            encoding="utf-8",
        )

        # Light-weight account preview for the alias-override UI in step 6.
        # Importer returns `currency_code`; expose under both keys so the
        # frontend keeps working whether it reads `currency_code` or `currency`.
        accounts_preview = []
        for acc in staging.get("accounts", []):
            cur_code = acc.get("currency_code", "") or acc.get("currency", "")
            accounts_preview.append({
                "id": acc.get("id"),
                "name": acc.get("name", ""),
                "currency": cur_code,
                "currency_code": cur_code,
                "type": acc.get("type", ""),
                "status": acc.get("status", ""),
            })

        # Categories preview for the new step-6 reports-config mapping. The
        # importer flattens parent/child via `full_path`; expose as `path` so
        # the frontend (reportsWizardCategories()) shows the user's actual
        # category names instead of falling back to EMPTY_START_CATEGORIES.
        categories_preview = []
        for cat in staging.get("categories", []):
            categories_preview.append({
                "id": cat.get("id"),
                "name": cat.get("name", ""),
                "path": cat.get("full_path") or cat.get("name", ""),
            })

        stats = staging.get("stats", {})
        self._respond_json(200, {
            "staging_id": staging_id,
            "filename": filename,
            "summary": {
                "accounts": stats.get("account_count", len(staging.get("accounts", []))),
                "categories": stats.get("category_count", len(staging.get("categories", []))),
                "payees": stats.get("payee_count", len(staging.get("payees", []))),
                "tags": stats.get("tag_count", len(staging.get("tags", []))),
                "transactions": stats.get("transaction_count", len(staging.get("transactions", []))),
                "currencies": stats.get("currency_counts", {}),
                "date_range": stats.get("date_range"),
            },
            "accounts": accounts_preview,
            "categories": categories_preview,
            "warnings": staging.get("warnings", []),
        })

    def handle_setup_finalize(self):
        """Run setup_core.run_setup() with the wizard config and optional staging."""
        import setup_core
        import tempfile

        if self._setup_refuse_if_initialized():
            return

        body = self._read_json_body()
        config = body.get("config") or {}
        staging_id = body.get("staging_id") or ""
        alias_overrides = body.get("account_alias_overrides") or {}
        # Per-account FinanceOS type override (key = mmex account id, value =
        # one of ACCOUNT_TYPE_KEYS). Optional companion: owner override
        # (key = id, value = name) and pass_through_payee override.
        type_overrides = body.get("account_type_overrides") or {}
        owner_overrides = body.get("account_owner_overrides") or {}
        pt_payee_overrides = body.get("account_pt_payee_overrides") or {}

        # Validate the config shape early (mirrors scripts/setup.py).
        for required in ("brand", "currency", "auth_mode", "datasource"):
            if required not in config:
                self._respond_json(400, {"error": f"missing config field: {required}"})
                return

        if config["datasource"] not in ("empty", "mmex"):
            self._respond_json(400, {"error": "datasource must be 'empty' or 'mmex'"})
            return

        staging = None
        staging_path: Path | None = None
        if config["datasource"] == "mmex":
            if not staging_id:
                self._respond_json(400, {"error": "MMEX datasource requires staging_id"})
                return
            staging_path = Path(tempfile.gettempdir()) / f"financeos-staging-{staging_id}.json"
            if not staging_path.exists():
                self._respond_json(404, {"error": "staging expired or unknown — re-upload"})
                return
            try:
                staging = json.loads(staging_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as e:
                self._respond_json(500, {"error": f"failed to read staging: {e}"})
                return

            # Apply per-account overrides on top of staging
            # (key = mmex account id, all string-keyed for JSON safety).
            if staging.get("accounts"):
                for acc in staging["accounts"]:
                    aid = str(acc.get("id"))
                    if alias_overrides.get(aid):
                        acc["preferred_alias"] = alias_overrides[aid].strip().lower()
                    if type_overrides.get(aid):
                        chosen = type_overrides[aid].strip().lower()
                        if chosen in setup_core.ACCOUNT_TYPE_KEYS:
                            acc["preferred_type"] = chosen
                    if owner_overrides.get(aid):
                        acc["preferred_owner"] = owner_overrides[aid].strip().lower() or "self"
                    if pt_payee_overrides.get(aid):
                        acc["preferred_pass_through_payee"] = pt_payee_overrides[aid].strip()

        try:
            result = setup_core.run_setup(
                config,
                root=REPO_ROOT,
                staging=staging,
            )
        except setup_core.SetupError as e:
            self._respond_json(409, {"error": str(e)})
            return
        except Exception as e:
            self._respond_json(500, {"error": f"setup failed: {e}"})
            return
        finally:
            if staging_path is not None:
                try:
                    staging_path.unlink(missing_ok=True)
                except OSError:
                    pass

        self._respond_json(200, {"ok": True, **result})

    def _setup_refuse_if_initialized(self) -> bool:
        """Return True (and respond 409) if the repo is already initialized."""
        data_dir = REPO_ROOT / "data"
        state_file = data_dir / ".setup_state.json"
        try:
            if state_file.exists():
                state = json.loads(state_file.read_text(encoding="utf-8"))
                if state.get("initialized") is True:
                    self._respond_json(409, {
                        "error": "already initialized",
                        "hint": f"Remove {state_file} to re-run setup.",
                    })
                    return True
        except (OSError, json.JSONDecodeError):
            pass

        # Second guard: refuse if transactions.csv has data rows.
        tx_file = data_dir / "transactions.csv"
        try:
            if tx_file.exists() and tx_file.stat().st_size > 0:
                with tx_file.open("r", encoding="utf-8") as fh:
                    for i, _ in enumerate(fh):
                        if i >= 1:
                            self._respond_json(409, {
                                "error": "live data detected (data/transactions.csv is non-empty)",
                                "hint": "Wipe data/ before running the setup wizard.",
                            })
                            return True
        except OSError:
            pass
        return False

    # ── API: Reports config (category mappings) ──────────────────────
    # Maps the 8 category-driven reports (Dining Out, Bills, AI, Vice,
    # Bank Fees, Cash Discrepancy, Automobile, Discretionary vs. Fixed)
    # to user-chosen category names. Frontend reads at boot, persists
    # edits via /save. Read returns the merged map (file overlay on
    # hardcoded defaults) so the UI can show effective values without a
    # second fetch.

    def handle_reports_config_get(self):
        """Return the effective reports config (file merged over defaults).

        Also reports `file_exists`, which the dashboard uses to decide
        whether to show the migration-banner for installs that skipped
        the 1.3.0 setup-step-6 (config/reports.json gets written there).
        """
        from config_loader import _REPORTS_PATH  # local import to avoid touching module-init
        self._respond_json(200, {
            "config": get_reports_config(),
            "file_exists": _REPORTS_PATH.exists(),
        })

    def handle_reports_config_save(self):
        """Replace config/reports.json with the posted body. Body: {config: {...}}."""
        body = self._read_json_body()
        cfg = body.get("config")
        if not isinstance(cfg, dict):
            self._respond_json(400, {"error": "config must be an object"})
            return
        try:
            save_reports_config(cfg)
        except (OSError, ValueError) as e:
            self._respond_json(500, {"error": f"failed to write reports config: {e}"})
            return
        # Best-effort git commit. Failure is non-fatal — the file is on
        # disk and will be picked up by the dashboard reload.
        try:
            tx_engine.git_commit("Reports config updated", ["config/reports.json"])
        except Exception:
            pass
        self._respond_json(200, {"ok": True, "config": get_reports_config()})

    # ── API: Auto-tag rules ──────────────────────────────────────────
    # Backs the Settings → Auto-Tags UI. Reads/writes the `auto_tag`
    # block in config/defaults.json. config_loader clears the
    # get_defaults() lru_cache on save so the next TX-write picks up
    # the new rules without a server restart.

    def handle_auto_tags_get(self):
        """Return the four auto-tag rule maps + the property cost_tags.

        The cost_tags list lets the UI populate the bridge target +
        category-prefix target dropdowns with valid Property_X tags
        without forcing the user to type them.
        """
        cost_tags = sorted(tx_engine._all_property_cost_tags())
        self._respond_json(200, {
            "config": get_auto_tags_config(),
            "property_cost_tags": cost_tags,
        })

    def handle_auto_tags_save(self):
        """Replace auto_tag block with the posted body. Body: {config: {...}}.

        Validation: only the four known sub-keys are honored; anything
        else is silently dropped to keep the file shape clean. Bridge
        targets are coerced to lists in case the UI sends scalars.
        """
        body = self._read_json_body()
        cfg = body.get("config")
        if not isinstance(cfg, dict):
            self._respond_json(400, {"error": "config must be an object"})
            return
        try:
            save_auto_tags_config(cfg)
        except (OSError, ValueError) as e:
            self._respond_json(500, {"error": f"failed to write auto-tags: {e}"})
            return
        try:
            tx_engine.git_commit("Auto-tag rules updated", ["config/defaults.json"])
        except Exception:  # noqa: BLE001
            # git commit is best-effort; file is on disk regardless.
            pass
        self._respond_json(200, {"ok": True, "config": get_auto_tags_config()})

    def handle_auto_tags_backfill_prefix(self):
        """Re-run category_prefix_tag_backfill on transactions.csv.

        Body: {dry_run: bool=true}. Returns the per-prefix summary so
        the dashboard can show "X TX, Y TZS retagged" feedback.
        """
        body = self._read_json_body()
        dry_run = bool(body.get("dry_run", True))
        try:
            import category_prefix_tag_backfill
            result = category_prefix_tag_backfill.backfill(dry_run=dry_run)
        except Exception as exc:  # noqa: BLE001
            req_id = secrets.token_hex(4)
            print(
                f"[serve] auto_tags_backfill req={req_id}: "
                f"{type(exc).__name__}: {exc}", file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            self._respond_json(500, {
                "error": "backfill failed", "request_id": req_id,
            })
            return
        if not dry_run and result.get("total_count"):
            try:
                tx_engine.git_commit(
                    f"Auto-tag backfill: {result['total_count']} rows retagged",
                    ["data/transactions.csv"],
                )
            except Exception:  # noqa: BLE001
                pass
        self._respond_json(200, {"ok": True, "dry_run": dry_run, **result})

    # ── API: FX history backfill ─────────────────────────────────────
    # Wraps scripts/fx_backfill.py so the dashboard can extend
    # data/fx_rates_history.csv on demand. The Settings → Currency tab
    # exposes a manual button; the Setup-Wizard fires it once after
    # finalize so fresh forks land with current rates without the user
    # needing to know the script exists.

    def handle_fx_backfill(self):
        """Kick off an FX backfill in the background. Body: { since?, until? }.

        Both bounds are optional — ``since`` defaults to "last CSV date + 1"
        (auto-detect), ``until`` defaults to today. The handler returns
        immediately with a job_id; the actual work runs in a daemon thread
        so the user can navigate away from the Settings page without losing
        progress, and a multi-year seed (which can take several minutes)
        does not tie up the HTTP keep-alive connection.

        Poll ``/api/fx/backfill/status`` with the returned ``job_id`` to
        watch progress and pick up the merge summary on completion.
        """
        from datetime import date, datetime

        body = self._read_json_body() or {}

        def _parse(field):
            raw = body.get(field)
            if not raw:
                return None
            try:
                return datetime.strptime(raw, "%Y-%m-%d").date()
            except (TypeError, ValueError):
                raise ValueError(f"{field} must be YYYY-MM-DD")

        try:
            since = _parse("since")
            until = _parse("until")
        except ValueError as e:
            self._respond_json(400, {"error": str(e)})
            return

        existing = fx_backfill._read_existing(fx_backfill.FX_HISTORY_PATH)
        if since is None:
            since = fx_backfill._detect_since(existing)
        if until is None:
            until = date.today()
        if since > until:
            self._respond_json(200, {
                "ok": True,
                "status": "done",
                "since": since.isoformat(), "until": until.isoformat(),
                "new_dates": 0, "updated_dates": 0, "total": len(existing),
                "note": "nothing to do",
            })
            return

        _fx_jobs_gc()
        job_id = f"fx-{int(time.time())}-{secrets.token_hex(4)}"
        with _fx_jobs_lock:
            _fx_jobs[job_id] = {
                "status": "running",
                "since": since.isoformat(),
                "until": until.isoformat(),
                "started_at": time.time(),
            }
        threading.Thread(target=_fx_run_job, args=(job_id, since, until), daemon=True).start()
        self._respond_json(202, {
            "ok": True,
            "status": "running",
            "job_id": job_id,
            "since": since.isoformat(),
            "until": until.isoformat(),
        })

    def handle_fx_backfill_status(self):
        """Return the current state of a backfill job. Body: { job_id }."""
        body = self._read_json_body() or {}
        job_id = body.get("job_id")
        if not job_id:
            self._respond_json(400, {"error": "job_id is required"})
            return
        with _fx_jobs_lock:
            job = _fx_jobs.get(job_id)
            snapshot = dict(job) if job else None
        if snapshot is None:
            self._respond_json(404, {"error": "job not found", "job_id": job_id})
            return
        snapshot["ok"] = True
        snapshot["job_id"] = job_id
        self._respond_json(200, snapshot)

    # ── API: Branding (display name + accent color) ──────────────────
    # Settings → Branding writes through here. The setup wizard populates
    # the same file via setup_core.write_branding on first install; this
    # endpoint lets users tweak the values later without re-running setup.

    def handle_branding_get(self):
        """Return the current config/branding.json content (or defaults)."""
        path = REPO_ROOT / "config" / "branding.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except (OSError, json.JSONDecodeError):
            data = {}
        self._respond_json(200, {
            "display_name": data.get("display_name", "FinanceOS"),
            "accent_color": data.get("accent_color", "#1e40af"),
            "fx_dashboard_url": data.get("fx_dashboard_url", ""),
        })

    def handle_branding_save(self):
        """Atomically rewrite config/branding.json from the posted body."""
        import re
        body = self._read_json_body()
        name = (body.get("display_name") or "").strip()
        accent = (body.get("accent_color") or "").strip()
        # Optional external FX dashboard URL. Empty string is allowed and
        # means "no link in sidebar". When set, must be http(s) — we do not
        # accept javascript: or other schemes since this lands in an <a href>.
        fx_url = (body.get("fx_dashboard_url") or "").strip()
        if not name:
            self._respond_json(400, {"error": "display_name is required"})
            return
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", accent):
            self._respond_json(400, {"error": "accent_color must be #rrggbb"})
            return
        if fx_url:
            if not re.match(r"^https?://", fx_url, re.IGNORECASE):
                self._respond_json(400, {"error": "fx_dashboard_url must start with http:// or https://"})
                return
            # L-S1 (Sprint 23) — refuse URL characters that would break
            # out of the sidebar link's href attribute or open a
            # protocol-confusion vector even after the scheme check.
            # The frontend renders this via escapeHtml so an XSS leak
            # is already blocked, but defense-in-depth catches obvious
            # tampering at the API boundary.
            if any(c in fx_url for c in ('"', "'", "<", ">", "\n", "\r", " ")):
                self._respond_json(400, {"error": "fx_dashboard_url contains disallowed characters"})
                return
        target = REPO_ROOT / "config" / "branding.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        # Mirror display_name into display_name_html so the sidebar logo
        # (data-brand-html binding) updates in lockstep with the title.
        payload = {"display_name": name, "display_name_html": name, "accent_color": accent, "fx_dashboard_url": fx_url}
        # Atomic write — temp + os.replace, mirrors save_reports_config.
        import tempfile
        tmp_fd, tmp_name = tempfile.mkstemp(dir=str(target.parent), prefix=f".{target.name}.", suffix=".tmp")
        try:
            with os.fdopen(tmp_fd, "w", encoding="utf-8", newline="") as f:
                json.dump(payload, f, indent=2, ensure_ascii=False)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_name, target)
        except Exception:
            try: Path(tmp_name).unlink()
            except OSError: pass
            raise
        try:
            tx_engine.git_commit("Branding updated", ["config/branding.json"])
        except Exception:
            pass
        self._respond_json(200, {"ok": True, **payload})

    # ── API: /api/metals/spot ─────────────────────────────────────────
    # Server-side proxy for goldprice.org. The dashboard previously fetched
    # this endpoint directly from the browser, but goldprice.org's CORS
    # policy refuses cross-origin reads from our Tailscale HTTPS origin
    # (and the workaround `Origin` header in the fetch config is silently
    # ignored — browsers don't let scripts spoof it). Routing through the
    # server eliminates the issue: cron_metals already does the same call
    # daily, we reuse its fetch_spot() helper. Output mirrors the
    # goldprice JSON shape so the frontend parser is unchanged. Cached
    # in-memory for 5 min so a dashboard reload spree doesn't hammer the
    # upstream.

    def handle_metals_spot(self):
        """Proxy goldprice.org spot prices, returning the upstream JSON shape."""
        import time
        import cron_metals

        cache = getattr(FinanceOSHandler, "_metals_spot_cache", None)
        now = time.time()
        if cache and (now - cache["ts"] < 300):
            self._respond_json(200, cache["data"])
            return
        try:
            gold_oz_eur, silver_oz_eur = cron_metals.fetch_spot()
        except Exception as e:
            req_id = secrets.token_hex(4)
            print(f"[serve] metals_spot req={req_id}: {type(e).__name__}: {e}",
                  file=sys.stderr)
            self._respond_json(502, {
                "error": "Upstream goldprice fetch failed",
                "request_id": req_id,
            })
            return
        payload = {"items": [{"xauPrice": gold_oz_eur, "xagPrice": silver_oz_eur}]}
        FinanceOSHandler._metals_spot_cache = {"ts": now, "data": payload}
        self._respond_json(200, payload)

    # ── API: /api/receipts ────────────────────────────────────────────

    def handle_receipts_upload(self):
        """Accept up to MAX_FILES_PER_REQUEST multipart-uploaded files.

        Body: multipart/form-data with one or more file parts named "files"
        (or anything else with a filename — the name attribute is ignored).
        Each file is byte-sniffed, validated against the MIME whitelist, and
        for images re-encoded as JPEG to drop EXIF/GPS metadata at the
        encoder boundary. PDFs are stored as-is.

        Response: {"saved": [{"url", "thumb_url", "mime", "kind", "size"}, …]}

        Per-file errors are reported in the "errors" array with a 207 status
        if some files succeeded and others failed, so a partial-batch user
        can still keep the successes. 400 = nothing usable, 500 = server bug.
        """
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype.lower():
            self._respond_json(400, {"error": "expected multipart/form-data"})
            return
        body = getattr(self, "_raw_body", b"")
        try:
            parts = receipts.parse_multipart(ctype, body)
        except ValueError as exc:
            self._respond_json(400, {"error": f"multipart parse failed: {exc}"})
            return
        if not parts:
            self._respond_json(400, {"error": "no files in request"})
            return
        if len(parts) > receipts.MAX_FILES_PER_REQUEST:
            self._respond_json(400, {
                "error": f"too many files (max {receipts.MAX_FILES_PER_REQUEST})",
            })
            return

        saved: list[dict] = []
        errors: list[dict] = []
        for part in parts:
            try:
                saved.append(receipts.store_upload(
                    filename=part["filename"],
                    content_type=part["content_type"],
                    data=part["data"],
                ))
            except ValueError as exc:
                errors.append({"filename": part.get("filename", ""), "error": str(exc)})
            except Exception as exc:  # unexpected — surface a request_id for log lookup
                req_id = secrets.token_hex(4)
                print(f"[serve] receipts_upload req={req_id}: {type(exc).__name__}: {exc}",
                      file=sys.stderr)
                errors.append({
                    "filename": part.get("filename", ""),
                    "error": f"server error (request_id={req_id})",
                })

        if saved and errors:
            status = 207  # Multi-Status — partial success, frontend keeps the saved ones
        elif saved:
            status = 200
        else:
            status = 400
        self._respond_json(status, {"saved": saved, "errors": errors})

    def handle_receipts_delete(self):
        """Remove receipt files + their thumbnails. Body: {"paths": ["/data/receipts/…", …]}.

        Idempotent — missing files are not an error. Path-traversal attempts
        return 200 with removed=0 rather than 4xx so a malicious actor learns
        nothing about what exists.
        """
        body = self._read_json_body() or {}
        paths = body.get("paths")
        if not isinstance(paths, list):
            self._respond_json(400, {"error": "paths must be an array"})
            return
        removed = receipts.delete_files([p for p in paths if isinstance(p, str)])
        self._respond_json(200, {"removed": removed})

    def handle_receipts_export(self):
        """Stream a ZIP of receipt files + index.csv back as a binary blob.

        Body: ``{"date_from": "YYYY-MM-DD", "date_to": "YYYY-MM-DD",
                 "account": "<alias>", "tag": "<tag>",
                 "only_with_receipts": true}``

        Synchronous (single-user app, tempfile-backed so memory stays
        bounded).

        Hardening (Sprint 7, H-03):
          - Single-flight lock: a second call while one export is in flight
            gets HTTP 429 instead of two ZIPs racing on tempdir + disk.
          - Pre-scan size cap: walk the matching receipt files first and
            sum their sizes; refuse upfront if they would exceed
            RECEIPTS_EXPORT_MAX_BYTES. Without this a date-range that
            happens to cover years of attached photos would silently
            balloon the tempfile.
        """
        body = self._read_json_body() or {}
        df = (body.get("date_from") or "").strip()
        dt = (body.get("date_to") or "").strip()
        if not df or not dt:
            self._respond_json(400, {"error": "date_from and date_to are required"})
            return
        if df > dt:
            self._respond_json(400, {"error": "date_from must be <= date_to"})
            return
        account = (body.get("account") or "").strip()
        tag = (body.get("tag") or "").strip()
        only_with = bool(body.get("only_with_receipts", True))

        # ── H-03 (Sprint 7) — single-flight gate ────────────────────────
        if not _receipts_export_lock.acquire(blocking=False):
            self._respond_json(429, {
                "error": "Another receipts export is already running. Try again in a moment.",
            })
            return

        try:
            import csv as _csv
            tx_path = tx_engine.DATA_DIR / "transactions.csv"
            try:
                with tx_path.open("r", newline="", encoding="utf-8") as f:
                    tx_rows = list(_csv.DictReader(f))
            except Exception as exc:
                req_id = secrets.token_hex(4)
                print(f"[serve] receipts_export load req={req_id}: {type(exc).__name__}: {exc}",
                      file=sys.stderr)
                self._respond_json(500, {"error": "load transactions failed", "request_id": req_id})
                return

            # ── H-03 — pre-scan source-file bytes ──────────────────────
            # Walks the same selection logic build_export_zip uses, but
            # only sums on-disk file sizes. ZIP compression makes the
            # final archive smaller, so a cap on raw bytes is a strict
            # upper bound — if we pass this gate the produced ZIP is
            # always <= cap.
            try:
                src_total = self._estimate_receipts_export_bytes(
                    tx_rows, df, dt, account, tag, only_with,
                )
            except Exception as exc:
                req_id = secrets.token_hex(4)
                print(f"[serve] receipts_export scan req={req_id}: {type(exc).__name__}: {exc}",
                      file=sys.stderr)
                self._respond_json(500, {"error": "pre-scan failed", "request_id": req_id})
                return
            if src_total > RECEIPTS_EXPORT_MAX_BYTES:
                self._respond_json(413, {
                    "error": "Receipts export would exceed the size cap",
                    "limit_bytes": RECEIPTS_EXPORT_MAX_BYTES,
                    "observed_source_bytes": src_total,
                })
                return

            try:
                zip_path, stats = receipts.build_export_zip(
                    tx_rows,
                    date_from=df,
                    date_to=dt,
                    account=account,
                    tag=tag,
                    only_with_receipts=only_with,
                )
            except Exception as exc:
                req_id = secrets.token_hex(4)
                print(f"[serve] receipts_export build req={req_id}: {type(exc).__name__}: {exc}",
                      file=sys.stderr)
                self._respond_json(500, {"error": "build_export_zip failed", "request_id": req_id})
                return

            # Stream the ZIP back chunked so a 500 MB year-export doesn't
            # have to live in memory twice (once for the ZIP, once for the
            # response buffer). Always unlink the tempfile in finally so
            # interrupted downloads don't leak.
            try:
                size = zip_path.stat().st_size
                filename = f"receipts_{df}_{dt}.zip"
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Length", str(size))
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                # Surface the counts in headers so the frontend can show a
                # "Exported 23 TXs, 47 files (5.2 MB)" toast without parsing
                # the ZIP itself.
                self.send_header("X-Tx-Count", str(stats["tx_count"]))
                self.send_header("X-File-Count", str(stats["file_count"]))
                self._send_cors_origin()
                self.end_headers()
                with zip_path.open("rb") as zf:
                    while True:
                        chunk = zf.read(64 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
            finally:
                try:
                    zip_path.unlink()
                except OSError:
                    pass
        finally:
            _receipts_export_lock.release()

    def _estimate_receipts_export_bytes(
        self, tx_rows: list, date_from: str, date_to: str,
        account: str, tag: str, only_with_receipts: bool,
    ) -> int:
        """Sum the on-disk size of receipt files a build_export_zip() call
        would include, without building anything. Mirrors the filter logic
        in receipts.build_export_zip — used by handle_receipts_export to
        enforce RECEIPTS_EXPORT_MAX_BYTES upfront.
        """
        total = 0
        for tx in tx_rows or []:
            d = (tx.get("date") or "").strip()
            if not d or d < date_from or d > date_to:
                continue
            if account and tx.get("account") != account:
                continue
            if tag:
                tags = [t.strip() for t in (tx.get("tags") or "").split(";") if t.strip()]
                if tag not in tags:
                    continue
            urls = [u.strip() for u in (tx.get("receipt_url") or "").split(";") if u.strip()]
            if only_with_receipts and not urls:
                continue
            for url in urls:
                src = receipts._safe_url_to_path(url)
                if src and src.exists():
                    try:
                        total += src.stat().st_size
                    except OSError:
                        pass
        return total

    def handle_receipts_stats(self):
        """Coverage + storage KPIs for the Settings → Receipts tab.

        Body (optional): ``{"limit": int, "thresholds": {"TZS": 50000, …}}``.
        Defaults are reasonable for a typical multi-currency setup — see
        ``receipts.DEFAULT_RECEIPT_THRESHOLDS``. Response carries both the
        KPIs and the top-N missing-receipts list so the dashboard can render
        the tab from a single round-trip.
        """
        body = self._read_json_body() or {}
        limit = body.get("limit", 50)
        try:
            limit = max(1, min(500, int(limit)))
        except (TypeError, ValueError):
            limit = 50
        thresholds = body.get("thresholds")
        if not isinstance(thresholds, dict):
            thresholds = None
        # Load TX rows inline — tx_engine has no top-level helper, and the
        # other endpoints follow the same pattern (DictReader on the CSV).
        import csv as _csv
        tx_path = tx_engine.DATA_DIR / "transactions.csv"
        try:
            with tx_path.open("r", newline="", encoding="utf-8") as f:
                tx_rows = list(_csv.DictReader(f))
        except Exception as exc:
            req_id = secrets.token_hex(4)
            print(f"[serve] receipts_stats req={req_id}: {type(exc).__name__}: {exc}",
                  file=sys.stderr)
            self._respond_json(500, {"error": "load transactions failed", "request_id": req_id})
            return
        stats = receipts.compute_stats(tx_rows)
        missing = receipts.missing_receipts(tx_rows, thresholds=thresholds, limit=limit)
        self._respond_json(200, {"stats": stats, "missing": missing})

    # ── API: /api/health ──────────────────────────────────────────────

    def handle_health(self):
        """Return server health status: hostname, git info, uptime, Pi check.

        L-P5 (Sprint 24) — endpoint is auth-exempt (PWA findPi() probe
        + Tailscale monitoring both need it unauthenticated). When the
        server runs in `auth.mode=basic` AND the caller did not send
        valid credentials, return a minimal `{"ok": true}` instead of
        the full info dict. Authenticated callers (dashboard footer,
        PWA after login) still get app_version, git status, data size,
        etc. so the existing UI keeps working.
        """
        import platform
        import subprocess
        from datetime import datetime

        # Minimal payload for unauth callers when auth is required.
        if auth.is_auth_required():
            hdr = self.headers.get("Authorization", "")
            creds = auth._decode_basic(hdr)
            if not (creds is not None and auth.verify_credentials(*creds)):
                self._respond_json(200, {"ok": True})
                return

        info = {
            "hostname": platform.node(),
            "platform": platform.system(),
            "server_time": datetime.now().isoformat(timespec='seconds'),
            "app_version": _read_app_version(),
        }

        # Git status
        try:
            repo = tx_engine.DATA_DIR.parent
            # Suppress Windows console flash on each git child (no-op on POSIX).
            no_win = {"creationflags": 0x08000000} if sys.platform == "win32" else {}
            last_commit = subprocess.check_output(
                ["git", "log", "-1", "--format=%h %s (%cr)"],
                cwd=str(repo), timeout=5, stderr=subprocess.DEVNULL,
                **no_win,
            ).decode().strip()
            info["git_last_commit"] = last_commit

            status_out = subprocess.check_output(
                ["git", "status", "--porcelain"],
                cwd=str(repo), timeout=5, stderr=subprocess.DEVNULL,
                **no_win,
            ).decode().strip()
            info["git_clean"] = len(status_out) == 0
            info["git_dirty_files"] = len(status_out.splitlines()) if status_out else 0
        except Exception as e:
            info["git_error"] = str(e)

        # Data directory size
        try:
            data_dir = tx_engine.DATA_DIR
            total_bytes = sum(f.stat().st_size for f in data_dir.rglob("*") if f.is_file())
            if total_bytes < 1024 * 1024:
                info["data_size"] = f"{total_bytes / 1024:.1f} KB"
            else:
                info["data_size"] = f"{total_bytes / (1024 * 1024):.1f} MB"
            info["data_files"] = sum(1 for f in data_dir.rglob("*") if f.is_file())
        except Exception:
            pass

        # Detect if running on Pi.
        # Primary signal: env var FINANCEOS_HOST_TYPE=pi (explicit, set in systemd unit).
        # Fallback signal: hostname matches one of config/defaults.json:host.pi_hostnames
        # (so existing Pi installs keep working without needing the env var).
        host_type_env = os.environ.get("FINANCEOS_HOST_TYPE", "").strip().lower()
        if host_type_env == "pi":
            info["is_pi"] = True
        else:
            pi_hostnames = get_default("host.pi_hostnames", []) or []
            if isinstance(pi_hostnames, list) and platform.node().lower() in {h.lower() for h in pi_hostnames}:
                info["is_pi"] = True

        self._respond_json(200, info)

    # ── API: /api/tx/update ───────────────────────────────────────────

    def handle_tx_update(self):
        """Edit fields of an existing transaction (identified by import_id).

        Validates account/category before writing. Creates backup before
        modifying transactions.csv.
        """
        body = self._read_json_body()
        import_id = body.get("import_id", "")
        updated = body.get("updated", {})

        if not import_id:
            self._respond_json(400, {"error": "import_id is required"})
            return
        if not updated:
            self._respond_json(400, {"error": "No fields to update"})
            return

        # Validate updated fields
        accounts = tx_engine.load_accounts()
        categories = tx_engine.load_categories()
        if "account" in updated and updated["account"] not in accounts:
            self._respond_json(400, {"error": f"Unknown account: '{updated['account']}'"})
            return
        if "category" in updated and updated["category"] and updated["category"] not in categories:
            self._respond_json(400, {"error": f"Unknown category: '{updated['category']}'"})
            return

        # subscription_id is not a TX column; pop it out of `updated`
        # and handle the link mutation separately so update_transaction
        # never tries to write it to transactions.csv. None means
        # "field not present in the request" (preserve existing link);
        # empty string means "explicitly unlink".
        sub_id_change = updated.pop("subscription_id", None)

        # property_id is also not a TX column — it materializes as the
        # property's cost_tag inside the `tags` field. When the picker
        # changed selection, rewrite the tags string here: drop any
        # previously-attached property tag, then add the new one (if
        # any). None = picker not touched, "" = explicit unlink.
        property_id_change = updated.pop("property_id", None)
        if property_id_change is not None:
            existing_tx = tx_engine.load_transaction_by_id(import_id) or {}
            base_tags_str = updated.get("tags", existing_tx.get("tags", "") or "")
            current_tags = [t for t in base_tags_str.split(";") if t]
            known_prop_tags = tx_engine._all_property_cost_tags()
            cleaned = [t for t in current_tags if t not in known_prop_tags]
            new_pid = (property_id_change or "").strip()
            if new_pid:
                new_tag = tx_engine._resolve_property_cost_tag(new_pid)
                if not new_tag:
                    self._respond_json(400, {
                        "error": f"Unknown property: '{new_pid}'",
                    })
                    return
                if new_tag not in cleaned:
                    cleaned.append(new_tag)
            updated["tags"] = ";".join(cleaned)

        # Backup
        try:
            backup.backup_file("transactions", tx_engine.DATA_DIR / "transactions.csv")
        except Exception as e:
            self._respond_json(500, {"error": f"Backup failed: {e}"})
            return

        # Update transactions.csv. When the only change was
        # subscription_id (popped above), `updated` is empty and we
        # skip the rewrite — but still verify the TX exists so a stray
        # subscription_log row cannot point at a non-existent TX.
        if updated:
            if not tx_engine.update_transaction(import_id, updated):
                self._respond_json(404, {"error": f"Transaction '{import_id}' not found"})
                return
        elif sub_id_change is not None:
            if tx_engine.load_transaction_by_id(import_id) is None:
                self._respond_json(404, {"error": f"Transaction '{import_id}' not found"})
                return

        # Apply subscription-link mutation if requested.
        sub_log_changed = False
        if sub_id_change is not None:
            existing_link = subscriptions.find_log_by_tx(import_id)
            new_sub_id = (sub_id_change or "").strip()
            current_sub_id = (existing_link or {}).get("subscription_id", "")
            if new_sub_id != current_sub_id:
                try:
                    backup.backup_file(
                        "subscription_log",
                        tx_engine.DATA_DIR / "subscription_log.csv",
                    )
                except Exception as e:
                    self._respond_json(500, {
                        "error": f"subscription_log backup failed: {e}",
                    })
                    return
                # Always unlink old (no-op if none) before linking new.
                if existing_link:
                    subscriptions.unlink_tx(import_id)
                    sub_log_changed = True
                if new_sub_id:
                    # Pull the persisted TX so the log mirrors what's
                    # actually in transactions.csv after the edit
                    # (account / amount might have just changed).
                    persisted = tx_engine.load_transaction_by_id(import_id) or {}
                    subscriptions.append_subscription_log({
                        "date": persisted.get("date", ""),
                        "subscription_id": new_sub_id,
                        "amount": persisted.get("amount", ""),
                        "currency": persisted.get("currency", ""),
                        "account": persisted.get("account", ""),
                        "tx_import_id": import_id,
                        "note": "",
                    })
                    sub_log_changed = True

        # Git commit
        summary = updated.get("payee", "") or updated.get("category", "") or "fields updated"
        commit_files = ["data/transactions.csv"]
        if sub_log_changed:
            commit_files.append("data/subscription_log.csv")
        git_ok = tx_engine.git_commit(
            f"TX edit: {import_id} ({summary})", files=commit_files,
        )

        self._respond_json(200, {
            "success": True,
            "import_id": import_id,
            "git_committed": git_ok,
        })

    # ── API: /api/tx/delete ───────────────────────────────────────────

    def handle_tx_delete(self):
        """Delete a transaction by import_id. Creates backup before modifying."""
        body = self._read_json_body()
        import_id = body.get("import_id", "")

        if not import_id:
            self._respond_json(400, {"error": "import_id is required"})
            return

        # Backup
        try:
            backup.backup_file("transactions", tx_engine.DATA_DIR / "transactions.csv")
        except Exception as e:
            self._respond_json(500, {"error": f"Backup failed: {e}"})
            return

        # Look up subscription-link before the delete so we can cascade.
        # Cascade rationale: a subscription_log row pointing at a TX that
        # no longer exists is an orphan — the same shape we already
        # detect in fuel_log reconciliation. Removing it up front is
        # cheaper than running a sweep later.
        sub_link = subscriptions.find_log_by_tx(import_id)
        if sub_link:
            try:
                backup.backup_file(
                    "subscription_log",
                    tx_engine.DATA_DIR / "subscription_log.csv",
                )
            except Exception as e:
                self._respond_json(500, {
                    "error": f"subscription_log backup failed: {e}",
                })
                return

        # Delete
        if not tx_engine.delete_transaction(import_id):
            self._respond_json(404, {"error": f"Transaction '{import_id}' not found"})
            return

        if sub_link:
            subscriptions.unlink_tx(import_id)

        # Git commit
        commit_files = ["data/transactions.csv"]
        if sub_link:
            commit_files.append("data/subscription_log.csv")
        git_ok = tx_engine.git_commit(
            f"TX delete: {import_id}", files=commit_files,
        )

        self._respond_json(200, {
            "success": True,
            "import_id": import_id,
            "git_committed": git_ok,
        })


    # ── API: /api/tx/batch-delete ────────────────────────────────────────

    def handle_tx_batch_delete(self):
        """Delete multiple transactions by import_id list."""
        body = self._read_json_body()
        import_ids = body.get("import_ids", [])

        if not import_ids or not isinstance(import_ids, list):
            self._respond_json(400, {"error": "import_ids (list) is required"})
            return

        # Backup
        try:
            backup.backup_file("transactions", tx_engine.DATA_DIR / "transactions.csv")
        except Exception as e:
            self._respond_json(500, {"error": f"Backup failed: {e}"})
            return

        deleted = tx_engine.batch_delete_transactions(import_ids)
        if deleted == 0:
            self._respond_json(404, {"error": "No matching transactions found"})
            return

        git_ok = tx_engine.git_commit(f"TX batch delete: {deleted} transactions")
        self._respond_json(200, {
            "success": True,
            "deleted": deleted,
            "git_committed": git_ok,
        })

    # ── API: /api/tx/batch-tag ───────────────────────────────────────────

    def handle_tx_batch_tag(self):
        """Add/remove tags on multiple transactions."""
        body = self._read_json_body()
        import_ids = body.get("import_ids", [])
        add_tags = body.get("add_tags", [])
        remove_tags = body.get("remove_tags", [])

        if not import_ids or not isinstance(import_ids, list):
            self._respond_json(400, {"error": "import_ids (list) is required"})
            return
        if not add_tags and not remove_tags:
            self._respond_json(400, {"error": "add_tags or remove_tags required"})
            return

        # Backup
        try:
            backup.backup_file("transactions", tx_engine.DATA_DIR / "transactions.csv")
        except Exception as e:
            self._respond_json(500, {"error": f"Backup failed: {e}"})
            return

        modified = tx_engine.batch_update_tags(import_ids, add_tags, remove_tags)
        if modified == 0:
            self._respond_json(404, {"error": "No transactions modified"})
            return

        summary = []
        if add_tags:
            summary.append(f"+{','.join(add_tags)}")
        if remove_tags:
            summary.append(f"-{','.join(remove_tags)}")
        git_ok = tx_engine.git_commit(f"TX batch tag: {modified} transactions ({' '.join(summary)})")
        self._respond_json(200, {
            "success": True,
            "modified": modified,
            "git_committed": git_ok,
        })


# ── Server Utilities ────────────────────────────────────────────────────────


def is_port_in_use(port: int) -> bool:
    """Check if a TCP port is already bound (another server instance running)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def open_browser(url: str, delay: float = 0.5) -> None:
    """Open the dashboard URL in the default browser after a short delay.

    Runs in a daemon thread so the server starts immediately without
    waiting for the browser to launch.
    """
    def _open():
        time.sleep(delay)
        try:
            webbrowser.open(url)
        except Exception as e:
            print(f"[warn] Konnte Browser nicht öffnen: {e}")

    threading.Thread(target=_open, daemon=True).start()


def _run_with_reload(child_argv: list[str]) -> int:
    """Parent-mode for `--reload`: watch `scripts/` and respawn the server
    child whenever a `.py` file changes.

    The child runs the same `serve.py` invocation with `FINANCEOS_RELOAD_CHILD=1`
    set so it skips this branch and goes straight into the normal HTTP loop.
    Only Python files trigger a restart — JS / CSS / HTML are served live by
    the running process and never need a reload.
    """
    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler
    except ImportError:
        print(
            "[err] --reload requires the `watchdog` package.\n"
            "      Install with: pip install watchdog",
            file=sys.stderr,
        )
        return 1

    import subprocess
    import threading

    pending_restart = threading.Event()

    def spawn_child() -> subprocess.Popen:
        env = os.environ.copy()
        env["FINANCEOS_RELOAD_CHILD"] = "1"
        cmd = [sys.executable, str(Path(__file__).resolve())] + list(child_argv)
        return subprocess.Popen(cmd, env=env)

    class _Handler(FileSystemEventHandler):
        def on_modified(self, event):
            if not event.is_directory and event.src_path.endswith(".py"):
                pending_restart.set()

        def on_created(self, event):
            if not event.is_directory and event.src_path.endswith(".py"):
                pending_restart.set()

    observer = Observer()
    observer.schedule(_Handler(), str(SCRIPTS_DIR), recursive=True)
    observer.start()

    print(f"[reload] Watching {SCRIPTS_DIR} for *.py changes — Ctrl+C to stop.")
    child = spawn_child()

    try:
        while True:
            if pending_restart.wait(timeout=1.0):
                # Debounce: editors often save in two writes (truncate + flush)
                # so we wait briefly and then drain everything queued in that
                # window into a single restart.
                time.sleep(0.3)
                pending_restart.clear()
                print("[reload] Python file changed — restarting server…")
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
                child = spawn_child()
            elif child.poll() is not None:
                # Child exited on its own (crash / clean shutdown). Mirror its
                # exit code so the parent doesn't keep an orphan process tree.
                return child.returncode or 0
    except KeyboardInterrupt:
        print("\n[reload] Stopping…")
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
    finally:
        observer.stop()
        observer.join()
    return 0


# H-31 (Sprint 15) — Pi-venv-sync hazard. Parses requirements.txt at
# boot, walks each non-commented entry, asks importlib.metadata what is
# actually installed, and prints a [warn] block whenever an installed
# version doesn't satisfy the requirement (or is missing entirely).
# Tolerates: blank lines, inline comments (`pkg ... # note`), and the
# commented-out optional dev deps (watchdog / apscheduler / pytest)
# which are intentionally absent on production Pi.

_PEP440_SPLIT = _re.compile(r"\s*(>=|<=|==|!=|~=|>|<)\s*")


def _parse_requirement_spec(line: str) -> tuple[str, list[tuple[str, str]]] | None:
    """Return (dist_name, [(op, version), ...]) or None for skip-this-line."""
    stripped = line.split("#", 1)[0].strip()
    if not stripped:
        return None
    # Crude PEP-508 split: name is everything up to the first comparator.
    m = _re.match(r"^([A-Za-z0-9_.\-]+)", stripped)
    if not m:
        return None
    name = m.group(1).lower().replace("_", "-")
    rest = stripped[len(name):].strip()
    if not rest:
        return name, []
    specs: list[tuple[str, str]] = []
    for part in rest.split(","):
        sm = _re.match(r"\s*(>=|<=|==|!=|~=|>|<)\s*([0-9A-Za-z.\-+]+)\s*$", part)
        if not sm:
            continue
        specs.append((sm.group(1), sm.group(2)))
    return name, specs


def _version_tuple(v: str) -> tuple:
    """Loose-but-stable version compare. Handles `12.1.1`, `4.0`, etc."""
    parts = []
    for chunk in _re.split(r"[.\-+]", v):
        try:
            parts.append((0, int(chunk)))
        except ValueError:
            parts.append((1, chunk))
    return tuple(parts)


def _satisfies(installed: str, specs: list[tuple[str, str]]) -> bool:
    if not specs:
        return True
    iv = _version_tuple(installed)
    for op, ver in specs:
        rv = _version_tuple(ver)
        ok = {
            ">=": iv >= rv,
            "<=": iv <= rv,
            "==": iv == rv,
            "!=": iv != rv,
            ">": iv > rv,
            "<": iv < rv,
            "~=": iv >= rv and iv[:1] == rv[:1],
        }.get(op, True)
        if not ok:
            return False
    return True


def _check_requirements_drift() -> None:
    """Compare requirements.txt entries against importlib.metadata. Prints
    a stderr [warn] block on drift; returns silently when everything is
    in sync."""
    from importlib import metadata as _md

    req_path = Path(__file__).parent.parent / "requirements.txt"
    if not req_path.exists():
        return

    drift: list[str] = []
    missing: list[str] = []

    for raw in req_path.read_text(encoding="utf-8").splitlines():
        parsed = _parse_requirement_spec(raw)
        if not parsed:
            continue
        name, specs = parsed
        try:
            installed = _md.version(name)
        except _md.PackageNotFoundError:
            missing.append(f"{name} (spec: {raw.strip()})")
            continue
        if not _satisfies(installed, specs):
            spec_str = ",".join(f"{op}{v}" for op, v in specs)
            drift.append(f"{name}: installed {installed} does not satisfy {spec_str}")

    if not drift and not missing:
        return
    print(
        "[warn] requirements.txt drift detected — likely a deploy that "
        "bumped the file without re-running `pip install -r requirements.txt` "
        "in the active venv:",
        file=sys.stderr,
    )
    for line in drift:
        print(f"  - {line}", file=sys.stderr)
    for line in missing:
        print(f"  - MISSING: {line}", file=sys.stderr)


def main() -> int:
    """Parse CLI args and start the HTTP server.

    If the port is already in use, assumes another instance is running
    and just opens the browser to the existing server.
    """
    parser = argparse.ArgumentParser(description="FinanceOS Dashboard HTTP-Server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Port (Default: {DEFAULT_PORT})")
    parser.add_argument("--no-open", action="store_true", help="Browser nicht automatisch öffnen")
    parser.add_argument("--bind", default=DEFAULT_BIND, help=f"Bind-Adresse (Default: {DEFAULT_BIND}, fuer Netzwerk: 0.0.0.0)")
    parser.add_argument("--source", choices=["preview", "live"], default="live",
                        help="Default-Datenquelle fürs Dashboard (preview oder live)")
    parser.add_argument("--reload", action="store_true",
                        help="Auto-Reload des Servers bei Python-Code-Änderungen (Dev-Loop, requires watchdog).")
    args = parser.parse_args()

    # `--reload` runs us as a parent supervisor that respawns the actual
    # server child on every .py change. The child is detected via the env
    # var so it never re-enters this branch.
    if args.reload and not os.environ.get("FINANCEOS_RELOAD_CHILD"):
        child_argv = [a for a in sys.argv[1:] if a != "--reload"]
        return _run_with_reload(child_argv)

    url = f"http://localhost:{args.port}{DASHBOARD_PATH}?source={args.source}"

    if is_port_in_use(args.port):
        print(f"[info] Port {args.port} ist schon belegt — vermutlich läuft bereits ein Server.")
        print(f"[info] Öffne Dashboard im Browser: {url}")
        if not args.no_open:
            open_browser(url, delay=0.0)
            time.sleep(1.0)
        return 0

    os.chdir(REPO_ROOT)

    print()
    print(f"  FinanceOS Dashboard Server")
    print(f"  URL:   {url}")
    print(f"  Root:  {REPO_ROOT}")
    print(f"  Stop:  Ctrl+C")
    print()

    if not args.no_open:
        open_browser(url)

    # M-B6 (Sprint 17) — invariant check: every type=pass_through account
    # must declare a non-empty pass_through_payee. Without it,
    # generate_pass_through_line silently returns None for expenses on
    # the account and the auto-reimbursement disappears. Warn-only at
    # boot so the operator can fix in Settings → Accounts; never fail
    # boot here either.
    try:
        for _alias, _acc in tx_engine.load_accounts().items():
            if (_acc.get("type") or "").strip() == "pass_through":
                if not (_acc.get("pass_through_payee") or "").strip():
                    print(
                        f"[warn] account '{_alias}' is type=pass_through but has empty "
                        f"pass_through_payee — its auto-reimbursement counter-entries "
                        f"will be skipped silently. Set the field in Settings → Accounts.",
                        file=sys.stderr,
                    )
    except Exception as exc:  # noqa: BLE001 — never break boot
        print(f"[warn] pass_through_payee invariant check failed: {exc}", file=sys.stderr)

    # H-31 (Sprint 15) — venv drift check. The Pi has burned once on a
    # silent ImportError (bcrypt) after a deploy that bumped
    # requirements.txt but didn't `pip install -r` in the active venv.
    # We don't fail boot here (broken deps still let the user reach a
    # Settings UI to fix the venv); we just print a stderr [warn] block
    # listing every requirement whose installed version doesn't satisfy
    # the spec, and every required dist that isn't installed at all.
    try:
        _check_requirements_drift()
    except Exception as exc:  # noqa: BLE001 — never break boot
        print(f"[warn] requirements drift check failed: {exc}", file=sys.stderr)

    # H-29 (Sprint 11) — validate the on-disk auto_tag config at boot so
    # a typo from a hand-edit of defaults.json surfaces in the server
    # log instead of silently turning into a no-op auto-tag rule. We
    # only warn (never fail boot) because a broken auto_tag block must
    # not prevent the user from reaching the Settings UI to fix it.
    try:
        import config_loader as _cfg_loader_mod
        _at_errors = _cfg_loader_mod.validate_auto_tag_config(
            _cfg_loader_mod.get_default("auto_tag", {}) or {}
        )
        if _at_errors:
            print(
                f"[warn] config/defaults.json:auto_tag has {len(_at_errors)} validation issue(s):",
                file=sys.stderr,
            )
            for err in _at_errors:
                print(f"  - {err}", file=sys.stderr)
            print(
                "[warn] Auto-tag rules with invalid keys/shape will be skipped at runtime. "
                "Fix in Settings → Auto-Tags or edit config/defaults.json directly.",
                file=sys.stderr,
            )
    except Exception as exc:  # noqa: BLE001 — must never break boot
        print(f"[warn] auto-tag validation failed: {exc}", file=sys.stderr)

    # Built-in scheduler — replaces host-cron wiring on Docker / Synology /
    # Unraid setups. Bare-metal Pi falls back to host crontab unless the
    # operator opts in via env or config. No-op if apscheduler is missing.
    try:
        import scheduler as _scheduler_mod  # noqa: F401 — local module
        _scheduler_mod.start_scheduler()
    except Exception as exc:  # noqa: BLE001 — scheduler must never break boot
        print(f"[warn] scheduler init failed: {exc}", file=sys.stderr)

    try:
        with http.server.ThreadingHTTPServer((args.bind, args.port), FinanceOSHandler) as httpd:
            httpd.daemon_threads = True
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\n[ok] Server gestoppt.")
    except OSError as e:
        print(f"[err] Server konnte nicht gestartet werden: {e}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
