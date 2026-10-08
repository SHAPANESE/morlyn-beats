"""Single-owner media portal. Run --help for account setup and serving."""
from __future__ import annotations

import argparse
import getpass
import hashlib
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
import uuid
import warnings

from flask import Flask, abort, g, jsonify, request, send_file
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

ROOT = Path(__file__).resolve().parent
SECTIONS = {
    "01": "Ediciones de video",
    "02": "Video redes",
    "03": "Animación 3D",
    "04": "Motion graphics",
}
COOKIE = "morlyn_access"
MAX_IMAGE_UPLOAD = 200 * 1024 * 1024
MAX_VIDEO_UPLOAD = 1024 * 1024 * 1024
MAX_UPLOAD = max(MAX_IMAGE_UPLOAD, MAX_VIDEO_UPLOAD)
QUOTA = int(os.environ.get("MORLYN_STORAGE_GB", "20")) * 1024 * 1024 * 1024
MAX_VIDEO_SECONDS = int(os.environ.get("MORLYN_VIDEO_MINUTES", "30")) * 60
PROCESSING_TIMEOUT = 1200
Image.MAX_IMAGE_PIXELS = 24_000_000
warnings.filterwarnings("error", category=Image.DecompressionBombWarning)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def device_label(agent):
    browser = next((name for marker, name in [("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari")] if marker in agent), "Navegador")
    system = next((name for marker, name in [("Android", "Android"), ("iPhone", "iOS"), ("iPad", "iPadOS"), ("Windows", "Windows"), ("Macintosh", "macOS"), ("Linux", "Linux")] if marker in agent), "Dispositivo")
    return f"{browser} · {system}"


