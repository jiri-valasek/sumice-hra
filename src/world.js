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
    if (a.c === 'water' && a.pond) color = '#3f5f52';
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

  for (const f of map.pitches || []) paintPitch(ctx, s, f, W, H);

  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  mctx.lineCap = 'round'; mctx.lineJoin = 'round';
  for (const w of map.water) {
    if (w.u) continue; // propustek pod cestou
    line(ctx, s, w.p);
    ctx.strokeStyle = '#6f9a52'; ctx.lineWidth = (w.w + 2.5) * s; ctx.stroke();
    ctx.strokeStyle = '#4f94c9'; ctx.lineWidth = w.w * s; ctx.stroke();
    line(mctx, ms, w.p);
    mctx.strokeStyle = SURF_PAINT[SURF.WATER]; mctx.lineWidth = Math.max(w.w, 3.5) * ms; mctx.stroke();
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

// ------------------------------------------------------------ hřiště (malování na zem)
function paintPitch(ctx, s, f, W, H) {
  const ring = f.p;
  const box = obb(ring);
  const { c, u, v, L, W: Wd } = box;
  // lokální souřadnice hřiště: a podél delší osy, d napříč
  const P = (a, d) => [(c[0] + u[0] * a + v[0] * d + W / 2) * s, (c[1] + u[1] * a + v[1] * d + H / 2) * s];
  const poly = () => { ctx.beginPath(); ring.forEach(([x, z], i) => (i ? ctx.lineTo((x + W / 2) * s, (z + H / 2) * s) : ctx.moveTo((x + W / 2) * s, (z + H / 2) * s))); ctx.closePath(); };
  const rect = (a0, d0, a1, d1) => { ctx.beginPath(); const q = [P(a0, d0), P(a1, d0), P(a1, d1), P(a0, d1)]; q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  const line = (a0, d0, a1, d1) => { ctx.beginPath(); ctx.moveTo(...P(a0, d0)); ctx.lineTo(...P(a1, d1)); ctx.stroke(); };
  const circle = (a, d, r) => { ctx.beginPath(); const [x, y] = P(a, d); ctx.arc(x, y, r * s, 0, Math.PI * 2); ctx.stroke(); };
  ctx.save();
  poly(); ctx.clip();
  ctx.strokeStyle = '#f7f7f2'; ctx.lineWidth = Math.max(1, 0.14 * s * 1.6);
  if (f.c === 'pitch' && f.sp === 'soccer') {
    for (let a = -L, k = 0; a < L; a += 6, k++) { rect(a, -Wd, a + 6, Wd); ctx.fillStyle = k % 2 ? '#5fae4d' : '#6cbb57'; ctx.fill(); }
    const l = L - 1.5, w = Wd - 1.5;
    rect(-l, -w, l, w); ctx.stroke();
    line(0, -w, 0, w);
    circle(0, 0, Math.min(9.15, w * 0.4));
    const pw = Math.min(20.15, w * 0.8), gw = Math.min(9.15, w * 0.4);
    for (const e of [-1, 1]) {
      rect(e * l, -pw, e * (l - Math.min(16.5, l * 0.3)), pw); ctx.stroke();
      rect(e * l, -gw, e * (l - Math.min(5.5, l * 0.1)), gw); ctx.stroke();
    }
  } else if (f.c === 'pitch' && f.sp === 'tennis') {
    const clay = f.su === 'clay' || !f.su;
    poly(); ctx.fillStyle = clay ? '#c8663e' : '#3f8a55'; ctx.fill();
    const cl = Math.min(11.885, L - 2), cw = Math.min(5.485, Wd - 1);
    if (!clay) { rect(-cl, -cw, cl, cw); ctx.fillStyle = '#b9483a'; ctx.fill(); }
    rect(-cl, -cw, cl, cw); ctx.stroke();
    const sw = cw * 4.115 / 5.485, sl = cl * 6.4 / 11.885;
    line(-cl, -sw, cl, -sw); line(-cl, sw, cl, sw);
    line(-sl, -sw, -sl, sw); line(sl, -sw, sl, sw);
    line(-sl, 0, sl, 0);
  } else if (f.c === 'playground') {
    poly(); ctx.fillStyle = '#4fae5a'; ctx.fill();
    const rnd = hashRand(Math.round(Math.abs(c[0] * 7 + c[1])));
    ctx.fillStyle = '#d14b3c';
    for (let i = 0; i < 7; i++) {
      const [x, y] = P((rnd() * 2 - 1) * L * 0.8, (rnd() * 2 - 1) * Wd * 0.8);
      ctx.beginPath(); ctx.ellipse(x, y, (2 + rnd() * 3) * s, (1.5 + rnd() * 2) * s, rnd() * 3, 0, Math.PI * 2); ctx.fill();
    }
  } else if (f.c === 'pumptrack') {
    poly(); ctx.fillStyle = '#9c8a6c'; ctx.fill();
    ctx.strokeStyle = '#5f5e5a'; ctx.lineWidth = 2.4 * s; ctx.lineJoin = 'round';
    poly(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...P(-L * 0.7, -Wd * 0.4)); ctx.bezierCurveTo(...P(-L * 0.2, Wd * 0.9), ...P(L * 0.2, -Wd * 0.9), ...P(L * 0.7, Wd * 0.4)); ctx.stroke();
  } else {
    // obecné hřiště (hasičské…)
    for (let a = -L, k = 0; a < L; a += 6, k++) { rect(a, -Wd, a + 6, Wd); ctx.fillStyle = k % 2 ? '#62b04f' : '#6dbb59'; ctx.fill(); }
    rect(-(L - 1), -(Wd - 1), L - 1, Wd - 1); ctx.stroke();
  }
  ctx.restore();
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
// moderní vesnice: světlé omítky, převážně červené tašky (podle leteckých záběrů obce)
const WALLS = ['#f6f3ec', '#f1e8d2', '#f3e2b8', '#ece8de', '#f2d8c4', '#e7ebe6', '#f5ebca', '#eadcc8', '#f8f1de', '#e9d3b0'].map(C);
const ROOFS_RED = ['#b5452c', '#c0532f', '#a63d28', '#bf5a35', '#ad4a2d'].map(C);
const ROOFS_OTHER = ['#6b3f2f', '#7a4a36', '#4b4f55', '#5a5e64'].map(C);
const AG_WALL = C('#d8d1c2'), AG_ROOF = C('#7c7f82'), FLAT_ROOF = C('#6e6a66');
const BASE = C('#a39a8a'), GLASS = C('#3d4c5c'), FRAME = C('#f4f4ef'), DOOR = C('#6b4a33'), WHITE = C('#f7f4ec');
const GOLD = C('#d4b04c');

// dominanty podle virtuální prohlídky obce
const STYLE = {
  church: { wall: '#ecc56a', roof: '#b5452c' },
  ou: { wall: '#f2a183', roof: '#8d8781', flat: true, accent: '#e8703e', floorH: 3.1 },
  ou_wing: { wall: '#ecdcbc', roof: '#b5452c', floorH: 3.0 },
  zs: { wall: '#f5cf4c', roof: '#c4432b', accent: '#ef8a3c', tower: '#e9e6df', floorH: 3.4 },
  ms: { wall: '#f6d94a', roof: '#8e9196', hip: true, floorH: 3.0 },
  mlyn: { wall: '#cdc8bc', roof: '#4f5358', hip: true, floorH: 3.1 },
  chalupa: { wall: '#f8f6f0', roof: '#5a4a3c', gable: true, pitch: 0.9, floorH: 2.7 },
};

const SMALL = new Set(['garage', 'garages', 'shed', 'carport', 'roof', 'hut', 'kiosk', 'container', 'static_caravan', 'toilets']);
const AG = new Set(['barn', 'farm_auxiliary', 'agricultural', 'cowshed', 'stable', 'industrial', 'warehouse', 'greenhouse', 'manufacture', 'service']);
const BIG = new Set(['civic', 'townhall', 'school', 'retail', 'commercial', 'public', 'apartments', 'office', 'kindergarten']);

function rectOf(box, grow = 0) {
  const { c, u, v, L, W } = box;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, d]) => [c[0] + u[0] * (L + grow) * a + v[0] * (W + grow) * d, c[1] + u[1] * (L + grow) * a + v[1] * (W + grow) * d]);
}

