/**
 * ParkProgram IR — the single source of truth a twin project is built from (P2 of the twin
 * design). Every input (text, plan image, CAD, point cloud, orthophoto) is normalized into this
 * program by an adapter; the operators only ever read IR and task cards derived from it; a
 * conversation change lands as a diff that reruns only the affected objects.
 *
 * Renderer-safe: no Node, no Electron — the UI reads the same contract the jobs do.
 */
import {
  type TwinObjectKind,
  type TwinSceneClass,
  type TwinElement,
  type TwinDataSourceKind,
  isTwinSceneClass,
  isTwinElement,
  isTwinObjectKind,
  isTwinDataSourceKind,
  twinElementKind,
} from "./twin-elements.ts";

/** Where a field's value came from. Four come from the text chain (their default confidences are the reference architecture's); eight from the multi-source and solver chain (it names them without numbers — these are the studio's defaults). */
export const IrSource = {
  User: "user",
  TextInferred: "text_inferred",
  Derived: "derived",
  ArchetypeDefault: "archetype_default",
  Solver: "solver",
  Llm: "llm",
  PlanImage: "plan_image",
  Cad: "cad",
  PointCloud: "pointcloud",
  Oblique: "oblique",
  Photo: "photo",
  Manual: "manual",
} as const;
export type IrSource = (typeof IrSource)[keyof typeof IrSource];

/** The confidence a field starts with when its source says no other number. */
export const SOURCE_CONFIDENCE: Readonly<Record<IrSource, number>> = {
  user: 0.95,
  text_inferred: 0.8,
  derived: 0.7,
  archetype_default: 0.6,
  solver: 0.65,
  llm: 0.6,
  plan_image: 0.75,
  cad: 0.9,
  pointcloud: 0.85,
  oblique: 0.55,
  photo: 0.5,
  manual: 0.95,
};

/**
 * Which source wins a conflict, high to low: measurement, then drawings, then image inference,
 * then the solver, then archetype defaults. A person's word outranks everything.
 */
export const SOURCE_PRIORITY: Readonly<Record<IrSource, number>> = {
  user: 6,
  manual: 6,
  pointcloud: 5,
  cad: 4,
  plan_image: 3,
  photo: 3,
  oblique: 3,
  text_inferred: 3,
  llm: 3,
  derived: 2,
  solver: 2,
  archetype_default: 1,
};

/** One IR value with its provenance: only a `user` field may be locked, and a range's floor may not pass its ceiling. */
export interface IrField<T> {
  value: T;
  source: IrSource;
  confidence: number;
  locked?: boolean;
  tolerance?: number;
  range?: { min: number; max: number };
  evidence?: string;
  note?: string;
}

/** A point in the site's local ENU frame (metres, +Y north, +Z up). */
export interface IrPoint {
  x: number;
  y: number;
}

/** A closed ring in the site's local frame; the first point is not repeated at the end. */
export type IrRing = readonly IrPoint[];

/** J1 — the design brief: what was asked for, with every number carrying its provenance. */
export interface IrBrief {
  siteAreaM2: IrField<number>;
  far: IrField<number>;
  coverage: IrField<number>;
  maxHeightM: IrField<number>;
  zones: readonly IrZone[];
  keyElements: readonly string[];
  assumptions: readonly string[];
  conflicts: readonly string[];
  questions: readonly string[];
}

/** One land-use zone of the brief: its share of the site and how many buildings it holds. */
export interface IrZone {
  id: string;
  landUse: string;
  ratio: IrField<number>;
  buildings: IrField<number>;
}

/** J2 — the master plan: the site's red line, plots, road centerlines and building outlines. */
export interface IrMasterPlan {
  redLine: IrRing;
  setbackM: IrField<number>;
  plots: readonly IrPlot[];
  roads: readonly IrRoadCenterline[];
  buildingOutlines: readonly IrBuildingOutline[];
}

/** One plot of land a building may stand on. */
export interface IrPlot {
  id: string;
  ring: IrRing;
  zoneId: string;
}

/** A road's centerline with its design width; the operator turns it into pavement. */
export interface IrRoadCenterline {
  id: string;
  points: readonly IrPoint[];
  widthM: number;
}

