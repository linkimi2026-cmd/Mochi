#!/usr/bin/env python3
"""拉取开源仓库中的系统提示词到 docs/reference/system-prompts/。

源：asgeirtj/system_prompts_leaks (CC0-1.0)
用途：Mochi 产品设计的对标参考，不参与运行时。

网络说明：raw.githubusercontent.com 在国内不稳定（SSL 握手超时），
因此内置多镜像回退 + 重试；已存在的文件默认复用、不重复下载。
要强制刷新全部内容，加 --force 重跑。
"""
import hashlib
import json
import pathlib
import sys
import time
import urllib.request

REPO = "asgeirtj/system_prompts_leaks"
BRANCH = "main"
MIRRORS = [
    f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/",
    f"https://cdn.jsdelivr.net/gh/{REPO}@{BRANCH}/",
    f"https://raw.gitmirror.com/{REPO}/{BRANCH}/",
]
DEST = pathlib.Path("/Users/a1379/Documents/Mochi/docs/reference/system-prompts")

# Anthropic 侧 —— Claude Fable 5.1 全套 + Cowork（办公 Agent 桌面形态）
ANTHROPIC = [
    "Anthropic/official/2026-09-01-claude-fable-5.1.md",
    "Anthropic/claude-fable-5.1.md",
    "Anthropic/claude-code/claude-code-fable-5.1.md",
    "Anthropic/claude-code/claude-code-headless-fable-5.1.md",
    # Cowork —— 与 Mochi 定位最同构：非开发者向的办公 Agent 桌面应用
    "Anthropic/claude-cowork/claude-cowork.md",
    "Anthropic/claude-cowork/claude-cowork-dispatch.md",
]

# OpenAI 侧 —— 面向 Mochi 工作场景的对标子集
OPENAI = [
    "OpenAI/gpt-5.6-sol.md",                        # 旗舰对话 + 工具定义
    "OpenAI/Codex/gpt-5.6.md",                      # Agent 形态
    "OpenAI/chatgpt-personality-instructions.md",   # 人格/语气总纲
    "OpenAI/gpt-5-robot-personality.md",
    "OpenAI/gpt-5-nerdy-personality.md",
    "OpenAI/gpt-5-listener-personality.md",
    "OpenAI/chatgpt-gpt-5-agent-mode.md",           # Agent 模式（对标 Mochi Work 模式）
    "OpenAI/tool-advanced-memory.md",               # 记忆工具定义（对标 Mochi 记忆系统）
    "OpenAI/tool-deep-research.md",                 # 研究工具定义
]

INDEX_FILES = ["Anthropic/README.md", "OpenAI/README.md"]

FORCE = "--force" in sys.argv


def fetch(path: str) -> bytes:
    """按镜像顺序拉取，每个镜像重试 3 次。"""
    last_err = None
    for base in MIRRORS:
        for _ in range(3):
            try:
                req = urllib.request.Request(
                    base + path, headers={"User-Agent": "mochi-fetch/1.0"}
                )
                with urllib.request.urlopen(req, timeout=45) as r:
                    return r.read()
            except Exception as e:  # noqa: BLE001
                last_err = e
                time.sleep(1.5)
        print(f"    mirror unavailable: {base.split('/')[2]}")
    raise RuntimeError(f"all mirrors failed for {path}: {last_err}")


def main() -> None:
    manifest = []
    for path in ANTHROPIC + OPENAI + INDEX_FILES:
        out = DEST / path
        if out.exists() and out.stat().st_size > 0 and not FORCE:
            blob = out.read_bytes()
            status = "cached"
        else:
            blob = fetch(path)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(blob)
            status = "fetched"

        text = blob.decode("utf-8", "replace")
        manifest.append(
            {
                "path": path,
                "bytes": len(blob),
                "lines": len(text.splitlines()),
                "sha256": hashlib.sha256(blob).hexdigest(),
            }
        )
        print(f"{status:<8} {path:<58} {len(blob):>7} B  {len(text.splitlines()):>5} lines")

    (DEST / "manifest.json").write_text(
        json.dumps(
            {"repo": REPO, "branch": BRANCH, "files": manifest},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\nmanifest -> {DEST / 'manifest.json'}")


if __name__ == "__main__":
    main()
