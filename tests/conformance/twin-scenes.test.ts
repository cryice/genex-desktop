/**
 * P4/P5 contract test for the three scene classes (park / city / workshop): the ontology must carry
 * a precision bracket for each, and `gen-ir` must build a Q1-clean program for each, updating the
 * project's scene class. Also confirms georeferencing clears the Q0 sandbox info.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activate, computeIrIssues } from "../../src/plugins/twin-park/backend.ts";
import type { PluginContext } from "../../src/plugin-sdk/index.d.ts";
import { TwinSceneClass, isTwinSceneClass } from "../../src/shared/twin-elements.ts";
import { twinScenePrecision } from "../../src/shared/twin-ontology.ts";

/** The activation's tool, or a throw when the plugin exposes none. */
async function tool() {
  const activation = await activate({} as unknown as Parameters<typeof activate>[0]);
  if (!activation.tool) throw new Error("twin-park activation exposes no tool");
  return activation.tool;
}

/** An in-memory project store: project.read/project.write back a string map. */
function mockCtx(store: Record<string, string>): PluginContext {
  return {
    hook: undefined,
    host: async (name: string, args: { path?: string; text?: string }) => {
      if (name === "project.read") return store[args.path ?? ""] ?? null;
      if (name === "project.write") {
        store[args.path ?? ""] = String(args.text ?? "");
        return undefined;
      }
      return null;
    },
  } as unknown as PluginContext;
}

/** A minimal Q1-clean program for a scene class, with elements appropriate to it.
 *  `gen-ir` expects RAW numbers (it wraps them into provenance Fields); the output IR carries Fields. */
function program(sceneClass: string, elements: string[]) {
  return {
    sceneClass,
    brief: {
      siteAreaM2: 10000,
      far: 2,
      coverage: 0.4,
      maxHeightM: 60,
      zones: [{ id: "Z1", landUse: "mixed", ratio: 1, buildings: elements.length }],
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
      setbackM: 5,
      plots: [],
      roads: [],
      buildingOutlines: elements.map((_, i) => ({
        id: `O${i + 1}`,
        plotId: "P1",
        ring: [
          { x: 10 + i * 20, y: 10 },
          { x: 30 + i * 20, y: 10 },
          { x: 30 + i * 20, y: 30 },
          { x: 10 + i * 20, y: 30 },
        ],
        heightM: 30,
        floors: 6,
        zoneId: "Z1",
      })),
    },
    objects: elements.map((element, i) => ({
      id: `O${i + 1}`,
      element,
      params: {},
      outputPath: `objects/O${i + 1}.usdc`,
      status: "pending",
      seed: i + 1,
      styleVersion: "1.0.0",
      operatorVersion: "twin-park-0.1",
    })),
  };
}

test("every scene class carries a precision bracket, descending city→workshop", () => {
  for (const scene of Object.values(TwinSceneClass)) {
    assert.ok(isTwinSceneClass(scene));
    assert.ok(twinScenePrecision(scene).citygml.length > 0);
  }
  assert.equal(twinScenePrecision("city").citygml, "LOD1-2");
  assert.equal(twinScenePrecision("workshop").citygml, "LOD3-4");
});

for (const [scene, elements] of [
  ["park", ["building", "road", "lamp"]],
  ["city", ["building", "road", "tree"]],
  ["workshop", ["equipment", "workstation", "production-line"]],
] as const) {
  test(`gen-ir builds a Q1-clean ${scene} program and updates the project scene class`, async () => {
    const store: Record<string, string> = {
      "park.json": JSON.stringify({ version: 1, sceneClass: "park", georef: null }),
    };
    const run = await tool();
    const result = await run(
      "gen-ir",
      { program: JSON.stringify(program(scene, elements as unknown as string[])) },
      mockCtx(store),
    );
    const ir = JSON.parse(store["ir.json"]);
    const park = JSON.parse(store["park.json"]);
    assert.equal(ir.sceneClass, scene);
    assert.equal(park.sceneClass, scene);
    assert.equal((result as { ok: boolean }).ok, true);
    assert.equal(ir.objects.length, elements.length);
  });
}

test("georeferencing clears the Q0 sandbox info", async () => {
  const store: Record<string, string> = {
    "park.json": JSON.stringify({ version: 1, sceneClass: "park", georef: null }),
  };
  const run = await tool();
  await run("georeference", { lat: 36.65, lon: 117.12, heightM: 42 }, mockCtx(store));
  const park = JSON.parse(store["park.json"]);
  assert.ok(park.georef.origin);
  assert.equal(park.georef.origin.lat, 36.65);
  const issues = computeIrIssues(park, null);
  assert.ok(!issues.some((issue) => issue.code === "q0-no-georef"));
});
