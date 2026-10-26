# Twin Plan — the harness loop for a digital twin scene

This is the **director plan** for building a park / city / workshop twin. It is the order the
harness must follow, and the gates that stop it. Read `twin-ir`, `twin-elements`, `twin-operators`,
`twin-input-adapters`, `gis-alignment`, `iot-binding` and `park-standards` first — this plan assumes
their vocabulary.

## The one rule

**Model nothing until the IR is written and self-consistent.** A digital twin is not a mesh you
sculpt; it is a program (`ir.json`) the deterministic operators rebuild. The IR is the contract; the
geometry is a side effect. The `run.prepare` and `finish` hooks run `ir-check` and **block** the build
while the IR fails Q1 self-consistency (ARCH-01 Q1): land-use ratios sum to 1, the zone building
counts agree with the master plan, the tallest building's zone exists, and any conflict carries a
question to the person.

## The loop

1. **Scaffold** — `new-park {sceneClass}` places `park.json`, the Babylon preview, the catalog and the
   contract docs. `sceneClass` is `park | city | workshop`; the scaffold's facts decide which
   `twin-*` fact detects the project.
2. **Brief (J1)** — from the person's words, a plan image, a DWG or a GIS export, decide the program:
   site area, FAR, coverage, max height, land-use zones (each with a ratio and a building count), and
   the key elements. Write nothing yet.
3. **Master plan (J2)** — lay out the red line, plots, road centerlines and building outlines (each
   outline: plot, ring, height, floors, zone). This is the geometry's skeleton; the operators turn
   it into roads and pads.
4. **Objects (J3)** — enumerate every scene object with its engineering element
   (`building`, `road`, `lamp-pole`, `luminaire`, `camera`, `pipe`, `valve`, …) and, for parametric
   objects, its parameters. One object, one layer, at local origin.
5. **Write the IR** — `gen-ir {program}`. The tool wraps every number into a provenance `Field`
   (source `llm`), derives the scene class and the georef, and runs Q1. It writes `ir.json`
   regardless and reports any issue. If issues come back, fix the brief and rerun — **do not** reach
   for a geometry tool while Q1 fails.
6. **Georeference** (when coordinates are known) — `georeference {lat, lon, heightM}` pins the site's
   CGCS2000 local ENU frame; every layer is built around it. A twin that is not georeferenced is a
   diorama (see `gis-alignment`).
7. **Rebuild geometry** — only now, and only per object:
   - `gen-object {object}` for each building / landmark (paradigm 1 parametric, or paradigm 3 asset
     completion); a failure degrades to a rule baseline and marks the object `degraded`.
   - `gen-site` for roads, kerbs, landscape and terrain from the master plan.
   - `scatter` for catalog instances (lamps, trees, furniture) as PointInstancers.
   These may run as `twin_modeler` / `twin_site` / `twin_scatter` workers in parallel — each reads
   the IR, none invents geometry.
8. **Assemble** — `assemble` composes `master_twin.usda` (composition arcs and world transforms
   only), the `twin_manifest.json` (binding keys, material map) and the Q3 scene QA that **blocks
   delivery** on a broken scene.
9. **Bind (optional)** — `iot-bind` links a device to a scene target; one binding serves the web
   route and UE5's manifest keys (see `iot-binding`).
10. **Deliver** — `export-glb {object}` for the web route. UE5 consumes the USD directly via
    Interchange. The `finish` hook re-runs `ir-check`; if Q1 still fails the delivery is held back.

## What the harness must not do

- Do not hand-model meshes. If a source is a scanned point cloud or mesh, treat it as **evidence
  only**; rebuild from IR. Scanned meshes are never deliverables.
- Do not edit `ir.json` by hand to silence the gate. Fix the brief and rerun `gen-ir`; the gate is
  catching a real inconsistency.
- Do not run a geometry tool before `gen-ir` has written a Q1-clean `ir.json`. The hooks will block
  the build anyway, and a partial scene is harder to debug than a clean IR.

## How the gate reads

`ir-check` is a **harness-only** tool (agents never call it directly). The manifest `hooks` fire it at
`run.prepare`, `checkpoint.before` and `finish`. When the IR is inconsistent it answers `{ block:
reason, note: allIssues }` and Genex holds the moment back before any file changes; when clean it
answers `{}` and the moment proceeds. A `note` with the full issue list is attached so the harness can
see exactly what to fix.
