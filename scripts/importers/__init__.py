"""Data importers for the FinanceOS Setup-Wizard.

Each importer in this package must be side-effect-free: it reads an
external data source and returns a structured `staging` payload that
the wizard (CLI or web) renders for user review before any CSV is
written.
"""
