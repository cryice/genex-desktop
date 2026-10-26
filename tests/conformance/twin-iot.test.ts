/**
 * P3 contract test for IoT binding end-to-end: `iot-bind` must write the binding into both
 * `park.json` (the web route) and `ir.json` (UE5's manifest keys, read by assemble.py), and
 * `export-glb` must record the exported GLB as a tagged web asset so the Babylon preview loads it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activate } from "../../src/plugins/twin-park/backend.ts";
import type { PluginContext } from "../../src/plugin-sdk/index.d.ts";

/** The activation's tool, or a throw when the plugin exposes none. */
async function tool() {
  const activation = await activate({} as unknown as Parameters<typeof activate>[0]);
  if (!activation.tool) throw new Error("twin-park activation exposes no tool");
  return activation.tool;
}

/** An in-memory project: project.read/project.write back a string map; native jobs complete. */
function mockCtx(store: Record<string, string>): PluginContext {
  return {
    hook: undefined,
    host: async (name: string, args: { path?: string; text?: string }) => {
      if (name === "project.read") return store[args.path ?? ""] ?? null;
      if (name === "project.write") {
        store[args.path ?? ""] = String(args.text ?? "");
        return undefined;
      }
      if (name === "native.run")
        return { state: "completed", id: "job", output: "/tmp", stdout: "", stderr: "", reason: null };
      if (name === "assets.deliver") return ["B_0001.glb"];
      return null;
    },
  } as unknown as PluginContext;
}

const PARK = JSON.stringify({ version: 1, sceneClass: "park", bindings: [], assets: [], georef: null });

const IR = JSON.stringify({
  version: 1,
  sceneClass: "park",
  brief: {
    siteAreaM2: { value: 10000, source: "llm", confidence: 0.6 },
    far: { value: 2, source: "llm", confidence: 0.6 },
    coverage: { value: 0.4, source: "llm", confidence: 0.6 },
    maxHeightM: { value: 60, source: "llm", confidence: 0.6 },
    zones: [
      {
        id: "Z1",
        landUse: "office",
        ratio: { value: 1, source: "llm", confidence: 0.6 },
        buildings: { value: 1, source: "llm", confidence: 0.6 },
      },
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
      {
        id: "B_0001",
        plotId: "P1",
        ring: [
          { x: 5, y: 15 },
          { x: 15, y: 15 },
          { x: 15, y: 25 },
          { x: 5, y: 25 },
        ],
        heightM: 30,
        floors: 6,
        zoneId: "Z1",
      },
    ],
  },
  objects: [
    {
      id: "B_0001",
      element: "building",
      params: {},
      outputPath: "objects/B_0001.usdc",
      status: "pending",
      seed: 1,
      styleVersion: "1.0.0",
      operatorVersion: "twin-park-0.1",
    },
  ],
  styleGuide: {
    id: "twin-park",
    version: "1.0.0",
    palette: ["concrete"],
    materialFamilies: ["masonry"],
    facadeVocabulary: ["grid"],
  },
  environment: {
    crs: "CGCS2000",
    origin: { lat: 0, lon: 0, heightM: 0 },
    timeOfDay: ["09:00"],
    cameraTracks: ["aerial"],
  },
});

test("iot-bind writes the binding into both park.json and ir.json", async () => {
  const store: Record<string, string> = { "park.json": PARK, "ir.json": IR };
  const run = await tool();
  await run(
    "iot-bind",
    { prim: "/World/Objects/B_0001", device: "lamp1", property: "brightness", target: "material.emissive" },
    mockCtx(store),
  );
  const park = JSON.parse(store["park.json"]);
  const ir = JSON.parse(store["ir.json"]);
  assert.equal(park.bindings.length, 1);
  assert.equal(park.bindings[0].device, "lamp1");
  assert.equal(ir.bindings?.length, 1);
  assert.equal(ir.bindings[0].prim, "/World/Objects/B_0001");
});

test("iot-bind reverse flag is mirrored and gated", async () => {
  const store: Record<string, string> = { "park.json": PARK, "ir.json": IR };
  const run = await tool();
  await run(
    "iot-bind",
    { prim: "/World/Objects/B_0001", device: "gate1", property: "open", target: "rotation.y", reverse: true },
    mockCtx(store),
  );
  const park = JSON.parse(store["park.json"]);
  const ir = JSON.parse(store["ir.json"]);
  assert.equal(park.bindings[0].reverse, true);
  assert.equal(ir.bindings[0].reverse, true);
});

test("export-glb records a tagged web asset at the outline centroid", async () => {
  const store: Record<string, string> = {
    "park.json": JSON.stringify({
      version: 1,
      sceneClass: "park",
      bindings: [],
      assets: [],
      layers: ["objects/B_0001.usdc"],
    }),
    "ir.json": IR,
  };
  const run = await tool();
  const result = await run("export-glb", { object: "B_0001" }, mockCtx(store));
  const park = JSON.parse(store["park.json"]);
  assert.equal(park.assets.length, 1);
  assert.equal(park.assets[0].id, "B_0001");
  assert.equal(park.assets[0].element, "building");
  assert.equal(park.assets[0].floor, 6);
  assert.deepEqual(park.assets[0].position, [10, 0, 20]);
  assert.equal((result as { glb: string }).glb, "B_0001.glb");
});
