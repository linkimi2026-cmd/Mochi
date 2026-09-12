# MOCHI-DOCUMENTS-TOOL-01

适配器已验收，待最终包集成；Lagrange / terra-max 实现。root 独立审核，Halley 唯一 desktop/profile/vendor/lock 集成者。

目标：已验纯 JS 文档引擎必须成为教师可调用且随包可用的工具，返回可编辑 DOCX、配套 PDF、疑点与检查清单真实路径。当前只有 generateDocumentBundle 导出，未入 runtime-profile，不能称交付。

复用：沿用 docs/reuse-audit.md 已完成完整 Office/Harness 生态检索及 MOCHI-P1-PDF-01 的固定 DOCX/pdf-layout 实现；实现前读相关记录并补核官方工具公开接口，不新增引擎或框架。原树 plugins/mochi-documents 为准，external 旧 LibreOffice 副本不能覆盖。

允许写：plugins/mochi-documents 的最小工具入口、package main/files/固定 dsh-tools alpha 依赖、必要适配器测试；不改生成引擎、共享 PDF、PPT、桌面、课堂或其它 Agent 的文件。其他执行者并行，不还原他人改动。

接口：复用固定 alpha defineTool/output 双参 render，暴露明确的结构化文档生成工具，参数与现有 validateStructuredDocument 一致，避免另造不兼容结构。只接受已授权输入，不伪称完成 OCR 或任意 Office 转换。使用正式工具上下文的工作区/权限机制决定输出位置；如接口未确认先读源码，不把模型自由字符串当宿主授权。全新目录、取消传播、错误与真实路径返回遵守既有引擎语义。普通模板零外部程序；特殊精确考试模板的现有依赖限制如实显示，不删除或假称跨平台已完成。

验证：实际 fixed-alpha 工具注册/调用，普通中文文本与表格输入产生可编辑 DOCX 和嵌字 PDF，检查内容、路径和清单；现有输出不覆盖，取消/非法参数失败不留下完成标记。课堂不注册此写工具。最终提供净 tgz、hash、源差异与真实命令证据给 root；审核后 Halley 加入教师 profile/stage 与依赖，最终包内实测。

不修改模型密钥、不外发教材、不借此扩大到扫描识别实现。这个工具仅补齐现有能力的实际入口，其它总纲要求继续保持待验。

## 2026-09-09 复审

root 亲读 adapter、manifest、测试并独立以实际 Mac App Electron 和固定 alpha dsh-tools 执行 verify-alpha-tool（session69723，exit0 PASS）。普通中文段落/表格生成、正式 defineTool 参数验证与双参输出通过；ctx register/policy 为隔离 fixture，不替代正式 Teacher ToolRuntime 和最终包闭包验收。第一次双重归一化输入错误已返修，最终 generator 接收原始 args。净包 SHA256 a6661bebdcdd60e381bdf8959cfca60e2a5be4b5851e89c7b57452e52515c47d，4文件。已授权 Halley 唯一接入教师 profile、stage、依赖；课堂排除及实际打包调用仍待。特殊考试模板保持明确不可用，不算跨平台转换完成。
