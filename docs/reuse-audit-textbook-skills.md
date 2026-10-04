# 教材转检索 Skill 的开源复用核查（2026-10-01）

实施前先检索完整应用／框架生态，再核具体 book-to-skill。实际搜索词：`github Skill_Seekers documentation PDF skill framework`、`github virgiliojr94/book-to-skill`、`github zhimaAi BookToSkill`。三仓 GitHub API 的 commit／tree／license 元数据已取得。Python urllib 连线失败、后续 contents API 返回 rate-limit，raw 部分文件超时；不将这些写成不存在方案。固定仓归档改经 GitHub codeload 获取，只读审源码，不安装第三方包或下载教材。

| 方案 | 固定提交／时间／许可 | 核到的实际能力与取舍 |
| --- | --- | --- |
| [Skill_Seekers](https://github.com/yusufkaraaslan/Skill_Seekers/tree/5b5d8dfca263fa76e6daae9f292890b311ef36aa) | `5b5d8dfca263fa76e6daae9f292890b311ef36aa`，2026-09-30，MIT，未归档 | 完整文档／PDF／仓库转换框架；pyproject 核到 requests、PyGithub、GitPython、Anthropic、PyMuPDF、LangChain、LlamaIndex 等核心依赖。当前 Mochi 已有页库与工具桥，全栈接入将重复存储与处理，不采用运行时。没有宣称已测 PDF 转换效果。 |
| [virgiliojr94/book-to-skill](https://github.com/virgiliojr94/book-to-skill/tree/c108d25b0cb58e1bdc361f3de02ed9f37075152f) | `c108d25b0cb58e1bdc361f3de02ed9f37075152f`，2026-09-29，v1.4.0，MIT，未归档 | Python ≥3.9，基础无额外依赖；真实 CLI `book_to_skill.cli:main` 纯提取，TXT／MD 走 stdlib。CLI 产生 full_text／metadata／source SHA；章节方法论由 SKILL.md 的宿主模型工作流另行提炼，CLI 本身没有 LLM。采用固定纯提取 Python 闭包、明确关闭安装，生成“教材检索 Skill”，不是自动精读 Skill。 |
| [zhimaAi/BookToSkill](https://github.com/zhimaAi/BookToSkill/tree/b8499c103588e303eaa23c238fbe13ae632c1ff4) | `b8499c103588e303eaa23c238fbe13ae632c1ff4`，2026-08-10，Apache-2.0，未归档 | 实际 search_index.py 是 stdlib 词法检索：中文 2/3 字片段、多字段权重、最多 5 条、每次读取完整 JSONL。转换逐块让宿主模型选证据；merge 从原块恢复正文，不接受模型自写正文；build 带 Markdown／资产／检索脚本成 ZIP。更新复用原 Markdown，但会重建完整索引。没有原生 SQLite 适配；本次不采用第二套逐块建库。 |

推荐实际采用 virgilio 的固定纯提取代码，把现有 SQLite 原页导出的 Markdown 交给真实 CLI，生成单一 router 和每册按需引用目录。页码、bookId、来源 commit／SHA 与 OCR 标记从现页库搬运，不交给模型猜测；原 PDF 不复制。后续用户明确需要某主题方法论时，才按命中页进行有限的语义提炼并记录已处理范围。不能把提取／检索仓称为已完成全书框架提炼。

已确认本地 `knowledge-store.mjs` 的两表为 textbook_books／textbook_pages，保存 display_text、search_text、PDF页、printed_page、text_status 与原页核对标志；现检索用 SQL instr 精确文本命中，不是 FTS5。模型已有 search／page／page_image 受管桥。只读核教师当前数据库得到 **0 本、0 页**；33 本／4,844 页是此前目标／历史快照，根任务正在恢复，不据此声称当前已导入。

重要源码边界：virgilio 的 sanitize 会移除 U+2061 函数应用、U+2062 隐形乘号等码点。其输出只作为检索派生文本，原页文本保持原样保存在 references，公式／图表仍指向受管原 PDF。没有重跑 OCR，不将扫描空页制造为正文。上游 `detect_structure` 只给章节数量／少量标题样本，不是可靠教材目录，不伪造章节树。

实施计划已由根任务授权：脚本只读一册的页流，实际调用上游 CLI；生成 root 唯一 Skill，books 子目录只供引用；可按 bookId 与现受管工具互通。保留 MIT、固定 commit、每个 vendored 文件 SHA256。不开网络模型、不调用 PDF parser、不安装依赖。仓库更新保持受管目录边界，升级须重新核提取字符清理与闭包。源码检查不等于实际跨平台验证。

## 实际实施与验证

`scripts/build-textbook-skills.mjs` 只读 SQLite，逐册逐页导出受管 Markdown，使用固定上游真实 `scripts/extract.py --mode text --install-missing no`。保留 20 个原样上游文件，约 138 KB Python import 闭包，包括 MIT 及 `tools/scan_generated_skill.py`；每次构建校验 UPSTREAM.json 的文件 SHA。其它格式 parser 仅为原 CLI 的 import 闭包，不作为本次转换入口。保留原始页资料与清理后的 `.search.txt`，没有整书模型处理。

输出 custom 根的第一层只有 `router/SKILL.md` 可发现，各册在 `router/references/books/<bookId>/SKILL.md`。Mochi 内优先走现 search／page 工具，无需读取整册 catalog；无桥接时先用 rg 有限检索小书目 TSV，再至多三页本地命中。每册 `book.json` 是不含页正文的简短元数据，完整 catalog 仅用于审计。没有全体 description 注入。真实 router 为 **998 B**，33 册 portable 书目 TSV 为 **9,218 B**，不会将书目强制注入。

上游 Skill 的 Full Conversion 还包含成本确认和模型语义提炼；本次是用户明确授权的**纯提取与检索布局部分复用**，不执行 Full Conversion，不把原文页称作生成的章节摘要。scanner 真实检查每册生成 SKILL.md 和唯一 router，原始 `references/` 明确不在扫描范围；scanner 的提示及状态存入 instruction-scan.json，不静默修改来源正文，不将 instruction scan 通过宣传为教材安全认证。

合成 SQLite 的 **4 项构建测试**及既有 mochi-knowledge 测试合计 **12 项通过**：真实 CLI 清理器执行、数学码点原文保留、空／OCR 页不补造、来源桥接、源 DB 字节不变、原文注入词不成为生成指令、两册仅一个发现入口、元数据预算、显式受管替换、失败保留旧仓及清理临时目录。语法与 diff 检查通过。

根任务恢复真实库后，已执行实际 CLI 构建与逐页验证：**33 册／4,844 页**，**33 次真实提取**和 **34 次指令扫描**，每一页原文 SHA 与 SQLite 匹配，源 SQLite 和原文汇总 SHA 在构建前后不变，没有 PDF 复制。空正文 862 页（822 pending-OCR + 40 no-text-layer）保留空状态和原页入口；未进行 OCR 或凭邻页补写。输出约 21.64 MB 来源文本／派生文本／元数据，单一可发现 entry 为 router。统计证据见 `docs/evidence/2026-10-01-textbook-skills-build.json`。

生成仓最初置于 knowledge 内，既有教材快照器严格只接受 SQLite／library，故根任务将仓原样移动至 **`/Users/a1379/Documents/Mochi-textbook-skills.nosync`**；不把 Skill 仓混入教材快照源。终端安装时由根任务独立同步至 home/knowledge/book-skills。

本生成器是**离线开发工具，要求 Python ≥3.9**；本机用 Python 3.14.7 验证，无 Python 的 Windows 终端不能凭此生成。已生成的检索仓与现 Node 教材工具互通，不要求终端再次执行 Python。Mochi package files 增加生成器和 vendor，桌面资源白名单以 files／directories 分开闭包（已核 directories 递归拷贝），源快照登记补知识库 scripts／tests／vendor。最终打包及 Windows 运行仍由根任务执行，未宣称跨平台验收。
