import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- Scene, camera, renderer ---
const canvas = document.getElementById('canvas');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 10000);
camera.position.set(0, 25, 80);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
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

const bloomComposer = new EffectComposer(renderer);
bloomComposer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 1.7, 0.5, 0.62
);
bloomComposer.addPass(bloomPass);
bloomComposer.renderToScreen = false;

const planetMaskRT = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
});
const whiteMaskMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
const mergeUniforms = {
  tDiffuse: { value: null },
  uBloom: { value: bloomComposer.readBuffer.texture },
  uPlanetMask: { value: planetMaskRT.texture },
  uBloomStrength: { value: 0.72 },
};
const mergePass = new ShaderPass(
  new THREE.ShaderMaterial({
    uniforms: mergeUniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform sampler2D uBloom;
      uniform sampler2D uPlanetMask;
      uniform float uBloomStrength;
      varying vec2 vUv;
      void main() {
        vec4 base = texture2D(tDiffuse, vUv);
        vec4 bloom = texture2D(uBloom, vUv);
        float planetMask = texture2D(uPlanetMask, vUv).r;
        float bloomMask = (1.0 - planetMask);
        gl_FragColor = base + bloom * uBloomStrength * bloomMask;
      }
    `,
  }),
  'tDiffuse'
);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(mergePass);

// --- Starfield background ---
const starGeometry = new THREE.BufferGeometry();
const starCount = 4000;
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const r = 800 + Math.random() * 1200;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
  starPositions[i * 3 + 2] = r * Math.cos(phi);
}
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMaterial = new THREE.PointsMaterial({
  color: 0xffffff,
  size: 2,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.9,
});
const stars = new THREE.Points(starGeometry, starMaterial);
scene.add(stars);

// --- Sun: solid opaque sphere (no soft edge = no dark ring) ---
const sunGeometry = new THREE.SphereGeometry(4, 96, 96);
const sunMaterial = new THREE.MeshBasicMaterial({
  color: 0xfffff5,
  transparent: false,
  depthWrite: false,
  depthTest: true,
});
const sun = new THREE.Mesh(sunGeometry, sunMaterial);
sun.position.set(0, 0, 0);
sun.layers.set(0);
scene.add(sun);

// Bloom layer: circle for bloom pass only
const circleVert = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const circleFrag = `
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float d = length(c) * 2.0;
    float alpha = exp(-d * d * 1.4);
    alpha *= 1.0 - smoothstep(0.88, 0.98, d);
    vec3 col = vec3(1.0, 0.98, 0.96);
    gl_FragColor = vec4(col, alpha);
  }
`;
const sunBloomCircle = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10, 1, 1),
  new THREE.ShaderMaterial({
    vertexShader: circleVert,
    fragmentShader: circleFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
);
sunBloomCircle.position.set(0, 0, 0);
sunBloomCircle.layers.set(1);
scene.add(sunBloomCircle);

// Starburst: bloom layer only (subtle starshine via bloom)
const burstSize = 1024;
const burstCanvas = document.createElement('canvas');
burstCanvas.width = burstSize;
burstCanvas.height = burstSize;
const bctx = burstCanvas.getContext('2d');
const bc = burstSize / 2;
bctx.fillStyle = 'rgba(0,0,0,0)';
bctx.fillRect(0, 0, burstSize, burstSize);
const numRays = 28;
for (let i = 0; i < numRays; i++) {
  const angle = (i / numRays) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
  const lengthScale = 0.35 + Math.random() * 0.6;
  const maxLen = bc * lengthScale;
  const width = 1 + Math.random() * 1.5;
  const peakOpacity = 0.2 + Math.random() * 0.12;
  bctx.save();
  bctx.translate(bc, bc);
  bctx.rotate(angle);
  const g = bctx.createLinearGradient(0, 0, maxLen, 0);
  g.addColorStop(0, `rgba(255,255,255,${peakOpacity * 0.4})`);
  g.addColorStop(0.2, `rgba(255,252,248,${peakOpacity * 0.75})`);
  g.addColorStop(0.5, `rgba(255,248,240,${peakOpacity * 0.35})`);
  g.addColorStop(0.8, 'rgba(255,245,235,0.04)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  bctx.fillStyle = g;
  bctx.fillRect(-width / 2, 0, width, maxLen);
  bctx.restore();
}
const burstTexture = new THREE.CanvasTexture(burstCanvas);
burstTexture.needsUpdate = true;
const burstVert = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const burstFrag = `
  uniform sampler2D map;
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    vec4 tex = texture2D(map, vUv);
    float d = length(vUv - 0.5) * 2.0;
    tex.a *= (1.0 - smoothstep(0.72, 0.98, d)) * opacity;
    tex.rgb *= tex.a;
    gl_FragColor = tex;
  }
`;
const softStarburst = new THREE.Mesh(
  new THREE.PlaneGeometry(28, 28, 1, 1),
  new THREE.ShaderMaterial({
    uniforms: {
      map: { value: burstTexture },
      opacity: { value: 0.6 },
    },
    vertexShader: burstVert,
    fragmentShader: burstFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
);
softStarburst.position.set(0, 0, 0);
softStarburst.layers.set(1);
scene.add(softStarburst);

const sunPos = new THREE.Vector3(0, 0, 0);
const camToSun = new THREE.Vector3();
const camFwd = new THREE.Vector3();

// --- Solar system: real scale sizes and distances
// Radii from NASA (km). Sun radius 695,700 km; 1 AU = 45 units; orbital periods from NASA.
const SUN_RADIUS_KM = 695_700;
const SUN_RADIUS_SCENE = 4; // sun sphere is 4 units
const AU_TO_UNITS = 45;
const SECONDS_PER_EARTH_YEAR = 60;

const planetData = [
  { name: 'Mercury', au: 0.387, periodYears: 0.241, radiusKm: 2_439.7, color: 0x8c7853, texture: '2k_mercury.jpg' },
  { name: 'Venus', au: 0.723, periodYears: 0.615, radiusKm: 6_051.8, color: 0xe6c229, texture: '2k_venus_surface.jpg' },
  { name: 'Earth', au: 1.0, periodYears: 1.0, radiusKm: 6_371, color: 0x2244aa, texture: '2k_earth_daymap.jpg' },
  { name: 'Mars', au: 1.523, periodYears: 1.88, radiusKm: 3_389.5, color: 0xc1440e, texture: '2k_mars.jpg' },
  { name: 'Jupiter', au: 5.205, periodYears: 11.86, radiusKm: 69_911, color: 0xc88b2a, texture: '2k_jupiter.jpg' },
  { name: 'Saturn', au: 9.582, periodYears: 29.42, radiusKm: 58_232, color: 0xe8d5a8, texture: '2k_saturn.jpg', ringTexture: '2k_saturn_ring_alpha.png' },
  { name: 'Uranus', au: 19.2, periodYears: 83.75, radiusKm: 25_362, color: 0x4fd0e2, texture: '2k_uranus.jpg' },
  { name: 'Neptune', au: 30.05, periodYears: 163.72, radiusKm: 24_622, color: 0x4166f5, texture: '2k_neptune.jpg' },
];

const textureLoader = new THREE.TextureLoader();
const TEXTURE_BASE = 'textures/';

const planets = [];
const css2DRenderer = new CSS2DRenderer();
css2DRenderer.setSize(window.innerWidth, window.innerHeight);
css2DRenderer.domElement.style.position = 'absolute';
css2DRenderer.domElement.style.top = '0';
css2DRenderer.domElement.style.left = '0';
css2DRenderer.domElement.style.pointerEvents = 'none';
css2DRenderer.domElement.style.zIndex = '10';
document.body.appendChild(css2DRenderer.domElement);

let selectedPlanet = null;
let planetViewOffset = new THREE.Vector3();
const freeViewBtn = document.getElementById('free-view-btn');

let cameraTransition = null;
const TRANSITION_DURATION = 2.2;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function enterPlanetView(planet) {
  if (cameraTransition) return;
  const planetRadius = planet.geometry.parameters.radius;
  const dir = camera.position.clone().sub(planet.position).normalize();
  const endDistance = Math.max(planetRadius * 25, 0.5);
  cameraTransition = {
    planet,
    startCamera: camera.position.clone(),
    startTarget: controls.target.clone(),
    dir: dir.clone(),
    endDistance,
    progress: 0,
    minDistance: Math.max(0.008, planetRadius * 2.5),
    maxDistance: 250,
  };
  freeViewBtn.style.display = 'block';
}

function exitPlanetView() {
  selectedPlanet = null;
  controls.target.set(0, 0, 0);
  controls.minDistance = 15;
  controls.maxDistance = 1500;
  freeViewBtn.style.display = 'none';
}

freeViewBtn.addEventListener('click', exitPlanetView);

planetData.forEach((p) => {
  const radiusUnits = SUN_RADIUS_SCENE * (p.radiusKm / SUN_RADIUS_KM);
  const segments = 64;
  const geometry = new THREE.SphereGeometry(Math.max(0.005, radiusUnits), segments, segments);
  const material = new THREE.MeshStandardMaterial({
    color: p.color,
    roughness: 0.85,
    metalness: 0.05,
    emissive: 0x0a0a0a,
    emissiveIntensity: 0.12,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = {
    name: p.name,
    orbitRadius: p.au * AU_TO_UNITS,
    orbitSpeed: (2 * Math.PI) / (p.periodYears * SECONDS_PER_EARTH_YEAR),
    orbitAngle: Math.random() * Math.PI * 2,
  };
  mesh.layers.enable(2);
  planets.push(mesh);
  scene.add(mesh);

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
  labelObj.position.set(0, 2.5, 0);
  mesh.add(labelObj);
});

const travelToEl = document.getElementById('travel-to');
planetData.forEach((p, i) => {
  const a = document.createElement('a');
  a.href = '#';
  a.textContent = p.name;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    enterPlanetView(planets[i]);
  });
  travelToEl.appendChild(a);
});

// Light so planets are bright on the sun-lit side
const sunLight = new THREE.PointLight(0xffeedd, 6, 0, 0);
sunLight.position.set(0, 0, 0);
scene.add(sunLight);
const ambient = new THREE.AmbientLight(0x1a1a1a, 0.45);
scene.add(ambient);

// --- Orbit controls ---
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 15;
controls.maxDistance = 1500;
controls.maxPolarAngle = Math.PI;

// --- Zoom label ---
const zoomLabel = document.getElementById('zoom-label');
function updateZoomLabel() {
  const d = camera.position.distanceTo(controls.target);
  if (d < 80) zoomLabel.textContent = 'Zoom: Inner solar system (Mercury–Mars)';
  else if (d < 350) zoomLabel.textContent = 'Zoom: Jupiter / Saturn';
  else if (d < 800) zoomLabel.textContent = 'Zoom: Outer planets';
  else zoomLabel.textContent = 'Zoom: Full solar system';
}
controls.addEventListener('change', updateZoomLabel);

// --- Resize ---
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  bloomComposer.setSize(w, h);
  bloomComposer.setPixelRatio(renderer.getPixelRatio());
  bloomPass.resolution.set(w, h);
  composer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  mergeUniforms.uBloom.value = bloomComposer.readBuffer.texture;
  planetMaskRT.setSize(w, h);
  planetMaskRT.setPixelRatio(renderer.getPixelRatio());
  css2DRenderer.setSize(w, h);
});

// --- Animation: all planets orbit in the XZ plane ---
function animate() {
  requestAnimationFrame(animate);
  const dt = 1 / 60;
  const earthRotationSpeed = (2 * Math.PI) / 60;
  planets.forEach((planet) => {
    const { orbitRadius, orbitSpeed } = planet.userData;
    planet.userData.orbitAngle += orbitSpeed * dt;
    const a = planet.userData.orbitAngle;
    planet.position.x = orbitRadius * Math.cos(a);
    planet.position.z = orbitRadius * Math.sin(a);
    if (planet.userData.name === 'Earth') {
      planet.rotation.y += earthRotationSpeed * dt;
    }
  });
  sunBloomCircle.lookAt(camera.position);
  softStarburst.lookAt(camera.position);
  camToSun.copy(sunPos).sub(camera.position).normalize();
  camera.getWorldDirection(camFwd);
  const viewAtSun = Math.max(0, camToSun.dot(camFwd));
  const burstScale = 0.3 + 0.7 * viewAtSun * viewAtSun;
  softStarburst.material.opacity = 0.6 * burstScale;
  softStarburst.scale.setScalar(burstScale);
  if (cameraTransition) {
    const tr = cameraTransition;
    tr.progress = Math.min(1, tr.progress + dt / TRANSITION_DURATION);
    const t = easeInOutCubic(tr.progress);
    const endCamera = tr.planet.position.clone().add(tr.dir.clone().multiplyScalar(tr.endDistance));
    const endTarget = tr.planet.position.clone();
    camera.position.lerpVectors(tr.startCamera, endCamera, t);
    controls.target.lerpVectors(tr.startTarget, endTarget, t);
    controls.update();
    if (tr.progress >= 1) {
      selectedPlanet = tr.planet;
      planetViewOffset.copy(camera.position).sub(tr.planet.position);
      controls.minDistance = tr.minDistance;
      controls.maxDistance = tr.maxDistance;
      cameraTransition = null;
    }
  } else if (selectedPlanet) {
    const p = selectedPlanet.position;
    camera.position.copy(p).add(planetViewOffset);
    controls.target.copy(p);
    controls.update();
    planetViewOffset.copy(camera.position).sub(p);
  } else {
    controls.update();
  }
  updateZoomLabel();
  const prevCamLayers = camera.layers.mask;
  const prevRenderTarget = renderer.getRenderTarget();
  camera.layers.set(2);
  planets.forEach((p) => {
    storedMaterials[p.uuid] = p.material;
    p.material = whiteMaskMaterial;
  });
  renderer.setRenderTarget(planetMaskRT);
  renderer.clear();
  renderer.render(scene, camera);
  planets.forEach((p) => {
    p.material = storedMaterials[p.uuid];
    delete storedMaterials[p.uuid];
  });
  camera.layers.mask = prevCamLayers;
  renderer.setRenderTarget(prevRenderTarget);
  scene.traverse(darkenNonBloom);
  camera.layers.set(1);
  bloomComposer.render();
  camera.layers.set(0);
  scene.traverse(restoreMaterials);
  mergeUniforms.uPlanetMask.value = planetMaskRT.texture;
  composer.render();
  css2DRenderer.render(scene, camera);
}

animate();
