// Chůze pěšky: postavička, která umí vystoupit ze stroje, chodit, nosit pilu a polena
import * as THREE from 'three';
import { SURF } from './world.js';

const mat = (hex) => new THREE.MeshLambertMaterial({ color: hex });
const box = (g, w, h, d, m, x, y, z) => {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z); b.castShadow = true; g.add(b); return b;
};

export function chainsawModel() {
  const g = new THREE.Group();
  box(g, 0.16, 0.2, 0.36, mat('#f07a1a'), 0, 0, 0);        // tělo
  box(g, 0.12, 0.05, 0.12, mat('#222'), 0, 0.13, -0.05);    // rukojeť
  box(g, 0.03, 0.08, 0.62, mat('#c9ccd0'), 0, -0.02, 0.48); // lišta
  box(g, 0.04, 0.1, 0.62, mat('#3a3a3a'), 0, -0.02, 0.48).scale.set(1, 0.4, 1); // řetěz
  return g;
}

export function logMesh(len = 1.6, r = 0.17) {
  const g = new THREE.Group();
  const bark = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, len, 9), mat('#6b4a2f'));
  bark.rotation.z = Math.PI / 2; bark.castShadow = true; g.add(bark);
  for (const s of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.CircleGeometry(r * 0.96, 9), mat('#d8b27a'));
    end.position.x = s * (len / 2 + 0.005); end.rotation.y = s * Math.PI / 2; g.add(end);
  }
  return g;
}

export class Walker {
  constructor(world) {
    this.world = world;
    this.kind = 'walk';
    this.p = { name: 'Pěšky', radius: 0.35, maxSpeed: 5, cam: { dist: 4.2, height: 1.9, look: 1.5 }, engine: null };
    const g = new THREE.Group();
    const skin = mat('#f1c9a5'), shirt = mat('#2e7d32'), pants = mat('#2c3e50');
    this.legs = []; this.arms = [];
    for (const x of [-0.1, 0.1]) {
      const leg = new THREE.Group(); leg.position.set(x, 0.85, 0);
      box(leg, 0.14, 0.85, 0.16, pants, 0, -0.42, 0); box(leg, 0.15, 0.1, 0.24, mat('#3b2a1a'), 0, -0.82, 0.04);
      g.add(leg); this.legs.push(leg);
    }
    box(g, 0.44, 0.62, 0.26, shirt, 0, 1.16, 0);
    for (const x of [-0.28, 0.28]) {
      const arm = new THREE.Group(); arm.position.set(x, 1.43, 0);
      box(arm, 0.11, 0.6, 0.13, shirt, 0, -0.29, 0);
      box(arm, 0.1, 0.1, 0.1, skin, 0, -0.62, 0);
      g.add(arm); this.arms.push(arm);
    }
    box(g, 0.25, 0.27, 0.25, skin, 0, 1.61, 0);
    box(g, 0.28, 0.1, 0.28, mat('#e8392b'), 0, 1.78, 0);      // kšiltovka
    box(g, 0.2, 0.03, 0.16, mat('#e8392b'), 0, 1.74, 0.2);
    this.group = g;
    // co nese
    this.saw = chainsawModel(); this.saw.position.set(0, -0.62, 0.15); this.saw.visible = false;
    this.arms[0].add(this.saw);
    this.log = logMesh(1.4, 0.15); this.log.position.set(0, 2.0, 0.05); this.log.rotation.y = Math.PI / 2; this.log.visible = false;
    g.add(this.log);
    this.hasSaw = false; this.carrying = false;
    this.pos = { x: 0, z: 0 }; this.y = 0; this.heading = 0;
    this.vx = 0; this.vz = 0; this.speed = 0; this.phase = 0;
    this.surface = SURF.GRASS; this.onBridge = false; this.air = 0; this.bump = 0; this.landed = 0;
    this.sawing = 0;
  }

  place(x, z, heading) {
    this.pos.x = x; this.pos.z = z; this.heading = heading;
    this.y = this.world.ground(x, z).h; this.vx = this.vz = 0; this.speed = 0;
    this.updateVisual(0);
  }

  // camYaw = kam se dívá kamera; šipky/WASD jdou vzhledem ke kameře
  update(dt, inp, camYaw) {
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = fz, rz = -fx;
    let mx = fx * inp.throttle + rx * inp.steer, mz = fz * inp.throttle + rz * inp.steer;
    const ml = Math.hypot(mx, mz);
    this.surface = this.onBridge ? SURF.PAVED : this.world.surface(this.pos.x, this.pos.z);
    let sp = inp.run ? 5.2 : 2.2;
    if (this.carrying) sp *= 0.7;
    if (this.surface === SURF.WATER) sp *= 0.45;
    if (this.sawing > 0) sp = 0;
    if (ml > 0.01) {
      mx /= ml; mz /= ml;
      const want = Math.atan2(mx, mz);
      let d = want - this.heading;
      d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.heading += d * Math.min(1, dt * 10);
    }
    const tvx = ml > 0.01 ? mx * sp : 0, tvz = ml > 0.01 ? mz * sp : 0;
    const k = Math.min(1, dt * 10);
    this.vx += (tvx - this.vx) * k; this.vz += (tvz - this.vz) * k;
    this.pos.x += this.vx * dt; this.pos.z += this.vz * dt;
    this.world.colliders.resolve(this.pos, this.p.radius);
    const T = this.world.terrain;
    const hw = T.W / 2 - 5, hh = T.H / 2 - 5;
    this.pos.x = Math.max(-hw, Math.min(hw, this.pos.x)); this.pos.z = Math.max(-hh, Math.min(hh, this.pos.z));
    this.speed = Math.hypot(this.vx, this.vz);
    const g = this.world.ground(this.pos.x, this.pos.z, this.y);
    this.onBridge = g.bridge;
    this.y += (g.h - this.y) * Math.min(1, dt * 20);
    if (Math.abs(g.h - this.y) > 1.5) this.y = g.h;
    this.updateVisual(dt);
  }

  updateVisual(dt) {
    this.group.position.set(this.pos.x, this.y, this.pos.z);
    this.group.rotation.y = this.heading;
    this.phase += this.speed * dt * 4.2;
    const sw = Math.sin(this.phase) * 0.6 * Math.min(1, this.speed / 2);
    this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;
    if (this.carrying) {
      this.arms[0].rotation.x = -2.9; this.arms[1].rotation.x = -2.9;
    } else if (this.hasSaw) {
      this.arms[0].rotation.x = -1.1 + (this.sawing > 0 ? Math.sin(performance.now() / 30) * 0.05 : 0);
      this.arms[1].rotation.x = -1.0;
    } else {
      this.arms[0].rotation.x = -sw * 0.8; this.arms[1].rotation.x = sw * 0.8;
    }
    this.saw.visible = this.hasSaw && !this.carrying;
    this.log.visible = this.carrying;
  }
}
