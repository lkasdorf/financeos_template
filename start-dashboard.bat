@echo off
REM FinanceOS Dashboard Starter (Windows)
REM Startet den lokalen HTTP-Server und oeffnet das Dashboard im Browser.
REM Zum Stoppen: dieses Fenster schliessen oder Ctrl+C druecken.

cd /d "%~dp0"
title FinanceOS Dashboard
python scripts\serve.py
pause
