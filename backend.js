(() => {
  const idPattern = /^[A-Za-z0-9_-]{11}$/;
  const youtubeId = value => {
    let url;
    try { url = new URL(String(value).trim()); }
    catch { throw new Error('Pegá un enlace válido de YouTube.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Pegá un enlace válido de YouTube.');
    const host = url.hostname.toLowerCase();
    let id;
    if (host === 'youtu.be') id = url.pathname.split('/')[1];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(host)) {
      const parts = url.pathname.split('/').filter(Boolean);
      id = parts[0] === 'watch' ? url.searchParams.get('v') : ['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : null;
    }
    if (!id || !idPattern.test(id)) throw new Error('Pegá el enlace de un video de YouTube, no de un canal o una lista.');
    return id;
  };
  window.morlynYouTube = {
    id: youtubeId,
    embed: id => {
      if (!idPattern.test(id)) throw new Error('Identificador de video inválido.');
      return 'https://www.youtube-nocookie.com/embed/' + id + '?playsinline=1&rel=0';
    },
    watch: id => {
      if (!idPattern.test(id)) throw new Error('Identificador de video inválido.');
      return 'https://www.youtube.com/watch?v=' + id;
    },
    thumbnail: id => {
      if (!idPattern.test(id)) throw new Error('Identificador de video inválido.');
      return 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
    },
  };
  const config = window.MORLYN_BACKEND;
  window.morlynRememberSession = remember => {
    if (remember) localStorage.setItem('morlyn-remember', '1');
    else localStorage.removeItem('morlyn-remember');
  };
  const authStorage = {
    getItem: key => localStorage.getItem('morlyn-remember') === '1' ? localStorage.getItem(key) : sessionStorage.getItem(key),
    setItem: (key, value) => {
      const remember = localStorage.getItem('morlyn-remember') === '1';
      (remember ? localStorage : sessionStorage).setItem(key, value);
      (remember ? sessionStorage : localStorage).removeItem(key);
    },
    removeItem: key => { localStorage.removeItem(key); sessionStorage.removeItem(key); },
  };
  window.morlynBackend = config?.url && config?.publishableKey && window.supabase
    ? window.supabase.createClient(config.url, config.publishableKey, {
      auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
    : null;
  // Public-only connection. Authentication remains on the portal's own origin.
  // The separate 4173 preview can consume works from the local portal on 4174.
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const baseUrl = config?.localApiBase || (local && location.port === '4173'
    ? location.protocol + '//' + location.hostname + ':4174' : location.origin);
  window.morlynLoadLocalWorks = () => window.morlynBackend ? Promise.resolve(null)
    : fetch(baseUrl + '/api/public/media', { credentials: 'omit', cache: 'no-store' })
      .then(async response => {
        if (!response.ok) return null;
        const result = await response.json();
        return Array.isArray(result.media) ? { baseUrl, media: result.media } : null;
      }).catch(() => null);
  window.morlynLocalReady = window.morlynLoadLocalWorks();
})();
