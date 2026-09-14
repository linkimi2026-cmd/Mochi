# 34 · Codex 仓库审计命令（CODEX_REPO_AUDIT_COMMAND）

> Codex 开工前必须按顺序执行并记录输出。全部只读（除 PHASE_1 明确允许的构建）。

## 0. 红线自证（每次会话开始都跑）

```bash
# ① 联动计划零改动自证（红线）
find /Users/a1379/Documents/联动计划 -path '*/.git' -prune -o -type f -mmin -60 -print
# 期望输出为空。

# ② 基线确认
git -C /Users/a1379/Documents/Mochi/mochi-harness-src.nosync/mochi-harness log --oneline -1
# 期望：d347e7039 … tag: dsh-v0.1.3-alpha.1
git -C /Users/a1379/Documents/Mochi/mochi-harness-src.nosync/mochi-harness status --short
# 期望：除已登记 patch 外无未提交改动
```

## 1. 读官方仓库（产出 HARNESS_REALITY_AUDIT 复核）

```bash
R=/Users/a1379/Documents/Mochi/mochi-harness-src.nosync/mochi-harness
ls $R/docs/user/guide/ && ls $R/packages/client/ | head -50
sed -n '1,120p' $R/docs/web-styling.md
sed -n '1,80p' $R/packages/client/ui-slots/README.md
sed -n '1,80p' $R/packages/bundle/web-app/README.md
sed -n '1,60p' $R/packages/interaction/user-approval/README.md
grep -rn "registerSlot\|register({" $R/packages/client/ui-*/src/client/index.ts | head -20
```

## 2. 读 Mochi 现状

```bash
M=/Users/a1379/Documents/Mochi
ls $M/apps/desktop/electron/dsh/ $M/.mochi-home.nosync/profiles/
sed -n '1,60p' $M/apps/desktop/electron/dsh/harness.ts
cat $M/.mochi-home.nosync/profiles/mochi/cordis.patch.yml
cat $M/plugins/cordis.yml 2>/dev/null; ls $M/plugins/
```

## 3. dump 生效配置（改 patch 前后各一次，diff 留档）

```bash
$M/mochi.sh --profile mochi --dump-config > /tmp/mochi-config-before.yml
# （改动后）$M/mochi.sh --profile mochi --dump-config > /tmp/mochi-config-after.yml && diff /tmp/mochi-config-{before,after}.yml
```

## 4. 专项核实（对应 `33` Q1/Q2，最高优先）

```bash
# Q1 第三方 client 插件注入机制
sed -n '1,120p' $R/packages/client/web/README.md
grep -rn "client" $R/packages/bundle/web-app/cordis.patch.yml | head
grep -rln "ConversationNodeDefinition" $R/packages/client | head
# 判定：运行时可注入 → 记录注入配方；不可 → 记录"须纳入 client 树构建"与构建命令。

# Q2 --dsw-* 语义别名全清单
ls $R/packages/client/ui-theme/src/styles/
grep -rhoE "\-\-dsw-[a-z0-9-]+" $R/packages/client/ui-theme/src/styles/ | sort -u
```

## 5. 报告格式

把以上输出整理成《CODEX_AUDIT_REPORT》：每项结论 + 证据路径 + 对 `33` 开放问题的答案编号。
与 `01_HARNESS_REALITY_AUDIT.md` 冲突时，以实测为准并回写修订。
