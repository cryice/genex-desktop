# Twin Studio delivery checklist

## Implemented

- Twin IR is the canonical source for engineering objects, data sources, telemetry, alarms and commands.
- Data source registration covers GIS, BIM, CAD/DWG, point clouds and IoT with metadata issues.
- Modeling targets are Blender and OpenUSD.
- Renderer targets are Babylon.js, Godot and Unreal.
- `configure-target` writes `twin-target.json`.
- `export-target` writes the engine-neutral manifest and renderer project skeletons under `exports/`.
- The project panel exposes Data, Scene and Application sections.
- Godot and Babylon exports now each contain an in-project `TwinManifest.json` derived from Twin IR, with object outlines and IoT datasets. Godot reads it through `res://`; Babylon fetches it locally, so both semantic previews work before USD assembly.
- Babylon objects include their device bindings, highlight active alarms, and show bound telemetry/alarm details when selected.
- Babylon supports a read-only WebSocket IoT feed configured in `park.json`; it subscribes to the selected topic and applies matching device/property samples to bound scene targets. It never sends reverse-control commands.
- `configure-iot-feed` validates and persists the WebSocket endpoint/topic in `park.json`, `data-sources.json`, and Twin IR when present.
- Unreal's `TwinImport.json` is documented as a Genex integration contract; the USD Stage plugin opens the referenced `master_twin.usda`, while the sidecar manifests preserve semantic IDs and operations.

## Operating rules

1. Register and validate sources before generating geometry.
2. Resolve CRS, units, origin and axis before rendering.
3. Generate geometry from Twin IR; do not edit renderer output as the source of truth.
4. Keep telemetry, replay, alarms and commands separate; commands require confirmation and audit.
5. Record engine version, source IR version and export validation in delivery evidence.

## Verification

- Biome checks pass for changed TypeScript files.
- Manifest parses with Node and declares 16 tools, 23 skills and one project panel.
- China standards mapping skill covers BIM/CIM, surveying, smart-city and security references without copying protected standard text.
- `validate-data-sources` applies metadata gates before renderer export and records `ready` or `needs-metadata` status per source.
- Ten iterations are recorded in [`iteration-plan.md`](./iteration-plan.md), including evidence and release follow-ups.

## Release evidence still required

- Blender 5.2.1 LTS USD-to-GLB conversion was verified locally using the repository job script; the output re-imported as one `test-building` mesh with 24 vertices. Raw fixture and output are retained under ignored `.studio-dev/evidence/twin-blender-probe/`.
- On a machine with Unreal installed, open `exports/unreal/TwinImport.json`, import the referenced USD layer, and record the engine version and result in the project evidence.
- On a machine with Godot 4 installed, open `exports/godot/project.godot`, run the project and record the engine version and result.
- For offline Babylon delivery, replace the generated CDN script with a pinned project asset and record the Babylon.js version and license in `THIRD-PARTY-NOTICES.md`.
- Resolve the existing upstream provider/sandbox TypeScript errors before treating the repository typecheck as a release gate.
- Full repository typecheck currently has unrelated baseline errors in upstream provider/sandbox integration; these must be resolved before a release gate.
