# FinanceOS — FAQ & Référence des fonctionnalités

> Documentation vivante de chaque fonctionnalité, convention et particularité. Relue pour exactitude à chaque release.

---

## Vue d'ensemble & architecture

### Qu'est-ce que FinanceOS ?
Un système de finances personnelles auto-hébergé et basé sur des CSV. Tourne comme un dashboard single-file sur ta propre machine, dans ton propre LAN ou VPN. Toutes les données vivent sous forme de CSV/JSON dans `data/`, les transactions s'entrent via le dashboard ou le terminal Claude Code (TX free-text).

### Où vivent les données ?
- `data/` — tous les fichiers CSV/JSON (Transactions, Accounts, Categories, Tags, Scheduled, Debts, FX, Payees, Budgets, Goals, ATM Fees, Custom Reports)
- `data/backups/` — backups automatiques avant chaque écriture
- `data/bank_imports/` — dépose ici les relevés bancaires (CSV/XLS) pour la Reconciliation
- `docs/` — documents de référence (Schema, TX Guide, ce FAQ, deployment)
- `dashboard/` — SPA single-file (HTML + modules JS + CSS)
- `scripts/` — outils Python (Serve, TX Engine, Backup, jobs cron)
- `config/` — branding, features, defaults, smart-defaults, auth, i18n

### Quelle source fait foi ?
`docs/schema.md` est la source unique de vérité pour la structure des CSV. Les scripts lisent les comptes/catégories exclusivement depuis `data/accounts.csv` et `data/categories.csv`.

---

## Saisir des transactions

### Comment je saisis une transaction ?
Ouvre le dashboard, clique sur **+ Add Transaction** (ou appuie sur le bouton flottant `+` sur mobile). Remplis date, montant, compte, payee, catégorie, tags optionnels + note, clique **Save**. La plomberie CSV — backup, écriture atomique, git-commit quand un remote est configuré — se fait en coulisses.

Le flux terminal free-text `TX ...` que les anciennes versions de ce template mettaient en avant a été supprimé en v1.2.0. La saisie manuelle via le formulaire est désormais le seul chemin pris en charge.

### Smart defaults — qu'est-ce qui se remplit automatiquement ?
- **Currency** est héritée du compte choisi (ligne `data/accounts.csv`).
- Les suggestions de **Category** viennent de l'historique du payee (`data/payees.json`) — saisis le même payee deux fois avec la même catégorie et la troisième entrée se pré-remplira.
- Les **Auto-tags** s'activent quand tu configures des règles dans `config/defaults.json` (`auto_tag.by_account` et `auto_tag.by_payee`). Le template est livré sans règles auto-tag — ajoute celles qui reviennent dans tes données.

### Comment je fais un transfer ?
Mets le type sur **Transfer**, choisis les comptes source et destination, entre le montant. Une seule ligne, pas de double-comptabilisation.

### Comment je splitte un ticket sur plusieurs catégories ?
Clique sur **Add split line** dans le formulaire autant de fois que nécessaire. Chaque ligne a sa propre catégorie et son montant ; le badge live-sum passe au vert quand les splits additionnés correspondent au total saisi. Save écrit une ligne par split, toutes partageant le même `receipt_group` et (si renseignée) la même `receipt_url`.

### Comment j'ajoute des tags ?
Choisis-en dans le multi-select tag-chip du formulaire, ou tape un nouveau nom de tag et confirme pour le créer. Les nouveaux tags sont ajoutés automatiquement à `data/tags.csv`.

---

## Pass-Through & Custody

### À quoi sert un compte pass-through ?
Un compte marqué `type=pass_through` dans `data/accounts.csv` (avec la colonne `pass_through_payee` renseignée) génère automatiquement **deux lignes** pour chaque écriture :

1. La dépense réelle (avec la vraie catégorie, par ex. `Bills:Electricity`)
2. Une contre-écriture d'income (`Income:<payee> Reimbursement`)

Le solde pass-through reste donc à 0. Utile pour les comptes qui détiennent l'argent de quelqu'un d'autre que tu dépenses pour son compte — par ex. une carte prépayée financée par l'employeur. **Le wizard Setup ne livre aucun compte pass-through ;** ajoute-les via Settings → Accounts après installation.

### Qu'est-ce qu'un compte custody ?
Un compte avec `owner != self`. Écritures normales, **pas** de contre-écriture automatique. Le solde est affiché à part sous "Custody" dans le dashboard, **pas** dans le Net Worth. Utile pour de l'argent que tu administres pour quelqu'un d'autre (les économies d'un partenaire, l'argent de poche d'un enfant).

### Privé vs Pro — comment le dashboard distingue-t-il ?
Deux voies :

1. **Par compte** — quand un compte est marqué `type=pass_through` avec le bon `pass_through_payee`, chaque écriture y est implicitement côté pro, et le système d'auto-tag (`config/defaults.json` `auto_tag.by_account`) peut y apposer un tag `BUSINESS_<entity>`.
2. **Par tag** — attache manuellement un tag `BUSINESS_<entity>` à une écriture. Sert quand un compte privé a payé une dépense pro (tu seras remboursé plus tard).

Le report "Business vs. Personal" et les reports Reimbursement par entité reposent sur **`config/businesses.json`**. Chaque entité déclare ses tags (`tag: 'BUSINESS_Acme'`), ses comptes (les alias pass-through), et ses catégories d'income (`{salary: 'Income:Acme Salary', reimbursement: 'Income:Acme Reimbursement'}`). Le template livre `entities: []`, donc les reports business dégradent proprement vers "no entities configured" — les utilisateurs côté fork ajoutent les leurs.

### Règle de reimbursement
Les revenus de reimbursement pass-through (par ex. `Income:Employer Inc. Reimbursement`) comptent **partout comme un income régulier** — dashboard, chart cashflow, reports. Ne les filtre pas. Le report Income affiche le split "Real Income" vs. "Reimbursements" sous forme de tuiles info quand des entités business sont configurées.

