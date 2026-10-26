"""Rebuild one object's .usdc layer from its IR task card (paradigm 1 and paradigm 3).

Paradigm 1 (a building, ~60% of a park): the card's footprint ring is extruded floor by floor —
plinth at -2.0 m so no skirt floats, one drawer floor per storey, facade walls by material slot
with metric UVs, a parapet on the roof. Paradigm 3 (an asset, ~15%): a catalog entry's
parameters build the prototype (a lamp, a tree, a bench) base-aligned to zero.

The layer is written at the object's local origin (P3); the assemble job places it. Every run
ends with the Q2 box QA: bounds against the card, Z_min at or below zero, a face budget and
material slots bound — a failure is reported, and the caller decides between a rerun and a
degraded rule baseline.
"""
import math
import sys

try:
    from pxr import Sdf, Usd, UsdGeom
except Exception as error:  # pragma: no cover - depends on the machine
    from common import fail

    fail("pxr (OpenUSD) is not importable in this Python: %s" % error)

from common import _bind_material, box, card_argv, emit, extent_of, face_count, fail, new_stage, prim_name, read_json, ring_points, ring_polygon

# The plinth's depth below grade: a building never floats on its skirt.
PLINTH_DEPTH_M = 2.0
PLINTH_OUTSET_M = 0.4
# The roof parapet's height.
PARAPET_M = 1.1
# The slab's thickness.
SLAB_M = 0.3
# The most faces one object layer may carry before it is a rerun, not a delivery.
FACE_BUDGET = 20000
# How far the built bounds may sit from the card's numbers, in metres.
BOUNDS_TOLERANCE_M = 0.05
# Sides of an upright cylinder in an asset prototype.
CYLINDER_SIDES = 12


