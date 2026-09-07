# Mochi 免费教师资料检索

`mochi-web-search` 把 `mochi-free-web` 注册到官方 `ctx.web`。它不调用语言模型，不附带站点 Cookie、Authorization 或 token，也不把生成文本当成来源。

## 检索架构（2026-09-06 改版）

**扇出 + 加权，不再是单源 + 硬白名单过滤。**

一次 `web_search` 并发查询四类来源，任一失败不影响其他源：

| 源 | 何时启用 | 说明 |
|---|---|---|
| SearXNG 全网 | 配置 `MOCHI_SEARXNG_ENDPOINT` 时 | 只指向运维方控制的实例；公共实例常禁用 JSON 且会 429，不随机依赖 |
| OpenAlex | 默认 | 无 key；带 `mailto`（`MOCHI_WEB_SEARCH_MAILTO`）进 polite pool |
| Crossref | 默认 | 无 key；出版元数据，结果链接取 DOI |
| arXiv | 默认 | 无 key；官方限速 1 req/3s，预印本 |
| 中文维基百科 | 全部扇出源失败时兜底 | 内容标注为"百科参考" |

**权威域名加权排序**：`TEACHER_AUTHORITY_DOMAINS`（教材/教育部/开放教材域名）、
`doi.org`、`.gov.cn`/`.edu.cn`/`.gov`/`.edu`/`.ac.xx` 在排序中**加分**，未命中的来源
**照常保留**——白名单是权重不是过滤器（2026-09-06 前的硬过滤语义已废弃，
五域名时代大多数查询被过滤到 0 结果的问题随之消失）。带用户信息、非 HTTP(S)、
非标准端口的 URL 仍会被卫生检查丢弃；`site:` 语法不作为任何授权依据。

返回的标题和摘要仍是未受信任的网页数据。教材与配套资源的正文版权须逐页确认；本插件只返回链接和检索摘要。

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
- [OpenAlex API](https://docs.openalex.org/)（CC0）· [Crossref REST](https://api.crossref.org/) · [arXiv API](https://info.arxiv.org/help/api/)
- 教材来源、版本待确认项和开放许可补充材料见 [`skills/teaching-material-find/teacher-resources.json`](../../skills/teaching-material-find/teacher-resources.json)。

运行测试：

```sh
node --test test/*.test.mjs
```
