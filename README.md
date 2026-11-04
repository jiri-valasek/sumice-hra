# Šumice 🚜🏎️

Projížďka po Šumicích (okres Uherské Hradiště) na motokáře, krossce nebo traktoru, v prohlížeči.
Vesnice je postavená ze skutečných mapových dat: silnice, mosty, domy, pole, sady, lesy, potoky, železnice i kopce sedí s realitou. Po trati jezdí vláček a staví na zastávce Šumice.

## Hraní

Stačí otevřít `index.html` přes webový server (nebo GitHub Pages). Nic se neinstaluje.

| Akce | Klávesnice | Tablet / mobil |
|---|---|---|
| Jízda | šipky nebo WASD | ◀ ▶ vlevo, ⏫ ⏬ vpravo |
| Smyk (ruční brzda) | mezerník | – |
| Přesednout (motokára → krosska → traktor) | T | 🔄 |
| Houkačka | H | 📯 |
| Kamera (za vozidlem / zdálky / shora) | C | 🎥 |
| Zpátky na cestu | R | 📍 |
| Celá mapa | N | klepnout na minimapu |
| Zvuk | M | 🔊 |

## Lokální spuštění

```bash
python3 -m http.server 8000
```

Pak otevři http://localhost:8000

## Data

Data ve složce `data/` generuje skript `tools/build_data.py`:

- **OpenStreetMap** (silnice, budovy, plochy, stromy, zajímavá místa) přes API `api.openstreetmap.org`
- **ČÚZK DMR 5G** (výškový model terénu, 5 m mřížka). Terén se jemně zahladí a pod silnicemi a domy srovná (plynulý podélný profil, bez náklonu do stran).

```bash
python3 tools/build_data.py --refresh
```

Výřez mapy (souřadnice) se nastavuje na začátku skriptu.

## Struktura

- `index.html`: stránka, HUD, menu a dotyková tlačítka
- `src/world.js`: terén, malovaný povrch, silnice, budovy, stromy, popisky a kolize
- `src/vehicles.js`: modely vozidel a jízdní fyzika (včetně skoků)
- `src/train.js`: vláček na trati
- `src/input.js`: klávesnice a dotyk
- `src/audio.js`: syntetizovaný zvuk motoru a houkačka
- `src/main.js`: hlavní smyčka, kamera a minimapa

## Licence dat

Mapová data © přispěvatelé [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).
Výškopis © [ČÚZK](https://geoportal.cuzk.cz) (DMR 5G, otevřená data).
