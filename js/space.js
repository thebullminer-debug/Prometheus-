import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
// --- Scene, camera, renderer ---
const canvas = document.getElementById('canvas');

// Debug overlay for runtime errors (helps when the canvas goes fully black).
const debugOverlay = document.createElement('div');
debugOverlay.style.position = 'fixed';
debugOverlay.style.top = '0';
debugOverlay.style.left = '0';
debugOverlay.style.zIndex = '9999';
debugOverlay.style.padding = '8px 10px';
debugOverlay.style.fontFamily = 'system-ui, sans-serif';
debugOverlay.style.fontSize = '12px';
debugOverlay.style.lineHeight = '1.25';
debugOverlay.style.color = 'rgba(255,255,255,0.95)';
debugOverlay.style.background = 'rgba(0,0,0,0.7)';
debugOverlay.style.maxWidth = '70vw';
debugOverlay.style.whiteSpace = 'pre-wrap';
debugOverlay.style.pointerEvents = 'none';
document.body.appendChild(debugOverlay);
function showDebug(msg) {
  debugOverlay.textContent = String(msg ?? '');
}
window.addEventListener('error', (ev) => {
  showDebug(`Error: ${ev.message}\n${ev.filename}:${ev.lineno}:${ev.colno}`);
});
window.addEventListener('unhandledrejection', (ev) => {
  showDebug(`Unhandled promise rejection: ${String(ev.reason)}`);
});

const scene = new THREE.Scene();
// Stars / constellations use catalog positions ~1e7–1e8 units; far must exceed that or nothing draws.
const STARFIELD_CAMERA_FAR = 2e9;
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, STARFIELD_CAMERA_FAR);
// Start near Earth's orbit (1 AU = 45): view from ~1.1 AU so Sun and inner planets fit in view
camera.position.set(0, 20, 55);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// --- Selective bloom: only the sun glows (no glow on stars/planets) ---
const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
const storedMaterials = {};

function darkenNonBloom(obj) {
  if ((obj.isMesh || obj.isPoints) && obj.material && !obj.layers.isEnabled(1)) {
    storedMaterials[obj.uuid] = obj.material;
    obj.material = darkMaterial;
  }
}

function restoreMaterials(obj) {
  if (storedMaterials[obj.uuid]) {
    obj.material = storedMaterials[obj.uuid];
    delete storedMaterials[obj.uuid];
  }
}

// --- Milky Way constants: 60° to ecliptic, soft falloff, one hemisphere ---
const mwRadius = 2700;
const bandWidthRad = 0.22;
const mwThetaStart = Math.PI * 0.35;
const mwThetaEnd = Math.PI * 1.65;
const galacticCenterTheta = Math.PI * 0.95;
const MW_SIGMA_RAD = 0.32;
function mwFalloff(angularDistFromPlane) {
  return Math.exp(-(angularDistFromPlane * angularDistFromPlane) / (2 * MW_SIGMA_RAD * MW_SIGMA_RAD));
}
const GALACTIC_TILT_RAD = (30 * Math.PI) / 180;
const cosTilt = Math.cos(-GALACTIC_TILT_RAD);
const sinTilt = Math.sin(-GALACTIC_TILT_RAD);
function tiltGalacticPlane(x, y, z) {
  return { x, y: y * cosTilt - z * sinTilt, z: y * sinTilt + z * cosTilt };
}
// Milky Way glow orientation (keep as-is).
const SKY_Y_RAD = 2.82;
const cosSkyY = Math.cos(SKY_Y_RAD);
const sinSkyY = Math.sin(SKY_Y_RAD);
function rotateSkyY(x, y, z) {
  return { x: x * cosSkyY + z * sinSkyY, y, z: -x * sinSkyY + z * cosSkyY };
}
// Star cluster only: extra 90° so cluster orientation matches target (second screenshot), glow unchanged
const STAR_BAND_Y_RAD = SKY_Y_RAD + Math.PI / 2;
const cosStarBandY = Math.cos(STAR_BAND_Y_RAD);
const sinStarBandY = Math.sin(STAR_BAND_Y_RAD);
function rotateSkyYStarBand(x, y, z) {
  return { x: x * cosStarBandY + z * sinStarBandY, y, z: -x * sinStarBandY + z * cosStarBandY };
}

