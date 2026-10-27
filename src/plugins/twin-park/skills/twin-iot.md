# Twin IoT binding

IoT 数据绑定到 Twin IR 的设备和属性，不绑定到脆弱的渲染器节点名。绑定包含 deviceId、property、target、单位、采样时间、质量码、方向和权限。连接器负责 MQTT、OPC UA、Modbus 或 HTTP 协议适配；Twin IR 负责语义统一。用 `configure-iot-feed` 配置 Babylon 只读 WebSocket feed；地址限 `ws://`/`wss://` 且不能含 URL userinfo 或 fragment。`park.json` 的 `feed` 使用 `{kind:"websocket",url,topic}`，网关消息使用 `{device,property,value,unit?,at?,quality?}`，连接后发送 `{type:"subscribe",topic}`。消息只更新匹配的绑定和测点 readout；未知设备/属性忽略，断线不自动重试。实时流、历史时序、告警、命令和回放必须区分。预览不发送命令；反向控制仍需单独实现权限、用户确认和审计，不得复用只读订阅能力。
