/**
 * P2 contract test for the GIS georeference transform. The plugin's in-JS `geodeticToEnu` (CGCS2000
 * ellipsoid, closed-form topocentric) must agree with the pyproj-backed `jobs/georeference.py`
 * helper on direction and sign, and the Q0 geographic pre-check must be a non-blocking info (so the
 * build is not held merely for an unset survey origin).
 */
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  geodeticToEnu,
  computeIrIssues,
  CGCS2000_ELLIPSOID,
} from "../../src/plugins/twin-park/backend.ts";

const ORIGIN = { lat: 39.9, lon: 116.4, h: 50 };

test("origin maps to the local ENU zero (0, 0, 0)", () => {
  const [e, n, u] = geodeticToEnu(ORIGIN, ORIGIN, CGCS2000_ELLIPSOID);
  assert.ok(Math.abs(e) < 1e-6 && Math.abs(n) < 1e-6 && Math.abs(u) < 1e-6, `origin not zero: ${e},${n},${u}`);
});

test("a point east of the origin has positive east, near-zero north/up", () => {
  // ~0.00119 deg east of lon 116.4 at lat 39.9 ≈ 101 m east (matches georeference.py 101.768).
  const [e, n, u] = geodeticToEnu(ORIGIN, { lat: 39.9, lon: 116.40119, h: 50 });
  assert.ok(e > 90 && e < 120, `east out of range: ${e}`);
  assert.ok(Math.abs(n) < 5, `north should be ~0: ${n}`);
  assert.ok(Math.abs(u) < 5, `up should be ~0: ${u}`);
});

test("a point north of the origin has positive north, near-zero east/up", () => {
  // ~0.00180 deg north of lat 39.9 ≈ 200 m north (matches georeference.py 199.86).
  const [, n, u] = geodeticToEnu(ORIGIN, { lat: 39.9018, lon: 116.4, h: 50 });
  assert.ok(n > 180 && n < 220, `north out of range: ${n}`);
  assert.ok(Math.abs(u) < 5, `up should be ~0: ${u}`);
});

test("up is positive for a point higher than the origin", () => {
  const [, , u] = geodeticToEnu(ORIGIN, { lat: 39.9, lon: 116.4, h: 150 });
  assert.ok(u > 90 && u < 110, `up should be ~100 m: ${u}`);
});

test("Q0 geographic pre-check is a non-blocking info, not an error", () => {
  const issues = computeIrIssues({ sceneClass: "park" }, {
    version: 1,
    sceneClass: "park",
    brief: {
      siteAreaM2: { value: 10000, source: "llm", confidence: 0.6 },
      far: { value: 2, source: "llm", confidence: 0.6 },
      coverage: { value: 0.4, source: "llm", confidence: 0.6 },
      maxHeightM: { value: 60, source: "llm", confidence: 0.6 },
      zones: [
        { id: "Z1", landUse: "office", ratio: { value: 1, source: "llm", confidence: 0.6 }, buildings: { value: 0, source: "llm", confidence: 0.6 } },
      ],
      keyElements: [],
      assumptions: [],
      conflicts: [],
      questions: [],
    },
    masterPlan: { redLine: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], setbackM: { value: 5, source: "llm", confidence: 0.6 }, plots: [], roads: [], buildingOutlines: [] },
    objects: [],
    styleGuide: { id: "twin-park", version: "1.0.0", palette: [], materialFamilies: [], facadeVocabulary: [] },
    environment: { crs: "CGCS2000", origin: { lat: 0, lon: 0, heightM: 0 }, timeOfDay: ["09:00"], cameraTracks: ["aerial"] },
  } as unknown);
  const geo = issues.find((i) => i.code === "q0-no-georef");
  assert.ok(geo, "expected a q0-no-georef info issue");
  assert.equal(geo?.severity, "info", "must be non-blocking info");
});

test("manifest exposes the georeference tool and the GIS skill", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../src/plugins/twin-park/plugin.json", import.meta.url), "utf8"),
  ) as {
    tools: Array<{ name: string; audience?: string }>;
    skills: Array<{ name: string }>;
  };
  assert.ok(manifest.tools.some((t) => t.name === "georeference"), "georeference tool declared");
  assert.ok(manifest.skills.some((s) => s.name === "gis-alignment"), "gis-alignment skill declared");
});
