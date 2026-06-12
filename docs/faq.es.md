# FinanceOS — FAQ y referencia de funcionalidades

> Documentación viva de cada función, convención y peculiaridad. Revisada para ver que sea precisa en cada release.

---

## Visión general y arquitectura

### ¿Qué es FinanceOS?
Un sistema de finanzas personales auto-alojado, basado en CSV. Funciona como un dashboard en un único archivo en tu propia máquina, en tu propia LAN o VPN. Todos los datos viven como CSV/JSON en `data/`, las transacciones se introducen a través del dashboard o del terminal de Claude Code (texto libre TX).

### ¿Dónde están los datos?
- `data/` — todos los archivos CSV/JSON (Transactions, Accounts, Categories, Tags, Scheduled, Debts, FX, Payees, Budgets, Goals, ATM Fees, Custom Reports)
- `data/backups/` — backups automáticos antes de cada escritura
- `data/bank_imports/` — coloca aquí los archivos de extractos bancarios (CSV/XLS) para la función Reconciliation
- `docs/` — documentos de referencia (Schema, guía TX, este FAQ, deployment)
- `dashboard/` — SPA en un único archivo (HTML + módulos JS + CSS)
- `scripts/` — herramientas Python (Serve, TX Engine, Backup, cron jobs)
- `config/` — branding, features, defaults, smart-defaults, auth, i18n

### ¿Qué fuente es vinculante?
`docs/schema.md` es la única fuente de verdad para la estructura CSV. Los scripts leen cuentas/categorías exclusivamente desde `data/accounts.csv` y `data/categories.csv`.

---

## Registrar transacciones

### ¿Cómo registro una transacción?
Abre el dashboard, haz clic en **+ Add Transaction** (o pulsa el botón flotante `+` en móvil). Rellena fecha, importe, cuenta, payee, categoría, tags y nota opcionales, y haz clic en **Save**. La fontanería CSV — backup, escritura atómica, git-commit cuando hay un remote configurado — ocurre por detrás.

El flujo de terminal por texto libre `TX ...` que versiones anteriores de esta plantilla anunciaban se eliminó en v1.2.0. La entrada manual a través del formulario es ahora el único camino soportado.

### Smart defaults — ¿qué se rellena automáticamente?
- **Currency** se hereda de la cuenta elegida (fila de `data/accounts.csv`).
- Las sugerencias de **Category** vienen del historial de payees (`data/payees.json`) — registra el mismo payee dos veces con la misma categoría y la tercera entrada se prerrellenará.
- Los **Auto-tags** se disparan cuando configuras reglas en `config/defaults.json` (`auto_tag.by_account` y `auto_tag.by_payee`). La plantilla viene sin reglas de auto-tag — añade las que se repitan en tus datos.

### ¿Cómo hago una transferencia?
Pon el tipo en **Transfer**, elige cuenta origen y destino, introduce el importe. Una fila, sin doble contabilización.

### ¿Cómo divido un recibo entre varias categorías?
Haz clic en **Add split line** en el formulario tantas veces como necesites. Cada línea recibe su propia categoría e importe; el badge de suma en vivo se pone verde cuando los splits cuadran con el total escrito. Save escribe una fila por split, todas compartiendo el mismo `receipt_group` y (si está adjunta) la misma `receipt_url`.

### ¿Cómo añado tags?
Elige del chip multi-select en el formulario, o escribe un nombre de tag nuevo y confirma para crearlo. Los tags nuevos se añaden automáticamente a `data/tags.csv`.

---

## Pass-Through y Custody

### ¿Qué hace una cuenta pass-through?
Una cuenta marcada como `type=pass_through` en `data/accounts.csv` (con la columna `pass_through_payee` rellena) genera automáticamente **dos filas** por cada registro:

1. El gasto real (con la categoría real, p. ej. `Bills:Electricity`)
2. Una contraentrada de ingreso (`Income:<payee> Reimbursement`)

El saldo pass-through se queda por tanto en 0. Útil para cuentas que mantienen dinero de otra persona y tú lo gastas en su nombre — p. ej. una tarjeta prepago financiada por un empleador. **El asistente de Setup no entrega cuentas pass-through;** añádelas a través de Settings → Accounts tras la instalación.

### ¿Qué es una cuenta custody?
Una cuenta con `owner != self`. Registros normales, **sin** contraentrada automática (a diferencia de pass-through). El saldo aparece por separado bajo "Custody" en el dashboard, **no** en Net Worth. Útil para dinero que administras para otra persona (los ahorros de tu pareja, la paga de un hijo).

### Privado vs. negocio — ¿cómo los distingue el dashboard?
De dos formas:

1. **Por cuenta** — cuando una cuenta está marcada como `type=pass_through` con su `pass_through_payee` correspondiente, cada registro hecho en ella es implícitamente del lado del negocio, y el sistema de auto-tags (`config/defaults.json` `auto_tag.by_account`) puede estamparle un tag `BUSINESS_<entidad>`.
2. **Por tag** — adjunta manualmente un tag `BUSINESS_<entidad>` a un registro. Se usa cuando una cuenta privada pagó un gasto del negocio (se te reembolsará luego).

El informe "Business vs. Personal" y los informes de reembolso por negocio se basan en **`config/businesses.json`**. Cada entidad declara sus tags (`tag: 'BUSINESS_Acme'`), cuentas (los alias pass-through) y categorías de ingreso (`{salary: 'Income:Acme Salary', reimbursement: 'Income:Acme Reimbursement'}`). La plantilla viene con `entities: []`, de modo que los informes de negocio degradan a "sin entidades configuradas" — los usuarios del fork añaden las suyas.

