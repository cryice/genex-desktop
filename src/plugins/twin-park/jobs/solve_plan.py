"""Derive the master plan (J2) from the brief (J1), deterministically.

The solver is the rule baseline of ②: no model is called. It lays the site out on one of five
skeletons (grid, courtyard, point, linear, dual-spine), places plots inside the red line with
the setback, assigns zones, writes road centerlines and building outlines, and reverse-calculates
storeys from the FAR. The same brief and seed always produce the same plan (P5); a model's
layout intent, when there is one, lands as an IR diff before this runs.
"""
import sys

from common import emit, fail, read_json, write_json

# The setback used when the brief names none.
DEFAULT_SETBACK_M = 5.0
# The storey height a reverse-calculated floor count assumes.
STOREY_M = 3.6
# The ring road's width and the spine's.
RING_ROAD_M = 9.0
SPINE_ROAD_M = 7.0
# How far inside the red line the ring road runs.
RING_INSET_M = 12.0
# A plot's margin inside its land: the gap between neighbouring buildings.
PLOT_MARGIN_M = 4.0


def _rectangle(area_m2):
    """A 3:2 rectangle of the given area, centred on the origin."""
    import math

    width = math.sqrt(area_m2 * 1.5)
    depth = area_m2 / width
    hx, hy = width / 2, depth / 2
    return [{"x": -hx, "y": -hy}, {"x": hx, "y": -hy}, {"x": hx, "y": hy}, {"x": -hx, "y": hy}]


def _ring_bounds(ring):
    xs = [float(p["x"]) for p in ring]
    ys = [float(p["y"]) for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def _inset_ring(ring, inset):
    """A ring shrunk toward its own bounding-box centre — the rule baseline's setback."""
    min_x, min_y, max_x, max_y = _ring_bounds(ring)
    return [
        {"x": min_x + inset, "y": min_y + inset},
        {"x": max_x - inset, "y": min_y + inset},
        {"x": max_x - inset, "y": max_y - inset},
        {"x": min_x + inset, "y": max_y - inset},
    ]


def _skeleton(zone_count, ratio_spread):
    """Which of the five skeletons this brief lays out on."""
    if zone_count >= 4:
        return "grid"
    if ratio_spread > 0.5:
        return "linear"
    if zone_count == 2:
        return "dual-spine"
    return "courtyard"


def _plots_on(ring, skeleton, count):
    """Plot rectangles inside `ring`, by skeleton; the last row absorbs the remainder."""
    min_x, min_y, max_x, max_y = _ring_bounds(ring)
    inner = _inset_ring(ring, RING_INSET_M)
    i_min_x, i_min_y, i_max_x, i_max_y = _ring_bounds(inner)
    width, depth = i_max_x - i_min_x, i_max_y - i_min_y
    if skeleton == "linear":
        columns = max(1, count)
        rows = 1
    elif skeleton == "dual-spine":
        columns = 2
        rows = max(1, (count + 1) // 2)
    elif skeleton == "grid":
        columns = max(2, int(count**0.5))
        rows = max(1, (count + columns - 1) // columns)
    else:
        columns = 2
        rows = max(1, (count + 1) // 2)
    plots = []
    for row in range(rows):
        for column in range(columns):
            if len(plots) >= count:
                break
            x0 = i_min_x + width * column / columns + PLOT_MARGIN_M
            x1 = i_min_x + width * (column + 1) / columns - PLOT_MARGIN_M
            y0 = i_min_y + depth * row / rows + PLOT_MARGIN_M
            y1 = i_min_y + depth * (row + 1) / rows - PLOT_MARGIN_M
            if x1 - x0 < 8 or y1 - y0 < 8:
                continue
            plots.append([{"x": x0, "y": y0}, {"x": x1, "y": y0}, {"x": x1, "y": y1}, {"x": x0, "y": y1}])
    while len(plots) < count:
        plots.append(plots[-1] if plots else _inset_ring(ring, RING_INSET_M))
    return plots[:count]


def _roads_for(ring):
    """The ring road and the spines, as centerlines with widths."""
    min_x, min_y, max_x, max_y = _ring_bounds(ring)
    roads = [
        {
            "id": "ring",
            "widthM": RING_ROAD_M,
            "points": [
                {"x": min_x + RING_INSET_M, "y": min_y + RING_INSET_M},
                {"x": max_x - RING_INSET_M, "y": min_y + RING_INSET_M},
                {"x": max_x - RING_INSET_M, "y": max_y - RING_INSET_M},
                {"x": min_x + RING_INSET_M, "y": max_y - RING_INSET_M},
            ],
        },
        {
            "id": "spine-ns",
            "widthM": SPINE_ROAD_M,
            "points": [{"x": (min_x + max_x) / 2, "y": min_y + RING_INSET_M}, {"x": (min_x + max_x) / 2, "y": max_y - RING_INSET_M}],
        },
    ]
    return roads


def _ring_area(ring):
    total = 0.0
    for index, point in enumerate(ring):
        nxt = ring[(index + 1) % len(ring)]
        total += float(point["x"]) * float(nxt["y"]) - float(nxt["x"]) * float(point["y"])
    return abs(total) / 2


def solve(ir):
    brief = ir.get("brief") or {}
    site_area = float((brief.get("siteAreaM2") or {}).get("value") or 0)
    far = float((brief.get("far") or {}).get("value") or 1.5)
    max_height = float((brief.get("maxHeightM") or {}).get("value") or 24)
    zones = brief.get("zones") or []
    red_line = (ir.get("masterPlan") or {}).get("redLine") or (_rectangle(site_area) if site_area > 0 else None)
    if not red_line:
        fail("the brief names no site area and the IR carries no red line")
    zone_count = max(1, len(zones))
    ratios = [float((zone.get("ratio") or {}).get("value") or 0) for zone in zones]
    spread = max(ratios) - min(ratios) if ratios else 0.0
    skeleton = _skeleton(zone_count, spread)
    counts = [int((zone.get("buildings") or {}).get("value") or 0) for zone in zones]
    total = sum(counts) or zone_count
    plots = _plots_on(red_line, skeleton, total)
    outlines = []
    for index, plot in enumerate(plots):
        zone = zones[min(index, zone_count - 1)] if zones else {"id": "all"}
        footprint = _ring_area(plot)
        floors = max(1, min(int(round(far * site_area / max(footprint, 1.0) / max(total, 1))), int(max_height // STOREY_M) or 1))
        outlines.append(
            {
                "id": "B_%04d" % (index + 1),
                "plotId": "p%03d" % (index + 1),
                "ring": plot,
                "heightM": round(floors * STOREY_M, 2),
                "floors": floors,
                "zoneId": zone.get("id") or "all",
            }
        )
    plan = {
        "redLine": red_line,
        "setbackM": {"value": DEFAULT_SETBACK_M, "source": "derived", "confidence": 0.7},
        "plots": [{"id": "p%03d" % (index + 1), "ring": plot, "zoneId": (zones[min(index, zone_count - 1)] if zones else {"id": "all"}).get("id") or "all"} for index, plot in enumerate(plots)],
        "roads": _roads_for(red_line),
        "buildingOutlines": outlines,
        "skeleton": skeleton,
    }
    return plan


def main():
    if len(sys.argv) < 3:
        fail("usage: solve_plan.py <ir.json> <master_plan.json>")
    ir = read_json(sys.argv[1])
    plan = solve(ir)
    write_json(sys.argv[2], plan)
    emit({"ok": True, "skeleton": plan["skeleton"], "plots": len(plan["plots"]), "buildings": len(plan["buildingOutlines"]), "roads": len(plan["roads"])})


main()
