# 老师上传的文件怎么被读到（附件盘读取链路）

> **status**: active
> **last_verified**: 2026-09-12
> **verified_by**: 工具线（逐条跑测试 + 看渲染图取证）
> **性质**：回答「老师把 Word/Excel/PPT/PDF/图片拖进对话以后，Mochi 到底怎么把它读出来」。
> 本文只管这一条链路；产品定位看 `Mochi-总体方案.md`，出包路径看 `docs/build-standard.md`。

---

## 0. 症状与结论先摆前面

**症状**：老师在「备课与课件」里上传 Word，Mochi 回「识别不到 / 读不了这个文档」。

**结论**：不是模型不会读，是**两道闸互相咬死**，模型手里没有一把能开门的钥匙。

| # | 闸 | 原来的行为 |
|---|---|---|
| 1 | `mochi-documents` 的输入路径闸 | 只允许**会话工作区**内的路径 → 上传件在附件盘里，直接 `INPUT_OUTSIDE_WORKSPACE` |
| 2 | `mochi-files/file_read` | 只读纯文本，二进制（含 NUL 字节）一律拒 → 上传的 .docx 必被拒 |

而宿主给模型的提示只有一句话（`packages/llm/llm/src/content.ts:156`，底座源码）：

> `[<文件名>: verbatim read-only copy saved at <路径>. Read that path with your file tools when its contents are needed; copy it to a writable location before modifying it.]`

「用你的 file tools 读那个路径」——模型于是先去试 `file_read`；而 `file_read` 的拒绝消息原先只说
「Word/Excel/PPT/PDF/图片请用对应的文档工具」，**没说工具叫什么名字**。模型不知道 `doc_read` 存在，
常见结局是改去 `web_search`、或者干脆告诉老师「读不了」。

---

## 1. 文件到底落在哪里（宿主侧事实）

底座 `@deepseek-ai/dsh-attachment-local`（源码
`packages/attachment/attachment-local/`）是内容寻址存储：

| 用途 | 路径 |
|---|---|
| 普通文件引用路径（**模型看到的那个**） | `<DSH_HOME>/attachments/v1/files/<digest 前缀>/<digest>/<原文件名>` |
| 普通文件唯一对象 | `<DSH_HOME>/attachments/v1/file-objects/<digest 前缀>/<digest>` |
| 图片对象 | `<DSH_HOME>/attachments/v1/objects/<digest 前缀>/<digest>` |

两个关键性质（底座 README 原话，`attachment-local/README.zh.md`）：

1. **引用路径是只读硬链接**（"每条引用路径 … 都是只读硬链接"）。
   所以 Mochi 侧把它当**只读**输入根是符合上游设计的，不是绕权限。
2. 同名不同名的相同字节去重成一个对象，不重复占盘。

`DSH_HOME` 的解析顺序：宿主显式配置 → `MOCHI_HOME` → `DSH_HOME` → `~/.mochi-home` / `~/.dsh`。
**所以 Mochi 侧必须把这一串都当候选**，不能只认其中一个——换过 home 的机器也要找得到。

---

## 2. 修法（四件事，缺一不可）

### 2.1 读路径闸：把附件盘加成**只读**输入根

四个读文件的插件各自实现自己的允许根（本仓约定：插件之间不互相 import），所以四处都要改：

| 插件 | 位置 | 处理 |
|---|---|---|
| `mochi-documents` | `plugin.mjs` · `resolveAttachmentReadRoots()` / `existingAttachmentRoots()` / `resolveInputFile()` | 附件盘是**只读**输入根；写入仍只允许工作区。`doc_read` 结果里回 `来源: 老师上传的附件（宿主只读副本）` |
| `mochi-sheets` | `paths.mjs` · `resolveAttachmentReadRoots()` / `existingAttachmentRoots()`；`resolveInside({ roots, readOnlyRoots })` | `readOnlyRoots` **只在 `mustExist: true`（读既有文件）时生效**；`spreadsheet_create` 的输出路径永远只认工作区 |
| `mochi-presentations` | `index.mjs` · `attachmentInspectRoots()` / `withAttachmentRoots()` | `ppt_inspect` 本身只读，附件盘作为**追加**根接进 `resolveInspectAllowedRoots` |
| `mochi-files` | 不需要放开 | 它是纯文本工具，职责不是读 Office（见 2.2） |

**两条设计纪律，别改回去：**

