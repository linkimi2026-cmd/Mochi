# 当前交付状态

已生成代码场景影片：output/Mochi_V9_2K120_4m46s.mp4。2560×1440、恒定120fps、34320帧、286秒，音轨AAC48kHz双声道。motion sample60/60帧不同。详制作说明.md、功能覆盖与来源.md和evidence/final-video-verification.json。以下是保留的制作历史，旧实录待办不再是本片验收口径。

# Mochi V9 比赛功能演示（制作中）
目标：3—5分钟，覆盖全部实际产品功能，包括节日、待办、喊人叫人、课堂名单、回执，不以功能名闪过替代操作结果。

## 当前事实
- 独立教师运行 home：private.nosync/home。用户原聊天未用于素材。
- 录制原片：private.nosync/{onboarding,memory,journal,reminder,holiday,mailbox,appointment-reply,call-student,team}.mp4。当前未完成剪辑/脱敏/成片。
- 记忆、日记、3分钟提醒已真实运行；holiday仅日历now依赖固定到10月1日，模型真实调用，必须片中标注。
- 班级演示使用真实MochiLanService签名回环通信，3个合成学生请求。老师回复与叫号均经过App人工审批，教室持久化收件。
- 教学团队正在真实生成demo-workspace中的PPTX/DOCX/XLSX。
- feature-coverage.json 是待办清单，不是完工证书。
- 指定参考仓库固定提交与学习结论见 evidence/reference-decisions.md。

## 环境
教师二进制 /Applications/Mochi.app，必须用CUA完整路径定位，按名称会误选历史备份App。教师 profile LAN 49331；隔离教室49332；隔离校园后端49340（本机SQLite，30个真实迁移，合成演示账号）。
- 教师环境 DSH_HOME=.../private.nosync/home MOCHI_PLUGIN_ROOT=.../private.nosync/plugins MOCHI_RUNTIME_ROLE=teacher MOCHI_LAN_DISCOVERY=0；userdata-clean。
- private.nosync/plugins中仅mochi-user-profile复制并注入节日日期；其他均链接安装版。teacher-agent-presets必须同级链接，否则profile预备失败。
- prepare-demo.mjs初始化真实通信；已执行，不能再次执行造成重复请求。其常驻教室服务已停止，改由教室App接管。
- 教室App为APFS克隆，独立bundle ID；Electron CFBundleName须保留Mochi，否则找不到Helper。只有演示副本修改bundle metadata，不改功能。
- ffmpeg原片1920x1200/30fps，后期需裁掉菜单/Dock及非目标窗口；不可将原片直接发布。

后续：完成所有缺口功能录制；接收端/回执真实检查；剪为<=300s，统一章节/阅读停留/镜头，生成字幕、成片、可编辑源和逐功能时间码覆盖表；抽帧与完整播放检查后才报告完成。

## 用户新增硬性要求（2026-10-02）
- 成片 2K / 120fps，制作解释为 2560×1440 / 120fps。
- 只展示 Mochi 界面；桌面、菜单栏、Dock、其他应用窗口不得入片。现有原始全屏录制必须裁切并逐镜核查；禁止直接交付原片。
- 可使用 Remotion 等动效技术，真实界面主体配合重点放大与章节转场。
- 原始素材现有30fps，不能称为原生120fps实录；后续核验设备/采集实际刷新率，导出120fps和源帧率分别记录。

### 09:45 增量状态
- 新`record-window.swift`复用MIT示例，ScreenCaptureKit按PID选Mochi主窗口，排除桌面/其他应用，编译通过；先初始化NSApplication以免CGS断言。
- 教师当前PID20303，origin64054，启动session55731，现带MOCHI_CAMPUS_API_URL=http://127.0.0.1:49340。
- 窗口试录window-check-2.mov已抽帧确认仅Mochi；源2560×1440 VFR（12.03秒1102帧，静态跳帧），不是恒120。窗口当前2160×1440在画布左侧；最终以crop2160/pad居中+fps120规范化，验证样片evidence/Mochi_2K120_capture_check.mp4。后续所有成片/样片统一2560×1440/120fps，动效原生120。
- `team-results.mp4`录到真实PPTX及DOCX内置预览。课堂已读两封回信录制完成classroom-receipt.mp4。
- 真实团队发现表格插件漏inject sandboxPolicy；已最小修改plugins/mochi-sheets/index.mjs和相应测试、新增cordis-live测试。根目录依赖tmp缺失导致原测试环境失败；在安装依赖隔离副本26/26通过+真实Cordis1/1通过。private插件覆盖仅mochi-sheets/index，当前演示App已重启载入，但/Applications内未修改。原团队会话第2轮正在重试真实XLSX。图表原失败是模型把data编码成字符串，已提示原会话传真实对象，没有改图表代码。
- 文件投递被受管路径规则拒绝FILE_SOURCE_FORBIDDEN，task#2未发。没有放宽安全边界。上传选择器里PPTX/PDF打开按钮为disabled，已取消。下一步按正常受管导出流程准备同一文件再retryTaskId2确认。delivery.mp4为失败原片且已停止，不冒称投递成功。
- CUA当前教师设置打开，已实际从焦糖切到鼠尾草绿（隔离profile），未录够完整个性化镜头。classroom App在CUA app列表显示未运行，需核实再启动同一隔离home（旧session12333可能退出）。

## 用户最新明确授权：代码场景（2026-10-02）
用户明确：不必真实录屏，可依据项目源码搭建全部代码场景并做Remotion等动效。主制作路线改为源码驱动的代码演示片，允许完整模拟交互场景，不再以逐个实录成功作为全部镜头前提。仍覆盖实际存在的所有功能，2560×1440/120fps/180—300秒，仅Mochi相关界面。统一注明“基于实际功能的代码演示 · 示例数据”，避免把模拟运行结果冒充已实测结果。已录素材与运行证据保留为功能/视觉参考。未完成的真实功能回归不阻塞代码场景，但不得宣称其已经实测成功。
