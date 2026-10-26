# Twin template contract

This project is a **digital twin scene** (a park, a city district or a workshop), not a game. It
is built by the `twin-park` plugin's operators and viewed here.

## The shape

- `park.json` — the scene list for this page: scene class, the USD stage it came from, the site's
  local frame (CGCS2000), the exported assets, the live bindings and the render targets.
- `catalog/` — the element catalog: one engineering spec per element type (lamp specs, road
  cross-sections, building templates). Instances are made from catalog entries; the catalog is
  data, never geometry.
- `src/main.js` — the page entry: Babylon engine, camera, lights, asset loading, render loop.
- `src/park.js` — the manifest readers (`isParkManifest` is the gate).
- `src/iot.js` — the live side: device properties drive scene targets through `park.json`'s
  bindings. The transport is one configurable line (`feed`); the protocol is the gateway's.
- `src/studio.js` — the studio contract: `state()`, `scene()`, `cameras()`, `setFloor()`,
  `setTimeOfDay()`. Extend it; never remove a method — the harness calls them.

## Rules an agent building here follows

1. **Parameters, not vertices.** Describe elements in the IR (`src/shared/twin-ir.ts`) and let
   the operators generate geometry. Never hand-place a mesh where a catalog entry exists.
2. **Local origin, metre units, +Z up.** Every asset is modelled at its own origin; the page
   places it from the manifest. The site frame is CGCS2000, converted by `georeference`.
3. **Tags are the contract.** Every loaded asset carries its element id as `twinTag` (and its
   floor as `twinFloor` for the drawer). The scene checks read those tags.
4. **Bindings travel with the scene.** A binding in `park.json` has a twin in
   `twin_manifest.json` (`twin:bindingKey`) for UE5 and the business systems — write it once.
5. **Degrade, never block.** A missing asset is an empty slot with a note, not a dead page.

## Never remove a method

`window.__studio`'s methods are the harness's handles on this page. Adding is expected;
removing breaks the checks silently.
