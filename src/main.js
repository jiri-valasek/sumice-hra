import * as THREE from 'three';
import { Terrain, paintGround, buildRoads, buildBuildings, buildTrees, buildLabels, Colliders, nearestRoadPoint, SURF } from './world.js';
import { Vehicle, VEHICLES } from './vehicles.js';
import { Input } from './input.js';
import { Sound } from './audio.js';

const $ = (s) => document.querySelector(s);
const status = (t) => { $('#loading-text').textContent = t; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ------------------------------------------------------------ renderer + scéna
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('#game').appendChild(renderer.domElement);

const SKY = new THREE.Color('#a9d3f2');
const scene = new THREE.Scene();
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 250, 1500);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 4000);

scene.add(new THREE.HemisphereLight('#dff0ff', '#6f7d4a', 1.1));
const sun = new THREE.DirectionalLight('#fff4dc', 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.4;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------ načtení světa
const world = {};
let labels, groundCanvas, map;

async function load() {
  status('Stahuji mapu Šumic…');
  const [mapRes, hRes] = await Promise.all([fetch('data/map.json'), fetch('data/heights.bin')]);
  map = await mapRes.json();
  const hbuf = await hRes.arrayBuffer();

  status('Modeluji kopce…'); await nextFrame();
  world.terrain = new Terrain(map, hbuf);

  status('Maluji pole, louky a silnice…'); await nextFrame();
  const ground = paintGround(map, renderer.capabilities.maxTextureSize);
  groundCanvas = ground.canvas;
  world.surface = ground.surface;
  const tex = new THREE.CanvasTexture(ground.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  scene.add(world.terrain.mesh(tex));
  buildRoads(map, world.terrain).forEach((m) => scene.add(m));

  status('Stavím domy…'); await nextFrame();
  const b = buildBuildings(map);
  scene.add(b.mesh);

  status('Sázím stromy…'); await nextFrame();
  const t = buildTrees(map, world.terrain);
  t.meshes.forEach((m) => scene.add(m));
  world.colliders = new Colliders(b.colliders, t.colliders);

  labels = buildLabels(map, world.terrain);
  scene.add(labels.group);

  buildMinimap();
  $('#attribution').textContent = map.attribution;
}

// ------------------------------------------------------------ minimapa
const mini = $('#minimap');
const mctx = mini.getContext('2d');
let miniSrc, miniBig = false;
function buildMinimap() {
  miniSrc = document.createElement('canvas');
  const s = 1024 / groundCanvas.width;
  miniSrc.width = 1024; miniSrc.height = Math.round(groundCanvas.height * s);
  miniSrc.getContext('2d').drawImage(groundCanvas, 0, 0, miniSrc.width, miniSrc.height);
}
function drawMinimap(v) {
  const size = mini.width;
  const [W, H] = map.size;
  const pxPerM = miniSrc.width / W;
  mctx.save();
  mctx.clearRect(0, 0, size, size);
  mctx.beginPath(); mctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); mctx.clip();
  mctx.fillStyle = '#93c463'; mctx.fillRect(0, 0, size, size);
  const viewM = miniBig ? Math.max(W, H) : 450;
  const scale = size / (viewM * pxPerM);
  const cx = miniBig ? 0 : v.pos.x, cz = miniBig ? 0 : v.pos.z;
  mctx.translate(size / 2, size / 2);
  mctx.scale(scale, scale);
  mctx.translate(-(cx + W / 2) * pxPerM, -(cz + H / 2) * pxPerM);
  mctx.drawImage(miniSrc, 0, 0);
  // místa
  for (const p of labels.list) {
    mctx.fillStyle = '#ffffff';
    mctx.beginPath(); mctx.arc((p.x + W / 2) * pxPerM, (p.z + H / 2) * pxPerM, 3.5 / scale, 0, Math.PI * 2); mctx.fill();
  }
  // hráč
  mctx.translate((v.pos.x + W / 2) * pxPerM, (v.pos.z + H / 2) * pxPerM);
  mctx.rotate(-v.heading + Math.PI);
  const a = 9 / scale;
  mctx.fillStyle = '#ff3b30'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2 / scale;
  mctx.beginPath(); mctx.moveTo(0, -a); mctx.lineTo(a * 0.7, a * 0.8); mctx.lineTo(0, a * 0.4); mctx.lineTo(-a * 0.7, a * 0.8); mctx.closePath();
  mctx.fill(); mctx.stroke();
  mctx.restore();
  mctx.strokeStyle = 'rgba(255,255,255,0.9)'; mctx.lineWidth = 3;
  mctx.beginPath(); mctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); mctx.stroke();
  mctx.fillStyle = '#fff'; mctx.font = 'bold 13px system-ui'; mctx.textAlign = 'center';
  mctx.fillText('S', size / 2, 16);
}

