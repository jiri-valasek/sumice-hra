// Stavba světa z data/map.json + data/heights.bin
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ------------------------------------------------------------ pomocné
function hashRand(seed) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}
const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

// ------------------------------------------------------------ terén
export class Terrain {
  constructor(map, heightsBuf, lowPower = false) {
    const t = map.terrain;
    const raw = new Uint16Array(heightsBuf);
    this.W = map.size[0];
    this.H = map.size[1];
    // mřížka 5 m (stejná pro vykreslení i fyziku); slabší zařízení 10 m
    const step = lowPower ? 2 : 1;
    this.nx = Math.ceil((t.w - 1) / step) + 1;
    this.nz = Math.ceil((t.h - 1) / step) + 1;
    this.h = new Float32Array(this.nx * this.nz);
    const src = (i, j) => raw[j * t.w + i] * t.scale;
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const u = (i / (this.nx - 1)) * (t.w - 1);
        const v = (j / (this.nz - 1)) * (t.h - 1);
        const i0 = Math.min(Math.floor(u), t.w - 2), j0 = Math.min(Math.floor(v), t.h - 2);
        const fu = u - i0, fv = v - j0;
        const a = src(i0, j0) * (1 - fu) + src(i0 + 1, j0) * fu;
        const b = src(i0, j0 + 1) * (1 - fu) + src(i0 + 1, j0 + 1) * fu;
        this.h[j * this.nx + i] = a * (1 - fv) + b * fv;
      }
    }
  }

  // přesně podle trojúhelníků PlaneGeometry, aby auta neplavala nad zemí
  height(x, z) {
    const u = ((x + this.W / 2) / this.W) * (this.nx - 1);
    const v = ((z + this.H / 2) / this.H) * (this.nz - 1);
    const i = Math.min(Math.max(Math.floor(u), 0), this.nx - 2);
    const j = Math.min(Math.max(Math.floor(v), 0), this.nz - 2);
    const fu = Math.min(Math.max(u - i, 0), 1), fv = Math.min(Math.max(v - j, 0), 1);
    const n = this.nx;
    const ha = this.h[j * n + i], hd = this.h[j * n + i + 1];
    const hb = this.h[(j + 1) * n + i], hc = this.h[(j + 1) * n + i + 1];
    if (fu + fv <= 1) return ha + (hd - ha) * fu + (hb - ha) * fv;
    return hc + (hb - hc) * (1 - fu) + (hd - hc) * (1 - fv);
  }

  normal(x, z, out = new THREE.Vector3()) {
    const e = 1.5;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  }

  mesh(texture) {
    const g = new THREE.PlaneGeometry(this.W, this.H, this.nx - 1, this.nz - 1);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setY(k, this.h[k]);
    g.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ map: texture });
    // jemná „trávová" textura navíc, aby zem zblízka nebyla rozmazaná
    const detail = detailTexture();
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = position.xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;\nuniform sampler2D detailMap;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float d1 = texture2D(detailMap, vWorldXZ * 0.31).r;
          float d2 = texture2D(detailMap, vWorldXZ * 0.047).g;
          diffuseColor.rgb *= 0.78 + 0.26 * d1 + 0.18 * (d2 - 0.5);`);
    };
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }
}

function detailTexture() {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  // dva kanály: jemná zrnitost (R) a velké skvrny (G), obojí dlaždicové
  const rnd = hashRand(5);
  const blobs = Array.from({ length: 40 }, () => [rnd() * N, rnd() * N, 12 + rnd() * 30, rnd()]);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      let g = 0.5;
      for (const [bx, by, r, v] of blobs) {
        const dx = Math.min(Math.abs(x - bx), N - Math.abs(x - bx)), dy = Math.min(Math.abs(y - by), N - Math.abs(y - by));
        const d = Math.hypot(dx, dy);
        if (d < r) g += (v - 0.5) * (1 - d / r) * 0.8;
      }
      img.data[i] = Math.floor(rnd() * 255);
      img.data[i + 1] = Math.max(0, Math.min(255, g * 255));
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// ------------------------------------------------------------ silnice jako pásy na terénu
function roadTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  const rnd = hashRand(kind.length * 31);
  if (kind === 'track') {
    ctx.fillStyle = '#b39c72'; ctx.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 900; i++) { ctx.fillStyle = rnd() < 0.5 ? 'rgba(90,70,40,0.25)' : 'rgba(230,215,180,0.25)'; ctx.fillRect(rnd() * 64, rnd() * 256, 2, 2); }
    ctx.fillStyle = 'rgba(110,150,70,0.9)'; ctx.fillRect(25, 0, 14, 256);         // tráva uprostřed
    ctx.fillStyle = 'rgba(110,150,70,0.85)'; ctx.fillRect(0, 0, 5, 256); ctx.fillRect(59, 0, 5, 256);
    for (let i = 0; i < 200; i++) { ctx.fillStyle = 'rgba(80,120,50,0.6)'; ctx.fillRect(24 + rnd() * 16, rnd() * 256, 2, 3); }
  } else if (kind === 'foot') {
    ctx.fillStyle = '#c9b892'; ctx.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 600; i++) { ctx.fillStyle = 'rgba(120,100,70,0.25)'; ctx.fillRect(rnd() * 64, rnd() * 256, 2, 2); }
  } else {
    ctx.fillStyle = '#7d7c78'; ctx.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 1500; i++) { ctx.fillStyle = rnd() < 0.5 ? 'rgba(40,40,40,0.18)' : 'rgba(200,200,200,0.14)'; ctx.fillRect(rnd() * 64, rnd() * 256, 1.5, 1.5); }
    ctx.fillStyle = '#5f5e5a'; ctx.fillRect(0, 0, 3, 256); ctx.fillRect(61, 0, 3, 256);
    if (kind === 'main') {
      ctx.fillStyle = '#eeeee6';
      ctx.fillRect(4, 0, 2, 256); ctx.fillRect(58, 0, 2, 256);
      ctx.fillRect(31, 0, 2, 110);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildRoads(map, terrain) {
  const groups = { main: [], paved: [], track: [], foot: [] };
  for (const r of map.roads) {
    const k = ['primary', 'secondary', 'tertiary'].includes(r.t) ? 'main'
      : (['footway', 'path', 'steps', 'cycleway'].includes(r.t) && !r.s) ? 'foot'
        : r.s ? 'paved' : 'track';
    groups[k].push(r);
  }
  const meshes = [];
  const order = { foot: 1, track: 2, paved: 3, main: 4 };
  for (const [kind, list] of Object.entries(groups)) {
    const pos = [], uv = [], idx = [];
    for (const r of list) {
      const pts = r.p; // body už jsou zhuštěné po ~3 m (tools/build_data.py)
      if (pts.length < 2) continue;
      const hw = r.w / 2;
      const base = pos.length / 3;
      let dist = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1];
        const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const nx = -tz, nz = tx;
        if (i > 0) dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        for (const s of [-1, 1]) {
          const x = pts[i][0] + nx * hw * s, z = pts[i][1] + nz * hw * s;
          // silnice s profilem: vodorovně napříč; pěšinky kopírují terén
          const groundY = r.h ? Math.max(r.h[i], terrain.height(x, z) - 0.05) : Math.max(terrain.height(x, z), terrain.height(pts[i][0], pts[i][1]) - 0.3);
          const y = groundY + 0.08 + order[kind] * 0.01;
          pos.push(x, y, z);
          uv.push(s < 0 ? 0 : 1, dist / 8);
        }
        if (i > 0) {
          const o = base + (i - 1) * 2;
          idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); // lícem nahoru
        }
      }
    }
    if (!idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    // normály stejné jako terén pod silnicí -> stejné osvětlení
    const nrm = new Float32Array(pos.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 3) {
      terrain.normal(pos[i], pos[i + 2], v);
      nrm[i] = v.x; nrm[i + 1] = v.y; nrm[i + 2] = v.z;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const mat = new THREE.MeshLambertMaterial({
      map: roadTexture(kind),
      polygonOffset: true, polygonOffsetFactor: -2 - order[kind], polygonOffsetUnits: -4 - order[kind],
    });
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.renderOrder = order[kind];
    meshes.push(m);
  }
  return meshes;
}

// ------------------------------------------------------------ malovaný povrch
const AREA_COLORS = {
  residential: '#a7c97c', meadow: '#9ccc65', grass: '#8fcb5e', garden: '#86bf5a',
  orchard: '#93c562', vineyard: '#a9bb62', scrub: '#6f9a4a', forest: '#4d7838',
  farmyard: '#bcae8e', industrial: '#aaa49a', cemetery: '#86a86c', parking: '#9b9b98',
  pitch: '#5fb04c', playground: '#d3bd8f', water: '#4f94c9',
};
const FIELD_COLORS = ['#dcc66b', '#c9b262', '#a9c75b', '#8b6b47', '#c4ab64', '#9fbd50', '#d1b35f', '#7f9e45', '#9a7a52'];

// kódy povrchu pro fyziku (červený kanál masky)
export const SURF = { GRASS: 0, FIELD: 1, DIRT: 2, PAVED: 3, WATER: 4 };
const SURF_PAINT = ['rgb(0,0,0)', 'rgb(80,0,0)', 'rgb(160,0,0)', 'rgb(240,0,0)', 'rgb(0,240,0)'];

export function paintGround(map, maxTex) {
  const [W, H] = map.size;
  const size = Math.min(4096, maxTex);
  const s = size / Math.max(W, H);
  const cw = Math.round(W * s), ch = Math.round(H * s);
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');

  // maska povrchu (2 m / px)
  const ms = 0.5;
  const mask = document.createElement('canvas');
  mask.width = Math.round(W * ms); mask.height = Math.round(H * ms);
  const mctx = mask.getContext('2d');

  const tx = (x) => (x + W / 2);
  const tz = (z) => (z + H / 2);
  const path = (c, sc, rings) => {
    c.beginPath();
    for (const r of rings) {
      r.forEach(([x, z], i) => (i ? c.lineTo(tx(x) * sc, tz(z) * sc) : c.moveTo(tx(x) * sc, tz(z) * sc)));
      c.closePath();
    }
  };
  const line = (c, sc, p) => {
    c.beginPath();
    p.forEach(([x, z], i) => (i ? c.lineTo(tx(x) * sc, tz(z) * sc) : c.moveTo(tx(x) * sc, tz(z) * sc)));
  };

  ctx.fillStyle = '#93c463';
  ctx.fillRect(0, 0, cw, ch);
  mctx.fillStyle = SURF_PAINT[SURF.GRASS];
  mctx.fillRect(0, 0, mask.width, mask.height);

  const order = ['residential', 'farmland', 'meadow', 'grass', 'garden', 'orchard', 'vineyard', 'scrub',
    'forest', 'farmyard', 'industrial', 'cemetery', 'parking', 'pitch', 'playground', 'water'];
  const areas = [...map.areas].sort((a, b) => order.indexOf(a.c) - order.indexOf(b.c));
  for (const a of areas) {
    const rings = [...a.p, ...(a.holes || [])];
    let color = AREA_COLORS[a.c] || '#93c463';
    if (a.c === 'farmland') color = FIELD_COLORS[a.id % FIELD_COLORS.length];
    ctx.save();
    path(ctx, s, rings);
    ctx.fillStyle = color;
    ctx.fill('evenodd');
    if (a.c === 'farmland' || a.c === 'vineyard' || a.c === 'orchard') {
      // brázdy / řádky
      ctx.clip('evenodd');
      const rnd = hashRand(a.id + 7);
      const ang = rnd() * Math.PI;
      const gap = (a.c === 'farmland' ? 2.2 : 3) * s;
      ctx.strokeStyle = a.c === 'farmland' ? 'rgba(60,40,10,0.13)' : 'rgba(40,60,20,0.18)';
      ctx.lineWidth = gap * 0.45;
      const xs = a.p[0].map((p) => tx(p[0]) * s), zs = a.p[0].map((p) => tz(p[1]) * s);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const R = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 2;
      ctx.translate(cx, cz); ctx.rotate(ang);
      ctx.beginPath();
      for (let y = -R; y < R; y += gap) { ctx.moveTo(-R, y); ctx.lineTo(R, y); }
      ctx.stroke();
    }
    ctx.restore();

    const sc = a.c === 'water' ? SURF.WATER : a.c === 'farmland' ? SURF.FIELD
      : (a.c === 'parking' || a.c === 'farmyard' || a.c === 'industrial') ? SURF.DIRT : SURF.GRASS;
    path(mctx, ms, rings);
    mctx.fillStyle = SURF_PAINT[sc];
    mctx.fill('evenodd');
  }

  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  mctx.lineCap = 'round'; mctx.lineJoin = 'round';
  for (const w of map.water) {
    line(ctx, s, w.p);
    ctx.strokeStyle = '#6f9a52'; ctx.lineWidth = (w.w + 2.5) * s; ctx.stroke();
    ctx.strokeStyle = '#4f94c9'; ctx.lineWidth = w.w * s; ctx.stroke();
    line(mctx, ms, w.p);
    mctx.strokeStyle = SURF_PAINT[SURF.WATER]; mctx.lineWidth = w.w * ms; mctx.stroke();
  }

  // stín pod budovami
  ctx.fillStyle = 'rgba(70,60,45,0.55)';
  for (const b of map.buildings) { path(ctx, s, [b.p]); ctx.fill(); }

  const roads = [...map.roads].sort((a, b) => a.w - b.w);
  // nejdřív krajnice všech, potom vozovky -> hezké křižovatky
  for (const r of roads) {
    line(ctx, s, r.p);
    ctx.strokeStyle = r.s ? '#5f5d58' : '#97815c';
    ctx.lineWidth = (r.w + 1.0) * s; ctx.stroke();
  }
  for (const r of roads) {
    line(ctx, s, r.p);
    ctx.strokeStyle = r.s ? (r.w >= 5 ? '#7c7b77' : '#8a8984') : (r.t === 'track' ? '#b49d74' : '#c9b48c');
    ctx.lineWidth = r.w * s; ctx.stroke();
    if (r.t === 'track' && !r.s) {
      // tráva uprostřed polní cesty
      ctx.strokeStyle = 'rgba(120,160,80,0.75)'; ctx.lineWidth = r.w * 0.28 * s; ctx.stroke();
    }
    line(mctx, ms, r.p);
    mctx.strokeStyle = SURF_PAINT[r.s ? SURF.PAVED : SURF.DIRT];
    mctx.lineWidth = Math.max(r.w, 2.5) * ms; mctx.stroke();
  }
  for (const r of roads) {
    if (!['primary', 'secondary', 'tertiary'].includes(r.t)) continue;
    line(ctx, s, r.p);
    ctx.setLineDash([3 * s, 6 * s]);
    ctx.strokeStyle = 'rgba(245,245,235,0.85)'; ctx.lineWidth = 0.18 * s * 2; ctx.stroke();
    ctx.setLineDash([]);
  }

  // jemný šum, ať to není placka
  const img = ctx.getImageData(0, 0, cw, ch);
  const d = img.data;
  let seed = 12345;
  for (let i = 0; i < d.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = ((seed >> 16) & 31) - 16;
    d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.6;
  }
  ctx.putImageData(img, 0, 0);

  const mdata = mctx.getImageData(0, 0, mask.width, mask.height).data;
  const surf = new Uint8Array(mask.width * mask.height);
  for (let i = 0; i < surf.length; i++) {
    const r = mdata[i * 4], g = mdata[i * 4 + 1];
    surf[i] = g > 120 ? SURF.WATER : r > 200 ? SURF.PAVED : r > 120 ? SURF.DIRT : r > 40 ? SURF.FIELD : SURF.GRASS;
  }
  const surface = (x, z) => {
    const i = Math.floor((x + W / 2) * ms), j = Math.floor((z + H / 2) * ms);
    if (i < 0 || j < 0 || i >= mask.width || j >= mask.height) return SURF.GRASS;
    return surf[j * mask.width + i];
  };
  return { canvas, surface };
}

// ------------------------------------------------------------ budovy
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

function polyArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

function obb(pts) {
  const hull = convexHull(pts);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const ux = Math.cos(ang), uz = Math.sin(ang);
    let mnU = Infinity, mxU = -Infinity, mnV = Infinity, mxV = -Infinity;
    for (const [x, z] of hull) {
      const u = x * ux + z * uz, v = -x * uz + z * ux;
      mnU = Math.min(mnU, u); mxU = Math.max(mxU, u); mnV = Math.min(mnV, v); mxV = Math.max(mxV, v);
    }
    const area = (mxU - mnU) * (mxV - mnV);
    if (!best || area < best.area) {
      const cu = (mnU + mxU) / 2, cv = (mnV + mxV) / 2;
      let L = (mxU - mnU) / 2, Wd = (mxV - mnV) / 2, u = [ux, uz], v = [-uz, ux];
      if (Wd > L) { [L, Wd] = [Wd, L]; [u, v] = [v, [-u[0], -u[1]]]; }
      best = { area, c: [cu * ux - cv * uz, cu * uz + cv * ux], u, v, L, W: Wd };
    }
  }
  return best;
}

class GeoBuilder {
  constructor() { this.pos = []; this.col = []; }
  tri(a, b, c, color, want) {
    // a,b,c = [x,y,z]; want = požadovaný směr normály
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (want && nx * want[0] + ny * want[1] + nz * want[2] < 0) [b, c] = [c, b];
    this.pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) this.col.push(color.r, color.g, color.b);
  }
  quad(a, b, c, d, color, want) { this.tri(a, b, c, color, want); this.tri(a, c, d, color, want); }
  walls(ring, y0, y1, color) {
    const n = ring.length;
    let cx = 0, cz = 0; ring.forEach(([x, z]) => { cx += x; cz += z; }); cx /= n; cz /= n;
    const ccw = polyArea(ring) > 0;
    for (let i = 0; i < n; i++) {
      const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
      const dx = x2 - x1, dz = z2 - z1;
      // vnější normála (pro orientaci proti směru v x,z je to (dz,-dx))
      const want = ccw ? [dz, 0, -dx] : [-dz, 0, dx];
      this.quad([x1, y0, z1], [x2, y0, z2], [x2, y1, z2], [x1, y1, z1], color, want);
    }
  }
  flat(ring, y, color) {
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [a, b, c] of tris) {
      this.tri([ring[a][0], y, ring[a][1]], [ring[b][0], y, ring[b][1]], [ring[c][0], y, ring[c][1]], color, [0, 1, 0]);
    }
  }
  box(cx, cz, y0, y1, hw, hd, rot, color) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const pt = (u, v) => [cx + u * c - v * s, cz + u * s + v * c];
    const ring = [pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd)];
    this.walls(ring, y0, y1, color);
    this.flat(ring, y1, color);
    return ring;
  }
  pyramid(cx, cz, y0, y1, hw, rot, color) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const pt = (u, v) => [cx + u * c - v * s, y0, cz + u * s + v * c];
    const ring = [pt(-hw, -hw), pt(hw, -hw), pt(hw, hw), pt(-hw, hw)];
    const top = [cx, y1, cz];
    for (let i = 0; i < 4; i++) {
      const a = ring[i], b = ring[(i + 1) % 4];
      const mx = (a[0] + b[0]) / 2 - cx, mz = (a[2] + b[2]) / 2 - cz;
      this.tri(a, b, top, color, [mx, hw * 0.5, mz]);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

const C = (hex) => new THREE.Color(hex);
const WALLS = ['#f4f0e6', '#efe4c6', '#eadcc0', '#f3e7d1', '#e7e2d8', '#f1dba9', '#e2e9ec', '#f2d7c4', '#e9efd9'].map(C);
const ROOFS = ['#a9442a', '#b5552f', '#8e3b27', '#6d4b3b', '#5b6067', '#9c402c', '#7a3424', '#b0613a'].map(C);
const AG_WALL = C('#d8d1c2'), AG_ROOF = C('#7c7f82'), FLAT_ROOF = C('#6e6a66');
const CHURCH_WALL = C('#f6f1e2'), CHURCH_ROOF = C('#5c6a70'), TOWER_ROOF = C('#3f6b5c');
const BASE = C('#a39a8a');

const SMALL = new Set(['garage', 'garages', 'shed', 'carport', 'roof', 'hut', 'kiosk', 'container', 'static_caravan', 'toilets']);
const AG = new Set(['barn', 'farm_auxiliary', 'agricultural', 'cowshed', 'stable', 'industrial', 'warehouse', 'greenhouse', 'manufacture', 'service']);
const BIG = new Set(['civic', 'townhall', 'school', 'retail', 'commercial', 'public', 'apartments', 'office', 'kindergarten']);

export function buildBuildings(map) {
  const gb = new GeoBuilder();
  const colliders = [];
  for (let bi = 0; bi < map.buildings.length; bi++) {
    const b = map.buildings[bi];
    const rnd = hashRand(bi + 1);
    const t = b.t;
    const ring = b.p;
    const area = Math.abs(polyArea(ring));
    const box = obb(ring);
    const rectish = area / box.area > 0.82 && box.W > 1.2;

    let wallH, pitch, wallC, roofC, flatRoof = false;
    if (t === 'church') { wallH = 12; pitch = 0.85; wallC = CHURCH_WALL; roofC = CHURCH_ROOF; }
    else if (t === 'chapel') { wallH = 5; pitch = 0.85; wallC = CHURCH_WALL; roofC = CHURCH_ROOF; }
    else if (SMALL.has(t)) { wallH = 2.5; pitch = 0.2; wallC = pick(WALLS, rnd()); roofC = FLAT_ROOF; flatRoof = !rectish || area < 30 || rnd() < 0.5; }
    else if (AG.has(t) || area > 400) { wallH = 5; pitch = 0.45; wallC = AG_WALL; roofC = AG_ROOF; }
    else if (BIG.has(t)) { wallH = 7; pitch = 0.65; wallC = pick(WALLS, rnd()); roofC = pick(ROOFS, rnd()); }
    else { wallH = 3.3; pitch = 0.75 + rnd() * 0.15; wallC = pick(WALLS, rnd()); roofC = pick(ROOFS, rnd()); }
    if (b.l && t !== 'church') wallH = Math.max(wallH, b.l * 3);
    if (b.h && t !== 'church') wallH = Math.max(2.2, b.h - (flatRoof ? 0 : box.W * Math.tan(pitch)));

    const y0 = b.y - 0.6;
    const top = b.y + b.dy + wallH;

    let foot = ring;
    if (rectish && !flatRoof) {
      const { c, u, v, L, W } = box;
      foot = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, d]) => [c[0] + u[0] * L * a + v[0] * W * d, c[1] + u[1] * L * a + v[1] * W * d]);
    }
    // sokl
    gb.walls(foot, y0, b.y + b.dy + 0.35, BASE);
    gb.walls(foot, b.y + b.dy + 0.35, top, wallC);
    colliders.push(foot);

    if (rectish && !flatRoof) {
      const { c, u, v, L, W } = box;
      const o = t === 'church' ? 0.3 : 0.45;
      const tan = Math.tan(pitch);
      const ridge = top + W * tan;
      const eave = top - o * tan;
      const P = (a, d, y) => [c[0] + u[0] * a + v[0] * d, y, c[1] + u[1] * a + v[1] * d];
      const Lo = L + o * 0.6, Wo = W + o;
      gb.quad(P(-Lo, Wo, eave), P(Lo, Wo, eave), P(Lo, 0, ridge), P(-Lo, 0, ridge), roofC, [v[0], 1, v[1]]);
      gb.quad(P(-Lo, -Wo, eave), P(Lo, -Wo, eave), P(Lo, 0, ridge), P(-Lo, 0, ridge), roofC, [-v[0], 1, -v[1]]);
      gb.tri(P(L, -W, top), P(L, W, top), P(L, 0, ridge), wallC, [u[0], 0, u[1]]);
      gb.tri(P(-L, -W, top), P(-L, W, top), P(-L, 0, ridge), wallC, [-u[0], 0, -u[1]]);

      if (t === 'church' || t === 'chapel') {
        // věž na západnějším konci
        const sgn = (c[0] + u[0] * L) < (c[0] - u[0] * L) ? 1 : -1;
        const tw = t === 'church' ? Math.min(3.2, W * 0.85) : Math.min(1.4, W * 0.6);
        const tc = [c[0] + u[0] * (L - tw) * sgn, c[1] + u[1] * (L - tw) * sgn];
        const rot = Math.atan2(u[1], u[0]);
        const th = t === 'church' ? top + 14 : ridge + 2.5;
        gb.box(tc[0], tc[1], y0, th, tw, tw, rot, CHURCH_WALL);
        gb.pyramid(tc[0], tc[1], th, th + (t === 'church' ? 9 : 3), tw * 1.08, rot, TOWER_ROOF);
        // kříž
        const ch = th + (t === 'church' ? 9 : 3);
        gb.box(tc[0], tc[1], ch, ch + 1.8, 0.08, 0.08, rot, C('#d4b04c'));
        gb.box(tc[0], tc[1], ch + 1.1, ch + 1.25, 0.55, 0.08, rot, C('#d4b04c'));
      }
    } else {
      gb.flat(foot, top, roofC === FLAT_ROOF ? FLAT_ROOF : roofC.clone().multiplyScalar(0.8));
    }
  }
  const mesh = new THREE.Mesh(gb.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, colliders };
}

// ------------------------------------------------------------ stromy
function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

function treeGeometries() {
  const trunk = (h, r) => colored(new THREE.CylinderGeometry(r * 0.7, r, h, 6).translate(0, h / 2, 0), '#6b4a2f');
  const deciduous = mergeGeometries([
    trunk(3, 0.25),
    colored(new THREE.IcosahedronGeometry(2.6, 0).scale(1, 1.15, 1).translate(0, 5, 0), '#5c9a3c'),
  ]);
  const orchard = mergeGeometries([
    trunk(1.6, 0.18),
    colored(new THREE.IcosahedronGeometry(1.8, 0).scale(1.1, 0.9, 1.1).translate(0, 2.8, 0), '#6fae46'),
  ]);
  const bush = colored(new THREE.IcosahedronGeometry(1.4, 0).scale(1.2, 0.8, 1.2).translate(0, 0.9, 0), '#5a8a3a');
  const conifer = mergeGeometries([
    trunk(2, 0.25),
    colored(new THREE.ConeGeometry(2.4, 5, 7).translate(0, 4, 0), '#3f6e3a'),
    colored(new THREE.ConeGeometry(1.8, 4, 7).translate(0, 6.5, 0), '#3f6e3a'),
  ]);
  return [deciduous, deciduous, orchard, bush, conifer];
}

export function buildTrees(map, terrain) {
  const geos = treeGeometries();
  const groups = [[], [], [], [], []];
  for (const t of map.trees) groups[t[2]].push(t);
  const meshes = [];
  const colliders = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const rnd = hashRand(99);
  groups.forEach((list, kind) => {
    if (!list.length) return;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const im = new THREE.InstancedMesh(geos[kind], mat, list.length);
    list.forEach(([x, z, , sc], i) => {
      p.set(x, terrain.height(x, z) - 0.15, z);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      s.setScalar(sc);
      m4.compose(p, q, s);
      im.setMatrixAt(i, m4);
      col.setHSL(0, 0, 1).offsetHSL((rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.18);
      im.setColorAt(i, col);
      if (kind !== 3) colliders.push([x, z, 0.35 * sc + 0.15]);
    });
    im.castShadow = true;
    im.receiveShadow = false;
    meshes.push(im);
  });
  return { meshes, colliders };
}

// ------------------------------------------------------------ popisky
const POI_ICON = { church: '⛪', museum: '🏛️', convenience: '🛒', townhall: '🏠', post_office: '✉️', school: '🏫', pub: '🍺', cafe: '🍰', playground: '🛝', pitch: '⚽', fire_station: '🚒' };
const POI_SKIP = new Set(['parcel_locker', 'static_caravan']);

export function buildLabels(map, terrain) {
  const group = new THREE.Group();
  const list = [];
  for (const p of map.pois) {
    if (POI_SKIP.has(p.k) || p.n === map.name) continue;
    const text = `${POI_ICON[p.k] || '📍'} ${p.n}`;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = 'bold 44px system-ui, sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 40;
    c.width = w; c.height = 72;
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath(); ctx.roundRect(2, 2, w - 4, 68, 30); ctx.fill();
    ctx.fillStyle = '#2b3a2a';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 20, 38);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const sp = new THREE.Sprite(mat);
    const hgt = p.k === 'church' ? 34 : 13;
    sp.position.set(p.x, terrain.height(p.x, p.z) + hgt, p.z);
    sp.scale.set(w / 72 * 3, 3, 1);
    sp.renderOrder = 10;
    group.add(sp);
    list.push({ ...p, sprite: sp, text });
  }
  return { group, list };
}

// ------------------------------------------------------------ kolize
export class Colliders {
  constructor(polys, circles, cell = 16) {
    this.cell = cell;
    this.grid = new Map();
    for (const p of polys) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      this.add({ poly: p }, x0, z0, x1, z1);
    }
    for (const [x, z, r] of circles) this.add({ x, z, r }, x - r, z - r, x + r, z + r);
  }
  add(item, x0, z0, x1, z1) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const k = i * 100003 + j;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(item);
      }
    }
  }
  // posune kruh (pos {x,z}, poloměr R) ven z překážek; vrací normálu nárazu nebo null
  resolve(pos, R) {
    const c = this.cell;
    let hit = null;
    const seen = new Set();
    for (let i = Math.floor((pos.x - R) / c); i <= Math.floor((pos.x + R) / c); i++) {
      for (let j = Math.floor((pos.z - R) / c); j <= Math.floor((pos.z + R) / c); j++) {
        const items = this.grid.get(i * 100003 + j);
        if (!items) continue;
        for (const it of items) {
          if (seen.has(it)) continue;
          seen.add(it);
          const n = it.poly ? this.poly(it.poly, pos, R) : this.circle(it, pos, R);
          if (n) hit = n;
        }
      }
    }
    return hit;
  }
  circle(it, pos, R) {
    const dx = pos.x - it.x, dz = pos.z - it.z;
    const d = Math.hypot(dx, dz), m = R + it.r;
    if (d >= m || d < 1e-6) return null;
    const nx = dx / d, nz = dz / d;
    pos.x = it.x + nx * m; pos.z = it.z + nz * m;
    return { x: nx, z: nz };
  }
  poly(p, pos, R) {
    let best = Infinity, bx = 0, bz = 0, inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [x1, z1] = p[j], [x2, z2] = p[i];
      if ((z1 > pos.z) !== (z2 > pos.z) && pos.x < ((x2 - x1) * (pos.z - z1)) / (z2 - z1) + x1) inside = !inside;
      const ex = x2 - x1, ez = z2 - z1;
      const L2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((pos.x - x1) * ex + (pos.z - z1) * ez) / L2));
      const cx = x1 + ex * t, cz = z1 + ez * t;
      const d = (pos.x - cx) ** 2 + (pos.z - cz) ** 2;
      if (d < best) { best = d; bx = cx; bz = cz; }
    }
    const d = Math.sqrt(best);
    if (!inside && d >= R) return null;
    let nx = (pos.x - bx) / (d || 1), nz = (pos.z - bz) / (d || 1);
    if (inside) { nx = -nx; nz = -nz; }
    pos.x = bx + nx * R; pos.z = bz + nz * R;
    return { x: nx, z: nz };
  }
}

// ------------------------------------------------------------ silnice: nejbližší bod
export function nearestRoadPoint(map, x, z, types = null) {
  let best = null;
  for (const r of map.roads) {
    if (types && !types.includes(r.t)) continue;
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x1, z1] = r.p[i], [x2, z2] = r.p[i + 1];
      const ex = x2 - x1, ez = z2 - z1, L2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - x1) * ex + (z - z1) * ez) / L2));
      const cx = x1 + ex * t, cz = z1 + ez * t;
      const d = (x - cx) ** 2 + (z - cz) ** 2;
      if (!best || d < best.d) best = { d, x: cx, z: cz, heading: Math.atan2(ex, ez) };
    }
  }
  return best;
}
