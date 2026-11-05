#!/usr/bin/env python3
"""
Stáhne a připraví data pro hru:
  - OpenStreetMap (silnice, budovy, pole, lesy, voda, zajímavá místa)
  - ČÚZK DMR 5G (výškový model terénu)

Výstup: data/map.json + data/heights.bin

Spuštění (z kořene repa):
    python3 tools/build_data.py            # použije cache, pokud existuje
    python3 tools/build_data.py --refresh  # stáhne vše znovu
"""
import json, math, os, random, struct, sys, urllib.request
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", "cache")
OUT = os.path.join(ROOT, "data")

# Herní výřez: Šumice + pole kolem (WGS84)
LON_MIN, LON_MAX = 17.700, 17.745
LAT_MIN, LAT_MAX = 49.021, 49.043
DEM_RES = 5.0  # metrů na pixel výškového modelu

LAT0 = (LAT_MIN + LAT_MAX) / 2
LON0 = (LON_MIN + LON_MAX) / 2
M_PER_DEG_LAT = 111132.954 - 559.822 * math.cos(2 * math.radians(LAT0))
M_PER_DEG_LON = 111412.84 * math.cos(math.radians(LAT0))

WIDTH_M = (LON_MAX - LON_MIN) * M_PER_DEG_LON
HEIGHT_M = (LAT_MAX - LAT_MIN) * M_PER_DEG_LAT


def proj(lat, lon):
    """WGS84 -> lokální metry. x = východ, z = jih (Three.js: -z je sever)."""
    return (round((lon - LON0) * M_PER_DEG_LON, 2), round(-(lat - LAT0) * M_PER_DEG_LAT, 2))