// --- Milky Way as space coloring (sky dome): soft band, 60° to ecliptic ---
const invCosSkyY = Math.cos(-SKY_Y_RAD);
const invSinSkyY = Math.sin(-SKY_Y_RAD);
const invCosTilt = Math.cos(GALACTIC_TILT_RAD);
const invSinTilt = Math.sin(GALACTIC_TILT_RAD);
const skyDomeGeom = new THREE.SphereGeometry(4200, 64, 40, 0, Math.PI * 2, 0, Math.PI);
const skyDomeMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    uSigma: { value: 0.32 },
    uBandBright: { value: new THREE.Color(0.22, 0.20, 0.28) },
    uBandWarm: { value: new THREE.Color(0.16, 0.12, 0.11) },
    uDark: { value: new THREE.Color(0.012, 0.009, 0.015) },
    invCosSkyY: { value: invCosSkyY },
    invSinSkyY: { value: invSinSkyY },
    invCosTilt: { value: invCosTilt },
    invSinTilt: { value: invSinTilt },
  },
  vertexShader: `
    varying vec3 vWorldPosition;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorldPosition = w.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uSigma;
    uniform vec3 uBandBright;
    uniform vec3 uBandWarm;
    uniform vec3 uDark;
    uniform float invCosSkyY;
    uniform float invSinSkyY;
    uniform float invCosTilt;
    uniform float invSinTilt;
    varying vec3 vWorldPosition;
    void main() {
      vec3 dir = normalize(vWorldPosition - cameraPosition);
      float x = dir.x, y = dir.y, z = dir.z;
      float invX = x * invCosSkyY - z * invSinSkyY;
      float invZ = x * invSinSkyY + z * invCosSkyY;
      float gy = y * invCosTilt + invZ * invSinTilt;
      float gz = -y * invSinTilt + invZ * invCosTilt;
      float gx = invX;
      float r = length(vec3(gx, gy, gz));
      float phi = acos(clamp(gz / r, -1.0, 1.0));
      float distFromPlane = abs(phi - 1.5707963267948966);
      float band = exp(-(distFromPlane * distFromPlane) / (2.0 * uSigma * uSigma));
      float dust = 0.5 + 0.5 * sin(gx * 4.0 + gy * 3.0) * band;
      vec3 bandColor = mix(uBandWarm, uBandBright, dust);
      vec3 col = mix(uDark, bandColor, band);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const skyDome = new THREE.Mesh(skyDomeGeom, skyDomeMat);
scene.add(skyDome);

// Star field: catalog RA/Dec + parallax (no drawn constellation lines — natural asterisms from brightness/color).

// --- Real stars: Hipparcos catalog (see data/catalog-stars.json, build script in scripts/) ---
const realStars = [];
const realStarPickSpheres = [];
// Put stars + constellation lines under a single group so we can rotate the sky over time.
const catalogStarsGroup = new THREE.Group();
scene.add(catalogStarsGroup);
let starsTravelDropdown = null;
/** @type {THREE.Points | null} */
let catalogStarPoints = null;
/** HIP → row index in the point cloud (for highlighting constellation members). */
let catalogHipToPointIndex = new Map();
/** Snapshot of default point sizes; restored when constellations are cleared. */
let catalogStarSizeNormBase = null;
/** World-space star positions (copy at load); GPU buffer holds (world - camera) each frame for float precision. */
let catalogStarWorldPositions = null;
/** Immutable parallax-based world positions (scene units). Figure mode overwrites working buffer for selected asterism only. */
let catalogStarWorldParallax = null;
/** HIP → unit direction from ICRS RA/Dec (matches planetarium sky geometry from the Sun). */
let catalogHipUnitDirScene = new Map();
/** Point-cloud row → HIP, or -1. */
let catalogPointHipByIndex = null;
let suppressedCatalogStarHip = null;
/** HIPs in the active Stellarium stick figure; placed on a common Sun-centered sphere for correct angles. */
let activeConstellationFigureHips = new Set();
let constellationFigureShellRadius = 0;
const _sunWorldFigure = new THREE.Vector3();
const _figureUnitScratch = new THREE.Vector3();
const _lastFloatingOriginCam = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);

/** Stars sit at ~1e6 scene units; float32 modelView math shakes when the camera is close. Subtract camera in JS (float64), parent group at camera. */
const FLOAT_ORIGIN_EPS_SQ = 1e-14;

/**
 * Catalog star mesh / pick position: normally `catalogWorld` (may sit on constellation shell).
 * While that star is selected, use true parallax so close-up disk + glow stay with the camera target.
 */
function getCatalogStarAnchorWorld(mesh) {
  const pw = mesh.userData.catalogWorldParallax;
  const cw = mesh.userData.catalogWorld;
  if (selectedStar === mesh && pw) return pw;
  return cw || pw;
}

function syncCatalogStarsFloatingOrigin() {
  if (!catalogStarWorldPositions || !catalogStarPoints) return;
  const cam = camera.position;
  if (!Number.isNaN(_lastFloatingOriginCam.x)
    && _lastFloatingOriginCam.distanceToSquared(cam) < FLOAT_ORIGIN_EPS_SQ) {
    return;
  }
  _lastFloatingOriginCam.copy(cam);

  const world = catalogStarWorldPositions;
  const posAttr = catalogStarPoints.geometry.attributes.position;
  const out = posAttr.array;
  const cx = cam.x;
  const cy = cam.y;
  const cz = cam.z;
  for (let i = 0; i < world.length; i += 3) {
    out[i] = world[i] - cx;
    out[i + 1] = world[i + 1] - cy;
    out[i + 2] = world[i + 2] - cz;
  }
  posAttr.needsUpdate = true;
  catalogStarsGroup.position.copy(cam);

  for (let r = 0; r < realStars.length; r++) {
    const mesh = realStars[r];
    const w = getCatalogStarAnchorWorld(mesh);
    if (!w) continue;
    mesh.position.set(w.x - cx, w.y - cy, w.z - cz);
  }
  for (let p = 0; p < realStarPickSpheres.length; p++) {
    const pm = realStarPickSpheres[p];
    const rs = pm.userData.realStar;
    const w = rs ? getCatalogStarAnchorWorld(rs) : pm.userData.catalogWorld;
    if (!w) continue;
    pm.position.set(w.x - cx, w.y - cy, w.z - cz);
  }
}

/** Point-sprite size on screen (Hipparcos V mag): bright stars (e.g. Sirius ~-1.5, Polaris ~2) read larger than mag ~6. */
function magnitudeToPointSizeNorm(mag) {
  const t = (6.9 - mag) * 0.44;
  return Math.min(1.58, Math.max(0.11, t));
}

/** HIPs in Orion (data/constellations.json) — close-up = Sun-style disk + glow, scaled by real stellar radius. */
const ORION_FIGURE_HIPS = new Set([
  27989, 26727, 27366, 26311, 25930, 25336, 25281, 24436, 26207,
  23607, 22957, 22845, 22509, 22449, 22549, 22797, 23123,
  28614, 29038, 29426, 28716, 27913,
]);
const ORION_STAR_SOLAR_RADII = new Map([
  [27989, 700], [24436, 79], [26311, 28], [26727, 19], [25930, 16.5], [27366, 14],
  [25336, 5.75], [26207, 5.5], [25281, 3.3], [22449, 8.2], [22509, 4.5], [22549, 9],
  [22797, 5.5], [22845, 6], [22957, 7], [23123, 5.5], [23607, 4.5],
  [27913, 5], [28614, 5], [28716, 5.5], [29038, 5], [29426, 5.5],
]);
const ORION_MAX_SCENE_SCALE = 140;
const ORION_MIN_DISK_HALF_ANGLE_RAD = 0.012;

function estimateSolarRadiiFromCatalog(s) {
  if (Number.isFinite(s.hip) && ORION_STAR_SOLAR_RADII.has(s.hip)) {
    return ORION_STAR_SOLAR_RADII.get(s.hip);
  }
  const mag = Number.isFinite(s.mag) ? s.mag : 5;
  const bv = Number.isFinite(s.bv) ? s.bv : 0.6;
  let r = 1 + 0.15 * Math.max(0, 4 - mag) + 0.12 * Math.max(0, bv - 0.2);
  return THREE.MathUtils.clamp(r, 0.35, 35);
}

/**
 * catalog-stars.json positions are ICRS equatorial Cartesian (RA/Dec): +Z = celestial north, XY = equator.
 * Planets use J2000 ecliptic in the XZ plane with +Y = ecliptic north (see keplerPosition).
 * Map equatorial → ecliptic (rotation about X by obliquity ε), then ecliptic (X,Y,Z) → Three (X, Z, -Y)
 * so ecliptic north matches +Y — same frame as planetary orbits.
 */
const J2000_OBLIQUITY_RAD = (23.4392911 * Math.PI) / 180;
const _catalogFrameScratch = new THREE.Vector3();

function hipparcosCatalogXYZToSceneStarXYZ(xEq, yEq, zEq, target = _catalogFrameScratch) {
  const co = Math.cos(J2000_OBLIQUITY_RAD);
  const so = Math.sin(J2000_OBLIQUITY_RAD);
  const xE = xEq;
  const yE = co * yEq + so * zEq;
  const zE = -so * yEq + co * zEq;
  return target.set(xE, zE, -yE);
}

/** ICRS RA/Dec (deg) → unit direction in the same ecliptic-aligned scene frame as planets (J2000, heliocentric-style). */
const _icrsUnitScratch = new THREE.Vector3();
function icrsRaDegDecDegToSceneUnit(raDeg, deDeg, target = _icrsUnitScratch) {
  const raRad = (raDeg * Math.PI) / 180;
  const deRad = (deDeg * Math.PI) / 180;
  const c = Math.cos(deRad);
  const xEq = c * Math.cos(raRad);
  const yEq = c * Math.sin(raRad);
  const zEq = Math.sin(deRad);
  hipparcosCatalogXYZToSceneStarXYZ(xEq, yEq, zEq, target);
  return target.normalize();
}

function restoreCatalogStarPointSize() {
  if (suppressedCatalogStarHip == null || !catalogStarPoints || !catalogStarSizeNormBase) return;
  const idx = catalogHipToPointIndex.get(suppressedCatalogStarHip);
  if (idx != null && idx >= 0) {
    const arr = catalogStarPoints.geometry.attributes.sizeNorm.array;
    arr[idx] = catalogStarSizeNormBase[idx];
    catalogStarPoints.geometry.attributes.sizeNorm.needsUpdate = true;
  }
  suppressedCatalogStarHip = null;
}

function suppressCatalogStarPoint(hip) {
  if (!catalogStarPoints || !catalogStarSizeNormBase) return;
  const idx = catalogHipToPointIndex.get(hip);
  if (idx != null && idx >= 0) {
    catalogStarPoints.geometry.attributes.sizeNorm.array[idx] = 0;
    catalogStarPoints.geometry.attributes.sizeNorm.needsUpdate = true;
    suppressedCatalogStarHip = hip;
  }
}

function loadCatalogStars() {
  fetch('data/catalog-stars.json?v=14')
    .then((res) => {
      if (!res.ok) throw new Error(`catalog-stars.json ${res.status}`);
      return res.json();
    })
    .then((catalog) => {
      const stars = catalog.stars;
      // Render ALL catalog stars as small point-sprites.
      // Named stars will also get click/label helpers, but visually they'll match the rest.
      const pointRows = [];
      const hipPosMap = new Map(); // hip id -> THREE.Vector3 (scene frame; used for constellations)
      const vFrame = new THREE.Vector3();
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        pointRows.push(s);
        if (Number.isFinite(s.hip)) {
          hipparcosCatalogXYZToSceneStarXYZ(s.x, s.y, s.z, vFrame);
          hipPosMap.set(s.hip, vFrame.clone());
        }
      }
      const nPts = pointRows.length;
      const pos = new Float32Array(nPts * 3);
      const col = new Float32Array(nPts * 3);
      const sizeN = new Float32Array(nPts);
      /** Distance Sun→star in scene units (catalog parallax); used for inverse-square vs camera distance. */
      const refDistArr = new Float32Array(nPts);
      /** Hipparcos V magnitude (apparent from ~Earth). */
      const magVArr = new Float32Array(nPts);
      catalogHipUnitDirScene = new Map();
      catalogPointHipByIndex = new Int32Array(nPts);
      catalogPointHipByIndex.fill(-1);
      for (let j = 0; j < nPts; j++) {
        const s = pointRows[j];
        hipparcosCatalogXYZToSceneStarXYZ(s.x, s.y, s.z, vFrame);
        pos[j * 3] = vFrame.x;
        pos[j * 3 + 1] = vFrame.y;
        pos[j * 3 + 2] = vFrame.z;
        col[j * 3] = s.r;
        col[j * 3 + 1] = s.g;
        col[j * 3 + 2] = s.b;
        sizeN[j] = magnitudeToPointSizeNorm(s.mag);
        refDistArr[j] = Math.hypot(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
        magVArr[j] = Number.isFinite(s.mag) ? s.mag : 7.0;
        if (Number.isFinite(s.hip)) {
          catalogPointHipByIndex[j] = s.hip;
          if (!catalogHipUnitDirScene.has(s.hip) && Number.isFinite(s.ra) && Number.isFinite(s.de)) {
            icrsRaDegDecDegToSceneUnit(s.ra, s.de, vFrame);
            catalogHipUnitDirScene.set(s.hip, vFrame.clone());
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('starColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('sizeNorm', new THREE.BufferAttribute(sizeN, 1));
      geo.setAttribute('refDist', new THREE.BufferAttribute(refDistArr, 1));
      geo.setAttribute('magV', new THREE.BufferAttribute(magVArr, 1));
      const vShader = `
        attribute vec3 starColor;
        attribute float sizeNorm;
        attribute float refDist;
        attribute float magV;
        uniform float uStarPointFluxScale;
        varying vec3 vCol;
        varying float vSizeNorm;
        varying float vBrightness;
        void main() {
          vCol = mix(vec3(1.0), starColor, 0.45);
          vSizeNorm = sizeNorm;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float dCam = max(length(mvPosition.xyz), 1.0);
          float px = 26000.0 * sizeNorm / dCam;
          gl_PointSize = clamp(px, 1.2, 9.0);
          /* Flux vs m=5 reference: 10^(-0.4*(m-5)) so m=5 → 1, Sirius-like m~-1 → ~40× */
          float fluxEarth = exp(-0.921034037197271 * (magV - 5.0));
          float rSafe = max(dCam, refDist * 0.035);
          float invSq = (refDist / rSafe) * (refDist / rSafe);
          invSq = clamp(invSq, 0.06, 520.0);
          vBrightness = fluxEarth * invSq * uStarPointFluxScale;
          vBrightness = clamp(vBrightness, 0.05, 95.0);
        }
      `;
      const fShader = `
        varying vec3 vCol;
        varying float vSizeNorm;
        varying float vBrightness;
        void main() {
          vec2 q = gl_PointCoord - vec2(0.5);
          float r = length(q) * 2.0;
          if (r > 1.0) discard;
          float edge = 1.0 - smoothstep(0.86, 1.0, r);
          float faintBoost = mix(1.35, 1.0, smoothstep(0.15, 1.5, vSizeNorm));
          gl_FragColor = vec4(vCol * edge * faintBoost * vBrightness, edge);
        }
      `;
      const mat = new THREE.ShaderMaterial({
        uniforms: { uStarPointFluxScale: { value: 2.85 } },
        vertexShader: vShader,
        fragmentShader: fShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      catalogStarsGroup.add(pts);
      catalogStarPoints = pts;
      catalogStarWorldParallax = new Float32Array(pos);
      catalogStarWorldPositions = new Float32Array(pos);
      _lastFloatingOriginCam.set(Number.NaN, Number.NaN, Number.NaN);
      constellationHipToPos = hipPosMap;
      catalogHipToPointIndex = new Map();
      for (let j = 0; j < nPts; j++) {
        const s = pointRows[j];
        if (Number.isFinite(s.hip)) catalogHipToPointIndex.set(s.hip, j);
      }
      catalogStarSizeNormBase = new Float32Array(sizeN);

      const LY_TO_AU = 63241.077;
      const MILES_PER_AU_STAR = 92.955807e6;
      stars.forEach((s) => {
        const hasName = !!s.n;
        if (!hasName && !ORION_FIGURE_HIPS.has(s.hip)) return;
        const displayName = hasName ? s.n : `HIP ${s.hip} (Orion)`;
        const distLy = s.distLy;
        const distAU = distLy != null ? distLy * LY_TO_AU : null;
        const distMiles = distAU != null ? distAU * MILES_PER_AU_STAR : null;
        // Named stars: keep a tiny invisible anchor for click/zoom behavior.
        // Visual appearance is handled by the point cloud shader above.
        const mag = Number.isFinite(s.mag) ? s.mag : 8;
        const brightT = Math.max(0, Math.min(1, (6.5 - mag) / 6.5)); // V=6.5 -> 1, V~13 -> 0
        const radiusUnits = 0.05 + 0.10 * brightT; // tiny, never “big star blobs”
        const geom = new THREE.SphereGeometry(radiusUnits, 8, 8);
        const meshMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(s.r, s.g, s.b),
          transparent: true,
          opacity: 0.0,
          depthWrite: false,
          depthTest: false,
        });
        const mesh = new THREE.Mesh(geom, meshMat);
        hipparcosCatalogXYZToSceneStarXYZ(s.x, s.y, s.z, vFrame);
        mesh.position.set(vFrame.x, vFrame.y, vFrame.z);
        const catalogDistScene = Math.hypot(vFrame.x, vFrame.y, vFrame.z);
        mesh.userData = {
          name: displayName,
          hip: s.hip,
          distLy,
          distAU,
          distMiles,
          mag,
          /** Scene units: |Sun→star|; inverse-square brightness uses this vs camera distance. */
          catalogDistScene,
          catalogWorld: { x: vFrame.x, y: vFrame.y, z: vFrame.z },
          catalogWorldParallax: { x: vFrame.x, y: vFrame.y, z: vFrame.z },
        };
        catalogStarsGroup.add(mesh);
        realStars.push(mesh);

        const pickRadius = Math.max(10, Math.hypot(vFrame.x, vFrame.y, vFrame.z) * 0.035);
        const pickGeom = new THREE.SphereGeometry(pickRadius, 12, 12);
        const pickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
        const pickMesh = new THREE.Mesh(pickGeom, pickMat);
        pickMesh.position.set(vFrame.x, vFrame.y, vFrame.z);
        pickMesh.userData.catalogWorld = mesh.userData.catalogWorld;
        pickMesh.userData.catalogWorldParallax = mesh.userData.catalogWorldParallax;
        pickMesh.userData.realStar = mesh;
        pickMesh.layers.set(0);
        catalogStarsGroup.add(pickMesh);
        realStarPickSpheres.push(pickMesh);

        const labelEl = document.createElement('div');
        let distText = '';
        if (distMiles != null) {
          distText = distMiles >= 1e12
            ? `${(distMiles / 1e12).toFixed(2)} trillion mi`
            : `${(distMiles / 1e6).toFixed(1)} million mi`;
        } else {
          distText = 'distance uncertain';
        }
        const lyText = distLy != null ? `${distLy.toFixed(2)} ly` : 'unknown ly';
        labelEl.textContent = `${displayName} (${lyText}, ${distText})`;
        labelEl.style.color = 'rgba(255,255,255,0.95)';
        labelEl.style.fontFamily = 'system-ui, sans-serif';
        labelEl.style.fontSize = '11px';
        labelEl.style.whiteSpace = 'nowrap';
        labelEl.style.textShadow = '0 0 4px #000, 0 1px 3px #000';
        labelEl.style.pointerEvents = 'none';
        const labelObj = new CSS2DObject(labelEl);
        labelObj.position.set(0, radiusUnits * 1.5, 0);
        mesh.add(labelObj);
        mesh.userData.labelEl = labelEl;

        const tintCol = new THREE.Color(s.r, s.g, s.b);
        const kit = createSunLikeStarVisuals(tintCol);
        mesh.add(kit.group);
        mesh.userData.sunLikeBuild = kit;
        mesh.userData.solarRadii = estimateSolarRadiiFromCatalog(s);
      });

      if (starsTravelDropdown) {
        starsTravelDropdown.innerHTML = '';
        realStars.forEach((starMesh) => {
          const link = document.createElement('a');
          link.href = '#';
          link.textContent = starMesh.userData.name;
          link.style.display = 'block';
          link.style.padding = '0.15rem 0';
          link.style.color = 'rgba(255,255,255,0.9)';
          link.style.textDecoration = 'none';
          link.style.cursor = 'pointer';
          link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            enterStarView(starMesh);
          });
          link.addEventListener('mouseenter', () => { link.style.background = 'rgba(60,60,80,0.6)'; });
          link.addEventListener('mouseleave', () => { link.style.background = 'transparent'; });
          starsTravelDropdown.appendChild(link);
        });
      }
      populateDistanceReferenceSelect();

      applySkyNamesVisibility();

      // After all catalogStarsGroup children exist (lines render on top via renderOrder).
      updateConstellationLines();

      // Optional Gaia / high-precision ICRS (deg) for stick-figure directions — see data/constellation-gaia-dr3.json
      fetch('data/constellation-gaia-dr3.json?v=1')
        .then((r) => (r.ok ? r.json() : null))
        .then((pack) => {
          if (!pack || !pack.hips || typeof pack.hips !== 'object') return;
          for (const [key, v] of Object.entries(pack.hips)) {
            const hip = parseInt(key, 10);
            const deDeg = v != null && v.dec != null ? v.dec : v != null ? v.de : null;
            if (!Number.isFinite(hip) || !v || !Number.isFinite(v.ra) || !Number.isFinite(deDeg)) continue;
            icrsRaDegDecDegToSceneUnit(v.ra, deDeg, vFrame);
            catalogHipUnitDirScene.set(hip, vFrame.clone());
          }
          updateConstellationLines();
        })
        .catch(() => {});
    })
    .catch((err) => {
      console.error('Failed to load star catalog:', err);
    });
}

// --- Sun: limb darkening, rim/core, real solar colors (as before the square-sun changes) ---
const sunGeometry = new THREE.SphereGeometry(4, 128, 128);
/** Denser mesh for catalog star close-ups (same radius as Sun) — smoother silhouette when zoomed. */
const starCloseUpSphereGeom = new THREE.SphereGeometry(4, 220, 220);
const sunSphereVert = `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vModelPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vModelPos = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;
const sunSphereFrag = `
  uniform vec3 uCoreColor;
  uniform vec3 uLimbColor;
  uniform vec3 uRimColor;
  uniform float uCoreIntensity;
  uniform float uRimIntensity;
  uniform float uLimbDarken1;
  uniform float uLimbDarken2;
  uniform float uRimPower;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vModelPos;
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float mu = ndv;
    // Quadratic limb darkening: I(mu)/I(1) = 1 - u1*(1-mu) - u2*(1-mu)^2 (realistic sun falloff)
    float oneMinusMu = 1.0 - mu;
    float limbDarken = 1.0 - uLimbDarken1 * oneMinusMu - uLimbDarken2 * oneMinusMu * oneMinusMu;
    limbDarken = max(0.0, limbDarken);
    // Core = hot white-yellow, limb = cooler orange (chromosphere-like edge)
    vec3 diskColor = mix(uLimbColor, uCoreColor, smoothstep(0.0, 0.5, mu));
    float rim = pow(1.0 - ndv, uRimPower);
    vec3 colCore = diskColor * (uCoreIntensity * limbDarken);
    vec3 colRim = uRimColor * (uRimIntensity * rim);
    vec3 col = colCore + colRim;
    float n = noise(vModelPos.xy * 8.0) * 0.5 + noise(vModelPos.xz * 11.0) * 0.5;
    col += (n - 0.5) * 0.03;
    gl_FragColor = vec4(col, 1.0);
  }
`;
/** Same physics as Sun disk, but finer granulation + optional edge softening — avoids “minecraft” blocks on smaller stars. */
const sunSphereFragStarCloseUp = `
  uniform vec3 uCoreColor;
  uniform vec3 uLimbColor;
  uniform vec3 uRimColor;
  uniform float uCoreIntensity;
  uniform float uRimIntensity;
  uniform float uLimbDarken1;
  uniform float uLimbDarken2;
  uniform float uRimPower;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vModelPos;
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float mu = ndv;
    float oneMinusMu = 1.0 - mu;
    float limbDarken = 1.0 - uLimbDarken1 * oneMinusMu - uLimbDarken2 * oneMinusMu * oneMinusMu;
    limbDarken = max(0.0, limbDarken);
    vec3 diskColor = mix(uLimbColor, uCoreColor, smoothstep(0.0, 0.5, mu));
    float rim = pow(1.0 - ndv, uRimPower);
    vec3 colCore = diskColor * (uCoreIntensity * limbDarken);
    vec3 colRim = uRimColor * (uRimIntensity * rim);
    vec3 col = colCore + colRim;
    float n1 = noise(vModelPos.xy * 42.0) * 0.5 + noise(vModelPos.xz * 58.0) * 0.5;
    float n2 = noise(vModelPos.xy * 19.0 + 3.0) * 0.5 + noise(vModelPos.xz * 23.0 - 1.0) * 0.5;
    float n = mix(n1, n2, 0.35);
    col += (n - 0.5) * 0.0065;
    col *= mix(0.9, 1.0, smoothstep(0.0, 0.11, mu));
    gl_FragColor = vec4(col, 1.0);
  }
`;
const sunMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uCoreColor: { value: new THREE.Color(1.0, 1.0, 1.0) },
    uLimbColor: { value: new THREE.Color(1.0, 0.92, 0.82) },
    uRimColor: { value: new THREE.Color(1.0, 0.95, 0.9) },
    uCoreIntensity: { value: 22.0 },
    uRimIntensity: { value: 0.6 },
    uLimbDarken1: { value: 0.32 },
    uLimbDarken2: { value: 0.2 },
    uRimPower: { value: 2.2 },
  },
  vertexShader: sunSphereVert,
  fragmentShader: sunSphereFrag,
  transparent: false,
  depthWrite: true,
  depthTest: true,
});
sunMaterial.toneMapped = false;
const solarSystemGroup = new THREE.Group();
scene.add(solarSystemGroup);
solarSystemGroup.position.set(0, 0, 0);