### Regla de reimbursements
Los ingresos pass-through de reembolso (p. ej. `Income:Employer Inc. Reimbursement`) cuentan **en todos lados como ingreso regular** — dashboard, gráfico de cashflow, informes. No los filtres fuera. El informe de Income muestra adicionalmente el split "Real Income" vs. "Reimbursements" como tarjetas informativas cuando hay entidades de negocio configuradas.

---

## Transacciones programadas (Scheduled)

### ¿Qué es?
Plantillas de registros recurrentes en `data/scheduled.csv`. El motor **no** las ejecuta automáticamente — solo a petición.

### Comandos
- `SCHED` → entradas vencidas como vista previa por lotes, registra con `y` (terminal Claude Code)
- `SCHED LIST` → todas las entradas programadas activas
- `SCHED ALL` → incluyendo las `active=false`

### Botón en el dashboard (rc.12+)
En el Dashboard, cuando al menos una entrada tiene `next_run <= hoy`, aparece un botón "Run N due now" en la cabecera de la sección Upcoming Payments. Clic → modal con la vista previa TX completa (cada entrada vencida como fila marcada por defecto, incluyendo contraentradas pass-through). Desmarca las filas que quieras saltar → "Book selected" dispara el flujo atómico backup + append + git-commit. Idempotente (hacer clic dos veces seguidas no encuentra nada vencido la segunda vez). Respaldado por `POST /api/scheduled/preview-due` y `POST /api/scheduled/run-due` — ver "Local vs always-on" más abajo para entender por qué el botón importa cuando no hay un cron en una Pi.

### Formato de frequency
- `monthly:15` → el día 15 de cada mes
- `monthly:last` → último día del mes
- `weekly:<weekday>` → mon/tue/wed/thu/fri/sat/sun
- `yearly:MM-DD` → una vez al año en MM-DD
- `quarterly:MM-DD` → cada tres meses el día DD; MM ancla el conjunto (`03-15` → mar/jun/sep/dic, `01-01` → ene/abr/jul/oct)

### Tras disparar
`last_run` se actualiza, `next_run` se adelanta a la siguiente ocurrencia. Un único git commit cubre `transactions.csv` + `scheduled.csv` juntos.

### Mantenimiento
- **Nueva:** añade una fila al CSV, `sched_id` continúa secuencialmente
- **Desactivar:** `active=false`
- **Borrar:** solo si la plantilla entera debe desaparecer
- **Modificar:** edita directamente en el CSV

---

## Retiradas en cajero (ATM)

### ¿Cómo registro una retirada?
`TX atm 200 checking`. El motor lee `data/atm_fees.csv`, encuentra la fila coincidente vía `(bank, amount)` y genera los registros:
1. Transferencia (importe) de banco → cash, tag `ATM`
2. `fee_net` como gasto, categoría `Fees:Bank Fees`, sin tag
3. `levy` como gasto (si > 0), sin tag
4. VAT = `fee_net × vat_rate`, sin tag (solo cuando el banco cobra IVA sobre las comisiones)

### ¿Dónde configuro las comisiones?
`Settings → ATM Fees` en el dashboard. Campos: Bank, Amount, Currency, Fee (net), Levy, VAT rate, Note. El total se muestra en vivo en la tabla.

### ¿Importe desconocido?
El motor pregunta: "Amount X is not in `atm_fees.csv` — provide the fees manually or create a preset?"

---

## Cuentas

### Tipos de cuenta
- `bank` / `cash` / `savings` / `mobile_money` / `credit_card` (Self, cuentan para el net worth)
- `pass_through` (saldo = 0, contraentrada automática)
- Custody (`owner != self`, se muestra por separado)

### Mantener cuentas
`Settings → Accounts`: alias, name, currency, type, owner, status (active/archived), pass-through payee, saldo inicial.

### Ver saldos
- `BALANCE` en el terminal → saldos actuales desde `accounts.csv` + `transactions.csv`
- Dashboard → página `Accounts` con una vista de detalle por cuenta

### Registrar directamente desde una cuenta
Cada página de detalle de cuenta muestra un botón primario grande **"+ Add TX"** debajo del saldo + fila de meta. Clic →

1. La página Add TX se abre con la **cuenta prerrellenada** y un botón **`← Back`** arriba.
2. Registra como siempre.
3. Tras un commit con éxito → **salto automático de vuelta a la misma página de detalle de cuenta**, con el saldo refrescado y la nueva transacción en la lista.

El botón más pequeño "+ Add TX" arriba a la derecha (junto a Export XLSX) se queda como atajo de acceso rápido para cuando has hecho scroll lejos hacia abajo.

**Comportamiento del botón Back:** solo aparece si realmente vienes de una vista de detalle de cuenta. Si cambias a la página Add TX a través de la sidebar, el FAB o la tecla `n` por el medio, el contexto de retorno se descarta.

---

## Categorías y tags

### Estructura de categorías
Jerárquica vía `:` — `Food`, `Food:Groceries`, `Food:Dining out`. Definida en `data/categories.csv` con los campos: `path`, `type` (income/expense/transfer), `active`, `note`, `pnl`, `essential`.

### Flag `essential`
Marca una categoría como gasto fijo de subsistencia (p. ej. Food, Bills, Transport). La usa el Cashflow Forecast (informe F3) y los cálculos "pure cost-of-living".

### Flag `pnl`
Marca si una categoría aparece en los informes P&L (Income Statement). `false` = transferencia / movimiento interno, `true` = ingreso/gasto real.

### Mantener tags
`Settings → Tags` — tag + descripción opcional. Define los tuyos; la plantilla de inicio vacío no trae tags preconfigurados.

### Editar categorías
Essential + pnl se pueden configurar en el modal de edición. Los cambios generan un auto-commit y el dashboard re-renderiza la página activa para que los informes muestren los nuevos valores inmediatamente.

---

## Informes (Reports)

