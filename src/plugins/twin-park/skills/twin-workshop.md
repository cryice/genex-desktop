# 数字孪生车间场景类

车间（workshop）是孪生三场景类之一（park / city / workshop，见 `twin-elements.ts` 的 `TwinSceneClass`）。它与园区/城市的核心区别是**精度档与要素集**：车间追求设备级精度，单体到 LOD3–LOD4，含室内与可维护要素；园区整体 LOD2、城市级广域 LOD1–LOD2。

## 要素集（车间专属）

- `equipment`（设备）、`workstation`（工位）、`production-line`（生产线）三类工程要素，默认 `kind` 分别为 `equipment` / `equipment` / `production-line`（见 `ELEMENT_KIND`）。
- 其余基础要素（road、pipe、valve、camera、gate）与园区共用，但精度档跟随车间整体 LOD3–LOD4（见 `twin-ontology.ts` 的 `TwinElementStandards`）。
- 标准映射：equipment→`IfcElementAssembly` / CityGML `BuildingInstallation` / CJJ/T 318 `设备`；workstation→`IfcFurnishingElement`；production-line→`IfcElementAssembly`。

## 精度与质检

- 精度档 `TwinScenePrecision.workshop = { citygml: "LOD3-4", bim: "LOD300-400" }`。总装算子按此档校验单体精度，低于 LOD3 的对象标 `degraded`。
- 车间是 **Q4 保真度（IoU）要求最高** 的场景：设备摆放、工位排布须与参考图纸/点云足尺对齐（`park-standards.md` Q4）。

## 布局

车间布局由 IR 的 `masterPlan`（plots / roads / buildingOutlines）承载：厂房轮廓作 `building`，内部设备/工位用 `buildingOutlines`（或 `plots`）的局部坐标表达，产线由多个 `equipment` 沿中心线排布。算子对车间不做特殊几何分支——它仍是一份 ParkProgram IR，区别在于要素种类与精度档。

## 与园区/城市的切换

`sceneClass` 决定精度档与要素校验，不影响算子管线：`new-park {sceneClass:"workshop"}` 生成 `workshop.usd` 舞台，`gen-ir` 写入 `sceneClass:"workshop"`，`assemble` 按车间 LOD 档出 `twin_manifest.json` 与 Q3/Q4/Q5 报告。一个工程只属于一个场景类。
