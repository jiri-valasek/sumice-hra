// Vozidla: modely postavené z jednoduchých tvarů + arkádová fyzika
import * as THREE from 'three';
import { SURF } from './world.js';

const mat = (hex, extra = {}) => new THREE.MeshLambertMaterial({ color: hex, ...extra });

function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function wheel(r, w, tireM, rimM, rimScale = 0.55) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18), tireM);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * rimScale, r * rimScale, w * 1.04, 12), rimM);
  rim.rotation.z = Math.PI / 2;
  // vzorek, aby bylo vidět otáčení
  for (let i = 0; i < 6; i++) {
    const lug = new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, r * 0.16, r * 0.3), tireM);
    const a = (i / 6) * Math.PI * 2;
    lug.position.set(0, Math.cos(a) * r, Math.sin(a) * r);
    lug.rotation.x = a;
    g.add(lug);
  }
  g.add(tire, rim);
  return g;
}

function person(shirtHex, helmetHex) {
  const g = new THREE.Group();
  g.add(box(0.5, 0.55, 0.32, mat(shirtHex), 0, 0.28, 0));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mat('#f1c9a5'));
  head.position.y = 0.72;
  g.add(head);
  if (helmetHex) {
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), mat(helmetHex));
    helm.position.y = 0.74;
    g.add(helm);
  } else {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.1, 12), mat('#3a5a8c'));
    cap.position.y = 0.86;
    const peak = box(0.2, 0.03, 0.18, mat('#3a5a8c'), 0, 0.82, 0.2);
    g.add(cap, peak);
  }
  return g;
}

// ------------------------------------------------------------ modely
function kartModel() {
  const g = new THREE.Group();
  const red = mat('#e0392b'), dark = mat('#2a2a2e'), tire = mat('#1b1b1d'), rim = mat('#d9d9d9');
  g.add(box(1.1, 0.12, 2.0, dark, 0, 0.18, 0));          // rám
  g.add(box(1.25, 0.22, 0.5, red, 0, 0.32, 0.95));        // přední kapota
  g.add(box(0.5, 0.2, 0.7, red, 0, 0.32, 0.55));          // nos
  g.add(box(0.28, 0.25, 1.0, red, -0.62, 0.3, 0));        // boční nárazníky
  g.add(box(0.28, 0.25, 1.0, red, 0.62, 0.3, 0));
  g.add(box(1.3, 0.2, 0.2, dark, 0, 0.3, -1.05));         // zadní nárazník
  g.add(box(0.55, 0.45, 0.12, dark, 0, 0.5, -0.38));      // opěradlo
  g.add(box(0.45, 0.3, 0.4, mat('#555'), 0.25, 0.42, -0.75)); // motor
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), mat('#999'));
  exhaust.rotation.x = Math.PI / 2; exhaust.position.set(0.45, 0.45, -1.0);
  g.add(exhaust);
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 14), dark);
  sw.position.set(0, 0.65, 0.25); sw.rotation.x = -0.9;
  g.add(sw);
  const driver = person('#2f6fd6', '#f5c518');
  driver.position.set(0, 0.25, -0.15);
  g.add(driver);
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 4), mat('#ccc'));
  flagPole.position.set(-0.45, 1.0, -0.95);
  const flag = box(0.02, 0.25, 0.35, mat('#ffcf33'), -0.45, 1.58, -1.1);
  g.add(flagPole, flag);
  const wheels = [];
  for (const [x, z, r, w, front] of [[-0.68, 0.75, 0.2, 0.2, 1], [0.68, 0.75, 0.2, 0.2, 1], [-0.7, -0.75, 0.24, 0.3, 0], [0.7, -0.75, 0.24, 0.3, 0]]) {
    const wh = wheel(r, w, tire, rim);
    wh.position.set(x, r, z);
    wh.userData = { r, front };
    g.add(wh);
    wheels.push(wh);
  }
  return { group: g, wheels };
}

