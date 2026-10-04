import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");

function loadClient() {
  const factories = new Map();
  let openError = "";
  const registered = [];
  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children: children.length > 1 ? children : children[0] } };
    },
    useState() { return [openError, (value) => { openError = value; }]; },
  };
  const sandbox = {
    Object,
    Array,
    JSON,
    String,
    Promise,
    window: { __ModuleLoader__: { load(entry) { factories.set(entry.id, entry.factory); } } },
  };
  vm.runInNewContext(source, sandbox, { filename: "mochi-presentations/client.js" });
  const factory = factories.get("mochi-presentations");
  assert.ok(factory, "client registers with the DSH ModuleLoader");
  const plugin = factory((name) => {
    if (name === "react") return React;
    throw new Error(`unexpected dependency: ${name}`);
  });
  assert.deepEqual(Array.from(plugin.inject), ["slots"]);
  plugin.apply({
    slots: {
      inject(name, callback) {
        assert.equal(name, "tool.call.toolview");
        for (const register of callback()) registered.push(register);
      },
      register(descriptor, component) { return { descriptor, component }; },
    },
  });
  return { plugin, registered, React, getOpenError: () => openError };
}

function block(tool, result) {
  return {
    kind: "tool-result",
    isError: false,
    content: [{ type: "text", text: JSON.stringify({ tool, 完成: true, 产物: result }) }],
  };
}

function renderButtons(component, toolName, result, openFile = () => {}) {
  const view = component({ toolName, block: result, openFile });
  const flatten = (value) => Array.isArray(value) ? value.flatMap(flatten) : value == null ? [] : [value];
  const children = flatten(view.props.children);
  return { view, children, buttons: children.filter((child) => child?.type === "button") };
}

test("registers a keyed view only for create and revise", () => {
  const { registered } = loadClient();
  assert.deepEqual(registered.map(({ descriptor }) => descriptor.key), ["mochi_ppt_create", "mochi_ppt_revise"]);
  assert.ok(registered.every(({ descriptor }) => descriptor.name === "tool.call.toolview"));
});

test("create and revise show PDF and editable PPTX buttons for validated absolute paths", () => {
  const { plugin } = loadClient();
  for (const toolName of ["mochi_ppt_create", "mochi_ppt_revise"]) {
    const { view, buttons } = renderButtons(plugin.__test.PresentationToolRow, toolName,
      block(toolName, { pptx: "/workspace/lesson.pptx", previewPdf: "/workspace/lesson-preview.pdf" }));
    assert.equal(view.props["data-state"], "ready");
    assert.deepEqual(buttons.map((button) => button.props.children), ["打开课件预览 PDF", "获取可编辑 PPTX"]);
  }
});

test("omits the preview button when previewPdf is absent", () => {
  const { plugin } = loadClient();
  const { buttons } = renderButtons(plugin.__test.PresentationToolRow, "mochi_ppt_create",
    block("mochi_ppt_create", { pptx: "/workspace/lesson.pptx", previewPdf: null }));
  assert.deepEqual(buttons.map((button) => button.props.children), ["获取可编辑 PPTX"]);
});

test("running, failed, malformed, and unsafe results expose clear status without file buttons", () => {
  const { plugin } = loadClient();
  const row = plugin.__test.PresentationToolRow;
  const cases = [
    [{ kind: "tool-call" }, "running", "课件正在生成，完成后可打开文件。"],
    [{ kind: "tool-result", isError: true, error: { code: "FAILED" }, content: [] }, "failed", "课件生成失败，未提供打开入口。"],
    [{ kind: "tool-result", isError: false, content: [{ type: "text", text: "{" }] }, "invalid", "课件结果无法识别，未提供打开入口。"],
    [block("mochi_ppt_create", { pptx: "../../outside.pptx" }), "invalid", "课件结果无法识别，未提供打开入口。"],
    [block("mochi_ppt_revise", { pptx: "/workspace/a.pptx", previewPdf: "relative.pdf" }), "invalid", "课件结果无法识别，未提供打开入口。"],
  ];
  for (const [result, state, status] of cases) {
    const { view, children, buttons } = renderButtons(row, "mochi_ppt_create", result);
    assert.equal(view.props["data-state"], state);
    assert.equal(buttons.length, 0);
    assert.equal(children[0].props.children, status);
  }
});

test("button callbacks open only their validated paths and report callback errors", async () => {
  const { plugin, getOpenError } = loadClient();
  const paths = [];
  const { buttons } = renderButtons(plugin.__test.PresentationToolRow, "mochi_ppt_revise",
    block("mochi_ppt_revise", { pptx: "C:\\Lessons\\lesson.pptx", previewPdf: "C:\\Lessons\\lesson.pdf" }),
    (path) => { paths.push(path); });
  buttons[0].props.onClick();
  buttons[1].props.onClick();
  assert.deepEqual(paths, ["C:\\Lessons\\lesson.pdf", "C:\\Lessons\\lesson.pptx"]);

  const throwing = renderButtons(plugin.__test.PresentationToolRow, "mochi_ppt_create",
    block("mochi_ppt_create", { pptx: "/workspace/lesson.pptx" }), () => { throw new Error("denied"); });
  throwing.buttons[0].props.onClick();
  assert.equal(getOpenError(), "无法打开文件，请在工作区文件列表中查看。");

  let reject;
  const rejecting = renderButtons(plugin.__test.PresentationToolRow, "mochi_ppt_create",
    block("mochi_ppt_create", { pptx: "/workspace/lesson.pptx" }), () => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
  rejecting.buttons[0].props.onClick();
  reject(new Error("denied"));
  await Promise.resolve();
  assert.equal(getOpenError(), "无法打开文件，请在工作区文件列表中查看。");
});
