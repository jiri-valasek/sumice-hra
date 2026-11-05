// Oživení vesnice: auta na silnicích a lidé na chodnících
import * as THREE from 'three';

const mat = (hex) => new THREE.MeshLambertMaterial({ color: hex });
const box = (g, w, h, d, m, x, y, z) => {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z); b.castShadow = true; g.add(b); return b;
};

// ------------------------------------------------------------ síť cest (graf)
function buildGraph(map, types, W, H) {
  const key = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  const inside = (p) => Math.abs(p[0]) < W / 2 - 20 && Math.abs(p[1]) < H / 2 - 20;
  const ways = map.roads.filter((r) => types.includes(r.t));
  const count = new Map();
  for (const r of ways) for (const p of r.p) count.set(key(p), (count.get(key(p)) || 0) + 1);
  const edges = [], adj = new Map();
  const addAdj = (k, e, fwd) => { if (!adj.has(k)) adj.set(k, []); adj.get(k).push({ e, fwd }); };
  for (const r of ways) {
    let start = 0;
    for (let i = 1; i < r.p.length; i++) {
      const isNode = i === r.p.length - 1 || count.get(key(r.p[i])) > 1 || !inside(r.p[i]);
      if (!isNode) continue;
      const pts = r.p.slice(start, i + 1);
      if (pts.every(inside) && pts.length > 1) {
        const cum = [0];
        for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
        const e = { pts, cum, len: cum[cum.length - 1], a: key(pts[0]), b: key(pts[pts.length - 1]), w: r.w };
        if (e.len > 0.5) { edges.push(e); addAdj(e.a, e, true); addAdj(e.b, e, false); }
      }
      start = i;
    }
  }
  return { edges, adj };
}

function pointOn(e, s) {
  s = Math.max(0, Math.min(e.len, s));
  let lo = 0, hi = e.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.cum[m] <= s) lo = m; else hi = m; }
  const a = e.pts[lo], b = e.pts[hi];
  const f = (s - e.cum[lo]) / ((e.cum[hi] - e.cum[lo]) || 1);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

class Walker {
  // společný pohyb po grafu (auto i chodec)
  constructor(graph, rnd) {
    this.g = graph; this.rnd = rnd;
    // náhodná hrana (podle délky)
    const total = graph.edges.reduce((t, e) => t + e.len, 0);
    let r = rnd() * total;
    for (const e of graph.edges) { r -= e.len; if (r <= 0) { this.e = e; break; } }
    this.e = this.e || graph.edges[0];
    this.fwd = rnd() < 0.5;
    this.s = rnd() * this.e.len;
  }
  // pozice a směr v metru `ahead` před námi (přes křižovatky po současné trase)
  pos(ahead = 0) {
    const s = this.fwd ? this.s + ahead : this.s - ahead;
    const p = pointOn(this.e, s);
    const q = pointOn(this.e, this.fwd ? s + 1 : s - 1);
    let dx = q[0] - p[0], dz = q[1] - p[1];
    const l = Math.hypot(dx, dz) || 1;
    return { x: p[0], z: p[1], fx: dx / l, fz: dz / l };
  }
  advance(d) {
    this.s += this.fwd ? d : -d;
    const over = this.fwd ? this.s - this.e.len : -this.s;
    if (over > 0) {
      const node = this.fwd ? this.e.b : this.e.a;
      const opts = (this.g.adj.get(node) || []).filter((o) => o.e !== this.e);
      if (!opts.length) { this.fwd = !this.fwd; this.s = this.fwd ? 0 : this.e.len; return; } // slepá ulice -> otočit
      const o = opts[Math.floor(this.rnd() * opts.length)];
      this.e = o.e; this.fwd = o.fwd; this.s = o.fwd ? over : o.e.len - over;
    }
  }
}

// ------------------------------------------------------------ modely
const CAR_COLORS = ['#c0392b', '#f4f4f4', '#2e5fa8', '#b9bdc2', '#222428', '#2f7a4a', '#e8b52a', '#7a2f5a', '#d9d9d9'];
function carModel(color) {
  const g = new THREE.Group();
  const body = mat(color), glass = mat('#2b3542'), black = mat('#1b1b1b');
  box(g, 1.75, 0.65, 4.1, body, 0, 0.62, 0);
  box(g, 1.6, 0.6, 2.1, glass, 0, 1.22, -0.25);
  box(g, 1.62, 0.08, 1.9, body, 0, 1.55, -0.3);
  box(g, 1.5, 0.12, 0.06, mat('#fff6c8'), 0, 0.75, 2.06);
  box(g, 1.5, 0.12, 0.06, mat('#c0262b'), 0, 0.8, -2.06);
  const wheels = [];
  for (const [x, z] of [[-0.82, 1.3], [0.82, 1.3], [-0.82, -1.3], [0.82, -1.3]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 12), black);
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.33, z); g.add(w); wheels.push(w);
  }
  return { g, wheels };
}