function tractorModel() {
  const g = new THREE.Group();
  const green = mat('#3d8b3a'), dark = mat('#2b2f2a'), tire = mat('#1c1c1c'), rim = mat('#f2b632');
  const glass = mat('#bfe3f2', { transparent: true, opacity: 0.35 });
  g.add(box(0.9, 0.5, 2.6, dark, 0, 0.75, 0.1));          // podvozek
  g.add(box(0.95, 0.8, 1.6, green, 0, 1.25, 0.9));        // kapota
  g.add(box(1.0, 0.12, 1.65, green, 0, 1.68, 0.9));
  g.add(box(0.9, 0.5, 0.1, mat('#cfcfcf'), 0, 1.2, 1.72)); // maska
  for (const x of [-0.3, 0.3]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), mat('#fff8d0', { emissive: '#665c22' }));
    l.rotation.x = Math.PI / 2; l.position.set(x, 1.48, 1.76);
    g.add(l);
  }
  // kabina
  const cab = new THREE.Group();
  cab.position.set(0, 1.0, -0.65);
  cab.add(box(1.5, 0.2, 1.5, green, 0, 0.0, 0));
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) cab.add(box(0.08, 1.5, 0.08, dark, x, 0.85, z));
  cab.add(box(1.6, 0.12, 1.6, green, 0, 1.65, 0));        // střecha
  cab.add(box(1.38, 1.3, 0.03, glass, 0, 0.85, 0.7));
  cab.add(box(1.38, 1.3, 0.03, glass, 0, 0.85, -0.7));
  cab.add(box(0.03, 1.3, 1.38, glass, -0.7, 0.85, 0));
  cab.add(box(0.03, 1.3, 1.38, glass, 0.7, 0.85, 0));
  cab.add(box(0.6, 0.15, 0.5, dark, 0, 0.4, -0.2));       // sedačka
  const driver = person('#c0392b', null);
  driver.position.set(0, 0.45, -0.15);
  cab.add(driver);
  g.add(cab);
  // blatníky
  for (const x of [-0.95, 0.95]) g.add(box(0.6, 0.08, 1.4, green, x, 1.75, -0.7));
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), mat('#444'));
  exhaust.position.set(0.35, 2.2, 1.3);
  g.add(exhaust);
  const wheels = [];
  for (const [x, z, r, w, front] of [[-0.75, 1.15, 0.5, 0.32, 1], [0.75, 1.15, 0.5, 0.32, 1], [-0.95, -0.7, 0.85, 0.5, 0], [0.95, -0.7, 0.85, 0.5, 0]]) {
    const wh = wheel(r, w, tire, rim, 0.5);
    wh.position.set(x, r, z);
    wh.userData = { r, front };
    g.add(wh);
    wheels.push(wh);
  }
  return { group: g, wheels, exhaustTop: new THREE.Vector3(0.35, 2.85, 1.3) };
}

function motoModel() {
  const g = new THREE.Group();
  const orange = mat('#f07a1a'), dark = mat('#26282c'), tire = mat('#1a1a1a'), rim = mat('#c9c9c9'), white = mat('#f4f4f4');
  const tilt = new THREE.Group(); // náklon v zatáčce
  g.add(tilt);
  const wheels = [];
  for (const [z, front] of [[0.72, 1], [-0.72, 0]]) {
    const wh = wheel(0.36, 0.14, tire, rim, 0.6);
    wh.position.set(0, 0.36, z);
    wh.userData = { r: 0.36, front };
    tilt.add(wh);
    wheels.push(wh);
  }
  tilt.add(box(0.2, 0.25, 1.1, dark, 0, 0.62, -0.05));        // rám + motor
  tilt.add(box(0.32, 0.28, 0.45, mat('#555'), 0, 0.5, 0.0));
  tilt.add(box(0.34, 0.22, 0.5, orange, 0, 0.88, 0.22));      // nádrž
  tilt.add(box(0.26, 0.1, 0.7, dark, 0, 0.9, -0.3));         // sedlo
  tilt.add(box(0.3, 0.06, 0.55, orange, 0, 0.85, -0.68));    // zadní blatník
  tilt.add(box(0.26, 0.05, 0.4, white, 0, 0.78, 0.82));      // přední blatník
  const fork = box(0.08, 0.6, 0.08, mat('#bbb'), 0, 0.62, 0.66); fork.rotation.x = -0.35; tilt.add(fork);
  tilt.add(box(0.75, 0.05, 0.05, dark, 0, 1.05, 0.52));      // řídítka
  tilt.add(box(0.26, 0.2, 0.06, white, 0, 0.98, 0.72));      // tabulka s číslem
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 8), mat('#888'));
  exhaust.rotation.x = Math.PI / 2 - 0.3; exhaust.position.set(0.17, 0.7, -0.45); tilt.add(exhaust);
  const rider = person('#1f8a4c', '#e8392b');
  rider.position.set(0, 0.85, -0.15);
  rider.rotation.x = 0.35;
  tilt.add(rider);
  // ruce
  for (const x of [-0.25, 0.25]) { const a = box(0.08, 0.08, 0.5, mat('#1f8a4c'), x, 1.15, 0.25); a.rotation.x = 0.5; tilt.add(a); }
  return { group: g, wheels, tilt };
}

