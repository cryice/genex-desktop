/**
 * Standard crosswalk for twin elements — the single place that maps each engineering element to
 * its identifiers in the modeling standards a park/city/workshop twin is built against. The
 * reference operators read this table to emit standards-correct metadata, and the IR validators
 * read it to confirm a scene stays inside its declared LOD bracket. A code change lands once.
 *
 * Standards in scope:
 *  - GB/T 51269-2017 建筑信息模型分类和编码标准 (BIM classification; code values from its annex)
 *  - CityGML 3.0 / CityJSON (OGC city model; class names are exact)
 *  - IFC 4.3 = ISO 16739-1:2024 (building/infrastructure model; entity names are exact)
 *  - CJJ/T 318-2023 城市信息模型应用统一标准 (Chinese CIM object classification)
 *
 * The `gbt51269` column names the classification domain: building works use GB/T 51269-2017
 * directly; municipal/landscape/utility objects follow CJJ/T 318-2023 object classes and are
 * noted as such. Fill the exact numeric code from the standard annex per project.
 */

import type { TwinElement, TwinSceneClass } from "./twin-elements.ts";

/** One element's standing in each modeling standard. */
export interface ElementStandard {
  /** GB/T 51269-2017 domain (building works, or CJJ/T 318 municipal class). Numeric code per project. */
  gbt51269: string;
  /** CityGML 3.0 / CityJSON class name. */
  citygml: string;
  /** IFC 4.3 (ISO 16739-1:2024) entity name. */
  ifc: string;
  /** CJJ/T 318-2023 CIM object class (Chinese). */
  cim: string;
  /** Recommended CityGML level of detail for this element. */
  citygmlLod: string;
  /** Recommended BIMForum level of development for this element. */
  bimLod: string;
}

