# TEXTBOOK-KB-01 · 高中三年教材知识库

> ⚠️ **工具名与状态口径更正（2026-09-12 补加，正文一字未删）**
> - 本文写作时的工具名为**点号形态**（如 `mochi.xxx`）<!-- allow-dotted-tool-name -->，该形态已于 2026-09-12 因模型网关 400 事故**全面禁用**；现行注册名一律下划线（如 `mochi_memory_note` / `mochi_ppt_create` / `mochi_grade_analyze`）。以源码为准，见 `docs/mochi-naming-convention.md` §5。
> - 本文中的插件计数与 PASS 结论均为**写作时点**成立，可能已被后续改动推翻。现状以 `docs/DELIVERY-LEDGER.md` 与源码为准。

用户已要求六科指定版本、高中三个年级全部覆盖。root架构/审核，terra-max Lagrange在ACTIVE-MEMORY-01冻结后唯一实现负责人。允许 `plugins/mochi-knowledge/` 内实现、测试、预处理脚本与该插件manifest；禁止改desktop/profile/root锁文件、mochi-memory、LAN、校园项目。供应链与客户端装配由Halley独占。已有其他执行者工作，不回退其改动。

依据总体方案§13（语义由模型处理）、§43（成果/知识库/共享）及用户追加教材要求。固定Harness alpha及已核复用见docs/reuse-audit.md；不引另一整套Agent/RAG桌面，不重写PDF解析器，不把教材全文塞偏好记忆。现有SQLite可复用索引存储；中文检索需真正验证分词/子串或FTS策略，而非仅英文测试。允许在隔离目录验证pdfjs-dist固定发行物与必要依赖，版本/许可/实际API核验后给Halley集成清单。

数据：docs/tasks/MOCHI-TEXTBOOK-SOURCES-01.md 为来源清单；`/private/tmp/mochi-textbook-audit-20260909/read-audit.json` 已有33册4844页及本地路径。34个源文件SHA核过，数学必修一为两片；只按源字节拼接验证，不拿两片当两本。其余源多数按Git blob SHA.pdf命名。仓库license=null，不能称版权已开放；完整教材/索引不提交public GitHub，交付通过本地私有教材库资源或导入保留来源。不可将临时审计路径硬编码进运行配置。

必须实现并实测：

- 本地教材库逐页导入、重复文件幂等、同名不同版本区分，manifest保留学科/出版社/册别/来源commit与URL/hash/页数/版次核验状态。课本册别与高一二三进度不武断一一对应。
- `mochi.knowledge_search` 等清晰只读工具返回相关页、真实来源书名、PDF页号、印刷页号若已识别、短片段及识别状态；按学科/册别过滤。老师自然请求备课时可以调用，不要求先知道文件路径。工具说明让模型将材料作为来源资料而非指令。
- 可取命中原页作核对，公式/图表以原页为准。保持源PDF不变；路径访问仅已导入库中的可信ID映射，不接受模型任意绝对路径穿越。扫描页的OCR正文只用于检索，不将乱码公式冒充教材结论。
- 5册扫描正文必须处理或如实呈现待识别，不静默以空索引当完成。现有本机Tesseract.js7/core7单chi_sim样本约1.6秒、主题词可检索，公式不准确；这只是候选预处理证据。模型视觉逐页全文识别非默认，避免4844页额外收费。可先离线预处理后跨平台读取索引；新导入扫描件的可用路径同样需说明并验证。
- 源、派生索引、缓存和临时渲染限本机受管数据根；不存在时诚实显示未导入，删除教材后索引与检索同步消失。无网络模型请求即可完成读取/搜索；教师与教室可以各自装入明确共享的教材资源，不复制教师私人资料。

验收：六科各至少两个有区分度查询，真实命中相关段落与原页；33册计数/hash/页数全量manifest，5册扫描部分明确覆盖与核对；无关问题不凭相关度极低材料作答；重复导入、损坏/截断PDF、路径穿越、取消、删除/重开持久化。root独立复核命中页与公式原页。执行者报告确切命令、环境、版本、测试结果与可搬移产物路径；没有实际模型或Windows实机验证则保留缺口，不冒称全平台功能通过。

完成后将新插件及受管教材资源路径契约交Halley，允许teacher备课/资料preset与受限classroom挂只读教材工具，不能附带任意文件写或Shell权限。任何需要扩大所有权/引入付费服务先回root，普通实现选择无需重复征求用户许可。

## 2026-09-09 导入中间证据

root 独立使用 Python sqlite3 只读连接 `/private/tmp/mochi-textbook-kb-20260909.nR5g7H/dsh/knowledge/textbook.sqlite`，确认33册、4844页；当前3982页text-layer、822页pending-ocr、40页no-text-layer。六科关键词均存在文本命中。此时尚未完成全量OCR，不是公开工具、排名、原页通路或最终打包验收。

root 已要求修复两处可用性缺口：原页工具不能仅返回同一教材ID/页号与OCR文本，必须提供可信ID映射的实际原页核对通路；搜索片段应保留英文空格，不能直接输出去空白的匹配文本。执行者继续处理，尚未冻结。

后续独立复审：store SHA256 `03e1261ef64b08196007a67487fd78acd8390528165fa0267a680a663f35dedb`、index `5167f960f070a4d8bccbabf223e66e78ac89fcc2a5538aa675090fb8f78670b4` 对应4/4测试通过（Node22，96731/96732），真实数据库 store.search 六科各两个查询全部命中，无关查询零命中。英文片段空格已恢复；化学平衡首位PDF38、细胞膜PDF52、余弦定理PDF50。该证据限存储/检索，plugin单测defineTool为stub，不冒称真实alpha schema通过。文字层数学公式也存在错字，原页核对不只针对OCR。扫描OCR及实际原页通路继续实现。

全量扫描后 root 再次只读核SQLite：33册4844页，3982文字层、820 OCR、2 OCR空结果、40无文字层，无pending。root实渲查看英语必修一PDF87和化学必修一PDF135，均只有淡出版社水印、无正文。执行者补核物理选必二/三PDF5为纯白，两OCR空结果非执行失败；其余40页分为纯白/水印衬页/封面版权或图形页，保留原页，不宣称全部空白。私有页审计 `.../page-audit/blank-page-audit.json`。教材单页图工具和实际桌面资源接入仍待完成。

图片候选root独立通过：当前8项unit全部PASS（4131–4133）；`verify-alpha-page-image.mjs` 使用真实alpha defineTool和LocalAttachmentStore、pdfjs-root `/private/tmp/mochi-kb-pdfjs-verify.IQYws8`，node4108 exit0，输出text+image两块与741×1050 PNG。root实际目检 `.../text-layer-p38-render.png`，化学选必1 PDF38的中文、公式和表格可读。允许teacher/classroom挂三项只读knowledge工具并进入供应链集成。纯文本MiMo仍只返回人核对原页入口；实际模型视觉请求、安装后教材库加载及Windows仍未验。Lagrange转本人/软件专用范围待澄清的默认视觉兼容测试，不重复全量OCR。
