// The open notch's media background: "Gradient Waves", a raymarched sea of waves in the song's three colours.
// Ported to plain JS from React Bits (https://reactbits.dev/backgrounds/gradient-waves), keeping its shader as is;
// the mouse steering, click swells and intro are left out. It renders only while the notch shows it (#glow visible:
// open, Color glow on, a song, Home) and stands still while the song is paused.
//
// React Bits: MIT + Commons Clause License Condition v1.0. Copyright (c) 2026 David Haz. Permission is hereby granted,
// free of charge, to any person obtaining a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
// modify, merge, publish, and distribute the Software as part of an application, website, or product, subject to the
// following conditions: The above copyright notice and this permission notice shall be included in all copies or
// substantial portions of the Software. Commons Clause: you may not sell, sublicense, or redistribute the components
// themselves. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
(function () {
  const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;
  const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uClock;
uniform float uAmplitude;
uniform float uWaveScale;
uniform float uWaveRatio;
uniform float uSwell;
uniform float uTurbulence;
uniform float uHeight;
uniform float uTilt;
uniform float uZoom;
uniform vec2 uLook;
uniform float uFogDepth;
uniform float uBrightness;
uniform float uOpacity;
uniform float uGrain;
uniform vec3 uHorizon;
uniform vec3 uWave;
uniform vec3 uCrest;
uniform vec3 uBackground;
uniform float uOpaque;
uniform float uLight;
uniform vec3 uSun;
uniform float uRelief;
uniform float uSheen;
uniform float uSteps;
uniform float uStride;
uniform vec3 uIntro;
uniform vec3 uSwells[4];
uniform float uSwellWidth;
out vec4 outColor;

const float FAR = 4000.0;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 surface(vec2 xy) {
  vec2 freq = vec2(uWaveScale / 7.0, (uWaveScale * uWaveRatio) / 3.0);
  vec4 tc = vec4(uTime / 0.130, uTime / 0.810, uTime / 0.200, uTime / 0.710);
  float a = xy.x + tc.x;
  float swellPhase = (xy.y + a) / 20.0 + tc.y;
  float bend = uSwell * cos(swellPhase) / 20.0;
  float mx = a + uSwell * sin(swellPhase);
  float crossPhase = xy.x / 23.0 + tc.w;
  float my = xy.y - tc.z + uTurbulence * cos(crossPhase);
  float twist = -uTurbulence * sin(crossPhase) / 23.0;
  float cx = cos(mx * freq.x);
  float cy = cos(my * freq.y);
  float rise = 1.0;
  if (uIntro.z > 0.0) rise = mix(1.0, smoothstep(uIntro.y * 0.45, uIntro.y * 1.6, xy.x), uIntro.z);
  float amp = uAmplitude * rise;
  float h = (sin(mx * freq.x) + sin(my * freq.y)) * amp + uHeight;
  float dx = amp * (freq.x * cx * (1.0 + bend) + freq.y * cy * twist);
  float dy = amp * (freq.x * cx * bend + freq.y * cy);
  for (int k = 0; k < 4; k++) {
    vec3 sw = uSwells[k];
    if (sw.z <= 0.0) continue;
    float u = (xy.x - sw.x) / uSwellWidth;
    float v = (xy.y - sw.y) / (uSwellWidth * 3.5);
    float bump = sw.z * exp(-u * u - v * v);
    h += bump;
    dx += bump * (-2.0 * u / uSwellWidth);
    dy += bump * (-2.0 * v / (uSwellWidth * 3.5));
  }
  return vec3(h, dx, dy);
}

float march(vec3 origin, vec3 dir) {
  float dist = 0.0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps) break;
    float gap = origin.z + dist * dir.z - surface(origin.xy + dist * dir.xy).x;
    if (abs(gap) < 0.002 * dist + 0.01) break;
    dist += uStride * gap;
    if (!(abs(dist) < FAR)) return FAR;
  }
  return dist;
}

