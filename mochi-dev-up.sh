#!/bin/zsh
# Mochi + 嘉行联 双服务启动器（受管 detached 子进程，日志默认写 /tmp）
# 用法：./mochi-dev-up.sh
#
# 2026-09-04 小组件架构：不再需要 vite dev @5173 —— 校园静态产物由 Mochi
# 的 jxl-campus node half 同源直出；这里只负责：
#   1) cloud 默认使用现成 Pages/Worker；local 才按需启动 API @8787
#   2) Mochi mochi-web profile @3090 —— 官方 Web GUI + Mochi 运行时
# 改了 client-plugins/*/client.js 后必须重启本脚本（插件 bundle 在启动时缓存）。

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MOCHI_DIR="${MOCHI_WORKSPACE_ROOT:-$SCRIPT_DIR}"
PATH_RESOLVER="$MOCHI_DIR/scripts/campus-paths.cjs"
NODE_BIN="${MOCHI_NODE_BINARY:-node}"
DETACHED_LAUNCHER="$MOCHI_DIR/scripts/run-detached.cjs"
CAMPUS_MODE="${MOCHI_CAMPUS_MODE:-cloud}"
if [ -n "${MOCHI_CAMPUS_API_URL:-}" ]; then
  CAMPUS_ORIGIN="$MOCHI_CAMPUS_API_URL"
  CAMPUS_MODE="custom"
else
  case "$CAMPUS_MODE" in
    cloud) CAMPUS_ORIGIN="https://jyl-campus-health-entry.pages.dev" ;;
    local) CAMPUS_ORIGIN="http://127.0.0.1:8787" ;;
    *)
      echo "[up] MOCHI_CAMPUS_MODE 只支持 cloud 或 local" >&2
      exit 1
      ;;
  esac
fi
CAMPUS_ORIGIN="${CAMPUS_ORIGIN%/}"

if [ ! -f "$PATH_RESOLVER" ]; then
  echo "[up] 缺少校园路径解析器：$PATH_RESOLVER" >&2
  exit 1
fi
if [ ! -f "$DETACHED_LAUNCHER" ]; then
  echo "[up] 缺少后台启动器：$DETACHED_LAUNCHER" >&2
  exit 1
fi

if ! CAMPUS_SOURCE_ROOT="$("$NODE_BIN" "$PATH_RESOLVER" --field source --workspace-root "$MOCHI_DIR")"; then
  echo "[up] 无法解析校园源码根目录" >&2
  exit 1
fi
if ! CAMPUS_STATE_DIR="$("$NODE_BIN" "$PATH_RESOLVER" --field state --workspace-root "$MOCHI_DIR")"; then
  echo "[up] 无法解析校园本地状态目录" >&2
  exit 1
fi
if ! CAMPUS_STATIC_ROOT="$("$NODE_BIN" "$PATH_RESOLVER" --field static --workspace-root "$MOCHI_DIR")"; then
  echo "[up] 无法解析校园静态产物目录" >&2
  exit 1
