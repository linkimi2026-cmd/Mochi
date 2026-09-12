# TEACHER-PRESETS-01 · 四个教师功能区

用户本轮明确：今晚将 Agent 预设四区改为教师专用，今天提出的功能完成后打包，明天交付。root审核、terra-max实现；不转做无关项目。

已核固定d347的现状：标准、PTC、极简、创造四项为编程用途。官方 agent-presets 支持自定义 roots、preset.yml、agent.cordis.yml、独立 persona/tools/skills 和 includeShippedRoot；运行过的会话不允许原地切preset。这是已有完整框架能力，不另造预设系统。

预设方向：备课与课件（结构化教案/真实可编辑PPTX及续改）、资料与试卷（资料整理/文档及来源核验）、成绩分析（真实XLSX/CSV输入、既有统计底座、可复核结果）、班级与教室（明确目标学校班级设备、既有审批和LAN协作，不凭名字猜目标）。名称可微调，但必须教师可懂，工具和skills必须真实可用；不把不存在的工具写入提示词。

owner：Lagrange完成Chat×Work后负责新增 teacher-agent-presets/ 内容及独立验证；Halley唯一负责受管profile/资源打包/根路径；Maxwell继续PPT与LAN不分散。各自不覆盖他人改动。root审查后集成。

实施前先冻结与Halley的路径接口、宿主与preset工具作用域、旧preset ID/旧会话兼容策略。教师主入口呈现4个教学区；不要删除用户自定义预设或把既有会话偷偷转成另一个用途。通过官方能力能实现的不得另写内核。课堂设备身份权限不可因为教师预设选择而升级，模型提示词不是角色认证。

验收：完整实际runtime列出4项教师入口；每项新会话可启动且persona/真实tool/skill生效，无缺依赖或host服务重复注册。至少核各项代表任务的输入、工具调用与产物；PPTX/XLSX沿用已验证底座；LAN未就绪不虚报已发送。确认旧记录可打开、新preset默认选择和教师/教室角色隔离。最终安装包含preset目录并可在无源码的受管数据根运行。
