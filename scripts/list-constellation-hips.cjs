/**
 * List every Hipparcos ID used in data/constellations.json for ADQL / VizieR queries.
 *
 *   node scripts/list-constellation-hips.cjs
 *   node scripts/list-constellation-hips.cjs --sql   (single-line IN (...) for pasting)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const p = path.join(root, 'data', 'constellations.json');

function loadHipSet() {
  const set = new Set();
  if (!fs.existsSync(p)) {
    console.error('Missing', p);
    process.exit(1);
  }
  const list = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const c of list) {
    for (const seg of c.segments || []) {
      if (Array.isArray(seg) && seg.length >= 2) {
        set.add(seg[0]);
        set.add(seg[1]);
      }
    }
  }
  return set;
}

const hips = [...loadHipSet()].sort((a, b) => a - b);
console.log('Constellation HIP count:', hips.length);
console.log('HIPs:', hips.join(', '));
console.log('');

if (process.argv.includes('--sql')) {
  const inner = hips.join(', ');
  console.log('WHERE h.hip IN (' + inner + ')');
} else {
  console.log('Tip: node scripts/list-constellation-hips.cjs --sql');
  console.log('See docs/gaia-coordinates.md for Gaia ADQL.');
}
