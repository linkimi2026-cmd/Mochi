# [Mochi] Windows「无法选择工作区」热修 —— 把目录选择器钉到 browse 交互
#
# 现象：Windows 上点「选择工作区」弹出
#   directory picker failed: win32 folder dialog worker exited before reporting a result
# 原因：Harness 的 directory-picker 行用 -auto，win32 会走 koffi + COM 原生子进程；
#       真机上该子进程没回报任何 IPC 消息就退出（连 showing 都没发），宿主直接抛错。
# 上游 dsh-web-app 的 directory-picker 行上方写明：
#   "Mount -native or -browse directly in an overlay to pin the interaction."
# 本脚本按这句话把 win32 钉到 browse（应用内目录浏览器，宿主侧只用 node:fs，零原生依赖）。
#
# 落点（两处都写，互为兜底）：
#   1) 运行时 profile：%USERPROFILE%\.mochi-home\profiles\mochi-web\cordis.patch.yml
#      —— 写在受管区块之后（用户区，宿主重启重算受管区块时会原样保留），无需管理员权限。
#   2) 安装目录模板：<InstallDir>\resources\mochi\profile\patches\web.patch.yml
#      —— 让以后每次启动重算的受管区块自带钉死行；装到 Program Files 时需管理员。
#
# 用法（普通权限即可；装到 Program Files 时用管理员）：
#   powershell -ExecutionPolicy Bypass -File fix-windows-directory-picker.ps1
#   powershell -ExecutionPolicy Bypass -File fix-windows-directory-picker.ps1 -InstallDir "D:\Apps\Mochi"
#
# 幂等：已修过则跳过；改动前备份为 <原文件>.bak-<时间戳>，写入失败自动回滚。

[CmdletBinding()]
param(
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

$hotfixBlock = @'

# ---- Mochi hotfix 2026-09-11 ----
# win32 原生目录选择器（koffi/COM 子进程）真机不可用；按上游
# "Mount -native or -browse directly in an overlay to pin the interaction."
# 钉到 browse（应用内目录浏览器，零原生依赖）。
- id: directory-picker
  disabled: true

- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: directory-picker-browse-surface
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
'@

$script:patched = 0
$script:failed = 0

function Update-MochiPatchFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Write-Host "[SKIP] $Label 不存在：$Path" -ForegroundColor DarkGray
    return
  }

  $existing = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  if ($existing -match "directory-picker-browse") {
    Write-Host "[ OK ] $Label 已包含 browse 钉死行。" -ForegroundColor Green
    return
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupPath = "$Path.bak-$stamp"
  try {
    Copy-Item -LiteralPath $Path -Destination $backupPath -Force
  } catch {
    Write-Host "[FAIL] $Label 无法写入（备份失败）：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "       如果安装在 Program Files，请右键脚本 -> 以管理员身份运行。" -ForegroundColor Yellow
    $script:failed = 1
    return
  }

  try {
    Add-Content -LiteralPath $Path -Value $hotfixBlock -Encoding UTF8 -NoNewline
  } catch {
    Write-Host "[FAIL] $Label 写入失败：$($_.Exception.Message)" -ForegroundColor Red
    $script:failed = 1
    return
  }

  $verify = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  if ($verify -notmatch "directory-picker-browse" -or $verify -notmatch "id: directory-picker\r?\n\s+disabled: true") {
    Write-Host "[FAIL] $Label 写入校验失败，正在回滚……" -ForegroundColor Red
    Copy-Item -LiteralPath $backupPath -Destination $Path -Force
    $script:failed = 1
    return
  }

  Write-Host "[ OK ] $Label 已修补（备份：$backupPath）" -ForegroundColor Green
  $script:patched = 1
}

function Find-MochiInstallDir {
  $candidates = @()
  if ($InstallDir -ne "") { $candidates += $InstallDir }
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "Programs\Mochi") }
  if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles "Mochi") }
  if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} "Mochi") }
  foreach ($dir in $candidates) {
    if ($dir -and (Test-Path -LiteralPath (Join-Path $dir "Mochi.exe") -PathType Leaf)) { return $dir }
  }
  return ""
}

Write-Host "=== Mochi 热修：Windows 工作区选择器 ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/2] 运行时 profile（无需管理员权限）"
foreach ($homeName in @(".mochi-home", ".mochi-classroom-home")) {
  $runtimePatch = Join-Path $env:USERPROFILE "$homeName\profiles\mochi-web\cordis.patch.yml"
  Update-MochiPatchFile -Path $runtimePatch -Label "$homeName 运行时 profile"
}

Write-Host ""
Write-Host "[2/2] 安装目录模板"
$root = Find-MochiInstallDir
if ($root -eq "") {
  Write-Host "[SKIP] 找不到 Mochi 安装目录（上面运行时 profile 已足够）。" -ForegroundColor DarkGray
} else {
  Write-Host "       安装目录：$root"
  Update-MochiPatchFile -Path (Join-Path $root "resources\mochi\profile\patches\web.patch.yml") -Label "安装目录模板"
}

Write-Host ""
Write-Host "============================================================"
if ($script:failed -eq 1) {
  Write-Host "结果：未完全应用。请右键本脚本 -> 以管理员身份运行后重试。" -ForegroundColor Red
} elseif ($script:patched -eq 0) {
  Write-Host "结果：无需修改（已修过，或 Mochi 还没跑过一次）。" -ForegroundColor Yellow
  Write-Host "      先启动一次 Mochi，再运行本脚本。" -ForegroundColor Yellow
} else {
  Write-Host "结果：已应用。" -ForegroundColor Green
}
Write-Host ""
Write-Host "接下来你必须做这三步：" -ForegroundColor Cyan
Write-Host "  1) 完全退出 Mochi（关掉窗口后，还要右键右下角托盘图标选「退出」）；"
Write-Host "  2) 重新启动 Mochi；"
Write-Host "  3) 再点一次「选择工作区」——这次打开的是应用内目录浏览器（面包屑 + 新建文件夹）。"
Write-Host ""
Write-Host "回滚：把上面列出的 .bak-<时间戳> 备份覆盖回去，重启即可。"
Write-Host "============================================================"
