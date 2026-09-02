/*
 * Single-pass CRT compositor for Morlyn Beats.
 * The curvature, rounded-screen SDF and lightweight bloom approach are adapted
 * from RetroZone's MIT-licensed CRT shader. See vendor/RETROZONE-LICENSE.txt.
 */

const output = document.querySelector('#crt-output');
const mpcCanvas = document.querySelector('#three-sampler');
const stage = document.querySelector('.three-stage');

if (output && mpcCanvas && stage) {
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
      uniform sampler2D u_mpcTexture;
      uniform vec2 u_resolution;
      uniform vec4 u_mpcRect;
      uniform float u_time;
      varying vec2 v_uv;

      #define PI 3.14159265359

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
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
        vec4 base = texture2D(u_texture, uv);
        bool insideMpc = uv.x >= u_mpcRect.x && uv.x <= u_mpcRect.x + u_mpcRect.z
          && uv.y >= u_mpcRect.y && uv.y <= u_mpcRect.y + u_mpcRect.w;
        if (insideMpc) {
          vec2 localUV = (uv - u_mpcRect.xy) / u_mpcRect.zw;
          vec4 mpc = texture2D(u_mpcTexture, localUV);
          vec3 composite = mix(base.rgb, mpc.rgb, mpc.a);
          float interfaceMask = smoothstep(0.06, 0.16, max(max(base.r, base.g), base.b));
          return mix(composite, base.rgb, interfaceMask);
        }
        return base.rgb;
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

        vec2 texel = 1.0 / u_resolution;
        vec3 color = sampleSource(uv);

        vec3 bloom = color * 0.36;
        bloom += sampleSource(uv + vec2(texel.x * 2.4, 0.0)) * 0.16;
        bloom += sampleSource(uv - vec2(texel.x * 2.4, 0.0)) * 0.16;
        bloom += sampleSource(uv + vec2(0.0, texel.y * 2.4)) * 0.16;
        bloom += sampleSource(uv - vec2(0.0, texel.y * 2.4)) * 0.16;
        color += max(bloom - 0.34, 0.0) * 0.62;

        float horizontalRow = fract(uv.y * u_resolution.y * 0.34);
        float scanline = mix(0.82, 1.0, smoothstep(0.10, 0.62, horizontalRow));
        color *= scanline;

        vec2 center = screenUV * 2.0 - 1.0;
        float edge = smoothstep(0.38, 1.18, dot(center, center));
        color *= 1.0 - edge * 0.30;

        float grain = hash(gl_FragCoord.xy + floor(u_time * 18.0)) - 0.5;
        color += grain * 0.026;

        float flicker = sin(u_time * 73.0) * 0.006 + sin(u_time * 17.0) * 0.008;
        color *= 1.0 + flicker;
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
      const mpcTextureLocation = gl.getUniformLocation(program, 'u_mpcTexture');
      const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
      const mpcRectLocation = gl.getUniformLocation(program, 'u_mpcRect');
      const timeLocation = gl.getUniformLocation(program, 'u_time');

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

      const mpcTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, mpcTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0]),
      );
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

      const source = document.createElement('canvas');
      const sourceContext = source.getContext('2d', { alpha: false });
      const isFirefox = navigator.userAgent.includes('Firefox');
      let renderScale = 1;
      let viewportWidth = 1;
      let viewportHeight = 1;
      let layout = null;
      let textureWidth = 0;
      let textureHeight = 0;
      let mpcDirty = true;
      let mpcFrame = null;
      const startTime = performance.now();
      const flickerLeadIn = 3.6;
      const flickerPeriod = 4.8;
      const flickerDuration = 0.62;
      let lastFlickerCycle = -1;
      let flickerAudioContext = null;
      let flickerAudioBuffer = null;
      let flickerAudioOffset = 0;
      let flickerAudioPromise = null;

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

      const prepareFlickerAudio = () => {
        if (flickerAudioPromise) return flickerAudioPromise;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return Promise.resolve(null);
        flickerAudioContext = new AudioContextClass();
        flickerAudioPromise = fetch('./assets/flicker-open-sign.m4a')
          .then((response) => {
            if (!response.ok) throw new Error(`Flicker audio failed: ${response.status}`);
            return response.arrayBuffer();
          })
          .then((data) => flickerAudioContext.decodeAudioData(data))
          .then((buffer) => {
            flickerAudioBuffer = buffer;
            const channel = buffer.getChannelData(0);
            const blockSize = Math.max(1, Math.floor(buffer.sampleRate * 0.018));
            let maximum = 0;
            const levels = [];
            for (let index = 0; index < channel.length; index += blockSize) {
              let total = 0;
              const end = Math.min(channel.length, index + blockSize);
              for (let sample = index; sample < end; sample += 1) total += Math.abs(channel[sample]);
              const level = total / Math.max(1, end - index);
              levels.push(level);
              maximum = Math.max(maximum, level);
            }
            const onsetBlock = levels.findIndex((level) => level > maximum * 0.2);
            flickerAudioOffset = Math.max(0, onsetBlock * blockSize / buffer.sampleRate - 0.025);
            return buffer;
          })
          .catch((error) => {
            console.warn('Could not prepare the flicker sound.', error);
            return null;
          });
        return flickerAudioPromise;
      };

      const unlockFlickerAudio = async () => {
        await prepareFlickerAudio();
        if (flickerAudioContext?.state === 'suspended') await flickerAudioContext.resume();
      };

      const playFlickerAudio = () => {
        if (!flickerAudioBuffer || flickerAudioContext?.state !== 'running') return;
        const now = flickerAudioContext.currentTime;
        const availableDuration = Math.max(0.05, flickerAudioBuffer.duration - flickerAudioOffset);
        const duration = Math.min(flickerDuration, availableDuration);
        const sourceNode = flickerAudioContext.createBufferSource();
        const gainNode = flickerAudioContext.createGain();
        sourceNode.buffer = flickerAudioBuffer;
        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.gain.exponentialRampToValueAtTime(0.24, now + 0.012);
        gainNode.gain.setValueAtTime(0.24, now + Math.max(0.02, duration - 0.05));
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        sourceNode.connect(gainNode).connect(flickerAudioContext.destination);
        sourceNode.start(now, flickerAudioOffset, duration);
        sourceNode.stop(now + duration + 0.015);
      };

      prepareFlickerAudio();
      window.addEventListener('pointerdown', unlockFlickerAudio, { once: true, passive: true });
      window.addEventListener('keydown', unlockFlickerAudio, { once: true });
      window.addEventListener('morlyn-mpc-frame', (event) => {
        const frame = event.detail;
        if (!frame?.pixels || !frame.width || !frame.height) return;
        mpcFrame = frame;
        mpcDirty = true;
      });

      const rectOf = (selector) => document.querySelector(selector)?.getBoundingClientRect() || null;

      const readLayout = () => {
        layout = {
          eyebrow: { node: document.querySelector('.eyebrow'), rect: rectOf('.eyebrow') },
          title: document.querySelectorAll('.hero-title .line'),
          services: [...document.querySelectorAll('.service-index li')],
          instagram: { node: document.querySelector('.primary-action'), rect: rectOf('.primary-action') },
          japanese: { node: document.querySelector('.jp-mark'), rect: rectOf('.jp-mark') },
          play: rectOf('.vhs-play'),
          speed: rectOf('.vhs-speed'),
          timecode: rectOf('.vhs-timecode'),
          stage: stage.getBoundingClientRect(),
        };
      };

      const resize = () => {
        viewportWidth = Math.max(window.innerWidth, 1);
        viewportHeight = Math.max(window.innerHeight, 1);
        renderScale = isFirefox ? 0.7 : Math.min(window.devicePixelRatio || 1, 1);
        output.width = Math.max(1, Math.round(viewportWidth * renderScale));
        output.height = Math.max(1, Math.round(viewportHeight * renderScale));
        source.width = output.width;
        source.height = output.height;
        textureWidth = 0;
        textureHeight = 0;
        gl.viewport(0, 0, output.width, output.height);
        readLayout();
      };

      const cssFont = (node, fallback = 'DM Mono') => {
        const style = node ? getComputedStyle(node) : null;
        const size = style ? parseFloat(style.fontSize) : 10;
        const weight = style?.fontWeight || '500';
        const family = style?.fontFamily || fallback;
        return { style, size, font: `${weight} ${size}px ${family}` };
      };

      const drawTrackedText = (context, text, x, y, tracking) => {
        let cursorX = x;
        [...text].forEach((character) => {
          context.fillText(character, cursorX, y);
          cursorX += context.measureText(character).width + tracking;
        });
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
        sourceContext.textBaseline = 'bottom';
        sourceContext.fillStyle = '#ffe5bd';
        sourceContext.shadowColor = 'rgba(233, 92, 56, .72)';
        sourceContext.shadowBlur = 3;
        sourceContext.shadowOffsetX = 4;
        sourceContext.shadowOffsetY = 5;

        const visibleCharacters = Math.max(0, Math.floor((elapsed - 0.22) / 0.075));
        let characterOffset = 0;
        [...layout.title].forEach((line) => {
          const rect = line.getBoundingClientRect();
          const fullText = line.textContent.trim();
          const localVisible = Math.max(0, Math.min(fullText.length, visibleCharacters - characterOffset));
          const visibleText = fullText.slice(0, localVisible);
          const tracking = size * 0.025;
          const width = Math.max(trackedWidth(sourceContext, fullText, tracking), 1);
          const scaleX = rect.width / width;
          const scaleY = Math.max(1, Math.min(1.42, rect.height / Math.max(size * 0.86, 1)));

          sourceContext.save();
          sourceContext.translate(rect.left, rect.bottom);
          sourceContext.scale(scaleX, scaleY);
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
        if (!node || !rect || !text) return;
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

      const drawInterface = (elapsed) => {
        const eyebrow = layout.eyebrow;
        drawLabel(eyebrow.node, eyebrow.rect, undefined, {
          color: '#e95c38',
          glow: 'rgba(233, 92, 56, .55)',
          tracking: 0.14,
        });

        drawTitle(elapsed);

        layout.services.forEach((service, index) => {
          const rect = service.getBoundingClientRect();
          const { size, font } = cssFont(service);
          sourceContext.font = font;
          sourceContext.textBaseline = 'top';
          sourceContext.fillStyle = '#ff6842';
          sourceContext.fillText(String(index + 1).padStart(2, '0'), rect.left, rect.top);
          sourceContext.fillStyle = '#ffe4bd';
          sourceContext.shadowColor = 'rgba(255, 228, 189, .55)';
          sourceContext.shadowBlur = 7;
          const textX = rect.left + size * 3.2;
          drawTrackedText(sourceContext, service.textContent.trim(), textX, rect.top, size * 0.12);
          sourceContext.shadowColor = 'transparent';
          sourceContext.shadowBlur = 0;
          sourceContext.strokeStyle = 'rgba(255, 104, 66, .62)';
          sourceContext.lineWidth = 1;
          sourceContext.beginPath();
          sourceContext.moveTo(textX, rect.top + size * 1.36);
          sourceContext.lineTo(textX + Math.min(viewportWidth * 0.19, 290), rect.top + size * 1.36);
          sourceContext.stroke();
        });

        const instagram = layout.instagram;
        drawLabel(instagram.node, instagram.rect, instagram.node?.textContent?.trim(), { tracking: 0.1 });
        if (instagram.rect) {
          sourceContext.strokeStyle = '#efd2aa';
          sourceContext.globalAlpha = 0.72;
          sourceContext.lineWidth = 1;
          sourceContext.beginPath();
          sourceContext.moveTo(instagram.rect.left, instagram.rect.bottom + 1);
          sourceContext.lineTo(instagram.rect.right, instagram.rect.bottom + 1);
          sourceContext.stroke();
          sourceContext.globalAlpha = 1;
        }

        const jp = layout.japanese;
        if (jp.node && jp.rect) {
          const { size, font } = cssFont(jp.node, 'sans-serif');
          sourceContext.font = font;
          sourceContext.textAlign = 'right';
          sourceContext.textBaseline = 'top';
          sourceContext.fillStyle = '#e95c38';
          sourceContext.shadowColor = 'rgba(233, 92, 56, .45)';
          sourceContext.shadowBlur = 3;
          ['モーリン', 'ビーツ'].forEach((line, index) => {
            sourceContext.fillText(line, jp.rect.right, jp.rect.top + index * size * 0.88);
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

        const counterSeconds = Math.floor(elapsed);
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
        if (textureWidth !== source.width || textureHeight !== source.height) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
          textureWidth = source.width;
          textureHeight = source.height;
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
        }

        gl.uniform1i(textureLocation, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, mpcTexture);
        if (mpcDirty && mpcFrame) {
          try {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.RGBA,
              mpcFrame.width,
              mpcFrame.height,
              0,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              mpcFrame.pixels,
            );
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          } catch (error) {
            console.warn('Could not upload the MPC pixel frame to the CRT texture.', error);
          }
          mpcDirty = false;
        }
        gl.uniform1i(mpcTextureLocation, 1);

        const stageRect = stage.getBoundingClientRect();
        gl.uniform4f(
          mpcRectLocation,
          stageRect.left / viewportWidth,
          1 - (stageRect.bottom / viewportHeight),
          stageRect.width / viewportWidth,
          stageRect.height / viewportHeight,
        );
        gl.uniform2f(resolutionLocation, output.width, output.height);
        gl.uniform1f(timeLocation, elapsed);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };

      let previousFrame = 0;
      const frameInterval = 1000 / 30;

      const frame = (now) => {
        if (now - previousFrame >= frameInterval) {
          previousFrame = now;
          const elapsed = (now - startTime) / 1000;
          const flicker = getFlickerState(elapsed);
          if (flicker.active && flicker.cycle !== lastFlickerCycle) {
            lastFlickerCycle = flicker.cycle;
            playFlickerAudio();
          }
          drawSource(elapsed);
          drawShader(elapsed);
        }
        requestAnimationFrame(frame);
      };

      const start = async () => {
        if (document.fonts?.ready) await document.fonts.ready;
        resize();
        window.morlynMpcRenderer?.renderNow();
        drawSource(0);
        drawShader(0);
        document.documentElement.classList.add('canvas-crt-ready');
        window.addEventListener('resize', resize, { passive: true });
        requestAnimationFrame(frame);
      };

      start();
    } catch (error) {
      console.error(error);
    }
  }
}
