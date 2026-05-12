"""Receipt-Attachments service (v1.6.0) — images + PDFs on transactions.

Storage layout (all paths relative to repo root):

    data/receipts/YYYY/MM/<hex>.<ext>     — originals (JPEG / PDF)
    data/receipts/thumbs/<hex>.jpg        — 256 px JPEG previews (images only)

Every accepted image is *re-encoded* as JPEG quality 92. Re-encoding strips
EXIF, GPS, camera model and any other metadata at the encoder boundary —
even uploads from a client that tried to keep metadata get sanitized server
side. PDFs are stored as-is (no metadata strip yet; future work).

URLs stored in ``transactions.csv:receipt_url`` start with ``/data/receipts/…``
so the frontend can use them verbatim in ``<img src>`` and ``<embed src>`` —
Caddy serves the path directly (see deploy/Caddyfile), Python's
SimpleHTTPRequestHandler serves it in dev mode.

The module is intentionally framework-free so a future bulk-export job
(rc.3) or PWA sync (rc.2) can reuse the same store/delete helpers.
"""
from __future__ import annotations

import io
import os
import re
import secrets
from datetime import date
from pathlib import Path

from PIL import Image, ImageOps

# Register the HEIC decoder so iPhone uploads (image/heic, image/heif) open
# transparently through PIL.Image.open(). Import-time side effect, idempotent.
try:
    import pillow_heif

    pillow_heif.register_heif_opener()
except ImportError:  # pragma: no cover — Pi must `pip install -r requirements.txt`
    pillow_heif = None

import tx_engine

# ── Configuration ───────────────────────────────────────────────────────────

RECEIPTS_DIR = tx_engine.DATA_DIR / "receipts"
THUMBS_DIR = RECEIPTS_DIR / "thumbs"

# URL prefix the frontend uses. Stored verbatim in transactions.csv.
URL_PREFIX = "/data/receipts/"

MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB per file
MAX_FILES_PER_REQUEST = 5
THUMB_SIZE = (256, 256)
JPEG_QUALITY = 92
THUMB_QUALITY = 82

# MIME whitelist. Anything not in here is rejected upfront, regardless of
# what the client claimed via Content-Type. We sniff the actual format from
# the bytes (see _sniff_kind) so a renamed .exe can't slip through as a JPG.
ALLOWED_IMAGE_MIMES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}
ALLOWED_PDF_MIMES = {"application/pdf"}
ALLOWED_MIMES = ALLOWED_IMAGE_MIMES | ALLOWED_PDF_MIMES

# Magic-byte prefixes for the MIME sniff. Just enough to disambiguate the
# whitelist — not a full file-type detector.
_MAGIC = [
    (b"\xff\xd8\xff", "image"),                         # JPEG
    (b"\x89PNG\r\n\x1a\n", "image"),                    # PNG
    (b"RIFF", "image_webp_maybe"),                       # WEBP (need to check at offset 8)
    (b"%PDF-", "pdf"),                                   # PDF
    (b"\x00\x00\x00", "heic_maybe"),                     # HEIC (ftyp box starts after 4-byte size)
]


# ── Public API ──────────────────────────────────────────────────────────────


