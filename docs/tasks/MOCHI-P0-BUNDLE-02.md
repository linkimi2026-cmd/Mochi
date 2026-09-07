# MOCHI-P0-BUNDLE-02 · 修复后包内复验

状态：返修 / CHANGES REQUIRED。离线构建与ASAR物理位置通过，真实启动因必需peer依赖cordis-plugin-group未被选入而失败。P0；实现负责人 p0_packaging_audit / terra-max；独立复验 p0_cold_start。继承 BUNDLE01、ASAR01 的范围与禁止区，基线 HEAD b64776394e94ac5300ed42da64f8d592a1b53cbb 加本轮已审冻结差异。

目标及方案：§6 保留 dsh + 官方 SPA + Electron，§45 验证打包版 mochi-web 可在新数据根启动。复用 docs/reuse-audit.md 的完整应用/框架与 builder 25.1.8 审查；仅修正既有生产依赖物理位置，不切内核版本或扩展产品功能。

允许写入：BUNDLE01列出的构建生成目录、新的 packaged-profile run 与验证器。保留本轮旧失败候选到 release/failed-bundle-01-时间戳；更早 dist/mac-arm64/Mochi.app 不得移动、覆盖或删除。仅用已核官方 digest 的 Electron 缓存离线构建，校园静态资源显式用本项目 campus.nosync/mochi-dist/client。源码/锁/运行配置/已安装 dsh JS 补丁均不得修改；记录构建前后 hash。不是唯一工作者，不回滚他人编辑。

新测量器可作三项明确修正：HTTP 重定向要求与 ready URL 同 origin（包括同随机端口）；原/副本所有已记录关键输入 hash 必须相同；递归检查副本 symlink 的 realpath 全在副本 App 内。原 BUNDLE01 验证器与失败证据保持不变。这些是证据链改进，不能改写旧失败原因或放宽任何 PASS 条件。

验收顺序：

1. 离线构建成功，输入冻结 hash 不变。记录候选大小/文件数与旧候选差异。
2. ASAR header 与物理树确认 js-yaml、argparse、nested dsh 和所需 native 模块均物理存在；主进程仍在 ASAR，旧 dist 未入包。对比生产依赖集合，electron-builder/TypeScript 等开发包未混入。
3. 工作区外完整副本、新 HOME/DSH_HOME/cwd，拒绝工作区、真实 HOME 与出站访问。实际包内 Electron/DSH、包内 profile/plugins/skills 启动，验证 profile 生成、ready、同源 HTTP 200 且真实 boot 标记，以及 SIGTERM 后 PID/端口/tmp 清理，无强杀。失败即保留记录并返回定位，不吞错或借开发树补依赖。
4. 执行者冻结候选/验证器/结果，主控审阅后由非实现者在独立输出目录复验一次；关键输入绑定同一候选 hash。

交付：真实 diff、命令/环境/输入 hash、包结构对比、脱敏日志、结果与清理证据。审计结论只限本机 macOS arm64 包内 sidecar；Finder 完整窗口、Windows、全新机、校园网与真实模型调用均未由此验收。无发布/推送/remote 操作，不放行 P1。
