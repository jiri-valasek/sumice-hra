import * as THREE from 'three';
import { Terrain, paintGround, buildRoads, buildBuildings, buildTrees, buildLabels, Colliders, nearestRoadPoint, SURF,
  Bridges, buildBridgeMeshes, buildWater, buildRails, buildPonds, buildProps } from './world.js';
import { Traffic } from './traffic.js';
import { Train } from './train.js';
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

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// slabší zařízení (malý telefon) -> hrubší terén; ?lite / ?full v adrese to přebije
const LOW_POWER = location.search.includes('lite') || (!location.search.includes('full') && isTouch && Math.min(screen.width, screen.height) < 500);

const SKY = new THREE.Color('#a9d3f2');
const scene = new THREE.Scene();
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 250, 1500);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 4000);

scene.add(new THREE.HemisphereLight('#e6f2ff', '#9aa07a', 1.9));
const sun = new THREE.DirectionalLight('#fff4dc', 1.9);
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
  world.terrain = new Terrain(map, hbuf, LOW_POWER);

  status('Maluji pole, louky a silnice…'); await nextFrame();
  const ground = paintGround(map, renderer.capabilities.maxTextureSize);
  groundCanvas = ground.canvas;
  world.surface = ground.surface;
  const tex = new THREE.CanvasTexture(ground.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  scene.add(world.terrain.mesh(tex));
  buildRoads(map, world.terrain).forEach((m) => scene.add(m));
  world.bridges = new Bridges(map);
  world.ground = (x, z, yPrev) => {
    const t = world.terrain.height(x, z);
    const d = world.bridges.deck(x, z);
    // na most se dostaneš jen zhora – pod mostem jedeš potokem
    if (d > t && (yPrev === undefined || yPrev > d - 1.4)) return { h: d, bridge: true };
    return { h: t, bridge: false };
  };
  scene.add(buildBridgeMeshes(map));
  world.water = buildWater(map);
  scene.add(world.water);
  buildRails(map).forEach((m) => scene.add(m));

  status('Stavím domy…'); await nextFrame();
  const b = buildBuildings(map);
  scene.add(b.mesh);

  status('Sázím stromy…'); await nextFrame();
  const t = buildTrees(map, world.terrain);
  t.meshes.forEach((m) => scene.add(m));
  buildPonds(map).forEach((m) => scene.add(m));
  const props = buildProps(map, world.terrain);
  props.meshes.forEach((m) => scene.add(m));
  world.colliders = new Colliders(b.colliders, [...t.colliders, ...props.circles]);
  world.train = new Train(map, scene, world.colliders, map.pois.find((p) => p.k === 'halt'));
  world.train.onHorn = (d) => sound.trainHorn(d);
  status('Posílám do ulic lidi a auta…'); await nextFrame();
  world.traffic = new Traffic(map, world, scene, LOW_POWER ? { cars: 5, people: 15 } : {});
  world.traffic.onHonk = (d) => { if (d < 80) sound.horn(false); };

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

// ------------------------------------------------------------ šplouchání ve vodě
const drops = [];
const dropGeo = new THREE.IcosahedronGeometry(0.06, 0);
const dropMat = new THREE.MeshBasicMaterial({ color: '#e6f6ff', transparent: true, opacity: 0.85 });
for (let i = 0; i < 80; i++) { const m = new THREE.Mesh(dropGeo, dropMat); m.visible = false; scene.add(m); drops.push({ m, v: new THREE.Vector3(), life: 0 }); }
let dropIdx = 0, splashT = 0, wasWet = false;
function updateSplash(dt, v) {
  const wet = v.surface === SURF.WATER && !v.onBridge && v.air < 0.1;
  if (wet && !wasWet && Math.abs(v.speed) > 3) { sound.splash(Math.min(1, Math.abs(v.speed) / 12)); burst(v, 25); toast('💦 Šplouch!'); }
  wasWet = wet;
  if (wet && Math.abs(v.speed) > 1.5) {
    splashT -= dt;
    if (splashT <= 0) { splashT = 0.05; burst(v, 3); }
  }
  for (const d of drops) {
    if (d.life <= 0) continue;
    d.life -= dt;
    d.v.y -= 12 * dt;
    d.m.position.addScaledVector(d.v, dt);
    if (d.life <= 0) d.m.visible = false;
  }
}
function burst(v, n) {
  const sp = Math.abs(v.speed);
  for (let i = 0; i < n; i++) {
    const d = drops[dropIdx++ % drops.length];
    const a = Math.random() * Math.PI * 2;
    d.m.position.set(v.pos.x + Math.cos(a) * 0.8, v.y + 0.3, v.pos.z + Math.sin(a) * 0.8);
    d.v.set(Math.cos(a) * (1 + Math.random() * 2) + v.vx * 0.3, 3 + Math.random() * 3 + sp * 0.15, Math.sin(a) * (1 + Math.random() * 2) + v.vz * 0.3);
    d.life = 0.9; d.m.visible = true;
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
  if (v.onBridge) return '🌉 Na mostě';
  if (v.air > 0.25) return '🚀 Letím!';
  const s = { [SURF.FIELD]: '🌾 Na poli', [SURF.WATER]: '💦 Ve vodě!', [SURF.GRASS]: '🌿 Na louce', [SURF.DIRT]: '🟫 Na polňačce' }[v.surface];
  return s || '🏡 Šumice';
}

let last = performance.now();
let hudTimer = 0;
let paused = false;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) tick(dt, input.state());
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function tick(dt, inp) {

  if (input.take('switch')) useVehicle({ kart: 'moto', moto: 'tractor', tractor: 'kart' }[active.kind]);
  if (input.take('camera')) { camMode = (camMode + 1) % CAM_MODES.length; toast('🎥 ' + CAM_MODES[camMode]); }
  if (input.take('reset')) resetToRoad();
  if (input.take('horn')) { sound.horn(active.kind === 'tractor'); world.traffic.horn(active); }
  if (input.take('mute')) { const m = sound.toggleMute(); $('#btn-mute').textContent = m ? '🔇' : '🔊'; }
  if (input.take('map')) miniBig = !miniBig;

  // fyzika v menších krocích = stabilnější srážky
  const steps = 2;
  for (let i = 0; i < steps; i++) active.update(dt / steps, inp);
  if (active.bump > 0.3) { sound.bump(active.bump); active.bump = 0.29; }
  if (active.landed > 0) { sound.bump(active.landed); active.landed = 0; }
  world.train.update(dt, active);
  world.traffic.update(dt, active);
  if (world.water.userData.flow) world.water.userData.flow.offset.y -= dt * 0.35;
  updateSplash(dt, active);
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
}

let toastT;
function toast(t) {
  const el = $('#toast');
  el.textContent = t; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1400);
}