// Soft radial halo around the sun — additive so it actually glows; big scale so it's visible
const sunGlowGeom = new THREE.CircleGeometry(1, 64);
const sunGlowMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthTest: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uIntensity: { value: 0.65 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uIntensity;
    varying vec2 vUv;
    void main() {
      float d = length(vUv - 0.5) * 2.0;
      // Sharper falloff from center so glow is a distinct halo, not a soft sun edge
      float falloff = 1.0 - smoothstep(0.28, 0.82, d);
      float a = falloff * uIntensity;
      vec3 innerColor = vec3(1.0, 0.62, 0.28);
      vec3 outerColor = vec3(1.0, 0.94, 0.88);
      vec3 col = mix(outerColor, innerColor, 1.0 - smoothstep(0.0, 0.4, d));
      gl_FragColor = vec4(col, a);
    }
  `,
});
sunGlowMat.toneMapped = false;
const sunGlow = new THREE.Mesh(sunGlowGeom, sunGlowMat);
sunGlow.position.set(0, 0, 0);
sunGlow.renderOrder = -1;
solarSystemGroup.add(sunGlow);

// Outer soft glow (Space Engine–style wider luminous field)
const sunGlowOuterGeom = new THREE.CircleGeometry(1, 64);
const sunGlowOuterMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthTest: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  uniforms: { uIntensity: { value: 0.4 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform float uIntensity;
    varying vec2 vUv;
    void main() {
      float d = length(vUv - 0.5) * 2.0;
      float a = (1.0 - smoothstep(0.35, 0.92, d)) * uIntensity;
      gl_FragColor = vec4(1.0, 0.96, 0.88, a);
    }
  `,
});
sunGlowOuterMat.toneMapped = false;
const sunGlowOuter = new THREE.Mesh(sunGlowOuterGeom, sunGlowOuterMat);
sunGlowOuter.position.set(0, 0, 0);
sunGlowOuter.renderOrder = -2;
solarSystemGroup.add(sunGlowOuter);

// Starburst: tapered rays — wider at sun, very thin at tips. No even circle; many subtle, few long/bright.
const burstSize = 1024;
const burstCanvas = document.createElement('canvas');
burstCanvas.width = burstSize;
burstCanvas.height = burstSize;
const bc = burstSize / 2;
const bctx = burstCanvas.getContext('2d');
bctx.fillStyle = 'rgba(0,0,0,0)';
bctx.fillRect(0, 0, burstSize, burstSize);
const numRays = 64;
for (let i = 0; i < numRays; i++) {
  const angle = (i / numRays) * Math.PI * 2;
  const r = Math.random();
  let lenBase, baseW, tipW, opacityScale;
  if (r < 0.4) {
    lenBase = 0.18 + Math.random() * 0.32;
    baseW = 1.2 + Math.random() * 1.8;
    tipW = 0.15 + Math.random() * 0.35;
    opacityScale = 0.35 + Math.random() * 0.22;
  } else if (r < 0.72) {
    lenBase = 0.42 + Math.random() * 0.38;
    baseW = 2.8 + Math.random() * 2.8;
    tipW = 0.25 + Math.random() * 0.55;
    opacityScale = 0.6 + Math.random() * 0.3;
  } else {
    lenBase = 0.82 + Math.random() * 0.18;
    baseW = 6 + Math.random() * 5;
    tipW = 0.35 + Math.random() * 0.6;
    opacityScale = 0.92 + Math.random() * 0.08;
  }
  const len = bc * lenBase;
  const g = bctx.createLinearGradient(0, 0, 0, len);
  const o = (v) => Math.min(1, v * opacityScale);
  g.addColorStop(0, `rgba(255,252,246,${o(0.98)})`);
  g.addColorStop(0.05, `rgba(255,250,242,${o(0.94)})`);
  g.addColorStop(0.18, `rgba(255,248,238,${o(0.72)})`);
  g.addColorStop(0.38, `rgba(248,246,252,${o(0.4)})`);
  g.addColorStop(0.58, `rgba(238,242,255,${o(0.16)})`);
  g.addColorStop(0.82, `rgba(228,232,248,${o(0.04)})`);
  g.addColorStop(1, 'rgba(218,222,240,0)');
  bctx.save();
  bctx.translate(bc, bc);
  bctx.rotate(angle);
  bctx.beginPath();
  bctx.moveTo(-baseW / 2, 0);
  bctx.lineTo(baseW / 2, 0);
  bctx.lineTo(tipW / 2, len);
  bctx.lineTo(-tipW / 2, len);
  bctx.closePath();
  bctx.fillStyle = g;
  bctx.fill();
  bctx.restore();
}
for (let i = 0; i < numRays; i++) {
  const r = Math.random();
  if (r > 0.35) continue;
  const angle = (i / numRays) * Math.PI * 2;
  const len = bc * (0.9 + Math.random() * 0.1);
  const baseSpine = 2.4 + Math.random() * 1.4;
  const tipSpine = 0.15 + Math.random() * 0.3;
  const g = bctx.createLinearGradient(0, 0, 0, len);
  g.addColorStop(0, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.2, 'rgba(255,252,250,0.65)');
  g.addColorStop(0.5, 'rgba(250,250,255,0.2)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  bctx.save();
  bctx.translate(bc, bc);
  bctx.rotate(angle);
  bctx.beginPath();
  bctx.moveTo(-baseSpine / 2, 0);
  bctx.lineTo(baseSpine / 2, 0);
  bctx.lineTo(tipSpine / 2, len);
  bctx.lineTo(-tipSpine / 2, len);
  bctx.closePath();
  bctx.fillStyle = g;
  bctx.fill();
  bctx.restore();
}
const burstTexture = new THREE.CanvasTexture(burstCanvas);
burstTexture.needsUpdate = true;
const starburstGeom = new THREE.CircleGeometry(1, 64);
const starburstMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthTest: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uMap: { value: burstTexture },
    uOpacity: { value: 0.85 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D uMap;
    uniform float uOpacity;
    varying vec2 vUv;
    void main() {
      float d = length(vUv - 0.5) * 2.0;
      if (d > 0.998) discard;
      vec4 t = texture2D(uMap, vUv);
      float edgeFade = 1.0 - smoothstep(0.94, 0.998, d);
      gl_FragColor = vec4(t.rgb, t.a * uOpacity * edgeFade);
    }
  `,
});
starburstMat.toneMapped = false;
const sunStarburst = new THREE.Mesh(starburstGeom, starburstMat);
sunStarburst.position.set(0, 0, 0);
sunStarburst.renderOrder = 0;
sunStarburst.visible = false;
starburstMat.uniforms.uOpacity.value = 0;
solarSystemGroup.add(sunStarburst);

// Lens flare streak (Space Engine–style: strong horizontal beam + ghost circles)
const lensFlareGeom = new THREE.PlaneGeometry(1, 1);
const lensFlareMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthTest: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  uniforms: { uIntensity: { value: 0.0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform float uIntensity;
    varying vec2 vUv;
    void main() {
      float x = abs(vUv.x - 0.5) * 2.0;
      float streak = (1.0 - smoothstep(0.0, 0.95, x)) * uIntensity;
      float brighterCenter = 1.0 - 0.25 * x;
      vec3 col = vec3(0.88, 0.92, 1.0);
      float a = streak * brighterCenter;
      float ghost1 = 0.0;
      float dx1 = vUv.x - 0.32;
      float dy1 = vUv.y - 0.5;
      ghost1 = (1.0 - smoothstep(0.0, 0.08, sqrt(dx1*dx1 + dy1*dy1))) * 0.45 * uIntensity;
      float ghost2 = 0.0;
      float dx2 = vUv.x - 0.18;
      float dy2 = vUv.y - 0.5;
      ghost2 = (1.0 - smoothstep(0.0, 0.05, sqrt(dx2*dx2 + dy2*dy2))) * 0.32 * uIntensity;
      float ghost3 = 0.0;
      float dx3 = vUv.x - 0.08;
      float dy3 = vUv.y - 0.48;
      ghost3 = (1.0 - smoothstep(0.0, 0.04, sqrt(dx3*dx3 + dy3*dy3))) * 0.22 * uIntensity;
      a += ghost1 + ghost2 + ghost3;
      vec3 ghostCol = vec3(0.8, 0.88, 1.0);
      col = mix(col, ghostCol, min(1.0, (ghost1 + ghost2 + ghost3) / max(a, 0.001)));
      gl_FragColor = vec4(col, a);
    }
  `,
});
lensFlareMat.toneMapped = false;
const sunLensFlare = new THREE.Mesh(lensFlareGeom, lensFlareMat);
sunLensFlare.position.set(0, 0, 0);
sunLensFlare.scale.set(55, 0.55, 1);
sunLensFlare.renderOrder = 1;
sunLensFlare.visible = false;
lensFlareMat.uniforms.uIntensity.value = 0;
solarSystemGroup.add(sunLensFlare);

const sun = new THREE.Mesh(sunGeometry, sunMaterial);
sun.position.set(0, 0, 0);
sun.layers.set(0);
sun.layers.enable(1);
sun.userData = { name: 'Sun', removed: false, surfaceTempK: 5778 };
solarSystemGroup.add(sun);

function createSunLikeStarVisuals(tint) {
  const diskMat = sunMaterial.clone();
  diskMat.fragmentShader = sunSphereFragStarCloseUp;
  diskMat.needsUpdate = true;
  const core = tint.clone().lerp(new THREE.Color(1, 1, 1), 0.12);
  const limb = tint.clone().multiplyScalar(0.9);
  const rim = core.clone().lerp(new THREE.Color(1, 0.93, 0.85), 0.4);
  diskMat.uniforms.uCoreColor.value.copy(core);
  diskMat.uniforms.uLimbColor.value.copy(limb);
  diskMat.uniforms.uRimColor.value.copy(rim);
  diskMat.uniforms.uLimbDarken1.value = 0.28;
  diskMat.uniforms.uLimbDarken2.value = 0.17;
  diskMat.uniforms.uRimPower.value = 2.05;
  const disk = new THREE.Mesh(starCloseUpSphereGeom, diskMat);
  disk.layers.set(0);
  disk.layers.enable(1);
  disk.frustumCulled = false;

  const glowMat = sunGlowMat.clone();
  const outerMat = sunGlowOuterMat.clone();
  const glow = new THREE.Mesh(sunGlowGeom, glowMat);
  const outer = new THREE.Mesh(sunGlowOuterGeom, outerMat);
  glow.renderOrder = -1;
  outer.renderOrder = -2;
  glow.frustumCulled = false;
  outer.frustumCulled = false;
  [glowMat, outerMat].forEach((m) => {
    m.polygonOffset = true;
    m.polygonOffsetFactor = 1;
    m.polygonOffsetUnits = 1;
  });
  disk.renderOrder = 1;
  diskMat.polygonOffset = true;
  diskMat.polygonOffsetFactor = -1;
  diskMat.polygonOffsetUnits = -1;
  // Supergiant disks can subtend >90° at min zoom; FrontSide would cull from inside → “empty” core.
  diskMat.side = THREE.DoubleSide;

  const group = new THREE.Group();
  group.add(outer);
  group.add(glow);
  group.add(disk);
  group.visible = false;
  return { group, disk, glow, outer, diskMat, glowMat, outerMat };
}

/** Unit direction for figure placement: ICRS RA/Dec first, else parallax position (fallback). */
function getFigureUnitDir(hip) {
  const fromRa = catalogHipUnitDirScene.get(hip);
  if (fromRa) return fromRa;
  const p = constellationHipToPos.get(hip);
  if (!p) return null;
  return _figureUnitScratch.copy(p).normalize();
}

/**
 * Stellarium-style asterism: active figure stars sit on one Sun-centered sphere using ICRS directions.
 * Parallax depth is ignored for those HIPs so angles match [planetarium sky] from the solar system barycenter.
 * Travel / camera follow still use catalogWorldParallax (true distances).
 */
function applyConstellationFigureShellToWorldPositions() {
  if (!catalogStarWorldPositions || !catalogStarWorldParallax || !catalogPointHipByIndex) return;
  const n = catalogStarWorldPositions.length / 3;
  if (!constellationEnabled || activeConstellationFigureHips.size === 0) {
    catalogStarWorldPositions.set(catalogStarWorldParallax);
    for (let r = 0; r < realStars.length; r++) {
      const m = realStars[r];
      const pw = m.userData.catalogWorldParallax;
      const cw = m.userData.catalogWorld;
      if (pw && cw) {
        cw.x = pw.x;
        cw.y = pw.y;
        cw.z = pw.z;
      }
    }
    for (let p = 0; p < realStarPickSpheres.length; p++) {
      const pm = realStarPickSpheres[p];
      const pw = pm.userData.catalogWorldParallax;
      const cw = pm.userData.catalogWorld;
      if (pw && cw) {
        cw.x = pw.x;
        cw.y = pw.y;
        cw.z = pw.z;
      }
    }
    _lastFloatingOriginCam.set(Number.NaN, Number.NaN, Number.NaN);
    return;
  }
  sun.getWorldPosition(_sunWorldFigure);
  const R = constellationFigureShellRadius;
  const sx = _sunWorldFigure.x;
  const sy = _sunWorldFigure.y;
  const sz = _sunWorldFigure.z;
  for (let j = 0; j < n; j++) {
    const hip = catalogPointHipByIndex[j];
    const o = j * 3;
    if (hip >= 0 && activeConstellationFigureHips.has(hip)) {
      const u = getFigureUnitDir(hip);
      if (u) {
        catalogStarWorldPositions[o] = sx + R * u.x;
        catalogStarWorldPositions[o + 1] = sy + R * u.y;
        catalogStarWorldPositions[o + 2] = sz + R * u.z;
      } else {
        catalogStarWorldPositions[o] = catalogStarWorldParallax[o];
        catalogStarWorldPositions[o + 1] = catalogStarWorldParallax[o + 1];
        catalogStarWorldPositions[o + 2] = catalogStarWorldParallax[o + 2];
      }
    } else {
      catalogStarWorldPositions[o] = catalogStarWorldParallax[o];
      catalogStarWorldPositions[o + 1] = catalogStarWorldParallax[o + 1];
      catalogStarWorldPositions[o + 2] = catalogStarWorldParallax[o + 2];
    }
  }
  for (let r = 0; r < realStars.length; r++) {
    const m = realStars[r];
    const hip = m.userData.hip;
    const cw = m.userData.catalogWorld;
    const pw = m.userData.catalogWorldParallax;
    if (!cw || !pw) continue;
    if (activeConstellationFigureHips.has(hip)) {
      const u = getFigureUnitDir(hip);
      if (u) {
        cw.x = sx + R * u.x;
        cw.y = sy + R * u.y;
        cw.z = sz + R * u.z;
      } else {
        cw.x = pw.x;
        cw.y = pw.y;
        cw.z = pw.z;
      }
    } else {
      cw.x = pw.x;
      cw.y = pw.y;
      cw.z = pw.z;
    }
  }
  for (let p = 0; p < realStarPickSpheres.length; p++) {
    const pm = realStarPickSpheres[p];
    const m = pm.userData.realStar;
    if (!m) continue;
    pm.userData.catalogWorld.x = m.userData.catalogWorld.x;
    pm.userData.catalogWorld.y = m.userData.catalogWorld.y;
    pm.userData.catalogWorld.z = m.userData.catalogWorld.z;
  }
  _lastFloatingOriginCam.set(Number.NaN, Number.NaN, Number.NaN);
}

