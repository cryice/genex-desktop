/**
 * P1 contract test for the data-source metadata gate and the object-to-outline link:
 *
 * - Sources registered with `register-data-source` must reach `ir.json`. If they do not, operators
 *   and exports cannot see or gate on inputs the project already knows about, and geometry gets
 *   built from sources nobody validated — exactly what the gate exists to prevent.
 * - A scene object and the master-plan outline it is built from are two things with two ids: the
 *   plan names outlines `B_0001` while J3 names objects `O_0001`, so the link must be explicit
 *   rather than assumed, or every building silently vanishes from the renderer manifests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activate, mergeIrDataSources, rendererSceneManifest } from "../../src/plugins/twin-park/backend.ts";
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

/** A source as `register-data-source` writes it into data-sources.json. */
function registered(overrides: Record<string, unknown> = {}) {
  return {
    id: "gis-1",
    kind: "gis",
    uri: "file:///data/redline.geojson",
    status: "pending",
    issues: [],
    ...overrides,
  };
}

/** A Q1-clean program with one outline and one object, so the manifest has something to draw. */
function programWithOutline(objectId: string, outlineId: string) {
  const field = (value: number) => ({ value, source: "llm", confidence: 0.6 });
  return {
    version: 1,
    sceneClass: "park",
    brief: {
      siteAreaM2: field(10000),
      far: field(2),
      coverage: field(0.4),
      maxHeightM: field(60),
      zones: [{ id: "Z1", landUse: "office", ratio: field(1), buildings: field(1) }],
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
      setbackM: field(5),
      plots: [
        {
          id: "P1",
          ring: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 30, y: 30 },
            { x: 10, y: 30 },
          ],
          zoneId: "Z1",
        },
      ],
      roads: [],
      buildingOutlines: [
        {
          id: "B_0001",
          plotId: "P1",
          ring: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 30, y: 30 },
            { x: 10, y: 30 },
          ],
          heightM: 40,
          floors: 10,
          zoneId: "Z1",
        },
      ],
    },
    objects: [
      {
        id: objectId,
        element: "building",
        kind: "building",
        outlineId,
        params: {},
        outputPath: `objects/${objectId}.usdc`,
        status: "pending",
        seed: 1,
        styleVersion: "1.0.0",
        operatorVersion: "twin-park-0.1",
      },
    ],
    styleGuide: { id: "twin-park", version: "1.0.0", palette: [], materialFamilies: [], facadeVocabulary: [] },
    environment: {
      crs: "CGCS2000",
      origin: { lat: 0, lon: 0, heightM: 0 },
      timeOfDay: ["09:00"],
      cameraTracks: ["aerial"],
    },
  } as unknown as Parameters<typeof rendererSceneManifest>[0];
}

test("registered sources reach the IR even when the program names none", () => {
  const programSources = [registered({ id: "bim-1", kind: "bim", uri: "file:///data/tower.ifc", units: "m" })];
  const projectRegistered = [registered()];
  const merged = mergeIrDataSources(programSources as never, projectRegistered);

  assert.deepEqual(
    merged.map((source) => source.id).sort(),
    ["bim-1", "gis-1"],
    "both the program's source and the registered one belong in the IR",
  );
});

test("a registered source with a later id wins on a collision", () => {
  const merged = mergeIrDataSources([registered({ uri: "file:///data/old.geojson" })] as never, [
    registered({ uri: "file:///data/new.geojson" }),
  ]);
  assert.equal(merged.length, 1, "an id collision stays one source");
  assert.equal(merged[0]?.uri, "file:///data/new.geojson");
});

test("junk registered entries are dropped, not carried into the IR", () => {
  const merged = mergeIrDataSources([], [null, 7, { kind: "not-a-kind" }, { kind: "gis", uri: "" }]);
  // An empty uri still parses as a source; an unknown kind does not.
  assert.deepEqual(
    merged.map((source) => source.kind),
    ["gis"],
  );
});

