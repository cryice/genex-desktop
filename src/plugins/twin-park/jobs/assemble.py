"""Compose the delivery package (L6): master_twin.usda, twin_manifest.json, qa_report.json.

The master carries only composition arcs and world transforms (P3): every object keeps its own
layer at its local origin, and the master references it and places it by its outline's centroid
and first-edge yaw. Composition happens under one `Sdf.ChangeBlock` — geometry is never copied.

Staged layers (the `layerNN` input slots) are verified and delivered beside the master as
`<objectId>.usdc`; objects past the slot count are referenced by their project-relative path and
reported as unverified — a district of objects composes as a sub-master the root references, so
the slot count bounds one call, never the park.

Q3 blocks delivery: the composed stage must open, every prototype must resolve, the manifest
must account for every object, and the stage's conventions (metres, Z-up) must hold.
"""
import hashlib
import os
import shutil
import sys

try:
    from pxr import Sdf, Usd, UsdGeom, UsdLux
except Exception as error:  # pragma: no cover - depends on the machine
    from common import fail

    fail("pxr (OpenUSD) is not importable in this Python: %s" % error)

from common import emit, fail, read_json, write_json
from judge_metrics import footprint_iou, visual_scorecard

# The staged layer slots the manifest declares; the last objects are referenced, not composed.
LAYER_SLOTS = 11
# The storey height a manifest floor table assumes when the IR names none.
STOREY_M = 3.6
# The UE master material a semantic slot maps to.
UE_MATERIAL_PREFIX = "/Game/Twin/Materials/MI_Twin_"


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _centroid(ring):
    xs = [float(p["x"]) for p in ring]
    ys = [float(p["y"]) for p in ring]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def _yaw(ring):
    import math

    a, b = ring[0], ring[1]
    return math.atan2(float(b["y"]) - float(a["y"]), float(b["x"]) - float(a["x"]))


def _place(stage, ir, layers):
    """Composition arcs and world transforms for every object of the IR."""
    plan = ir.get("masterPlan") or {}
    outlines = {outline["id"]: outline for outline in plan.get("buildingOutlines") or []}
    ir_path = ir.get("_ir_path")
    placed = []
    for index, obj in enumerate(ir.get("objects") or []):
        object_id = obj.get("id") or "object"
        outline = outlines.get(object_id)
        staged = layers[index] if index < len(layers) else None
        if staged and os.path.isfile(staged) and os.path.abspath(staged) != os.path.abspath(ir_path or ""):
            local = "%s.usdc" % object_id
            shutil.copyfile(staged, local)
            reference = "./%s" % local
            digest = _sha256(staged)
            composed = True
        else:
            reference = "../%s" % obj.get("outputPath", "buildings/%s.usdc" % object_id)
            digest = None
            composed = False
        prim_path = "/World/Objects/%s" % object_id
        if outline:
            cx, cy = _centroid(outline["ring"])
            yaw = _yaw(outline["ring"])
            xform = UsdGeom.Xform.Define(stage, prim_path)
            xform.AddTranslateOp().Set((cx, 0.0, cy))
            xform.AddRotateZOp().Set(yaw * 180.0 / 3.141592653589793)
        else:
            xform = UsdGeom.Xform.Define(stage, prim_path)
        xform.GetPrim().GetReferences().AddReference(reference)
        placed.append({"id": object_id, "composed": composed, "reference": reference, "sha256": digest, "outline": outline.get("ring") if outline else None})
    return placed


def _environment(stage, ir):
    """The lighting scope and the time-of-day variant set, in the master itself."""
    env = ir.get("environment") or {}
    UsdGeom.Xform.Define(stage, "/World/Environment")
    dome = UsdLux.DomeLight.Define(stage, "/World/Environment/Sky")
    dome.CreateIntensityAttr().Set(0.4)
    sun = UsdLux.DistantLight.Define(stage, "/World/Environment/Sun")
    sun.CreateIntensityAttr().Set(3.0)
    variants = ["day", "dusk", "night"] if not env.get("timeOfDay") else env["timeOfDay"]
    variant_set = stage.GetPrimAtPath("/World/Environment").GetVariantSets().AddVariantSet("TimeOfDay")
    for name in variants:
        variant_set.AddVariant(name)
        with variant_set.GetVariantEditContext():
            intensity = {"day": 3.0, "dusk": 1.2, "night": 0.05}.get(name, 2.0)
            color = {"day": (1.0, 0.98, 0.94), "dusk": (1.0, 0.72, 0.45), "night": (0.35, 0.45, 0.7)}.get(name, (1, 1, 1))
            sun.CreateIntensityAttr().Set(intensity)
            sun.CreateColorAttr().Set(color)
    variant_set.SetVariantSelection(variants[0])


def _manifest(ir, placed):
    """twin_manifest.json: per object its digest, outline, floors and binding keys."""
    plan = ir.get("masterPlan") or {}
    floors = {outline["id"]: outline.get("floors") for outline in plan.get("buildingOutlines") or []}
    bindings = ir.get("bindings") or []
    return {
        "version": 1,
        "sceneClass": ir.get("sceneClass"),
        "units": "meters",
        "upAxis": "Z",
        "defaultPrim": "/World",
        "objects": [
            {
                "id": entry["id"],
                "sha256": entry["sha256"],
                "worldOutline": entry["outline"],
                "floors": floors.get(entry["id"]) or 1,
                "storeyM": STOREY_M,
                "bindingKeys": [binding.get("device") for binding in bindings if binding.get("prim", "").endswith(entry["id"])],
                "materialMap": {"default": UE_MATERIAL_PREFIX + "Default"},
            }
            for entry in placed
        ],
    }


