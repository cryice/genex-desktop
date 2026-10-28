# Twin Studio 十次迭代记录

| 迭代 | 交付目标 | 当前证据 |
| --- | --- | --- |
| 1 | Twin Park 项目识别与项目面板 | `plugin.json` 的 project panel、`panel.html` |
| 2 | Twin IR、对象、关系和来源 | `src/shared/twin-ir.ts`、`twin-elements.ts` |
| 3 | Data / Scene / Application 工作区结构 | `src/plugins/twin-park/panel.html` |
| 4 | CIM、BIM、GIS、CAD、点云、IoT 数据源登记 | `register-data-source`、`data-sources.json` |
| 5 | 数据源元数据门禁 | `validate-data-sources`、`twin-china-standards.md` |
| 6 | Blender 与 OpenUSD 建模目标 | `configure-target`、OpenUSD native jobs |
| 7 | Babylon.js、Godot、Unreal 目标导出 | `export-target` 及三套导出目录 |
| 8 | Babylon 和 Godot 语义对象预览 | 生成的 Babylon HTML 与 Godot GDScript |
| 9 | IoT 测点、告警、命令和审计约束 | Twin IR telemetry/alarms/commands、`twin-operations.md` |
| 10 | 标准资料、验证记录和交付清单 | `source-index.md`、`delivery-checklist.md` |
| 11 | 一级 Twin 工作区 Tab 与插件清单同步 | `src/renderer/plugins/twin-park/TwinRoom.tsx`、`use-shell-chrome.ts` 的 `useTwinRoom`、`Sidebar.tsx` 的 Twin 行、`plugin.json` 补齐 `twin-modeling` / `twin-renderers` |

## 迭代验收规则

每次迭代必须留下可检查的代码、manifest、数据文件或文档证据。渲染器输出不能反向修改 Twin IR；导出前先通过坐标、单位、数据源元数据和 IR 自洽性检查。标准资料只记录编号、范围、实现影响和官方入口，不复制受保护的标准全文。

## 已知发布前工作

- 完整仓库 TypeScript 检查仍受上游 provider/sandbox 类型错误影响，需要单独清理。
- Unreal 当前输出是可审查的 OpenUSD 导入描述和 manifest，生产环境仍需在安装 Unreal 的机器上完成导入验证。
- 本机 Blender 5.2.1 LTS 已验证：仓库 USD→GLB 作业成功导入临时 USD 并导出 1,540 字节 GLB；清空场景后重新导入该 GLB，得到 1 个名为 `test-building` 的网格和 24 个顶点。本次验证也修复了 `-noaudio` 参数拼写和 Blender 脚本目录导入路径。
- Godot 与 Babylon 导出都将 Twin IR 中的建筑轮廓和 IoT 数据写入各自目录的 `TwinManifest.json`，不再依赖 assemble 阶段产物；Godot 从 `res://` 读取，Babylon 从同目录 fetch。两者仍需各自引擎/浏览器环境做最终运行验证。
- Babylon 预览对象现在携带设备绑定，活动告警会高亮对象，点选对象可查看测点值和告警；生成的内联 JavaScript 已通过 Node 语法检查。
- Babylon 预览可使用 `park.json` 中配置的只读 WebSocket feed，按 `{device,property,value}` 更新匹配绑定和测点详情；不发送反向控制命令。
- 新增 `configure-iot-feed` 配置入口，校验 `ws/wss` 地址并将数据源同步登记到项目清单和已有 Twin IR；面板状态显示 feed 是否已配置。
- Unreal README 现区分 Genex 集成描述与 Unreal 原生可导入文件，并给出 USD Stage 工作流和稳定 prim ID 约定；仍需 Unreal 实机导入验证。
- Godot 尚未安装，仍需在具备 Godot 4 的环境中启动导出工程进行运行验证。
- Babylon.js 使用 CDN 运行时，离线交付需要在项目资产中固定 Babylon.js 版本并记录许可证。
