# 0.2.0 发布前包装闭包修复（2026-10-04）

本轮不重复升版。实际package.json、package-lock顶层及root package均为0.2.0；Git已记录基线是0.1.0。根任务从另一线程确认其刚完成升版和本地0.2.0构建，这一来源属于线程交接事实；本轮没有重新执行version。GitHub只读API确认公开仓库仍为linkimi2026-cmd/Mochi，现仅公开v0.1.0，含旧Mac arm64 DMG和Windows x64 EXE。0.2.0尚未占用，可用于新release；仓库及`https://github.com/linkimi2026-cmd/Mochi/releases/latest`保持不变。没有推送/上传/创建release。

## 检索与复用

先完整electron-builder生态，实际词 `site:github.com/electron-userland/electron-builder releases GitHub publish`；再发布组件 `site:github.com/cli/cli gh release create upload latest`。采用现成electron-builder打包及GitHub CLI发布机制，不另写上传器/发布平台。检索成功，不把未运行搜索称没有现成方案。

核本机electron-builder25.1.8/MIT、electron-publish25.1.7/MIT及实际GitHubPublisher createRelease/overwriteArtifact。正确固定标签为`electron-builder@25.1.8`，不是先前404的`v25.1.8`；GitHub只读API返回annotated tag object `4e51e4cc84251698ef9c9a4f3445584637fd4d4b`，进一步解引用commit `1d61d6f59061be23d5cd8602a65e8ce10861ccc0`，仓库 https://github.com/electron-userland/electron-builder/tree/1d61d6f59061be23d5cd8602a65e8ce10861ccc0 。实读本机LICENSE确认MIT。当前稳定构建使用Electron44.0.0和Harness0.2.0-rc.2，不为发布升级builder主版本或改模型配置。

GitHub CLI根任务已API核2.98.0 / commit a255baf71d13fe5947a4eb7ad521ffd412d64cee / MIT，仓库 https://github.com/cli/cli/tree/a255baf71d13fe5947a4eb7ad521ffd412d64cee 。采用其新tag/release、明确latest、资产上传；最终执行归根任务授权范围。本机electron-publish的同名冲突处理确实DELETE旧asset后重传，用户要求旧包保留，因此不得对旧release/旧asset使用overwrite/clobber；使用新v0.2.0、版本化新资产名，旧v0.1.0及所有本地历史目录原样保留。发布路径维护成本为原有锁定工具和精确输入快照，不新增依赖。

## 已确认故障与最小修复

output/release-20261004/mac-build.log双端虽然有SMOKE_OK，却也有mochi-user-profile failed to import。对实际0.2.0 App仅RUN_AS_NODE动态import（无GUI/真实home读取/模型）复现ERR_MODULE_NOT_FOUND，精确缺`plugins/mochi-user-profile/greeting-policy.mjs`。holiday-greeting新增相对import，source已存在，生产拷贝白名单遗漏；既有mochi-memory/mem-store文件与isSensitiveMemoryText导出都完整，不能推测是它导致。

只补prepare-mochi-resources中mochi-user-profile白名单一项；祝福策略/原用户设置/凭据不改。smoke-packaged门槛增加拒绝任何failed-to-import，不因单纯壳SMOKE_OK放行缺插件包。该门槛只匹配真实导入失败，不把无Key或普通非致命warning当导入失败。

新增test-user-profile-package-closure：按真实PLUGINS白名单物理拷贝profile+memory，使用包内44 RUN_AS_NODE导入；删除policy先复现同一错误，恢复同stage成功；SMOKE_OK+导入失败必须拒绝。合计3包装回归+18当前profile/祝福回归=21 PASS。测试不调用付费、不读取credentials/会话、不修改真实home。

全白名单与旧0.2.0包的pre-repair-package-parity.json用于保留修复前证据。最初直接比较旧本地sidebar wrapper的3差异是已核stage函数按现代模式复制runtime-modern上游0.24.1的显式转换，不能当作第三方插件遗漏；应以现代源包比对。实际需修的包装缺口只有greeting-policy。

为保留已有产物，旧release/mac-arm64原目录同盘rename到output/release-20261004/pre-closure-mac-arm64；旧0.2.0 DMG与0.1.0所有包不动。新验证仅现成dist:dir --without-key-seeds，不重新生成DMG、不安装用户App。

## 发布边界

用户后续要求长期Key服务端保护。已有Windows私有流程仍会注入两个seed并expect-seeds，不可直接作为公开Windows包发布；teacher agent负责无Key候选。当前只完成Mac包装闭包与回归，正式DMG/Windows候选/服务器保护接线及公开release由根任务串接。未读取seed值、教材正文或外发教材。目录构建结果后补，未把预期写成通过。
