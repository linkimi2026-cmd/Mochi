# Mochi 运行事实

> **status**: active
> **last_verified**: 2026-09-13
> **verified_by**: Codex（当前源码、运行配置和本轮只读命令；未重新启动完整桌面应用）

本文回答“当前代码如何启动、选角色、装载插件、连接校园服务和进入安装包”。现场状态见 `docs/PROJECT-STATUS.md`，产品设计见 `Mochi-总体方案.md`。

## 启动入口

| 场景 | 命令 | 说明 |
|---|---|---|
| Electron 开发 | `cd apps/desktop && npm run dev` | Electron 主进程启动一个 Web sidecar，端口由运行时选择 |
| Web 开发 | `./mochi-dev-up.sh` | 默认启动 `mochi-web` 于 3090，并连接校园服务 |
| Mochi CLI / Web | `./mochi.sh --profile mochi-web --port 3090 --no-open` | 使用指定 profile |
| 打包应用 | 双击 Mochi | Electron 从包内资源启动 sidecar |

`mochi-dev-up.sh` 的 `cloud` 默认 Origin 仍是历史 Cloudflare 地址。当前“联动计划”把 CloudBase 作为国内主路线，但脚本不会自动发现该地址。演示时应通过 `MOCHI_CAMPUS_API_URL` 显式传入已验证 Origin。

## 角色选择

桌面角色选择顺序为：命令行 `--role` → `MOCHI_RUNTIME_ROLE` → 已保存角色 → 首次启动选择框。

| 角色 | 默认预设 | 预设来源 | 插件范围 |
|---|---|---|---|
| `teacher` | `lesson-planning` | 受管教师预设、已安装预设、用户预设 | 对应 profile 的完整教师能力 |
| `classroom` | `classroom` | 受管课堂预设 | 受控的 8 项课堂插件，不加载用户预设 |

教师和教室角色使用不同数据根。不要让教室一体机复用教师个人运行目录。

## 数据根

| 场景 | 默认位置 |
|---|---|
| 教师开发态 | `<workspace>/.mochi-home.nosync` |
| 教师打包态 | `~/.mochi-home` |
| 教室开发态 | `<workspace>/.mochi-classroom-home.nosync` |
| 教室打包态 | `~/.mochi-classroom-home` |

解析优先级是 `DSH_HOME` → `MOCHI_RUNTIME_HOME` → 角色默认位置。父 shell 如果已经设置 `DSH_HOME`，可能把 Mochi 写入错误目录。开发时可使用：

```bash
env -u DSH_HOME ./mochi.sh --profile mochi-web --port 3090 --no-open
```

成果文件应按工具返回的输出路径和工作区查找。运行数据根不是默认成果目录。

## 插件如何装载

`apps/desktop/resources/mochi-web/runtime-profile.cjs` 根据 `runtime-profile.json` 生成 profile 配置、Cordis patch 和插件链接。运行时按 profile 目录里的插件名装载。

三类位置必须区分：

| 位置 | 用途 |
|---|---|
| `plugins/`、`client-plugins/` | 开发态源码 |
| `apps/desktop/.mochi-package-resources-v1.nosync/` | 打包时由白名单生成的临时资源 |
| `apps/desktop/node_modules/` | 依赖闭包和打包取材，不是开发态插件真值 |

修改源码不等于修改已经生成的安装包。打包前必须重新生成受管资源并执行 `test:package-resources`。

当前 stager 定义 26 项插件资源；不同 profile 实际启用数量不同，不能把“打包定义数”写成每个角色都会同时加载的插件数。

## 工具命名

模型可见工具名只能使用字母、数字、下划线和连字符。点号会导致模型网关拒绝整轮请求。当前守卫：

```bash
node scripts/check-skill-tools.mjs
```

工具文档应使用源码真实注册名，不根据自然语言自行猜测。

## 聊天模式与工作模式

默认聊天模式收窄执行工具。教师要生成文件、课件、表格或模型时，先切换到工作模式。

模式限制在确认服务不可用时允许降级，目的是避免教师永远无法进入工作模式；校园写操作自己的审批仍然关闭失败，不会因为模式降级而自动执行。

