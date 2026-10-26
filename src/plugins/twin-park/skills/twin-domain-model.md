# Twin domain model

数字孪生的事实来源是工程对象、空间关系、时间状态和数据证据，不是渲染器节点。每个对象至少包含 `id`、`type`、`geometryRef`、`transform`、`properties`、`relations` 和 `provenance`。设备对象额外包含设备标识、测点、告警和命令。

使用 Twin IR 的稳定 ID；分离几何、语义、时序和权限；记录来源、置信度、单位、坐标系和时间。冲突进入 review，不静默猜测。输出前检查孤儿关系、重复 ID、单位不一致、坐标系缺失和非法时间戳。
