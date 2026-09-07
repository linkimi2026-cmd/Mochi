# MOCHI-P0P1-ALPHA-INTEGRATION-01

执行中。唯一实现者 Maxwell / terra-max；root 架构审计。用户已明确授权 P0/P1 并行，设备网络待现场补验不阻挡实施。依据总体方案 §6 固定 alpha、§21/22/45 桌面与 profile；目标是实际完整 profile 可运行，保留官方 SPA、Electron 与用户 UI。

输入：已验 patched 257 tarballs（REASONING01 patch c3e0b4a…4015c）、RUNTIME02 230 family 闭包、未改 runtime-profile、现有12插件和现有packager。复用 docs/reuse-audit.md 同一官方固定 MIT Harness、npm11.6 file tgz、electron/rebuild3.6.1 机制；不重写依赖解析器。

唯一写边界：新外部完整结构工作区及其desktop consumer/package/lock、证据 alpha-integration01；兼容改动限 packager 20个RC运行版本与 sidebar13 peer、campus/dispatch各一依赖范围。源码、UI、profile、原consumer与旧rc产物冻结，其他代理不写此树。不能删除用户未提交改动。

复用标准 npm pack/安装供给230family+12插件完整依赖（优先本地tgz避免file目录链接解析问题），保留optional/lifecycle/peer检查，不force/legacy-peer。新consumer只fs-ext按既有机制重建Electron39.8.10 ABI140，不嫁接旧node_modules。现有runtime-profile/package-resources测试与真实Electron profile启动为关键验收；日志正常、入口HTTP可达、停止清理。原生关键行为复用既有harness。无需重跑已验源码/包家族测试。

交付最小diff、实际版本/新lock、命令结果、profile证据与后续打包输入。普通准备问题自修留证；真实兼容缺陷回报root限定修复，不扩大UI/架构。Halley只读打包准备，Lagrange P1主进程另树；待交付后再顺序集成。未称完整桌面/Windows通过。


接续授权：完整安装/实际staged资源/native/profile通过后，Maxwell继续同一外部树现有mac arm64目录包与既有packaged-profile smoke，无新resolver/安装树。正式P1 main等STARTUP01审定后顺序取用；此前可用冻结基线main完成alpha侧验证，明确产物版本。source-workspace测试因兄弟desktop node_modules不能被源插件解析的失败单列，不能伪造通过，也不需用手symlink/第二次安装掩盖；实际staged包路径单独验。


## root应用包范围验收

当前ASAR63a03e29d4ab3c0829cd13fd12c08b146a08569af34a573fc335940c9c01d58b功能包PASS：root独立隔离profile session6112 exit0/全部条件通过，亲读最终packaged Electron flock为ABI140/EAGAIN/释放与清理PASS。生产提升尚待完成。root另发现mochi-campus本地tgz含5项node_modules.nosync开发元数据，功能不依赖它们；当前包可作为预览保留，清理该包files白名单并刷新单个tgz/锁后再提升，随下一doctor功能构建整合，不仅为元数据重复build。不可把当前功能PASS称最终分发清单已完成。