## 校园接入

### 源码和静态资源

`scripts/campus-paths.cjs` 的校园源码优先级：

1. 有效的 `MOCHI_CAMPUS_SOURCE_ROOT`；
2. 同级 `../联动计划`；
3. `campus.nosync` 兼容副本。

当前本机解析到 `../联动计划`。校园静态资源可以由 `MOCHI_CAMPUS_STATIC_ROOT` 显式指定，或使用包内审核后的客户端。

### API

API Origin 优先使用 `MOCHI_CAMPUS_API_URL`，其次使用 `runtime-profile.json` 的 `serviceDefaults.campusApiUrl`。

当前随包发行的版本化值为 `https://jyl-campus-health-entry.pages.dev`（内测阶段的生产入口）。这是**有意写进配置的事实**，不是待办：安装包必须开箱即连，否则打包版会静静地回落到 `plugins/mochi-campus/connection.mjs` 的兜底 `http://127.0.0.1:8787`，在老师电脑上表现为"校园功能全部不可用"。环境变量仍然可以覆盖它，用于受控测试或后续换域名。

改动该值后必须重新出包（`extraResources` 把 `resources/mochi-web` 复制成包内 `Contents/Resources/mochi/profile`），只改源码不会影响已安装的应用。

`client-plugins/jxl-campus` 提供校园界面和 `/jxl-api` 同源代理；`plugins/mochi-campus` 提供 Agent 工具。校园账号与模型凭据分开，所有写操作继续由校园权限和人工确认约束。

完整关系见 `docs/PROJECT-HISTORY.md`。

## 搜索接入

搜索端点优先使用 `MOCHI_SEARXNG_ENDPOINT`，其次使用 `runtime-profile.json` 的 `serviceDefaults.searxngEndpoint`。当前配置值为 `null`。没有配置时不能承诺联网搜索一定可用，也不应临时依赖未经验证的公共实例。

## 桌面打包链

```text
源码
  → 平台与架构检查
  → 依赖与 peer 检查
  → 构建期种子
  → 校园静态发布输入
  → TypeScript 构建
  → 受管 Mochi 资源暂存
  → electron-builder
  → 安装器存在性和时间检查
```

主要入口：`apps/desktop/scripts/package-desktop.cjs`。Mac arm64 与 x64 构建要求宿主平台和 CPU 架构匹配。Windows 正式包通过原生 Windows CI 生成。

快照清单为 `.github/windows-native-package-inputs.json`。当前本轮检查结果为 504 项、91,992,954 字节、0 缺失、0 不一致。检查命令：

```bash
node scripts/check-snapshot-manifest.mjs --fail
```

不带 `--fail` 的报告模式不能作为门禁通过证据。

## 凭据

构建脚本可以把模型凭据种子写入安装包，以满足安装后直接使用。这是当前产品决定，同时意味着安装包接收者可能提取凭据。技术事实和治理风险见 `docs/DECISIONS.md` 与 `参赛材料/伦理与社会影响.md`。

校园服务端密钥、校园数据库和用户会话不会作为校园静态客户端复制进桌面包。

## 当前风险

- 校园 API 和搜索端点没有默认现行地址。
- Web 启动脚本的 Cloudflare 默认值与“联动计划”CloudBase 主路线不一致。
- 安装包内置模型凭据需要限额、轮换和撤销治理。
- 插件链接和运行数据可能受错误的 `DSH_HOME` 或移动后的旧 profile 影响；遇到启动错误先检查实际数据根和链接。
- 源码、暂存资源和已发布安装包可能处于不同时间点；验收必须绑定具体包。

## 维护检查

```bash
cd apps/desktop
npm run typecheck
npm run test:runtime-profile
npm run test:profile-skills
npm run test:package-resources

cd ../..
node scripts/test-campus-paths.cjs
node scripts/test-jxl-campus-static-root.mjs
node scripts/check-skill-tools.mjs
node scripts/check-snapshot-manifest.mjs --fail
```

测试通过说明相应代码和资源契约成立，不自动证明线上服务、最终安装包或现场设备已经验收。
