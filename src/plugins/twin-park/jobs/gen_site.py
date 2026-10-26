"""Build the site layer (paradigm 1 supplement): roads, kerbs, markings, landscape, terrain.

The master plan's centerlines become pavement by buffer-union; kerbs are the ring between the
pavement's buffer and a slightly wider one; landscape is the plots minus the buildings minus the
roads, by difference, so there is no seam between the green and the built. Everything is flat at
its own height in the site's local frame — terrain relief arrives with the orthophoto adapter
(P2); a flat site is the rule baseline.
"""
import sys

from common import box, emit, fail, mesh_from_polygon, new_stage, prim_name, read_json, ring_polygon

# The kerb's width beyond the pavement edge, and its height.
KERB_WIDTH_M = 0.15
KERB_HEIGHT_M = 0.15
# The pavement's thickness above grade.
PAVEMENT_Y = 0.02
# The landscape's height above grade.
LANDSCAPE_Y = 0.01
# Markings: dash length, gap and width.
DASH_M = 2.0
DASH_GAP_M = 4.0
MARKING_WIDTH_M = 0.12
# The most faces the site layer may carry.
FACE_BUDGET = 60000


def _polyline_buffer(points, radius):
    """A Shapely polygon around a polyline, with round caps at the ends."""
    from shapely.geometry import LineString

    return LineString(points).buffer(radius, cap_style=1)


def _dashes(stage, root, points):
    """Centre-line dashes along a polyline."""
    from shapely.geometry import LineString

    line = LineString(points)
    travelled = 0.0
    index = 0
    while travelled < line.length:
        start = line.interpolate(travelled)
        end = line.interpolate(min(travelled + DASH_M, line.length))
        centre = line.interpolate((travelled + min(travelled + DASH_M, line.length)) / 2)
        box(stage, "%s/Marking_%03d" % (root, index), (MARKING_WIDTH_M, DASH_M, 0.02), (centre.x, PAVEMENT_Y + 0.02, centre.y), "marking")
        travelled += DASH_M + DASH_GAP_M
        index += 1


def build(stage, ir):
    from shapely.ops import unary_union

    plan = ir.get("masterPlan") or {}
    red_line = plan.get("redLine")
    if not red_line:
        fail("the IR carries no master plan: run the solver first")
    site = "%s/Site" % "/World"
    from pxr import UsdGeom

    UsdGeom.Xform.Define(stage, site)
    mesh_from_polygon(stage, "%s/Terrain" % site, ring_polygon(red_line), 0.0, "terrain")

    roads_scope = "%s/Roads" % site
    UsdGeom.Xform.Define(stage, roads_scope)
    pavements = []
    for road in plan.get("roads") or []:
        points = [(float(p["x"]), float(p["y"])) for p in road["points"]]
        half = float(road.get("widthM") or 7.0) / 2
        pavement = _polyline_buffer(points, half)
        pavements.append(pavement)
        road_root = "%s/%s" % (roads_scope, prim_name(road.get("id") or "road"))
        UsdGeom.Xform.Define(stage, road_root)
        mesh_from_polygon(stage, "%s/Pavement" % road_root, pavement, PAVEMENT_Y, "asphalt")
        kerb = _polyline_buffer(points, half + KERB_WIDTH_M).difference(pavement)
        if not kerb.is_empty:
            mesh_from_polygon(stage, "%s/Kerb" % road_root, kerb, PAVEMENT_Y + KERB_HEIGHT_M, "concrete")
        _dashes(stage, road_root, points)

    green_scope = "%s/Landscape" % site
    UsdGeom.Xform.Define(stage, green_scope)
    plots = unary_union([ring_polygon(plot["ring"]) for plot in plan.get("plots") or []]) if plan.get("plots") else None
    if plots is not None and not plots.is_empty:
        built = unary_union([ring_polygon(outline["ring"]).buffer(1.0) for outline in plan.get("buildingOutlines") or []]) if plan.get("buildingOutlines") else None
        green = plots.difference(built) if built is not None else plots
        green = green.difference(unary_union(pavements).buffer(0.5)) if pavements else green
        if not green.is_empty:
            parts = list(green.geoms) if hasattr(green, "geoms") else [green]
            for index, part in enumerate(parts):
                if part.area > 1.0:
                    mesh_from_polygon(stage, "%s/Green_%03d" % (green_scope, index), part, LANDSCAPE_Y, "green")
    return {"roads": len(plan.get("roads") or []), "greenParts": len(list(green.geoms)) if plots is not None and not green.is_empty else 0}


def qa(stage):
    from pxr import UsdGeom

    issues = []
    meshes = [prim for prim in stage.Traverse() if prim.IsA(UsdGeom.Mesh)]
    if not meshes:
        issues.append("no mesh in the site layer")
        return issues, 0
    faces = 0
    z_min = None
    for prim in meshes:
        mesh = UsdGeom.Mesh(prim)
        counts = mesh.GetFaceVertexCountsAttr().Get()
        faces += len(counts) if counts else 0
        bounds = mesh.ComputeWorldBound(0.0, "default").ComputeAlignedBox()
        low = bounds.GetMin()
        z_min = low[2] if z_min is None else min(z_min, low[2])
    if z_min is not None and z_min > 0:
        issues.append("Z_min %.2f is above grade" % z_min)
    if faces > FACE_BUDGET:
        issues.append("faces %d over the budget %d" % (faces, FACE_BUDGET))
    return issues, faces


def main():
    if len(sys.argv) < 3:
        fail("usage: gen_site.py <ir.json> <site.usdc>")
    ir = read_json(sys.argv[1])
    stage = new_stage(sys.argv[2])
    built = build(stage, ir)
    issues, faces = qa(stage)
    stage.Save()
    emit({"ok": len(issues) == 0, "faces": faces, "built": built, "qa": issues, "degraded": False})


main()