### Informes estándar (categorizados)
**Income:**
- Income Analysis — Real Income vs. Reimbursements (gráfico apilado)
- Income vs. Expense Summary — mes / año, saldo neto, savings rate
- Income Sources Breakdown — split detallado

**Expenses:**
- Bills Overview — Rent / Electricity / Water / Internet
- Category Deep Dive
- Seasonal Heatmap
- Bank Fees
- Subscriptions

**Forecast:**
- **F3 Cashflow Forecast** — modelo de 4 capas: mediana mensual de coste esencial + neto pass-through + ingreso variable + scheduled

### Custom Reports
Informes definidos por el usuario vía filter builder — guardables, duplicables, con su propio camino de renderizado. Configuración en `data/custom_reports.json`. Detrás del feature flag `custom_reports`.

### Consistencia entre informes
Todos los informes de gastos usan la misma lógica de totales que el dashboard (incl. reimbursements como ingreso).

### ¿Por qué está vacío mi informe de Dining Out / Bills / Vice / AI Costs / etc.?
Ocho informes filtran transacciones por categoría y buscan los strings canónicos (`Food:Dining out`, `Bills:Rent`, `Subscriptions:AI`, `Leisure:Alcohol|Smoking|Vaping`, `Fees:*`, `Other Expenses:Cash Discrepancy`, `Automobile:*`, más la lista FIXED_PREFIXES que mueve Discretionary vs. Fixed). Si renombraste una categoría — p. ej. "Restaurants" en vez de "Food:Dining out" — el informe no ve filas coincidentes.

**Solución:** abre **Settings → Reports** y mapea los nombres de tus categorías a los buckets de los informes (multi-select por informe o por bucket para Bills/Automobile). El paso 6 del asistente de Setup hace las mismas preguntas en el primer arranque. Save persiste a `config/reports.json`; los informes se re-renderizan con el nuevo mapping inmediatamente.

### ¿Cómo renombro categorías sin romper los informes?
Dos opciones:

1. **Renombra en `data/categories.csv`, luego actualiza Settings → Reports.** Los informes guiados por categoría leen `REPORTS_CONFIG` en memoria, así que en cuanto pongas tu nuevo nombre en el bucket del informe afectado, todo funciona. Las transacciones existentes mantienen su categoría antigua hasta que las actualices en bloque — Settings → Categories tiene un helper de renombrado.
2. **Construye un Custom Report.** Settings → Custom Reports → Add report → filtro `category equals "Restaurants"`. Guardar. El informe original "Dining Out" te muestra cero (o se queda como documentación), y tu informe custom hace lo correcto.

### ¿Qué informes NO se ven afectados por renombrados?
Net Worth Trend, Top Payees, Income vs. Expense Summary, Account Balances Over Time, Cashflow Forecast, Year-over-Year Comparison, Seasonal Heatmap, Monthly Comparison, Largest Transactions, FX Exposure, Cash vs. Digital, Weekday vs. Weekend, Savings Rate Trend, y la mayoría de informes "Overview" — agregan por importe/cuenta/fecha/payee, nunca por string de categoría.

### Esquema de `config/reports.json`
- **Informes planos** (Dining Out, AI Costs, Vice Spending, Bank Fees): `{ categories: [...], match?: 'exact' | 'prefix' }`. `match` por defecto `'exact'`. Múltiples categorías hacen OR-match.
- **Informes con buckets** (Bills, Automobile): `{ buckets: { <bucketId>: { categories: [...] }, ... } }`. Los IDs de bucket son estables (rent / electricity / petrol / maintenance / …) — el informe los usa para nombres de columna, colores y etiquetas i18n. Categorías por bucket: OR-match.
- **Cash Discrepancy:** `{ expense_categories: [...], income_categories: [...] }`. Dos conjuntos separados para que el informe pueda distinguir un ingreso de "dinero encontrado" de un gasto de "dinero perdido".
- **Discretionary vs. Fixed:** `{ fixed_prefixes: [...] }`. Lista plana de prefijos. Cualquier cosa que empiece con uno de estos es "fixed", todo lo demás es "discretionary".

---

## Actualizar

### ¿Cómo me entero de actualizaciones?
En la página del repo en GitHub, arriba a la derecha clic en `Watch` → *Custom* → marca *Releases*. Recibes un email por cada nuevo tag. Feed RSS: `https://github.com/<owner>/financeos/releases.atom`.

### ¿Qué significa cada bump de versión?
- **Patch** (`v1.2.x → v1.2.y`) — solo bugfixes, simple `git pull && restart`.
- **Minor** (`v1.x.0 → v1.y.0`) — nuevas funciones compatibles hacia atrás. Lee las release notes; normalmente puedes hacer pull directo.
- **Major** (`v1.x → v2.0.0`) — cambios incompatibles. El release trae un script de migración y las notas describen los pasos.

### ¿Cómo actualizo sin perder datos?
Los bind-mounts (Docker) o `data/` y `config/` fuera de la ruta de instalación (Python local) mantienen tu estado separado del código de la app. Pasos de actualización:

- **Docker / Compose:** `git pull && docker compose down && docker compose up -d --build`
- **Synology Container Manager:** clic en *Build* sobre el proyecto — DSM hace pull del código fresco, reconstruye, reinicia. Volúmenes intactos.
- **Unraid:** *Force Update* sobre el contenedor desde la WebUI.
- **Python local:** `git pull && pip install -r requirements.txt && restart`

### ¿Debería hacer backup antes de actualizar?
Para actualizaciones patch + minor: no es estrictamente necesario, pero es barato. **Settings → Backup → Export full data ZIP** es un snapshot completo de un clic. Para actualizaciones major: sí, siempre.

### ¿Qué pasa si un release rompe algo?
`git checkout <previous-tag>` y reinicia. Los datos bind-mounted permanecen intactos.

---

## Exportar a PDF

