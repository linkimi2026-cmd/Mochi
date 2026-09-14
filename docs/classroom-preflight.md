> **status**: active　**last_verified**: 2026-09-13　**verified_by**: Codex（本轮仅核对交接修订范围）

> **2026-09-13 核对**：最新状态见 [项目现状](PROJECT-STATUS.md)。本轮没有重新执行历史现场测试。

> 用户已确认 Windows 一体机全部功能实测正常；本页“脚本尚未在目标机运行”仅表示未收到该脚本的输出，不否定用户功能实测。参数与录屏待归档。

# 教室机 P0 现场取证

`scripts/collect-classroom-preflight.ps1` 是一份待现场手动运行的 Windows PowerShell 5.1 脚本。它只收集一台机器的最小硬件事实，并对两个既定端点各执行一次无凭据 HTTPS GET，结果仅写到本地 JSON。它不会安装软件、修改执行策略/代理/证书/防火墙、读取用户主目录、扫描文件、调用模型或自动上传结果。

## 当前证据状态

| 项目 | 来源 | 当前状态 |
| --- | --- | --- |
| 教室一体机系统为 Win10 | 用户说明 | 用户报告，尚未由脚本实测。 |
| 无还原卡 | 用户说明 | 用户报告；脚本不自动判断还原卡，JSON 始终标为 `manual-confirmation-needed`。 |
| 内存“可能 10GB” | 用户说明 | 不确定，不能作为配置依据；以 `installedMemoryBytes` 和 `osVisibleMemoryKiB` 的现场值为准。 |
| 网络可经路由器或网线接入 | 用户说明 | 接入条件说明，不等于两个目标端点可达。 |
| 本脚本 | 本仓 P0 新增 | 尚未在目标 Windows 机器运行；当前开发机没有 `pwsh` 或 `powershell.exe`，仅做静态审查。 |

这不是 P1 的“自动医生”功能，也不能替代真实教室网络、麦克风录音、模型调用、安装包启动或校园业务登录验收。

## 脚本来源与完整性

该文件是本仓 `MOCHI-P0-FIELDKIT-01` 新增的取证脚本，不是教室机器原有脚本，也不是从陌生网页下载的工具。当前审阅版本的 SHA-256 为：

```text
16ad69c35c714ca80654777e4c0af61c7e41c560dc4e2a3b9708172143327c6a
```

将脚本复制到现场独立文件夹后，可先在该文件夹执行下列只读命令比对：

```powershell
Get-FileHash .\collect-classroom-preflight.ps1 -Algorithm SHA256
```

若哈希不一致，停止运行并交由 P0 主控审阅。

## 现场运行

1. 在教室机器新建独立的本地文件夹，例如 `C:\Mochi-P0-Fieldkit`。仅复制已核对 SHA-256 的 `collect-classroom-preflight.ps1` 到该文件夹；可另附本说明文件。不要复制整个 Mochi 仓库、`node_modules`、运行配置或任何用户本地状态。脚本拒绝 UNC 路径和映射网络盘作为输出位置。
2. 打开普通的 **Windows PowerShell**，进入该独立文件夹后执行：

   ```powershell
   Set-Location C:\Mochi-P0-Fieldkit
   powershell.exe -NoLogo -NoProfile -File .\collect-classroom-preflight.ps1
   ```

   默认会在当前本地目录生成带 UTC 时间戳的 `mochi-classroom-preflight-*.json`。脚本先检查同名文件，并在最终写入时用 `CreateNew` 原子创建；即使采集期间同名文件出现，也会失败且不会覆盖它。

3. 如需指定已有目录中的文件名，可执行：

   ```powershell
   powershell.exe -NoLogo -NoProfile -File .\collect-classroom-preflight.ps1 -OutputPath .\classroom-preflight.json -TimeoutSeconds 10
   ```

   `-OutputPath` 必须位于已有本地目录；脚本拒绝 UNC 路径和映射网络盘。`-TimeoutSeconds` 只控制每个端点的一次请求，范围为 1–60 秒。脚本不会自动重试；DNS 解析可能超过这个值，因此它不是严格的端到端总时限。

