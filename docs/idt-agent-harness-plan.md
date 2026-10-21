# idt-agent 生产 harness 架构分析

读这份文档之前先明确范围：这里讨论的是 **idt-agent** 里要新增的「文字/图片/DWG → 拆分 → 并行子任务 → 组装 USD → 交接下一节点」生产流程，不是本仓库的 `docs/harness-runtime.md`（那是 Genex 游戏构建 harness）。两者唯一相通的地方是都遵循同一条原则：**能让代码确定性完成的，不要交给模型**。

本文是一次读码分析的归档，不含实现。结论与依据都对应 idt-agent 仓库 `dev` 分支的当前代码。

## 结论摘要

只补「子 agent 能力」不够。这条流程是五层，子 agent 只是第三层；另外四层（输入归一化、校验、组装、交接）都是确定性代码，而 idt-agent 目前一层都没有。

更关键的是：**并行与 idt-agent 现有的会话模型直接冲突**。这不是加一个工具能解决的，需要单独加一层执行器。

## 一、现状核对

| 环节 | 现状 | 代码依据 |
| --- | --- | --- |
| 多运行时 | 已有 | `src/daemon/agent-runtimes/`（pi / claude-code / codex / opencode） |
| 3D 生成 | 只有文生、图生 3D，产物 glTF/GLB | `src/daemon/{meshy,tripo,hyper3d}-provider.ts` |
| 会话并发 | **一个项目同时只允许一个 turn** | `AgentManager.isProjectBusy()`，键为 `projectId:conversationId` |
| 写权限边界 | **只有可读白名单，没有可写白名单** | `NativeSessionRequest.policy` 仅含 `readablePaths` |
| 结构化编排 | 无 | 全局无调度器、无计划产物 |
| 下游交接 | 有存储、无执行器 | `src/shared/dtwin.ts`、`src/daemon/dtwin-store.ts` |
| DWG / USD | 无任何实现 | 全仓检索无命中 |

下游是通的：`DTWIN_ARTIFACT_KINDS` 已包含 `usd`，`DtwinWorkflowNode.kind` 已包含 `builtin`。「进入下一节点」不需要发明新概念，只要给 dtwin 补一个执行器。

## 二、为什么只补子 agent 不够

### 2.1 并发通道不存在

`AgentManager` 把 `#activeTurns` / `#revisions` 按 `projectId:conversationId` 持有，`isProjectBusy(projectId)` 让整个项目成为独占资源，多处显式拒绝同项目第二个 turn。

要并行 N 个子任务，必须绕开 turn 通道，直接起 N 个 `AgentRuntimeService.createSession()`。代价是事件流、断点、界面呈现都要自己接一层。

### 2.2 写权限无法收紧

policy 只有 `readablePaths`。子任务 A 完全可能改掉 B 的文件，而这一点只能靠 prompt 劝阻——prompt 不是机制。

两个可选兜法：给 policy 补可写白名单；或每个子任务一个独立输出目录，事后 diff 只允许 `owns` 声明的路径。

### 2.3 领域工具一个都没有

现有工具只有 `questionnaire`、`web_search`、`install_plugin`、`update_plan`、`playable_*`、`canvas_*`、`generate_canvas_media`。缺三组：

- 图纸解析：DWG/DXF → 图层、块参照、标注、文字
- 参数化几何：Python + build123d / CadQuery，或 OpenSCAD
- USD 生成与校验：`pxr` 的 Stage / 引用 / 包围盒

这三组不是 agent 能力，是可执行文件与依赖。

### 2.4 编排语义没有载体

计划是有向无环图，要拓扑调度、并发上限、失败重试、blocked 传播、断点续跑。CLI 原生 subagent 一样都不管，而且三家运行时行为不一致，与 idt-agent 的多运行时策略冲突。

## 三、五层结构

模型只站在中间，前后都是确定性代码。依赖几何本身：DWG 到 USD 的绝大部分工作是确定性转换（图层→构件、块参照→实例、标注→参数），模型只在识图、归类、审查、修补四个被限定的环节有价值。