def store_upload(
    *,
    filename: str,
    content_type: str,
    data: bytes,
    today: date | None = None,
) -> dict:
    """Persist one uploaded file. Returns a dict the API surfaces verbatim.

    Args:
        filename: Original filename from the client (used only for the
            extension hint — the stored filename is a fresh hex id, so this
            cannot influence the on-disk path).
        content_type: Client-declared MIME type. Cross-checked against the
            actual byte signature; the byte-sniff wins on disagreement.
        data: Raw upload bytes.
        today: Optional date override for the YYYY/MM folder split. Defaults
            to ``date.today()``; the override is only useful in tests.

    Returns:
        ``{"url", "thumb_url", "mime", "kind", "size"}``

    Raises:
        ValueError: invalid MIME, oversize file, decode failure, or path-
            traversal attempt via the filename.
    """
    if not data:
        raise ValueError("empty upload")
    if len(data) > MAX_FILE_BYTES:
        raise ValueError(f"file exceeds {MAX_FILE_BYTES} bytes")

    # Sniff the actual type from the bytes so a renamed file can't bypass
    # the MIME whitelist by claiming a fake Content-Type header.
    sniffed = _sniff_kind(data)
    if sniffed is None:
        raise ValueError("unsupported file format (sniff failed)")

    declared = (content_type or "").lower().strip()
    if sniffed == "pdf":
        kind = "pdf"
        mime_out = "application/pdf"
    elif sniffed == "image":
        kind = "image"
        mime_out = "image/jpeg"
    else:
        raise ValueError("unsupported file format")

    # If the client declared a MIME, it must be in the whitelist. Mismatches
    # between declared and sniffed are tolerated (we use sniff) but a totally
    # off-whitelist declaration still gets rejected so the API is consistent.
    if declared and declared not in ALLOWED_MIMES:
        raise ValueError(f"MIME '{declared}' not in whitelist")

    today = today or date.today()
    year_dir = RECEIPTS_DIR / f"{today.year:04d}" / f"{today.month:02d}"
    year_dir.mkdir(parents=True, exist_ok=True)
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)

    file_id = secrets.token_hex(8)  # 16 hex chars, ~64-bit unguessable

    if kind == "pdf":
        out_path = year_dir / f"{file_id}.pdf"
        tx_engine._atomic_write_bytes(out_path, data)
        out_size = out_path.stat().st_size
        return {
            "url": _path_to_url(out_path),
            "thumb_url": "",  # PDFs have no thumbnail in rc.1 — frontend renders an icon placeholder
            "mime": mime_out,
            "kind": kind,
            "size": out_size,
        }

    # Image branch: open with PIL, normalise orientation via EXIF, re-encode
    # as JPEG (strips metadata at the encoder), generate a 256 px thumbnail.
    try:
        img = Image.open(io.BytesIO(data))
        img.load()  # force decode now so corrupt files fail before we touch disk
    except Exception as exc:
        raise ValueError(f"image decode failed: {exc}") from exc

    img = ImageOps.exif_transpose(img)  # apply the orientation flag, then drop it
    img = _to_rgb(img)

    # Save original as JPEG
    main_path = year_dir / f"{file_id}.jpg"
    main_buf = io.BytesIO()
    img.save(main_buf, "JPEG", quality=JPEG_QUALITY, optimize=True)
    tx_engine._atomic_write_bytes(main_path, main_buf.getvalue())

    # Save thumbnail
    thumb = img.copy()
    thumb.thumbnail(THUMB_SIZE, Image.LANCZOS)
    thumb_path = THUMBS_DIR / f"{file_id}.jpg"
    thumb_buf = io.BytesIO()
    thumb.save(thumb_buf, "JPEG", quality=THUMB_QUALITY, optimize=True)
    tx_engine._atomic_write_bytes(thumb_path, thumb_buf.getvalue())

    return {
        "url": _path_to_url(main_path),
        "thumb_url": _path_to_url(thumb_path),
        "mime": mime_out,
        "kind": kind,
        "size": main_path.stat().st_size,
    }


# Default "should have a receipt" thresholds per currency. Anything at or
# above this in absolute value is flagged on the missing-receipts list.
# Tuned for a typical multi-currency setup (TZS-heavy with a few minor
# currencies) but kept as an explicit dict so callers can override per
# request from the UI.
DEFAULT_RECEIPT_THRESHOLDS = {
    "TZS": 50_000.0,
    "EUR": 20.0,
    "USD": 20.0,
    "PLN": 100.0,
    "GBP": 20.0,
    "CHF": 20.0,
}


