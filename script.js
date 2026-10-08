const cursor = document.querySelector('.cursor');
const isFirefox = navigator.userAgent.includes('Firefox');
document.documentElement.classList.toggle('firefox-crt', isFirefox);

window.addEventListener('pointermove', (event) => {
  cursor.style.left = `${event.clientX}px`;
  cursor.style.top = `${event.clientY}px`;
});

document.querySelectorAll('a, button').forEach((item) => {
  item.addEventListener('pointerenter', () => cursor.classList.add('big'));
  item.addEventListener('pointerleave', () => cursor.classList.remove('big'));
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add('visible');
  });
}, { threshold: 0.14 });

document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));

let characterIndex = 0;
document.querySelectorAll('.warp-title .line > span').forEach((word) => {
  const characters = [...word.textContent];
  word.textContent = '';
  word.setAttribute('aria-hidden', 'true');

  characters.forEach((character) => {
    const letter = document.createElement('span');
    letter.className = 'char';
    letter.textContent = character;
    letter.style.setProperty('--char-index', characterIndex);
    word.appendChild(letter);
    characterIndex += 1;
  });

  characterIndex += 1;
});

const distortionMap = document.createElement('canvas');
distortionMap.width = 192;
distortionMap.height = 192;
const distortionContext = distortionMap.getContext('2d');
const distortionPixels = distortionContext.createImageData(distortionMap.width, distortionMap.height);

for (let y = 0; y < distortionMap.height; y += 1) {
  for (let x = 0; x < distortionMap.width; x += 1) {
    const nx = (x / (distortionMap.width - 1)) * 2 - 1;
    const ny = (y / (distortionMap.height - 1)) * 2 - 1;
    const radius = Math.min(nx * nx + ny * ny, 1.35);
    const red = Math.max(0, Math.min(1, .5 + nx * radius * .38));
    const green = Math.max(0, Math.min(1, .5 + ny * radius * .3));
    const pixel = (y * distortionMap.width + x) * 4;
    distortionPixels.data[pixel] = Math.round(red * 255);
    distortionPixels.data[pixel + 1] = Math.round(green * 255);
    distortionPixels.data[pixel + 2] = 128;
    distortionPixels.data[pixel + 3] = 255;
  }
}

distortionContext.putImageData(distortionPixels, 0, 0);
const barrelMap = document.querySelector('#barrel-map');
barrelMap.setAttribute('href', distortionMap.toDataURL('image/png'));
const barrelDisplacement = document.querySelector('#barrel-displacement');
const resizeBarrelDistortion = () => {
  const scale = Math.min(124, Math.max(38, window.innerWidth * .073));
  barrelDisplacement?.setAttribute('scale', scale.toFixed(1));
};
resizeBarrelDistortion();
window.addEventListener('resize', resizeBarrelDistortion, { passive: true });
requestAnimationFrame(() => document.documentElement.classList.add('barrel-ready'));

const vhsTimecode = document.querySelector('#vhs-timecode');
const updateVhsCounter = () => {
  const totalSeconds = window.morlynVhsSeconds();
  if (vhsTimecode) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    vhsTimecode.textContent = [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, '0'))
      .join(':');
  }
};

updateVhsCounter();
window.setInterval(updateVhsCounter, 1000);

