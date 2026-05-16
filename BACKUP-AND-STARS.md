# Backup

- **Full folder backup** (recommended): `Interstellar-Game-BACKUP-2026-02-21` on your Desktop is a copy of this entire project (created with `robocopy`). Use it to restore if something breaks.
- **Single ZIP**: Close `npx serve`, Cursor, and anything that has files open, then in PowerShell run:
  ```powershell
  Compress-Archive -Path 'C:\Users\Nikolai\Desktop\Game\*' -DestinationPath 'C:\Users\Nikolai\Desktop\Interstellar-Game.zip' -Force
  ```
  Restore by unzipping to a new folder and running `npx serve` there.

# Real star sky (efficient workflow)

You do **not** need one AI prompt per star. The pipeline is:

1. **One** download from VizieR → `vendor/hip_bright_full.tsv` (see URL in `scripts/build-catalog-from-vizier-tsv.cjs`).
2. **One** command → `npm run build-stars` → writes `data/catalog-stars.json` (~5000 stars, V ≤ 6.5).
3. The game **loads that JSON once** at runtime and draws:
   - **Thousands** of Hipparcos stars as a point cloud (additive, minimum screen size so they stay visible when zoomed out).
   - **Named** stars (see `HIP_NAME` in the build script) as colored spheres + travel menu + click targets.

To add more names: edit `HIP_NAME` in `scripts/build-catalog-from-vizier-tsv.cjs`, then run `npm run build-stars` again.

# Milky Way

The **procedural Milky Way background** (sky dome shader) is unchanged. Only the **fake random star points** were removed in favor of the real catalog.

# License

HYG/Hipparcos-derived data: respect VizieR / ESA Hipparcos terms; HYG database is CC BY-SA (see Astronomy Nexus).
