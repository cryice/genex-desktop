import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IrIssueCode,
  IrObjectStatus,
  IrSource,
  SOURCE_CONFIDENCE,
  SOURCE_PRIORITY,
  conflictWinner,
  irFieldOk,
  irSelfConsistency,
  isIrProgram,
  isTwinCatalogEntry,
  taskCardCacheKey,
  taskCardOf,
  type IrField,
  type IrProgram,
} from "../../src/shared/twin-ir.ts";
import { TwinElement, TwinObjectKind, TwinSceneClass } from "../../src/shared/twin-elements.ts";

/** A field with its provenance, the way an adapter writes one. */
function fieldOfLocal<T>(value: T, source: IrSource, confidence = SOURCE_CONFIDENCE[source]): IrField<T> {
  return { value, source, confidence };
}

/** A minimal but valid program: two zones, two buildings, one road. */
function programOf(overrides: Partial<IrProgram> = {}): IrProgram {
  const brief = {
    siteAreaM2: fieldOfLocal(40000, IrSource.Cad),
    far: fieldOfLocal(1.8, IrSource.TextInferred),
    coverage: fieldOfLocal(0.3, IrSource.TextInferred),
    maxHeightM: fieldOfLocal(24, IrSource.TextInferred),
    zones: [
      { id: "rd", landUse: "R&D", ratio: fieldOfLocal(0.6, IrSource.TextInferred), buildings: fieldOfLocal(2, IrSource.TextInferred) },
      { id: "green", landUse: "landscape", ratio: fieldOfLocal(0.4, IrSource.TextInferred), buildings: fieldOfLocal(0, IrSource.TextInferred) },
    ],
    keyElements: ["gate"],
    assumptions: [],
    conflicts: [],
    questions: [],
  };
  const masterPlan = {
    redLine: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ],
    setbackM: fieldOfLocal(5, IrSource.Cad),
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
    roads: [{ id: "main", points: [{ x: 0, y: 52 }, { x: 200, y: 52 }], widthM: 9 }],
    buildingOutlines: [
      { id: "B_0001", plotId: "p1", ring: [{ x: 20, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 50 }, { x: 20, y: 50 }], heightM: 24, floors: 8, zoneId: "rd" },
      { id: "B_0002", plotId: "p1", ring: [{ x: 70, y: 20 }, { x: 95, y: 20 }, { x: 95, y: 45 }, { x: 70, y: 45 }], heightM: 18, floors: 6, zoneId: "rd" },
    ],
  };
  return {
    version: 1,
    sceneClass: TwinSceneClass.Park,
    brief,
    masterPlan,
    objects: [
      {
        id: "B_0001",
        element: TwinElement.Building,
        params: { floors: fieldOfLocal(8, IrSource.Cad) },
        outputPath: "buildings/B_0001.usdc",
        status: IrObjectStatus.Pending,
        seed: 7,
        styleVersion: "sg-1",
        operatorVersion: "op-1",
      },
    ],
    styleGuide: { id: "sg-1", version: "1", palette: ["#cccccc"], materialFamilies: ["concrete"], facadeVocabulary: ["grid"] },
    environment: { crs: "CGCS2000", origin: { lat: 36.65, lon: 117.12, heightM: 0 }, timeOfDay: ["day", "dusk", "night"], cameraTracks: ["orbit"] },
    ...overrides,
  };
}

test("source confidences match the reference architecture's text chain", () => {
  assert.equal(SOURCE_CONFIDENCE.user, 0.95);
  assert.equal(SOURCE_CONFIDENCE.text_inferred, 0.8);
  assert.equal(SOURCE_CONFIDENCE.derived, 0.7);
  assert.equal(SOURCE_CONFIDENCE.archetype_default, 0.6);
  for (const source of Object.values(IrSource)) assert.ok(SOURCE_CONFIDENCE[source] > 0 && SOURCE_CONFIDENCE[source] <= 1);
});

test("conflict priority is measurement, then drawings, then images, then solver, then defaults", () => {
  assert.ok(SOURCE_PRIORITY.pointcloud > SOURCE_PRIORITY.cad);
  assert.ok(SOURCE_PRIORITY.cad > SOURCE_PRIORITY.plan_image);
  assert.ok(SOURCE_PRIORITY.plan_image > SOURCE_PRIORITY.solver);
  assert.ok(SOURCE_PRIORITY.solver > SOURCE_PRIORITY.archetype_default);
  assert.ok(SOURCE_PRIORITY.user >= SOURCE_PRIORITY.pointcloud);
});

