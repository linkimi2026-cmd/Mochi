# Mochi 代码质量独立审核 · 2026-09-12

> **status**: active　**last_verified**: 2026-09-12 19:2x　**verified_by**: 工具线（只读取证 + 独立复跑；未改任何源码）
> **审核方式**：3 路分区深读（LAN/协议、文档工具链、记忆与前端）+ 主审独立复跑测试与亲手复现关键缺陷。
> 标 ✅ 的结论**由主审亲自复现**；标 ⚠️ 的是子审计给出 文件:行号 但主审未逐条复跑的。
> **注意**：审核期间 `plugins/mochi-presentations/`（19:02）与 `packages/mochi-pdf-layout/`（19:09）正在被另一路并行改动，本文结论以 19:2x 的工作区状态为准。

---

## 一、结论先行

**工程质量：B+**（自研部分：25,026 行插件源码 + 6,624 行前端插件 + 4,142 行 Electron 外壳）。
在同龄人作品里属于**罕见**水平——路径守卫、签名协议、诚实降级、测试密度都不是摆样子。
但**达不到“可以放心交给学校生产使用”的 A**：有 3 处会**静默出错**或**静默泄露**的真缺陷。

| 维度 | 评价 |
|---|---|
| 架构与边界划分 | **A-**　插件–宿主契约清晰，用官方扩展点（ctx.tools.register / connection.fetch.register / ctx.web.registerSearchProvider），没有劫持私有 API 的野路子 |
| 安全设计意图 | **B+**　三层路径守卫、Ed25519 签名+指纹绑定、SQL 全参数绑定、零 eval；但意图在实现处有漏（见缺陷 3、5） |
| 正确性 | **B-**　公式引擎有**两处静默错值**（已复现），且会被写进交付文件 |
| 诚实性（不吹） | **A**　无 soffice 直接报错不伪造、未实现函数点名报 #NAME?、CI 文件里逐条写明“哪些测试装不上、为什么” |
| 测试 | **B**　55 个测试文件 / 13,981 行；主审独立复跑 **51/55 通过**；但存在“拿正则测正则”与“真的红着没人管” |
| 可维护性 | **C+**　重复实现多（isDescendant ×4、ZIP 解析 ×3、数据根解析 ×5）、lan-service.mjs 单文件 2,261 行、17 个 .probe-*.mjs 调试残留 |
| 仓库纪律 | **C**　9/8 之后**全部工作（216 项改动）未提交**；公开仓库里有本机 token 残留 |

---

## 二、主审亲自复现的缺陷（✅ = 我亲手跑出来的）

### 🔴 1. 下一次出包，PPT 工具族会在包里加载失败 ✅

- `plugins/mochi-presentations/index.mjs:23,463` 从 `@mochi/pdf-layout` 导入并使用 drawTextLine；
- 但 `apps/desktop/node_modules/@mochi/pdf-layout/index.mjs`（9/11 副本）**不含该导出**（grep 命中 0）；
- 打包依赖把它钉在 `apps/desktop/package.json:294` → `vendor/local-plugins/mochi-pdf-layout-0.1.0-a3f9ed33.tgz`（9/8 打的），该 tgz 内 index.mjs 同样**不含 drawTextLine**（命中 0）。

→ **实测**：`node scripts/test-package-resources.mjs` 现在直接报
`SyntaxError: The requested module '@mochi/pdf-layout' does not provide an export named 'drawTextLine'`。
即：**按现在的工作区重出包，mochi_ppt_create / ppt_inspect / mochi_ppt_render 全部不可用。**

> ⚠️ 更正：我在上一版评估里转述了项目自报的“26 插件暂存 PASS”。**这条自报与实测不符**，以实测为准。
> （可能是并行改动正在做的重构中间态；修法有二：重打并更新 tgz + 重算 CI 快照，或先回退该 import。）

### 🔴 2. 公式引擎两处静默错值（已复现，且会写进交付的 xlsx）✅

