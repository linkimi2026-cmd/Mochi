# MOCHI-P0-ALPHA-MIMO-RUNTIME-02

P0 §6 固定alpha/profile接入；状态执行中，唯一执行者 Lagrange/p0_baseline_inventory/terra-max，root 独立审计。2026-09-07 已通过 followup_task 实际派发。Maxwell 独立负责 RUNTIME02 搬移/types，本票不写其输入。

目标：实际现有 mochi-llm-mimo wrapper + runtime-profile initialConfig 通过真实新 alpha 编译包和公共 Context/LlmRuntime 工作，不能拿源码单测或PiAI候选替代。复用 reuse-audit 已核官方MIT固定Harness/DeepSeekAdapter和既有loopback，不选新库。

只读 consumer /private/tmp/mochi-alpha-runtime02.suLW9w/consumer，llm-deepseek lib/index.js SHA9cc4dce9a411f1f1ae7e7985babf826b3179abcf39b3464c9d13b79b024d5130。允许新外部fixture原字节复制 wrapper，明确测试用 node_modules 链接解析至 consumer；关键import真实路径/hash须验证，没有RC或src alias。测试链接不作为便携产物。唯一写 fixture/harness 和 artifacts/architect-audit/alpha-mimo-runtime02/<timestamp>。不改原 wrapper/生产/UI/profile/锁/消费者/原测试；你不是唯一工作者。

普通 Node22 env-i 独立 HOME/DSH/TMP，无真实凭据/远程业务服务。actual initialConfig仅baseURL换loopback、合成凭据输入。验两模型目录中文四档/default low，off/low/medium/high实际wire与文本，max HTTP前拒绝；credentials服务优先、无命中environment fallback、缺凭据拒绝；与另一个official route目录独立。原适配器已通过的完整工具/abort套件不重复，wrapper若影响该链再补有依据的最小case。

所有关键判断有实际assert，资源关闭/请求计数明确，交完整可独立复跑harness、准确路径/命令/句柄/exits/hash和短报告。首个实际失败定位后报告，无修改wrapper或业务配置授权；不要由root接管实现。普通测试细节在此边界内自主执行，不重复求确认。


## root 最终验收

已验收 / PASS。root 在新 HOME/DSH/XDG 环境独立运行最终 harness（316b7ae9f838ff9d5092afde94a410bf312c2dfb734cbb10d63f2f8e6e8b038c），exit 0、七类用例通过，off 字段实际省略。证据 artifacts/architect-audit/alpha-mimo-runtime02/root-final.json。只代表真实发布包与未改 wrapper 的 loopback 集成，不冒称远程模型/桌面全链路已验。
