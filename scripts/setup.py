"""FinanceOS Setup-Wizard CLI entry-point (Block C.2).

Two modes, both delegated to ``setup_core.run_setup`` so the web wizard
(Block C.3) can share the exact same code path:

  - non-interactive (flags): scripted / automated installs
  - ``--interactive``: step-by-step prompts (Branding → Currency → Auth →
    Datasource → Optional Features → Summary → Confirm)

Detailed account/category review (alias edits, type fixes, pass-through
payee, etc.) is intentionally **not** part of the CLI flow — that belongs
in the web wizard (C.3) where row-level editing is ergonomic. CLI users
can edit ``data/accounts.csv`` directly after setup.

Usage (empty start, no auth):
    python scripts/setup.py --brand "My Finances" --currency USD --auth-none --empty

Usage (interactive):
    python scripts/setup.py --interactive
"""
from __future__ import annotations

import argparse
import getpass
import subprocess
import sys
from pathlib import Path

# Allow running as ``python scripts/setup.py`` from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import setup_core  # noqa: E402
from scripts.importers import mmex as mmex_reader  # noqa: E402


def _build_parser() -> argparse.ArgumentParser:
    """Build the argparse parser.

    In flag-mode, ``--brand``, ``--currency`` and one of (``--auth-none`` /
    ``--auth-user``) and one of (``--empty`` / ``--mmex``) are required.
    In ``--interactive`` mode all of those are collected via prompts and
    the corresponding flags are accepted as pre-filled defaults.
    """
    p = argparse.ArgumentParser(
        prog="setup",
        description="Initialize a fresh FinanceOS instance.",
    )
    p.add_argument(
        "--root", type=Path, default=None,
        help="Project root (defaults to CWD; useful for testing into a temp dir).",
    )
    p.add_argument("--brand", help="Display name (e.g. 'My Finances').")
    p.add_argument("--accent", default="#1e40af", help="Accent color hex (optional).")
    p.add_argument("--currency", help="Default ISO-4217 code (e.g. USD).")

    auth = p.add_mutually_exclusive_group()
    auth.add_argument("--auth-none", action="store_true",
                      help="Disable authentication (the dashboard becomes open).")
    auth.add_argument("--auth-user", help="Username for basic auth (requires --auth-pass).")
    p.add_argument("--auth-pass", help="Password for basic auth.")

    src = p.add_mutually_exclusive_group()
    src.add_argument("--empty", action="store_true",
                     help="Start with the empty seed (4 accounts, generic categories).")
    src.add_argument("--mmex", type=Path,
                     help="Path to a MMEX .mmb file to import.")

    p.add_argument("--force", action="store_true",
                   help="Overwrite an existing/initialized install (skips the "
                        "setup-state and live-transactions guards, DC-H2). "
                        "No backup is taken — use deliberately.")
    p.add_argument("--interactive", action="store_true",
                   help="Run interactive prompts instead of consuming flags.")
    p.add_argument("--git-commit", action="store_true",
                   help="After setup, stage data/ + config/ and create an initial commit.")
    return p


# ── Interactive prompt helpers ─────────────────────────────────────────────

def _ask(question: str, default: str | None = None) -> str:
    """Print ``question`` and read a line. ``default`` is shown in brackets and
    returned verbatim if the user just hits Enter."""
    suffix = f" [{default}]" if default is not None else ""
    raw = input(f"{question}{suffix}: ").strip()
    return raw or (default or "")


def _ask_yes_no(question: str, *, default: bool = False) -> bool:
    hint = "Y/n" if default else "y/N"
    while True:
        raw = input(f"{question} [{hint}]: ").strip().lower()
        if not raw:
            return default
        if raw in ("y", "yes"):
            return True
        if raw in ("n", "no"):
            return False
        print("  Please answer y or n.")


def _ask_password(prompt: str = "Password") -> str:
    # On Windows, ``getpass.getpass`` binds to ``msvcrt`` and ignores piped
    # stdin, so non-tty callers (tests, automation) need ``input()``.
    use_getpass = sys.stdin.isatty()
    reader = (lambda p: getpass.getpass(p)) if use_getpass else (lambda p: input(p))
    while True:
        first = reader(f"{prompt}: ")
        if not first:
            print("  Password cannot be empty.")
            continue
        second = reader("Confirm: ")
        if first == second:
            return first
        print("  Passwords do not match — try again.")


