# 安装慢的真因与取证方法（安装包文件数）

**status: 生效中 ｜ last_verified: 2026-09-12 ｜ verified_by: 工具线（本机取证 + 契约测试）**

> 适用范围：任何会改变安装包**文件数量**的改动。
> 相关文档：`docs/build-standard.md`（出包唯一路径）、`docs/DELIVERY-LEDGER.md`（交付台账）。

---

## 0. 一句话

**老师那边慢的不是下载，是安装向导本身。根因是安装要往磁盘上新建 41,150 个文件**，
Windows Defender 实时防护逐个扫描新建文件，累计十几分钟。**砍体积不解决问题，砍文件数才解决。**

---

## 1. 症状与纠正过程

用户原话分两次，第二次才是真的：

1. 第一次说「安装包的下载速度在一体机上很快，但在老师的电脑上就会很慢，甚至高达 15 分钟」
   —— 据此我先去查分发通道（GitHub Actions 产物 / 局域网 / 微信）。
2. 用户随后明确纠正：**「安装到电脑上，点击安装向导之后，它会更新得很慢很慢」**
   —— 是**安装阶段**，不是传输阶段。

> ⚠️ 教训：**「慢」必须问清是下载慢、解压慢、还是装完启动慢。**
> 这三者的修法完全不同，猜错一次就是白做一轮。

---

## 2. 取证方法（本机可复现，不需要 Windows）

出包机上就能把安装包"称重"，不需要装 Windows 也不需要解包两次。
`7za` 是 electron-builder 的依赖，仓库里自带：

```bash
cd /Users/a1379/Documents/Mochi
SZ=apps/desktop/node_modules/7zip-bin/mac/arm64/7za
EXE=release/2026-09-10/Mochi-Setup-0.1.0-win-x64.exe

# ① 直接列出内层 app 树（41,150 个文件，不必先解包）
"$SZ" l "$EXE" > /tmp/win-listing.txt
wc -l /tmp/win-listing.txt

# ② 真解一次，计时（这一步最接近安装向导在做的事）
/usr/bin/time -p "$SZ" x "$EXE" -o/tmp/winx -y
find /tmp/winx -type f | wc -l
```

第 ② 步的输出里，`real` 就是「纯解压 + 写盘」的下限时间。
**本机（M 系列芯片）实测：41,150 个文件 / 1.79 GB → `real 28.5` 秒。**
老师的笔记本 CPU 弱得多，而且多了 Defender 逐个扫描这一项，才会到十几分钟。

---

## 3. 实测体积与文件数构成（2026-09-10 那个包）

解包后 1,706.7 MB / **41,150 个文件**；7z 压缩后 484.1 MB。

| 路径 | 原始 | 压缩后 | 占比 |
|---|---|---|---|
| `resources/app.asar.unpacked/node_modules` | 597.9 MB | 144.3 MB | 29.8% |
| `resources/mochi/playwright` | 549.4 MB | 177.0 MB | 36.6% |
| `Mochi.exe`（Electron 本体） | 201.2 MB | 59.3 MB | 12.2% |
| `resources/mochi/node_modules` | 153.0 MB | 36.0 MB | 7.4% |
| `resources/mochi/campus.nosync` | 26.8 MB | 25.4 MB | 5.2% |
| `resources/mochi/plugins` | 45.0 MB | 10.0 MB | 2.1% |
| 其余（dll / pak / icudtl / locales…） | ~133 MB | ~25 MB | — |

**文件数**：`app.asar.unpacked/node_modules` 34,503 个（84%）、`resources/mochi/node_modules` 6,046 个、
其余 ~600 个。

### 3.1 哪些文件运行时根本不会被加载

| 规则 | 文件数 | 原始 | 压缩后 |
|---|---|---|---|
| `*.map` 源码映射 | 7,980 | 220.9 MB | 38.7 MB |
| `*.d.ts` | 1,445 | 8.7 MB | 1.8 MB |
| `*.d.mts` | 3,034 | 4.4 MB | 1.1 MB |
| `*.d.cts` | 316 | 1.6 MB | 0.3 MB |
| **合计** | **12,775** | **235.5 MB** | **41.9 MB** |

