# 第七版：复用与镜头节奏核对

2026-10-03。先查完整工程、框架，再查转场组件。实际查询：`site:github.com remotion-dev remotion license transitions`、`site:github.com motion-canvas motion-canvas transitions`、`site:github.com heygen-com hyperframes-launches k3-promo`、`site:github.com motiondivision motion layout animation`。搜索和 GitHub API 均成功；没有用未执行搜索代替结论。

| 项目 / 核对提交 | 源码与兼容性核对 | 决定 |
| --- | --- | --- |
| [HyperFrames launches](https://github.com/heygen-com/hyperframes-launches) / `d7ac35069d74a3a437780579b3b7fe2f3eeace5f` | 最近 push 2026-09-26，未归档。读 `k3-promo/index.html`：分层场景、GSAP 连续变换、透视和字形。Apache-2.0 只覆盖原创工程代码，品牌/音视频/字体另有权属。 | 部分采用编排方法。与本地 HyperFrames 0.8.36 + GSAP 3.15.0 同管线；不复制外部媒体。GitHub K3 示例不是桌面那条纸张/骑马原片，不能混为同一来源。 |
| [Remotion](https://github.com/remotion-dev/remotion) / `9a4bd2865f71420b62c84e48c30fe4d9579e90a5` | 最近 push 2026-10-02，未归档。实际读 transitions 的 slide.tsx：进入/退出两层根据同一 progress 运动，边缘 epsilon 避免白缝。自有 Remotion License，不能称 MIT。React / ReactDOM peer >=16.8；各 Remotion 包需同版本。 | 适合新的 React 视频项目；这轮不迁移已有影片。迁移需重做视频时钟、字体、原组件适配及三轨同步，不能直接提升编舞。没有在本仓安装或验证它的渲染。 |
| [transitions-video](https://github.com/remotion-dev/transitions-video) / `8d4b188b42976f7dbdf536c681ce2b3e5e5e1669` | 完整发布视频项目。最近 push 2023-11-02；package 使用 Remotion 4.0.60、React 18，license 字段 UNLICENSED、README 指向 Remotion 条款。 | 只研究完整片结构，不复制未厘清授权的源码或升级旧依赖。 |
| [Motion Canvas](https://github.com/motion-canvas/motion-canvas) / `7b91435c301d530351dcf5ebb91dd139c002e405` | MIT，最近 push 2026-07-02，未归档。读 slideTransition.ts：同时移动前后两场上下文；文档 finishScene 可避免过渡时上一场冻结。自有 JSX/Canvas 节点体系，不能直接挂载 Mochi React DOM。 | 适合从零制作矢量说明动画；参考前后场持续运动，不为此重画真实产品界面。未接入本仓。 |
| [Motion](https://github.com/motiondivision/motion) / `f5838ce47b323ce2713cb2effc5afaa5b6120a44` | MIT，最近 push 2026-10-02。实际 package 为 14.0.0，React 18/19 peer，依赖 framer-motion 14.0.0；共享布局和弹簧适合交互产品。 | 适合产品交互；当前确定性离线时钟已有 GSAP，避免混用第二套实时动画时钟。Motion+ 付费示例不能当全部开源。 |

长期维护：只增加影片编舞与可审计节奏配置，不改产品功能、不新增框架依赖。原始章节保留，新版生成文件独立；可重建而非手工覆盖。现有 GSAP Standard no charge 许可不称 MIT。只以本地实际渲染证明已采用功能可用。

## 原片观察与设计判断

已确认：桌面 K3 在约 23–27 秒从游戏成果退出到纸张空间，再推进下一成果；约 40–48 秒展示论文、图表与仪表盘；约 48–54 秒把成果群收拢、纸张承接品牌与“未来已来”。K2.6 约 32–36 秒让执行界面、网页与其他成果同时处在一个空间。依据原视频抽帧，不推断原片制作软件。

设计判断：Mochi 可用真实交互模型的图形、参数和推导三处作为镜头目标；日记的记录、来源、更正构成因果关系；结尾用信纸托起“Mochi 已至”。背景纸层要有前中后距离，在关键动作时改变构图；不是每页同样淡入。

## 停留修正口径

“停止推进”按主要信息焦点衡量；背景渐变、Mo 呼吸或 5% 慢推不算新信息。真实打字、拖动和状态切换保持源时间。已发现重点：示例列表、Agent 成员对话、叫人通知/回执、查人结果近景、记忆七段重复排版、结尾标题。

新镜头使用清晰的全景 → 内容局部 → 相关结果接续。纯停留目标 <=1.5 秒。真实连续操作不拆成看不懂的碎片；技术连续帧检查与人工观感分开记录，不能用 120fps 元数据冒充无卡顿。