def compute_stats(tx_rows: list[dict]) -> dict:
    """Coverage + storage KPIs for the Settings → Receipts tab.

    Transfers are excluded from the TX-coverage numerator/denominator —
    they almost never have receipts and would skew the % low for no
    actionable reason.
    """
    total_tx = 0
    with_rcpt = 0
    without_rcpt = 0
    for tx in tx_rows or []:
        if (tx.get("type") or "").lower() == "transfer":
            continue
        total_tx += 1
        if (tx.get("receipt_url") or "").strip():
            with_rcpt += 1
        else:
            without_rcpt += 1

    # Walk receipts/ on disk for storage figures. Both originals and
    # thumbnails count toward total_storage_bytes — they're all on the
    # same SD card. Per-extension breakdown excludes thumbnails so the
    # user sees "23 photos + 5 PDFs", not "28 photos + 5 PDFs".
    total_storage_bytes = 0
    file_count = 0
    by_extension: dict[str, int] = {}
    if RECEIPTS_DIR.exists():
        for root, _, files in os.walk(RECEIPTS_DIR):
            in_thumbs = "thumbs" in Path(root).parts
            for fname in files:
                try:
                    fpath = Path(root) / fname
                    total_storage_bytes += fpath.stat().st_size
                    file_count += 1
                    if not in_thumbs:
                        ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
                        by_extension[ext] = by_extension.get(ext, 0) + 1
                except OSError:
                    continue

    coverage_pct = (with_rcpt / total_tx * 100.0) if total_tx else 0.0
    return {
        "total_tx": total_tx,
        "with_receipt": with_rcpt,
        "without_receipt": without_rcpt,
        "coverage_pct": round(coverage_pct, 1),
        "storage_bytes": total_storage_bytes,
        "storage_mb": round(total_storage_bytes / (1024 * 1024), 2),
        "file_count": file_count,
        "by_extension": by_extension,
    }


def missing_receipts(
    tx_rows: list[dict],
    thresholds: dict | None = None,
    limit: int = 50,
) -> list[dict]:
    """TXs above the per-currency threshold that have no attachment yet.

    Sorted newest-first so the UI shows what the user most recently
    forgot to attach. Limit defaults to 50 — beyond that the table
    starts to feel like a homework list rather than a hint.
    """
    thresholds = thresholds or DEFAULT_RECEIPT_THRESHOLDS
    out: list[dict] = []
    for tx in tx_rows or []:
        if (tx.get("type") or "").lower() == "transfer":
            continue
        if (tx.get("receipt_url") or "").strip():
            continue
        try:
            amount = abs(float(tx.get("amount") or 0))
        except (TypeError, ValueError):
            continue
        ccy = (tx.get("currency") or "TZS").upper()
        threshold = thresholds.get(ccy, 0)
        if threshold <= 0 or amount < threshold:
            continue
        out.append({
            "import_id": tx.get("import_id", ""),
            "date": tx.get("date", ""),
            "account": tx.get("account", ""),
            "type": tx.get("type", ""),
            "payee": tx.get("payee", ""),
            "category": tx.get("category", ""),
            "amount": tx.get("amount", ""),
            "currency": ccy,
        })
    out.sort(key=lambda r: r.get("date", ""), reverse=True)
    return out[:limit]


