window.__ModuleLoader__.load({
  id: "mochi-presentations",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");

    var TOOL_NAMES = Object.freeze(["mochi_ppt_create", "mochi_ppt_revise"]);

    function absolutePath(value) {
      return typeof value === "string"
        && (value.startsWith("/") || /^[A-Za-z]:[/\\]/.test(value) || value.startsWith("\\\\"))
        && !value.includes("\0");
    }

    function resultModel(toolName, block) {
      if (!TOOL_NAMES.includes(toolName)) return { state: "unsupported", files: [] };
      if (!block || block.kind !== "tool-result") return { state: "running", files: [] };
      if (block.isError === true || block.error) return { state: "failed", files: [] };
      if (block.isError !== false || !Array.isArray(block.content) || block.content.length !== 1
        || block.content[0]?.type !== "text" || typeof block.content[0].text !== "string") {
        return { state: "invalid", files: [] };
      }

      var result;
      try {
        result = JSON.parse(block.content[0].text);
      } catch {
        return { state: "invalid", files: [] };
      }
      if (!result || typeof result !== "object" || Array.isArray(result)
        || result.tool !== toolName || result["完成"] !== true
        || !result["产物"] || typeof result["产物"] !== "object" || Array.isArray(result["产物"])
        || !absolutePath(result["产物"].pptx)) {
        return { state: "invalid", files: [] };
      }

      var previewPdf = result["产物"].previewPdf;
      if (previewPdf !== undefined && previewPdf !== null && previewPdf !== "" && !absolutePath(previewPdf)) {
        return { state: "invalid", files: [] };
      }
      var files = [];
      if (typeof previewPdf === "string" && previewPdf.length > 0) {
        files.push({ label: "打开课件预览 PDF", path: previewPdf });
      }
      files.push({ label: "获取可编辑 PPTX", path: result["产物"].pptx });
      return { state: "ready", files: files };
    }

    function statusText(state) {
      if (state === "running") return "课件正在生成，完成后可打开文件。";
      if (state === "failed") return "课件生成失败，未提供打开入口。";
      if (state === "invalid") return "课件结果无法识别，未提供打开入口。";
      return "";
    }

    function PresentationToolRow(props) {
      var owner = props.owner || props;
      var model = resultModel(owner.toolName, owner.block);
      var statePair = React.useState("");
      var openError = statePair[0];
      var setOpenError = statePair[1];
      var status = openError || statusText(model.state);

      function openFile(file) {
        setOpenError("");
        try {
          const result = owner.openFile(file.path);
          if (result && typeof result.then === "function") {
            result.catch(function () { setOpenError("无法打开文件，请在工作区文件列表中查看。"); });
          }
        } catch {
          setOpenError("无法打开文件，请在工作区文件列表中查看。");
        }
      }

      return React.createElement("section", {
        className: "mochi-presentation-tool-card",
        "data-tool": owner.toolName,
        "data-state": model.state,
      },
      status ? React.createElement("p", { role: "status" }, status) : null,
      model.files.map(function (file) {
        return React.createElement("button", {
          key: file.label,
          type: "button",
          onClick: function () { openFile(file); },
        }, file.label);
      }));
    }

    PresentationToolRow.__test = { absolutePath: absolutePath, resultModel: resultModel, statusText: statusText };

    return {
      name: "mochi-presentations-client",
      inject: ["slots"],
      apply: function (ctx) {
        ctx.slots.inject("tool.call.toolview", function () {
          return TOOL_NAMES.map(function (toolName) {
            return ctx.slots.register({ name: "tool.call.toolview", key: toolName }, PresentationToolRow);
          });
        });
      },
      __test: { PresentationToolRow: PresentationToolRow, resultModel: resultModel },
    };
  },
});
