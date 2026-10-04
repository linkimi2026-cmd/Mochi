window.__ModuleLoader__.load({id:"mochi-onboarding",factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client-entry.mjs
var client_entry_exports = {};
__export(client_entry_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_entry_exports);
var import_react2 = __toESM(require("react"), 1);

// steps.mjs
var STEP_IDS = ["identity", "account", "chat", "input", "mail", "work", "settings"];
var GUIDE_VERSION = 2;
function guideSteps(role) {
  const teacher = role === "teacher", classroom = role === "classroom";
  return [
    {
      id: "identity",
      title: teacher ? "\u5148\u8BA9 Mochi \u8BA4\u8BC6\u4F60" : classroom ? "\u5148\u8BA4\u8BC6\u8FD9\u4E2A\u73ED\u7684\u5C0F\u4F19\u4F34" : "\u5148\u786E\u8BA4\u8EAB\u4EFD\u4E0E\u79F0\u547C",
      sketch: "pair",
      text: teacher ? "\u5728\u201C\u8BBE\u5907\u4E0E\u8FDE\u63A5\u201D\u586B\u5199\u4F60\u5E0C\u671B Mochi \u600E\u4E48\u79F0\u547C\u4F60\uFF0C\u518D\u6838\u5BF9\u5B66\u6821\u4E0E\u672C\u673A\u6559\u5E08\u8EAB\u4EFD\u3002\u79F0\u547C\u53EF\u4EE5\u968F\u65F6\u6539\u3002" : classroom ? "\u5728\u201C\u8BBE\u5907\u4E0E\u8FDE\u63A5\u201D\u586B\u5199\u73ED\u7EA7\u79F0\u547C\uFF0C\u518D\u6838\u5BF9\u5B66\u6821\u3001\u73ED\u7EA7\u4E0E\u6559\u5BA4\u8EAB\u4EFD\u3002\u6559\u5E08\u4E2A\u4EBA\u79F0\u547C\u5728\u6559\u5E08\u7AEF\u586B\u5199\u3002" : "\u672C\u673A\u89D2\u8272\u7531\u684C\u9762\u9501\u5B9A\u3002\u5230\u201C\u8BBE\u5907\u4E0E\u8FDE\u63A5\u201D\u786E\u8BA4\u8EAB\u4EFD\u548C\u79F0\u547C\uFF0C\u8D44\u6599\u6682\u65F6\u4E0D\u8DB3\u4E5F\u53EF\u4EE5\u7A0D\u540E\u8865\u3002",
      note: "\u586B\u5199\u79F0\u547C\u4E0D\u7B49\u4E8E\u6821\u56ED\u8D26\u53F7\u5DF2\u8BA4\u8BC1\u3002",
      actions: [["identity", "\u8BBE\u7F6E\u79F0\u547C\u4E0E\u8EAB\u4EFD"]]
    },
    {
      id: "account",
      title: "\u767B\u5F55\u771F\u6B63\u7684\u6821\u56ED\u8D26\u53F7",
      sketch: "pair",
      text: "\u6253\u5F00\u8BBE\u7F6E\u91CC\u7684\u201C\u767B\u5F55\u6821\u56ED\u8D26\u53F7\u201D\u3002\u5728\u5B9E\u9645\u767B\u5F55\u9875\u9762\u9A8C\u8BC1\u8D26\u53F7\uFF1B\u5FD8\u8BB0\u5BC6\u7801\u6216\u6743\u9650\u4E0D\u7B26\u65F6\uFF0C\u6309\u5B66\u6821\u7684\u8D26\u53F7\u6D41\u7A0B\u5904\u7406\u3002",
      note: "\u6307\u5357\u4E0D\u4F1A\u66FF\u4F60\u767B\u5F55\uFF0C\u4E5F\u4E0D\u4F1A\u628A\u770B\u8FC7\u8FD9\u4E00\u6B65\u5F53\u4F5C\u8BA4\u8BC1\u6210\u529F\u3002",
      actions: [["account", "\u627E\u5230\u6821\u56ED\u8D26\u53F7\u5165\u53E3"]]
    },
    {
      id: "chat",
      title: "\u5148\u4ECE\u4E00\u4E2A\u65B0\u5BF9\u8BDD\u5F00\u59CB",
      sketch: "input",
      text: teacher ? "\u65B0\u5BF9\u8BDD\u9ED8\u8BA4\u4F7F\u7528\u901A\u7528 Mochi\u3002\u5907\u8BFE\u4E0E\u8BFE\u4EF6\u3001\u8D44\u6599\u4E0E\u8BD5\u5377\u3001\u6210\u7EE9\u5206\u6790\u3001\u73ED\u7EA7\u4E0E\u6559\u5BA4\u56DB\u4E2A\u4E13\u95E8\u52A9\u624B\u6309\u9700\u8981\u9009\u62E9\uFF1B\u5207\u6362\u4E0D\u4F1A\u66FF\u4F60\u53D1\u9001\u6D88\u606F\u3002" : "\u5148\u5728\u65B0\u5BF9\u8BDD\u91CC\u544A\u8BC9 Mochi \u4F60\u60F3\u505A\u4EC0\u4E48\u3002\u5199\u597D\u540E\u518D\u70B9\u53D1\u9001\uFF1B\u9047\u5230\u5185\u5BB9\u4E0D\u51C6\u786E\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u8865\u5145\u6216\u7EA0\u6B63\u3002",
      note: "\u5DF2\u6709\u5BF9\u8BDD\u7684\u5185\u5BB9\u4F1A\u4FDD\u7559\uFF1B\u8FD9\u91CC\u53EA\u6253\u5F00\u8F6F\u4EF6\u539F\u6709\u7684\u65B0\u5EFA\u4F1A\u8BDD\u5165\u53E3\u3002",
      actions: [["chat", "\u6253\u5F00\u65B0\u5BF9\u8BDD"]]
    },
    {
      id: "input",
      title: "\u9009\u4E00\u79CD\u5408\u9002\u7684\u8F93\u5165\u65B9\u5F0F",
      sketch: "input",
      text: "\u6587\u5B57\u3001\u201C\u8BED\u97F3\u8F93\u5165\u201D\u548C\u201C\u62CD\u9898\u201D\u5148\u653E\u8FDB\u8349\u7A3F\uFF0C\u68C0\u67E5\u540E\u518D\u53D1\u9001\u3002\u201C\u8BED\u97F3\u5BF9\u8BDD\u201D\u9700\u4E3B\u52A8\u5F00\u542F\uFF0C\u4F1A\u628A\u8BC6\u522B\u5185\u5BB9\u63D0\u4EA4\u5F53\u524D\u5BF9\u8BDD\uFF0C\u7ED3\u675F\u540E\u505C\u6B62\u3002",
      note: "\u9996\u6B21\u4F7F\u7528\u9EA6\u514B\u98CE\u6216\u6444\u50CF\u5934\u9700\u7CFB\u7EDF\u6388\u6743\u3002\u6CA1\u6709\u5F53\u524D\u4F1A\u8BDD\u65F6\uFF0C\u5148\u65B0\u5EFA\u4E00\u4E2A\u5BF9\u8BDD\u3002",
      actions: [["composer", "\u627E\u5230\u8F93\u5165\u6846"], ["voice", "\u627E\u5230\u8BED\u97F3\u8F93\u5165"], ["voicechat", "\u627E\u5230\u8BED\u97F3\u5BF9\u8BDD"], ["camera", "\u627E\u5230\u62CD\u9898\u6309\u94AE"]]
    },
    {
      id: "mail",
      title: "\u4ECE\u5C0F\u4FE1\u7BB1\u770B\u4E00\u5C01\u771F\u5B9E\u7EB8\u6761",
      sketch: "letter",
      text: "\u6253\u5F00\u201C\u5C0F\u4FE1\u7BB1\u201D\u67E5\u770B\u901A\u77E5\u548C\u56DE\u6267\u3002\u8BBE\u5907\u914D\u5BF9\u5148\u6838\u5BF9\u5B66\u6821\u3001\u5BF9\u65B9\u8EAB\u4EFD\u4E0E\u6307\u7EB9\uFF1B\u9644\u8FD1\u53D1\u73B0\u3001\u5DF2\u914D\u5BF9\u548C\u5B9E\u9645\u9001\u8FBE\u662F\u4E0D\u540C\u72B6\u6001\u3002",
      note: teacher ? "\u9700\u8981\u53D1\u9001\u901A\u77E5\u65F6\uFF0C\u5728\u5BF9\u8BDD\u4E2D\u8BF4\u660E\u73ED\u7EA7\u4E0E\u5185\u5BB9\uFF0C\u7531 Mochi \u5C55\u793A\u540E\u786E\u8BA4\u3002" : "\u6559\u5BA4\u6536\u5230\u6559\u5E08\u914D\u5BF9\u7533\u8BF7\u540E\uFF0C\u6838\u5BF9\u65E0\u8BEF\u518D\u63A5\u53D7\uFF1B\u53EF\u4EE5\u628A\u5C4F\u4E0A\u7684\u4E34\u65F6\u4EE3\u7801\u544A\u8BC9\u8001\u5E08\u3002",
      actions: [["mail", "\u6253\u5F00\u5C0F\u4FE1\u7BB1"]]
    },
    {
      id: "work",
      title: teacher ? "\u6309\u6821\u56ED\u6743\u9650\u8FDB\u5165\u5DE5\u4F5C" : classroom ? "\u51C6\u5907\u597D\u4E00\u8282\u8BFE\u7684\u966A\u4F34" : "\u627E\u5230\u672C\u673A\u7684\u5DE5\u4F5C\u5165\u53E3",
      sketch: "letter",
      text: teacher ? "\u767B\u5F55\u4E14\u5177\u5907\u76F8\u5E94\u6743\u9650\u540E\uFF0C\u5C55\u5F00\u201C\u6821\u56ED\u5DE5\u4F5C\u201D\u8FDB\u5165\u5B9E\u9645\u4E8B\u52A1\u9875\u9762\u3002\u5148\u770B\u5F53\u524D\u72B6\u6001\uFF0C\u518D\u6309\u9875\u9762\u63D0\u793A\u5904\u7406\uFF1B\u6CA1\u6709\u5165\u53E3\u65F6\u5148\u68C0\u67E5\u8D26\u53F7\u6743\u9650\u3002" : classroom ? "\u5728\u201C\u8BFE\u5802\u52A9\u624B\u201D\u67E5\u770B\u672C\u5730\u76D1\u542C\u72B6\u6001\uFF0C\u8BF4\u201C\u5F00\u59CB\u4E0A\u8BFE\u201D\u6536\u96C6\u672C\u8282\u5185\u5BB9\u3001\u8BF4\u201C\u8FD9\u8282\u8BFE\u7ED3\u675F\u201D\u751F\u6210\u53EF\u7F16\u8F91\u4FE1\u4EF6\uFF1B\u5728\u201C\u8BFE\u5802\u7BA1\u5BB6\u201D\u5BFC\u5165\u8BFE\u8868\u5E76\u68C0\u67E5\u65F6\u95F4\u3002" : "\u8EAB\u4EFD\u670D\u52A1\u5C1A\u672A\u63D0\u4F9B\u9501\u5B9A\u89D2\u8272\u3002\u8BF7\u5148\u56DE\u201C\u8BBE\u5907\u4E0E\u8FDE\u63A5\u201D\u6838\u5BF9\uFF1B\u5165\u53E3\u4E0D\u53EF\u7528\u65F6\u6307\u5357\u4F1A\u660E\u786E\u8BF4\u660E\u3002",
      note: teacher ? "\u767B\u5F55\u3001\u6388\u6743\u548C\u63D0\u4EA4\u90FD\u5728\u539F\u9875\u9762\u5B8C\u6210\uFF0C\u6307\u5357\u4E0D\u4EE3\u66FF\u8FD9\u4E9B\u7ED3\u679C\u3002" : "\u8BFE\u8868\u4E0E\u8BC6\u522B\u6A21\u578B\u9700\u5B9E\u9645\u51C6\u5907\u597D\uFF1B\u8F6F\u4EF6\u5173\u95ED\u6216\u5173\u673A\u671F\u95F4\u4E0D\u4F1A\u6267\u884C\u63D0\u9192\u3002",
      actions: teacher ? [["campus", "\u627E\u5230\u6821\u56ED\u5DE5\u4F5C"]] : classroom ? [["listening", "\u6253\u5F00\u8BFE\u5802\u52A9\u624B"], ["planner", "\u6253\u5F00\u8BFE\u8868"]] : [["identity", "\u6838\u5BF9\u672C\u673A\u8EAB\u4EFD"]]
    },
    {
      id: "settings",
      title: "\u628A Mochi \u8C03\u6210\u559C\u6B22\u7684\u6837\u5B50",
      sketch: "letter",
      text: "\u8BBE\u7F6E\u91CC\u53EF\u4EE5\u8C03\u6574\u5916\u89C2\u4E0E Mochi \u672C\u4F53\u989C\u8272\u3002\u8BB0\u5FC6\u56DE\u770B\u53EA\u5C55\u793A\u5B9E\u9645\u4FDD\u5B58\u7684\u8D44\u6599\uFF1B\u79F0\u547C\u3001\u73ED\u7EA7\u7279\u8D28\u548C\u966A\u4F34\u5F00\u59CB\u65E5\u671F\u90FD\u53EF\u56DE\u539F\u5165\u53E3\u4FEE\u6539\u3002",
      note: "\u9996\u6B21\u4E03\u6B65\u5B8C\u6210\u540E\u4E0D\u518D\u81EA\u52A8\u51FA\u73B0\u3002\u60F3\u91CD\u65B0\u770B\uFF0C\u70B9\u4FA7\u680F\u7684\u201C\u65B0\u624B\u6307\u5F15\u201D\u3002",
      actions: [["settings", "\u6253\u5F00\u8BBE\u7F6E"], ["memory", "\u6253\u5F00\u8BB0\u5FC6\u56DE\u770B"]]
    }
  ];
}
function normalizeProgress(snapshot) {
  const value = snapshot?.value;
  const current = value?.version === GUIDE_VERSION;
  return {
    ready: snapshot?.status === "ready",
    persistent: snapshot?.mode === "host" && snapshot?.writable === true,
    status: current && value?.status === "complete" ? "complete" : "new",
    step: current && STEP_IDS.includes(value?.step) ? value.step : STEP_IDS[0]
  };
}
function guideGeometry({ width, height, composerTop, headerBottom = 64 }) {
  const top = Math.max(16, headerBottom + 14), bottom = Math.min(height - 20, Number.isFinite(composerTop) ? composerTop - 12 : height - 160);
  return { top, right: 18, width: Math.max(140, Math.min(300, width - 36)), maxHeight: Math.max(0, Math.min(470, bottom - top)), hidden: bottom - top < 90 };
}

// navigation.mjs
var visible = (node) => node && !node.disabled && node.getClientRects().length > 0 && !node.closest("[hidden],[inert]");
var first = (document2, selector) => [...document2.querySelectorAll(selector)].find(visible);
function locateGuideTarget(document2, action) {
  const selectors = {
    chat: '[data-slot="sidebar"] button[aria-label="\u65B0\u5EFA\u4F1A\u8BDD"],button[aria-label="\u65B0\u5EFA\u4F1A\u8BDD"]',
    composer: '[data-conversation-content] [contenteditable="true"]',
    voice: '[data-conversation-content] button[aria-label="\u5F00\u59CB\u5F55\u97F3"],[data-conversation-content] button[aria-label="\u6253\u5F00\u8BED\u97F3\u8F93\u5165\u5F15\u5BFC"]',
    voicechat: '[data-conversation-content] button[aria-label="\u5F00\u542F\u8BED\u97F3\u5BF9\u8BDD"]',
    camera: '[data-conversation-content] button[aria-label="\u6444\u50CF\u5934\u6216\u5C55\u53F0\u62CD\u9898"]',
    mail: '[data-slot="sidebar.footer.action"] button[aria-label^="\u5C0F\u4FE1\u7BB1\uFF0C"]',
    campus: 'button[aria-label="\u5C55\u5F00\u6821\u56ED\u5DE5\u4F5C\u5165\u53E3"],button[aria-label="\u6536\u8D77\u6821\u56ED\u5DE5\u4F5C\u5165\u53E3"]',
    listening: '[data-slot="sidebar.footer.action"] button[data-mochi-classroom-status]',
    planner: '[data-slot="sidebar.footer.action"] button[aria-label="\u8BFE\u5802\u7BA1\u5BB6"]'
  };
  if (action === "settings" || action === "account") {
    const trigger = document2.querySelector('[data-slot="settings.trigger"]')?.closest("button");
    return visible(trigger) ? trigger : null;
  }
  return selectors[action] ? first(document2, selectors[action]) ?? null : null;
}
var TARGET_HINTS = {
  chat: "\u6CA1\u6709\u627E\u5230\u65B0\u5EFA\u4F1A\u8BDD\u6309\u94AE\uFF0C\u8BF7\u5C55\u5F00\u5DE6\u4FA7\u680F\u540E\u518D\u8BD5\u3002",
  composer: "\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u8F93\u5165\u6846\uFF0C\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u65B0\u5BF9\u8BDD\u3002",
  voice: "\u5F53\u524D\u6CA1\u6709\u8BED\u97F3\u8F93\u5165\u5165\u53E3\uFF0C\u8BF7\u5148\u6253\u5F00\u5BF9\u8BDD\uFF1B\u82E5\u4ECD\u6CA1\u6709\uFF0C\u68C0\u67E5\u672C\u5730\u8BC6\u522B\u670D\u52A1\u4E0E\u63D2\u4EF6\u72B6\u6001\u3002",
  voicechat: "\u5F53\u524D\u6CA1\u6709\u8BED\u97F3\u5BF9\u8BDD\u5165\u53E3\uFF0C\u8BF7\u5148\u6253\u5F00\u5BF9\u8BDD\uFF1B\u82E5\u4ECD\u6CA1\u6709\uFF0C\u68C0\u67E5\u8BED\u97F3\u5BF9\u8BDD\u63D2\u4EF6\u4E0E\u672C\u5730\u8BC6\u522B\u670D\u52A1\u3002",
  camera: "\u5F53\u524D\u6CA1\u6709\u62CD\u9898\u5165\u53E3\uFF0C\u8BF7\u5148\u6253\u5F00\u5BF9\u8BDD\uFF1B\u82E5\u4ECD\u6CA1\u6709\uFF0C\u68C0\u67E5\u6444\u50CF\u5934\u63D2\u4EF6\u662F\u5426\u542F\u7528\u3002",
  mail: "\u5F53\u524D\u6CA1\u6709\u5C0F\u4FE1\u7BB1\u5165\u53E3\uFF0C\u8BF7\u68C0\u67E5\u672C\u673A\u6821\u56ED\u8FDE\u63A5\u529F\u80FD\u662F\u5426\u542F\u7528\u3002",
  campus: "\u6821\u56ED\u5DE5\u4F5C\u5165\u53E3\u8FD8\u4E0D\u53EF\u7528\u3002\u5148\u767B\u5F55\u6821\u56ED\u8D26\u53F7\uFF0C\u518D\u6838\u5BF9\u73ED\u4E3B\u4EFB\u6743\u9650\u4E0E\u5BC6\u7801\u8BBE\u7F6E\u3002",
  listening: "\u5F53\u524D\u6CA1\u6709\u8BFE\u5802\u52A9\u624B\u5165\u53E3\uFF0C\u8BF7\u5148\u786E\u8BA4\u8FD9\u662F\u6559\u5BA4\u7AEF\u5E76\u68C0\u67E5\u672C\u5730\u76D1\u542C\u529F\u80FD\u3002",
  planner: "\u5F53\u524D\u6CA1\u6709\u8BFE\u8868\u5165\u53E3\uFF0C\u8BF7\u5148\u786E\u8BA4\u8FD9\u662F\u6559\u5BA4\u7AEF\u5E76\u68C0\u67E5\u8BFE\u5802\u7BA1\u5BB6\u529F\u80FD\u3002",
  settings: "\u6CA1\u6709\u627E\u5230\u8BBE\u7F6E\u5165\u53E3\uFF0C\u8BF7\u5C55\u5F00\u5DE6\u4FA7\u680F\u540E\u518D\u8BD5\u3002",
  account: "\u6CA1\u6709\u627E\u5230\u6821\u56ED\u8D26\u53F7\u5165\u53E3\uFF0C\u8BF7\u5148\u6253\u5F00\u8BBE\u7F6E\u7684\u201C\u901A\u7528\u201D\u3002"
};

// sidebar-action.mjs
var import_react = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var sidebarIcons = { memory: import_dsh_client_ui_primitives.IconArchiveOutlineRegular, planner: import_dsh_client_ui_primitives.IconClockOutlineRegular, guide: import_dsh_client_ui_primitives.IconQuestionOutlineRegular };
function SidebarAction({ wide = true, label, description, icon: Icon, onClick }) {
  const button = import_react.default.createElement(import_dsh_client_ui_primitives.Button, {
    type: "button",
    variant: "ghost",
    size: "md",
    onClick,
    "aria-label": description,
    title: description,
    "data-mochi-sidebar-action": label,
    "data-wide": String(wide),
    style: {
      width: wide ? "100%" : 36,
      minWidth: wide ? 0 : 36,
      height: 36,
      padding: wide ? "0 8px" : 0,
      justifyContent: wide ? "flex-start" : "center",
      flexShrink: 0,
      whiteSpace: "nowrap",
      borderRadius: wide ? 12 : "50%"
    },
    icon: import_react.default.createElement(Icon, { size: 18, "aria-hidden": true })
  }, wide ? import_react.default.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, label) : null);
  return import_react.default.createElement(import_dsh_client_ui_primitives.Tooltip, { label: description, side: "right", portal: true, disabled: wide }, button);
}

// client-entry.mjs
var h = import_react2.default.createElement;
var inject = ["slots", "configForms"];
function Sketch({ kind }) {
  const paths = kind === "input" ? ["M10 12h120v50H10z", "M20 24h64M20 34h80M20 44h46", "M112 48l6-6 6 6M118 42v13"] : kind === "pair" ? ["M12 14h42v40H12zM94 14h42v40H94z", "M64 27h20M79 22l5 5-5 5M84 41H64M69 36l-5 5 5 5", "M23 61h20M105 61h20"] : ["M24 10h88v54H24z", "M36 25h64M36 35h54M36 45h40", "M112 54l12-6v16l-12-6"];
  return h(
    "svg",
    { viewBox: "0 0 148 72", className: "mochi-guide-sketch", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false },
    ...paths.map((d, index) => h("path", { key: index, d }))
  );
}
function apply(ctx) {
  const form = ctx.configForms.get("mochi-onboarding");
  let opened = false, step = "identity", busy = false, message = "", profile = null, profileFailed = false;
  let profileGate = false, coordinator = null, firstStarted = false, disposed = false, compact = false, anchor = null, required = true, modalVisible = false;
  let campus = window.mochiCampusIdentitySnapshot ?? { status: "unknown" };
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => listeners.forEach((listener) => listener());
  const progress = () => normalizeProgress(form.getSnapshot());
  const useState = () => {
    const [, force] = import_react2.default.useReducer((value) => value + 1, 0);
    import_react2.default.useEffect(() => {
      listeners.add(force);
      return () => listeners.delete(force);
    }, []);
  };
  const hasModal = () => [...document.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"]')].some((node) => node.getClientRects().length > 0);
  const readyForGuide = () => profileGate && !modalVisible;
  const first2 = () => {
    if (!coordinator) return;
    const state = progress();
    if (state.ready && state.status !== "new") {
      coordinator.complete();
      return;
    }
    if (!firstStarted && state.ready && readyForGuide()) {
      firstStarted = true;
      required = true;
      step = state.step;
      anchor = document.activeElement;
      opened = true;
      notify();
    }
  };
  const readProfile = async () => {
    try {
      const response = await fetch("/api/mochi-profile", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Profile unavailable");
      const value = await response.json();
      if (disposed) return;
      if (!["teacher", "classroom"].includes(value.role)) throw new Error("Profile role unavailable");
      profile = value;
      profileFailed = false;
      profileGate = value.configured === true || value.setupDismissed === true || document.documentElement.dataset.mochiUserProfilePromptDone === "true";
    } catch {
      if (disposed) return;
      profileFailed = true;
      profileGate = true;
    }
    notify();
    first2();
  };
  const save = async (nextStep, status) => {
    const state = progress();
    if (!state.persistent) throw new Error("\u6307\u5F15\u8FDB\u5EA6\u6682\u65F6\u4E0D\u80FD\u4FDD\u5B58\uFF0C\u8BF7\u68C0\u67E5\u672C\u673A\u8FDE\u63A5\uFF1B\u53EF\u4EE5\u5148\u7EE7\u7EED\u4F7F\u7528\u3002");
    const accepted = await form.mutate([{ op: "set", path: ["version"], value: GUIDE_VERSION }, { op: "set", path: ["step"], value: nextStep }, { op: "set", path: ["status"], value: status }]);
    if (!accepted) throw new Error("\u6307\u5F15\u8FDB\u5EA6\u6CA1\u6709\u4FDD\u5B58\u6210\u529F\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002");
  };
  const act = async (action) => {
    if (busy) return;
    busy = true;
    message = "";
    notify();
    try {
      await action();
    } catch (error) {
      message = error.message;
    } finally {
      busy = false;
      notify();
    }
  };
  const close = () => {
    opened = false;
    coordinator?.complete();
    const target = anchor?.isConnected && anchor.getClientRects().length && !anchor.closest("[hidden],[inert]") ? anchor : locateGuideTarget(document, "composer");
    target?.focus?.();
    notify();
  };
  const advance = (direction) => act(async () => {
    const index = STEP_IDS.indexOf(step), next = STEP_IDS[Math.max(0, index + direction)];
    if (!next) {
      await save(step, "complete");
      close();
      return;
    }
    await save(next, required ? "new" : "complete");
    step = next;
    message = "";
    compact = false;
    notify();
  });
  const reopen = (event) => {
    const state = progress();
    anchor = event?.currentTarget ?? document.activeElement;
    required = state.status !== "complete";
    step = required ? state.step : STEP_IDS[0];
    compact = false;
    opened = true;
    message = "";
    notify();
  };
  const visibleButton = (text) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === text && button.getClientRects().length && !button.disabled && !button.closest("[hidden],[inert]"));
  const waitFor = async (read) => {
    const deadline = Date.now() + 1500;
    do {
      const value = read();
      if (value) return value;
      await new Promise((done) => setTimeout(done, 50));
    } while (!disposed && Date.now() < deadline);
    return null;
  };
  let marked = null, markTimer;
  const highlight = (target) => {
    marked?.removeAttribute("data-mochi-guide-target");
    clearTimeout(markTimer);
    marked = target;
    target.setAttribute("data-mochi-guide-target", "true");
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    target.focus?.({ preventScroll: true });
    markTimer = setTimeout(() => {
      marked?.removeAttribute("data-mochi-guide-target");
      marked = null;
    }, 4500);
  };
  const navigate = (action) => act(async () => {
    if (action === "identity") {
      if (!locateGuideTarget(document, "mail")) throw new Error(TARGET_HINTS.mail);
      window.dispatchEvent(new CustomEvent("mochi-open-user-profile"));
      const panel = await waitFor(() => document.querySelector('[role="dialog"][aria-label="\u8BBE\u5907\u4E0E\u8FDE\u63A5"]'));
      if (!panel) throw new Error("\u79F0\u547C\u5165\u53E3\u8FD8\u4E0D\u53EF\u7528\u3002\u8BF7\u6253\u5F00\u201C\u5C0F\u4FE1\u7BB1 \u2192 \u8BBE\u5907\u4E0E\u8FDE\u63A5\u201D\uFF0C\u6216\u68C0\u67E5\u8EAB\u4EFD\u670D\u52A1\u3002");
      compact = true;
      return;
    }
    if (action === "memory") {
      const event = new CustomEvent("mochi-open-memory", { cancelable: true });
      window.dispatchEvent(event);
      if (!event.defaultPrevented) throw new Error("\u8BB0\u5FC6\u56DE\u770B\u5165\u53E3\u8FD8\u4E0D\u53EF\u7528\uFF1B\u53EF\u5728\u5BF9\u8BDD\u4E2D\u8BE2\u95EE\u201C\u4F60\u8BB0\u4F4F\u4E86\u4EC0\u4E48\u201D\uFF0C\u67E5\u770B\u5B9E\u9645\u4FDD\u5B58\u7684\u8BB0\u5FC6\u3002");
      compact = true;
      return;
    }
    const target = locateGuideTarget(document, action);
    if (!target) throw new Error(TARGET_HINTS[action] ?? "\u5F53\u524D\u5165\u53E3\u8FD8\u4E0D\u53EF\u7528\uFF0C\u8BF7\u5148\u6838\u5BF9\u8BBE\u7F6E\u3002");
    compact = true;
    if (["composer", "voice", "voicechat", "camera"].includes(action)) {
      highlight(target);
      message = "\u5DF2\u6807\u51FA\u771F\u5B9E\u5165\u53E3\uFF1B\u7531\u4F60\u70B9\u51FB\u6216\u8F93\u5165\uFF0C\u6307\u5357\u4E0D\u4F1A\u5F00\u59CB\u5F55\u97F3\u3001\u62CD\u7167\u6216\u53D1\u9001\u3002";
      return;
    }
    if (action === "campus" && target.getAttribute("aria-expanded") === "true") {
      highlight(target);
      return;
    }
    target.click();
    if (action === "account") {
      await waitFor(() => document.querySelector('[role="dialog"] .jxl-campus-account'));
      const account = document.querySelector('[role="dialog"] .jxl-campus-account');
      if (!account) {
        visibleButton("\u901A\u7528")?.click();
        const found = await waitFor(() => document.querySelector('[role="dialog"] .jxl-campus-account'));
        if (!found) throw new Error(TARGET_HINTS.account);
      }
      const button = document.querySelector('[role="dialog"] .jxl-campus-account button');
      if (!button || !button.getClientRects().length) throw new Error(TARGET_HINTS.account);
      highlight(button);
      message = "\u5DF2\u6807\u51FA\u539F\u6821\u56ED\u8D26\u53F7\u6309\u94AE\uFF1B\u8BF7\u5728\u5B9E\u9645\u9875\u9762\u767B\u5F55\u3002";
    }
  });
  function Entry({ wide }) {
    useState();
    return h(SidebarAction, { wide, label: "\u6307\u5F15", description: "\u65B0\u624B\u6307\u5F15", icon: sidebarIcons.guide, onClick: reopen });
  }
  function FirstRun({ complete, openSection }) {
    import_react2.default.useEffect(() => {
      coordinator = { complete, openSection };
      first2();
      return () => {
        if (coordinator?.complete === complete) coordinator = null;
      };
    }, [complete, openSection]);
    return null;
  }
  function Card() {
    useState();
    const ref = import_react2.default.useRef(null), [geometry, setGeometry] = import_react2.default.useState(() => guideGeometry({ width: innerWidth, height: innerHeight }));
    import_react2.default.useLayoutEffect(() => {
      if (!opened) return;
      const place = () => {
        const composer2 = [...document.querySelectorAll("[data-conversation-content] [data-composer-card]")].find((node) => node.getClientRects().length);
        const header = document.querySelector('[data-slot="conversation.header"]');
        setGeometry(guideGeometry({ width: innerWidth, height: innerHeight, composerTop: composer2?.getBoundingClientRect().top, headerBottom: Math.max(64, header?.getBoundingClientRect().bottom ?? 64) }));
      };
      place();
      const resize = new ResizeObserver(place);
      const composer = [...document.querySelectorAll("[data-conversation-content] [data-composer-card]")].find((node) => node.getClientRects().length);
      if (composer) resize.observe(composer);
      window.addEventListener("resize", place);
      return () => {
        resize.disconnect();
        window.removeEventListener("resize", place);
      };
    }, [opened, step, compact, modalVisible]);
    if (!opened || !readyForGuide()) return null;
    const steps = guideSteps(profile?.role), index = STEP_IDS.indexOf(step), current = steps[index];
    return h(
      "aside",
      { ref, role: "region", className: "mochi-guide", "aria-label": "Mochi \u65B0\u624B\u6307\u5F15", hidden: geometry.hidden, style: { top: geometry.top, right: geometry.right, width: geometry.width, maxHeight: geometry.maxHeight } },
      h("header", null, h("span", null, `${index + 1} / ${steps.length} \xB7 ${required ? "\u9996\u6B21\u4F7F\u7528\uFF0C\u9010\u6B65\u8BA4\u8BC6 Mochi" : "\u91CD\u65B0\u770B\u770B"}`), !required && h("button", { type: "button", "aria-label": "\u5173\u95ED\u91CD\u770B\u6307\u5F15", disabled: busy, onClick: close }, "\u5173\u95ED")),
      h("h2", null, current.title),
      compact ? h("button", { type: "button", onClick: () => {
        compact = false;
        notify();
      } }, "\u5C55\u5F00\u8FD9\u4E00\u6B65") : h(
        import_react2.default.Fragment,
        null,
        h(Sketch, { kind: current.sketch }),
        h("p", null, current.text),
        h("p", { className: "mochi-guide-note" }, current.note),
        step === "identity" && h("p", { role: "status" }, profileFailed ? "\u79F0\u547C\u670D\u52A1\u5C1A\u672A\u8FDE\u63A5\uFF0C\u8EAB\u4EFD\u548C\u79F0\u547C\u72B6\u6001\u672A\u786E\u8BA4\u3002" : profile?.configured ? "\u79F0\u547C\u5DF2\u4FDD\u5B58\uFF1B\u672C\u673A\u8EAB\u4EFD\u4E0E\u6821\u56ED\u8BA4\u8BC1\u4ECD\u6309\u5404\u81EA\u771F\u5B9E\u72B6\u6001\u6838\u5BF9\u3002" : "\u79F0\u547C\u8FD8\u6CA1\u586B\u5199\uFF0C\u53EF\u4EE5\u5148\u8BBE\u7F6E\uFF0C\u4E5F\u53EF\u4EE5\u7A0D\u540E\u8865\u3002"),
        step === "account" && h("p", { role: "status" }, campus.status === "authenticated" ? "\u539F\u6821\u56ED\u8D26\u53F7\u9875\u9762\u62A5\u544A\uFF1A\u8D26\u53F7\u5DF2\u767B\u5F55\u3002" : campus.status === "unauthenticated" ? "\u539F\u6821\u56ED\u8D26\u53F7\u9875\u9762\u62A5\u544A\uFF1A\u5C1A\u672A\u767B\u5F55\u3002" : "\u6821\u56ED\u8D26\u53F7\u72B6\u6001\u5C1A\u672A\u786E\u8BA4\uFF0C\u8BF7\u5728\u539F\u9875\u9762\u67E5\u770B\u3002"),
        h("div", { className: "mochi-guide-actions" }, ...current.actions.map(([action, label]) => h("button", { key: action, type: "button", disabled: busy, onClick: () => navigate(action) }, label)))
      ),
      message && h("p", { role: "status", className: "mochi-guide-note" }, message),
      h(
        "footer",
        null,
        h("button", { type: "button", disabled: busy || index === 0, onClick: () => advance(-1) }, "\u4E0A\u4E00\u6B65"),
        h("button", { type: "button", disabled: busy, onClick: () => advance(1) }, index === steps.length - 1 ? "\u5B8C\u6210\u6307\u5F15" : "\u6211\u4E86\u89E3\u4E86\uFF0C\u4E0B\u4E00\u6B65")
      )
    );
  }
  const style = document.createElement("style");
  style.textContent = '.mochi-guide{position:fixed;z-index:35;box-sizing:border-box;overflow:auto;overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:14px;background:var(--dsw-alias-bg-base,#fffefa);color:var(--dsw-alias-label-primary,#403b32);padding:16px;box-shadow:0 8px 24px #0001;font-size:13px;line-height:1.6}.mochi-guide header,.mochi-guide footer,.mochi-guide-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mochi-guide header{justify-content:space-between;font-size:11px}.mochi-guide h2{font-size:17px;line-height:1.4;margin:12px 0 6px}.mochi-guide p{margin:9px 0}.mochi-guide-note{color:var(--dsw-alias-label-secondary,#746c60);font-size:12px}.mochi-guide-sketch{width:148px;height:72px;display:block;margin:10px auto;color:var(--dsw-alias-label-secondary,#746c60)}.mochi-guide button{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:8px;padding:5px 9px;background:var(--dsw-alias-bg-base,#fffefa);cursor:pointer}.mochi-guide button:active{transform:translateY(1px)}.mochi-guide button:disabled{opacity:.5;cursor:default}.mochi-guide footer{position:sticky;bottom:-16px;margin:12px -16px -16px;padding:10px 16px;background:var(--dsw-alias-bg-base,#fffefa);border-top:1px solid var(--dsw-alias-border-l2,#d8d3c7);justify-content:space-between}.mochi-guide :focus-visible{outline:2px solid currentColor;outline-offset:2px}[data-mochi-guide-target="true"]{outline:2px solid var(--dsw-alias-label-primary,#403b32)!important;outline-offset:3px!important}@media(prefers-reduced-motion:reduce){.mochi-guide button:active{transform:none}}';
  style.textContent += '.mochi-guide::before{content:"";position:absolute;right:0;top:0;width:26px;height:26px;pointer-events:none;background:linear-gradient(225deg,var(--dsw-alias-bg-layer-2,#fffefa) 47%,var(--dsw-alias-border-l2,#d8d3c7) 50%,transparent 53%)}.mochi-guide header{border-bottom:1px dashed var(--dsw-alias-border-l2,#d8d3c7);padding-bottom:10px;padding-right:10px}.mochi-guide h2{font-family:var(--dsw-font-serif,serif)}.mochi-guide-entry{flex-shrink:0;white-space:nowrap;font:inherit;font-size:12px;padding:5px 6px;border-radius:7px;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);cursor:pointer}';
  document.head.append(style);
  const offForm = form.subscribe(() => {
    notify();
    first2();
  });
  const dismissed = () => {
    profileGate = true;
    void readProfile();
    first2();
  };
  const updated = () => {
    void readProfile();
  };
  const auth = () => {
    campus = window.mochiCampusIdentitySnapshot ?? { status: "unknown" };
    notify();
  };
  const escape = (event) => {
    if (event.key !== "Escape" || !opened || hasModal()) return;
    event.preventDefault();
    if (!required) close();
    else {
      message = "\u9996\u6B21\u6307\u5F15\u4F1A\u4FDD\u7559\u5728\u8FD9\u91CC\u3002\u8BF7\u6309\u6B65\u9AA4\u7EE7\u7EED\uFF1B\u5916\u90E8\u670D\u52A1\u4E0D\u53EF\u7528\u65F6\uFF0C\u6838\u5BF9\u8BF4\u660E\u540E\u4E5F\u80FD\u8FDB\u5165\u4E0B\u4E00\u6B65\u3002";
      compact = false;
      notify();
    }
  };
  modalVisible = hasModal();
  const surfaceChanged = () => {
    const modal = hasModal();
    if (modal !== modalVisible) {
      modalVisible = modal;
      notify();
    }
    first2();
  };
  const transitionFinished = (event) => {
    if (event.target.closest?.('[data-shell-overlay],dialog,[role="dialog"]')) surfaceChanged();
  };
  const mutation = new MutationObserver(surfaceChanged);
  mutation.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "hidden", "inert", "aria-modal", "class", "style"] });
  window.addEventListener("mochi-user-profile-dismissed", dismissed);
  window.addEventListener("mochi-user-profile-updated", updated);
  window.addEventListener("campus:auth-state", auth);
  window.addEventListener("mochi-open-onboarding", reopen);
  document.addEventListener("keydown", escape);
  window.addEventListener("focus", surfaceChanged);
  document.addEventListener("visibilitychange", surfaceChanged);
  document.addEventListener("transitionend", transitionFinished);
  document.addEventListener("animationend", transitionFinished);
  document.addEventListener("close", surfaceChanged, true);
  ctx.slots.inject("settings.onboarding", () => ctx.slots.register({ name: "settings.onboarding", id: "mochi-guide", order: 100 }, FirstRun));
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "mochi-guide-entry", order: 90 }, Entry));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "mochi-guide-card", order: 90 }, Card));
  ctx.slots.inject("settings.general.item", () => ctx.slots.register({ name: "settings.general.item", id: "mochi-guide-reopen", order: 100 }, Entry));
  void readProfile();
  ctx.on("dispose", () => {
    disposed = true;
    offForm();
    mutation.disconnect();
    clearTimeout(markTimer);
    marked?.removeAttribute("data-mochi-guide-target");
    style.remove();
    listeners.clear();
    window.removeEventListener("mochi-user-profile-dismissed", dismissed);
    window.removeEventListener("mochi-user-profile-updated", updated);
    window.removeEventListener("campus:auth-state", auth);
    window.removeEventListener("mochi-open-onboarding", reopen);
    document.removeEventListener("keydown", escape);
    window.removeEventListener("focus", surfaceChanged);
    document.removeEventListener("visibilitychange", surfaceChanged);
    document.removeEventListener("transitionend", transitionFinished);
    document.removeEventListener("animationend", transitionFinished);
    document.removeEventListener("close", surfaceChanged, true);
  });
}

return module.exports;}});
