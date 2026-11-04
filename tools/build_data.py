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
    w = int(round(WIDTH_M / DEM_RES)) + 1
    h = int(round(HEIGHT_M / DEM_RES)) + 1
    url = (
        "https://ags.cuzk.cz/arcgis2/rest/services/dmr5g/ImageServer/exportImage"
        f"?bbox={LON_MIN},{LAT_MIN},{LON_MAX},{LAT_MAX}&bboxSR=4326&imageSR=4326"
        f"&size={w},{h}&format=tiff&pixelType=F32"
        "&interpolation=RSP_BilinearInterpolation&f=image"
    )
    path = fetch(url, os.path.join(CACHE, f"dmr5g_{w}x{h}.tif"), refresh)
    a = np.array(Image.open(path), dtype=np.float32)
    assert a.shape == (h, w), a.shape
    hmin = float(np.floor(a.min()))
    q = np.clip(np.round((a - hmin) * 100), 0, 65535).astype("<u2")  # centimetry nad minimem
    with open(os.path.join(OUT, "heights.bin"), "wb") as f:
        f.write(q.tobytes())
    print(f"terén {w}x{h}, {a.min():.1f}–{a.max():.1f} m n. m.")
    return {"w": w, "h": h, "min": hmin, "scale": 0.01, "file": "heights.bin"}, a, hmin


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

    roads, buildings, areas, water_lines, pois, trees = [], [], [], [], [], []
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
            roads.append({"t": hw, "w": width, "s": 1 if paved else 0, "p": p})
            continue

        if "waterway" in t and not closed:
            ww = t["waterway"]
            width = {"river": 7, "stream": 2, "ditch": 1, "drain": 1, "canal": 4}.get(ww, 1.5)
            water_lines.append({"w": width, "p": p})
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
            buildings.append(b)
            cx, cz = centroid(ring)
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
            areas.append({"c": c, "id": int(wid) % 997, "p": [p[:-1]]})
            add_poi(t, *centroid(p[:-1]))
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

    # odstraň stromy na silnicích a v domech (zhruba)
    road_cells = set()
    for r in roads:
        if r["t"] in ("footway", "path", "steps"):
            continue
        p = r["p"]
        for i in range(len(p) - 1):
            (x1, z1), (x2, z2) = p[i], p[i + 1]
            L = math.hypot(x2 - x1, z2 - z1)
            for k in range(int(L // 2) + 1):
                f = k * 2 / L if L else 0
                road_cells.add((int((x1 + (x2 - x1) * f) // 3), int((z1 + (z2 - z1) * f) // 3)))
    trees = [tr for tr in trees if (int(tr[0] // 3), int(tr[1] // 3)) not in road_cells]

    print(f"silnice {len(roads)}, budovy {len(buildings)}, plochy {len(areas)}, "
          f"vodní toky {len(water_lines)}, stromy {len(trees)} (les {forest_trees}), místa {len(pois)}")
    return roads, buildings, areas, water_lines, pois, trees


def main():
    refresh = "--refresh" in sys.argv
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    terrain, dem, hmin = build_heights(refresh)
    roads, buildings, areas, water, pois, trees = build_osm(refresh, dem, hmin)
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
    }
    with open(os.path.join(OUT, "map.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("hotovo:", os.path.getsize(os.path.join(OUT, "map.json")) // 1024, "kB map.json")


if __name__ == "__main__":
    main()
