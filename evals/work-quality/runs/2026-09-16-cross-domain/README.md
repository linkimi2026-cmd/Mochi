# 46案跨领域策略对照（2026-09-16，已执行）

## 结论

完成46题×两版共92份DeepSeek输出，调用无错误；**自动裁判结果不可靠，不能据此宣布新提示词提高正确率或全部通过。** 单次开发集、无真实工具/附件、非完整角色prompt、没有独立留出集。

| 同一批输出的评分方式 | 旧版 | 新版 | 错误数 |
| --- | --- | --- | --- |
| Promptfoo默认llm-rubric（不含完整原题） | 45/46 | 46/46 | 0 |
| 补齐原题后重评 | 46/46 | 45/46 | 0 |

两次唯一失败均为fact-current-name，但判定对象反转：旧rubric要求实际检索，与合成无工具条件冲突。第二次裁判自己承认这个冲突，仍判新版失败。这是评测问题，不能作为模型退步或提升证据。

Codex抽查发现两个新版漏检：delivery-matches-final-artifact在无工具时称“已交付”；first-pass-clean把“单页检查”扩展为“逐页/各页”通过。math-denominator正确给出14/28=50%，旧rubric额外要求说明缺考人数超出了题目本身。详见[review-notes.json](review-notes.json)；这是定向输出复核，不是独立人工全面验收。

根据这些发现，仅澄清了上级案例库的4条rubric，未改原始输入/输出/评分。修改后的rubric尚未运行，不把旧成绩套到新版标准。

## 实际配置与范围

baseline为Git HEAD core persona，candidate为当时core persona+独立公共规则；不是完整教师角色或按需技能加载。CJS入口输出标准system/user消息JSON。每案附相同无工具/文件边界，题设明确回执可作条件，禁止假称本轮实际执行。

- 生成：DeepSeek Flash/high，max_tokens4500。
- 两次评分：DeepSeek V4 Pro，thinking disabled，max_tokens2000。
- Promptfoo0.123.0负责执行/评分；共享、遥测、缓存及数据库写入关闭。
- 第一次92份生成+评分耗时3分37秒、341948 tokens（生成291663，评分50285）；第二次仅评分54秒、56806 tokens，均并发3。耗时包含本机调度，非生产性能基准。推理token属于用量子项，不能重复加总。
- 一案校准另有2份输出及评分，2/2自动通过，仅用于验证调用配置。
- `echo`只回放已保存文本，不是模型；第二次没有重新生成。全部实际模型请求均为DeepSeek，没有MiMo或其他供应商。

原始案例32通用+14PPT；[case-scope.json](case-scope.json)标领域。没有原始PPT/教材/图片，因此只能判断策略响应，不能评价实际文件或视觉质量。多数题偏向证据边界与失败恢复，不能代表现实任务分布。

## 证据文件

- `baseline-system.txt`、`candidate-system.txt`：不可追溯混用的固定提示快照。
- `cases.json`、`promptfooconfig.json`、`results.json`：首次执行配置/原始结果。
- `rescore-cases.json`、`rescore-config.json`、`rescore-results.json`：原输出回放，加原题评分；metadata关联原result ID。
- `calibration*.json`：校准配置和结果；对应日志记录退出状态。Promptfoo退出100表示存在断言失败，不是请求报错。
- `runtime-versions.json`：临时评测依赖版本；结果中未含reasoning_content字段，不输出私有推理。

## 复现

在独立临时目录安装Promptfoo0.123.0；Node要求>=22.22.0，本次24.19.0。CLI还实际需要hono4.13.8及本机@libsql/darwin-arm64@0.5.29（均MIT），未改产品依赖/锁文件。原生库按运行平台匹配，不能在其他平台照装darwin-arm64。

通过环境提供`DEEPSEEK_API_KEY`，不要写入配置、日志或仓库。设置`PROMPTFOO_DISABLE_TELEMETRY=1`、`PROMPTFOO_DISABLE_UPDATE=1`、`PROMPTFOO_CACHE_ENABLED=false`及临时`PROMPTFOO_CONFIG_DIR`。复制本目录到一个新结果目录，在副本运行安装位置的：

```sh
promptfoo eval -c promptfooconfig.json --no-cache --no-write --no-progress-bar --no-table --no-share
```

会产生付费模型请求；不要覆盖本次证据。仅重评时改用`rescore-config.json`，仍有DeepSeek评分费用。未来评测应让裁判看到完整原题并检查rubric与工具边界，另加可程序验证的事实/结构检查及独立审阅，不能只依赖模型裁判。