| 输入 | Mochi 内置引擎 | Excel 正确值 |
|---|---|---|
| =SUBSTITUTE("a-b-c","-","+",2) | **"b+c"** ❌ | "a-b+c" |
| =COUNTIF(B1:B3,"张*") | **0** ❌ | 2 |
| =SUMIF(B1:B3,"张*",C1:C3) | **0** ❌ | 30 |

- `formula.mjs:739-749`：带第 4 参时推进了 index 却没把跳过的原文写回 output；
- `formula.mjs:498-524`：matchCriteria 不认通配符 * 与 ?；
- 而 `index.mjs:113` 把 COUNTIF/SUMIF/AVERAGEIF 当作**已支持**函数告诉模型，**没有边界说明**；
- 叠加：没有 LibreOffice 的机器（= 任何老师的电脑）走的就是内置引擎，**错值会被当作缓存值写进 xlsx 交付**。
- 讽刺的是这套引擎的纪律原本是“绝不猜”（未实现函数点名报 #NAME?）——这两处是唯一破例的地方。

**对教学场景的具体风险**：老师问“统计一下张姓同学的成绩”→ 得到 0。这是会在答辩现场被一眼看穿的错。

### 🔴 3. LAN 私钥被送进浏览器 ✅

- `lan-service.mjs:1110` 往 outbox 行写 `sender: clone(local)`，而 `local = this.#identity(state)` = **含 privateKey 的完整身份**（:333、:1772）；
- `snapshot()` 对 outbox **不做投影**（:692 的 boundedRows 只是排序切片，源码已核）；
- 该快照经 `host-bridge.mjs:121` 的 `/api/mochi-lan/state` 直出浏览器，:2256 还把同一份塞进每条事件；
- 而同一个类的文档注释明写 *“its state intentionally omits private keys”* —— **意图与实现相反**。
- 顶层 identity 字段本身安全（:657 用了 identityProjection），**漏的是 outbox 里的 sender**；前端压根没用到该字段，属纯泄露。

→ 拿到它就能以教师端身份对已配对教室签名投递。攻击面限于本机已认证页面/XSS，但**一条支持日志或截图就会带出私钥**。

### 🟠 4. 收件箱满 1000 条后永久拒收 ✅

`lan-service.mjs:2197` 满则抛 MESSAGE_LIMIT 429；全文件 grep **没有任何删除 inbox 行的路径**（:1531/:1655 只清文件）。此后教室端再也收不到通知；而 dispatch 侧把 429 当 NOT_SENT 并给 retryTaskId → **重试必然再失败**。

### 🟠 5. 授权令牌不校验动作 ✅

`ensureAuthorization(value, action)`（:510-513）只查 WeakSet 成员，**action 参数从头到尾没被读过**。为 mark-seen 铸的令牌可直接用于 blockPeer / configureIdentity。实际可利用性低（令牌不落模型手里），但这是“参数被静默忽略”的典型设计缺陷。

### 🟠 6. 敏感记忆护栏可绕过 ⚠️

护栏只有 4 条关键词正则（`mem-store.mjs:71-76`）：密码/password/token/api_key/secret/密钥、身份证、成绩X(单|明细|排名)、病历|医疗|诊断。
→ “张三期中考试 92 分，全班第 3 名”“学生名单 王五 13800138000”“我的密 码是 abc123” 全部放行（子审计实测 12/12 漏网，主审已核对规则原文）。
更麻烦的是 world-state 的 append-todo 路径**连这层都没有**，而 `index.mjs:147` 会把 world-state 原样回灌模型。
**而单测样本恰好就是这些关键词本身** → 拿正则测正则，所以“全绿”。

### 🟠 7. 校园功能在打包版上是死的 ✅

