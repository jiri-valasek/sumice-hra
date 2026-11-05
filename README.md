# Šumice 🚜🏎️

Projížďka po Šumicích (okres Uherské Hradiště) na motokáře, krossce nebo traktoru, v prohlížeči.
Vesnice je postavená ze skutečných mapových dat: silnice, mosty, domy, pole, sady, lesy, potoky, železnice i kopce sedí s realitou. Po trati jezdí vláček a staví na zastávce Šumice. Po silnicích jezdí auta, po chodnících chodí lidé, u rybníků sedí rybáři a jsou tu hřiště (fotbal, tenis, dětské hřiště, pumptrack).

## Hraní

Stačí otevřít `index.html` přes webový server (nebo GitHub Pages). Nic se neinstaluje.

| Akce | Klávesnice | Tablet / mobil |
|---|---|---|
| Jízda / chůze | šipky nebo WASD (Shift = běh) | ◀ ▶ vlevo, ⏫ ⏬ vpravo |
| Vystoupit / nastoupit | F nebo pravé tlačítko myši | 🚶 |
| Akce (vzít pilu, kácet, zvednout a položit poleno) | E nebo levé tlačítko myši | ✋ |
| Rozhlížení | myš (klikni do hry) | tažení prstem |
| Smyk (ruční brzda) | mezerník | – |
| Přesednout (motokára → krosska → traktor) | T | 🔄 |
| Houkačka | H | 📯 |
| Kamera (za vozidlem / zdálky / shora) | C | 🎥 |
| Zpátky na cestu | R | 📍 |
| Celá mapa | N | klepnout na minimapu |
| Zvuk | M | 🔊 |

## Práce na louce a v lese

Nad obecními rybníky jsou louky a les. Na louce stojí **traktor se sekačkou**: nasedni a poseč louku (ukazuje se, kolik procent je hotovo, na konci jsou balíky sena). V lese leží na pařezu **motorová pila**: vezmi ji, pokácej stromy, polena odnes na **hromadu dřeva**. Zóny se nastavují v `tools/build_data.py` (`MEADOW_ZONE`, `FOREST_ZONE`).

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
- `src/vehicles.js`: modely vozidel a jízdní fyzika
- `src/train.js`: vláček na trati
- `src/player.js`: chůze pěšky
- `src/activities.js`: kosení louky a kácení v lese
- `src/traffic.js`: auta a chodci (graf silnic a chodníků z OSM)
- `src/input.js`: klávesnice a dotyk
- `src/audio.js`: syntetizovaný zvuk motoru a houkačka
- `src/main.js`: hlavní smyčka, kamera a minimapa

## Dominanty obce

Kostel, obecní úřad, základní škola, mateřská škola, válcový mlýn a Hasoňova chalupa jsou vymodelované podle virtuální prohlídky na [sumice.cz](https://www.sumice.cz/) (fotky se do hry nevkládají, slouží jen jako předloha). Nastavení je v `LANDMARKS` v `tools/build_data.py` a `STYLE` v `src/world.js`.

## Licence dat

Mapová data © přispěvatelé [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).
Výškopis © [ČÚZK](https://geoportal.cuzk.cz) (DMR 5G, otevřená data).
