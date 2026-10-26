"""Read a DXF's layers into IR fragments (the CAD adapter's second half).

The drawing is read by layer, because a CAD drawing's layer names are its schema: the red line,
the road centerlines and the building outlines live on layers whose names say so. Units come from
the header's $INSUNITS — a millimetre drawing read as metres is a park 1000 times too small, so
the scale is applied to every coordinate.

The output is IR fragments and evidence, never geometry: the fragments merge into the IR, and the
rebuild happens in the operators.
"""
import re
import sys

try:
    import ezdxf
except Exception as error:  # pragma: no cover - depends on the machine
    from common import fail

    fail("ezdxf is not importable in this Python: %s" % error)

from common import DXF_INSUNITS_TO_M, emit, fail, read_json, write_json

# Layer-name patterns (case-insensitive substrings) for each fragment kind.
RED_LINE = ("红线", "redline", "red-line", "boundary", "用地")
ROADS = ("道路", "road", "centerline", "centreline", "中心线")
BUILDINGS = ("建筑", "building", "outline", "轮廓", "楼")
# The default road width and building floors when the layer names say nothing.
DEFAULT_ROAD_M = 9.0
DEFAULT_FLOORS = 6
STOREY_M = 3.6


def _matches(layer, patterns):
    name = (layer or "").lower()
    return any(pattern in name for pattern in patterns)


def _floors_from_layer(layer):
    """Floors from a layer name like `building-6F` or `建筑-6层`; a leading index is not a floor."""
    match = re.search(r"(\d+)\s*[fF层]", layer or "")
    return int(match.group(1)) if match else DEFAULT_FLOORS


def _width_from_layer(layer):
    """A road width from a layer name like `road-9m`; a bare index number is not a width."""
    match = re.search(r"(\d+(?:\.\d+)?)\s*m(?![a-zA-Z])", layer or "")
    return float(match.group(1)) if match else DEFAULT_ROAD_M


def _polyline_points(entity, scale):
    try:
        points = [(p[0] * scale, p[1] * scale) for p in entity.get_points("xy")]
    except Exception:
        points = []
    if len(points) > 1 and points[0] == points[-1]:
        points.pop()
    return points


def read(path):
    doc = ezdxf.readfile(path)
    units = int(doc.header.get("$INSUNITS", 0) or 0)
    scale = DXF_INSUNITS_TO_M.get(units, 1.0)
    fragments = {"redLine": None, "roads": [], "buildingOutlines": [], "evidence": {}, "scale": scale, "units": units}
    for entity in doc.modelspace():
        layer = entity.dxf.layer
        fragments["evidence"][layer] = fragments["evidence"].get(layer, 0) + 1
        if entity.dxftype() not in ("LWPOLYLINE", "POLYLINE", "LINE"):
            continue
        if entity.dxftype() == "LINE":
            points = [(entity.dxf.start.x * scale, entity.dxf.start.y * scale), (entity.dxf.end.x * scale, entity.dxf.end.y * scale)]
        else:
            points = _polyline_points(entity, scale)
        if len(points) < 2:
            continue
        if _matches(layer, RED_LINE) and fragments["redLine"] is None:
            fragments["redLine"] = [{"x": x, "y": y} for x, y in points]
        elif _matches(layer, BUILDINGS):
            if len(points) >= 3:
                floors = _floors_from_layer(layer)
                fragments["buildingOutlines"].append(
                    {
                        "id": "B_%04d" % (len(fragments["buildingOutlines"]) + 1),
                        "ring": [{"x": x, "y": y} for x, y in points],
                        "floors": floors,
                        "heightM": round(floors * STOREY_M, 2),
                        "zoneId": "cad",
                    }
                )
        elif _matches(layer, ROADS):
            width = _width_from_layer(layer)
            fragments["roads"].append({"id": "road-%03d" % (len(fragments["roads"]) + 1), "widthM": width, "points": [{"x": x, "y": y} for x, y in points]})
    return fragments


def main():
    if len(sys.argv) < 4:
        fail("usage: dxf_ir.py <ir.json> <drawing.dxf> <ir_fragments.json>")
    ir = read_json(sys.argv[1])
    try:
        fragments = read(sys.argv[2])
    except Exception as error:
        fail("the DXF could not be read: %s" % error)
        return
    plan = ir.setdefault("masterPlan", {})
    if fragments["redLine"] and not plan.get("redLine"):
        plan["redLine"] = fragments["redLine"]
    plan.setdefault("roads", []).extend(fragments["roads"])
    plan.setdefault("buildingOutlines", []).extend(fragments["buildingOutlines"])
    write_json(sys.argv[3], {"fragments": fragments, "ir": ir})
    emit(
        {
            "ok": True,
            "scale": fragments["scale"],
            "redLine": fragments["redLine"] is not None,
            "roads": len(fragments["roads"]),
            "buildings": len(fragments["buildingOutlines"]),
            "layers": len(fragments["evidence"]),
            "degraded": False,
        }
    )


main()