/** Where a building stands and how tall it is, before its floors are planned. */
export interface IrBuildingOutline {
  id: string;
  plotId: string;
  ring: IrRing;
  heightM: number;
  floors: number;
  zoneId: string;
}

/** J3 — one object of the scene: its parameters, its product path and its status. */
export interface IrObject {
  id: string;
  element: TwinElement;
  kind?: TwinObjectKind;
  params: Readonly<Record<string, IrField<unknown>>>;
  outputPath: string;
  status: IrObjectStatus;
  seed: number;
  styleVersion: string;
  operatorVersion: string;
}

/** Whether an object landed whole, degraded to a rule baseline, or has not run yet. */
export const IrObjectStatus = {
  Ok: "ok",
  Degraded: "degraded",
  Pending: "pending",
} as const;
export type IrObjectStatus = (typeof IrObjectStatus)[keyof typeof IrObjectStatus];

const OBJECT_STATUSES: ReadonlySet<unknown> = new Set(Object.values(IrObjectStatus));

/** Whether a value names one of the object statuses. */
export function isIrObjectStatus(value: unknown): value is IrObjectStatus {
  return OBJECT_STATUSES.has(value);
}

/** The versioned style every object of a program builds in. */
export interface IrStyleGuide {
  id: string;
  version: string;
  palette: readonly string[];
  materialFamilies: readonly string[];
  facadeVocabulary: readonly string[];
}

/** Where the site is on Earth and how it is lit and filmed. */
export interface IrEnvironment {
  crs: string;
  origin: { lat: number; lon: number; heightM: number };
  timeOfDay: readonly string[];
  cameraTracks: readonly string[];
}

/** One external engineering data source recorded with the IR and its validation evidence. */
export interface IrDataSource {
  id: string;
  kind: TwinDataSourceKind;
  uri: string;
  crs?: string;
  units?: string;
  version?: string;
  capturedAt?: string;
  checksum?: string;
  status: "pending" | "validated" | "rejected";
  issues: readonly string[];
}

/** The whole program: one scene class, one brief, one master plan, every object. */
export interface IrProgram {
  version: 1;
  sceneClass: TwinSceneClass;
  brief: IrBrief;
  masterPlan: IrMasterPlan;
  objects: readonly IrObject[];
  styleGuide: IrStyleGuide;
  environment: IrEnvironment;
  /** External CIM/BIM/GIS/CAD/IoT inputs and their validation state. */
  dataSources?: readonly IrDataSource[];
  /** Runtime observations kept separate from geometry and renderer state. */
  telemetry?: readonly IrTelemetryPoint[];
  alarms?: readonly IrAlarm[];
  commands?: readonly IrCommand[];
  /** Optional device-to-scene bindings; written by `iot-bind` and read by the assemble operator. */
  bindings?: readonly IrBinding[];
}

/** What a self-consistency check found: a stable code and one line a person can act on. */
export interface IrIssue {
  code: IrIssueCode;
  message: string;
}

/**
 * One device-to-scene binding, written by `iot-bind`. A binding says which prim (a USD prim path
 * like `/World/Objects/B_0001`), which device in the IoT gateway, which property, and the scene
 * target it drives (`material.emissive`, `rotation.y`, `visibility`, …). `reverse` bindings also
 * let the twin command the device — those are gated by a confirmation card before any write.
 */
export interface IrBinding {
  prim: string;
  device: string;
  property: string;
  target: string;
  /** When true the twin may also write the property back to the device (reverse control). */
  reverse?: boolean;
}

/** A normalized telemetry sample; adapters may fill quality according to their protocol. */
export interface IrTelemetryPoint {
  device: string;
  property: string;
  value: number | string | boolean | null;
  unit?: string;
  at: string;
  quality: "good" | "uncertain" | "bad";
}

/** A normalized alarm independent of a renderer or vendor protocol. */
export interface IrAlarm {
  id: string;
  device: string;
  severity: "info" | "warning" | "critical";
  message: string;
  active: boolean;
  at: string;
}

/** A user-authorized command request; adapters must audit and confirm writes. */
export interface IrCommand {
  id: string;
  device: string;
  property: string;
  value: number | string | boolean | null;
  requestedBy: string;
  requestedAt: string;
  status: "pending" | "confirmed" | "sent" | "rejected";
}