/** Every engineering element and its standard identifiers. */
export const TwinElementStandards: Readonly<Record<TwinElement, ElementStandard>> = {
  site: {
    gbt51269: "建筑工程-场地",
    citygml: "LandUse",
    ifc: "IfcSite",
    cim: "场地",
    citygmlLod: "LOD1",
    bimLod: "LOD100",
  },
  terrain: {
    gbt51269: "建筑工程-场地(地形)",
    citygml: "ReliefFeature",
    ifc: "IfcGeographicElement",
    cim: "地形",
    citygmlLod: "LOD1",
    bimLod: "LOD100",
  },
  plaza: {
    gbt51269: "CJJ/T 318-开放空间",
    citygml: "LandUse",
    ifc: "IfcCivilElement",
    cim: "广场",
    citygmlLod: "LOD1",
    bimLod: "LOD100",
  },
  water: {
    gbt51269: "CJJ/T 318-水体",
    citygml: "WaterBody",
    ifc: "IfcGeographicElement",
    cim: "水体",
    citygmlLod: "LOD1",
    bimLod: "LOD100",
  },
  parking: {
    gbt51269: "CJJ/T 318-停车场地",
    citygml: "LandUse",
    ifc: "IfcCivilElement",
    cim: "停车场地",
    citygmlLod: "LOD1",
    bimLod: "LOD100",
  },
  building: {
    gbt51269: "建筑工程-主体结构",
    citygml: "Building",
    ifc: "IfcBuilding",
    cim: "建筑物",
    citygmlLod: "LOD2",
    bimLod: "LOD300",
  },
  floor: {
    gbt51269: "建筑工程-主体结构",
    citygml: "Building",
    ifc: "IfcBuildingStorey",
    cim: "楼层",
    citygmlLod: "LOD3",
    bimLod: "LOD300",
  },
  room: {
    gbt51269: "建筑工程-建筑装饰装修",
    citygml: "BuildingInstallation",
    ifc: "IfcSpace",
    cim: "房间(室内)",
    citygmlLod: "LOD4",
    bimLod: "LOD400",
  },
  road: {
    gbt51269: "CJJ/T 318-道路",
    citygml: "Road",
    ifc: "IfcRoad",
    cim: "道路",
    citygmlLod: "LOD2",
    bimLod: "LOD200",
  },
  lane: {
    gbt51269: "CJJ/T 318-道路",
    citygml: "Road",
    ifc: "IfcRoadPart",
    cim: "车道",
    citygmlLod: "LOD2",
    bimLod: "LOD200",
  },
  crossing: {
    gbt51269: "CJJ/T 318-道路",
    citygml: "Road",
    ifc: "IfcRoadPart",
    cim: "交叉口",
    citygmlLod: "LOD2",
    bimLod: "LOD200",
  },
  tree: {
    gbt51269: "CJJ/T 318-植被",
    citygml: "SolitaryVegetationObject",
    ifc: "IfcVegetation",
    cim: "单株植被",
    citygmlLod: "LOD2",
    bimLod: "LOD200",
  },
  shrub: {
    gbt51269: "CJJ/T 318-植被",
    citygml: "PlantCover",
    ifc: "IfcVegetation",
    cim: "灌木丛",
    citygmlLod: "LOD2",
    bimLod: "LOD200",
  },
  lamp: {
    gbt51269: "CJJ/T 318-城市家具",
    citygml: "CityFurniture",
    ifc: "IfcFurnishingElement",
    cim: "路灯",
    citygmlLod: "LOD2",
    bimLod: "LOD200",
  },
  luminaire: {
    gbt51269: "建筑工程-建筑电气",
    citygml: "CityFurniture",
    ifc: "IfcLightFixture",
    cim: "灯具",
    citygmlLod: "LOD3",
    bimLod: "LOD300",
  },
  bench: {
    gbt51269: "CJJ/T 318-城市家具",
    citygml: "CityFurniture",
    ifc: "IfcFurnishingElement",
    cim: "城市家具",
    citygmlLod: "LOD2",
    bimLod: "LOD200",
  },
  sign: {
    gbt51269: "CJJ/T 318-城市家具",
    citygml: "CityFurniture",
    ifc: "IfcSign",
    cim: "标识",
    citygmlLod: "LOD2",
    bimLod: "LOD200",
  },
  camera: {
    gbt51269: "建筑工程-智能建筑",
    citygml: "CityFurniture",
    ifc: "IfcSensor",
    cim: "监控设备",
    citygmlLod: "LOD3",
    bimLod: "LOD300",
  },
  gate: {
    gbt51269: "建筑工程-建筑装饰装修",
    citygml: "CityFurniture",
    ifc: "IfcDoor",
    cim: "闸机/门",
    citygmlLod: "LOD3",
    bimLod: "LOD300",
  },
  pipe: {
    gbt51269: "建筑工程-给水排水及供暖",
    citygml: "GenericCityObject",
    ifc: "IfcPipeSegment",
    cim: "管线",
    citygmlLod: "LOD2",
    bimLod: "LOD300",
  },
  valve: {
    gbt51269: "建筑工程-给水排水及供暖",
    citygml: "GenericCityObject",
    ifc: "IfcValve",
    cim: "阀门",
    citygmlLod: "LOD3",
    bimLod: "LOD300",
  },
  equipment: {
    gbt51269: "建筑工程-工业设备",
    citygml: "BuildingInstallation",
    ifc: "IfcElementAssembly",
    cim: "设备",
    citygmlLod: "LOD3",
    bimLod: "LOD400",
  },
  workstation: {
    gbt51269: "建筑工程-工业设备",
    citygml: "BuildingInstallation",
    ifc: "IfcFurnishingElement",
    cim: "工位",
    citygmlLod: "LOD3",
    bimLod: "LOD300",
  },
  "production-line": {
    gbt51269: "建筑工程-工业设备",
    citygml: "BuildingInstallation",
    ifc: "IfcElementAssembly",
    cim: "生产线",
    citygmlLod: "LOD3",
    bimLod: "LOD400",
  },
};

/** The LOD and precision bracket a scene class is built to. */
export interface ScenePrecision {
  /** CityGML LOD bracket for the whole scene (the semantic fidelity ceiling). */
  citygml: string;
  /** BIMForum LOD bracket for individual elements. */
  bim: string;
  /** One-line guidance the operators and Q-gates enforce. */
  note: string;
}

/** Precision bracket per scene class (§2.4 of the twin design: one IR, three requirement sets). */
export const TwinScenePrecision: Readonly<Record<TwinSceneClass, ScenePrecision>> = {
  park: { citygml: "LOD2", bim: "LOD200-300", note: "园区整体 LOD2，建筑单体到 LOD300" },
  city: { citygml: "LOD1-2", bim: "LOD100-200", note: "城市级广域，单体精度下降以换广度" },
  workshop: { citygml: "LOD3-4", bim: "LOD300-400", note: "设备级精度，含室内与可维护元素" },
};

/** The standard crosswalk for one element. */
export function twinElementStandard(element: TwinElement): ElementStandard {
  return TwinElementStandards[element];
}

/** The precision bracket for a scene class. */
export function twinScenePrecision(scene: TwinSceneClass): ScenePrecision {
  return TwinScenePrecision[scene];
}