/** A Q1-clean city program, as the agent writes it, with three sources already registered. */
function cityProgram() {
  return {
    sceneClass: "city",
    brief: {
      siteAreaM2: 40000,
      far: 1.8,
      coverage: 0.3,
      maxHeightM: 24,
      zones: [
        { id: "rd", landUse: "R&D", ratio: 0.6, buildings: 2 },
        { id: "green", landUse: "landscape", ratio: 0.4, buildings: 0 },
      ],
      keyElements: [],
    },
    masterPlan: {
      redLine: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
        { x: 0, y: 200 },
      ],
      setbackM: 5,
      plots: [
        {
          id: "p1",
          ring: [
            { x: 10, y: 10 },
            { x: 60, y: 10 },
            { x: 60, y: 60 },
            { x: 10, y: 60 },
          ],
          zoneId: "rd",
        },
      ],
      roads: [
        {
          id: "main",
          points: [
            { x: 0, y: 52 },
            { x: 200, y: 52 },
          ],
          widthM: 9,
        },
      ],
      buildingOutlines: [
        {
          id: "B_0001",
          plotId: "p1",
          ring: [
            { x: 20, y: 20 },
            { x: 50, y: 20 },
            { x: 50, y: 50 },
            { x: 20, y: 50 },
          ],
          heightM: 24,
          floors: 8,
          zoneId: "rd",
        },
        {
          id: "B_0002",
          plotId: "p1",
          ring: [
            { x: 70, y: 20 },
            { x: 95, y: 20 },
            { x: 95, y: 45 },
            { x: 70, y: 45 },
          ],
          heightM: 18,
          floors: 6,
          zoneId: "rd",
        },
      ],
    },
    objects: [
      { id: "O_0001", element: "building", kind: "building", outlineId: "B_0001" },
      { id: "O_0002", element: "building", kind: "building", outlineId: "B_0002" },
      { id: "O_0003", element: "lamp", kind: "landscape" },
    ],
  };
}

test("gen-ir carries every registered source into ir.json", async () => {
  const run = await tool();
  const store: Record<string, string> = {
    "park.json": JSON.stringify({ version: 1, sceneClass: "city" }),
    "data-sources.json": JSON.stringify({
      version: 1,
      sources: [
        registered({ id: "gis-1", kind: "gis", uri: "file:///data/redline.geojson", crs: "EPSG:4547" }),
        registered({ id: "cad-1", kind: "cad", uri: "file:///data/base.dwg", crs: "EPSG:4547", units: "m" }),
        registered({ id: "iot-1", kind: "iot", uri: "file:///data/hvac.jsonl" }),
      ],
    }),
  };
  const ctx = mockCtx(store);

  await run("gen-ir", { program: JSON.stringify(cityProgram()) }, ctx);

  const ir = JSON.parse(store["ir.json"] ?? "{}") as { dataSources?: Array<{ id: string }> };
  const ids = (ir.dataSources ?? []).map((source) => source.id).sort();
  assert.deepEqual(ids, ["cad-1", "gis-1", "iot-1"], "gen-ir must carry the registered sources into the IR");
});

test("renderer manifest follows the object's outlineId", () => {
  const manifest = rendererSceneManifest(programWithOutline("O_0001", "B_0001"));
  assert.equal(manifest.objects.length, 1, "the object built from B_0001 must reach the manifest");
  assert.equal(manifest.objects[0]?.id, "B_0001", "the manifest is keyed by the outline it draws");
});

test("renderer manifest still matches an object whose id is already the outline id", () => {
  const manifest = rendererSceneManifest(programWithOutline("B_0001", "B_0001"));
  assert.equal(manifest.objects.length, 1, "the legacy id-matching shape keeps working");
});

test("renderer manifest ignores an object pointing at a missing outline", () => {
  const manifest = rendererSceneManifest(programWithOutline("O_0001", "B_9999"));
  assert.equal(manifest.objects.length, 0, "a dangling outlineId draws nothing");
});
