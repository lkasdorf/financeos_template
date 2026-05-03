# Deployment — Always-On (Raspberry Pi / Linux Server)

> Bilingual reference. **DE** (Deutsch) on top of each section, **EN** (English) below the divider.

This guide covers running FinanceOS as a 24/7 service with bidirectional Git
sync between your local PC and an always-on host (Raspberry Pi, VPS, …).
Every section appears in German and English so contributors from either
language can follow along without context-switching.

---

## 1. Service via systemd

**DE.** `serve.py` läuft als systemd-Unit, damit das Dashboard nach Reboot
automatisch hochfährt und nach einem Code-Push manuell neu gestartet werden
kann. Code-Deploys passieren bewusst manuell (`sudo systemctl restart
<unit>` lokal, oder `ssh <host> 'sudo systemctl restart <unit>'` von der
Dev-Maschine) — so wird eine aktive Dashboard-Session nicht durch einen
zufälligen `*/5`-Tick unterbrochen. Optional: ein eingegrenzter
sudoers-Eintrag (Abschnitt 3) lässt den Restart ohne Passwort-Prompt
durchlaufen.

**EN.** `serve.py` runs as a systemd unit so the dashboard comes back up
on reboot and can be restarted manually after a code push. Code deploys
are a deliberate manual step (`sudo systemctl restart <unit>` locally, or
`ssh <host> 'sudo systemctl restart <unit>'` from the dev machine) so an
active dashboard session is never interrupted by a stray `*/5` tick.
Optional: a narrow sudoers entry (section 3) lets the restart skip the
password prompt.

```ini
# /etc/systemd/system/financeos.service
[Unit]
Description=FinanceOS Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=financeos
WorkingDirectory=/srv/financeos
ExecStart=/usr/bin/python3 scripts/serve.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now financeos
```

---

## 2. Crontab — bidirektionaler Sync alle 5 Minuten / 5-minute bidirectional sync

**DE.** Ein einziger Cron-Eintrag betreibt den vollen Sync-Loop:
fetch → rebase → commit pending `data/`-Änderungen → push. Kein
Auto-Restart bei Code-Pulls — Restart erfolgt manuell (Abschnitt 1).
Das ersetzt den früheren Doppel-Cron (Bash-Pull + Python-Commit), der
über `.git/FETCH_HEAD` raceen konnte und in einer Variante stille
Transaktions-Verluste verursacht hat (siehe `CHANGELOG.md`,
v2026-04-26.3).

**EN.** A single cron entry drives the full sync loop:
fetch → rebase → commit pending `data/` changes → push. No
auto-restart on code pulls — restart is a manual step (section 1).
This replaces the earlier two-cron split (bash pull + Python commit)
which raced on `.git/FETCH_HEAD` and, in one variant, silently destroyed
transactions (see `CHANGELOG.md`, v2026-04-26.3).

```cron
# /etc/cron.d/financeos  (or `crontab -e` for the service user)
*/5 * * * * cd /srv/financeos && /usr/bin/python3 scripts/cron_commit.py >> /var/log/financeos/cron_commit.log 2>&1

# Daily helpers (timing is up to you):
5  3 * * * cd /srv/financeos && /usr/bin/python3 scripts/cron_fx.py        >> /var/log/financeos/cron_fx.log 2>&1
0  8 * * * cd /srv/financeos && /usr/bin/python3 scripts/cron_metals.py    >> /var/log/financeos/cron_metals.log 2>&1
10 4 * * * cd /srv/financeos && /usr/bin/python3 scripts/cron_sched.py     >> /var/log/financeos/cron_sched.log 2>&1
20 4 * * * cd /srv/financeos && /usr/bin/python3 scripts/cron_integrity.py >> /var/log/financeos/cron_integrity.log 2>&1
```

**DE.** Logs-Verzeichnis vorab anlegen:
**EN.** Create the log directory up front:

```bash
sudo mkdir -p /var/log/financeos
sudo chown financeos:financeos /var/log/financeos
```

---

## 3. Sudoers-Snippet — passwortloser Restart / passwordless restart (optional)

