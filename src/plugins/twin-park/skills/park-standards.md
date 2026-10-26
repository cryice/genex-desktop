# 国标与交付闸门

数字孪生园区交付前须过 ARCH-01 的 Q0–Q5 闸门，并满足国内相关标准。

## 质量闸门

- **Q0 输入前置**：清单与场景类已知、IR 存在且合法。`run.prepare` 的 `ir-check` 钩子在此阻塞。
- **Q1 IR 自洽**：比例和=1、建筑数对得上、最高楼分区存在、冲突有提问。
- **Q2 盒内 QA**：单对象内部校验（Z_min>0、高度偏差≤5%、面数<预算、材质槽齐全），<5ms。
- **Q3 场景阻断**：总装后场景级 QA，不过则阻断交付。
- **Q4 保真度**：与参考（点云 / 图纸）的 IoU，车间场景要求最高。`assemble` 算子对每件已合成建筑取其世界 XY 足迹与 IR 设计轮廓算 `footprint_iou`（`jobs/judge_metrics.py`），均值写入 `qa_report.json.fidelity`。
- **Q5 视觉**：人工 / 评审视觉评分；`assemble` 先出一份确定性 0–100 启发性分册（`buildCompleteness / elementVariety / bindingReadiness / georefPosture` 加权），写入 `qa_report.json.visual`，指出评审该看哪里。

## 国内标准要求

- **CIM 分层**：按城市信息模型分层组织要素，便于与城市级平台对接。
- **防火间距（GB 50016）**：建筑间距、消防车道、扑救面作为总图求解的硬约束，冲突时 `questions` 上报。
- **分级 LOD**：按场景类与用途定义 LOD1–LOD3，降级对象标 `degraded`，不阻塞整园。

## 许可红线（务必避开）

- 不打包 LibreDWG（GPL 传染）：DWG 走 ODA File Converter 独立进程。
- 不使用 YOLO / MinIO / CGAL / nvdiffrast / DepthAnything V2 Base+Large（AGPL / 非商用 / CC-BY-NC）。
- 扫描网格不进交付；几何只来自确定性算子。
