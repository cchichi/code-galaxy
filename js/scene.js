// three.js 星空渲染：自定义着色器星点 + Bloom 辉光 + 年份环 + 时间旅行 + 拾取交互
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const STAR_VERT = `
attribute float aSize;
attribute vec3 aColor;
attribute float aSeed;
attribute float aArm;
attribute float aT;      // 时间序：0=最早 1=最新
varying vec3 vColor;
varying float vSeed;
uniform float uTime;
uniform float uPixelRatio;
uniform float uSelArm;   // 旋臂过滤，-1=全部
uniform float uBirth;    // 诞生动画进度 0→1
uniform float uLimit;    // 时间旅行：只显示 aT <= uLimit
void main() {
  vColor = aColor;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.86 + 0.14 * sin(uTime * 2.0 + aSeed * 6.2831);
  float dimArm = (uSelArm < -0.5 || abs(aArm - uSelArm) < 0.5) ? 1.0 : 0.10;
  float dimT = (aT <= uLimit) ? 1.0 : 0.05;
  float birth = clamp((uBirth - aT) * 2.6, 0.0, 1.0);
  vColor *= dimArm * dimT * birth;
  gl_PointSize = max(aSize * tw * uPixelRatio * (55.0 / -mv.z) * (0.3 + 0.7 * birth), 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const STAR_FRAG = `