void main() {
  float c;
  float s;
  float vfov = (3.14159 / 2.3) / max(uZoom, 0.05);
  vec3 cam = vec3(0.0, 0.0, 30.0);
  vec2 uv = gl_FragCoord.xy / uResolution - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  uv.y *= -1.0;

  vec3 dir = vec3(0.0, 0.0, -1.0);
  float ulen = length(uv);
  float xrot = vfov * ulen;
  c = cos(xrot);
  s = sin(xrot);
  dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  vec2 nuv = ulen > 1e-5 ? uv / ulen : vec2(1.0, 0.0);
  dir = mat3(nuv.x, -nuv.y, 0.0, nuv.y, nuv.x, 0.0, 0.0, 0.0, 1.0) * dir;
  c = cos(uTilt + uLook.y);
  s = sin(uTilt + uLook.y);
  dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;
  c = cos(uLook.x);
  s = sin(uLook.x);
  dir = mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0) * dir;

  float dist = march(cam, dir);
  vec3 pos = cam + dist * dir;
  vec3 field = surface(pos.xy);
  vec3 view = -dir;

  float crest = clamp((field.x - uHeight) / max(2.0 * uAmplitude, 0.001) * 0.5 + 0.5, 0.0, 1.0);
  vec3 body = mix(uWave, uCrest, smoothstep(0.45, 1.0, crest) * 0.5);
  vec3 normal = normalize(vec3(-field.yz * (1.0 + 1.5 * uRelief), 1.0));
  float diffuse = clamp(dot(normal, uSun) * 0.5 + 0.5, 0.0, 1.0);
  float lightness = mix(1.0, diffuse * diffuse * (3.0 - 2.0 * diffuse), uRelief);
  float sheen = pow(clamp(dot(normal, normalize(uSun + view)), 0.0, 1.0), 14.0) * uSheen * (0.4 + 0.6 * uRelief);
  float rim = pow(1.0 - clamp(dot(normal, view), 0.0, 1.0), 3.0);

  vec3 col;
  float alpha;
  float haze = 1.0 - exp(-dist / (uFogDepth * 5.0));
  float fade = 1.0 - smoothstep(0.35, 1.0, haze);
  if (uLight < 0.5) {
    vec3 lit = mix(uHorizon * 0.18, body, lightness) + uCrest * sheen;
    lit = mix(lit, uHorizon, rim * 0.15 * uRelief);
    col = mix(lit, uHorizon, smoothstep(0.0, 1.0, haze)) * 0.85 * uBrightness;
    alpha = fade;
  } else {
    vec3 hue = mix(uHorizon, body, 0.35 + 0.65 * lightness);
    float density = mix(0.16, 0.9, 1.0 - lightness);
    density *= 1.0 - clamp(sheen, 0.0, 1.0) * 0.85;
    density *= 1.0 - 0.5 * smoothstep(0.0, 1.0, haze);
    col = hue;
    alpha = fade * clamp(density * uBrightness, 0.0, 1.0);
  }

  float reveal = uIntro.x;
  col = clamp(col, 0.0, 1.0);
  float grain = (hash(gl_FragCoord.xy + fract(uClock) * 64.0) - 0.5) * uGrain;
  alpha = clamp(alpha * (1.0 + grain), 0.0, 1.0) * reveal * uOpacity;
  if (uOpaque > 0.5) {
    outColor = vec4(mix(uBackground, col, alpha), 1.0);
  } else {
    outColor = vec4(col * alpha, alpha);
  }
}`;
  // React Bits' defaults (quality medium), with the camera zoomed in and tilted down for a short, wide strip (else
  // the waves bulge into a dome) and dimmed a little for the text over them
  const S = { speed: 0.4, amplitude: 2.5, waveScale: 0.6, waveRatio: 0.9, swell: 35, turbulence: 20, tilt: 72 * Math.PI / 180,
    zoom: 2.4, height: 5.5, fogDepth: 15, relief: 1, lightAngle: 120 * Math.PI / 180, sheen: 0, brightness: 0.8, opacity: 1, grain: 0.2, steps: 84 };
  // Waves in `box` (a canvas filling it), drawn while `shown()`; colours glide to new ones. Gone from the page: its GL
  // context is given back.
  function makeWaves(box, shown) {
  const canvas = document.createElement('canvas');
  canvas.className = 'waves';
  box.appendChild(canvas);
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
  if (!gl) { canvas.remove(); return { colors() {}, playing() {}, tune() {}, wake() {} }; }
  const compile = (type, text) => {
    const sh = gl.createShader(type); gl.shaderSource(sh, text); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(sh)); return null; }
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.bindAttribLocation(prog, 0, 'aPosition');
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const u = {};
  for (const n of ['uResolution', 'uTime', 'uClock', 'uAmplitude', 'uWaveScale', 'uWaveRatio', 'uSwell', 'uTurbulence', 'uHeight', 'uTilt',
    'uZoom', 'uLook', 'uFogDepth', 'uBrightness', 'uOpacity', 'uGrain', 'uHorizon', 'uWave', 'uCrest', 'uBackground', 'uOpaque', 'uLight',
    'uSun', 'uRelief', 'uSheen', 'uSteps', 'uStride', 'uIntro', 'uSwells', 'uSwellWidth']) u[n] = gl.getUniformLocation(prog, n);
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const ocean = [[0.39, 0.4, 0.95], [0.23, 0.51, 0.96], [0.18, 0.83, 0.75]];
  const st = { time: 0, clock: 0, last: 0, raf: 0, playing: true, cols: ocean.map((c) => c.slice()), want: ocean };

  function render() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5); // ponytail: 1.5x is sharp enough for soft waves, and cheaper
    const w = Math.max(1, Math.round(box.clientWidth * ratio)), h = Math.max(1, Math.round(box.clientHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(u.uResolution, w, h);
    gl.uniform1f(u.uTime, st.time); gl.uniform1f(u.uClock, st.clock);
    gl.uniform1f(u.uAmplitude, S.amplitude); gl.uniform1f(u.uWaveScale, S.waveScale); gl.uniform1f(u.uWaveRatio, S.waveRatio);
    gl.uniform1f(u.uSwell, S.swell); gl.uniform1f(u.uTurbulence, S.turbulence); gl.uniform1f(u.uHeight, S.height);
    gl.uniform1f(u.uTilt, S.tilt); gl.uniform1f(u.uZoom, S.zoom); gl.uniform2f(u.uLook, 0, 0);
    gl.uniform1f(u.uFogDepth, S.fogDepth); gl.uniform1f(u.uBrightness, S.brightness); gl.uniform1f(u.uOpacity, S.opacity);
    gl.uniform1f(u.uGrain, S.grain);
    gl.uniform3fv(u.uHorizon, st.cols[0]); gl.uniform3fv(u.uWave, st.cols[1]); gl.uniform3fv(u.uCrest, st.cols[2]);
    gl.uniform3f(u.uBackground, 0, 0, 0); gl.uniform1f(u.uOpaque, 0); gl.uniform1f(u.uLight, 0);
    const alt = 0.52;
    gl.uniform3f(u.uSun, Math.cos(alt) * Math.cos(S.lightAngle), Math.cos(alt) * Math.sin(S.lightAngle), Math.sin(alt));
    gl.uniform1f(u.uRelief, S.relief); gl.uniform1f(u.uSheen, S.sheen); gl.uniform1f(u.uSteps, S.steps);
    gl.uniform3f(u.uIntro, 1, 0, 0);
    gl.uniform3fv(u.uSwells, new Float32Array(12)); gl.uniform1f(u.uSwellWidth, 8);
    const slope = S.amplitude * ((S.waveScale / 7) * (1 + Math.abs(S.swell) / 20) + ((S.waveScale * S.waveRatio) / 3) * (1 + Math.abs(S.turbulence) / 23));
    gl.uniform1f(u.uStride, 0.9 / Math.max(1, slope / 1.5));
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function tick(now) {
    st.raf = 0;
    if (!canvas.isConnected) { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return; }
    if (!shown() || document.hidden) { st.last = 0; return; }
    const dt = st.last ? Math.min((now - st.last) / 1000, 0.1) : 0;
    st.last = now;
    st.clock += dt;
    // the colours glide to the new ones (about half a second)
    const k = 1 - Math.exp(-dt / 0.15);
    let moving = false;
    st.cols.forEach((c, i) => c.forEach((v, j) => { const d = st.want[i][j] - v; if (Math.abs(d) > 0.002) moving = true; c[j] = v + d * (dt ? k : 1); }));
    const still = !st.playing || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still) st.time += dt * S.speed;
    render();
    if (!still || moving) st.raf = requestAnimationFrame(tick); // paused: drawn until the colours settle, then nothing
  }
  const wake = () => { if (!st.raf && shown() && !document.hidden) st.raf = requestAnimationFrame(tick); };
  document.addEventListener('visibilitychange', wake);
  wake();
  return {
    // the accent colours, 0-255 each
    colors(c1, c2, c3) { st.want = [c1, c2, c3].map((c) => c.map((v) => v / 255)); wake(); },
    playing(on) { st.playing = !!on; wake(); },
    // the look (React Bits' props), e.g. Waves.tune({ zoom: 2, tilt: 1.2 }) from the inspector
    tune(o) { Object.assign(S, o); wake(); },
    wake,
  };
  }
  window.makeWaves = makeWaves;
  // the notch's: behind the open player (#glow), while it shows (open, Color glow on, a song, Home)
  const glow = document.getElementById('glow');
  const notch = document.getElementById('notch');
  if (glow && notch) {
    window.Waves = makeWaves(glow, () => ['open', 'glow-on', 'has-media'].every((c) => notch.classList.contains(c)) && (notch.classList.contains('on-music') || notch.classList.contains('on-home')));
    new MutationObserver(Waves.wake).observe(notch, { attributes: true, attributeFilter: ['class'] });
  }
})();
