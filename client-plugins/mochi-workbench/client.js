window.__ModuleLoader__.load({
  id: "mochi-workbench",
  factory: (require) => {
    var module = { exports: {} };
    var react = require("react");
    var mochiBrand = require("jxl-brand");

    var OFFICE_API_ORIGIN = "http://127.0.0.1:18100";
    var SUPPORTED_IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);
    var MAX_IMAGE_BYTES = 15 * 1024 * 1024;
    var MAX_IMAGE_DIMENSION = 8192;
    var MAX_IMAGE_PIXELS = 24 * 1000 * 1000;
    var MAX_CROP_PIXELS = 12 * 1000 * 1000;
    var selectionListeners = new Set();
    var workbenchState = Object.freeze({
      open: false,
      sessionId: null,
      selection: null,
      message: "",
    });
    var composerDraftBridge = null;
    var betterSidebarService = null;
    var officeScriptLoads = Object.create(null);
    var editorSequence = 0;

    function subscribeWorkbench(listener) {
      selectionListeners.add(listener);
      return function () { selectionListeners.delete(listener); };
    }

    function getWorkbenchSnapshot() {
      return workbenchState;
    }

    function setWorkbenchState(patch) {
      var next = Object.freeze(Object.assign({}, workbenchState, patch));
      if (
        next.open === workbenchState.open
        && next.sessionId === workbenchState.sessionId
        && next.selection === workbenchState.selection
        && next.message === workbenchState.message
      ) return;
      workbenchState = next;
      selectionListeners.forEach(function (listener) {
        try { listener(); } catch (_) {}
      });
    }

    function revokeObjectUrl(value) {
      if (!value || typeof value !== "string" || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
      try { URL.revokeObjectURL(value); } catch (_) {}
    }

    function releaseSelectionResources(selection) {
      if (selection && selection.crop && selection.crop.objectUrl) revokeObjectUrl(selection.crop.objectUrl);
    }

    function replaceSelection(selection, message) {
      if (workbenchState.selection && workbenchState.selection !== selection) releaseSelectionResources(workbenchState.selection);
      setWorkbenchState({ selection: selection || null, message: message || "" });
    }

    function openWorkbench(sessionId) {
      if (typeof sessionId !== "string" || !sessionId) return;
      releaseSelectionResources(workbenchState.selection);
      setWorkbenchState({ open: true, sessionId: sessionId, selection: null, message: "" });
      if (betterSidebarService) {
        try {
          // 内容型打开（带 path seed）：落点面板折叠时自动展开，重复点击聚焦同一 tab。
          betterSidebarService.openTab(
            { type: "mochi-workbench:panel", id: "mochi-workbench", title: "工作台", path: "workbench" },
            { sessionId: sessionId }
          );
        } catch (_) {}
      }
    }

    function closeWorkbench() {
      releaseSelectionResources(workbenchState.selection);
      setWorkbenchState({ open: false, sessionId: null, selection: null, message: "" });
      if (betterSidebarService) {
        // 未知 id 严格 no-op：tab 不在当前会话时静默跳过。
        try { betterSidebarService.closeTab("mochi-workbench"); } catch (_) {}
      }
    }

    function clearSelection() {
      replaceSelection(null, "");
    }

    function clamp(value, minimum, maximum) {
      return Math.min(Math.max(value, minimum), maximum);
    }

    function normalizedNumber(value) {
      return Math.round(value * 10000) / 10000;
    }

    /**
     * Convert a drag that occurred inside an actual rendered preview rectangle
     * into a normalized [0, 1] range. No DOM text is read here.
     */
    function normalizeBounds(start, end, rect) {
      if (!start || !end || !rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !(rect.width > 0) || !(rect.height > 0)) return null;
      if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return null;
      var left = clamp((Math.min(start.x, end.x) - rect.left) / rect.width, 0, 1);
      var right = clamp((Math.max(start.x, end.x) - rect.left) / rect.width, 0, 1);
      var top = clamp((Math.min(start.y, end.y) - rect.top) / rect.height, 0, 1);
      var bottom = clamp((Math.max(start.y, end.y) - rect.top) / rect.height, 0, 1);
      if (right - left < 0.01 || bottom - top < 0.01) return null;
      return Object.freeze({
        left: normalizedNumber(left),
        top: normalizedNumber(top),
        width: normalizedNumber(right - left),
        height: normalizedNumber(bottom - top),
      });
    }

    function isSupportedImageFile(file) {
      return !!(
        file
        && typeof file.type === "string"
        && SUPPORTED_IMAGE_TYPES.indexOf(file.type) !== -1
        && Number.isSafeInteger(file.size)
        && file.size > 0
        && file.size <= MAX_IMAGE_BYTES
      );
    }

    function imageFileError(file) {
      if (!file || typeof file !== "object") return "请选择一张 PNG、JPEG 或 WebP 图片。";
      if (SUPPORTED_IMAGE_TYPES.indexOf(file.type) === -1) return "仅支持 PNG、JPEG 或 WebP 图片。";
      if (!Number.isSafeInteger(file.size) || file.size < 1) return "所选图片为空或无法读取。";
      if (file.size > MAX_IMAGE_BYTES) return "图片超过 15 MB 上限。";
      return "";
    }

    function isValidImageDimensions(width, height) {
      return Number.isSafeInteger(width)
        && Number.isSafeInteger(height)
        && width > 0
        && height > 0
        && width <= MAX_IMAGE_DIMENSION
        && height <= MAX_IMAGE_DIMENSION
        && width * height <= MAX_IMAGE_PIXELS;
    }

    function isSha256(value) {
      return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
    }

    function buildLocalImageArtifact(file, sha256, width, height, objectUrl) {
      if (!isSupportedImageFile(file) || !isSha256(sha256) || !isValidImageDimensions(width, height)) return null;
      var hash = sha256.toLowerCase();
      return Object.freeze({
        artifactId: "local-image-sha256-" + hash,
        version: "sha256-" + hash,
        page: 1,
        objectUrl: typeof objectUrl === "string" ? objectUrl : "",
        source: Object.freeze({
          kind: "local-image",
          sha256: hash,
          mimeType: file.type,
          bytes: file.size,
          width: width,
          height: height,
          filename: typeof file.name === "string" && file.name ? file.name.slice(0, 160) : "本地图像",
          file: file,
        }),
      });
    }

    function isLocalImageArtifact(value) {
      return !!(
        value
        && typeof value.artifactId === "string"
        && typeof value.version === "string"
        && value.page === 1
        && value.source
        && value.source.kind === "local-image"
        && isSha256(value.source.sha256)
        && value.artifactId === "local-image-sha256-" + value.source.sha256
        && value.version === "sha256-" + value.source.sha256
        && SUPPORTED_IMAGE_TYPES.indexOf(value.source.mimeType) !== -1
        && Number.isSafeInteger(value.source.bytes)
        && value.source.bytes > 0
        && value.source.bytes <= MAX_IMAGE_BYTES
        && isValidImageDimensions(value.source.width, value.source.height)
      );
    }

    function selectionFromPreview(target, start, end, artifact) {
      if (!target || !target.dataset || typeof target.getBoundingClientRect !== "function") return null;
      var artifactId = target.dataset.artifactId;
      var version = target.dataset.artifactVersion;
      var page = Number(target.dataset.artifactPage);
      var bounds = normalizeBounds(start, end, target.getBoundingClientRect());
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(artifactId || "") || !/^[A-Za-z0-9._-]{1,100}$/.test(version || "") || !Number.isSafeInteger(page) || page < 1 || !bounds) return null;
      if (artifact && (!isLocalImageArtifact(artifact) || artifact.artifactId !== artifactId || artifact.version !== version || artifact.page !== page)) return null;
      return Object.freeze({ artifactId: artifactId, version: version, page: page, bounds: bounds, source: artifact ? artifact.source : null });
    }

    function selectionPixelRect(selection) {
      if (!selection || !selection.bounds || !selection.source || !isValidImageDimensions(selection.source.width, selection.source.height)) return null;
      var sourceWidth = selection.source.width;
      var sourceHeight = selection.source.height;
      var left = clamp(Math.floor(selection.bounds.left * sourceWidth), 0, sourceWidth - 1);
      var top = clamp(Math.floor(selection.bounds.top * sourceHeight), 0, sourceHeight - 1);
      var right = clamp(Math.ceil((selection.bounds.left + selection.bounds.width) * sourceWidth), left + 1, sourceWidth);
      var bottom = clamp(Math.ceil((selection.bounds.top + selection.bounds.height) * sourceHeight), top + 1, sourceHeight);
      return Object.freeze({ left: left, top: top, width: right - left, height: bottom - top });
    }

    function cropOutputSize(rect) {
      if (!rect || !Number.isSafeInteger(rect.width) || !Number.isSafeInteger(rect.height) || rect.width < 1 || rect.height < 1) return null;
      var pixels = rect.width * rect.height;
      if (pixels <= MAX_CROP_PIXELS) return Object.freeze({ width: rect.width, height: rect.height });
      var scale = Math.sqrt(MAX_CROP_PIXELS / pixels);
      return Object.freeze({ width: Math.max(1, Math.floor(rect.width * scale)), height: Math.max(1, Math.floor(rect.height * scale)) });
    }

    async function sha256Hex(buffer) {
      if (!buffer || typeof globalThis === "undefined" || !globalThis.crypto || !globalThis.crypto.subtle) throw new Error("当前浏览器无法生成本地文件哈希。");
      var digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
      return Array.prototype.map.call(new Uint8Array(digest), function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
    }

    function loadImageDimensions(objectUrl) {
      if (typeof Image !== "function") return Promise.reject(new Error("当前浏览器无法读取图片尺寸。"));
      return new Promise(function (resolveDimensions, rejectDimensions) {
        var image = new Image();
        image.onload = function () { resolveDimensions({ width: image.naturalWidth, height: image.naturalHeight }); };
        image.onerror = function () { rejectDimensions(new Error("图片无法解码。")); };
        image.src = objectUrl;
      });
    }

    async function loadLocalImageArtifact(file) {
      var fileError = imageFileError(file);
      if (fileError) throw new Error(fileError);
      if (typeof file.arrayBuffer !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") throw new Error("当前浏览器无法安全预览本地图片。");
      var hash = await sha256Hex(await file.arrayBuffer());
      var objectUrl = URL.createObjectURL(file);
      try {
        var dimensions = await loadImageDimensions(objectUrl);
        if (!isValidImageDimensions(dimensions.width, dimensions.height)) throw new Error("图片尺寸超过 8192 像素边长或 2400 万像素上限。");
        var artifact = buildLocalImageArtifact(file, hash, dimensions.width, dimensions.height, objectUrl);
        if (!artifact) throw new Error("图片元数据校验失败。");
        return artifact;
      } catch (error) {
        revokeObjectUrl(objectUrl);
        throw error;
      }
    }

    async function createLocalCrop(imageElement, selection) {
      if (!imageElement || !selection || !selection.source || !isLocalImageArtifact({
        artifactId: selection.artifactId,
        version: selection.version,
        page: selection.page,
        source: selection.source,
      })) throw new Error("当前选择未绑定可验证的本地图像。");
      if (
        !imageElement.dataset
        || imageElement.dataset.artifactId !== selection.artifactId
        || imageElement.dataset.artifactVersion !== selection.version
        || Number(imageElement.dataset.artifactPage) !== selection.page
        || imageElement.naturalWidth !== selection.source.width
        || imageElement.naturalHeight !== selection.source.height
      ) throw new Error("预览图片已变更，未生成裁图。");
      var sourceRect = selectionPixelRect(selection);
      var outputSize = cropOutputSize(sourceRect);
      if (!sourceRect || !outputSize || typeof document === "undefined") throw new Error("框选区域无法生成裁图。");
      var canvas = document.createElement("canvas");
      canvas.width = outputSize.width;
      canvas.height = outputSize.height;
      var context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("当前浏览器无法生成裁图。");
      context.drawImage(
        imageElement,
        sourceRect.left,
        sourceRect.top,
        sourceRect.width,
        sourceRect.height,
        0,
        0,
        outputSize.width,
        outputSize.height,
      );
      var blob = await new Promise(function (resolveBlob, rejectBlob) {
        canvas.toBlob(function (result) {
          if (result) resolveBlob(result);
          else rejectBlob(new Error("裁图编码失败。"));
        }, "image/png");
      });
      if (typeof blob.arrayBuffer !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") throw new Error("当前浏览器无法保存本机裁图预览。");
      var hash = await sha256Hex(await blob.arrayBuffer());
      return Object.freeze({
        phase: "ready",
        mimeType: "image/png",
        bytes: blob.size,
        sha256: hash,
        width: outputSize.width,
        height: outputSize.height,
        sourceRect: sourceRect,
        blob: blob,
        objectUrl: URL.createObjectURL(blob),
      });
    }

    function isReadyLocalCrop(crop) {
      return !!(
        crop
        && crop.phase === "ready"
        && crop.mimeType === "image/png"
        && Number.isSafeInteger(crop.bytes)
        && crop.bytes > 0
        && crop.bytes <= MAX_IMAGE_BYTES
        && isSha256(crop.sha256)
        && isValidImageDimensions(crop.width, crop.height)
        && crop.sourceRect
        && Number.isSafeInteger(crop.sourceRect.left)
        && Number.isSafeInteger(crop.sourceRect.top)
        && Number.isSafeInteger(crop.sourceRect.width)
        && Number.isSafeInteger(crop.sourceRect.height)
        && crop.sourceRect.width > 0
        && crop.sourceRect.height > 0
        && crop.blob
      );
    }

    function canAttachSelection(selection) {
      return !!(selection && selection.source && isReadyLocalCrop(selection.crop));
    }

    function selectionContextText(selection, teacherInstruction, attachedToDraft) {
      if (!selection || !selection.bounds || !selection.source || !canAttachSelection(selection)) return "";
      var instruction = typeof teacherInstruction === "string" ? teacherInstruction.trim() : "";
      var lines = [
        "【教师工作台框选上下文】",
        "素材标识：" + selection.artifactId,
        "版本：" + selection.version,
        "页面：" + selection.page,
        "原文件 SHA-256：" + selection.source.sha256,
        "原图像素：" + selection.source.width + "×" + selection.source.height,
        "框选区域（归一化）：x=" + selection.bounds.left + "，y=" + selection.bounds.top + "，宽=" + selection.bounds.width + "，高=" + selection.bounds.height,
        "原图裁剪像素：x=" + selection.crop.sourceRect.left + "，y=" + selection.crop.sourceRect.top + "，宽=" + selection.crop.sourceRect.width + "，高=" + selection.crop.sourceRect.height,
        "本机裁图 SHA-256：" + selection.crop.sha256 + "（" + selection.crop.width + "×" + selection.crop.height + "）",
        attachedToDraft
          ? "说明：裁图已加入当前会话的原生草稿附件，尚未发送；未进行文字读取或 OCR。"
          : "说明：裁图仅在本机工作台预览，尚未作为官方对话附件传递；未进行文字读取或 OCR。",
      ];
      if (instruction) lines.push("教师指令：" + instruction);
      return lines.join("\n");
    }

    function appendSelectionToDraft(draft, selection, teacherInstruction, attachedToDraft) {
      var context = selectionContextText(selection, teacherInstruction, attachedToDraft);
      if (!context) return typeof draft === "string" ? draft : "";
      var current = typeof draft === "string" ? draft : "";
      return current ? current + "\n\n" + context : context;
    }

    function isOfficeDocumentId(value) {
      return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
    }

    function isOfficeHealth(value) {
      return !!(
        value
        && value.ok === true
        && value.engine
        && typeof value.engine.origin === "string"
        && typeof value.engine.online === "boolean"
        && typeof value.engine.callbackReachable === "boolean"
        && Array.isArray(value.demoIds)
        && value.demoIds.every(isOfficeDocumentId)
      );
    }

    function canOpenOfficeEditor(health) {
      return !!(health && health.engine && health.engine.online === true && health.engine.callbackReachable === true);
    }

    function isOfficeEditorConfig(value) {
      if (!value || typeof value !== "object" || typeof value.engineOrigin !== "string" || typeof value.scriptUrl !== "string" || !value.config || typeof value.config !== "object") return false;
      var config = value.config;
      if (!config.document || !config.editorConfig || typeof config.token !== "string") return false;
      if (typeof config.document.url !== "string" || typeof config.document.key !== "string" || typeof config.document.fileType !== "string" || typeof config.document.title !== "string") return false;
      if (typeof config.editorConfig.callbackUrl !== "string" || typeof config.documentType !== "string") return false;
      try {
        var engineOrigin = new URL(value.engineOrigin).origin;
        var script = new URL(value.scriptUrl);
        return script.origin === engineOrigin && script.pathname === "/web-apps/apps/api/documents/api.js";
      } catch (_) {
        return false;
      }
    }

    function isSafeWebUrl(value) {
      if (typeof value !== "string" || !value.trim()) return null;
      try {
        var url = new URL(value.trim());
        if (url.protocol === "https:") return url.href;
        var loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
        return url.protocol === "http:" && loopback ? url.href : null;
      } catch (_) {
        return null;
      }
    }

    async function requestJson(path, signal) {
      var response = await fetch(OFFICE_API_ORIGIN + path, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        signal: signal,
        headers: { accept: "application/json" },
      });
      var body = await response.json().catch(function () { return null; });
      if (!response.ok) {
        var error = new Error(body && typeof body.error === "string" ? body.error : "office request failed");
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    }

    function loadOnlyOfficeScript(scriptUrl) {
      if (typeof window === "undefined" || typeof document === "undefined") return Promise.reject(new Error("ONLYOFFICE script requires a browser document"));
      if (window.DocsAPI && typeof window.DocsAPI.DocEditor === "function") return Promise.resolve(window.DocsAPI);
      if (officeScriptLoads[scriptUrl]) return officeScriptLoads[scriptUrl];
      officeScriptLoads[scriptUrl] = new Promise(function (resolveScript, rejectScript) {
        var existing = Array.prototype.find.call(document.querySelectorAll("script[data-mochi-office-script]"), function (node) {
          return node.getAttribute("data-mochi-office-script") === scriptUrl;
        });
        var script = existing || document.createElement("script");
        var settle = function () {
          if (window.DocsAPI && typeof window.DocsAPI.DocEditor === "function") resolveScript(window.DocsAPI);
          else rejectScript(new Error("ONLYOFFICE DocsAPI is unavailable after script load"));
        };
        script.addEventListener("load", settle, { once: true });
        script.addEventListener("error", function () { rejectScript(new Error("ONLYOFFICE DocsAPI script failed to load")); }, { once: true });
        if (!existing) {
          script.async = true;
          script.src = scriptUrl;
          script.setAttribute("data-mochi-office-script", scriptUrl);
          document.head.appendChild(script);
        }
      }).catch(function (error) {
        delete officeScriptLoads[scriptUrl];
        throw error;
      });
      return officeScriptLoads[scriptUrl];
    }

    function statusCopy(health) {
      if (!health || !health.engine) return "Office 服务未连接";
      if (!health.engine.online) return "Office 引擎未连接";
      if (!health.engine.callbackReachable) return "Office 回调桥接尚未验证";
      return "Office 编辑器可用";
    }

    function installStyles() {
      if (typeof document === "undefined") return function () {};
      var styleId = "mochi-workbench-style";
      if (document.getElementById(styleId)) return function () {};
      var style = document.createElement("style");
      style.id = styleId;
      style.textContent = [
        ".mochi-workbench-panel{position:absolute;z-index:1;top:calc(env(safe-area-inset-top,0px) + 76px);right:14px;bottom:14px;width:min(456px,calc(100vw - 330px));min-width:320px;display:flex;flex-direction:column;overflow:hidden;pointer-events:auto;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d8dfda) 82%,transparent);border-radius:20px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#faf9f4) 91%,transparent);color:var(--dsw-alias-label-primary,#243029);box-shadow:0 22px 52px -28px rgba(18,31,24,.58),inset 0 1px 0 rgba(255,255,255,.56);backdrop-filter:blur(20px) saturate(150%);-webkit-backdrop-filter:blur(20px) saturate(150%);animation:mochi-workbench-enter 180ms cubic-bezier(.22,.78,.24,1);}",
        "@keyframes mochi-workbench-enter{from{opacity:0;transform:translateX(10px) scale(.99)}to{opacity:1;transform:none}}",
        ".mochi-workbench__top{display:flex;align-items:center;gap:10px;min-height:52px;padding:10px 12px 8px 16px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d8dfda) 75%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#faf9f4) 84%,transparent);}",
        ".mochi-workbench__title{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px}.mochi-workbench__eyebrow{font:600 11px/1.2 system-ui,sans-serif;letter-spacing:.08em;color:var(--dsw-alias-label-secondary,#65736a)}.mochi-workbench__name{font:650 15px/1.25 system-ui,sans-serif;letter-spacing:.01em}.mochi-workbench__close,.mochi-workbench__header-trigger{appearance:none;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d8dfda) 86%,transparent);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#243029);font:600 12px/1 system-ui,sans-serif;cursor:pointer;border-radius:999px;min-height:34px;padding:0 11px;transition:transform 100ms ease,background-color 120ms ease,border-color 120ms ease;}.mochi-workbench__close:hover,.mochi-workbench__header-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(70,90,78,.1));}.mochi-workbench__close:active,.mochi-workbench__header-trigger:active{transform:scale(.97);}",
        ".mochi-workbench__header-trigger[aria-pressed=\"true\"]{border-color:color-mix(in srgb,#d9873e 52%,var(--dsw-alias-border-l2,#d8dfda));background:color-mix(in srgb,#d9873e 13%,var(--dsw-alias-bg-layer-1,#fff));}.mochi-workbench__tabs{display:flex;gap:4px;padding:8px 12px 0;background:color-mix(in srgb,var(--dsw-alias-bg-base,#f7f4ec) 76%,transparent);}.mochi-workbench__tab{appearance:none;border:0;border-radius:10px 10px 0 0;min-height:34px;padding:0 11px;background:transparent;color:var(--dsw-alias-label-secondary,#65736a);font:600 12px/1 system-ui,sans-serif;cursor:pointer;transition:background-color 120ms ease,color 120ms ease,transform 100ms ease;}.mochi-workbench__tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(70,90,78,.1));}.mochi-workbench__tab:active{transform:scale(.97)}.mochi-workbench__tab[aria-selected=\"true\"]{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#243029);box-shadow:inset 0 -2px 0 #d9873e;}",
        ".mochi-workbench__body{min-height:0;flex:1;overflow:auto;padding:14px;background:color-mix(in srgb,var(--dsw-alias-bg-base,#f7f4ec) 78%,transparent);}.mochi-workbench__section{display:flex;flex-direction:column;gap:12px;min-height:100%;}.mochi-workbench__card{border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d8dfda) 82%,transparent);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);padding:13px;box-shadow:inset 0 1px 0 rgba(255,255,255,.52);}.mochi-workbench__card h3{margin:0 0 5px;font:650 14px/1.35 system-ui,sans-serif}.mochi-workbench__card p,.mochi-workbench__card li{margin:0;color:var(--dsw-alias-label-secondary,#65736a);font:400 12px/1.6 system-ui,sans-serif}.mochi-workbench__card ul{margin:6px 0 0;padding-left:18px;}",
        ".mochi-workbench__status{display:flex;align-items:center;gap:9px;border-radius:12px;padding:10px 11px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-3,#eef0ec) 72%,transparent);font:600 12px/1.35 system-ui,sans-serif;}.mochi-workbench__status-dot{width:8px;height:8px;border-radius:50%;background:#697c70;flex:none}.mochi-workbench__status[data-state=\"offline\"] .mochi-workbench__status-dot,.mochi-workbench__status[data-state=\"error\"] .mochi-workbench__status-dot{background:#bf6048}.mochi-workbench__status[data-state=\"online\"] .mochi-workbench__status-dot{background:#698c70}.mochi-workbench__actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}.mochi-workbench__button{appearance:none;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d8dfda) 86%,transparent);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#243029);min-height:36px;padding:0 11px;font:600 12px/1 system-ui,sans-serif;cursor:pointer;transition:background-color 120ms ease,transform 100ms ease,border-color 120ms ease;}.mochi-workbench__button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(70,90,78,.1));}.mochi-workbench__button--primary{background:var(--dsw-alias-brand-primary,#315f50);color:var(--dsw-alias-bg-layer-1,#fff);border-color:transparent}.mochi-workbench__button--primary:hover:not(:disabled){background:#3c6f5e}.mochi-workbench__button:disabled{cursor:not-allowed;opacity:.52}.mochi-workbench__button:active:not(:disabled){transform:scale(.97)}",
        ".mochi-workbench__loading{display:flex;min-height:150px;align-items:center;justify-content:center;gap:10px;color:var(--dsw-alias-label-secondary,#65736a);font:500 12px/1.4 system-ui,sans-serif}.mochi-workbench__loading-orb{width:34px;height:34px;flex:none}.mochi-workbench__office-editor{min-height:360px;overflow:hidden;border-radius:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d8dfda) 82%,transparent);background:var(--dsw-alias-bg-base,#f7f4ec)}.mochi-workbench__office-editor>div{height:100%;min-height:360px}.mochi-workbench__meta{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 10px;font:400 12px/1.45 system-ui,sans-serif}.mochi-workbench__meta dt{color:var(--dsw-alias-label-secondary,#65736a)}.mochi-workbench__meta dd{min-width:0;margin:0;overflow-wrap:anywhere}.mochi-workbench__version-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.mochi-workbench__version{border-radius:999px;padding:3px 8px;background:var(--dsw-alias-bg-layer-3,#eef0ec);font:600 11px/1.2 system-ui,sans-serif;color:var(--dsw-alias-label-secondary,#65736a)}",
        ".mochi-workbench__field{display:flex;flex-direction:column;gap:6px;color:var(--dsw-alias-label-secondary,#65736a);font:600 12px/1.35 system-ui,sans-serif}.mochi-workbench__input,.mochi-workbench__textarea,.mochi-workbench__file{box-sizing:border-box;width:100%;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d8dfda) 86%,transparent);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#243029);font:400 13px/1.5 system-ui,sans-serif;padding:9px 10px;}.mochi-workbench__file{padding:7px 9px;cursor:pointer}.mochi-workbench__textarea{min-height:74px;resize:vertical}.mochi-workbench__image-stage{overflow:auto;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d8dfda) 84%,transparent);border-radius:14px;background:linear-gradient(150deg,#fffdf8,var(--dsw-alias-bg-layer-1,#fff));padding:10px;line-height:0}.mochi-workbench__image-frame{position:relative;display:inline-block;max-width:100%;line-height:0}.mochi-workbench__image{display:block;max-width:100%;max-height:min(480px,60vh);width:auto;height:auto;border-radius:9px;touch-action:pan-y;user-select:none}.mochi-workbench__image[data-selecting=true]{cursor:crosshair;touch-action:none}.mochi-workbench__selection-box{position:absolute;pointer-events:none;border:2px solid #d9873e;background:rgba(217,135,62,.14);border-radius:5px}.mochi-workbench__iframe{width:100%;min-height:330px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d8dfda) 84%,transparent);border-radius:12px;background:#fff}.mochi-workbench__selection-summary{display:flex;flex-direction:column;gap:8px}.mochi-workbench__selection-record{border-radius:10px;padding:9px;background:var(--dsw-alias-bg-layer-3,#eef0ec);font:400 12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.mochi-workbench__crop{display:flex;flex-direction:column;gap:7px}.mochi-workbench__crop-image{display:block;max-width:100%;max-height:220px;object-fit:contain;align-self:flex-start;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d8dfda) 84%,transparent);border-radius:10px;background:var(--dsw-alias-bg-base,#f7f4ec)}.mochi-workbench__notice{min-height:18px;color:var(--dsw-alias-label-secondary,#65736a);font:500 12px/1.45 system-ui,sans-serif}.mochi-workbench__notice[data-error=true]{color:#a4552f}.mochi-workbench__limit{color:var(--dsw-alias-label-tertiary,#7a877e);font:400 11px/1.5 system-ui,sans-serif}",
        ".mochi-workbench-panel :is(button,input,textarea):focus-visible{outline:2px solid color-mix(in srgb,#d9873e 74%,transparent);outline-offset:2px}@media (max-width:680px){.mochi-workbench-panel{top:calc(env(safe-area-inset-top,0px) + 76px);right:7px;bottom:7px;left:7px;width:auto;min-width:0;border-radius:16px}.mochi-workbench__body{padding:10px}.mochi-workbench__top{padding-left:12px}.mochi-workbench__office-editor,.mochi-workbench__office-editor>div{min-height:300px}}@media (max-width:360px){.mochi-workbench-panel{top:calc(env(safe-area-inset-top,0px) + 76px);right:4px;bottom:4px;left:4px;border-radius:14px}.mochi-workbench__tab{padding:0 8px;font-size:11px}.mochi-workbench__close{padding:0 9px}}@media (prefers-reduced-motion:reduce){.mochi-workbench-panel{animation:none}.mochi-workbench-panel :is(.mochi-workbench__button,.mochi-workbench__close,.mochi-workbench__header-trigger,.mochi-workbench__tab){transition:none}.mochi-workbench-panel :is(.mochi-workbench__button,.mochi-workbench__close,.mochi-workbench__header-trigger,.mochi-workbench__tab):active{transform:none}}@media (prefers-reduced-transparency:reduce){.mochi-workbench-panel{background:var(--dsw-alias-bg-layer-1,#fff);backdrop-filter:none;-webkit-backdrop-filter:none}}@media (prefers-contrast:more){.mochi-workbench-panel,.mochi-workbench__card,.mochi-workbench__image-stage{border-color:var(--dsw-alias-label-primary,#243029)}}",
        ".mochi-workbench-sidebar-host{display:flex;flex-direction:column;height:100%;min-height:0;}.mochi-workbench-sidebar-host .mochi-workbench-panel{position:static;z-index:auto;top:auto;right:auto;bottom:auto;left:auto;width:auto;min-width:0;flex:1;min-height:0;border:0;border-radius:0;background:transparent;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;animation:none;}",
      ].join("");
      document.head.appendChild(style);
      return function () {
        if (style.parentNode) style.parentNode.removeChild(style);
      };
    }

    function MochiLoading(props) {
      var OrbCompanion = mochiBrand && mochiBrand.OrbCompanion;
      return react.createElement(
        "div",
        { className: "mochi-workbench__loading", role: "status", "aria-live": "polite" },
        typeof OrbCompanion === "function"
          ? react.createElement("span", { className: "mochi-workbench__loading-orb", "aria-hidden": true }, react.createElement(OrbCompanion, { state: "typing", size: 34, active: true }))
          : null,
        react.createElement("span", null, props.text || "Mochi 正在准备"),
      );
    }

    function WorkbenchHeaderAction(props) {
      var snapshot = react.useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot);
      var sessionId = typeof props.sessionId === "string" ? props.sessionId : null;
      if (!sessionId) return null;
      var open = snapshot.open && snapshot.sessionId === sessionId;
      return react.createElement(
        "button",
        {
          type: "button",
          className: "mochi-workbench__header-trigger",
          "aria-label": open ? "关闭教师工作台" : "打开教师工作台",
          "aria-pressed": open,
          onClick: function () { if (open) closeWorkbench(); else openWorkbench(sessionId); },
        },
        "工作台",
      );
    }

    function TabButton(props) {
      return react.createElement(
        "button",
        {
          type: "button",
          className: "mochi-workbench__tab",
          role: "tab",
          id: props.id + "-tab",
          "aria-selected": props.active,
          "aria-controls": props.id + "-panel",
          onClick: props.onSelect,
        },
        props.children,
      );
    }

    function WorkbenchOverlay() {
      var snapshot = react.useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot);
      if (!snapshot.open) return null;
      return react.createElement(WorkbenchPanel, { snapshot: snapshot });
    }

    // better-sidebar tab 宿主：可见性由侧边栏管理，不看 store.open；
    // 外层 div 携带作用域类，CSS 把 overlay 绝对定位还原为流式填充。
    function WorkbenchSidebarTab() {
      var snapshot = react.useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot);
      return react.createElement(
        "div",
        { className: "mochi-workbench-sidebar-host" },
        react.createElement(WorkbenchPanel, { snapshot: snapshot })
      );
    }

    function WorkbenchPanel(props) {
      var tabState = react.useState("office");
      var tab = tabState[0];
      var setTab = tabState[1];
      var instructionState = react.useState("");
      var instruction = instructionState[0];
      var setInstruction = instructionState[1];
      var imageState = react.useState(null);
      var image = imageState[0];
      var setImage = imageState[1];
      var selection = props.snapshot.selection;

      react.useEffect(function () {
        return function () {
          if (image && image.objectUrl) revokeObjectUrl(image.objectUrl);
        };
      }, [image]);

      react.useEffect(function () {
        function onKeyDown(event) {
          if (event.key === "Escape") closeWorkbench();
        }
        document.addEventListener("keydown", onKeyDown);
        return function () { document.removeEventListener("keydown", onKeyDown); };
      }, []);

      function insertSelectionIntoComposer() {
        if (!selection) return;
        var result = composerDraftBridge ? composerDraftBridge(selection, instruction) : { ok: false, message: "当前会话的对话输入不可用" };
        setWorkbenchState({ message: result.message || (result.ok ? "已加入当前对话草稿，尚未发送。" : "无法加入对话草稿") });
      }

      function replaceImage(imageArtifact) {
        clearSelection();
        setImage(imageArtifact || null);
      }

      var activePanel = tab === "office"
        ? react.createElement(OfficePane, null)
        : tab === "web"
          ? react.createElement(WebPane, { image: image, onImageChange: replaceImage })
          : react.createElement(SelectionPane, { selection: selection, instruction: instruction, onInstruction: setInstruction, onInsert: insertSelectionIntoComposer });
      return react.createElement(
        "aside",
        { className: "mochi-workbench-panel", "aria-label": "教师工作台" },
        react.createElement(
          "div",
          { className: "mochi-workbench__top" },
          react.createElement("div", { className: "mochi-workbench__title" }, react.createElement("span", { className: "mochi-workbench__eyebrow" }, "MOCHI · TEACHER"), react.createElement("span", { className: "mochi-workbench__name" }, "教师工作台")),
          react.createElement("button", { type: "button", className: "mochi-workbench__close", "aria-label": "关闭教师工作台", onClick: closeWorkbench }, "关闭"),
        ),
        react.createElement(
          "div",
          { className: "mochi-workbench__tabs", role: "tablist", "aria-label": "教师工作台页面" },
          react.createElement(TabButton, { id: "mochi-workbench-office", active: tab === "office", onSelect: function () { setTab("office"); } }, "Office"),
          react.createElement(TabButton, { id: "mochi-workbench-web", active: tab === "web", onSelect: function () { setTab("web"); } }, "网页预览"),
          react.createElement(TabButton, { id: "mochi-workbench-selection", active: tab === "selection", onSelect: function () { setTab("selection"); } }, selection ? "已框选" : "框选"),
        ),
        react.createElement("div", { className: "mochi-workbench__body", id: "mochi-workbench-" + tab + "-panel", role: "tabpanel", "aria-labelledby": "mochi-workbench-" + tab + "-tab" }, activePanel),
      );
    }

    function OfficePane() {
      var healthState = react.useState({ phase: "loading", value: null, error: "" });
      var health = healthState[0];
      var setHealth = healthState[1];
      var documentIdState = react.useState(null);
      var documentId = documentIdState[0];
      var setDocumentId = documentIdState[1];
      var versionsState = react.useState({ phase: "idle", values: [], error: "" });
      var versions = versionsState[0];
      var setVersions = versionsState[1];
      var editorState = react.useState({ phase: "idle", value: null, error: "" });
      var editor = editorState[0];
      var setEditor = editorState[1];

      function refreshHealth() {
        setHealth({ phase: "loading", value: null, error: "" });
        var controller = new AbortController();
        requestJson("/health", controller.signal).then(function (value) {
          if (!isOfficeHealth(value)) throw new Error("Office 健康响应不完整");
          setHealth({ phase: "ready", value: value, error: "" });
          setDocumentId(function (current) { return current && value.demoIds.indexOf(current) !== -1 ? current : (value.demoIds[0] || null); });
        }).catch(function (error) {
          if (error && error.name === "AbortError") return;
          setHealth({ phase: "error", value: null, error: "Office 服务暂时无法连接" });
        });
        return controller;
      }

      react.useEffect(function () {
        var controller = refreshHealth();
        return function () { controller.abort(); };
      }, []);

      react.useEffect(function () {
        if (!documentId) return undefined;
        var controller = new AbortController();
        setVersions({ phase: "loading", values: [], error: "" });
        requestJson("/api/office/documents/" + encodeURIComponent(documentId) + "/versions", controller.signal).then(function (value) {
          var entries = Array.isArray(value && value.versions) ? value.versions.filter(function (entry) { return entry && Number.isSafeInteger(entry.version) && typeof entry.name === "string"; }) : [];
          setVersions({ phase: "ready", values: entries, error: "" });
        }).catch(function () {
          setVersions({ phase: "error", values: [], error: "版本列表暂不可读取" });
        });
        return function () { controller.abort(); };
      }, [documentId]);

      function requestEditor() {
        if (!documentId || !health.value || !canOpenOfficeEditor(health.value)) return;
        setEditor({ phase: "loading", value: null, error: "" });
        var controller = new AbortController();
        requestJson("/api/office/documents/" + encodeURIComponent(documentId) + "/editor-config", controller.signal).then(function (value) {
          if (!isOfficeEditorConfig(value)) throw new Error("Office 编辑器配置不完整");
          setEditor({ phase: "ready", value: value, error: "" });
        }).catch(function (error) {
          var unavailable = error && error.body && (error.body.error === "engine_offline" || error.body.error === "callback_bridge_unverified");
          setEditor({ phase: "error", value: null, error: unavailable ? "Office 引擎或回调桥接尚未验证" : "Office 编辑器配置暂不可用" });
        });
      }

      if (health.phase === "loading") return react.createElement(MochiLoading, { text: "Mochi 正在检查 Office 连接" });
      if (health.phase === "error") return react.createElement(
        "section",
        { className: "mochi-workbench__section" },
        react.createElement("div", { className: "mochi-workbench__status", "data-state": "error" }, react.createElement("span", { className: "mochi-workbench__status-dot", "aria-hidden": true }), health.error),
        react.createElement("button", { type: "button", className: "mochi-workbench__button", onClick: refreshHealth }, "重新检查"),
      );

      var safeToOpen = canOpenOfficeEditor(health.value);
      var currentVersion = versions.values.length ? "v" + String(versions.values[versions.values.length - 1].version).padStart(4, "0") : "源文件";
      return react.createElement(
        "section",
        { className: "mochi-workbench__section" },
        react.createElement(
          "div",
          { className: "mochi-workbench__status", "data-state": safeToOpen ? "online" : "offline" },
          react.createElement("span", { className: "mochi-workbench__status-dot", "aria-hidden": true }),
          statusCopy(health.value),
        ),
        !safeToOpen ? react.createElement(
          "div",
          { className: "mochi-workbench__card" },
          react.createElement("h3", null, "编辑器未打开"),
          react.createElement("p", null, "当前不会装载伪编辑器。须同时确认 Office 引擎在线且回调桥接可达，才会加载官方编辑器。"),
          react.createElement("div", { className: "mochi-workbench__actions", style: { marginTop: "10px" } }, react.createElement("button", { type: "button", className: "mochi-workbench__button", onClick: refreshHealth }, "重新检查")),
        ) : null,
        react.createElement(
          "div",
          { className: "mochi-workbench__card" },
          react.createElement("h3", null, "允许的教学文档"),
          health.value.demoIds.length
            ? react.createElement("div", { className: "mochi-workbench__actions" }, health.value.demoIds.map(function (id) {
              return react.createElement("button", { type: "button", key: id, className: "mochi-workbench__button" + (documentId === id ? " mochi-workbench__button--primary" : ""), "aria-pressed": documentId === id, onClick: function () { setDocumentId(id); setEditor({ phase: "idle", value: null, error: "" }); } }, id);
            }))
            : react.createElement("p", null, "服务尚未公布可打开的文档。"),
          documentId ? react.createElement("dl", { className: "mochi-workbench__meta", style: { marginTop: "10px" } }, react.createElement("dt", null, "素材"), react.createElement("dd", null, documentId), react.createElement("dt", null, "当前版本"), react.createElement("dd", null, currentVersion)) : null,
          versions.phase === "ready" && versions.values.length ? react.createElement("div", { className: "mochi-workbench__version-list", "aria-label": "已保存版本" }, versions.values.map(function (entry) { return react.createElement("span", { className: "mochi-workbench__version", key: entry.version }, "v" + String(entry.version).padStart(4, "0")); })) : null,
          versions.error ? react.createElement("p", { className: "mochi-workbench__limit", style: { marginTop: "8px" } }, versions.error) : null,
          safeToOpen && documentId ? react.createElement("div", { className: "mochi-workbench__actions", style: { marginTop: "12px" } }, react.createElement("button", { type: "button", className: "mochi-workbench__button mochi-workbench__button--primary", onClick: requestEditor }, "打开 Office 编辑器")) : null,
        ),
        editor.phase === "loading" ? react.createElement(MochiLoading, { text: "Mochi 正在准备官方编辑器" }) : null,
        editor.phase === "error" ? react.createElement("div", { className: "mochi-workbench__status", "data-state": "error" }, react.createElement("span", { className: "mochi-workbench__status-dot", "aria-hidden": true }), editor.error) : null,
        editor.phase === "ready" ? react.createElement(OnlyOfficeEditor, { response: editor.value, onError: function () { setEditor({ phase: "error", value: null, error: "Office 编辑器脚本暂不可用" }); } }) : null,
        react.createElement("p", { className: "mochi-workbench__limit" }, "Office iframe 与跨域页面都不会把文字内容交给本工作台。"),
      );
    }

    function OnlyOfficeEditor(props) {
      var containerId = react.useRef("mochi-office-editor-" + (++editorSequence));
      react.useEffect(function () {
        var disposed = false;
        var editor = null;
        loadOnlyOfficeScript(props.response.scriptUrl).then(function (DocsAPI) {
          if (disposed) return;
          editor = new DocsAPI.DocEditor(containerId.current, props.response.config);
        }).catch(function () {
          if (!disposed) props.onError();
        });
        return function () {
          disposed = true;
          try { editor && typeof editor.destroyEditor === "function" && editor.destroyEditor(); } catch (_) {}
        };
      }, [props.response.scriptUrl, props.response.config.document.key]);
      return react.createElement("div", { className: "mochi-workbench__office-editor", "aria-label": "ONLYOFFICE 文档编辑器" }, react.createElement("div", { id: containerId.current }));
    }

    function WebPane(props) {
      var modeState = react.useState("local-image");
      var mode = modeState[0];
      var setMode = modeState[1];
      var addressState = react.useState("");
      var address = addressState[0];
      var setAddress = addressState[1];
      var loadedState = react.useState(null);
      var loaded = loadedState[0];
      var setLoaded = loadedState[1];
      var errorState = react.useState("");
      var error = errorState[0];
      var setError = errorState[1];
      var uploadState = react.useState({ phase: "idle", error: "" });
      var upload = uploadState[0];
      var setUpload = uploadState[1];
      var uploadToken = react.useRef(0);

      react.useEffect(function () {
        return function () { uploadToken.current += 1; };
      }, []);

      function openWebPage() {
        var safe = isSafeWebUrl(address);
        if (!safe) {
          setError("仅可打开 https 网页或本机 loopback 地址；不会加载 data、file 或脚本 URL。");
          return;
        }
        setError("");
        setLoaded(safe);
        setMode("iframe");
      }

      async function chooseLocalImage(event) {
        var file = event.target && event.target.files && event.target.files[0];
        if (event.target) event.target.value = "";
        if (!file) return;
        var token = uploadToken.current + 1;
        uploadToken.current = token;
        setUpload({ phase: "loading", error: "" });
        try {
          var artifact = await loadLocalImageArtifact(file);
          if (uploadToken.current !== token) {
            revokeObjectUrl(artifact.objectUrl);
            return;
          }
          props.onImageChange(artifact);
          setMode("local-image");
          setUpload({ phase: "ready", error: "" });
        } catch (loadError) {
          if (uploadToken.current !== token) return;
          setUpload({ phase: "error", error: loadError instanceof Error ? loadError.message : "图片无法安全预览。" });
        }
      }

      return react.createElement(
        "section",
        { className: "mochi-workbench__section" },
        react.createElement(
          "div",
          { className: "mochi-workbench__card" },
          react.createElement("h3", null, "本地图像框选"),
          react.createElement("p", null, "图片只在当前浏览器本地预览。支持 PNG、JPEG、WebP，最大 15 MB、8192 像素边长和 2400 万像素；不会上传或读取文字。"),
          react.createElement("label", { className: "mochi-workbench__field", style: { marginTop: "10px" } }, "选择图片", react.createElement("input", { className: "mochi-workbench__file", type: "file", accept: "image/png,image/jpeg,image/webp", disabled: upload.phase === "loading", onChange: chooseLocalImage })),
          upload.phase === "loading" ? react.createElement(MochiLoading, { text: "Mochi 正在校验本地图像" }) : null,
          upload.phase === "error" ? react.createElement("p", { className: "mochi-workbench__notice", "data-error": "true", "aria-live": "polite" }, upload.error) : null,
        ),
        mode === "iframe" && loaded
          ? react.createElement(
            react.Fragment,
            null,
            react.createElement("div", { className: "mochi-workbench__card" }, react.createElement("p", null, "当前网页在隔离 iframe 中显示，工作台不会读取其内容，也不能据此框选。"), react.createElement("button", { type: "button", className: "mochi-workbench__button", onClick: function () { setMode("local-image"); } }, "回到本地图像")),
            react.createElement("iframe", { className: "mochi-workbench__iframe", title: "网页查看（跨域内容不可读取）", src: loaded, sandbox: "allow-forms allow-popups allow-scripts", referrerPolicy: "no-referrer" }),
          )
          : props.image
            ? react.createElement(LocalImagePreview, { image: props.image })
            : react.createElement("p", { className: "mochi-workbench__limit" }, "选择一张本地图像后，才会显示可框选的真实图像区域。"),
        react.createElement(
          "div",
          { className: "mochi-workbench__card" },
          react.createElement("h3", null, "网页查看"),
          react.createElement("p", null, "网页只有在老师主动输入地址后才会打开。Office iframe 和跨域网页的选区当前尚未接入。"),
          react.createElement("label", { className: "mochi-workbench__field", style: { marginTop: "10px" } }, "网页地址", react.createElement("input", { className: "mochi-workbench__input", value: address, placeholder: "https://…", inputMode: "url", onChange: function (event) { setAddress(event.target.value); } })),
          react.createElement("div", { className: "mochi-workbench__actions", style: { marginTop: "9px" } }, react.createElement("button", { type: "button", className: "mochi-workbench__button", onClick: openWebPage }, "打开网页"), props.image ? react.createElement("button", { type: "button", className: "mochi-workbench__button", onClick: function () { setMode("local-image"); } }, "回到本地图像") : null),
          error ? react.createElement("p", { className: "mochi-workbench__notice", "data-error": "true", style: { marginTop: "7px" } }, error) : null,
        ),
      );
    }

    function LocalImagePreview(props) {
      var selectingState = react.useState(false);
      var selecting = selectingState[0];
      var setSelecting = selectingState[1];
      var dragState = react.useState(null);
      var drag = dragState[0];
      var setDrag = dragState[1];
      var snapshot = react.useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot);
      var frameRef = react.useRef(null);

      function selectPoint(event) {
        return { x: event.clientX, y: event.clientY };
      }

      function startCrop(imageElement, selection) {
        var pending = Object.freeze(Object.assign({}, selection, { crop: Object.freeze({ phase: "loading" }) }));
        replaceSelection(pending, "Mochi 正在生成本机裁图。");
        createLocalCrop(imageElement, pending).then(function (crop) {
          if (workbenchState.open && workbenchState.selection === pending) {
            setWorkbenchState({ selection: Object.freeze(Object.assign({}, pending, { crop: crop })), message: "已在本机生成裁图；尚未加入对话附件。" });
          } else {
            revokeObjectUrl(crop.objectUrl);
          }
        }).catch(function () {
          if (workbenchState.open && workbenchState.selection === pending) {
            setWorkbenchState({ selection: Object.freeze(Object.assign({}, pending, { crop: Object.freeze({ phase: "error" }) })), message: "未能生成本机裁图，未加入对话附件。" });
          }
        });
      }

      function begin(event) {
        if (!selecting || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        var point = selectPoint(event);
        setDrag({ pointerId: event.pointerId, start: point, end: point });
      }

      function move(event) {
        if (!drag || drag.pointerId !== event.pointerId) return;
        setDrag({ pointerId: drag.pointerId, start: drag.start, end: selectPoint(event) });
      }

      function finish(event) {
        if (!drag || drag.pointerId !== event.pointerId) return;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (_) {}
        var selection = selectionFromPreview(event.currentTarget, drag.start, selectPoint(event), props.image);
        setDrag(null);
        setSelecting(false);
        if (!selection) {
          setWorkbenchState({ message: "框选区域过小或图片版本已变更，未保存选择。" });
          return;
        }
        startCrop(event.currentTarget, selection);
      }

      function cancel(event) {
        if (!drag || drag.pointerId !== event.pointerId) return;
        setDrag(null);
        setSelecting(false);
      }

      var indicator = null;
      if (drag && frameRef.current) {
        var bounds = normalizeBounds(drag.start, drag.end, frameRef.current.getBoundingClientRect());
        if (bounds) indicator = react.createElement("span", { className: "mochi-workbench__selection-box", "aria-hidden": true, style: { left: (bounds.left * 100) + "%", top: (bounds.top * 100) + "%", width: (bounds.width * 100) + "%", height: (bounds.height * 100) + "%" } });
      }
      var selectedCurrentImage = snapshot.selection && snapshot.selection.artifactId === props.image.artifactId && snapshot.selection.version === props.image.version;
      return react.createElement(
        react.Fragment,
        null,
        react.createElement(
          "div",
          { className: "mochi-workbench__card" },
          react.createElement("h3", null, "已选择本地图像"),
          react.createElement("p", null, props.image.source.filename + " · " + props.image.source.width + "×" + props.image.source.height + " · SHA-256 " + props.image.source.sha256.slice(0, 16) + "…"),
          react.createElement("div", { className: "mochi-workbench__actions", style: { marginTop: "9px" } }, react.createElement("button", { type: "button", className: "mochi-workbench__button mochi-workbench__button--primary", "aria-pressed": selecting, onClick: function () { setSelecting(!selecting); setDrag(null); } }, selecting ? "取消框选" : "开始框选"), selectedCurrentImage ? react.createElement("button", { type: "button", className: "mochi-workbench__button", onClick: clearSelection }, "清除当前选择") : null),
        ),
        react.createElement(
          "div",
          { className: "mochi-workbench__image-stage" },
          react.createElement(
            "div",
            { ref: frameRef, className: "mochi-workbench__image-frame" },
            react.createElement("img", {
              className: "mochi-workbench__image",
              src: props.image.objectUrl,
              alt: "本地图像预览：" + props.image.source.filename,
              draggable: false,
              "data-selecting": selecting || undefined,
              "data-artifact-id": props.image.artifactId,
              "data-artifact-version": props.image.version,
              "data-artifact-page": String(props.image.page),
              onPointerDown: begin,
              onPointerMove: move,
              onPointerUp: finish,
              onPointerCancel: cancel,
            }),
            indicator,
          ),
        ),
        snapshot.selection && snapshot.selection.crop && snapshot.selection.crop.phase === "loading" ? react.createElement(MochiLoading, { text: "Mochi 正在生成本机裁图" }) : null,
        react.createElement("p", { className: "mochi-workbench__limit", "aria-live": "polite" }, snapshot.message || "框选基于图像实际渲染区域，不含容器留白或 letterbox。"),
      );
    }

    function SelectionPane(props) {
      var selection = props.selection;
      var crop = selection && selection.crop;
      var cropGenerated = !!(crop && crop.phase === "ready");
      var ready = canAttachSelection(selection);
      var delivered = !!(selection && selection.delivery);
      var record = selection
        ? "素材=" + selection.artifactId + "；版本=" + selection.version + "；页=" + selection.page + "；原图=" + selection.source.width + "×" + selection.source.height + "；SHA-256=" + selection.source.sha256 + "；x=" + selection.bounds.left + "，y=" + selection.bounds.top + "，宽=" + selection.bounds.width + "，高=" + selection.bounds.height
        : "尚未选择本地图像中的区域。";
      var status = !selection
        ? "请先在“网页预览”中选择一张本地图像并完成框选。"
        : crop && crop.phase === "loading"
          ? "Mochi 正在生成本机裁图，暂不会改动对话草稿。"
          : crop && crop.phase === "error"
            ? "裁图未生成，未向对话添加附件。"
            : delivered
              ? "裁图已加入当前会话的原生草稿附件，仍未发送。"
              : ready
                ? "裁图已在本机生成；点击后才会加入当前会话的原生草稿附件。"
                : cropGenerated
                  ? "裁图已生成，但超过当前 15 MB 草稿附件上限，未加入对话。"
                  : "裁图尚不可作为附件加入对话。";
      return react.createElement(
        "section",
        { className: "mochi-workbench__section" },
        react.createElement(
          "div",
          { className: "mochi-workbench__card mochi-workbench__selection-summary" },
          react.createElement("h3", null, "框选上下文"),
          react.createElement("p", null, status),
          react.createElement("div", { className: "mochi-workbench__selection-record" }, record),
          cropGenerated ? react.createElement(
            "div",
            { className: "mochi-workbench__crop" },
            react.createElement("img", { className: "mochi-workbench__crop-image", src: crop.objectUrl, alt: "本机生成的框选裁图" }),
            react.createElement("p", { className: "mochi-workbench__limit" }, "裁图 PNG · " + crop.width + "×" + crop.height + " · SHA-256 " + crop.sha256.slice(0, 16) + "…"),
          ) : null,
          react.createElement(
            "label",
            { className: "mochi-workbench__field" },
            "给 Mochi 的补充指令（可选）",
            react.createElement("textarea", {
              className: "mochi-workbench__textarea",
              value: props.instruction,
              maxLength: 1000,
              placeholder: "例如：请根据这个区域拟定课堂讲解提纲。",
              onChange: function (event) { props.onInstruction(event.target.value); },
            }),
          ),
          react.createElement("p", { className: "mochi-workbench__limit" }, "操作只使用当前会话的官方草稿与附件通道，不会自动发送或创建新会话。"),
          react.createElement("div", { className: "mochi-workbench__actions" }, react.createElement("button", { type: "button", className: "mochi-workbench__button mochi-workbench__button--primary", disabled: !ready || delivered, onClick: props.onInsert }, delivered ? "已加入草稿附件" : "加入草稿和裁图"), selection ? react.createElement("button", { type: "button", className: "mochi-workbench__button", onClick: clearSelection }, "清除选择") : null),
        ),
        workbenchState.message ? react.createElement("p", { className: "mochi-workbench__notice", "aria-live": "polite" }, workbenchState.message) : null,
      );
    }

    function createComposerDraftBridge(ctx) {
      return function (selection, instruction) {
        if (!canAttachSelection(selection)) return { ok: false, message: "本机裁图尚未准备好，未改动对话草稿。" };
        var sessionId = workbenchState.sessionId;
        if (!sessionId || !workbenchState.open || ctx.sessions.list.getSnapshot().current !== sessionId || workbenchState.selection !== selection) {
          closeWorkbench();
          return { ok: false, message: "会话或框选已变化，未改动任何草稿。" };
        }
        if (selection.delivery && selection.delivery.sessionId === sessionId) return { ok: false, message: "该裁图已加入当前会话草稿附件。" };
        var sessionContext = ctx.sessions.scope(sessionId);
        var conversation = sessionContext && sessionContext.conversation;
        if (!sessionContext || !conversation || !conversation.input || typeof conversation.input.for !== "function" || typeof conversation.createDraftImages !== "function" || typeof conversation.releaseDraftImages !== "function") {
          return { ok: false, message: "当前会话的官方图片草稿通道不可用。" };
        }
        var input = conversation.input.for(sessionContext);
        if (!input || !input.state || typeof input.setDraft !== "function" || typeof input.addImages !== "function") {
          return { ok: false, message: "当前会话的官方对话输入暂不可用。" };
        }
        if (typeof File !== "function") return { ok: false, message: "当前浏览器无法创建本机裁图附件。" };
        var attachmentFile = new File([selection.crop.blob], "mochi-crop-" + selection.crop.sha256.slice(0, 16) + ".png", { type: "image/png", lastModified: Date.now() });
        var attachments;
        try {
          attachments = conversation.createDraftImages([attachmentFile]);
        } catch (_) {
          return { ok: false, message: "官方图片草稿通道拒绝了该裁图。" };
        }
        var imageIds = Array.prototype.map.call(attachments, function (attachment) { return attachment.id; });
        if (ctx.sessions.list.getSnapshot().current !== sessionId || workbenchState.selection !== selection) {
          conversation.releaseDraftImages(attachments);
          closeWorkbench();
          return { ok: false, message: "会话或框选已变化，未改动任何草稿。" };
        }
        if (!input.addImages(imageIds)) {
          conversation.releaseDraftImages(attachments);
          return { ok: false, message: "当前草稿正忙，裁图未加入附件。" };
        }
        try {
          var existing = input.state.getSnapshot();
          var nextDraft = appendSelectionToDraft(existing && existing.draft, selection, instruction, true);
          if (!nextDraft) throw new Error("empty selection context");
          input.setDraft(nextDraft);
        } catch (_) {
          imageIds.forEach(function (id) {
            try { input.removeImage && input.removeImage(id); } catch (_) {}
          });
          conversation.releaseDraftImages(attachments);
          return { ok: false, message: "无法更新当前草稿，已撤回刚注册的裁图附件。" };
        }
        setWorkbenchState({
          selection: Object.freeze(Object.assign({}, selection, {
            delivery: Object.freeze({ sessionId: sessionId, attachmentIds: Object.freeze(imageIds.slice()) }),
          })),
        });
        return { ok: true, message: "已把裁图与框选上下文加入当前会话草稿，尚未发送。" };
      };
    }

    function installSessionSwitchGuard(ctx) {
      function reconcile() {
        var current = ctx.sessions.list.getSnapshot().current || null;
        if (workbenchState.open && workbenchState.sessionId !== current) closeWorkbench();
      }
      var dispose = ctx.sessions.list.subscribe(reconcile);
      reconcile();
      return dispose;
    }

    function apply(ctx) {
      composerDraftBridge = createComposerDraftBridge(ctx);
      ctx.effect(function () { return installStyles(); }, "mochi-workbench: styles");
      ctx.effect(function () { return installSessionSwitchGuard(ctx); }, "mochi-workbench: session guard");
      ctx.effect(function () {
        return function () {
          if (composerDraftBridge) composerDraftBridge = null;
          closeWorkbench();
        };
      }, "mochi-workbench: lifecycle");
      ctx.effect(function () {
        if (!ctx.betterSidebar || typeof ctx.betterSidebar.registerTab !== "function") return function () {};
        betterSidebarService = ctx.betterSidebar;
        var disposeTab = ctx.betterSidebar.registerTab({
          id: "mochi-workbench:panel",
          title: "工作台",
          order: 5,
          single: true,
          component: WorkbenchSidebarTab,
        });
        return function () {
          disposeTab();
          betterSidebarService = null;
        };
      }, "mochi-workbench: sidebar tab");
      ctx.slots.inject("conversation.session.header.actions", function* () {
        yield ctx.slots.register({ name: "conversation.session.header.actions", id: "mochi-workbench-toggle", order: 30 }, WorkbenchHeaderAction);
      });
    }

    module.exports.apply = apply;
    module.exports.inject = ["slots", "sessions", "conversation", "betterSidebar"];
    module.exports.__test = {
      OFFICE_API_ORIGIN: OFFICE_API_ORIGIN,
      MAX_CROP_PIXELS: MAX_CROP_PIXELS,
      MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
      MAX_IMAGE_DIMENSION: MAX_IMAGE_DIMENSION,
      MAX_IMAGE_PIXELS: MAX_IMAGE_PIXELS,
      appendSelectionToDraft: appendSelectionToDraft,
      buildLocalImageArtifact: buildLocalImageArtifact,
      canAttachSelection: canAttachSelection,
      canOpenOfficeEditor: canOpenOfficeEditor,
      createComposerDraftBridge: createComposerDraftBridge,
      cropOutputSize: cropOutputSize,
      imageFileError: imageFileError,
      isOfficeEditorConfig: isOfficeEditorConfig,
      isOfficeHealth: isOfficeHealth,
      isSupportedImageFile: isSupportedImageFile,
      isSafeWebUrl: isSafeWebUrl,
      normalizeBounds: normalizeBounds,
      openWorkbench: openWorkbench,
      closeWorkbench: closeWorkbench,
      getWorkbenchSnapshot: getWorkbenchSnapshot,
      setWorkbenchState: setWorkbenchState,
      selectionPixelRect: selectionPixelRect,
      selectionFromPreview: selectionFromPreview,
      selectionContextText: selectionContextText,
    };
    return module.exports;
  },
});
