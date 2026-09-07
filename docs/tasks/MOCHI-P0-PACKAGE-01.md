# MOCHI-P0-PACKAGE-01 · P0 资源依赖闭包修复

- 状态：已验收（PASS，仅本票资源闭包）；唯一实现负责人 p0_packaging_audit（terra-max）；主控独立验收。
- 用户价值：安装包内模型插件可真正加载，不依赖开发目录的 node_modules。
- 依据：总体方案 §6“官方 Web SPA 嵌 Electron”、§21/45“打包版 mochi-web 起得来”。契约旧 §35 对应当前 §45，不改变阶段。
- 基线：HEAD b64776394e94ac5300ed42da64f8d592a1b53cbb + 未提交工作树。修复前两脚本及 profile 的逐文件备份与 SHA-256 在 `.architect-baselines.nosync/20260906T155547Z/manifest.json`；这只是本任务回滚点，全仓 Git 基线仍待审查。
- 现状：PLUGINS 已12，旧需求不重做。package-resources 在临时资源导入 deepseek adapter 时缺 dsh-credentials。复用结论见 docs/reuse-audit.md，编码前须读。
- Max 执行规则：用户明确确认现有 terra-max 角色就是其 Max 编程方式；配置 `/Users/a1379/.codex/agents/terra-max.toml`，gpt-5.6-terra/max。未另建 skill。
- 允许写入：`apps/desktop/scripts/prepare-mochi-resources.cjs`、`apps/desktop/scripts/test-package-resources.mjs`；执行证据 `artifacts/architect-audit/p0-package-fix.md`。
- 禁止：主/渲染进程、profile 配置、锁文件、依赖安装升级、Harness 源码、其他插件、用户 runtime/凭据、真实服务、联动计划目录。不可提交/推送，不改总体方案。你不是唯一工作者，不回退他人编辑。
- 实施边界：检查当前 adapter 的真实 import closure，补已安装且兼容当前锁定版本的必要纯 JS runtime modules；不能盲目把整个 node_modules 打包。若需要 native、新依赖或内核改动，回传阻塞。
- 正常验收：现有 package-resources 真实 staging + 各插件 ESM 导入通过，尤其 MIMO adapter 入口；所有新增模块版本受校验。
- 异常/回归：保留已有禁止网络、无 symlink、资源边界、版本不符失败断言；新增缺失必要依赖的有效回归检查（不降低已有断言）；runtime-profile/release-input 仍通过。
- 交付：真实命令/结果/运行环境、修复前后 SHA/diff、产物位置、未测范围。源码资源测试不等于完整安装包启动或 Windows 真机通过。
- 越界：立即报告主控，不自行扩大架构；不接管用户 Chat × Work。
