// Read the tape origin before the page paints. Carry it through navigation
// as well as session storage so the clock survives a recreated browser view.
(() => {
  const now = Date.now();
  const valid = value => Number.isFinite(value) && value > 0 && value <= now;
  const carriedStart = Number(new URL(location.href).searchParams.get('tv-start'));
  let savedStart = 0;
  try { savedStart = Number(sessionStorage.getItem('morlyn-vhs-started-at')); } catch {}
  const startedAt = valid(carriedStart) ? carriedStart : valid(savedStart) ? savedStart : now;
  try { sessionStorage.setItem('morlyn-vhs-started-at', String(startedAt)); } catch {}
  window.morlynVhsStartedAt = startedAt;
  window.morlynVhsSeconds = () => Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
})();
