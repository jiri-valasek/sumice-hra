// Práce na louce a v lese: kosení traktorem a kácení motorovou pilou
import * as THREE from 'three';
import { chainsawModel, logMesh } from './player.js';

const mat = (hex) => new THREE.MeshLambertMaterial({ color: hex });

function pip(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, z1] = poly[j], [x2, z2] = poly[i];
    if ((z1 > z) !== (z2 > z) && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) c = !c;
  }
  return c;
}

// ------------------------------------------------------------ louka ke kosení
export class Meadow {
  constructor(ring, terrain, scene) {
    this.ring = ring;
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    this.x0 = Math.min(...xs) - 1; this.z0 = Math.min(...zs) - 1;
    this.w = Math.max(...xs) + 1 - this.x0; this.h = Math.max(...zs) + 1 - this.z0;
    this.cx = (this.x0 + this.w / 2); this.cz = (this.z0 + this.h / 2);
    this.res = 0.35;
    const c = this.canvas = document.createElement('canvas');
    c.width = Math.ceil(this.w / this.res); c.height = Math.ceil(this.h / this.res);
    const ctx = this.ctx = c.getContext('2d');
    // neposečená louka: sytá tráva s kytičkami
    ctx.save();
    this.path(ctx); ctx.clip();
    ctx.fillStyle = '#4c8f35'; ctx.fillRect(0, 0, c.width, c.height);
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < c.width * c.height * 0.08; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(30,70,20,0.35)' : 'rgba(120,170,70,0.35)';
      ctx.fillRect(rnd() * c.width, rnd() * c.height, 1, 2 + rnd() * 3);
    }
    for (let i = 0; i < c.width * c.height * 0.006; i++) {
      ctx.fillStyle = ['#ffffff', '#f7d83a', '#b48ad8', '#e8584a'][Math.floor(rnd() * 4)];
      ctx.fillRect(rnd() * c.width, rnd() * c.height, 2, 2);
    }
    ctx.restore();
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    // síť přehozená přes terén
    const sx = Math.ceil(this.w / 3), sz = Math.ceil(this.h / 3);
    const g = new THREE.PlaneGeometry(this.w, this.h, sx, sz);
    g.rotateX(-Math.PI / 2);
    g.translate(this.cx, 0, this.cz);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrain.height(pos.getX(i), pos.getZ(i)) + 0.1);
    g.computeVertexNormals();
    // UV: canvas řádek 0 = nejmenší z (sever)
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - this.x0) / this.w, 1 - (pos.getZ(i) - this.z0) / this.h);
    const m = new THREE.MeshLambertMaterial({ map: this.tex, transparent: true, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -6 });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    // trsy vysoké trávy (zmizí pod sekačkou)
    const tuft = new THREE.ConeGeometry(0.28, 0.75, 4, 1, true);
    tuft.translate(0, 0.37, 0);
    const pts = [];
    for (let i = 0; i < this.w * this.h / 1.6; i++) {
      const x = this.x0 + rnd() * this.w, z = this.z0 + rnd() * this.h;
      if (pip(x, z, ring)) pts.push([x, z]);
    }
    this.tufts = new THREE.InstancedMesh(tuft, new THREE.MeshLambertMaterial({ color: '#4f9a37', side: THREE.DoubleSide }), pts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    this.cell = new Map();
    pts.forEach(([x, z], i) => {
      const k = 0.8 + rnd() * 0.6;
      m4.compose(p.set(x, terrain.height(x, z), z), q.setFromAxisAngle(up, rnd() * 6), sc.set(k, k * (0.8 + rnd() * 0.5), k));
      this.tufts.setMatrixAt(i, m4);
      this.tufts.setColorAt(i, col.setHSL(0.27 + rnd() * 0.05, 0.45, 0.32 + rnd() * 0.1));
      const key = Math.floor(x / 4) * 100003 + Math.floor(z / 4);
      if (!this.cell.has(key)) this.cell.set(key, []);
      this.cell.get(key).push({ i, x, z, cut: false });
    });
    scene.add(this.tufts);

    // postup: mřížka 1 m
    this.grid = new Map(); this.total = 0; this.done = 0;
    for (let x = Math.floor(this.x0); x < this.x0 + this.w; x++) {
      for (let z = Math.floor(this.z0); z < this.z0 + this.h; z++) {
        if (pip(x + 0.5, z + 0.5, ring)) { this.grid.set(x * 100003 + z, false); this.total++; }
      }
    }
    this.dirty = false;
    this.finished = false;
  }

  path(ctx) {
    ctx.beginPath();
    this.ring.forEach(([x, z], i) => {
      const px = (x - this.x0) / this.res, py = (z - this.z0) / this.res;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.closePath();
  }

  inside(x, z) { return pip(x, z, this.ring); }
  get progress() { return this.total ? this.done / this.total : 0; }

  // poseč kruh (x, z, r) – heading kvůli směru pruhů
  cut(x, z, r, heading) {
    if (x < this.x0 - r || x > this.x0 + this.w + r || z < this.z0 - r || z > this.z0 + this.h + r) return 0;
    const ctx = this.ctx;
    ctx.save();
    this.path(ctx); ctx.clip();
    const px = (x - this.x0) / this.res, py = (z - this.z0) / this.res;
    // pruhy podle směru jízdy (jako na posečené louce)
    const stripe = Math.floor((x * Math.cos(heading) - z * Math.sin(heading)) / 4.4) % 2 === 0;
    ctx.fillStyle = stripe ? '#8fc463' : '#9fd06f';
    ctx.beginPath(); ctx.arc(px, py, r / this.res, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    this.dirty = true;
    let n = 0;
    for (let gx = Math.floor(x - r); gx <= Math.floor(x + r); gx++) {
      for (let gz = Math.floor(z - r); gz <= Math.floor(z + r); gz++) {
        const k = gx * 100003 + gz;
        if (this.grid.get(k) === false && (gx + 0.5 - x) ** 2 + (gz + 0.5 - z) ** 2 < r * r) { this.grid.set(k, true); this.done++; n++; }
      }
    }
    const m4 = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let cx = Math.floor((x - r) / 4); cx <= Math.floor((x + r) / 4); cx++) {
      for (let cz = Math.floor((z - r) / 4); cz <= Math.floor((z + r) / 4); cz++) {
        for (const t of this.cell.get(cx * 100003 + cz) || []) {
          if (!t.cut && (t.x - x) ** 2 + (t.z - z) ** 2 < r * r) {
            t.cut = true;
            this.tufts.getMatrixAt(t.i, m4);
            m4.copyPosition(m4); // zachovat pozici
            const p = new THREE.Vector3().setFromMatrixPosition(m4);
            zero.setPosition(p);
            this.tufts.setMatrixAt(t.i, zero);
            this.tufts.instanceMatrix.needsUpdate = true;
          }
        }
      }
    }
    return n;
  }

  flush() { if (this.dirty) { this.tex.needsUpdate = true; this.dirty = false; } }
}

// balíky sena po dokončení
export function hayBales(meadow, terrain, scene) {
  const g = new THREE.CylinderGeometry(0.75, 0.75, 1.2, 14);
  g.rotateZ(Math.PI / 2);
  const m = mat('#e2c35a');
  const out = [];
  let s = 3;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 60 && out.length < 9; i++) {
    const x = meadow.x0 + rnd() * meadow.w, z = meadow.z0 + rnd() * meadow.h;
    if (!meadow.inside(x, z) || out.some(([a, b]) => Math.hypot(a - x, b - z) < 9)) continue;
    const b = new THREE.Mesh(g, m);
    b.position.set(x, terrain.height(x, z) + 0.75, z);
    b.rotation.y = rnd() * 3;
    b.castShadow = true;
    scene.add(b);
    out.push([x, z, 1.0]);
  }
  return out;
}