// Tune between real pages with a brief television static transition.
const channelOverlay = document.createElement('div');
channelOverlay.className = 'channel-transition';
channelOverlay.setAttribute('aria-hidden', 'true');
const channelNumber = document.createElement('span');
channelNumber.className = 'channel-number';
const staticCanvas = document.createElement('canvas');
staticCanvas.className = 'channel-static';
staticCanvas.width = 480;
staticCanvas.height = 270;
const channelOsd = document.createElement('canvas');
channelOsd.className = 'channel-osd';
channelOsd.width = 480;
channelOsd.height = 270;
const osdContext = channelOsd.getContext('2d');
const channelGhost = document.createElement('img');
channelGhost.className = 'channel-ghost';
channelGhost.alt = '';
channelGhost.hidden = true;
channelOverlay.append(channelGhost, staticCanvas, channelOsd, channelNumber);
document.body.appendChild(channelOverlay);
// Keep the CRT silhouette fixed above both pages and tuning static. The mask
// follows the same rounded-screen and barrel bounds as crt-pipeline.js.
const crtFrame = document.createElement('canvas');
crtFrame.className = 'crt-frame';
crtFrame.setAttribute('aria-hidden', 'true');
document.body.appendChild(crtFrame);
const frameContext = crtFrame.getContext('2d');
const resizeCrtFrame = () => {
  if (!frameContext) return;
  crtFrame.width = Math.max(1, Math.round(window.innerWidth));
  crtFrame.height = Math.max(1, Math.round(window.innerHeight));
  const mask = frameContext.createImageData(crtFrame.width, crtFrame.height);
  for (let y = 0; y < crtFrame.height; y += 1) {
    const cy = (y + .5) / crtFrame.height * 2 - 1;
    for (let x = 0; x < crtFrame.width; x += 1) {
      const cx = (x + .5) / crtFrame.width * 2 - 1;
      const curve = 1 + (cx * cx + cy * cy) * .115;
      const dx = Math.abs(cx) - .985 + .135;
      const dy = Math.abs(cy) - .975 + .135;
      const roundedDistance = Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - .135;
      if (roundedDistance > 0 || Math.abs(cx * curve) > 1 || Math.abs(cy * curve) > 1) {
        const offset = (y * crtFrame.width + x) * 4;
        mask.data[offset] = 1;
        mask.data[offset + 1] = 1;
        mask.data[offset + 2] = 1;
        mask.data[offset + 3] = 255;
      }
    }
  }
  frameContext.putImageData(mask, 0, 0);
};
resizeCrtFrame();
window.addEventListener('resize', resizeCrtFrame, { passive: true });
const channelIdent = document.createElement('div');
channelIdent.className = 'channel-ident';
channelIdent.setAttribute('aria-hidden', 'true');
document.body.appendChild(channelIdent);
const reducedChannelMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const channelTransitionMs = 500;
const channelPhaseMs = channelTransitionMs / 2;
let changingChannel = false;
let arrivalTimeout;
let identTimeout;
let noiseFrame;
const staticContext = staticCanvas.getContext('2d');
const staticPixels = staticContext?.createImageData(staticCanvas.width, staticCanvas.height);
let previousNoiseFrame = 0;
let tuningStartedAt = Date.now();
const paintStatic = (now) => {
  if (!channelOverlay.classList.contains('is-active') || reducedChannelMotion.matches) return;
  if (staticPixels && now - previousNoiseFrame >= 33) {
    previousNoiseFrame = now;
    const progress = Math.min(1, (Date.now() - tuningStartedAt) / channelTransitionMs);
    const sweep = -30 + progress * (staticCanvas.height + 60);
    for (let y = 0; y < staticCanvas.height; y += 1) {
      const distance = Math.abs(y - sweep);
      const band = Math.max(0, 1 - distance / 14) * 65;
      const row = Math.random() * 20;
      for (let x = 0; x < staticCanvas.width; x += 1) {
        const offset = (y * staticCanvas.width + x) * 4;
        const value = Math.min(220, Math.random() * 105 + row + band);
        staticPixels.data[offset] = value;
        staticPixels.data[offset + 1] = value * .89;
        staticPixels.data[offset + 2] = value * .74;
        staticPixels.data[offset + 3] = 255;
      }
    }
    staticContext.putImageData(staticPixels, 0, 0);
    if (osdContext) {
      const rect = channelNumber.getBoundingClientRect();
      const style = getComputedStyle(channelNumber);
      osdContext.setTransform(1, 0, 0, 1, 0, 0);
      osdContext.clearRect(0, 0, channelOsd.width, channelOsd.height);
      osdContext.setTransform(channelOsd.width / innerWidth, 0, 0, channelOsd.height / innerHeight, 0, 0);
      osdContext.font = style.font;
      osdContext.textBaseline = 'top';
      osdContext.fillStyle = '#efd2aa';
      osdContext.shadowColor = 'rgba(233, 92, 56, .4)';
      osdContext.shadowBlur = 4;
      osdContext.fillText(channelNumber.textContent, rect.left, rect.top);
    }
  }
  noiseFrame = requestAnimationFrame(paintStatic);
};
const showChannel = (number, snapshot, startedAt = Date.now()) => {
  tuningStartedAt = startedAt;
  channelGhost.hidden = !snapshot;
  if (snapshot) channelGhost.src = snapshot;
  channelNumber.textContent = 'CH ' + number;
  channelOverlay.classList.remove('is-arriving');
  channelOverlay.classList.add('is-active');
  cancelAnimationFrame(noiseFrame);
  noiseFrame = requestAnimationFrame(paintStatic);
};
const finishTuning = () => {
  channelOverlay.classList.add('is-arriving');
  document.documentElement.classList.add('signal-lock');
  channelIdent.textContent = 'CH ' + (document.body.dataset.channel || '00');
  channelIdent.classList.add('is-visible');
  arrivalTimeout = window.setTimeout(() => {
    channelOverlay.classList.remove('is-active', 'is-arriving');
    document.documentElement.classList.remove('signal-lock');
    cancelAnimationFrame(noiseFrame);
  }, reducedChannelMotion.matches ? 50 : channelPhaseMs);
  identTimeout = window.setTimeout(() => channelIdent.classList.remove('is-visible'), 800);
};
try {
  const storedChange = sessionStorage.getItem('morlyn-channel-change');
  if (storedChange) {
    sessionStorage.removeItem('morlyn-channel-change');
    let change;
    try { change = JSON.parse(storedChange); } catch {}
    document.documentElement.classList.add('channel-arrival');
    showChannel(document.body.dataset.channel || '00', change?.snapshot, change?.startedAt);
    requestAnimationFrame(() => { if (!changingChannel) finishTuning(); });
  }
} catch {}

document.querySelectorAll('.channel-link').forEach((link) => {
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (changingChannel) return;
    changingChannel = true;
    window.clearTimeout(arrivalTimeout);
    window.clearTimeout(identTimeout);
    channelIdent.classList.remove('is-visible');
    document.documentElement.classList.remove('signal-lock');
    document.documentElement.classList.add('signal-cut');
    let snapshot;
    if (!reducedChannelMotion.matches) {
      try { snapshot = window.morlynCaptureCrt?.(); } catch {}
    }
    const startedAt = Date.now();
    showChannel(link.dataset.channel, snapshot, startedAt);
    try {
      sessionStorage.setItem('morlyn-channel-change', JSON.stringify({ startedAt, snapshot }));
    } catch {
      try { sessionStorage.setItem('morlyn-channel-change', '1'); } catch {}
    }
    const destination = new URL(link.href);
    destination.searchParams.set('tv-start', String(window.morlynVhsStartedAt));
    window.setTimeout(() => window.location.assign(destination.href), reducedChannelMotion.matches ? 50 : channelPhaseMs);
  });
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    changingChannel = false;
    channelOverlay.classList.remove('is-active', 'is-arriving');
    channelIdent.classList.remove('is-visible');
    document.documentElement.classList.remove('signal-cut', 'signal-lock');
    window.clearTimeout(arrivalTimeout);
    window.clearTimeout(identTimeout);
    cancelAnimationFrame(noiseFrame);
  }
});
