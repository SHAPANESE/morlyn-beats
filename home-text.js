(() => {
  const node = document.querySelector('.hero-description');
  const backend = window.morlynBackend;
  if (!node || !backend) return;
  let loading = false;
  const fit = () => {
    if (!node.textContent) return;
    node.style.fontSize = '';
    let size = parseFloat(getComputedStyle(node).fontSize);
    const minimum = matchMedia('(max-width: 800px) and (orientation: portrait)').matches ? 16 : 10;
    while (node.scrollHeight > node.clientHeight + 1 && size > minimum) {
      size -= 1;
      node.style.fontSize = size + 'px';
    }
    window.dispatchEvent(new Event('morlyn-home-text-changed'));
  };
  const refresh = async () => {
    if (loading) return;
    loading = true;
    try {
      const result = await backend.from('portfolio_site_content').select('body').eq('id', 'home').maybeSingle();
      if (result.error) return;
      node.textContent = result.data?.body || '';
      node.scrollTop = 0;
      fit();
      window.dispatchEvent(new Event('morlyn-home-text-changed'));
    } catch { /* Keep the last visible text during temporary connection failures. */ }
    finally { loading = false; }
  };
  const updates = 'BroadcastChannel' in window ? new BroadcastChannel('morlyn-portfolio-updates') : null;
  updates?.addEventListener('message', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('resize', fit);
  document.fonts?.ready.then(fit);
  refresh();
})();