- **写入面绝不因读放权而变大。** `mochi-sheets` 用 `mustExist` 分流：读既有文件才纳入附件盘，
  写输出只认工作区。已由 `test/plugin.test.mjs` 的「写入绝不落进附件盘」用例钉死。
- **附件盘是「追加」根，不是「兜底」根。** 没有任何主根 `mochi-presentations` 仍然照旧抛
  `WORKSPACE_UNAVAILABLE`——不能因为「恰好存在一个附件盘」就凭空获得读取能力。
  已由 `test/inspect.test.mjs` 的「不会在无主根时凭空放行」用例钉死。

### 2.2 拒绝消息按后缀点名工具（把错误消息变成路由器）

`mochi-files/handlers.mjs` 导出了 `readerHint(filePath)`，按后缀点名**真实注册过的**工具名：

| 后缀 | 点名工具 |
|---|---|
| `.docx` | `doc_read`（改：`doc_edit`；导出 PDF：`doc_export`） |
| `.pdf` | `pdf_read` |
| `.xlsx` / `.csv` | `spreadsheet_read` |
| `.pptx` | `ppt_inspect`（生成/修订：`mochi_ppt_create` / `mochi_ppt_revise`） |
| `.png .jpg .jpeg .webp .gif` | `read_image`（**前提：当前路由声明了图像输入**，见 §3.3） |
| `.doc` / `.xls` / `.ppt` | 旧版二进制格式，本机不支持 → 如实要求先另存为新格式 |
| 其他二进制 | 「本机没有能读取这种二进制格式的工具」——**不给假名字** |

同时 `file_read` 的 tool description 也提前写明这条对应关系，模型不必先撞一次墙。

> **为什么这条比修路径闸还重要**：路径闸只修了「读得到」，这条修的是「模型知道去哪读」。
> 少一条，模型照样会告诉老师读不了。
> 回归用例：`plugins/mochi-files/test/files.test.mjs` 的
> 「file_read 拒二进制时按后缀点名该改调的工具」——顺带断言提示里**不出现点号工具名**。

### 2.3 教师端预设人格里写明上传件怎么读

四个教师预设（`client-plugins/teacher-agent-presets/*/agent.cordis.yml`）都加了一段：
上传件是宿主给出的**只读副本路径**，按后缀直接调对应工具，**不要用 `file_read`**（它只接受纯文本，一定会拒），
要修改就先复制到工作区。成绩分析预设额外点名「产物一律落在工作区」。

### 2.4 出包链：vendored tarball 必须跟着源码一起换

**这是本次真正的拦路虎。** `apps/desktop/package.json:294` 用 `file:` 依赖钉着一个
**打好的 tarball**：

```
"@mochi/pdf-layout": "file:../../vendor/local-plugins/mochi-pdf-layout-0.1.0-<sha256 前 8 位>.tgz"
```

`@mochi/pdf-layout` 源码改了（新增 `splitScriptRuns` / `measureText` / `drawTextLine` 导出），
历史上 tarball 曾仍是 9/8 的旧包，导致暂存树里 `import { drawTextLine }` 直接 SyntaxError，
PPT 工具族无法进入安装包。当前是否闭环应以 `test:package-resources`、快照检查和最终包实测为准，不能继续引用旧审计当作现状。

**重打包配方**（哈希算法已实测确认 = `sha256(tgz)` 前 8 位）：

```bash
cd packages/mochi-pdf-layout
npm pack --pack-destination ../../vendor/local-plugins
cd ../../vendor/local-plugins
HASH=$(shasum -a 256 mochi-pdf-layout-0.1.0.tgz | cut -c1-8)
mv mochi-pdf-layout-0.1.0.tgz "mochi-pdf-layout-0.1.0-$HASH.tgz"
# 然后同步三处：apps/desktop/package.json 的 file: 路径、
# package-lock.json 的 root 依赖 + node_modules 条目的 resolved / integrity
# （integrity = sha512-<base64(sha512 原始字节)>），并刷新 apps/desktop/node_modules/@mochi/pdf-layout。
# 最后：node scripts/reconcile-snapshot-manifest.mjs --write
```

**顺手把工具补齐了**：`scripts/reconcile-snapshot-manifest.mjs` 原先只「重算已登记条目的哈希」+
「从 PLUGINS 白名单登记新文件」，**完全不管 tarball 的改名换新**——所以新 tgz 登记不进去、
旧条目报「登记但磁盘缺失」，`check-snapshot-manifest --fail` 必然失败，而失败原因看起来跟业务改动毫无关系。
现在它按 **`apps/desktop/package.json` 的 `file:` 依赖**作为「出包真正消费的 tarball 集合」：