def _wall(stage, path, a, b, z0, z1, slot):
    """One vertical wall between two ring points, as two triangles with metric UVs.

    The ring's (x, y) are the stage's X and Y; z0 and z1 are elevations, which are Z.
    """
    mesh = UsdGeom.Mesh.Define(stage, path)
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    mesh.CreatePointsAttr([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)])
    mesh.CreateFaceVertexCountsAttr([3, 3])
    mesh.CreateFaceVertexIndicesAttr([0, 1, 2, 0, 2, 3])
    st = UsdGeom.PrimvarsAPI(mesh.GetPrim()).CreatePrimvar("st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.faceVarying)
    st.Set([(0.0, z0), (length, z0), (length, z1), (0.0, z1)])
    mesh.CreateSubdivisionSchemeAttr().Set("none")
    _bind_material(mesh, path, slot, 2)
    return mesh


def _cylinder(stage, path, radius, height, center_xy, slot="default"):
    """A low-poly upright cylinder standing on its base z."""
    cx, cz = center_xy
    mesh = UsdGeom.Mesh.Define(stage, path)
    points = []
    for z in (cz, cz + height):
        for index in range(CYLINDER_SIDES):
            angle = 2 * math.pi * index / CYLINDER_SIDES
            points.append((cx + radius * math.cos(angle), z, cz + radius * math.sin(angle)))
    counts, indices = [], []
    for index in range(CYLINDER_SIDES):
        nxt = (index + 1) % CYLINDER_SIDES
        counts.extend([3, 3])
        indices.extend([index, nxt, CYLINDER_SIDES + nxt, index, CYLINDER_SIDES + nxt, CYLINDER_SIDES + index])
    mesh.CreatePointsAttr(points)
    mesh.CreateFaceVertexCountsAttr(counts)
    mesh.CreateFaceVertexIndicesAttr(indices)
    mesh.CreateSubdivisionSchemeAttr().Set("none")
    _bind_material(mesh, path, slot, len(counts))
    return mesh


def build_building(stage, root, card):
    """Paradigm 1: extrude the card's footprint ring floor by floor."""
    ring = card.get("ring")
    if not ring or len(ring) < 3:
        fail("the card carries no footprint ring", objectId=card.get("objectId"))
    polygon = ring_polygon(ring)
    if not polygon.is_valid or polygon.area <= 1.0:
        fail("the card's footprint ring is degenerate", objectId=card.get("objectId"))
    xs = [p[0] for p in polygon.exterior.coords]
    ys = [p[1] for p in polygon.exterior.coords]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    dx, dy = max(xs) - min(xs), max(ys) - min(ys)
    floors = max(1, int(card.get("floors") or 1))
    cap = float(card.get("heightCapM") or 0) or floors * 3.6
    storey = cap / floors

    skirt = "%s/BaseAndSkirt" % root
    UsdGeom.Xform.Define(stage, skirt)
    box(stage, "%s/Plinth" % skirt, (dx + 2 * PLINTH_OUTSET_M, dy + 2 * PLINTH_OUTSET_M, PLINTH_DEPTH_M), (cx, cy, -PLINTH_DEPTH_M / 2), "concrete")

    floors_scope = "%s/Floors" % root
    UsdGeom.Xform.Define(stage, floors_scope)
    cycle = ring_points(ring)
    cycle.append(cycle[0])
    for index in range(floors):
        number = index + 1
        z0 = index * storey
        floor = "%s/F%02d" % (floors_scope, number)
        UsdGeom.Xform.Define(stage, floor)
        box(stage, "%s/Slab" % floor, (dx, dy, SLAB_M), (cx, cy, z0 + SLAB_M / 2), "concrete")
        for edge in range(len(cycle) - 1):
            _wall(stage, "%s/Facade_%02d" % (floor, edge), cycle[edge], cycle[edge + 1], z0, z0 + storey, "facade" if edge % 2 == 0 else "facade_alt")

    roof = "%s/Roof" % root
    UsdGeom.Xform.Define(stage, roof)
    for edge in range(len(cycle) - 1):
        _wall(stage, "%s/Parapet_%02d" % (roof, edge), cycle[edge], cycle[edge + 1], cap, cap + PARAPET_M, "parapet")
    return {"floors": floors, "storeyM": round(storey, 3), "footprintM2": round(polygon.area, 2)}


def build_asset(stage, root, card, params):
    """Paradigm 3: a catalog entry's parameters build the prototype, base-aligned to zero."""
    element = card.get("element")
    if element == "lamp":
        pole = float(params.get("poleHeightM", 9))
        arm = float(params.get("armLengthM", 1.5))
        radius = float(params.get("baseRadiusM", 0.18))
        _cylinder(stage, "%s/Pole" % root, radius, pole, (0, 0), "metal")
        box(stage, "%s/Arm" % root, (arm, 0.12, 0.12), (arm / 2, 0, pole - 0.2), "metal")
        box(stage, "%s/Head" % root, (0.5, 0.3, 0.16), (arm, 0, pole - 0.32), "emissive")
        box(stage, "%s/Base" % root, (0.5, 0.5, 0.3), (0, 0, 0.15), "concrete")
    elif element == "tree":
        _cylinder(stage, "%s/Trunk" % root, 0.15, 2.4, (0, 0), "bark")
        box(stage, "%s/Canopy" % root, (3.2, 3.2, 3.6), (0, 0, 4.2), "foliage")
    elif element == "bench":
        box(stage, "%s/Seat" % root, (1.8, 0.55, 0.12), (0, 0, 0.45), "timber")
        box(stage, "%s/Back" % root, (1.8, 0.12, 0.5), (0, -0.24, 0.72), "timber")
        for side in (-0.6, 0.6):
            box(stage, "%s/Leg%s" % (root, "L" if side < 0 else "R"), (0.12, 0.45, 0.45), (side, 0, 0.225), "metal")
    else:
        size = float(params.get("sizeM", 2))
        box(stage, "%s/Body" % root, (size, size, size), (0, 0, size / 2), "default")
    return {"element": element}


def qa_object(stage, card):
    """The Q2 box QA on one layer: bounds, Z_min, faces, material slots.

    The plinth is allowed its outset below grade, so the bounds check expects it and the height
    check reads the top elevation against the cap.
    """
    issues = []
    mesh_prims = [prim for prim in stage.Traverse() if prim.IsA(UsdGeom.Mesh)]
    if not mesh_prims:
        return ["no mesh in the layer"], 0
    faces = sum(face_count(UsdGeom.Mesh(prim)) for prim in mesh_prims)
    mins, maxs = [], []
    for prim in mesh_prims:
        low, high = extent_of(UsdGeom.Mesh(prim))
        mins.append(low)
        maxs.append(high)
    z_min = min(m[2] for m in mins)
    top = max(m[2] for m in maxs)
    cap = float(card.get("heightCapM") or 0)
    ring = card.get("ring") or []
    if ring:
        xs = [float(p["x"]) for p in ring]
        ys = [float(p["y"]) for p in ring]
        outset = PLINTH_OUTSET_M + BOUNDS_TOLERANCE_M
        if min(m[0] for m in mins) < min(xs) - outset or max(m[0] for m in maxs) > max(xs) + outset:
            issues.append("built width leaves the footprint ring")
        if min(m[1] for m in mins) < min(ys) - outset or max(m[1] for m in maxs) > max(ys) + outset:
            issues.append("built depth leaves the footprint ring")
    if z_min > 0:
        issues.append("Z_min %.2f is above grade" % z_min)
    if cap > 0 and abs(top - (cap + PARAPET_M)) > max(1.0, cap * 0.05):
        issues.append("top %.2f leaves the cap %.2f plus its parapet" % (top, cap))
    if faces > FACE_BUDGET:
        issues.append("faces %d over the budget %d" % (faces, FACE_BUDGET))
    slots = [prim for prim in stage.Traverse() if prim.IsA(UsdGeom.Subset)]
    if not slots:
        issues.append("no material slot bound")
    return issues, faces


def main():
    card_path, out, kind = card_argv()
    card = read_json(card_path)
    object_id = card.get("objectId") or "object"
    stage = new_stage(out)
    root = "/World/%s" % object_id
    UsdGeom.Xform.Define(stage, root)
    if kind == "asset":
        built = build_asset(stage, root, card, card.get("params") or {})
    else:
        built = build_building(stage, root, card)
    issues, faces = qa_object(stage, card)
    stage.Save()
    emit({"ok": len(issues) == 0, "objectId": object_id, "kind": kind, "faces": faces, "built": built, "qa": issues, "degraded": False})


main()
