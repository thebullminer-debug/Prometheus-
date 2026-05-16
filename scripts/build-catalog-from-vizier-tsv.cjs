/**
 * Build data/catalog-stars.json from a VizieR Hipparcos TSV export.
 *
 * 1) Download (or refresh) vendor/hip_bright_full.tsv:
 *    (example) https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=I/239/hip_main&-out.max=20000&-out=HIP,_RAJ2000,_DEJ2000,Vmag,Plx,B-V&Vmag=0..12
 *
 * 2) Optional: vendor/hip_constellation_supplement.tsv — extra Hipparcos rows for HIPs missing from the bulk export
 *    (see repo file; keeps every vertex in data/constellations.json on the sky).
 *
 * 3) Run: node scripts/build-catalog-from-vizier-tsv.cjs
 *    (Pulls required HIPs from data/constellations.json so every stick-figure star is present.)
 *
 * Must match space.js: AU_TO_UNITS, REAL_STAR_DISTANCE_SCALE
 * Positions are ICRS equatorial (Z = celestial north). space.js maps them into the ecliptic scene frame
 * (same as planetary keplerPosition: XZ = ecliptic, Y = ecliptic north).
 */
const fs = require('fs');
const path = require('path');

/** Every HIP that appears in data/constellations.json is forced into the catalog so lines meet real points. */
function loadRequiredConstellationHipSet(rootDir) {
  const p = path.join(rootDir, 'data', 'constellations.json');
  if (!fs.existsSync(p)) return new Set();
  try {
    const list = JSON.parse(fs.readFileSync(p, 'utf8'));
    const set = new Set();
    for (const c of list) {
      for (const seg of c.segments || []) {
        if (Array.isArray(seg) && seg.length >= 2) {
          set.add(seg[0]);
          set.add(seg[1]);
        }
      }
    }
    return set;
  } catch {
    return new Set();
  }
}

const AU_TO_UNITS = 45;
// Distance compression factor.
// Lower values exaggerate nearby-star parallax inside the solar system,
// which makes constellations look distorted when you move near Earth.
// Keep this large enough that nearby-star parallax stays small in-game.
const REAL_STAR_DISTANCE_SCALE = 0.05;
const AU_PER_PARSEC = 206264.806;
/** Stars with bad/missing parallax sit on this sphere (scene units) — matches old sky star shell */
const CELESTIAL_SHELL_UNITS = 3950;

// Common names by Hipparcos ID (extend in this file when you add more)
const HIP_NAME = {
  746: 'Caph',
  1067: 'Alpheratz',
  3179: 'Schedar',
  4427: 'Navi',
  5447: 'Mirach',
  6077: 'Aldebaran',
  7588: 'Achernar',
  14576: 'Hamal',
  17702: 'Hatysa',
  26727: 'Alnitak',
  21421: 'Alcyone',
  24436: 'Rigel',
  24608: 'Capella',
  25336: 'Bellatrix',
  25930: 'Mintaka',
  26311: 'Alnilam',
  27366: 'Saiph',
  27989: 'Betelgeuse',
  26207: 'Meissa',
  28716: 'Chi2 Ori',
  30324: 'Castor',
  30438: 'Canopus',
  32349: 'Sirius',
  34444: 'Pollux',
  36850: 'Castor B',
  37279: 'Procyon',
  37826: 'Regulus',
  39953: 'Algieba',
  49669: 'Spica',
  59803: 'Acrux',
  60718: 'Acrux B',
  62434: 'Mimosa',
  65474: 'Antares',
  68702: 'Hadar',
  69673: 'Arcturus',
  70890: 'Proxima Centauri',
  71681: 'Alpha Centauri B',
  71683: 'Alpha Centauri',
  72607: 'Kochab',
  46390: 'Alphard',
  80763: 'Adhara',
  86228: 'Rasalhague',
  90496: 'Gienah',
  91262: 'Vega',
  92855: 'Gienah B',
  95947: 'Albireo',
  97649: 'Altair',
  100453: 'Sadr',
  102098: 'Deneb',
  102488: 'Delta Cyg',
  104019: 'Gacrux',
  113368: 'Fomalhaut',
  11767: 'Polaris',
};

function raDecToUnitXYZ(raDeg, decDeg) {
  const raRad = (raDeg * Math.PI) / 180;
  const decRad = (decDeg * Math.PI) / 180;
  const c = Math.cos(decRad);
  return { x: c * Math.cos(raRad), y: c * Math.sin(raRad), z: Math.sin(decRad) };
}

function sceneScaleFromParsecs(pc) {
  return pc * AU_PER_PARSEC * AU_TO_UNITS * REAL_STAR_DISTANCE_SCALE;
}