// ------------------------------------------------------------ kouř z výfuku
const smoke = [];
const smokeMat = new THREE.MeshLambertMaterial({ color: '#b5b5b5', transparent: true, opacity: 0.5, depthWrite: false });
const smokeGeo = new THREE.IcosahedronGeometry(0.25, 0);
for (let i = 0; i < 30; i++) {
  const m = new THREE.Mesh(smokeGeo, smokeMat.clone());
  m.visible = false; scene.add(m);
  smoke.push({ m, life: 0 });
}
let smokeTimer = 0, smokeIdx = 0;
const tmpV = new THREE.Vector3();
function updateSmoke(dt, v, throttle) {
  if (v.exhaustTop) {
    smokeTimer -= dt;
    if (smokeTimer <= 0) {
      smokeTimer = throttle ? 0.16 : 0.45;
      const s = smoke[smokeIdx++ % smoke.length];
      tmpV.copy(v.exhaustTop).applyMatrix4(v.group.matrixWorld);
      s.m.position.copy(tmpV); s.life = 1.6; s.m.visible = true; s.m.scale.setScalar(1);
    }
  }
  for (const s of smoke) {
    if (s.life <= 0) continue;
    s.life -= dt;
    s.m.position.y += dt * 1.2;
    s.m.position.x += dt * 0.9;
    s.m.scale.setScalar(0.6 + (1.6 - s.life) * 1.2);
    s.m.material.opacity = Math.max(0, s.life / 1.6) ** 2 * 0.3;
    if (s.life <= 0) s.m.visible = false;
  }
}

// ------------------------------------------------------------ hra
const input = new Input();
const sound = new Sound();
const vehicles = {};
let active = null;
let camMode = 0;
const CAM_MODES = ['Za vozidlem', 'Zdálky', 'Shora'];
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();

function spawnPoint() {
  const church = map.pois.find((p) => p.k === 'church' && p.n.includes('Panny')) || map.pois[0] || { x: 0, z: 0 };
  const r = nearestRoadPoint(map, church.x, church.z, ['residential', 'tertiary', 'secondary', 'unclassified', 'service']);
  return r || { x: 0, z: 0, heading: 0 };
}

function useVehicle(kind) {
  const prev = active;
  if (!vehicles[kind]) {
    vehicles[kind] = new Vehicle(kind, world);
    scene.add(vehicles[kind].group);
  }
  active = vehicles[kind];
  for (const v of Object.values(vehicles)) v.group.visible = v === active;
  if (prev && prev !== active) active.place(prev.pos.x, prev.pos.z, prev.heading);
  $('#vehicle-name').textContent = active.p.name;
  return active;
}

