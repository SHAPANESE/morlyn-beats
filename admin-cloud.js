'use strict';
const cloud = window.morlynBackend;
const cloudConfig = window.MORLYN_BACKEND;
const cloudStatus = document.querySelector('#admin-status');
const cloudForm = document.querySelector('#upload-form');
const cloudFields = document.querySelector('#upload-fields');
const cloudProgress = document.querySelector('#upload-progress');
const cloudPreview = document.querySelector('#file-preview');
const cloudPages = {'01': 'video-tv.html', '02': 'video-redes.html', '03': 'animacion-3d.html', '04': 'motion-graphics.html'};
const cloudTypes = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif'};
const cloudMax = Math.min(Number(cloudConfig.maxFileBytes) || 50 * 1024 ** 2, 50 * 1024 ** 2);
const cloudUpdates = 'BroadcastChannel' in window ? new BroadcastChannel('morlyn-portfolio-updates') : null;
let cloudUploading = false, cloudPreviewUrl = '', cloudWorks = [], cloudRecovery = false;
function cloudMessage(text) { cloudStatus.textContent = text; }
function cloudNotify() { cloudUpdates?.postMessage('refresh'); }
function cloudClearPreview() {
  cloudPreview.replaceChildren();
  if (cloudPreviewUrl) URL.revokeObjectURL(cloudPreviewUrl);
  cloudPreviewUrl = '';
}
function cloudValidateImage(file) {
  if (!file || !cloudTypes[file.type]) throw new Error('Elegí una imagen JPG, PNG, WebP o GIF. Para videos, usá un enlace de YouTube.');
  if (!file.size) throw new Error('El archivo está vacío.');
  if (file.size > cloudMax) throw new Error('La imagen supera el límite de 50 MB.');
}
function cloudSource() {
  const youtube = document.querySelector('#work-type').value === 'youtube';
  document.querySelector('#image-source').hidden = youtube;
  document.querySelector('#youtube-source').hidden = !youtube;
  document.querySelector('#work-file').required = !youtube;
  document.querySelector('#youtube-url').required = youtube;
  cloudClearPreview();
}
document.querySelector('#work-type').addEventListener('change', cloudSource);
document.querySelector('#work-file').addEventListener('change', event => {
  cloudClearPreview();
  if (!event.target.files.length) return;
  try {
    const file = event.target.files[0]; cloudValidateImage(file);
    cloudPreviewUrl = URL.createObjectURL(file);
    const image = document.createElement('img'); image.src = cloudPreviewUrl; image.alt = 'Vista previa del trabajo'; cloudPreview.append(image);
    cloudMessage('');
  } catch (error) { event.target.value = ''; cloudMessage(error.message); }
});
document.querySelector('#cloud-upload-limits').textContent = `JPG, PNG, WebP o GIF. Hasta ${Math.round(cloudMax / 1024 ** 2)} MB por imagen; 1 GB de almacenamiento total en Supabase Free.`;
function cloudHideSession() {
  document.querySelector('#login-panel').hidden = false;
  ['#home-text-panel', '#upload-panel', '#published-panel', '#account-panel'].forEach(id => document.querySelector(id).hidden = true);
  document.querySelector('#home-text-form').reset();
  document.querySelector('#home-text-form [type=submit]').disabled = true;
  document.querySelector('#home-text-status').textContent = '';
  document.querySelector('#published-works').replaceChildren();
  document.querySelector('#owner-email').textContent = '';
  document.querySelector('#change-password-form').reset();
  document.querySelector('#edit-work-dialog').close();
  cloudWorks = []; cloudClearPreview();
}
function cloudRenderWorks() {
  const list = document.querySelector('#published-works'), filter = document.querySelector('#works-filter').value;
  list.replaceChildren();
  const visible = cloudWorks.filter(work => filter === 'all' || work.channel === filter);
  if (!visible.length) { list.textContent = 'Todavía no hay trabajos en esta selección.'; return; }
  for (const work of visible) {
    const row = document.createElement('article'); row.className = 'published-work';
    const details = document.createElement('div'); details.className = 'work-details';
    const title = document.createElement('strong'); title.textContent = 'CH ' + work.channel + ' / ' + work.title;
    const state = document.createElement('span'); state.className = 'work-state'; state.textContent = work.published ? 'PUBLICADO' : 'BORRADOR';
    const description = document.createElement('p'); description.textContent = work.description;
    details.append(title, state, description);
    const actions = document.createElement('div'); actions.className = 'work-actions';
    if (work.published) {
      const link = document.createElement('a'); link.href = cloudPages[work.channel]; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Ver sección ↗'; actions.append(link);
    }
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary'; edit.textContent = 'Editar';
    edit.addEventListener('click', () => {
      const form = document.querySelector('#edit-work-form');
      form.elements.id.value = work.id; form.elements.title.value = work.title; form.elements.description.value = work.description; form.elements.published.checked = work.published;
      document.querySelector('#edit-status').textContent = ''; document.querySelector('#edit-work-dialog').showModal();
    });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = 'Eliminar';
    remove.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar «${work.title}» del portfolio? Esta acción no se puede deshacer.`)) return;
      remove.disabled = true;
      try {
        const result = await cloud.from('portfolio_works').delete().eq('id', work.id).select('id');
        if (result.error || !result.data?.length) throw result.error || new Error('No se eliminó el trabajo.');
        let warning = '';
        if (work.media_path) {
          const cleanup = await cloud.storage.from(cloudConfig.bucket).remove([work.media_path]);
          if (cleanup.error) warning = ' No pudimos liberar el archivo de Storage; el administrador puede retirarlo desde el dashboard.';
        }
        await cloudListWorks(); cloudNotify(); cloudMessage('Trabajo eliminado del portfolio.' + warning);
      } catch { cloudMessage('No se pudo eliminar el trabajo. Revisá tu conexión e intentá de nuevo.'); remove.disabled = false; }
    });
    actions.append(edit, remove); row.append(details, actions); list.append(row);
  }
}
async function cloudListWorks() {
  const result = await cloud.from('portfolio_works').select('id,channel,title,description,media_type,media_path,video_id,published').order('created_at', {ascending: false});
  if (result.error) throw result.error;
  cloudWorks = result.data; cloudRenderWorks();
}
async function cloudShowSession() {
  const result = await cloud.auth.getSession();
  if (result.error) throw result.error;
  const session = result.data.session;
  if (!session) { cloudHideSession(); return; }
  const permission = await cloud.rpc('is_portfolio_admin');
  if (permission.error) throw permission.error;
  if (permission.data !== true) {
    await cloud.auth.signOut({scope: 'local'}); cloudHideSession(); cloudMessage('Esta cuenta no está autorizada para administrar el portfolio.'); return;
  }
  document.querySelector('#login-panel').hidden = true;
  ['#home-text-panel', '#upload-panel', '#published-panel', '#account-panel'].forEach(id => document.querySelector(id).hidden = false);
  document.querySelector('#owner-email').textContent = session.user.email;
  await Promise.all([cloudListWorks(), cloudLoadHomeText()]);
}
async function cloudLoadHomeText() {
  const status = document.querySelector('#home-text-status');
  const button = document.querySelector('#home-text-form [type=submit]');
  button.disabled = true;
  try {
    const result = await cloud.from('portfolio_site_content').select('body').eq('id', 'home').maybeSingle();
    if (result.error) {
      status.textContent = ['PGRST205', '42P01'].includes(result.error.code)
        ? 'La edición de portada todavía no está activada.'
        : 'No pudimos cargar el texto. Recargá el panel para intentar de nuevo.';
      return;
    }
    document.querySelector('#home-text').value = result.data?.body || '';
    status.textContent = '';
    button.disabled = false;
  } catch { status.textContent = 'No pudimos cargar el texto. Recargá el panel para intentar de nuevo.'; }
}
async function cloudSubmit(form, action, statusSelector) {
  const button = form.querySelector('[type=submit]'); button.disabled = true;
  try { await action(new FormData(form)); }
  catch (error) { if (statusSelector) document.querySelector(statusSelector).textContent = error.message; else cloudMessage(error.message); }
  finally { button.disabled = false; }
}
if (!cloud) {
  cloudMessage('Falta activar la conexión con Supabase. El administrador está preparando tu acceso.');
  document.querySelector('#login-form [type=submit]').disabled = true;
  window.morlynLocalReady?.then(local => { if (local) location.replace(local.baseUrl + '/admin.html'); });
} else {
  document.querySelector('#home-text-form').addEventListener('submit', event => {
    event.preventDefault();
    const status = document.querySelector('#home-text-status');
    status.textContent = '';
    cloudSubmit(event.currentTarget, async values => {
      const body = String(values.get('body') || '').trim();
      if ([...body].length > 600) throw new Error('El texto puede tener hasta 600 caracteres.');
      const result = await cloud.from('portfolio_site_content').upsert({id: 'home', body}, {onConflict: 'id'}).select('body').single();
      if (result.error) throw new Error('No pudimos guardar el texto. Revisá tu conexión e intentá de nuevo.');
      document.querySelector('#home-text').value = result.data.body;
      status.textContent = 'Texto de portada guardado.';
      cloudNotify();
    }, '#home-text-status');
  });
  document.querySelector('#forgot-password').hidden = !cloudConfig.passwordRecoveryEnabled;
  cloud.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      cloudRecovery = true; document.querySelector('#recovery-dialog').showModal();
    }
    // Avoid calling Auth or SQL while the SDK's event callback holds its lock.
    if (['SIGNED_OUT', 'TOKEN_REFRESHED'].includes(event)) setTimeout(() => cloudShowSession().catch(() => cloudMessage('No pudimos renovar el acceso. Volvé a entrar.')), 0);
  });
  cloudShowSession().catch(() => cloudMessage('No pudimos conectar con el proyecto. Revisá la conexión o recargá el panel.'));
  document.querySelector('#login-form').addEventListener('submit', event => {
    event.preventDefault(); cloudSubmit(event.currentTarget, async values => {
      window.morlynRememberSession(values.has('remember'));
      const result = await cloud.auth.signInWithPassword({email: values.get('email').trim(), password: values.get('password')});
      if (result.error) throw new Error('Email o contraseña incorrectos, o el servicio no está disponible.');
      document.querySelector('#login-form').reset(); cloudMessage(''); await cloudShowSession();
    });
  });
  document.querySelector('#logout').addEventListener('click', async () => {
    if (cloudUploading) return;
    const result = await cloud.auth.signOut({scope: 'local'});
    if (result.error) { cloudMessage('No pudimos cerrar sesión. Intentá de nuevo.'); return; }
    cloudHideSession(); cloudForm.reset(); cloudSource(); cloudMessage('Sesión cerrada.');
  });
  cloudForm.addEventListener('submit', async event => {
    event.preventDefault(); if (cloudUploading) return;
    let objectPath = null, inserted = false, row = null;
    try {
      const values = new FormData(cloudForm), title = values.get('title').trim(), description = values.get('description').trim(), channel = values.get('channel');
      if (!title || title.length > 160 || description.length > 5000 || !cloudPages[channel]) throw new Error('Revisá el título, el texto y la sección.');
      const youtube = values.get('type') === 'youtube';
      const file = youtube ? null : values.get('file');
      const videoId = youtube ? window.morlynYouTube.id(values.get('youtube_url')) : null;
      if (!youtube) cloudValidateImage(file);
      row = {id: crypto.randomUUID(), channel, title, description, media_type: youtube ? 'youtube' : 'image', media_path: null, video_id: videoId, published: values.has('published')};
      cloudUploading = true; cloudFields.disabled = true; document.querySelector('#logout').disabled = true;
      if (!youtube) {
        objectPath = channel + '/' + row.id + '.' + cloudTypes[file.type]; row.media_path = objectPath;
        const session = await cloud.auth.getSession();
        if (session.error || !session.data.session) throw new Error('La sesión terminó. Volvé a entrar para publicar.');
        cloudProgress.hidden = false; cloudProgress.value = 0; cloudMessage('Subiendo la imagen…');
        const endpoint = new URL(cloudConfig.url);
        if (endpoint.hostname.endsWith('.supabase.co')) endpoint.hostname = endpoint.hostname.replace('.supabase.co', '.storage.supabase.co');
        await new Promise((resolve, reject) => {
          new tus.Upload(file, {
            endpoint: endpoint.origin + '/storage/v1/upload/resumable',
            headers: {authorization: 'Bearer ' + session.data.session.access_token, apikey: cloudConfig.publishableKey},
            retryDelays: [0, 1000, 3000, 5000, 10000], uploadDataDuringCreation: true, removeFingerprintOnSuccess: true,
            storeFingerprintForResuming: false, chunkSize: 6 * 1024 ** 2,
            metadata: {bucketName: cloudConfig.bucket, objectName: objectPath, contentType: file.type, cacheControl: '3600'},
            onProgress: (sent, total) => { cloudProgress.value = sent / total * 100; }, onError: reject, onSuccess: resolve,
          }).start();
        });
      }
      const result = await cloud.from('portfolio_works').insert(row);
      if (result.error) throw result.error;
      inserted = true; cloudForm.reset(); cloudSource(); cloudNotify();
      cloudMessage(row.published ? 'Trabajo publicado. Ya aparece en su sección.' : 'Borrador guardado. Podés publicarlo desde Editar.');
      await cloudListWorks();
    } catch (error) {
      if (objectPath && !inserted && row) {
        const check = await cloud.from('portfolio_works').select('id').eq('id', row.id).maybeSingle();
        if (check.data) inserted = true;
        else if (!check.error) await cloud.storage.from(cloudConfig.bucket).remove([objectPath]);
      }
      if (inserted) cloudMessage('El trabajo se guardó, pero no pudimos actualizar la lista. Presioná Actualizar antes de volver a subir.');
      else cloudMessage(error.message?.match(/^(Elegí|La imagen|El archivo|Revisá|Pegá|La sesión)/) ? error.message : 'No se pudo guardar. Conservamos los datos; revisá la conexión y volvé a intentar.');
    } finally {
      cloudUploading = false; cloudFields.disabled = false; document.querySelector('#logout').disabled = false; cloudProgress.hidden = true;
    }
  });
  document.querySelector('#edit-work-form').addEventListener('submit', event => {
    event.preventDefault(); cloudSubmit(event.currentTarget, async values => {
      const result = await cloud.from('portfolio_works').update({title: values.get('title').trim(), description: values.get('description').trim(), published: values.has('published')}).eq('id', values.get('id')).select('id');
      if (result.error || !result.data?.length) throw new Error('No se pudieron guardar los cambios.');
      document.querySelector('#edit-work-dialog').close(); await cloudListWorks(); cloudNotify(); cloudMessage('Cambios guardados.');
    }, '#edit-status');
  });
  document.querySelector('#change-password-form').addEventListener('submit', event => {
    event.preventDefault(); cloudSubmit(event.currentTarget, async values => {
      if (values.get('password') !== values.get('confirmation')) throw new Error('Las contraseñas no coinciden.');
      const result = await cloud.auth.updateUser({password: values.get('password')});
      if (result.error) throw new Error('No se pudo actualizar la contraseña. Volvé a ingresar e intentá de nuevo.');
      const revoked = await cloud.auth.signOut({scope: 'others'});
      document.querySelector('#change-password-form').reset(); cloudMessage(revoked.error ? 'Contraseña actualizada. No pudimos cerrar las otras sesiones; reintentá con el botón.' : 'Contraseña actualizada y otras sesiones cerradas.');
    });
  });
  document.querySelector('#close-other-sessions').addEventListener('click', async () => {
    const result = await cloud.auth.signOut({scope: 'others'});
    cloudMessage(result.error ? 'No se pudieron cerrar las otras sesiones.' : 'Las otras sesiones se cerraron.');
  });
  document.querySelector('#forgot-password').addEventListener('click', async event => {
    const email = document.querySelector('#login-form [name=email]');
    if (!email.reportValidity()) return;
    event.currentTarget.disabled = true;
    try {
      const result = await cloud.auth.resetPasswordForEmail(email.value.trim(), {redirectTo: new URL('admin.html', location.href).href});
      cloudMessage(result.error ? 'No pudimos solicitar la recuperación. Contactá al administrador.' : 'Si la cuenta está habilitada, recibirás un enlace para recuperar el acceso.');
    } finally { document.querySelector('#forgot-password').disabled = false; }
  });
  document.querySelector('#recovery-password-form').addEventListener('submit', event => {
    event.preventDefault(); cloudSubmit(event.currentTarget, async values => {
      if (!cloudRecovery) throw new Error('Abrí el enlace de recuperación que recibiste por email.');
      if (values.get('password') !== values.get('confirmation')) throw new Error('Las contraseñas no coinciden.');
      const result = await cloud.auth.updateUser({password: values.get('password')});
      if (result.error) throw new Error('El enlace venció o no se pudo actualizar la contraseña. Solicitá otro enlace.');
      await cloud.auth.signOut({scope: 'others'}); cloudRecovery = false;
      document.querySelector('#recovery-dialog').close(); document.querySelector('#recovery-password-form').reset();
      cloudMessage('Contraseña actualizada.'); await cloudShowSession();
    }, '#recovery-status');
  });
}
document.querySelector('#close-edit').addEventListener('click', () => document.querySelector('#edit-work-dialog').close());
document.querySelector('#works-filter').addEventListener('change', cloudRenderWorks);
document.querySelector('#reload-works').addEventListener('click', () => cloudListWorks().catch(() => cloudMessage('No se pudo actualizar la lista.')));
window.addEventListener('beforeunload', event => { if (cloudUploading) { event.preventDefault(); event.returnValue = ''; } });