test("a field is well formed only when its lock, range and confidence agree", () => {
  assert.equal(irFieldOk(fieldOfLocal(8, IrSource.Cad)), true);
  assert.equal(irFieldOk({ value: 8, source: IrSource.User, confidence: 0.95, locked: true }), true);
  assert.equal(irFieldOk({ value: 8, source: IrSource.Cad, confidence: 0.9, locked: true }), false, "only a person may lock");
  assert.equal(irFieldOk({ value: 8, source: IrSource.Cad, confidence: 1.4 }), false, "confidence above one");
  assert.equal(irFieldOk({ value: 8, source: IrSource.Cad, confidence: 0.9, range: { min: 5, max: 3 } }), false, "range floor above ceiling");
});

test("a conflict is won by source priority, then confidence", () => {
  const measured = fieldOfLocal(24, IrSource.PointCloud);
  const drawn = fieldOfLocal(22, IrSource.Cad);
  assert.equal(conflictWinner(measured, drawn).value, 24, "measurement outranks a drawing");
  assert.equal(conflictWinner(drawn, measured).value, 24);
  const lowConfidence = { value: 20, source: IrSource.Cad, confidence: 0.5 };
  assert.equal(conflictWinner(drawn, lowConfidence).value, 22, "same source: confidence decides");
});

test("a consistent program passes; each broken rule is named", () => {
  assert.deepEqual(irSelfConsistency(programOf()), []);
  const brokenRatio = programOf();
  brokenRatio.brief.zones[1].ratio.value = 0.3;
  assert.deepEqual(
    irSelfConsistency(brokenRatio).map((issue) => issue.code),
    [IrIssueCode.RatioSum],
  );
  const brokenCount = programOf();
  brokenCount.brief.zones[0].buildings.value = 3;
  assert.deepEqual(
    irSelfConsistency(brokenCount).map((issue) => issue.code),
    [IrIssueCode.BuildingCount],
  );
  const unknownZone = programOf();
  unknownZone.masterPlan.buildingOutlines[0].zoneId = "nowhere";
  assert.deepEqual(
    irSelfConsistency(unknownZone).map((issue) => issue.code),
    [IrIssueCode.TallestZoneUnknown],
  );
  const unasked = programOf();
  unasked.brief.conflicts = [...unasked.brief.conflicts, "FAR 2.0 vs 限高 24 m"];
  assert.deepEqual(
    irSelfConsistency(unasked).map((issue) => issue.code),
    [IrIssueCode.ConflictUnasked],
  );
});

test("a task card is derived from the IR deterministically and holds no facts of its own", () => {
  const program = programOf();
  const object = program.objects[0];
  const card = taskCardOf(object, program.masterPlan);
  assert.ok(card);
  assert.equal(card.objectId, "B_0001");
  assert.equal(card.kind, TwinObjectKind.Building);
  assert.equal(card.floors, 8);
  assert.equal(card.heightCapM, 24);
  assert.equal(card.seed, 7);
  assert.equal(card.styleVersion, "sg-1");
  assert.ok(card.roadFacing.includes("main"), "the card names the road the outline faces");
  assert.ok(card.neighbours.includes("B_0002"), "the card names the neighbour within 30 m");
  assert.equal(taskCardCacheKey(card), taskCardCacheKey(taskCardOf(object, program.masterPlan)!), "the same IR derives the same key");
  assert.equal(taskCardOf({ ...object, element: "rock" as TwinElement }, program.masterPlan), null, "an unknown element derives nothing");
});

test("catalog entries are the engineering specs instances are made from", () => {
  const entry = {
    id: "lamp-spec-a",
    element: TwinElement.Lamp,
    label: "9 m arm lamp",
    unit: "meters" as const,
    params: { heightM: { type: "number" as const, default: 9 }, armM: { type: "number" as const, default: 1.5 } },
  };
  assert.equal(isTwinCatalogEntry(entry), true);
  assert.equal(isTwinCatalogEntry({ ...entry, element: "streetlight" }), false, "an unknown element is refused");
  assert.equal(isTwinCatalogEntry({ ...entry, unit: "cm" }), false, "units are metres");
});

test("a program is recognized by its version, scene class and tables", () => {
  assert.equal(isIrProgram(programOf()), true);
  assert.equal(isIrProgram({ ...programOf(), version: 2 }), false);
  assert.equal(isIrProgram({ ...programOf(), sceneClass: "factory" }), false);
  assert.equal(isIrProgram({}), false);
});
