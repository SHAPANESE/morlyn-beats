"""Real browser smoke test, isolated account and storage; requires Playwright."""
import io
import os
import secrets
from pathlib import Path
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image
from playwright.sync_api import sync_playwright, expect
from waitress import create_server
from werkzeug.security import generate_password_hash
from client_server import create_app


def main():
    with tempfile.TemporaryDirectory() as temporary:
        app = create_app(temporary, secure=False)
        with app.portal_connect() as conn:
            conn.execute("INSERT INTO owner(id,email,password) VALUES(1,?,?)", ("cliente@example.com", generate_password_hash("una frase privada 2026")))
        conn.close()
        server = create_server(app, host="127.0.0.1", port=0, threads=4)
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{server.effective_port}"
        try:
            with sync_playwright() as playwright:
                edge = Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe"
                browser = playwright.chromium.launch(executable_path=str(edge) if edge.exists() else None, headless=True)
                context = browser.new_context(viewport={"width": 1440, "height": 1000})
                # Keep this local test isolated even when production uses Supabase.
                context.route('**/backend-config.js', lambda route: route.fulfill(
                    content_type='application/javascript', body="window.MORLYN_BACKEND={url:'',publishableKey:'',bucket:'portfolio'}"))
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(origin + "/cliente")
                page.get_by_role("heading", name="Ingresá a tu cuenta").wait_for()
                page.locator('#login-form input[name="email"]').fill("cliente@example.com")
                page.locator('#login-password').fill("una frase privada 2026")
                page.get_by_role("button", name="Mostrar", exact=True).click()
                assert page.locator('#login-password').get_attribute('type') == 'text'
                page.get_by_role("button", name="Ocultar", exact=True).click()
                page.get_by_role("button", name="Ingresar →", exact=True).click()
                page.get_by_role("heading", name="Imágenes y videos.").wait_for()
                open_gallery = context.new_page()
                open_gallery.goto(origin + '/motion-graphics.html')
                expect(open_gallery.locator('.portfolio-placeholder')).to_have_count(8)
                image = io.BytesIO()
                Image.frombytes("RGB", (800, 600), secrets.token_bytes(800 * 600 * 3)).save(image, "PNG")
                assert image.tell() > 1024 * 1024
                import imageio_ffmpeg
                video = Path(temporary) / "video.mov"
                subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x120:d=1", "-c:v", "libx264", "-y", str(video)], check=True, timeout=20)
                page.locator('#upload-section').select_option('04')
                page.locator('#upload-description').fill('Texto del trabajo\nCon una segunda línea y <etiquetas>.')
                page.locator('#files').set_input_files([
                    {"name": "Mi imagen.png", "mimeType": "image/png", "buffer": image.getvalue()},
                    {"name": "Mi video.mov", "mimeType": "video/quicktime", "buffer": video.read_bytes()},
                ])
                page.get_by_role('button', name='Subir y publicar ↑').click()
                expect(page.locator('#upload-message')).to_contain_text('2 de 2', timeout=60000)
                page.locator('.card').first.wait_for()
                assert page.locator('.card').count() == 2
                assert page.locator('.card video').count() == 1
                assert page.locator('.card img').count() == 1
                immediately_public = context.request.get(origin + '/api/public/media').json()['media']
                assert len(immediately_public) == 2
                assert all(work['section'] == '04' for work in immediately_public)
                expect(open_gallery.locator('.portfolio-placeholder')).to_have_count(0)
                expect(open_gallery.locator('.portfolio-card')).to_have_count(2)
                video_card = page.locator('.card').filter(has=page.locator('video'))
                video_card.get_by_role('button', name='Editar / publicar').click()
                page.locator('#edit-form input[name="published"]').uncheck()
                page.get_by_role('button', name='Guardar cambios', exact=True).click()
                page.locator('#edit-dialog').wait_for(state='hidden')
                expect(page.locator('.file-description').first).to_contain_text('Con una segunda línea y <etiquetas>.')
                dimensions = page.locator('.card video').evaluate('async video => { video.muted = true; await video.play(); video.pause(); return [video.videoWidth, video.videoHeight]; }')
                assert dimensions == [160, 120], dimensions
                image_card = page.locator('.card').filter(has=page.locator('img'))
                image_card.get_by_role('button', name='Editar / publicar').click()
                page.locator('#edit-form input[name="title"]').fill('Imagen publicada')
                page.locator('#edit-form textarea[name="description"]').fill('Descripción publicada de la imagen.')
                page.locator('#edit-form input[name="published"]').check()
                page.get_by_role('button', name='Guardar cambios', exact=True).click()
                page.locator('#edit-dialog').wait_for(state='hidden')
                page.get_by_role('heading', name='Imagen publicada').wait_for()
                published = context.request.get(origin + '/api/public/media').json()['media']
                assert len(published) == 1 and published[0]['title'] == 'Imagen publicada'
                assert published[0]['description'] == 'Descripción publicada de la imagen.'
                expect(open_gallery.locator('.portfolio-card')).to_have_count(1)
                open_gallery.close()
                gallery_page = context.new_page()
                gallery_page.goto(origin + '/motion-graphics.html')
                work = gallery_page.get_by_role('button', name='Ver imagen: Imagen publicada', exact=True)
                work.wait_for()
                work.focus()
                work.press('Enter')
                expect(gallery_page.locator('.work-player-description')).to_have_text('Descripción publicada de la imagen.')
                expect(gallery_page.locator('.work-player img')).to_have_attribute('src', origin + published[0]['url'])
                expect(gallery_page.locator('.portfolio-placeholder')).to_have_count(0)
                gallery_page.screenshot(path=str(Path(__file__).parent / 'gallery-integration.png'), full_page=True)
                gallery_page.close()
                visitor = browser.new_context(viewport={"width": 390, "height": 844})
                mobile = visitor.new_page()
                mobile.goto(origin + '/cliente')
                mobile.get_by_role('heading', name='Ingresá a tu cuenta').wait_for()
                assert mobile.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                assert visitor.request.get(origin + '/media/' + published[0]['id']).status == 401
                assert visitor.request.get(origin + published[0]['url']).status == 200
                mobile.locator('#login-form input[name="email"]').fill('cliente@example.com')
                mobile.locator('#login-password').fill('una frase privada 2026')
                mobile.get_by_role('button', name='Ingresar →', exact=True).click()
                mobile.get_by_role('heading', name='Imágenes y videos.').wait_for()
                assert mobile.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                page.get_by_role('button', name='Cuenta y dispositivos').click()
                page.locator('#sessions li').nth(1).wait_for()
                page.get_by_role('button', name='Cerrar las otras sesiones').click()
                expect(page.locator('#security-message')).to_contain_text('se cerraron')
                mobile.get_by_role('button', name='Actualizar', exact=True).click()
                mobile.get_by_role('heading', name='Ingresá a tu cuenta').wait_for()
                page.locator('[data-close="security-dialog"]').click()
                image_card = page.locator('.card').filter(has=page.locator('img'))
                image_card.get_by_role('button', name='Eliminar', exact=True).click()
                page.get_by_role('button', name='Eliminar archivo', exact=True).click()
                page.locator('#delete-dialog').wait_for(state='hidden')
                expect(page.locator('.card')).to_have_count(1)
                assert context.request.get(origin + '/api/public/media').json()['media'] == []
                page.screenshot(path=str(Path(__file__).parent / 'portal-desktop.png'), full_page=True)
                page.get_by_role('button', name='Cerrar sesión', exact=True).click()
                page.get_by_role('heading', name='Ingresá a tu cuenta').wait_for()
                assert not errors, errors
                visitor.close()
                context.close()
                browser.close()
                print('Browser OK: login, image + video upload, text, publication, public gallery, mobile layout, device revocation, deletion and logout.')
        finally:
            server.close()
            server.task_dispatcher.shutdown()
            import gc
            gc.collect()


if __name__ == '__main__':
    main()