def _interactive_config(args: argparse.Namespace) -> tuple[dict, dict | None]:
    """Run the interactive wizard and return ``(config, staging)``.

    ``args`` lets users seed prompts via flags (e.g. ``--brand X --interactive``
    pre-fills the Brand step).
    """
    print("\nFinanceOS Setup-Wizard\n======================\n")

    # Step 1 — Branding
    print("Step 1 — Branding")
    brand = _ask("Display name", default=args.brand or "FinanceOS")
    accent = _ask("Accent color hex", default=args.accent or "#1e40af")
    print()

    # Step 2 — Default currency
    print("Step 2 — Default Currency")
    currency = ""
    while not currency:
        currency = _ask("ISO-4217 code (e.g. USD, EUR)", default=args.currency or "USD")
        if len(currency) != 3 or not currency.isalpha():
            print("  Currency must be a 3-letter code.")
            currency = ""
    currency = currency.upper()
    print()

    # Step 3 — Authentication
    print("Step 3 — Authentication")
    print("  basic — username/password protected (recommended)")
    print("  none  — open dashboard (use only on a trusted network)")
    if args.auth_none:
        default_mode = "none"
    elif args.auth_user:
        default_mode = "basic"
    else:
        default_mode = "basic"
    auth_mode = ""
    while auth_mode not in ("basic", "none"):
        auth_mode = _ask("Mode (basic/none)", default=default_mode).lower()
    auth_user = None
    auth_pass = None
    if auth_mode == "basic":
        auth_user = _ask("Username", default=args.auth_user or "admin")
        auth_pass = args.auth_pass or _ask_password()
    elif not _ask_yes_no(
        "  WARNING: 'none' leaves the dashboard open. Continue?", default=False
    ):
        print("Aborted.")
        sys.exit(1)
    print()

    # Step 4 — Datasource
    print("Step 4 — Data Source")
    print("  (a) Import a MMEX .mmb file")
    print("  (b) Empty start (4 generic accounts, neutral categories)")
    if args.mmex:
        default_choice = "a"
    elif args.empty:
        default_choice = "b"
    else:
        default_choice = "b"
    choice = ""
    while choice not in ("a", "b"):
        choice = _ask("Choice (a/b)", default=default_choice).lower()
    staging = None
    datasource = "empty"
    if choice == "a":
        datasource = "mmex"
        path_str = _ask("Path to .mmb file", default=str(args.mmex) if args.mmex else "")
        path = Path(path_str).expanduser()
        if not path.is_file():
            print(f"  File not found: {path}", file=sys.stderr)
            sys.exit(2)
        print("  Reading MMEX...", end=" ", flush=True)
        try:
            staging = mmex_reader.read_mmex(path)
        except Exception as exc:
            print(f"failed: {exc}", file=sys.stderr)
            sys.exit(2)
        s = staging["stats"]
        print(
            f"{s['account_count']} accounts, {s['category_count']} categories, "
            f"{s['payee_count']} payees, {s['transaction_count']} transactions."
        )
    print()

    # Step 5 — Optional features
    print("Step 5 — Optional Features")
    feat_recon = _ask_yes_no("Enable bank reconciliation?", default=False)
    feat_fx = _ask_yes_no("Enable FX auto-refresh cron?", default=True)
    features = {"reconciliation": feat_recon, "fx_auto_refresh": feat_fx}
    print()

    # Step 6 — Summary + confirm
    print("Step 6 — Summary")
    print(f"  Brand         {brand}")
    print(f"  Accent        {accent}")
    print(f"  Currency      {currency}")
    print(f"  Auth          {auth_mode}" + (f" ({auth_user})" if auth_user else ""))
    if datasource == "mmex":
        s = staging["stats"]  # type: ignore[index]
        print(f"  Datasource    MMEX ({path})")
        print(
            f"  Will create   {s['account_count']} accounts, "
            f"{s['category_count']} categories, {s['payee_count']} payees, "
            f"{s['transaction_count']} transactions"
        )
    else:
        print("  Datasource    Empty start (4 accounts, 34 generic categories)")
    print(
        "  Features      "
        f"reconciliation={'on' if feat_recon else 'off'}, "
        f"fx_auto_refresh={'on' if feat_fx else 'off'}"
    )
    print()
    if not _ask_yes_no("Proceed?", default=True):
        print("Aborted.")
        sys.exit(1)
    print()

    config = {
        "brand": brand,
        "accent_color": accent,
        "currency": currency,
        "auth_mode": auth_mode,
        "auth_user": auth_user,
        "auth_password": auth_pass,
        "datasource": datasource,
        "features": features,
    }
    return config, staging