function mowerModel() {
  const m = tractorModel();
  const red = mat('#c0392b'), steel = mat('#9aa0a6');
  // boční žací lišta (vpravo za předními koly)
  const bar = new THREE.Group();
  bar.add(box(2.4, 0.12, 0.35, red, -2.2, 0.25, 0.2));
  bar.add(box(2.3, 0.05, 0.5, steel, -2.2, 0.15, 0.25));
  bar.add(box(0.2, 0.6, 0.2, red, -1.1, 0.5, 0.2));
  const arm = box(1.2, 0.1, 0.1, red, -0.8, 0.85, 0.2); arm.rotation.z = -0.35; bar.add(arm);
  m.group.add(bar);
  m.cutPoint = new THREE.Vector3(-1.6, 0, 0.2); // střed záběru (lokálně)
  return m;
}

// ------------------------------------------------------------ fyzika
export const VEHICLES = {
  kart: {
    name: 'Motokára', model: kartModel, radius: 1.1, wheelbase: 1.5,
    maxSpeed: 19, reverse: 5, accel: 8, brake: 14, drag: 0.25, grip: 5.5, driftGrip: 1.2,
    steerMax: 0.55, steerRate: 4, maxYaw: 2.4,
    surf: { [SURF.PAVED]: 1, [SURF.DIRT]: 0.85, [SURF.GRASS]: 0.6, [SURF.FIELD]: 0.45, [SURF.WATER]: 0.3 },
    cam: { dist: 6, height: 2.6, look: 1.0 }, engine: { base: 70, range: 160, type: 'sawtooth' },
  },
  moto: {
    name: 'Krosska', model: motoModel, radius: 0.7, wheelbase: 1.45,
    maxSpeed: 27, reverse: 3, accel: 11, brake: 16, drag: 0.2, grip: 7, driftGrip: 1.6,
    steerMax: 0.5, steerRate: 5, maxYaw: 2.6,
    surf: { [SURF.PAVED]: 1, [SURF.DIRT]: 0.95, [SURF.GRASS]: 0.85, [SURF.FIELD]: 0.75, [SURF.WATER]: 0.4 },
    cam: { dist: 5.5, height: 2.4, look: 1.2 }, engine: { base: 95, range: 260, type: 'sawtooth' },
    lean: true, springy: 1.2,
  },
  mower: {
    name: 'Traktor se sekačkou', model: mowerModel, radius: 1.7, wheelbase: 2.2,
    maxSpeed: 7, reverse: 3, accel: 2.8, brake: 8, drag: 0.35, grip: 9, driftGrip: 4,
    steerMax: 0.65, steerRate: 2.4, maxYaw: 1.3,
    surf: { [SURF.PAVED]: 1, [SURF.DIRT]: 1, [SURF.GRASS]: 1, [SURF.FIELD]: 0.95, [SURF.WATER]: 0.5 },
    cam: { dist: 9, height: 5, look: 1.8 }, engine: { base: 30, range: 50, type: 'square' },
  },
  tractor: {
    name: 'Traktor', model: tractorModel, radius: 1.7, wheelbase: 2.2,
    maxSpeed: 11, reverse: 4, accel: 3.2, brake: 8, drag: 0.35, grip: 9, driftGrip: 4,
    steerMax: 0.6, steerRate: 2.2, maxYaw: 1.2,
    surf: { [SURF.PAVED]: 1, [SURF.DIRT]: 1, [SURF.GRASS]: 0.95, [SURF.FIELD]: 0.9, [SURF.WATER]: 0.5 },
    cam: { dist: 9, height: 4.2, look: 1.8 }, engine: { base: 32, range: 45, type: 'square' },
  },
};

const tmpN = new THREE.Vector3(), tmpF = new THREE.Vector3(), tmpR = new THREE.Vector3(), tmpM = new THREE.Matrix4();

