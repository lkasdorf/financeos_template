# Contributing to FinanceOS

Thanks for your interest in improving FinanceOS. This document covers the basics for issues, pull requests, and a local dev setup.

## Reporting issues

- **Bugs** — please use the bug-report issue template. Include OS, Python version, and the steps to reproduce.
- **Feature ideas** — use the feature-request template. Describe the use case before the proposed solution.
- **Security** — do **not** open a public issue. Email the maintainer (see repo profile) or use GitHub Security Advisories.

## Pull requests

1. **Open an issue first** for non-trivial changes so we can align on scope before code lands.
2. **Branch from `main`**, keep PRs focused (one logical change per PR).
3. **Write tests or a manual repro** when fixing a bug — the failing case before, the passing case after.
4. **Update docs** if you change behavior visible to users (`docs/`, `README.md`, FAQ).
5. **Run the validation scripts** before pushing:
   ```bash
   python scripts/i18n_check.py        # if you touched dashboard/ or config/i18n/
   python scripts/check_faq_pair.py    # if you touched docs/faq*.md
   ```
6. **One commit per concern** is preferred but not required — squash-merge is fine.

## Local dev setup

```bash
git clone https://github.com/<your-org>/financeos.git
cd financeos
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scripts/setup.py --interactive --empty       # empty starter data
python scripts/serve.py                             # → http://localhost:8080/dashboard/
```

## Coding conventions

- **Python** — PEP 8, type hints where they clarify, docstrings on public functions.
- **JavaScript** — vanilla ES modules, no build step. Match the style of the file you're editing.
- **CSV schema** — single source of truth lives in `docs/schema.md`. Schema changes need a migration plan and a docs update in the same PR.
- **i18n** — every user-facing string goes through `t('key.path', {}, 'English fallback')`. Don't hardcode English in JS.
- **Config-driven** — anything that varies per user goes in `config/*.json`, not in code.

## Project layout

See [`README.md`](README.md) for the directory map and [`CLAUDE.md`](CLAUDE.md) for deeper conventions.

## License

By submitting a contribution, you agree that it will be licensed under the same MIT License as the rest of the project.
