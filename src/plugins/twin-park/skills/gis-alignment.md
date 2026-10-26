# 地理参考对齐

没有地理参考的孪生只是沙盘（diorama）。所有图层都围绕一个局部 ENU（East-North-Up）原点构建，该原点由 CGCS2000 大地坐标换算。

## CGCS2000 → 局部 ENU 帧

- **JS 工具 `georeference`**：接收 `lat` / `lon` / `heightM`，采用 CGCS2000（GRS80 椭球，`a=6378137, f=1/298.257222101`）闭式 topocentric 变换（geodetic→ECEF→ENU 旋转），写入 `park.json` 的 `georef.origin` 与 IR `environment.origin`。结果就是公园足迹内厘米级精度的局部米制坐标系（Z-up，1 单位 = 1 米）。
- **Python 辅助 `jobs/georeference.py`**（pyproj 闭环，离线一次性运行，不占 manifest 8 个 nativeJobs 名额）：`--lat/--lon/--h` 或读 `ir.json` 的 `environment.origin`，产出 `georef.json`（含 `enu.proj4 = +proj=aeqd` 局部切平面描述、原点残差应为 0）。还支持 `--points pts.csv` 批量把 (lon,lat,h) 测点转到 ENU。供控制点精度报告与多测点批量转换。

两种实现用同一套闭式数学，结果在厘米级一致（`twin-georeference.test.ts` 锁方向/符号约定，并与 Python 实测互验）。

## CAD 适配器（实测可用）

- **`dxf_ir.py`（DWG→DXF 后解析）**：ezdxf 读图层，按 `INSUNITS` 做单位缩放（mm=0.001 → m），正则从图层名提路宽 / 楼层（如 `road-9m`→9m、`建筑-6F`→6 层）。已用合成 DXF 真跑通：红线、建筑轮廓、道路中心线均正确提取并回写 IR 片段（J2）。
- **`dwg_dxf.py`（DWG→DXF）**：调用 ODA File Converter 独立进程（不打包，避 GPL）。沙箱无 ODA 二进制时给出明确错误，逻辑完整。

## GeoServer 叠加

园区底图、红线、地下管网等 OGC 服务通过 GeoServer 叠加，作为总图求解与验收的参考。叠加层只读，不参与几何生成（`twin-input-adapters`）。

## 正射影像与地形

正射影像配准到局部帧后作贴地纹理；地形由 DEM 经重采样生成 `terrain` 要素（范式 2/3），不依赖点云网格。

## 验证

- 关键控制点（楼角、路口）在局部帧下的坐标与实测偏差应在厘米级；`georeference.py` 输出的 `originResidualM` 应为 0。
- 交付包 `twin_manifest.json` 必须记录 `georef`，否则 Q3 阻断。
- 未设 `georeference` 的工程，`ir-check` 给出 **info 级告警（非阻断）**——沙盘模式允许无地理配准（`q0-no-georef`）。