// okna (a dveře) po obvodu
function addWindows(gb, foot, baseY, floors, floorH, o) {
  const ccw = polyArea(foot) > 0;
  let longest = -1, longL = 0;
  for (let i = 0; i < foot.length; i++) {
    const [x1, z1] = foot[i], [x2, z2] = foot[(i + 1) % foot.length];
    const L = Math.hypot(x2 - x1, z2 - z1);
    if (L > longL) { longL = L; longest = i; }
  }
  for (let i = 0; i < foot.length; i++) {
    const [x1, z1] = foot[i], [x2, z2] = foot[(i + 1) % foot.length];
    const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
    const n = Math.floor((L - 1.0) / o.spacing);
    if (n < 1) continue;
    const ex = dx / L, ez = dz / L;
    const nx = (ccw ? dz : -dz) / L, nz = (ccw ? -dx : dx) / L;
    const want = [nx, 0, nz];
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const cx = x1 + dx * t, cz = z1 + dz * t;
      for (let f = 0; f < floors; f++) {
        const isDoor = o.door && f === 0 && i === longest && k === Math.floor(n / 2);
        const w = isDoor ? 0.6 : o.w / 2;
        const y0 = baseY + f * floorH + (isDoor ? 0.05 : o.sill);
        const y1 = isDoor ? y0 + 2.15 : y0 + o.h;
        const quad = (ww, ya, yb, off, col) => {
          const ax = cx - ex * ww + nx * off, az = cz - ez * ww + nz * off;
          const bx = cx + ex * ww + nx * off, bz = cz + ez * ww + nz * off;
          gb.quad([ax, ya, az], [bx, ya, bz], [bx, yb, bz], [ax, yb, az], col, want);
        };
        quad(w + 0.09, y0 - 0.09, y1 + 0.09, 0.03, o.frame || FRAME);
        quad(w, y0, y1, 0.05, isDoor ? DOOR : GLASS);
      }
    }
  }
}

function gableRoof(gb, box, top, pitch, o, roofC, wallC) {
  const { c, u, v, L, W } = box;
  const tan = Math.tan(pitch), ridge = top + W * tan, eave = top - o * tan;
  const P = (a, d, y) => [c[0] + u[0] * a + v[0] * d, y, c[1] + u[1] * a + v[1] * d];
  const Lo = L + o * 0.6, Wo = W + o;
  gb.quad(P(-Lo, Wo, eave), P(Lo, Wo, eave), P(Lo, 0, ridge), P(-Lo, 0, ridge), roofC, [v[0], 1, v[1]]);
  gb.quad(P(-Lo, -Wo, eave), P(Lo, -Wo, eave), P(Lo, 0, ridge), P(-Lo, 0, ridge), roofC, [-v[0], 1, -v[1]]);
  gb.tri(P(L, -W, top), P(L, W, top), P(L, 0, ridge), wallC, [u[0], 0, u[1]]);
  gb.tri(P(-L, -W, top), P(-L, W, top), P(-L, 0, ridge), wallC, [-u[0], 0, -u[1]]);
  return ridge;
}

