# MOCHI-P1-SERVICE-DEFAULTS-01

P1，Maxwell/terra-max唯一执行者；目标是启动和医生共享同一个非秘密服务配置来源，避免shell与Electron各自硬编码漂移。总体方案§24要求校园/搜索注入，runtime-profile仍是唯一受管来源。

已核：p1-service-defaults-preflight/inspection.json与public-health-probe.json。profile无defaults；shell校园Pages默认、README CloudBase主入口不一致；实际CloudBase health410、Pages超时，均不能称健康默认；SearXNG是未打包外部Python本地服务。用户正被询问有效校园URL，不以超时当永久服务下线。

复用既有runtime-profile.json/cjs和FreeWebSearchProvider，无新服务或框架；引用现有完整生态复用审计及本票预检。公开百科/学术回退不能宣传成已验证完整网页搜索替代。

本轮授权：runtime-profile.json新增明确非秘密serviceDefaults（campusApiUrl、searxngEndpoint暂null）；runtime-profile.cjs增加读取/验证/解析公开函数；electron/dsh/profile.ts提供薄调用，必要resolver测试。已设置的MOCHI_CAMPUS_API_URL/MOCHI_SEARXNG_ENDPOINT优先，支持受控http/https地址、拒绝无效协议/内嵌凭据，错误不打印原输入。缺值返回未配置，不制造loopback/失效云默认；保留现有用户profile配置和受管patch内容。

禁止：main.ts/web-host.ts（Lagrange正在生命周期票）、doctor-window.ts、renderer/sidebar/preload、校园业务/认证、真实HOME/密钥、生产node_modules/锁、mochi.sh。最终接线等生命周期冻结后顺序派发，当前不声称已注入完整启动链。无需重新安装/build全部alpha或改上游。

验收：新配置源存在与null状态、env覆盖、合法值、非法协议/凭据不泄露、未知字段/旧manifest兼容判断有明确行为；现有profile生成必要回归不覆盖用户受管外配置。生成包资源包含同一manifest/resolver，给调用契约、diff、测试证据与固定hash。root审后再接线；未配置校园功能缺口保留。
