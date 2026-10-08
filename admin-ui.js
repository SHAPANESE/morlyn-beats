(() => {
  const links = [...document.querySelectorAll('.dashboard-sidebar nav a')];
  const mark = link => {
    links.forEach(item => item.removeAttribute('aria-current'));
    link?.setAttribute('aria-current', 'location');
  };
  links.forEach(link => link.addEventListener('click', () => mark(link)));
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      const entry = entries.filter(item => item.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (entry) mark(links.find(link => link.hash === '#' + entry.target.id));
    }, {rootMargin: '-15% 0px -60% 0px'});
    links.forEach(link => { const panel = document.querySelector(link.hash); if (panel) observer.observe(panel); });
  }
  document.querySelectorAll('[data-password-target]').forEach(button => button.addEventListener('click', () => {
    const field = document.getElementById(button.dataset.passwordTarget);
    const reveal = field.type === 'password';
    field.type = reveal ? 'text' : 'password';
    button.textContent = reveal ? 'Ocultar' : 'Mostrar';
    button.setAttribute('aria-pressed', String(reveal));
  }));
  const counter = document.querySelector('#home-text-counter');
  const field = document.querySelector('#home-text');
  const count = () => { counter.textContent = field.value.length + ' / 600'; };
  field.addEventListener('input', count);
  window.addEventListener('morlyn-home-editor-loaded', count);
  count();
})();
