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
const vhsStartedAt = performance.now();
const updateVhsCounter = () => {
  const now = performance.now();
  const totalSeconds = Math.floor((now - vhsStartedAt) / 1000);
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
