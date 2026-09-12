# Mochi 打包标准（唯一出包路径）

**状态：生效中 ｜ 适用范围：所有会影响 Windows 安装包内容的改动**

> `status`: 生效中 ｜ `last_verified`: 2026-09-12（新增 §5 私有出包分支机制）｜ `verified_by`: WorkBuddy 工具线

本文只回答一件事：**一个源码改动怎么变成用户装得到的修复。**

结论先写：只有一条路径，没有任何手工补丁路径。

---

## 0. 唯一路径

```
改源码 → 提交到仓库 → GitHub Actions 出包 → 用户安装这个包
```

**不存在第二条路径。特别地，不存在「手工热修包」这条路径。**

> ⚠️ 2026-09-12 补注：历史上确实产出过两个手工热修目录（`release/2026-09-11-win-hotfix/`、`release/2026-09-12-toolname-hotfix/`）。2026-09-12 21:0x 已随「手工路径作废」一并移入 `release/_voided-manual-hotfixes/`（含 0600 的作废说明 README）；**仍在盘上，但已不在 `release/` 顶层、不再会被误当交付物分发**。本条是**规范**，不是对磁盘现状的描述。

上一轮曾交付过一个 Windows 双击即修的 `.cmd` 热修包，让用户在机器上手工打补丁。
用户已明确否掉这种模式，原话是：

> 「所有的问题你必须要在安装包里面解决掉，不允许再出现这种需要更新的这种情况。」

所以热修包不是「先留着应急」，而是**产品上不允许存在的交付物**：

- 老师拿到的应该是一个装完即好用的包，不是「装完再补一刀」；
- 手工补丁要求老师做技术操作（解压、右键、执行脚本），现场没人能保证执行到位；
- 补丁一旦扩散，用户机器上的实际版本就不可知，后续任何排障都在猜；
- 补丁脚本本身不在 CI 快照里、没被哈希守护，等于一条绕过门禁的暗路。

**如果修不进包，就说明问题还没真正修完**，而不是「再发个补丁兜一下」。

---

## 1. 什么会进包、什么不会

出包不是「整个仓库塞进去」，而是由白名单**逐文件**挑选。改错位置 = 改动不进包，
用户装到的还是旧行为，而在开发机上又一切正常 —— 这是本项目最容易踩的坑。

### 1.1 插件源码：按白名单逐文件暂存（本节是重点）

`apps/desktop/scripts/prepare-mochi-resources.cjs` 里有一个 `PLUGINS` 常量，
它把每个要打包的插件都写成一条：

```js
{ id: "mochi-xxx", source: "plugins/mochi-xxx", files: ["index.mjs", "package.json"] }
```

**这条记录里的 `files` 是精确文件清单，只列了文件才进包。**

- 你在 `plugins/mochi-xxx/` 里**新增一个源文件**（例如 `tools.mjs`），
  **必须同时把 `"tools.mjs"` 加进 `PLUGINS` 对应条目的 `files`**，
  否则它不会被打进安装包：开发机 `node index.mjs` 走的是磁盘真实文件，能跑；
  用户在包里走的是暂存树，文件根本不在，直接报模块找不到。
- 有的条目还有 `directories: ["assets"]`（整目录拷贝，例如本地 vendored 的渲染资源）。
  新增资源目录同理要登记。
- 白名单里 `files` 列了但磁盘上**删掉了**的文件，会让暂存阶段报错 —— 删文件时记得同步白名单。

> 一句话：**改已有文件通常自动进包；新增文件一定不会自动进包。**
> 自检方法见第 5 节 `test:package-resources`。

### 1.2 client-plugins：同样的规则

`client-plugins/<name>/` 走同一个 `PLUGINS` 白名单、同一套 `files` 逐文件规则
（例如主题、品牌、校园客户端、工作台、模型预设等）。新增 `client.js` / `index.mjs`
之外的源文件，同样要先登记再提交。

### 1.3 vendor/local-plugins/*.tgz：安装依赖，缺了连 npm ci 都过不去

`apps/desktop/package.json` 里有约 21 条指向
`vendor/local-plugins/*.tgz` 的 `file:` 依赖。出包流程第一步 `npm ci` 会去读这些包：

- **tgz 必须在仓库里真实存在**，且路径与版本号跟 `package.json` / lockfile 对得上；
- 重新打包某个插件后，如果 tgz 文件名带内容哈希（形如 `xxx-0.0.1-<hash>.tgz`），
  记得同步改 `package.json` 的引用和 lockfile，否则 CI 直接失败；
