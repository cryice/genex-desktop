import { readFile } from "node:fs/promises";
import type {
  Activate,
  PluginContext,
  PluginNativeResult,
  PluginNativeStatus,
  PluginScalar,
} from "../../plugin-sdk/index.d.ts";
import { isIrProgram, irSelfConsistency, taskCardOf, taskCardCacheKey } from "../../shared/twin-ir.ts";
import {
  type IrBrief,
  type IrBuildingOutline,
  type IrEnvironment,
  type IrDataSource,
  type IrField,
  type IrMasterPlan,
  type IrObject,
  type IrPlot,
  type IrPoint,
  type IrProgram,
  type IrRoadCenterline,
  type IrRing,
  IrSource,
  type IrStyleGuide,
  type IrZone,
  type IrBinding,
  IrObjectStatus,
  SOURCE_CONFIDENCE,
} from "../../shared/twin-ir.ts";
import {
  isTwinSceneClass,
  isTwinElement,
  isTwinObjectKind,
  isTwinDataSourceKind,
  isTwinModelingBackend,
  isTwinRendererTarget,
  twinElementKind,
  TwinObjectKind,
  type TwinElement,
} from "../../shared/twin-elements.ts";

/**
 * Twin Park backend (API 3): the glue between the agent's tools and the deterministic Python
 * operators. It never models geometry — it stages IR and cards, runs native jobs, delivers the
 * layers the operators write, and keeps park.json as the project's single source of truth. One
 * object, one layer, at local origin: the operators hold the geometry; this file holds the wiring.
 *
 * Local modeling uses only public SDK services; no import from Studio core.
 *
 * P1 — IR-first gate: `ir-check` is a harness-only tool the `hooks` fire at `run.prepare`,
 * `checkpoint.before` and `finish`; when the ParkProgram IR is not Q1-self-consistent it answers
 * `{ block }` and Genex holds the moment back before any geometry is committed. `gen-ir` is the
 * agent tool that writes a consistent `ir.json` from a structured brief, closing the loop.
 */

/** The host services this plugin calls, by their public SDK names. */
const Host = {
  NativeRun: "native.run",
  ProjectRead: "project.read",
  ProjectWrite: "project.write",
  AssetsDeliver: "assets.deliver",
  RuntimeDetect: "runtime.detect",
} as const;

/** The native job each tool runs, as plugin.json declares them. */
const Job = {
  GenObject: "gen-object",
  GenSite: "gen-site",
  Scatter: "scatter",
  Assemble: "assemble",
  UsdGlb: "usd-glb",
} as const;

/** The native runtime each tool names. */
const Runtime = { Py: "py", Dwg: "dwg", Blender: "blender" } as const;

/** The agent tools plugin.json declares. */
const Tool = {
  NewPark: "new-park",
  IrCheck: "ir-check",
  GenIr: "gen-ir",
  UsdInfo: "usd-info",
  GenObject: "gen-object",
  GenSite: "gen-site",
  Scatter: "scatter",
  Assemble: "assemble",
  Georeference: "georeference",
  IotBind: "iot-bind",
  ExportGlb: "export-glb",
  ConfigureTarget: "configure-target",
  ExportTarget: "export-target",
} as const;

/** The runtime files new-park writes into a project (the Babylon preview, the scene and the catalog). */
const TEMPLATE_FILES = [
  "index.html",
  "park.json",
  "src/main.js",
  "src/park.js",
  "src/iot.js",
  "src/studio.js",
  "catalog/lamp-spec-a.json",
  "catalog/road-cross-section-a.json",
  "docs/CONTRACT.md",
] as const;

/** What a project's park.json holds, as this backend reads and maintains it. */
interface ParkFile {
  version: number;
  sceneClass: string;
  stage?: string;
  units?: string;
  georef?: {
    crs?: string;
    origin?: { lat: number; lon: number; heightM: number };
    enu?: {
      east: [number, number, number];
      north: [number, number, number];
      up: [number, number, number];
      originXyz: [number, number, number];
    };
    ellipsoid?: { a: number; f: number };
  };
  bindings?: ParkBinding[];
  feed?: { kind?: string; url?: string; topic?: string };
  renderTargets?: string[];
  /** The delivered layer files (project-relative) the assemble job composes; maintained by this backend. */
  layers?: string[];
  /** The web route's assets: one GLB per exported object, tagged with its element and placed by scene. */
  assets?: ParkAsset[];
}

/** One exported GLB the Babylon preview loads; its tag is the object id the scene checks read. */
interface ParkAsset {
  id: string;
  element?: string;
  glb: string;
  /** World placement [x, y, z] from the IR outline centroid; undefined leaves it at origin. */
  position?: [number, number, number];
  /** The building's floor count, for the drawer; undefined for non-buildings. */
  floor?: number;
}

