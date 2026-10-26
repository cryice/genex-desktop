"""P5 judge metrics: Q4 (footprint IoU) and Q5 (visual scorecard) sanity.

Run with: python tests/conformance/test_judge_metrics.py
The repo's node test runner does not cover Python, so this is a standalone check the CI can call.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src", "plugins", "twin-park", "jobs"))
from judge_metrics import footprint_iou, visual_scorecard

SQUARE = [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 10}, {"x": 0, "y": 10}]
SAME = SQUARE
SHIFTED = [{"x": 20, "y": 20}, {"x": 30, "y": 20}, {"x": 30, "y": 30}, {"x": 20, "y": 30}]
HALF = [{"x": 0, "y": 0}, {"x": 5, "y": 0}, {"x": 5, "y": 5}, {"x": 0, "y": 5}]


def test_iou_identical():
    assert abs(footprint_iou(SAME, SQUARE) - 1.0) < 1e-9


def test_iou_half_overlap():
    # HALF (5x5=25) lies fully inside SQUARE (10x10=100): intersection 25, union 100 -> 0.25
    assert abs(footprint_iou(SQUARE, HALF) - 0.25) < 1e-6


def test_iou_disjoint():
    assert footprint_iou(SQUARE, SHIFTED) == 0.0


def test_iou_degenerate():
    assert footprint_iou(SQUARE, []) == 0.0


def _ir(objects, scene_class="park", georef=False):
    return {
        "sceneClass": scene_class,
        "objects": objects,
        "environment": {"origin": {"lat": 36.0, "lon": 117.0} if georef else {"lat": 0, "lon": 0}},
    }


def test_visual_scorecard_full():
    ir = _ir(
        [{"element": "building"}, {"element": "road"}, {"element": "lamp"}, {"element": "camera"}, {"element": "tree"}, {"element": "pipe"}],
        georef=True,
    )
    placed = [{"id": "B1", "composed": True}, {"id": "R1", "composed": True}, {"id": "L1", "composed": True}]
    bindings = [{"device": "cam1"}]
    score = visual_scorecard(ir, placed, bindings, "park")
    assert 0 <= score["score"] <= 100
    assert score["subScores"]["buildCompleteness"] == 1.0
    assert score["subScores"]["georefPosture"] == 1.0
    assert score["bindings"] == 1


def test_visual_scorecard_city_needs_georef():
    ir = _ir([{"element": "building"}], georef=False)
    score = visual_scorecard(ir, [{"id": "B1", "composed": True}], [], "city")
    assert score["subScores"]["georefPosture"] == 0.3  # city without georef is penalized


if __name__ == "__main__":
    for name in list(globals()):
        if name.startswith("test_") and callable(globals()[name]):
            globals()[name]()
            print("ok", name)
    print("ALL JUDGE TESTS PASSED")