varying vec3 vColor;
varying float vSeed;
uniform float uTime;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);
  float tw = 0.86 + 0.14 * sin(uTime * 2.0 + vSeed * 6.2831);
  vec3 col = vColor * (core * 0.6 + pow(core, 3.0) * 1.1) * tw;
  gl_FragColor = vec4(col, 1.0);
}`;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,240,210,0.55)');
  grad.addColorStop(0.6, 'rgba(180,190,255,0.14)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

// 十字衍射星芒贴图（巨新星用）
function flareTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const bar = (w, h) => {
    const grad = g.createLinearGradient(0, 64 - h, 0, 64 + h);
    grad.addColorStop(0, 'rgba(255,235,190,0)');
    grad.addColorStop(0.5, 'rgba(255,246,220,0.95)');
    grad.addColorStop(1, 'rgba(255,235,190,0)');
    g.fillStyle = grad;
    g.fillRect(0, 64 - h, w, h * 2);
  };
  g.save();
  g.translate(64, 64);
  bar(128, 2.2);
  g.rotate(Math.PI / 2);
  bar(128, 2.2);
  g.rotate(Math.PI / 4);
  bar(64, 1.2);
  g.rotate(Math.PI / 2);
  bar(64, 1.2);
  g.restore();
  return new THREE.CanvasTexture(c);
}

let renderer, composer, camera, scene, controls, clock;
let starPoints = null, farPoints = null, nebulaGroup = null, coreSprite = null, ringGroup = null, flareGroup = null;
let starMaterial, raycaster, pointerNDC;
let armLabelAnchors = [];
let ringLabelAnchors = [];  // [{el, pos, now}]
let onHover = null, onClickStar = null;
let hoveredIndex = -1;
let currentGalaxy = null;
let selArm = -1;
let limit = 1;            // 时间旅行
let birthStart = -1;      // 诞生动画起点（clock 秒）
let nowLabelEl = null;

function makeStarMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uSelArm: { value: -1 },
      uBirth: { value: 0 },
      uLimit: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function buildPoints(stars, material) {
  const n = stars.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const seed = new Float32Array(n);
  const arm = new Float32Array(n);
  const tOrd = new Float32Array(n);
  stars.forEach((s, i) => {
    pos[i * 3] = s.x; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z;
    col[i * 3] = s.color[0] / 255; col[i * 3 + 1] = s.color[1] / 255; col[i * 3 + 2] = s.color[2] / 255;
    size[i] = s.size; seed[i] = s.seed; arm[i] = s.arm;
    tOrd[i] = s.t != null ? s.t : 0;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aArm', new THREE.BufferAttribute(arm, 1));
  geo.setAttribute('aT', new THREE.BufferAttribute(tOrd, 1));
  return new THREE.Points(geo, material);
}

function buildFarStars() {
  const n = 1600, stars = [];
  for (let i = 0; i < n; i++) {
    const r = 130 + Math.random() * 70;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const tint = Math.random();
    stars.push({
      x: r * Math.sin(ph) * Math.cos(th), y: r * Math.cos(ph) * 0.7, z: r * Math.sin(ph) * Math.sin(th),
      color: tint < 0.7 ? [200, 210, 255] : tint < 0.9 ? [255, 235, 200] : [160, 200, 255],
      size: 0.5 + Math.random() * 1.1,
      seed: Math.random(),
      arm: -1, t: 0,
    });
  }
  return buildPoints(stars, starMaterial);
}

function buildNebula(tex) {
  const group = new THREE.Group();
  const clouds = [
    { color: 0x2447c9, pos: [26, 3, -18], scale: 62, opacity: 0.13 },
    { color: 0xc96a2b, pos: [-30, -2, 14], scale: 55, opacity: 0.11 },
    { color: 0x1b6fa8, pos: [-8, -6, -34], scale: 70, opacity: 0.10 },
    { color: 0x3b55c9, pos: [18, 5, 30], scale: 48, opacity: 0.09 },
  ];
  for (const c of clouds) {
    const mat = new THREE.SpriteMaterial({
      map: tex, color: c.color, transparent: true, opacity: c.opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sp = new THREE.Sprite(mat);
    sp.position.set(...c.pos);
    sp.scale.set(c.scale, c.scale, 1);
    group.add(sp);
  }
  return group;
}

function ensureLabelsBox(id) {
  return document.getElementById(id) || (() => {
    const d = document.createElement('div');
    d.id = id;
    document.body.appendChild(d);
    return d;
  })();
}

function buildRings(rings) {
  const group = new THREE.Group();
  const labelsBox = ensureLabelsBox('ring-labels');
  labelsBox.innerHTML = '';
  ringLabelAnchors = [];
  nowLabelEl = null;
  const labelAngle = 2.35;
  for (const ring of rings) {
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(ring.r * Math.cos(a), 0, ring.r * Math.sin(a)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: ring.now ? 0x8fa3d4 : 0x3d4f8a,
      transparent: true,
      opacity: ring.now ? 0.3 : 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    group.add(new THREE.Line(geo, mat));

    const el = document.createElement('div');
    el.className = 'ring-label' + (ring.now ? ' now' : '');
    el.textContent = ring.now ? '现在' : String(ring.year);
    if (!ring.now) el.title = `${ring.year} 年 · ${ring.count} 次提交`;
    labelsBox.appendChild(el);
    if (ring.now) nowLabelEl = el;
    ringLabelAnchors.push({ el, pos: new THREE.Vector3(ring.r * Math.cos(labelAngle), 0, ring.r * Math.sin(labelAngle)), now: !!ring.now });
  }
  return group;
}

function buildFlares(galaxy, tex) {
  const group = new THREE.Group();
  for (const s of galaxy.stars) {
    if (!s.planet) continue;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xffe9b0, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sp.position.set(s.x, s.y, s.z);
    const sc = s.size * 2.6;
    sp.scale.set(sc, sc, 1);
    sp.userData.t = s.t;
    group.add(sp);
  }
  return group;
}

export function init(canvas, { hover, clickStar } = {}) {
  onHover = hover || null;
  onClickStar = clickStar || null;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x05070f, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(0, 34, 46);

  // Bloom 辉光后期
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.7, 0.12);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 12;
  controls.maxDistance = 160;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.45;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  clock = new THREE.Clock();
  starMaterial = makeStarMaterial();
  const tex = glowTexture();

  farPoints = buildFarStars();
  scene.add(farPoints);
  nebulaGroup = buildNebula(tex);
  scene.add(nebulaGroup);

  coreSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0xfff2d0, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  coreSprite.scale.set(14, 14, 1);
  scene.add(coreSprite);

  raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.55;
  pointerNDC = new THREE.Vector2(-10, -10);

  canvas.addEventListener('pointermove', (e) => {
    pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    if (onHover) onHover({ x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener('pointerleave', () => { pointerNDC.set(-10, -10); if (onHover) onHover(null); });
  canvas.addEventListener('click', (e) => {
    if (hoveredIndex >= 0 && onClickStar) onClickStar(hoveredIndex, e);
  });

  window.addEventListener('resize', onResize);
  renderer.setAnimationLoop(tick);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

function tick() {
  const t = clock.getElapsedTime();
  starMaterial.uniforms.uTime.value = t;
  if (birthStart >= 0) starMaterial.uniforms.uBirth.value = Math.min(1, (t - birthStart) / 3.2);
  controls.update();

  // 银心脉冲
  if (coreSprite) {
    const p = 14 + Math.sin(t * 1.8) * 0.8;
    coreSprite.scale.set(p, p, 1);
  }
  // 星芒随诞生/时间旅行显隐
  if (flareGroup) {
    const birth = starMaterial.uniforms.uBirth.value;
    for (const sp of flareGroup.children) {
      const vis = birth >= 1 && sp.userData.t <= limit;
      sp.material.opacity = vis ? 0.8 : 0;
    }
  }
  // 「现在」标签：时间旅行时隐藏
  if (nowLabelEl) nowLabelEl.style.opacity = limit < 0.999 ? 0 : '';

  if (starPoints) {
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObject(starPoints);
    const idx = hits.length ? hits[0].index : -1;
    if (idx !== hoveredIndex) {
      hoveredIndex = idx;
      renderer.domElement.style.cursor = idx >= 0 ? 'pointer' : 'grab';
    }
  }

  updateLabels();
  composer.render();
}

const _v = new THREE.Vector3();
function projectTo(el, pos) {
  _v.copy(pos).project(camera);
  if (_v.z > 1) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.style.left = ((_v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
  el.style.top = ((-_v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
}
function updateLabels() {
  for (const a of armLabelAnchors) {
    const dimmed = selArm >= 0 && a.arm !== selArm;
    a.el.style.opacity = dimmed ? 0.12 : '';
    projectTo(a.el, a.pos);
  }
  for (const a of ringLabelAnchors) {
    if (a.now && limit < 0.999) { a.el.style.opacity = 0; }
    projectTo(a.el, a.pos);
  }
}

// 用新的银河数据重建星点、年份环、星芒与标签
export function setGalaxy(galaxy) {
  currentGalaxy = galaxy;
  selArm = -1;
  limit = 1;
  starMaterial.uniforms.uSelArm.value = -1;
  starMaterial.uniforms.uLimit.value = 1;
  starMaterial.uniforms.uBirth.value = 0;
  birthStart = clock.getElapsedTime();

  for (const g of [starPoints, ringGroup, flareGroup]) {
    if (!g) continue;
    scene.remove(g);
    g.traverse((o) => o.geometry && o.geometry.dispose());
  }
  starPoints = ringGroup = flareGroup = null;

  const labelsBox = ensureLabelsBox('arm-labels');
  labelsBox.innerHTML = '';
  armLabelAnchors = [];

  starPoints = buildPoints(galaxy.stars, starMaterial);
  scene.add(starPoints);

  ringGroup = buildRings(galaxy.rings || []);
  scene.add(ringGroup);

  flareGroup = buildFlares(galaxy, flareTexture());
  scene.add(flareGroup);

  // 旋臂标签锚在「最老」的星上（反向时间映射下位于银河外缘）
  for (let k = 0; k < galaxy.arms.length; k++) {
    const arm = galaxy.arms[k];
    const el = document.createElement('div');
    el.className = 'arm-label';
    el.innerHTML = `${arm.repo} <span class="cnt">×${arm.count}</span>`;
    labelsBox.appendChild(el);
    const anchorStar = firstOf(galaxy.stars, (s) => s.arm === k && !s.planet);
    if (anchorStar) {
      const pos = new THREE.Vector3(anchorStar.x, anchorStar.y, anchorStar.z).multiplyScalar(1.09);
      armLabelAnchors.push({ el, pos, arm: k });
    }
  }

  controls.reset();
  camera.position.set(0, 34, 46);
  controls.autoRotate = true;
}

function firstOf(arr, pred) {
  for (let i = 0; i < arr.length; i++) if (pred(arr[i])) return arr[i];
  return null;
}

// 颜色模式：hour（时刻）/ repo（仓库）/ weekend（工作日-周末）
export function updateColors(mode) {
  if (!currentGalaxy || !starPoints) return;
  const attr = starPoints.geometry.getAttribute('aColor');
  currentGalaxy.stars.forEach((s, i) => {
    const c = mode === 'repo' ? s.colRepo : mode === 'weekend' ? s.colWeekend : s.colHour;
    if (!c) return;
    s.color = c;
    attr.setXYZ(i, c[0] / 255, c[1] / 255, c[2] / 255);
  });
  attr.needsUpdate = true;
}

// 旋臂过滤：k 为旋臂序号，-1 表示全部显示
export function setArmFilter(k) {
  selArm = k;
  starMaterial.uniforms.uSelArm.value = k;
}

// 时间旅行：v ∈ [0,1]，只显示时间序 ≤ v 的星
export function setLimit(v) {
  limit = v;
  starMaterial.uniforms.uLimit.value = v;
}
export function getLimit() { return limit; }

export function getStar(index) {
  return currentGalaxy ? currentGalaxy.stars[index] : null;
}
export function getHoveredStar() {
  return hoveredIndex >= 0 ? getStar(hoveredIndex) : null;
}
