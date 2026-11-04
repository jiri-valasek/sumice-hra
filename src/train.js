// Vláček (motorák), který jezdí tam a zpět po trati a staví na zastávce Šumice
import * as THREE from 'three';

const mat = (hex, extra = {}) => new THREE.MeshLambertMaterial({ color: hex, ...extra });

function carModel(front) {
  const g = new THREE.Group();
  const L = 14.5, W = 2.9;
  const red = mat('#c8282b'), white = mat('#eef0f2'), dark = mat('#1d2a3a'), grey = mat('#7b8085'), black = mat('#222');
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; g.add(b); return b; };
  box(W, 1.2, L, red, 0, 1.6, 0);               // spodek skříně
  box(W, 1.3, L, white, 0, 2.85, 0);            // horní část
  box(W + 0.02, 0.75, L - 1.6, dark, 0, 2.9, 0); // pás oken
  box(W - 0.2, 0.35, L - 0.4, grey, 0, 3.65, 0); // střecha
  box(W, 0.3, L, black, 0, 0.85, 0);            // rám
  for (const z of [-L / 2 + 2.6, L / 2 - 2.6]) {   // podvozky
    box(2.2, 0.7, 2.6, black, 0, 0.55, z);
    for (const dz of [-0.8, 0.8]) for (const x of [-0.75, 0.75]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.15, 14), grey);
      w.rotation.z = Math.PI / 2; w.position.set(x, 0.45, z + dz); g.add(w);
    }
  }
  for (const s of [-1, 1]) for (const z of [-L / 2 + 1.3, L / 2 - 1.3]) box(0.04, 1.9, 1.0, mat('#f2c230'), s * (W / 2 + 0.01), 2.0, z); // dveře
  if (front) {
    for (const end of [-1, 1]) {
      box(W - 0.3, 0.9, 0.05, dark, 0, 2.9, end * (L / 2 + 0.01));
      for (const x of [-0.9, 0.9]) {
        const l = box(0.3, 0.2, 0.06, mat('#fff8cc', { emissive: '#887722' }), x, 1.5, end * (L / 2 + 0.02));
        l.castShadow = false;
      }
    }
  }
  return g;
}

export class Train {
  constructor(map, scene, colliders, stopPoi) {
    this.line = map.trainLine || [];
    this.ok = this.line.length > 10;
    if (!this.ok) return;
    this.cum = [0];
    for (let i = 1; i < this.line.length; i++) {
      const a = this.line[i - 1], b = this.line[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    this.total = this.cum[this.cum.length - 1];
    this.cars = [carModel(true), carModel(true)];
    this.cars.forEach((c) => scene.add(c));
    this.carLen = 14.5;
    this.gap = 1.0;
    this.colliders = colliders;
    this.dyn = this.cars.map(() => ({ poly: [[0, 0], [0, 0], [0, 0], [0, 0]], cx: 0, cz: 0, r: 9 }));
    colliders.dynamic.push(...this.dyn);
    // zastávka
    this.stopAt = null;
    if (stopPoi) {
      let best = Infinity;
      this.line.forEach((p, i) => { const d = (p[0] - stopPoi.x) ** 2 + (p[1] - stopPoi.z) ** 2; if (d < best) { best = d; this.stopAt = this.cum[i]; } });
    }
    // start kousek před zastávkou, ať je vlak brzo vidět
    this.s = this.stopAt !== null ? Math.max(40, this.stopAt - 350) : Math.min(this.total - 60, 80);
    this.dir = 1;
    this.v = 0;
    this.wait = 3;
    this.maxV = 15;
    this.servedStop = false;
    this.hornCooldown = 0;
    this.onHorn = null;
  }

  at(s) {
    s = Math.max(0, Math.min(this.total, s));
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    const a = this.line[lo], b = this.line[hi];
    const f = (s - this.cum[lo]) / ((this.cum[hi] - this.cum[lo]) || 1);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  update(dt, player) {
    if (!this.ok) return;
    const trainLen = this.carLen * 2 + this.gap;
    // kam jedeme a kde zastavit
    const head = this.s;
    const endS = this.dir > 0 ? this.total - 5 : trainLen + 5;
    let target = endS;
    if (this.stopAt !== null && !this.servedStop) {
      const stopHead = this.stopAt + this.dir * trainLen / 2;
      if ((stopHead - head) * this.dir > 0) target = stopHead;
    }
    const dist = (target - head) * this.dir;
    if (this.wait > 0) {
      this.wait -= dt;
      this.v = 0;
      if (this.wait <= 0 && this.onHorn) this.onHorn(this.distTo(player));
    } else {
      const brake = (this.v * this.v) / (2 * 0.8);
      if (dist <= brake + 0.5) this.v = Math.max(0, this.v - 0.8 * dt);
      else this.v = Math.min(this.maxV, this.v + 0.6 * dt);
      if (dist <= 0.6 || (this.v === 0 && dist < 3)) {
        this.v = 0;
        if (target === endS) { this.dir *= -1; this.s = head; this.servedStop = false; this.wait = 8; }
        else { this.servedStop = true; this.wait = 12; }
      }
    }
    this.s += this.v * this.dir * dt;

    // pozice vozů
    let s = this.s;
    this.cars.forEach((car, k) => {
      const sf = s, sb = s - this.dir * this.carLen;
      const f = this.at(sf - this.dir * 2.6), b = this.at(sb + this.dir * 2.6);
      const mx = (f[0] + b[0]) / 2, mz = (f[1] + b[1]) / 2, my = (f[2] + b[2]) / 2;
      car.position.set(mx, my + 0.3, mz);
      const yaw = Math.atan2(f[0] - b[0], f[1] - b[1]);
      const pitch = -Math.atan2(f[2] - b[2], Math.hypot(f[0] - b[0], f[1] - b[1]));
      car.rotation.set(pitch, yaw, 0, 'YXZ');
      // kolize
      const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = fz, rz = -fx;
      const hl = this.carLen / 2, hw = 1.5;
      const d = this.dyn[k];
      d.cx = mx; d.cz = mz;
      d.poly[0] = [mx + fx * hl + rx * hw, mz + fz * hl + rz * hw];
      d.poly[1] = [mx + fx * hl - rx * hw, mz + fz * hl - rz * hw];
      d.poly[2] = [mx - fx * hl - rx * hw, mz - fz * hl - rz * hw];
      d.poly[3] = [mx - fx * hl + rx * hw, mz - fz * hl + rz * hw];
      d.vx = fx * this.v * this.dir; d.vz = fz * this.v * this.dir;
      s -= this.dir * (this.carLen + this.gap);
    });

    // houkání, když jede blízko hráče
    this.hornCooldown -= dt;
    if (this.v > 4 && this.hornCooldown <= 0 && this.onHorn) {
      const d = this.distTo(player);
      if (d < 140) { this.onHorn(d); this.hornCooldown = 14; }
    }
  }

  distTo(player) {
    const p = this.cars[0].position;
    return Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
  }
}
