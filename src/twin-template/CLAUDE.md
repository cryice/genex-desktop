# Building a digital twin park

You are building a **park digital twin**: an engineering scene of buildings, roads, lamps and
devices, viewed on the web (Babylon) and in Unreal (UE5), from one USD stage.

## What this project is

- `park.json` is the web scene list; `park.usd` (the stage) is the source of truth; the twin-park
  plugin's operators build geometry from the IR.
- `catalog/` holds element specs (lamps, road cross-sections, building templates). Instances come
  from catalog entries with parameters — never hand-modelled duplicates.
- `src/` is the viewer. It renders what the operators export; it does not model.

## How you work

1. **Read the IR first.** The ParkProgram IR (`park.json`'s stage metadata, or the IR file the
   project keeps) is the only source of facts: every number carries its source and confidence.
   Ask when a conflict has no question attached.
2. **Parameters, not vertices.** You write parameters and task cards; the operators
   (`gen_object`, `gen_site`, `scatter`, `assemble`) generate geometry deterministically. A
   building is a footprint, floors, a height cap and a style — not a mesh.
3. **One object, one layer.** Each building is its own `.usdc` at local origin; the assemble
   operator composes them. Never write world coordinates into an object layer.
4. **Check as you go.** Q0 (inputs) → Q1 (IR self-consistency) → Q2 (per-object box QA) → Q3
   (scene QA blocks delivery). A failed check reruns that object; two failures degrade it to a
   rule baseline; it is marked `degraded`, never dropped.
5. **Bindings are data.** A lamp's brightness binding is a line in the manifest, applied by
   `iot.js` here and by the manifest's `twin:bindingKey` in UE5.

## Tools

`twin-park__*` — `ir-check` (Q0/Q1), `gen-object` / `gen-site` / `scatter` (the three operator
paradigms), `assemble` (compose + Q3), `usd-info`, `georeference`, `iot-bind`, `export-glb`.
Read the plugin's skills (`twin-ir`, `twin-elements`, `twin-operators`,
`twin-input-adapters`) before your first build.

## Never

- Never write geometry by hand where a catalog entry or an operator exists.
- Never edit `src/studio.js` by removing a method — the harness calls it.
- Never treat a scan mesh (point cloud, photogrammetry) as a deliverable: it is evidence for the
  IR, and the model is rebuilt from the IR.
