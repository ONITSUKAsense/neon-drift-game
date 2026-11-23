/* ==========================================================================
   NEON DRIFT · 霓虹夜驰
   A pseudo-3D synthwave racer. Vanilla Canvas2D, zero dependencies.
   --------------------------------------------------------------------------
   渲染原理：赛道被切成 200 单位的片段，每帧按透视投影把它们从近到远铺成梯形，
   转弯量逐段累加形成曲率，山丘量累加形成上下起伏 —— 经典 OutRun 做法。
   ========================================================================== */

'use strict';

/* roundRect 补丁：微信内置浏览器 / 旧 WebView 可能没有这个方法 */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    let tr = r, br = r, bl = r, tl = r;
    if (Array.isArray(r)) [tl, tr, br, bl] = r;
    tl = Math.min(tl, w / 2, h / 2);
    tr = Math.min(tr, w / 2, h / 2);
    br = Math.min(br, w / 2, h / 2);
    bl = Math.min(bl, w / 2, h / 2);
    this.moveTo(x + tl, y);
    this.lineTo(x + w - tr, y);
    this.arcTo(x + w, y, x + w, y + tr, tr);
    this.lineTo(x + w, y + h - br);
    this.arcTo(x + w, y + h, x + w - br, y + h, br);
    this.lineTo(x + bl, y + h);
    this.arcTo(x, y + h, x, y + h - bl, bl);
    this.lineTo(x, y + tl);
    this.arcTo(x, y, x + tl, y, tl);
    this.closePath();
    return this;
  };
}

const UA = navigator.userAgent || '';
const IS_TOUCH =
  'ontouchstart' in window ||
  navigator.maxTouchPoints > 0 ||
  (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ||
  /iPhone|iPad|iPod|Android|MicroMessenger|Mobile/i.test(UA);
if (IS_TOUCH) document.documentElement.classList.add('touch');

/* ------------------------------------------------------------------ 0. 工具 */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const fmt = (n) => Math.floor(n).toLocaleString('en-US');
const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- 1. 配置 */
const CFG = {
  segLen: 200,
  rumbleLen: 3,
  roadWidth: 2000,
  cameraHeight: 1000,
  fov: 82,
  drawDistance: 280,
  lanes: 4,
  maxSpeed: 200 * 60,
};
CFG.cameraDepth = 1 / Math.tan((CFG.fov / 2) * Math.PI / 180);
CFG.playerZ = CFG.cameraHeight * CFG.cameraDepth;
CFG.laneX = [-0.75, -0.25, 0.25, 0.75];

// 1 世界单位 ≈ 7.45mm，于是 12000 单位/秒 ≈ 322 km/h
const M_PER_UNIT = 0.00745;

const COL = {
  light: { ground: '#100720', road: '#26153a', lane: '#d9c2ff', rumble: '#ff2e88' },
  dark:  { ground: '#08030f', road: '#1a0e29', lane: '#4a2d68', rumble: '#25e8ff' },
};
const TRAFFIC_COLORS = ['#ff4d6d', '#ffb347', '#4cc9f0', '#b388ff', '#7cf59b', '#ff8fab'];
const FOG_RGB = '58, 10, 78';

/* ------------------------------------------------------------- 2. 画布状态 */
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d', { alpha: false });
const backdrop = document.createElement('canvas');
const view = { w: 0, h: 0, dpr: 1, horizon: 0 };
let bgShift = 0;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(320, canvas.clientWidth || window.innerWidth);
  const h = Math.max(240, canvas.clientHeight || window.innerHeight);
  view.w = w; view.h = h; view.dpr = dpr;
  view.horizon = Math.round(h * 0.52);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  buildBackdrop();
}

/* 远景：夜空 / 星 / 条纹落日 / 山脊 —— 一次画好，之后整帧贴图 */
function buildBackdrop() {
  const { w, h, dpr, horizon: hz } = view;
  const W = w * 1.6;
  backdrop.width = Math.round(W * dpr);
  backdrop.height = Math.round(h * dpr);
  const g = backdrop.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 天空
  const sky = g.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0.00, '#04010a');
  sky.addColorStop(0.32, '#12062c');
  sky.addColorStop(0.60, '#340a4e');
  sky.addColorStop(0.82, '#7c1156');
  sky.addColorStop(0.96, '#e02a63');
  sky.addColorStop(1.00, '#ff6a8a');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, hz + 1);

  // 星
  for (let i = 0; i < 260; i++) {
    const y = Math.pow(Math.random(), 1.7) * hz * 0.8;
    const a = (1 - y / (hz * 0.85)) * rand(0.25, 0.95);
    const r = rand(0.5, 1.5);
    g.fillStyle = `rgba(255,240,255,${a.toFixed(3)})`;
    g.beginPath();
    g.arc(rand(0, W), y, r, 0, TAU);
    g.fill();
  }

  // 落日
  const sunX = W * 0.5;
  const sunY = hz - h * 0.115;
  const sunR = Math.min(W, h) * 0.205;
  const glow = g.createRadialGradient(sunX, sunY, sunR * 0.1, sunX, sunY, sunR * 3.4);
  glow.addColorStop(0, 'rgba(255,110,150,0.42)');
  glow.addColorStop(0.45, 'rgba(255,46,136,0.16)');
  glow.addColorStop(1, 'rgba(255,46,136,0)');
  g.fillStyle = glow;
  g.fillRect(sunX - sunR * 3.4, sunY - sunR * 3.4, sunR * 6.8, sunR * 6.8);

  // 落日画在独立离屏画布上：先填渐变，再用 destination-out 切槽，最后贴回天空
  const pad = Math.ceil(sunR * 0.06) + 2;
  const scSize = Math.ceil((sunR + pad) * 2);
  const sc = document.createElement('canvas');
  sc.width = Math.ceil(scSize * dpr);
  sc.height = Math.ceil(scSize * dpr);
  const sg = sc.getContext('2d');
  sg.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = scSize / 2;
  const cy = scSize / 2;
  sg.beginPath();
  sg.arc(cx, cy, sunR, 0, TAU);
  sg.clip();
  const sunGrad = sg.createLinearGradient(0, cy - sunR, 0, cy + sunR);
  sunGrad.addColorStop(0.00, '#fff8c4');
  sunGrad.addColorStop(0.36, '#ffcb5c');
  sunGrad.addColorStop(0.70, '#ff7a6b');
  sunGrad.addColorStop(1.00, '#ff2e88');
  sg.fillStyle = sunGrad;
  sg.fillRect(cx - sunR, cy - sunR, sunR * 2, sunR * 2);
  sg.globalCompositeOperation = 'destination-out';
  const stepY = Math.max(3, sunR * 0.115);
  for (let y = cy + sunR * 0.02; y < cy + sunR; y += stepY) {
    const t = (y - (cy - sunR)) / (sunR * 2);
    sg.fillRect(cx - sunR, y, sunR * 2, stepY * (0.16 + t * 0.34));
  }
  g.drawImage(sc, sunX - cx, sunY - cy, scSize, scSize);

  // 山脊（两层）
  const ridge = (baseY, amp, color, rim) => {
    g.beginPath();
    g.moveTo(0, hz + 4);
    let x = 0;
    let y = baseY;
    g.lineTo(0, y);
    while (x < W) {
      x += rand(W * 0.02, W * 0.06);
      y = baseY + Math.sin(x * 0.008) * amp * 0.4 + rand(-amp, amp) * 0.5;
      g.lineTo(x, y);
    }
    g.lineTo(W, hz + 4);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    if (rim) {
      g.strokeStyle = rim;
      g.lineWidth = 1.4;
      g.stroke();
    }
  };
  g.globalAlpha = 0.9;
  ridge(hz - h * 0.055, h * 0.055, '#1a0533', 'rgba(122,60,255,0.35)');
  g.globalAlpha = 1;
  ridge(hz - h * 0.018, h * 0.032, '#0d0219', 'rgba(255,46,136,0.42)');

  // 地平线光带
  const hg = g.createLinearGradient(0, hz - h * 0.045, 0, hz + h * 0.02);
  hg.addColorStop(0, 'rgba(255,46,136,0)');
  hg.addColorStop(0.62, 'rgba(255,96,150,0.34)');
  hg.addColorStop(1, 'rgba(255,190,210,0.10)');
  g.fillStyle = hg;
  g.fillRect(0, hz - h * 0.045, W, h * 0.065);

  // 地面底色（会被路段覆盖，仅防止缝隙）
  const gr = g.createLinearGradient(0, hz, 0, h);
  gr.addColorStop(0, '#2a0a3e');
  gr.addColorStop(0.4, '#12061f');
  gr.addColorStop(1, '#05010a');
  g.fillStyle = gr;
  g.fillRect(0, hz - 1, W, h - hz + 1);
}