/** The issue codes the brief's self-consistency check reports (ARCH-01 Q1). */
export const IrIssueCode = {
  RatioSum: "ratio_sum",
  BuildingCount: "building_count",
  ConflictUnasked: "conflict_unasked",
  TallestZoneUnknown: "tallest_zone_unknown",
} as const;
export type IrIssueCode = (typeof IrIssueCode)[keyof typeof IrIssueCode];

/** The ratio sum tolerance: zones must account for the whole site within 1%. */
const RATIO_TOLERANCE = 0.01;

/** Whether one field is well formed: a lock only a person may set, a sane range and confidence. */
export function irFieldOk<T>(field: IrField<T>): boolean {
  if (field.locked === true && field.source !== IrSource.User) return false;
  if (!Number.isFinite(field.confidence) || field.confidence < 0 || field.confidence > 1) return false;
  if (field.range && field.range.min > field.range.max) return false;
  return true;
}

/** Which of two conflicting fields wins: the higher-priority source, then the higher confidence. */
export function conflictWinner<T>(a: IrField<T>, b: IrField<T>): IrField<T> {
  const byPriority = SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source];
  if (byPriority !== 0) return byPriority > 0 ? b : a;
  return b.confidence > a.confidence ? b : a;
}

/** The program's self-consistency check (ARCH-01 Q1): four rules, each an issue or silence. */
export function irSelfConsistency(program: IrProgram): readonly IrIssue[] {
  const issues: IrIssue[] = [];
  const { brief, masterPlan } = program;
  const ratioSum = brief.zones.reduce((sum, zone) => sum + zone.ratio.value, 0);
  if (Math.abs(ratioSum - 1) > RATIO_TOLERANCE)
    issues.push({
      code: IrIssueCode.RatioSum,
      message: `land-use ratios sum to ${ratioSum.toFixed(3)}, expected 1 within ${RATIO_TOLERANCE}`,
    });
  const counted = brief.zones.reduce((sum, zone) => sum + zone.buildings.value, 0);
  const planned = masterPlan.buildingOutlines.length;
  if (counted !== planned)
    issues.push({
      code: IrIssueCode.BuildingCount,
      message: `zones count ${counted} buildings but the master plan places ${planned}`,
    });
  const tallest = masterPlan.buildingOutlines.reduce<TallestBuilding>(
    (best, outline) => (best === null || outline.heightM > best.heightM ? outline : best),
    null,
  );
  if (tallest !== null && !brief.zones.some((zone) => zone.id === tallest.zoneId))
    issues.push({
      code: IrIssueCode.TallestZoneUnknown,
      message: `the tallest building's zone "${tallest.zoneId}" is not in the zone list`,
    });
  if (brief.conflicts.length > 0 && brief.questions.length === 0)
    issues.push({
      code: IrIssueCode.ConflictUnasked,
      message: "unreconciled conflicts exist but nothing is asked of the person",
    });
  return issues;
}

/** The tallest outline of a plan so far, or null before any is seen. */
type TallestBuilding = IrBuildingOutline | null;

/**
 * The card one object is built from: derived from the IR deterministically, never by a model
 * (ARCH-01 ③). It carries the local outline, floors, height cap, road-facing and entrance edges,
 * neighbours and the seed — and it holds no facts of its own, so an IR change re-derives it.
 */
export interface IrTaskCard {
  objectId: string;
  kind: TwinObjectKind;
  element: TwinElement;
  ring: IrRing | null;
  floors: number;
  heightCapM: number;
  roadFacing: readonly string[];
  entranceEdges: readonly string[];
  neighbours: readonly string[];
  seed: number;
  styleVersion: string;
  operatorVersion: string;
}

/** The cache key one build answers to: the card, the style, the model, the operator and the seed (ARCH-01 P5). */
export function taskCardCacheKey(card: IrTaskCard): string {
  const parts = [
    card.objectId,
    card.kind,
    card.element,
    String(card.floors),
    String(card.heightCapM),
    card.roadFacing.join("+"),
    card.entranceEdges.join("+"),
    card.neighbours.join("+"),
    String(card.seed),
    card.styleVersion,
    card.operatorVersion,
  ];
  return parts.join("|");
}