fi
CAMPUS_WRANGLER_CONFIG="$CAMPUS_SOURCE_ROOT/dist/jyl_campus_health/wrangler.json"
CAMPUS_ENV_FILE="$CAMPUS_SOURCE_ROOT/.dev.vars"
LOG_DIR="${MOCHI_DEV_UP_LOG_DIR:-/tmp}"
case "$LOG_DIR" in
  /*) ;;
  *) LOG_DIR="$MOCHI_DIR/$LOG_DIR" ;;
esac
if ! mkdir -p "$LOG_DIR"; then
  echo "[up] 无法创建启动日志目录：$LOG_DIR" >&2
  exit 1
fi
if [ "$LOG_DIR" != "/tmp" ]; then
  chmod 700 "$LOG_DIR"
fi
CAMPUS_LOG="$LOG_DIR/jxl-campus-api.log"
MOCHI_LOG="$LOG_DIR/mochi-web-run.log"

http_status() {
  local HTTP_CODE
  if ! HTTP_CODE=$(curl -sS --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 2 "$1" 2>/dev/null); then
    HTTP_CODE=000
  fi
  case "$HTTP_CODE" in
    [0-9][0-9][0-9]) print -r -- "$HTTP_CODE" ;;
    *) print -r -- 000 ;;
  esac
}

# 1) 本地模式按需启动校园 API。云端模式不启动也不停止 8787，保留已有
# 本地 D1 与进程作为独立备份/调试环境。
if [ "$CAMPUS_MODE" = "local" ] && ! lsof -ti :8787 >/dev/null 2>&1; then
  if [ ! -f "$CAMPUS_WRANGLER_CONFIG" ]; then
    echo "[up] 缺少校园 Worker 构建配置：$CAMPUS_WRANGLER_CONFIG" >&2
    echo "[up] 请先在 $CAMPUS_SOURCE_ROOT 运行 pnpm build，再重试。" >&2
    exit 1
  fi
  if [ ! -f "$CAMPUS_ENV_FILE" ]; then
    echo "[up] 缺少校园本地变量文件：$CAMPUS_ENV_FILE" >&2
    exit 1
  fi
  echo "[up] 启动校园 API @8787 …"
  # Source and D1 persistence are intentionally independent: changing the
  # canonical source checkout cannot silently select a new local database.
  # The source wrangler.jsonc is Vite-plugin input and intentionally omits
  # assets.directory; the generated config supplies that field for Wrangler.
  if ! CAMPUS_PID=$(cd "$CAMPUS_SOURCE_ROOT" && "$NODE_BIN" "$DETACHED_LAUNCHER" --log "$CAMPUS_LOG" -- ./node_modules/.bin/wrangler dev --config "$CAMPUS_WRANGLER_CONFIG" --env-file "$CAMPUS_ENV_FILE" --port 8787 --persist-to "$CAMPUS_STATE_DIR"); then
    echo "[up] 无法启动校园 API 后台进程" >&2
    exit 1
  fi
  echo "[up] 校园 API 后台 PID: $CAMPUS_PID"
elif lsof -ti :8787 >/dev/null 2>&1; then
  echo "[up] 8787 已在运行"
else
  echo "[up] 使用云端校园服务，不启动本地 8787"
fi

# 2) Mochi (mochi-web profile @3090)
if ! lsof -ti :3090 >/dev/null 2>&1; then
  echo "[up] 启动 Mochi @3090 …"
  if ! MOCHI_PID=$(cd "$MOCHI_DIR" && MOCHI_CAMPUS_MODE="$CAMPUS_MODE" MOCHI_CAMPUS_API_URL="$CAMPUS_ORIGIN" MOCHI_CAMPUS_STATIC_ROOT="$CAMPUS_STATIC_ROOT" "$NODE_BIN" "$DETACHED_LAUNCHER" --log "$MOCHI_LOG" -- ./mochi.sh --profile mochi-web --port 3090 --no-open); then
    echo "[up] 无法启动 Mochi 后台进程" >&2
    exit 1
  fi
  echo "[up] Mochi 后台 PID: $MOCHI_PID"
else
  echo "[up] 3090 已在运行（如改过 client.js 请先 kill 再重跑本脚本）"
fi

# 3) 等待真实就绪并输出不含认证令牌的入口。
# Campus 只接受所选上游明确的 /api/health 200；Mochi 可处于已就绪的匿名 200 或
# 本机认证边界 401。其他响应（包括 500）都不能视为成功。
READY=0
API_CODE=000
MOCHI_CODE=000
for i in $(seq 1 20); do
  API_CODE=$(http_status "$CAMPUS_ORIGIN/api/health")
  MOCHI_CODE=$(http_status http://127.0.0.1:3090/)
  echo "[wait] api=$API_CODE mochi=$MOCHI_CODE"
  if [ "$API_CODE" = "200" ] && { [ "$MOCHI_CODE" = "200" ] || [ "$MOCHI_CODE" = "401" ]; }; then
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" -ne 1 ]; then
  echo "[up] 服务未在 40 秒内就绪（api=$API_CODE mochi=$MOCHI_CODE）" >&2
  exit 1
fi

echo "── 入口 ──────────────────────────────"
echo "Mochi: http://127.0.0.1:3090/"
echo "Campus 小组件: Mochi 侧栏底部 5 个功能界面（班主任待办 等）"
echo "Campus API（$CAMPUS_MODE）: $CAMPUS_ORIGIN/api/health"