def build_export_zip(
    tx_rows: list[dict],
    *,
    date_from: str,
    date_to: str,
    account: str = "",
    tag: str = "",
    only_with_receipts: bool = True,
) -> tuple[Path, dict]:
    """Build a ZIP at a temp path with selected receipts + an index.csv.

    ZIP layout::

        receipts_<dr>.zip/
          index.csv                              # TX metadata, one row per TX
          files/<date>_<short_id>_<seq>.<ext>    # original photo/PDF

    Filenames are prefixed with the TX date so an "open in file manager"
    workflow stays chronological, and with a short import_id slug so
    multiple TXs on the same date stay clearly grouped.

    Args:
        tx_rows: full TX list from transactions.csv (DictReader output).
        date_from / date_to: ISO dates, inclusive on both ends.
        account: optional account-alias filter. Empty = all.
        tag: optional single-tag filter (matches any of the TX's tags).
        only_with_receipts: when True, TXs without receipt_url are dropped
            entirely. When False, they still appear in index.csv with an
            empty files list — useful for "what am I missing" exports.

    Returns:
        Tuple ``(zip_path, stats)`` — the caller is responsible for
        deleting ``zip_path`` after streaming it back to the client.
        ``stats`` is ``{"tx_count", "file_count", "size_bytes"}``.
    """
    import csv as _csv
    import tempfile
    import zipfile

    matched: list[tuple[dict, list[str]]] = []
    for tx in tx_rows or []:
        d = (tx.get("date") or "").strip()
        if not d or d < date_from or d > date_to:
            continue
        if account and tx.get("account") != account:
            continue
        if tag:
            tags = [t.strip() for t in (tx.get("tags") or "").split(";") if t.strip()]
            if tag not in tags:
                continue
        urls = [u.strip() for u in (tx.get("receipt_url") or "").split(";") if u.strip()]
        if only_with_receipts and not urls:
            continue
        matched.append((tx, urls))

    # NamedTemporaryFile with delete=False so the file outlives this
    # function — the HTTP handler streams it then unlinks.
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp.close()
    zip_path = Path(tmp.name)
    file_count = 0

    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            idx_buf = io.StringIO()
            idx_writer = _csv.writer(idx_buf)
            idx_writer.writerow([
                "date", "import_id", "account", "type", "payee", "category",
                "amount", "currency", "tags", "files",
            ])
            for tx, urls in matched:
                files_in_zip: list[str] = []
                short_id = (tx.get("import_id") or "")[:8] or "noid"
                tx_date = tx.get("date", "")
                for seq, url in enumerate(urls, start=1):
                    src_path = _safe_url_to_path(url)
                    if not src_path or not src_path.exists():
                        # Stale URL — skip the file but keep the TX row so
                        # the user sees something is off in the index.
                        continue
                    ext = src_path.suffix.lower() or ".bin"
                    in_zip = f"files/{tx_date}_{short_id}_{seq}{ext}"
                    zf.write(src_path, in_zip)
                    files_in_zip.append(in_zip)
                    file_count += 1
                idx_writer.writerow([
                    tx_date,
                    tx.get("import_id", ""),
                    tx.get("account", ""),
                    tx.get("type", ""),
                    tx.get("payee", ""),
                    tx.get("category", ""),
                    tx.get("amount", ""),
                    tx.get("currency", ""),
                    tx.get("tags", ""),
                    ";".join(files_in_zip),
                ])
            zf.writestr("index.csv", idx_buf.getvalue())
    except Exception:
        # On any build error, drop the half-written ZIP so the tempdir
        # doesn't fill up and the caller doesn't accidentally stream junk.
        try:
            zip_path.unlink()
        except OSError:
            pass
        raise

    return zip_path, {
        "tx_count": len(matched),
        "file_count": file_count,
        "size_bytes": zip_path.stat().st_size,
    }


def delete_files(urls: list[str]) -> int:
    """Delete originals + matching thumbnails. Returns count actually removed.

    Idempotent — missing files are not an error so callers can retry without
    bookkeeping. Refuses any URL that escapes ``data/receipts/`` (path-
    traversal guard), even when the caller is authenticated.
    """
    removed = 0
    for raw in urls or []:
        path = _safe_url_to_path(raw)
        if path is None:
            continue
        try:
            path.unlink()
            removed += 1
        except FileNotFoundError:
            pass
        # Delete the matching thumbnail too. PDFs have no thumb, so this is a
        # best-effort no-op for them.
        thumb_path = THUMBS_DIR / (path.stem + ".jpg")
        try:
            thumb_path.unlink()
        except FileNotFoundError:
            pass
    return removed


# ── Multipart parser ────────────────────────────────────────────────────────


_BOUNDARY_RE = re.compile(r'boundary=(?:"([^"]+)"|([^;]+))', re.IGNORECASE)