def create_app(data_dir=None, secure=None):
    app = Flask(__name__, static_folder=None)
    # Outside the site root, so a parallel static preview cannot expose the DB.
    data = Path(data_dir or os.environ.get("MORLYN_DATA_DIR", ROOT.parent / f".{ROOT.name}-client-data"))
    data.mkdir(parents=True, exist_ok=True)
    media = data / "media"
    media.mkdir(exist_ok=True)
    database = data / "portal.sqlite3"
    app.config.update(
        MAX_CONTENT_LENGTH=MAX_UPLOAD + 1024 * 1024,
        # Werkzeug's multipart decoder buffers file chunks too (64 KiB).
        # A 16 KiB cap rejects ordinary file uploads before parsing the file.
        MAX_FORM_MEMORY_SIZE=512 * 1024,
        MAX_FORM_PARTS=8,
        TRUSTED_HOSTS=os.environ.get("MORLYN_HOSTS", "localhost,127.0.0.1").split(","),
        SECURE_COOKIE=secure if secure is not None else os.environ.get("MORLYN_HTTPS") == "1",
    )
    processing = threading.BoundedSemaphore(2)

    def connect():
        conn = sqlite3.connect(database, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    with connect() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS owner (
          id INTEGER PRIMARY KEY CHECK(id=1), email TEXT NOT NULL,
          password TEXT NOT NULL, recovery TEXT, recovery_expires REAL);
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY, csrf TEXT NOT NULL, authenticated INTEGER NOT NULL,
          created REAL NOT NULL, seen REAL NOT NULL, expires REAL NOT NULL,
          device TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts (bucket TEXT NOT NULL, at REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS attempts_bucket ON attempts(bucket, at);
        CREATE TABLE IF NOT EXISTS media (
          id TEXT PRIMARY KEY, file TEXT NOT NULL, title TEXT NOT NULL,
          section TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL,
          created REAL NOT NULL, published INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS garbage (file TEXT PRIMARY KEY, size INTEGER NOT NULL);
        """)
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(media)")}
        if "description" not in columns:
            conn.execute("ALTER TABLE media ADD COLUMN description TEXT NOT NULL DEFAULT ''")

    def db():
        if "db" not in g:
            g.db = connect()
        return g.db

    @app.teardown_appcontext
    def close_db(_):
        if "db" in g:
            g.db.close()

    def fail(message, status=400):
        response = jsonify(error=message)
        response.status_code = status
        return response

    def limited(bucket, count, seconds):
        now = time.time()
        conn = db()
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM attempts WHERE at < ?", (now - 3600,))
        total = conn.execute("SELECT COUNT(*) FROM attempts WHERE bucket=? AND at>?",
                             (bucket, now - seconds)).fetchone()[0]
        if total >= count:
            conn.commit()
            return True
        conn.execute("INSERT INTO attempts VALUES (?,?)", (bucket, now))
        conn.commit()
        return False

    def new_session(authenticated=False, remember=False):
        raw, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        now = time.time()
        ttl = (30 * 86400 if remember else 12 * 3600) if authenticated else 900
        db().execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?)", (
            digest(raw), csrf, int(authenticated), now, now, now + ttl,
            device_label(request.user_agent.string)))
        db().commit()
        g.cookie = (raw, ttl if remember else None)
        g.session = db().execute("SELECT * FROM sessions WHERE token=?", (digest(raw),)).fetchone()
        return g.session

    @app.before_request
    def protect():
        g.session = None
        if not request.path.startswith("/api/"):
            return
        if request.method not in {"GET", "HEAD", "OPTIONS"} and request.path != "/api/media":
            request.max_content_length = 16 * 1024
        now = time.time()
        token = digest(request.cookies.get(COOKIE, ""))
        conn = db()
        # Windows may hold a playing video's file open. Retire it immediately,
        # then remove its bytes on the next request after the stream closes.
        for pending in conn.execute("SELECT * FROM garbage").fetchall():
            try:
                (media / pending["file"]).unlink(missing_ok=True)
            except OSError:
                continue
            conn.execute("DELETE FROM garbage WHERE file=?", (pending["file"],))
        conn.execute("DELETE FROM sessions WHERE expires<=? OR seen<=?", (now, now - 7 * 86400))
        g.session = conn.execute("SELECT * FROM sessions WHERE token=?", (token,)).fetchone()
        if g.session:
            # A regular session has a 2-hour idle limit; remembered devices have 7 days.
            idle = 7 * 86400 if g.session["expires"] - g.session["created"] > 86400 else 7200
            if now - g.session["seen"] > idle:
                conn.execute("DELETE FROM sessions WHERE token=?", (token,))
                g.session = None
            else:
                conn.execute("UPDATE sessions SET seen=? WHERE token=?", (now, token))
        conn.commit()
        public = {"/api/bootstrap", "/api/login", "/api/recover", "/api/public/media"}
        if request.path not in public and not (g.session and g.session["authenticated"]):
            return fail("Tu sesión terminó. Ingresá de nuevo para continuar.", 401)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            if request.headers.get("Sec-Fetch-Site") == "cross-site":
                return fail("Solicitud no permitida.", 403)
            expected = g.session["csrf"] if g.session else ""
            supplied = request.headers.get("X-CSRF-Token", "")
            if not expected or not secrets.compare_digest(expected, supplied):
                return fail("Recargá la página para renovar el acceso.", 403)

    @app.after_request
    def headers(response):
        response.headers.update({
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "same-origin",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; img-src 'self' blob: https:; media-src 'self' blob: https:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https:; frame-src https://www.youtube-nocookie.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        })
        if request.path.startswith(("/api/", "/media/", "/cliente", "/admin.html")):
            response.headers["Cache-Control"] = "no-store"
        if request.path.startswith(("/api/public/", "/public/media/")):
            origins = os.environ.get("MORLYN_PUBLIC_ORIGINS", "http://localhost:4173,http://127.0.0.1:4173").split(",")
            origin = request.headers.get("Origin")
            if origin in origins:
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Vary"] = "Origin"
                response.headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS"
                response.headers["Access-Control-Allow-Headers"] = "Range"
        if app.config["SECURE_COOKIE"]:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        if hasattr(g, "cookie"):
            raw, age = g.cookie
            response.set_cookie(COOKIE, raw, max_age=age, httponly=True,
                                secure=app.config["SECURE_COOKIE"], samesite="Strict", path="/")
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        if request.path.startswith("/api/"):
            messages = {413: "La carga supera el máximo de 1 GB o contiene campos demasiado grandes." if request.path == "/api/media" else "La solicitud es demasiado grande.",
                        404: "No se encontró el archivo.", 400: "Solicitud inválida."}
            return fail(messages.get(error.code, "No se pudo completar la solicitud."), error.code)
        return error

    @app.errorhandler(Exception)
    def unexpected(error):
        app.logger.exception("Portal request failed")
        if request.path.startswith("/api/"):
            return fail("No se pudo completar la operación. Intentá de nuevo.", 500)
        return "No se pudo completar la operación.", 500

    @app.get("/cliente")
    @app.get("/cliente/")
    @app.get("/admin.html")
    def portal():
        if request.path == "/admin.html":
            config = (ROOT / "backend-config.js").read_text(encoding="utf-8")
            url = re.search(r"\burl\s*:\s*['\"]([^'\"]+)['\"]", config)
            key = re.search(r"\bpublishableKey\s*:\s*['\"]([^'\"]+)['\"]", config)
            if url and key:
                return send_file(ROOT / "admin.html")
        return send_file(ROOT / "client-portal" / "index.html")

    @app.get("/client-portal/<name>")
    def portal_asset(name):
        if name not in {"portal.css", "portal.js", "portal-tokens.css"}:
            abort(404)
        return send_file(ROOT / "client-portal" / name)

    @app.get("/api/bootstrap")
    def bootstrap():
        if not g.session:
            if limited("bootstrap:" + (request.remote_addr or "unknown"), 120, 900):
                return fail("Demasiados intentos. Esperá unos minutos.", 429)
            new_session()
        owner = db().execute("SELECT email FROM owner WHERE id=1").fetchone()
        return jsonify(authenticated=bool(g.session["authenticated"]), csrf=g.session["csrf"],
                       configured=bool(owner), email=owner["email"] if owner and g.session["authenticated"] else None,
                       sections=SECTIONS, limits={"imageBytes": MAX_IMAGE_UPLOAD,
                       "videoBytes": MAX_VIDEO_UPLOAD, "videoSeconds": MAX_VIDEO_SECONDS, "quota": QUOTA})

    def payload():
        value = request.get_json(silent=True)
        return value if isinstance(value, dict) else {}

    def text_field(value):
        return value if isinstance(value, str) else ""

    @app.post("/api/login")
    def login():
        if limited("login:" + (request.remote_addr or "unknown"), 10, 900):
            response = fail("Demasiados intentos. Volvé a probar en 15 minutos.", 429)
            response.headers["Retry-After"] = "900"
            return response
        values = payload()
        email = text_field(values.get("email")).strip().lower()
        password = text_field(values.get("password"))
        if len(password) > 256:
            return fail("Email o contraseña incorrectos.", 401)
        owner = db().execute("SELECT * FROM owner WHERE id=1").fetchone()
        valid_password = check_password_hash(owner["password"] if owner else dummy_hash, password)
        if not owner or not valid_password or email != owner["email"]:
            return fail("Email o contraseña incorrectos.", 401)
        db().execute("DELETE FROM sessions WHERE token=?", (g.session["token"],))
        new_session(True, values.get("remember") is True)
        return jsonify(csrf=g.session["csrf"], email=owner["email"])

    @app.post("/api/logout")
    def logout():
        db().execute("DELETE FROM sessions WHERE token=?", (g.session["token"],))
        db().commit()
        g.cookie = ("", 0)
        return jsonify(ok=True)

    @app.get("/api/sessions")
    def sessions():
        rows = db().execute("SELECT * FROM sessions WHERE authenticated=1 ORDER BY seen DESC").fetchall()
        return jsonify(sessions=[dict(id=row["token"], device=row["device"],
                                      created=row["created"], seen=row["seen"],
                                      current=row["token"] == g.session["token"]) for row in rows])

    @app.delete("/api/sessions/<token>")
    def revoke(token):
        if token == "others":
            db().execute("DELETE FROM sessions WHERE token<>? AND authenticated=1", (g.session["token"],))
        else:
            db().execute("DELETE FROM sessions WHERE token=? AND authenticated=1", (token,))
            if token == g.session["token"]:
                g.cookie = ("", 0)
        db().commit()
        return jsonify(ok=True)

    def password_ok(password):
        return isinstance(password, str) and 12 <= len(password) <= 256

    @app.post("/api/password")
    def password():
        if limited("password:" + (request.remote_addr or "unknown"), 10, 900):
            return fail("Esperá 15 minutos antes de volver a intentar.", 429)
        values = payload()
        owner = db().execute("SELECT * FROM owner WHERE id=1").fetchone()
        current = text_field(values.get("current"))
        if len(current) > 256 or not check_password_hash(owner["password"], current):
            return fail("La contraseña actual es incorrecta.", 400)
        if not password_ok(values.get("password")):
            return fail("Usá una contraseña de entre 12 y 256 caracteres.")
        hashed = generate_password_hash(values["password"], method="scrypt")
        db().execute("UPDATE owner SET password=?, recovery=NULL, recovery_expires=NULL WHERE id=1", (hashed,))
        db().execute("DELETE FROM sessions")
        new_session(True)
        return jsonify(ok=True, csrf=g.session["csrf"])

    @app.post("/api/recover")
    def recover():
        if limited("recover:" + (request.remote_addr or "unknown"), 5, 900):
            return fail("Esperá 15 minutos antes de volver a intentar.", 429)
        values = payload()
        code = text_field(values.get("code"))
        if not password_ok(values.get("password")):
            return fail("Usá una contraseña de entre 12 y 256 caracteres.")
        hashed = generate_password_hash(values["password"], method="scrypt")
        conn = db()
        conn.execute("BEGIN IMMEDIATE")
        owner = conn.execute("SELECT * FROM owner WHERE id=1").fetchone()
        if not owner or not owner["recovery"] or not owner["recovery_expires"] or owner["recovery_expires"] < time.time() or not secrets.compare_digest(owner["recovery"], digest(code)):
            conn.rollback()
            return fail("El código no es válido o venció.", 400)
        conn.execute("UPDATE owner SET password=?, recovery=NULL, recovery_expires=NULL WHERE id=1", (hashed,))
        conn.execute("DELETE FROM sessions")
        new_session(True)
        return jsonify(ok=True, csrf=g.session["csrf"], email=owner["email"])

    def media_value(row, public=False):
        result = dict(row)
        del result["file"]
        result["published"] = bool(result["published"])
        result["url"] = ("/public/media/" if public else "/media/") + row["id"]
        return result

    @app.get("/api/media")
    def list_media():
        rows = db().execute("SELECT * FROM media ORDER BY created DESC").fetchall()
        return jsonify(media=[media_value(row) for row in rows],
                       used=sum(row["size"] for row in rows) + db().execute("SELECT COALESCE(SUM(size),0) FROM garbage").fetchone()[0], quota=QUOTA)

    @app.get("/api/public/media")
    def public_list():
        rows = db().execute("SELECT * FROM media WHERE published=1 ORDER BY created DESC").fetchall()
        return jsonify(media=[media_value(row, True) for row in rows], sections=SECTIONS)

    @app.get("/media/<media_id>")
    @app.get("/public/media/<media_id>")
    def download(media_id):
        row = db().execute("SELECT * FROM media WHERE id=?", (media_id,)).fetchone()
        if not row:
            abort(404)
        if request.path.startswith("/public/"):
            if not row["published"]:
                abort(404)
        else:
            session = db().execute("SELECT * FROM sessions WHERE token=?", (digest(request.cookies.get(COOKIE, "")),)).fetchone()
            now = time.time()
            idle = 7 * 86400 if session and session["expires"] - session["created"] > 86400 else 7200
            if not session or not session["authenticated"] or session["expires"] <= now or now - session["seen"] > idle:
                abort(401)
        response = send_file(media / row["file"], conditional=True,
                             mimetype="video/mp4" if row["kind"] == "video" else "image/webp")
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.post("/api/media")
    def upload():
        if limited("upload", 60, 3600):
            return fail("Llegaste al límite de cargas por hora. Probá más tarde.", 429)
        if not processing.acquire(blocking=False):
            return fail("Hay archivos procesándose. Esperá y volvé a intentar.", 429)
        output = None
        try:
            section = request.form.get("section", "")
            title = request.form.get("title", "").strip()
            description = request.form.get("description", "").strip()
            publication = request.form.get("published", "false")
            file = request.files.get("file")
            if section not in SECTIONS or not file or not title or len(title) > 120:
                return fail("Elegí una sección, un archivo y un título de hasta 120 caracteres.")
            if len(description) > 5000:
                return fail("El texto puede tener hasta 5000 caracteres.")
            if publication not in {"true", "false"}:
                return fail("Elegí si querés publicar el archivo o guardarlo como borrador.")
            ext = Path(file.filename or "").suffix.lower()
            kind = "image" if ext in {".jpg", ".jpeg", ".png", ".webp"} else "video" if ext in {".mp4", ".mov", ".webm"} else None
            if not kind:
                return fail("Usá JPG, PNG, WebP, MP4, MOV o WebM.")
            media_id = uuid.uuid4().hex
            output = media / (media_id + (".webp" if kind == "image" else ".mp4"))
            with tempfile.TemporaryDirectory(dir=data) as temporary:
                source = Path(temporary) / ("source" + ext)
                file.save(source)
                limit = MAX_IMAGE_UPLOAD if kind == "image" else MAX_VIDEO_UPLOAD
                if not source.stat().st_size:
                    return fail("El archivo está vacío.")
                if source.stat().st_size > limit:
                    return fail("La imagen supera los 200 MB." if kind == "image" else "El video supera 1 GB.", 413)
                if kind == "image":
                    with Image.open(source, formats=["JPEG", "PNG", "WEBP"]) as image:
                        image.verify()
                    with Image.open(source, formats=["JPEG", "PNG", "WEBP"]) as image:
                        if getattr(image, "is_animated", False):
                            return fail("Para animaciones, subí un video MP4, MOV o WebM.")
                        image = ImageOps.exif_transpose(image)
                        image.thumbnail((4096, 4096))
                        image = image.convert("RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB")
                        image.save(output, "WEBP", quality=90, exif=b"", icc_profile=None)
                else:
                    import imageio_ffmpeg
                    executable = shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe()
                    container = "mov" if ext in {".mp4", ".mov"} else "matroska,webm"
                    safe_input = ["-nostdin", "-protocol_whitelist", "file,pipe", "-f", container, "-i", str(source)]
                    probe = subprocess.run([executable, "-hide_banner", *safe_input], capture_output=True, timeout=20)
                    info = probe.stderr.decode("utf-8", errors="replace")
                    duration = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", info)
                    if not duration or sum(float(value) * factor for value, factor in zip(duration.groups(), [3600, 60, 1])) > MAX_VIDEO_SECONDS or "Video:" not in info:
                        return fail(f"Subí un video válido de hasta {MAX_VIDEO_SECONDS // 60} minutos.")
                    command = [executable, "-hide_banner", "-loglevel", "error", *safe_input,
                               "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-map_metadata", "-1",
                               "-vf", "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
                               "-r", "30", "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "23",
                               "-maxrate", "6M", "-bufsize", "12M", "-pix_fmt", "yuv420p",
                               "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-t", str(MAX_VIDEO_SECONDS), "-y", str(output)]
                    result = subprocess.run(command, capture_output=True, timeout=PROCESSING_TIMEOUT)
                    if result.returncode or not output.exists() or not output.stat().st_size:
                        return fail("No se pudo leer el video. Probá exportarlo como MP4.")
            size = output.stat().st_size
            conn = db()
            conn.execute("BEGIN IMMEDIATE")
            used = conn.execute("SELECT COALESCE(SUM(size),0) FROM media").fetchone()[0] + conn.execute("SELECT COALESCE(SUM(size),0) FROM garbage").fetchone()[0]
            if used + size > QUOTA:
                conn.rollback()
                return fail("No queda espacio. Eliminá archivos antes de volver a subir.", 409)
            conn.execute("INSERT INTO media(id,file,title,section,kind,size,created,published,description) VALUES (?,?,?,?,?,?,?,?,?)", (media_id, output.name, title, section, kind, size, time.time(), int(publication == "true"), description))
            conn.commit()
            output = None
            return jsonify(media=media_value(conn.execute("SELECT * FROM media WHERE id=?", (media_id,)).fetchone())), 201
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombWarning, Image.DecompressionBombError):
            return fail("La imagen no es válida o supera los 24 megapíxeles.")
        except subprocess.TimeoutExpired:
            return fail("El video tarda demasiado en procesarse. Subí una versión más corta o liviana.", 422)
        finally:
            if output and output.exists():
                output.unlink()
            processing.release()

    @app.patch("/api/media/<media_id>")
    def edit_media(media_id):
        values = payload()
        title = text_field(values.get("title")).strip()
        section = text_field(values.get("section"))
        description = text_field(values.get("description", "")).strip()
        if not title or len(title) > 120 or section not in SECTIONS or not isinstance(values.get("published"), bool):
            return fail("Revisá el título, la sección y el estado de publicación.")
        if len(description) > 5000:
            return fail("El texto puede tener hasta 5000 caracteres.")
        cursor = db().execute("UPDATE media SET title=?,section=?,published=?,description=? WHERE id=?", (title, section, int(values["published"]), description, media_id))
        db().commit()
        if not cursor.rowcount:
            abort(404)
        return jsonify(ok=True)

    @app.delete("/api/media/<media_id>")
    def delete_media(media_id):
        conn = db()
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM media WHERE id=?", (media_id,)).fetchone()
        if not row:
            conn.rollback()
            abort(404)
        conn.execute("DELETE FROM media WHERE id=?", (media_id,))
        conn.execute("INSERT INTO garbage VALUES (?,?)", (row["file"], row["size"]))
        conn.commit()
        try:
            (media / row["file"]).unlink(missing_ok=True)
        except OSError:
            pass
        else:
            conn.execute("DELETE FROM garbage WHERE file=?", (row["file"],))
            conn.commit()
        return jsonify(ok=True)

    @app.get("/")
    def home():
        return send_file(ROOT / "index.html")

    @app.get("/<path:filename>")
    def existing_asset(filename):
        # Explicit whitelist prevents serving credentials, source, uploads and backups.
        allowed = {"index.html", "video-tv.html", "video-redes.html", "animacion-3d.html", "motion-graphics.html",
                   "styles.css", "display.css", "admin.css", "admin.js", "admin-cloud.js", "script.js", "portfolio.js", "crt-pipeline.js",
                   "three-scene.js", "vhs-clock.js", "backend-config.js", "backend.js", "works.json"}
        is_asset = filename.startswith("assets/") and Path(filename).suffix.lower() in {".ttf", ".woff2", ".svg", ".png", ".jpg", ".webp", ".mp4", ".wav", ".m4a"}
        is_vendor = filename.startswith("vendor/") and Path(filename).suffix.lower() == ".js"
        if filename not in allowed and not is_asset and not is_vendor:
            abort(404)
        target = (ROOT / filename).resolve()
        boundary = ROOT / "assets" if is_asset else ROOT / "vendor" if is_vendor else ROOT
        if not target.is_relative_to(boundary) or not target.is_file():
            abort(404)
        return send_file(target)

    dummy_hash = generate_password_hash(secrets.token_urlsafe(32), method="scrypt")
    app.portal_connect = connect
    return app


def main():
    parser = argparse.ArgumentParser(description="Portal Ramiro Lynn: una cuenta, imágenes y videos.")
    parser.add_argument("command", choices=["init", "recovery", "serve"])
    parser.add_argument("--port", type=int, default=4174)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    app = create_app()
    if args.command == "init":
        with app.portal_connect() as conn:
            if conn.execute("SELECT 1 FROM owner").fetchone():
                raise SystemExit("La cuenta ya existe. Usá recovery para recuperar el acceso.")
            email = input("Email del cliente: ").strip().lower()
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254:
                raise SystemExit("Email inválido.")
            password = getpass.getpass("Contraseña (12 a 256 caracteres): ")
            if not 12 <= len(password) <= 256 or password != getpass.getpass("Repetí la contraseña: "):
                raise SystemExit("Las contraseñas no coinciden o no cumplen la longitud.")
            conn.execute("INSERT INTO owner(id,email,password) VALUES(1,?,?)", (email, generate_password_hash(password, method="scrypt")))
        print("Cuenta creada. Ejecutá serve y abrí http://localhost:4174/admin.html")
    elif args.command == "recovery":
        with app.portal_connect() as conn:
            if not conn.execute("SELECT 1 FROM owner").fetchone():
                raise SystemExit("Primero creá la cuenta con init.")
            code = secrets.token_urlsafe(32)
            conn.execute("UPDATE owner SET recovery=?,recovery_expires=? WHERE id=1", (digest(code), time.time() + 1800))
        print("Código de un solo uso; vence en 30 minutos. Entregalo al cliente por un canal privado:\n" + code)
    else:
        if args.host not in {"127.0.0.1", "localhost", "::1"} and not app.config["SECURE_COOKIE"]:
            raise SystemExit("Para acceso externo configurá HTTPS, MORLYN_HTTPS=1 y MORLYN_HOSTS.")
        from waitress import serve
        print(f"Portal: http://{args.host}:{args.port}/admin.html", flush=True)
        serve(app, host=args.host, port=args.port, threads=4, max_request_body_size=MAX_UPLOAD + 1024 * 1024,
              channel_timeout=PROCESSING_TIMEOUT + 60, connection_limit=100)


if __name__ == "__main__":
    main()