`runtime-profile.json:4` 的 campusApiUrl 为 null → web-host.ts 不注入 MOCHI_CAMPUS_API_URL → 回退 `mochi-campus/connection.mjs:13` 的 http://127.0.0.1:8787（wrangler dev）。
新装的一台电脑上没有任何校园后端，界面文案会直接教用户“请确认 wrangler dev @8787 已启动”。
**PPT P4「谁在外面，谁没回来」正是靠这条链**——演示前必须在演示机上把校园地址配好并验证一次。

### 🟡 其余（证据充分但影响较小）

| # | 问题 | 证据 |
|---|---|---|
| 8 | 读路径有写副作用：load() 每次无条件原子写盘，而 context hook 每步模型调用都调 listTodos() | `world-state.mjs:90-97,176`；`active-context.mjs:99` |
| 9 | ZIP 解压未设 maxOutputLength（zip 炸弹） | `document-io.mjs:160`、`sheet-write.mjs:68` |
| 10 | 前端轮询/观察者不解绑：LAN 面板 3 秒轮询 3 个接口且组件常驻；jxl-theme 的 MutationObserver 无 disconnect | `client-plugins/mochi-lan/client.js:25,749`；`jxl-theme/client.js:26` |
| 11 | 硬编码绝对路径：构建脚本写死 /Users/a1379/Documents/Mochi/...；documents 测试写死本机 poppler 路径；soffice 默认 /opt/homebrew/bin | `jxl-theme/scripts/build-client.mjs:7,14`；`mochi-documents/test/exam-template.test.mjs:11` |
| 12 | 重复实现：isDescendant ×4、inImmediateTransaction ×4+、数据根解析 ×5、ZIP/OOXML 解析 ×3；lan-service.mjs 2,261 行单文件 | 子审计 文件:行号 |
| 13 | 文档声明与实现不符：`presentations/plugin.mjs:223` 声称 revise“其余页逐字节一致（jszip 重开核验）”，实际全库无此核验 | 子审计 |
| 14 | 仓库卫生：9/8 基线之后 **216 项改动未提交**；插件内 17 个 .probe-*.mjs 调试残留；WORKLOG.md 被跟踪且**公开仓库**版本里有本机 dev token | git status / git show HEAD:WORKLOG.md |

---

## 三、独立复跑的测试结果（主审亲跑，2026-09-12 19:1x）

全部 55 个插件/前端测试入口：**PASS=51  FAIL=4**

| 失败项 | 性质 |
|---|---|
| `plugins/mochi-hello/test.mjs` | 环境：该插件未装 @deepseek-ai/cordis（CI 同样排除） |
| `plugins/mochi-memory/test-active-context.mjs` | **真红**：断言 prompt 含 mochi.memory_note（点号），实现已按 9/12 的“工具名禁点号”事故改成 mochi_memory_note → **测试没跟上改名，一直红着没人发现**（因为不在 CI 里） |
| `plugins/mochi-memory/test-active-prompt-assembly.mjs` | 需 MOCHI_ACTIVE_PROMPT_CONSUMER 环境变量，缺失即抛错（未 skip） |
| `plugins/mochi-presentations/test-plugin.mjs` | 需 MOCHI_PRESENTATIONS_PLUGIN_URL，同上 |

apps/desktop 侧：test-installer-config / test-release-input / test-launch-role **PASS**；
test-package-resources **FAIL**（见缺陷 1）、test-runtime-profile **FAIL**（模型清单 deepStrictEqual 不符，与 9/12 手工给 mimo 加 inputModalities 有关）。

**测试质量的真实分布**：
- **真验证（多数）**：`mochi-lan/test.mjs` 两个独立进程 + 真 socket + 真重启，验伪造 endpoint / 错班 / ACK 丢失不重发；`document-io.test.mjs` 用 /usr/bin/unzip -t 外部复核产物；`formula.test.mjs:280` 故意写错缓存值 999、断言引擎算回 30（**反自欺设计**）。
- **自我循环（少数，但正中要害）**：敏感护栏的测试样本就是护栏正则自己的关键词；`test-host-bridge.mjs` 用假 lan 对象只验转发形状——**缺陷 3 正因此漏网**；前端测试用 vm 沙箱 + 假 React，清理函数与定时器不在被测范围——**缺陷 10 正因此漏网**。