- 这些 tgz 也在 CI 快照清单里，改一个就要重算哈希（见第 3 节）。

> 🔴 **改源码却忘了重打 tgz ＝ 出包直接坏，而且报错点离你很远的那个文件。**
> 2026-09-12 真实踩过：`packages/mochi-pdf-layout/index.mjs` 加了新导出，但
> `vendor/local-plugins/mochi-pdf-layout-0.1.0-a3f9ed33.tgz`（9/8 打的）里没有 →
> 暂存树 `import { drawTextLine }` SyntaxError → **PPT 工具族整个不可用**。
> 详细配方（含哈希算法、integrity 算法、要同步的三处）见
> `docs/attachment-and-render-pipeline.md` §2.4。
>
> **哈希算法已实测确认**：文件名里的 8 位十六进制 = `sha256(tgz)` 的前 8 位；
> lockfile 的 `integrity` = `sha512-<base64(sha512 原始字节)>`。
>
> **`scripts/reconcile-snapshot-manifest.mjs` 现在会自动收敛这些条目**
> ——它按 `apps/desktop/package.json` 的 `file:` 依赖判定「出包真正消费的集合」：
> 新打的自动登记、已不再引用且磁盘上也没有的自动删除。**重打包以后跑一次 `--write` 即可**，
> 不再需要手工改 `.github/windows-native-package-inputs.json`。

### 1.4 docs/**、scripts/**：默认不进包

`docs/**` 在快照清单里是 **0 条** —— 也就是说文档改动**完全不影响安装包**，
不要指望「改了文档用户就看到新说明」。

`scripts/**` 绝大多数也不进包；目前清单里**只有 `scripts/campus-paths.cjs` 一条**，
因为打包脚本在运行时要 require 它。本文件所属的 `scripts/check-snapshot-manifest.mjs`
是开发期校验工具，**不打包**。

判断某文件是否进包，最可靠的办法是直接查清单：

```bash
python3 -c "import json;m=json.load(open('.github/windows-native-package-inputs.json',encoding='utf-8'));print('\n'.join(f['path'] for f in m['files'] if f['path'].startswith('docs/')))"
```

### 1.5 运行时载荷的排除规则：装了但运行时不会读的文件

**安装慢的根因是文件数，不是体积** —— 老师反馈「点了安装向导之后慢得离谱」，
实测是安装要往磁盘上新建 **41,150 个文件**，Windows Defender 逐个扫描新建文件
（每个 10~50 ms），累计十几分钟。本机纯解压 41,150 个文件要 **28.5 秒**（M 系列芯片）。

因此有三条规则排除「运行时永远不会加载」的文件：

```js
// apps/desktop/scripts/prepare-mochi-resources.cjs
const PACKAGED_RUNTIME_PAYLOAD_EXCLUDED_FILE = /(?:\.map|\.d\.ts|\.d\.mts|\.d\.cts)$/i;
```

| 覆盖哪棵树 | 由谁执行 |
|---|---|
| `resources/mochi/node_modules` | `packagedRuntimePayloadFilter()` |
| 插件的整目录拷贝（`PLUGINS[].directories`，如 `dsh-better-sidebar/lib`） | 同上 |
| `app.asar.unpacked/node_modules` | `apps/desktop/package.json` 的 `build.files` 四条 `!node_modules/**/*.<ext>` |

实测收益：**12,775 个文件 / 235.5 MB 原始 / 41.9 MB 压缩**，占全包文件数 **31.0%**。
→ 文件数 41,150 → **28,375**。

**两条不许动**：
- 排除规则**只在打包时生效，磁盘上一个文件都不删**（这是用户明确要求）；
- `LICENSE` / `NOTICE` 是合规文件，一个都不许排除。

**改这两处必须同时改**，否则会静默回归（包涨回 4 万个文件，且不报任何错）。
`test-installer-config.mjs` 用 electron-builder 的**真实** `getNodeModuleFileMatcher`
逐文件断言「该留的留、该排的排」，并断言 `package.json` 的 glob 与脚本里的正则覆盖同一组扩展名。

> 🔴 别用 `getMainFileMatchers` 去验证这条规则 —— 它追加的是 `!**/node_modules`，
> 实测对 `node_modules/**` 下所有文件一律返回 `false`，用它验证会得出完全错误的结论。
> 完整取证方法、实测数字、以及「下一步还能再降 83% 的那一刀」见
> **`docs/installer-install-speed.md`**。

