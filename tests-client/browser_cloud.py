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
        home_text = ['']
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
            if p == '/rest/v1/portfolio_site_content':
                if method == 'POST':
                    if not allowed[0]: return fulfill(route, {'message':'Permission denied'}, 403)
                    home_text[0] = data['body']
                    return fulfill(route, {'body':home_text[0]}, 201)
                return fulfill(route, [{'body':home_text[0]}])
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
                context.route('https://i.ytimg.com/vi/**', lambda route: route.fulfill(content_type='image/png', body=image.getvalue(), headers={'Access-Control-Allow-Origin':'*'}))
                context.route('https://www.youtube.com/iframe_api', lambda route: route.fulfill(content_type='application/javascript', body='''window.YT={Player:class {
                  constructor(frame,options){this.frame=frame;this.events=options.events;this.state=2;this.current=0;this.muted=false;window.testYTPlayer=this;setTimeout(()=>this.events.onReady({target:this}),0)}
                  getPlayerState(){return this.state} getDuration(){return 120} getCurrentTime(){return this.current} isMuted(){return this.muted}
                  playVideo(){this.state=1;this.events.onStateChange({data:1})} pauseVideo(){this.state=2;this.events.onStateChange({data:2})}
                  mute(){this.muted=true} unMute(){this.muted=false} seekTo(value){this.current=value}
                  destroy(){this.frame.remove();this.destroyed=true}
                }};window.onYouTubeIframeAPIReady();'''))
                context.route('https://www.youtube-nocookie.com/**', lambda route: route.fulfill(content_type='text/html', body='''<html><body style="margin:0;background:#18334d"><svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#f5c865" stroke-width="2"/></pattern></defs><rect width="100%" height="100%" fill="url(#grid)"/></svg><button style="position:absolute;left:45%;bottom:30px" onclick="this.textContent='PLAYING'">PLAY</button></body></html>'''))
                page = context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin+'/admin.html')
                expect(page.locator('#dashboard-nav')).to_be_hidden()
                page.screenshot(path=str(ROOT/'tests-client/admin-login.png'))
                page.locator('#login-form [name=email]').fill('cliente@example.com')
                page.locator('#login-form [name=password]').fill('a private password 2026')
                page.get_by_role('button',name='Mostrar',exact=True).click()
                expect(page.locator('#login-password')).to_have_attribute('type','text')
                page.get_by_role('button',name='Ocultar',exact=True).click()
                expect(page.locator('#login-password')).to_have_attribute('type','password')
                page.locator('#login-form [type=submit]').click()
                expect(page.locator('#upload-panel')).to_be_visible()
                expect(page.locator('#home-text-form [type=submit]')).to_be_enabled()
                expect(page.locator('#dashboard-nav')).to_be_visible()
                page.screenshot(path=str(ROOT/'tests-client/admin-dashboard-desktop.png'))
                page.set_viewport_size({'width':390,'height':844})
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.screenshot(path=str(ROOT/'tests-client/admin-dashboard-mobile.png'))
                page.locator('.dashboard-sidebar a[href="#home-text-panel"]').click()
                expect(page.locator('#home-text')).to_be_in_viewport()
                page.set_viewport_size({'width':1440,'height':1000})
                home = context.new_page(); home.on('pageerror', lambda error: errors.append(str(error)))
                home.goto(origin+'/index.html')
                expect(home.locator('.hero-description')).to_be_empty()
                introduction = 'Editor de video y animador.\nIdeas que se convierten en imagen. <sin HTML>'
                page.locator('#home-text').fill(introduction)
                expect(page.locator('#home-text-counter')).to_have_text(str(len(introduction))+' / 600')
                page.locator('#home-text-form [type=submit]').click()
                expect(page.locator('#home-text-status')).to_have_text('Texto de portada guardado.')
                expect(home.locator('.hero-description')).to_have_text(introduction)
                expect(home.locator('.hero-description')).to_be_visible()
                expect(home.locator('.hero-description *')).to_have_count(0)
                home.reload()
                expect(home.locator('.hero-description')).to_have_text(introduction)
                home.set_viewport_size({'width':390,'height':844})
                home.wait_for_timeout(500)
                text_box = home.locator('.hero-description').bounding_box()
                assert text_box['x'] >= 0 and text_box['x'] + text_box['width'] <= 390
                assert text_box['y'] + text_box['height'] < 844
                home.screenshot(path=str(ROOT/'tests-client/home-text-mobile.png'))
                home.set_viewport_size({'width':1440,'height':1000})
                home.wait_for_timeout(500)
                home.screenshot(path=str(ROOT/'tests-client/home-text-desktop.png'))
                page.locator('#home-text').fill('Texto de portada. ' * 30)
                page.locator('#home-text-form [type=submit]').click()
                expect(home.locator('.hero-description')).to_have_text(('Texto de portada. ' * 30).strip())
                home.set_viewport_size({'width':390,'height':844})
                home.wait_for_timeout(500)
                if home.locator('.hero-description').evaluate('n=>n.scrollHeight>n.clientHeight+1'):
                    home.locator('.hero-description').focus()
                    home.keyboard.press('End')
                    home.wait_for_timeout(300)
                    assert home.locator('.hero-description').evaluate('n=>n.scrollTop>0')
                page.locator('#home-text').fill('')
                page.locator('#home-text-form [type=submit]').click()
                expect(home.locator('.hero-description')).to_be_hidden()
                home.close()
                context.route('**/rest/v1/portfolio_site_content*', lambda route: fulfill(route, {'code':'PGRST205','message':'Table missing'}, 404))
                unconfigured = context.new_page()
                unconfigured.on('pageerror', lambda error: errors.append(str(error)))
                unconfigured.goto(origin+'/admin.html')
                unconfigured.locator('#login-form [name=email]').fill('cliente@example.com')
                unconfigured.locator('#login-form [name=password]').fill('a private password 2026')
                unconfigured.locator('#login-form [type=submit]').click()
                expect(unconfigured.locator('#upload-panel')).to_be_visible()
                expect(unconfigured.locator('#home-text-status')).to_contain_text('todavía no está activada')
                expect(unconfigured.locator('#home-text-form [type=submit]')).to_be_disabled()
                unconfigured.close()
                context.unroute('**/rest/v1/portfolio_site_content*')
                gallery = context.new_page(); gallery.on('pageerror', lambda error: errors.append(str(error)))
                gallery.goto(origin+'/motion-graphics.html')
                expect(gallery.locator('.portfolio-placeholder')).to_have_count(8)
                page.locator('#upload-form [name=channel]').select_option('04')
                page.locator('#upload-form [name=title]').fill('Video YouTube')
                page.locator('#upload-form [name=description]').fill('Texto del video <sin HTML>')
                page.locator('#work-type').select_option('youtube')
                expect(page.locator('#upload-form [type=submit]')).to_have_text('Publicar video ↗')
                page.locator('#upload-form [name=published]').uncheck()
                expect(page.locator('#upload-form [type=submit]')).to_have_text('Guardar borrador')
                page.locator('#upload-form [name=published]').check()
                page.locator('#youtube-url').fill('https://youtu.be/dQw4w9WgXcQ')
                expect(page.locator('#file-preview .preview-caption')).to_contain_text('listo para publicar')
                page.locator('#upload-form [type=submit]').click()
                expect(page.locator('#admin-status')).to_contain_text('Trabajo publicado')
                expect(gallery.locator('.portfolio-card')).to_have_count(1)
                expect(gallery.locator('.portfolio-placeholder')).to_have_count(0)
                expect(gallery.locator('.portfolio-card img')).to_have_attribute('src','https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
                expect(gallery.locator('.portfolio-card img')).to_have_js_property('naturalWidth',320)
                assert not upload_requests
                gallery.locator('.work-open').click(force=True)
                expect(gallery.locator('.work-player iframe')).to_have_attribute('src','https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&rel=0&controls=0&enablejsapi=1&origin='+origin.replace(':','%3A').replace('/','%2F'))
                expect(gallery.locator('.work-player-description')).to_have_text('Texto del video <sin HTML>')
                expect(gallery.locator('.work-player-external')).to_have_count(0)
                assert gallery.locator('.work-player-media').evaluate('(node)=>getComputedStyle(node).clipPath') == 'none'
                assert gallery.locator('.work-player iframe').evaluate('(node)=>getComputedStyle(node).borderRadius') == '0px'
                play = gallery.get_by_role('button',name='Reproducir video',exact=True)
                expect(play).to_be_enabled()
                play.click(force=True)
                expect(gallery.get_by_role('button',name='Pausar video',exact=True)).to_be_enabled()
                gallery.get_by_role('button',name='Pausar video',exact=True).click(force=True)
                expect(gallery.get_by_role('button',name='Reproducir video',exact=True)).to_be_enabled()
                gallery.get_by_role('button',name='Silenciar video',exact=True).click(force=True)
                expect(gallery.get_by_role('button',name='Activar sonido',exact=True)).to_be_enabled()
                gallery.locator('.work-player-seek').evaluate("node=>{node.value='50';node.dispatchEvent(new Event('input',{bubbles:true}))}")
                assert gallery.evaluate('window.testYTPlayer.current') == 60
                expect(gallery.locator('.work-player-time')).to_have_count(0)
                expect(gallery.locator('.work-player-controls button')).to_have_count(3)
                assert gallery.evaluate("getComputedStyle(document.querySelector('.work-player-media'),'::after').pointerEvents") == 'none'
                gallery.screenshot(path=str(ROOT/'tests-client/youtube-player.png'))
                box = gallery.locator('.work-player iframe').bounding_box(); assert box['height'] >= 200 and box['width'] >= 200
                gallery.locator('.work-player-back').click(force=True)
                expect(gallery.locator('.work-player')).to_have_count(0)
                assert gallery.evaluate('window.testYTPlayer.destroyed')
                gallery.set_viewport_size({'width':390,'height':844})
                gallery.locator('.work-open').click(force=True)
                mobile_box = gallery.locator('.work-player iframe').bounding_box()
                assert mobile_box['width'] >= 200 and mobile_box['height'] >= 200
                controls_box = gallery.locator('.work-player-controls').bounding_box()
                assert controls_box['height'] <= 50
                assert controls_box['x'] >= 0 and controls_box['x'] + controls_box['width'] <= 390
                assert mobile_box['x'] >= 0 and mobile_box['x'] + mobile_box['width'] <= 390
                expect(gallery.get_by_role('button',name='Reproducir video',exact=True)).to_be_enabled()
                gallery.wait_for_timeout(500)
                gallery.screenshot(path=str(ROOT/'tests-client/youtube-player-mobile.png'))
                gallery.locator('.work-player-back').click(force=True)
                gallery.set_viewport_size({'width':1440,'height':1000})
                context.route('https://www.youtube.com/iframe_api', lambda route: route.abort())
                fallback_page = context.new_page()
                fallback_page.on('pageerror', lambda error: errors.append(str(error)))
                fallback_page.goto(origin+'/motion-graphics.html')
                fallback_page.locator('.work-open').click(force=True)
                expect(fallback_page.locator('.work-player iframe')).to_have_attribute('src','https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&rel=0')
                expect(fallback_page.locator('.work-player-controls')).to_have_count(0)
                fallback_page.locator('.work-player-back').click(force=True)
                fallback_page.close()
                context.route('https://i.ytimg.com/vi/**', lambda route: route.fulfill(status=404))
                gallery.reload()
                expect(gallery.locator('.portfolio-card img')).to_have_attribute('src','assets/youtube-preview.svg')
                expect(gallery.locator('.portfolio-card img')).to_have_js_property('naturalWidth',640)
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
                expect(page.locator('#home-text-panel')).to_be_hidden()
                assert not errors, errors
                browser.close()
                print('Cloud browser OK: real SDK login, YouTube, TUS image, signed URLs, descriptions, drafts, placeholders, deletion, logout and unauthorized account.')
        finally: server.close()

if __name__ == '__main__': main()
