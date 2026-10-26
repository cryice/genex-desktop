# 工程要素与目录

数字孪生的世界由**类型化的工程要素**构成，不是手建网格。模型只产出约束要素参数的 Schema，几何全归确定性算子。

## 要素词表（TwinElement）

建筑类：`building` / `floor` / `room`。场地类：`site` / `terrain` / `plaza` / `water` / `parking`。道路类：`road` / `lane` / `crossing`。植被与城市家具：`tree` / `shrub` / `lamp` / `luminaire` / `bench` / `sign`。设备类：`camera` / `gate` / `pipe` / `valve`。车间类：`equipment` / `workstation` / `production-line`。

## 对象类型（TwinObjectKind）

`building` / `landmark` / `road` / `landscape` / `vegetation-lamp` / `device` / `env` / `equipment` / `production-line`。`twinElementKind` 给出要素的默认类型；任务卡可以把一栋楼提升为 `landmark`（T2 DSL 精建），车间的设备保持 `equipment`。

## 一个对象 = 一个图层 = 局部原点

每个 `IrObject` 产出一个 `.usdc`，其原点在该对象自身的局部基准（楼体在底面中心、设备在其安装点）。总装时再用世界变换拼回园区，零拷贝引用（Sdf reference），不烘焙顶点。

## 目录（TwinCatalogEntry）

要素规格（如路灯 `lamp-spec-a`、道路横断面 `road-cross-section-a`）存于 `catalog/`，是实例化的原型来源。`scatter` 算子按要素类型建一个 `PointInstancer`，引用目录原型，挂 `twin:element` 与 `twin:bindingKey` 属性。

## 场景类（TwinSceneClass）

`park`（园区，500+ 对象，总图求解）/ `city`（城市，递归扇出，3D Tiles 流式）/ `workshop`（车间，设备级精度，PLC/MES/SCADA 反控）。选择场景类决定求解规模与反控深度，新建工程时由 `new-park` 的 `sceneClass` 决定。
