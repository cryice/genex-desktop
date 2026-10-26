# 三范式算子

大模型**只写参数，算子写几何**。一条对象经确定性算子重建，几何全在算子侧，模型侧零顶点。三范式按占比分工：

## 范式 1 — 参数化楼体（≈60%）

建筑、地标由 `gen-object` 按任务卡（轮廓环、层数、限高、朝向、邻接）参数化生成：`_wall` 抬墙、`PrimvarsAPI` 写 UV、`UsdGeom.Subset` 挂材质槽、裙边（parapet）使顶部略超限高属预期。内部 Q2 盒内 QA：Z_min>0、高度偏差 ≤5%、面数 < 预算、材质槽齐全。

## 范式 2 — 引用 + PointInstancer（≈25%）

路灯、树、座椅、标志等大量同类对象由 `scatter` 建一个 `PointInstancer`：原型为带 `twin:element`/`twin:bindingKey` 的 Xform，实例用 `ProtoIndices`/`Positions`（Gf.Vec3f）/`Orientations`（Gf.Quatf）表达。设备实例额外挂 `twin:bindingKey` 供 IoT 反控。

## 范式 3 — 资产补全（≈15%）

地标精建、设备外形等无法参数化的，由资产补全：引用目录原型或外部 GLB，套材质与局部原点。失败时降级为规则基线并标记 `status: degraded`，不阻塞整园。

## 站点与总装

`gen-site` 由总图道路中心线 + 地块生成道路层（中心线 + 路缘差集，`MultiPolygon`→多部件）、景观与地形。`assemble` 去重引用各层到 `master_twin.usda`（仅世界变换与组合弧），加环境与相机层、`twin_manifest.json` 与 Q3 场景 QA；Q3 不过则阻断交付。

## 降级梯

回馈等级 ≤2 → 退到规则基线；LOD1 标记 `degraded`；单对象失败不阻塞整园，仅该对象降级。算子版本记 `operatorVersion`，风格版本记 `styleVersion`，换版本即全园重派生。
