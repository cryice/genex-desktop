# 数字孪生城市场景类

城市片区（city）是孪生三场景类之一（`TwinSceneClass`：park / city / workshop）。它与园区相反：**用广度换精度**——城市级广域覆盖，单体精度下降到 LOD1–LOD2，靠分级 LOD 与流式加载承载大范围。

## 要素与精度

- 要素集与园区共用（building、road、tree、lamp、pipe…），但精度档 `TwinScenePrecision.city = { citygml: "LOD1-2", bim: "LOD100-200" }`：建筑单体只到 LOD2，地形/地块到 LOD1。
- 标准映射走 CJJ/T 318-2023 城市对象类（建筑物、道路、水体、植被、城市家具），与园区一致；详见 `twin-ontology.ts` 的 `TwinElementStandards`。

## 3D Tiles 流式

城市级交付不走单 `master_twin.usda` 全量组装，而走 **3D Tiles 流式**：

- 算子产出的 `.usdc` 分层按 CityGML `CityObjectGroup` / `b3dm` 切分，按行政区划或网格瓦片化。
- 消费端（Cesium / UE5 的 Cesium for Unreal）按相机视锥拉取 LOD：近处 LOD2、远处 LOD1，远景用 `LandUse`/`ReliefFeature` 概化。
- 同一份 IR 经 `solve-plan` 生成分块清单，再由 `gen-site`/`scatter` 按块出几何，最终 `assemble` 产出瓦片清单（而非单一 master）作为流式入口。
- 地理参考（CGCS2000→ENU，`georeference`）在城市场景下是**必选项**：无坐标的城市片区无法与 GIS 底图/GeoServer 对齐，Q3 应据此升格为阻断（园区允许沙盘模式，城市不允许）。

## 质检差异

- Q4 保真度在城市档用**抽样** IoU（按瓦片抽建筑轮廓），而非逐栋足尺，避免大范围全量计算。
- Q5 视觉评分强调**一致性**（瓦片接缝、LOD 跳变是否可见）与底图配准，而非单体精细度。

## 与园区/车间的切换

`new-park {sceneClass:"city"}` → `city.usd`；`gen-ir` 写 `sceneClass:"city"`；`assemble` 按城市 LOD 档出 `twin_manifest.json` 与报告。流式入口是城市交付的增量能力，基础 IR→USD 管线三者完全一致。
