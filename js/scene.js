// three.js 星空渲染：自定义着色器星点 + 星云 + 核心辉光 + 拾取交互
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const STAR_VERT = `
attribute float aSize;
attribute vec3 aColor;
attribute float aSeed;
varying vec3 vColor;
varying float vSeed;
uniform float uTime;
uniform float uPixelRatio;
void main() {
  vColor = aColor;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.86 + 0.14 * sin(uTime * 2.0 + aSeed * 6.2831);
  gl_PointSize = max(aSize * tw * uPixelRatio * (55.0 / -mv.z), 1.0);
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

let renderer, scene, camera, controls, clock;
let starPoints = null, farPoints = null, nebulaGroup = null, coreSprite = null;
let starMaterial, raycaster, pointerNDC;
let armLabelAnchors = [];   // [{el, pos:Vector3}]
let onHover = null, onClickStar = null;
let hoveredIndex = -1;
let currentGalaxy = null;

function makeStarMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
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
  stars.forEach((s, i) => {
    pos[i * 3] = s.x; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z;
    col[i * 3] = s.color[0] / 255; col[i * 3 + 1] = s.color[1] / 255; col[i * 3 + 2] = s.color[2] / 255;
    size[i] = s.size; seed[i] = s.seed;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
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

export function init(canvas, { hover, clickStar } = {}) {
  onHover = hover || null;
  onClickStar = clickStar || null;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x05070f, 1);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(0, 34, 46);

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
    map: tex, color: 0xfff2d0, transparent: true, opacity: 0.85,
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
}

function tick() {
  const t = clock.getElapsedTime();
  starMaterial.uniforms.uTime.value = t;
  controls.update();

  if (starPoints) {
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObject(starPoints);
    const idx = hits.length ? hits[0].index : -1;
    if (idx !== hoveredIndex) {
      hoveredIndex = idx;
      renderer.domElement.style.cursor = idx >= 0 ? 'pointer' : 'grab';
    }
  }

  updateArmLabels();
  renderer.render(scene, camera);
}

const _v = new THREE.Vector3();
function updateArmLabels() {
  for (const { el, pos } of armLabelAnchors) {
    _v.copy(pos).project(camera);
    const behind = _v.z > 1;
    if (behind) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.left = ((_v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    el.style.top = ((-_v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  }
}

// 用新的银河数据重建星点与旋臂标签
export function setGalaxy(galaxy) {
  currentGalaxy = galaxy;
  if (starPoints) {
    scene.remove(starPoints);
    starPoints.geometry.dispose();
    starPoints = null;
  }
  const labelsBox = document.getElementById('arm-labels');
  labelsBox.innerHTML = '';
  armLabelAnchors = [];

  starPoints = buildPoints(galaxy.stars, starMaterial);
  scene.add(starPoints);

  // 每条旋臂最外侧的一颗星作为标签锚点
  for (const arm of galaxy.arms) {
    const el = document.createElement('div');
    el.className = 'arm-label';
    el.innerHTML = `${arm.repo} <span class="cnt">×${arm.count}</span>`;
    labelsBox.appendChild(el);
    const anchorStar = galaxy.stars.filter((s) => s.repo === arm.repo).pop();
    if (anchorStar) armLabelAnchors.push({ el, pos: new THREE.Vector3(anchorStar.x, anchorStar.y, anchorStar.z) });
  }

  // 重置相机视角
  controls.reset();
  camera.position.set(0, 34, 46);
  controls.autoRotate = true;
}

export function getStar(index) {
  return currentGalaxy ? currentGalaxy.stars[index] : null;
}
export function getHoveredStar() {
  return hoveredIndex >= 0 ? getStar(hoveredIndex) : null;
}