### ¿Cómo?
En la vista de detalle de informe haz clic en **"Export PDF"** → modal de opciones (orientación, tamaño de página, incluir gráficos) → `window.print()` abre el diálogo de impresión del sistema. Sin herramientas extra.

### ¿Qué se puede configurar?
- **Orientation:** Portrait / Landscape
- **Page Size:** A4 / Letter / A3
- **Include Charts:** Yes / No
- La última elección se recuerda durante la sesión.

### Tipografía profesional
Densidad de informe financiero: cuerpo 8 pt, título 12 pt, tablas 7.5 pt (portrait) / 8 pt (landscape), líneas finas 0.25 pt + líneas gruesas 0.5 pt.

### Auto-fit
Las tablas anchas (p. ej. Income Sources de 14 columnas) se escalan automáticamente al ancho de página vía `transform: scale()` — mínimo 55%.

### Caveat dark-mode
El texto de los gráficos se renderiza en colores oscuros cuando el modo oscuro está activo. Workaround: cambia al tema claro antes de exportar.

---

## Dashboard

### Navegación
SPA vía hash routing (`#dashboard`, `#reports`, `#accounts`, …). Sidebar a la izquierda, menú "More" en móvil. Detalle de cuenta vía `#account:<alias>`.

### Layout y anchos en monitores grandes
El dashboard y todas las demás páginas están **alineados a la izquierda** con la sidebar. El ancho del contenido se adapta al viewport:

| Viewport | max-width |
|---|---|
| `< 1800px` (1080p / 1440p) | 1400px |
| `≥ 1800px` (QHD / 2K) | 1600px |
| `≥ 2200px` (WQHD / 4K / Ultrawide) | 1800px |

### Net Worth
La suma de cada cuenta Self en la moneda de visualización activa. Los saldos pass-through son 0 por definición; las cuentas custody se muestran por separado.

### Currency Switcher
En la cabecera. Tasas en vivo: `cron_fx.py` consulta primero el Bank of Tanzania (EUR/USD cotizados en TZS; PLN/TRY vía cross-rate Frankfurter ECB) y cae sobre el endpoint er-api configurado en `config/defaults.json` si BoT no es alcanzable. El snapshot va a `data/fx_rates.csv`; el histórico se acumula en `data/fx_rates_history.csv`.

### Backfill de tasas FX históricas
Settings → Currency → **Backfill historical rates** ejecuta `scripts/fx_backfill.py` contra las mismas dos fuentes para rellenar huecos en `data/fx_rates_history.csv`. Útil cuando:

- Importaste MMEX con historial de varios años y necesitas conversión precisa por periodo en los informes.
- Tu dashboard estuvo offline un tiempo y `cron_fx.py` no pudo snapshotear.
- Forkeaste la plantilla pública, que trae tasas hasta la fecha del release — el asistente de Setup ya dispara el backfill una vez tras finalize, pero puedes re-ejecutarlo cuando quieras.

El paso de merge **nunca sobreescribe** una fila existente, así que re-ejecutar es seguro. Ambos campos de fecha son opcionales: déjalos vacíos para traer solo fechas nuevas desde la última fila del CSV, o ponlos explícitamente para sembrar un rango largo (p. ej. 2018-01-01 → hoy).

### Módulos de la sidebar
Add TX · Dashboard · Reports · Accounts · Transactions · Custom Reports · Alerts · Debts · Reconciliation · Settings · **FAQ**

(Los módulos detrás de feature flags apagados están ocultos.)

### Navegación móvil (smartphone / tablet)
Por debajo de 768 px de ancho el layout móvil toma el control con una **top bar + drawer hamburger**:
- **Top bar fijada arriba:** hamburger a la izquierda, brand centrado, un punto opcional de alertas a la derecha
- **Drawer entra deslizando desde la izquierda** (280 px de ancho, máx. 80 vw) con la lista de navegación completa
- **FAB para Add TX** — botón redondo de 56 px con acento abajo a la derecha (fijo, siempre al alcance del pulgar)
- **El drawer se cierra al:** tocar el backdrop, ESC, o tocar un item de navegación
- **El scroll del body se bloquea** mientras el drawer está abierto

---

## Reconciliation (sistema de adapters)

### Propósito
Reconciliación mensual de extractos bancarios contra `transactions.csv`. Los archivos de extractos viven bajo `data/bank_imports/`.

### Flujo
`RECON` → parsear extracto → comprobación de totales/saldo → matching de filas por (fecha, importe) → explicar diferencias → escribir el informe como `reconciliation_YYYY_MM.md` → actualizar `recon_index.json`.

### Sistema de plugin de adapters

La lógica de extracto bancario es enchufable vía `scripts/reconciliation/`. Cada banco es un adapter (subclase de `BankAdapter`); el mapeo cuenta → adapter se enruta a través de `config/reconciliation.json`.

La plantilla viene con un adapter por defecto:

| Adapter | Archivo | Formato | Uso |
|---|---|---|---|
| `csv_generic` | `scripts/reconciliation/csv_generic.py` | `.csv` | columnas configurables (date, details, amount o debit+credit), formato de fecha, separador decimal |

**Añadir un banco nuevo:**
1. Nuevo módulo `scripts/reconciliation/<bank>.py` con una subclase de `BankAdapter` (ver `base.py`)
2. Implementa `parse(filepath)` + `match_payee(details)`, ajusta los atributos de clase (`name`, `display_name`, `file_extensions`, `data_subdir`, `default_account`, `default_currency`)
3. Añádelo a `ADAPTERS` en `scripts/reconciliation/__init__.py`
4. Añade el mapeo de cuenta en `config/reconciliation.json`

### Diferencias esperadas
- Desplazamiento de fecha (el dashboard a veces registra un día antes que la fecha de posting del banco)
- Splits (banco = 1 fila, FinanceOS = varias)
- Redondeo desde las fuentes importadas

