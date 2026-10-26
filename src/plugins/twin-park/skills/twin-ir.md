# ParkProgram IR 纪律

数字孪生不是手捏网格，而是**先成 IR、后成几何**。ParkProgram IR 是整个管线的唯一事实来源，所有几何都由它确定性派生。

## 三条铁律

1. **每个字段都带来源、置信度、锁**。`IrField<T>` 形如 `{ value, source, confidence, locked }`。来源决定优先级（`SOURCE_PRIORITY`），置信度 0–1。
2. **只有人能上锁**。`locked: true` 且 `source` 不是 `user` 的字段视为非法（`irFieldOk` 拒绝）。模型可以提议，但不能锁死——锁是人对争议的裁决。
3. **冲突按来源优先级解决**。`conflictWinner` 比较来源优先级，再比置信度。被低优先级覆盖的高优先级字段要留下 `questions`，绝不能默默丢弃。

## IR 的三段（存档即证据）

- **J1 任务书（IrBrief）**：用地指标、容积率、覆盖率、限高、分区、关键要素、假设、冲突、待问问题。
- **J2 总图（IrMasterPlan）**：红线、退线、地块、道路中心线、建筑轮廓。
- **J3 对象（IrObject[]）**：每个对象一个 `params`（Schema 约束的参数）、`outputPath`、`status`、`seed`、`styleVersion`、`operatorVersion`。

## 自洽是卡点，不是建议（Q1）

`irSelfConsistency` 检查四件事，任何一项不符 `ir-check` 即报错并阻断构建：

- 分区用地比例之和 ≈ 1（容差 1%）。
- 分区建筑数量之和 == 总图建筑轮廓数量。
- 最高建筑的 `zoneId` 必须出现在分区列表里。
- 若存在未调和冲突，必须有 `questions` 向人提问。

**变更只落差为 diff**：改了一个字段，只重跑受影响的对象（按 `taskCardCacheKey` 命中缓存），全园不重建。

## 输入只是证据

文字、图片、DWG、GIS、点云都只是**生成 IR 的证据**，不是几何来源。扫描得到的网格永远不是交付物（`twin-input-adapters`）。