/* -------------------------------------------------------------- 3. 赛道生成 */
const segments = [];
let trackPieces = 0;

const lastY = () => (segments.length ? segments[segments.length - 1].p2.world.y : 0);

function addSegment(curve, y) {
  const n = segments.length;
  const seg = {
    index: n,
    p1: { world: { x: 0, y: lastY(), z: n * CFG.segLen }, camera: {}, screen: {} },
    p2: { world: { x: 0, y, z: (n + 1) * CFG.segLen }, camera: {}, screen: {} },
    curve,
    color: Math.floor(n / CFG.rumbleLen) % 2 ? COL.light : COL.dark,
    props: [],
  };
  if (n % 6 === 0) {
    seg.props.push({ type: 'pylon', x: -1.36, h: 3400, w: 190, side: -1 });
    seg.props.push({ type: 'pylon', x: 1.36, h: 3400, w: 190, side: 1 });
  }
  segments.push(seg);
}

function addRoad(enter, hold, leave, curve, y) {
  const startY = lastY();
  const endY = startY + y * CFG.segLen;
  const total = enter + hold + leave;
  for (let n = 0; n < enter; n++) addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
  for (let n = 0; n < hold; n++) addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
  for (let n = 0; n < leave; n++) addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
}

function appendPiece(difficulty) {
  const r = Math.random();
  const len = randInt(40, 90);
  const bend = lerp(2.2, 5.4, difficulty) * pick([-1, 1]);
  if (r < 0.30 || trackPieces < 2) {
    addRoad(len, len, len, 0, 0);
  } else if (r < 0.66) {
    addRoad(len, len, len, bend, 0);
  } else if (r < 0.86) {
    addRoad(len, len, len, 0, rand(10, 34) * pick([-1, 1]));
  } else {
    // S 弯
    addRoad(len, len, len, bend, 0);
    addRoad(len, len, len, -bend, 0);
  }
  trackPieces++;
}

function ensureTrack(zAhead) {
  const need = Math.ceil((zAhead + CFG.drawDistance * CFG.segLen + CFG.segLen * 40) / CFG.segLen);
  const diff = clamp(player.z / 180000, 0, 1);
  while (segments.length < need) appendPiece(diff);
}

function findSegment(z) {
  const i = clamp(Math.floor(z / CFG.segLen), 0, segments.length - 1);
  return segments[i];
}

/* ------------------------------------------------------------- 4. 透视投影 */
function project(p, camX, camY, camZ, width, height, horizon) {
  const c = p.camera;
  c.x = (p.world.x || 0) - camX;
  c.y = (p.world.y || 0) - camY;
  c.z = (p.world.z || 0) - camZ;
  const s = (p.screen.scale = CFG.cameraDepth / c.z);
  p.screen.x = width / 2 + s * c.x * (width / 2);
  p.screen.y = horizon - s * c.y * (height / 2);
  p.screen.w = s * CFG.roadWidth * (width / 2);
}

/* --------------------------------------------------------------- 5. 游戏态 */
const player = {
  x: 0,
  z: 3200,
  speed: 0,
  shields: 3,
  mult: 1,
  score: 0,
  boost: 100,
  invuln: 0,
  drifting: false,
  boosting: false,
  offRoad: false,
  combo: 0,
  sinceEvent: 0,
  startZ: 3200,
};
let entities = [];
let particles = [];
let streaks = [];
let nextSpawnZ = 0;
let shake = 0;
let flashT = 0;
let state = 'title'; // title | playing | paused | over
let elapsed = 0;
let bestScore = Number(localStorage.getItem('neondrift.best') || 0) || 0;
let bestDist = Number(localStorage.getItem('neondrift.dist') || 0) || 0;

const keys = { left: false, right: false, up: false, down: false, boost: false, drift: false };

/* --------------------------------------------------------------- 6. 生成物 */
function spawnPattern(z) {
  const diff = clamp((z - 3200) / 170000, 0, 1);
  const r = Math.random();
  const laneCount = r < 0.58 - diff * 0.22 ? 1 : r < 0.95 - diff * 0.08 ? 2 : 3;
  const lanes = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, laneCount);
  const groupOffset = rand(-0.05, 0.05);

  for (const lane of lanes) {
    const isBarrier = diff > 0.12 && Math.random() < 0.14 + diff * 0.12;
    if (isBarrier) {
      entities.push({
        type: 'barrier', z: z + rand(-160, 160), x: CFG.laneX[lane] + groupOffset,
        speed: 0, w: 780, h: 480, passed: false, hit: false, color: '#ff2e88',
      });
    } else {
      entities.push({
        type: 'car', z: z + rand(-160, 160), x: CFG.laneX[lane] + groupOffset,
        speed: CFG.maxSpeed * rand(0.10, 0.32), w: 800, h: 720,
        passed: false, hit: false, color: pick(TRAFFIC_COLORS), sway: rand(0, TAU),
      });
    }
  }

  // 空车道放能量球
  const free = [0, 1, 2, 3].filter((l) => !lanes.includes(l));
  if (free.length) {
    const lane = pick(free);
    const count = randInt(2, 4);
    for (let i = 0; i < count; i++) {
      entities.push({
        type: 'orb', z: z + 900 + i * 620, x: CFG.laneX[lane],
        speed: 0, w: 380, h: 380, passed: false, hit: false, color: '#2ef2ff', phase: rand(0, TAU),
      });
    }
  }
}

function spawnAhead() {
  const diff = clamp((player.z - 3200) / 170000, 0, 1);
  const horizonZ = player.z + CFG.drawDistance * CFG.segLen * 0.9;
  let guard = 0;
  while (nextSpawnZ < horizonZ && guard++ < 40) {
    spawnPattern(nextSpawnZ);
    nextSpawnZ += lerp(15000, 6200, diff) + rand(-1800, 2400);
  }
}