---

## Scheduled Transactions

### C'est quoi ?
Des templates de saisies récurrentes dans `data/scheduled.csv`. L'engine ne les exécute **pas** automatiquement — uniquement sur demande.

### Commandes
- `SCHED` → entrées dues sous forme de batch preview, valide avec `y` (terminal Claude Code)
- `SCHED LIST` → toutes les entrées scheduled actives
- `SCHED ALL` → y compris `active=false`

### Bouton du dashboard (rc.12+)
Sur le Dashboard, quand au moins une entrée a `next_run <= today`, un bouton "Run N due now" apparaît dans l'en-tête de la section Upcoming Payments. Clic → modal avec la preview complète des TX (chaque entrée due en ligne cochée par défaut, y compris les contre-écritures pass-through). Décoche les lignes à sauter → "Book selected" déclenche le flux atomique backup + append + git-commit. Idempotent (deux clics d'affilée ne trouvent plus rien à la seconde fois). Appuyé par `POST /api/scheduled/preview-due` et `POST /api/scheduled/run-due` — voir "Local vs always-on" ci-dessous pour comprendre pourquoi ce bouton compte quand il n'y a pas de cron Pi.

### Format de fréquence
- `monthly:15` → le 15 de chaque mois
- `monthly:last` → dernier jour du mois
- `weekly:<weekday>` → mon/tue/wed/thu/fri/sat/sun
- `yearly:MM-DD` → une fois par an le MM-DD
- `quarterly:MM-DD` → tous les trois mois le DD ; MM ancre le set (`03-15` → Mar/Jun/Sep/Dec, `01-01` → Jan/Apr/Jul/Oct)

### Après un fire
`last_run` est mis à jour, `next_run` avancé à la prochaine occurrence. Le commit Git couvre `transactions.csv` + `scheduled.csv` ensemble.

### Maintenance
- **Nouveau :** ajoute une ligne au CSV, `sched_id` continue de manière séquentielle
- **Désactiver :** `active=false`
- **Supprimer :** uniquement si le template doit disparaître entièrement
- **Modifier :** édite directement dans le CSV

---

## Retraits ATM

### Comment je saisis un retrait ?
`TX atm 200 checking`. L'engine lit `data/atm_fees.csv`, trouve la ligne correspondante via `(bank, amount)`, et génère les écritures :
1. Transfer (montant) banque → cash, tag `ATM`
2. `fee_net` en dépense, catégorie `Fees:Bank Fees`, sans tag
3. `levy` en dépense (si > 0), sans tag
4. VAT = `fee_net × vat_rate`, sans tag (uniquement si la banque facture de la TVA sur les frais)

### Où je configure les frais ?
`Settings → ATM Fees` dans le dashboard. Champs : Bank, Amount, Currency, Fee (net), Levy, VAT rate, Note. Le total s'affiche en direct dans la table.

### Montant inconnu ?
L'engine demande : "Amount X is not in `atm_fees.csv` — provide the fees manually or create a preset?"

---

## Comptes

### Types de comptes
- `bank` / `cash` / `savings` / `mobile_money` / `credit_card` (Self, comptent dans le net worth)
- `pass_through` (solde = 0, contre-écriture automatique)
- Custody (`owner != self`, affichage séparé)

### Gérer les comptes
`Settings → Accounts` : alias, name, currency, type, owner, status (active/archived), pass-through payee, initial balance.

### Voir les soldes
- `BALANCE` dans le terminal → soldes actuels depuis `accounts.csv` + `transactions.csv`
- Dashboard → page `Accounts` avec vue détail par compte

### Saisir directement depuis un compte
Chaque page de détail de compte affiche un gros bouton primaire **"+ Add TX"** sous la ligne solde + meta. Clique →

1. La page Add TX s'ouvre avec le **compte pré-rempli** et un **bouton `← Back`** en haut.
2. Saisis comme d'habitude.
3. Après un commit réussi → **saut automatique de retour sur la même page de détail du compte**, avec le solde rafraîchi et la nouvelle transaction dans la liste.

Le plus petit bouton "+ Add TX" en haut à droite (à côté de Export XLSX) reste comme raccourci d'accès rapide quand tu as scrollé loin vers le bas.

**Comportement du bouton back :** il n'apparaît que si tu viens effectivement d'un détail de compte. Si tu passes à la page Add TX via la sidebar, le FAB, ou la touche `n` entre-temps, le contexte de retour est jeté.

---

## Catégories & Tags

### Structure des catégories
Hiérarchique via `:` — `Food`, `Food:Groceries`, `Food:Dining out`. Définies dans `data/categories.csv` avec les champs : `path`, `type` (income/expense/transfer), `active`, `note`, `pnl`, `essential`.

### Flag `essential`
Marque une catégorie comme cost-of-living (par ex. Food, Bills, Transport). Utilisé par le Cashflow Forecast (report F3) et les calculs "pure cost-of-living".

### Flag `pnl`
Marque si une catégorie apparaît dans les reports P&L (Income Statement). `false` = transfer / mouvement interne, `true` = vraie income/expense.

### Gérer les tags
`Settings → Tags` — tag + description optionnelle. Définis les tiens ; le template empty-start est livré sans tags prédéfinis.

### Éditer les catégories
Essential + pnl peuvent être réglés dans le modal d'édition. Les changements génèrent un auto-commit et le dashboard re-rend la page active pour que les reports affichent les nouvelles valeurs immédiatement.

---

## Reports

### Reports standards (catégorisés)
**Income :**
- Income Analysis — Real Income vs. Reimbursements (chart empilé)
- Income vs. Expense Summary — mois / année, net balance, savings rate
- Income Sources Breakdown — split détaillé

**Expenses :**
- Bills Overview — Rent / Electricity / Water / Internet
- Category Deep Dive
- Seasonal Heatmap
- Bank Fees
- Subscriptions