def fetch(url, path, refresh):
    if os.path.exists(path) and not refresh:
        return path
    print("stahuji", url)
    req = urllib.request.Request(url, headers={"User-Agent": "sumice-hra-builder/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(path + ".part", "wb") as f:
        f.write(r.read())
    os.replace(path + ".part", path)
    return path


# ---------------------------------------------------------------- terén
def build_heights(refresh):
    """Stáhne DMR 5G a převzorkuje ho na naši metrovou mřížku.

    Pozor: ArcGIS exportImage si výřez upraví tak, aby pixely měly čtvercový tvar
    ve stupních – proto čteme skutečný vrácený výřez (f=json) a podle něj
    převzorkujeme. (Dřív to tu chybělo a terén byl svisle zdeformovaný.)"""
    w = int(round(WIDTH_M / DEM_RES)) + 1
    h = int(round(HEIGHT_M / DEM_RES)) + 1
    m = 0.002  # okraj navíc
    bx0, by0, bx1, by1 = LON_MIN - m, LAT_MIN - m, LON_MAX + m, LAT_MAX + m
    sw = 1000
    sh = int(round(sw * (by1 - by0) / (bx1 - bx0)))  # čtvercové pixely ve stupních
    base = ("https://ags.cuzk.cz/arcgis2/rest/services/dmr5g/ImageServer/exportImage"
            f"?bbox={bx0},{by0},{bx1},{by1}&bboxSR=4326&imageSR=4326"
            f"&size={sw},{sh}&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation")
    meta_path = os.path.join(CACHE, f"dmr5g_{sw}x{sh}.json")
    tif_path = os.path.join(CACHE, f"dmr5g_{sw}x{sh}.tif")
    if refresh or not (os.path.exists(meta_path) and os.path.exists(tif_path)):
        fetch(base + "&f=json", meta_path, True)
        meta = json.load(open(meta_path))
        fetch(meta["href"], tif_path, True)
    meta = json.load(open(meta_path))
    ext = meta["extent"]
    src = np.array(Image.open(tif_path), dtype=np.float64)
    sh_, sw_ = src.shape
    print(f"ČÚZK vrátil výřez lon {ext['xmin']:.5f}–{ext['xmax']:.5f}, lat {ext['ymin']:.5f}–{ext['ymax']:.5f}, {sw_}x{sh_} px")
    # pixel-is-area: střed pixelu i leží na xmin + (i+0.5)*dx
    dx = (ext["xmax"] - ext["xmin"]) / sw_
    dy = (ext["ymax"] - ext["ymin"]) / sh_
    lons = LON_MIN + (LON_MAX - LON_MIN) * np.arange(w) / (w - 1)
    lats = LAT_MAX - (LAT_MAX - LAT_MIN) * np.arange(h) / (h - 1)  # řádek 0 = sever
    u = (lons - ext["xmin"]) / dx - 0.5
    v = (ext["ymax"] - lats) / dy - 0.5
    assert u.min() >= 0 and u.max() <= sw_ - 1 and v.min() >= 0 and v.max() <= sh_ - 1, "výřez nepokrývá mapu"
    i0 = np.clip(np.floor(u).astype(int), 0, sw_ - 2); fu = u - i0
    j0 = np.clip(np.floor(v).astype(int), 0, sh_ - 2); fv = v - j0
    I0, J0 = np.meshgrid(i0, j0); FU, FV = np.meshgrid(fu, fv)
    a = ((src[J0, I0] * (1 - FU) + src[J0, I0 + 1] * FU) * (1 - FV)
         + (src[J0 + 1, I0] * (1 - FU) + src[J0 + 1, I0 + 1] * FU) * FV)
    hmin = float(np.floor(a.min()))
    print(f"terén {w}x{h}, {a.min():.1f}–{a.max():.1f} m n. m.")
    return {"w": w, "h": h, "min": hmin, "scale": 0.01, "file": "heights.bin"}, a, hmin


def grid_mask(dem, ring):
    xs, zs = grid_xz(dem)
    rx = [x for x, _ in ring]; rz = [z for _, z in ring]
    i0 = max(0, int(np.searchsorted(xs, min(rx))) - 1); i1 = min(len(xs), int(np.searchsorted(xs, max(rx))) + 1)
    j0 = max(0, int(np.searchsorted(zs, min(rz))) - 1); j1 = min(len(zs), int(np.searchsorted(zs, max(rz))) + 1)
    if i1 <= i0 or j1 <= j0:
        return None
    gx, gz = np.meshgrid(xs[i0:i1], zs[j0:j1])
    ins = points_in_poly(gx.ravel(), gz.ravel(), ring).reshape(gx.shape)
    return (slice(j0, j1), slice(i0, i1)), ins


def ponds_and_pitches(dem, hmin, areas):
    """Rybníky: rovná hladina a dno pod ní. Hřiště: rovná plocha."""
    out = dem.copy()
    for a in areas:
        if a["c"] == "water" and a.get("pond"):
            ring = a["p"][0]
            shore = np.array([sample_height(dem, hmin, x, z) for x, z in densify(ring, 3.0)])
            level = float(np.percentile(shore, 15)) - 0.35
            a["h"] = round(level, 2)
            gm = grid_mask(out, ring)
            if gm:
                sl, ins = gm
                sub = out[sl]
                sub[ins] = np.minimum(sub[ins], level + hmin - 0.8)
        elif a["c"] in ("pitch", "playground", "pumptrack"):
            ring = a["p"][0]
            gm = grid_mask(out, ring)
            if gm:
                sl, ins = gm
                if ins.any():
                    sub = out[sl]
                    sub[ins] = np.median(sub[ins])
    return out


def write_heights(dem, hmin):
    q = np.clip(np.round((dem - hmin) * 100), 0, 65535).astype("<u2")  # centimetry nad minimem
    with open(os.path.join(OUT, "heights.bin"), "wb") as f:
        f.write(q.tobytes())


# ---------------------------------------------------------------- srovnání terénu
def smooth_dem(a, passes=2):
    """Jemné zahlazení (binomický filtr 3x3)."""
    a = a.astype(np.float64)
    for _ in range(passes):
        p = np.pad(a, 1, mode="edge")
        a = (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:]
             + 2 * p[1:-1, :-2] + 4 * p[1:-1, 1:-1] + 2 * p[1:-1, 2:]
             + p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) / 16
    return a


def grid_xz(dem):
    hgt, wid = dem.shape
    xs = np.linspace(-WIDTH_M / 2, WIDTH_M / 2, wid)
    zs = np.linspace(-HEIGHT_M / 2, HEIGHT_M / 2, hgt)
    return xs, zs


def smoothstep(e0, e1, d):
    t = np.clip((d - e0) / (e1 - e0), 0, 1)
    return 1 - t * t * (3 - 2 * t)


def densify(p, step):
    out = []
    for i in range(len(p) - 1):
        (x1, z1), (x2, z2) = p[i], p[i + 1]
        n = max(1, int(math.ceil(math.hypot(x2 - x1, z2 - z1) / step)))
        for k in range(n):
            out.append([x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n])
    out.append(list(p[-1]))
    return out


FOOT = ("footway", "path", "steps", "cycleway")


def moving_avg(hs, win):
    if len(hs) <= 2 or win < 1:
        return hs
    k = np.ones(2 * win + 1)
    return np.convolve(np.pad(hs, win, mode="edge"), k, "valid") / k.sum()


def bridge_profile(pts, dem, hmin, water_h=None):
    """Mostovka: rovně mezi opěrami, vždy nad vodou."""
    h0 = sample_height(dem, hmin, *pts[0])
    h1 = sample_height(dem, hmin, *pts[-1])
    n = len(pts)
    hs = np.array([h0 + (h1 - h0) * i / max(1, n - 1) for i in range(n)])
    if water_h is not None:
        lo = min(water_h(x, z) for x, z in pts) + 1.6
        if hs.min() < lo:
            hs += lo - hs.min()
    return hs


def road_profiles(roads, rails, dem, hmin, water_h):
    """Plynulý výškový profil podél každé cesty (bez náklonu do stran)."""
    for r in roads:
        pts = densify(r["p"], 3.0)
        r["p"] = [[round(x, 1), round(z, 1)] for x, z in pts]
        if r["t"] in FOOT and not r.get("b"):
            continue
        if r.get("b"):
            hs = bridge_profile(pts, dem, hmin, water_h)
        else:
            hs = np.array([sample_height(dem, hmin, x, z) for x, z in pts])
            # klouzavý průměr ~ 24 m silnice, 15 m polní cesty
            hs = moving_avg(hs, 8 if r["s"] else 5)
        r["h"] = [round(float(v), 2) for v in hs]
    for r in rails:
        pts = densify(r["p"], 3.0)
        r["p"] = [[round(x, 1), round(z, 1)] for x, z in pts]
        if r["b"]:
            hs = bridge_profile(pts, dem, hmin, water_h)
        else:
            hs = moving_avg(np.array([sample_height(dem, hmin, x, z) for x, z in pts]), 12)
        r["h"] = [round(float(v), 2) for v in hs]
        r.pop("ends", None)


def carve_water(dem, hmin, water):
    """Vyhloubí koryta řek a potoků a spočítá hladinu."""
    xs, zs = grid_xz(dem)
    res = xs[1] - xs[0]
    out = dem.copy()
    # jen části toků uvnitř mapy
    water[:] = [w for w in water if any(in_bounds(x, z, 30) for x, z in w["p"])]
    for wl in water:
        pts = [q for q in densify(wl["p"], 2.5) if in_bounds(q[0], q[1], 30)]
        if len(pts) < 2:
            wl["p"] = []; wl["h"] = []
            continue
        wl["p"] = [[round(x, 1), round(z, 1)] for x, z in pts]
        bed = np.array([sample_height(dem, hmin, x, z) for x, z in pts])
        # dno nesmí stoupat proti proudu "zubatě": zahladit
        bed = moving_avg(bed, 3) - wl["d"]
        wl["h"] = [round(float(b + wl["d"] * 0.45), 2) for b in bed]
        if wl.get("u"):
            continue
        core, blend = wl["w"] / 2, 2.5 + wl["w"] * 0.3
        for (x, z), b in zip(pts, bed):
            R = core + blend
            i0 = max(0, int((x - R - xs[0]) / res)); i1 = min(len(xs) - 1, int((x + R - xs[0]) / res) + 1)
            j0 = max(0, int((z - R - zs[0]) / res)); j1 = min(len(zs) - 1, int((z + R - zs[0]) / res) + 1)
            if i1 < i0 or j1 < j0:
                continue
            gx, gz = np.meshgrid(xs[i0:i1 + 1], zs[j0:j1 + 1])
            wgt = smoothstep(core, R, np.hypot(gx - x, gz - z))
            sl = (slice(j0, j1 + 1), slice(i0, i1 + 1))
            target = b + hmin
            out[sl] = np.where(out[sl] > target, out[sl] * (1 - wgt) + target * wgt, out[sl])
    return out


def water_sampler(water):
    """Výška hladiny nejbližšího toku (pro mosty)."""
    P = [(x, z, h) for wl in water for (x, z), h in zip(wl["p"], wl["h"])]
    arr = np.array(P) if P else np.zeros((0, 3))

    def f(x, z):
        if not len(arr):
            return -1e9
        d = (arr[:, 0] - x) ** 2 + (arr[:, 1] - z) ** 2
        i = int(np.argmin(d))
        return arr[i, 2] if d[i] < 40 ** 2 else -1e9
    return f


def fix_bridges(roads, rails, dem, hmin, water_h):
    """Konce mostovky napojí na výšku navazující cesty (žádný schod na nájezdu)."""
    def ends_of(lst):
        pts = []
        for r in lst:
            if r.get("b") or "h" not in r:
                continue
            for k in (0, -1):
                pts.append((r["p"][k][0], r["p"][k][1], r["h"][k]))
        return np.array(pts) if pts else np.zeros((0, 3))
    for lst in (roads, rails):
        nb = ends_of(lst)
        for r in lst:
            if not r.get("b"):
                continue
            hs = []
            for k in (0, -1):
                x, z = r["p"][k]
                h = None
                if len(nb):
                    d = (nb[:, 0] - x) ** 2 + (nb[:, 1] - z) ** 2
                    i = int(np.argmin(d))
                    if d[i] < 6 ** 2:
                        h = float(nb[i, 2])
                if h is None:
                    h = sample_height(dem, hmin, x, z)
                hs.append(h)
            n = len(r["p"])
            prof = np.array([hs[0] + (hs[1] - hs[0]) * i / max(1, n - 1) for i in range(n)])
            # uprostřed musí být most nad vodou -> mírné prohnutí nahoru
            lo = min(water_h(x, z) for x, z in r["p"]) + 1.3
            mid = np.sin(np.linspace(0, np.pi, n))
            if prof.min() < lo:
                prof += (lo - prof.min()) * mid / max(mid.max(), 1e-6)
            r["h"] = [round(float(v), 2) for v in prof]


def flatten(dem, hmin, roads, buildings, rails=()):
    xs, zs = grid_xz(dem)
    res = xs[1] - xs[0]
    out = dem.copy()

    def splat(acc_num, acc_den, acc_w, x, z, target, core, blend):
        R = core + blend
        i0 = max(0, int((x - R - xs[0]) / res)); i1 = min(len(xs) - 1, int((x + R - xs[0]) / res) + 1)
        j0 = max(0, int((z - R - zs[0]) / res)); j1 = min(len(zs) - 1, int((z + R - zs[0]) / res) + 1)
        if i1 < i0 or j1 < j0:
            return
        gx, gz = np.meshgrid(xs[i0:i1 + 1], zs[j0:j1 + 1])
        d = np.hypot(gx - x, gz - z)
        wgt = smoothstep(core, R, d)
        sl = (slice(j0, j1 + 1), slice(i0, i1 + 1))
        acc_num[sl] += wgt * target
        acc_den[sl] += wgt
        np.maximum(acc_w[sl], wgt, out=acc_w[sl])

    # 1) plošiny pod domy
    num = np.zeros_like(dem); den = np.zeros_like(dem); wmax = np.zeros_like(dem)
    for b in buildings:
        ring = b["p"]
        ground = [sample_height(out, hmin, x, z) for x, z in ring]
        level = float(np.median(ground)) + hmin
        cx, cz = centroid(ring)
        rad = max(math.hypot(x - cx, z - cz) for x, z in ring)
        splat(num, den, wmax, cx, cz, level, rad + 1.5, 5.0)
    m = den > 0
    out[m] = out[m] * (1 - wmax[m]) + (num[m] / den[m]) * wmax[m]

    # 2) koridory silnic (přebijí plošiny domů)
    num = np.zeros_like(dem); den = np.zeros_like(dem); wmax = np.zeros_like(dem)
    bridge_ends = [pt for r in list(roads) + list(rails) if r.get("b") for pt in (r["p"][0], r["p"][-1])]

    def near_bridge(x, z):
        return any((x - bx) ** 2 + (z - bz) ** 2 < 14 ** 2 for bx, bz in bridge_ends)

    for r in list(roads) + [dict(rr, w=4.0, s=1) for rr in rails]:
        if "h" not in r or r.get("b"):
            continue  # pod mostem terén nesrovnáváme – teče tam voda
        core = r["w"] / 2 + 1.5
        blend = 7.0 if r["s"] else 5.0
        for (x, z), h in zip(r["p"], r["h"]):
            nb = near_bridge(x, z)
            splat(num, den, wmax, x, z, h + hmin, core * (0.6 if nb else 1), 1.0 if nb else blend)
    m = den > 0
    out[m] = out[m] * (1 - wmax[m]) + (num[m] / den[m]) * wmax[m]
    return out


def sample_height(dem, hmin, x, z):
    hgt, wid = dem.shape
    u = (x + WIDTH_M / 2) / WIDTH_M * (wid - 1)
    v = (z + HEIGHT_M / 2) / HEIGHT_M * (hgt - 1)
    u = min(max(u, 0), wid - 1.001)
    v = min(max(v, 0), hgt - 1.001)
    i, j = int(u), int(v)
    fu, fv = u - i, v - j
    a = dem[j, i] * (1 - fu) + dem[j, i + 1] * fu
    b = dem[j + 1, i] * (1 - fu) + dem[j + 1, i + 1] * fu
    return a * (1 - fv) + b * fv - hmin


# ---------------------------------------------------------------- OSM
ROAD_WIDTH = {
    "primary": 7.5, "secondary": 7, "tertiary": 6, "unclassified": 5,
    "residential": 5, "living_street": 4.5, "service": 3.5, "track": 3,
    "cycleway": 2.2, "footway": 1.6, "path": 1.2, "pedestrian": 4, "steps": 1.6,
    "primary_link": 5, "secondary_link": 5, "tertiary_link": 5,
}

AREA_CLASS = [
    # (klíč, hodnota nebo None = cokoli, třída)
    ("natural", "water", "water"), ("water", None, "water"), ("landuse", "reservoir", "water"),
    ("landuse", "basin", "water"),
    ("landuse", "forest", "forest"), ("natural", "wood", "forest"),
    ("natural", "scrub", "scrub"),
    ("landuse", "orchard", "orchard"), ("landuse", "vineyard", "vineyard"),
    ("landuse", "farmland", "farmland"),
    ("landuse", "meadow", "meadow"), ("natural", "grassland", "meadow"),
    ("landuse", "grass", "grass"), ("leisure", "park", "grass"), ("landuse", "village_green", "grass"),
    ("leisure", "pitch", "pitch"), ("leisure", "playground", "playground"),
    ("leisure", "track", "pumptrack"),
    ("landuse", "cemetery", "cemetery"), ("amenity", "grave_yard", "cemetery"),
    ("landuse", "farmyard", "farmyard"), ("landuse", "industrial", "industrial"),
    ("landuse", "allotments", "garden"), ("leisure", "garden", "garden"),
    ("landuse", "residential", "residential"),
    ("amenity", "parking", "parking"),
]
AREA_ORDER = ["residential", "farmland", "meadow", "grass", "garden", "orchard", "vineyard",
              "scrub", "forest", "farmyard", "industrial", "cemetery", "parking", "pitch",
              "playground", "water"]

POI_KEYS = ("amenity", "shop", "tourism", "historic", "leisure", "office", "craft")

# Potoky svedené do potrubí: OSM id -> v jaké vzdálenosti od domů je potok pod zemí (m)
PIPED_STREAMS = {
    "81886238": 45,  # bezejmenný potok od Ovčírky ulicí k severovýchodu – v obci sveden do potrubí (cca 60. léta)
}

# Dominanty obce – vzhled podle virtuální prohlídky na sumice.cz (OSM id budovy -> styl, popisek, počet pater)
LANDMARKS = {
    "36998573": ("church", None, None),
    "36998624": ("ou", None, 3),
    "461136373": ("ou_wing", None, 2),
    "36998576": ("zs", "Základní škola", 2),
    "255724940": ("ms", "Mateřská škola", 2),
    "255724922": ("mlyn", "Válcový mlýn", 2),
    "255725129": ("chalupa", "Hasoňova chalupa", 1),
}


def tags_of(e):
    return {t.get("k"): t.get("v") for t in e.iter("tag")}


def area_class(t):
    for k, v, c in AREA_CLASS:
        if k in t and (v is None or t[k] == v):
            return c
    return None


def stitch(segments):
    """Spojí otevřené úseky (seznamy id uzlů) do uzavřených kruhů."""
    segs = [list(s) for s in segments if len(s) >= 2]
    rings = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[::-1][1:]
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = s[::-1][:-1] + ring
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


def poly_area(p):
    s = 0.0
    for i in range(len(p)):
        x1, z1 = p[i]
        x2, z2 = p[(i + 1) % len(p)]
        s += x1 * z2 - x2 * z1
    return s / 2


def centroid(p):
    return (sum(x for x, _ in p) / len(p), sum(z for _, z in p) / len(p))


def points_in_poly(px, pz, poly):
    """Vektorový ray-casting: px, pz numpy pole."""
    inside = np.zeros(px.shape, dtype=bool)
    n = len(poly)
    for i in range(n):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % n]
        cond = (z1 > pz) != (z2 > pz)
        with np.errstate(divide="ignore", invalid="ignore"):
            xi = (x2 - x1) * (pz - z1) / (z2 - z1) + x1
        inside ^= cond & (px < xi)
    return inside


