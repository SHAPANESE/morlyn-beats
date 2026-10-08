import io
import secrets
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

from PIL import Image
from werkzeug.security import generate_password_hash

from client_server import create_app, digest, QUOTA


class PortalTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = "una frase privada 2026"
        cls.hashed = generate_password_hash(cls.password, method="scrypt")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.app = create_app(self.temporary.name, secure=False)
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()
        with self.app.portal_connect() as conn:
            conn.execute("INSERT INTO owner(id,email,password) VALUES(1,?,?)", ("cliente@example.com", self.hashed))
        self.csrf = self.client.get("/api/bootstrap").json["csrf"]

    def tearDown(self):
        self.client = None
        self.app = None
        import gc
        gc.collect()
        self.temporary.cleanup()

    def login(self, client=None, remember=False):
        client = client or self.client
        csrf = client.get("/api/bootstrap").json["csrf"]
        response = client.post("/api/login", json={"email": "CLIENTE@example.com", "password": self.password, "remember": remember}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(response.status_code, 200, response.json)
        if client is self.client:
            self.csrf = response.json["csrf"]
        return response.json["csrf"]

    def mutate(self, path, method="post", **kwargs):
        return getattr(self.client, method)(path, headers={"X-CSRF-Token": self.csrf}, **kwargs)

    def image(self):
        output = io.BytesIO()
        Image.new("RGB", (80, 60), "red").save(output, "PNG")
        output.seek(0)
        return output

    def upload_image(self):
        response = self.mutate("/api/media", data={"title": "Mi trabajo", "section": "01", "file": (self.image(), "foto.png")})
        self.assertEqual(response.status_code, 201, response.json)
        return response.json["media"]

    def test_login_csrf_cookie_and_logout(self):
        self.assertEqual(self.client.get("/api/media").status_code, 401)
        self.assertEqual(self.client.post("/api/login", json={}).status_code, 403)
        previous = self.client.get_cookie("morlyn_access").value
        self.login()
        cookie = self.client.get_cookie("morlyn_access")
        self.assertNotEqual(previous, cookie.value)
        self.assertTrue(cookie.http_only)
        self.assertEqual(cookie.same_site, "Strict")
        self.assertEqual(self.client.get("/api/media").status_code, 200)
        self.assertEqual(self.mutate("/api/logout").status_code, 200)
        self.assertEqual(self.client.get("/api/media").status_code, 401)

    def test_wrong_credentials_rate_limited(self):
        for _ in range(10):
            response = self.mutate("/api/login", json={"email": "cliente@example.com", "password": "incorrecta"})
            self.assertEqual(response.status_code, 401)
        self.assertEqual(self.mutate("/api/login", json={}).status_code, 429)

    def test_multiple_devices_and_revoke(self):
        self.login()
        other = self.app.test_client()
        other_csrf = self.login(other, remember=True)
        sessions = self.client.get("/api/sessions").json["sessions"]
        self.assertEqual(len(sessions), 2)
        self.assertEqual(sum(row["current"] for row in sessions), 1)
        self.assertEqual(self.mutate("/api/sessions/others", method="delete").status_code, 200)
        self.assertEqual(other.get("/api/media").status_code, 401)
        self.assertEqual(self.client.get("/api/media").status_code, 200)

    def test_idle_and_absolute_expiration(self):
        self.login()
        with self.app.portal_connect() as conn:
            conn.execute("UPDATE sessions SET seen=? WHERE authenticated=1", (time.time() - 7201,))
        self.assertEqual(self.client.get("/api/media").status_code, 401)
        self.login(remember=True)
        with self.app.portal_connect() as conn:
            conn.execute("UPDATE sessions SET expires=? WHERE authenticated=1", (time.time() - 1,))
        self.assertEqual(self.client.get("/api/media").status_code, 401)

    def test_image_private_publish_edit_delete(self):
        self.login()
        item = self.upload_image()
        self.assertFalse(item["published"])
        visitor = self.app.test_client()
        self.assertEqual(visitor.get(item["url"]).status_code, 401)
        self.assertEqual(visitor.get("/api/public/media").json["media"], [])
        self.assertEqual(visitor.get("/public/media/" + item["id"]).status_code, 404)
        image_response = self.client.get(item["url"])
        self.assertEqual(image_response.mimetype, "image/webp")
        self.assertEqual(Image.open(io.BytesIO(image_response.data)).size, (80, 60))
        image_response.close()
        self.assertEqual(self.mutate("/api/media/" + item["id"], method="patch", json={"title": "Descripción", "section": "04", "published": True}).status_code, 200)
        public = visitor.get("/api/public/media").json["media"][0]
        self.assertEqual(public["section"], "04")
        with visitor.get(public["url"]) as public_response:
            self.assertEqual(public_response.status_code, 200)
        self.assertEqual(self.mutate("/api/media/" + item["id"], method="patch", json={"title": "Descripción", "section": "04", "published": False}).status_code, 200)
        self.assertEqual(visitor.get(public["url"]).status_code, 404)
        self.assertEqual(self.mutate("/api/media/" + item["id"], method="delete").status_code, 200)
        self.assertEqual(self.client.get(item["url"]).status_code, 404)
        self.assertEqual(self.client.get("/api/media").json["used"], 0)

    def test_invalid_uploads_and_metadata(self):
        self.login()
        for filename, data in [("fake.png", b"not an image"), ("script.svg", b"<svg/>"), ("fake.mp4", b"not a video")]:
            result = self.mutate("/api/media", data={"title": "Mal archivo", "section": "01", "file": (io.BytesIO(data), filename)})
            self.assertEqual(result.status_code, 400, result.json)
        result = self.mutate("/api/media", data={"title": "Foto", "section": "../", "file": (self.image(), "foto.png")})
        self.assertEqual(result.status_code, 400)
        self.assertEqual(self.client.get("/api/media").json["media"], [])
        self.assertEqual(list((Path(self.temporary.name) / "media").iterdir()), [])

    def test_large_multipart_image_upload(self):
        self.login()
        output = io.BytesIO()
        Image.frombytes("RGB", (800, 600), secrets.token_bytes(800 * 600 * 3)).save(output, "PNG")
        self.assertGreater(output.tell(), 1024 * 1024)
        output.seek(0)
        response = self.mutate("/api/media", data={"title": "Imagen de más de 1 MB", "section": "01", "file": (output, "large.png")})
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(len(self.client.get("/api/media").json["media"]), 1)
        response.request.environ["wsgi.input"].close()
        response.close()

    def test_upload_limits_are_consistent(self):
        bootstrap = self.client.get("/api/bootstrap").json
        self.assertEqual(set(bootstrap["sections"]), {'01', '02', '03', '04'})
        limits = bootstrap["limits"]
        self.assertEqual(limits["imageBytes"], 200 * 1024 * 1024)
        self.assertEqual(limits["videoBytes"], 1024 * 1024 * 1024)
        self.assertEqual(limits["quota"], QUOTA)
        self.assertGreater(self.app.config["MAX_FORM_MEMORY_SIZE"], 64 * 1024)

    def test_quota_rejection_cleans_file(self):
        self.login()
        with self.app.portal_connect() as conn:
            conn.execute("INSERT INTO media(id,file,title,section,kind,size,created,published) VALUES('existing','existing.webp','Existing','01','image',?,0,0)", (QUOTA,))
        result = self.mutate("/api/media", data={"title": "Foto", "section": "01", "file": (self.image(), "foto.png")})
        self.assertEqual(result.status_code, 409)
        self.assertEqual(list((Path(self.temporary.name) / "media").iterdir()), [])

    def test_locked_file_is_retired_then_cleaned(self):
        self.login()
        item = self.upload_image()
        path = next((Path(self.temporary.name) / "media").iterdir())
        with patch.object(Path, "unlink", side_effect=PermissionError("File is playing")):
            self.assertEqual(self.mutate("/api/media/" + item["id"], method="delete").status_code, 200)
            self.assertTrue(path.exists())
            self.assertEqual(self.client.get(item["url"]).status_code, 404)
        self.assertEqual(self.client.get("/api/media").json["used"], 0)
        self.assertFalse(path.exists())

    def test_description_upload_edit_and_publication(self):
        self.login()
        description = "Primera línea.\nSegunda línea con <texto> y acentos."
        response = self.mutate("/api/media", data={"title": "Trabajo", "description": description, "section": "01", "file": (self.image(), "foto.png")})
        self.assertEqual(response.status_code, 201)
        item = response.json["media"]
        self.assertEqual(item["description"], description)
        self.assertEqual(self.client.get("/api/public/media").json["media"], [])
        response = self.mutate("/api/media/" + item["id"], method="patch", json={"title": "Trabajo", "description": "Texto actualizado", "section": "01", "published": True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/public/media").json["media"][0]["description"], "Texto actualizado")
        response = self.mutate("/api/media/" + item["id"], method="patch", json={"title": "Trabajo", "description": "x" * 5001, "section": "01", "published": True})
        self.assertEqual(response.status_code, 400)

    def test_upload_and_publish_in_selected_channel(self):
        self.login()
        response = self.mutate('/api/media', data={'title': 'Trabajo publicado al subir', 'section': '03', 'description': 'Texto del trabajo.', 'published': 'true', 'file': (self.image(), 'trabajo.png')})
        self.assertEqual(response.status_code, 201, response.json)
        self.assertTrue(response.json['media']['published'])
        public = self.app.test_client().get('/api/public/media').json['media']
        self.assertEqual(len(public), 1)
        self.assertEqual(public[0]['section'], '03')
        self.assertEqual(public[0]['description'], 'Texto del trabajo.')

    def test_video_conversion_and_range(self):
        import imageio_ffmpeg
        self.login()
        path = Path(self.temporary.name) / "test.mov"
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x480:rate=30:duration=2", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-y", str(path)], check=True, timeout=20)
        self.assertGreater(path.stat().st_size, 64 * 1024)
        with path.open("rb") as source:
            result = self.mutate("/api/media", data={"title": "Video real", "section": "02", "file": (source, "video.mov")})
        self.assertEqual(result.status_code, 201, result.json)
        item = result.json["media"]
        result.request.environ["wsgi.input"].close()
        self.assertEqual(item["kind"], "video")
        response = self.client.get(item["url"], headers={"Range": "bytes=0-127"})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.mimetype, "video/mp4")
        self.assertEqual(len(response.data), 128)
        response.close()

    def test_password_change_revokes_other_device(self):
        self.login()
        other = self.app.test_client()
        self.login(other)
        result = self.mutate("/api/password", json={"current": self.password, "password": "otra frase segura 2026"})
        self.assertEqual(result.status_code, 200)
        self.csrf = result.json["csrf"]
        self.assertEqual(other.get("/api/media").status_code, 401)
        self.assertEqual(self.client.get("/api/media").status_code, 200)
        self.assertEqual(len(self.client.get("/api/sessions").json["sessions"]), 1)

    def test_recovery_is_single_use_and_revokes_sessions(self):
        self.login()
        visitor = self.app.test_client()
        csrf = visitor.get("/api/bootstrap").json["csrf"]
        with self.app.portal_connect() as conn:
            conn.execute("UPDATE owner SET recovery=?,recovery_expires=?", (digest("private-code"), time.time() + 60))
        result = visitor.post("/api/recover", json={"code": "private-code", "password": "recuperada segura 2026"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.client.get("/api/media").status_code, 401)
        replay = visitor.post("/api/recover", json={"code": "private-code", "password": "recuperada segura 2026"}, headers={"X-CSRF-Token": result.json["csrf"]})
        self.assertEqual(replay.status_code, 400)

    def test_security_headers_and_private_files(self):
        response = self.client.get("/cliente")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
        response.close()
        for path in ["/.client-data/portal.sqlite3", "/client_server.py", "/assets/../client_server.py", "/assets/../client-portal/portal.js", "/assets/../.client-data/media/secret.webp"]:
            self.assertEqual(self.client.get(path).status_code, 404, path)
        self.login()
        self.assertEqual(self.client.post("/api/logout", headers={"X-CSRF-Token": self.csrf, "Sec-Fetch-Site": "cross-site"}).status_code, 403)
        self.assertEqual(self.client.get("/api/bootstrap", headers={"Host": "evil.example"}).status_code, 400)

    def test_project_routes_and_public_preview_cors(self):
        for path in ['/', '/admin.html', '/video-tv.html', '/video-redes.html', '/animacion-3d.html', '/motion-graphics.html', '/backend.js', '/works.json', '/vendor/three.module.min.js', '/client-portal/portal-tokens.css']:
            with self.client.get(path) as response:
                self.assertEqual(response.status_code, 200, path)
        response = self.client.get('/api/public/media', headers={'Origin': 'http://localhost:4173'})
        self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'http://localhost:4173')
        response = self.client.get('/api/bootstrap', headers={'Origin': 'http://localhost:4173'})
        self.assertNotIn('Access-Control-Allow-Origin', response.headers)
        self.assertEqual(self.client.get('/vendor/../client_server.py').status_code, 404)


if __name__ == "__main__":
    unittest.main()