| 层 | 职责 | 性质 | 落点 |
| --- | --- | --- | --- |
| 一 归一化 | 输出构件清单与尺寸表，每项尺寸带出处 | 代码 + 少量模型 | 新增 `src/daemon/harness/normalize/` |
| 二 拆分 | 输出子任务图：谁写哪个文件、放在哪个 USD 路径、怎么验收 | 模型 | 单次调用 + JSON Schema 校验 |
| 三 执行 | 每个子任务一个独立会话，只允许写自己声明的路径 | 代码 | 新增 `src/daemon/harness/scheduler.ts` |
| 四 校验 | 包围盒、单位、轴向、引用完整性、路径越界 | 纯代码 | 新增 `src/daemon/harness/verify/` |
| 五 组装与交接 | 只做引用拼接，产出 `assembly.usda`，落为 stage artifact | 纯代码 | 新增 `src/daemon/harness/assembly.ts` → 写 `DtwinStageArtifact` |

两条硬性约定：

1. **尺寸必须带出处**。未确认的尺寸（`assumed`）在交给用户过目前必须单列，不能混进已确认尺寸。
2. **组装不合并几何**。子任务各写自己的 `.usda`，组装器只生成引用，单位与轴向的换算只做一次。

## 四、子 agent 的两条路线

| | A 编排层建会话（推荐） | B 用 CLI 原生 subagent |
| --- | --- | --- |
| 可控性 | 高，工具集可收窄 | 低，行为由 CLI 决定 |
| 可观测 | 每步有结构化结果 | 只有自然语言回传 |
| 可断言 | 能验证产物路径与包围盒 | 无法验证 |
| 并发上限 | 自己控制 | 控制不了 |
| 跨运行时 | 三家一致 | 三家不一致 |
| 成本 | 要写调度器与事件汇总 | 省调度 |

选 A 的本质是：**把 CLI 当函数调用，而不是当同事**。B 省下的调度成本，会在第一次需要「哪个子任务改错了文件」时全部还回去。

## 五、最小竖切

不要从 DWG 开始。先用手写的三个构件把后四层串起来：

1. 手写计划：三个房间，各自 `owns: ["parts/r1.usda"]`、`usdPath: "/World/L1/Room1"`
2. 调度器起三个会话并行，每个只拿到该构件的简报与尺寸表
3. 校验器量包围盒，相对误差超过 2% 打回该子任务
4. 生成 `assembly.usda`，用引用拼起来
5. 在 `usdview` 里打开，肉眼确认三个房间的相对位置

**验收标准**：改尺寸表里的一个尺寸，重跑，对应房间的包围盒跟着变，其他不变。

这条通过了才说明契约是对的。先定一百行类型定义，大概率是过早抽象。

## 六、待决事项

1. **重计算放哪**：DWG 解析（ODA 需商业授权，LibreDWG 格式覆盖有风险）、Python 几何库、USD 运行时，塞进 Electron 安装包是 GB 级负担。本地打包，还是服务端转换、本地只留 USD 轻校验？
2. **输入质量**：是否有可脱敏的真实图纸。若只有「有图无图层规范」的施工图，归一化层工作量翻倍，架构要按最坏情况留余地。
3. **USD 的角色**：交付物还是中间表示。前者校验要严（Stage 合法性、材质、实例化），后者只需包围盒与路径。

## 七、与 Genex harness 的边界

Genex 的 harness 是「自己实现主循环 + 编排 + 判定」的重资产路线（见 `docs/harness-runtime.md`，一千余行，含 kinds、critics、play scripts）。idt-agent 这条线不应复制它：那里面向的是可被程序观察的游戏页面，这里面向的是不可被程序完整观察的图纸与几何，判定必须落在几何量上（包围盒、单位、引用），而不是视觉证据。

能复用的只有一条：**判定必须由代码给出，模型的自述不算通过**。