/** The card one object of a program derives, or null when the object names no known element. */
export function taskCardOf(object: IrObject, plan: IrMasterPlan): IrTaskCard | null {
  if (!isTwinElement(object.element)) return null;
  const outline = plan.buildingOutlines.find((candidate) => candidate.id === object.id) ?? null;
  const kind = object.kind && isTwinObjectKind(object.kind) ? object.kind : twinElementKind(object.element);
  return {
    objectId: object.id,
    kind,
    element: object.element,
    ring: outline ? outline.ring : null,
    floors: outline ? outline.floors : 1,
    heightCapM: outline ? outline.heightM : 0,
    roadFacing: outline ? roadIdsTouching(plan, outline) : [],
    entranceEdges: [],
    neighbours: outline ? neighbourIds(plan, outline) : [],
    seed: object.seed,
    styleVersion: object.styleVersion,
    operatorVersion: object.operatorVersion,
  };
}

/** The road ids whose centerline passes within half its width (plus a metre) of the outline's ring. */
function roadIdsTouching(plan: IrMasterPlan, outline: IrBuildingOutline): readonly string[] {
  return plan.roads
    .filter((road) =>
      samplePolyline(road.points, ROAD_SAMPLE_STEP_M).some(
        (point) => ringDistance(outline.ring, point) <= road.widthM / 2 + 1,
      ),
    )
    .map((road) => road.id);
}

/** How far apart a road-facing check samples a centerline, in metres. */
const ROAD_SAMPLE_STEP_M = 1;

/** A polyline as the points a fixed step walks through it, ends included. */
function samplePolyline(points: readonly IrPoint[], stepM: number): readonly IrPoint[] {
  const sampled: IrPoint[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(length / stepM));
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      sampled.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  if (points.length > 0) sampled.push(points[points.length - 1]);
  return sampled;
}

/** The other building outlines whose rings come within `NEIGHBOUR_M` of this one. */
const NEIGHBOUR_M = 30;

function neighbourIds(plan: IrMasterPlan, outline: IrBuildingOutline): readonly string[] {
  return plan.buildingOutlines
    .filter((other) => other.id !== outline.id && ringsWithin(outline.ring, other.ring, NEIGHBOUR_M))
    .map((other) => other.id);
}

/** The shortest distance from a ring to a point, by sampling the ring's edges. */
function ringDistance(ring: IrRing, point: IrPoint): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length; index++) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    best = Math.min(best, segmentDistance(a, b, point));
  }
  return best;
}

function segmentDistance(a: IrPoint, b: IrPoint, point: IrPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function ringsWithin(a: IrRing, b: IrRing, metres: number): boolean {
  return a.some((point) => ringDistance(b, point) <= metres);
}

/** A catalog entry: one element type's engineering spec, the thing instances are made from. */
export interface TwinCatalogEntry {
  id: string;
  element: TwinElement;
  label: string;
  unit: "meters";
  params: Readonly<Record<string, { type: "number" | "string" | "boolean"; default: number | string | boolean }>>;
}

/** Whether a value is a catalog entry the operators can build from. */
export function isTwinCatalogEntry(value: unknown): value is TwinCatalogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<TwinCatalogEntry>;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    isTwinElement(entry.element) &&
    typeof entry.label === "string" &&
    entry.unit === "meters" &&
    typeof entry.params === "object" &&
    entry.params !== null
  );
}

/** Whether a value is a program the operators can build from. */
export function isIrProgram(value: unknown): value is IrProgram {
  if (typeof value !== "object" || value === null) return false;
  const program = value as Partial<IrProgram>;
  return (
    program.version === 1 &&
    isTwinSceneClass(program.sceneClass) &&
    typeof program.brief === "object" &&
    program.brief !== null &&
    typeof program.masterPlan === "object" &&
    program.masterPlan !== null &&
    Array.isArray(program.objects) &&
    (!program.dataSources || program.dataSources.every(isIrDataSource))
  );
}

/** Whether a recorded engineering data source has enough metadata for an adapter to use it. */
export function isIrDataSource(value: unknown): value is IrDataSource {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Partial<IrDataSource>;
  return (
    typeof source.id === "string" &&
    source.id.length > 0 &&
    isTwinDataSourceKind(source.kind) &&
    typeof source.uri === "string" &&
    source.uri.length > 0 &&
    (source.status === "pending" || source.status === "validated" || source.status === "rejected") &&
    Array.isArray(source.issues)
  );
}
