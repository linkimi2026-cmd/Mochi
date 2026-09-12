# Mochi 免费教师资料检索

`mochi-web-search` 把 `mochi-free-web` 注册到官方 `ctx.web`。它不调用语言模型，不附带站点 Cookie、Authorization 或 token，也不把生成文本当成来源。

## 检索架构（2026-09-12 改版）

**扇出 + 加权，不再是单源 + 硬白名单过滤。**

一次 `web_search` 并发查询下列来源，任一失败不影响其他源；教育类查询还会额外对
国内教育站点做 `site:` 限定扇出：

| 源 | 何时启用 | 说明 |
|---|---|---|
| 中文网页（Baidu、微信、头条） | 默认 | 使用 `agent-webtool` 0.6.0 的结构化 SDK；三个引擎并行，默认每引擎 3 秒。标题和摘要只是检索线索，不是教材版本、年份或正文事实的证明。 |
| 教育站点定向检索（`site:`） | 仅教育类查询 | 对学科网/菁优网/组卷网/国家智慧教育平台等发 `site:<域名> 关键词`，每站点独立成组参与加权；详见下文「国内教育站点覆盖」 |
| SearXNG 全网 | 配置 `MOCHI_SEARXNG_ENDPOINT` 时 | 只指向运维方控制的实例；公共实例常禁用 JSON 且会 429，不随机依赖 |
| OpenAlex | 默认 | 无 key；带 `mailto`（`MOCHI_WEB_SEARCH_MAILTO`）进 polite pool |
| Crossref | 默认 | 无 key；出版元数据，结果链接取 DOI |
| arXiv | 默认 | 无 key；官方限速 1 req/3s，预印本 |
| 中文维基百科 | 全部扇出源失败时兜底 | 内容标注为"百科参考" |

当本次调用有可用的中文网页结果时，学术元数据源不会仅因 DOI 或机构域名权重混入并挤掉它们；OpenAlex、Crossref 和 arXiv 会在中文网页组为空时作为回退。这保留研究查询的降级来源，同时避免通用中文教学查询被不相关论文标题覆盖。

**权威域名加权排序**：`TEACHER_AUTHORITY_DOMAINS`（教材/教育部/开放教材域名，2026-09-12
起分五层给权重，见下文表格）、`doi.org`、`.gov.cn`/`.edu.cn`/`.gov`/`.edu`/`.ac.xx`
在排序中**加分**，未命中的来源
**照常保留**——白名单是权重不是过滤器（2026-09-06 前的硬过滤语义已废弃，
五域名时代大多数查询被过滤到 0 结果的问题随之消失）。带用户信息、非 HTTP(S)、
非标准端口的 URL 仍会被卫生检查丢弃；`site:` 语法不作为任何授权依据。

返回的标题和摘要仍是未受信任的网页数据。教材与配套资源的正文版权须逐页确认；本插件只返回链接和检索摘要。每次调用只映射该次 SDK 返回的 `results`，不读取它的进程级引用收集器，因此不会把另一条查询的结果当成本次引用。

## 国内教育站点覆盖（2026-09-12）

### 一、分层权威目录（`TEACHER_AUTHORITY_TIERS`）

原先只有 5 条域名、命中一律 +0.55。现按「全国级 / 国际开放教材 / 省级 / 市级 /
商业教辅」分层，让国家平台与省市教育局排在商业题库之前：

| 层 | 权重 | 域名 | 机构 |
|---|---|---|---|
| national | 0.55 | `basic.smartedu.cn` | 国家中小学智慧教育平台 |
| national | 0.55 | `smartedu.cn` | 国家智慧教育公共服务平台（总平台） |
| national | 0.55 | `moe.gov.cn` | 教育部 |
| national | 0.55 | `pep.com.cn` | 人民教育出版社 |
| national | 0.55 | `fltrp.com` | 外语教学与研究出版社 |
| international | 0.55 | `openstax.org` | OpenStax（CC 授权开放教材） |
| provincial | 0.52 | `edu.sc.gov.cn` | 四川省教育厅 |
| provincial | 0.52 | `sceea.cn` | 四川省教育考试院 |
| municipal | 0.50 | `edu.chengdu.gov.cn` | 成都市教育局 |
| commercial | 0.48 | `zxxk.com` | 学科网 |
| commercial | 0.48 | `zujuan.xkw.com` | 组卷网（学科网旗下题库） |
| commercial | 0.48 | `jyeoo.com` | 菁优网 |

