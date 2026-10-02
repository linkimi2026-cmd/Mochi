# 叮咚与小信箱 / 真实多 Agent 对话式剪辑

2026-10-02。先检索完整应用/框架：`site:github.com heygen-com hyperframes video gsap`；再检索动画生态：`site:github.com greensock GSAP CustomEase spring`。搜索成功，查阅 https://github.com/heygen-com/hyperframes 、https://github.com/heygen-com/hyperframes-launch-video 和框架官方时序文档。没有把搜索结果当接入验证。

继续采用本仓固定 HyperFrames 0.8.36（Apache-2.0；前轮核对提交d4756f597c0dbb66310c2add699de6767b23f11b）、GSAP 3.15.0（Standard no charge；13e2b790546426a1a2e0e9b409f3f8dc6d6611f2）。已有本地渲染成功证据。未安装新版、未引入新的许可证或依赖。完整示例只用于分析对象接续，不搬运品牌素材；无需迁移现有框架。

原生 rail-pages.popupPageHtml、rail-model.newAttentionPayloads 和 mochi-lan.LanPanel 覆盖通知排版、消息归档和权限状态，无需重写产品UI。只在隔离影片中将已存演示记录传入原组件；HTTP适配只读，拒绝写请求，不触发真实发送。维护成本限定为展示时钟和来源映射；产品接口变化时由构建/渲染检查暴露。

用户已确认群聊式表达只用于宣传片，保留真实软件界面。不得创造不存在的产品群聊页面，也不得编写虚构 Agent 对白、完成回执。原界面按参与者顺序展开，字幕仅说明实际职责。

音轨追加：检索 `site:github.com librosa librosa beat onset librosa` 与 `site:github.com heygen-com hyperframes audio beat sync`，找到既有HyperFrames官方beats命令及源文档（https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-cli/references/beats.md）。本机0.8.36实际运行成功，对两条独立音轨写出time/strength。沿用现有命令，不安装librosa或自写节拍检测器。编舞关键点通过有界、保留音高的FFmpeg atempo接入，再检查实际输出能量起音；测量不冒充听审。

点击声直接执行本仓`client-plugins/jxl-theme/scripts/mechanical-audio.mjs`原始生成器，以离线AudioContext适配取得press/release样本，不复制算法或下载音效。两版同一点击时序，配乐分别来自已用Mixkit与用户指定的本地K3参考片。K3使用原片音轨，未分离纯音乐，可能保留原音效。

投递动作追加（2026-10-02）：执行完整框架检索 `site:github.com heygen-com hyperframes gsap video`，再查 `site:github.com greensock GSAP motionPath timeline`。成功找到上述完整框架、launch-video 和官方 timeline adapter。沿用已锁定版本与许可证，使用现有 GSAP Timeline 与原 Mo 组件，不引入外部图标库。信封为后期矢量道具，接收端为真实 LanPanel，最终展开原生 popup。动画时钟可 seek；代码只位于 promo，维护与产品运行隔离。新增双音提示由 FFmpeg 正弦声源合成，属于后期音效，不宣称产品原始提示音。
