/**
 * The twin vocabularies the studio decides behavior by: scene classes, engineering elements and
 * the object kinds they generate as. House rule: one table per vocabulary, values in their exact
 * wire spelling, and behavior reads typed codes — never English text.
 *
 * A digital twin is built of engineering elements (buildings, equipment, roads, lamps), not of
 * styled art assets; see `twin-ir.ts` for the program they are assembled into.
 */

/** The scene classes a twin project may be (§2.4 of the twin design): one IR and one operator set, three sets of requirements. */
export const TwinSceneClass = {
  Park: "park",
  City: "city",
  Workshop: "workshop",
} as const;
export type TwinSceneClass = (typeof TwinSceneClass)[keyof typeof TwinSceneClass];

const SCENE_CLASSES: ReadonlySet<unknown> = new Set(Object.values(TwinSceneClass));

/** Whether a value names one of the scene classes. */
export function isTwinSceneClass(value: unknown): value is TwinSceneClass {
  return SCENE_CLASSES.has(value);
}

/**
 * The engineering elements a twin is made of. An element is a kind of thing in the world with a
 * type (its catalog entry) and instances; it is not a mesh — geometry is generated from the IR by
 * the operators, and an element may carry data bindings (a lamp's device) beside its shape.
 */
export const TwinElement = {
  Site: "site",
  Terrain: "terrain",
  Plaza: "plaza",
  Water: "water",
  Parking: "parking",
  Building: "building",
  Floor: "floor",
  Room: "room",
  Road: "road",
  Lane: "lane",
  Crossing: "crossing",
  Tree: "tree",
  Shrub: "shrub",
  Lamp: "lamp",
  Luminaire: "luminaire",
  Bench: "bench",
  Sign: "sign",
  Camera: "camera",
  Gate: "gate",
  Pipe: "pipe",
  Valve: "valve",
  Equipment: "equipment",
  Workstation: "workstation",
  ProductionLine: "production-line",
} as const;
export type TwinElement = (typeof TwinElement)[keyof typeof TwinElement];

const ELEMENTS: ReadonlySet<unknown> = new Set(Object.values(TwinElement));

/** Whether a value names one of the engineering elements. */
export function isTwinElement(value: unknown): value is TwinElement {
  return ELEMENTS.has(value);
}

/**
 * The object kinds a task card may name: each kind is a six-piece registry entry (prompt
 * template, parameter Schema, operator, QA rules, degradation ladder, rule baseline). The first
 * six are the reference architecture's set; `Device` and the workshop kinds extend it for
 * cameras/gates/utilities and for factory scenes.
 */
export const TwinObjectKind = {
  Building: "building",
  Landmark: "landmark",
  Road: "road",
  Landscape: "landscape",
  VegetationLamp: "vegetation-lamp",
  Device: "device",
  Env: "env",
  Equipment: "equipment",
  ProductionLine: "production-line",
} as const;
export type TwinObjectKind = (typeof TwinObjectKind)[keyof typeof TwinObjectKind];

const OBJECT_KINDS: ReadonlySet<unknown> = new Set(Object.values(TwinObjectKind));

/** Whether a value names one of the object kinds. */
export function isTwinObjectKind(value: unknown): value is TwinObjectKind {
  return OBJECT_KINDS.has(value);
}

/**
 * The kind an element generates as when nothing says otherwise. A task card may promote a
 * building to `landmark` (a T2 DSL build) and a workshop's equipment stays `equipment`; the
 * mapping only has to cover the common case.
 */
const ELEMENT_KIND: Readonly<Record<TwinElement, TwinObjectKind>> = {
  site: TwinObjectKind.Landscape,
  terrain: TwinObjectKind.Landscape,
  plaza: TwinObjectKind.Landscape,
  water: TwinObjectKind.Landscape,
  parking: TwinObjectKind.Landscape,
  building: TwinObjectKind.Building,
  floor: TwinObjectKind.Building,
  room: TwinObjectKind.Building,
  road: TwinObjectKind.Road,
  lane: TwinObjectKind.Road,
  crossing: TwinObjectKind.Road,
  tree: TwinObjectKind.VegetationLamp,
  shrub: TwinObjectKind.VegetationLamp,
  lamp: TwinObjectKind.VegetationLamp,
  luminaire: TwinObjectKind.VegetationLamp,
  bench: TwinObjectKind.VegetationLamp,
  sign: TwinObjectKind.VegetationLamp,
  camera: TwinObjectKind.Device,
  gate: TwinObjectKind.Device,
  pipe: TwinObjectKind.Device,
  valve: TwinObjectKind.Device,
  equipment: TwinObjectKind.Equipment,
  workstation: TwinObjectKind.Equipment,
  "production-line": TwinObjectKind.ProductionLine,
};

/** The kind an element generates as when its task card names none. */
export function twinElementKind(element: TwinElement): TwinObjectKind {
  return ELEMENT_KIND[element];
}

/** The elements one kind covers, for the skills and the operator picker. */
export function twinKindElements(kind: TwinObjectKind): readonly TwinElement[] {
  return (Object.keys(ELEMENT_KIND) as TwinElement[]).filter((element) => ELEMENT_KIND[element] === kind);
}
