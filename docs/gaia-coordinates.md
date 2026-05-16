# Getting accurate star coordinates (Gaia DR3) for this project

**Gold standard for positions & parallaxes today:** [Gaia Data Release 3 (Gaia DR3)](https://www.cosmos.esa.int/web/gaia/data-release-3) from ESA — sub-mas astrometry for hundreds of millions of stars.

Your game keys stars by **Hipparcos ID (HIP)**. Gaia does not use HIP as its primary key, but the **Gaia Archive** and **VizieR** provide **HIP ↔ Gaia** links.

---

## 1) HIP list to paste into queries

From the repo root:

```bash
node scripts/list-constellation-hips.cjs
```

Prints every HIP in `data/constellations.json` plus a compact `IN (...)` clause for SQL/ADQL.

---

## 2) Gaia Archive (ESA) — ADQL (recommended)

**URL:** [Gaia science archive — Advanced (ADQL)](https://gea.esac.esa.int/archive/)

Use the **`gaiadr3.hipparcos2`** table: each row ties a **HIP** to a **`source_id`** in **`gaiadr3.gaia_source`**.

```sql
-- Replace the IN list with output from list-constellation-hips.cjs
SELECT
  h.hip,
  g.source_id,
  g.ra,                                    -- deg, ICRS, Gaia ref epoch
  g.dec,
  g.parallax,                              -- mas
  g.parallax_error,
  g.pmra, g.pmdec,                         -- mas/yr
  g.ruwe,                                  -- quality hint (lower usually better)
  g.phot_g_mean_mag
FROM gaiadr3.hipparcos2 AS h
JOIN gaiadr3.gaia_source AS g USING (source_id)
WHERE h.hip IN (11767, 27989, 26727)
```

**Notes**

- **`ra` / `dec`** are on the **Gaia reference** (see Gaia DR3 documentation for epoch / frame details). For a game at J2000-style sky, they are already far better than old reductions; adding **full precession to “of date”** is extra work.
- **`parallax`** in **mas** → distance in parsecs ≈ `1000 / parallax` when `parallax_error` is small.
- If a HIP is missing, widen the search (name resolution in SIMBAD) or use a **positional cross-match** (cone) around Hipparcos RA/Dec.

**If `JOIN … USING (source_id)` errors** in the Archive UI, use the neighbour table (same archive, DR3 doc: *Cross-matches*):

```sql
SELECT
  hip.hip,
  g.source_id,
  g.ra, g.dec, g.parallax, g.parallax_error, g.pmra, g.pmdec, g.ruwe
FROM gaiadr3.hipparcos2_best_neighbour AS nb
JOIN gaiadr3.gaia_source AS g ON g.source_id = nb.source_id
JOIN hipparcos2.hipparcos2 AS hip ON hip.original_ext_source_id = nb.original_ext_source_id
WHERE hip.hip IN (11767, 27989, 26727)
```

(Schema/table names sometimes change slightly between Archive releases — if this fails, open the **Gaia DR3 data model** in the archive and search for `hipparcos2`.)

---

## 3) VizieR (CDS) — TAP / browser

**Portal:** [VizieR](https://vizier.cds.unistra.fr/viz-bin/VizieR)  
**TAP endpoint:** `https://vizier.cds.unistra.fr/viz-bin/tap`

You can query **`I/355/gaiadr3`** (Gaia DR3) and restrict by uploaded coordinates, or use a **pre-joined** Hipparcos table:

- **`I/239/hip_main`** — Hipparcos mean astrometry (good for sanity checks).
- For **Gaia + HIP** in one go, prefer the **Gaia Archive** query above; VizieR is best when you want **FTP/TSV** or many catalogues at once.

**Cone search ADQL pattern** (VizieR — adjust table/column names to the chosen VizieR table):

```sql
SELECT TOP 500 *
FROM "I/355/gaiadr3"
WHERE 1=CONTAINS(POINT('ICRS', ra, dec),
                 CIRCLE('ICRS', 83.822083, -5.391111, 0.0003))
```

(`ra`/`dec` in degrees; radius in degrees — here ~1.1 arcsec.)

---

## 4) Plugging into *this* game

### A) Live overrides (stick figures only)

`space.js` loads **`data/constellation-gaia-dr3.json`** (optional). Format:

```json
{
  "hips": {
    "54061": { "ra": 165.9319937, "dec": 61.7510349 }
  }
}
```

Use **`dec`** (or **`de`**) in degrees, ICRS. Only listed HIPs get updated sky directions; parallax distances still come from `catalog-stars.json`.

### B) Full catalog rebuild

1. Run `node scripts/list-constellation-hips.cjs`.
2. Run the Gaia ADQL (section 2); export **CSV or VOTable**.
3. Extend **`scripts/build-catalog-from-vizier-tsv.cjs`** (or add `build-catalog-from-gaia.cjs`) to read **`hip`, `ra`, `dec`, `parallax`** and emit the same `catalog-stars.json` fields your `space.js` already expects (`ra`, `de` in degrees, `x,y,z` or compute `x,y,z` from unit vector × distance).

**Bright stars:** Gaia can be non-ideal for the *very* brightest objects (saturation / processing). If something looks wrong for Sirius-level stars, compare to **`I/239/hip_main`** or a dedicated bright-star list.

---

## 5) Optional: Python + `astroquery`

```bash
pip install astroquery
```

```python
from astroquery.gaia import Gaia
job = Gaia.launch_job("""
    SELECT h.hip, g.ra, g.dec, g.parallax, g.pmra, g.pmdec
    FROM gaiadr3.hipparcos2 h
    JOIN gaiadr3.gaia_source g USING (source_id)
    WHERE h.hip IN (11767, 27989)
""")
r = job.get_results()
print(r)
```

(If the schema rejects `USING`, switch to the `hipparcos2_best_neighbour` variant above.)

---

## References

- [Gaia DR3 documentation](https://www.cosmos.esa.int/web/gaia/data-release-3)
- [Gaia Archive](https://gea.esac.esa.int/archive/)
- [VizieR](https://vizier.cds.unistra.fr/)
- [SIMBAD](http://simbad.cds.unistra.fr/) (names → identifiers)