// ------------------------------------------------------------ start
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
  // ladění: ?debug zpřístupní hru v konzoli (window.game)
  if (location.search.includes('debug')) {
    window.game = {
      world, map, camera, get active() { return active; }, useVehicle,
      // pohled kamery z bodu (lat, lon, výška nad terénem) na bod (lat, lon) – pro srovnání s fotkami
      view(lat, lon, h, lat2, lon2, h2 = 2) {
        paused = true;
        const P = (la, lo) => [(lo - map.origin.lon) * 111412.84 * Math.cos(map.origin.lat * Math.PI / 180),
          -(la - map.origin.lat) * (111132.954 - 559.822 * Math.cos(2 * map.origin.lat * Math.PI / 180))];
        const [x, z] = P(lat, lon), [x2, z2] = P(lat2, lon2);
        camera.position.set(x, world.terrain.height(x, z) + h, z);
        camera.lookAt(x2, world.terrain.height(x2, z2) + h2, z2);
        renderer.render(scene, camera);
      },
      // posune simulaci o `sec` sekund s daným ovládáním (pro testy)
      sim(sec, inp = {}) {
        paused = true;
        const i = { throttle: 0, steer: 0, handbrake: false, ...inp };
        for (let t = 0; t < sec; t += 1 / 30) tick(1 / 30, i);
        hudTimer = 0; tick(0.0001, i);
        renderer.render(scene, camera);
      },
    };
  }
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