### Vista del dashboard
`#reconciliation` muestra cada informe mensual agrupado por año con detalles. Tres endpoints de recon detrás del feature flag `crdb_recon` (sí, el flag lleva el nombre del adapter de referencia original — se mantiene por compatibilidad): `POST /api/recon/adapters` (lista de adapters instalados con metadatos), `POST /api/recon/files?account=` (descubrimiento de archivos por adapter), `POST /api/recon/suggestions` (con `account` opcional en el body).

---

## Debts y Third Party

### Debts (préstamos)
`data/debt_payments.csv` + página de dashboard `#debts`. Características:
- Pagos parciales, top-up
- Soporte de moneda extranjera
- Generación automática de TX al pagar
- Historial de pagos por deuda

Detrás del feature flag `debt_tracking`.

### Third Party (dinero de otras personas)
`data/third_party.csv` — adelantos abiertos para terceros. El comando `THIRD PARTY` lista entradas abiertas.

---

## Payees

### Auto-aprendizaje
El dashboard auto-aprende payees desde nuevos registros — entrada en `data/payees.json`. Revisa la lista periódicamente a través de Settings → Payees.

### Grupos
Los payees pueden agruparse (p. ej. "Utilities" = Electric Co + Water Co + Internet). CRUD desde el dashboard.

### Pestaña Settings
`Settings → Payees` — lista de cada payee con edit/delete/merge.

---

## Quick Expenses

### Chips bajo "Add TX"
Chips preset para gastos en efectivo frecuentes (p. ej. "Coffee", "Lunch"). Un clic abre el formulario Add TX prerrellenado.

### Configuración
`Settings → Quick Expenses`. Campos: Name (etiqueta del chip), Account, Payee, Category, Tags, Type, Note, Active. Detrás del feature flag `quick_expenses`.

---

## Budgets y Savings Goals

### Budgets
Por categoría + mes — `Settings → Budgets`. El widget del dashboard muestra el tracker mes a mes con barras de porcentaje.

### Savings Goals
Objetivos con importe + fecha límite — `Settings → Goals`. El dashboard muestra el progreso.

---

## Pestañas de Settings (vista general)

| Pestaña | Propósito |
|---|---|
| Categories | CRUD para `categories.csv` incl. pnl + essential |
| Tags | CRUD para `tags.csv` |
| Scheduled | CRUD para `scheduled.csv` |
| Quick Expenses | CRUD para `quick_expenses.csv` |
| ATM Fees | CRUD para `atm_fees.csv` |
| Payees | CRUD para `payees.json` + grupos |
| Accounts | CRUD para `accounts.csv` |
| Currency | moneda de visualización por defecto |
| FX Rates | overrides manuales de tasas + histórico |
| Goals | savings goals |
| Budgets | budgets por categoría por mes |
| Backup | trigger manual de backup + descarga del ZIP completo |

(Las pestañas detrás de feature flags apagados están ocultas.)

---

## Deployment always-on

### Propósito
Ejecutar FinanceOS en un host 24/7 (single-board computer, NAS, VPS) con sincronización bidireccional vía Git entre tu PC local y el host always-on. Guía completa de setup: **`docs/deployment.md`**.

### Cron jobs (opt-in)
El repo trae varios scripts cron que cableas vía crontab en tu host always-on:

- `cron_commit.py` — cada 5 minutos un sync git bidireccional: fetch → rebase → commit de lo pendiente en data/ → push. El servicio **no** se reinicia automáticamente tras pulls de código; el auto-restart se eliminó porque interrumpía sesiones activas del dashboard durante codificación desde el PC. Reinicia a mano tras un push de código: `sudo systemctl restart <unit>` (o `ssh <host> 'sudo systemctl restart <unit>'` desde la máquina de desarrollo).
- `cron_fx.py` — snapshot diario de tasas FX
- `cron_sched.py` — chequeo diario de scheduled vencidos
- `cron_integrity.py` — chequeo diario de schema/saldos

Ver `docs/deployment.md` para el snippet completo de crontab + unit de systemd + sudoers.

---

## Local vs. always-on

### ¿Qué funciona sin un host always-on?
Todo en el dashboard funciona enteramente en el lado cliente una vez `serve.py` está arriba. Añadir transacciones, editar categorías, ver informes, ejecutar reconciliations, exportar PDFs — todo esto funciona cuando arrancas `python scripts/serve.py` a demanda y lo paras cuando acabas. No se requiere worker en background.

### ¿Qué necesita un host always-on o un ritual diario?
Tres cosas dependen de eventos basados en tiempo que no ocurren a menos que algo esté corriendo en el momento adecuado:

| Función | Comportamiento always-on | Impacto solo local | Workaround |
|---|---|---|---|
| **Transacciones programadas** | `cron_sched.py` dispara diariamente a la hora configurada y registra las entradas vencidas automáticamente | Si el portátil está apagado cuando vence una entrada, se queda "overdue" hasta que pulses el botón **Run N due now** del Dashboard | Pulsa el botón del dashboard cuando empiezas a trabajar cada día. Idempotente + atómico. |
| **Historial de tasas FX** | `cron_fx.py` snapshotea tasas diariamente en `data/fx_rates_history.csv` | Los días que tu portátil está apagado no reciben snapshot → los informes time-series muestran huecos en esas fechas | Acepta los huecos (la tasa actual aún se trae en vivo en cada carga de página), o programa `python scripts/cron_fx.py` vía Windows Task Scheduler / cron / launchd |
| **Chequeos de integridad** | `cron_integrity.py` corre nocturnamente, expone drift de schema/saldos a la página de Alerts | Sin alertas a menos que lo ejecutes a mano | Ejecuta `python scripts/cron_integrity.py` tras ediciones mayores, o prográmalo localmente |