/** One device-to-scene binding, written by iot-bind and read by the web route and UE5's manifest. */
interface ParkBinding {
  prim: string;
  device: string;
  property: string;
  target: string;
  /** When true the twin may also write the property back to the device (reverse control, gated). */
  reverse?: boolean;
}

/** One issue ir-check reports: a stable code and one line a person can act on. */
interface CheckIssue {
  code: string;
  message: string;
  /** error blocks a build; warn and info are advisory only. Defaults to error. */
  severity?: "error" | "warn" | "info";
}

const MESSAGE = {
  BadScene: (value: string) => `sceneClass 必须是 park / city / workshop 之一：${value}`,
  NoObject: "gen-object 需要 object 参数（对象 id，例如 B_0001）",
  NoIr: "ir.json 不存在或不是合法的 IrProgram：请先用 harness 生成 ParkProgram IR",
  NoObjectInIr: (id: string) => `ir.objects 中找不到 ${id}`,
  NoCard: (id: string) => `无法为 ${id} 派生任务卡（element 未知）`,
  NeedLatLon: "georeference 需要 lat 与 lon（数字）",
  NeedBinding: (field: string) => `iot-bind 需要 ${field} 参数`,
  UnknownTool: (name: string) => `Unknown twin-park tool: ${name}`,
  NoProgram: "gen-ir 需要一个 program 对象（或 JSON 字符串）：sceneClass、brief、masterPlan、objects",
  BadElement: (value: string) => `gen-ir: element "${value}" 不是已知要素`,
} as const;

type ToolArgs = Record<string, PluginScalar>;

/** The scene class as a human label, for the scaffold's page title. */
function sceneLabel(sceneClass: string): string {
  if (sceneClass === "city") return "数字孪生城市片区";
  if (sceneClass === "workshop") return "数字孪生车间";
  return "数字孪生园区";
}

/** A minimal park.json for the rare case a tool runs before new-park wrote one. */
function defaultPark(): ParkFile {
  return { version: 1, sceneClass: "park", bindings: [] };
}

