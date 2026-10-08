const client = window.morlynBackend;
const config = window.MORLYN_BACKEND;
const status = document.querySelector('#admin-status');
const loginForm = document.querySelector('#login-form');
const uploadForm = document.querySelector('#upload-form');
const fields = document.querySelector('#upload-fields');
const progress = document.querySelector('#upload-progress');
const logout = document.querySelector('#logout');
const preview = document.querySelector('#file-preview');
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
let previewUrl;
let uploading = false;

function message(text) { status.textContent = text; }
function validateFile(file) {
  if (!file || !allowedTypes.includes(file.type)) throw new Error('Elegí una imagen JPG, PNG, WebP o GIF, o un video MP4 o WebM.');
  if (file.size > config.maxFileBytes) throw new Error('El archivo supera los 50 MB. Elegí una versión más liviana.');
  if (!file.size) throw new Error('El archivo está vacío.');
}
function clearPreview() {
  preview.replaceChildren();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}
document.querySelector('#work-file').addEventListener('change', (event) => {
  clearPreview();
  const file = event.target.files[0];
  if (!file) return;
  try {
    validateFile(file);
    const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'img');
    previewUrl = URL.createObjectURL(file);
    media.src = previewUrl;
    if (media.tagName === 'VIDEO') { media.controls = true; media.playsInline = true; }
    else media.alt = 'Vista previa del trabajo';
    preview.appendChild(media);
    message('');
  } catch (error) { event.target.value = ''; message(error.message); }
});

async function listWorks() {
  const { data, error } = await client.from('portfolio_works').select('id,channel,title').order('created_at', { ascending: false });
  if (error) throw error;
  const list = document.querySelector('#published-works');
  list.replaceChildren();
  if (!data.length) { list.textContent = 'Todavía no publicaste trabajos.'; return; }
  const pages = { '01': 'video-tv.html', '02': 'video-redes.html', '03': 'animacion-3d.html', '04': 'motion-graphics.html' };
  data.forEach(work => {
    const row = document.createElement('div');
    row.className = 'published-work';
    const title = document.createElement('span');
    title.textContent = 'CH ' + work.channel + ' / ' + work.title;
    const link = document.createElement('a');
    link.href = pages[work.channel] + '#trabajos';
    link.textContent = 'Ver en el sitio ↗';
    link.target = '_blank';
    link.rel = 'noopener';
    row.append(title, link);
    list.appendChild(row);
  });
}
async function showSession() {
  const { data: { session }, error } = await client.auth.getSession();
  if (error) throw error;
  let authorized = false;
  if (session) {
    const permission = await client.rpc('is_portfolio_admin');
    if (permission.error) throw permission.error;
    authorized = permission.data === true;
  }
  document.querySelector('#login-panel').hidden = authorized;
  document.querySelector('#upload-panel').hidden = !authorized;
  document.querySelector('#published-panel').hidden = !authorized;
  if (session && !authorized) {
    await client.auth.signOut();
    message('Este usuario no tiene acceso al panel de trabajos.');
  }
  if (authorized) await listWorks();
}

if (!client) {
  message('El panel todavía no está habilitado. Estamos preparando tu acceso.');
  loginForm.querySelector('button').disabled = true;
} else {
  showSession().catch(() => message('No pudimos conectar el panel. Intentá de nuevo.'));
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector('button');
    button.disabled = true;
    message('Entrando…');
    try {
      const values = new FormData(loginForm);
      const { error } = await client.auth.signInWithPassword({ email: values.get('email').trim(), password: values.get('password') });
      if (error) throw error;
      loginForm.reset();
      message('');
      await showSession();
    } catch { message('No pudimos entrar. Revisá tu email y contraseña o intentá de nuevo.'); }
    finally { button.disabled = false; }
  });
  logout.addEventListener('click', async () => {
    if (uploading) return;
    const { error } = await client.auth.signOut();
    if (error) { message('No pudimos cerrar la sesión. Intentá de nuevo.'); return; }
    message('Sesión cerrada.');
    clearPreview();
    uploadForm.reset();
    await showSession();
  });
  uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (uploading) return;
    let objectPath;
    let uploaded = false;
    let published = false;
    try {
      const values = new FormData(uploadForm);
      const file = values.get('file');
      validateFile(file);
      const title = values.get('title').trim();
      if (!title) throw new Error('Escribí un título para el trabajo.');
      const channel = values.get('channel');
      objectPath = channel + '/' + crypto.randomUUID() + '.' + extensions[file.type];
      uploading = true;
      fields.disabled = true;
      logout.disabled = true;
      progress.hidden = false;
      progress.value = 0;
      message('Subiendo el archivo…');
      const { data: { session }, error } = await client.auth.getSession();
      if (error || !session) throw new Error('La sesión terminó. Volvé a entrar para publicar.');
      const storageUrl = new URL(config.url);
      if (storageUrl.hostname.endsWith('.supabase.co')) storageUrl.hostname = storageUrl.hostname.replace('.supabase.co', '.storage.supabase.co');
      await new Promise((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: storageUrl.origin + '/storage/v1/upload/resumable',
          headers: { authorization: 'Bearer ' + session.access_token, apikey: config.publishableKey },
          retryDelays: [0, 1000, 3000, 5000, 10000],
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          storeFingerprintForResuming: false,
          chunkSize: 6 * 1024 * 1024,
          metadata: { bucketName: config.bucket, objectName: objectPath, contentType: file.type, cacheControl: '3600' },
          onProgress: (sent, total) => { progress.value = sent / total * 100; },
          onError: reject,
          onSuccess: resolve,
        });
        upload.start();
      });
      uploaded = true;
      message('Publicando el trabajo…');
      const result = await client.from('portfolio_works').insert({ channel, title, media_path: objectPath, media_type: file.type.startsWith('video/') ? 'video' : 'image' });
      if (result.error) throw result.error;
      published = true;
      uploadForm.reset();
      clearPreview();
      message('Trabajo publicado. Ya se puede ver en la galería.');
      await listWorks();
    } catch (error) {
      if (uploaded && !published) {
        const cleanup = await client.storage.from(config.bucket).remove([objectPath]);
        if (cleanup.error) console.error('Could not clean up unpublished media', cleanup.error);
      }
      if (published) message('El trabajo se publicó, pero no pudimos actualizar la lista. Recargá el panel.');
      else message(error.message?.startsWith('Elegí') || error.message?.startsWith('El archivo') || error.message?.startsWith('Escribí') || error.message?.startsWith('La sesión') ? error.message : 'No se pudo publicar el trabajo. Conservamos los datos para que puedas volver a intentar.');
    } finally {
      uploading = false;
      fields.disabled = false;
      logout.disabled = false;
      progress.hidden = true;
    }
  });
}
window.addEventListener('beforeunload', (event) => {
  if (uploading) { event.preventDefault(); event.returnValue = ''; }
});