占全包文件数的 **31.0%**。另有 `plugins/dsh-better-sidebar/lib/*.map` 6 个（30.9 MB 原始 / 6.9 MB 压缩）。

### 3.2 量完之后**决定不动**的（写下来免得下次又想去动）

- **`test`/`demo`/`docs` 目录**：全包合计才 ~900 个文件，而且很多根本不是测试目录
  （是 `zod/src/v4/classic/tests`、`undici/test` 这种库自己的结构目录）。
  为 900 个文件去冒「误伤某个库运行时代码」的风险不划算。**这是量出来的，不是拍脑袋。**
- **`LICENSE` / `NOTICE`**：合规文件，一个都不许排除。
- **`resources/mochi/playwright/chromium-1187`（可见浏览器，110 MB 压缩）**：
  用户明确要求保留（"先别动，我担心以后要用"）。已实测确认 `headless: true`（默认）
  不会用到它，只有显式 `headless: false` 才会 —— 需要时这是**下一个可以砍的大项**，
  但需要用户点头，且要同步改 CI 的准备步骤与元数据校验。

---

## 4. 修复：打包时按规则排除

**核心纪律：只在打包时过滤，磁盘上一个文件都不删。** 开发机上 `node_modules`、插件源码原封不动。

规则只有一个正则，写在 `apps/desktop/scripts/prepare-mochi-resources.cjs`：

```js
const PACKAGED_RUNTIME_PAYLOAD_EXCLUDED_FILE = /(?:\.map|\.d\.ts|\.d\.mts|\.d\.cts)$/i;
```

它覆盖**三条**打包路径（少覆盖一条，那棵树就会原样进包）：

| 路径 | 谁在管 |
|---|---|
| `resources/mochi/node_modules` | 本脚本里 `packagedRuntimePayloadFilter()` |
| 插件的整目录拷贝（`PLUGINS[].directories`） | 同上 |
| `app.asar.unpacked/node_modules` | `apps/desktop/package.json` 的 `build.files` 负向模式 |

`package.json` 里那四条：

```json
"files": [
  "dist-electron/**/*",
  "package.json",
  "!node_modules/**/*.map",
  "!node_modules/**/*.d.ts",
  "!node_modules/**/*.d.mts",
  "!node_modules/**/*.d.cts"
]
```

### 4.1 为什么 `build.files` 的负向模式真的生效（查过源码，不是推测）

`app-builder-lib` 有两条**完全不同**的匹配路径，用错就会得出错误结论：

- `getMainFileMatchers()` 给主匹配器追加 `!**/node_modules` —— 它**不负责 node_modules 内部**。
  实测：它的 filter 对 `node_modules/**` 下**所有**文件一律返回 `false`，**不能用它验证**。
- `getNodeModuleFileMatcher()`（`platformPackager.js:302` 调用）才是决定 node_modules 收哪些文件的：
  它**只**抽取 `config.files` 里以 `!` 开头的模式，然后自动 `prependPattern("**/*")`。
  `appFileCopier.js` 的注释把意图写得很直白：
  > `// use main matcher patterns ... so user can exclude some files !node_modules/xxxx`

所以正确写法就是「**只写排除，不用重述包含**」。
契约测试里用的就是这个 matcher，见 §5。

另：`d.ts` 本来就在 electron-builder 的默认排除扩展名里（`fileMatcher.js` 的 `excludedExts`）。
所以 `app.asar.unpacked` 那棵树里的 `.d.ts` 一直是 0 个；那 1,445 个 `.d.ts`
**全在 `resources/mochi/node_modules`** —— 那是我们自己的复制脚本，改动前一个过滤都没做。

---

## 5. 验证（三条，缺一不可）

### 5.1 排除规则真的作用在 electron-builder 的判定链路上

`apps/desktop/scripts/test-installer-config.mjs` 里用**真实**的
`getNodeModuleFileMatcher(appDir, destination, macroExpander, build.win, {config: build, ...})`
搭出 matcher，逐文件断言：

- 必须**保留**：`*.js` / `*.mjs` / `*.json` / `*.node` / `*.exe` / `*.bcmap` / `LICENSE` / `NOTICE`
- 必须**排除**：`*.map` / `*.d.ts` / `*.d.mts` / `*.d.cts`

