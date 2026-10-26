# Twin Studio delivery checklist

## Implemented

- Twin IR is the canonical source for engineering objects, data sources, telemetry, alarms and commands.
- Data source registration covers GIS, BIM, CAD/DWG, point clouds and IoT with metadata issues.
- Modeling targets are Blender and OpenUSD.
- Renderer targets are Babylon.js, Godot and Unreal.
- `configure-target` writes `twin-target.json`.
- `export-target` writes the engine-neutral manifest and renderer project skeletons under `exports/`.
- The project panel exposes Data, Scene and Application sections.

## Operating rules

1. Register and validate sources before generating geometry.
2. Resolve CRS, units, origin and axis before rendering.
3. Generate geometry from Twin IR; do not edit renderer output as the source of truth.
4. Keep telemetry, replay, alarms and commands separate; commands require confirmation and audit.
5. Record engine version, source IR version and export validation in delivery evidence.

## Verification

- Biome checks pass for changed TypeScript files.
- Manifest parses with Node and declares 14 tools, 21 skills and one project panel.
- China standards mapping skill covers BIM/CIM, surveying, smart-city and security references without copying protected standard text.
- Full repository typecheck currently has unrelated baseline errors in upstream provider/sandbox integration; these must be resolved before a release gate.
