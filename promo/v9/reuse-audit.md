

### 2026-10-02 新功能宣传片 V9
用户明确要求直接录制并制作新版视频，覆盖节日祝福、待办与当前新功能。先检索完整应用/框架：`site:github.com hyperframes video framework`、`site:github.com remotion remotion video`、`site:github.com screen-studio screen recording open source cap`；再检索组件 `site:github.com/greensock/GSAP timeline license`，补 `site:github.com/remotion-dev/remotion license`。搜索均成功，Remotion 首轮误命中后定域补查成功。
实际 GitHub API 核验：HyperFrames https://github.com/heygen-com/hyperframes @ d4756f597c0dbb66310c2add699de6767b23f11b (2026-10-02)；Cap https://github.com/CapSoftware/Cap @ a2a6bd8b1948c48fe92936c265c8402d7fa8ddb3 (2026-10-01)；Remotion https://github.com/remotion-dev/remotion @ c320056a980972de109ef27a40bede9660a46931 (2026-10-01)；GSAP https://github.com/greensock/GSAP @ 13e2b790546426a1a2e0e9b409f3f8dc6d6611f2 (2026-04-13)。日期只表示所查提交，不能保证长期维护。
采用已安装 HyperFrames 0.8.36（package.json Apache-2.0）及 GSAP 3.15.0（Standard no charge license），保留现有 HTML 时间轴/逐帧渲染，不升级依赖；Node 24.19.0、FFmpeg 已存在，实际渲染结果另记。Remotion 有实体规模相关许可且需迁移 React 工程，不采用；Cap 提供完整录制编辑，但本机现成原生录制+既有渲染链可复用，不为本次增加桌面应用，未做 Cap 接入许可或兼容性验收。维护影响：仅新增 promo/v9 源工程、素材覆盖记录及成片，产品代码和旧成片保留；使用独立演示运行目录，未验证的功能不冒称拍摄完成。