function hipRoof(gb, box, top, pitch, o, roofC) {
  const { c, u, v, L, W } = box;
  const tan = Math.tan(pitch), ridge = top + W * tan, eave = top - o * tan;
  const P = (a, d, y) => [c[0] + u[0] * a + v[0] * d, y, c[1] + u[1] * a + v[1] * d];
  const Lo = L + o, Wo = W + o, r = Math.max(0, L - W);
  gb.quad(P(-Lo, Wo, eave), P(Lo, Wo, eave), P(r, 0, ridge), P(-r, 0, ridge), roofC, [v[0], 1, v[1]]);
  gb.quad(P(-Lo, -Wo, eave), P(Lo, -Wo, eave), P(r, 0, ridge), P(-r, 0, ridge), roofC, [-v[0], 1, -v[1]]);
  gb.tri(P(Lo, -Wo, eave), P(Lo, Wo, eave), P(r, 0, ridge), roofC, [u[0], 1, u[1]]);
  gb.tri(P(-Lo, -Wo, eave), P(-Lo, Wo, eave), P(-r, 0, ridge), roofC, [-u[0], 1, -u[1]]);
  return ridge;
}

// na kterém konci lodi je věž: naproti apsidě (zaoblený konec má víc bodů obrysu)
function towerEnd(ring, box) {
  const { c, u, L } = box;
  let plus = 0, minus = 0;
  for (const [x, z] of ring) {
    const a = (x - c[0]) * u[0] + (z - c[1]) * u[1];
    if (a > L * 0.45) plus++; else if (a < -L * 0.45) minus++;
  }
  if (plus !== minus) return plus > minus ? -1 : 1;
  return (c[0] + u[0] * L) < (c[0] - u[0] * L) ? 1 : -1; // jinak západ
}

