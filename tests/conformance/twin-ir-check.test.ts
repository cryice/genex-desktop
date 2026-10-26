/**
 * P1 contract test for the IR gate: the harness-only `ir-check` must block a moment when the
 * ParkProgram IR fails Q0/Q1, and the manifest must wire it as a harness-only tool the hooks fire.
 */
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeIrIssues, irHookAnswer } from "../../src/plugins/twin-park/backend.ts";

/** A Q1-clean program: ratios sum to 1, zone building counts match the master plan, the tallest building's zone exists, no unreconciled conflicts. */
const CLEAN_PROGRAM = {
  version: 1,
  sceneClass: "park",
  brief: {
    siteAreaM2: { value: 10000, source: "llm", confidence: 0.6 },
    far: { value: 2, source: "llm", confidence: 0.6 },
    coverage: { value: 0.4, source: "llm", confidence: 0.6 },
    maxHeightM: { value: 60, source: "llm", confidence: 0.6 },
    zones: [
      { id: "Z1", landUse: "office", ratio: { value: 0.6, source: "llm", confidence: 0.6 }, buildings: { value: 2, source: "llm", confidence: 0.6 } },
      { id: "Z2", landUse: "green", ratio: { value: 0.4, source: "llm", confidence: 0.6 }, buildings: { value: 0, source: "llm", confidence: 0.6 } },
    ],
    keyElements: [],
    assumptions: [],
    conflicts: [],
    questions: [],
  },
  masterPlan: {
    redLine: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    setbackM: { value: 5, source: "llm", confidence: 0.6 },
    plots: [],
    roads: [],
    buildingOutlines: [
      { id: "B1", plotId: "P1", ring: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }], heightM: 40, floors: 10, zoneId: "Z1" },
      { id: "B2", plotId: "P2", ring: [{ x: 50, y: 50 }, { x: 70, y: 50 }, { x: 70, y: 70 }, { x: 50, y: 70 }], heightM: 20, floors: 5, zoneId: "Z1" },
    ],
  },
  objects: [],
  styleGuide: { id: "twin-park", version: "1.0.0", palette: [], materialFamilies: [], facadeVocabulary: [] },
  environment: { crs: "CGCS2000", origin: { lat: 0, lon: 0, heightM: 0 }, timeOfDay: ["09:00"], cameraTracks: ["aerial"] },
};

/** Same as CLEAN_PROGRAM but the land-use ratios sum to 0.9, so Q1 ratio_sum fires. */
const RATIO_BROKEN = {
  ...CLEAN_PROGRAM,
  brief: {
    ...CLEAN_PROGRAM.brief,
    zones: [
      { id: "Z1", landUse: "office", ratio: { value: 0.6, source: "llm", confidence: 0.6 }, buildings: { value: 2, source: "llm", confidence: 0.6 } },
      { id: "Z2", landUse: "green", ratio: { value: 0.3, source: "llm", confidence: 0.6 }, buildings: { value: 0, source: "llm", confidence: 0.6 } },
    ],
  },
};

test("no park and no ir: both Q0 issues report", () => {
  const issues = computeIrIssues(null, null);
  assert.ok(issues.some((i) => i.code === "q0-no-park"));
  assert.ok(issues.some((i) => i.code === "q0-no-ir"));
});

test("clean program on a park: Q1 self-consistent, only a non-blocking georef info", () => {
  const issues = computeIrIssues({ sceneClass: "park" }, CLEAN_PROGRAM);
  // No georef set in the fixture → a diorama-mode info, which must NOT block the build.
  assert.equal(issues.length, 1, "only the q0-no-georef info is expected");
  assert.equal(issues[0].code, "q0-no-georef");
  assert.equal(issues[0].severity, "info");
  assert.deepEqual(irHookAnswer(issues), {}, "info-only means the moment proceeds");
});

test("broken ratio sum: Q1 ratio_sum reports", () => {
  const issues = computeIrIssues({ sceneClass: "park" }, RATIO_BROKEN);
  assert.ok(issues.some((i) => i.code === "q1-ratio_sum"));
});

test("ir-check answer is empty when clean (moment proceeds)", () => {
  assert.deepEqual(irHookAnswer([]), {});
});

test("ir-check answer blocks with the first issue and lists all (moment held back)", () => {
  const answer = irHookAnswer([
    { code: "q1-ratio_sum", message: "land-use ratios sum to 0.900, expected 1 within 0.01" },
    { code: "q1-building_count", message: "zones count 2 buildings but the master plan places 1" },
  ]);
  assert.equal(typeof answer.block, "string");
  assert.match(answer.block as string, /q1-ratio_sum/);
  assert.ok((answer.note ?? "").includes("q1-building_count"));
});

test("manifest wires ir-check as a harness-only hook tool and declares gen-ir", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../src/plugins/twin-park/plugin.json", import.meta.url), "utf8"),
  ) as {
    tools: Array<{ name: string; audience?: string }>;
    hooks: Array<{ on: string; tool: string }>;
  };
  const irCheck = manifest.tools.find((tool) => tool.name === "ir-check");
  assert.ok(irCheck, "ir-check tool declared");
  assert.equal(irCheck?.audience, "harness", "ir-check must be harness-only so the hook validator accepts it");
  assert.ok(manifest.tools.some((tool) => tool.name === "gen-ir"), "gen-ir tool declared");
  const toolNames = new Set(manifest.tools.map((tool) => tool.name));
  for (const hook of manifest.hooks) {
    assert.ok(toolNames.has(hook.tool), `hook references a declared tool: ${hook.tool}`);
    if (hook.tool === "ir-check") {
      assert.equal(irCheck?.audience, "harness");
    }
  }
});