子域同样生效（`official.zxxk.com`、`www.jyeoo.com` 等）。`domainAuthority()` 仍按
"命中加分、未命中保留"工作，`*.gov.cn` / `*.edu.cn` 的 0.45 泛化规则不变。
调用方若通过 `trustedDomains` 传入自定义目录，目录内的一切域名按 0.55 计算
（向后兼容），目录外的域名不再享受教辅加权。

**逐条核实情况**（2026-09-12，均以官方站点/官方公告为准）：

| 域名 | 核实方式 | 结论 |
|---|---|---|
| `zxxk.com` | 官网 `www.zxxk.com`／`official.zxxk.com`／集团站 `about.xkw.com` 自称学科网 | 已核实 |
| `zujuan.xkw.com` | 组卷网官网及学科网帮助中心说明其为学科网旗下题库平台 | 已核实 |
| `jyeoo.com` | 官网 `www.jyeoo.com`、百度百科词条"菁优网" | 已核实 |
| `basic.smartedu.cn` / `smartedu.cn` | 平台官网；教育部 2022-03-29 新闻发布会实录明示 `www.smartedu.cn` | 已核实 |
| `edu.sc.gov.cn` | 四川省教育厅官网，且被省内政府网站引用为教育厅官方网址 | 已核实 |
| `sceea.cn` | 四川省教育厅公布的官方渠道列表（"四川省教育考试院官方网站"） | 已核实 |
| `edu.chengdu.gov.cn` | 成都市教育局《政府网站工作年度报表（2023年度）》载明首页网址 | 已核实 |
| 人教社 `pep.com.cn` / 教育部 `moe.gov.cn` / 外研社 `fltrp.com` | 2026-09-06 起已在目录，本次沿用 | 沿用（未重新核实） |

**未能核实、因此未写入目录的**：

- 「金优网」：查不到对应的教育网站域名。检索到的「金优联考卷」（北京金优）是
  一个试卷品牌/联考产品，并非可检索的官网。为避免编造域名，**没有**为它新增条目；
  只在查询信号里把「金优网」按最接近的真实站点**菁优网 `jyeoo.com`** 处理（见下）。
- `jyeoo.net`：检索中出现且内容与菁优网一致，疑似镜像站，未收录。
- 学科网 `sogou` / 微信等渠道域名：无核实依据，未收录。

### 二、教育站点定向扇出（`site:` 限定检索）

判定为**教育查询**时，除通用网页扇出外，额外对教育站点发起 `site:<域名>` 限定检索，
每个站点**独立成组**参与 `mergeRank`：

- 触发信号（`isEducationQuery`）：`试卷 / 试题 / 题库 / 卷子 / 练习 / 课件 / 教案 /
  学案 / 讲义 / 高考 / 中考 / 期中 / 期末 / 月考 / 联考 / 模拟 / 真题 / 一模 / 二模 /
  三模 / 组卷 / 单元测试 / 阶段测试 / 会考 / 学业水平 / 考点 / 命题 / 阅卷 / 错题`。
  用户直接点名站点（学科网、组卷网、菁优网、国家智慧教育平台、人教社）同样触发。
- 站点名单（`educationFanoutTargets`，上限 4 个）：命中「四川」优先加 `edu.sc.gov.cn`，
  命中「成都」优先加 `edu.chengdu.gov.cn`，再补默认
  `basic.smartedu.cn → zxxk.com → jyeoo.com → zujuan.xkw.com`。
