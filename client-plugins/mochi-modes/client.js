window.__ModuleLoader__.load({
  id: "mochi-modes-client",
  factory: (require) => {
    var module = { exports: {} };
    var react = require("react");

    // 与宿主 plugins/mochi-modes/modes.mjs 共享的契约常量（一个字都不能差）。
    var PROJECTION_KEY = "mochiModes";
    var WORK_COMMAND_LINE = "/mochi-work";
    var CHAT_COMMAND_LINE = "/mochi-chat";
    var HEADER_SLOT = "conversation.session.header.actions";

    // 「对话 / 工作」是同一聊天界面（官方 chat 视图）上的两个**界面**：
    //   * 对话界面：真的只拿来聊天、讨论、提问，宿主只留对话必需工具
    //     （restrict 收窄，省 token），工作台也不显示。
    //   * 工作界面：就是老师现在用的这个对话界面，只是解除限制、全量工具、
    //     工作台可用，AI 在这里出文件，老师在这里改产物。
    // 本组件只做两件事：读宿主 mochiModes 投影显示真实模式并给一句人话说明；
    // 点按钮经官方 command.execute 直接切换（老师主动点工作 = 一上来就干活，不弹窗）。
    // 投影缺席时整块不渲染 —— 不拿客户端乐观状态假冒“当前模式”。
    function modeFromProjection(view) {
      if (!view || typeof view !== "object") return null;
      if (view.mode === "work") return "work";
      if (view.mode === "chat") return "chat";
      return null;
    }

    // 模式旁边的一行小字，让老师一眼看懂当前这个界面能干什么。
    var MODE_HINTS = Object.freeze({
      chat: "只聊天，不干活",
      work: "全量工具，正在干活",
    });

    function commandLineFor(target) {
      if (target === "work") return WORK_COMMAND_LINE;
      if (target === "chat") return CHAT_COMMAND_LINE;
      return null;
    }

    /**
     * 把「切换到 target」翻译成一次官方命令调用。返回 { ok, message? }。
     * 任何缺失的通道都如实返回失败，绝不假装切换成功。
     */
    function createModeSwitcher(remote) {
      return function switchMode(sessionId, target) {
        var line = commandLineFor(target);
        if (!line) return Promise.resolve({ ok: false, message: "未知模式：" + String(target) });
        if (typeof sessionId !== "string" || !sessionId) {
          return Promise.resolve({ ok: false, message: "当前没有会话，无法切换模式。" });
        }
        var commands = remote && remote.commands;
        if (!commands || typeof commands.execute !== "function") {
          return Promise.resolve({ ok: false, message: "当前客户端没有可用的命令通道，无法切换模式。" });
        }
        var pending;
        try {
          pending = commands.execute(sessionId, line, []);
        } catch (error) {
          return Promise.resolve({ ok: false, message: error instanceof Error ? error.message : String(error) });
        }
        return Promise.resolve(pending).then(
          function (result) {
            if (!result || result.ok !== true) {
              var details = result && result.error ? result.error : null;
              return { ok: false, message: (details && details.message) || "命令被宿主拒绝" };
            }
            if (result.value === undefined) return { ok: false, message: "宿主不认识命令 " + line };
            return { ok: true, line: line };
          },
          function (reason) {
            return { ok: false, message: reason instanceof Error ? reason.message : String(reason) };
          },
        );
      };
    }

    function installStyles() {
      if (typeof document === "undefined") return function () {};
      var styleId = "mochi-modes-style";
      if (document.getElementById(styleId)) return function () {};
      var style = document.createElement("style");
      style.id = styleId;
      style.textContent = [
        ".mochi-modes-toggle{display:inline-flex;align-items:center;gap:2px;min-height:34px;box-sizing:border-box;padding:3px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d8dfda) 88%,transparent);border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-bg-base,#f7f4ec) 85%,transparent);box-shadow:inset 0 1px 0 rgba(255,255,255,.66)}",
        ".mochi-modes-toggle__option{appearance:none;min-height:26px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#65736a);font:650 12px/1 system-ui,sans-serif;cursor:pointer;transition:background-color 140ms ease,color 140ms ease}",
        ".mochi-modes-toggle__option:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover,rgba(70,90,78,.1)) 84%,transparent);color:var(--dsw-alias-label-primary,#243029)}",
        ".mochi-modes-toggle__option:disabled{cursor:progress;opacity:.6}",
        '.mochi-modes-toggle__option[aria-pressed="true"]{background:var(--dsw-alias-brand-primary,#315f50);color:var(--dsw-alias-bg-layer-1,#fff)}',
        '.mochi-modes-toggle[data-pending="true"]{box-shadow:inset 0 1px 0 rgba(255,255,255,.66),0 0 0 2px color-mix(in srgb,#d9873e 26%,transparent)}',
        ".mochi-modes-toggle__hint{max-width:200px;color:var(--dsw-alias-label-secondary,#65736a);font:500 11px/1.3 system-ui,sans-serif;white-space:nowrap}",
        '.mochi-modes-toggle[data-mode="work"] .mochi-modes-toggle__hint{color:var(--dsw-alias-brand-primary,#315f50)}',
        ".mochi-modes-toggle__error{max-width:230px;color:var(--dsw-alias-state-error-primary,#bf6048);font:600 11px/1.3 system-ui,sans-serif}",
        ".mochi-modes-toggle :is(button):focus-visible{outline:2px solid color-mix(in srgb,#d9873e 74%,transparent);outline-offset:2px}",
      ].join("");
      document.head.appendChild(style);
      return function () {
        if (style.parentNode) style.parentNode.removeChild(style);
      };
    }

    function ModeToggle(props) {
      var sessionId = typeof props.sessionId === "string" && props.sessionId ? props.sessionId : null;
      var useProjection = typeof props.useProjection === "function" ? props.useProjection : null;
      // Hook 必须在任何提前 return 之前调用，保持顺序稳定。
      var view = useProjection ? useProjection(PROJECTION_KEY) : undefined;
      var busyState = react.useState(null);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var errorState = react.useState(null);
      var error = errorState[0];
      var setError = errorState[1];
      var mode = modeFromProjection(view);
      if (!sessionId || mode === null) return null;
      var pending = view.pending === true;

      function choose(target) {
        if (target === mode || busy !== null) return;
        var switchMode = typeof props.switchMode === "function" ? props.switchMode : null;
        if (!switchMode) {
          setError("当前客户端没有可用的命令通道，无法切换模式。");
          return;
        }
        setBusy(target);
        setError(null);
        Promise.resolve(switchMode(target)).then(
          function (outcome) {
            setBusy(null);
            if (outcome && outcome.ok === false) setError(outcome.message || "切换模式失败。");
          },
          function (reason) {
            setBusy(null);
            setError(reason instanceof Error ? reason.message : String(reason));
          },
        );
      }

      function option(target, label) {
        return react.createElement(
          "button",
          {
            type: "button",
            className: "mochi-modes-toggle__option",
            "data-mode": target,
            "aria-pressed": mode === target,
            disabled: busy !== null,
            onClick: function () { choose(target); },
          },
          label,
        );
      }

      return react.createElement(
        "div",
        {
          className: "mochi-modes-toggle",
          role: "group",
          "aria-label": "会话模式",
          "data-mode": mode,
          "data-pending": pending ? "true" : "false",
        },
        option("chat", "对话"),
        option("work", "工作"),
        busy !== null
          ? react.createElement("span", { className: "mochi-modes-toggle__error", role: "status" }, "正在切换…")
          : (error !== null ? react.createElement("span", { className: "mochi-modes-toggle__error", role: "status" }, error) : null),
        // 当前界面说明放最后：保留“状态位”的既有子元素次序，也保证出错时
        // 老师先看到错误、再看到说明。
        react.createElement("span", { className: "mochi-modes-toggle__hint", "data-mode": mode }, MODE_HINTS[mode]),
      );
    }

    function apply(ctx) {
      var switchMode = createModeSwitcher(ctx.remote);
      ctx.effect(function () { return installStyles(); }, "mochi-modes: styles");
      ctx.slots.inject(HEADER_SLOT, function* () {
        yield ctx.slots.register({
          name: HEADER_SLOT,
          id: "mochi-modes-toggle",
          order: 20,
          inject: function (sessionId) {
            return {
              switchMode: function (target) { return switchMode(sessionId, target); },
            };
          },
        }, ModeToggle);
      });
    }

    module.exports.apply = apply;
    module.exports.inject = ["slots", "remote", "remote.commands"];
    module.exports.__test = {
      PROJECTION_KEY: PROJECTION_KEY,
      WORK_COMMAND_LINE: WORK_COMMAND_LINE,
      CHAT_COMMAND_LINE: CHAT_COMMAND_LINE,
      HEADER_SLOT: HEADER_SLOT,
      MODE_HINTS: MODE_HINTS,
      ModeToggle: ModeToggle,
      commandLineFor: commandLineFor,
      createModeSwitcher: createModeSwitcher,
      modeFromProjection: modeFromProjection,
    };
    return module.exports;
  },
});