---

## 2. CI 快照清单铁律

`.github/windows-native-package-inputs.json` 登记了 Windows 出包源码快照的
**精确文件清单 + 每个文件的 sha256 与字节数**。私有出包分支在构建前会逐个校验
哈希，对不上直接拒绝构建。所以：

> **改动清单内的任何一个文件，都必须同步重算它的 `sha256` 和 `bytes`，
> 并把差值累加进 `verification.expectedFileBytes`。**
> 漏了这一步，出包会在 CI 阶段失败，而且失败原因看起来跟你的业务改动毫无关系。

### 2.1 重算脚本（**首选这一条**）

仓库里有一个专门的工具，一次把「哈希漂移 + 新增文件登记 + 字节总数」全部处理掉：

```bash
node scripts/reconcile-snapshot-manifest.mjs          # 先看差异，不落盘
node scripts/reconcile-snapshot-manifest.mjs --write   # 确认后落盘
```

它会做四件事：

1. 从 `prepare-mochi-resources.cjs` 反解 `PLUGINS` 白名单，把**新插件源文件自动登记**进清单
   （分类写成 `staged-plugin:<插件id>`）——不用再手工加条目，也就不会忘；
2. 重算**每一个**清单内文件的 `sha256` 与 `bytes`；
3. 重写 `verification.expectedFileCount` 与 `expectedFileBytes`；
4. 报告「白名单外但已登记的条目」（`directories` 整目录拷贝的那批，属正常）与
   「清单登记但磁盘缺失」的文件。

跑完用 `node scripts/check-snapshot-manifest.mjs --fail` 复查，应当
`不一致：0 个，缺失：0 个`、`字节差：±0`。

<details>
<summary>手工重算单个文件的做法（仅在需要精确控制时使用）</summary>

把 `<改动文件相对路径>` 换成你这次真正改过的文件（相对仓库根，用正斜杠），支持一次写多个：

```python
import json, hashlib
p = '.github/windows-native-package-inputs.json'
m = json.load(open(p, encoding='utf-8'))
targets = ['<改动文件相对路径>']
paths = {f['path']: f for f in m['files']}
total = int(m['verification']['expectedFileBytes'])
for t in targets:
    assert t in paths, f'该文件不在快照里：{t}'
    d = open(t, 'rb').read(); f = paths[t]
    total += len(d) - int(f['bytes']); f['bytes'] = len(d); f['sha256'] = hashlib.sha256(d).hexdigest()
m['verification']['expectedFileBytes'] = total
open(p, 'w', encoding='utf-8').write(json.dumps(m, ensure_ascii=False, indent=2) + "\n")
print('ok', total)
```

这条路径的 `assert` 会在「文件不在快照里」时报错 —— 那通常正说明你撞上了 1.1 节
「新增文件忘了登记」的坑，用上面的 reconcile 脚本来处理。
</details>

- 清单本身（manifest）不参与哈希，是快照里唯一豁免的文件。

### 2.2 当前漂移状态

**2026-09-12 22:2x：0 漂移。** 实时值 `不一致：0 个，缺失：0 个`、`字节差：±0`，
**492 条 / 91,919,236 B** —— 2026-09-12 这轮出包就是拿这份清单物化的快照，
并且已经过了私有 CI 的逐文件哈希校验（`Verify approved Mochi source snapshot` 通过）。

> ⚠️ 这一节写的是**时点结论，不是长期状态**：当天 19:4x 曾漂移 11 个文件 / +34,614 B，
> 20:2x 收敛到 3 处（`apps/desktop/package.json`、
> `apps/desktop/scripts/prepare-mochi-resources.cjs`、
> `apps/desktop/scripts/test-installer-config.mjs` —— 即那一轮真正改过的文件）。
> **出包前必须重新收敛到 0**，一切以脚本的实时输出为准，不要抄这里的数字。

为什么之前会有漂移、以及为什么这次连别人未提交的改动一起重算了：

- 漂移的成因是「清单是哈希白名单，但工作区里堆着多个人未提交的改动」。
  只要漂移不为 0，私有 CI 的哈希校验就会在**第一步**失败，
  整轮 Windows 出包白跑 —— 这与「所有修复必须进安装包」这条硬要求直接冲突。