---

## 四、真正值得肯定的地方（不是客套，都有证据）

1. **路径安全边界是三层真做**：逻辑层 path.resolve → realpath 层挡符号链接穿越 → 根目录层拒绝 / 与主目录，且**写后复检+回滚**（`mochi-files/paths.mjs:1-18`、`handlers.mjs:130`）。这是中学生项目里我唯一见到认真对待路径穿越的。
2. **签名协议不是装饰**：canonical JSON 规范化 + Ed25519，且**远端自述指纹必须等于公钥派生的指纹**（`lan-service.mjs:351`）——冒充在密钥层就不成立；收件时落接收方身份、回执前复核（:1019-1021）。
3. **诚实降级成体系**：没有 soffice 就报错不伪造（`documents/plugin.mjs:488`）；未实现的函数点名报 #NAME?；PDF 缺 ToUnicode 时明说 available:false 并给边界说明。
4. **CI 文件是“诚实文档”的范本**：`.github/workflows/mochi-ci.yml` 逐条列出“哪些测试装不上、为什么、不要随手加回来”。多数团队连自己 CI 没覆盖什么都不知道。
5. **攻击面确实窄**：全仓零 eval / new Function、零 shell:true；SQL 全部参数绑定（FTS 短语转义 + LIKE ESCAPE）；前端只有一处 innerHTML 且拼的是静态常量。

---

## 五、如果只修五件事

1. ~~修缺陷 1（重打 mochi-pdf-layout tgz 并重算 CI 快照）~~ —— ✅ **已修（2026-09-12 20:3x 复核）**：tgz 已重打为 `vendor/local-plugins/mochi-pdf-layout-0.1.0-c4a3d2c2.tgz`，`apps/desktop/package.json:294` 已换钉；`test-package-resources`（26/29/106）与 `test-runtime-profile` 复跑**均 PASS**。⚠️ **快照清单仍是 DRIFT**（2026-09-12 20:3x 实测：492 条、3 个文件不一致、字节差 +5,528）——**出 Windows 包前必须先 reconcile**。
2. **修缺陷 2**（SUBSTITUTE 第 4 参与 COUNTIF/SUMIF 通配符）——⚠️ **2026-09-12 20:3x 复现：仍是错的**（`=SUBSTITUTE("a-b-c","-","+",2)` → `b+c`；`=COUNTIF(B1:B3,"张*")` → `0`；`SUMIF` 同样 0）。**这一条是本轮唯一还没人动的硬缺陷。**
3. ~~修缺陷 3（outbox 存 identityProjection(local)）~~ —— ✅ **已修（2026-09-12 20:3x 复核）**：`lan-service.mjs:807/845/962/1039` 均已改为 `sender: identityProjection(local)`。⚠️ 仍建议补一条「快照里不得出现 privateKey」的反向断言测试，否则同类问题会再犯。
4. **修缺陷 4+5**（inbox 加淘汰或已读归档；ensureAuthorization 真的比对 action）——⚠️ **2026-09-12 20:3x 复核：仍未修**（`lan-service.mjs:2197` 的 `MESSAGE_LIMIT` 429 依旧，全文无删除 inbox 的路径；`ensureAuthorization` 仍只查 WeakSet、不比对 `action`）。
5. **把仓库状态收干净**：提交这 216 项改动（公开仓库那条 WORKLOG.md 里的 token 顺手轮换）、删 17 个 .probe-*.mjs。

---

---

## 六、补录（第二轮子审计回报，主审未复跑，仅登记证据）