const sunPos = new THREE.Vector3(0, 0, 0);
const camToSun = new THREE.Vector3();
const camFwd = new THREE.Vector3();
/** Not in scene — used to build a stable world rotation for star glow billboards (avoids lookAt gimbal → thin rects). */
const _starBillboardHelper = new THREE.Object3D();
const _starGlowParentQ = new THREE.Quaternion();

// --- Solar system: real size ratios, compressed distances
// Sun/Earth size ratio is real (Sun ≈ 109× Earth radius). Distances are compressed so the
// system fits on screen: 1 AU = 45 units here; true scale would be 1 AU ≈ 860 units.
const SUN_RADIUS_KM = 695_700;
const SUN_RADIUS_SCENE = 4; // sun sphere is 4 units (scaled down when close so it stays coin-sized)
const AU_TO_UNITS = 45;    // 1 AU in scene (Earth orbit radius); true scale would be ~860
const REAL_SUN_ANGULAR_RADIUS_RAD = SUN_RADIUS_KM / 149.6e6; // ~0.00465 rad (~0.27°) from 1 AU
/**
 * Scene radius of the star disk at camera distance d — MUST match the selectedStar block in animate()
 * (min angular size floor + θ cap + starScale clamp).
 */
function starCloseUpSceneDiskRadius(d, Rsov) {
  const angleRad = Math.min(REAL_SUN_ANGULAR_RADIUS_RAD * Rsov, 1.12);
  let maxDiskR = d * Math.tan(angleRad);
  maxDiskR = Math.max(maxDiskR, d * Math.tan(ORION_MIN_DISK_HALF_ANGLE_RAD));
  const sc = THREE.MathUtils.clamp(maxDiskR / SUN_RADIUS_SCENE, 0.06, ORION_MAX_SCENE_SCALE);
  return SUN_RADIUS_SCENE * sc;
}

/**
 * Star close-up orbit distances: giant stars use a huge scene disk (up to ORION_MAX_SCENE_SCALE * SUN_RADIUS_SCENE).
 * minDistance must scale with that or the camera sits inside the bright sphere (white screen).
 * We solve for the smallest d with d >= k * R_disk(d), matching the same starScale law as the render loop.
 */
function computeStarCloseUpOrbitLimits(Rsov) {
  const kOutside = 2.5;
  const radDisk = (d) => starCloseUpSceneDiskRadius(d, Rsov);
  let lo = 0.25;
  let hi = SUN_RADIUS_SCENE * ORION_MAX_SCENE_SCALE * (kOutside + 4);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) * 0.5;
    if (mid >= kOutside * radDisk(mid)) hi = mid;
    else lo = mid;
  }
  const minDistance = Math.max(6, hi);
  // Default arrival: far enough to see disk + halo (Sun-like “from a distance”), scales up for supergiants
  const endDistance = THREE.MathUtils.clamp(minDistance * 4.0, 85, minDistance * 14);
  const maxDistance = Math.max(200_000, endDistance * 18);
  return { minDistance, endDistance, maxDistance };
}
// 1 Earth orbit = 1 real year
const SECONDS_PER_EARTH_YEAR = 365.25 * 24 * 60 * 60;

// Sun luminosity (W). Used for temperature and habitable zone. Sun ≈ 3.828e26 W.
const SUN_LUMINOSITY_W = 3.828e26;
// Stefan-Boltzmann constant (W m^-2 K^-4)
const STEFAN_BOLTZMANN = 5.670374419e-8;
// Earth's orbital radius in m (1 AU)
const AU_M = 1.496e11;

// Solve Kepler's equation M = E - e*sin(E) for E (eccentric anomaly)
function solveKepler(M, e) {
  let E = M;
  for (let i = 0; i < 15; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-10) break;
  }
  return E;
}