- 所以现在的口径是：**出包前必须把清单收敛到 0 漂移**，
  而不是「只算自己那几个、别人的留给别人」。
  收敛后请在提交说明里写清楚这次一并重算了哪些文件，方便别人核对。
- 每条新增条目都要有 `categories`（`staged-plugin:<插件id>` / `desktop-source` /
  `desktop-lock` / `teacher-preset`），不要留空。

随时可以跑下面这条命令看**实时**状态：

```bash
node scripts/check-snapshot-manifest.mjs
```

脚本会打印每个不一致文件的路径、期望字节 vs 实际字节、期望/实际哈希前 16 位，
以及期望总字节与实际总字节的差值。加 `--fail` 会以退出码 1 表示存在漂移。

`.github/workflows/mochi-ci.yml` 里的快照步骤**当前是「报告但不阻断」**
（`continue-on-error: true`）。清单再维持一段时间 0 漂移之后，删掉
`continue-on-error` 并给脚本加 `--fail`，就升级成硬门禁。

---

## 3. 本机（Mac）不能出包

Windows 安装包**只能在原生 Windows runner 上构建**。这不只是约定，是代码里写死的：
`apps/desktop/scripts/package-desktop.cjs` 的 `assertNativeTarget`（第 62 行附近）
会比较 `process.platform` 与目标平台，不一致直接抛错：

- 在 macOS 上跑 `npm run dist:win` → 立即被拒，不会产出 Windows 安装器；
- 同理，Windows 安装器必须在 `windows-2022` 上、用 x64 架构构建。

所以本机能做的只有两件事：

1. **取证**：读源码、读包内容、比对哈希；
2. **校验**：跑测试、跑快照清单检查、跑打包前的资源暂存检查。

**本机做不了**：产出可交付的 Windows 安装包。

真正的出包在 `.github/workflows/windows-native-package.yml`，
它只在私有出包仓库里运行（会拒绝非私有仓库），流程是：
校验快照哈希 → `npm ci` → 校验原生模块可加载 → 跑固定测试 → 暂存资源 →
构建安装器 → 上传工件（仅留在私有仓库，不对外发布）。

---

## 4. 发布前自检清单

出包前在本机把下面这些跑一遍。**任何一条不是「通过」就不要进入出包流程。**

### 4.1 快照一致性

```bash
node scripts/check-snapshot-manifest.mjs --fail
```

- 看输出末尾：应为 `[snapshot] OK`。
- 若显示 `DRIFT`：跑 `node scripts/reconcile-snapshot-manifest.mjs --write` 收敛到 0 漂移。
- 期望输出里 `字节差` 应当是 `±0`，`不一致：0 个，缺失：0 个`。

### 4.2 回归测试（CI 会跑的同一批）

```bash
# 插件、客户端插件、仓库脚本、桌面端纯 Node 测试
node --test plugins/mochi-campus/connection.test.mjs plugins/mochi-lan/test.mjs \
  plugins/mochi-knowledge/test/knowledge-store.test.mjs \
  plugins/mochi-knowledge/test/page-image.test.mjs \
  plugins/mochi-knowledge/test/plugin.test.mjs \
  plugins/mochi-office/test/server.test.mjs plugins/mochi-office/test/store.test.mjs \
  plugins/mochi-files/test/paths.test.mjs \
  plugins/mochi-task-scheduler/test/schedule-time.test.mjs \
  plugins/mochi-task-scheduler/test/scheduler.test.mjs \
  plugins/mochi-task-scheduler/test/store.test.mjs \
  client-plugins/jxl-brand/scripts/avatar-lifecycle.test.mjs \
  client-plugins/mochi-lan/test/client.test.mjs \
  client-plugins/mochi-model-presets/test/client.test.mjs \
  client-plugins/mochi-modes/test/client.test.mjs \
  client-plugins/mochi-workbench/test/client.test.mjs \
  scripts/test-campus-paths.cjs scripts/test-jxl-campus-static-root.mjs \
  scripts/test-run-detached.cjs \
  apps/desktop/scripts/test-release-input.mjs \
  apps/desktop/scripts/test-doctor.mjs \
  apps/desktop/scripts/test-launch-role.mjs
```

- 看每个文件的 `✔`、末尾的 `pass N / fail 0`；进程退出码必须是 0。
- 完整的 CI 入口、以及**为什么另外那些测试没进 CI**（需要原生模块 / 内部依赖），
  见 `.github/workflows/mochi-ci.yml` 顶部的注释。