| # | 问题 | 证据 | 为什么值得记 |
|---|---|---|---|
| 15 | 教材库检索**无 FTS**：全表 instr(search_text,?) + 长度差排序 | knowledge-store.mjs:443-453 | 同项目的 mem-store 用了 FTS5 trigram（:65,248-260）——**同一个仓库里两套检索差一个数量级**；33 册 4844 页量级下每次查询 O(全库文本） |
| 16 | **依赖 DSH 内部哈希类名做布局**：[class*="hHd-Xa_root"]、[class*="_root"] | jxl-campus/client.js:124-132、jxl-theme 桥 CSS | 注释自认锁定 dsh-v0.1.3-alpha.1——宿主一升级就**静默错版**（不报错，只是样式崩） |
| 17 | **跨插件硬依赖无声明无降级**：require("jxl-brand") | jxl-campus/client.js:9,390；package.json 无该依赖 | 加载顺序无保证，jxl-brand 缺席时校园插件工厂直接抛错 |
| 18 | world-state.md 的 ≤200 行上限**只对 appendChange 生效** | world-state.mjs:142-154 vs :164,170,203 | 其余三条写入路径无上限 → 文件可无界增长，且每次全量读写（叠加缺陷 8） |
| 19 | 死数据：mochi_schedules.time_zone 列写了不用 | task-scheduler/store.mjs:27 vs index.mjs:112 | 看似支持逐条时区，实际永远走硬编码默认值——**这种「看起来支持」最容易被答辩问到** |
| 20 | 端口不一致：workbench 写死 127.0.0.1:18100，office 容器绑 18080 | client-plugins/mochi-workbench/client.js:8 | 因 mochi-office 不进包，影响有限，但属清单不一致 |

补充：前端测试用 vm 沙箱 + 假 React，且测试文件自己注明「直接调用组件、不做 reconciliation」（mochi-workbench/test/client.test.mjs:17-52）——**缺陷 10（轮询/观察者不解绑）恰好长在这个盲区里**。
---

## 七、补录（文档工具链子审计第二轮，主审已核对关键项）

| # | 问题 | 证据 | 状态 |
|---|---|---|---|
| 21 | **课件输出目录无允许根校验**：只查「绝对路径 + 不存在」，不校验落在受管工作区内 | `presentations/plugin.mjs:61-77` vs 对照组 `documents/plugin.mjs:108-128`（强制落在 workspaceRoot + realpath + ordinaryDirectory） | ✅ 已核对：两套插件对同一件事的标准不一致，presentations 更松 |
| 22 | **「源文件原样保留」与实现不符**：实际是 ExcelJS 整簿重序列化，图表/图片/透视表静默丢失 | `sheets/tools.mjs:440-450`（注释）vs `:441-450`（代码）；同文件 `:262` 却写「丢失的内容：无：.xlsx 另存是逐字节复制」 | ✅ 已核对：**「逐字节复制」是错的**，属对用户的失实承诺 |
| 23 | sheets 的允许根全不可用时**静默回退 process.cwd()** | `mochi-sheets/paths.mjs:110-114`；对照 `mochi-files/paths.mjs:258-261` 同情形直接拒绝 | ✅ 已核对：两个文件工具族安全标准不一致 |
| 24 | 渲染超时只 kill 直接子进程（未 detached/进程组）→ 残留 soffice.bin 孤儿 | `presentations/render.mjs:156,160`；对照 `documents/index.mjs:914` 用进程组 kill（正确） | ✅ 已核对 |
| 25 | `render.mjs:85` 的 `<dir>` 未转义（同项目 `index.mjs:991` 做了转义） | 子审计 | ⚠️ 未复跑 |
| 26 | 自校验与实现共用同一解析器：`verifyEditedDocx:791` 用同一解析器回读，畸形 XML 仍判 passed | `document-io.mjs:592-597,791` | ⚠️ 未复跑（与缺陷 9 同源） |

**测试缺口（文档工具链）**：无畸形/截断 ZIP、ZIP64、加密归档、zip 炸弹用例；SUBSTITUTE 四参与 COUNTIF 通配符**零覆盖**（`formula.test.mjs:84` 只有三参）；soffice 缺失分支靠 `t.skip` 跳过；`verify-cjk.mjs` / `test-plugin.mjs` 不在 `npm test` 范围内——**中文渲染回归无人看守**。

### ⚠️ 对子审计第 7 条的反驳（主审已复核，不成立）

子审计称「`mochi-sheets/package.json` 的 files 漏 `address.mjs` 与 `recalc.mjs` → 按 files 打包即加载失败」。
**实测不成立**：实际打包走的是白名单 `apps/desktop/scripts/prepare-mochi-resources.cjs:106-118`，该条目**已完整包含** `address.mjs` 与 `recalc.mjs`；且 `vendor/local-plugins/` 里没有 sheets 的 tgz，不存在按 `package.json` 打包的路径。
→ 降级为**潜在不一致**（若将来改为 tgz 分发才会触发），不是当前缺陷。
*本报告为只读取证与独立复跑所得，未修改任何源码、配置或既有文档。缺陷 1–5、7 由主审亲手复现；缺陷 6、8–14 来自三路并行子审计，均附 文件:行号 证据，未逐条复跑。*

---

## 八、收口状态（2026-09-12 21:1x 复核 · 缺陷修复轮）

> 本节由修复轮追加。**上面正文保持取证当时的样子不改写**，只在这里记"现在修到哪一步"。

| 缺陷 | 状态 | 证据 / 处置 |
|---|---|---|
| 1 出包链断（pdf-layout 缺 drawTextLine） | ✅ 已修 | tgz 重打为 `c4a3d2c2`；`test-package-resources` PASS（26/29/106） |
| 2 公式引擎两处静默错值 | ✅ **已修** | `formula.mjs`：SUBSTITUTE 第 4 参写回前 N-1 次命中的原文；`matchCriteria` 新增 `*` `?` `~` 通配符。新增**零依赖**回归测试 `plugins/mochi-sheets/test/formula-engine.test.mjs`，并列入 CI |
| 3 LAN 私钥进浏览器 | ✅ 已修（**且比原报告更严重**） | 追加发现：除 outbox 外，sendMessage 路径 `lan-service.mjs` 的 `state.outbox[...].sender` 与 `state.outgoingFiles[...].sender` **仍在存 `clone(local)`**，实测 `snapshot()` 里真的出现 `privateKey`。两处均已改为 `identityProjection(local)`；由 `test-limits.mjs` 第④项永久看守（断言快照里不得出现 `privateKey`） |
| 4 收件箱满仓永久拒收 | ✅ 已修 | 满仓时回收**最旧的、已确认看到的**收件；一条已读都没有时才 `MESSAGE_LIMIT`（未读永不静默丢弃）。新增测试旋钮 `testMaxMessages` + 回归测试 |
| 5 授权令牌不校验动作 | ✅ 已修 | `ensureAuthorization(value, action, label)` 真的比对动作；令牌一次性且绑定动作；新错误码 `LOCAL_APPROVAL_SCOPE_MISMATCH`。`test-files.mjs` 里装饰性的 action 标签同步改成规范动作 id |
| 6 敏感记忆护栏可绕过 | ⏳ 未动 | 属"设计取舍 + 需要产品决策"，不是笔误；边界已在 `参赛材料/伦理与社会影响.md` 里如实写明 |
| 7 打包版校园功能指向 127.0.0.1:8787 | ⏳ 未动 | `runtime-profile.json` 的 `campusApiUrl` 仍为 `null`。这是**产品决策**（连已部署的 `jyl-campus-health-entry.pages.dev` 还是保持本机），需要作者拍板，见 `docs/DELIVERY-LEDGER.md` 开放决策 |
| 8–13、15–26 其余条目 | ⏳ 未动 | 保持原状；属可接受技术债或未复跑项 |
| 14 仓库卫生 | 🟡 部分处理 | `WORKLOG.md` 里 14 处明文开发令牌已脱敏为 `<已脱敏-本机开发令牌>`；**git 历史里仍存在**，需要轮换那些 dev token。212 项未提交改动仍未提交（需作者决定是否入库/推送） |