function buildChurch(gb, b, box, y0, ground, chapel) {
  const st = STYLE.church;
  const wallC = C(st.wall), roofC = C(st.roof);
  const { c, u, W } = box;
  const wallH = chapel ? 5 : 10;
  const top = ground + wallH;
  const foot = rectOf(box);
  gb.walls(foot, y0, ground + 0.5, BASE);
  gb.walls(foot, ground + 0.5, top, wallC);
  gb.walls(rectOf(box, 0.08), top - 0.55, top, WHITE); // bílá římsa
  if (!chapel) addWindows(gb, foot, ground, 1, 0, { spacing: 4.2, w: 1.2, h: 3.4, sill: 3.0, frame: WHITE, door: false });
  gableRoof(gb, box, top, 0.8, 0.3, roofC, wallC);
  const sgn = towerEnd(b.p, box);
  const tw = chapel ? Math.min(1.4, W * 0.6) : Math.min(3.0, W * 0.8);
  const L = box.L;
  const tc = [c[0] + u[0] * (L + (chapel ? -tw : tw * 0.35)) * sgn, c[1] + u[1] * (L + (chapel ? -tw : tw * 0.35)) * sgn];
  const rot = Math.atan2(u[1], u[0]);
  const th = chapel ? top + W * 0.8 + 2.5 : top + 13;
  gb.box(tc[0], tc[1], y0, th, tw, tw, rot, wallC);
  gb.box(tc[0], tc[1], th - 0.5, th, tw + 0.1, tw + 0.1, rot, WHITE);
  if (!chapel) {
    gb.box(tc[0], tc[1], top - 0.5, top, tw + 0.1, tw + 0.1, rot, WHITE);
    // hodiny na všech stranách věže
    for (const [a, d] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const ox = (a * cs - d * sn) * (tw + 0.04), oz = (a * sn + d * cs) * (tw + 0.04);
      gb.box(tc[0] + ox, tc[1] + oz, th - 3.4, th - 1.6, a ? 0.03 : 0.9, d ? 0.03 : 0.9, rot, WHITE);
      gb.box(tc[0] + ox * 1.01, tc[1] + oz * 1.01, th - 2.55, th - 2.45, a ? 0.03 : 0.6, d ? 0.03 : 0.6, rot, C('#333'));
    }
  }
  // tmavá báň se špičkou a zlatý kříž
  const TOWER_ROOF = C('#3a4045');
  const r1 = th + (chapel ? 2.5 : 4);
  gb.pyramid(tc[0], tc[1], th, r1, tw * 1.05, rot, TOWER_ROOF);
  if (!chapel) {
    gb.box(tc[0], tc[1], r1 - 0.6, r1 + 1.2, 0.6, 0.6, rot, TOWER_ROOF);
    gb.pyramid(tc[0], tc[1], r1 + 1.2, r1 + 4.5, 0.6, rot, TOWER_ROOF);
  }
  const ch = chapel ? r1 : r1 + 4.5;
  gb.box(tc[0], tc[1], ch, ch + 1.8, 0.08, 0.08, rot, GOLD);
  gb.box(tc[0], tc[1], ch + 1.1, ch + 1.25, 0.5, 0.08, rot, GOLD);
  return foot;
}

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
    const y0 = b.y - 0.6;
    const ground = b.y + b.dy;

    if (t === 'church' || t === 'chapel' || b.st === 'church') {
      colliders.push(buildChurch(gb, b, box, y0, ground, t === 'chapel'));
      continue;
    }

    const st = b.st ? STYLE[b.st] : null;
    const rectish = area / box.area > 0.82 && box.W > 1.2;
    const small = SMALL.has(t) || area < 22;
    const ag = !st && (AG.has(t) || area > 400);
    let floors = b.l || (BIG.has(t) ? 2 : 1);
    if (!b.l && !small && !ag && area > 90 && rnd() < 0.35) floors = 2;
    const floorH = st?.floorH || (ag ? 4.5 : small ? 2.5 : 2.9);
    let wallH = small ? 2.5 : floors * floorH + 0.4;
    if (b.h && !st) wallH = Math.max(2.2, b.h * 0.75);

    let wallC, roofC, roof;
    if (st) {
      wallC = C(st.wall); roofC = C(st.roof);
      roof = st.flat || !rectish ? 'flat' : st.gable ? 'gable' : st.hip ? 'hip' : 'gable';
    } else if (small) {
      wallC = pick(WALLS, rnd()); roofC = FLAT_ROOF;
      roof = rectish && rnd() < 0.5 ? 'gable' : 'flat';
    } else if (ag) {
      wallC = AG_WALL; roofC = AG_ROOF; roof = rectish ? 'gable' : 'flat';
    } else {
      wallC = pick(WALLS, rnd());
      roofC = rnd() < 0.75 ? pick(ROOFS_RED, rnd()) : pick(ROOFS_OTHER, rnd());
      const squarish = box.L / Math.max(box.W, 0.1) < 1.5;
      roof = !rectish ? 'flat' : (squarish && rnd() < 0.7) || (!squarish && rnd() < 0.25) ? 'hip' : 'gable';
    }
    const pitch = st?.pitch || (small ? 0.25 : ag ? 0.35 : 0.6 + rnd() * 0.15);
    const top = ground + wallH;
    const foot = roof === 'flat' ? ring : rectOf(box);

    gb.walls(foot, y0, ground + 0.35, BASE);
    gb.walls(foot, ground + 0.35, top, wallC);
    colliders.push(foot);

    if (!small) {
      addWindows(gb, foot, ground + 0.35, ag ? 1 : floors, floorH, ag
        ? { spacing: 7, w: 1.6, h: 0.9, sill: 2.4, door: false }
        : { spacing: 3.1, w: 1.15, h: 1.3, sill: 0.85, door: true });
    }

    if (st?.accent) {
      // výrazný rizalit / schodišťová část (obecní úřad, škola)
      const { c, u, L, W } = box;
      let v = box.v;
      // rizalit na stranu k nejbližší silnici (tam je vchod)
      const r = nearestRoadPoint(map, c[0], c[1], ['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'living_street']);
      if (r && (r.x - c[0]) * v[0] + (r.z - c[1]) * v[1] < 0) v = [-v[0], -v[1]];
      const rot = Math.atan2(u[1], u[0]);
      const cx = c[0] + v[0] * (W + 0.6), cz = c[1] + v[1] * (W + 0.6);
      gb.box(cx, cz, y0, top + (roof === 'flat' ? 2.2 : 0), Math.min(3.4, L * 0.3), 0.9, rot, C(st.accent));
      addWindows(gb, rectOf({ c: [cx, cz], u, v, L: Math.min(3.4, L * 0.3), W: 0.9 }), ground + 0.35, floors, floorH, { spacing: 2.4, w: 1.4, h: 1.8, sill: 0.6, door: false });
    }
    if (st?.tower) {
      const { c, u, L } = box;
      const rot = Math.atan2(u[1], u[0]);
      gb.box(c[0] + u[0] * (L + 1.6), c[1] + u[1] * (L + 1.6), y0, top + 3, 1.6, 2.2, rot, C(st.tower));
    }

    if (roof === 'flat') {
      gb.walls(foot, top, top + 0.3, wallC.clone().multiplyScalar(0.92)); // atika
      gb.flat(foot, top + 0.05, roofC === FLAT_ROOF || st?.flat ? roofC : roofC.clone().multiplyScalar(0.8));
    } else if (roof === 'hip') {
      hipRoof(gb, box, top, pitch, 0.5, roofC);
    } else {
      gableRoof(gb, box, top, pitch, small ? 0.2 : 0.45, roofC, wallC);
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
  const handles = [];
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
    list.forEach(([x, z, , sc, cut], i) => {
      p.set(x, terrain.height(x, z) - 0.15, z);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      s.setScalar(sc);
      m4.compose(p, q, s);
      im.setMatrixAt(i, m4);
      col.setHSL(0, 0, 1).offsetHSL((rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.18);
      im.setColorAt(i, col);
      const h = { x, z, kind, scale: sc, mesh: im, index: i, cut: !!cut, standing: true };
      handles.push(h);
      if (kind !== 3) colliders.push([x, z, 0.35 * sc + 0.15, h]);
    });
    im.castShadow = true;
    im.receiveShadow = false;
    meshes.push(im);
  });
  return { meshes, colliders, handles };
}

// ------------------------------------------------------------ popisky
const POI_ICON = { saw: '🪚', pile: '🪵', meadow: '🌾', mower: '🚜', pumptrack: '🚲', halt: '🚉', kindergarten: '🧸', mill: '⚙️', church: '⛪', museum: '🏛️', convenience: '🛒', townhall: '🏠', post_office: '✉️', school: '🏫', pub: '🍺', cafe: '🍰', playground: '🛝', pitch: '⚽', fire_station: '🚒' };
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
    this.dynamic = []; // pohyblivé překážky (vlak): pole polygonů, mění se každý snímek
    for (const p of polys) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      this.add({ poly: p }, x0, z0, x1, z1);
    }
    for (const [x, z, r, h] of circles) {
      const it = { x, z, r };
      if (h) h.col = it; // strom ke kácení: po pokácení srážku vypneme
      this.add(it, x - r, z - r, x + r, z + r);
    }
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
  resolve(pos, R, ignore = null) {
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
    for (const d of this.dynamic) {
      if (d === ignore) continue;
      if (Math.abs(d.cx - pos.x) > d.r + R || Math.abs(d.cz - pos.z) > d.r + R) continue;
      const n = d.circle ? this.circle(d, pos, R) : this.poly(d.poly, pos, R);
      if (n) { hit = n; hit.dynamic = d; }
    }
    return hit;
  }
  // je bod uvnitř koruny stromu nebo budovy? (pro kameru)
  blocked(x, z, crown = 5) {
    const c = this.cell;
    const items = this.grid.get(Math.floor(x / c) * 100003 + Math.floor(z / c));
    if (!items) return false;
    for (const it of items) {
      if (it.poly) {
        let inside = false;
        const p = it.poly;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          const [x1, z1] = p[j], [x2, z2] = p[i];
          if ((z1 > z) !== (z2 > z) && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) inside = !inside;
        }
        if (inside) return true;
      } else if (it.r > 0 && (x - it.x) ** 2 + (z - it.z) ** 2 < (it.r * crown) ** 2) return true;
    }
    return false;
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

