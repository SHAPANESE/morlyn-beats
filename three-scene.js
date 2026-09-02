import * as THREE from './vendor/three.module.min.js';

const canvas = document.querySelector('#three-sampler');
const stage = document.querySelector('.three-stage');

if (canvas && stage) {
  const isFirefox = navigator.userAgent.includes('Firefox');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 7.2, 8.6);
  camera.lookAt(0, 0, 0.25);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !isFirefox,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isFirefox ? 1 : 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = !isFirefox;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const ink = new THREE.MeshStandardMaterial({ color: 0x171513, roughness: 0.72, metalness: 0.08 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xefd2aa, roughness: 0.58, metalness: 0.06 });
  const padTop = new THREE.MeshStandardMaterial({ color: 0x211d1a, roughness: 0.78, metalness: 0.01 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe95c38, roughness: 0.52, metalness: 0.04 });
  const displayMaterial = new THREE.MeshStandardMaterial({
    color: 0x281713,
    emissive: 0xd94829,
    emissiveIntensity: 1.2,
    roughness: 0.28,
  });

  function roundedShape(width, depth, radius) {
    const x = -width / 2;
    const y = -depth / 2;
    const shape = new THREE.Shape();
    shape.moveTo(x + radius, y);
    shape.lineTo(x + width - radius, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + radius);
    shape.lineTo(x + width, y + depth - radius);
    shape.quadraticCurveTo(x + width, y + depth, x + width - radius, y + depth);
    shape.lineTo(x + radius, y + depth);
    shape.quadraticCurveTo(x, y + depth, x, y + depth - radius);
    shape.lineTo(x, y + radius);
    shape.quadraticCurveTo(x, y, x + radius, y);
    return shape;
  }

  function roundedBody(width, depth, height, radius, material) {
    const geometry = new THREE.ExtrudeGeometry(roundedShape(width, depth, radius), {
      depth: height,
      steps: 1,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.1,
      bevelThickness: 0.1,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -height / 2, 0);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function addEdges(mesh, color = 0x171513, opacity = 0.72) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 24),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
    );
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    mesh.parent.add(edges);
    return edges;
  }

  const sampler = new THREE.Group();
  const interactivePads = [];
  const padHitTargets = [];
  scene.add(sampler);

  const body = roundedBody(7.2, 5.15, 0.64, 0.3, cream);
  sampler.add(body);

  const topPanel = new THREE.Mesh(new THREE.BoxGeometry(6.3, 0.16, 1.12), ink);
  topPanel.position.set(0, 0.41, -1.72);
  topPanel.castShadow = true;
  sampler.add(topPanel);

  const display = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.05, 0.59), displayMaterial);
  display.position.set(-1.22, 0.52, -1.72);
  sampler.add(display);

  const displayLine = new THREE.Mesh(new THREE.BoxGeometry(2.38, 0.025, 0.035), orange);
  displayLine.position.set(-1.22, 0.555, -1.72);
  sampler.add(displayLine);

  const displayCanvas = document.createElement('canvas');
  displayCanvas.width = 512;
  displayCanvas.height = 128;
  const displayContext = displayCanvas.getContext('2d');
  const displayTexture = new THREE.CanvasTexture(displayCanvas);
  displayTexture.colorSpace = THREE.SRGBColorSpace;
  const displayReadout = new THREE.Mesh(
    new THREE.PlaneGeometry(2.58, 0.48),
    new THREE.MeshBasicMaterial({ map: displayTexture }),
  );
  displayReadout.rotation.x = -Math.PI / 2;
  displayReadout.position.set(-1.22, 0.565, -1.72);
  sampler.add(displayReadout);

  function updateDisplay(label = 'READY', number = '--') {
    displayContext.fillStyle = '#20110f';
    displayContext.fillRect(0, 0, displayCanvas.width, displayCanvas.height);
    displayContext.strokeStyle = '#7f281b';
    displayContext.lineWidth = 3;
    displayContext.strokeRect(6, 6, displayCanvas.width - 12, displayCanvas.height - 12);
    displayContext.fillStyle = '#e95c38';
    displayContext.font = 'bold 34px monospace';
    displayContext.fillText(`PAD ${number}`, 28, 48);
    displayContext.font = 'bold 27px monospace';
    displayContext.fillText(label, 28, 91);
    displayTexture.needsUpdate = true;
  }
  updateDisplay();

  for (let i = 0; i < 4; i += 1) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.18, 32), cream);
    knob.position.set(1.08 + i * 0.58, 0.59, -1.72);
    knob.castShadow = true;
    sampler.add(knob);
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.04, 0.13), orange);
    marker.position.set(knob.position.x, 0.7, -1.77);
    marker.rotation.y = i * 0.38 - 0.45;
    sampler.add(marker);
  }

  const padPositions = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      padPositions.push({ x: -2.62 + col * 0.82, z: -0.7 + row * 0.85 });
    }
  }

  padPositions.forEach(({ x, z }, index) => {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.18, 0.61), padTop.clone());
    pad.position.set(x, 0.53, z);
    pad.rotation.y = -0.015 * (index % 4);
    pad.castShadow = true;
    pad.userData.index = index;
    pad.userData.restY = pad.position.y;
    sampler.add(pad);
    interactivePads.push(pad);
    padHitTargets.push(pad);

    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.09, 0.68), ink);
    rim.position.set(x, 0.42, z);
    rim.castShadow = true;
    rim.userData.padTarget = pad;
    sampler.add(rim);
    padHitTargets.push(rim);
  });

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const control = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.13, 0.32), row === 3 ? orange : ink);
      control.position.set(1.12 + col * 0.67, 0.5, -0.48 + row * 0.62);
      control.castShadow = true;
      sampler.add(control);
    }
  }

  const wheelRim = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.1, 48), ink);
  wheelRim.position.set(2.65, 0.46, 0.72);
  wheelRim.castShadow = true;
  sampler.add(wheelRim);
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.48, 0.18, 48), cream);
  wheel.position.set(2.65, 0.58, 0.72);
  wheel.castShadow = true;
  sampler.add(wheel);

  const sideAccent = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.08, 0.15), orange);
  sideAccent.position.set(2.25, 0.46, 2.08);
  sampler.add(sideAccent);

  addEdges(body);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 7),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.3 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.48;
  shadow.receiveShadow = true;
  scene.add(shadow);

  scene.add(new THREE.HemisphereLight(0xffe4bf, 0x120d0a, 2.2));
  const key = new THREE.DirectionalLight(0xffddb5, 4.2);
  key.position.set(-3, 7, 5);
  key.castShadow = !isFirefox;
  key.shadow.mapSize.set(512, 512);
  scene.add(key);
  const rim = new THREE.PointLight(0xe95c38, 14, 14);
  rim.position.set(4, 2.8, -2);
  scene.add(rim);

  sampler.rotation.set(-0.05, -0.18, -0.035);
  const targetRotation = { x: sampler.rotation.x, y: sampler.rotation.y };

  let audioContext;
  let sampleLoadPromise;
  const sampleBuffers = new Map();
  const sampleFiles = {
    kick: './assets/samples/kick.wav',
    snare: './assets/samples/snare.wav',
    closedHat: './assets/samples/closed-hat.wav',
    openHat: './assets/samples/open-hat.wav',
    fill: './assets/samples/fill.wav',
  };
  const padVoices = [
    { sample: 'kick', rate: 1.00, gain: .92 },
    { sample: 'snare', rate: 1.00, gain: .72 },
    { sample: 'closedHat', rate: 1.08, gain: .48 },
    { sample: 'openHat', rate: .96, gain: .46 },
    { sample: 'kick', rate: .82, gain: .90 },
    { sample: 'snare', rate: .86, gain: .70 },
    { sample: 'closedHat', rate: .82, gain: .46 },
    { sample: 'fill', rate: 1.00, gain: .66 },
    { sample: 'kick', rate: 1.18, gain: .86 },
    { sample: 'snare', rate: 1.16, gain: .66 },
    { sample: 'closedHat', rate: 1.34, gain: .42 },
    { sample: 'openHat', rate: 1.16, gain: .42 },
    { sample: 'fill', rate: .74, gain: .62 },
    { sample: 'kick', rate: .66, gain: .88 },
    { sample: 'snare', rate: .72, gain: .68 },
    { sample: 'fill', rate: 1.24, gain: .58 },
  ];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function getAudioContext(shouldResume = true) {
    if (!audioContext) audioContext = new AudioContext();
    if (shouldResume && audioContext.state === 'suspended') audioContext.resume();
    return audioContext;
  }

  function loadSamples() {
    if (sampleLoadPromise) return sampleLoadPromise;
    const context = getAudioContext(false);
    sampleLoadPromise = Promise.all(Object.entries(sampleFiles).map(async ([name, path]) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Could not load ${path}`);
      const audioData = await response.arrayBuffer();
      sampleBuffers.set(name, await context.decodeAudioData(audioData));
    })).catch((error) => {
      console.warn('Sample kit unavailable; using synthesized fallback.', error);
    });
    return sampleLoadPromise;
  }

  function playLoadedSample(index) {
    const voice = padVoices[index];
    const buffer = sampleBuffers.get(voice?.sample);
    if (!voice || !buffer) return false;
    const context = getAudioContext();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = voice.rate;
    gain.gain.value = voice.gain;
    source.connect(gain).connect(context.destination);
    source.start();
    return true;
  }

  function envelope(context, gain, peak, duration, start = context.currentTime) {
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + .006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  }

  function tone(frequency, duration, type = 'sine', pitchEnd = frequency, peak = .22) {
    const context = getAudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(pitchEnd, 1), context.currentTime + duration);
    envelope(context, gain, peak, duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + .02);
  }

  function noise(duration, filterType, frequency, peak = .16) {
    const context = getAudioContext();
    const length = Math.ceil(context.sampleRate * duration);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = filterType;
    filter.frequency.value = frequency;
    envelope(context, gain, peak, duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
  }

  function playSynthFallback(index) {
    switch (index) {
      case 0: tone(155, .5, 'sine', 42, .48); break;
      case 1: noise(.22, 'highpass', 1300, .28); tone(190, .12, 'triangle', 120, .12); break;
      case 2: noise(.065, 'highpass', 6500, .18); break;
      case 3: noise(.38, 'highpass', 5400, .16); break;
      case 4: tone(130, .34, 'sine', 72, .3); break;
      case 5: tone(185, .3, 'sine', 105, .27); break;
      case 6: tone(255, .26, 'sine', 145, .24); break;
      case 7:
        noise(.12, 'bandpass', 1150, .22);
        setTimeout(() => noise(.1, 'bandpass', 1400, .14), 42);
        break;
      case 8: tone(760, .06, 'square', 520, .12); break;
      case 9: tone(540, .16, 'square', 520, .1); tone(810, .13, 'square', 760, .07); break;
      case 10: noise(.1, 'highpass', 7600, .1); break;
      case 11: noise(.75, 'highpass', 3500, .12); break;
      case 12: tone(55, .45, 'sawtooth', 48, .16); break;
      case 13: tone(130.81, .42, 'triangle', 130.81, .13); break;
      case 14: tone(164.81, .42, 'triangle', 164.81, .13); break;
      case 15: tone(196, .5, 'triangle', 196, .13); break;
      default: break;
    }
  }

  function playPad(index) {
    if (!playLoadedSample(index)) {
      loadSamples();
      playSynthFallback(index);
    }
  }

  const soundNames = [
    'KICK 19', 'SNARE 15', 'CLOSED HAT 16', 'OPEN HAT 02',
    'KICK LOW', 'SNARE LOW', 'HAT LOW', 'FILL 02',
    'KICK HIGH', 'SNARE HIGH', 'HAT HIGH', 'OPEN HAT HIGH',
    'FILL SLOW', 'KICK SUB', 'SNARE DEEP', 'FILL FAST',
  ];

  loadSamples();

  function triggerPad(pad) {
    if (!pad) return;
    const index = pad.userData.index;
    canvas.dataset.lastPad = String(index);
    updateDisplay(soundNames[index], String(index + 1).padStart(2, '0'));
    playPad(index);
    pad.position.y = pad.userData.restY - .08;
    pad.material.emissive.setHex(0xe95c38);
    pad.material.emissiveIntensity = .65;
    requestRender();
    window.setTimeout(() => {
      pad.position.y = pad.userData.restY;
      pad.material.emissive.setHex(0x000000);
      pad.material.emissiveIntensity = 0;
      requestRender();
    }, 95);
  }

  function hitPad(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(padHitTargets, false)[0]?.object;
    return hit?.userData.padTarget || hit;
  }

  stage.addEventListener('pointerdown', (event) => {
    const pad = hitPad(event);
    if (!pad) return;
    canvas.focus();
    triggerPad(pad);
  });

  stage.addEventListener('pointermove', (event) => {
    stage.style.cursor = hitPad(event) ? 'pointer' : 'default';
  });

  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive MPC with sixteen playable pads');
  const keyboardMap = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'];
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const index = keyboardMap.indexOf(event.key.toLowerCase());
    if (index >= 0) triggerPad(interactivePads[index]);
  });

  function resize() {
    const width = Math.max(stage.clientWidth, 1);
    const height = Math.max(stage.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const compact = camera.aspect < 1.48;
    camera.position.set(0, compact ? 7.8 : 7.2, compact ? 11.3 : 8.6);
    camera.lookAt(0, 0, 0.25);
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(() => {
    resize();
    requestRender();
  });
  resizeObserver.observe(stage);
  resize();

  let renderQueued = false;
  let lastPixelCapture = -Infinity;
  let pixelBuffer = null;

  function publishMpcFrame(force = false) {
    const now = performance.now();
    if (!force && now - lastPixelCapture < 72) return;

    const width = canvas.width;
    const height = canvas.height;
    const requiredLength = width * height * 4;
    if (!width || !height || !requiredLength) return;
    if (!pixelBuffer || pixelBuffer.length !== requiredLength) {
      pixelBuffer = new Uint8Array(requiredLength);
    }

    const context = renderer.getContext();
    context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixelBuffer);
    window.dispatchEvent(new CustomEvent('morlyn-mpc-frame', {
      detail: { pixels: pixelBuffer, width, height },
    }));
    lastPixelCapture = now;
  }

  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.setTimeout(() => requestAnimationFrame(render), 25);
  }

  function render() {
    renderQueued = false;
    sampler.rotation.x += (targetRotation.x - sampler.rotation.x) * 0.055;
    sampler.rotation.y += (targetRotation.y - sampler.rotation.y) * 0.055;
    renderer.render(scene, camera);

    const stillMoving =
      Math.abs(targetRotation.x - sampler.rotation.x) > .0004 ||
      Math.abs(targetRotation.y - sampler.rotation.y) > .0004;
    publishMpcFrame(!stillMoving);
    if (stillMoving) requestRender();
  }

  window.morlynMpcRenderer = {
    renderNow() {
      renderer.render(scene, camera);
      publishMpcFrame(true);
    },
  };
  requestRender();
}