// ------------------------------------------------------------ les ke kácení
export class Forest {
  constructor(world, scene, zones, handles, sound) {
    this.world = world; this.scene = scene; this.sound = sound;
    this.trees = handles.filter((h) => h.cut);
    this.ring = zones.forest;
    const G = (x, z) => world.ground(x, z).h;
    // stojan s pilou (pařez)
    const [sx, sz] = zones.saw;
    this.sawPos = { x: sx, z: sz };
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.7, 10), mat('#7a5634'));
    stump.position.set(sx, G(sx, sz) + 0.35, sz); stump.castShadow = true; scene.add(stump);
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.44, 10), mat('#d8b27a'));
    top.rotation.x = -Math.PI / 2; top.position.set(sx, G(sx, sz) + 0.705, sz); scene.add(top);
    this.standSaw = chainsawModel();
    this.standSaw.position.set(sx, G(sx, sz) + 0.82, sz); this.standSaw.rotation.y = 0.6;
    scene.add(this.standSaw);
    world.colliders.dynamic.push({ circle: true, x: sx, z: sz, r: 0.5, cx: sx, cz: sz });
    // hromada
    const [px, pz] = zones.pile;
    this.pilePos = { x: px, z: pz };
    this.pileY = G(px, pz);
    this.pile = [];
    const sign = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.1), mat('#5b3b25')); post.position.y = 0.7; sign.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.05), mat('#c99a5b')); board.position.y = 1.35; sign.add(board);
    sign.position.set(px - 2.4, this.pileY, pz - 1.4); scene.add(sign);
    this.logs = [];       // polena na zemi
    this.falling = [];    // padající stromy
    this.dust = [];
    const dg = new THREE.BoxGeometry(0.05, 0.05, 0.05), dm = mat('#e8d3a0');
    for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(dg, dm); m.visible = false; scene.add(m); this.dust.push({ m, v: new THREE.Vector3(), life: 0 }); }
    this.dustIdx = 0;
    this.sawTarget = null;
    this.felled = 0;
  }

  get pileCount() { return this.pile.length; }

  // nejbližší akce pro hráče pěšky
  interactions(pl) {
    const out = [];
    const d = (x, z) => Math.hypot(x - pl.pos.x, z - pl.pos.z);
    const fx = Math.sin(pl.heading), fz = Math.cos(pl.heading);
    const facing = (x, z) => { const dx = x - pl.pos.x, dz = z - pl.pos.z, l = Math.hypot(dx, dz) || 1; return (dx * fx + dz * fz) / l; };
    if (!pl.carrying) {
      const ds = d(this.sawPos.x, this.sawPos.z);
      if (ds < 2.4) out.push({ d: ds - 1, label: pl.hasSaw ? 'Vrátit pilu na pařez' : 'Vzít motorovou pilu', act: () => this.toggleSaw(pl) });
    }
    if (pl.hasSaw && !pl.carrying && pl.sawing <= 0) {
      let best = null, bd = 3.2;
      for (const t of this.trees) {
        if (!t.standing) continue;
        if (Math.abs(t.x - pl.pos.x) > 4 || Math.abs(t.z - pl.pos.z) > 4) continue;
        const dd = d(t.x, t.z);
        if (dd < bd && facing(t.x, t.z) > 0.2) { bd = dd; best = t; }
      }
      if (best) out.push({ d: bd, label: 'Pokácet strom', act: () => this.startSaw(pl, best) });
    }
    if (!pl.carrying) {
      for (const l of this.logs) {
        const dl = d(l.x, l.z);
        if (dl < 2.0) out.push({ d: dl, label: 'Zvednout poleno', act: () => this.pickLog(pl, l) });
      }
    } else {
      const dp = d(this.pilePos.x, this.pilePos.z);
      if (dp < 5) out.push({ d: 0, label: 'Položit poleno na hromadu', act: () => this.dropLog(pl, true) });
      else out.push({ d: 9, label: 'Položit poleno', act: () => this.dropLog(pl, false) });
    }
    return out;
  }

  toggleSaw(pl) {
    pl.hasSaw = !pl.hasSaw;
    this.standSaw.visible = !pl.hasSaw;
    this.sound.click();
    return pl.hasSaw ? '🪚 Máš motorovou pilu! Jdi k lesu a klikni na strom.' : 'Pila je zpátky na pařezu.';
  }

  startSaw(pl, tree) {
    this.sawTarget = tree;
    pl.sawing = 1.6;
    pl.heading = Math.atan2(tree.x - pl.pos.x, tree.z - pl.pos.z);
    this.sound.chainsaw(true);
  }

  pickLog(pl, l) {
    this.scene.remove(l.mesh);
    this.logs.splice(this.logs.indexOf(l), 1);
    pl.carrying = true;
    this.sound.click();
  }

  dropLog(pl, toPile) {
    pl.carrying = false;
    this.sound.click();
    if (toPile) {
      const n = this.pile.length;
      // pyramida: vrstvy 6,5,4,3,2,1 – pak další hromada vedle
      const perPile = 21;
      const k = n % perPile, pileNo = Math.floor(n / perPile);
      let layer = 0, left = k, inLayer = 6;
      while (left >= inLayer) { left -= inLayer; layer++; inLayer--; }
      const m = logMesh(1.6, 0.17);
      const off = (left - (inLayer - 1) / 2) * 0.36;
      m.position.set(this.pilePos.x + pileNo * 2.2, this.pileY + 0.17 + layer * 0.3, this.pilePos.z + off);
      m.rotation.y = 0;
      this.scene.add(m);
      this.pile.push(m);
      if (this.pile.length % 10 === 0) this.sound.fanfare();
      return `🪵 Na hromadě: ${this.pile.length}`;
    }
    const fx = Math.sin(pl.heading), fz = Math.cos(pl.heading);
    this.spawnLog(pl.pos.x + fx * 1.2, pl.pos.z + fz * 1.2, pl.heading + Math.PI / 2);
    return null;
  }

  spawnLog(x, z, rot, len = 1.6, r = 0.17) {
    const m = logMesh(len, r);
    m.position.set(x, this.world.ground(x, z).h + r, z);
    m.rotation.y = rot;
    this.scene.add(m);
    this.logs.push({ mesh: m, x, z });
  }

  update(dt, pl) {
    // řezání
    if (pl && pl.sawing > 0 && this.sawTarget) {
      pl.sawing -= dt;
      const t = this.sawTarget;
      for (let i = 0; i < 2; i++) {
        const p = this.dust[this.dustIdx++ % this.dust.length];
        p.m.position.set(t.x, this.world.ground(t.x, t.z).h + 0.5, t.z);
        p.v.set((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3);
        p.life = 0.6; p.m.visible = true;
      }
      if (pl.sawing <= 0) {
        this.sound.chainsaw(false);
        this.fell(t, Math.atan2(t.x - pl.pos.x, t.z - pl.pos.z));
        this.sawTarget = null;
      }
    }
    for (const p of this.dust) {
      if (p.life <= 0) continue;
      p.life -= dt; p.v.y -= 9 * dt; p.m.position.addScaledVector(p.v, dt);
      if (p.life <= 0) p.m.visible = false;
    }
    // padající stromy
    for (const f of [...this.falling]) {
      f.t += dt;
      const k = Math.min(1, (f.t / 1.4) ** 2);
      f.pivot.quaternion.setFromAxisAngle(f.axis, k * Math.PI / 2 * 0.96);
      if (f.t > 1.4 && !f.landed) {
        f.landed = true;
        this.sound.thud();
        const len = 1.6, n = 3;
        for (let i = 0; i < n; i++) {
          const dd = (1.2 + i * 1.75) * f.tree.scale;
          this.spawnLog(f.tree.x + Math.sin(f.dir) * dd, f.tree.z + Math.cos(f.dir) * dd, f.dir + Math.PI / 2, len, 0.15 + 0.03 * f.tree.scale);
        }
      }
      if (f.landed) {
        const s = Math.max(0, 1 - (f.t - 1.4) * 2);
        f.mesh.scale.setScalar(s * f.tree.scale);
        if (s <= 0) { this.scene.remove(f.pivot); this.falling.splice(this.falling.indexOf(f), 1); }
      }
    }
  }

  fell(t, dir) {
    t.standing = false;
    this.felled++;
    // schovat strom v InstancedMesh + vypnout srážku
    const m4 = new THREE.Matrix4().makeScale(0, 0, 0);
    t.mesh.setMatrixAt(t.index, m4);
    t.mesh.instanceMatrix.needsUpdate = true;
    if (t.col) t.col.r = -100;
    const y = this.world.ground(t.x, t.z).h;
    // pařez
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * t.scale, 0.26 * t.scale, 0.35, 8), mat('#6b4a2f'));
    stump.position.set(t.x, y + 0.17, t.z); this.scene.add(stump);
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.21 * t.scale, 8), mat('#d8b27a'));
    top.rotation.x = -Math.PI / 2; top.position.set(t.x, y + 0.351, t.z); this.scene.add(top);
    // padající kopie
    const pivot = new THREE.Group();
    pivot.position.set(t.x, y, t.z);
    const mesh = new THREE.Mesh(t.mesh.geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.scale.setScalar(t.scale); mesh.castShadow = true;
    pivot.add(mesh);
    this.scene.add(pivot);
    const axis = new THREE.Vector3(Math.cos(dir), 0, -Math.sin(dir)).normalize();
    this.falling.push({ pivot, mesh, axis, t: 0, dir, tree: t, landed: false });
  }
}