function bvToRgb(bv) {
  if (bv == null || Number.isNaN(bv)) return [0.95, 0.95, 1.0];
  const t = Math.max(-0.4, Math.min(2.0, bv));
  let r, g, b;
  if (t < 0.0) {
    r = 0.7 + 0.3 * (t + 0.4) / 0.4;
    g = 0.85;
    b = 1.0;
  } else if (t < 0.4) {
    r = 0.9 + 0.1 * (t / 0.4);
    g = 0.9 + 0.05 * (t / 0.4);
    b = 1.0;
  } else if (t < 1.0) {
    r = 1.0;
    g = 0.95 - 0.1 * ((t - 0.4) / 0.6);
    b = 0.85 - 0.35 * ((t - 0.4) / 0.6);
  } else {
    r = 1.0;
    g = 0.75 - 0.45 * Math.min(1, (t - 1.0));
    b = 0.35 - 0.2 * Math.min(1, (t - 1.0));
  }
  return [r, g, b];
}

function parseTsv(filePath, needHip = new Set()) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const stars = [];
  let headerFound = false;
  const col = { hip: 0, ra: 1, de: 2, vmag: 3, plx: 4, bv: 5 };

  for (const line of lines) {
    if (line.startsWith('#')) continue;
    if (!line.trim()) continue;
    const parts = line.split('\t').map((s) => s.trim());
    if (parts[0] === 'HIP' && parts[1] && parts[1].includes('RA')) {
      headerFound = true;
      continue;
    }
    if (parts[0] === '------') continue;
    if (!headerFound && parts[0] !== 'HIP') continue;
    if (!/^\d+$/.test(parts[0])) continue;

    const hip = parseInt(parts[0], 10);
    const ra = parseFloat(parts[col.ra]);
    const de = parseFloat(parts[col.de]);
    const vmag = parseFloat(parts[col.vmag]);
    const plx = parseFloat(parts[col.plx]);
    const bvStr = parts[col.bv];
    const bv = bvStr === '' || bvStr === '—' ? null : parseFloat(bvStr);

    if (!Number.isFinite(ra) || !Number.isFinite(de) || !Number.isFinite(vmag)) continue;

    let pc = null;
    // Plx is trigonometric parallax in mas. pc = 1000 / plx(mas).
    if (Number.isFinite(plx) && plx > 0.2 && plx < 5000) {
      pc = 1000 / plx;
    } else if (needHip.has(hip) && Number.isFinite(plx) && plx > 0 && plx < 5000) {
      // Fainter constellation members: accept smaller positive parallax (noisier Hipparcos values).
      pc = 1000 / Math.max(plx, 0.12);
    } else if (needHip.has(hip)) {
      // Still emit the star so lines meet a point; distance is a rough fallback when plx is missing/bad.
      pc = 200;
    }

    const u = raDecToUnitXYZ(ra, de);
    let x, y, z;
    const name = HIP_NAME[hip];
    // True 3D placement at compressed parallax distance (REAL_STAR_DISTANCE_SCALE).
    if (pc == null) continue;
    const s = sceneScaleFromParsecs(pc);
    x = u.x * s;
    y = u.y * s;
    z = u.z * s;

    const [r, g, b] = bvToRgb(bv);
    const entry = {
      hip,
      ra,
      de,
      mag: vmag,
      bv: bv ?? 0,
      pc: pc ?? null,
      x,
      y,
      z,
      r,
      g,
      b,
    };
    if (name) entry.n = name;
    entry.distLy = pc * 3.2615637771674336;
    stars.push(entry);
  }

  return stars;
}

const root = path.join(__dirname, '..');
const input = path.join(root, 'vendor', 'hip_bright_full.tsv');
const supplementPath = path.join(root, 'vendor', 'hip_constellation_supplement.tsv');
const outPath = path.join(root, 'data', 'catalog-stars.json');
const requiredConstellationHips = loadRequiredConstellationHipSet(root);

if (!fs.existsSync(input)) {
  console.error('Missing', input);
  console.error('Download VizieR TSV (see script header) into vendor/hip_bright_full.tsv');
  process.exit(1);
}

const mainStars = parseTsv(input, requiredConstellationHips);
const extraStars = fs.existsSync(supplementPath)
  ? parseTsv(supplementPath, requiredConstellationHips)
  : [];
const byHip = new Map();
for (const s of mainStars) byHip.set(s.hip, s);
for (const s of extraStars) {
  if (!byHip.has(s.hip)) byHip.set(s.hip, s);
}
const stars = Array.from(byHip.values()).sort((a, b) => a.hip - b.hip);

const missing = [...requiredConstellationHips].filter((h) => !byHip.has(h));
if (missing.length) {
  console.warn('WARNING: constellation HIPs still missing from catalog:', missing.join(', '));
}
if (extraStars.length) {
  console.log('Merged', extraStars.length, 'supplement row(s); unique stars:', stars.length);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const payload = {
  version: 1,
  source: 'VizieR I/239/hip_main (Hipparcos), Vmag ≤ 12',
  generated: new Date().toISOString(),
  count: stars.length,
  celestialShellUnits: CELESTIAL_SHELL_UNITS,
  stars,
};
fs.writeFileSync(outPath, JSON.stringify(payload), 'utf8');
console.log('Wrote', outPath, 'stars:', stars.length);