/* --------------------------------------------------------------- 7. 音效 */
const Sound = (() => {
  let ac = null;
  let master = null;
  let engine = null;
  let engineGain = null;
  let engineFilter = null;
  let noiseBuf = null;
  let musicOn = true;
  let muted = false;
  let musicTimer = null;
  let step = 0;
  let nextNote = 0;

  function makeNoise() {
    const len = ac.sampleRate * 0.9;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function init() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.85;
    master.connect(ac.destination);
    noiseBuf = makeNoise();

    // 引擎
    engineFilter = ac.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 500;
    engineFilter.Q.value = 7;
    engineGain = ac.createGain();
    engineGain.gain.value = 0;
    engineFilter.connect(engineGain).connect(master);

    engine = [0, 1, 2].map((i) => {
      const o = ac.createOscillator();
      o.type = i === 2 ? 'square' : 'sawtooth';
      o.detune.value = (i - 1) * 9;
      o.frequency.value = 44;
      const g = ac.createGain();
      g.gain.value = i === 2 ? 0.12 : 0.5;
      o.connect(g).connect(engineFilter);
      o.start();
      return o;
    });

    startMusic();
  }

  function setEngine(pct, boosting) {
    if (!ac || muted) return;
    const t = ac.currentTime;
    const base = 38 + pct * 86 + (boosting ? 22 : 0);
    engine.forEach((o, i) => o.frequency.setTargetAtTime(base * (1 + i * 0.505), t, 0.08));
    engineFilter.frequency.setTargetAtTime(280 + pct * 1500, t, 0.1);
    engineGain.gain.setTargetAtTime(muted ? 0 : 0.02 + pct * 0.035, t, 0.12);
  }

  function noise(dur, type, f0, f1, gain) {
    if (!ac || muted) return;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const filt = ac.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(f0, ac.currentTime);
    filt.frequency.exponentialRampToValueAtTime(Math.max(60, f1), ac.currentTime + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    src.connect(filt).connect(g).connect(master);
    src.start();
    src.stop(ac.currentTime + dur + 0.02);
  }

  function blip(freq, dur = 0.09, type = 'triangle', vol = 0.12, slide = 0) {
    if (!ac || muted) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  const BASS = [0, 0, 3, 0, 7, 0, 3, 0, 0, 0, 5, 0, 7, 10, 7, 5];
  function scheduleStep(i, t) {
    const root = 55; // A1
    const semis = BASS[i % 16];
    const f = root * Math.pow(2, semis / 12);
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const filt = ac.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(260 + (i % 4 === 0 ? 380 : 0), t);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    o.connect(filt).connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.22);

    if (i % 4 === 0) {
      const k = ac.createOscillator();
      k.type = 'sine';
      k.frequency.setValueAtTime(120, t);
      k.frequency.exponentialRampToValueAtTime(42, t + 0.16);
      const kg = ac.createGain();
      kg.gain.setValueAtTime(0.0001, t);
      kg.gain.exponentialRampToValueAtTime(0.24, t + 0.01);
      kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      k.connect(kg).connect(master);
      k.start(t);
      k.stop(t + 0.24);
    }
    if (i % 4 === 2) noise(0.05, 'highpass', 7000, 9000, 0.035);
  }

  function startMusic() {
    if (musicTimer || !ac) return;
    nextNote = ac.currentTime + 0.2;
    musicTimer = setInterval(() => {
      if (!ac || !musicOn || muted || state === 'paused') return;
      const stepDur = 60 / 116 / 2;
      while (nextNote < ac.currentTime + 0.3) {
        scheduleStep(step, nextNote);
        nextNote += stepDur;
        step = (step + 1) % 16;
      }
    }, 60);
  }

  return {
    init,
    setEngine,
    coin() { blip(880, 0.07, 'triangle', 0.09, 520); setTimeout(() => blip(1320, 0.08, 'triangle', 0.07, 180), 55); },
    whoosh() { noise(0.26, 'bandpass', 1900, 380, 0.16); },
    drift() { noise(0.1, 'highpass', 4200, 5200, 0.05); },
    crash() { noise(0.55, 'lowpass', 2200, 120, 0.5); blip(90, 0.3, 'sawtooth', 0.22, -50); },
    shieldLose() { blip(220, 0.18, 'square', 0.14, -90); },
    start() { blip(440, 0.1, 'square', 0.1, 240); setTimeout(() => blip(660, 0.12, 'square', 0.1, 240), 100); },
    toggleMute() {
      muted = !muted;
      if (muted && ac) engineGain.gain.setTargetAtTime(0, ac.currentTime, 0.05);
      return muted;
    },
    get muted() { return muted; },
  };
})();

/* --------------------------------------------------------------- 8. 粒子 */
function addParticle(p) {
  if (particles.length > 280) return;
  particles.push(p);
}

function burst(x, y, n, color, spread = 320, life = 0.7) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU);
    const sp = rand(0.25, 1) * spread;
    addParticle({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55 - 60,
      life, max: life, color, size: rand(1.2, 3.4), type: 'spark', gravity: 480,
    });
  }
}

function addStreak() {
  if (streaks.length > 90) return;
  const a = rand(0, TAU);
  streaks.push({ a, r: rand(0.1, 0.55), speed: rand(1.1, 2.4), life: 1, len: rand(0.04, 0.13) });
}

/* --------------------------------------------------------------- 9. 摄像机 */
function cameraZ() { return player.z - CFG.playerZ; }

