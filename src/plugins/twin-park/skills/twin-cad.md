# Twin CAD and DWG/DXF ingestion

DWG/DXF 是工程输入，不是最终运行时格式。先按图层、块、线型、标注和单位解析，再映射到 Twin IR。保留图层名、块名、句柄、原始单位、原始坐标和转换日志。无法映射的实体进入 review 清单，不静默丢弃。通过 Blender/OpenUSD 生成几何层。
