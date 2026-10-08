'use strict';
const $ = (selector) => document.querySelector(selector);
let csrf = '', sections = {}, items = [], busy = false, deleting = '';
let limits = {imageBytes: 200 * 1024 ** 2, videoBytes: 1024 ** 3, videoSeconds: 1800};
const portfolioUpdates = 'BroadcastChannel' in window ? new BroadcastChannel('morlyn-portfolio-updates') : null;
function notifyPortfolio() { portfolioUpdates?.postMessage('refresh'); }
function message(text, error = false) {
  $('#notice').textContent = text;
  $('#notice').classList.toggle('error', error);
}
function signedOut(text = 'Ingresá para administrar tu portfolio.') {
  $('#workspace').hidden = true; $('#logout').hidden = true; $('#access').hidden = false;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('#gallery').replaceChildren(); items = [];
  $('#login-form').reset(); $('#recovery-form').reset(); $('#password-form').reset();
  $('#login-form').hidden = false; $('#recovery-form').hidden = true;
  $('#login-password').type = 'password';
  const reveal = document.querySelector('[data-reveal="login-password"]');
  reveal.textContent = 'Mostrar'; reveal.setAttribute('aria-pressed', 'false');
  message(text);
}
async function api(path, {method = 'GET', body} = {}) {
  const response = await fetch(path, {method, credentials: 'same-origin', cache: 'no-store',
    headers: {'X-CSRF-Token': csrf, ...(body ? {'Content-Type': 'application/json'} : {})},
    body: body ? JSON.stringify(body) : undefined});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !['/api/login', '/api/recover'].includes(path)) {
      signedOut(result.error); await bootstrap(false);
    }
    throw new Error(result.error || 'No se pudo completar la operación.');
  }
  if (result.csrf) csrf = result.csrf;
  return result;
}
function sectionOptions(element, all = false) {
  element.replaceChildren();
  if (all) element.add(new Option('Todas las secciones', 'all'));
  Object.entries(sections).forEach(([key, label]) => element.add(new Option(label, key)));
}
async function bootstrap(load = true) {
  try {
    const result = await api('/api/bootstrap');
    sections = result.sections;
    limits = result.limits || limits;
    $('#upload-limits').textContent = `Imágenes hasta ${bytes(limits.imageBytes)}. Videos hasta ${bytes(limits.videoBytes)} y ${Math.floor(limits.videoSeconds / 60)} minutos.`;
    ['#upload-section', '#edit-section'].forEach(id => sectionOptions($(id)));
    sectionOptions($('#filter'), true);
    if (!result.configured) { signedOut('Falta configurar la cuenta del cliente. El administrador debe crearla antes de ingresar.'); $('#login-form button[type=submit]').disabled = true; return; }
    $('#login-form button[type=submit]').disabled = false;
    if (result.authenticated && load) await enter(result.email);
    else if (load) signedOut();
  } catch (error) { message('No se pudo conectar al servidor. Recargá la página para reintentar.', true); }
}
async function enter(email) {
  $('#access').hidden = true; $('#workspace').hidden = false; $('#logout').hidden = false;
  $('#account').textContent = email;
  message('Tu espacio está listo. Elegí una sección y subí tu trabajo para publicarlo.');
  await refresh();
}
function bytes(value) { return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`; }
async function refresh() {
  const result = await api('/api/media'); items = result.media;
  $('#storage').textContent = `${bytes(result.used)} de ${bytes(result.quota)} usados · ${items.length} archivos`;
  render();
}
function render() {
  const selected = $('#filter').value;
  const visible = items.filter(item => selected === 'all' || item.section === selected);
  $('#empty').hidden = visible.length > 0;
  $('#empty').textContent = items.length ? 'No hay archivos en esta sección.' : 'Todavía no hay archivos. Subí tu primer trabajo para empezar.';
  $('#gallery').replaceChildren();
  for (const item of visible) {
    const card = document.createElement('article'); card.className = 'card';
    const preview = document.createElement(item.kind === 'video' ? 'video' : 'img');
    preview.src = item.url;
    if (item.kind === 'video') { preview.controls = true; preview.preload = 'none'; preview.playsInline = true; preview.setAttribute('aria-label', item.title); }
    else { preview.alt = item.title; preview.loading = 'lazy'; }
    const content = document.createElement('div'); content.className = 'card-content';
    const title = document.createElement('h2'); title.textContent = item.title;
    const metadata = document.createElement('p'); metadata.className = 'muted';
    metadata.textContent = `${sections[item.section]} · ${item.kind === 'video' ? 'VIDEO' : 'IMAGEN'} · ${bytes(item.size)}`;
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = item.published ? 'PUBLICADO' : 'BORRADOR · PRIVADO';
    const description = document.createElement('p'); description.className = 'file-description'; description.textContent = item.description || ''; description.hidden = !item.description;
    const actions = document.createElement('div'); actions.className = 'actions';
    const edit = document.createElement('button'); edit.textContent = 'Editar / publicar'; edit.addEventListener('click', () => openEdit(item));
    const remove = document.createElement('button'); remove.textContent = 'Eliminar'; remove.addEventListener('click', () => {
      deleting = item.id; $('#delete-name').textContent = item.title; $('#delete-message').textContent = ''; $('#delete-dialog').showModal();
    });
    actions.append(edit, remove); content.append(title, description, metadata, badge, actions); card.append(preview, content); $('#gallery').append(card);
  }
}
async function submitForm(form, action, target = null) {
  const button = form.querySelector('[type=submit]'); button.disabled = true;
  try { await action(new FormData(form)); }
  catch (error) { if (target) $(target).textContent = error.message; else message(error.message, true); }
  finally { button.disabled = false; }
}
$('#login-form').addEventListener('submit', event => {
  event.preventDefault(); submitForm(event.currentTarget, async values => {
    const result = await api('/api/login', {method: 'POST', body: {email: values.get('email'), password: values.get('password'), remember: values.has('remember')}});
    $('#login-form').reset(); await enter(result.email);
  });
});
$('#recovery-form').addEventListener('submit', event => {
  event.preventDefault(); submitForm(event.currentTarget, async values => {
    if (values.get('password') !== values.get('confirmation')) throw new Error('Las contraseñas no coinciden.');
    const result = await api('/api/recover', {method: 'POST', body: {code: values.get('code'), password: values.get('password')}});
    $('#recovery-form').reset(); await enter(result.email);
  });
});
document.querySelectorAll('[data-reveal]').forEach(button => button.addEventListener('click', () => {
  const input = document.getElementById(button.dataset.reveal); const show = input.type === 'password';
  input.type = show ? 'text' : 'password'; button.textContent = show ? 'Ocultar' : 'Mostrar'; button.setAttribute('aria-pressed', String(show));
}));
$('#open-recovery').addEventListener('click', () => { $('#login-form').hidden = true; $('#recovery-form').hidden = false; $('#recovery-form input').focus(); });
$('#back-login').addEventListener('click', () => { $('#recovery-form').hidden = true; $('#login-form').hidden = false; $('#login-form input').focus(); });
$('#logout').addEventListener('click', async () => {
  if (busy) { message('Esperá a que termine la carga para cerrar sesión.'); return; }
  try { await api('/api/logout', {method: 'POST'}); signedOut('Sesión cerrada.'); await bootstrap(false); }
  catch (error) { message(error.message, true); }
});
$('#filter').addEventListener('change', render);
$('#refresh').addEventListener('click', () => refresh().catch(error => message(error.message, true)));
$('#files').addEventListener('change', () => { $('#selection').textContent = `${$('#files').files.length} archivos seleccionados`; });
const dropZone = $('#drop-zone');
['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); if (!busy) dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', event => { if (busy) return; $('#files').files = event.dataTransfer.files; $('#files').dispatchEvent(new Event('change')); });
function uploadFile(file, section, description, published, index, total) {
  return new Promise((resolve, reject) => {
    const data = new FormData(); data.append('file', file); data.append('section', section);
    data.append('title', file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Sin título');
    data.append('description', description);
    data.append('published', String(published));
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/media'); xhr.setRequestHeader('X-CSRF-Token', csrf); xhr.timeout = 1800000;
    xhr.upload.addEventListener('progress', event => {
      if (event.lengthComputable) {
        $('#upload-progress').value = Math.round(event.loaded / event.total * 100);
        $('#upload-message').textContent = event.loaded === event.total ? `Procesando ${index}/${total}: ${file.name}. El video puede tardar unos minutos…` : `Subiendo ${index}/${total}: ${file.name}`;
      }
    });
    xhr.addEventListener('load', () => {
      let result = {}; try { result = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(result);
      else { const error = new Error(result.error || 'No se pudo subir el archivo.'); error.status = xhr.status; reject(error); }
    });
    xhr.addEventListener('error', () => reject(new Error('Se perdió la conexión. Revisá la galería antes de volver a subir.')));
    xhr.addEventListener('timeout', () => reject(new Error('La operación tardó demasiado. Actualizá la galería antes de reintentar.')));
    xhr.send(data);
  });
}
$('#upload-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const files = Array.from($('#files').files), section = $('#upload-section').value, description = $('#upload-description').value;
  const published = $('#upload-published').checked;
  if (!files.length) return;
  busy = true; $('#upload-form').querySelectorAll('button,input,select,textarea').forEach(control => control.disabled = true);
  $('#upload-status').hidden = false; $('#upload-results').replaceChildren(); $('#view-section').hidden = true;
  let successful = 0;
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index], result = document.createElement('li'); $('#upload-results').append(result);
      $('#upload-progress').value = 0; $('#upload-message').textContent = `Subiendo ${index + 1}/${files.length}: ${file.name}`;
      try {
        if (!/\.(jpe?g|png|webp|mp4|mov|webm)$/i.test(file.name)) throw new Error('Formato no admitido.');
        const video = /\.(mp4|mov|webm)$/i.test(file.name), limit = video ? limits.videoBytes : limits.imageBytes;
        if (file.size > limit) throw new Error(`Supera el límite de ${bytes(limit)} para ${video ? 'videos' : 'imágenes'}.`);
        const uploaded = await uploadFile(file, section, description, published, index + 1, files.length); successful++;
        result.textContent = `${file.name} · ${uploaded.media.published ? 'publicado en ' + sections[section] : 'guardado como borrador privado'}`;
      } catch (error) {
        result.textContent = `${file.name} · ${error.message}`;
        if (error.status === 401 || error.status === 403) { signedOut(error.message); await bootstrap(false); break; }
      }
    }
    $('#upload-message').textContent = `Carga terminada: ${successful} de ${files.length} archivos ${published ? 'publicados en ' + sections[section] : 'guardados como borradores privados'}.`;
    if (published && successful) {
      const pages = {'01': 'video-tv.html', '02': 'video-redes.html', '03': 'animacion-3d.html', '04': 'motion-graphics.html'};
      $('#view-section').href = '/' + pages[section]; $('#view-section').hidden = false;
    }
    if (!$('#workspace').hidden) await refresh();
    if (successful) notifyPortfolio();
    $('#files').value = ''; $('#selection').textContent = 'Podés subir varios archivos juntos.';
    if (successful === files.length) $('#upload-description').value = '';
  } catch (error) { message(error.message, true); }
  finally { busy = false; $('#upload-form').querySelectorAll('button,input,select,textarea').forEach(control => control.disabled = false); }
});
$('#upload-published').addEventListener('change', () => {
  $('#upload-submit').textContent = $('#upload-published').checked ? 'Subir y publicar ↑' : 'Guardar borradores ↑';
});
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
function openEdit(item) {
  const form = $('#edit-form'); form.elements.id.value = item.id; form.elements.title.value = item.title;
  form.elements.description.value = item.description || '';
  form.elements.section.value = item.section; form.elements.published.checked = item.published;
  $('#edit-message').textContent = ''; $('#edit-dialog').showModal();
}
$('#edit-form').addEventListener('submit', event => {
  event.preventDefault(); submitForm(event.currentTarget, async values => {
    await api(`/api/media/${values.get('id')}`, {method: 'PATCH', body: {title: values.get('title'), description: values.get('description'), section: values.get('section'), published: values.has('published')}});
    $('#edit-dialog').close(); await refresh(); message('Cambios guardados.');
    notifyPortfolio();
  }, '#edit-message');
});
$('#confirm-delete').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { await api(`/api/media/${deleting}`, {method: 'DELETE'}); $('#delete-dialog').close(); await refresh(); notifyPortfolio(); message('Archivo eliminado.'); }
  catch (error) { $('#delete-message').textContent = error.message; }
  finally { $('#confirm-delete').disabled = false; }
});
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
async function loadSessions() {
  const result = await api('/api/sessions'); $('#sessions').replaceChildren();
  for (const session of result.sessions) {
    const li = document.createElement('li'), label = document.createElement('strong'), detail = document.createElement('p');
    label.textContent = session.current ? 'Este dispositivo' : 'Otro dispositivo';
    detail.textContent = `${session.device} · última actividad: ${new Date(session.seen * 1000).toLocaleString('es-AR')}`;
    li.append(label, detail);
    if (!session.current) {
      const button = document.createElement('button'); button.textContent = 'Cerrar esta sesión';
      button.addEventListener('click', async () => { button.disabled = true; try { await api(`/api/sessions/${session.id}`, {method: 'DELETE'}); await loadSessions(); } catch (error) { $('#security-message').textContent = error.message; button.disabled = false; } });
      li.append(button);
    }
    $('#sessions').append(li);
  }
}
$('#open-security').addEventListener('click', async () => {
  $('#security-message').textContent = ''; $('#security-dialog').showModal();
  try { await loadSessions(); } catch (error) { $('#security-message').textContent = error.message; }
});
$('#revoke-others').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { await api('/api/sessions/others', {method: 'DELETE'}); await loadSessions(); $('#security-message').textContent = 'Las otras sesiones se cerraron.'; }
  catch (error) { $('#security-message').textContent = error.message; }
  finally { $('#revoke-others').disabled = false; }
});
$('#password-form').addEventListener('submit', event => {
  event.preventDefault(); submitForm(event.currentTarget, async values => {
    if (values.get('password') !== values.get('confirmation')) throw new Error('Las contraseñas no coinciden.');
    await api('/api/password', {method: 'POST', body: {current: values.get('current'), password: values.get('password')}});
    $('#password-form').reset(); await loadSessions(); $('#security-message').textContent = 'Contraseña actualizada. Las otras sesiones se cerraron.';
  }, '#security-message');
});
bootstrap();