**Forecast :**
- **F3 Cashflow Forecast** — modèle à 4 couches : médiane des coûts essentiels par mois + pass-through net + revenus variables + scheduled

### Custom Reports
Reports définis par l'utilisateur via filter builder — sauvegardables, duplicables, avec leur propre chemin de rendu. Configuration dans `data/custom_reports.json`. Derrière le feature flag `custom_reports`.

### Cohérence des reports
Tous les reports de dépenses utilisent la même logique de total que le dashboard (incluant les reimbursements comme income).

### Pourquoi mon report Dining Out / Bills / Vice / AI Costs / etc. est-il vide ?
Huit reports filtrent les transactions par catégorie et cherchent les chaînes de catégorie canoniques (`Food:Dining out`, `Bills:Rent`, `Subscriptions:AI`, `Leisure:Alcohol|Smoking|Vaping`, `Fees:*`, `Other Expenses:Cash Discrepancy`, `Automobile:*`, plus la liste FIXED_PREFIXES qui pilote Discretionary vs. Fixed). Si tu as renommé une catégorie — par ex. "Restaurants" au lieu de "Food:Dining out" — le report ne voit aucune ligne correspondante.

**Fix :** ouvre **Settings → Reports** et mappe tes noms de catégorie aux buckets des reports (multi-select par report ou par bucket pour Bills/Automobile). L'étape 6 du wizard Setup pose les mêmes questions au premier lancement. Save persiste dans `config/reports.json` ; les reports se re-rendent avec le nouveau mapping immédiatement.

### Comment je renomme des catégories sans casser les reports ?
Deux options :
1. **Renomme dans `data/categories.csv`, puis mets à jour Settings → Reports.** Les reports catégorie-driven lisent le `REPORTS_CONFIG` en mémoire, donc dès que tu listes ton nouveau nom dans le bucket du report concerné, ça marche tout seul. Les transactions existantes gardent leur ancienne catégorie jusqu'à ce que tu fasses un bulk-update — Settings → Categories propose un helper de renommage.
2. **Construis un Custom Report.** Settings → Custom Reports → Add report → filter `category equals "Restaurants"`. Save. Le report original "Dining Out" affiche zéro pour toi (ou reste comme documentation), et ton custom report fait ce qu'il faut.

### Quels reports ne sont PAS affectés par les renommages ?
Net Worth Trend, Top Payees, Income vs. Expense Summary, Account Balances Over Time, Cashflow Forecast, Year-over-Year Comparison, Seasonal Heatmap, Monthly Comparison, Largest Transactions, FX Exposure, Cash vs. Digital, Weekday vs. Weekend, Savings Rate Trend, et la plupart des reports "Overview" — ils agrègent par montant/compte/date/payee, jamais par chaîne de catégorie.

### Schéma de `config/reports.json`
- **Flat reports** (Dining Out, AI Costs, Vice Spending, Bank Fees) : `{ categories: [...], match?: 'exact' | 'prefix' }`. `match` vaut `'exact'` par défaut. Plusieurs catégories : OR-match.
- **Bucket reports** (Bills, Automobile) : `{ buckets: { <bucketId>: { categories: [...] }, ... } }`. Les IDs de bucket sont stables (rent / electricity / petrol / maintenance / …) — le report les utilise pour les noms de colonnes, les couleurs et les labels i18n. Catégories par bucket : OR-match.
- **Cash Discrepancy :** `{ expense_categories: [...], income_categories: [...] }`. Deux ensembles séparés pour que le report puisse distinguer un income "found money" d'une dépense "lost money".
- **Discretionary vs. Fixed :** `{ fixed_prefixes: [...] }`. Simple liste de préfixes. Tout ce qui commence par l'un d'eux est "fixed", le reste est "discretionary".

---

## Mises à jour

### Comment je suis notifié des updates ?
Sur la page du repo GitHub, en haut à droite clique `Watch` → *Custom* → coche *Releases*. Tu reçois un email à chaque nouveau tag. Flux RSS : `https://github.com/<owner>/financeos/releases.atom`.

### Que signifie chaque version bump ?
- **Patch** (`v1.2.x → v1.2.y`) — bugfixes uniquement, fais juste `git pull && restart`.
- **Minor** (`v1.x.0 → v1.y.0`) — nouvelles features compatibles avec l'existant. Lis les release notes ; en général tu peux pull direct.
- **Major** (`v1.x → v2.0.0`) — breaking changes. La release livre un script de migration et les notes décrivent les étapes.

### Comment je mets à jour sans perdre mes données ?
Les bind-mounts (Docker) ou le fait d'avoir `data/` et `config/` en dehors du chemin d'install (Python local) gardent ton state séparé du code applicatif. Étapes de mise à jour :

- **Docker / Compose :** `git pull && docker compose down && docker compose up -d --build`
- **Synology Container Manager :** clique *Build* sur le projet — DSM pull le code à jour, rebuild, redémarre. Les volumes restent intacts.
- **Unraid :** *Force Update* sur le container depuis la WebUI.
- **Python local :** `git pull && pip install -r requirements.txt && restart`

### Faut-il faire un backup avant une mise à jour ?
Pour les patch + minor updates : pas strictement nécessaire, mais peu coûteux. **Settings → Backup → Export full data ZIP** est un snapshot complet en un clic. Pour les major updates : oui, toujours.

### Et si une release casse quelque chose ?
`git checkout <previous-tag>` et restart. Les données bind-mountées restent intactes.

---

## Export PDF

### Comment ?
Dans la vue détail d'un report, clique sur **"Export PDF"** → modal d'options (orientation, page size, include charts) → `window.print()` ouvre le dialogue d'impression système. Pas d'outil supplémentaire.

### Que peut-on configurer ?
- **Orientation :** Portrait / Landscape
- **Page Size :** A4 / Letter / A3
- **Include Charts :** Yes / No
- Le dernier choix est mémorisé pour la session.

