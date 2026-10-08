const portfolioGrid = document.querySelector('.portfolio-grid');
if (portfolioGrid) {
  const portfolio = portfolioGrid.closest('.portfolio');
  const emptyMessage = document.querySelector('.portfolio-empty');
  const channel = document.body.dataset.channel;
  const openWork = (work, open) => {
    if (document.querySelector('.work-player')) return;
    const hero = document.querySelector('.hero');
    const player = document.createElement('section');
    player.className = 'work-player';
    player.setAttribute('role', 'region');
    player.setAttribute('aria-label', work.title || 'Trabajo audiovisual');
    const header = document.createElement('div');
    header.className = 'work-player-header';
    const channelLabel = document.createElement('p');
    channelLabel.className = 'work-player-kicker';
    channelLabel.textContent = 'CANAL ' + channel + ' / ' + (work.type === 'video' ? 'VIDEO' : 'IMAGEN');
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'work-player-back';
    back.textContent = 'VOLVER A TRABAJOS \u2190';
    header.append(channelLabel, back);
    const mediaArea = document.createElement('div');
    mediaArea.className = 'work-player-media';
    const full = document.createElement(work.type === 'video' ? 'video' : 'img');
    full.crossOrigin = 'anonymous';
    full.src = work.src;
    if (work.type === 'video') {
      full.playsInline = true;
      full.preload = 'auto';
      full.setAttribute('aria-label', work.title || 'Trabajo audiovisual');
      if (work.poster) full.poster = work.poster;
    } else full.alt = work.alt || work.title || '';
    const status = document.createElement('p');
    status.className = 'work-player-status';
    status.setAttribute('role', 'status');
    status.textContent = 'CARGANDO...';
    const loaded = () => { status.hidden = true; };
    full.addEventListener(work.type === 'video' ? 'loadeddata' : 'load', loaded);
    full.addEventListener('error', () => {
      status.hidden = false;
      status.textContent = 'No pudimos cargar el archivo. Volv\u00e9 a trabajos para reintentar.';
    });
    mediaArea.append(full, status);
    const title = document.createElement('h2');
    title.className = 'work-player-title';
    title.textContent = (work.title || 'Trabajo audiovisual').toUpperCase();
    player.append(header, mediaArea, title);
    const listener = new AbortController();
    const proxy = document.querySelector('.crt-action-hit');
    const copy = document.querySelector('.hero-copy');
    const close = () => {
      if (work.type === 'video') full.pause();
      if (document.fullscreenElement === hero) document.exitFullscreen().catch(() => {});
      listener.abort();
      player.remove();
      window.dispatchEvent(new Event('morlyn-work-changed'));
      document.body.classList.remove('work-is-open');
      portfolio.inert = false;
      if (copy) copy.inert = false;
      if (proxy) proxy.inert = false;
      open.focus({ preventScroll: true });
    };
    back.addEventListener('click', close);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    }, { signal: listener.signal });
    if (work.type === 'video') {
      const controls = document.createElement('div');
      controls.className = 'work-player-controls';
      const play = document.createElement('button');
      play.type = 'button';
      play.textContent = 'PLAY \u25b6';
      play.setAttribute('aria-label', 'Reproducir video');
      play.addEventListener('click', () => full.paused ? full.play().catch(() => {}) : full.pause());
      const syncPlay = () => {
        play.textContent = full.paused ? 'PLAY \u25b6' : 'PAUSA \u275a\u275a';
        play.setAttribute('aria-label', full.paused ? 'Reproducir video' : 'Pausar video');
      };
      ['play', 'pause', 'ended'].forEach(name => full.addEventListener(name, syncPlay));
      const seek = document.createElement('input');
      seek.type = 'range';
      seek.className = 'work-player-seek';
      seek.min = '0'; seek.max = '100'; seek.step = '.1'; seek.value = '0';
      seek.setAttribute('aria-label', 'Posici\u00f3n del video');
      seek.disabled = true;
      full.addEventListener('loadedmetadata', () => { seek.disabled = !Number.isFinite(full.duration); });
      seek.addEventListener('input', () => {
        if (Number.isFinite(full.duration)) full.currentTime = Number(seek.value) / 100 * full.duration;
      });
      const time = document.createElement('span');
      time.className = 'work-player-time';
      const format = value => Math.floor(value / 60).toString().padStart(2, '0') + ':' + Math.floor(value % 60).toString().padStart(2, '0');
      time.textContent = '00:00 / 00:00';
      const syncTime = () => {
        const duration = Number.isFinite(full.duration) ? full.duration : 0;
        if (duration) seek.value = String(full.currentTime / duration * 100);
        time.textContent = format(full.currentTime) + ' / ' + format(duration);
      };
      full.addEventListener('timeupdate', syncTime);
      full.addEventListener('loadedmetadata', syncTime);
      const mute = document.createElement('button');
      mute.type = 'button';
      mute.textContent = 'SONIDO ON';
      mute.setAttribute('aria-label', 'Silenciar video');
      mute.addEventListener('click', () => {
        full.muted = !full.muted;
        mute.textContent = full.muted ? 'SONIDO OFF' : 'SONIDO ON';
        mute.setAttribute('aria-label', full.muted ? 'Activar sonido' : 'Silenciar video');
      });
      const expand = document.createElement('button');
      expand.type = 'button';
      expand.textContent = 'AMPLIAR \u2197';
      expand.setAttribute('aria-label', 'Pantalla completa');
      expand.addEventListener('click', () => {
        if (document.fullscreenElement === hero) document.exitFullscreen().catch(() => {});
        else hero.requestFullscreen?.().catch(() => {});
      });
      controls.append(play, seek, time, mute, expand);
      player.appendChild(controls);
    }
    portfolio.inert = true;
    if (copy) copy.inert = true;
    if (proxy) proxy.inert = true;
    document.body.classList.add('work-is-open');
    hero.appendChild(player);
    window.dispatchEvent(new Event('morlyn-work-changed'));
    back.focus({ preventScroll: true });
    if (work.type === 'video') full.play().catch(() => {});
  };
  const loadWorks = async () => {
    if (window.morlynBackend) {
      const { data, error } = await window.morlynBackend.from('portfolio_works')
        .select('title,media_type,media_path').eq('channel', channel).order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(work => ({
        title: work.title,
        type: work.media_type,
        src: window.morlynBackend.storage.from(window.MORLYN_BACKEND.bucket).getPublicUrl(work.media_path).data.publicUrl,
      }));
    }
    const response = await fetch('works.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load portfolio');
    return (await response.json())[channel] || [];
  };
  loadWorks().then(works => {
    if (!works.length) {
      for (let index = 0; index < 8; index += 1) {
        const type = index % 2 === 0 ? 'video' : 'image';
        const card = document.createElement('figure');
        card.className = 'portfolio-card portfolio-placeholder';
        const media = document.createElement('div');
        media.className = 'portfolio-placeholder-media portfolio-media-window';
        media.setAttribute('role', 'img');
        media.setAttribute('aria-label', type === 'video' ? 'Espacio reservado para un video' : 'Espacio reservado para una imagen');
        const icon = document.createElement('span');
        icon.className = 'placeholder-icon placeholder-icon-' + type;
        icon.setAttribute('aria-hidden', 'true');
        const signal = document.createElement('span');
        signal.className = 'placeholder-signal';
        signal.textContent = 'ESPACIO RESERVADO';
        const open = document.createElement('button');
        open.className = 'work-open';
        open.type = 'button';
        open.setAttribute('aria-label', 'Abrir vista de prueba: ' + (type === 'video' ? 'video' : 'imagen'));
        open.addEventListener('click', () => openWork({
          type: 'image',
          src: 'assets/works/prueba-modal.svg',
          title: 'Vista de prueba / Espacio para ' + (type === 'video' ? 'video' : 'imagen'),
          alt: 'Imagen de prueba del portfolio Morlyn Beats',
        }, open));
        card.addEventListener('click', event => { if (event.target !== open) open.click(); });
        media.append(icon, signal, open);
        const caption = document.createElement('figcaption');
        caption.textContent = String(index + 1).padStart(2, '0') + ' / ' + (type === 'video' ? 'VIDEO' : 'IMAGEN');
        card.append(media, caption);
        portfolioGrid.appendChild(card);
      }
    }
    works.forEach(work => {
      const card = document.createElement('figure');
      card.className = 'portfolio-card';
      const media = document.createElement(work.type === 'video' ? 'video' : 'img');
      media.crossOrigin = 'anonymous';
      media.src = work.src;
      if (work.type === 'video') {
        media.controls = true;
        media.playsInline = true;
        media.preload = 'metadata';
        media.setAttribute('aria-label', work.title || 'Trabajo audiovisual');
        if (work.poster) media.poster = work.poster;
      } else {
        media.alt = work.alt || work.title || '';
        media.loading = 'lazy';
      }
      const mediaWindow = document.createElement('div');
      mediaWindow.className = 'portfolio-media-window';
      mediaWindow.appendChild(media);
      const open = document.createElement('button');
      open.className = 'work-open';
      open.type = 'button';
      open.setAttribute('aria-label', 'Ver ' + (work.type === 'video' ? 'video' : 'imagen') + ': ' + (work.title || 'Trabajo'));
      open.addEventListener('click', () => openWork(work, open));
      card.addEventListener('click', event => { if (event.target !== open) open.click(); });
      mediaWindow.appendChild(open);
      card.appendChild(mediaWindow);
      if (work.title) {
        const caption = document.createElement('figcaption');
        caption.textContent = work.title;
        card.appendChild(caption);
      }
      portfolioGrid.appendChild(card);
    });
    portfolio.hidden = false;
    emptyMessage.hidden = true;
    window.dispatchEvent(new Event('morlyn-portfolio-ready'));
  }).catch(error => {
    console.error(error);
    portfolio.hidden = false;
    emptyMessage.hidden = false;
    emptyMessage.textContent = 'No pudimos cargar los trabajos. Recargá la página para volver a intentar.';
  });
}