- ⚠️ **已知覆盖缺口**：凡 `import '@deepseek-ai/dsh-tools'` 的插件测试
  （`mochi-modes` / `mochi-visuals` / `mochi-sheets` / `mochi-documents` /
  `mochi-presentations` 的绝大多数用例）在 CI 上跑不了 —— CI 不装依赖。
  它们**必须在本机跑**，CI 绿了不代表它们没坏。补法是给 CI 放一个 dsh-tools 测试替身，
  属于待办项。

### 4.3 打包资源暂存检查（新增/删除插件文件时必跑）

```bash
cd apps/desktop && npm run test:package-resources
```

- 这条会验证 `PLUGINS` 白名单暂存出来的资源树是否完整。
- **只要你动过 `PLUGINS` 的 `files`/`directories`，或给插件新增/删除了源文件，就必须跑。**
- 注意：这条需要 `apps/desktop` 已安装依赖，只能在本机依赖齐全时跑；
  在干净检出上会因缺 node_modules 而失败（这是预期，不是回归）。

### 4.4 出包相关契约

以下在 `apps/desktop` 目录下运行，且都要求依赖已安装：

```bash
cd apps/desktop
npm run test:installer-config   # 安装器配置契约
npm run test:runtime-profile    # 运行时 profile 组装
npm run test:release-input      # 发布输入快照与篡改拒绝
```

### 4.5 提交前的最后一眼

- [ ] 我新增的每个插件源文件，都登记进了 `PLUGINS` 的 `files`（或 `directories`）。
- [ ] 我改动的每个快照内文件，哈希和字节都重算过（`reconcile-snapshot-manifest.mjs --write`）。
- [ ] `node scripts/check-snapshot-manifest.mjs --fail` 输出 `OK`。
- [ ] 4.2 的测试全绿。
- [ ] **本机**跑一遍 4.3 以及 §4.6 的那批「CI 覆盖不到」的测试。
- [ ] 没有产出任何 `.cmd` / 补丁脚本之类的「手工热修」交付物。

### 4.6 CI 覆盖不到的测试（必须本机跑）

因为 CI 不装依赖，下面这批只能在依赖齐全的本机跑。**改了对应插件就一定要跑**：

```bash
cd plugins/mochi-modes      && node --test test/*.test.mjs
cd plugins/mochi-visuals    && node --test test/*.test.mjs
cd plugins/mochi-files      && node --test test/*.test.mjs
cd plugins/mochi-sheets     && node --test test/*.test.mjs
cd plugins/mochi-documents  && node --test test/*.test.mjs
cd plugins/mochi-presentations && node --test test/*.test.mjs
cd client-plugins/mochi-modes && node --test test/*.test.mjs
```

（`plugins/mochi-modes` 这类插件的测试目录里要有 `node_modules` 软链指向
`@deepseek-ai/dsh-tools` 才能跑；这是开发机约定，不进包。）

### 4.7 技能/文档层工具名守卫（零依赖，CI 硬门禁）

```bash
node scripts/check-skill-tools.mjs          # 人读
node scripts/check-skill-tools.mjs --json   # 机器可读
```

**为什么需要单独一条**：`apps/desktop/scripts/test-package-resources.mjs` 里已有两层守卫
—— `assertModelFacingToolNames()`（重放注册面后断言工具名）与
`assertNoDottedToolNameLiterals(stageRoot/plugins)`（扫已暂存插件源码）。
**两层都不扫 `skills/`**，于是下面这些曾长期漏网（2026-09-12 实测，且**同日已由 `check-skill-tools.mjs` 全部改正**）：

- `skills/class-meeting-prep/SKILL.md` 的 `jxl.*`<!-- allow-dotted-tool-name -->
- `skills/student-follow-up/` · `student-movement-request/` · `weekly-class-report/`
  三份 SKILL.md 引用的 **`jxl_student_query`——这个工具根本不存在**（正确名是 <!-- allow-dotted-tool-name -->
  `jxl_student_directory_search` / `jxl_student_card`）

本脚本补齐这一段：扫 `skills/` + `docs/`（排除 `docs/reference/` 第三方提示词语料、
`docs/tasks/` 历史工单证据），报两类问题并**对 R1 以退出码 1 阻断**：

| 规则 | 内容 |
| --- | --- |
| **R1** | 反引号里的工具名写成点号形态（`jxl.*` / `ppt.create`）——会让模型网关整轮 400 拒收 <!-- allow-dotted-tool-name --> |
| **R2** | 反引号里的工具名拼错，或引用了当前不存在的工具 |