def parse_multipart(content_type: str, body: bytes) -> list[dict]:
    """Parse an HTTP multipart/form-data body into a list of file parts.

    Returns: ``[{"filename": str, "content_type": str, "data": bytes}, ...]``
    Non-file parts (plain form fields without a filename) are skipped.

    A minimal hand-rolled parser is used instead of cgi.FieldStorage (which
    is deprecated and slated for removal in newer Pythons) and instead of an
    extra dependency. Mirrors the spec just enough to handle browser POSTs.
    """
    match = _BOUNDARY_RE.search(content_type or "")
    if not match:
        raise ValueError("missing boundary in Content-Type")
    boundary = (match.group(1) or match.group(2) or "").strip()
    if not boundary:
        raise ValueError("empty boundary")

    delim = ("--" + boundary).encode("latin-1")
    parts: list[dict] = []

    # Split on boundary; the trailing "--" boundary closes the body.
    raw_parts = body.split(delim)
    for raw in raw_parts:
        chunk = raw.strip(b"\r\n")
        if not chunk or chunk == b"--":
            continue
        # Headers / body separated by a blank line. RFC 7578 mandates CRLF
        # but some clients send LF only — accept both.
        sep_crlf = chunk.find(b"\r\n\r\n")
        sep_lf = chunk.find(b"\n\n")
        if sep_crlf >= 0 and (sep_lf < 0 or sep_crlf < sep_lf):
            head_end, head_skip = sep_crlf, 4
        elif sep_lf >= 0:
            head_end, head_skip = sep_lf, 2
        else:
            continue
        headers_text = chunk[:head_end].decode("latin-1", errors="replace")
        file_body = chunk[head_end + head_skip:]
        # Trim trailing newline before the next boundary
        if file_body.endswith(b"\r\n"):
            file_body = file_body[:-2]
        elif file_body.endswith(b"\n"):
            file_body = file_body[:-1]

        filename_match = re.search(
            r'Content-Disposition:[^\r\n]*?filename="([^"]*)"',
            headers_text,
            re.IGNORECASE,
        )
        if not filename_match:
            continue  # plain form field, ignore
        filename = filename_match.group(1)

        ctype_match = re.search(
            r'Content-Type:\s*([^\r\n;]+)',
            headers_text,
            re.IGNORECASE,
        )
        ctype = (ctype_match.group(1) if ctype_match else "application/octet-stream").strip().lower()

        parts.append({
            "filename": filename,
            "content_type": ctype,
            "data": file_body,
        })

    return parts


# ── Internal helpers ────────────────────────────────────────────────────────


def _path_to_url(path: Path) -> str:
    """Convert an absolute filesystem path under data/receipts into the URL
    the dashboard will request. Slashes are normalised so Windows backslashes
    don't bleed into the JSON response."""
    try:
        rel = path.relative_to(tx_engine.DATA_DIR / "receipts")
    except ValueError:
        # Should never happen — paths are always built from RECEIPTS_DIR
        return ""
    return URL_PREFIX + str(rel).replace("\\", "/")


def _safe_url_to_path(url: str) -> Path | None:
    """Inverse of :func:`_path_to_url` with strong path-traversal guards.

    Returns None if the URL does not point inside data/receipts/, contains
    '..' segments, or otherwise looks suspicious. Callers should treat the
    None case as "skip this entry" and never error out — a malicious POST
    body must not be able to cause a 500.
    """
    if not url or not isinstance(url, str):
        return None
    if not url.startswith(URL_PREFIX):
        return None
    rel = url[len(URL_PREFIX):]
    if ".." in rel.split("/") or rel.startswith("/") or "\\" in rel:
        return None
    candidate = (RECEIPTS_DIR / rel).resolve()
    try:
        candidate.relative_to(RECEIPTS_DIR.resolve())
    except ValueError:
        return None
    return candidate


def _sniff_kind(data: bytes) -> str | None:
    """Return 'image', 'pdf', or None based on the leading bytes."""
    if len(data) < 12:
        return None
    head = data[:16]
    if head.startswith(b"\xff\xd8\xff"):
        return "image"  # JPEG
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image"  # PNG
    if head.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image"  # WEBP
    if head.startswith(b"%PDF-"):
        return "pdf"
    # HEIC/HEIF: ISO BMFF — bytes 4..8 are 'ftyp', bytes 8..12 are a brand
    # like 'heic', 'heix', 'mif1' (HEIF), or 'msf1' (HEIF sequence).
    if data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"hevc", b"mif1", b"msf1", b"heim", b"heis"):
        return "image"
    return None


def _to_rgb(img: Image.Image) -> Image.Image:
    """Flatten transparency onto white before JPEG encoding, otherwise PIL
    would raise on RGBA/LA/P-mode images."""
    if img.mode == "RGB":
        return img
    if img.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        alpha = img.split()[-1]
        bg.paste(img.convert("RGBA"), mask=alpha)
        return bg
    if img.mode == "P":
        return img.convert("RGB")
    return img.convert("RGB")
