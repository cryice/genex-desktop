"""Shared helpers for the twin operators.

Every job reads its inputs from argv, writes its declared outputs, and prints exactly one
result line `TWIN_RESULT {json}` on stdout — the plugin backend parses that line and the
host keeps the process log beside it. A job never writes outside its output directory.

Units are metres, +Z up, and every object layer is built at its own local origin (P3): world
coordinates exist only in the assembled master.
"""
import json
import sys

RESULT_PREFIX = "TWIN_RESULT "

# Metres per drawing unit, from a DXF $INSUNITS code (0 means unitless: assume metres).
DXF_INSUNITS_TO_M = {0: 1.0, 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 0.000001, 8: 0.0000254, 10: 0.9144}


def read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, value):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


def field(value, source="derived", confidence=0.7):
    """One IR field: the shell every IR number travels in."""
    return {"value": value, "source": source, "confidence": confidence}


def emit(result):
    """The one result line a job prints; exits 0 so the host sees a completed job."""
    sys.stdout.write(RESULT_PREFIX + json.dumps(result, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fail(message, **extra):
    emit({"ok": False, "error": message, **extra})
    sys.exit(0)


def require_pxr():
    try:
        from pxr import Usd, UsdGeom
        return Usd, UsdGeom
    except Exception as error:  # pragma: no cover - depends on the machine
        fail("pxr (OpenUSD) is not importable in this Python: %s" % error)


def require_shapely():
    try:
        from shapely.geometry import Polygon
        return Polygon
    except Exception as error:  # pragma: no cover
        fail("shapely is not importable in this Python: %s" % error)


def ring_points(ring):
    """An IR ring as (x, y) tuples, dropping a repeated last point."""
    points = [(float(p["x"]), float(p["y"])) for p in ring]
    if len(points) > 1 and points[0] == points[-1]:
        points.pop()
    return points


def prim_name(text):
    """A prim-safe name: USD paths take letters, digits and underscores only."""
    import re

    cleaned = re.sub(r"[^A-Za-z0-9_]", "_", str(text))
    return cleaned or "prim"


def ring_polygon(ring):
    return require_shapely()(ring_points(ring))


def triangulate(polygon):
    """Triangles covering a (possibly non-convex) polygon, via earcut.

    Returns triangles as coordinate triples: earcut's indices span the outer ring and the holes
    concatenated, so the points are resolved here, once, against that combined array.
    """
    import numpy as np

    import mapbox_earcut as earcut

    rings = [np.asarray(polygon.exterior.coords[:-1], dtype=np.float64)]
    rings.extend(np.asarray(hole.coords[:-1], dtype=np.float64) for hole in polygon.interiors)
    vertices = np.ascontiguousarray(np.vstack(rings))
    ring_ends = np.cumsum([len(ring) for ring in rings]).astype(np.uint32)
    indices = earcut.triangulate_float64(vertices, ring_ends)
    return [(vertices[int(indices[i])], vertices[int(indices[i + 1])], vertices[int(indices[i + 2])]) for i in range(0, len(indices), 3)]


def _bind_material(mesh, path, slot, face_count):
    """One material slot as a GeomSubset bound to the `materialBind` family."""
    _, UsdGeom = require_pxr()
    if not slot or face_count == 0:
        return
    subset = UsdGeom.Subset.Define(mesh.GetPrim().GetStage(), "%s/%s" % (path, slot))
    subset.CreateElementTypeAttr().Set(UsdGeom.Tokens.face)
    subset.CreateIndicesAttr().Set(list(range(face_count)))
    subset.CreateFamilyNameAttr("materialBind")


def mesh_from_polygon(stage, path, polygon, y, material_slot="default"):
    """Flat meshes at height `y` covering `polygon`, with metric UVs and material subsets.

    The ring's (x, y) are the stage's X and Y; `y` here is the elevation, which is Z. A
    multi-part geometry (a buffer difference, a landscape remainder) becomes one mesh per part,
    suffixed `_0`, `_1`, … on the same path.
    """
    Usd, UsdGeom = require_pxr()
    from pxr import Sdf

    parts = list(polygon.geoms) if hasattr(polygon, "geoms") else [polygon]
    meshes = []
    for index, part in enumerate(parts):
        if part.is_empty or part.area <= 1e-9:
            continue
        suffix = "" if len(parts) == 1 else "_%d" % index
        mesh = UsdGeom.Mesh.Define(stage, path + suffix)
        points, counts, indices, uvs = [], [], [], []
        for triangle in triangulate(part):
            base = len(points)
            for x, ring_y in triangle:
                points.append((float(x), float(ring_y), y))
                uvs.append((float(x), float(ring_y)))
            counts.append(3)
            indices.extend([base, base + 1, base + 2])
        mesh.CreatePointsAttr(points)
        mesh.CreateFaceVertexCountsAttr(counts)
        mesh.CreateFaceVertexIndicesAttr(indices)
        st = UsdGeom.PrimvarsAPI(mesh.GetPrim()).CreatePrimvar("st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.faceVarying)
        st.Set(uvs)
        mesh.CreateSubdivisionSchemeAttr().Set("none")
        _bind_material(mesh, path + suffix, material_slot, len(counts))
        meshes.append(mesh)
    return meshes


def box(stage, path, size, center, material_slot="default"):
    """An axis-aligned box mesh as triangles: size (dx, dy, dz), center (x, y, z)."""
    Usd, UsdGeom = require_pxr()

    mesh = UsdGeom.Mesh.Define(stage, path)
    dx, dy, dz = (s / 2.0 for s in size)
    cx, cy, cz = center
    corners = [
        (cx - dx, cy - dy, cz - dz), (cx + dx, cy - dy, cz - dz),
        (cx + dx, cy + dy, cz - dz), (cx - dx, cy + dy, cz - dz),
        (cx - dx, cy - dy, cz + dz), (cx + dx, cy - dy, cz + dz),
        (cx + dx, cy + dy, cz + dz), (cx - dx, cy + dy, cz + dz),
    ]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    points, counts, indices = [], [], []
    for face in faces:
        base = len(points)
        points.extend(corners[i] for i in face)
        counts.extend([3, 3])
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    mesh.CreatePointsAttr(points)
    mesh.CreateFaceVertexCountsAttr(counts)
    mesh.CreateFaceVertexIndicesAttr(indices)
    mesh.CreateSubdivisionSchemeAttr().Set("none")
    _bind_material(mesh, path, material_slot, len(counts))
    return mesh


def new_stage(path, meters_per_unit=1.0):
    """A stage with the twin's global conventions written down: metres, Z-up, a /World root.

    The root is also the layer's defaultPrim, so a composition arc that names no target prim
    resolves to it.
    """
    Usd, UsdGeom = require_pxr()
    stage = Usd.Stage.CreateNew(path)
    UsdGeom.SetStageMetersPerUnit(stage, meters_per_unit)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    return stage


def extent_of(mesh):
    """The world bounds of a mesh prim, as (min, max)."""
    bounds = mesh.ComputeWorldBound(0.0, "default")
    aligned = bounds.ComputeAlignedBox()
    return tuple(aligned.GetMin()), tuple(aligned.GetMax())


def face_count(mesh):
    counts = mesh.GetFaceVertexCountsAttr().Get()
    return len(counts) if counts else 0


def card_argv():
    """argv as (card path, output path, kind): every operator job takes the same three."""
    if len(sys.argv) < 3:
        fail("usage: <job>.py <input> <output> [kind]")
    card = sys.argv[1]
    out = sys.argv[2]
    kind = sys.argv[3] if len(sys.argv) > 3 else "building"
    return card, out, kind