**DE.** Optionaler Komfort-Eintrag, damit ein manueller Restart per
SSH (`ssh <host> 'sudo systemctl restart <unit>'`) ohne Passwort-Prompt
durchläuft. Eingeschränkt auf genau den `systemctl restart`-Befehl für
die FinanceOS-Unit — keine breitere Berechtigung. Den Pfad zu `systemctl`
auf dem Zielsystem über `command -v systemctl` ermitteln; auf den meisten
Distros liegt er unter `/usr/bin/systemctl`. Ohne den Eintrag fragt
`sudo` interaktiv nach dem Passwort — über eine SSH-PTY funktioniert das
genauso, nur weniger bequem.

**EN.** Optional convenience entry so a manual SSH restart
(`ssh <host> 'sudo systemctl restart <unit>'`) skips the password
prompt. Locked down to the exact `systemctl restart` invocation for the
FinanceOS unit — nothing broader. Find the absolute path to `systemctl`
on the target with `command -v systemctl`; on most distros it lives at
`/usr/bin/systemctl`. Without the entry, `sudo` will prompt for the
password interactively — which works fine over an SSH PTY, just less
convenient.

```sudoers
# /etc/sudoers.d/financeos    (chmod 440, install via `visudo -f`)
financeos ALL=(root) NOPASSWD: /usr/bin/systemctl restart financeos
```

```bash
# Install with syntax validation
sudo visudo -f /etc/sudoers.d/financeos
sudo chmod 440 /etc/sudoers.d/financeos
```

---

## 4. Custom service name / abweichender Unit-Name

**DE.** Der systemd-Unit-Name ist frei wählbar (siehe Abschnitt 1) —
`cron_commit.py` selbst spricht den Service nicht mehr an, deshalb gibt
es im Sync-Loop nichts zu konfigurieren. Falls der Unit-Name vom Default
`financeos` abweicht, einfach den Restart-Befehl und (falls genutzt) den
sudoers-Eintrag aus Abschnitt 3 entsprechend anpassen.

**EN.** The systemd unit name is yours to choose (see section 1) —
`cron_commit.py` no longer talks to the service, so there's nothing to
configure on the sync side. If the unit name differs from the default
`financeos`, just adjust the restart command and (if used) the sudoers
entry from section 3 accordingly.

---

## 5. Health-Check / Funktionsprüfung

**DE.** Nach dem ersten `*/5`-Tick (max. 5 Minuten warten) sollten in
`cron_commit.log` reguläre Batch-Zeilen oder ein „working tree clean,
nothing to commit"-Hinweis erscheinen — keine Stacktraces, keine
`rebase failed: invalid upstream 'FETCH_HEAD'`-Meldungen. Falls doch:
prüfen, dass kein zweiter Cron-Job auf demselben Repo `git fetch` läuft.

**EN.** After the first `*/5` tick (wait at most five minutes),
`cron_commit.log` should show regular batch lines or a "working tree
clean, nothing to commit" message — no stack traces, no
`rebase failed: invalid upstream 'FETCH_HEAD'`. If you do see them,
verify that no second cron job is running `git fetch` against the same
repo.

```bash
tail -n 50 /var/log/financeos/cron_commit.log
systemctl status financeos --no-pager
sudo -n -u financeos systemctl restart financeos   # dry-run the sudoers rule
```

---

## 6. Was NICHT tun / What NOT to do

**DE.**
- Keinen zweiten Cron mit `git fetch` / `git pull` auf demselben Repo —
  `.git/FETCH_HEAD` ist nicht für Concurrent-Writer ausgelegt.
- Kein `git reset --hard ORIG_HEAD` als Recovery-Fallback in eigenen
  Wrapper-Scripts. ORIG_HEAD ist sticky aus früheren Operationen und
  zerstört frische Commits stillschweigend.
- Keine Sudo-Regel à la `NOPASSWD: ALL` — die optionale
  Convenience-Regel (Abschnitt 3) erlaubt nur exakt den
  `systemctl restart <unit>`-Befehl.

**EN.**
- Don't run a second cron that does `git fetch` / `git pull` on the
  same repo — `.git/FETCH_HEAD` is not safe for concurrent writers.
- Don't use `git reset --hard ORIG_HEAD` as a recovery fallback in
  custom wrapper scripts. ORIG_HEAD is sticky from earlier operations
  and silently nukes fresh commits.
- Don't grant `NOPASSWD: ALL` — the optional convenience entry
  (section 3) allows exactly the `systemctl restart <unit>` command and
  nothing else.