### Typographie professionnelle
Densité financial-report : corps 8 pt, titre 12 pt, tables 7,5 pt (portrait) / 8 pt (landscape), filets fins 0,25 pt + filets épais 0,5 pt.

### Auto-fit
Les tables larges (par ex. Income Sources à 14 colonnes) sont mises à l'échelle de la largeur de page automatiquement via `transform: scale()` — minimum 55%.

### Mise en garde dark-mode
Le texte des charts s'affiche en couleurs sombres quand le dark mode est actif. Contournement : bascule en thème clair avant d'exporter.

---

## Dashboard

### Navigation
SPA via routing par hash (`#dashboard`, `#reports`, `#accounts`, …). Sidebar à gauche, menu "More" sur mobile. Détail de compte via `#account:<alias>`.

### Layout & largeurs sur grands écrans
Le dashboard et toutes les autres pages sont **alignés à gauche** sur la sidebar. La largeur du contenu s'adapte au viewport :

| Viewport | max-width |
|---|---|
| `< 1800px` (1080p / 1440p) | 1400px |
| `≥ 1800px` (QHD / 2K) | 1600px |
| `≥ 2200px` (WQHD / 4K / Ultrawide) | 1800px |

### Net Worth
La somme de chaque compte Self dans la currency d'affichage active. Les soldes pass-through valent 0 par définition ; les comptes custody sont affichés séparément.

### Currency Switcher
Dans l'en-tête. Taux en direct : `cron_fx.py` interroge d'abord la Bank of Tanzania (EUR/USD cotés en TZS ; PLN/TRY via taux croisé Frankfurter ECB) et bascule sur l'endpoint er-api configuré dans `config/defaults.json` si la BoT est injoignable. Le snapshot va dans `data/fx_rates.csv` ; l'historique s'accumule dans `data/fx_rates_history.csv`.

### Backfill des taux FX historiques
Settings → Currency → **Backfill historical rates** lance `scripts/fx_backfill.py` contre les deux mêmes sources pour combler les trous dans `data/fx_rates_history.csv`. Utile quand :

- Tu as importé MMEX avec un historique pluriannuel et tu as besoin de conversions de devise précises par période dans les reports.
- Ton dashboard a été offline un moment et `cron_fx.py` n'a pas pu prendre de snapshot.
- Tu as forké le template public, qui livre les taux jusqu'à la date de release — le wizard Setup déclenche déjà le backfill une fois après finalize, mais tu peux le relancer à tout moment.

L'étape de merge **n'écrase jamais** une ligne existante, donc relancer est sans risque. Les deux champs de date sont optionnels : laisse-les vides pour ne récupérer que les nouvelles dates depuis la dernière ligne CSV, ou règle-les explicitement pour seeder une longue plage (par ex. 2018-01-01 → today).

### Modules de sidebar
Add TX · Dashboard · Reports · Accounts · Transactions · Custom Reports · Alerts · Debts · Reconciliation · Settings · **FAQ**

(Les modules derrière des feature flags désactivés sont masqués.)

### Navigation mobile (smartphone / tablette)
En dessous de 768 px de largeur le layout mobile prend le relais avec une **top bar + hamburger drawer** :
- **Top bar épinglée en haut :** hamburger à gauche, brand centré, point d'alerte optionnel à droite
- **Le drawer glisse depuis la gauche** (280 px de large, max 80 vw) avec la liste de navigation complète
- **FAB pour Add TX** — bouton rond accent 56 px en bas à droite (fixe, toujours accessible au pouce)
- **Le drawer se ferme sur :** tap sur le backdrop, ESC, ou tap sur un item de nav
- **Le scroll du body est verrouillé** tant que le drawer est ouvert

---

## Reconciliation (système d'adaptateurs)

### But
Réconciliation mensuelle des relevés bancaires contre `transactions.csv`. Les fichiers de relevé bancaire vivent sous `data/bank_imports/`.

### Flux
`RECON` → parser le relevé → check des totaux/solde → matching des lignes par (date, amount) → expliquer les différences → écrire le rapport en `reconciliation_YYYY_MM.md` → mettre à jour `recon_index.json`.

### Système de plugins adaptateurs

La logique de relevé bancaire est pluggable via `scripts/reconciliation/`. Chaque banque est un adaptateur (sous-classe de `BankAdapter`) ; le routing compte → adaptateur passe par `config/reconciliation.json`.

Le template est livré avec un adaptateur par défaut :

| Adaptateur | Fichier | Format | Usage |
|---|---|---|---|
| `csv_generic` | `scripts/reconciliation/csv_generic.py` | `.csv` | colonnes configurables (date, details, amount ou debit+credit), format de date, séparateur décimal |

**Ajouter une nouvelle banque :**
1. Nouveau module `scripts/reconciliation/<bank>.py` avec une sous-classe de `BankAdapter` (voir `base.py`)
2. Implémenter `parse(filepath)` + `match_payee(details)`, régler les attributs de classe (`name`, `display_name`, `file_extensions`, `data_subdir`, `default_account`, `default_currency`)
3. L'ajouter à `ADAPTERS` dans `scripts/reconciliation/__init__.py`
4. Ajouter le mapping de compte dans `config/reconciliation.json`

### Différences attendues
- Décalage de date (le dashboard saisit parfois un jour avant la date de posting de la banque)
- Splits (banque = 1 ligne, FinanceOS = plusieurs)
- Arrondis depuis les sources d'import

### Vue dashboard
`#reconciliation` montre chaque rapport mensuel groupé par année avec détails. Trois endpoints recon derrière le feature flag `crdb_recon` (oui, le flag porte le nom de l'adaptateur de référence d'origine — conservé pour compatibilité) : `POST /api/recon/adapters` (liste des adaptateurs installés avec métadonnées), `POST /api/recon/files?account=` (découverte de relevés par adaptateur), `POST /api/recon/suggestions` (avec un `account` optionnel dans le body).

---

## Debts & Third Party