/** The project file as parsed JSON, or null when it is absent or not JSON. */
async function readJson(ctx: PluginContext, file: string): Promise<unknown> {
  const text = await ctx.host(Host.ProjectRead, { path: file }).catch(() => null);
  if (typeof text !== "string" || text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The project file as parsed JSON, typed as ParkFile when it parses at all. */
async function readPark(ctx: PluginContext): Promise<ParkFile | null> {
  const value = await readJson(ctx, "park.json");
  return value && typeof value === "object" ? (value as ParkFile) : null;
}

/** Write a value to a project file as pretty JSON. */
async function writeJson(ctx: PluginContext, file: string, value: unknown): Promise<void> {
  await ctx.host(Host.ProjectWrite, { path: file, text: JSON.stringify(value, null, 2) });
}

/** Run a native job to completion, staging the named inputs from the project; throw on any non-completion. */
async function runJob(
  ctx: PluginContext,
  job: string,
  inputs: Record<string, string>,
  values: Record<string, string>,
): Promise<PluginNativeResult> {
  const result = await ctx.host(Host.NativeRun, { job, inputs, values });
  if (result.state !== "completed") {
    const reason = result.reason ?? result.stderr ?? result.stdout ?? "unknown failure";
    throw new Error(`native job ${job} ${result.state}: ${reason}`);
  }
  return result;
}

/** Deliver a finished job's files into the project and return their relative paths. */
async function deliver(ctx: PluginContext, job: PluginNativeResult): Promise<string[]> {
  return ctx.host(Host.AssetsDeliver, { output: job.output, jobId: job.id });
}

/** Remember delivered layer files in park.json so assemble can compose them. */
async function recordLayers(ctx: PluginContext, files: readonly string[]): Promise<void> {
  const park = await readPark(ctx);
  if (!park) return;
  const layers = new Set(park.layers ?? []);
  for (const file of files) if (file.endsWith(".usdc") || file.endsWith(".usd")) layers.add(file);
  park.layers = [...layers];
  await writeJson(ctx, "park.json", park);
}

/** Create a twin project from the bundled template: the preview, the scene descriptor and the catalog. */
async function newPark(args: ToolArgs, ctx: PluginContext) {
  const sceneClass = String(args.sceneClass ?? "park");
  if (!isTwinSceneClass(sceneClass)) throw new Error(MESSAGE.BadScene(sceneClass));
  const templateRoot = new URL("./template/", import.meta.url);
  for (const rel of TEMPLATE_FILES) {
    let text = await readFile(new URL(rel, templateRoot), "utf8");
    if (rel === "index.html") text = text.replaceAll("__PARK_TITLE__", sceneLabel(sceneClass));
    if (rel === "park.json") {
      const park = JSON.parse(text) as ParkFile;
      park.sceneClass = sceneClass;
      park.stage = `${sceneClass}.usd`;
      text = JSON.stringify(park, null, 2);
    }
    await ctx.host(Host.ProjectWrite, { path: rel, text });
  }
  return { ok: true, sceneClass, files: [...TEMPLATE_FILES] };
}

/**
 * The Q0 (manifest scene class known) and Q1 (IR self-consistency) issues of a project, as a pure
 * function over the already-read park and ir. Exported so the gate's logic is unit-testable.
 */
export function computeIrIssues(
  park: { sceneClass: string; georef?: { origin?: { lat: number; lon: number; heightM: number } } } | null,
  ir: unknown,
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  if (!park) issues.push({ code: "q0-no-park", message: "park.json 缺失" });
  else if (!isTwinSceneClass(park.sceneClass))
    issues.push({ code: "q0-bad-scene", message: MESSAGE.BadScene(park.sceneClass) });
  else if (!park.georef?.origin)
    issues.push({
      code: "q0-no-georef",
      message: "未设置地理参考（georeference）：当前为沙盘模式，非地理配准孪生",
      severity: "info",
    });
  if (!ir) issues.push({ code: "q0-no-ir", message: "ir.json 不存在：先由 harness 生成 ParkProgram IR" });
  else if (!isIrProgram(ir)) issues.push({ code: "q0-bad-ir", message: "ir.json 不是合法的 IrProgram" });
  else for (const issue of irSelfConsistency(ir)) issues.push({ code: `q1-${issue.code}`, message: issue.message });
  return issues;
}

/**
 * The handler's answer for a moment: blocking on the first error (so Genex holds the
 * moment back) and a note listing them all, or empty when nothing blocks. `warn` and `info`
 * issues are advisory and never block — a park without georeferencing is allowed as a diorama.
 * Pure and testable.
 */
export function irHookAnswer(issues: CheckIssue[]): { block?: string; note?: string } {
  const blocking = issues.filter((issue) => (issue.severity ?? "error") === "error");
  if (blocking.length === 0) return {};
  const reasons = blocking.map((issue) => `${issue.code}: ${issue.message}`);
  return { block: reasons[0].slice(0, 300), note: reasons.join(" ; ") };
}

/** Q0 (manifest and scene class known) and Q1 (IR self-consistency) of ARCH-01, read before a build. */
async function irCheck(ctx: PluginContext) {
  const park = await readPark(ctx);
  const ir = await readJson(ctx, "ir.json");
  const issues = computeIrIssues(park, ir);
  if (ctx.hook) return irHookAnswer(issues);
  return { ok: issues.length === 0, issues, q0: park !== null, q1: ir !== null && isIrProgram(ir) };
}

/** The native runtimes' readiness on this computer, with what to tell the user when one is missing. */
async function usdInfo(ctx: PluginContext) {
  const py = await ctx.host(Host.RuntimeDetect, { runtime: Runtime.Py });
  const dwg = await ctx.host(Host.RuntimeDetect, { runtime: Runtime.Dwg });
  const blender = await ctx.host(Host.RuntimeDetect, { runtime: Runtime.Blender });
  const status = (s: PluginNativeStatus) => ({ state: s.state, version: s.version ?? null, detail: s.detail });
  const guidance =
    py.state === "ready"
      ? "USD 工具链就绪，可以重建几何与总装。"
      : "本机未检出含 pxr 的 Python（≥24.11）。请在 Settings › Plugins › Twin Park 指定 program 路径，或安装 openusd。";
  return { py: status(py), dwg: status(dwg), blender: status(blender), guidance };
}

/** The operator the gen-object job runs for a kind: building, landmark, or asset for the rest. */
function genObjectJobKind(kind: TwinObjectKind | undefined): "building" | "landmark" | "asset" {
  if (kind === TwinObjectKind.Building) return "building";
  if (kind === TwinObjectKind.Landmark) return "landmark";
  return "asset";
}

/** Rebuild one object's .usdc from its IR task card (paradigm 1 parametric, or paradigm 3 asset). */
async function genObject(args: ToolArgs, ctx: PluginContext) {
  const id = String(args.object ?? "").trim();
  if (!id) throw new Error(MESSAGE.NoObject);
  const ir = await readJson(ctx, "ir.json");
  if (!isIrProgram(ir)) throw new Error(MESSAGE.NoIr);
  const object = ir.objects.find((candidate) => candidate.id === id);
  if (!object) throw new Error(MESSAGE.NoObjectInIr(id));
  const card = taskCardOf(object, ir.masterPlan);
  if (!card) throw new Error(MESSAGE.NoCard(id));
  const cardPath = `cards/${id}.json`;
  await writeJson(ctx, cardPath, card);
  const kind = genObjectJobKind(object.kind);
  const job = await runJob(ctx, Job.GenObject, { "card.json": cardPath }, { kind });
  const files = await deliver(ctx, job);
  await recordLayers(ctx, files);
  return { object: id, kind, card: taskCardCacheKey(card), files };
}

/** Build the site layer (roads, kerbs, landscape, terrain) from the IR master plan. */
async function genSite(ctx: PluginContext) {
  const ir = await readJson(ctx, "ir.json");
  if (!isIrProgram(ir)) throw new Error(MESSAGE.NoIr);
  const job = await runJob(ctx, Job.GenSite, { "ir.json": "ir.json" }, {});
  const files = await deliver(ctx, job);
  await recordLayers(ctx, files);
  return { files };
}

/** Place catalog instances (lamps, trees, furniture) as PointInstancers. */
async function scatter(ctx: PluginContext) {
  const ir = await readJson(ctx, "ir.json");
  if (!isIrProgram(ir)) throw new Error(MESSAGE.NoIr);
  const job = await runJob(ctx, Job.Scatter, { "ir.json": "ir.json" }, {});
  const files = await deliver(ctx, job);
  await recordLayers(ctx, files);
  return { files };
}

/** Compose the delivery package: master_twin.usda, twin_manifest.json and the Q3 scene QA. */
async function assemble(ctx: PluginContext) {
  const ir = await readJson(ctx, "ir.json");
  if (!isIrProgram(ir)) throw new Error(MESSAGE.NoIr);
  const park = await readPark(ctx);
  const layers = (park?.layers ?? []).slice(0, 11);
  const inputs: Record<string, string> = { "ir.json": "ir.json" };
  layers.forEach((layer, index) => {
    inputs[`layer${String(index + 1).padStart(2, "0")}`] = layer;
  });
  const job = await runJob(ctx, Job.Assemble, inputs, {});
  const files = await deliver(ctx, job);
  return { files, layers };
}

/** CGCS2000 ellipsoid (GRS80-based) in metres; the datum every twin layer is anchored to. */
export const CGCS2000_ELLIPSOID = { a: 6378137.0, f: 1 / 298.257222101 };

/** Geodetic (degrees, metres) to Earth-Centred Earth-Fixed Cartesian on a given ellipsoid. */
function geodeticToEcef(
  latDeg: number,
  lonDeg: number,
  h: number,
  ellipsoid: { a: number; f: number },
): [number, number, number] {
  const { a, f } = ellipsoid;
  const e2 = f * (2 - f);
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const x = (n + h) * Math.cos(lat) * Math.cos(lon);
  const y = (n + h) * Math.cos(lat) * Math.sin(lon);
  const z = (n * (1 - e2) + h) * Math.sin(lat);
  return [x, y, z];
}

/** ECEF minus the origin's ECEF, rotated into the origin's local East-North-Up frame. */
function ecefToEnu(
  lat0Deg: number,
  lon0Deg: number,
  p: [number, number, number],
  p0: [number, number, number],
): [number, number, number] {
  const lat0 = (lat0Deg * Math.PI) / 180;
  const lon0 = (lon0Deg * Math.PI) / 180;
  const dx = p[0] - p0[0];
  const dy = p[1] - p0[1];
  const dz = p[2] - p0[2];
  const sinLat = Math.sin(lat0);
  const cosLat = Math.cos(lat0);
  const sinLon = Math.sin(lon0);
  const cosLon = Math.cos(lon0);
  const east = -sinLon * dx + cosLon * dy;
  const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const up = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;
  return [east, north, up];
}

/** Convert a geodetic point into the local ENU (East-North-Up) metre frame whose origin is `origin`.
 * Standard topocentric transform on the CGCS2000 ellipsoid; centimetre-accurate across a park footprint. */
export function geodeticToEnu(
  origin: { lat: number; lon: number; h: number },
  point: { lat: number; lon: number; h: number },
  ellipsoid: { a: number; f: number } = CGCS2000_ELLIPSOID,
): [number, number, number] {
  const o = geodeticToEcef(origin.lat, origin.lon, origin.h, ellipsoid);
  const p = geodeticToEcef(point.lat, point.lon, point.h, ellipsoid);
  return ecefToEnu(origin.lat, origin.lon, p, o);
}

/** Set the site's CGCS2000 local frame: convert the origin's lat/lon/height into an ENU local metre
 * frame every layer is built around, and store it in park.json and the IR environment. */
async function georeference(args: ToolArgs, ctx: PluginContext) {
  const lat = Number(args.lat);
  const lon = Number(args.lon);
  const heightM = args.heightM === undefined ? 0 : Number(args.heightM);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(MESSAGE.NeedLatLon);
  const park = (await readPark(ctx)) ?? defaultPark();
  park.georef = {
    crs: "CGCS2000",
    origin: { lat, lon, heightM },
    enu: { east: [1, 0, 0], north: [0, 1, 0], up: [0, 0, 1], originXyz: [0, 0, 0] },
    ellipsoid: CGCS2000_ELLIPSOID,
  };
  await writeJson(ctx, "park.json", park);
  const ir = await readJson(ctx, "ir.json");
  if (isIrProgram(ir)) {
    ir.environment.origin = { lat, lon, heightM };
    await writeJson(ctx, "ir.json", ir);
  }
  return { georef: park.georef };
}

/** Bind a device to a scene target; one binding serves the web route and UE5's manifest keys. */
async function iotBind(args: ToolArgs, ctx: PluginContext) {
  for (const field of ["prim", "device", "property", "target"]) {
    if (!String(args[field] ?? "").trim()) throw new Error(MESSAGE.NeedBinding(field));
  }
  const reverse = args.reverse === true || String(args.reverse ?? "") === "true";
  const park = (await readPark(ctx)) ?? defaultPark();
  park.bindings = park.bindings ?? [];
  const binding: ParkBinding = {
    prim: String(args.prim),
    device: String(args.device),
    property: String(args.property),
    target: String(args.target),
    reverse,
  };
  park.bindings.push(binding);
  await writeJson(ctx, "park.json", park);
  // Mirror the binding into the IR so the assemble operator can emit UE5's binding keys from one source.
  const ir = await readJson(ctx, "ir.json");
  if (isIrProgram(ir)) {
    const bindings = (ir.bindings ?? []).filter(
      (entry: IrBinding) => entry.prim !== binding.prim || entry.device !== binding.device,
    );
    bindings.push({
      prim: binding.prim,
      device: binding.device,
      property: binding.property,
      target: binding.target,
      reverse,
    });
    ir.bindings = bindings;
    await writeJson(ctx, "ir.json", ir);
  }
  return { bindings: park.bindings.length, last: binding };
}

/** A building outline's centroid in the site's local ENU frame, for placing its exported GLB. */
function outlineCentroid(
  ring: { x: number; y: number }[] | readonly { x: number; y: number }[],
): [number, number, number] {
  const xs = ring.map((point) => point.x);
  const ys = ring.map((point) => point.y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** Export one object's USD layer to GLB for the web route, through local Blender's USD importer. */
async function exportGlb(args: ToolArgs, ctx: PluginContext) {
  const object = String(args.object ?? "").trim();
  if (!object) throw new Error(MESSAGE.NoObject);
  const park = (await readPark(ctx)) ?? defaultPark();
  const layer = (park.layers ?? []).find((file) => file.includes(object)) ?? `objects/${object}.usdc`;
  const name = object.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const job = await runJob(ctx, Job.UsdGlb, { "object.usdc": layer }, { name });
  const files = await deliver(ctx, job);
  const glb = files.find((file) => file.endsWith(".glb")) ?? `${name}.glb`;
  // Record the GLB as a web asset so the Babylon preview loads and tags it; the stage gives its place.
  const ir = await readJson(ctx, "ir.json");
  let element: string | undefined;
  let floor: number | undefined;
  let position: [number, number, number] | undefined;
  if (isIrProgram(ir)) {
    const obj = ir.objects.find((candidate) => candidate.id === object);
    element = obj?.element;
    const outline = ir.masterPlan.buildingOutlines.find((candidate) => candidate.id === object);
    if (outline) {
      floor = outline.floors;
      if (outline.ring.length > 0) position = outlineCentroid(outline.ring);
    }
  }
  park.assets = park.assets ?? [];
  const existing = park.assets.findIndex((asset) => asset.id === object);
  const asset: ParkAsset = { id: object, element, glb, position, floor };
  if (existing >= 0) park.assets[existing] = asset;
  else park.assets.push(asset);
  await writeJson(ctx, "park.json", park);
  return { object, glb, asset, files };
}

// ---------------------------------------------------------------------------
// P1 — gen-ir: write a consistent ParkProgram IR from a structured brief.
// ---------------------------------------------------------------------------

/** Loose record helpers (values arrive as JSON from the agent). */
type Raw = Record<string, unknown>;
const asObject = (value: unknown): Raw | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null;
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asStringArray = (value: unknown): string[] =>
  asArray(value)
    .map((x) => String(x))
    .filter((s) => s.length > 0);
const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
};

/** A point in the site's local ENU frame, from `[x, y]` or `{ x, y }`. */
function toPoint(value: unknown): IrPoint | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = asNumber(value[0]);
    const y = asNumber(value[1]);
    if (x !== null && y !== null) return { x, y };
    return null;
  }
  const point = asObject(value);
  if (point) {
    const x = asNumber(point.x);
    const y = asNumber(point.y);
    if (x !== null && y !== null) return { x, y };
  }
  return null;
}

/** A closed ring from an array of points (the first point is not repeated at the end). */
function toRing(value: unknown): IrRing {
  return asArray(value)
    .map(toPoint)
    .filter((point): point is IrPoint => point !== null);
}

/** A numeric IR field, defaulting its provenance to the LLM chain. */
function fieldNum(value: unknown, source: IrSource = IrSource.Llm): IrField<number> {
  return { value: asNumber(value) ?? 0, source, confidence: SOURCE_CONFIDENCE[source] };
}

/** An IR field of any type: keep an explicit Field, or wrap a bare value. */
function fieldUnknown(value: unknown, source: IrSource = IrSource.Llm): IrField<unknown> {
  const record = asObject(value);
  if (record && "value" in record) {
    return {
      value: record.value,
      source: (record.source as IrSource) ?? source,
      confidence: typeof record.confidence === "number" ? record.confidence : SOURCE_CONFIDENCE[source],
    } as IrField<unknown>;
  }
  return { value, source, confidence: SOURCE_CONFIDENCE[source] };
}

/** A deterministic seed from an object id, so a rebuild is reproducible without the agent guessing. */
function seedOf(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100000;
}

/** J1 — the design brief, with every number wrapped into a provenance field. */
function normalizeBrief(raw: Raw): IrBrief {
  const zones: IrZone[] = asArray(raw.zones).map((zone, index) => {
    const entry = asObject(zone) ?? {};
    return {
      id: typeof entry.id === "string" && entry.id ? entry.id : `Z${index + 1}`,
      landUse: String(entry.landUse ?? "mixed"),
      ratio: fieldNum(entry.ratio, IrSource.Llm),
      buildings: fieldNum(entry.buildings, IrSource.Llm),
    };
  });
  return {
    siteAreaM2: fieldNum(raw.siteAreaM2),
    far: fieldNum(raw.far),
    coverage: fieldNum(raw.coverage),
    maxHeightM: fieldNum(raw.maxHeightM),
    zones,
    keyElements: asStringArray(raw.keyElements),
    assumptions: asStringArray(raw.assumptions),
    conflicts: asStringArray(raw.conflicts),
    questions: asStringArray(raw.questions),
  };
}

/** J2 — the master plan: red line, plots, road centerlines and building outlines. */
function normalizeMasterPlan(raw: Raw, zoneIds: readonly string[]): IrMasterPlan {
  const plots: IrPlot[] = asArray(raw.plots).map((plot, index) => {
    const entry = asObject(plot) ?? {};
    return {
      id: String(entry.id ?? `P${index + 1}`),
      ring: toRing(entry.ring),
      zoneId: String(entry.zoneId ?? zoneIds[0] ?? ""),
    };
  });
  const roads: IrRoadCenterline[] = asArray(raw.roads).map((road, index) => {
    const entry = asObject(road) ?? {};
    return {
      id: String(entry.id ?? `R${index + 1}`),
      points: toRing(entry.points),
      widthM: asNumber(entry.widthM) ?? 8,
    };
  });
  const buildingOutlines: IrBuildingOutline[] = asArray(raw.buildingOutlines).map((outline, index) => {
    const entry = asObject(outline) ?? {};
    return {
      id: String(entry.id ?? `B${index + 1}`),
      plotId: String(entry.plotId ?? ""),
      ring: toRing(entry.ring),
      heightM: asNumber(entry.heightM) ?? 0,
      floors: asNumber(entry.floors) ?? 1,
      zoneId: String(entry.zoneId ?? ""),
    };
  });
  return {
    redLine: toRing(raw.redLine),
    setbackM: fieldNum(raw.setbackM),
    plots,
    roads,
    buildingOutlines,
  };
}

/** One object's parameters as provenance fields, from a raw params record. */
function normalizeParams(raw: unknown): Record<string, IrField<unknown>> {
  const params: Record<string, IrField<unknown>> = {};
  for (const [key, value] of Object.entries(asObject(raw) ?? {})) params[key] = fieldUnknown(value);
  return params;
}

/** An object's kind: an explicit known kind, or the default its element generates as. */
function resolveObjectKind(object: Raw, element: TwinElement): TwinObjectKind {
  if (object.kind && isTwinObjectKind(String(object.kind) as TwinObjectKind))
    return String(object.kind) as TwinObjectKind;
  return twinElementKind(element);
}

/** One scene object of J3: a known element, its resolved kind, wrapped params and a product path. */
function normalizeObject(entry: unknown, index: number, styleVersion: string, operatorVersion: string): IrObject {
  const object = asObject(entry) ?? {};
  const id = String(object.id ?? `O${index + 1}`);
  const element = String(object.element ?? "") as TwinElement;
  if (!isTwinElement(element)) throw new Error(MESSAGE.BadElement(element));
  return {
    id,
    element,
    kind: resolveObjectKind(object, element),
    params: normalizeParams(object.params),
    outputPath: String(object.outputPath ?? `objects/${id}.usdc`),
    status: IrObjectStatus.Pending,
    seed: typeof object.seed === "number" ? object.seed : seedOf(id),
    styleVersion: String(object.styleVersion ?? styleVersion),
    operatorVersion: String(object.operatorVersion ?? operatorVersion),
  };
}

/** J3 — every scene object, with a default kind from its element and an operator version. */
function normalizeObjects(raw: unknown, styleVersion: string, operatorVersion: string): IrObject[] {
  return asArray(raw).map((entry, index) => normalizeObject(entry, index, styleVersion, operatorVersion));
}

/** Normalize external engineering inputs while preserving their validation state and provenance. */
function normalizeDataSources(raw: unknown): IrDataSource[] {
  return asArray(raw).flatMap((entry, index) => {
    const source = asObject(entry) ?? {};
    const kind = String(source.kind ?? "");
    if (!isTwinDataSourceKind(kind)) return [];
    return [
      {
        id: String(source.id ?? `source-${index + 1}`),
        kind,
        uri: String(source.uri ?? ""),
        ...(typeof source.crs === "string" ? { crs: source.crs } : {}),
        ...(typeof source.units === "string" ? { units: source.units } : {}),
        ...(typeof source.version === "string" ? { version: source.version } : {}),
        status: source.status === "validated" || source.status === "rejected" ? source.status : "pending",
        issues: asStringArray(source.issues),
      } satisfies IrDataSource,
    ];
  });
}

/** The Earth anchor, preferring an explicit environment origin, then the project's georef, then zero. */
function originFrom(originRaw: Raw | null, georef: ParkFile["georef"] | undefined): IrEnvironment["origin"] {
  if (originRaw)
    return {
      lat: asNumber(originRaw.lat) ?? 0,
      lon: asNumber(originRaw.lon) ?? 0,
      heightM: asNumber(originRaw.heightM) ?? 0,
    };
  if (georef?.origin) return { lat: georef.origin.lat, lon: georef.origin.lon, heightM: georef.origin.heightM };
  return { lat: 0, lon: 0, heightM: 0 };
}

/** The first non-empty string list a raw value carries, or the fallback. */
function firstList(value: unknown, fallback: readonly string[]): readonly string[] {
  const list = asStringArray(value);
  return list.length > 0 ? list : fallback;
}

/** The site's Earth anchor and how it is lit and filmed, from the explicit environment or the georef. */
function buildEnvironment(georef: ParkFile["georef"] | undefined, raw: Raw | null): IrEnvironment {
  return {
    crs: raw && typeof raw.crs === "string" ? raw.crs : "CGCS2000",
    origin: originFrom(raw ? asObject(raw.origin) : null, georef),
    timeOfDay: firstList(raw?.timeOfDay, ["09:00", "15:00", "19:00"]),
    cameraTracks: firstList(raw?.cameraTracks, ["aerial", "street"]),
  };
}

const STYLE_VERSION = "1.0.0";
const OPERATOR_VERSION = "twin-park-0.1";
const DEFAULT_STYLE: IrStyleGuide = {
  id: "twin-park",
  version: STYLE_VERSION,
  palette: ["concrete", "glass", "steel"],
  materialFamilies: ["masonry", "metal"],
  facadeVocabulary: ["grid", "ribbon"],
};

/** Parse a JSON string into a record, or null when it is not valid JSON for a record. */
function safeJsonRecord(text: string): Raw | null {
  try {
    return asObject(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Write a consistent ParkProgram IR (`ir.json`) from a structured brief: the agent supplies the
 * design decisions (the J1/J2/J3 content), this tool wraps every number into a provable `Field`
 * (source `llm`), derives the scene class and georef, and runs Q1 self-consistency. It writes the
 * file regardless (so geometry tools have data to read) and reports any issues the `ir-check` hook
 * will then block on; the harness fixes the brief and reruns until Q1 passes.
 */
async function genIr(args: ToolArgs, ctx: PluginContext) {
  const raw = typeof args.program === "string" ? safeJsonRecord(args.program) : asObject(args.program);
  if (!raw) throw new Error(MESSAGE.NoProgram);
  const sceneClass = String(raw.sceneClass ?? "park");
  if (!isTwinSceneClass(sceneClass)) throw new Error(MESSAGE.BadScene(sceneClass));
  const park = await readPark(ctx);
  const brief = normalizeBrief(asObject(raw.brief) ?? {});
  const masterPlan = normalizeMasterPlan(
    asObject(raw.masterPlan) ?? {},
    brief.zones.map((zone) => zone.id),
  );
  const objects = normalizeObjects(raw.objects, STYLE_VERSION, OPERATOR_VERSION);
  const dataSources = normalizeDataSources(raw.dataSources);
  const environment = buildEnvironment(park?.georef, asObject(raw.environment));
  const program: IrProgram = {
    version: 1,
    sceneClass,
    brief,
    masterPlan,
    objects,
    styleGuide: DEFAULT_STYLE,
    environment,
    ...(dataSources.length > 0 ? { dataSources } : {}),
  };
  if (!isIrProgram(program)) throw new Error("gen-ir: 生成的 IrProgram 结构不完整");
  const issues = irSelfConsistency(program).map((issue) => ({ code: `q1-${issue.code}`, message: issue.message }));
  await writeJson(ctx, "ir.json", program);
  if (park) {
    park.sceneClass = sceneClass;
    await writeJson(ctx, "park.json", park);
  }
  return { ok: issues.length === 0, issues, written: "ir.json", objectCount: objects.length, sceneClass };
}

/** Persist the selected modeling backend and renderer target for deterministic exports. */
async function configureTarget(args: ToolArgs, ctx: PluginContext) {
  const renderer = String(args.renderer ?? "");
  const modeling = String(args.modeling ?? "");
  if (!isTwinRendererTarget(renderer)) throw new Error(`不支持的渲染目标：${renderer}`);
  if (!isTwinModelingBackend(modeling)) throw new Error(`不支持的建模后端：${modeling}`);
  const output = rendererOutput(renderer);
  const target = {
    version: 1,
    renderer,
    modeling,
    coordinateFrame: "local-enu",
    units: "meters",
    output,
  };
  await writeJson(ctx, "twin-target.json", target);
  return target;
}

/** Write an engine-neutral export manifest consumed by the selected renderer adapter. */
async function exportTarget(ctx: PluginContext) {
  const target = await readJson(ctx, "twin-target.json");
  if (!target || typeof target !== "object") throw new Error("请先运行 configure-target 选择建模后端和渲染目标");
  const ir = await readJson(ctx, "ir.json");
  if (!ir || typeof ir !== "object") throw new Error("请先生成 ir.json");
  const manifest = {
    version: 1,
    target,
    source: { ir: "ir.json", usd: "master_twin.usda", manifest: "twin_manifest.json" },
    coordinateFrame: "local-enu",
    units: "meters",
    generatedAt: new Date().toISOString(),
  };
  await writeJson(ctx, "exports/twin-export.json", manifest);
  return { ok: true, path: "exports/twin-export.json", target };
}

/** The project output shape for one renderer target. */
function rendererOutput(renderer: string): "web" | "godot-project" | "unreal-project" {
  if (renderer === "babylon") return "web";
  if (renderer === "godot") return "godot-project";
  return "unreal-project";
}

/** Local modeling uses only public SDK services; no import from Studio core. */
export const activate: Activate = () => ({
  async action(name, _args, ctx) {
    if (name === "workspace-status") {
      const park = await readPark(ctx);
      return {
        sceneClass: park?.sceneClass ?? null,
        hasIr: Boolean(await readJson(ctx, "ir.json")),
        hasManifest: Boolean(await readJson(ctx, "twin_manifest.json")),
      };
    }
    if (name === "check-ir") return irCheck(ctx);
    throw new Error(MESSAGE.UnknownTool(name));
  },
  async tool(name, args, ctx) {
    switch (name) {
      case Tool.NewPark:
        return newPark(args, ctx);
      case Tool.IrCheck:
        return irCheck(ctx);
      case Tool.GenIr:
        return genIr(args, ctx);
      case Tool.UsdInfo:
        return usdInfo(ctx);
      case Tool.GenObject:
        return genObject(args, ctx);
      case Tool.GenSite:
        return genSite(ctx);
      case Tool.Scatter:
        return scatter(ctx);
      case Tool.Assemble:
        return assemble(ctx);
      case Tool.Georeference:
        return georeference(args, ctx);
      case Tool.IotBind:
        return iotBind(args, ctx);
      case Tool.ExportGlb:
        return exportGlb(args, ctx);
      case Tool.ConfigureTarget:
        return configureTarget(args, ctx);
      case Tool.ExportTarget:
        return exportTarget(ctx);
      default:
        throw new Error(MESSAGE.UnknownTool(name));
    }
  },
});
