# mochi-modeling · Mochi 教学建模工作空间

**是什么**：把「能运行、能拖动、能核对、能保存」的交互数学模型交付成一
个自包含 HTML 页面。首样为「椭圆切线交互模型」（conic-tangent）：可拖切
点、切线/焦点/辅助线、参数滑块改 a/b、结论分步揭示、课堂大字号模式、
假设显式区，页面显著标注「拖动观察只能支持猜想，证明需要推导」。

**红线实现**：计算与画面同一份状态——`conic.mjs` 是唯一公式来源（纯
ESM 零依赖），`index.mjs` 生成 model.html 时把它**原样内嵌**为页面模块，
`verify.mjs` 在 node 里 import 同一文件；HTML 零 http(s) 外链；页面全部
交互本地计算，无任何网络请求。

**怎么跑**

```bash
node verify.mjs   # node 数值验证（不开浏览器）：斜率对解析解 1e-9，边界全拒绝
node test.mjs     # 单测：注册/三件套/零外链/model.json schema/解析解/render 双参
```

工具 `mochi.model_create`（参数 `type='conic-tangent'`、`a`、`b`、
`outputDirectory`）在输出目录生成：

- `model.html` —— 自包含交互页（浏览器直接打开即可）
- `model.json` —— 模型说明：类型/参数/公式/假设/版本 v1/生成时间/验证摘要
- `assets/jsxgraphcore.js`、`assets/jsxgraph.css` —— 渲染引擎本地副本

**JSXGraph vendor 来源 / 版本 / 许可证**

- 版本：**1.13.3**（撰写时 GitHub jsxgraph/jsxgraph 最新稳定 release，
  tag `v1.13.3`，commit `7c2176d479ae256cb9d38265bce81fa18709d01f`）
- 来源：npm 包 `jsxgraph@1.13.3` 的 `distrib/jsxgraphcore.js`（经
  unpkg.com 取得；jsdelivr 网络不稳，两者为同一 dist 产物），许可证文本
  从 GitHub tag v1.13.3 取 `LICENSE.LGPL` / `LICENSE.MIT` 存于 `assets/`
- 许可证：**GNU LGPL 与 MIT 双许可（二选一）**——已在下载文件头与
  model.json 里实测记录（文件头 "dual licensed under the GNU LGPL or
  MIT License"，仓库根有 LICENSE.LGPL 与 LICENSE.MIT 两份文本）

**目录**：`conic.mjs`（计算核心）/ `index.mjs`（插件入口，dsh 工具
`mochi.model_create`）/ `verify.mjs`（数值验证）/ `test.mjs`（单测）/
`assets/`（vendor 副本与许可文本）。依赖以 node_modules 符号链接指向
mochi-campus 的 pnpm store（`.nosync` 副本同），不重复安装。
