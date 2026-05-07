# Deployment Guide

> Bilingual reference. **DE** (Deutsch) on top of each section, **EN** (English) below the divider.

This guide covers every supported way to host FinanceOS — desktop, NAS,
Raspberry Pi, generic Linux server, and from-anywhere remote access. Each
platform has its own quirks; pick the section that matches your setup.

**Contents**

1. [Synology Container Manager](#synology-container-manager)
2. [Unraid](#unraid)
3. [Generic Docker (any Linux + Docker host)](#generic-docker)
4. [Raspberry Pi / systemd](#raspberry-pi--systemd)
5. [Reverse proxy (Caddy / nginx / Traefik)](#reverse-proxy)
6. [Remote access (Tailscale / Twingate / Cloudflare Tunnel)](#remote-access)
7. [Enabling authentication](#enabling-authentication)
8. [Updating FinanceOS](#updating-financeos)
9. [Backups](#backups)
10. [Recurring jobs (cron / scheduled tasks)](#recurring-jobs)

---

## Synology Container Manager

**DE.** FinanceOS läuft auf jeder DSM-7-NAS mit installiertem Container Manager
(früher "Docker") als Project — das ist der saubere Weg, mit Volume-Mounts
auf `/volume1/docker/financeos/{data,config,memory}`, sodass deine Buchungen die
Synology-Backup-Routine (Hyper Backup) automatisch erfassen.

**EN.** FinanceOS runs on any DSM 7 NAS with Container Manager (formerly
"Docker") installed, as a *Project* — that's the clean path, with volume
mounts on `/volume1/docker/financeos/{data,config,memory}` so your
transactions get picked up by the Synology backup routine (Hyper Backup)
automatically.

### Schritte / Steps

**DE.**

1. **SSH auf die Synology** und Verzeichnisstruktur anlegen:
   ```bash
   sudo mkdir -p /volume1/docker/financeos/{data,config,memory}
   sudo chown -R $(whoami) /volume1/docker/financeos
   cd /volume1/docker/financeos
   ```
2. Repo klonen oder Release-ZIP entpacken:
   ```bash
   git clone https://github.com/lkasdorf/financeos_template.git src
   cp src/docker-compose.yml ./
   cp src/.env.example ./.env
   ```
3. **Container Manager** öffnen → *Project* → *Create*:
   - Project name: `financeos`
   - Path: `/volume1/docker/financeos`
   - Source: `Use existing docker-compose.yml`
   - *Build the project's web service*: an
4. Nach dem Build: Status `Running` → URL `http://<NAS-IP>:8080/dashboard/setup.html` aufrufen.
5. Einmalig den 7-Schritte-Setup-Assistenten durchklicken.

**EN.**

1. **SSH into the NAS** and create the directory structure:
   ```bash
   sudo mkdir -p /volume1/docker/financeos/{data,config,memory}
   sudo chown -R $(whoami) /volume1/docker/financeos
   cd /volume1/docker/financeos
   ```
2. Clone the repo (or unpack a release ZIP):
   ```bash
   git clone https://github.com/lkasdorf/financeos_template.git src
   cp src/docker-compose.yml ./
   cp src/.env.example ./.env
   ```
3. Open **Container Manager** → *Project* → *Create*:
   - Project name: `financeos`
   - Path: `/volume1/docker/financeos`
   - Source: `Use existing docker-compose.yml`
   - Tick *Build the project's web service*.
4. After the build, status should be `Running` → visit `http://<NAS-IP>:8080/dashboard/setup.html`.
5. Walk through the seven-step Setup wizard once.

### Wichtige Volume-Mounts / Important volume mounts

```yaml
# /volume1/docker/financeos/docker-compose.yml — bereits korrekt im Template
volumes:
  - ./data:/app/data        # CSVs, Backups, Custom Reports — geht in Hyper Backup
  - ./config:/app/config    # branding.json, features.json, reports.json, auth.json, i18n
  - ./memory:/app/memory    # optional, Claude-Code-Kontext
```

**DE.** Die drei Mounts sind bewusst aus dem Image ausgelagert. Wer das Image
neu baut (Update), verliert keine Daten. Wer die NAS resetten muss, hat
über Hyper Backup alles auf der externen Platte.

**EN.** The three mounts deliberately live outside the image. Rebuilding the
image (an update) keeps your data. If you ever have to reset the NAS, Hyper
Backup has everything on the external drive.

### DSM-Reverse-Proxy / DSM reverse proxy (optional)

**DE.** Wenn du eine eigene Domain wie `finance.meinhaus.de` willst, statt
`<NAS-IP>:8080`, geht das über DSM bordeigen — *Control Panel → Login Portal →
Advanced → Reverse Proxy → Create*. Quelle: `https://finance.meinhaus.de`,
Ziel: `http://localhost:8080`. Let's-Encrypt-Zertifikat ist im
*Control Panel → Security → Certificate* zwei Klicks.

**EN.** If you want a custom domain like `finance.myhouse.com` instead of
`<NAS-IP>:8080`, DSM has reverse-proxy support built in — *Control Panel →
Login Portal → Advanced → Reverse Proxy → Create*. Source:
`https://finance.myhouse.com`, destination: `http://localhost:8080`. The
Let's Encrypt certificate is two clicks in *Control Panel → Security →
Certificate*.

---

## Unraid

**DE.** Unraid hat keinen offiziellen FinanceOS-Eintrag im Community-Apps-Store,
aber das Template lässt sich in 3 Minuten als Custom Container hinzufügen.

**EN.** Unraid doesn't have an official FinanceOS entry in the Community Apps
store, but the template can be added as a custom container in three minutes.

### Schritte / Steps

**DE.**

1. **Apps → Add Container** (oben rechts, neben *Add Container* steht *Settings*).
2. Felder:
   - Name: `financeos`
   - Repository: `lkasdorf/financeos:latest` *(falls noch nicht vorhanden, lokal über `docker build` bauen — siehe Generic Docker)*
   - Network Type: `Bridge`
   - Console shell command: `bash`
3. Port hinzufügen: Container `8080` → Host `8080` (oder anderer freier Port).
4. Drei Path-Mounts hinzufügen:
   - `/app/data` ↔ `/mnt/user/appdata/financeos/data`
   - `/app/config` ↔ `/mnt/user/appdata/financeos/config`
   - `/app/memory` ↔ `/mnt/user/appdata/financeos/memory`
5. **Apply** → Container startet → URL `http://<unraid-host>:8080/dashboard/setup.html`.

**EN.**

1. **Apps → Add Container** (top right, next to *Add Container* is *Settings*).
2. Fields:
   - Name: `financeos`
   - Repository: `lkasdorf/financeos:latest` *(if not yet available, build locally via `docker build` — see Generic Docker)*
   - Network Type: `Bridge`
   - Console shell command: `bash`
3. Add port mapping: container `8080` → host `8080` (or any free port).
4. Add three path mounts:
   - `/app/data` ↔ `/mnt/user/appdata/financeos/data`
   - `/app/config` ↔ `/mnt/user/appdata/financeos/config`
   - `/app/memory` ↔ `/mnt/user/appdata/financeos/memory`
5. **Apply** → container starts → URL `http://<unraid-host>:8080/dashboard/setup.html`.

---

## Generic Docker

**DE.** Funktioniert auf jedem Linux-Host mit Docker Engine ≥ 20.10 und Docker
Compose v2 (`docker compose`, ohne Bindestrich). Die Standard-`docker-compose.yml`
des Templates reicht.

**EN.** Works on any Linux host with Docker Engine ≥ 20.10 and Docker Compose
v2 (`docker compose`, no hyphen). The template's stock `docker-compose.yml`
is enough.

### Compose

```bash
git clone https://github.com/lkasdorf/financeos_template.git financeos
cd financeos
cp .env.example .env
# Optional: in .env den Host-Port (FINANCEOS_PORT) ändern
docker compose up -d
docker compose logs -f       # erste Boot-Logs anschauen
```

### Stand-Alone `docker run` (ohne Compose / without Compose)

```bash
docker build -t financeos:local .
docker run -d --name financeos --restart unless-stopped \
  -p 8080:8080 \
  -v "$PWD/data":/app/data \
  -v "$PWD/config":/app/config \
  -v "$PWD/memory":/app/memory \
  financeos:local
```

### Kleinere Plattformen / Smaller platforms

**DE.** Auf einem Pi 4 (4 GB), einem Synology DS218+, einem N100-Mini-PC läuft
das Image problemlos. RAM-Bedarf im Idle: ~80 MB.

**EN.** A Pi 4 (4 GB), a Synology DS218+, an N100 mini PC all run the image
fine. Idle RAM: ~80 MB.

---

## Raspberry Pi / systemd

**DE.** Wer Docker auf dem Pi nicht will (oder lieber bare-metal hostet, weil
Docker auf SD-Karte zu viel I/O macht), läuft `serve.py` direkt als
systemd-Unit. Das ist auch der Setup, der im Privat-Repo seit Block C läuft.

**EN.** If you don't want Docker on the Pi (or prefer bare metal because
Docker on SD wastes I/O), run `serve.py` directly as a systemd unit. This is
the same setup the private repo has been running since Block C.

### Service-Datei / Service file

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
ExecStart=/usr/bin/python3 scripts/serve.py --bind 0.0.0.0 --port 8080 --no-open
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now financeos
sudo systemctl status financeos
```

### Bidirektionaler Git-Sync alle 5 Min / 5-minute bidirectional sync (optional)

**DE.** Wer FinanceOS auf zwei Geräten (Dev-Maschine + Pi) hostet und Buchungen
mal hier mal da macht, braucht einen Git-Sync. Das Template liefert
`scripts/cron_commit.py`: ein einziger Cron-Eintrag betreibt
fetch → rebase → commit pending `data/`-Änderungen → push.

**EN.** If you host FinanceOS on two devices (dev machine + Pi) and book
transactions on either, you need a git sync. The template ships
`scripts/cron_commit.py`: a single cron entry runs
fetch → rebase → commit pending `data/` changes → push.

```cron
# /etc/cron.d/financeos  (or `crontab -e` for the service user)
*/5 * * * * cd /srv/financeos && /usr/bin/python3 scripts/cron_commit.py >> /var/log/financeos/cron_commit.log 2>&1
```

```bash
sudo mkdir -p /var/log/financeos
sudo chown financeos:financeos /var/log/financeos
```

### Sudoers-Snippet — passwortloser Restart / passwordless restart (optional)

**DE.** Komfort-Eintrag, damit ein manueller Restart per SSH ohne
Passwort-Prompt durchläuft. Eingeschränkt auf genau den `systemctl restart`-Befehl
für die FinanceOS-Unit — keine breitere Berechtigung.

**EN.** Convenience entry so a manual SSH restart skips the password
prompt. Locked down to the exact `systemctl restart` invocation — nothing
broader.

```sudoers
# /etc/sudoers.d/financeos    (chmod 440, install via `visudo -f`)
financeos ALL=(root) NOPASSWD: /usr/bin/systemctl restart financeos
```

```bash
sudo visudo -f /etc/sudoers.d/financeos
sudo chmod 440 /etc/sudoers.d/financeos
```

### Was NICHT tun / What NOT to do

**DE.**
- Keinen zweiten Cron mit `git fetch` / `git pull` auf dem gleichen Repo —
  `.git/FETCH_HEAD` ist nicht für Concurrent-Writer ausgelegt.
- Kein `git reset --hard ORIG_HEAD` als Recovery-Fallback. ORIG_HEAD ist sticky
  aus früheren Operationen und zerstört frische Commits stillschweigend.
- Keine Sudo-Regel à la `NOPASSWD: ALL` — die optionale Convenience-Regel
  oben erlaubt nur exakt den `systemctl restart`-Befehl.

**EN.**
- Don't run a second cron that does `git fetch` / `git pull` on the same
  repo — `.git/FETCH_HEAD` is not safe for concurrent writers.
- Don't use `git reset --hard ORIG_HEAD` as a recovery fallback. ORIG_HEAD is
  sticky from earlier operations and silently nukes fresh commits.
- Don't grant `NOPASSWD: ALL` — the optional convenience entry above allows
  exactly the `systemctl restart` command and nothing else.

---

## Reverse proxy

**DE.** FinanceOS hört intern auf `:8080` und macht selbst kein TLS. Für eine
saubere Domain mit HTTPS braucht es einen Reverse Proxy davor. Hier zwei
minimal-funktionierende Snippets.

**EN.** FinanceOS listens on `:8080` and does no TLS itself. For a clean
HTTPS domain, put a reverse proxy in front. Two minimal working snippets:

### Caddy (empfohlen / recommended)

```caddyfile
finance.example.com {
    reverse_proxy localhost:8080
}
```

**DE.** Das war's. Caddy holt das Let's-Encrypt-Zertifikat selber.

**EN.** That's it. Caddy fetches the Let's Encrypt certificate by itself.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name finance.example.com;

    ssl_certificate     /etc/letsencrypt/live/finance.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/finance.example.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

### Traefik (Docker-Compose-Label)

**DE.** Wenn du eh Traefik als Cluster-Edge hast, reichen vier Labels in der
`docker-compose.yml`:

**EN.** If you already run Traefik as the cluster edge, four labels in
`docker-compose.yml` are enough:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.financeos.rule=Host(`finance.example.com`)"
  - "traefik.http.routers.financeos.entrypoints=websecure"
  - "traefik.http.routers.financeos.tls.certresolver=letsencrypt"
  - "traefik.http.services.financeos.loadbalancer.server.port=8080"
```

---

## Remote access

**DE.** FinanceOS hat per Design **keine Auth-Schicht eingeschaltet** — die
Idee ist, dass du es nur in deinem privaten Netzwerk laufen lässt. Wenn du
es von unterwegs erreichen willst, mach es über ein VPN, statt einen Port
ins offene Internet aufzumachen.

**EN.** FinanceOS by design ships with **no auth on by default** — the idea
is that it lives in your private network. To reach it from elsewhere, use
a VPN rather than punching a port into the open Internet.

### Tailscale (empfohlen / recommended)

**DE.** Tailscale ist ein Mesh-VPN auf WireGuard-Basis. Setup auf allen Geräten
in zwei Befehlen, danach taucht dein Server unter `http://financeos.<dein-tailnet>.ts.net:8080`
auf — von jedem Tailscale-eingeloggten Gerät weltweit.

**EN.** Tailscale is a WireGuard-based mesh VPN. Setup on every device is
two commands, then your server shows up as
`http://financeos.<your-tailnet>.ts.net:8080` from any Tailscale-logged-in
device anywhere.

```bash
# Auf dem FinanceOS-Host / On the FinanceOS host (Linux example):
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale set --hostname=financeos
```

**DE.** Auf der Synology gibt's das offizielle Tailscale-Paket im *Package
Center* — erst aktivieren mit Tailscale-Account verbinden, fertig. Auf dem
Pi reicht `curl ... | sh` oben.

**EN.** On Synology, the official Tailscale package lives in *Package
Center* — activate it, log in with your Tailscale account, done. On the Pi
the `curl ... | sh` above is enough.

**DE.** Optional: in der Tailscale-Admin-Konsole HTTPS für die Magic-DNS-URL
einschalten — `https://financeos.<tailnet>.ts.net` mit gültigem Zertifikat,
ohne Reverse Proxy.

**EN.** Optional: in the Tailscale admin console, enable HTTPS for the
Magic DNS URL — `https://financeos.<tailnet>.ts.net` with a valid cert,
no reverse proxy required.

### Twingate

**DE.** Zero-Trust-Alternative mit feiner Per-Resource-Access-Policy. Free Tier
deckt einen User. Setup-Skizze:

**EN.** Zero-trust alternative with fine-grained per-resource access policy.
Free tier covers a single user. Setup outline:

1. Twingate-Account anlegen, *Network → Add a Connector* → einen Connector als Docker-Container auf dem FinanceOS-Host laufen lassen.
2. *Resources → Add Resource* → `http://localhost:8080` als interne Ressource.
3. Im Twingate-Client (Mac/Windows/iOS/Android) auf den FinanceOS-Endpunkt zugreifen.

### Cloudflare Tunnel

**DE.** Wenn du Cloudflare eh fürs DNS nutzt: Cloudflare Tunnel ohne offene
Ports. Achtung: routet deinen Traffic durch Cloudflare — das musst du
bewusst akzeptieren.

**EN.** If you already use Cloudflare for DNS: Cloudflare Tunnel with no
open ports. Caveat: routes your traffic through Cloudflare — accept that
deliberately.

```bash
# Cloudflared installieren / install cloudflared
cloudflared tunnel login
cloudflared tunnel create financeos
cloudflared tunnel route dns financeos finance.example.com

# /etc/cloudflared/config.yml
tunnel: financeos
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: finance.example.com
    service: http://localhost:8080
  - service: http_status:404

cloudflared tunnel run financeos
```

**DE.** Bonus: Cloudflare Access davor, dann brauchst du den FinanceOS-eigenen
Auth-Layer gar nicht.

**EN.** Bonus: put Cloudflare Access in front and you don't need
FinanceOS's own auth layer at all.

### Was NICHT tun / What NOT to do

**DE.**
- **Keinen Port-Forward auf 8080 ohne Auth.** Selbst wenn du dein Heimnetz für
  „uninteressant" hältst — Bot-Scanner finden alles.
- **Kein Basic Auth über HTTP.** Wer Basic Auth nutzt, **muss** einen Reverse
  Proxy mit TLS davor haben. Sonst landet dein Passwort klartext im WLAN.
- **Kein „nur die richtige IP kennt das".** Security through obscurity ist
  keine.

**EN.**
- **No port-forward to 8080 without auth.** Even if you think your home
  network is "uninteresting" — bot scanners find everything.
- **No Basic Auth over plain HTTP.** If you use Basic Auth you **must**
  have a TLS-terminating reverse proxy in front. Otherwise your password
  rides plain in WiFi traffic.
- **No "only the right IP knows about it".** Security through obscurity
  is none.

---

## Enabling authentication

**DE.** Per Default läuft FinanceOS ohne Auth (LAN/Tailscale-Annahme). Wer
HTTP Basic einschalten will:

**EN.** FinanceOS runs without auth by default (LAN/Tailscale assumption).
To turn HTTP Basic on:

```bash
docker compose exec financeos python scripts/auth.py --set-password
# oder lokal / or local:
python scripts/auth.py --set-password
```

**DE.** Schreibt einen bcrypt-Hash in `config/auth.json` (`mode: "basic"`).
Server neu starten (`docker compose restart financeos` oder
`sudo systemctl restart financeos`). Browser bekommt die native
Basic-Auth-Login-Box. Wieder ausschalten: `python scripts/auth.py --disable`,
Status: `python scripts/auth.py --status`.

**EN.** Writes a bcrypt hash to `config/auth.json` (`mode: "basic"`).
Restart the server (`docker compose restart financeos` or
`sudo systemctl restart financeos`). The browser gets the native Basic
Auth login dialog. Turn it off again with `python scripts/auth.py --disable`;
check status via `python scripts/auth.py --status`.

---

## Updating FinanceOS

### Watch für Releases / Watch for releases

**DE.** Auf der GitHub-Repo-Seite oben rechts auf `Watch` → *Custom* → Häkchen
bei *Releases*. Du bekommst eine E-Mail bei jedem neuen Tag. RSS-Feed:
`https://github.com/lkasdorf/financeos_template/releases.atom`.

**EN.** On the GitHub repo page, top-right click `Watch` → *Custom* →
tick *Releases*. You get an email for every new tag. RSS feed:
`https://github.com/lkasdorf/financeos_template/releases.atom`.

### SemVer

| Bump | Was passiert / What it means | Update-Schritt / Update step |
|---|---|---|
| **Patch** `v1.2.x → v1.2.y` | Bugfix only / nur Bugfixes | `git pull && restart` |
| **Minor** `v1.x.0 → v1.y.0` | Backwards-compatible features / abwärtskompatible Features | Read release notes, `git pull && restart` |
| **Major** `v1.x → v2.0.0` | Breaking changes / Breaking Changes | Migrations-Skript siehe Release / migration script in release |

### Update-Workflow je Plattform / Update workflow per platform

**DE — Docker / Compose:**

```bash
cd /pfad/zu/financeos
git pull origin main          # oder: git fetch && git checkout v1.3.0
docker compose down
docker compose up -d --build
```

**EN — Docker / Compose:**

```bash
cd /path/to/financeos
git pull origin main          # or: git fetch && git checkout v1.3.0
docker compose down
docker compose up -d --build
```

**DE — Synology Container Manager:** im Project auf *Build* klicken (DSM zieht
neuen Code, baut neu, startet). Volumes bleiben unangetastet.

**EN — Synology Container Manager:** in the Project, click *Build* (DSM
pulls fresh code, rebuilds, restarts). Volumes are untouched.

**DE — Unraid:** Container *Force Update* aus dem WebUI. Alternativ
`docker pull && docker compose up -d` über die Unraid-Console.

**EN — Unraid:** *Force Update* on the container from the WebUI.
Alternatively `docker pull && docker compose up -d` from the Unraid
console.

**DE — Pi / lokal:**

```bash
cd /srv/financeos
git pull
pip install -r requirements.txt   # falls neue Deps / if new deps
sudo systemctl restart financeos
```

**EN — Pi / local:**

```bash
cd /srv/financeos
git pull
pip install -r requirements.txt   # if new deps
sudo systemctl restart financeos
```

### Vor jedem Major-Update / Before every major update

**DE.** Backup-ZIP aus den Settings ziehen (*Settings → Backup → Export full
data ZIP*). Synology-User: zusätzlich Hyper Backup laufen lassen. Major-
Updates kommen mit Migrations-Skripten, aber ein Snapshot beruhigt.

**EN.** Pull a backup ZIP from settings (*Settings → Backup → Export full
data ZIP*). Synology users: also run Hyper Backup. Major updates ship
migration scripts, but a snapshot is peace of mind.

---

## Backups

**DE.** Drei Ebenen, mehr braucht's nicht:

**EN.** Three layers, no more needed:

1. **Auto-Backup pro Schreibvorgang.** Jede `tx_engine.add_transaction()`-
   und Settings-Save-Operation erzeugt einen Snapshot der betroffenen CSV in
   `data/backups/`. Maximal 30 pro Datei (rotierend).
   *Each `tx_engine.add_transaction()` and settings-save operation drops a
   snapshot of the affected CSV into `data/backups/`. Max 30 per file
   (rotating).*

2. **Manuelles Full-Data-ZIP.** *Settings → Backup → Export* lädt den ganzen
   `data/`-Ordner als ZIP runter. Reinpacken: gleicher Knopf, *Import ZIP*.
   *Manual full-data ZIP — Settings → Backup → Export downloads the full
   `data/` folder. Re-import: same button, Import ZIP.*

3. **Off-Host-Backup.** Synology Hyper Backup auf USB / B2 / Cloud, oder
   `git push` ins private Remote-Repo, oder `borgmatic` o.ä. nightly. Pflicht,
   nicht optional.
   *Off-host backup — Synology Hyper Backup to USB / B2 / cloud, or
   `git push` to a private remote repo, or `borgmatic` etc. nightly.
   Mandatory, not optional.*

---

## Recurring jobs

**DE.** Optional und für die Standard-Nutzung **nicht zwingend**. Die fünf
Cron-Scripts im Repo automatisieren Komfort-Tasks:

**EN.** Optional and **not required** for normal use. The five cron scripts
in the repo automate comfort tasks:

| Script | Schedule | Was passiert / What it does | Was passiert ohne / Without it |
|---|---|---|---|
| `cron_commit.py` | `*/5 * * * *` | Bidirektionaler git-Sync (Multi-Device) / bidirectional git sync | Single-Host: irrelevant. Multi-Device: Daten driften. |
| `cron_fx.py` | `5 3 * * *` | FX-Kurse aktualisieren / refresh FX rates | Cached/Fallback-Kurse, Header-Refresh nötig / cached + fallback rates, manual refresh in header |
| `cron_metals.py` | `0 8 * * *` | Gold/Silber-Spot-Preise / gold/silver spot | Letzter Stand bis manueller Refresh / stale until manual refresh |
| `cron_sched.py` | `10 4 * * *` | Fällige Scheduled-TX als Notify / surface due scheduled TX | User muss `SCHED` manuell triggern / user must trigger SCHED manually |
| `cron_integrity.py` | `20 4 * * *` | Schema/Saldo-Drift-Check / schema + balance drift check | Keine Frühwarnung bei Daten-Korruption / no early warning |

### Wie eintragen / How to install

**DE — Pi / Linux mit cron:**

```cron
# /etc/cron.d/financeos
*/5 * * * * cd /srv/financeos && /usr/bin/python3 scripts/cron_commit.py    >> /var/log/financeos/cron_commit.log    2>&1
5  3 * * * cd /srv/financeos && /usr/bin/python3 scripts/cron_fx.py        >> /var/log/financeos/cron_fx.log        2>&1
0  8 * * * cd /srv/financeos && /usr/bin/python3 scripts/cron_metals.py    >> /var/log/financeos/cron_metals.log    2>&1
10 4 * * * cd /srv/financeos && /usr/bin/python3 scripts/cron_sched.py     >> /var/log/financeos/cron_sched.log     2>&1
20 4 * * * cd /srv/financeos && /usr/bin/python3 scripts/cron_integrity.py >> /var/log/financeos/cron_integrity.log 2>&1
```

**EN — Pi / Linux with cron:** same snippet.

**DE — Synology:** *Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script*. Befehl:

**EN — Synology:** *Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script*. Command:

```bash
docker exec financeos python scripts/cron_fx.py
```

Pro Cron-Eintrag eine Task. Trigger entsprechend der Tabelle oben setzen.
*One task per cron entry. Set triggers per the table above.*

**DE — Unraid:** *Plugins → User Scripts → Add new script*. Cron-Schedule
direkt in der UI setzen, Skript-Body ruft `docker exec financeos python scripts/cron_*.py`.

**EN — Unraid:** *Plugins → User Scripts → Add new script*. Set the cron
schedule in the UI; script body calls `docker exec financeos python scripts/cron_*.py`.

**DE — Docker auf einem anderen Host:** entweder host-seitiger cron mit
`docker exec`, oder ein Sidecar-Container wie `mcuadros/ofelia`, der die
Schedules per Compose-Label hält.

**EN — Docker on another host:** either host-side cron with `docker exec`,
or a sidecar container like `mcuadros/ofelia` that holds schedules via
Compose labels.

> **Roadmap-Hinweis / Roadmap note:** Ein eingebauter Scheduler (Python-Thread
> in `serve.py`, Auto-Detect für Container) ist für **v1.4.0** geplant. Dann
> braucht keiner mehr cron einzutragen, wenn der Container nur an einem Ort
> läuft. Stand v1.3.0 ist die manuelle Variante oben der einzige Weg.
>
> *A built-in scheduler (Python thread in `serve.py`, auto-detect for
> containers) is planned for **v1.4.0**. Then no one has to set up cron
> anymore as long as the container runs in one place. As of v1.3.0 the
> manual setup above is the only way.*