### ¿Y la tasa FX en vivo (currency switcher)?
Eso funciona local sin ningún cron. El dashboard trae la tasa actual del proveedor FX configurado (`config/defaults.json` → `currency.fx_api_url`) en cada carga de página. Mientras tengas internet, la conversión es fresca. El CSV histórico es lo único de lo que el cron es responsable, y solo importa para gráficos time-series que abarcan varios días.

### Setup recomendado para usuarios solo portátil
1. Arranca `python scripts/serve.py` cuando te sientas a trabajar (o configúrate un atajo de escritorio).
2. Haz clic en **Run N due now** en el Dashboard una vez al día si tienes entradas programadas — esto sustituye al cron de la Pi.
3. No te preocupes por el historial FX a menos que los informes FX-Exposure / time-series te molesten activamente. Si lo hacen, configura el Windows Task Scheduler:
   ```
   schtasks /create /tn "FinanceOS FX snapshot" /tr "python C:\path\to\financeos\scripts\cron_fx.py" /sc DAILY /st 08:00
   ```
   o en Linux/macOS añade al crontab:
   ```
   0 8 * * * cd /path/to/financeos && /path/to/.venv/bin/python scripts/cron_fx.py >> logs/cron_fx.log 2>&1
   ```

### ¿Por qué `serve.py` no ejecuta los crons internamente?
Eso está en la roadmap de v1.4.0 (thread `apscheduler` dentro del proceso). Hasta entonces los scripts cron se quedan externos para que el servidor se mantenga simple y un crash en la lógica del cron no pueda tumbar el dashboard. También deja a los usuarios mezclar y combinar (p. ej. cron en la Pi, dashboard en el portátil apuntando al mismo `data/` sobre un volumen compartido).

---

## Reglas duras

### Mandato de backup
Una ejecución de `scripts/backup.py` se lanza antes de cada escritura en `data/*.csv`. Sin excepciones.

Tres capas de backup en el sistema vivo:
1. **Rolling backups** (`data/backups/*.csv`) — automáticos antes de cada escritura, máx. 30 generaciones por archivo, los más antiguos se podan automáticamente. Settings → pestaña Backup → "Backup Transactions/Scheduled/Debts/All" también los dispara manualmente.
2. **Descarga ZIP completa** (Settings → Backup → "Download full backup (.zip)") — empaqueta todo el directorio `data/` (sin `data/backups/` ni `__pycache__/`) en un ZIP DEFLATE con timestamp UTC en el nombre. Endpoint: `POST /api/backup/export`.
3. **Git** (ver siguiente punto) — cada escritura se commitea y empuja.

### Git tras cada escritura
`git add` + commit con mensaje significativo + push (cuando hay un remote configurado).

### Cola offline
Cada entrada TX aterriza **primero** en `data/prompt_log.csv` (`booked=False`), luego se parsea/registra. En éxito `booked=True`.

### Fidelidad al schema
`docs/schema.md` es vinculante. Los scripts leen cuentas/categorías solo desde `accounts.csv` y `categories.csv`.

### Esquema de versionado
Semantic Versioning. Bumpea solo en cambios relevantes para el usuario; los commits solo de datos no bumpean la versión.

### Estilo de respuesta (integración con Claude)
Corto, estructurado, sin paja. Para registros: preview → confirmación → mensaje de commit.

---

## Feature Flags (config/features.json)

### Propósito
Las funcionalidades de alto nivel se pueden encender/apagar vía `config/features.json` sin tocar código. Construido para que una instalación fresca sea pequeña y enfocada; opta por las funciones que necesites.

### Flags disponibles

Siete flags booleanos. La plantilla de inicio vacío trae las opcionales en `false` y las core en `true`.

| Flag | Qué se controla |
|---|---|
| `metals` | Página de metales preciosos (`#metals`), entrada en la sidebar, CSVs de metales en `data/`, cron de spot, loader de metales en boot. **Apagado por defecto en la plantilla.** |
| `pwa` | Servicio estático bajo `/pwa/*` (index, service worker, manifest, JS de app). **Apagado por defecto en la plantilla.** |
| `crdb_recon` | Página Reconciliation (`#reconciliation`), nav en sidebar, endpoints `/api/recon/*`, archivos bajo `/data/bank_imports/*` |
| `debt_tracking` | Página Debts (`#debts`), nav en sidebar, endpoints `/api/debts/*` |
| `quick_expenses` | Chips de quick-expense bajo Add TX, pestaña Settings "Quick Expenses", endpoints `/api/quickexp/*` |
| `custom_reports` | Página Custom Reports (`#custom-reports`), nav en sidebar, endpoints `/api/custom-reports/*` |
| `scheduled_tx` | Pestaña Settings "Scheduled" para plantillas SCHED, endpoints `/api/scheduled/*`. El comando CLI `SCHED` es independiente (sigue funcionando) |

Las llamadas API contra una función en OFF devuelven `404 {"error": "feature '<flag>' disabled"}`. Los elementos UI se ocultan vía atributos `data-feature` (sidebar/páginas) o filtros de código (pestañas Settings, chips).

### Cambiar
Edita `config/features.json`, pon el valor en `true`/`false`, reinicia el servidor (Python cachea por proceso). Ejemplo:

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

### Default benigno
Si falta el archivo o una clave de flag, el default es `true` — el dashboard sigue funcionando incluso sin el config.

---

## Defaults (config/defaults.json)

### Propósito
Configuración de capa de sistema para valores que deberían ser ajustables sin cambios de código: puerto del servidor, retención de backup, defaults de moneda, URLs de APIs FX/metales, reglas de auto-tag, mapeos de reembolso pass-through.

### Estructura

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

### Dónde se consume cada clave