export class Vehicle {
  constructor(kind, world) {
    this.kind = kind;
    this.p = VEHICLES[kind];
    this.world = world;
    const m = this.p.model();
    this.group = m.group;
    this.wheels = m.wheels;
    this.exhaustTop = m.exhaustTop;
    this.tilt = m.tilt || null;
    this.cutPoint = m.cutPoint || null;
    // srážkový obrys, když vozidlo stojí zaparkované
    this.dyn = { poly: [[0, 0], [0, 0], [0, 0], [0, 0]], cx: 1e9, cz: 1e9, r: 4, vx: 0, vz: 0 };
    this.vy = 0;
    this.air = 0;      // jak dlouho je ve vzduchu
    this.onBridge = false;
    this.landed = 0;   // síla dopadu (pro zvuk)
    this.pos = { x: 0, z: 0 };
    this.y = 0;
    this.heading = 0;
    this.vx = 0; this.vz = 0;
    this.steer = 0;
    this.speed = 0;
    this.wheelSpin = 0;
    this.bump = 0;
    this.surface = SURF.PAVED;
    this.up = new THREE.Vector3(0, 1, 0);
  }

  place(x, z, heading) {
    this.pos.x = x; this.pos.z = z; this.heading = heading;
    this.vx = this.vz = 0; this.speed = 0; this.steer = 0;
    this.y = this.world.ground(x, z).h;
    this.vy = 0; this.air = 0; this.lastGround = this.y; this.onBridge = false;
    this.up.set(0, 1, 0);
    this.updateVisual(0);
  }

