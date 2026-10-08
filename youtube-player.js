// Native YouTube playback with the site's own controls outside the iframe.
let apiPromise;
function loadAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const previous = window.onYouTubeIframeAPIReady;
    const fail = () => { clearTimeout(timer); script.remove(); apiPromise = null; reject(new Error('YouTube API unavailable')); };
    const timer = setTimeout(fail, 15000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      previous?.();
      resolve(window.YT);
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return apiPromise;
}

export function mountYouTubeControls({iframe, container, fullscreenTarget, status, fallbackUrl}) {
  const controls = document.createElement('div');
  controls.className = 'work-player-controls';
  const button = (text, label) => {
    const node = document.createElement('button'); node.type = 'button';
    node.textContent = text; node.setAttribute('aria-label', label); return node;
  };
  const play = button('PLAY ▶', 'Reproducir video');
  const mute = button('SONIDO ON', 'Silenciar video');
  const expand = button('AMPLIAR ↗', 'Pantalla completa');
  const seek = document.createElement('input');
  seek.type = 'range'; seek.className = 'work-player-seek';
  seek.min = '0'; seek.max = '100'; seek.step = '.1'; seek.value = '0';
  seek.setAttribute('aria-label', 'Posición del video');
  const time = document.createElement('span'); time.className = 'work-player-time'; time.textContent = '00:00 / 00:00';
  play.disabled = mute.disabled = seek.disabled = true;
  controls.append(play, seek, time, mute, expand); container.append(controls);
  let player, polling, closed = false, ready = false;
  let readyTimeout;
  const format = value => Math.floor(value / 60).toString().padStart(2, '0') + ':' + Math.floor(value % 60).toString().padStart(2, '0');
  const sync = () => {
    if (!ready || closed) return;
    const state = player.getPlayerState(), playing = state === 1 || state === 3;
    play.textContent = playing ? 'PAUSA ❚❚' : 'PLAY ▶';
    play.setAttribute('aria-label', playing ? 'Pausar video' : 'Reproducir video');
    const duration = Number(player.getDuration()) || 0, current = Number(player.getCurrentTime()) || 0;
    seek.disabled = !(Number.isFinite(duration) && duration > 0);
    if (!seek.matches(':active')) seek.value = duration > 0 ? String(current / duration * 100) : '0';
    time.textContent = format(current) + ' / ' + format(duration);
    const muted = player.isMuted();
    mute.textContent = muted ? 'SONIDO OFF' : 'SONIDO ON';
    mute.setAttribute('aria-label', muted ? 'Activar sonido' : 'Silenciar video');
  };
  const fallback = () => {
    if (closed || ready) return;
    closed = true;
    clearTimeout(readyTimeout); clearInterval(polling); controls.remove();
    const replacement = iframe.cloneNode(false); replacement.src = fallbackUrl;
    replacement.addEventListener('load', () => { status.hidden = true; });
    try { player?.destroy(); } catch {}
    player = null;
    if (iframe.isConnected) iframe.replaceWith(replacement);
    else if (container.isConnected) container.querySelector('.work-player-media').prepend(replacement);
  };
  play.addEventListener('click', () => {
    if (!ready) return;
    [1, 3].includes(player.getPlayerState()) ? player.pauseVideo() : player.playVideo();
  });
  mute.addEventListener('click', () => { if (ready) { player.isMuted() ? player.unMute() : player.mute(); sync(); } });
  seek.addEventListener('input', () => { if (ready) player.seekTo(Number(seek.value) / 100 * player.getDuration(), true); });
  expand.addEventListener('click', () => {
    if (document.fullscreenElement === fullscreenTarget) document.exitFullscreen().catch(() => {});
    else fullscreenTarget.requestFullscreen?.().catch(() => {});
  });
  readyTimeout = setTimeout(fallback, 20000);
  loadAPI().then(YT => {
    if (closed || !iframe.isConnected) return;
    player = new YT.Player(iframe, {events: {
      onReady: () => {
        if (closed) return;
        ready = true; clearTimeout(readyTimeout); status.hidden = true;
        play.disabled = mute.disabled = false; sync(); polling = setInterval(sync, 500);
      },
      onStateChange: sync,
      onError: () => { if (!closed) { status.hidden = false; status.textContent = 'No pudimos reproducir el video. Revisá que siga disponible y permita reproducción insertada.'; } },
    }});
  }).catch(fallback);
  return () => {
    closed = true; clearInterval(polling); clearTimeout(readyTimeout);
    try { player?.destroy(); } catch {}
    controls.remove();
  };
}