- 发问方式：`agent-webtool` 的 `query` 用 `site:<域名> <关键词>`；配置了
  `MOCHI_SEARXNG_ENDPOINT` 时 SearXNG 侧同样用 `q=site:<域名> <关键词>`。
- **英文/学术查询不启用**：`transformer attention mechanism`、`化学平衡 教学`
  这类查询得到的扇出列表为空，OpenAlex/Crossref/arXiv 的结果不会被国内教辅站点挤掉。
- 触发时 `scopeText` 会明说「本次启用了教育站点定向检索（…）」。

### 三、下载能力的真实边界（不要承诺"帮你下载"）

本插件**只做检索**：返回链接与检索摘要，不抓取、不转存、不生成文件，也不绕过
登录、验证码或付费墙。`scopeText` 会按本次实际返回的来源如实说明：

- **学科网 `zxxk.com`、组卷网 `zujuan.xkw.com`、菁优网 `jyeoo.com`**：试卷/试题
  绝大多数需要登录或 VIP/优点付费后才能下载（菁优网公开的部分仅答案与解析，
  中考压轴真题、模拟卷等多需充值 VIP 或消耗"优点"）。这里只能给到链接。
- **国家中小学智慧教育平台 / 国家智慧教育公共服务平台**、**教育部与省市教育局/
  考试院官网**（`*.gov.cn`）：公开课程资源与公开附件通常可直接获取，但实际
  是否可下载仍以站点要求为准（部分页面需登录通行证）。
- 来源不在上述名单时，说明文字会写"能否下载取决于来源站点自身的登录与授权要求"。

不存在的「已下载」「已保存到 …」等表述一律不生成；如需真正下载，应由调用方
在获得用户明确授权与目标站点许可后另行处理。`site:` 只影响检索发问，不构成任何
抓取授权。

## 启用方式

插件经 runtime-profile 生成器挂载（三 profile 同挂），`core.patch.yml` 把
`web` 行的 `searchProvider` 固定为 `mochi-free-web`。运行时只需：

```sh
# mochi.sh 已内置默认值，本地开发无需手设
MOCHI_SEARXNG_ENDPOINT=http://127.0.0.1:8888/search   # tools/searxng/start.sh 启动
MOCHI_WEB_SEARCH_MAILTO=you@example.edu               # 可选，OpenAlex/Crossref polite pool
```

本地 SearXNG 实例：`bash tools/searxng/start.sh`（端口 8888，JSON 已启用，
引擎按本机网络实测裁剪：360search/bing/baidu 可用，sogou 上游引擎损坏已禁用，
DDG/维基/谷歌系本机不可达已禁用）。

## 学生数据边界

`ctx.web.search` 的标准请求只有一个不带授权上下文的字符串 query。适配器可以限制请求头和返回 URL，却不能可靠识别任意字符串中的学生个人资料。调用方必须先执行教师资料 skill 的隐私门禁：学生姓名、学号、健康、考勤、成绩、处分、家庭联系信息及可识别附件内容不得进入未授权外网查询。若产品需要硬性技术拦截，应在 profile/tool 的调用前策略层实现，而不是把这项保证伪装成关键词过滤。

## 依据与维护

- [SearXNG Search API](https://docs.searxng.org/dev/search_api.html) 和 [官方 GitHub 项目](https://github.com/searxng/searxng)
- [agent-webtool](https://github.com/potato47/agent-webtool) 固定 npm `0.6.0`（MIT；默认中文网页检索 SDK）
- [OpenAlex API](https://docs.openalex.org/)（CC0）· [Crossref REST](https://api.crossref.org/) · [arXiv API](https://info.arxiv.org/help/api/)
- 教材来源、版本待确认项和开放许可补充材料见 [`skills/teaching-material-find/teacher-resources.json`](../../skills/teaching-material-find/teacher-resources.json)。

运行测试：

```sh
node --test test/*.test.mjs
```