// Position from orbital elements (ecliptic XZ, Y up). Ω and ω in radians.
function keplerPosition(aAU, e, incRad, meanAnomaly, AU_TO_UNITS, lonAscNodeRad, argPeriRad) {
  const E = solveKepler(meanAnomaly, e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const rAU = aAU * (1 - e * Math.cos(E));
  const r = rAU * AU_TO_UNITS;
  const nup = nu + (argPeriRad != null ? argPeriRad : 0);
  const cosNup = Math.cos(nup);
  const sinNup = Math.sin(nup);
  const cosI = Math.cos(incRad);
  const sinI = Math.sin(incRad);
  const O = lonAscNodeRad != null ? lonAscNodeRad : 0;
  const cosO = Math.cos(O);
  const sinO = Math.sin(O);
  return {
    x: r * (cosNup * cosO - sinNup * cosI * sinO),
    y: r * sinNup * sinI,
    z: r * (cosNup * sinO + sinNup * cosI * cosO),
  };
}

// Orbital elements: JPL mean ecliptic J2000 (1800–2050). inclinationDeg, longitudeAscendingNodeDeg (Ω), argumentPerihelionDeg (ω), eccentricity. Axial tilt = obliquity.
const planetData = [
  { name: 'Mercury', au: 0.38709927, periodYears: 0.241, radiusKm: 2_439.7, massKg: 3.285e23, albedo: 0.088, color: 0x8c7853, texture: '2k_mercury.jpg', axialTiltDeg: 0.034, inclinationDeg: 7.00498, longitudeAscendingNodeDeg: 48.33077, argumentPerihelionDeg: 29.127, eccentricity: 0.205636 },
  { name: 'Venus', au: 0.72333566, periodYears: 0.615, radiusKm: 6_051.8, massKg: 4.867e24, albedo: 0.77, color: 0xe6c229, texture: '2k_venus_surface.jpg', axialTiltDeg: 177.36, inclinationDeg: 3.39468, longitudeAscendingNodeDeg: 76.67984, argumentPerihelionDeg: 54.923, eccentricity: 0.006777 },
  { name: 'Earth', au: 1.00000261, periodYears: 1.0, radiusKm: 6_371, massKg: 5.972e24, albedo: 0.306, color: 0x2244aa, texture: '2k_earth_daymap.jpg', nightTexture: '2k_earth_nightmap.jpg', axialTiltDeg: 23.439, inclinationDeg: 0, longitudeAscendingNodeDeg: 0, argumentPerihelionDeg: 102.938, eccentricity: 0.016711 },
  { name: 'Mars', au: 1.52371034, periodYears: 1.88, radiusKm: 3_389.5, massKg: 6.417e23, albedo: 0.25, color: 0xc1440e, texture: '2k_mars.jpg', axialTiltDeg: 25.19, inclinationDeg: 1.84969, longitudeAscendingNodeDeg: 49.55954, argumentPerihelionDeg: 286.502, eccentricity: 0.093394 },
  { name: 'Jupiter', au: 5.202887, periodYears: 11.86, radiusKm: 69_911, massKg: 1.898e27, albedo: 0.503, color: 0xc88b2a, texture: '2k_jupiter.jpg', axialTiltDeg: 3.13, inclinationDeg: 1.30440, longitudeAscendingNodeDeg: 100.47391, argumentPerihelionDeg: 274.254, eccentricity: 0.048386 },
  { name: 'Saturn', au: 9.53667594, periodYears: 29.42, radiusKm: 58_232, massKg: 5.683e26, albedo: 0.342, color: 0xe8d5a8, texture: '2k_saturn.jpg', ringTexture: '2k_saturn_ring_alpha.png', axialTiltDeg: 26.73, inclinationDeg: 2.48599, longitudeAscendingNodeDeg: 113.66242, argumentPerihelionDeg: 338.937, eccentricity: 0.053862 },
  { name: 'Uranus', au: 19.18916464, periodYears: 83.75, radiusKm: 25_362, massKg: 8.681e25, albedo: 0.3, color: 0x4fd0e2, texture: '2k_uranus.jpg', axialTiltDeg: 97.77, inclinationDeg: 0.77264, longitudeAscendingNodeDeg: 74.01693, argumentPerihelionDeg: 96.937, eccentricity: 0.047257 },
  { name: 'Neptune', au: 30.06992276, periodYears: 163.72, radiusKm: 24_622, massKg: 1.024e26, albedo: 0.29, color: 0x4166f5, texture: '2k_neptune.jpg', axialTiltDeg: 28.32, inclinationDeg: 1.77004, longitudeAscendingNodeDeg: 131.78423, argumentPerihelionDeg: 273.181, eccentricity: 0.008590 },
];

// Major moons: orbitKm (semi-major axis), periodDays (orbital period), radiusKm, color (fallback), texture (optional)
const moonsData = {
  Earth: [
    { name: 'Moon', orbitKm: 384_400, periodDays: 27.322, radiusKm: 1_737.4, color: 0xa89e94, texture: '2k_moon.jpg', normalMap: '2k_moon_normal.jpg' },
  ],
  Mars: [
    { name: 'Phobos', orbitKm: 9_376, periodDays: 0.319, radiusKm: 22.5, color: 0x6b5d52, texture: '2k_phobos.jpg' },
    { name: 'Deimos', orbitKm: 23_460, periodDays: 1.263, radiusKm: 12.4, color: 0x5c5349, texture: '2k_deimos.jpg' },
  ],
  Jupiter: [
    { name: 'Io', orbitKm: 421_700, periodDays: 1.769, radiusKm: 1_821.6, color: 0xd4a574, texture: '2k_io.jpg' },
    { name: 'Europa', orbitKm: 671_100, periodDays: 3.551, radiusKm: 1_560.8, color: 0xc4b9a0, texture: '2k_europa.jpg' },
    { name: 'Ganymede', orbitKm: 1_070_400, periodDays: 7.155, radiusKm: 2_634.1, color: 0x8b7355, texture: '2k_ganymede.jpg' },
    { name: 'Callisto', orbitKm: 1_882_700, periodDays: 16.689, radiusKm: 2_410.3, color: 0x4a4a4a, texture: '2k_callisto.jpg' },
  ],
  Saturn: [
    { name: 'Mimas', orbitKm: 185_540, periodDays: 0.942, radiusKm: 198.2, color: 0x9a9a8a, texture: '2k_mimas.jpg' },
    { name: 'Enceladus', orbitKm: 237_950, periodDays: 1.370, radiusKm: 252.1, color: 0xdddddd, texture: '2k_enceladus.jpg' },
    { name: 'Tethys', orbitKm: 294_670, periodDays: 1.888, radiusKm: 533, color: 0xaaa090, texture: '2k_tethys.jpg' },
    { name: 'Dione', orbitKm: 377_420, periodDays: 2.737, radiusKm: 561.7, color: 0xbbb5a5, texture: '2k_dione.jpg' },
    { name: 'Rhea', orbitKm: 527_108, periodDays: 4.518, radiusKm: 763.8, color: 0x9a9585, texture: '2k_rhea.jpg' },
    { name: 'Titan', orbitKm: 1_221_870, periodDays: 15.945, radiusKm: 2_574.7, color: 0xc4a35a, texture: '2k_titan.jpg' },
    { name: 'Iapetus', orbitKm: 3_560_820, periodDays: 79.321, radiusKm: 734.5, color: 0x5a5a52, texture: '2k_iapetus.jpg' },
  ],
  Uranus: [
    { name: 'Miranda', orbitKm: 129_390, periodDays: 1.413, radiusKm: 235.8, color: 0xa09080, texture: '2k_miranda.jpg' },
    { name: 'Ariel', orbitKm: 190_900, periodDays: 2.520, radiusKm: 578.9, color: 0x9a9a8a, texture: '2k_ariel.jpg' },
    { name: 'Umbriel', orbitKm: 266_000, periodDays: 4.144, radiusKm: 584.7, color: 0x4a4a4a, texture: '2k_umbriel.jpg' },
    { name: 'Titania', orbitKm: 435_910, periodDays: 8.706, radiusKm: 788.9, color: 0x8a7a6a, texture: '2k_titania.jpg' },
    { name: 'Oberon', orbitKm: 583_520, periodDays: 13.463, radiusKm: 761.4, color: 0x5a5a52, texture: '2k_oberon.jpg' },
  ],
  Neptune: [
    { name: 'Triton', orbitKm: 354_759, periodDays: 5.877, radiusKm: 1_353.4, color: 0x9a9a8a, texture: '2k_triton.jpg' },
    { name: 'Proteus', orbitKm: 117_647, periodDays: 1.122, radiusKm: 210, color: 0x4a4a4a, texture: '2k_proteus.jpg' },
  ],
};

const textureLoader = new THREE.TextureLoader();
const TEXTURE_BASE = 'textures/';

const planets = [];
const planetOrbitLines = [];
const moons = [];

/** Planet, moon (when parent focused), and named star CSS2D labels */
let skyNamesVisible = true;
function applySkyNamesVisibility() {
  const show = skyNamesVisible ? 'visible' : 'hidden';
  planets.forEach((p) => {
    const el = p.userData?.labelEl;
    if (el) el.style.visibility = show;
  });
  realStars.forEach((m) => {
    const el = m.userData?.labelEl;
    if (el) el.style.visibility = show;
  });
  moons.forEach((moon) => {
    const el = moon.userData?.labelEl;
    if (!el) return;
    const selOk = selectedPlanet === moon.userData.parentPlanet || selectedMoon === moon;
    el.style.visibility = skyNamesVisible && selOk ? 'visible' : 'hidden';
  });
}
const css2DRenderer = new CSS2DRenderer();
css2DRenderer.setSize(window.innerWidth, window.innerHeight);
css2DRenderer.domElement.style.position = 'absolute';
css2DRenderer.domElement.style.top = '0';
css2DRenderer.domElement.style.left = '0';
css2DRenderer.domElement.style.pointerEvents = 'none';
css2DRenderer.domElement.style.zIndex = '10';
document.body.appendChild(css2DRenderer.domElement);

let selectedPlanet = null;
let selectedMoon = null;
let selectedStar = null;
let constellationHipToPos = new Map(); // hip id -> THREE.Vector3
let constellationDefs = null;
let constellationLines = null;
let constellationEnabled = false;
const RENDER_CONSTELLATION_LINES = false;
let constellationUiLoaded = false;
let constellationSelectEl = null;
/** Line segment endpoints in world space (rebuilt when selection changes; Sun-centered figure shell). */
let constellationLineWorldPositions = null;
let constellationToggleEl = null;
let selectedConstellationName = 'Orion';
let planetViewOffset = new THREE.Vector3();
const targetWorldPos = new THREE.Vector3();
const _earthOrbitScratch = new THREE.Vector3();
const freeViewBtn = document.getElementById('free-view-btn');

function resetCatalogStarPointHighlights() {
  if (!catalogStarPoints || !catalogStarSizeNormBase) return;
  const attr = catalogStarPoints.geometry.attributes.sizeNorm;
  attr.array.set(catalogStarSizeNormBase);
  attr.needsUpdate = true;
}

/** Slightly enlarge point-sprite size for HIPs that belong to the active stick figure. */
function applyConstellationStarHighlights(hipSet) {
  resetCatalogStarPointHighlights();
  if (!constellationEnabled || !hipSet?.size || !catalogStarPoints || !catalogStarSizeNormBase) return;
  const attr = catalogStarPoints.geometry.attributes.sizeNorm;
  const arr = attr.array;
  for (const hip of hipSet) {
    const j = catalogHipToPointIndex.get(hip);
    if (j === undefined) continue;
    arr[j] = Math.min(1.45, catalogStarSizeNormBase[j] * 1.9);
  }
  attr.needsUpdate = true;
}

function clearConstellationLines() {
  resetCatalogStarPointHighlights();
  activeConstellationFigureHips.clear();
  constellationFigureShellRadius = 0;
  if (constellationLines) {
    constellationLines.removeFromParent();
    if (constellationLines.geometry) constellationLines.geometry.dispose();
    if (constellationLines.material) constellationLines.material.dispose();
    constellationLines = null;
  }
  constellationLineWorldPositions = null;
  applyConstellationFigureShellToWorldPositions();
}

function syncConstellationLinesToCamera() {
  if (!constellationLines || !constellationLineWorldPositions) return;
  const world = constellationLineWorldPositions;
  const cx = camera.position.x;
  const cy = camera.position.y;
  const cz = camera.position.z;
  const pos = constellationLines.geometry.attributes.position.array;
  for (let i = 0; i < world.length; i += 3) {
    pos[i] = world[i] - cx;
    pos[i + 1] = world[i + 1] - cy;
    pos[i + 2] = world[i + 2] - cz;
  }
  constellationLines.geometry.attributes.position.needsUpdate = true;
  constellationLines.geometry.setDrawRange(0, world.length / 3);
  // Parent is catalogStarsGroup (already translated by camera each frame).
  constellationLines.position.set(0, 0, 0);
  constellationLines.updateMatrixWorld(true);
}

/**
 * Stick figures from data/constellations.json (HIP segments from Stellarium modern_st).
 * Active figure stars + lines use a Sun-centered sphere: P = Sun + R·û with û from ICRS RA/Dec
 * (same geometry family as Stellarium Web / planetariums). R = max parallax distance in the figure.
 */
function updateConstellationLines() {
  if (!RENDER_CONSTELLATION_LINES) {
    clearConstellationLines();
    return;
  }
  if (!constellationEnabled) {
    clearConstellationLines();
    return;
  }
  if (!constellationDefs || !Array.isArray(constellationDefs) || !constellationHipToPos) return;
  const def = constellationDefs.find((d) => d.name === selectedConstellationName);
  if (!def) {
    clearConstellationLines();
    return;
  }

  const segments = def.segments || [];
  if (!segments.length) {
    clearConstellationLines();
    return;
  }

  clearConstellationLines();

  const highlightHips = new Set();
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    if (!Array.isArray(seg) || seg.length < 2) continue;
    if (constellationHipToPos.has(seg[0])) highlightHips.add(seg[0]);
    if (constellationHipToPos.has(seg[1])) highlightHips.add(seg[1]);
  }

  let R = 0;
  for (const hip of highlightHips) {
    const p = constellationHipToPos.get(hip);
    if (p) R = Math.max(R, Math.hypot(p.x, p.y, p.z));
  }
  if (R < 1e5) R = 1e7;
  const shellR = R * 1.001;
  constellationFigureShellRadius = shellR;
  activeConstellationFigureHips = new Set(highlightHips);

  sun.getWorldPosition(_sunWorldFigure);
  const sx = _sunWorldFigure.x;
  const sy = _sunWorldFigure.y;
  const sz = _sunWorldFigure.z;
  const world = [];

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    if (!Array.isArray(seg) || seg.length < 2) continue;
    const hipA = seg[0];
    const hipB = seg[1];
    const ua = getFigureUnitDir(hipA);
    const ub = getFigureUnitDir(hipB);
    if (!ua || !ub) continue;
    const ax = sx + shellR * ua.x;
    const ay = sy + shellR * ua.y;
    const az = sz + shellR * ua.z;
    const bx = sx + shellR * ub.x;
    const by = sy + shellR * ub.y;
    const bz = sz + shellR * ub.z;
    world.push(ax, ay, az, bx, by, bz);
  }

  if (world.length === 0) {
    activeConstellationFigureHips.clear();
    constellationFigureShellRadius = 0;
    applyConstellationFigureShellToWorldPositions();
    applyConstellationStarHighlights(highlightHips);
    return;
  }

  constellationLineWorldPositions = world;
  const pos = new Float32Array(world.length);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lineColor = def.color != null ? def.color : 0x66ffcc;
  const mat = new THREE.LineBasicMaterial({
    color: lineColor,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 1500;
  catalogStarsGroup.add(lines);
  constellationLines = lines;
  applyConstellationFigureShellToWorldPositions();
  syncConstellationLinesToCamera();
  applyConstellationStarHighlights(highlightHips);
}

// Simulation clock: starts at current date/time, advances with timeScale
const simulationStartDate = new Date();
let simulationTimeSeconds = 0;
let simulationPaused = false;
let timeScale = 1;

let cameraTransition = null;
const TRANSITION_DURATION = 2.2;
/** While near the solar system, test Sun/planets/moons before star pick spheres (those spheres are huge and steal clicks). */
const SOLAR_SYSTEM_RAY_PRIORITY_UNITS = 12_000;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function enterPlanetView(planet) {
  cameraTransition = null;
  selectedMoon = null;
  selectedStar = null;
  planet.getWorldPosition(targetWorldPos);
  const radius = planet.geometry.parameters.radius;
  const dir = camera.position.clone().sub(targetWorldPos).normalize();
  const endDistance = Math.max(radius * 25, 0.5);
  cameraTransition = {
    target: planet,
    startCamera: camera.position.clone(),
    startTarget: controls.target.clone(),
    dir: dir.clone(),
    endDistance,
    progress: 0,
    minDistance: Math.max(0.008, radius * 2.5),
    maxDistance: 250,
  };
  freeViewBtn.style.display = 'block';
}

function enterMoonView(moon) {
  cameraTransition = null;
  selectedPlanet = null;
  selectedStar = null;
  moon.getWorldPosition(targetWorldPos);
  const radius = moon.geometry.parameters.radius;
  const dir = camera.position.clone().sub(targetWorldPos).normalize();
  const endDistance = Math.max(radius * 40, 0.12);
  cameraTransition = {
    target: moon,
    startCamera: camera.position.clone(),
    startTarget: controls.target.clone(),
    dir: dir.clone(),
    endDistance,
    progress: 0,
    minDistance: Math.max(0.004, radius * 4),
    maxDistance: 250,
  };
  freeViewBtn.style.display = 'block';
}

function enterSunView() {
  cameraTransition = null;
  selectedMoon = null;
  selectedStar = null;
  sun.getWorldPosition(targetWorldPos);
  const radius = SUN_RADIUS_SCENE;
  const dir = camera.position.clone().sub(targetWorldPos).normalize();
  const endDistance = Math.max(radius * 28, 2.5);
  cameraTransition = {
    target: sun,
    startCamera: camera.position.clone(),
    startTarget: controls.target.clone(),
    dir: dir.clone(),
    endDistance,
    progress: 0,
    minDistance: Math.max(0.12, radius * 1.85),
    maxDistance: 250,
  };
  freeViewBtn.style.display = 'block';
}

function enterStarView(star) {
  cameraTransition = null;
  restoreCatalogStarPointSize();
  _lastFloatingOriginCam.set(Number.NaN, Number.NaN, Number.NaN);
  selectedPlanet = null;
  selectedMoon = null;
  const pw = star.userData.catalogWorldParallax;
  if (pw) targetWorldPos.set(pw.x, pw.y, pw.z);
  else star.getWorldPosition(targetWorldPos);
  const radius = star.geometry.parameters.radius;
  const dir = camera.position.clone().sub(targetWorldPos).normalize();
  const Rsov = star.userData.solarRadii;
  let endDistance;
  let minDistance;
  let maxDistance = 250_000;
  if (Rsov != null) {
    const lim = computeStarCloseUpOrbitLimits(Rsov);
    minDistance = lim.minDistance;
    endDistance = lim.endDistance;
    maxDistance = lim.maxDistance;
  } else {
    endDistance = Math.max(radius * 30, 2);
    minDistance = Math.max(0.5, radius * 8);
  }
  cameraTransition = {
    target: star,
    startCamera: camera.position.clone(),
    startTarget: controls.target.clone(),
    dir: dir.clone(),
    endDistance,
    progress: 0,
    minDistance,
    maxDistance,
  };
  freeViewBtn.style.display = 'block';
}

function exitPlanetView() {
  restoreCatalogStarPointSize();
  selectedPlanet = null;
  selectedMoon = null;
  selectedStar = null;
  controls.target.copy(solarSystemGroup.position);
  controls.minDistance = 15;
  controls.maxDistance = 250000;
  freeViewBtn.style.display = 'none';
}

if (freeViewBtn) freeViewBtn.addEventListener('click', exitPlanetView);

planetData.forEach((p) => {
  const radiusUnits = SUN_RADIUS_SCENE * (p.radiusKm / SUN_RADIUS_KM);
  const segments = 64;
  const geometry = new THREE.SphereGeometry(Math.max(0.005, radiusUnits), segments, segments);
  const material = new THREE.MeshStandardMaterial({
    color: p.color,
    roughness: 0.78,
    metalness: 0.04,
    emissive: 0x08080a,
    emissiveIntensity: 0.06,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const incRad = ((p.inclinationDeg != null ? p.inclinationDeg : 0) * Math.PI) / 180;
  const lonAscNodeRad = ((p.longitudeAscendingNodeDeg != null ? p.longitudeAscendingNodeDeg : 0) * Math.PI) / 180;
  const argPeriRad = ((p.argumentPerihelionDeg != null ? p.argumentPerihelionDeg : 0) * Math.PI) / 180;
  const e = Math.min(0.999, p.eccentricity != null ? p.eccentricity : 0);
  const aAU = p.au;
  const meanMotion = (2 * Math.PI) / (p.periodYears * SECONDS_PER_EARTH_YEAR);
  const meanAnomaly0 = Math.random() * Math.PI * 2;
  mesh.userData = {
    name: p.name,
    aAU,
    baseAU: aAU,
    e,
    baseE: e,
    incRad,
    lonAscNodeRad,
    argPeriRad,
    meanMotion,
    meanAnomaly: meanAnomaly0,
    orbitRadius: aAU * AU_TO_UNITS,
    radiusUnits,
    albedo: p.albedo ?? 0.3,
    massKg: p.massKg ?? 5e24,
    surfaceTempK: 288,
    inHabitableZone: false,
    habitabilityClass: 'Unknown',
    tidalPowerW: 0,
    removed: false,
  };
  const pos0 = keplerPosition(aAU, e, incRad, meanAnomaly0, AU_TO_UNITS, lonAscNodeRad, argPeriRad);
  mesh.position.set(pos0.x, pos0.y, pos0.z);
  const axialTiltRad = (p.axialTiltDeg != null ? p.axialTiltDeg : 0) * (Math.PI / 180);
  mesh.rotation.x = -axialTiltRad;
  mesh.layers.enable(2);
  planets.push(mesh);
  solarSystemGroup.add(mesh);

  const orbitSegments = 128;
  const orbitPoints = [];
  const cosI = Math.cos(incRad);
  const sinI = Math.sin(incRad);
  const cosO = Math.cos(lonAscNodeRad);
  const sinO = Math.sin(lonAscNodeRad);
  for (let i = 0; i <= orbitSegments; i++) {
    const nu = (i / orbitSegments) * Math.PI * 2;
    const rAU = aAU * (1 - e * e) / (1 + e * Math.cos(nu));
    const r = rAU * AU_TO_UNITS;
    const nup = nu + argPeriRad;
    const cosNup = Math.cos(nup);
    const sinNup = Math.sin(nup);
    orbitPoints.push(new THREE.Vector3(
      r * (cosNup * cosO - sinNup * cosI * sinO),
      r * sinNup * sinI,
      r * (cosNup * sinO + sinNup * cosI * cosO)
    ));
  }
  const orbitGeom = new THREE.BufferGeometry().setFromPoints(orbitPoints);
  const orbitLine = new THREE.LineLoop(orbitGeom, new THREE.LineBasicMaterial({
    color: 0x555566,
    transparent: true,
    opacity: 0.55,
  }));
  solarSystemGroup.add(orbitLine);
  planetOrbitLines.push(orbitLine);

  textureLoader.load(TEXTURE_BASE + p.texture, (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    material.map = tex;
    material.color.set(0xffffff);
    material.needsUpdate = true;
  }, undefined, () => { /* keep fallback color on error */ });

  if (p.ringTexture) {
    const innerR = radiusUnits * 1.35;
    const outerR = radiusUnits * 2.35;
    const ringGeometry = new THREE.RingGeometry(innerR, outerR, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({
      map: null,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    mesh.add(ring);
    textureLoader.load(TEXTURE_BASE + p.ringTexture, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      ringMaterial.map = tex;
      ringMaterial.needsUpdate = true;
    });
  }

  const labelEl = document.createElement('div');
  labelEl.textContent = p.name;
  labelEl.style.color = 'rgba(255,255,255,0.9)';
  labelEl.style.fontFamily = 'system-ui, sans-serif';
  labelEl.style.fontSize = '13px';
  labelEl.style.whiteSpace = 'nowrap';
  labelEl.style.textShadow = '0 0 4px #000, 0 1px 3px #000';
  labelEl.style.pointerEvents = 'auto';
  labelEl.style.cursor = 'pointer';
  labelEl.title = 'Click to focus on ' + p.name;
  labelEl.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    enterPlanetView(mesh);
  });
  const labelObj = new CSS2DObject(labelEl);
  labelObj.position.set(0, radiusUnits * 1.32, 0);
  mesh.add(labelObj);
  mesh.userData.labelEl = labelEl;

  // Moons: orbit in planet radii (correct proportion), size scaled down slightly so not chunky
  const moonList = moonsData[p.name];
  if (moonList) {
    moonList.forEach((m) => {
      const orbitRadiusUnits = (m.orbitKm / p.radiusKm) * radiusUnits;
      const moonRadiusUnits = Math.max(0.0012, (m.radiusKm / p.radiusKm) * radiusUnits * 0.55);
      const periodSeconds = m.periodDays * 24 * 60 * 60;
      const orbitSpeed = (2 * Math.PI) / periodSeconds;
      const geometry = new THREE.SphereGeometry(moonRadiusUnits, 32, 32);
      const isEarthMoon = m.name === 'Moon';
      const material = new THREE.MeshStandardMaterial({
        color: m.color,
        roughness: 0.92,
        metalness: 0.0,
        emissive: isEarthMoon ? 0x1a1a1a : 0x0a0a08,
        emissiveIntensity: isEarthMoon ? 0.07 : 0.02,
      });
      const moonMesh = new THREE.Mesh(geometry, material);
      const orbitAngle = Math.random() * Math.PI * 2;
      moonMesh.userData = {
        name: m.name,
        orbitAngle,
        orbitSpeed,
        orbitRadius: orbitRadiusUnits,
        parentPlanet: mesh,
      };
      // Position in parent planet's local space so orbit is correct when solar system moves
      moonMesh.position.set(
        orbitRadiusUnits * Math.cos(orbitAngle),
        0,
        orbitRadiusUnits * Math.sin(orbitAngle)
      );
      moonMesh.layers.enable(2);
      const moonLabelEl = document.createElement('div');
      moonLabelEl.textContent = m.name;
      moonLabelEl.style.color = 'rgba(255,255,255,0.9)';
      moonLabelEl.style.fontFamily = 'system-ui, sans-serif';
      moonLabelEl.style.fontSize = '12px';
      moonLabelEl.style.whiteSpace = 'nowrap';
      moonLabelEl.style.textShadow = '0 0 4px #000, 0 1px 3px #000';
      moonLabelEl.style.visibility = 'hidden';
      moonLabelEl.style.pointerEvents = 'none';
      const moonLabelObj = new CSS2DObject(moonLabelEl);
      moonLabelObj.position.set(0, moonRadiusUnits * 1.35, 0);
      moonMesh.add(moonLabelObj);
      moonMesh.userData.labelEl = moonLabelEl;
      moons.push(moonMesh);
      mesh.add(moonMesh);
      textureLoader.load(TEXTURE_BASE + m.texture, (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        material.map = tex;
        material.color.setHex(isEarthMoon ? 0xc8c8c4 : 0xffffff);
        material.needsUpdate = true;
      }, undefined, () => { /* keep fallback color on error */ });
      if (m.normalMap) {
        textureLoader.load(TEXTURE_BASE + m.normalMap, (normTex) => {
          normTex.wrapS = normTex.wrapT = THREE.RepeatWrapping;
          material.normalMap = normTex;
          material.normalScale = new THREE.Vector2(isEarthMoon ? 0.2 : 0.8, isEarthMoon ? 0.2 : 0.8);
          material.needsUpdate = true;
        }, undefined, () => {});
      }
    });
  }
});

const travelToEl = document.getElementById('travel-to');
if (travelToEl) {
  const sunWrap = document.createElement('div');
  sunWrap.className = 'travel-item';
  sunWrap.style.display = 'inline-block';
  sunWrap.style.margin = '0.1rem 0.15rem 0.1rem 0';
  const sunA = document.createElement('a');
  sunA.href = '#';
  sunA.textContent = 'Sun';
  sunA.addEventListener('click', (e) => {
    e.preventDefault();
    enterSunView();
  });
  sunWrap.appendChild(sunA);
  travelToEl.appendChild(sunWrap);

  planetData.forEach((p, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'travel-item';
    wrap.style.display = 'inline-block';
    wrap.style.position = 'relative';
    wrap.style.margin = '0.1rem 0.15rem 0.1rem 0';
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = p.name;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      enterPlanetView(planets[i]);
    });
    wrap.appendChild(a);
    const moonList = moonsData[p.name];
    if (moonList && moonList.length > 0) {
      const dropdown = document.createElement('div');
      dropdown.className = 'travel-moons-dropdown';
      dropdown.style.cssText = 'position:absolute; left:0; top:100%; margin-top:2px; min-width:100%; background:rgba(0,0,0,0.85); border:1px solid rgba(255,255,255,0.25); border-radius:6px; padding:0.35rem 0.5rem; font-size:0.8rem; color:rgba(255,255,255,0.9); display:none; z-index:30; pointer-events:auto; box-shadow:0 4px 12px rgba(0,0,0,0.5);';
      moonList.forEach((m) => {
        const moonMesh = moons.find((mo) => mo.userData.parentPlanet === planets[i] && mo.userData.name === m.name);
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = m.name;
        link.style.display = 'block';
        link.style.padding = '0.15rem 0';
        link.style.color = 'rgba(255,255,255,0.9)';
        link.style.textDecoration = 'none';
        link.style.cursor = 'pointer';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (moonMesh) enterMoonView(moonMesh);
        });
        link.addEventListener('mouseenter', () => { link.style.background = 'rgba(60,60,80,0.6)'; });
        link.addEventListener('mouseleave', () => { link.style.background = 'transparent'; });
        dropdown.appendChild(link);
      });
      wrap.appendChild(dropdown);
      wrap.addEventListener('mouseenter', () => { dropdown.style.display = 'block'; });
      wrap.addEventListener('mouseleave', () => { dropdown.style.display = 'none'; });
    }
    travelToEl.appendChild(wrap);
  });
  const starsWrap = document.createElement('div');
  starsWrap.className = 'travel-item';
  starsWrap.style.display = 'inline-block';
  starsWrap.style.position = 'relative';
  starsWrap.style.margin = '0.1rem 0.15rem 0.1rem 0';
  const starsLink = document.createElement('a');
  starsLink.href = '#';
  starsLink.textContent = 'Stars';
  starsLink.addEventListener('click', (e) => e.preventDefault());
  starsWrap.appendChild(starsLink);
  const starsDropdown = document.createElement('div');
  starsDropdown.className = 'travel-moons-dropdown';
  starsDropdown.style.cssText = 'position:absolute; left:0; top:100%; margin-top:2px; min-width:12em; max-height:14em; overflow:auto; background:rgba(0,0,0,0.85); border:1px solid rgba(255,255,255,0.25); border-radius:6px; padding:0.35rem 0.5rem; font-size:0.8rem; color:rgba(255,255,255,0.9); display:none; z-index:30; pointer-events:auto; box-shadow:0 4px 12px rgba(0,0,0,0.5);';
  starsTravelDropdown = starsDropdown;
  starsWrap.appendChild(starsDropdown);
  starsWrap.addEventListener('mouseenter', () => { starsDropdown.style.display = 'block'; });
  starsWrap.addEventListener('mouseleave', () => { starsDropdown.style.display = 'none'; });
  travelToEl.appendChild(starsWrap);
}
loadCatalogStars();

