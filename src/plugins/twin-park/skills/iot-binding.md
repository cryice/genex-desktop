# 设备绑定与反控

孪生要"活"起来，靠的是设备数据驱动场景目标。一条绑定四元组：`prim` / `device` / `property` / `target`。

## 绑定四元组

- `prim`：场景中的目标图元路径，如 `/Park/Buildings/B_0001` 或某盏灯的实例。
- `device`：IoT 网关中的设备 id（JetLinks 设备标识）。
- `property`：设备属性，如 `brightness` / `temperature` / `status`。
- `target`：被驱动的目标，如 `material.emissive`（亮灯）、`rotation.y`、`visibility`、`position`。

## 一处绑定，三处复用

`iot-bind` 把绑定写入 `park.json` 的 `bindings`，web 路线（Babylon）实时消费；同一份 `bindingKey` 也进入 `twin_manifest.json` 供 UE5 与业务系统读取。设备实例在 `scatter` 时已挂 `twin:bindingKey`，反控时按 key 寻址。

## 反控必须确认

写入设备（开阀、调亮度、启停产线）属于**反控**，必须经确认卡（confirmation）由人授权，绝不静默执行。只读订阅（看状态、看温度）无需确认。

## web 实时通道

`park.js` / `iot.js` 已实现实时绑定消费（WebSocket，最近 20 条滑动窗口）。新增绑定时同时更新 `park.json` 与 manifest，前端无需改代码即可接入新设备。
