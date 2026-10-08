(() => {
  const config = window.MORLYN_BACKEND;
  window.morlynBackend = config?.url && config?.publishableKey && window.supabase
    ? window.supabase.createClient(config.url, config.publishableKey, {
      auth: { storage: window.sessionStorage, persistSession: true, detectSessionInUrl: false },
    })
    : null;
})();