// --- Constellations UI (HIP-based line drawing) ---
constellationToggleEl = document.getElementById('constellation-toggle');
constellationSelectEl = document.getElementById('constellation-select');
const showNamesToggleEl = document.getElementById('show-names-toggle');
if (showNamesToggleEl) {
  skyNamesVisible = !!showNamesToggleEl.checked;
  showNamesToggleEl.addEventListener('change', () => {
    skyNamesVisible = !!showNamesToggleEl.checked;
    applySkyNamesVisibility();
  });
}
applySkyNamesVisibility();
if (constellationToggleEl && RENDER_CONSTELLATION_LINES) {
  constellationEnabled = !!constellationToggleEl.checked;
  constellationToggleEl.addEventListener('change', () => {
    constellationEnabled = !!constellationToggleEl.checked;
    updateConstellationLines();
  });
}

if (constellationSelectEl && RENDER_CONSTELLATION_LINES) {
  constellationSelectEl.addEventListener('change', () => {
    selectedConstellationName = constellationSelectEl.value;
    updateConstellationLines();
  });
}

if (RENDER_CONSTELLATION_LINES) {
  fetch('data/constellations.json?v=9')
    .then((res) => {
      if (!res.ok) throw new Error(`constellations.json ${res.status}`);
      return res.json();
    })
    .then((defs) => {
      constellationDefs = defs;
      if (constellationSelectEl && Array.isArray(constellationDefs)) {
        constellationSelectEl.innerHTML = '';
        constellationDefs.forEach((d) => {
          const o = document.createElement('option');
          o.value = d.name;
          o.textContent = d.name;
          constellationSelectEl.appendChild(o);
        });
        if (constellationDefs.some((d) => d.name === selectedConstellationName)) {
          constellationSelectEl.value = selectedConstellationName;
        } else if (constellationDefs[0]) {
          selectedConstellationName = constellationDefs[0].name;
          constellationSelectEl.value = selectedConstellationName;
        }
      }
      updateConstellationLines();
    })
    .catch((err) => console.error('Failed to load constellations:', err));
} else {
  clearConstellationLines();
}

// Populate distance reference dropdown with every named object: Sun, planets, moons, stars, camera target
function populateDistanceReferenceSelect() {
  const sel = document.getElementById('distance-reference');
  if (!sel) return;
  sel.innerHTML = '';
  const opt = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  };
  sel.appendChild(opt('Sun', 'Sun'));
  planetData.forEach((p) => {
    if (planets.find((pl) => pl.userData.name === p.name && !pl.userData.removed)) sel.appendChild(opt(p.name, p.name));
  });
  moons.forEach((m) => {
    const parentName = m.userData.parentPlanet?.userData?.name || 'Planet';
    sel.appendChild(opt(`moon:${parentName}:${m.userData.name}`, `${m.userData.name} (${parentName})`));
  });
  realStars.forEach((s) => sel.appendChild(opt(s.userData.name, s.userData.name)));
  sel.appendChild(opt('target', 'Camera target'));
  if (!sel.dataset.distanceListener) {
    sel.dataset.distanceListener = '1';
    sel.addEventListener('change', updateDistanceToEarth);
  }
  const hasEarth = Array.from(sel.options).some((o) => o.value === 'Earth');
  sel.value = hasEarth ? 'Earth' : (sel.options[0] && sel.options[0].value);
}
populateDistanceReferenceSelect();

// --- Click on a moon or star to zoom in (raycast uses larger pick spheres for stars) ---
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  const distSS = camera.position.distanceTo(solarSystemGroup.position);
  let clicky = false;
  if (distSS < SOLAR_SYSTEM_RAY_PRIORITY_UNITS) {
    if (raycaster.intersectObject(sun, false).length > 0) clicky = true;
    if (!clicky) {
      const ph = raycaster.intersectObjects(planets.filter((p) => !p.userData.removed));
      if (ph.length > 0) clicky = true;
    }
  }
  if (!clicky) {
    const moonHits = raycaster.intersectObjects(moons);
    const starPickHits = raycaster.intersectObjects(realStarPickSpheres);
    clicky = moonHits.length > 0 || starPickHits.length > 0;
  }
  canvas.style.cursor = clicky ? 'pointer' : '';
});
canvas.addEventListener('click', () => {
  raycaster.setFromCamera(mouseNDC, camera);
  const distSS = camera.position.distanceTo(solarSystemGroup.position);
  if (distSS < SOLAR_SYSTEM_RAY_PRIORITY_UNITS) {
    const sunHits = raycaster.intersectObject(sun, false);
    if (sunHits.length > 0) {
      enterSunView();
      return;
    }
    const planetHits = raycaster.intersectObjects(planets.filter((p) => !p.userData.removed));
    if (planetHits.length > 0) {
      enterPlanetView(planetHits[0].object);
      return;
    }
    const moonHits = raycaster.intersectObjects(moons);
    if (moonHits.length > 0) {
      enterMoonView(moonHits[0].object);
      return;
    }
  }
  const starPickHits = raycaster.intersectObjects(realStarPickSpheres);
  if (starPickHits.length > 0) {
    enterStarView(starPickHits[0].object.userData.realStar);
    return;
  }
  const moonHitsFar = raycaster.intersectObjects(moons);
  if (moonHitsFar.length > 0) {
    enterMoonView(moonHitsFar[0].object);
  }
});

