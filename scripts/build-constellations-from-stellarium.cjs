/**
 * Polyline HIP lists from Stellarium skycultures/modern_st/index.json (S&T / modern stick figures).
 * Source: https://github.com/Stellarium/stellarium — same topology as Stellarium Web.
 *
 * Run: node scripts/build-constellations-from-stellarium.cjs
 */
const fs = require('fs');
const path = require('path');

/** Stellarium "lines" arrays: each inner array is one polyline (consecutive HIPs connected). */
const STELLARIUM = {
  Orion: [
    [27989, 26727, 27366, 26727, 26311, 25930, 25336, 25930, 25281, 24436],
    [27989, 25336, 26207, 27989],
    [23607, 22957, 22845, 22509, 22449, 25336, 22449, 22549, 22797, 23123],
    [27989, 28614, 29038],
    [29426, 28716, 27913, 29038],
  ],
  'Big Dipper (Ursa Major)': [
    [58001, 57399, 54539, 50801, 50372, 50801, 54539, 57399, 55219, 55203],
    [59774, 54061, 53910, 58001, 59774, 62956, 65378, 67301],
    [54061, 46733, 48319, 46733, 41704, 48319, 53910, 48319, 46853, 44471, 44127],
  ],
  'Ursa Minor (Little Dipper)': [[11767, 85822, 82080, 77055, 79822, 75097, 72607, 77055]],
  'Cygnus (Northern Cross)': [
    [
      102098, 100453, 102488, 100453, 95947, 100453, 97165, 95853, 94779, 95853, 99848, 102098, 103413,
      104732, 102488,
    ],
  ],
  'Cassiopeia (W)': [[746, 3179, 4427, 6686, 8886]],
};

const COLORS = {
  Orion: 65280,
  'Big Dipper (Ursa Major)': 16755200,
  'Ursa Minor (Little Dipper)': 65535,
  'Cygnus (Northern Cross)': 42240,
  'Cassiopeia (W)': 16711680,
};

function polylinesToUniqueSegments(polylines) {
  const segments = [];
  const seen = new Set();
  for (const pl of polylines) {
    for (let i = 0; i < pl.length - 1; i++) {
      const a = pl[i];
      const b = pl[i + 1];
      if (a === b) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      segments.push([a, b]);
    }
  }
  return segments;
}

const out = [];
for (const name of Object.keys(STELLARIUM)) {
  out.push({
    name,
    color: COLORS[name],
    segments: polylinesToUniqueSegments(STELLARIUM[name]),
  });
}

const outPath = path.join(__dirname, '..', 'data', 'constellations.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('Wrote', outPath, 'constellations:', out.length);