  update(dt, input) {
    const P = this.p, T = this.world.terrain;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = fz, rz = -fx; // vpravo

    let fwd = this.vx * fx + this.vz * fz;
    let lat = this.vx * rx + this.vz * rz;

    this.surface = this.onBridge ? SURF.PAVED : this.world.surface(this.pos.x, this.pos.z);
    const sf = P.surf[this.surface] ?? 0.7;
    const flying = this.air > 0.08;
    const vmax = P.maxSpeed * sf;

    // plyn / brzda / couvání
    if (flying) { /* ve vzduchu kola nezaberou */ } else if (input.throttle > 0) {
      if (fwd < -0.5) fwd += P.brake * dt;
      else if (fwd < vmax) fwd += P.accel * input.throttle * dt * (1 - Math.max(0, fwd) / (vmax * 1.05));
    } else if (input.throttle < 0) {
      if (fwd > 0.5) fwd -= P.brake * dt;
      else if (fwd > -P.reverse) fwd -= P.accel * 0.6 * dt;
    }
    // odpor, mimo silnici víc
    const roll = (1 - sf) * 2.2 + 0.3;
    fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), (P.drag * Math.abs(fwd) + roll) * dt);
    if (fwd > vmax) fwd -= (fwd - vmax) * 2 * dt;

    // svah
    if (!flying) {
      const G = this.world.ground;
      const ahead = G(this.pos.x + fx * 1.5, this.pos.z + fz * 1.5, this.y).h;
      const behind = G(this.pos.x - fx * 1.5, this.pos.z - fz * 1.5, this.y).h;
      const slope = (ahead - behind) / 3;
      fwd -= 9.81 * slope * dt * 0.75;
    }

    // zatáčení (citlivost klesá s rychlostí)
    const target = input.steer * P.steerMax * (1 / (1 + Math.abs(fwd) * 0.04));
    this.steer += (target - this.steer) * Math.min(1, P.steerRate * dt);
    let yaw = (fwd / P.wheelbase) * Math.tan(this.steer);
    yaw = Math.max(-P.maxYaw, Math.min(P.maxYaw, yaw));
    this.heading += yaw * dt * (flying ? 0.3 : 1);

    // boční přilnavost (ruční brzda = smyk)
    const grip = input.handbrake ? P.driftGrip : P.grip * (this.surface === SURF.PAVED ? 1 : 0.8);
    if (!flying) lat *= Math.exp(-grip * dt);
    if (input.handbrake) fwd *= Math.exp(-0.6 * dt);

    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    const nrx = nfz, nrz = -nfx;
    this.vx = nfx * fwd + nrx * lat;
    this.vz = nfz * fwd + nrz * lat;

    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;

    // srážky
    const hit = this.world.colliders.resolve(this.pos, P.radius, this.dyn);
    if (hit) {
      const vn = this.vx * hit.x + this.vz * hit.z;
      if (vn < 0) {
        this.vx -= hit.x * vn * 1.35;
        this.vz -= hit.z * vn * 1.35;
        this.vx *= 0.75; this.vz *= 0.75;
        if (vn < -3) this.bump = Math.min(1, -vn / 12);
      }
      if (hit.dynamic) { // vlak tě odstrčí
        this.vx += hit.x * 4 + (hit.dynamic.vx || 0) * 0.5;
        this.vz += hit.z * 4 + (hit.dynamic.vz || 0) * 0.5;
        this.bump = Math.max(this.bump, 0.6);
      }
    }
    // hranice mapy
    const hw = T.W / 2 - 15, hh = T.H / 2 - 15;
    if (Math.abs(this.pos.x) > hw) { this.pos.x = Math.sign(this.pos.x) * hw; this.vx *= -0.3; }
    if (Math.abs(this.pos.z) > hh) { this.pos.z = Math.sign(this.pos.z) * hh; this.vz *= -0.3; }

    this.speed = this.vx * nfx + this.vz * nfz;

    // svislý pohyb: drží se země; dolů (z mostu do potoka) padá, nahoru nevyskakuje
    const g = this.world.ground(this.pos.x, this.pos.z, this.y);
    this.onBridge = g.bridge;
    if (g.h >= this.y - 0.05) {
      if (this.air > 0.25 && this.vy < -5) this.landed = Math.min(1, -this.vy / 14);
      // plynule nahoru (žádné cukání na hranách)
      this.y = g.h - this.y > 1.5 ? g.h : this.y + (g.h - this.y) * Math.min(1, dt * 25);
      if (this.y < g.h - 0.02) this.y = Math.max(this.y, g.h - 0.15);
      this.vy = 0;
      this.air = 0;
    } else {
      // pod námi je díra (konec mostu, sráz) – gravitace, ale jen když je to opravdu hodně dolů
      if (this.y - g.h > 0.6 || this.air > 0) {
        this.vy -= 22 * dt;
        this.y = Math.max(g.h, this.y + this.vy * dt);
        this.air += dt;
      } else {
        this.y = g.h; this.vy = 0; this.air = 0;
      }
    }
    this.lastGround = g.h;
    this.updateVisual(dt);
  }

  updateVisual(dt) {
    const T = this.world.terrain;
    if (this.lastGround === undefined) this.lastGround = this.y;
    if (this.onBridge) tmpN.set(0, 1, 0);
    else if (this.air > 0.08) tmpN.copy(this.up);
    else T.normal(this.pos.x, this.pos.z, tmpN);
    // vyhlazení náklonu
    this.up.lerp(tmpN, dt ? Math.min(1, dt * 10) : 1).normalize();
    tmpF.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    tmpR.crossVectors(this.up, tmpF).normalize();
    tmpF.crossVectors(tmpR, this.up).normalize();
    tmpM.makeBasis(tmpR, this.up, tmpF);
    this.group.quaternion.setFromRotationMatrix(tmpM);
    let shake = 0;
    if (this.surface !== SURF.PAVED && Math.abs(this.speed) > 1) shake = (Math.random() - 0.5) * 0.05 * Math.min(1, Math.abs(this.speed) / 8);
    this.group.position.set(this.pos.x, this.y + shake, this.pos.z);
    {
      const r = this.p.radius * 0.9, fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      const L = r * 1.25, Wd = r * 0.75, d = this.dyn;
      d.cx = this.pos.x; d.cz = this.pos.z;
      d.poly[0] = [this.pos.x + fx * L + fz * Wd, this.pos.z + fz * L - fx * Wd];
      d.poly[1] = [this.pos.x + fx * L - fz * Wd, this.pos.z + fz * L + fx * Wd];
      d.poly[2] = [this.pos.x - fx * L - fz * Wd, this.pos.z - fz * L + fx * Wd];
      d.poly[3] = [this.pos.x - fx * L + fz * Wd, this.pos.z - fz * L - fx * Wd];
    }

    this.wheelSpin += (this.speed * dt);
    if (this.tilt) {
      // motorka se v zatáčce naklání
      const lean = this.air > 0.08 ? 0 : -this.steer * Math.min(1, Math.abs(this.speed) / 10) * 1.1;
      this.tilt.rotation.z += (lean - this.tilt.rotation.z) * Math.min(1, (dt || 0) * 8);
    }
    for (const w of this.wheels) {
      w.rotation.x = this.wheelSpin / w.userData.r;
      w.rotation.y = w.userData.front ? this.steer : 0;
      w.rotation.order = 'YXZ';
    }
    this.bump *= Math.exp(-(dt || 0) * 6);
  }
}
