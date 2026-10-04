# Mochi 新版运行依赖

正式打包命令默认使用这里锁定的 Harness 0.2.0-rc.2 和 Electron 44.0.0。默认 `npm run dev` / `npm start` 同样选择新版运行树和固定 Electron44；`npm run dev:legacy` 保留旧代回归。首次需安装 desktop 开发依赖及本目录运行依赖。开发启动不会替代最终安装包验收。

在 `apps/desktop` 中先运行 `npm run runtime:install`，再运行原有 `npm run dist:dir`、`dist:mac` 或 `dist:win`。不含凭据种子的隔离测试包使用 `--without-key-seeds`；此开关不提供模型凭据。构建失败不会回落旧内核。

- 核心复用官方完整 CLI/Web/语音/团队/定时插件依赖集合，sidebar 固定 0.24.1，教学文件依赖使用已审查版本。
- 必须使用固定锁文件的 `npm ci`；安装不执行第三方脚本，目标平台原生模块由实际 App 二进制检查。
- Mochi 插件由受管白名单复制；新运行树只复制锁文件匹配的物理依赖，拒绝外链和旧内核混装。独立桌面壳不再附带第二份旧 Host。开发启动复用该流程至单独受管的 `.mochi-dev-resources-v1.nosync`，避免源码插件的旧依赖混入。
- 构建后必须通过实际 Electron44 原生探针和教师/教室完整 Host 启动，失败即非成功构建。
- 仓库根目录 `mochi.sh` 是独立旧代 CLI 入口，当前不属于上述桌面默认入口切换；不要用它验证新版桌面 Host，也不要把新版 home 交给旧代入口。
- `--legacy-runtime` 只用于显式构建旧版回归产物，不是已升级用户数据的降级办法，不能保证旧版本读取新会话。
- 不存放用户配置、API Key、Session 或数据库。

macOS arm64 实际 App 已通过原生模块与双角色启动；语音、页面、旧会话兼容另有验收。Windows 和学校物理设备不能由本机结果代替，尚未安装覆盖用户 App 或发布。