const SHIRTS = ['#c0392b', '#2e86c1', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#d35400', '#ecf0f1', '#34495e', '#e84393'];
const PANTS = ['#2c3e50', '#34495e', '#5d4037', '#1f3a5f', '#4a4a4a', '#7f8c8d'];
const HAIR = ['#3b2a1a', '#6b4a2a', '#c9a15a', '#1c1c1c', '#9a9a9a', '#8a3a1a'];
function personModel(rnd, kid) {
  const g = new THREE.Group();
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const shirt = mat(pick(SHIRTS)), pants = mat(pick(PANTS)), skin = mat('#f1c9a5');
  const legs = [], arms = [];
  for (const x of [-0.1, 0.1]) {
    const leg = new THREE.Group(); leg.position.set(x, 0.85, 0);
    box(leg, 0.13, 0.85, 0.15, pants, 0, -0.42, 0);
    g.add(leg); legs.push(leg);
  }
  box(g, 0.42, 0.6, 0.24, shirt, 0, 1.15, 0);
  for (const x of [-0.27, 0.27]) {
    const arm = new THREE.Group(); arm.position.set(x, 1.42, 0);
    box(arm, 0.1, 0.58, 0.12, shirt, 0, -0.28, 0);
    g.add(arm); arms.push(arm);
  }
  box(g, 0.24, 0.26, 0.24, skin, 0, 1.6, 0);
  box(g, 0.26, 0.08, 0.26, mat(pick(HAIR)), 0, 1.75, 0);
  if (kid) g.scale.setScalar(0.68);
  return { g, legs, arms };
}

// ------------------------------------------------------------ provoz
export class Traffic {
  constructor(map, world, scene, opts = {}) {
    this.world = world;
    const [W, H] = map.size;
    let seed = 4242;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    this.rnd = rnd;
    this.cars = [];
    this.people = [];
    this.onHonk = null;

    const roadG = buildGraph(map, ['secondary', 'tertiary', 'unclassified', 'residential', 'living_street'], W, H);
    const walkG = buildGraph(map, ['footway', 'path', 'pedestrian', 'living_street', 'residential'], W, H);

    if (roadG.edges.length) {
      for (let i = 0; i < (opts.cars ?? 9); i++) {
        const m = carModel(CAR_COLORS[i % CAR_COLORS.length]);
        scene.add(m.g);
        const car = { w: new Walker(roadG, rnd), m, v: 0, cruise: 8 + rnd() * 4, wait: 0, honked: 0,
          dyn: { poly: [[0, 0], [0, 0], [0, 0], [0, 0]], cx: 0, cz: 0, r: 4, vx: 0, vz: 0 } };
        world.colliders.dynamic.push(car.dyn);
        this.cars.push(car);
      }
    }
    if (walkG.edges.length) {
      for (let i = 0; i < (opts.people ?? 30); i++) {
        const kid = rnd() < 0.25;
        const m = personModel(rnd, kid);
        scene.add(m.g);
        const w = new Walker(walkG, rnd);
        // na silnici (residential) chodí po kraji, na chodníku uprostřed
        const p = { w, m, v: 1.0 + rnd() * 0.6, phase: rnd() * 6, side: 0, sideT: 0, wave: 0, lane: (rnd() < 0.5 ? -1 : 1) * (0.2 + rnd() * 0.3),
          dyn: { circle: true, x: 0, z: 0, r: kid ? 0.3 : 0.4, cx: 0, cz: 0 } };
        world.colliders.dynamic.push(p.dyn);
        this.people.push(p);
      }
    }
  }

  // troubení hráče: lidé v okolí zamávají
  horn(player) {
    for (const p of this.people) {
      if (Math.hypot(p.dyn.x - player.pos.x, p.dyn.z - player.pos.z) < 30) p.wave = 2.2;
    }
  }

  update(dt, player) {
    const G = this.world.ground;
    const px = player.pos.x, pz = player.pos.z;
    // ---- auta
    for (const c of this.cars) {
      const here = c.w.pos(0);
      // zatáčka před námi -> zpomal
      const ahead = c.w.pos(12);
      const turn = Math.acos(Math.max(-1, Math.min(1, here.fx * ahead.fx + here.fz * ahead.fz)));
      let target = c.cruise * Math.max(0.35, 1 - turn / 1.3);
      // překážky v jízdním pruhu: hráč a ostatní auta
      const rx = -here.fz, rz = here.fx; // vpravo
      const obstacles = [[px, pz, 1]];
      for (const o of this.cars) if (o !== c) obstacles.push([o.dyn.cx, o.dyn.cz, 0]);
      let blockedByPlayer = false;
      for (const [ox, oz, isPlayer] of obstacles) {
        const dx = ox - here.x, dz = oz - here.z;
        const along = dx * here.fx + dz * here.fz;
        const lat = Math.abs(dx * rx + dz * rz - 1.5);
        if (along > 0 && along < 16 && lat < 2.4) {
          target = Math.min(target, Math.max(0, (along - 6.5) * 1.1));
          if (isPlayer && along < 12) blockedByPlayer = true;
        }
      }
      const acc = target > c.v ? 2.5 : 6;
      c.v += Math.sign(target - c.v) * Math.min(Math.abs(target - c.v), acc * dt);
      c.w.advance(c.v * dt);
      // troubení, když stojíš autu v cestě
      if (blockedByPlayer && c.v < 0.5) { c.wait += dt; if (c.wait > 2.5 && c.honked <= 0 && this.onHonk) { this.onHonk(Math.hypot(here.x - px, here.z - pz)); c.honked = 6; } }
      else c.wait = 0;
      c.honked -= dt;

      const p = c.w.pos(0);
      const x = p.x + -p.fz * 1.5, z = p.z + p.fx * 1.5; // jízda vpravo
      const y = G(x, z).h + 0.05;
      c.m.g.position.set(x, y, z);
      const yaw = Math.atan2(p.fx, p.fz);
      c.m.g.rotation.set(0, yaw, 0);
      c.m.g.visible = Math.hypot(x - px, z - pz) < 700;
      for (const w of c.m.wheels) w.rotation.x += c.v * dt / 0.33;
      const d = c.dyn, hl = 2.1, hw = 0.95;
      d.cx = x; d.cz = z; d.vx = p.fx * c.v; d.vz = p.fz * c.v;
      d.poly[0] = [x + p.fx * hl + -p.fz * hw, z + p.fz * hl + p.fx * hw];
      d.poly[1] = [x + p.fx * hl - -p.fz * hw, z + p.fz * hl - p.fx * hw];
      d.poly[2] = [x - p.fx * hl - -p.fz * hw, z - p.fz * hl - p.fx * hw];
      d.poly[3] = [x - p.fx * hl + -p.fz * hw, z - p.fz * hl + p.fx * hw];
    }

    // ---- lidé
    for (const h of this.people) {
      const here = h.w.pos(0);
      const dx = px - h.dyn.x, dz = pz - h.dyn.z;
      const dist = Math.hypot(dx, dz);
      // vozidlo blízko -> uhni stranou a počkej
      let v = h.v;
      if (dist < 7) {
        const side = (dx * -here.fz + dz * here.fx) > 0 ? -1 : 1; // na opačnou stranu, než jede hráč
        h.side = side * 2.6; h.sideT = 2.5; v = 0;
      } else if (h.sideT > 0) { h.sideT -= dt; v = h.v * 0.4; }
      else h.side *= Math.exp(-dt * 1.5);
      h.w.advance(v * dt);
      const p = h.w.pos(0);
      const off = h.lane + h.side + (h.w.e.w > 4 ? (h.lane > 0 ? 1 : -1) * (h.w.e.w / 2 - 0.4) : 0);
      const cur = h.m.g.position;
      const tx = p.x + -p.fz * off, tz = p.z + p.fx * off;
      // plynulý přesun (uhýbání)
      const k = Math.min(1, dt * 6);
      const x = cur.x === 0 && cur.z === 0 ? tx : cur.x + (tx - cur.x) * k;
      const z = cur.x === 0 && cur.z === 0 ? tz : cur.z + (tz - cur.z) * k;
      h.m.g.position.set(x, G(x, z).h, z);
      const yaw = dist < 7 ? Math.atan2(dx, dz) : Math.atan2(p.fx * (h.w.fwd ? 1 : 1), p.fz);
      h.m.g.rotation.y += (((yaw - h.m.g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 8);
      h.m.g.visible = dist < 450;
      // chůze
      h.phase += v * dt * 5;
      const sw = Math.sin(h.phase) * 0.5 * Math.min(1, v);
      h.m.legs[0].rotation.x = sw; h.m.legs[1].rotation.x = -sw;
      h.m.arms[0].rotation.x = -sw * 0.8;
      if (h.wave > 0) { h.wave -= dt; h.m.arms[1].rotation.x = 0; h.m.arms[1].rotation.z = 2.6 + Math.sin(h.wave * 14) * 0.4; }
      else { h.m.arms[1].rotation.z = 0; h.m.arms[1].rotation.x = sw * 0.8; }
      h.dyn.x = x; h.dyn.z = z; h.dyn.cx = x; h.dyn.cz = z;
    }
  }
}
