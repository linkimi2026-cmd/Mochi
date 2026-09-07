# MOCHI-P5-MEM-MOUNT-01 · 挂载协调单：mochi-memory 注册进 runtime-profile

> 致：desktop 线 WorkBuddy（Maxwell / Halley 体系）
> 来自：记忆线 WorkBuddy（监制，用户 2026-09-07 裁定双线分工，记忆线专管）
> 性质：**协调请求，非派工**。`runtime-profile.json` 写权归你方，本单只提供验收完毕的输入与注册请求。我方承诺不碰该文件与 `apps/desktop/`。

## 输入（已验收，监制亲自复跑全绿）

- 插件：`plugins/mochi-memory`（`package.json` name = `mochi-memory`，`type: module`，`main: index.mjs`）
- 工具：5 个已验收（`mochi.memory_note` / `memory_recall` / `memory_forget` / `memory_world` / `memory_list`）+ 1 个在途（`memory_clear`，工单 `MOCHI-P5-MEM-03c.md`，验收中）。**建议等 03c 验收后一次注册，避免生成器跑两遍。**
- 依赖：`@deepseek-ai/dsh-tools: 0.1.3-alpha.1`；symlink 已就位（`node_modules -> node_modules.nosync -> ../../../mochi-campus/.../dsh-tools`，与 mochi-dispatch 同构）
- 测试三份监制亲自复跑全绿：`test.mjs`（插件 8 组）/ `test-worldstate.mjs`（6 组）/ `test-memstore.mjs`（9 组）
- **无 config 需求**（纯工具插件，不需要 cordis.patch.yml config 条目）→ 符合「无 config 的新插件只改 runtime-profile.json」标准路径，生成器可自动三件套

## 请求（你方节奏内执行，不催）

1. 在 `apps/desktop/resources/mochi-web/runtime-profile.json` 注册 `mochi-memory`（照 `mochi-dispatch` 同款条目：plugins 列表 + 注册表 workspacePath）
2. 跑生成器 + 回归 `apps/desktop/scripts/test-runtime-profile.mjs`
3. 重启 mochi-web（3090）后真机验证：插件加载日志出现 `mochi-memory`；对话里调用 `mochi.memory_world`（action=read）返回 world-state 骨架
4. 是否同时挂 headless / mochi profile 由你方裁定（记忆对 SDK 通道也有价值，web 优先）

## 注意

- 打包白名单：`scripts/prepare-mochi-resources.cjs` 的 PLUGINS 列表后续也要加 `mochi-memory`（现 12 个，加后 13），否则打包版会缺记忆插件。可随你方下一轮打包一起做，不阻塞本次开发态挂载。
- **落盘核验纪律**：本仓目录受 iCloud 同步 + 双线并行影响，已实测会发生"grep 与磁盘字节不一致、改动被吞"。任何交付前请 `sed -n` / `stat` 复核落盘。
- 验收回写：挂载完成请在 WORKLOG 追加一笔（含加载日志关键行），我方据此关闭记忆线挂载项。
