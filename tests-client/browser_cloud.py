"""Real browser and vendored SDK; remote HTTP responses are simulated, not live Supabase."""
import base64
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image
from playwright.sync_api import sync_playwright, expect
from waitress import create_server
from client_server import create_app

ROOT = Path(__file__).resolve().parents[1]
OWNER = '11111111-1111-4111-8111-111111111111'

def main():
    with tempfile.TemporaryDirectory() as temporary:
        app = create_app(temporary, secure=False)
        server = create_server(app, host='127.0.0.1', port=0, threads=4)
        threading.Thread(target=server.run, daemon=True).start()
        origin = f'http://127.0.0.1:{server.effective_port}'
        rows, errors, upload_requests = [], [], []
        image = io.BytesIO(); Image.new('RGB', (320, 240), 'orange').save(image, 'PNG')
        allowed = [True]
        def fulfill(route, data, status=200, headers=None):
            route.fulfill(status=status, body=json.dumps(data), headers={
                'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS,HEAD',
                **(headers or {}),
            })
        def remote(route):
            request = route.request
            parsed = urlparse(request.url); p = parsed.path; q = parse_qs(parsed.query)
            method = request.method
            if method == 'OPTIONS': return fulfill(route, {})
            data = request.post_data_json if 'json' in request.headers.get('content-type', '') and request.post_data_buffer else None
            if p == '/auth/v1/token':
                encode = lambda obj: base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
                token = encode({'alg':'HS256','typ':'JWT'}) + '.' + encode({'sub':OWNER,'role':'authenticated','exp':int(time.time())+3600}) + '.test'
                return fulfill(route, {'access_token':token,'token_type':'bearer','expires_in':3600,'refresh_token':'test-refresh','user':{'id':OWNER,'email':'cliente@example.com','aud':'authenticated','role':'authenticated'}})
            if p == '/auth/v1/logout': return fulfill(route, {})
            if p == '/rest/v1/rpc/is_portfolio_admin': return fulfill(route, allowed[0])
            if p == '/rest/v1/portfolio_works':
                if method == 'POST': rows.insert(0, data); return fulfill(route, None, 201)
                selected = [row for row in rows if all(row.get(key) == value[0][3:] for key,value in q.items() if key in ['id','channel'])]
                if q.get('published') == ['eq.true']: selected = [row for row in selected if row['published']]
                if method == 'PATCH':
                    for row in selected: row.update(data)
                if method == 'DELETE':
                    for row in selected: rows.remove(row)
                return fulfill(route, selected)
            if p == '/storage/v1/object/sign/portfolio':
                return fulfill(route, [{'path':value, 'signedURL':'/object/sign/portfolio/'+value+'?token=test'} for value in data['paths']])
            if p.startswith('/storage/v1/object/sign/portfolio/'):
                return route.fulfill(status=200, content_type='image/png', body=image.getvalue(), headers={'Access-Control-Allow-Origin':'*'})
            if p == '/storage/v1/upload/resumable':
                upload_requests.append(request.url)
                return fulfill(route, {}, 201, {'Location':request.url+'/test', 'Upload-Offset':str(len(request.post_data_buffer or b'')), 'Tus-Resumable':'1.0.0','Access-Control-Expose-Headers':'Location,Upload-Offset,Tus-Resumable'})
            if p.startswith('/storage/v1/object/portfolio') and method == 'DELETE': return fulfill(route, [])
            raise AssertionError(f'Unexpected request: {method} {p}')
        try:
            with sync_playwright() as playwright:
                edge = Path(os.environ.get('PROGRAMFILES(X86)', 'C:/Program Files (x86)'))/'Microsoft/Edge/Application/msedge.exe'
                browser = playwright.chromium.launch(executable_path=str(edge), headless=True)
                context = browser.new_context(viewport={'width':1440,'height':1000})
                context.route('**/admin.html', lambda route: route.fulfill(content_type='text/html', body=(ROOT/'admin.html').read_bytes()))
                context.route('**/backend-config.js', lambda route: route.fulfill(content_type='application/javascript', body="window.MORLYN_BACKEND={url:'https://morlyn-test.supabase.co',publishableKey:'sb_publishable_test',bucket:'portfolio',maxFileBytes:52428800,passwordRecoveryEnabled:false}"))
                context.route('https://*.supabase.co/**', remote)
                context.route('https://www.youtube-nocookie.com/**', lambda route: route.fulfill(content_type='text/html', body='<html><body>Embedded video fixture</body></html>'))
                page = context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin+'/admin.html')
                page.locator('#login-form [name=email]').fill('cliente@example.com')
                page.locator('#login-form [name=password]').fill('a private password 2026')
                page.locator('#login-form [type=submit]').click()
                expect(page.locator('#upload-panel')).to_be_visible()
                gallery = context.new_page(); gallery.on('pageerror', lambda error: errors.append(str(error)))
                gallery.goto(origin+'/motion-graphics.html')
                expect(gallery.locator('.portfolio-placeholder')).to_have_count(8)
                page.locator('#upload-form [name=channel]').select_option('04')
                page.locator('#upload-form [name=title]').fill('Video YouTube')
                page.locator('#upload-form [name=description]').fill('Texto del video <sin HTML>')
                page.locator('#work-type').select_option('youtube')
                page.locator('#youtube-url').fill('https://youtu.be/dQw4w9WgXcQ')
                page.locator('#upload-form [type=submit]').click()
                expect(page.locator('#admin-status')).to_contain_text('Trabajo publicado')
                expect(gallery.locator('.portfolio-card')).to_have_count(1)
                expect(gallery.locator('.portfolio-placeholder')).to_have_count(0)
                assert not upload_requests
                gallery.locator('.work-open').click(force=True)
                expect(gallery.locator('.work-player iframe')).to_have_attribute('src','https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&rel=0')
                expect(gallery.locator('.work-player-description')).to_have_text('Texto del video <sin HTML>')
                box = gallery.locator('.work-player iframe').bounding_box(); assert box['height'] >= 200 and box['width'] >= 200
                gallery.keyboard.press('Escape')
                page.locator('#published-works').get_by_role('button',name='Editar').click()
                page.locator('#edit-work-form [name=published]').uncheck()
                page.locator('#edit-work-form [name=description]').fill('Borrador privado')
                page.locator('#edit-work-form [type=submit]').click()
                expect(gallery.locator('.portfolio-placeholder')).to_have_count(8)
                expect(page.locator('#published-works')).to_contain_text('BORRADOR')
                page.locator('#upload-form [name=channel]').select_option('04')
                page.locator('#upload-form [name=title]').fill('Imagen publicada')
                page.locator('#upload-form [name=description]').fill('Texto de la imagen')
                page.locator('#work-file').set_input_files({'name':'image.png','mimeType':'image/png','buffer':image.getvalue()})
                page.locator('#upload-form [type=submit]').click()
                expect(page.locator('#admin-status')).to_contain_text('Trabajo publicado', timeout=20000)
                expect(page.locator('#published-works article')).to_have_count(2)
                expect(gallery.locator('.portfolio-card')).to_have_count(1)
                assert len(upload_requests) == 1
                gallery.locator('.work-open').click(force=True)
                expect(gallery.locator('.work-player img')).to_have_js_property('complete',True)
                expect(gallery.locator('.work-player-description')).to_have_text('Texto de la imagen')
                gallery.keyboard.press('Escape')
                page.on('dialog', lambda dialog: dialog.accept())
                page.locator('#published-works article').filter(has_text='Imagen publicada').get_by_role('button',name='Eliminar').click()
                expect(page.locator('#published-works article')).to_have_count(1)
                expect(gallery.locator('.portfolio-placeholder')).to_have_count(8)
                page.locator('#logout').click(); expect(page.locator('#login-panel')).to_be_visible()
                allowed[0] = False
                page.locator('#login-form [name=email]').fill('otro@example.com')
                page.locator('#login-form [name=password]').fill('another private password')
                page.locator('#login-form [type=submit]').click()
                expect(page.locator('#admin-status')).to_contain_text('no está autorizada')
                expect(page.locator('#upload-panel')).to_be_hidden()
                assert not errors, errors
                browser.close()
                print('Cloud browser OK: real SDK login, YouTube, TUS image, signed URLs, descriptions, drafts, placeholders, deletion, logout and unauthorized account.')
        finally: server.close()

if __name__ == '__main__': main()
