# Twin engineering research index

This index records public references used to design the Twin Studio skills. It stores implementation implications and links, not copied standards text.

## Standards and open specifications

- **buildingSMART IFC** — interoperable BIM entities, GUIDs, property sets and relationships. https://www.buildingsmart.org/standards/bsi-standards/industry-foundation-classes/
- **OGC APIs and 3D Tiles** — interoperable geospatial and streaming scene services. https://www.ogc.org/standards/ and https://www.ogc.org/standards/3dtiles/
- **EPSG guidance** — coordinate reference identifiers and transformations. https://epsg.org/
- **OpenUSD** — layered scene composition, references, variants and metadata. https://openusd.org/
- **MQTT / OPC UA** — device telemetry and industrial interoperability. https://mqtt.org/ and https://opcfoundation.org/
- **国家、行业和团体标准** — consult the current official text for BIM delivery, CIM construction, surveying, mapping, smart-city and industrial IoT requirements before making a project claim. Record the standard number, version, scope and affected validation rule in the project evidence.

中国工程实施优先核对的公开标准方向：GB/T 51212-2016（BIM 应用统一标准）、GB/T 51301-2018（BIM 设计交付）、GB/T 51269-2017（BIM 分类和编码）、CJJ/T 157-2010（城市三维建模）、GB/T 36625 系列（智慧城市数据融合）和 GB/T 22239-2019（网络安全等级保护基本要求）。编号和现行状态以国家标准全文公开系统、住房城乡建设主管部门及项目合同为准；索引不复制标准全文。

## Public industry references

Use public technical documentation and case studies from SuperMap, Esri, Bentley/iTwin, Autodesk, Glodon, Hikvision, Huawei Cloud, Alibaba Cloud IoT, Tencent Cloud IoT, Rootcloud, Kaos and relevant urban digital-government vendors as comparative implementation evidence. Marketing claims are not normative requirements.

企业资料的使用方式：超图、Bentley/iTwin、Autodesk、广联达等用于 BIM/CIM 数据组织和工程协同案例；海康、华为云、阿里云 IoT、腾讯云 IoT、树根互联、卡奥斯等用于设备接入、时序数据和运维场景对比。企业产品能力必须经过项目数据和接口验证，不能直接当作标准要求。

## Research rule

Every new Skill must state its source class, coordinate/data assumptions, validation checks, fallback behavior and license constraints. A news article can motivate a workflow; only an applicable standard or an explicit project contract can make it a required rule.