/* ---------------------------------------------------------- 10. 世界渲染 */
function renderWorld() {
  const { w, h, horizon: hz } = view;

  // 远景（视差）
  ctx.drawImage(backdrop, -0.3 * w + bgShift, 0, w * 1.6, h);

  const camZ = cameraZ();
  const baseSeg = findSegment(camZ);
  const basePercent = (camZ - baseSeg.p1.world.z) / CFG.segLen;
  const playerSeg = findSegment(player.z);
  const playerPercent = clamp((player.z - playerSeg.p1.world.z) / CFG.segLen, 0, 1);
  const playerY = lerp(playerSeg.p1.world.y, playerSeg.p2.world.y, playerPercent);
  const camY = playerY + CFG.cameraHeight;
  const camX = player.x * CFG.roadWidth;

  let maxy = h;
  let x = 0;
  let dx = -(baseSeg.curve * basePercent);

  for (let n = 0; n < CFG.drawDistance; n++) {
    const seg = segments[baseSeg.index + n];
    if (!seg) break;

    project(seg.p1, camX - x, camY, camZ, w, h, hz);
    project(seg.p2, camX - x - dx, camY, camZ, w, h, hz);
    x += dx;
    dx += seg.curve;

    const p1 = seg.p1.screen;
    const p2 = seg.p2.screen;

    if (seg.p1.camera.z <= CFG.cameraDepth || p2.y >= p1.y || p2.y >= maxy) continue;

    const bandH = p1.y - p2.y;
    if (bandH > 0) {
      // 地面
      ctx.fillStyle = seg.color.ground;
      ctx.fillRect(0, p2.y, w, bandH + 1);

      // 地面网格线：横向滚动的霓虹细线
      if (seg.index % 4 === 0 && n < 130) {
        ctx.fillStyle = `rgba(255,46,136,${(0.14 * (1 - n / 130)).toFixed(3)})`;
        ctx.fillRect(0, p2.y, w, 1);
      }

      // 路面
      ctx.fillStyle = seg.color.road;
      ctx.beginPath();
      ctx.moveTo(p1.x - p1.w, p1.y);
      ctx.lineTo(p2.x - p2.w, p2.y);
      ctx.lineTo(p2.x + p2.w, p2.y);
      ctx.lineTo(p1.x + p1.w, p1.y);
      ctx.closePath();
      ctx.fill();

      // 路肩霓虹条（贴脸的路段不画，否则会在屏幕角落糊出一条巨大的斜带）
      const rw1 = p1.w * 0.055;
      const rw2 = p2.w * 0.055;
      if (p1.w < w * 2.4) {
        ctx.fillStyle = seg.color.rumble;
        ctx.beginPath();
        ctx.moveTo(p1.x - p1.w, p1.y);
        ctx.lineTo(p2.x - p2.w, p2.y);
        ctx.lineTo(p2.x - p2.w + rw2, p2.y);
        ctx.lineTo(p1.x - p1.w + rw1, p1.y);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(p1.x + p1.w, p1.y);
        ctx.lineTo(p2.x + p2.w, p2.y);
        ctx.lineTo(p2.x + p2.w - rw2, p2.y);
        ctx.lineTo(p1.x + p1.w - rw1, p1.y);
        ctx.closePath();
        ctx.fill();
      }

      // 车道虚线
      if (seg.index % 6 < 3) {
        ctx.fillStyle = 'rgba(226,206,255,0.42)';
        for (let l = 1; l < CFG.lanes; l++) {
          const off = (l / CFG.lanes) * 2 - 1;
          const a1 = p1.w * off * 0.98;
          const a2 = p2.w * off * 0.98;
          const dw1 = Math.max(0.7, p1.w * 0.014);
          const dw2 = Math.max(0.7, p2.w * 0.014);
          ctx.beginPath();
          ctx.moveTo(p1.x + a1 - dw1, p1.y);
          ctx.lineTo(p2.x + a2 - dw2, p2.y);
          ctx.lineTo(p2.x + a2 + dw2, p2.y);
          ctx.lineTo(p1.x + a1 + dw1, p1.y);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // 远处雾化
    const fogN = clamp(n / CFG.drawDistance, 0, 1);
    if (fogN > 0.12) {
      const a = Math.pow((fogN - 0.12) / 0.88, 1.7) * 0.92;
      ctx.fillStyle = `rgba(${FOG_RGB},${a.toFixed(3)})`;
      ctx.fillRect(0, p2.y, w, bandH + 1);
    }

    maxy = p2.y;
  }

  /* ---- 立体物件统一后画：按由远及近排序，避免被更远的路段盖住上半身 ---- */
  const paint = [];
  const lastIdx = Math.min(baseSeg.index + CFG.drawDistance, segments.length) - 1;

  for (let i = baseSeg.index; i <= lastIdx; i++) {
    const seg = segments[i];
    if (!seg || !seg.props.length) continue;
    if (seg.p1.screen.scale > 0) paint.push({ kind: 'prop', seg, z: seg.p1.world.z, item: seg.props });
  }

  for (const e of entities) {
    if (e.dead) continue;
    const si = Math.floor(e.z / CFG.segLen);
    if (si < baseSeg.index || si > lastIdx) continue;
    const seg = segments[si];
    if (seg.p1.screen.scale > 0) paint.push({ kind: 'ent', seg, z: e.z, item: e });
  }

  paint.sort((a, b) => b.z - a.z);

  for (const p of paint) {
    if (p.kind === 'prop') {
      for (const pr of p.item) drawProp(pr, p.seg, w, h);
    } else {
      drawEntity(p.item, p.seg, w, h);
    }
  }
}

/* ---------------------------------------------------------- 11. 道具绘制 */
function drawProp(pr, seg, w, h) {
  const s = seg.p1.screen;
  const scale = s.scale;
  if (scale <= 0) return;
  const sw = pr.w * scale * (w / 2);
  const sh = pr.h * scale * (h / 2);
  if (sw < 0.7 || sh < 2) return;
  const sx = s.x + scale * (pr.x * CFG.roadWidth) * (w / 2);
  const sy = s.y;

  ctx.save();
  ctx.translate(sx, sy);

  if (pr.type === 'pylon') {
    const postW = Math.max(1, sw * 0.18);
    const grd = ctx.createLinearGradient(0, -sh, 0, 0);
    grd.addColorStop(0, 'rgba(255,46,136,0.95)');
    grd.addColorStop(0.5, 'rgba(255,46,136,0.45)');
    grd.addColorStop(1, 'rgba(122,60,255,0.15)');
    ctx.fillStyle = grd;
    ctx.fillRect(-postW / 2, -sh, postW, sh);
    // 灯头
    const r = Math.max(1.2, sw * 0.5);
    const glow = ctx.createRadialGradient(0, -sh, 0, 0, -sh, r * 3.4);
    glow.addColorStop(0, 'rgba(255,209,102,0.95)');
    glow.addColorStop(0.35, 'rgba(255,46,136,0.42)');
    glow.addColorStop(1, 'rgba(255,46,136,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -sh, r * 3.4, 0, TAU);
    ctx.fill();
  } else if (pr.type === 'arch') {
    const halfW = scale * CFG.roadWidth * 1.06 * (w / 2);
    const barH = Math.max(1.5, sh * 0.014);
    ctx.strokeStyle = 'rgba(46,242,255,0.9)';
    ctx.lineWidth = barH;
    ctx.beginPath();
    ctx.moveTo(-halfW, 0);
    ctx.lineTo(-halfW, -sh);
    ctx.lineTo(halfW, -sh);
    ctx.lineTo(halfW, 0);
    ctx.stroke();
    // 顶部与两角的灯点
    ctx.globalCompositeOperation = 'lighter';
    const dot = Math.max(1.2, barH * 1.6);
    for (const [dx, dy] of [[-halfW, -sh], [halfW, -sh], [0, -sh]]) {
      const g2 = ctx.createRadialGradient(dx, dy, 0, dx, dy, dot * 6);
      g2.addColorStop(0, 'rgba(210,255,255,0.9)');
      g2.addColorStop(0.35, 'rgba(46,242,255,0.4)');
      g2.addColorStop(1, 'rgba(46,242,255,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(dx, dy, dot * 6, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}

/* ---------------------------------------------------------- 12. 实体绘制 */
function drawEntity(e, seg, w, h) {
  const s = seg.p1.screen;
  const scale = s.scale;
  if (scale <= 0) return;
  const dCam = e.z - cameraZ();
  if (dCam < 220) return;

  const sw = e.w * scale * (w / 2);
  const sh = e.h * scale * (h / 2);
  if (sw < 1.6 || sh < 2) return;

  const sx = s.x + scale * (e.x * CFG.roadWidth) * (w / 2);
  const sy = s.y;
  if (sx < -sw * 2 || sx > w + sw * 2) return;

  // 远处物件渐隐，避免消失点糊成一团
  const far = CFG.drawDistance * CFG.segLen;
  const alpha = clamp(1 - (dCam - far * 0.45) / (far * 0.45), 0, 1);
  if (alpha <= 0.02) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, sy);

  if (e.type === 'orb') {
    drawOrb(sw, sh, e);
  } else if (e.type === 'barrier') {
    drawBarrier(sw, sh, e);
  } else {
    drawCar(sw, sh, e.color, false, 0, false);
  }

  ctx.restore();
}

function drawOrb(sw, sh, e) {
  const r = Math.max(1.5, sh * 0.22);
  const pulse = 1 + Math.sin(elapsed * 6 + e.phase) * 0.1;
  const y = -sh * 0.55;
  const glow = ctx.createRadialGradient(0, y, r * 0.2, 0, y, r * 3.6 * pulse);
  glow.addColorStop(0, 'rgba(180,255,255,0.95)');
  glow.addColorStop(0.3, 'rgba(46,242,255,0.55)');
  glow.addColorStop(1, 'rgba(46,242,255,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, y, r * 3.6 * pulse, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#eaffff';
  ctx.beginPath();
  ctx.arc(0, y, r * 0.55, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

function drawBarrier(sw, sh, e) {
  const w = sw;
  const h = sh;
  ctx.fillStyle = 'rgba(10,2,16,0.9)';
  ctx.fillRect(-w / 2, -h, w, h);
  // 斜纹
  ctx.save();
  ctx.beginPath();
  ctx.rect(-w / 2, -h, w, h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,46,136,0.9)';
  ctx.lineWidth = Math.max(2, w * 0.07);
  for (let i = -h; i < w + h; i += Math.max(6, w * 0.22)) {
    ctx.beginPath();
    ctx.moveTo(-w / 2 + i, 0);
    ctx.lineTo(-w / 2 + i + h, -h);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,150,190,0.95)';
  ctx.lineWidth = Math.max(1.2, w * 0.03);
  ctx.strokeRect(-w / 2, -h, w, h);
}

/* 车尾视角：玩家与 NPC 共用 */
function drawCar(sw, sh, color, isPlayer, tilt, braking) {
  const w = sw;
  const h = sh;
  const x0 = -w / 2;

  ctx.save();
  if (tilt) {
    ctx.translate(0, -h * 0.04);
    ctx.rotate(tilt);
    ctx.translate(0, h * 0.04);
  }

  // 地面阴影
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.012, w * 0.52, h * 0.075, 0, 0, TAU);
  ctx.fill();

  // 车底霓虹
  ctx.globalCompositeOperation = 'lighter';
  const ug = ctx.createRadialGradient(0, -h * 0.03, 0, 0, -h * 0.03, w * 0.6);
  ug.addColorStop(0, isPlayer ? 'rgba(46,242,255,0.5)' : 'rgba(255,46,136,0.16)');
  ug.addColorStop(1, 'rgba(46,242,255,0)');
  ctx.fillStyle = ug;
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.02, w * 0.6, h * 0.13, 0, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // 后轮
  ctx.fillStyle = '#0a0611';
  const tw = w * 0.105;
  const th = h * 0.23;
  ctx.beginPath();
  ctx.roundRect(x0 + w * 0.015, -th, tw, th, w * 0.03);
  ctx.roundRect(x0 + w * 0.985 - tw, -th, tw, th, w * 0.03);
  ctx.fill();

  // 车身
  const body = ctx.createLinearGradient(0, -h * 0.55, 0, 0);
  body.addColorStop(0, shade(color, isPlayer ? 0.12 : 0.28));
  body.addColorStop(0.45, shade(color, isPlayer ? 0 : 0.02));
  body.addColorStop(0.85, shade(color, isPlayer ? -0.42 : -0.28));
  body.addColorStop(1, shade(color, isPlayer ? -0.7 : -0.55));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x0 + w * 0.03, 0);
  ctx.lineTo(x0 + w * 0.035, -h * 0.38);
  ctx.lineTo(x0 + w * 0.085, -h * 0.5);
  ctx.lineTo(x0 + w * 0.915, -h * 0.5);
  ctx.lineTo(x0 + w * 0.965, -h * 0.38);
  ctx.lineTo(x0 + w * 0.97, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = isPlayer ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.22)';
  ctx.lineWidth = Math.max(0.6, h * 0.012);
  ctx.stroke();

  // 肩线
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = Math.max(0.8, h * 0.012);
  ctx.beginPath();
  ctx.moveTo(x0 + w * 0.085, -h * 0.5);
  ctx.lineTo(x0 + w * 0.915, -h * 0.5);
  ctx.stroke();

  // 座舱
  const roof = ctx.createLinearGradient(0, -h * 0.9, 0, -h * 0.5);
  roof.addColorStop(0, shade(color, -0.12));
  roof.addColorStop(1, shade(color, -0.52));
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(x0 + w * 0.15, -h * 0.5);
  ctx.lineTo(x0 + w * 0.235, -h * 0.88);
  ctx.lineTo(x0 + w * 0.765, -h * 0.88);
  ctx.lineTo(x0 + w * 0.85, -h * 0.5);
  ctx.closePath();
  ctx.fill();

  // 后窗
  const glass = ctx.createLinearGradient(0, -h * 0.84, 0, -h * 0.54);
  glass.addColorStop(0, 'rgba(28,10,48,0.98)');
  glass.addColorStop(0.45, 'rgba(96,50,150,0.72)');
  glass.addColorStop(1, 'rgba(10,3,20,0.98)');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.moveTo(x0 + w * 0.195, -h * 0.545);
  ctx.lineTo(x0 + w * 0.265, -h * 0.835);
  ctx.lineTo(x0 + w * 0.735, -h * 0.835);
  ctx.lineTo(x0 + w * 0.805, -h * 0.545);
  ctx.closePath();
  ctx.fill();

  // 车顶高光
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(x0 + w * 0.26, -h * 0.885, w * 0.48, Math.max(0.7, h * 0.012));

  // NPC 车顶示宽灯，远距离更醒目
  if (!isPlayer && w > 70) {
    ctx.fillStyle = 'rgba(255,214,140,0.95)';
    ctx.fillRect(x0 + w * 0.44, -h * 0.905, w * 0.12, Math.max(1, h * 0.022));
  }

  // 尾灯
  const ly = -h * 0.31;
  const lh = Math.max(1.2, h * 0.062);
  ctx.globalCompositeOperation = 'lighter';
  const glowR = ctx.createRadialGradient(0, ly, 0, 0, ly, w * 0.62);
  glowR.addColorStop(0, braking ? 'rgba(255,70,90,0.62)' : 'rgba(255,46,94,0.45)');
  glowR.addColorStop(1, 'rgba(255,46,94,0)');
  ctx.fillStyle = glowR;
  ctx.fillRect(-w * 0.7, ly - h * 0.24, w * 1.4, h * 0.4);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = braking ? '#ffd0d8' : '#ff2450';
  ctx.fillRect(x0 + w * 0.12, ly, w * 0.76, lh);
  ctx.fillStyle = 'rgba(255,240,245,0.95)';
  ctx.fillRect(x0 + w * 0.155, ly + lh * 0.3, w * 0.06, lh * 0.34);
  ctx.fillRect(x0 + w * 0.785, ly + lh * 0.3, w * 0.06, lh * 0.34);
  ctx.globalCompositeOperation = 'source-over';

  // 尾部扩散器灯（玩家专属的高光细节）
  if (isPlayer) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(46,242,255,0.5)';
    ctx.fillRect(x0 + w * 0.3, -h * 0.07, w * 0.4, Math.max(1, h * 0.012));
    ctx.globalCompositeOperation = 'source-over';
  }

  // 保险杠 / 扩散器
  ctx.fillStyle = 'rgba(8,2,14,0.9)';
  ctx.fillRect(x0 + w * 0.05, -h * 0.11, w * 0.9, h * 0.11);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(x0 + w * (0.24 + i * 0.11), -h * 0.1, w * 0.012, h * 0.08);
  }

  ctx.restore();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const f = (v) => clamp(Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt)), 0, 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/* --------------------------------------------------------- 13. 玩家与特效 */
function drawPlayerCar(w, h) {
  const baseW = Math.min(w * 0.185, 250);
  const sw = baseW;
  const sh = baseW * 0.68;
  const speedPct = player.speed / CFG.maxSpeed;
  const bob = Math.sin(elapsed * 26) * speedPct * 2.4 + Math.sin(elapsed * 11) * 0.8;
  const tilt = clamp(player.tilt || 0, -0.14, 0.14);
  const y = h - h * 0.05 + bob;
  const x = w / 2 - (player.tilt || 0) * w * 0.02;

  if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) {
    ctx.globalAlpha = 0.45;
  }

  // 氮气尾焰
  if (player.boosting) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'lighter';
    for (const dx of [-sw * 0.22, sw * 0.22]) {
      const len = sh * rand(0.5, 0.95);
      const fg = ctx.createLinearGradient(0, 0, 0, len);
      fg.addColorStop(0, 'rgba(255,255,255,0.95)');
      fg.addColorStop(0.3, 'rgba(46,242,255,0.85)');
      fg.addColorStop(1, 'rgba(255,46,136,0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(dx - sw * 0.07, -sh * 0.02);
      ctx.lineTo(dx, len);
      ctx.lineTo(dx + sw * 0.07, -sh * 0.02);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.save();
  ctx.translate(x, y);
  drawCar(sw, sh, '#14c8e6', true, tilt, keys.down);
  ctx.restore();

  ctx.globalAlpha = 1;
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    const a = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = a;
    if (p.type === 'smoke') {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (2 - a), 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawStreaks(w, h) {
  if (!streaks.length) return;
  const cx = w / 2;
  const cy = view.horizon * 0.96;
  const R = Math.hypot(w, h) * 0.62;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of streaks) {
    const r1 = s.r * R;
    const r2 = (s.r + s.len) * R;
    const a = s.life * 0.5;
    ctx.strokeStyle = `rgba(190,245,255,${a.toFixed(3)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1 * 0.75);
    ctx.lineTo(cx + Math.cos(s.a) * r2, cy + Math.sin(s.a) * r2 * 0.75);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------------------------------------------------------- 14. 主渲染帧 */
function render() {
  const { w, h } = view;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

  ctx.save();
  if (shake > 0.4) ctx.translate(rand(-shake, shake), rand(-shake, shake));

  renderWorld();

  // 速度感：侧向光线
  drawStreaks(w, h);

  // 玩家车
  if (state === 'playing' || state === 'paused') drawPlayerCar(w, h);

  // 粒子
  drawParticles();

  ctx.restore();

  // 暗角
  const vig = ctx.createRadialGradient(w / 2, h * 0.52, Math.min(w, h) * 0.32, w / 2, h * 0.52, Math.max(w, h) * 0.78);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(2,0,6,0.72)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  if (flashT > 0) {
    ctx.fillStyle = `rgba(255,46,94,${(flashT * 0.32).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/* ------------------------------------------------------------ 15. 更新逻辑 */
function update(dt) {
  elapsed += dt;

  if (state === 'title') {
    // 标题界面：空无一车的公路巡游，画面留给标题
    player.z += 3600 * dt;
    player.x = Math.sin(elapsed * 0.42) * 0.55;
    ensureTrack(player.z);
    bgShift = clamp(bgShift + Math.sin(elapsed * 0.42 + 1.2) * 0.6, -view.w * 0.3, view.w * 0.3);
    updateParticles(dt);
    return;
  }

  if (state !== 'playing') {
    updateParticles(dt);
    shake *= Math.pow(0.02, dt);
    return;
  }

  const maxSpeed = CFG.maxSpeed;
  const speedPct = player.speed / maxSpeed;
  const seg = findSegment(player.z);

  /* --- 速度 --- */
  let target = maxSpeed * 0.76;
  if (keys.up) target = maxSpeed;
  if (keys.down) target = maxSpeed * 0.24;
  player.boosting = keys.boost && player.boost > 1;
  if (player.boosting) {
    target = maxSpeed * 1.34;
    player.boost = Math.max(0, player.boost - 30 * dt);
  } else {
    player.boost = Math.min(100, player.boost + 4.2 * dt);
  }

  const accel = maxSpeed / 3.4;
  if (player.speed < target) player.speed = Math.min(target, player.speed + accel * dt);
  else player.speed = Math.max(target, player.speed - (maxSpeed / 2.4) * dt);

  /* --- 转向 --- */
  let steerInput = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (!steerInput) steerInput = pointerSteer;
  player.drifting = keys.drift && speedPct > 0.22;
  const steerRate = 1.45 * (player.drifting ? 1.55 : 1) * (0.42 + speedPct * 0.78);
  player.x += steerInput * steerRate * dt;

  // 离心力：弯道把车甩向外侧（漂移时甩得更狠）
  const centri = seg.curve * speedPct * dt * (player.drifting ? 0.085 : 0.055);
  player.x -= centri;

  // 平滑转向视觉倾角
  const targetTilt = -steerInput * 0.11 + seg.curve * 0.012;
  player.tilt = lerp(player.tilt || 0, targetTilt, 1 - Math.pow(0.0008, dt));

  player.offRoad = Math.abs(player.x) > 1;
  if (player.offRoad) {
    player.speed = Math.max(maxSpeed * 0.26, player.speed - (maxSpeed / 1.6) * dt);
    if (Math.random() < 0.55) {
      burst(view.w / 2 + rand(-120, 120), view.h * 0.94, 1, 'rgba(120,90,150,0.55)', 120, 0.5);
    }
  }
  player.x = clamp(player.x, -2.1, 2.1);

  /* --- 前进 --- */
  player.z += player.speed * dt;
  ensureTrack(player.z);
  spawnAhead();

  /* --- 分数 --- */
  player.sinceEvent += dt;
  if (player.sinceEvent > 3.4) player.mult = Math.max(1, player.mult - 0.42 * dt);
  player.score += speedPct * 120 * player.mult * dt;

  /* --- 漂移特效 --- */
  if (player.drifting && speedPct > 0.3) {
    if (Math.random() < 0.75) {
      const px = view.w / 2 + (steerInput > 0 ? -1 : 1) * rand(40, 110);
      burst(px, view.h * 0.94, 1, 'rgba(255,190,120,0.85)', 160, 0.45);
    }
    if (Math.random() < 0.25) Sound.drift();
    player.score += speedPct * 40 * player.mult * dt;
  }

  /* --- 氮气拖尾 --- */
  if (player.boosting) {
    for (let i = 0; i < 2; i++) addStreak();
    shake = Math.max(shake, 2.2);
  }

  /* --- 实体 --- */
  updateEntities(dt, true);
  updateParticles(dt);

  /* --- 计时器 --- */
  player.invuln = Math.max(0, player.invuln - dt);
  shake = Math.max(0, shake - dt * 34);
  flashT = Math.max(0, flashT - dt * 2.6);
  bgShift = clamp(bgShift * (1 - dt * 1.4) - seg.curve * speedPct * dt * 5.5, -view.w * 0.3, view.w * 0.3);

  Sound.setEngine(speedPct, player.boosting);
  updateHud();
}

function updateEntities(dt, live) {
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    if (e.dead) { entities.splice(i, 1); continue; }

    if (e.speed) e.z += e.speed * dt;

    if (!live) continue;

    const dz = e.z - player.z;
    if (dz < -2600) { entities.splice(i, 1); continue; }

    const dx = Math.abs(e.x - player.x);
    // 扫掠检测：这一帧从车前穿到车后也算碰到，避免高速/掉帧时"穿模"
    const prevDz = e.prevDz === undefined ? dz : e.prevDz;
    const crossed = prevDz > 0 && dz <= 0;
    e.prevDz = dz;

    if (e.type === 'orb') {
      if ((crossed || Math.abs(dz) < 380) && dx < 0.34) {
        e.dead = true;
        player.boost = Math.min(100, player.boost + 16);
        player.mult = Math.min(9, player.mult + 0.06);
        player.score += 14 * player.mult;
        player.sinceEvent = 0;
        Sound.coin();
        burst(view.w / 2 - (player.x - e.x) * 260, view.h * 0.72, 10, 'rgba(46,242,255,0.95)', 260, 0.5);
        if (Math.random() < 0.4) toast('+NITRO', 'cyan');
      }
      continue;
    }

    // 车 / 障碍
    if ((crossed || Math.abs(dz) < 240) && dx < 0.19 && player.invuln <= 0) {
      e.dead = true;
      hitObstacle(e);
      continue;
    }

    if (!e.passed && dz < 0) {
      e.passed = true;
      if (dx >= 0.19 && dx < 0.55) nearMiss(dx);
    }
  }
}

function nearMiss(dx) {
  player.combo++;
  player.mult = Math.min(9, player.mult + 0.22);
  player.sinceEvent = 0;
  const pts = Math.round(28 * player.mult);
  player.score += pts;
  player.boost = Math.min(100, player.boost + 7);
  Sound.whoosh();
  toast(`擦身 +${pts}`);
  shake = Math.max(shake, 3.5);
  const side = Math.random() < 0.5 ? 0.22 : 0.78;
  burst(view.w * side, view.h * 0.78, 8, 'rgba(255,179,71,0.9)', 300, 0.55);
}

function hitObstacle(e) {
  player.shields -= 1;
  player.invuln = 1.7;
  player.speed *= 0.45;
  player.mult = 1;
  player.combo = 0;
  shake = 22;
  flashT = 1;
  Sound.crash();
  burst(view.w / 2, view.h * 0.8, 34, 'rgba(255,120,60,0.95)', 620, 0.85);
  burst(view.w / 2, view.h * 0.8, 16, 'rgba(255,46,136,0.95)', 480, 0.95);

  const bars = document.querySelectorAll('#shields i');
  bars.forEach((b, i) => b.classList.toggle('off', i > player.shields - 1));

  if (player.shields < 0) gameOver();
  else toast(`-1 SHIELD`, 'cyan');
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += (p.gravity || 0) * dt;
    p.vx *= 1 - dt * 0.9;
  }
  for (let i = streaks.length - 1; i >= 0; i--) {
    const s = streaks[i];
    s.r += s.speed * dt * 1.4;
    s.life -= dt * 1.5;
    if (s.life <= 0) streaks.splice(i, 1);
  }
}

/* ------------------------------------------------------------ 16. HUD / UI */
const el = {
  hud: document.getElementById('hud'),
  score: document.getElementById('score'),
  best: document.getElementById('best'),
  mult: document.getElementById('mult'),
  speed: document.getElementById('speed'),
  nitro: document.getElementById('nitrofill'),
  nitroWrap: document.querySelector('.nitro'),
  toasts: document.getElementById('toasts'),
  hint: document.getElementById('hint'),
  overlay: document.getElementById('overlay'),
  screenTitle: document.getElementById('screen-title'),
  screenPause: document.getElementById('screen-pause'),
  screenOver: document.getElementById('screen-over'),
  finalScore: document.getElementById('finalScore'),
  finalDist: document.getElementById('finalDist'),
  finalBest: document.getElementById('finalBest'),
  finalRank: document.getElementById('finalRank'),
  flash: document.getElementById('flash'),
};

let lastMult = 1;

function updateHud() {
  el.score.textContent = fmt(player.score);
  el.best.textContent = fmt(Math.max(bestScore, player.score));
  el.speed.textContent = Math.round((player.speed / CFG.maxSpeed) * 322);
  el.mult.textContent = player.mult.toFixed(1);
  el.nitro.style.width = `${clamp(player.boost, 0, 100)}%`;
  el.nitroWrap.classList.toggle('burn', player.boosting);

  if (player.mult > lastMult + 0.15) {
    el.mult.classList.add('bump');
    setTimeout(() => el.mult.classList.remove('bump'), 130);
  }
  lastMult = player.mult;

  if (flashT > 0) el.flash.style.opacity = String(clamp(flashT, 0, 1));
  else el.flash.style.opacity = '0';
}

function toast(text, cls = '') {
  const d = document.createElement('div');
  d.className = `toast ${cls}`;
  d.textContent = text;
  while (el.toasts.children.length >= 3) el.toasts.firstElementChild.remove();
  el.toasts.appendChild(d);
  setTimeout(() => d.remove(), 1150);
}

function showScreen(which) {
  [el.screenTitle, el.screenPause, el.screenOver].forEach((s) => {
    s.classList.remove('active');
    s.classList.add('is-hidden');
  });
  if (which) {
    which.classList.remove('is-hidden');
    which.classList.add('active');
    el.overlay.classList.remove('is-hidden');
    el.overlay.classList.toggle('dim', which !== el.screenTitle);
  } else {
    el.overlay.classList.add('is-hidden');
  }
}

/* --------------------------------------------------------------- 17. 状态 */
function resetRun() {
  player.x = 0;
  player.z = 3200;
  player.speed = 0;
  player.shields = 3;
  player.mult = 1;
  player.score = 0;
  player.boost = 100;
  player.invuln = 0;
  player.combo = 0;
  player.sinceEvent = 0;
  player.tilt = 0;
  entities = [];
  particles = [];
  streaks = [];
  shake = 0;
  flashT = 0;
  nextSpawnZ = player.z + 6200;
  state = 'playing';
  lastMult = 1;
  document.querySelectorAll('#shields i').forEach((b) => b.classList.remove('off'));
  el.hint.classList.remove('fade');
  setTimeout(() => el.hint.classList.add('fade'), 9000);
  updateHud();
}

function startGame() {
  Sound.init();
  Sound.start();
  resetRun();
  showScreen(null);
  updateRotateHint();
  el.hud.classList.remove('is-hidden');
}

function gameOver() {
  state = 'over';
  const dist = Math.max(0, (player.z - player.startZ) * M_PER_UNIT / 1000);
  bestScore = Math.max(bestScore, player.score);
  bestDist = Math.max(bestDist, dist);
  localStorage.setItem('neondrift.best', String(Math.floor(bestScore)));
  localStorage.setItem('neondrift.dist', String(Math.floor(bestDist)));

  el.finalScore.textContent = fmt(player.score);
  el.finalDist.innerHTML = `${dist < 10 ? dist.toFixed(1) : Math.round(dist)}<small>km</small>`;
  el.finalBest.textContent = fmt(bestScore);
  el.finalRank.textContent = rankFor(player.score);
  el.hud.classList.add('is-hidden');
  showScreen(el.screenOver);
  updateRotateHint();
  Sound.setEngine(0, false);
}

function rankFor(score) {
  if (score > 12000) return '夜之城传说 · 你已经不在地面上了';
  if (score > 8000) return '霓虹猎人 · 车流只是背景板';
  if (score > 5000) return '老练车手 · 再快一点就完美了';
  if (score > 2500) return '初露锋芒 · 有点内味了';
  if (score > 800) return '新手上路 · 先学会活着';
  return '刚出炉 · 再来一局';
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  showScreen(el.screenPause);
  Sound.setEngine(0, false);
}

function resumeGame() {
  if (state !== 'paused') return;
  state = 'playing';
  showScreen(null);
}

/* --------------------------------------------------------------- 18. 输入 */
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', KeyD: 'right', d: 'right', D: 'right',
  ArrowUp: 'up', KeyW: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', KeyS: 'down', s: 'down', S: 'down',
  ShiftLeft: 'boost', ShiftRight: 'boost', Shift: 'boost',
  Space: 'drift', ' ': 'drift',
};
const lookupKey = (e) => KEYMAP[e.code] || KEYMAP[e.key] || null;

window.addEventListener('keydown', (e) => {
  const k = lookupKey(e);
  if (e.repeat) {
    if (k) e.preventDefault();
    return;
  }
  if (k) {
    keys[k] = true;
    e.preventDefault();
    if (state === 'title') startGame();
    return;
  }
  if (e.code === 'Enter' || e.key === 'Enter') {
    e.preventDefault();
    if (state === 'title' || state === 'over' || state === 'paused') startGame();
    return;
  }
  if (e.code === 'KeyP' || e.key === 'p' || e.key === 'P' || e.code === 'Escape' || e.key === 'Escape') {
    e.preventDefault();
    if (state === 'playing') pauseGame();
    else if (state === 'paused') resumeGame();
    return;
  }
  if (e.code === 'KeyM' || e.key === 'm' || e.key === 'M') {
    const m = Sound.toggleMute();
    toast(m ? '静音' : '声音开', 'cyan');
  }
});

window.addEventListener('keyup', (e) => {
  const k = lookupKey(e);
  if (k) {
    keys[k] = false;
    e.preventDefault();
  }
});

window.addEventListener('blur', () => {
  keys.left = keys.right = keys.up = keys.down = keys.boost = keys.drift = false;
  if (state === 'playing') pauseGame();
});

// 触屏 / 鼠标：按在屏幕左半边左转、右半边右转；标题界面点一下就开始
let pointerSteer = 0;
function setPointer(e) {
  if (state !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  if (x < 0.42) pointerSteer = -1;
  else if (x > 0.58) pointerSteer = 1;
  else pointerSteer = 0;
}
canvas.addEventListener('pointerdown', (e) => {
  if (state === 'title') { startGame(); return; }
  if (state === 'over') { startGame(); return; }
  setPointer(e);
});
canvas.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') setPointer(e); });
canvas.addEventListener('pointerup', () => { pointerSteer = 0; });
canvas.addEventListener('pointercancel', () => { pointerSteer = 0; });
canvas.addEventListener('pointerleave', () => { pointerSteer = 0; });

document.getElementById('startBtn').addEventListener('click', (e) => { e.stopPropagation(); startGame(); });
document.getElementById('againBtn').addEventListener('click', (e) => { e.stopPropagation(); startGame(); });
document.getElementById('resumeBtn').addEventListener('click', (e) => { e.stopPropagation(); resumeGame(); });
// 触屏点按暂停界面任意位置即继续（手机上没 P 键）
el.screenPause.addEventListener('pointerdown', () => { if (state === 'paused') resumeGame(); });

/* ---------------------------------------------------------------- 19. 主循环 */
let lastT = performance.now();
let fpsFrames = 0;
let fpsAcc = 0;
let fpsVal = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  fpsFrames++;
  fpsAcc += dt;
  if (fpsAcc >= 1) {
    fpsVal = Math.round(fpsFrames / fpsAcc);
    fpsFrames = 0;
    fpsAcc = 0;
  }

  if (state === 'playing' || state === 'title') {
    update(dt);
  } else {
    updateParticles(dt);
  }

  render();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ 20. 启动 */
let rotateHint = null;
function updateRotateHint() {
  const portrait = window.innerHeight > window.innerWidth;
  if (IS_TOUCH && portrait && state !== 'playing') {
    if (!rotateHint) {
      rotateHint = document.createElement('div');
      rotateHint.id = 'rotateHint';
      rotateHint.textContent = '🔄 横屏体验更佳';
      document.body.appendChild(rotateHint);
    }
  } else if (rotateHint) {
    rotateHint.remove();
    rotateHint = null;
  }
}

function boot() {
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('resize', updateRotateHint);
  if (IS_TOUCH) el.hint.textContent = '按住屏幕左 / 右半边转向';
  updateRotateHint();
  buildTrackStart();
  el.best.textContent = fmt(bestScore);
  showScreen(el.screenTitle);
  updateHud();
  requestAnimationFrame(frame);
}

function buildTrackStart() {
  addRoad(30, 30, 30, 0, 0);
  for (let i = 0; i < 6; i++) appendPiece(0);
  ensureTrack(player.z);
  nextSpawnZ = player.z + 6200;
}

// 供自动化验收使用
window.__NEON__ = {
  get state() { return state; },
  get player() { return player; },
  get fps() { return fpsVal; },
  get entities() { return entities.length; },
  list: () => entities.map((e) => ({ t: e.type, dz: Math.round(e.z - player.z), x: +e.x.toFixed(2) })),
  spawnAt: (dz, x, type = 'car') => entities.push({
    type, z: player.z + dz, x, speed: 0, w: type === 'car' ? 600 : 380, h: type === 'car' ? 560 : 380,
    passed: false, hit: false, color: '#ffb347', phase: 0,
  }),
  start: startGame,
  crash: () => hitObstacle({ type: 'car' }),
  setSpeed: (v) => { player.speed = v; },
  segments,
};

boot();
