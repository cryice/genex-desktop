"""The Q4 (fidelity IoU) and Q5 (visual scorecard) metrics, as pure, testable functions.

Kept free of pxr so it runs anywhere shapely is installed — `assemble.py` calls these for the
Q4 IoU (against geometry extents it measures) and the Q5 scorecard (against the IR and the
placement counts). A district twin composes as a sub-master, so these take the same per-object
`placed` shape the manifest does: each entry carries its id, whether it composed, its world
outline (the IR ring) and, for Q4, a measured `geomRing` the caller supplies.
"""

try:
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
except Exception:  # pragma: no cover - depends on the machine
    Polygon = None
    unary_union = None


def _ring_polygon(ring):
    if Polygon is None or not ring or len(ring) < 3:
        return None
    points = [(float(p["x"]), float(p["y"])) for p in ring]
    if points[0] != points[-1]:
        points = points + [points[0]]
    polygon = Polygon(points)
    return polygon if polygon.is_valid and polygon.area > 1e-9 else None


def footprint_iou(ir_ring, geom_ring):
    """The IoU of the IR-designed footprint against the as-built geometry footprint, in [0, 1].

    Both rings are lists of `{x, y}`. A zero-area side (a degenerate footprint) gives 0, never a
    divide-by-zero. Returns 1.0 when both sides are the same footprint and 0 when either is missing.
    """
    designed = _ring_polygon(ir_ring)
    built = _ring_polygon(geom_ring)
    if designed is None or built is None:
        return 0.0
    inter = designed.intersection(built).area
    union = designed.union(built).area
    if union <= 1e-9:
        return 0.0
    return inter / union


def visual_scorecard(ir, placed, bindings, scene_class):
    """The Q5 visual scorecard: a 0–100 heuristic over build completeness, element variety, binding
    readiness and georeference posture. Deterministic and explainable — each sub-score is reported.

    This is a scorecard, not a renderer: it reads what the operators produced (placement counts,
    element variety, bindings, georef) and grades posture. A human/QA review is still the final
    Q5 gate; the score tells them where to look first.
    """
    composed = [entry for entry in placed if entry.get("composed")]
    referenced = [entry for entry in placed if not entry.get("composed")]
    total_placed = len(composed) + len(referenced)

    objects = (ir or {}).get("objects") or []
    build_completeness = (len(composed) / total_placed) if total_placed else 1.0

    distinct_elements = {obj.get("element") for obj in objects}
    element_variety = min(1.0, len(distinct_elements) / 5.0)

    device_elements = {"camera", "gate", "pipe", "valve", "lamp", "luminaire", "equipment", "workstation"}
    device_count = sum(1 for obj in objects if obj.get("element") in device_elements)
    binding_readiness = min(1.0, (len(bindings or [])) / max(1, device_count))

    origin = (ir or {}).get("environment", {}).get("origin") or {}
    has_georef = bool(origin.get("lat") or origin.get("lon"))
    if scene_class == "city":
        georef = 1.0 if has_georef else 0.3  # city requires georeferencing; park/workshop tolerate sandbox
    else:
        georef = 1.0 if has_georef else 0.7

    sub = {
        "buildCompleteness": round(build_completeness, 3),
        "elementVariety": round(element_variety, 3),
        "bindingReadiness": round(binding_readiness, 3),
        "georefPosture": round(georef, 3),
    }
    total = round(100.0 * (0.4 * build_completeness + 0.2 * element_variety + 0.2 * binding_readiness + 0.2 * georef), 1)
    return {"score": total, "subScores": sub, "composed": len(composed), "referenced": len(referenced), "bindings": len(bindings or [])}