### Debts (prêts)
`data/debt_payments.csv` + page dashboard `#debts`. Features :
- Paiements partiels, top-up
- Support multi-devises
- Génération auto de TX au paiement
- Historique de paiement par dette

Derrière le feature flag `debt_tracking`.

### Third Party (argent d'autres personnes)
`data/third_party.csv` — avances ouvertes pour des tiers. La commande `THIRD PARTY` liste les entrées ouvertes.

---

## Payees

### Auto-learn
Le dashboard apprend automatiquement les payees depuis les nouvelles écritures — entrée dans `data/payees.json`. Revois la liste périodiquement via Settings → Payees.

### Groupes
Les payees peuvent être groupés (par ex. "Utilities" = Electric Co + Water Co + Internet). CRUD via le dashboard.

### Onglet Settings
`Settings → Payees` — liste de chaque payee avec edit/delete/merge.

---

## Quick Expenses

### Chips sous "Add TX"
Chips préréglés pour les dépenses cash fréquentes (par ex. "Coffee", "Lunch"). Un clic ouvre le formulaire Add TX pré-rempli.

### Configuration
`Settings → Quick Expenses`. Champs : Name (label du chip), Account, Payee, Category, Tags, Type, Note, Active. Derrière le feature flag `quick_expenses`.

---

## Budgets & Savings Goals

### Budgets
Par catégorie + mois — `Settings → Budgets`. Le widget du dashboard montre le tracker mois-par-mois avec barres de pourcentage.

### Savings Goals
Objectifs avec montant + deadline — `Settings → Goals`. Le dashboard montre la progression.

---

## Onglets Settings (vue d'ensemble)

| Onglet | But |
|---|---|
| Categories | CRUD pour `categories.csv` y compris pnl + essential |
| Tags | CRUD pour `tags.csv` |
| Scheduled | CRUD pour `scheduled.csv` |
| Quick Expenses | CRUD pour `quick_expenses.csv` |
| ATM Fees | CRUD pour `atm_fees.csv` |
| Payees | CRUD pour `payees.json` + groupes |
| Accounts | CRUD pour `accounts.csv` |
| Currency | devise d'affichage par défaut |
| FX Rates | overrides manuels de taux + historique |
| Goals | objectifs d'épargne |
| Budgets | budgets par catégorie et par mois |
| Backup | déclencheur manuel de backup + téléchargement ZIP complet |

(Les onglets derrière des feature flags désactivés sont masqués.)

---

## Déploiement always-on

### But
Faire tourner FinanceOS sur un host 24/7 (single-board computer, NAS, VPS) avec une synchro Git bidirectionnelle entre ton PC local et le host always-on. Guide de setup complet : **`docs/deployment.md`**.

### Jobs cron (opt-in)
Le repo est livré avec plusieurs scripts cron que tu câbles via crontab sur ton host always-on :

- `cron_commit.py` — toutes les 5 minutes une synchro git bidirectionnelle : fetch → rebase → commit des data/ en attente → push. Le service n'est **pas** redémarré automatiquement sur les pulls de code ; l'auto-restart a été retiré parce qu'il interrompait les sessions dashboard actives pendant du coding côté PC. Redémarre manuellement après un push de code : `sudo systemctl restart <unit>` (ou `ssh <host> 'sudo systemctl restart <unit>'` depuis la machine de dev).
- `cron_fx.py` — snapshot quotidien des taux FX
- `cron_sched.py` — check quotidien des scheduled dus
- `cron_integrity.py` — check quotidien schema/solde

Voir `docs/deployment.md` pour le snippet complet crontab + unit systemd + sudoers.

---

## Local vs always-on

### Qu'est-ce qui marche sans host always-on ?
Tout dans le dashboard tourne entièrement côté client une fois que `serve.py` est lancé. Ajouter des transactions, éditer des catégories, voir les reports, lancer des reconciliations, exporter en PDF — tout ça marche quand tu lances `python scripts/serve.py` à la demande et que tu l'arrêtes quand tu as fini. Aucun worker en arrière-plan n'est requis.

### Qu'est-ce qui a besoin d'un host always-on ou d'un rituel quotidien ?
Trois choses dépendent d'événements temporels qui ne se produisent que si quelque chose tourne au bon moment :

| Feature | Comportement always-on | Impact en local seul | Contournement |
|---|---|---|---|
| **Scheduled transactions** | `cron_sched.py` se déclenche quotidiennement à l'heure configurée et saisit les entrées dues automatiquement | Si le laptop est éteint quand une entrée arrive à échéance, elle reste "overdue" jusqu'au prochain clic sur le bouton **Run N due now** du Dashboard | Clique sur le bouton du dashboard quand tu commences à travailler chaque jour. Idempotent + atomique. |
| **Historique des taux FX** | `cron_fx.py` snapshot les taux quotidiennement dans `data/fx_rates_history.csv` | Les jours où ton laptop est éteint n'ont pas de snapshot → les reports time-series montrent des trous à ces dates | Soit accepter les trous (le taux actuel est toujours fetch en live à chaque page load), soit planifier `python scripts/cron_fx.py` via Windows Task Scheduler / cron / launchd |
| **Checks d'intégrité** | `cron_integrity.py` tourne la nuit, remonte les drifts schema/solde vers la page Alerts | Pas d'alertes sauf si tu le lances manuellement | Lance `python scripts/cron_integrity.py` après des édits majeurs, ou planifie-le en local |

### Et le taux FX live (currency switcher) ?
Ça marche en local sans aucun cron. Le dashboard récupère le taux actuel depuis le provider FX configuré (`config/defaults.json` → `currency.fx_api_url`) à chaque page load. Tant que tu as internet, la conversion est fraîche. Le CSV d'historique est la seule chose dont le cron est responsable, et ça n'a d'importance que pour les charts time-series qui couvrent plusieurs jours.