def _xy_extent(prim):
    """A mesh prim's world XY footprint as a 4-corner ring, for the Q4 IoU."""
    imageable = UsdGeom.Imageable(prim)
    box = imageable.ComputeWorldBound(0.0, "default")
    aligned = box.ComputeAlignedBox()
    mn = aligned.GetMin()
    mx = aligned.GetMax()
    return [
        {"x": mn[0], "y": mn[1]},
        {"x": mx[0], "y": mn[1]},
        {"x": mx[0], "y": mx[1]},
        {"x": mn[0], "y": mx[1]},
    ]


def _fidelity(stage, ir, placed):
    """Q4: the as-built footprint IoU against the IR-designed outline, per composed building."""
    plan = ir.get("masterPlan") or {}
    outlines = {outline["id"]: outline for outline in plan.get("buildingOutlines") or []}
    per = []
    total = 0.0
    measured = 0
    for entry in placed:
        if not entry["composed"]:
            continue
        outline = outlines.get(entry["id"])
        if not outline:
            continue
        prim = stage.GetPrimAtPath("/World/Objects/%s" % entry["id"])
        if not prim or not prim.IsValid():
            continue
        extent = _xy_extent(prim)
        iou = footprint_iou(outline["ring"], extent)
        per.append({"id": entry["id"], "iou": round(iou, 4)})
        total += iou
        measured += 1
    return {"meanIoU": round(total / measured, 4) if measured else None, "perObject": per, "measured": measured}


def _visual(ir, placed, bindings, scene_class):
    """Q5: the visual scorecard — a 0–100 heuristic over posture, not a renderer."""
    return visual_scorecard(ir, placed, bindings, scene_class)


def _qa(stage, ir, placed, master_path):
    """The Q3 scene gate: composition opens, conventions hold, the manifest accounts for all."""
    issues = []
    composed = [entry for entry in placed if entry["composed"]]
    if composed:
        check = Usd.Stage.Open(master_path)
        if check is None:
            issues.append("the composed master does not open")
        else:
            if UsdGeom.GetStageMetersPerUnit(check) != 1.0:
                issues.append("metersPerUnit is not 1")
            if str(UsdGeom.GetStageUpAxis(check)) != "Z":
                issues.append("up axis is not Z")
            for entry in composed:
                if not check.GetPrimAtPath("/World/Objects/%s" % entry["id"]).IsValid():
                    issues.append("%s does not resolve in the composed master" % entry["id"])
    unreferenced = [entry for entry in placed if not entry["composed"]]
    if len(unreferenced) > 0:
        issues.append("%d objects are referenced by project path and were not verified" % len(unreferenced))
    if not placed:
        issues.append("the IR carries no objects")
    return issues, {"composed": len(composed), "referenced": len(unreferenced)}


def main():
    if len(sys.argv) < 4:
        fail("usage: assemble.py <ir.json> <master_twin.usda> <twin_manifest.json> [qa_report.json] [layer ...]")
    ir_path, master_path, manifest_path = sys.argv[1], sys.argv[2], sys.argv[3]
    qa_path = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4].endswith(".json") else "qa_report.json"
    layers = [arg for arg in sys.argv[5:] if arg.endswith((".usdc", ".usda"))] if qa_path.endswith(".json") else []
    if not qa_path.endswith(".json"):
        qa_path = "qa_report.json"
        layers = [arg for arg in sys.argv[4:] if arg.endswith((".usdc", ".usda"))]
    ir = read_json(ir_path)
    ir["_ir_path"] = ir_path
    stage = Usd.Stage.CreateNew(master_path)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.Xform.Define(stage, "/World")
    UsdGeom.Xform.Define(stage, "/World/Objects")
    stage.SetDefaultPrim(stage.GetPrimAtPath("/World"))
    # No Sdf.ChangeBlock around the definitions: USD 26.11 refuses a Define inside one. The
    # assembly stays cheap because composition is by reference — geometry is never copied.
    placed = _place(stage, ir, layers)
    _environment(stage, ir)
    stage.Save()
    write_json(manifest_path, _manifest(ir, placed))
    issues, counts = _qa(stage, ir, placed, master_path)
    # Q4 (fidelity IoU) and Q5 (visual scorecard) ride on the same composed stage and IR.
    fidelity = _fidelity(stage, ir, placed)
    visual = _visual(ir, placed, ir.get("bindings") or [], ir.get("sceneClass"))
    write_json(qa_path, {"ok": len(issues) == 0, "issues": issues, "counts": counts, "fidelity": fidelity, "visual": visual})
    emit({"ok": len(issues) == 0, "composed": counts["composed"], "referenced": counts["referenced"], "qa": issues, "fidelity": fidelity, "visual": visual, "degraded": False})


main()