function resetToRoad() {
  const r = nearestRoadPoint(map, active.pos.x, active.pos.z, ['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'track']);
  if (r) active.place(r.x, r.z, r.heading);
}

function placeName(v) {
  let best = null, bd = 70 * 70;
  for (const p of labels.list) {
    const d = (p.x - v.pos.x) ** 2 + (p.z - v.pos.z) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  if (best) return best.text;
  const s = { [SURF.FIELD]: '🌾 Na poli', [SURF.WATER]: '💦 Ve vodě!', [SURF.GRASS]: '🌿 Na louce', [SURF.DIRT]: '🟫 Na polňačce' }[v.surface];
  return s || '🏡 Šumice';
}

let last = performance.now();
let hudTimer = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const inp = input.state();

  if (input.take('switch')) useVehicle(active.kind === 'kart' ? 'tractor' : 'kart');
  if (input.take('camera')) { camMode = (camMode + 1) % CAM_MODES.length; toast('🎥 ' + CAM_MODES[camMode]); }
  if (input.take('reset')) resetToRoad();
  if (input.take('horn')) sound.horn(active.kind === 'tractor');
  if (input.take('mute')) { const m = sound.toggleMute(); $('#btn-mute').textContent = m ? '🔇' : '🔊'; }
  if (input.take('map')) miniBig = !miniBig;

  // fyzika v menších krocích = stabilnější srážky
  const steps = 2;
  for (let i = 0; i < steps; i++) active.update(dt / steps, inp);
  if (active.bump > 0.3) { sound.bump(active.bump); active.bump = 0.29; }
  sound.setEngine(active.p.engine, active.speed / active.p.maxSpeed, inp.throttle !== 0);
  updateSmoke(dt, active, inp.throttle > 0);

  // kamera
  const C = active.p.cam;
  const fx = Math.sin(active.heading), fz = Math.cos(active.heading);
  const T = world.terrain;
  let want, look;
  if (camMode === 2) {
    want = tmpV.set(active.pos.x - fx * 4, active.y + 60, active.pos.z - fz * 4);
    look = new THREE.Vector3(active.pos.x, active.y, active.pos.z);
  } else {
    const k = camMode === 1 ? 2.2 : 1;
    want = tmpV.set(active.pos.x - fx * C.dist * k, active.y + C.height * k, active.pos.z - fz * C.dist * k);
    look = new THREE.Vector3(active.pos.x + fx * 3, active.y + C.look, active.pos.z + fz * 3);
  }
  camPos.lerp(want, 1 - Math.exp(-dt * (camMode === 2 ? 3 : 5)));
  const minY = T.height(camPos.x, camPos.z) + 1.2;
  if (camPos.y < minY) camPos.y = minY;
  camLook.lerp(look, 1 - Math.exp(-dt * 10));
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  // slunce sleduje hráče (stíny jen kolem)
  sun.position.set(active.pos.x + SUN_DIR.x * 200, active.y + SUN_DIR.y * 200, active.pos.z + SUN_DIR.z * 200);
  sun.target.position.set(active.pos.x, active.y, active.pos.z);

  // popisky jen v okolí
  for (const p of labels.list) {
    const d = Math.hypot(p.x - camPos.x, p.z - camPos.z);
    p.sprite.visible = d < 450;
    p.sprite.material.opacity = Math.min(1, (450 - d) / 100);
  }

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.15;
    $('#speed').textContent = Math.round(Math.abs(active.speed) * 3.6);
    $('#place').textContent = placeName(active);
    drawMinimap(active);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

let toastT;
function toast(t) {
  const el = $('#toast');
  el.textContent = t; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1400);
}

// ------------------------------------------------------------ start
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

load().then(() => {
  $('#loading').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  const sp = spawnPoint();
  useVehicle('kart').place(sp.x, sp.z, sp.heading);
  camPos.set(sp.x, active.y + 40, sp.z + 40);
  camLook.set(sp.x, active.y, sp.z);
  renderer.render(scene, camera);
  requestAnimationFrame((t) => { last = t; loop(t); });
}).catch((e) => {
  console.error(e);
  status('Něco se pokazilo: ' + e.message);
});

document.querySelectorAll('[data-start]').forEach((btn) => {
  btn.addEventListener('click', () => {
    useVehicle(btn.dataset.start);
    $('#menu').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    sound.start();
    if (isTouch && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  });
});