### Setup recommandé pour utilisateurs laptop-only
1. Lance `python scripts/serve.py` quand tu t'installes pour travailler (ou configure un raccourci bureau).
2. Clique sur **Run N due now** sur le Dashboard une fois par jour si tu as des entrées scheduled — ça remplace le cron Pi.
3. Ne te soucie pas de l'historique FX sauf si les reports FX-Exposure / time-series te dérangent activement. Si oui, configure Windows Task Scheduler :
   ```
   schtasks /create /tn "FinanceOS FX snapshot" /tr "python C:\path\to\financeos\scripts\cron_fx.py" /sc DAILY /st 08:00
   ```
   ou sur Linux/macOS ajoute à crontab :
   ```
   0 8 * * * cd /path/to/financeos && /path/to/.venv/bin/python scripts/cron_fx.py >> logs/cron_fx.log 2>&1
   ```

### Pourquoi `serve.py` ne tourne pas simplement les crons en interne ?
C'est sur la roadmap v1.4.0 (thread `apscheduler` à l'intérieur du process). En attendant, les scripts cron restent externes pour que le serveur reste simple et qu'un crash dans la logique cron ne puisse pas faire tomber le dashboard. Ça permet aussi aux utilisateurs de mixer (par ex. cron sur le Pi, dashboard sur le laptop pointant vers le même `data/` via un volume partagé).

---

## Règles dures

### Obligation de backup
Un run de `scripts/backup.py` s'exécute avant chaque écriture sur `data/*.csv`. Pas d'exceptions.

Trois couches de backup dans le système live :
1. **Backups roulants** (`data/backups/*.csv`) — automatique avant chaque écriture, max. 30 générations par fichier, les plus vieux sont auto-purgés. Settings → onglet Backup → "Backup Transactions/Scheduled/Debts/All" les déclenche aussi manuellement.
2. **Téléchargement ZIP complet** (Settings → Backup → "Download full backup (.zip)") — emballe tout le répertoire `data/` (sans `data/backups/` ni `__pycache__/`) dans un ZIP DEFLATE avec un timestamp UTC dans le nom de fichier. Endpoint : `POST /api/backup/export`.
3. **Git** (voir le point suivant) — chaque écriture est committée et pushée.

### Git après chaque écriture
`git add` + commit avec un message parlant + push (quand un remote est configuré).

### File d'attente offline
Chaque saisie TX atterrit **d'abord** dans `data/prompt_log.csv` (`booked=False`), puis elle est parsée/saisie. Au succès `booked=True`.

### Fidélité du schema
`docs/schema.md` fait foi. Les scripts lisent comptes/catégories uniquement depuis `accounts.csv` et `categories.csv`.

### Schéma de versionnage
Semantic Versioning. Bump uniquement sur les changements user-relevants ; les commits data-only ne bumpent pas la version.

### Style de réponse (intégration Claude)
Court, structuré, sans fioritures. Pour les saisies : preview → confirmation → message de commit.

---

## Feature Flags (config/features.json)

### But
Les features top-level peuvent être togglées on/off via `config/features.json` sans toucher au code. Pensé pour qu'un fresh install soit petit et focalisé ; opt-in sur les features au fur et à mesure que tu en as besoin.

### Flags disponibles

Sept flags booléens. Le template empty-start est livré avec les optionnels à `false` et les cœurs à `true`.

| Flag | Ce qui est gardé |
|---|---|
| `metals` | Page metals précieux (`#metals`), entrée de nav sidebar, CSVs metals dans `data/`, cron spot, loader metals au boot. **Off par défaut dans le template.** |
| `pwa` | Service statique sous `/pwa/*` (index, service worker, manifest, JS app). **Off par défaut dans le template.** |
| `crdb_recon` | Page Reconciliation (`#reconciliation`), nav sidebar, endpoints `/api/recon/*`, fichiers sous `/data/bank_imports/*` |
| `debt_tracking` | Page Debts (`#debts`), nav sidebar, endpoints `/api/debts/*` |
| `quick_expenses` | Chips quick-expense sous Add TX, onglet Settings "Quick Expenses", endpoints `/api/quickexp/*` |
| `custom_reports` | Page Custom Reports (`#custom-reports`), nav sidebar, endpoints `/api/custom-reports/*` |
| `scheduled_tx` | Onglet Settings "Scheduled" pour les templates SCHED, endpoints `/api/scheduled/*`. La commande CLI `SCHED` est indépendante (marche toujours) |

Les appels API contre une feature OFF retournent `404 {"error": "feature '<flag>' disabled"}`. Les éléments UI sont masqués via attributs `data-feature` (sidebar/pages) ou filtres code (onglets Settings, chips).

### Toggle
Édite `config/features.json`, mets la valeur à `true`/`false`, redémarre le serveur (Python cache par process). Exemple :

```json
{
  "metals": false,
  "pwa": false,
  "crdb_recon": true,
  "debt_tracking": true,
  "quick_expenses": true,
  "custom_reports": true,
  "scheduled_tx": true
}
```

### Défaut gracieux
Si le fichier ou une clé de flag manque, la valeur par défaut est `true` — le dashboard reste fonctionnel même sans la config.

---

## Defaults (config/defaults.json)

### But
Configuration de couche système pour les valeurs qui devraient être ajustables sans changements de code : port serveur, rétention backup, defaults currency, URLs API FX/metals, règles auto-tag, mappings reimbursement pass-through.

### Structure

```json
{
  "server":   { "default_port": 8080, "default_bind": "127.0.0.1", "dashboard_path": "/dashboard/" },
  "backup":   { "max_per_file": 30 },
  "currency": {
    "primary": "USD",
    "fallback_tzs_per_usd": 1,
    "fx_api_url": "https://open.er-api.com/v6/latest/USD",
    "metals_spot_api_url": "https://data-asg.goldprice.org/dbXRates/EUR"
  },
  "auto_tag": {
    "by_account": {},
    "by_payee":   {}
  },
  "pass_through": {
    "reimbursement_categories": {}
  }
}
```