// ------------------------------------------------------------ mosty
export class Bridges {
  constructor(map) {
    this.segs = [];
    const add = (r, w) => {
      for (let i = 0; i < r.p.length - 1; i++) {
        const [x1, z1] = r.p[i], [x2, z2] = r.p[i + 1];
        this.segs.push({ x1, z1, x2, z2, h1: r.h[i], h2: r.h[i + 1], hw: w / 2 + 0.3,
          minx: Math.min(x1, x2) - w, maxx: Math.max(x1, x2) + w, minz: Math.min(z1, z2) - w, maxz: Math.max(z1, z2) + w });
      }
    };
    for (const r of map.roads) if (r.b && r.h) add(r, r.w);
    for (const r of map.rails || []) if (r.b) add(r, 3.2);
  }
  // výška mostovky pod bodem (nebo -Infinity)
  deck(x, z) {
    let best = -Infinity;
    for (const s of this.segs) {
      if (x < s.minx || x > s.maxx || z < s.minz || z > s.maxz) continue;
      const ex = s.x2 - s.x1, ez = s.z2 - s.z1, L2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - s.x1) * ex + (z - s.z1) * ez) / L2));
      const d = Math.hypot(x - (s.x1 + ex * t), z - (s.z1 + ez * t));
      if (d <= s.hw) best = Math.max(best, s.h1 + (s.h2 - s.h1) * t + 0.12);
    }
    return best;
  }
}