| Clave | Consumida por |
|---|---|
| `server.default_port` / `default_bind` / `dashboard_path` | `scripts/serve.py` (defaults del CLI + construcción de URL) |
| `backup.max_per_file` | `scripts/backup.py` (retención para `data/backups/`) |
| `currency.primary` | `dashboard/core.js` `state.primaryCurrency` |
| `currency.fx_api_url` | `dashboard/core.js` + `scripts/cron_fx.py` |
| `auto_tag.by_account` / `by_payee` | `scripts/tx_engine.py` `apply_auto_tags()` |
| `pass_through.reimbursement_categories` | `scripts/tx_engine.py` `generate_pass_through_line()` |

### Cambiar / personalizar
Edita el archivo, reinicia el servidor (y el cron si hace falta). En el backend `lru_cache` cachea el contenido una vez por proceso. En el dashboard `loadDefaults()` corre en boot y sobreescribe `window.DEFAULTS` — un recargado de página basta.

### Default benigno
Si falta el archivo o una sub-clave, los fallbacks hardcoded toman el relevo. Sin crashes.

---

## Smart Defaults (config/smart_defaults.json)

### Propósito
Capa UX para defaults centrados en el usuario: en qué moneda de visualización arrancar.

```json
{
  "ui": { "default_display_currency": "USD" }
}
```

### `ui.default_display_currency`
La moneda de visualización en la **primera** carga del dashboard (cuando `localStorage['lp-default-currency']` aún está vacío). En cuanto el usuario toca el currency switcher, gana `localStorage`.

### Default benigno
Como `defaults.json`: si falta el archivo → los fallbacks hardcoded entran, la app sigue funcionando.

---

## i18n (config/i18n/)

### Propósito
Soporte multi-idioma para la UI del dashboard sin paso de build ni framework. Patrón como `features.json` / `defaults.json`: un archivo JSON por locale, el loader lo trae en boot, los defaults HTML en inglés se quedan como fallback en el markup.

### Estructura

```
config/i18n/
  en.json    ← default, siempre presente
  de.json    ← (opcional, los usuarios del fork lo añaden)
  pl.json    ← (opcional, idem)
```

Formato: claves planas con path en puntos, valores como strings. Ejemplo:

```json
{
  "nav.dashboard": "Dashboard",
  "settings.tab.language": "Language",
  "settings.language.heading": "Interface Language"
}
```

Los placeholders vía `{name}` se soportan (`t('foo.bar', { count: 3 })` → `"Foo: 3"` si el string es `"Foo: {count}"`).

### Selección de idioma
**Settings → Language** muestra un dropdown con cada código de `window.AVAILABLE_LOCALES`. La selección se persiste a `localStorage['lp-locale']` y sobreescribe el locale por defecto del navegador. Al cambiar el dashboard se recarga para que cada render dinámico tome el nuevo idioma.

Orden de resolución del locale:
1. `localStorage['lp-locale']` si está y está en `AVAILABLE_LOCALES`
2. `navigator.language[:2]` si el código está en `AVAILABLE_LOCALES`
3. `'en'`

### Añadir tu propio idioma
1. Crea `config/i18n/<code>.json`, traduce cada clave de `en.json` (las claves que falten caen silenciosamente a inglés)
2. En `dashboard/i18n.js` añade el código a `window.AVAILABLE_LOCALES`
3. Opcional: añade una etiqueta en cada locale: `"settings.language.option.fr": "French"` / `"settings.language.option.fr": "Français"`
4. Recarga — el nuevo idioma está en el dropdown

### Qué se marca en HTML
`data-i18n="key"` intercambia `textContent` durante la pasada de `applyI18n()`. El texto de fallback se queda en el markup, así que el navegador es legible sin JS o antes del fetch del locale:

```html
<span data-i18n="nav.dashboard">Dashboard</span>
```

`data-i18n-title="key"` pone el atributo `title` (para tooltips).

`data-i18n-placeholder="key"` pone el atributo `placeholder` (para inputs).

`data-i18n-aria-label="key"` pone el atributo `aria-label` (para botones solo icono).

`data-i18n-html="key"` pone `innerHTML` en vez de `textContent` — para strings que deberían contener markup inline (p. ej. títulos de página con `<span class="accent">` para el split de acento).

### En código JS
`t(key, params, fallback)` para strings generados dinámicamente:

```js
const label = t('settings.tab.language', {}, 'Language');
container.innerHTML = `<h3>${t('settings.language.heading')}</h3>`;
```

El tercer argumento (`fallback`) es el default en inglés a mostrar si la clave falta en el locale activo.

### Default benigno
Si `en.json` falta por completo o una clave está ausente, el dashboard muestra los defaults en inglés horneados en HTML/JS — sin crash, sin área vacía.

### Validación con i18n_check.py

`scripts/i18n_check.py` es la red de seguridad: escanea `dashboard/**/*.{js,html}` por cada llamada a `t()` y atributo `data-i18n*` y compara las claves contra `config/i18n/en.json`.

```bash
python scripts/i18n_check.py          # informe de texto, exit code 1 en errores duros
python scripts/i18n_check.py --json   # legible por máquina para CI / pre-commit
```

Tres clases de error:

| Clase | Significado | Exit code |
|---|---|---|
| `missing-in-EN` | la clave se llama desde código pero no está en `en.json` | 1 (duro) |
| `missing-in-<locale>` | la clave existe en `en.json` pero falta en otro locale (rotura de paridad) | 1 (duro) |
| `orphan` | la clave en `en.json` no se referencia en ningún sitio del código | 0 (warn) |

---

## Setup Wizard (CLI + Web)

### Propósito

Inicializa una instancia fresca de FinanceOS — escribe `data/.setup_state.json`, `config/branding.json`, `config/auth.json`, además de los archivos de datos. Tras una ejecución exitosa `.setup_state.json.initialized` pasa a `true` y una segunda ejecución aborta con exit code 2 (guard de re-init).