同时断言 `build.files` 里那四条负向模式**一条不少**（防静默回归），
并断言 `package.json` 的 glob 与 `prepare-mochi-resources.cjs` 的正则
**覆盖同一组扩展名**（两边不许漂移）。

### 5.2 负向对照（项目规矩：新断言必须证明它真的会失败）

```
去掉负向模式（对照）      mermaid.js=false  mermaid.js.map=false   ← matcher 为空，生产走 filter=null（旧行为）
当前配置                  mermaid.js=true   mermaid.js.map=false   ← 正面文件保留，.map 被剔除 ✓
```

> 顺带确认了生产语义：matcher 为空时 `NodeModuleCopyHelper` 用 `filter = null`，
> 即**完全不过滤**。所以「哪天有人删掉这四条，包会静默涨回 4 万个文件，且不报任何错」
> —— 这就是 5.1 里那条 `deepEqual` 守卫存在的理由。

### 5.3 本机真跑一遍打包资源生成

```bash
cd apps/desktop
mv .mochi-package-resources-v1.nosync/playwright /tmp/mochi-pw-hold
MOCHI_PLAYWRIGHT_BROWSER_RESOURCE_ROOT=/tmp/mochi-pw-hold \
  node scripts/prepare-mochi-resources.cjs
find .mochi-package-resources-v1.nosync -path '*/playwright' -prune -o -type f -print | wc -l
```

实测结果：

| | 改造前 | 改造后 |
|---|---|---|
| `node_modules` 文件数 | 6,033 | **3,662** |
| `node_modules` 体积 | 158 MB | **111 MB** |
| 整棵暂存树（不含 playwright） | ~6,100 | **3,946** |
| 其中排除类文件残留 | 2,371 | **0** |

脚本自己会回读校验：`assertNoExcludedRuntimePayloadFiles(working)` 扫**整棵暂存树**
（不只 node_modules），发现残留就抛错 —— 因为「规则写了但没生效」是不报错的静默失败。

### 5.4 CI 快照必须一起收敛

改了 `apps/desktop/package.json`、`prepare-mochi-resources.cjs`、`test-installer-config.mjs`
三个快照内文件，必须重算：

```bash
node scripts/reconcile-snapshot-manifest.mjs --write
node scripts/check-snapshot-manifest.mjs --fail     # 必须 OK / 字节差 ±0
```

本次基线：**492 条 / 91,919,236 B / 0 漂移**。

> ⚠️ 复验口径：**必须看 `check-snapshot-manifest.mjs --fail` 的实时输出**。
> 本文档 2026-09-12 白天写的 `91,913,750` 是当时的中间态（当天又有一轮快照收敛），
> 夜里复验为 `91,919,236`。**永远以脚本输出为准，不要照抄文档里的数字。**

---

## 6. 预期效果

| 指标 | 改造前 | 改造后 | 变化 |
|---|---|---|---|
| 安装包文件数 | 41,150 | **28,375** | **−31.0%** |
| 压缩后体积 | 484.1 MB | ~442 MB | −41.9 MB |
| 本机纯解压时间 | 28.5 s | 待重出包实测 | — |

**诚实说明：这一步把十几分钟压到十分钟左右，不会一键解决。**

### 6.1 改造后本机真实产物实测（2026-09-12，`--dir` 全量构建）

改完规则之后**真出一次包**称重，而不是继续推算。本机 macOS/arm64：
`node scripts/package-desktop.cjs --target mac --arch arm64 --dir --release-input-root .mochi-release-staging.nosync`
（整轮 39 秒，含 `tsc` + `@electron/rebuild`）。

| 组件 | 改造前 | 改造后 | 变化 |
|---|---|---|---|
| `app.asar.unpacked` 文件数 | 34,338 | **23,940** | −10,398（−30.3%） |
| `app.asar.unpacked` 体积 | 649 MB | **513 MB** | −136 MB |
| `Resources/mochi`（运行时载荷） | ~6,100 | **3,946** | −2,371（文件数） |
| `Resources/mochi/playwright` | 874 | 874 | 不变（受哈希审计，不能动） |
| **`Mochi.app` 合计** | — | **29,018 / 2.0 GB** | — |
| 排除类文件残留（`*.map`/`*.d.*`） | 2,371 | **0** | ✔ 全包零残留 |