4. 仅人工发送生成的 JSON 给审阅者。脚本不会发送、上传或打印硬件详情、响应正文、Cookie 或请求凭据。

若 Windows 的执行策略阻止运行，只记录该阻塞并停止。不要为了运行本脚本永久执行 `Set-ExecutionPolicy`，也不要关闭防火墙、代理或证书校验。

## JSON 内容与解释

输出 `schemaVersion` 为 `mochi.p0.classroom-preflight.v1`，主要字段如下：

| 字段 | 含义 | 不代表什么 |
| --- | --- | --- |
| `hardware.operatingSystem` | 实际 Windows 标题、版本、build、架构及 OS 可见内存 KiB | 不是用户报告的替代品，也不收集电脑名。 |
| `hardware.computerSystem` | 厂家与型号 | 不收集序列号、资产编号或登录账户。 |
| `hardware.cpu.logicalProcessorCount` | 全部 CPU 的逻辑处理器数之和 | 不是性能基准或启动时间。 |
| `hardware.memory.installedMemoryBytes` | `Win32_PhysicalMemory.Capacity` 求和 | 不等于 `osVisibleMemoryKiB`；两项必须分开看。 |
| `hardware.audio` | 是否完成音频设备枚举及设备数量 | 不代表麦克风能录音或课堂扩声可用。 |
| `restoreCard` | 固定为 `manual-confirmation-needed` | 不会推断或修改还原卡/管控状态。 |
| `network.endpoints` | 两个固定端点各一次 GET 的状态码、耗时、分类 | 不保存正文、响应头、Cookie、IP/MAC/Wi-Fi 名称，也不代表登录或模型任务成功。 |
| `overall.unconfirmedItems` | 必须人工继续确认的事项 | 不会产生“教室已通过”的自动结论。 |

网络分类应按以下方式阅读：

- `reachable-auth-required`（401）：目标端点返回未认证状态；不代表业务可用。
- `reachable-http-forbidden-unconfirmed`（403）：收到 HTTP 拒绝，但不能据此判断是认证、授权、策略或其他原因。
- `reachable-response-unconfirmed`（2xx）：只证明收到了 2xx。脚本不检查响应正文，因此不能把门户页或任意 200 当作 API 通过。
- `redirect-unconfirmed`：请求拒绝跟随重定向，需人工确认目标与登录流程。
- `dns-failure`、`tls-failure`、`timeout`、`connect-failure`：仅记录可判定的错误类别；网络环境、代理和校内策略仍需现场排查。
- `reachable-http-client-error` 或 `reachable-http-server-error`：收到 HTTP 响应但业务状态未确认。

无论网络状态为何，未认证 API 行为、还原卡和麦克风实际录音都会保留在 `unconfirmedItems` 中。脚本成功写出 JSON 只表示采集完成，不表示 P0 现场通过。

## 固定端点与边界

脚本只访问下列 URL，一次 GET、无 `-Credential`、无 `-UseDefaultCredentials`、无 `-WebSession`、无会话变量，并以 `-MaximumRedirection 0` 拒绝跟随重定向：

```text
https://mimo.ezlook.top/v1/models
https://jyl-campus-health-entry.pages.dev/api/auth/me
```

脚本不会读取或写入 `~/.mochi-home`、`.mochi-home.nosync` 或任何真实服务状态。默认输出和指定 `-OutputPath` 都必须位于本地卷，直接 UNC 路径和映射网络盘会被拒绝。输出 JSON 不含用户名、计算机名、序列号、IP/MAC、Wi-Fi 名称、账户、文件路径、文件清单、API key、响应头、Cookie 或响应正文。

## 现场后续

保留 JSON 原件，人工核对品牌/型号、内存、还原卡、音频输入和两个端点的状态分类。若端点不可达或被重定向，不要重试模型任务或改动校园网络；将 JSON 和现场条件交给 P0 主控决定下一步。