**豁免方式**：故意展示错误写法的对照行，在**行尾**加 `<!-- allow-dotted-tool-name -->`。
例：`docs/mochi-naming-convention.md:70` 用 `mochi.ppt_create` 演示「不要这样写」。<!-- allow-dotted-tool-name -->

> 已知工具名集合来自两处：测试文件里的期望数组（人工复核过的真值）+ 插件源码静态字面量。
> 报 R2 时先确认是**文档写错**还是**工具真的改名了**——后者要同步改测试与本文档。

---

## 5. 私有出包分支：快照、workflow 与依赖软链

出包不是「把 Mochi 仓库推上去」，而是在**私有仓库** `linkimi2026-cmd/jyl-campus-health`
的一条 `codex/mochi-windows-*` 分支上跑。那条分支里有两个输入：

```
jyl-campus-health @ codex/mochi-windows-*
├── campus-source/            ← 私有仓自身内容（校园端源码，CI 现场 pnpm 构建）
│   └── mochi-source/         ← Mochi 快照（逐文件白名单，本仓产物）
└── .github/workflows/windows-native-package.yml   ← 出包流程（模板的分离副本）
```

推送到 `codex/mochi-windows-*` 即触发（push 事件）；也可在 Actions 页手动 dispatch。

### 5.1 快照是「精确白名单」，不是「大致一份源码」

CI 的 `Verify approved Mochi source snapshot` 会拿 `.github/windows-native-package-inputs.json`
逐个校验：路径安全 → 逐个 sha256 → 字节数 → **反向遍历整棵快照树，出现清单外的文件直接失败**
→ 出现 reparse point（符号链接）直接失败。

所以快照里合法的文件总数恒等于 **清单条目数 + 1**（`+1` 是清单自身，它是唯一豁免哈希的文件）。
2026-09-12 这轮是 **492 + 1 = 493 个文件 / 91,919,236 字节**。

⚠️ 因此**清单里没登记的新文件不会进包，也不会报错** —— 用户装到的还是旧行为，
而开发机一切正常。这正是 §1.1 那个坑在快照层的同一张脸。

### 5.2 快照不能带符号链接 → 依赖链接由 CI 重建（最容易漏的一步）

开发机上 `plugins/<id>/node_modules/<pkg>` 是指向 `apps/desktop/node_modules` 的
**相对符号链接**。快照是逐字节白名单、且 CI 明确拒绝 reparse point，所以这些链接**不在快照里**。

CI 于是用**目录联接（junction）**把它们重建出来，而重建清单**硬编码在 workflow 的
`Install and verify desktop runtime closure` 步里**。

> 🔴 **改了插件依赖就必须重生成这份清单。**
> 漏了的后果不是警告，而是 `npm run test:package-resources`（它会 `import` 每个被暂存插件的
> 入口）解析不到依赖直接失败 —— 整轮出包白跑。

生成方法（本机一条命令，不需要推理）：

```bash
node tools/derive-plugin-links.mjs              # 看清单与差异报告
node tools/derive-plugin-links.mjs --powershell # 直接输出可粘贴进 workflow 的块
```

它的口径是「**开发机真实解析面 ∩ apps/desktop 提供的包**」：以 `PLUGINS` 白名单为准，
取每个被暂存插件 `node_modules/` 下真实存在的依赖，再与 `apps/desktop/node_modules` 求交。

**平台专属二进制必须剔除**（脚本已自动剔除，判据见脚本里的 `PLATFORM_SPECIFIC`）。
原因值得写下来：`@napi-rs/canvas` 会从自己的 realpath 旁边去解析 `@napi-rs/canvas-<平台>`，
所以**不需要**插件级链接；而开发机是 macOS、装的是 `*-darwin-arm64`，到了 windows runner 上
这个目标根本不存在 —— 旧写法直接 `throw`，**一个可选包就能误杀整轮出包**。

现在的写法是「目标缺失则跳过并写进 step summary」，同时保留
**2026-09-10 实测必需的那 11 条为硬失败**（那 11 条是本轮之前唯一有实证的必需集）。
2026-09-12 这轮清单由 **11 条扩到 109 条**，新增的都是本轮新进包插件
（`mochi-files` / `mochi-sheets` / `mochi-visuals` / `mochi-modes`）与
`mochi-presentations` 自身长大的导入面。

### 5.3 私有副本 ≠ 模板：改模板不会生效

