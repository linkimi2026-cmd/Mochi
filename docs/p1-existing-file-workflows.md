# P1 现有文件流程只读清点

范围：2026-09-07 仅读取固定 alpha 运行时、当前 profile、`dsh-better-sidebar` 与本地 Office POC；未读取用户文件、未启动服务、未安装依赖。本文区分静态已确认与未做的运行验证。

## 复用结论

检索词为 `site:github.com/omdsh-dev/DSH-better-sidebar upload attachment preview office` 和 `site:github.com/deepseek-ai deepseek harness dsh attachment upload conversation`。搜索未返回另一个可直接替代当前链路的完整项目，因此采用已固定的上游实现：[`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) `d347e703908d0406b7a7ef80e3a0e594d86b2215` 的 MIT alpha 包，以及 [`omdsh-dev/DSH-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) 的 MIT 本地 checkout。固定来源和补丁见 [`vendor/alpha-family/SOURCE.md`](../vendor/alpha-family/SOURCE.md)。未采用 catalog 中的 Office viewer；其许可证和 alpha 兼容性尚未核验。

## 已确认：对话附件上传

`mochi-web` profile 选择 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app`，[`runtime-profile.json`](../apps/desktop/resources/mochi-web/runtime-profile.json) 第 43–64 行。`dsh-web-app` 的固定 `cordis.patch.yml` 已挂载 `file-upload`、`ui-conversation`、`ui-chat` 和 `ui-attachment`：不是 Mochi 另写的一条上传链。

静态调用链如下：

```text
Composer picker/addFiles 或 document drag-drop
  -> ui-conversation ConversationController.beginFileUpload()
  -> ctx.fileUpload.upload(sessionId, File, name)
  -> POST /api/session/uploadFileBinary?sessionId=…&name=…
  -> FileUploads.uploadStream()
  -> ctx.attachments.saveFileStream()
  -> dsh-attachment-local 的 DSH_HOME 内容寻址文件对象
  -> Agent-scope receipt；发送 prompt 时才消费 receipt
```

证据：`@deepseek-ai/dsh-client-ui-attachment` 的 `ComposerAttachments` 在 document 级 `dragenter/dragover/drop` 收集 `FileList`，并调用 `onAddFiles`；`ui-conversation` 的类型声明把 picker 所用的 `addFiles` 和普通文件的立即上传状态公开为 `ComposerBarInjected` / `DraftFileUploads`。`@deepseek-ai/dsh-client-file-upload` 的 host `FileUploads.uploadStream()` 直接调用 `ctx.attachments.saveFileStream()`；`@deepseek-ai/dsh-attachment-local` 实现可流式、逐字节保存普通文件。

这意味着图片和普通文件都已有输入与持久化能力；普通文件会在选择后上传、发送时以 receipt 引用，不把浏览器原路径或字节写入会话事件。图片另有规范化及历史展示；普通文件按字节保留，模型获得的是按需读取的只读文件 handle。标准 composer 的附件入口已静态确认；本次未启动浏览器，因此不把具体“加号”图标像素表现或实际拖放 UAT 称为已验证。

## 已确认：侧栏文件树是另一条上传链

[`plugins/dsh-better-sidebar/src/client/FileTree.tsx`](../plugins/dsh-better-sidebar/src/client/FileTree.tsx) 提供文件选择和目录拖放；[`client/upload.ts`](../plugins/dsh-better-sidebar/src/client/upload.ts) 保持相对路径、顺序流式提交。它调用 [`client/api.ts`](../plugins/dsh-better-sidebar/src/client/api.ts) 的 `POST /sidebar/upload`，由 [`src/index.ts`](../plugins/dsh-better-sidebar/src/index.ts) 的同名 route 经过浏览器信任栅栏和 session workspace 约束后写入工作区。

这是“把文件放进当前 session workspace”的文件树能力，不会自动变成聊天附件、Artifact 流或模型 prompt。因此不能把它替代上节的对话上传，也不需要重写两者之一。

## 预览现状

| 类型 | 已确认链路 | 当前结论 |
| --- | --- | --- |
| PDF | `builtins/viewers.tsx` 注册 `pdf`，`PdfView.tsx` 从受 session scope 约束的 `mediaUrl()` 取字节、创建 `application/pdf` Blob URL 并放入 iframe | 已有工作区 PDF 内联预览，另有下载回退；未对真实 PDF 做浏览器 UAT。 |
| DOCX/XLSX/PPTX | 内建 viewer 明确不再提供 Office 三件套；二进制命中时只走 `binary-download` | 当前没有生产内联预览，只有下载回退。 |
| 可选 Office viewer | `plugins-viewers.ts` 仅列出 `@huanlin/dsh-plugin-better-sidebar-plugin-office` 的安装命令和 [GitHub 地址](https://github.com/HuanLinOTO/dsh-plugin-better-sidebar-plugin-office) | 未列入 profile、未被资源打包器 stage，不能声称当前 Mochi 已启用。 |

`mochi-documents` 与 `mochi-presentations` 也不在当前 `mochi-web` profile 或 `prepare-mochi-resources.cjs` 的生产 plugin 列表，故不能把本地生成器/PPT 代码算作桌面现有预览链。

## OnlyOffice / Docker

[`plugins/mochi-office/README.md`](../plugins/mochi-office/README.md) 明确它是“not enabled in Mochi UI or production profile”的 bounded POC；[`docker-compose.yml`](../plugins/mochi-office/docker-compose.yml) 的 `onlyoffice/documentserver:9.4.0.1` 只绑定本地 `127.0.0.1:18080`。当前 profile 与资源打包器均未列 `mochi-office`。因此 **OnlyOffice/Docker 不在当前生产调用链**，也不应被记录为已交付预览能力或本次现成功能的缺陷。

## 侧栏 Git 后端边界（真实缺口）

浏览器端只通过 `client/api.ts` 的 `/sidebar/api/git.*` 调用；Host [`src/index.ts`](../plugins/dsh-better-sidebar/src/index.ts) 先以 session 的权威 cwd 和已验证 worktree/repoRoot 解析请求，再分派 `git.status`、`git.diff`、`git.stage`、`git.commit` 等。最终 [`src/git.ts`](../plugins/dsh-better-sidebar/src/git.ts) 第 1–14、159–188 行使用 `node:child_process.spawn('git', …)` 执行系统 Git，并保留用户全局 Git identity。

所以边界是“浏览器 UI → 同进程 sidebar Host route → 本机 `git` 可执行文件”，不是远端 Git 服务；`dsh-better-sidebar/package.json` 未依赖 `isomorphic-git`。资源打包器会把该插件的 `lib/` 带入包内，因而系统 Git 仍是 §24 的实际外部依赖，需单列为后续替换/降级议题。

## 未验证与最小后续边界

- 未做实际 alpha 浏览器上传、重启后回显、DOCX/XLSX/PPTX/PDF 文件样本或跨平台 UAT；不能据静态证据称文件流端到端通过。
- 当前应复用对话上传及 PDF viewer，不另造上传协议或附件存储。
- Office 三件套若要进入 P1，先单独验证可选 viewer 的许可证、alpha 兼容性和实际 renderer；不要把未挂载的 Docker POC 接回生产链。