### Où chaque clé est consommée

| Clé | Consommée par |
|---|---|
| `server.default_port` / `default_bind` / `dashboard_path` | `scripts/serve.py` (defaults CLI + construction d'URL) |
| `backup.max_per_file` | `scripts/backup.py` (rétention pour `data/backups/`) |
| `currency.primary` | `dashboard/core.js` `state.primaryCurrency` |
| `currency.fx_api_url` | `dashboard/core.js` + `scripts/cron_fx.py` |
| `auto_tag.by_account` / `by_payee` | `scripts/tx_engine.py` `apply_auto_tags()` |
| `pass_through.reimbursement_categories` | `scripts/tx_engine.py` `generate_pass_through_line()` |

### Toggle / personnaliser
Édite le fichier, redémarre le serveur (et le cron si besoin). Côté backend `lru_cache` met le contenu en cache une fois par process. Dans le dashboard `loadDefaults()` tourne au boot et écrase `window.DEFAULTS` — un page reload suffit.

### Défaut gracieux
Si le fichier ou une sous-clé manque, les fallbacks hardcodés prennent le relais. Pas de crash.

---

## Smart Defaults (config/smart_defaults.json)

### But
Couche UX pour les defaults centrés utilisateur : dans quelle devise d'affichage démarrer.

```json
{
  "ui": { "default_display_currency": "USD" }
}
```

### `ui.default_display_currency`
La devise d'affichage au **premier** chargement du dashboard (quand `localStorage['lp-default-currency']` est encore vide). Dès que l'utilisateur bascule via le currency switcher, le `localStorage` gagne.

### Défaut gracieux
Comme `defaults.json` : si le fichier manque → les fallbacks hardcodés prennent le relais, l'app continue de tourner.

---

## i18n (config/i18n/)

### But
Support multi-langue pour l'UI du dashboard sans étape de build ni framework. Pattern comme `features.json` / `defaults.json` : un fichier JSON par locale, le loader le tire au boot, les defaults HTML anglais restent comme fallback dans le markup.

### Structure

```
config/i18n/
  en.json    ← défaut, toujours présent
  de.json    ← (optionnel, ajouté par les utilisateurs côté fork)
  pl.json    ← (optionnel, idem)
```

Format : clés flat dot-path, valeurs en strings. Exemple :

```json
{
  "nav.dashboard": "Dashboard",
  "settings.tab.language": "Language",
  "settings.language.heading": "Interface Language"
}
```

Les placeholders via `{name}` sont supportés (`t('foo.bar', { count: 3 })` → `"Foo: 3"` si la string est `"Foo: {count}"`).

### Sélection de langue
**Settings → Language** montre un dropdown avec chaque code de `window.AVAILABLE_LOCALES`. La sélection est persistée dans `localStorage['lp-locale']` et override la locale browser par défaut. Au switch le dashboard reload pour que chaque rendu dynamique récupère la nouvelle langue.

Ordre de résolution de locale :
1. `localStorage['lp-locale']` s'il est défini ET dans `AVAILABLE_LOCALES`
2. `navigator.language[:2]` si le code est dans `AVAILABLE_LOCALES`
3. `'en'`

### Ajouter ta propre langue
1. Crée `config/i18n/<code>.json`, traduis chaque clé depuis `en.json` (les clés manquantes retombent silencieusement sur l'anglais)
2. Dans `dashboard/i18n.js` ajoute le code à `window.AVAILABLE_LOCALES`
3. Optionnel : ajoute un label dans chaque locale : `"settings.language.option.fr": "French"` / `"settings.language.option.fr": "Français"`
4. Reload — la nouvelle langue est dans le dropdown

### Ce qui est marqué dans le HTML
`data-i18n="key"` échange `textContent` pendant la passe `applyI18n()`. Le texte de fallback reste dans le markup, donc le browser est lisible sans JS ou avant le fetch de la locale :

```html
<span data-i18n="nav.dashboard">Dashboard</span>
```

`data-i18n-title="key"` règle l'attribut `title` (pour les tooltips).

`data-i18n-placeholder="key"` règle l'attribut `placeholder` (pour les inputs).

`data-i18n-aria-label="key"` règle l'attribut `aria-label` (pour les boutons icon-only).

`data-i18n-html="key"` règle `innerHTML` au lieu de `textContent` — pour les strings qui doivent contenir du markup inline (par ex. titres de page avec `<span class="accent">` pour le split d'accent).

### Dans le code JS
`t(key, params, fallback)` pour les strings générées dynamiquement :

```js
const label = t('settings.tab.language', {}, 'Language');
container.innerHTML = `<h3>${t('settings.language.heading')}</h3>`;
```

Le troisième argument (`fallback`) est le défaut anglais à afficher si la clé manque dans la locale active.

### Défaut gracieux
Si `en.json` est entièrement manquant ou si une clé est absente, le dashboard montre les defaults anglais cuits dans le HTML/JS — pas de crash, pas de zone vide.

### Validation avec i18n_check.py

`scripts/i18n_check.py` est le filet de sécurité : scanne `dashboard/**/*.{js,html}` pour chaque appel `t()` et attribut `data-i18n*` et compare les clés à `config/i18n/en.json`.

```bash
python scripts/i18n_check.py          # rapport texte, exit code 1 en cas d'erreurs dures
python scripts/i18n_check.py --json   # machine-readable pour CI / pre-commit
```

Trois classes d'erreurs :

| Classe | Sens | Exit code |
|---|---|---|
| `missing-in-EN` | la clé est appelée depuis le code mais absente de `en.json` | 1 (dur) |
| `missing-in-<locale>` | la clé existe dans `en.json` mais manque dans une autre locale (parité cassée) | 1 (dur) |
| `orphan` | la clé dans `en.json` n'est référencée nulle part dans le code | 0 (warn) |

---

## Setup Wizard (CLI + Web)

### But

Initialise une instance FinanceOS fraîche — écrit `data/.setup_state.json`, `config/branding.json`, `config/auth.json`, plus les fichiers de données. Après un run réussi `.setup_state.json.initialized` bascule à `true` et un second run abort avec exit code 2 (garde re-init).

### Architecture

- `scripts/setup_core.py` — logique pure (pas d'effets de bord hors des chemins fournis). API publique : `run_setup`, `write_branding`, `write_auth`, `write_setup_state`, `write_empty_seed`, `write_mmex_seed`, `check_not_initialized`. Appelé par le CLI et le wizard web avec le même dict `config`.
- `scripts/setup.py` — frontend CLI, mince. Collecte la config via flags **ou** prompts interactifs.
- `dashboard/setup.html` + `setup.js` + `setup.css` — frontend browser, mince. Wizard à six étapes en JS vanilla.

### Modes

| Mode | Commande | Quand |
|---|---|---|
| Non-interactif (flags) | `python scripts/setup.py --brand "X" --currency USD --auth-user admin --auth-pass "***" --empty` | scripté / Docker Compose / CI |
| Interactif | `python scripts/setup.py --interactive` | premier setup avec des yeux humains |
| Avec commit initial | `... --git-commit` | quand le dir cible est un repo git |

### Sources de données

- **`--empty`** — démarre avec 4 comptes génériques (`cash`, `checking`, `savings`, `credit`, tous dans la devise par défaut choisie) et ~34 catégories neutres.
- **`--mmex path/to/db.mmb`** — lit un fichier Money Manager EX via `scripts/importers/mmex.py` (read-only) et convertit le staging payload de manière déterministe dans les fichiers de données.

### Étapes interactives

Six étapes, chacune avec un défaut + une validation :

1. **Branding** — nom d'affichage + couleur d'accent
2. **Devise par défaut** — ISO 3 lettres (USD, EUR, GBP, …)
3. **Auth** — `basic` (username + password, hash bcrypt) ou `none` (avec confirmation WARNING explicite)
4. **Source de données** — `(a)` fichier MMEX ou `(b)` démarrage vide
5. **Features optionnelles** — toggles pour les sept features togglables
6. **Résumé + confirm** — vue d'ensemble complète, `n` abort sans écriture (exit 1)

### Wizard web

Contrepartie browser-based du wizard CLI. Dans un état fresh-install, `dashboard/index.html` redirige automatiquement vers `dashboard/setup.html`.

Endpoints API (tous en POST) :

| Endpoint | But |
|---|---|
| `/api/setup/status` | porte pour le frontend — retourne `{initialized, has_data, default_currency, wizard_version}` |
| `/api/setup/mmex-upload` | accepte un `.mmb` encodé en base64 (max. 20 MB), parse, stocke le staging payload, retourne résumé + preview de comptes |
| `/api/setup/finalize` | appelle `setup_core.run_setup(config, staging=…)` 1:1 comme le CLI |

**Double garde** dans les deux mutations : refus 409 quand `data/.setup_state.json.initialized=true` OU que `data/transactions.csv` a des lignes de données — protège les instances live d'un wipe accidentel.

### Dépendance

`bcrypt>=4.0` dans `requirements.txt` (lazy-importé dans `setup_core` — le mode auth `none` n'en a pas besoin).

---

## Authentification

### But
Middleware HTTP Basic Auth optionnel devant chaque route serveur. Défaut pour le template empty-start : **off** (LAN/VPN uniquement). Opt-in pour l'hébergement public ou les déploiements partagés.

### Activer

```bash
python scripts/auth.py --set-password
# Username [admin]: alice
# Password (min 8 chars): ********
# Repeat: ********
# ✓ Basic auth enabled for user 'alice'.

# Redémarre le serveur (lru_cache lit auth.json une fois)
python scripts/serve.py
```

Le browser montre alors un dialogue de login natif au prochain request (HTTP `401 + WWW-Authenticate: Basic realm="FinanceOS"`).

### Autres modes

```bash
python scripts/auth.py --status     # montre le mode actuel + user (pas de leak du hash)
python scripts/auth.py --disable    # retour à mode=none
```

### Schema (`config/auth.json`)

```json
// Auth off
{ "mode": "none" }

// Basic auth actif
{
  "mode": "basic",
  "user": "alice",
  "password_bcrypt": "$2b$12$..."
}
```

### Chemins exempts (toujours joignables quand l'auth est on)

| Chemin | Condition |
|---|---|
| `/api/health` | toujours (pour cron / monitoring) |
| `/dashboard/setup.{html,js,css}` | uniquement tant que `data/.setup_state.json` n'est pas initialisé |
| `/api/setup/{status,mmex-upload,finalize}` | uniquement tant que `data/.setup_state.json` n'est pas initialisé |

### Ce qui n'est pas supporté

- **Bouton logout dans le dashboard :** les browsers cachent les credentials basic-auth par realm jusqu'à la fermeture de l'onglet. Le serveur ne peut pas invalider ça — un "logout" serait fake.
- **Plusieurs utilisateurs :** `auth.json` a exactement un slot user. Le multi-user est sur la roadmap v2.
- **Cookies de session :** basic auth stateless uniquement.

### Dépendance

`bcrypt>=4.0` (idem que le wizard setup). Lazy-importé, pas nécessaire quand `mode=none`.

---

## CHANGELOG & versionnage

### Format
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Fichier `CHANGELOG.md` à la racine du repo.

### Sous-sections
Added · Changed · Deprecated · Removed · Fixed · Security

### Politique de versionnage

[Semantic Versioning 2.0.0](https://semver.org/) :
- **MAJOR** — breaking changes
- **MINOR** — nouvelles features, rétro-compatibles
- **PATCH** — bug fixes

### Qu'est-ce qui y rentre ?
Uniquement les changements **user-relevants** (features, UX, bugfixes, migrations de schema). Pas de refactors internes, de batches data, ni de commits de maintenance.