// --- Habitable zone (green ring): inner/outer AU from luminosity ---
const L_SUN = 3.828e26;
function habitableZoneAU(lumW) {
  const L = lumW / L_SUN;
  const inner = 0.75 * Math.sqrt(L);
  const outer = 1.77 * Math.sqrt(L);
  return { inner, outer };
}
const hz = habitableZoneAU(SUN_LUMINOSITY_W);
const habitableZoneInner = hz.inner * AU_TO_UNITS;
const habitableZoneOuter = hz.outer * AU_TO_UNITS;
const habitableZoneGeom = new THREE.RingGeometry(habitableZoneInner, habitableZoneOuter, 64);
const habitableZoneMat = new THREE.MeshBasicMaterial({
  color: 0x00aa44,
  transparent: true,
  opacity: 0.22,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const habitableZoneRing = new THREE.Mesh(habitableZoneGeom, habitableZoneMat);
habitableZoneRing.rotation.x = -Math.PI / 2;
habitableZoneRing.position.set(0, 0, 0);
habitableZoneRing.visible = false;
solarSystemGroup.add(habitableZoneRing);

// --- Temperature & habitability (equilibrium + tidal) ---
const G = 6.674e-11;
const sunMassKg = 1.989e30;
function updateTemperatureAndHabitability() {
  planets.forEach((planet) => {
    if (planet.userData.removed) return;
    const distM = planet.userData.orbitRadius * (AU_M / AU_TO_UNITS);
    const distAU = distM / AU_M;
    const flux = (SUN_LUMINOSITY_W / (4 * Math.PI * distM * distM)) * (1 - planet.userData.albedo);
    const T4 = flux / STEFAN_BOLTZMANN;
    let tempK = Math.pow(T4, 0.25);
    const tidalW = planet.userData.tidalPowerW || 0;
    if (tidalW > 0) {
      const area = 4 * Math.PI * (planet.userData.radiusUnits * (AU_M / AU_TO_UNITS) * 1000) ** 2;
      const extraT4 = tidalW / (area * STEFAN_BOLTZMANN);
      tempK = Math.pow(T4 + extraT4, 0.25);
    }
    planet.userData.surfaceTempK = tempK;
    planet.userData.inHabitableZone = distAU >= hz.inner && distAU <= hz.outer;
    if (tempK < 200) planet.userData.habitabilityClass = 'Too cold';
    else if (tempK > 350) planet.userData.habitabilityClass = 'Too hot';
    else if (planet.userData.inHabitableZone) planet.userData.habitabilityClass = 'Habitable';
    else planet.userData.habitabilityClass = 'Marginal';
  });
}

// --- Tidal heating (simplified: scales with 1/a^6, larger r = more heating) ---
function updateTidalHeating() {
  planets.forEach((planet) => {
    if (planet.userData.removed) return;
    const distAU = planet.userData.orbitRadius / AU_TO_UNITS;
    const rKm = planet.userData.radiusUnits * (SUN_RADIUS_KM / SUN_RADIUS_SCENE);
    const baseTidal = (1e15 * (rKm / 6371) ** 2) / (distAU ** 6);
    planet.userData.tidalPowerW = baseTidal;
  });
}

// --- Collision detection (overlap → remove smaller or merge) ---
const collisionPairs = [];
const collisionWorldA = new THREE.Vector3();
const collisionWorldB = new THREE.Vector3();
function updateCollisions() {
  collisionPairs.length = 0;
  const sunR = SUN_RADIUS_SCENE;
  for (let i = 0; i < planets.length; i++) {
    const A = planets[i];
    if (A.userData.removed) continue;
    A.getWorldPosition(collisionWorldA);
    const rA = A.userData.radiusUnits;
    if (collisionWorldA.distanceTo(sunPos) < sunR + rA) {
      collisionPairs.push({ a: A, b: null });
      continue;
    }
    for (let j = i + 1; j < planets.length; j++) {
      const B = planets[j];
      if (B.userData.removed) continue;
      B.getWorldPosition(collisionWorldB);
      const rB = B.userData.radiusUnits;
      if (collisionWorldA.distanceTo(collisionWorldB) < rA + rB) collisionPairs.push({ a: A, b: B });
    }
  }
  collisionPairs.forEach(({ a, b }) => {
    if (b) {
      if (a.userData.massKg >= b.userData.massKg) {
        b.userData.removed = true;
        b.visible = false;
      } else {
        a.userData.removed = true;
        a.visible = false;
      }
    } else {
      a.userData.removed = true;
      a.visible = false;
    }
  });
}

// Sun: main light with inverse-square (inner planets bright, outer planets get less)
const sunLight = new THREE.PointLight(0xffeedd, 24000, 0, 2);
sunLight.position.set(0, 0, 0);
solarSystemGroup.add(sunLight);
// Fill light (no decay): matches surface brightness — sunlit side of Uranus/Neptune
// reads as "well-lit office" / "civil twilight" when you're close, not a dark blob
const sunFillLight = new THREE.PointLight(0xffeedd, 2.4, 0, 0);
sunFillLight.position.set(0, 0, 0);
solarSystemGroup.add(sunFillLight);
const ambient = new THREE.AmbientLight(0x1e1e26, 0.42);
scene.add(ambient);

// --- Orbit controls ---
const controls = new OrbitControls(camera, canvas);
controls.target.copy(solarSystemGroup.position);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 15;
controls.maxDistance = 250000;
controls.maxPolarAngle = Math.PI;

// --- Zoom label ---
const zoomLabel = document.getElementById('zoom-label');
function updateZoomLabel() {
  if (!zoomLabel) return;
  if (selectedStar) {
    zoomLabel.textContent = `Zoom: ${selectedStar.userData.name}`;
    return;
  }
  if (selectedPlanet === sun) {
    zoomLabel.textContent = 'Zoom: Sun';
    return;
  }
  const d = camera.position.distanceTo(controls.target);
  if (d < 80) zoomLabel.textContent = 'Zoom: Inner solar system (Mercury–Mars)';
  else if (d < 350) zoomLabel.textContent = 'Zoom: Jupiter / Saturn';
  else if (d < 800) zoomLabel.textContent = 'Zoom: Outer planets';
  else if (d < 2500) zoomLabel.textContent = 'Zoom: Full solar system';
  else zoomLabel.textContent = 'Zoom: Deep space';
}
controls.addEventListener('change', updateZoomLabel);

// --- Distance from viewer to selected reference (miles). 1 AU = 92.955807 million miles, 1 AU = 45 units ---
const MILES_PER_AU = 92.955807e6;
const MILES_PER_UNIT = MILES_PER_AU / AU_TO_UNITS;
// Must match scripts/build-catalog-from-vizier-tsv.cjs
const REAL_STAR_DISTANCE_SCALE = 0.05;
const STAR_MILES_PER_UNIT = MILES_PER_UNIT / REAL_STAR_DISTANCE_SCALE;
const ORBIT_LINES_HIDE_BEYOND_MILES = 10634e6;
const distanceValueEl = document.getElementById('distance-value');
const distanceReferenceSelect = document.getElementById('distance-reference');
function updateDistanceToEarth() {
  if (!distanceValueEl) return;
  const ref = distanceReferenceSelect ? distanceReferenceSelect.value : 'Earth';
  let pos;
  let useStarScaleForConversion = false;
  if (ref === 'Sun') {
    pos = solarSystemGroup.position;
    useStarScaleForConversion = !!selectedStar;
  } else if (ref === 'target') {
    controls.target.getWorldPosition(targetWorldPos);
    pos = targetWorldPos;
    useStarScaleForConversion = !!selectedStar;
  } else if (ref.startsWith('moon:')) {
    const parts = ref.split(':');
    if (parts.length !== 3) {
      distanceValueEl.textContent = '— mi';
      return;
    }
    const parentName = parts[1];
    const moonName = parts[2];
    const parent = planets.find((p) => !p.userData.removed && p.userData.name === parentName);
    const moon = parent ? moons.find((m) => m.userData.parentPlanet === parent && m.userData.name === moonName) : null;
    if (!moon) {
      distanceValueEl.textContent = '— mi';
      return;
    }
    moon.getWorldPosition(targetWorldPos);
    pos = targetWorldPos;
  } else {
    const star = realStars.find((s) => s.userData.name === ref);
    if (star) {
      star.getWorldPosition(targetWorldPos);
      pos = targetWorldPos;
      useStarScaleForConversion = true;
    } else {
      const body = planets.find((p) => !p.userData.removed && p.userData.name === ref);
      if (!body) {
        distanceValueEl.textContent = '— mi';
        return;
      }
      body.getWorldPosition(targetWorldPos);
      pos = targetWorldPos;
    }
  }
  const units = camera.position.distanceTo(pos);
  const miles = units * (useStarScaleForConversion ? STAR_MILES_PER_UNIT : MILES_PER_UNIT);
  let text;
  if (miles >= 1e6) {
    const millions = miles / 1e6;
    text = millions >= 10 ? `${Math.round(millions).toLocaleString()} million mi` : `${millions.toFixed(2)} million mi`;
  } else if (miles >= 1e3) {
    text = `${Math.round(miles).toLocaleString()} mi`;
  } else {
    text = `${Math.round(miles)} mi`;
  }
  distanceValueEl.textContent = text;
}

// --- Resize ---
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  css2DRenderer.setSize(w, h);
});

// --- Galactic orbit: solar system orbits Milky Way ~230 Myr per orbit ---
const GALACTIC_PERIOD_YEARS = 230e6;
const GALACTIC_ORBIT_RADIUS = 60;
let galacticAngle = 0;

// --- Animation: Keplerian orbits, galactic drift, long-term evolution ---
const SECONDS_PER_DAY = 24 * 60 * 60;
const DEFAULT_ROTATION_SPEED = (2 * Math.PI) / SECONDS_PER_DAY; // rad per sim-sec
const FIXED_DT = 1 / 60;