def in_bounds(x, z, margin=0):
    return abs(x) <= WIDTH_M / 2 + margin and abs(z) <= HEIGHT_M / 2 + margin


def build_osm(refresh, dem, hmin):
    m = 0.004
    url = ("https://api.openstreetmap.org/api/0.6/map"
           f"?bbox={LON_MIN - m},{LAT_MIN - m},{LON_MAX + m},{LAT_MAX + m}")
    root = ET.parse(fetch(url, os.path.join(CACHE, "osm.xml"), refresh)).getroot()

    nodes = {}
    node_tags = {}
    for n in root.iter("node"):
        nid = n.get("id")
        nodes[nid] = proj(float(n.get("lat")), float(n.get("lon")))
        t = tags_of(n)
        if t:
            node_tags[nid] = t
    ways = {}
    way_tags = {}
    for w in root.iter("way"):
        refs = [nd.get("ref") for nd in w.iter("nd") if nd.get("ref") in nodes]
        ways[w.get("id")] = refs
        way_tags[w.get("id")] = tags_of(w)

    def pts(refs):
        return [list(nodes[r]) for r in refs]

    roads, buildings, areas, water_lines, pois, trees, rails = [], [], [], [], [], [], []
    rnd = random.Random(42)

    def add_poi(t, x, z):
        name = t.get("name")
        if not name or not in_bounds(x, z):
            return
        kind = next((t[k] for k in POI_KEYS if k in t), None) or t.get("building")
        if t.get("building") in ("church", "chapel") or t.get("amenity") == "place_of_worship":
            kind = "church"
        if kind is None:
            return
        pois.append({"n": name, "k": kind, "x": round(x, 1), "z": round(z, 1)})

    for wid, refs in ways.items():
        t = way_tags[wid]
        if len(refs) < 2:
            continue
        p = pts(refs)
        if not any(in_bounds(x, z, 50) for x, z in p):
            continue
        closed = refs[0] == refs[-1] and len(refs) >= 4

        if "highway" in t and t["highway"] in ROAD_WIDTH and t.get("area") != "yes":
            hw = t["highway"]
            width = ROAD_WIDTH[hw]
            surf = t.get("surface", "")
            paved = hw not in ("track", "path", "footway") or surf in ("asphalt", "paved", "concrete", "paving_stones")
            if surf in ("unpaved", "gravel", "dirt", "ground", "grass", "compacted", "fine_gravel"):
                paved = False
            road = {"t": hw, "w": width, "s": 1 if paved else 0, "p": p}
            if t.get("bridge") and t["bridge"] != "no":
                road["b"] = 1
            roads.append(road)
            continue

        if t.get("railway") == "rail":
            rails.append({"p": p, "b": 1 if t.get("bridge") not in (None, "no") else 0,
                          "ends": (refs[0], refs[-1])})
            continue

        if "waterway" in t and not closed:
            ww = t["waterway"]
            width = {"river": 7, "stream": 2, "ditch": 1, "drain": 1, "canal": 4}.get(ww, 1.5)
            depth = {"river": 1.4, "stream": 0.8, "canal": 1.2}.get(ww, 0.4)
            wl = {"w": width, "d": depth, "p": p}
            if t.get("tunnel") or t.get("culvert") or t.get("location") == "underground":
                wl["u"] = 1  # propustek – pod cestou
            if wid in PIPED_STREAMS:
                wl["pipe"] = PIPED_STREAMS[wid]
            water_lines.append(wl)
            continue

        if "building" in t and closed:
            ring = p[:-1]
            if poly_area(ring) < 0:  # chceme orientaci proti směru hodinek v (x,z)
                ring = ring[::-1]
            if abs(poly_area(ring)) < 6:
                continue
            ground = [sample_height(dem, hmin, x, z) for x, z in ring]
            b = {"p": ring, "y": round(float(min(ground)), 2), "dy": round(float(max(ground) - min(ground)), 2),
                 "t": t["building"]}
            if "building:levels" in t:
                try:
                    b["l"] = int(float(t["building:levels"]))
                except ValueError:
                    pass
            if "height" in t:
                try:
                    b["h"] = float(t["height"].split()[0])
                except ValueError:
                    pass
            if t.get("amenity") == "place_of_worship" or t["building"] in ("church", "chapel"):
                b["t"] = "church" if t["building"] == "church" else "chapel"
            if "name" in t:
                b["n"] = t["name"]
            cx, cz = centroid(ring)
            if wid in LANDMARKS:
                st, label, lv = LANDMARKS[wid]
                b["st"] = st
                if lv:
                    b["l"] = lv
                if label:
                    kind = {"zs": "school", "ms": "kindergarten", "mlyn": "mill", "chalupa": "museum"}[st]
                    pois.append({"n": label, "k": kind, "x": round(cx, 1), "z": round(cz, 1)})
            buildings.append(b)
            add_poi(t, cx, cz)
            continue

        if t.get("natural") == "tree_row":
            for i in range(len(p) - 1):
                (x1, z1), (x2, z2) = p[i], p[i + 1]
                L = math.hypot(x2 - x1, z2 - z1)
                for k in range(int(L // 8) + 1):
                    f = k * 8 / L if L else 0
                    trees.append([round(x1 + (x2 - x1) * f, 1), round(z1 + (z2 - z1) * f, 1), 0, round(rnd.uniform(0.8, 1.2), 2)])
            continue

        c = area_class(t)
        if c and closed:
            ar = {"c": c, "id": int(wid) % 997, "p": [p[:-1]]}
            if t.get("sport"):
                ar["sp"] = t["sport"]
            if t.get("surface"):
                ar["su"] = t["surface"]
            areas.append(ar)
            add_poi(t, *centroid(p[:-1]))
            if c == "pumptrack":
                cx, cz = centroid(p[:-1])
                pois.append({"n": "Pumptrack", "k": "pumptrack", "x": round(cx, 1), "z": round(cz, 1)})
            if c == "playground":
                cx, cz = centroid(p[:-1])
                pois.append({"n": "Dětské hřiště", "k": "playground", "x": round(cx, 1), "z": round(cz, 1)})
            if c == "pitch" and t.get("sport") == "soccer":
                cx, cz = centroid(p[:-1])
                pois.append({"n": "Fotbalové hřiště", "k": "pitch", "x": round(cx, 1), "z": round(cz, 1)})
        elif closed:
            add_poi(t, *centroid(p[:-1]))

    # multipolygony
    for rel in root.iter("relation"):
        t = tags_of(rel)
        if t.get("type") != "multipolygon":
            continue
        c = area_class(t)
        if not c:
            continue
        outer = [ways[m.get("ref")] for m in rel.iter("member")
                 if m.get("type") == "way" and m.get("role") in ("outer", "") and m.get("ref") in ways]
        inner = [ways[m.get("ref")] for m in rel.iter("member")
                 if m.get("type") == "way" and m.get("role") == "inner" and m.get("ref") in ways]
        rings = [pts(r)[:-1] for r in stitch(outer)]
        if not rings or not any(in_bounds(x, z, 50) for r in rings for x, z in r):
            continue
        holes = [pts(r)[:-1] for r in stitch(inner)]
        areas.append({"c": c, "id": int(rel.get("id")) % 997, "p": rings, "holes": holes})

    # body: stromy a zajímavá místa
    for nid, t in node_tags.items():
        x, z = nodes[nid]
        if not in_bounds(x, z):
            continue
        if t.get("natural") == "tree":
            trees.append([x, z, 0, round(rnd.uniform(0.9, 1.3), 2)])
        elif t.get("railway") in ("halt", "station") and t.get("name"):
            pois.append({"n": t["name"], "k": "halt", "x": round(x, 1), "z": round(z, 1)})
        else:
            add_poi(t, x, z)

    # stromy v lesích, sadech a křovinách
    forest_trees = 0
    for a in areas:
        dens = {"forest": 70.0, "orchard": 9.0, "scrub": 120.0}.get(a["c"])
        if not dens:
            continue
        for ring in a["p"]:
            xs = [x for x, _ in ring]
            zs = [z for _, z in ring]
            x0, x1 = max(min(xs), -WIDTH_M / 2), min(max(xs), WIDTH_M / 2)
            z0, z1 = max(min(zs), -HEIGHT_M / 2), min(max(zs), HEIGHT_M / 2)
            if x1 <= x0 or z1 <= z0:
                continue
            if a["c"] == "orchard":
                # řady stromů v sadu
                gx, gz = np.meshgrid(np.arange(x0, x1, dens), np.arange(z0, z1, dens * 0.8))
                px = gx.ravel() + np.array([rnd.uniform(-0.8, 0.8) for _ in range(gx.size)])
                pz = gz.ravel() + np.array([rnd.uniform(-0.8, 0.8) for _ in range(gz.size)])
            else:
                n = int((x1 - x0) * (z1 - z0) / dens)
                px = np.array([rnd.uniform(x0, x1) for _ in range(n)])
                pz = np.array([rnd.uniform(z0, z1) for _ in range(n)])
            if px.size == 0:
                continue
            ins = points_in_poly(px, pz, ring)
            for hole in a.get("holes", []):
                ins &= ~points_in_poly(px, pz, hole)
            kind = {"forest": 1, "orchard": 2, "scrub": 3}[a["c"]]
            for x, z in zip(px[ins], pz[ins]):
                if kind == 1 and rnd.random() < 0.35:
                    k = 4  # jehličnan
                else:
                    k = kind
                trees.append([round(float(x), 1), round(float(z), 1), k, round(rnd.uniform(0.75, 1.3), 2)])
                forest_trees += kind == 1

    # stromy v zahradách (z dronu je ves plná zeleně)
    bcells = {}
    for b in buildings:
        xs = [x for x, _ in b["p"]]; zs = [z for _, z in b["p"]]
        for i in range(int(min(xs) // 10) - 1, int(max(xs) // 10) + 2):
            for j in range(int(min(zs) // 10) - 1, int(max(zs) // 10) + 2):
                bcells.setdefault((i, j), []).append(b["p"])
    garden = 0
    for a in areas:
        if a["c"] not in ("residential", "garden"):
            continue
        for ring in a["p"]:
            xs = [x for x, _ in ring]; zs = [z for _, z in ring]
            x0, x1 = max(min(xs), -WIDTH_M / 2), min(max(xs), WIDTH_M / 2)
            z0, z1 = max(min(zs), -HEIGHT_M / 2), min(max(zs), HEIGHT_M / 2)
            if x1 <= x0 or z1 <= z0:
                continue
            n = int((x1 - x0) * (z1 - z0) / 260)
            px = np.array([rnd.uniform(x0, x1) for _ in range(n)])
            pz = np.array([rnd.uniform(z0, z1) for _ in range(n)])
            if not n:
                continue
            ins = points_in_poly(px, pz, ring)
            for x, z in zip(px[ins], pz[ins]):
                near = bcells.get((int(x // 10), int(z // 10)), [])
                if any(points_in_poly(np.array([x, x + 3, x - 3, x, x]), np.array([z, z, z, z + 3, z - 3]), q).any() for q in near):
                    continue  # moc blízko domu
                kind = 2 if rnd.random() < 0.55 else (0 if rnd.random() < 0.8 else 4)
                trees.append([round(float(x), 1), round(float(z), 1), kind, round(rnd.uniform(0.7, 1.15), 2)])
                garden += 1
    print("stromy v zahradách", garden)

    # potoky v potrubí: rozdělit na otevřené úseky a podzemní úsek u domů
    centers = np.array([centroid(b["p"]) for b in buildings]) if buildings else np.zeros((0, 2))
    split = []
    for wl in water_lines:
        lim = wl.pop("pipe", None)
        if lim is None:
            split.append(wl)
            continue
        pts = densify(wl["p"], 5.0)
        under = [bool(len(centers)) and float(np.min(np.hypot(centers[:, 0] - x, centers[:, 1] - z))) < lim for x, z in pts]
        start = 0
        for i in range(1, len(pts) + 1):
            if i == len(pts) or under[i] != under[start]:
                seg = pts[max(0, start - 1):i] if start else pts[start:i]
                if len(seg) >= 2:
                    part = dict(wl, p=seg)
                    if under[start]:
                        part["u"] = 1
                    split.append(part)
                start = i
    water_lines[:] = split

    # husté stromy a vrby kolem rybníků (jako na leteckém snímku)
    pond_n = 0
    for a in areas:
        if a["c"] != "water":
            continue
        ring = a["p"][0]
        if abs(poly_area(ring)) > 30000:
            continue
        cx, cz = centroid(ring)
        if not in_bounds(cx, cz):
            continue
        for (x1, z1), (x2, z2) in zip(ring, ring[1:] + ring[:1]):
            L = math.hypot(x2 - x1, z2 - z1)
            for k in range(int(L // 4.5) + 1):
                f = k * 4.5 / L if L else 0
                x, z = x1 + (x2 - x1) * f, z1 + (z2 - z1) * f
                dx, dz = x - cx, z - cz
                dl = math.hypot(dx, dz) or 1
                off = rnd.uniform(3.0, 7.0)
                if rnd.random() < 0.8:
                    trees.append([round(x + dx / dl * off, 1), round(z + dz / dl * off, 1), 0, round(rnd.uniform(0.9, 1.4), 2)])
                    pond_n += 1
        a["pond"] = 1
    print("stromy kolem rybníků", pond_n)

    # odstraň stromy na silnicích, chodnících, kolejích a ve vodě (podle skutečné šířky)
    segs = {}
    def add_line(p, half):
        for i in range(len(p) - 1):
            (x1, z1), (x2, z2) = p[i], p[i + 1]
            for ci in range(int((min(x1, x2) - half) // 10), int((max(x1, x2) + half) // 10) + 1):
                for cj in range(int((min(z1, z2) - half) // 10), int((max(z1, z2) + half) // 10) + 1):
                    segs.setdefault((ci, cj), []).append((x1, z1, x2, z2, half))
    for r in roads:
        add_line(r["p"], r["w"] / 2 + 1.6)
    for r in rails:
        add_line(r["p"], 3.2)
    for w in water_lines:
        add_line(w["p"], w["w"] / 2 + 1.2)

    def blocked(x, z):
        for x1, z1, x2, z2, half in segs.get((int(x // 10), int(z // 10)), ()):
            ex, ez = x2 - x1, z2 - z1
            L2 = ex * ex + ez * ez or 1
            t = max(0.0, min(1.0, ((x - x1) * ex + (z - z1) * ez) / L2))
            if (x - x1 - ex * t) ** 2 + (z - z1 - ez * t) ** 2 < half * half:
                return True
        return False
    # ani v rybnících a na hřištích stromy nerostou
    clear = [a["p"][0] for a in areas if a["c"] in ("water", "pitch", "playground", "pumptrack")]
    if clear:
        tx = np.array([tr[0] for tr in trees]); tz = np.array([tr[1] for tr in trees])
        bad = np.zeros(len(trees), dtype=bool)
        for ring in clear:
            xs = [x for x, _ in ring]; zs = [z for _, z in ring]
            near = (tx > min(xs) - 2) & (tx < max(xs) + 2) & (tz > min(zs) - 2) & (tz < max(zs) + 2)
            if near.any():
                idx = np.nonzero(near)[0]
                bad[idx] |= points_in_poly(tx[idx], tz[idx], ring)
        trees = [tr for tr, b_ in zip(trees, bad) if not b_]
    before = len(trees)
    trees = [tr for tr in trees if not blocked(tr[0], tr[1])]
    print(f"odstraněno {before - len(trees)} stromů z cest a vody")

    print(f"silnice {len(roads)}, budovy {len(buildings)}, plochy {len(areas)}, "
          f"vodní toky {len(water_lines)}, stromy {len(trees)} (les {forest_trees}), místa {len(pois)}")
    # železnice: spojit úseky do jedné trati (pro vláček)
    line = chain_rails(rails)
    print(f"železnice {len(rails)} úseků, trať pro vlak {len(line)} bodů")
    return roads, buildings, areas, water_lines, pois, trees, rails, line


def train_line(line, rails):
    """Trať pro vláček: body po 4 m s výškou podle profilu kolejí (i na mostech)."""
    if not line:
        return []
    rp = np.array([[x, z, h] for r in rails for (x, z), h in zip(r["p"], r["h"])])
    out = []
    for x, z in densify(line, 4.0):
        if not in_bounds(x, z, -25):
            continue  # vlak nejezdí mimo mapu
        d = (rp[:, 0] - x) ** 2 + (rp[:, 1] - z) ** 2
        out.append([round(x, 1), round(z, 1), round(float(rp[int(np.argmin(d)), 2]), 2)])
    return out


def chain_rails(rails):
    """Najde nejdelší spojitou trať z úseků kolejí (podle sdílených koncových uzlů)."""
    segs = [dict(r) for r in rails]
    best = []
    for start in range(len(segs)):
        used = {start}
        chain = list(segs[start]["p"])
        a, b = segs[start]["ends"]
        grown = True
        while grown:
            grown = False
            for i, sg in enumerate(segs):
                if i in used:
                    continue
                e0, e1 = sg["ends"]
                if e0 == b:
                    chain += sg["p"][1:]; b = e1
                elif e1 == b:
                    chain += sg["p"][::-1][1:]; b = e0
                elif e1 == a:
                    chain = sg["p"][:-1] + chain; a = e0
                elif e0 == a:
                    chain = sg["p"][::-1][:-1] + chain; a = e1
                else:
                    continue
                used.add(i); grown = True
                break
        L = sum(math.hypot(chain[k + 1][0] - chain[k][0], chain[k + 1][1] - chain[k][1]) for k in range(len(chain) - 1))
        if not best or L > best[0]:
            best = [L, chain]
    return best[1] if best else []


def main():
    refresh = "--refresh" in sys.argv
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    terrain, dem, hmin = build_heights(refresh)
    dem = smooth_dem(dem)
    roads, buildings, areas, water, pois, trees, rails, line = build_osm(refresh, dem, hmin)
    dem = carve_water(dem, hmin, water)
    dem = ponds_and_pitches(dem, hmin, areas)
    road_profiles(roads, rails, dem, hmin, water_sampler(water))
    dem = flatten(dem, hmin, roads, buildings, rails)
    fix_bridges(roads, rails, dem, hmin, water_sampler(water))
    # výšky domů a cest podle srovnaného terénu
    for b in buildings:
        ground = [sample_height(dem, hmin, x, z) for x, z in b["p"]]
        b["y"] = round(float(min(ground)), 2)
        b["dy"] = round(float(max(ground) - min(ground)), 2)
    write_heights(dem, hmin)
    print("terén srovnán pod silnicemi a domy")
    out = {
        "name": "Šumice",
        "attribution": "Mapová data © přispěvatelé OpenStreetMap (ODbL), výškopis © ČÚZK (DMR 5G)",
        "origin": {"lat": LAT0, "lon": LON0},
        "size": [round(WIDTH_M, 2), round(HEIGHT_M, 2)],
        "terrain": terrain,
        "roads": roads,
        "buildings": buildings,
        "areas": areas,
        "water": water,
        "pois": pois,
        "trees": trees,
        "rails": rails,
        "ponds": [{"p": a["p"][0], "h": a["h"]} for a in areas if a.get("pond") and "h" in a],
        "pitches": [{"c": a["c"], "sp": a.get("sp"), "su": a.get("su"), "p": a["p"][0]} for a in areas
                    if a["c"] in ("pitch", "playground", "pumptrack") and in_bounds(*centroid(a["p"][0]))],
        "trainLine": train_line(line, rails),
    }
    with open(os.path.join(OUT, "map.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("hotovo:", os.path.getsize(os.path.join(OUT, "map.json")) // 1024, "kB map.json")


if __name__ == "__main__":
    main()