本仓里的 `windows-native-package.yml` 是**审阅模板**；真正执行的是私有分支里那份。
两者已经分叉，私有副本带 8 处 **copy-only 修复**，每一处都是 2026-09-10 那轮真实踩出来的：

| # | 修复 | 为什么 |
|---|---|---|
| 1 | 快照**不搬移**出 `campus-source`，改为把 release input 暂存到 `os.tmpdir()` 并传 `--release-input-root` | 快照落在输入根内部时，release 输出目录会被守卫按设计拒绝 |
| 2 | `python -m pip install setuptools` | node-gyp 9.x 需要 `distutils`，Python 3.12 已移除 |
| 3 | 依赖链接用 `New-Item -ItemType Junction` 重建 | 见 §5.2 |
| 4 | credits 导出**写进文件**，失败再退到 `headless_shell.exe`（2026-09-12 再加虚拟时间预算 + 3 轮重试，见 §5.4） | 管道捕获在 windows-2022 上返回空（exit 0、无 HTML） |
| 5 | 探针脚本改成**行数组**拼接，不用 `@'…'@` here-string | here-string 顶格会破坏 YAML 块标量 |
| 6 | 探针显式给 `MOCHI_PROBE_PLAYWRIGHT` | 探针落在 `RUNNER_TEMP`，裸 `require("playwright")` 解析不到 |
| 7 | 出包命令带 `--release-input-root` | 配合 #1 |
| 8 | 注入 `MOCHI_SEED_*_API_KEY` 仓库密钥 | 首启种子需要 |

> ⚠️ 反过来也成立：**私有副本里的修复没有回流到模板**。改动任一方时另一方要手动跟上。
> 2026-09-12 这轮的 credits 断言加固（§5.4）是**两边都改了**的一次。

### 5.4 credits 导出：这是两个真缺陷，不是一个

**缺陷一：只判 `<html` 会放进一份假清单。**
Chromium 会**静默地 dump 新标签页**（约 26 KB、标题「新标签页」、`Copyright` 零命中），
而新标签页同样含 `<html` —— 只断言 `<html` 抓不住「导错了页」。

**缺陷二（2026-09-12 实测）：`chrome://credits` 是异步渲染页，`--dump-dom` 会跑赢数据源。**
证据是**同一条命令、同一个 runner 镜像**：run #28 拿到真页面（exit 0、正常 HTML、
build 全绿），run #29 拿到**空文件**（exit 0、0 字节、随后脚本自己抛异常）。
同一份脚本两种结果 ⇒ 这不是配置错，是竞态。

> 顺带记一个 PowerShell 的不对称（run #29 的报错就出在这）：
> `Get-Content -Raw` 读**空文件**返回 `$null`；`-match` / `-notmatch` 会把它**静默当 `""`**，
> 但 `[regex]::Matches($null, …)` **直接抛** `Value cannot be null (Parameter 'input')`。
> 凡是"先判空、再按字符串处理"的地方，都要显式 `[string]` 转型。

最终写法（两个缺陷一起覆盖）：

| 手段 | 解决什么 |
|---|---|
| `--virtual-time-budget=8000` | 给异步数据源留出渲染时间 |
| 同一二进制**最多重试 3 轮**，失败后换 `headless_shell.exe` 再来 | 竞态是概率性的，重试是最便宜的对策 |
| 提前成功判据 `-match "<html" -and .Length -ge 100000` | 一旦拿到合格文档就不再等 |
| `$creditsHtml = [string](Get-Content … -Raw)` | 挡住 `$null` 抛异常 |
| 三判据：`<html` + 体量 ≥100000 + `Copyright` 命中数 >0 | 卡住"导成新标签页"（约 26 KB 必然不达标） |

**阈值为什么定 100000 而不是 200000**：新标签页约 26 KB，100000 已稳稳卡住它；
而 200000 对一次「渲染到一半」的 dump 有**误杀**风险 —— 宁可多跑一轮重试，不要假阴性。

（本机 macOS 侧另有一层：实测 Chromium 能启动、CDP 能连，`chrome://credits` 却渲染为
**空文档**，所以本机开发资源根里那份 credits 是"如实标注来源"的替代品，不是伪造 ——
见 §8.2 与 `docs/installer-install-speed.md`。Windows 交付物由 CI 每次现取。）

### 5.5 本机怎么准备与监视