- 被引用但清单里没有 → 登记
- 清单里有、已不再被引用、**且磁盘上也没有** → 删除（重打包留下的旧条目）
- 清单里有、已不再被引用、但磁盘上还在 → 保留 + 提醒（可能是别人正在换版本）

---

## 3. 三条互相独立的「看图」能力（都在这一轮落地或验证）

老师要的三件事，底层其实是同一条链路：**给模型一张图，让它真的看见**。

### 3.1 找图 + 判断图合不合适

走 `web_search` / `web_fetch` 拿到候选图；**判断合不合适必须靠 `read_image` 真的看一眼**，
不能靠文件名或 alt 文本猜。拿到 URL 后下载到工作区再 `read_image`。

### 3.2 本地找图

`file_search` 在允许根内按名字/通配符找（本仓 `mochi-files` 实现），
找到后同样用 `read_image` 看一眼再决定用不用。

### 3.3 看界面截屏 / 看自己渲出来的 PPT

**`read_image` 是底座自带的**（`@deepseek-ai/dsh-tool-fs` 的 `read-image.ts`），
支持 `.png/.jpg/.jpeg/.webp/.gif`，按文件签名识别。

> ⚠️ **它的注册有条件**：底座会判断**当前调用路由的模型能不能看图**，
> 不能就直接不注册这个工具（源码注释："An image-reading tool is useful only when the exact
> calling route can inspect its result, so unknown capability refuses"）。
> 所以 `runtime-profile.json` 里 `mochi-mimo` 的两个模型**必须显式声明**
> `inputModalities: ["text", "image"]`——少了这一行，「让 Mochi 看一眼自己渲出来的 PPT」这个能力
> **根本不存在**，而且失败方式是「工具目录里没这个工具」，非常难猜。
> 已被 `apps/desktop/scripts/test-runtime-profile.mjs` 的 `expectedMimoInitialConfig` 钉住。

**可复现的渲染自查链路**：`tools/verify-deck-render.mjs`

```bash
node tools/verify-deck-render.mjs --out <目录> --page 3
# → <目录>/deck/presentation.pptx   真 PPTX
# → <目录>/deck.pdf                 经 LibreOffice 转出的 PDF
# → <目录>/sheet-N.png              每页长图（一次看全）
# → <目录>/page-3.png               指定页原尺寸 PNG
# 然后把 PNG 交给 read_image 看。
```

**为什么必须有这个工具**：单元测试只能证明 XML 里字号是 24pt、色板正常，
**证明不了渲出来是空的 / 中文是豆腐块 / 标题被裁掉**。
本仓就是靠这条真实渲染链路才发现「混合中英数行被换成无 ToUnicode 映射的替代字形」
——测试全绿，肉眼一看整行缺字。

---

## 4. 对比度下限：渲染自查抓到的第一个真缺陷

同一轮渲染自查里肉眼看到的：`cover` / `closing` 是深底页，副题用 `accent` 画在 `deep` 上。
以 `field` 主题为例，`C08A1E` 金色压 `2F5D3A` 深绿 = **2.51:1**；
15pt 正文的 WCAG AA 下限是 **4.5:1**。投影到教室后排就是「有字但看不清」。

**这不是审美口味，是可测量的硬下限。** 修法：`plugins/mochi-presentations/index.mjs` 新增

- `contrastRatio(a, b)` — WCAG 相对亮度比，范围 1–21
- `ensureReadableColor(fg, bg, { minRatio = 4.5, fallback })` — **只推明度、不换色调**，
  向背景反方向走 20 档；都达不到才回退到调用方给的 `fallback`（深底给 `onDeep`、浅底给 `primary`），
  且回退值自己也不达标时**直接报错**，而不是把不可读的颜色发出去

**PPTX 与 PDF 两条渲染器共用同一口径**（`addSlide()` 与 PDF 绘制循环），不许一个标准一个样。

实测校正结果：

| 主题 | accent | deep | 校正前 | 校正后 |
|---|---|---|---|---|
| field | `C08A1E` | `2F5D3A` | 2.51 | **4.57**（→ `E0C58F`） |
| ink | `A8351A` | `26352E` | 1.96 | **4.88**（→ `CF9081`） |
| lab | `C2410C` | `1B3A5C` | 2.25 | **4.86**（→ `DD9779`） |
| festive | `0F766E` | `B33A20` | 1.08 | **4.79**（→ `DBEAE9`） |
| midnight | `D8A02B` | `0B0E12` | 8.27 | 8.27（本来就够，不动） |

