# Mochi 教师 Agent 预设

这是一组由官方 @deepseek-ai/dsh-agent-presets 发现和装载的受管资源目录。每个子目录的名称就是稳定 preset ID，包含：

- preset.yml：教师可读名称、说明和排序；
- agent.cordis.yml：该会话的官方 persona、文件、技能、提问、待办和必要网络工具。

## 四个教师功能区

| ID | 入口名称 | 真实能力 |
| --- | --- | --- |
| lesson-planning | 备课与课件 | 结构化教案；本机教材库已导入且宿主装配时先用 mochi_knowledge_search / mochi_knowledge_page 引用真实教材页，再调用 mochi_ppt_create / mochi_ppt_revise 生成或定页修订可编辑 PPTX。 |
| materials-assessment | 资料与试卷 | 读取本地资料、调用已配置的网页检索；本机教材库已导入且宿主装配时用 mochi_knowledge_search / mochi_knowledge_page 核对教材依据，整理带来源与许可边界的材料或试卷草案。 |
| grade-analysis | 成绩分析 | 宿主已装配时调用 mochi_grade_analyze，以教师明确的阈值产生可复核 XLSX。 |
| classroom-coordination | 班级与教室 | 读取 jxl_campus_status / jxl_relay_list；先用 mochi_list_classrooms 核对已配对教室，再在宿主装配且人工确认后用 mochi_notify_classroom、mochi_ask、mochi_request、mochi_find、mochi_tasks。 |

这些工具由 Mochi 的宿主 profile 注册，不能在每个 preset 内再次注册：重复挂载会造成全局工具服务冲突。每份 persona 都只在工具目录实际出现相应工具时使用它；缺失、无权限或 LAN 未就绪时明确报告不可用，绝不宣称已发送或已生成。

所有预设都装配官方 @deepseek-ai/dsh-skill-filesystem 和 @deepseek-ai/dsh-tool-skill。Mochi 宿主已将受管 skills/ 根加入其 skill provider，因此教师会话可以加载已验证的 class-meeting-prep、teaching-material-find、teacher-daily-brief 与 student-movement-request 等实际技能；不新增另一套技能框架。

## 宿主接线

资源打包和 profile 接线由桌面供应链 owner 完成。推荐的官方 roster 配置保持 shipped 与用户根，从而兼容既有会话：

~~~
- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  config:
    default: lesson-planning
    roots:
      - path: <managed-resource-root>/teacher-agent-presets
        trust: system
      - path: <installed-dsh-agent-presets>/presets
        trust: system
    includeShippedRoot: false
    includeUserRoot: true
~~~

官方发现器只在单个根内按 `order` 排序，随后按 `roots` 的顺序拼接。因此将教师根排在显式 shipped root 之前，并将 `includeShippedRoot` 设为 `false`，才能让教师四项真正排在兼容保留的标准、PTC、极简、创造项之前。显式 shipped root 仍保留 `standard`、`ptc`、`minimal`、`cordis`，不破坏已有会话；`includeUserRoot: true` 继续保留用户自己的预设。

## 验证

verify-presets.mjs 用指定的已安装 Harness 源码运行官方 discoverPresets()，确认教师四项与 shipped 兼容四项共八项均可解析、没有 broken 条目，且根顺序正确；同时检查教师项所依赖的真实工具/技能名称。

~~~
MOCHI_PRESET_HARNESS_ROOT=/absolute/path/to/installed-harness-root \
  node client-plugins/teacher-agent-presets/verify-presets.mjs
~~~

这项验证不替代桌面受管资源安装后的实际 profile 验收；后者需确认四项入口、旧会话、全局 Mochi 工具和真实技能目录均由打包产物装配。

`verify-runtime.mjs` 进一步在隔离的 DSH_HOME 中启动同一官方 profile，并为四项各创建一次会话，核对实际的预设选择、平台 Shell、文件/技能工具和 persona 挂载。它不请求模型或网络；运行时必须使用与固定 consumer 原生依赖 ABI 匹配的 Node：

~~~
MOCHI_PRESET_HARNESS_ROOT=/absolute/path/to/installed-harness-root \
  /path/to/matching-node \
  client-plugins/teacher-agent-presets/verify-runtime.mjs
~~~