export function buildBridgeMeshes(map) {
  const gb = new GeoBuilder();
  const slab = C('#a7a39a'), rail = C('#3d5a7a'), post = C('#2f3b48');
  const make = (r, w, railings) => {
    const p = r.p, h = r.h;
    for (let i = 0; i < p.length - 1; i++) {
      const [x1, z1] = p[i], [x2, z2] = p[i + 1];
      let dx = x2 - x1, dz = z2 - z1;
      const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const nx = -dz, nz = dx, hw = w / 2 + 0.25;
      const y1 = h[i] + 0.05, y2 = h[i + 1] + 0.05;
      const A = [x1 + nx * hw, z1 + nz * hw], B = [x2 + nx * hw, z2 + nz * hw];
      const Cc = [x2 - nx * hw, z2 - nz * hw], D = [x1 - nx * hw, z1 - nz * hw];
      // boky mostovky
      gb.quad([A[0], y1, A[1]], [B[0], y2, B[1]], [B[0], y2 - 0.7, B[1]], [A[0], y1 - 0.7, A[1]], slab, [nx, 0, nz]);
      gb.quad([D[0], y1, D[1]], [Cc[0], y2, Cc[1]], [Cc[0], y2 - 0.7, Cc[1]], [D[0], y1 - 0.7, D[1]], slab, [-nx, 0, -nz]);
      gb.quad([A[0], y1 - 0.7, A[1]], [B[0], y2 - 0.7, B[1]], [Cc[0], y2 - 0.7, Cc[1]], [D[0], y1 - 0.7, D[1]], slab, [0, -1, 0]);
      if (!railings) continue;
      for (const s of [1, -1]) {
        const ox = nx * hw * s, oz = nz * hw * s;
        const P1 = [x1 + ox, y1 + 1.0, z1 + oz], P2 = [x2 + ox, y2 + 1.0, z2 + oz];
        gb.quad(P1, P2, [P2[0], P2[1] + 0.12, P2[2]], [P1[0], P1[1] + 0.12, P1[2]], rail, [nx * s, 0, nz * s]);
        gb.quad(P1, P2, [P2[0], P2[1] + 0.12, P2[2]], [P1[0], P1[1] + 0.12, P1[2]], rail, [-nx * s, 0, -nz * s]);
        gb.box(x1 + ox, z1 + oz, y1, y1 + 1.12, 0.06, 0.06, Math.atan2(dz, dx), post);
      }
    }
  };
  for (const r of map.roads) if (r.b && r.h) make(r, r.w, true);
  for (const r of map.rails || []) if (r.b) make(r, 3.2, false);
  const m = new THREE.Mesh(gb.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------ voda
export function buildWater(map) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, '#d8f0ff'); g.addColorStop(0.12, '#4aa3df'); g.addColorStop(0.5, '#2f86c8');
  g.addColorStop(0.88, '#4aa3df'); g.addColorStop(1, '#d8f0ff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 128);
  const rnd = hashRand(3);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const x = 8 + rnd() * 48, y = rnd() * 128;
    ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.quadraticCurveTo(x, y - 3, x + 5, y); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;

  const pos = [], uv = [], idx = [];
  for (const wl of map.water) {
    if (wl.u || !wl.h) continue;
    const p = wl.p, hw = wl.w / 2 + 0.6;
    const base = pos.length / 3;
    let dist = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      if (i > 0) dist += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      for (const s of [-1, 1]) {
        pos.push(p[i][0] - tz * hw * s, wl.h[i], p[i][1] + tx * hw * s);
        uv.push(s < 0 ? 0 : 1, dist / 6);
      }
      if (i > 0) { const o = base + (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 6;
  mesh.userData.flow = tex;
  return mesh;
}

// ------------------------------------------------------------ koleje
export function buildRails(map) {
  const rails = map.rails || [];
  if (!rails.length) return [];
  // štěrkové lože s pražci (textura)
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8d8478'; ctx.fillRect(0, 0, 64, 64);
  const rnd = hashRand(11);
  for (let i = 0; i < 700; i++) { ctx.fillStyle = rnd() < 0.5 ? 'rgba(60,55,50,0.35)' : 'rgba(200,195,185,0.3)'; ctx.fillRect(rnd() * 64, rnd() * 64, 2, 2); }
  ctx.fillStyle = '#5a4433'; ctx.fillRect(8, 20, 48, 22); // pražec
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(8, 40, 48, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;

  const bed = { pos: [], uv: [], idx: [] };
  const steel = new GeoBuilder();
  const steelC = C('#b9bcc0'), steelS = C('#6b5a4c');
  for (const r of rails) {
    const p = r.p, h = r.h;
    const base = bed.pos.length / 3;
    let dist = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      if (i > 0) dist += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      for (const s of [-1, 1]) {
        bed.pos.push(p[i][0] + nx * 1.6 * s, h[i] + 0.14, p[i][1] + nz * 1.6 * s);
        bed.uv.push(s < 0 ? 0 : 1, dist / 0.65);
      }
      if (i > 0) { const o = base + (i - 1) * 2; bed.idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      if (i > 0) {
        const [x1, z1] = p[i - 1], [x2, z2] = p[i];
        const y1 = h[i - 1] + 0.3, y2 = h[i] + 0.3;
        for (const off of [-0.72, 0.72]) {
          const ax = x1 + nx * off, az = z1 + nz * off, bx = x2 + nx * off, bz = z2 + nz * off;
          // hlava kolejnice + bok
          steel.quad([ax - nx * 0.04, y1, az - nz * 0.04], [bx - nx * 0.04, y2, bz - nz * 0.04], [bx + nx * 0.04, y2, bz + nz * 0.04], [ax + nx * 0.04, y1, az + nz * 0.04], steelC, [0, 1, 0]);
          steel.quad([ax + nx * 0.04, y1, az + nz * 0.04], [bx + nx * 0.04, y2, bz + nz * 0.04], [bx + nx * 0.04, y2 - 0.16, bz + nz * 0.04], [ax + nx * 0.04, y1 - 0.16, az + nz * 0.04], steelS, [nx, 0, nz]);
          steel.quad([ax - nx * 0.04, y1, az - nz * 0.04], [bx - nx * 0.04, y2, bz - nz * 0.04], [bx - nx * 0.04, y2 - 0.16, bz - nz * 0.04], [ax - nx * 0.04, y1 - 0.16, az - nz * 0.04], steelS, [-nx, 0, -nz]);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(bed.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(bed.uv, 2));
  g.setIndex(bed.idx);
  g.computeVertexNormals();
  const bedMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -8 }));
  bedMesh.receiveShadow = true;
  bedMesh.renderOrder = 5;
  const steelMesh = new THREE.Mesh(steel.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  return [bedMesh, steelMesh];
}

// ------------------------------------------------------------ rybníky
export function buildPonds(map) {
  const meshes = [];
  const mat = new THREE.MeshPhongMaterial({ color: '#4d7a6c', specular: '#9fb8b0', shininess: 80, transparent: true, opacity: 0.9 });
  for (const pd of map.ponds || []) {
    const contour = pd.p.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const pos = [];
    for (const [a, b, c] of tris) for (const k of [a, c, b]) pos.push(pd.p[k][0], pd.h, pd.p[k][1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    // trojúhelníky lícem nahoru
    const n = g.attributes.normal;
    if (n.count && n.getY(0) < 0) { for (let i = 0; i < pos.length; i += 9) { [pos[i + 3], pos[i + 6]] = [pos[i + 6], pos[i + 3]]; [pos[i + 4], pos[i + 7]] = [pos[i + 7], pos[i + 4]]; [pos[i + 5], pos[i + 8]] = [pos[i + 8], pos[i + 5]]; } g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); }
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.renderOrder = 6;
    meshes.push(m);
  }
  return meshes;
}

// ------------------------------------------------------------ vybavení hřišť a rybníků
function seatedPerson(gb, x, y, z, rot, shirt) {
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const at = (a, d) => [x + a * cs - d * sn, z + a * sn + d * cs];
  const [sx, sz] = at(0, 0);
  gb.box(sx, sz, y, y + 0.45, 0.22, 0.22, rot, C('#4a4a4a'));            // stolička
  gb.box(sx, sz, y + 0.45, y + 1.05, 0.22, 0.17, rot, C(shirt));          // tělo
  gb.box(sx, sz, y + 1.05, y + 1.3, 0.12, 0.12, rot, C('#f1c9a5'));       // hlava
  gb.box(sx, sz, y + 1.3, y + 1.38, 0.17, 0.17, rot, C('#3d5a35'));       // klobouk
  const [kx, kz] = at(0, 0.25);
  gb.box(kx, kz, y + 0.4, y + 0.5, 0.2, 0.25, rot, C('#33415a'));         // nohy
  // prut
  for (let i = 0; i < 10; i++) {
    const [px, pz] = at(0, 0.3 + i * 0.35);
    gb.box(px, pz, y + 0.9 + i * 0.16, y + 0.95 + i * 0.16, 0.02, 0.2, rot, C('#2b2b2b'));
  }
}

function bench(gb, x, y, z, rot) {
  const wood = C('#8a5a34'), iron = C('#2f2f2f');
  const cs = Math.cos(rot), sn = Math.sin(rot);
  for (const a of [-0.7, 0.7]) gb.box(x + a * cs, z + a * sn, y, y + 0.45, 0.05, 0.22, rot, iron);
  gb.box(x, z, y + 0.42, y + 0.48, 0.85, 0.22, rot, wood);
  gb.box(x - 0.2 * sn, z + 0.2 * cs, y + 0.55, y + 0.85, 0.85, 0.03, rot, wood);
}

export function buildProps(map, terrain) {
  const gb = new GeoBuilder();
  const fence = new GeoBuilder();
  const circles = [];
  const white = C('#f7f7f2'), wood = C('#c9772f'), darkWood = C('#5b3b25'), steel = C('#b8bcc0'), dark = C('#2b302b');
  const Hh = (x, z) => terrain.height(x, z);

  for (const f of map.pitches || []) {
    const box = obb(f.p);
    const { c, u, v, L, W } = box;
    const rot = Math.atan2(u[1], u[0]);
    const P = (a, d) => [c[0] + u[0] * a + v[0] * d, c[1] + u[1] * a + v[1] * d];
    const y = Hh(c[0], c[1]);

    if (f.c === 'pitch' && f.sp === 'soccer') {
      for (const e of [-1, 1]) {
        const gw = Math.min(3.66, W * 0.3);
        for (const d of [-gw, gw]) { const [x, z] = P(e * (L - 1.5), d); gb.box(x, z, y, y + 2.44, 0.06, 0.06, rot, white); circles.push([x, z, 0.2]); }
        const [x, z] = P(e * (L - 1.5), 0);
        gb.box(x, z, y + 2.38, y + 2.5, 0.06, gw + 0.06, rot, white);
        for (const d of [-gw, gw]) { const [bx, bz] = P(e * (L - 0.3), d); gb.box(bx, bz, y, y + 1.2, 0.04, 0.04, rot, white); }
      }
    } else if (f.c === 'pitch' && f.sp === 'tennis') {
      const [x, z] = P(0, 0);
      const hw = Math.min(6.4, W - 0.5);
      gb.box(x, z, y, y + 0.92, 0.03, hw, rot, dark);
      gb.box(x, z, y + 0.92, y + 1.0, 0.04, hw, rot, white);
      for (const d of [-hw, hw]) { const [px, pz] = P(0, d); gb.box(px, pz, y, y + 1.07, 0.05, 0.05, rot, dark); }
      // plot kolem kurtu
      const ring = f.p;
      for (let i = 0; i < ring.length; i++) {
        const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length];
        const Ls = Math.hypot(x2 - x1, z2 - z1);
        const y1 = Hh(x1, z1), y2 = Hh(x2, z2);
        fence.quad([x1, y1, z1], [x2, y2, z2], [x2, y2 + 3, z2], [x1, y1 + 3, z1], C('#2f5d3a'), null);
        for (let k = 0; k <= Ls / 3; k++) {
          const t = k * 3 / Ls, px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t;
          gb.box(px, pz, Hh(px, pz), Hh(px, pz) + 3.05, 0.04, 0.04, 0, C('#24402a'));
        }
      }
    } else if (f.c === 'playground' && L * W > 150) {
      const k = Math.min(1, Math.min(L, W) / 12);
      // věž se skluzavkou
      { const [x, z] = P(-L * 0.45, -W * 0.3); const ty = Hh(x, z);
        for (const [a, d] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [px, pz] = [x + (a * Math.cos(rot) - d * Math.sin(rot)) * 0.9, z + (a * Math.sin(rot) + d * Math.cos(rot)) * 0.9]; gb.box(px, pz, ty, ty + 3.2, 0.07, 0.07, rot, wood); }
        gb.box(x, z, ty + 1.45, ty + 1.55, 0.95, 0.95, rot, wood);
        gb.box(x, z, ty + 3.1, ty + 3.2, 0.95, 0.95, rot, wood);
        // skluzavka do strany
        const s0 = P(-L * 0.45, -W * 0.3 + 1.0), s1 = P(-L * 0.45, -W * 0.3 + 1.0 + 3.6 * k);
        const nx = -u[1] * 0 + u[0] * 0.3, nz = u[1] * 0.3;
        gb.quad([s0[0] - nx, ty + 1.5, s0[1] - nz], [s0[0] + nx, ty + 1.5, s0[1] + nz], [s1[0] + nx, ty + 0.2, s1[1] + nz], [s1[0] - nx, ty + 0.2, s1[1] - nz], steel, [0, 1, 0]);
        gb.quad([s0[0] - nx, ty + 1.5, s0[1] - nz], [s0[0] + nx, ty + 1.5, s0[1] + nz], [s1[0] + nx, ty + 0.2, s1[1] + nz], [s1[0] - nx, ty + 0.2, s1[1] - nz], steel, [0, -1, 0]);
        circles.push([x, z, 1.4]);
      }
      // houpačky
      { const [x, z] = P(L * 0.2, W * 0.35); const ty = Hh(x, z);
        for (const a of [-1.6, 1.6]) { const [px, pz] = [x + Math.cos(rot) * a, z + Math.sin(rot) * a]; gb.box(px, pz, ty, ty + 2.5, 0.09, 0.09, rot, wood); circles.push([px, pz, 0.3]); }
        gb.box(x, z, ty + 2.4, ty + 2.55, 1.7, 0.08, rot, wood);
        for (const a of [-0.6, 0.6]) {
          const [px, pz] = [x + Math.cos(rot) * a, z + Math.sin(rot) * a];
          gb.box(px, pz, ty + 0.45, ty + 2.4, 0.015, 0.015, rot, dark);
          gb.box(px, pz, ty + 0.4, ty + 0.48, 0.22, 0.12, rot, C('#222'));
        }
      }
      // altán
      { const [x, z] = P(L * 0.45, -W * 0.3); const ty = Hh(x, z);
        for (const [a, d] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [px, pz] = [x + (a * Math.cos(rot) - d * Math.sin(rot)) * 1.6, z + (a * Math.sin(rot) + d * Math.cos(rot)) * 1.6]; gb.box(px, pz, ty, ty + 2.3, 0.08, 0.08, rot, darkWood); }
        gb.pyramid(x, z, ty + 2.3, ty + 3.6, 2.2, rot, C('#4b5054'));
        gb.box(x, z, ty + 0.7, ty + 0.78, 0.9, 0.5, rot, darkWood);
        circles.push([x, z, 1.9]);
      }
      // trampolíny
      for (const [a, d] of [[L * 0.05, -W * 0.45], [-L * 0.1, W * 0.4]]) { const [x, z] = P(a, d); gb.box(x, z, Hh(x, z) + 0.02, Hh(x, z) + 0.05, 0.75, 0.75, rot, C('#1f1f1f')); }
      { const [x, z] = P(0, W * 0.9); bench(gb, x, Hh(x, z), z, rot); }
    }
  }

  // mola a rybáři u rybníků
  const rnd = hashRand(77);
  for (const pd of map.ponds || []) {
    const ring = pd.p;
    let cx = 0, cz = 0; ring.forEach(([x, z]) => { cx += x; cz += z; }); cx /= ring.length; cz /= ring.length;
    const area = Math.abs(polyArea(ring));
    if (area < 600) continue;
    // nejdelší hrana břehu -> molo do vody
    let bi = 0, bl = 0;
    ring.forEach(([x, z], i) => { const [x2, z2] = ring[(i + 1) % ring.length]; const l = Math.hypot(x2 - x, z2 - z); if (l > bl) { bl = l; bi = i; } });
    const [x1, z1] = ring[bi], [x2, z2] = ring[(bi + 1) % ring.length];
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    let dx = cx - mx, dz = cz - mz; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const len = Math.min(7, dl * 0.4);
    const rot = Math.atan2(dz, dx);
    const jx = mx + dx * len / 2, jz = mz + dz * len / 2;
    gb.box(jx, jz, pd.h + 0.35, pd.h + 0.45, len / 2 + 1, 0.8, rot, C('#8a6a45'));
    for (let k = 0; k <= len; k += 2) for (const s of [-0.7, 0.7]) gb.box(mx + dx * k - dz * s, mz + dz * k + dx * s, pd.h - 1, pd.h + 0.4, 0.07, 0.07, rot, C('#5b4330'));
    seatedPerson(gb, mx + dx * (len - 0.6), pd.h + 0.45, mz + dz * (len - 0.6), rot - Math.PI / 2, pick(['#3d6b3a', '#8a4a2a', '#2f4f7a'], rnd()));
    // další rybář na břehu
    const k = Math.floor(rnd() * ring.length), [bx, bz] = ring[k];
    let ex = cx - bx, ez = cz - bz; const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
    seatedPerson(gb, bx - ex * 1.5, Hh(bx - ex * 1.5, bz - ez * 1.5), bz - ez * 1.5, Math.atan2(ez, ex) - Math.PI / 2, pick(['#6b6b3a', '#7a2f2f', '#2f6b6b'], rnd()));
    bench(gb, mx - dx * 4 - dz * 2, Hh(mx - dx * 4 - dz * 2, mz - dz * 4 + dx * 2), mz - dz * 4 + dx * 2, rot + Math.PI / 2);
  }

  const meshes = [];
  if (gb.pos.length) { const m = new THREE.Mesh(gb.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true })); m.castShadow = true; m.receiveShadow = true; meshes.push(m); }
  if (fence.pos.length) meshes.push(new THREE.Mesh(fence.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })));
  return { meshes, circles };
}