> `festive` 校正前后`0F766E`（青绿）几乎等于 `B33A20`（陶土红）的亮度——这是**主题配色本身的错**，
> 不是算法的错。要真正修得好看，应该换掉它的 `deep` 或 `accent`；本轮只保证「绝不出不可读的文字」。
> 归入待办。

回归用例：`plugins/mochi-presentations/test/presentation.test.mjs` 的
「深底节奏页的前景色过 WCAG AA 对比度下限，且修的是明度不是色调」——
对 9 个主题逐个断言 ≥4.5:1，并断言通道大小关系不变（即没换色调）。

---

## 5. 这一轮改了什么、怎么验的

| 改动 | 文件 | 回归证据 |
|---|---|---|
| 附件盘作为只读输入根（Word/PDF） | `plugins/mochi-documents/plugin.mjs` | 该插件 `test/plugin.test.mjs` 12/12 |
| 附件盘作为只读输入根（Excel/CSV，写入口不放大） | `plugins/mochi-sheets/paths.mjs`、`tools.mjs` | 该插件测试 23/23 |
| 附件盘作为追加只读根（PPT 检查） | `plugins/mochi-presentations/index.mjs` | `test/inspect.test.mjs` 9/9 |
| 二进制拒绝消息按后缀点名工具 | `plugins/mochi-files/handlers.mjs`、`index.mjs` | `test/files.test.mjs` 12/12（含 10 种后缀） |
| 四个教师预设写明上传件读法 | `client-plugins/teacher-agent-presets/*/agent.cordis.yml` | `verify-presets.mjs` PASS |
| 深底页对比度下限（PPTX + PDF 同口径） | `plugins/mochi-presentations/index.mjs` | 该插件测试 19/19 |
| 渲染自查工具转正 | `tools/verify-deck-render.mjs` | 端到端跑通，7 页 PNG 人工看图确认 |
| `@mochi/pdf-layout` tarball 重打包 | `vendor/local-plugins/mochi-pdf-layout-0.1.0-c4a3d2c2.tgz` + `apps/desktop/package.json` + lockfile | `test-package-resources` PASS（26/29/106） |
| 快照清单收敛工具支持 tarball 改名 | `scripts/reconcile-snapshot-manifest.mjs` | `check-snapshot-manifest --fail` → **OK，496 条，字节差 ±0**（2026-09-12 23:0x；该脚本同日补上了 `directories:` 递归展开） |
| 清理临时探查脚本 | `plugins/mochi-presentations/.probe-*.mjs` 等 13 个 + `.conv/.pdftext/.png/.render-check` 4 个 | 已删，共 17 个 |
| `mochi-memory` 测试断言点号工具名（真红） | `plugins/mochi-memory/test-active-context.mjs` | 改为 `mochi_memory_note` + 负向断言 |
| `test-runtime-profile` 期望值缺 `inputModalities` | `apps/desktop/scripts/test-runtime-profile.mjs` | PASS |

全量入口复跑：**47 个真入口全绿**；另有 **7 个环境门控校验脚本**
（`verify-alpha-*`、`test-active-prompt-assembly.mjs`、`test-plugin.mjs`、`lan/test/node.mjs`）
需要 `MOCHI_*_CONSUMER` / `MOCHI_*_PLUGIN_URL` 指向已构建的 alpha 产物才能跑，
**不是回归**，但也说明「这些校验在常规开发机上默认是静默跳过的」——归入待办。

---

## 6. 下一步（明确列出，不含糊）

1. **出包与装机验证**：本次只修到「源码 + 暂存树一致、CI 快照 ±0」。**重新出包并实机装**尚未做，
   尤其是**安装包下载速度**（一体机快、老师电脑慢至 15 分钟）这条还没动——属发布链问题，见
   `docs/build-standard.md`。
2. **`festive` 主题配色本身**：`accent` 与 `deep` 近乎同亮度，靠算法校正只能救到「可读」，
   要好看得换配色。
3. **`title-body` 版式的纵向留白**：渲染自查里看到正文块整体偏上、下半页空得多。
   `index.mjs` 注释写明内容页几何「一字未改」，属**待专门做的版式设计**，不是顺手调数。
4. **7 个环境门控校验脚本**：进 CI 或明确标注「需 alpha 产物」并给出可跑的命令。
5. **DeepSeek v4.1 flash 全链路测试 + 缓存命中率**：尚未做。
