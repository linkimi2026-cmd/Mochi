# MOCHI-P1-SERVICE-WIRING-01

P1，Lagrange / terra-max唯一owner main.ts、web-host.ts、必要接线测试。前置SERVICE-DEFAULTS01与HOST-LIFECYCLE01均root独立PASS；保留最新生命周期源。禁止改Maxwell冻结profile JSON/CJS/TS和用户renderer/preload/sidebar/锁/NMs。

目标与依据：总体方案§24，启动与医生读取相同非秘密配置。已验profile.ts公共resolveMochiServiceDefaults(environment=process.env)返回campusApiUrl?/searxngEndpoint?，显式env覆盖versioned JSON。既有resolver/运行时生态复用，不新选库。

实施：sidecar buildEnv通过该resolver注入实际有值的MOCHI_CAMPUS_API_URL/MOCHI_SEARXNG_ENDPOINT；医生createConfig读取同resolver并映射既有campusOrigin/searxngEndpoint。缺值保持未配置、不硬编码localhost或旧云地址。非法配置走当前受控中文失败/诊断，不能回显原值。不得读取密钥/校园会话，不修改真实服务或默认URL。

验收：可控profile默认值且外部环境无MOCHI变量时，真实子进程可观测正确注入；显式env覆盖，医生使用相同来源；非法URL不泄露，缺值仍未检测。保留生命周期关键回归，profile/doctor模块不重测无关全部功能。提供固定hash/最小diff/实际命令。当前校园URL缺失和搜索回退的产品可用性另列，不称云服务已可用；完成后冻结等tray模块顺序集成。
