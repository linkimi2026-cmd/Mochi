#!/bin/sh
# Mochi · dsh 运行入口
#
# 用法：
#   ./mochi.sh "帮我查今天有哪些学生超时未归"  # headless 单次任务
#   DSH_PROFILE=mochi-web ./mochi.sh            # 启动 Web UI（默认 3080）
#   ./mochi.sh --dump-config                    # 查看实际插件装配表
#
# Runtime home priority (shared with Electron):
#   DSH_HOME > MOCHI_RUNTIME_HOME > <workspace>/.mochi-home.nosync
# Packaged Electron has no workspace and instead defaults to ~/.mochi-home.
# The selected home keeps its sessions, credentials, locks and user-level patch.
# This launcher only regenerates Mochi-owned profile files and plugin links.

# WorkBuddy's injected shims can intercept Node filesystem operations. Mochi
# never relies on them, and no launcher-side lock cleanup is performed.
unset CODEBUDDY_SESSION_ID
unset CLAUDE_SESSION_ID
unset NODE_OPTIONS

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MOCHI_ROOT=${MOCHI_WORKSPACE_ROOT:-$SCRIPT_DIR}
RUNTIME_RESOURCES=${MOCHI_RUNTIME_RESOURCES:-$MOCHI_ROOT/apps/desktop/resources/mochi-web}
export DSH_HOME="${DSH_HOME:-${MOCHI_RUNTIME_HOME:-$MOCHI_ROOT/.mochi-home.nosync}}"

# 校园数据不出校：profile 与环境变量都关闭 telemetry。
export DSH_TELEMETRY_DISABLED="1"
# 免费全网检索端点：本地 SearXNG（tools/searxng/start.sh 启动，JSON 已启用）。
# 未设置时插件只用无 key 学术源（OpenAlex/Crossref/arXiv）+ 维基兜底；
# 指向其它受控 SearXNG 实例时直接覆盖此变量即可。
export MOCHI_SEARXNG_ENDPOINT="${MOCHI_SEARXNG_ENDPOINT:-http://127.0.0.1:8888/search}"
# 小组件与 Mochi 工具共用同一上游。当前产品选择默认使用已部署的
# Cloudflare 演示服务；本地开发可显式设置 MOCHI_CAMPUS_MODE=local。
# 完整 URL 覆盖优先级最高，供受控测试或后续正式域名使用。
if [ -z "${MOCHI_CAMPUS_API_URL:-}" ]; then
  case "${MOCHI_CAMPUS_MODE:-cloud}" in
    cloud) MOCHI_CAMPUS_API_URL="https://jyl-campus-health-entry.pages.dev" ;;
    local) MOCHI_CAMPUS_API_URL="http://127.0.0.1:8787" ;;
    *)
      echo "[mochi] MOCHI_CAMPUS_MODE 只支持 cloud 或 local" >&2
      exit 1
      ;;
  esac
fi
export MOCHI_CAMPUS_API_URL

if [ -n "${MOCHI_DSH_NODE:-}" ]; then
  NODE=$MOCHI_DSH_NODE
elif command -v node >/dev/null 2>&1; then
  NODE=$(command -v node)
else
  echo "[mochi] 找不到 Node.js；请设置 MOCHI_DSH_NODE" >&2
  exit 1
fi

if [ ! -x "$NODE" ]; then
  echo "[mochi] MOCHI_DSH_NODE 不是可执行文件：$NODE" >&2
  exit 1
fi

if [ -n "${MOCHI_DSH_BIN:-}" ]; then
  DSH=$MOCHI_DSH_BIN
else
  DSH=$("$NODE" -e '
try {
  process.stdout.write(require.resolve("@deepseek-ai/dsh/lib/bin.js", { paths: process.argv.slice(1) }))
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
' "$MOCHI_ROOT/apps/desktop" "$MOCHI_ROOT") || {
    echo "[mochi] 找不到 @deepseek-ai/dsh；请安装桌面运行时依赖或设置 MOCHI_DSH_BIN" >&2
    exit 1
  }
fi

if [ ! -f "$DSH" ]; then
  echo "[mochi] MOCHI_DSH_BIN 不存在：$DSH" >&2
  exit 1
fi

SKILLS_DIR=${MOCHI_SKILLS_DIR:-$MOCHI_ROOT/skills}
if [ -n "${MOCHI_PLUGIN_ROOT:-}" ]; then
  "$NODE" "$RUNTIME_RESOURCES/runtime-profile.cjs" \
    --home "$DSH_HOME" \
    --resources "$RUNTIME_RESOURCES" \
    --skills "$SKILLS_DIR" \
    --plugin-root "$MOCHI_PLUGIN_ROOT" || exit $?
else
  "$NODE" "$RUNTIME_RESOURCES/runtime-profile.cjs" \
    --home "$DSH_HOME" \
    --resources "$RUNTIME_RESOURCES" \
    --skills "$SKILLS_DIR" \
    --workspace "$MOCHI_ROOT" || exit $?
fi

PROFILE=${DSH_PROFILE:-headless}

# Respect an explicit CLI profile in either supported syntax.
has_profile=0
for arg in "$@"; do
  case "$arg" in
    --profile|--profile=*) has_profile=1 ;;
  esac
done

if [ "$has_profile" = "1" ]; then
  exec "$NODE" "$DSH" "$@"
else
  exec "$NODE" "$DSH" --profile "$PROFILE" "$@"
fi
