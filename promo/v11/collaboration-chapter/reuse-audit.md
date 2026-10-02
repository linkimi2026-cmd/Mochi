# 2026-10-02 复用核对

先检索完整工程 `site:github.com/heygen-com/hyperframes-launches k3-promo`，再检索组件生态 `site:github.com/deepseek-ai/deepseek-harness ui-approval ui-primitives`，搜索成功。真实仓库：https://github.com/heygen-com/hyperframes-launches 、https://github.com/deepseek-ai/deepseek-harness 。后者官方 client README 确认原生组件职责；实际适配依据本地源码和运行检查，不能仅凭 README。

沿用 HyperFrames 0.8.36 / Apache-2.0（既有固定记录 d4756f597c0dbb66310c2add699de6767b23f11b）、GSAP 3.15.0（既有固定记录13e2b790546426a1a2e0e9b409f3f8dc6d6611f2）。不迁移框架。当前原生聊天/审批/基础组件为0.2.0-rc.2，三个安装包package.json的MIT许可证已实读；源码哈希写入source-manifest.json。

原生基础组件ESM打包暴露了桌面运行依赖缺口：simple-icons、zustand、immer没有安装。仅在本影片assets/deps隔离补齐simple-icons16.31.0/CC0-1.0、zustand4.4.7/MIT、immer10.1.1/MIT，符合各上游包的开发依赖范围；许可证由npm registry实际核对。保留独立lock，不修改桌面运行环境。这三项是原生组件间接依赖，不另实现状态库和图标。

维护成本：影片适配层需要随原组件导出变化更新；构建边界检查与源码哈希显式暴露变化。对外部动画示例只部分采用连续对象接力理念，不搬运其品牌或捏造产品布局。接入检验写validation.json，完整画面检查必须看实际输出，自动检查不代替审片。
