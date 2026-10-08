/*
 * Single-pass CRT compositor for Ramiro Lynn.
 * The curvature, rounded-screen SDF and lightweight bloom approach are adapted
 * from RetroZone's MIT-licensed CRT shader. See vendor/RETROZONE-LICENSE.txt.
 */

const output = document.querySelector('#crt-output');
if (output) {
  const gl = output.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });

  if (gl) {
    const vertexSource = `
      attribute vec2 a_position;
      attribute vec2 a_uv;
      varying vec2 v_uv;

      void main() {
        v_uv = a_uv;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fragmentSource = `
      precision mediump float;

      uniform sampler2D u_texture;
      uniform vec2 u_screen_resolution;
      uniform float u_noise_phase;
      uniform float u_flicker;
      varying vec2 v_uv;

      float hash(vec2 p) {
        p = fract(p * vec2(0.1031, 0.11369));
        p += dot(p, p.yx + 19.19);
        return fract(p.x * p.y);
      }

      vec2 curveUV(vec2 uv) {
        vec2 c = uv * 2.0 - 1.0;
        c *= 1.0 + dot(c, c) * 0.115;
        return c * 0.5 + 0.5;
      }

      float roundedRectSDF(vec2 uv, vec2 size, float radius) {
        vec2 d = abs(uv - 0.5) * 2.0 - size + radius;
        return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - radius;
      }

      vec3 sampleSource(vec2 uv) {
        return texture2D(u_texture, uv).rgb;
      }

      void main() {
        vec2 screenUV = v_uv;

        if (roundedRectSDF(screenUV, vec2(0.985, 0.975), 0.135) > 0.0) {
          gl_FragColor = vec4(0.004, 0.004, 0.004, 1.0);
          return;
        }

        vec2 uv = curveUV(screenUV);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          gl_FragColor = vec4(0.004, 0.004, 0.004, 1.0);
          return;
        }

        vec2 texel = 1.0 / u_screen_resolution;
        vec3 color = sampleSource(uv);

        // Horizontal phosphor glow: three texture reads instead of five.
        vec3 bloom = color * 0.52;
        bloom += sampleSource(uv + vec2(texel.x * 2.4, 0.0)) * 0.24;
        bloom += sampleSource(uv - vec2(texel.x * 2.4, 0.0)) * 0.24;
        color += max(bloom - 0.34, 0.0) * 0.62;

        float horizontalRow = fract(uv.y * u_screen_resolution.y * 0.34);
        float scanline = mix(0.82, 1.0, smoothstep(0.10, 0.62, horizontalRow));
        color *= scanline;

        vec2 center = screenUV * 2.0 - 1.0;
        float edge = smoothstep(0.38, 1.18, dot(center, center));
        color *= 1.0 - edge * 0.30;

        float grain = hash(gl_FragCoord.xy + u_noise_phase) - 0.5;
        color += grain * 0.026;

        color *= 1.0 + u_flicker;
        color *= vec3(1.10, 1.065, 1.01);
        color = pow(max(color, vec3(0.0)), vec3(0.84));
        color = (color - 0.5) * 1.03 + 0.5;

        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
      }
    `;

    const compileShader = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || 'CRT shader compilation failed');
      }
      return shader;
    };

    const createProgram = () => {
      const program = gl.createProgram();
      gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexSource));
      gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentSource));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'CRT shader link failed');
      }
      return program;
    };

    try {
      const program = createProgram();
      const positionLocation = gl.getAttribLocation(program, 'a_position');
      const uvLocation = gl.getAttribLocation(program, 'a_uv');
      const textureLocation = gl.getUniformLocation(program, 'u_texture');
      const screenResolutionLocation = gl.getUniformLocation(program, 'u_screen_resolution');
      const noisePhaseLocation = gl.getUniformLocation(program, 'u_noise_phase');
      const flickerLocation = gl.getUniformLocation(program, 'u_flicker');

      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 0, 0,
         1, -1, 1, 0,
        -1,  1, 0, 1,
         1,  1, 1, 1,
      ]), gl.STATIC_DRAW);

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

      const source = document.createElement('canvas');
      const sourceContext = source.getContext('2d', { alpha: false });
      const isFirefox = navigator.userAgent.includes('Firefox');
      let renderScale = 1;
      let qualityScale = 1;
      try {
        const storedQuality = Number(sessionStorage.getItem('morlyn-crt-quality'));
        if (storedQuality >= .7 && storedQuality <= 1) qualityScale = storedQuality;
      } catch {}
      let lastQualityChange = performance.now();
      let lastRenderedAt = 0;
      let qualitySamples = [];
      let viewportWidth = 1;
      let viewportHeight = 1;
      let layout = null;
      let rectCache = new WeakMap();
      let fontCache = new WeakMap();
      let playerControlLayout = null;
      let sourceDirty = true;
      let sourceNeedsUpload = true;
      let lastSourceKey = '';
      let titleCharacterCount = 0;
      let textureWidth = 0;
      let textureHeight = 0;
      const startTime = performance.now();
      const flickerLeadIn = 3.6;
      const flickerPeriod = 4.8;
      const flickerDuration = 0.62;

      const getFlickerState = (elapsed) => {
        if (elapsed < flickerLeadIn) return { active: false, cycle: -1, phase: 1, alpha: 1 };
        const runningTime = elapsed - flickerLeadIn;
        const cycle = Math.floor(runningTime / flickerPeriod);
        const phase = runningTime - cycle * flickerPeriod;
        if (phase >= flickerDuration) return { active: false, cycle, phase, alpha: 1 };

        let alpha = 1;
        if (phase < 0.055) alpha = 0.42;
        else if (phase < 0.105) alpha = 0.96;
        else if (phase < 0.165) alpha = 0.52;
        else if (phase < 0.225) alpha = 1;
        else if (phase < 0.285) alpha = 0.64;
        else if (phase < 0.335) alpha = 0.9;
        else if (phase < 0.45) alpha = 0.72;
        else if (phase < 0.53) alpha = 0.94;
        return { active: true, cycle, phase, alpha };
      };

      const rectOf = (target) => {
        const node = typeof target === 'string' ? document.querySelector(target) : target;
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const heroTop = document.querySelector('.hero').getBoundingClientRect().top;
        return { left: rect.left, right: rect.right, top: rect.top - heroTop, bottom: rect.bottom - heroTop, width: rect.width, height: rect.height };
      };

      const cachedRectOf = target => {
        const node = typeof target === 'string' ? document.querySelector(target) : target;
        if (!node) return null;
        if (!rectCache.has(node)) rectCache.set(node, rectOf(node));
        return rectCache.get(node);
      };
      const invalidateSource = () => { sourceDirty = true; };

      let actionHit;
      let portfolioNeedsAlignment = true;
      const screenPoint = (x, y) => {
        const cx = x / viewportWidth * 2 - 1;
        const cy = y / viewportHeight * 2 - 1;
        const radius = cx * cx + cy * cy;
        let scale = 1;
        for (let step = 0; step < 6; step += 1) {
          scale -= (scale + .115 * radius * scale ** 3 - 1) / (1 + .345 * radius * scale ** 2);
        }
        return { x: (cx * scale + 1) * viewportWidth / 2, y: (cy * scale + 1) * viewportHeight / 2 };
      };
      const alignPortfolioCards = () => {
        const cards = [...document.querySelectorAll('.portfolio-card')];
        cards.forEach(card => { card.style.transform = 'none'; });
        const rects = cards.map(rectOf);
        const mediaRects = cards.map(card => rectOf(card.querySelector('.portfolio-media-window')));
        const captionRects = cards.map(card => rectOf(card.querySelector('figcaption')));
        cards.forEach((card, index) => {
          const rect = rects[index];
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const center = screenPoint(x, y);
          const dx = screenPoint(x + 1, y);
          const dy = screenPoint(x, y + 1);
          const a = dx.x - center.x;
          const b = dx.y - center.y;
          const c = dy.x - center.x;
          const d = dy.y - center.y;
          card.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${center.x - x}, ${center.y - y})`;
          card.crtLayout = { rect, media: mediaRects[index], caption: captionRects[index] };
        });
        portfolioNeedsAlignment = false;
        rectCache = new WeakMap();
        sourceDirty = true;
      };
      const updateActionHit = () => {
        if (!actionHit || !layout?.instagram.node) return;
        const originalRect = rectOf(layout.instagram.node);
        const touchPadding = viewportWidth <= 800 ? 10 : 0;
        const rect = { ...originalRect, left: originalRect.left - touchPadding, right: originalRect.right + touchPadding,
          top: originalRect.top - touchPadding, bottom: originalRect.bottom + touchPadding,
          width: originalRect.width + touchPadding * 2, height: originalRect.height + touchPadding * 2 };
        const points = [];
        // Sample the entire edge: a CRT turns straight source edges into arcs.
        for (let step = 0; step <= 12; step += 1) {
          points.push(screenPoint(rect.left + rect.width * step / 12, rect.top));
        }
        for (let step = 0; step <= 12; step += 1) {
          points.push(screenPoint(rect.right - rect.width * step / 12, rect.bottom));
        }
        const left = Math.min(...points.map(point => point.x));
        const top = Math.min(...points.map(point => point.y));
        actionHit.style.left = `${left}px`;
        actionHit.style.top = `${top}px`;
        actionHit.style.width = `${Math.max(...points.map(point => point.x)) - left}px`;
        actionHit.style.height = `${Math.max(...points.map(point => point.y)) - top}px`;
        actionHit.style.clipPath = `polygon(${points.map(point => `${point.x - left}px ${point.y - top}px`).join(',')})`;
      };
      const prepareActionHit = () => {
        const original = layout.instagram.node;
        if (!original) return;
        actionHit = document.createElement('a');
        actionHit.className = 'crt-action-hit';
        actionHit.href = original.href;
        if (original.target) actionHit.target = original.target;
        if (original.rel) actionHit.rel = original.rel;
        actionHit.setAttribute('aria-label', original.textContent.trim());
        actionHit.addEventListener('click', event => {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          original.click();
        });
        original.tabIndex = -1;
        original.setAttribute('aria-hidden', 'true');
        original.style.pointerEvents = 'none';
        document.querySelector('.hero').appendChild(actionHit);
        updateActionHit();
      };

      const readLayout = () => {
        titleCharacterCount = [...document.querySelectorAll('.hero-title .line')].reduce((count, node) => count + node.textContent.trim().length + 1, 0);
        layout = {
          eyebrow: { node: document.querySelector('.eyebrow'), rect: rectOf('.eyebrow') },
          title: document.querySelectorAll('.hero-title .line'),
          services: [...document.querySelectorAll('.service-index li')],
          instagram: { node: document.querySelector('.primary-action'), rect: rectOf('.primary-action') },
          japanese: { node: document.querySelector('.jp-mark'), rect: rectOf('.jp-mark') },
          play: rectOf('.vhs-play'),
          speed: rectOf('.vhs-speed'),
          timecode: rectOf('.vhs-timecode'),
          portfolioLink: { node: document.querySelector('.portfolio-link'), rect: rectOf('.portfolio-link') },
          description: { node: document.querySelector('.hero-description'), rect: rectOf('.hero-description') },
        };
      };

      const resize = () => {
        viewportWidth = Math.max(window.innerWidth, 1);
        viewportHeight = Math.max(window.innerHeight, 1);
        // Keep the CRT render budget bounded on large monitors; its silhouette
        // and scanlines still use CSS screen dimensions, independent of this scale.
        renderScale = Math.min(isFirefox ? .7 : 1,
          1600 / Math.max(viewportWidth, viewportHeight),
          Math.sqrt(1200000 / (viewportWidth * viewportHeight))) * qualityScale;
        rectCache = new WeakMap();
        fontCache = new WeakMap();
        playerControlLayout = null;
        sourceDirty = true;
        output.width = Math.max(1, Math.round(viewportWidth * renderScale));
        output.height = Math.max(1, Math.round(viewportHeight * renderScale));
        source.width = output.width;
        source.height = output.height;
        textureWidth = 0;
        textureHeight = 0;
        gl.viewport(0, 0, output.width, output.height);
        readLayout();
        portfolioNeedsAlignment = true;
        updateActionHit();
      };

      const cssFont = (node, fallback = 'DM Mono') => {
        if (node && fontCache.has(node)) return fontCache.get(node);
        const computed = node ? getComputedStyle(node) : null;
        const style = computed ? Object.fromEntries(['fontSize', 'fontWeight', 'fontFamily', 'fontStyle', 'color', 'lineHeight', 'paddingLeft', 'paddingTop'].map(key => [key, computed[key]])) : null;
        const size = style ? parseFloat(style.fontSize) : 10;
        const weight = style?.fontWeight || '500';
        const family = style?.fontFamily || fallback;
        const result = { style, size, font: `${style?.fontStyle || 'normal'} ${weight} ${size}px ${family}` };
        if (node) fontCache.set(node, result);
        return result;
      };

      const drawTrackedText = (context, text, x, y, tracking) => {
        let cursorX = x;
        for (const character of text) {
          context.fillText(character, cursorX, y);
          cursorX += context.measureText(character).width + tracking;
        }
      };

      const trackedWidth = (context, text, tracking) => {
        const characters = [...text];
        return characters.reduce((width, character) => width + context.measureText(character).width, 0)
          + Math.max(0, characters.length - 1) * tracking;
      };

      const drawFlickeringTitle = (context, text, x, y, tracking, elapsed, offset) => {
        const flicker = getFlickerState(elapsed);
        const flickerFrame = Math.floor(flicker.phase * 30);
        let cursorX = x;

        [...text].forEach((character, index) => {
          const letterNoise = Math.abs(
            Math.sin((index + offset + 1) * 78.233 + flickerFrame * 4.173) * 43758.5453,
          ) % 1;
          const letterDropout = flicker.active && letterNoise < 0.16 ? 0.58 : 1;
          context.globalAlpha = Math.max(0.35, flicker.alpha * letterDropout);
          context.fillText(character, cursorX, y);
          cursorX += context.measureText(character).width + tracking;
        });
        context.globalAlpha = 1;
      };

      const drawTitle = (elapsed) => {
        const title = document.querySelector('.hero-title');
        if (!title) return;
        const { size, font } = cssFont(title, 'Barlow Condensed');
        sourceContext.font = font;
        sourceContext.textBaseline = 'top';
        sourceContext.fillStyle = '#ffe5bd';
        sourceContext.shadowColor = 'rgba(233, 92, 56, .72)';
        sourceContext.shadowBlur = 3;
        sourceContext.shadowOffsetX = 4;
        sourceContext.shadowOffsetY = 5;

        const visibleCharacters = viewportWidth <= 800 || document.documentElement.classList.contains('channel-arrival')
          ? Infinity : Math.max(0, Math.floor((elapsed - 0.22) / 0.075));
        let characterOffset = 0;
        [...layout.title].forEach((line) => {
          const rect = cachedRectOf(line);
          const fullText = line.textContent.trim();
          const localVisible = Math.max(0, Math.min(fullText.length, visibleCharacters - characterOffset));
          const visibleText = fullText.slice(0, localVisible);
          const tracking = size * 0.055;
          const width = Math.max(trackedWidth(sourceContext, fullText, tracking), 1);
          const scaleX = rect.width / width;

          sourceContext.save();
          sourceContext.translate(rect.left, rect.top);
          sourceContext.scale(scaleX, 1);
          drawFlickeringTitle(sourceContext, visibleText, 0, 0, tracking, elapsed, characterOffset);
          sourceContext.restore();
          characterOffset += fullText.length + 1;
        });

        sourceContext.shadowColor = 'transparent';
        sourceContext.shadowBlur = 0;
        sourceContext.shadowOffsetX = 0;
        sourceContext.shadowOffsetY = 0;
      };

      const drawLabel = (node, rect, text = node?.textContent?.trim(), options = {}) => {
        if (!node || node.hidden || !rect || !rect.width || !rect.height || !text) return;
        const { style, size, font } = cssFont(node);
        sourceContext.font = font;
        sourceContext.textBaseline = 'top';
        sourceContext.textAlign = options.align || 'left';
        sourceContext.fillStyle = options.color || style?.color || '#efd2aa';
        sourceContext.shadowColor = options.glow || 'rgba(255, 225, 185, .32)';
        sourceContext.shadowBlur = options.blur ?? 4;
        const x = options.align === 'right' ? rect.right : rect.left;
        drawTrackedText(sourceContext, text, x, rect.top, size * (options.tracking ?? 0.08));
        sourceContext.textAlign = 'left';
        sourceContext.shadowColor = 'transparent';
        sourceContext.shadowBlur = 0;
      };

      const drawWorkCards = () => {
        const grid = document.querySelector('.portfolio-grid');
        if (!grid) return;
        const gridRect = cachedRectOf(grid);
        sourceContext.save();
        sourceContext.beginPath();
        sourceContext.rect(gridRect.left, gridRect.top, gridRect.width, gridRect.height);
        sourceContext.clip();
        [...grid.querySelectorAll('.portfolio-card')].forEach((card, index) => {
          const bounds = card.crtLayout;
          if (!bounds?.media || bounds.rect.bottom < gridRect.top || bounds.rect.top > gridRect.bottom) return;
          const rect = bounds.media;
          const media = card.querySelector('img, video');
          const active = !!card.querySelector('.work-open') && (card.matches(':hover') || card.contains(document.activeElement));
          const video = media?.tagName === 'VIDEO' || !!card.querySelector('.placeholder-icon-video');
          sourceContext.save();
          sourceContext.beginPath();
          sourceContext.roundRect(rect.left, rect.top, rect.width, rect.height, 8);
          sourceContext.clip();
          sourceContext.fillStyle = 'rgba(239, 210, 170, .025)';
          sourceContext.fillRect(rect.left, rect.top, rect.width, rect.height);
          const ready = media?.tagName === 'IMG' ? media.complete && media.naturalWidth : media?.readyState >= 2;
          if (ready) {
            const width = media.naturalWidth || media.videoWidth;
            const height = media.naturalHeight || media.videoHeight;
            const scale = Math.max(rect.width / width, rect.height / height);
            sourceContext.drawImage(media, rect.left + (rect.width - width * scale) / 2, rect.top + (rect.height - height * scale) / 2, width * scale, height * scale);
          } else {
            const compact = rect.height < 72;
            const padding = compact ? 10 : Math.max(12, rect.width * .065);
            const backdrop = sourceContext.createLinearGradient(rect.left, rect.top, rect.right, rect.bottom);
            backdrop.addColorStop(0, 'rgba(239, 210, 170, .055)');
            backdrop.addColorStop(.6, 'rgba(239, 210, 170, .015)');
            backdrop.addColorStop(1, 'rgba(233, 92, 56, .07)');
            sourceContext.fillStyle = backdrop;
            sourceContext.fillRect(rect.left, rect.top, rect.width, rect.height);
            sourceContext.textBaseline = 'alphabetic';
            sourceContext.textAlign = 'right';
            sourceContext.font = `italic 900 ${rect.height * .98}px "Barlow Condensed", sans-serif`;
            sourceContext.strokeStyle = 'rgba(233, 92, 56, .22)';
            sourceContext.lineWidth = 1;
            sourceContext.strokeText(String(index + 1).padStart(2, '0'), rect.right + 4, rect.bottom + rect.height * .08);
            sourceContext.textAlign = 'left';
            sourceContext.fillStyle = '#e95c38';
            sourceContext.fillRect(rect.left + padding, rect.top + padding, 24, 2);
            sourceContext.font = `500 ${Math.max(7, Math.min(9, rect.width * .03))}px "DM Mono", monospace`;
            sourceContext.fillStyle = 'rgba(239, 210, 170, .55)';
            if (!compact) sourceContext.fillText('RAMIRO / ARCHIVO', rect.left + padding + 32, rect.top + padding + 4);
            sourceContext.font = `italic 900 ${Math.min(rect.height * (compact ? .45 : .38), rect.width * .18)}px "Barlow Condensed", sans-serif`;
            const label = video ? 'VIDEO' : 'IMAGEN';
            const x = rect.left + padding;
            const y = rect.top + rect.height * (compact ? .76 : .65);
            sourceContext.fillStyle = 'rgba(233, 92, 56, .65)';
            sourceContext.fillText(label, x + 2, y + 2);
            sourceContext.fillStyle = '#efd2aa';
            sourceContext.shadowColor = 'rgba(239, 210, 170, .25)';
            sourceContext.shadowBlur = 3;
            sourceContext.fillText(label, x, y);
            sourceContext.shadowBlur = 0;
            sourceContext.font = `400 ${Math.max(7, Math.min(9, rect.width * .03))}px "DM Mono", monospace`;
            sourceContext.fillStyle = 'rgba(239, 210, 170, .45)';
            if (!compact) sourceContext.fillText('PROXIMAMENTE', x, rect.bottom - padding);
          }
          if ((media && video) || active) {
            sourceContext.fillStyle = 'rgba(0, 0, 0, .55)';
            sourceContext.fillRect(rect.left, rect.bottom - 30, rect.width, 30);
            sourceContext.font = '500 10px "DM Mono", monospace';
            sourceContext.textBaseline = 'middle';
            sourceContext.fillStyle = active ? '#e95c38' : '#efd2aa';
            sourceContext.fillText(!media ? 'VER PRUEBA \u2197' : video ? 'REPRODUCIR \u25b6' : 'ABRIR IMAGEN \u2197', rect.left + 12, rect.bottom - 15);
          }
          sourceContext.restore();
          const caption = card.querySelector('figcaption');
          if (caption && bounds.caption) {
            const { style, font, size } = cssFont(caption);
            const paddingTop = parseFloat(style.paddingTop) || 0;
            let text = caption.textContent.trim();
            sourceContext.font = font;
            if (trackedWidth(sourceContext, text, size * .08) > bounds.caption.width) {
              const ellipsis = '\u2026';
              let width = sourceContext.measureText(ellipsis).width;
              let shortened = '';
              for (const character of text) {
                const advance = sourceContext.measureText(character).width + size * .08;
                if (width + advance > bounds.caption.width) break;
                width += advance;
                shortened += character;
              }
              text = shortened + ellipsis;
            }
            drawLabel(caption, { ...bounds.caption, top: bounds.caption.top + paddingTop }, text, { tracking: .08, blur: 3, color: active ? '#e95c38' : undefined });
          }
        });
        sourceContext.restore();
      };

      const drawPortfolio = () => {
        const portfolio = document.querySelector('.section-works');
        if (!portfolio || portfolio.hidden) return;
        drawWorkCards();
        const kicker = portfolio.querySelector('.portfolio-kicker');
        const heading = portfolio.querySelector('h2');
        drawLabel(kicker, cachedRectOf(kicker), undefined, { color: '#e95c38', tracking: 0.16 });
        drawLabel(heading, cachedRectOf(heading), undefined, { tracking: 0.12 });

        const empty = portfolio.querySelector('.portfolio-empty');
        if (!empty || empty.hidden) return;
        const rect = cachedRectOf(empty);
        const { style, size, font } = cssFont(empty);
        const paddingX = parseFloat(style.paddingLeft) || 0;
        const paddingY = parseFloat(style.paddingTop) || 0;
        const lineHeight = parseFloat(style.lineHeight) || size * 1.8;
        sourceContext.save();
        sourceContext.strokeStyle = 'rgba(233, 92, 56, .45)';
        sourceContext.lineWidth = 1;
        sourceContext.shadowColor = 'rgba(233, 92, 56, .35)';
        sourceContext.shadowBlur = 4;
        sourceContext.strokeRect(rect.left, rect.top, rect.width, rect.height);
        sourceContext.font = font;
        sourceContext.textBaseline = 'top';
        sourceContext.fillStyle = '#efd2aa';
        sourceContext.shadowColor = 'rgba(255, 225, 185, .4)';
        let line = '';
        let y = rect.top + paddingY;
        empty.textContent.trim().split(/\s+/).forEach((word) => {
          const next = line ? line + ' ' + word : word;
          if (line && sourceContext.measureText(next).width > rect.width - paddingX * 2) {
            sourceContext.fillText(line, rect.left + paddingX, y);
            y += lineHeight;
            line = word;
          } else line = next;
        });
        if (line) sourceContext.fillText(line, rect.left + paddingX, y);
        sourceContext.restore();
      };

      const drawWorkPlayer = player => {
        const area = cachedRectOf(player.querySelector('.work-player-media'));
        const media = player.querySelector('img, video');
        const ready = media.tagName === 'IMG' ? media.complete && media.naturalWidth : media.readyState >= 2;
        if (ready) {
          const width = media.naturalWidth || media.videoWidth;
          const height = media.naturalHeight || media.videoHeight;
          const scale = Math.min(area.width / width, area.height / height);
          sourceContext.save();
          sourceContext.beginPath();
          sourceContext.rect(area.left, area.top, area.width, area.height);
          sourceContext.clip();
          sourceContext.drawImage(media, area.left + (area.width - width * scale) / 2, area.top + (area.height - height * scale) / 2, width * scale, height * scale);
          sourceContext.restore();
        }
        for (const selector of ['.work-player-kicker', '.work-player-title', '.work-player-status', '.work-player-time']) {
          const node = player.querySelector(selector);
          if (!node || node.hidden) continue;
          const rect = cachedRectOf(node);
          sourceContext.save();
          sourceContext.beginPath();
          sourceContext.rect(rect.left, rect.top, rect.width, rect.height);
          sourceContext.clip();
          drawLabel(node, rect, undefined, { tracking: selector === '.work-player-title' ? .02 : selector === '.work-player-time' ? 0 : .08 });
          sourceContext.restore();
        }
        const controls = [...player.querySelectorAll('button, input')];
        const key = controls.filter(node => node.tagName === 'BUTTON').map(node => node.textContent).join('|');
        if (playerControlLayout?.player !== player || playerControlLayout.key !== key) {
          controls.forEach(node => { node.style.transform = 'none'; });
          const rects = controls.map(rectOf);
          controls.forEach((node, index) => {
            const rect = rects[index];
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const center = screenPoint(x, y);
            const dx = screenPoint(x + 1, y);
            const dy = screenPoint(x, y + 1);
            node.style.transform = `matrix(${dx.x - center.x}, ${dx.y - center.y}, ${dy.x - center.x}, ${dy.y - center.y}, ${center.x - x}, ${center.y - y})`;
          });
          rectCache = new WeakMap();
          playerControlLayout = { player, key, rects };
        }
        controls.forEach((node, index) => {
          const rect = playerControlLayout.rects[index];
          const y = rect.top + rect.height / 2;
          const active = node.matches(':hover, :focus-visible');
          if (node.tagName === 'INPUT') {
            const progress = Number(node.value) / 100;
            sourceContext.fillStyle = 'rgba(239, 210, 170, .22)';
            sourceContext.fillRect(rect.left, y - 1, rect.width, 2);
            sourceContext.fillStyle = active ? '#ff6842' : '#efd2aa';
            sourceContext.fillRect(rect.left, y - 1, rect.width * progress, 2);
            sourceContext.fillRect(rect.left + rect.width * progress - 2, y - 4, 4, 8);
          } else {
            const { style } = cssFont(node);
            const textRect = { ...rect, left: rect.left + (parseFloat(style.paddingLeft) || 0), top: rect.top + (parseFloat(style.paddingTop) || 0) };
            drawLabel(node, textRect, undefined, { color: active ? '#ff6842' : undefined, tracking: .08 });
            if (active || node.classList.contains('work-player-back')) {
              sourceContext.fillStyle = active ? '#ff6842' : 'rgba(239, 210, 170, .4)';
              sourceContext.fillRect(rect.left, rect.bottom - 2, rect.width, 1);
            }
          }
        });
      };

      const drawInterface = (elapsed) => {
        const player = document.querySelector('.work-player');
        if (player) drawWorkPlayer(player);
        else {
        const eyebrow = layout.eyebrow;
        drawLabel(eyebrow.node, cachedRectOf(eyebrow.node), undefined, {
          color: '#e95c38',
          glow: 'rgba(233, 92, 56, .55)',
          tracking: 0.14,
        });

        drawTitle(elapsed);
        drawPortfolio();

        layout.services.forEach((service, index) => {
          const rect = cachedRectOf(service);
          const { size, font } = cssFont(service);
          sourceContext.font = font;
          sourceContext.textBaseline = 'top';
          sourceContext.fillStyle = '#ff6842';
          sourceContext.fillText(String(index + 1).padStart(2, '0'), rect.left, rect.top);
          const link = service.querySelector('a');
          const selected = link?.matches(':hover, :focus-visible, [aria-current="page"]');
          sourceContext.fillStyle = selected ? '#ff6842' : '#ffe4bd';
          sourceContext.shadowColor = 'rgba(255, 228, 189, .55)';
          sourceContext.shadowBlur = 3;
          const textX = rect.left + size * 3.2;
          drawTrackedText(sourceContext, service.textContent.trim().toUpperCase(), textX, rect.top, size * 0.12);
          sourceContext.shadowColor = 'transparent';
          sourceContext.shadowBlur = 0;
          sourceContext.strokeStyle = 'rgba(255, 104, 66, .62)';
          sourceContext.lineWidth = 1;
          sourceContext.beginPath();
          sourceContext.moveTo(textX, rect.top + size * 1.36);
          sourceContext.lineTo(textX + Math.min(viewportWidth * 0.19, 290), rect.top + size * 1.36);
          sourceContext.stroke();
        });

        drawLabel(layout.portfolioLink.node, cachedRectOf(layout.portfolioLink.node));

        const description = layout.description;
        if (description.node && description.rect && description.node.textContent.trim()) {
          const { style, size, font } = cssFont(description.node);
          sourceContext.font = font;
          sourceContext.textBaseline = 'top';
          sourceContext.fillStyle = style.color;
          const lineHeight = parseFloat(style.lineHeight) || size * 1.7;
          let line = '';
          let y = description.rect.top;
          description.node.textContent.trim().split(/\s+/).forEach((word) => {
            const next = line ? line + ' ' + word : word;
            if (line && sourceContext.measureText(next).width > description.rect.width) {
              sourceContext.fillText(line, description.rect.left, y);
              y += lineHeight;
              line = word;
            } else {
              line = next;
            }
          });
          if (line) sourceContext.fillText(line, description.rect.left, y);
        }

        const instagram = { ...layout.instagram, rect: cachedRectOf(layout.instagram.node) };
        const actionActive = actionHit?.matches(':hover, :focus-visible');
        drawLabel(instagram.node, instagram.rect, instagram.node?.textContent?.trim(), {
          tracking: 0.1,
          color: actionActive ? '#ff6842' : '#efd2aa',
          glow: actionActive ? 'rgba(233, 92, 56, .65)' : 'rgba(255, 225, 185, .32)',
        });
        if (instagram.rect) {
          sourceContext.strokeStyle = actionActive ? '#ff6842' : '#efd2aa';
          sourceContext.globalAlpha = 0.72;
          sourceContext.lineWidth = 1;
          sourceContext.beginPath();
          sourceContext.moveTo(instagram.rect.left, instagram.rect.bottom + 1);
          sourceContext.lineTo(instagram.rect.right, instagram.rect.bottom + 1);
          sourceContext.stroke();
          sourceContext.globalAlpha = 1;
        }

        }

        const jp = layout.japanese;
        const channelIdent = document.querySelector('.channel-ident.is-visible');
        if (channelIdent) {
          drawLabel(channelIdent, cachedRectOf(channelIdent), undefined, { tracking: -0.06, color: '#efd2aa' });
        }
        if (jp.node && jp.rect && !channelIdent) {
          const { size, font } = cssFont(jp.node, 'sans-serif');
          sourceContext.font = font;
          sourceContext.textAlign = 'right';
          sourceContext.textBaseline = 'top';
          sourceContext.fillStyle = '#e95c38';
          sourceContext.shadowColor = 'rgba(233, 92, 56, .45)';
          sourceContext.shadowBlur = 3;
          jp.node.innerHTML.split(/<br\s*\/?\s*>/i).forEach((line, index) => {
            sourceContext.fillText(line.trim(), jp.rect.right, jp.rect.top + index * size * .88);
          });
          sourceContext.textAlign = 'left';
          sourceContext.shadowColor = 'transparent';
          sourceContext.shadowBlur = 0;
        }

        const osdFontSize = Math.max(18, Math.min(viewportWidth * 0.027, 43));
        sourceContext.font = `500 ${osdFontSize}px "DM Mono", monospace`;
        sourceContext.fillStyle = '#eee8db';
        sourceContext.textBaseline = 'top';
        sourceContext.shadowColor = 'rgba(255, 245, 225, .45)';
        sourceContext.shadowBlur = 4;
        if (layout.play) sourceContext.fillText('PLAY ▶', layout.play.left, layout.play.top);

        const counterSeconds = window.morlynVhsSeconds();
        const counter = [
          Math.floor(counterSeconds / 3600),
          Math.floor((counterSeconds % 3600) / 60),
          counterSeconds % 60,
        ].map((value) => String(value).padStart(2, '0')).join(':');

        const lowerFontSize = Math.max(16, Math.min(viewportWidth * 0.0215, 34));
        sourceContext.font = `500 ${lowerFontSize}px "DM Mono", monospace`;
        if (layout.speed) sourceContext.fillText('SP', layout.speed.left, layout.speed.top);
        if (layout.timecode) {
          sourceContext.textAlign = 'right';
          sourceContext.fillText(counter, layout.timecode.right, layout.timecode.top);
          sourceContext.textAlign = 'left';
        }
        sourceContext.shadowColor = 'transparent';
        sourceContext.shadowBlur = 0;
      };

      const drawSource = (elapsed) => {
        sourceNeedsUpload = true;
        sourceContext.setTransform(1, 0, 0, 1, 0, 0);
        sourceContext.fillStyle = '#050505';
        sourceContext.fillRect(0, 0, source.width, source.height);
        sourceContext.setTransform(renderScale, 0, 0, renderScale, 0, 0);

        const glow = sourceContext.createRadialGradient(
          viewportWidth * 0.48,
          viewportHeight * 0.42,
          0,
          viewportWidth * 0.48,
          viewportHeight * 0.42,
          viewportWidth * 0.66,
        );
        glow.addColorStop(0, 'rgba(255, 225, 185, .07)');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        sourceContext.fillStyle = glow;
        sourceContext.fillRect(0, 0, viewportWidth, viewportHeight);

        drawInterface(elapsed);
      };

      const drawShader = (elapsed) => {
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(uvLocation);
        gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 16, 8);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        if (sourceNeedsUpload) {
          if (textureWidth !== source.width || textureHeight !== source.height) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
            textureWidth = source.width;
            textureHeight = source.height;
          } else {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
          }
          sourceNeedsUpload = false;
        }

        gl.uniform1i(textureLocation, 0);
        gl.uniform2f(screenResolutionLocation, viewportWidth, viewportHeight);
        gl.uniform1f(noisePhaseLocation, Math.floor(elapsed * 18) % 1024);
        gl.uniform1f(flickerLocation, Math.sin(elapsed * 73) * .006 + Math.sin(elapsed * 17) * .008);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };

      const checkRenderBudget = (now, interval) => {
        if (lastRenderedAt && now - startTime > 2000) qualitySamples.push(Math.min(now - lastRenderedAt, 300));
        lastRenderedAt = now;
        if (qualitySamples.length < 45) return;
        const average = qualitySamples.reduce((sum, value) => sum + value, 0) / qualitySamples.length;
        const missed = qualitySamples.filter(value => value > interval * 1.45).length / qualitySamples.length;
        qualitySamples = [];
        let next = qualityScale;
        if (average > interval * 1.2 || missed > .3) next = Math.max(.7, qualityScale * .85);
        else if (average < interval * 1.08 && missed < .03 && now - lastQualityChange > 12000) next = Math.min(1, qualityScale + .05);
        if (next === qualityScale) return;
        qualityScale = next;
        lastQualityChange = now;
        try { sessionStorage.setItem('morlyn-crt-quality', String(qualityScale)); } catch {}
        resize();
      };

      let previousFrame = 0;
      let animationFrame;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      const frame = now => {
        if (document.hidden) { animationFrame = undefined; return; }
        const interval = 1000 / (reducedMotion.matches ? 15 : 30);
        const delta = now - previousFrame;
        if (delta >= interval - .5) {
          previousFrame = now - (delta >= interval ? delta % interval : 0);
          if (!reducedMotion.matches) checkRenderBudget(now, interval);
          const elapsed = (now - startTime) / 1000;
          if (portfolioNeedsAlignment) alignPortfolioCards();
          const player = document.querySelector('.work-player');
          const video = player?.querySelector('video');
          const typing = viewportWidth <= 800 || document.documentElement.classList.contains('channel-arrival')
            ? titleCharacterCount : Math.min(titleCharacterCount, Math.max(0, Math.floor((elapsed - .22) / .075)));
          const flicker = getFlickerState(elapsed);
          const key = [window.morlynVhsSeconds(), player ? 'work' : typing,
            !player && flicker.active ? Math.floor(flicker.phase * 30) : -1,
            !!document.querySelector('.channel-ident.is-visible')].join('|');
          if (sourceDirty || key !== lastSourceKey || (video && !video.paused && !video.ended && video.readyState >= 2)) {
            drawSource(elapsed);
            sourceDirty = false;
            lastSourceKey = key;
          }
          drawShader(elapsed);
        }
        animationFrame = requestAnimationFrame(frame);
      };
      const resumeFrames = () => {
        if (document.hidden || animationFrame !== undefined) return;
        lastRenderedAt = 0;
        qualitySamples = [];
        previousFrame = performance.now() - 1000 / 30;
        sourceDirty = true;
        animationFrame = requestAnimationFrame(frame);
      };

      const start = async () => {
        if (document.fonts?.ready) await document.fonts.ready;
        resize();
        drawSource(0);
        drawShader(0);
        document.documentElement.classList.add('canvas-crt-ready');
        prepareActionHit();
        alignPortfolioCards();
        window.addEventListener('morlyn-portfolio-ready', () => { portfolioNeedsAlignment = true; sourceDirty = true; });
        window.addEventListener('morlyn-work-changed', () => { playerControlLayout = null; rectCache = new WeakMap(); sourceDirty = true; });
        for (const name of ['pointerover', 'pointerout', 'focusin', 'focusout', 'input', 'load', 'loadeddata', 'loadedmetadata', 'seeked', 'volumechange', 'durationchange', 'play', 'pause', 'ended', 'timeupdate', 'error']) document.addEventListener(name, invalidateSource, true);
        document.querySelector('.portfolio-grid')?.addEventListener('scroll', () => { portfolioNeedsAlignment = true; }, { passive: true });
        window.morlynCaptureCrt = () => {
          const elapsed = (performance.now() - startTime) / 1000;
          drawSource(elapsed);
          drawShader(elapsed);
          const snapshot = document.createElement('canvas');
          snapshot.width = 640;
          snapshot.height = Math.max(1, Math.round(640 * output.height / output.width));
          snapshot.getContext('2d').drawImage(output, 0, 0, snapshot.width, snapshot.height);
          return snapshot.toDataURL('image/jpeg', .7);
        };
        window.addEventListener('resize', resize, { passive: true });
        document.fonts?.addEventListener('loadingdone', resize);
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) { cancelAnimationFrame(animationFrame); animationFrame = undefined; }
          else resumeFrames();
        });
        window.addEventListener('pagehide', () => { cancelAnimationFrame(animationFrame); animationFrame = undefined; });
        window.addEventListener('pageshow', resumeFrames);
        resumeFrames();
      };

      start();
    } catch (error) {
      console.error(error);
    }
  }
}
