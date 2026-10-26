"""Build the instancer layers (paradigm 2): catalog instances as PointInstancers.

Lamps ride the roads at the catalog's spacing, trees fill the landscape at a density, benches
and signs follow the plots — each element type is ONE PointInstancer prim whose prototypes are
referenced, so ten thousand lamps are one prim and UE5 merges them into hardware instances.
Devices carry a binding key on their prototype, which is what `twin_manifest.json` and the IoT
route read.

Scatter rules live in the IR (`ir.scatter`); with none, the defaults here are the rule baseline:
lamps every 30 m along the roads, one tree per 400 m² of landscape.
"""
import math
import sys

try:
    from pxr import Gf, Sdf, UsdGeom
except Exception as error:  # pragma: no cover - depends on the machine
    from common import fail

    fail("pxr (OpenUSD) is not importable in this Python: %s" % error)

from common import emit, fail, new_stage, prim_name, read_json, ring_polygon

# Default lamp spacing along a road, and its offset from the pavement edge.
LAMP_SPACING_M = 30.0
LAMP_OFFSET_M = 1.2
# Default tree density: one per this many square metres of landscape.
TREE_PER_M2 = 1.0 / 400.0
# The deterministic jitter's seed, so a scattered scene never looks gridded but always rebuilds.
JITTER_SEED = 20261021
# The grid a landscape scatter walks, in metres.
SCATTER_STEP_M = 6.0
# The most instances one instancer may carry.
INSTANCE_BUDGET = 100000


def _rules(ir):
    """The scatter rules, or the rule baseline when the IR names none."""
    scatter = ir.get("scatter")
    if isinstance(scatter, list) and scatter:
        return scatter
    return [
        {"element": "lamp", "along": "roads", "spacingM": LAMP_SPACING_M, "offsetM": LAMP_OFFSET_M, "catalog": "lamp-spec-a", "device": True},
        {"element": "tree", "over": "landscape", "densityPerM2": TREE_PER_M2, "catalog": "tree-default", "device": False},
    ]


def _jitter(index):
    """A deterministic ±0.4 jitter."""
    state = (JITTER_SEED + index * 2654435761) % 4294967296
    return ((state / 4294967296) - 0.5) * 0.8


def _yaw_quaternion(yaw):
    """A Y-rotation as a quaternion, the form a PointInstancer takes."""
    half = yaw / 2.0
    return Gf.Quath(0.0, math.sin(half), 0.0, math.cos(half))


def _lamp_instances(rule, plan):
    """Instances along every road centerline at the rule's spacing, facing along the road."""
    instances = []
    spacing = float(rule.get("spacingM") or LAMP_SPACING_M)
    offset = float(rule.get("offsetM") or LAMP_OFFSET_M)
    for road in plan.get("roads") or []:
        points = [(float(p["x"]), float(p["y"])) for p in road["points"]]
        for segment in range(len(points) - 1):
            ax, ay = points[segment]
            bx, by = points[segment + 1]
            length = math.hypot(bx - ax, by - ay)
            if length <= 0:
                continue
            yaw = math.atan2(by - ay, bx - ax)
            travelled = spacing / 2
            while travelled < length:
                t = travelled / length
                x, y = ax + (bx - ax) * t, ay + (by - ay) * t
                instances.append(
                    {
                        "position": (x - offset * math.sin(yaw), y + offset * math.cos(yaw), 0.0),
                        "orientation": _yaw_quaternion(yaw),
                    }
                )
                travelled += spacing
    return instances


def _tree_instances(rule, plan):
    """Instances scattered over the landscape at the rule's density."""
    from shapely.geometry import Point

    density = float(rule.get("densityPerM2") or TREE_PER_M2)
    chance = density * SCATTER_STEP_M * SCATTER_STEP_M
    plots = [ring_polygon(plot["ring"]) for plot in plan.get("plots") or []]
    built = [ring_polygon(outline["ring"]).buffer(2.0) for outline in plan.get("buildingOutlines") or []]
    instances = []
    index = 0
    for plot in plots:
        min_x, min_y, max_x, max_y = plot.bounds
        y = min_y
        while y < max_y:
            x = min_x
            while x < max_x:
                point = Point(x, y)
                if plot.contains(point) and not any(area.contains(point) for area in built) and (index * 7919) % 1000 < chance * 1000:
                    instances.append(
                        {
                            "position": (x + _jitter(index), y + _jitter(index + 1), 0.0),
                            "orientation": _yaw_quaternion(_jitter(index) * math.pi),
                        }
                    )
                x += SCATTER_STEP_M
                index += 1
            y += SCATTER_STEP_M
    return instances


def build(stage, ir):
    """One PointInstancer per element type, prototypes referenced with their binding keys."""
    plan = ir.get("masterPlan") or {}
    UsdGeom.Xform.Define(stage, "/World")
    UsdGeom.Xform.Define(stage, "/World/Protos")
    scope = "/World/Instancers"
    UsdGeom.Xform.Define(stage, scope)
    counts = {}
    for rule in _rules(ir):
        element = rule.get("element") or "lamp"
        catalog = rule.get("catalog") or ("%s-default" % element)
        proto_name = prim_name(catalog)
        proto_path = "/World/Protos/%s" % proto_name
        proto = UsdGeom.Xform.Define(stage, proto_path)
        proto_prim = proto.GetPrim()
        proto_prim.CreateAttribute("twin:element", Sdf.ValueTypeNames.String).Set(element)
        if rule.get("device"):
            proto_prim.CreateAttribute("twin:bindingKey", Sdf.ValueTypeNames.String).Set(catalog)
        if rule.get("along") == "roads":
            instances = _lamp_instances(rule, plan)
        elif rule.get("over") == "landscape":
            instances = _tree_instances(rule, plan)
        else:
            instances = []
        if not instances:
            continue
        instancer = UsdGeom.PointInstancer.Define(stage, "%s/%s" % (scope, proto_name))
        instancer.CreatePrototypesRel().AddTarget(proto_path)
        instancer.CreateProtoIndicesAttr().Set([0] * len(instances))
        instancer.CreatePositionsAttr().Set([Gf.Vec3f(*instance["position"]) for instance in instances])
        instancer.CreateOrientationsAttr().Set([instance["orientation"] for instance in instances])
        counts[catalog] = len(instances)
    return counts


def main():
    if len(sys.argv) < 3:
        fail("usage: scatter.py <ir.json> <instancers.usdc>")
    ir = read_json(sys.argv[1])
    stage = new_stage(sys.argv[2])
    counts = build(stage, ir)
    stage.Save()
    total = sum(counts.values())
    emit(
        {
            "ok": True,
            "instancers": counts,
            "instances": total,
            "qa": [] if total <= INSTANCE_BUDGET else ["instances %d over the budget" % total],
            "degraded": False,
        }
    )


main()
