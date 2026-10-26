# Twin IoT binding

IoT 数据绑定到 Twin IR 的设备和属性，不绑定到脆弱的渲染器节点名。绑定包含 deviceId、property、target、单位、采样时间、质量码、方向和权限。连接器负责 MQTT、OPC UA、Modbus 或 HTTP 协议适配；Twin IR 负责语义统一。实时流、历史时序、告警、命令和回放必须区分，写操作需要确认和审计。
