# Deployment — Always-On (Raspberry Pi / Linux Server)

> Bilingual reference. **DE** (Deutsch) on top of each section, **EN** (English) below the divider.

This guide covers running FinanceOS as a 24/7 service with bidirectional Git
sync between your local PC and an always-on host (Raspberry Pi, VPS, …).
Every section appears in German and English so contributors from either
language can follow along without context-switching.

---

## 1. Service via systemd

**DE.** `serve.py` läuft als systemd-Unit, damit das Dashboard nach Reboot
automatisch hochfährt und beim Pull eines Code-Commits durch den Cron neu
gestartet werden kann. Der Unit-Name darf abweichen — wichtig ist nur, dass
der Cron-User per `sudo` ohne Passwort genau diesen Unit-Namen neustarten
darf (siehe Abschnitt 3).

**EN.** `serve.py` runs as a systemd unit so the dashboard comes back up on
reboot and can be restarted by the cron job whenever a code commit is
pulled. The unit name is up to you — the only constraint is that the cron
user must be allowed to `sudo systemctl restart` that exact unit without a
password (see section 3).

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
fetch → rebase → commit pending `data/`-Änderungen → push → optional
`systemctl restart` wenn Nicht-Daten-Files mitgekommen sind. Das ersetzt
den früheren Doppel-Cron (Bash-Pull + Python-Commit), der über
`.git/FETCH_HEAD` raceen konnte und in einer Variante stille
Transaktions-Verluste verursacht hat (siehe `CHANGELOG.md`,
v2026-04-26.3).

**EN.** A single cron entry drives the full sync loop:
fetch → rebase → commit pending `data/` changes → push → optional
`systemctl restart` when non-data files were pulled. This replaces the
earlier two-cron split (bash pull + Python commit) which raced on
`.git/FETCH_HEAD` and, in one variant, silently destroyed transactions
(see `CHANGELOG.md`, v2026-04-26.3).

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

## 3. Sudoers-Snippet — passwortloser Restart / passwordless restart

**DE.** Damit `cron_commit.py` den Service nach einem Code-Pull neu
starten kann, ohne nach einem Passwort zu fragen, braucht der Cron-User
einen schmalen sudoers-Eintrag — eingeschränkt auf genau den
`systemctl restart`-Befehl für die FinanceOS-Unit. Den Pfad zu `systemctl`
auf dem Zielsystem über `command -v systemctl` ermitteln; auf den meisten
Distros liegt er unter `/usr/bin/systemctl`.

**EN.** So `cron_commit.py` can restart the service after pulling a code
commit without prompting for a password, the cron user needs a narrow
sudoers entry — locked down to the exact `systemctl restart` invocation
for the FinanceOS unit. Find the absolute path to `systemctl` on the
target with `command -v systemctl`; on most distros it lives at
`/usr/bin/systemctl`.

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

**DE.** Forks und Eigen-Deployments können den systemd-Unit-Namen
überschreiben, ohne `cron_commit.py` zu patchen — über die
Umgebungsvariable `FINANCEOS_SERVICE_NAME`. Default ist `financeos`. Den
sudoers-Eintrag entsprechend anpassen, sonst schlägt der passwortlose
`sudo`-Aufruf fehl und der Service läuft mit altem Code weiter.

**EN.** Forks and bespoke deployments can override the systemd unit name
without patching `cron_commit.py` — set the `FINANCEOS_SERVICE_NAME`
environment variable. The default is `financeos`. Adjust the sudoers
entry to match, or the passwordless `sudo` call will fail and the
service will stay on the old code.

```cron
# Example: rename the unit to `myfin`
*/5 * * * * cd /srv/financeos && FINANCEOS_SERVICE_NAME=myfin /usr/bin/python3 scripts/cron_commit.py >> /var/log/financeos/cron_commit.log 2>&1
```

```sudoers
financeos ALL=(root) NOPASSWD: /usr/bin/systemctl restart myfin
```

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
- Keine Sudo-Regel à la `NOPASSWD: ALL` — der Cron-User bekommt nur
  exakt den `systemctl restart <unit>`-Befehl.

**EN.**
- Don't run a second cron that does `git fetch` / `git pull` on the
  same repo — `.git/FETCH_HEAD` is not safe for concurrent writers.
- Don't use `git reset --hard ORIG_HEAD` as a recovery fallback in
  custom wrapper scripts. ORIG_HEAD is sticky from earlier operations
  and silently nukes fresh commits.
- Don't grant `NOPASSWD: ALL` — the cron user gets exactly the
  `systemctl restart <unit>` command and nothing else.