def _flag_config(parser: argparse.ArgumentParser, args: argparse.Namespace) -> tuple[dict, dict | None]:
    """Build ``(config, staging)`` from CLI flags. Errors out via ``parser.error``."""
    if not args.brand:
        parser.error("--brand is required (or use --interactive)")
    if not args.currency:
        parser.error("--currency is required (or use --interactive)")
    if not (args.auth_none or args.auth_user):
        parser.error("one of --auth-none or --auth-user is required (or use --interactive)")
    if not (args.empty or args.mmex):
        parser.error("one of --empty or --mmex is required (or use --interactive)")
    if args.auth_user and not args.auth_pass:
        parser.error("--auth-user requires --auth-pass")

    datasource = "mmex" if args.mmex else "empty"
    staging = None
    if args.mmex:
        if not args.mmex.is_file():
            parser.error(f"--mmex: file not found: {args.mmex}")
        try:
            staging = mmex_reader.read_mmex(args.mmex)
        except Exception as exc:
            print(f"failed to read MMEX file: {exc}", file=sys.stderr)
            sys.exit(2)

    config = {
        "brand": args.brand,
        "accent_color": args.accent,
        "currency": args.currency.upper(),
        "auth_mode": "none" if args.auth_none else "basic",
        "auth_user": args.auth_user,
        "auth_password": args.auth_pass,
        "datasource": datasource,
    }
    return config, staging


def _maybe_git_commit(root: Path) -> None:
    """Stage data/ + config/ and create the initial setup commit. No-op if
    ``root`` is not a git working tree."""
    git_dir = root / ".git"
    if not git_dir.exists():
        print("  (skipping git commit — not a git repository)")
        return
    try:
        subprocess.run(
            ["git", "-C", str(root), "add", "data/", "config/"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(root), "commit", "-m", "chore: initial setup via CLI wizard"],
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        print(f"  git commit failed: {exc}", file=sys.stderr)
        return
    print("  Initial commit created.")


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.interactive:
        try:
            config, staging = _interactive_config(args)
        except (KeyboardInterrupt, EOFError):
            print("\nAborted.")
            return 1
    else:
        config, staging = _flag_config(parser, args)

    try:
        summary = setup_core.run_setup(config, root=args.root, staging=staging,
                                       force=args.force)
    except setup_core.SetupError as exc:
        print(f"setup failed: {exc}", file=sys.stderr)
        return 2

    counts = summary["counts"]
    lines = [
        "FinanceOS initialized:",
        f"  Brand          {summary['brand']}",
        f"  Currency       {summary['currency']}",
        f"  Auth           {summary['auth_mode']}",
        f"  Datasource     {summary['datasource']}",
        f"  Accounts       {counts['accounts']}",
        f"  Categories     {counts['categories']}",
        f"  Payees / Tags  {counts['payees']} / {counts['tags']}",
        f"  Transactions   {counts['transactions']}",
    ]
    if counts.get("warnings"):
        lines.append(f"  Warnings       {counts['warnings']}")
    lines.append(f"  State file     {summary['state_file']}")
    print("\n".join(lines))

    if args.git_commit:
        _maybe_git_commit(args.root or Path.cwd())

    return 0


if __name__ == "__main__":
    sys.exit(main())