function animate() {
  requestAnimationFrame(animate);
  const dt = FIXED_DT;
  const effectiveScale = Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1;
  const scaledDt = dt * effectiveScale;

  if (!simulationPaused) {
    const simulatedYears = simulationTimeSeconds / SECONDS_PER_EARTH_YEAR;
    const galacticAngularSpeed = (2 * Math.PI) / (GALACTIC_PERIOD_YEARS * SECONDS_PER_EARTH_YEAR);
    galacticAngle += galacticAngularSpeed * scaledDt;
    // Solar system stays at origin so camera (0, 20, 55) looking at (0,0,0) shows sun + planets
    // solarSystemGroup.position.set(GALACTIC_ORBIT_RADIUS * Math.cos(galacticAngle), 0, GALACTIC_ORBIT_RADIUS * Math.sin(galacticAngle));
    sunPos.copy(solarSystemGroup.position);

    planets.forEach((planet) => {
      if (planet.userData.removed) return;
      const u = planet.userData;
      let aAU = u.aAU;
      let e = u.e;
      if (u.name === 'Mercury') {
        const gyr = simulatedYears / 1e9;
        const drift = Math.min(1, gyr / 5);
        aAU = u.baseAU * (1 - 0.012 * drift);
        e = Math.min(0.9, u.baseE + 0.06 * drift);
      } else if (u.name === 'Venus' || u.name === 'Earth' || u.name === 'Mars') {
        const gyr = simulatedYears / 1e9;
        const drift = Math.min(1, gyr / 10);
        aAU = u.baseAU * (1 + 0.003 * drift);
        e = Math.min(0.5, u.baseE + 0.01 * drift);
      }
      u.meanAnomaly += u.meanMotion * scaledDt;
      u.meanAnomaly = ((u.meanAnomaly % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const pos = keplerPosition(aAU, e, u.incRad, u.meanAnomaly, AU_TO_UNITS, u.lonAscNodeRad, u.argPeriRad);
      planet.position.set(pos.x, pos.y, pos.z);
      u.orbitRadius = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
      const rotSpeed = u.rotationSpeed != null ? u.rotationSpeed : DEFAULT_ROTATION_SPEED;
      planet.rotation.y += rotSpeed * scaledDt;
    });
    moons.forEach((moon) => {
      const { orbitRadius, orbitSpeed, parentPlanet } = moon.userData;
      if (parentPlanet.userData.removed) return;
      moon.userData.orbitAngle += orbitSpeed * scaledDt;
      const angle = moon.userData.orbitAngle;
      // Orbit in parent's local space (moon is child of planet)
      moon.position.x = orbitRadius * Math.cos(angle);
      moon.position.y = 0;
      moon.position.z = orbitRadius * Math.sin(angle);
    });
    simulationTimeSeconds += dt * effectiveScale;
    updateTidalHeating();
    updateTemperatureAndHabitability();
    updateCollisions();
  }

  // (Constellations + stars are drawn in the inertial RA/Dec frame.
  // We intentionally do not auto-rotate the sky here; the camera/view
  // already provides the correct visual perspective.)
  sunPos.copy(solarSystemGroup.position);
  const sunDist = camera.position.distanceTo(sunPos);
  const maxSunRadius = sunDist * Math.tan(REAL_SUN_ANGULAR_RADIUS_RAD);
  const sunScale = Math.min(1, maxSunRadius / SUN_RADIUS_SCENE);
  sun.scale.setScalar(sunScale);

  sunGlow.scale.setScalar(sunScale * 30.0);
  sunGlow.lookAt(camera.position);

  sunGlowOuter.scale.setScalar(sunScale * 60.0);
  sunGlowOuter.lookAt(camera.position);

  const sunDistMiles = sunDist * MILES_PER_UNIT;
  const FAR_MILES = 320e6;
  const NEAR_MILES = 35e6;
  let flareT = (sunDistMiles - NEAR_MILES) / (FAR_MILES - NEAR_MILES);
  flareT = Math.max(0, Math.min(1, flareT));
  const glowStrength = Math.pow(1.0 - flareT, 0.45);
  // Maintain the 279–294M “perfect” look for most of the way in: keep bloom dampened across a wide range
  const BLOOM_DAMP_START = 50e6;
  const BLOOM_DAMP_END = 320e6;
  let bloomDamp = 1.0;
  if (sunDistMiles >= BLOOM_DAMP_START && sunDistMiles <= BLOOM_DAMP_END) {
    const t = (sunDistMiles - BLOOM_DAMP_START) / (BLOOM_DAMP_END - BLOOM_DAMP_START);
    bloomDamp = 0.55 - 0.1 * t;
  } else if (sunDistMiles > BLOOM_DAMP_END) {
    bloomDamp = 0.45;
  }
  const innerGlowIntensity = (0.85 + 3.2 * glowStrength) * bloomDamp;
  const outerGlowIntensity = (0.22 + 1.5 * glowStrength) * bloomDamp;
  sunGlowMat.uniforms.uIntensity.value = innerGlowIntensity;
  sunGlowOuterMat.uniforms.uIntensity.value = outerGlowIntensity;

  camToSun.copy(sunPos).sub(camera.position).normalize();
  camera.getWorldDirection(camFwd);
  const viewAtSun = Math.max(0, camToSun.dot(camFwd));
  const burstScale = 0.4 + 0.6 * viewAtSun * viewAtSun;

  if (sunStarburst.visible) {
    sunStarburst.scale.setScalar(sunScale * (28 + 58 * glowStrength));
    sunStarburst.lookAt(camera.position);
    starburstMat.uniforms.uOpacity.value = 1.7 * glowStrength * burstScale;
  }

  if (sunLensFlare.visible) {
    const flareLength = Math.max(55 * sunScale, sunDist * 0.42);
    sunLensFlare.scale.set(flareLength, 0.55 * sunScale, 1);
    sunLensFlare.lookAt(camera.position);
    lensFlareMat.uniforms.uIntensity.value = 2.4 * glowStrength * burstScale;
  }

  const MERCURY_ZONE_MILES = 55e6;
  const NEAR_MILES_M = 35e6;
  let mercuryT = (MERCURY_ZONE_MILES - sunDistMiles) / (MERCURY_ZONE_MILES - NEAR_MILES_M);
  mercuryT = Math.max(0, Math.min(1, mercuryT));
  // Sun disk intensity follows scroll/zoom: closer = brighter, farther = dimmer (same degree as size change)
  const sunIntensity = 14.0 + 28.0 * (0.35 + 0.65 * glowStrength);
  sunMaterial.uniforms.uCoreIntensity.value = sunIntensity;
  sunMaterial.uniforms.uRimIntensity.value = 0.35 + 0.7 * (0.35 + 0.65 * glowStrength);

  updateSimClock();

  if (cameraTransition) {
    const tr = cameraTransition;
    tr.progress = Math.min(1, tr.progress + dt / TRANSITION_DURATION);
    const t = easeInOutCubic(tr.progress);
    tr.target.getWorldPosition(targetWorldPos);
    const endCamera = targetWorldPos.clone().add(tr.dir.clone().multiplyScalar(tr.endDistance));
    const endTarget = targetWorldPos.clone();
    camera.position.lerpVectors(tr.startCamera, endCamera, t);
    controls.target.lerpVectors(tr.startTarget, endTarget, t);
    controls.update();
    if (tr.progress >= 1) {
      const isMoon = !!tr.target.userData.parentPlanet;
      const isStar = Number.isFinite(tr.target.userData.hip);
      selectedPlanet = !isMoon && !isStar ? tr.target : null;
      selectedMoon = isMoon ? tr.target : null;
      selectedStar = isStar ? tr.target : null;
      planetViewOffset.copy(camera.position).sub(targetWorldPos);
      controls.minDistance = tr.minDistance;
      controls.maxDistance = tr.maxDistance;
      cameraTransition = null;
    }
  } else if (selectedStar) {
    const sp = selectedStar.userData.catalogWorldParallax;
    if (sp) targetWorldPos.set(sp.x, sp.y, sp.z);
    else selectedStar.getWorldPosition(targetWorldPos);
    camera.position.copy(targetWorldPos).add(planetViewOffset);
    controls.target.copy(targetWorldPos);
    controls.update();
    planetViewOffset.copy(camera.position).sub(targetWorldPos);
  } else if (selectedMoon) {
    selectedMoon.getWorldPosition(targetWorldPos);
    camera.position.copy(targetWorldPos).add(planetViewOffset);
    controls.target.copy(targetWorldPos);
    controls.update();
    planetViewOffset.copy(camera.position).sub(targetWorldPos);
  } else if (selectedPlanet) {
    selectedPlanet.getWorldPosition(targetWorldPos);
    camera.position.copy(targetWorldPos).add(planetViewOffset);
    controls.target.copy(targetWorldPos);
    controls.update();
    planetViewOffset.copy(camera.position).sub(targetWorldPos);
  } else {
    controls.target.copy(solarSystemGroup.position);
    controls.update();
  }

  const earthPlanet = planets.find((p) => !p.userData.removed && p.userData.name === 'Earth');
  if (earthPlanet && planetOrbitLines.length > 0) {
    earthPlanet.getWorldPosition(_earthOrbitScratch);
    const dMiEarth = camera.position.distanceTo(_earthOrbitScratch) * MILES_PER_UNIT;
    const showPlanetOrbits = dMiEarth <= ORBIT_LINES_HIDE_BEYOND_MILES;
    for (let oi = 0; oi < planetOrbitLines.length; oi++) {
      planetOrbitLines[oi].visible = showPlanetOrbits;
    }
  }

  if (selectedStar && selectedStar.userData.sunLikeBuild) {
    const kit = selectedStar.userData.sunLikeBuild;
    const spw = selectedStar.userData.catalogWorldParallax;
    if (spw) targetWorldPos.set(spw.x, spw.y, spw.z);
    else selectedStar.getWorldPosition(targetWorldPos);
    const distScene = camera.position.distanceTo(targetWorldPos);
    const distSceneSafe = Math.max(distScene, 1e-6);
    const starDistMiles = distScene * STAR_MILES_PER_UNIT;
    const solarRadii = selectedStar.userData.solarRadii;

    const angleRad = Math.min(REAL_SUN_ANGULAR_RADIUS_RAD * solarRadii, 1.12);
    let maxDiskR = distSceneSafe * Math.tan(angleRad);
    maxDiskR = Math.max(maxDiskR, distSceneSafe * Math.tan(ORION_MIN_DISK_HALF_ANGLE_RAD));
    const starScale = THREE.MathUtils.clamp(maxDiskR / SUN_RADIUS_SCENE, 0.06, ORION_MAX_SCENE_SCALE);
    kit.disk.scale.setScalar(starScale);
    // Sun uses sunScale ≤ 1 so glow stays ~30/60 units; stars used starScale up to 140 → camera sat *inside*
    // huge additive billboards (orange full screen). Cap radii vs camera distance like the physical Sun case.
    const rawGlow = starScale * 30.0;
    const rawOuter = starScale * 60.0;
    const capGlow = distSceneSafe * 0.34;
    const capOuter = distSceneSafe * 0.62;
    const sGlow = Math.min(rawGlow, capGlow);
    const sOut = Math.min(rawOuter, capOuter);
    kit.glow.scale.setScalar(sGlow);
    kit.outer.scale.setScalar(sOut);
    // mesh.lookAt(camera) collapses to a line/rectangle when view ≈ ±Y (gimbal); match camera.up like the Sun rig
    _starBillboardHelper.position.copy(targetWorldPos);
    _starBillboardHelper.up.copy(camera.up);
    _starBillboardHelper.lookAt(camera.position);
    kit.glow.parent.getWorldQuaternion(_starGlowParentQ);
    kit.glow.quaternion.copy(_starGlowParentQ).invert().multiply(_starBillboardHelper.quaternion);
    kit.outer.quaternion.copy(kit.glow.quaternion);

    let flareTStar = (starDistMiles - NEAR_MILES) / (FAR_MILES - NEAR_MILES);
    flareTStar = Math.max(0, Math.min(1, flareTStar));
    const gStar = Math.pow(1.0 - flareTStar, 0.45);
    let bloomDampStar = 1.0;
    if (starDistMiles >= BLOOM_DAMP_START && starDistMiles <= BLOOM_DAMP_END) {
      const ts = (starDistMiles - BLOOM_DAMP_START) / (BLOOM_DAMP_END - BLOOM_DAMP_START);
      bloomDampStar = 0.55 - 0.1 * ts;
    } else if (starDistMiles > BLOOM_DAMP_END) {
      bloomDampStar = 0.45;
    }
    const smag = Number.isFinite(selectedStar.userData.mag) ? selectedStar.userData.mag : 5;
    const lumBoost = Math.min(1.35, 0.72 + 0.1 * Math.sqrt(Math.min(solarRadii, 80)));
    /**
     * Close-up disk/glow: keep the hand-tuned curve that looked right for Betelgeuse & Sun-like giants.
     * Raw Pogson (10^(-0.4m)) makes very bright stars (m~0.5) ~60× vs m=5 and blows out ACES → white mush.
     * Sky points still use full physics; here we only add soft distance + mild magnitude seasoning.
     */
    const brightT = THREE.MathUtils.clamp((6.5 - smag) / 6.5, 0, 1);
    let intensityMult = (0.45 + 0.55 * brightT) * lumBoost;
    const dRef = selectedStar.userData.catalogDistScene;
    if (dRef != null && dRef > 1e-9) {
      const rSafe = Math.max(distSceneSafe, dRef * 0.04);
      let invSq = (dRef / rSafe) ** 2;
      invSq = THREE.MathUtils.clamp(invSq, 0.12, 95);
      const distSoft = Math.pow(invSq, 0.38);
      intensityMult *= THREE.MathUtils.lerp(1.0, distSoft, 0.55);
    }
    const magSeason = THREE.MathUtils.clamp(Math.pow(10, -0.12 * (smag - 5)), 0.82, 1.18);
    intensityMult *= magSeason;
    const glowBoost = THREE.MathUtils.clamp(rawGlow / Math.max(sGlow, 0.001), 1, 2.4);
    const outerBoost = THREE.MathUtils.clamp(rawOuter / Math.max(sOut, 0.001), 1, 2.2);
    kit.glowMat.uniforms.uIntensity.value = (0.85 + 3.2 * gStar) * bloomDampStar * intensityMult * glowBoost;
    kit.outerMat.uniforms.uIntensity.value = (0.22 + 1.5 * gStar) * bloomDampStar * intensityMult * outerBoost;
    let diskInt = (14.0 + 28.0 * (0.35 + 0.65 * gStar)) * intensityMult;
    // ACES + high uCoreIntensity clips to white when the disk fills the view
    const diskRScene = starScale * SUN_RADIUS_SCENE;
    const proximity = THREE.MathUtils.clamp(diskRScene / Math.max(distSceneSafe, 1e-6), 0, 2.2);
    const proxT = THREE.MathUtils.clamp((proximity - 0.32) / 1.1, 0, 1);
    diskInt *= THREE.MathUtils.lerp(1.0, 0.48, proxT);
    diskInt = Math.min(diskInt, 19);
    kit.diskMat.uniforms.uCoreIntensity.value = diskInt;
    kit.diskMat.uniforms.uRimIntensity.value = Math.min(
      (0.35 + 0.7 * (0.35 + 0.65 * gStar)) * intensityMult,
      1.15,
    );

    const hip = selectedStar.userData.hip;
    if (hip != null && suppressedCatalogStarHip !== hip) {
      restoreCatalogStarPointSize();
      suppressCatalogStarPoint(hip);
    }
  }

  syncCatalogStarsFloatingOrigin();
  syncConstellationLinesToCamera();

  updateZoomLabel();
  updateDistanceToEarth();

  for (let ri = 0; ri < realStars.length; ri++) {
    const m = realStars[ri];
    const k = m.userData.sunLikeBuild;
    if (k) k.group.visible = selectedStar === m;
  }

  moons.forEach((moon) => {
    const el = moon.userData.labelEl;
    if (!el) return;
    const selOk = selectedPlanet === moon.userData.parentPlanet || selectedMoon === moon;
    el.style.visibility = skyNamesVisible && selOk ? 'visible' : 'hidden';
  });
  renderer.render(scene, camera);
  css2DRenderer.render(scene, camera);
}

// --- Simulation clock: digits sec, min, hr, day, year; then date line (day, month # and name, year A.D.) ---
const clockSec = document.getElementById('clock-sec');
const clockMin = document.getElementById('clock-min');
const clockHr = document.getElementById('clock-hr');
const clockDay = document.getElementById('clock-day');
const clockYear = document.getElementById('clock-year');
const simClockDateEl = document.getElementById('sim-clock-date');
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function updateSimClock() {
  const simMs = simulationStartDate.getTime() + simulationTimeSeconds * 1000;
  const d = new Date(simMs);
  const sec = Math.floor(d.getSeconds());
  const min = Math.floor(d.getMinutes());
  const hr = Math.floor(d.getHours());
  const day = Math.floor(d.getDate());
  const year = d.getFullYear();
  const monthNum = d.getMonth() + 1;
  const monthName = MONTH_NAMES[d.getMonth()];
  if (clockSec) clockSec.textContent = String(sec);
  if (clockMin) clockMin.textContent = String(min);
  if (clockHr) clockHr.textContent = String(hr);
  if (clockDay) clockDay.textContent = String(day);
  if (clockYear) clockYear.textContent = String(year);
  if (simClockDateEl) simClockDateEl.textContent = `${day}, ${monthNum} ${monthName}, ${year} A.D.`;
}
updateSimClock();

// --- Speed controls: Play = real time; others = Earth orbit in given real seconds ---
function setSpeedFromButton(btn) {
  if (!btn) return;
  const orbitSec = btn.dataset.orbitSeconds;
  if (orbitSec === 'real') {
    timeScale = 1;
  } else {
    const sec = parseFloat(orbitSec);
    timeScale = Number.isFinite(sec) && sec > 0 ? SECONDS_PER_EARTH_YEAR / sec : 1;
  }
  document.querySelectorAll('.speed-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
}

// Use event delegation so clicks work even if DOM timing varies
const speedControlsEl = document.getElementById('speed-controls');
if (speedControlsEl) {
  speedControlsEl.addEventListener('click', (e) => {
    const speedBtn = e.target.closest('.speed-btn');
    if (speedBtn) {
      setSpeedFromButton(speedBtn);
      return;
    }
    const pauseBtn = e.target.closest('#pause-btn');
    if (pauseBtn) {
      simulationPaused = !simulationPaused;
      pauseBtn.textContent = simulationPaused ? '▶' : '⏸';
      pauseBtn.title = simulationPaused ? 'Resume' : 'Pause simulation';
    }
  });
}

const activeSpeedBtn = document.querySelector('.speed-btn.active');
if (activeSpeedBtn) setSpeedFromButton(activeSpeedBtn);

// Keyboard: 1=Play, 2–6 = 2×, 3×, 5×, 10×, 100×
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input') || e.target.closest('textarea')) return;
  const orbitSecByKey = { '1': 'real', '2': '3600', '3': '60', '4': '1', '5': '0.1', '6': '0.01' };
  const orbitSec = orbitSecByKey[e.key];
  if (orbitSec === undefined) return;
  const btn = document.querySelector(`.speed-btn[data-orbit-seconds="${orbitSec}"]`);
  if (btn) setSpeedFromButton(btn);
});

const habitableZoneBtn = document.getElementById('habitable-zone-btn');
if (habitableZoneBtn) {
  habitableZoneBtn.addEventListener('click', () => {
    habitableZoneRing.visible = !habitableZoneRing.visible;
    habitableZoneBtn.classList.toggle('active', habitableZoneRing.visible);
    habitableZoneBtn.title = habitableZoneRing.visible ? 'Hide habitable zone' : 'Show habitable zone ring';
  });
}

// --- Planet info panel (temp, habitability) when focused ---
const planetInfoEl = document.getElementById('planet-info');
function updatePlanetInfo() {
  if (!planetInfoEl) return;
  if (selectedStar) {
    const u = selectedStar.userData;
    const lyLine = u.distLy != null ? `${u.distLy.toFixed(2)} ly` : 'unknown (poor parallax)';
    let miLine = '';
    if (u.distMiles != null) {
      miLine = u.distMiles >= 1e12 ? `${(u.distMiles / 1e12).toFixed(2)} trillion mi` : `${(u.distMiles / 1e6).toFixed(0)} million mi`;
    } else {
      miLine = '—';
    }
    planetInfoEl.style.display = 'block';
    planetInfoEl.innerHTML = `<strong>${u.name}</strong><br>Distance: ${lyLine}<br>${miLine} from Sun<br><span style="opacity:0.75;font-size:0.9em">Star close-up — planets are tiny here. Click <strong>Jupiter</strong> (top bar) or <strong>Free view</strong> to return.</span>`;
    return;
  }
  if (selectedMoon) {
    const parent = selectedMoon.userData.parentPlanet;
    const parentName = parent && parent.userData ? parent.userData.name : 'Planet';
    planetInfoEl.style.display = 'block';
    planetInfoEl.innerHTML = `<strong>${selectedMoon.userData.name}</strong><br>Moon of ${parentName}`;
    return;
  }
  if (!selectedPlanet || selectedPlanet.userData.removed) {
    planetInfoEl.style.display = 'none';
    return;
  }
  if (selectedPlanet === sun) {
    const T = selectedPlanet.userData.surfaceTempK.toFixed(0);
    planetInfoEl.style.display = 'block';
    planetInfoEl.innerHTML = `<strong>Sun</strong><br>Photosphere ~ ${T} K<br><span style="opacity:0.85">Same disk + glow stack as distant stars in close-up.</span>`;
    return;
  }
  const u = selectedPlanet.userData;
  const tempC = (u.surfaceTempK - 273.15).toFixed(1);
  planetInfoEl.style.display = 'block';
  planetInfoEl.innerHTML = `<strong>${u.name}</strong><br>Temp: ${tempC} °C (${u.surfaceTempK.toFixed(0)} K)<br>Habitability: ${u.habitabilityClass}`;
}
setInterval(updatePlanetInfo, 500);

animate();
