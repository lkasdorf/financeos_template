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

API endpoint groups (38 endpoints total):
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
import tx_engine
from config_loader import get_default, is_enabled

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
    "/api/fuel/list": "vehicles",
    "/api/fuel/add": "vehicles",
    "/api/fuel/update": "vehicles",
    "/api/fuel/delete": "vehicles",
    "/api/fuel/recon/dismiss": "vehicles",
    "/api/fuel/recon/undismiss": "vehicles",
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
        # Block the metals data files so the dashboard can't load them either.
        if (self.path.startswith("/data/metals_portfolio")
                or self.path.startswith("/data/metal_price_history")) and not is_enabled("metals"):
            self.send_error(404, "Metals feature disabled")
            return
        super().do_GET()

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
        self._raw_body = self.rfile.read(content_length) if content_length > 0 else b""
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
            "/api/accounts/update": self.handle_accounts_update,
            "/api/accounts/rename": self.handle_accounts_rename,
            "/api/backup/create": self.handle_backup_create,
            "/api/backup/list": self.handle_backup_list,
            "/api/backup/export": self.handle_backup_export,
            "/api/recon/files": self.handle_recon_files,
            "/api/recon/suggestions": self.handle_recon_suggestions,
            "/api/recon/adapters": self.handle_recon_adapters,
            "/api/vehicles/list": self.handle_vehicles_list,
            "/api/fuel/list": self.handle_fuel_list,
            "/api/fuel/add": self.handle_fuel_add,
            "/api/fuel/update": self.handle_fuel_update,
            "/api/fuel/delete": self.handle_fuel_delete,
            "/api/fuel/recon/dismiss": self.handle_fuel_recon_dismiss,
            "/api/fuel/recon/undismiss": self.handle_fuel_recon_undismiss,
            "/api/setup/status": self.handle_setup_status,
            "/api/setup/mmex-upload": self.handle_setup_mmex_upload,
            "/api/setup/finalize": self.handle_setup_finalize,
            "/api/health": self.handle_health,
            "/api/metals/spot": self.handle_metals_spot,
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

        # Append to transactions.csv
        try:
            tx_engine.append_transactions(lines)
        except Exception as e:
            self._respond_json(500, {"error": f"CSV write failed: {e}"})
            return

        # Mark the prompt_log entry as successfully booked
        tx_engine.mark_prompt_booked(prompt_id)

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

    def handle_accounts_update(self):
        """Update account properties (name, currency, type, etc.) by alias.

        The alias itself cannot be changed here — use handle_accounts_rename
        for that, as it requires cascading updates across all data files.
        """
        body = self._read_json_body()
        alias = body.get("alias", "")
        updated = body.get("updated", {})
        if not alias:
            self._respond_json(400, {"error": "alias is required"})
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

            # Backup-Pflicht: rename cascades through accounts.csv,
            # transactions.csv, scheduled.csv, quick_expenses.csv, payees.json.
            # Snapshot every file we are about to touch before the first write
            # so a partial-cascade failure can be reverted.
            backup.backup_file("accounts", accounts_path)
            backup.backup_file("transactions", data_dir / "transactions.csv")
            sched_path = data_dir / "scheduled.csv"
            if sched_path.exists():
                backup.backup_file("scheduled", sched_path)
            qe_path_pre = data_dir / "quick_expenses.csv"
            if qe_path_pre.exists():
                # quick_expenses.csv is not in BACKUP_TARGETS by stem; the
                # raw source path is enough for the snapshot copy.
                backup.backup_file("quick_expenses", qe_path_pre)
            payees_path_pre = data_dir / "payees.json"
            if payees_path_pre.exists():
                backup.backup_file("payees", payees_path_pre)

            # Update accounts.csv
            tx_engine._atomic_csv_rewrite(accounts_path, list(fieldnames or []), rows)

            # Update transactions.csv (account + transfer_to_account)
            tx_path = data_dir / "transactions.csv"
            tx_rows = []
            with open(tx_path, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                tx_fields = reader.fieldnames
                for row in reader:
                    if row.get("account") == old_alias:
                        row["account"] = new_alias
                    if row.get("transfer_to_account") == old_alias:
                        row["transfer_to_account"] = new_alias
                    tx_rows.append(row)
            tx_engine._atomic_csv_rewrite(tx_path, list(tx_fields or []), tx_rows)

            # Update scheduled.csv
            if sched_path.exists():
                s_rows = []
                with open(sched_path, newline="", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    s_fields = reader.fieldnames
                    for row in reader:
                        if row.get("account") == old_alias:
                            row["account"] = new_alias
                        s_rows.append(row)
                tx_engine._atomic_csv_rewrite(sched_path, list(s_fields or []), s_rows)

            # Update quick_expenses.csv
            qe_path = data_dir / "quick_expenses.csv"
            if qe_path.exists():
                q_rows = []
                with open(qe_path, newline="", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    q_fields = reader.fieldnames
                    for row in reader:
                        if row.get("account") == old_alias:
                            row["account"] = new_alias
                        q_rows.append(row)
                tx_engine._atomic_csv_rewrite(qe_path, list(q_fields or []), q_rows)

            # Update payees.json
            payees_path = data_dir / "payees.json"
            if payees_path.exists():
                with open(payees_path, "r", encoding="utf-8") as f:
                    payees = json.load(f)
                changed = False
                for p in payees:
                    if p.get("default_account") == old_alias:
                        p["default_account"] = new_alias
                        changed = True
                if changed:
                    tx_engine._atomic_write_text(
                        payees_path,
                        json.dumps(payees, ensure_ascii=False, indent=2),
                    )

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
        script = str(Path(__file__).parent / "backup.py")
        try:
            result = subprocess.run(
                ["python", script, target],
                capture_output=True, text=True, timeout=30,
                cwd=str(Path(__file__).parent.parent),
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
        archive without adding restore value) and any __pycache__ directories.
        Filename embeds a UTC timestamp so multiple downloads do not collide.

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

        spool = tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024)
        try:
            with zipfile.ZipFile(spool, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for path in data_dir.rglob("*"):
                    if not path.is_file():
                        continue
                    rel = path.relative_to(data_dir)
                    parts = rel.parts
                    # Skip the rolling backup snapshots and Python cache dirs.
                    if parts and parts[0] == "backups":
                        continue
                    if "__pycache__" in parts:
                        continue
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
        accounts_preview = []
        for acc in staging.get("accounts", []):
            accounts_preview.append({
                "id": acc.get("id"),
                "name": acc.get("name", ""),
                "currency": acc.get("currency", ""),
                "type": acc.get("type", ""),
                "status": acc.get("status", ""),
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

            # Apply alias overrides on top of staging (key = mmex account id).
            if alias_overrides and staging.get("accounts"):
                for acc in staging["accounts"]:
                    override = alias_overrides.get(str(acc.get("id")))
                    if override:
                        acc["preferred_alias"] = override.strip().lower()

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

    # ── API: /api/health ──────────────────────────────────────────────

    def handle_health(self):
        """Return server health status: hostname, git info, uptime, Pi check."""
        import platform
        import subprocess
        from datetime import datetime

        info = {
            "hostname": platform.node(),
            "platform": platform.system(),
            "server_time": datetime.now().isoformat(timespec='seconds'),
            "app_version": _read_app_version(),
        }

        # Git status
        try:
            repo = tx_engine.DATA_DIR.parent
            last_commit = subprocess.check_output(
                ["git", "log", "-1", "--format=%h %s (%cr)"],
                cwd=str(repo), timeout=5, stderr=subprocess.DEVNULL
            ).decode().strip()
            info["git_last_commit"] = last_commit

            status_out = subprocess.check_output(
                ["git", "status", "--porcelain"],
                cwd=str(repo), timeout=5, stderr=subprocess.DEVNULL
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

        # Backup
        try:
            backup.backup_file("transactions", tx_engine.DATA_DIR / "transactions.csv")
        except Exception as e:
            self._respond_json(500, {"error": f"Backup failed: {e}"})
            return

        # Update
        if not tx_engine.update_transaction(import_id, updated):
            self._respond_json(404, {"error": f"Transaction '{import_id}' not found"})
            return

        # Git commit
        summary = updated.get("payee", "") or updated.get("category", "") or "fields updated"
        git_ok = tx_engine.git_commit(f"TX edit: {import_id} ({summary})")

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

        # Delete
        if not tx_engine.delete_transaction(import_id):
            self._respond_json(404, {"error": f"Transaction '{import_id}' not found"})
            return

        # Git commit
        git_ok = tx_engine.git_commit(f"TX delete: {import_id}")

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
    args = parser.parse_args()

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
