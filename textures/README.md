# Planet textures (realistic)

Place the following texture files in this folder. They are **free** from [Solar System Scope](https://www.solarsystemscope.com/textures/) (NASA-based, CC BY 4.0).

**How to save:** Open each link in your browser (from the list below or from `download-textures.html`). When the image opens, right‑click the image → **Save Image As…** → save into this `textures` folder with the exact filename shown (e.g. `2k_venus_surface.jpg`). Or press **Ctrl+S** and choose the folder and filename. (right‑click link → “Save link as…” → save into this `textures` folder).

1. `2k_mercury.jpg`  
   https://www.solarsystemscope.com/textures/download/2k_mercury.jpg

2. `2k_venus_surface.jpg`  
   https://www.solarsystemscope.com/textures/download/2k_venus_surface.jpg

3. `2k_earth_daymap.jpg`  
   https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg

3b. `2k_earth_nightmap.jpg` (optional — night side with city lights)  
   https://www.solarsystemscope.com/textures/download/2k_earth_nightmap.jpg

4. `2k_mars.jpg`  
   https://www.solarsystemscope.com/textures/download/2k_mars.jpg

5. `2k_jupiter.jpg`  
   https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg

6. `2k_saturn.jpg`  
   https://www.solarsystemscope.com/textures/download/2k_saturn.jpg

7. `2k_saturn_ring_alpha.png`  
   https://www.solarsystemscope.com/textures/download/2k_saturn_ring_alpha.png

8. `2k_uranus.jpg`  
   https://www.solarsystemscope.com/textures/download/2k_uranus.jpg

9. `2k_neptune.jpg`  
   https://www.solarsystemscope.com/textures/download/2k_neptune.jpg

Without these files, planets will still render with solid colors. With them, you get realistic surface/atmosphere looks.

---

## Moon textures (optional)

The sim includes major moons with **correct orbits**. Place texture files in this `textures` folder with the **exact filename** the sim expects. If a file is missing, the moon uses a solid fallback color.

### Earth — working direct link

Solar System Scope only hosts the **Earth Moon** texture. This link works:

| Save as | Direct link |
|---------|-------------|
| `2k_moon.jpg` | https://www.solarsystemscope.com/textures/download/2k_moon.jpg |
| `2k_moon_normal.jpg` (optional) | [NASA CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/) — download a normal/height map and rename to `2k_moon_normal.jpg` if needed. |

### All other moons — where to get textures

Solar System Scope does **not** host Phobos, Deimos, or the other moons (those URLs return 404). Use these instead:

- **[NASA 3D Resources](https://nasa3d.arc.nasa.gov/)** — search for the moon name (e.g. “Phobos”, “Io”, “Titan”) and download equirectangular or global maps; resize/rename to match the filename below if needed.
- **[USGS Astropedia](https://astrogeology.usgs.gov/search)** — Phobos and many other moons (Deimos has no ready-made map; see note below); search the planetary map catalog.
- Web search: **“&lt;moon name&gt; texture map equirectangular”** or **“&lt;moon name&gt; bump map”** — then save the image into this folder with the exact filename the sim expects.

**Deimos:** No free, ready-made global Deimos texture exists in USGS/NASA catalogs (unlike Phobos). The sim uses its fallback color for Deimos. Optional: [Small Body Mapping Tool – Deimos](https://sbmt.jhuapl.edu/Object-Template.php?obj=43) or [Map-A-Planet 2](https://astrogeology.usgs.gov/tools/map-a-planet-2) to build one from raw data. Otherwise leave `2k_deimos.jpg` out.

**Filenames the sim expects** (save your downloaded texture with this name):

| Planet | Filenames |
|--------|-----------|
| **Mars** | `2k_phobos.jpg`, `2k_deimos.jpg` |
| **Jupiter** | `2k_io.jpg`, `2k_europa.jpg`, `2k_ganymede.jpg`, `2k_callisto.jpg` |
| **Saturn** | `2k_mimas.jpg`, `2k_enceladus.jpg`, `2k_tethys.jpg`, `2k_dione.jpg`, `2k_rhea.jpg`, `2k_titan.jpg`, `2k_iapetus.jpg` |
| **Uranus** | `2k_miranda.jpg`, `2k_ariel.jpg`, `2k_umbriel.jpg`, `2k_titania.jpg`, `2k_oberon.jpg` |
| **Neptune** | `2k_triton.jpg`, `2k_proteus.jpg` |