**两条独立取数互相印证**：改造前把排除规则**离线套用在真实产物的 34,338 条清单**上，
算出 23,940；随后真出包，`app.asar.unpacked` 实测**正好 23,940**。
静态推演与 electron-builder 的实际行为完全一致 —— 这才叫"规则真的生效了"，不是"规则写了"。

> 全包零残留是用 `find Mochi.app -type f | grep -cE '\.map$|\.d\.ts$|\.d\.mts$|\.d\.cts$'` 数的，
> 不是只看 `node_modules` 那一层。

### 6.2 剩下 82.5% 为什么**不能**靠改配置砍掉

改造后 `Mochi.app` 里 **23,940 / 29,018 = 82.5%** 的文件仍是 `app.asar.unpacked`。
前排全是纯 JS 库：`es-toolkit` 2,109、`rxjs` 1,022、`openai` 848、`d3` 786、`typebox` 684、
`lodash-es` 646、`zod` 581…… 看着像"随手就能塞回 asar"，实际不行，三条独立原因：

1. **Harness 是子进程，而且需要真实的模块解析根。**
   `electron/dsh/web-host.ts` 把 `app.asar.unpacked/node_modules/@deepseek-ai/dsh/lib/bin.js`
   作为**子进程**拉起，并把 `NODE_PATH` 指向 `app.asar.unpacked/node_modules`。
2. **dsh 的 profile 依赖回退用的是真实文件系统链接。**
   `web-host.ts` 的注释原话：解析到 `app.asar` 内部会让那些链接指向虚拟归档 ——
   `app.asar` 在操作系统层面是一个**文件**，不是目录，符号链接指向它内部**不可穿越**。
   这是 OS 层行为，Node 再怎么 patch `fs` 也救不了。
3. **ESM 不认 `NODE_PATH`。** 实测确认 Electron 以 Node 模式运行**能**读 asar 内部
   （`fs.readFileSync('<...>/app.asar/package.json')` 成功），所以"asar 不可读"不是原因；
   但插件是 `.mjs`，裸标识符解析只沿**真实路径**向上找 `node_modules`，永远进不了 asar。

**结论：要砍这 82.5%，得改运行时的依赖布局（把 Harness 闭包搬成真实文件、
或把它 bundle 成少数几个文件），属于独立工程，不是 `package.json` 改一行。**
`electron-builder` 的 `asarUnpack` 断言、`test-web-host-runtime.mjs` 都跟着这条布局走，
动它是**契约级改动**，且**必须在真 Windows 上装一次**才算验证 —— 因为
`asar` 与符号链接在 Windows 上的行为与 macOS 不同。

**另一条线（不属于代码）**：装机时数字签名 / 目录白名单能显著减少 Defender 的扫描开销，
但这需要证书与 IT 配合，不是我们能在安装包里解决的。

---

## 7. 下次改动怎么复现这套结论

```bash
# 1) 出包后立刻称重（本机）
SZ=apps/desktop/node_modules/7zip-bin/mac/arm64/7za
"$7za" l release/<date>/Mochi-Setup-0.1.0-win-x64.exe > /tmp/win-listing.txt
#    然后按 §2 的解析方式统计"文件数 / 各目录体积 / 排除类残留"

# 2) 三个必须绿的测试
cd apps/desktop && node scripts/test-installer-config.mjs && node scripts/test-package-resources.mjs
cd ../.. && node scripts/check-snapshot-manifest.mjs --fail
```

**判定标准**：文件数应显著低于 41,150；`*.map` / `*.d.ts` / `*.d.mts` / `*.d.cts` 残留应为 0。

---

## 8. Playwright 资源根的许可文件：本机与 CI 不一致（2026-09-12 查清）

`prepare-mochi-resources.cjs` 会校验资源根里的 `LICENSE` / `credits.html` / `credits.txt`
三个文件的 sha256 与 `metadata.json` 是否自洽。**校验的是"自洽"，不是"内容对不对"** ——
所以内容错了不会有任何报错。查下来确实错了。