### Arquitectura

- `scripts/setup_core.py` — lógica pura (sin efectos secundarios fuera de los paths suministrados). API pública: `run_setup`, `write_branding`, `write_auth`, `write_setup_state`, `write_empty_seed`, `write_mmex_seed`, `check_not_initialized`. Llamado por el CLI y el wizard web con el mismo dict `config`.
- `scripts/setup.py` — frontend CLI, fino. Recoge config vía flags **o** prompts interactivos.
- `dashboard/setup.html` + `setup.js` + `setup.css` — frontend de navegador, fino. Wizard de seis pasos en vanilla JS.

### Modos

| Modo | Comando | Cuándo |
|---|---|---|
| No interactivo (flags) | `python scripts/setup.py --brand "X" --currency USD --auth-user admin --auth-pass "***" --empty` | scripteado / Docker Compose / CI |
| Interactivo | `python scripts/setup.py --interactive` | setup la primera vez con ojos humanos |
| Con commit inicial | `... --git-commit` | cuando el directorio target es un repo git |

### Fuentes de datos

- **`--empty`** — arranca con 4 cuentas genéricas (`cash`, `checking`, `savings`, `credit`, todas en la moneda por defecto elegida) y ~34 categorías neutrales.
- **`--mmex path/to/db.mmb`** — lee un archivo Money Manager EX vía `scripts/importers/mmex.py` (read-only) y convierte el payload de staging de forma determinista en los archivos de datos.

### Pasos interactivos

Seis pasos, cada uno con un default + validación:

1. **Branding** — display name + color de acento
2. **Default currency** — ISO de 3 letras (USD, EUR, GBP, …)
3. **Auth** — `basic` (usuario + contraseña, hash bcrypt) o `none` (con un confirm WARNING explícito)
4. **Datasource** — `(a)` archivo MMEX o `(b)` inicio vacío
5. **Funciones opcionales** — toggles para las siete funciones conmutables
6. **Resumen + confirmación** — vista general completa, `n` aborta sin escritura (exit 1)

### Wizard web

Contraparte en navegador del wizard CLI. En estado de instalación fresca `dashboard/index.html` redirige automáticamente a `dashboard/setup.html`.

Endpoints API (todos POST):

| Endpoint | Propósito |
|---|---|
| `/api/setup/status` | gate para el frontend — devuelve `{initialized, has_data, default_currency, wizard_version}` |
| `/api/setup/mmex-upload` | acepta un `.mmb` codificado en base64 (máx. 20 MB), parsea, guarda payload de staging, devuelve resumen + preview de cuentas |
| `/api/setup/finalize` | llama a `setup_core.run_setup(config, staging=…)` 1:1 como el CLI |

**Doble guard** en ambas mutaciones: rechazo 409 cuando `data/.setup_state.json.initialized=true` O `data/transactions.csv` tiene filas de datos — protege instancias vivas de un wipe accidental.

### Dependencia

`bcrypt>=4.0` en `requirements.txt` (importado de forma perezosa en `setup_core` — el modo auth `none` no lo necesita).

---

## Autenticación

### Propósito
Middleware opcional de HTTP Basic Auth delante de cada ruta del servidor. Default para la plantilla de inicio vacío: **off** (solo LAN/VPN). Opt-in para hosting público o despliegues compartidos.

### Activar

```bash
python scripts/auth.py --set-password
# Username [admin]: alice
# Password (min 8 chars): ********
# Repeat: ********
# ✓ Basic auth enabled for user 'alice'.

# Reinicia el servidor (lru_cache lee auth.json una sola vez)
python scripts/serve.py
```

El navegador entonces muestra un diálogo de login nativo en la siguiente request (HTTP `401 + WWW-Authenticate: Basic realm="FinanceOS"`).

### Otros modos

```bash
python scripts/auth.py --status     # muestra modo actual + usuario (sin leak del hash)
python scripts/auth.py --disable    # vuelve a mode=none
```

### Esquema (`config/auth.json`)

```json
// Auth off
{ "mode": "none" }

// Basic auth activo
{
  "mode": "basic",
  "user": "alice",
  "password_bcrypt": "$2b$12$..."
}
```

### Paths exentos (siguen alcanzables con auth on)

| Path | Condición |
|---|---|
| `/api/health` | siempre (para cron / monitoring) |
| `/dashboard/setup.{html,js,css}` | solo mientras `data/.setup_state.json` no esté inicializado |
| `/api/setup/{status,mmex-upload,finalize}` | solo mientras `data/.setup_state.json` no esté inicializado |

### Qué no se soporta

- **Botón de logout en el dashboard:** los navegadores cachean credenciales basic-auth por realm hasta el cierre de pestaña. El servidor no puede invalidar eso — un "logout" sería fake.
- **Múltiples usuarios:** `auth.json` tiene exactamente un slot de usuario. Multi-usuario está en la roadmap v2.
- **Cookies de sesión:** solo basic auth sin estado.

### Dependencia

`bcrypt>=4.0` (la misma que el setup wizard). Importado de forma perezosa, no se necesita cuando `mode=none`.

---

## CHANGELOG y versionado

### Formato
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Archivo `CHANGELOG.md` en la raíz del repo.

### Subsecciones
Added · Changed · Deprecated · Removed · Fixed · Security

### Política de versionado

[Semantic Versioning 2.0.0](https://semver.org/):
- **MAJOR** — cambios incompatibles
- **MINOR** — nuevas funciones, compatible hacia atrás
- **PATCH** — bugfixes

### ¿Qué va aquí?
Solo cambios **relevantes para el usuario** (funciones, UX, bugfixes, migraciones de schema). Sin refactors internos, lotes de datos o commits de mantenimiento.