| 事情 | 做法 |
| --- | --- |
| 物化快照 | 按清单逐文件拷贝 + 逐字节校验 + 反向核对无多余文件（2026-09-12 实施记录见 WORKLOG） |
| 触发 | 推送到 `codex/mochi-windows-*` 分支，或在 Actions 页 `workflow_dispatch` |
| 看进度 | 取令牌后打 Actions API；`git credential fill` 可从 macOS 钥匙串取出 `github.com` 凭据 |
| ⚠️ 沙箱 | 沙箱内 `github.com` 被 `502 CONNECT tunnel failed` 挡住（`api.github.com` 正常）→ `git push` 要非沙箱执行 |
| 🔴 直推仍失败时 | 本机代理有时对 `github.com` **持续**返回 502（非沙箱、重试 4 次都一样）→ 改走 §5.6 的 API 路径 |

取令牌并查看最近运行（不打印令牌本身）：

```bash
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/linkimi2026-cmd/jyl-campus-health/actions/runs?per_page=5"
```

### 5.6 `github.com` 不通时，用 Git Data API 送提交

本机代理对 `github.com` 返回 `502 CONNECT tunnel failed`（**非沙箱也一样**），
但 **`api.github.com` 是通的**。这时 `git push` 重试多少次都没用，而走 API 手工搭一个
commit 只要四步 —— 内容在本地编码，全程不碰 `github.com` 这个域名。

| 步 | 调用 | 关键点 |
|---|---|---|
| 0 | `GET /repos/{o}/{r}/git/ref/heads/{branch}` | 拿远程当前指针，作为 parent |
| 1 | `GET /repos/{o}/{r}/git/commits/{sha}` | 拿 base tree |
| 2 | `POST /repos/{o}/{r}/git/blobs`（**base64**） | 见下方"免费的字节级校验" |
| 3 | `POST /repos/{o}/{r}/git/trees`（带 `base_tree`） | 只写变更的那些 path，其余继承 |
| 4 | `POST /repos/{o}/{r}/git/commits` → `PATCH /git/refs/heads/{branch}`（`force: false`） | 快进更新；**PATCH 这一步即触发 workflow** |

> ✅ **免费的字节级校验**：base64 建 blob 时，API 返回的 `sha` 必须等于本地
> `git hash-object <file>`。相等就证明"送上去的字节 == 本地那份"，
> 比事后下载回来 diff 更省事。**不等就立刻中止**，不要继续建 tree/commit。

这样产生的提交在 git 语义上与 `git push` 完全等价（同一 parent、同一 tree、
同一 blob sha），只是绕开了被挡的域名。

---

## 6. 相关文件

| 文件 | 作用 |
| --- | --- |
| `.github/windows-native-package-inputs.json` | Windows 出包源码快照清单（哈希 + 字节） |
| `.github/workflows/windows-native-package.yml` | 唯一出包流程（私有仓库、Windows runner） |
| `.github/workflows/mochi-ci.yml` | 回归测试 + 快照漂移报告 |
| `scripts/check-snapshot-manifest.mjs` | 本机快照校验脚本 |
| `scripts/reconcile-snapshot-manifest.mjs` | 快照收敛脚本：重算哈希 + 自动登记新插件文件 + 更新字节总数 |
| `scripts/check-skill-tools.mjs` | 技能/文档层工具名守卫（点号 + 不存在名），CI 硬门禁 |
| `scripts/scan-doc-drift.mjs` | 文档漂移自查（11 条规则，带 `文件:行号`），CI 只报告 |
| `docs/DOC-AUTHORITY.md` | 文档权威分层裁决书（谁说了算 + 元数据规范） |
| `docs/agent-integration-handbook.md` | 外部 Agent 对接技术手册（工具全表 / 契约 / A2A） |
| `apps/desktop/scripts/prepare-mochi-resources.cjs` | `PLUGINS` 白名单暂存（决定什么进包） |
| `tools/derive-plugin-links.mjs` | 从 `PLUGINS` 反解出 CI 要重建的依赖联接清单（见 §5.2）；**开发工具，不进快照** |
| `apps/desktop/scripts/package-desktop.cjs` | 出包入口，`assertNativeTarget` 拒绝跨平台构建 |
| `tools/derive-plugin-links.mjs` | 反解私有出包分支要重建的插件依赖链接（§5.2） |
| 私有仓 `linkimi2026-cmd/jyl-campus-health` | 真正的出包现场：`campus-source/` + `mochi-source/` 快照（§5） |