### 8.1 事实（用 sha256 逐字节确证，不是推测）

| 本机资源根的文件 | 实为 |
|---|---|
| `LICENSE`（11,601 B） | `node_modules/playwright-core/LICENSE` 的逐字节拷贝 |
| `credits.txt`（70,260 B） | `node_modules/playwright-core/ThirdPartyNotices.txt` 的逐字节拷贝 |
| `credits.html`（72,062 B） | 上面那份套了个 `<title>Chromium credits</title>` 外壳 |

而 **CI 在同一槽位放的是别的东西**（`windows-native-package.yml`）：
`LICENSE` ← `.github/windows-native-package-assets/chromium-140.0.7339.16-LICENSE`（1,536 B）；
`credits.*` ← 在 runner 上 `chrome --headless=new --dump-dom chrome://credits` 现取。

**即有 3 处不一致**，其中 `credits.*` 是**贴错标签**：文件说自己是 Chromium 的归属清单，
内容是 Playwright 的。

### 8.2 本机为什么生不成真的 `chrome://credits`

已实测（`tools/fetch-chromium-credits.mjs`）：Chromium **能**启动、CDP **能**连上，
但 `Page.navigate('chrome://credits')` 之后 `Runtime.evaluate` 取回的文档**长度为 0**。
同一个坑还有第二种触发方式：命令行 `--dump-dom chrome://credits` 在 Chromium 140/macOS 上
会**静默地 dump 新标签页**（26 KB、标题「新标签页」、`Copyright` 零命中）。

> 🐛 **顺手修掉的一个真 bug**：这个脚本原来 `socket.onopen` 那一步**没有超时**，
> 连不上就永久挂住、看起来像"还在跑"。已加总看门狗（`--watchdog`，默认 120s）+ 每步超时，
> 现在会在 29 秒内**明确失败**而不是挂着。脚本**拒绝写占位内容**（阈值：≥200,000 字符且 ≥100 处
> `Copyright`）—— 许可清单造假比缺文件更糟。

### 8.3 已做的处置

1. **本机资源根按「与 CI 产出形态一致」对齐**：`LICENSE` 换成 Chromium 那份；
   `credits.txt` **逐字节保留**微软的真实声明（不动一个字）；
   `credits.html` 只把标题改成 `Playwright third-party notices`，并在文件头写明
   **它不是 `chrome://credits`、由 CI 现取覆盖**；`metadata.json` 重算哈希并新增
   `creditsProvenance` 字段如实记录来源。
2. **加固了 CI 的校验**（这是本次发现里最有价值的一条）：原来只断言
   `$creditsHtml -notmatch "<html"`。**新标签页同样含 `<html`，所以这条校验抓不住"导错了页"** ——
   会把一份假许可清单静默打进安装包。已改为同时卡**体量 ≥200,000 字符**与
   **`Copyright` 指纹**，并在报错信息里直接点明「约 26 KB 且零命中 = dump 到了新标签页」。

> ⚠️ `windows-native-package.yml` 是**复制到私有构建分支**使用的模板。
> 这个加固**要跟着复制过去**才生效，只改本机仓库不够。

### 8.4 要本机生成真的 credits（在**你自己的终端**里跑）

Chromium 在受限沙箱里起不来，但在有 WindowServer 的普通终端里可以：

```bash
cd /Users/a1379/Documents/Mochi
mv apps/desktop/.mochi-package-resources-v1.nosync/playwright /tmp/mochi-pw-hold
node tools/fetch-chromium-credits.mjs \
  --chrome /tmp/mochi-pw-hold/browsers/chromium-1187/chrome-mac/Chromium.app/Contents/MacOS/Chromium \
  --out /tmp/mochi-pw-hold
# 然后重算 metadata.json 的两个 credits 哈希（LICENSE 不用动），再：
MOCHI_PLAYWRIGHT_BROWSER_RESOURCE_ROOT=/tmp/mochi-pw-hold \
  node apps/desktop/scripts/prepare-mochi-resources.cjs
```
