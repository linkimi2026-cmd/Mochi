window.__ModuleLoader__.load({
  id: "mochi-modes-client",
  factory: (require) => {
    var module = { exports: {} };
    var react = require("react");

    function installStyles() {
      if (typeof document === "undefined") return function () {};
      var styleId = "mochi-scenes-style";
      if (document.getElementById(styleId)) return function () {};
      var style = document.createElement("style");
      style.id = styleId;
      style.textContent = [
        ".mochi-scene-header{font:500 12px/1.4 system-ui;color:var(--dsw-alias-label-secondary,#65736a);padding:2px 6px}",
        ".mochi-empty-reply{margin:4px 0;padding:8px 12px;border-left:2px solid var(--dsw-alias-border-l2,#d8dfda);color:var(--dsw-alias-label-secondary,#65736a);font:400 13px/1.6 system-ui}",
        ".mochi-scene-settings{max-width:720px;color:var(--dsw-alias-label-primary,#403b32)}.mochi-scene-settings h2{font:600 18px/1.4 system-ui}.mochi-scene-settings p{font:400 13px/1.6 system-ui;color:var(--dsw-alias-label-secondary,#65736a)}.mochi-scene-settings [role=alert]{color:var(--dsw-alias-state-error-primary,#bf6048)}",
        ".mochi-scene-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px}.mochi-scene-card{appearance:none;display:flex;flex-direction:column;gap:8px;text-align:left;padding:16px;border:1px solid var(--dsw-alias-border-l2,#d8dfda);border-radius:12px;background:var(--dsw-alias-bg-base,#f7f4ec);color:inherit;font:400 13px/1.6 system-ui;cursor:pointer}.mochi-scene-card strong{font-weight:600;font-size:15px}.mochi-scene-card span,.mochi-scene-card small{color:var(--dsw-alias-label-secondary,#65736a)}.mochi-scene-card[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary,#315f50);background:var(--jxl-paper,#fffefa)}.mochi-scene-card:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#eee9dd)}.mochi-scene-card:active:not(:disabled){opacity:.8}.mochi-scene-card:disabled{cursor:default;opacity:.6}.mochi-scene-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#315f50);outline-offset:3px}",
      ].join("");
      document.head.appendChild(style);
      return function () {
        if (style.parentNode) style.parentNode.removeChild(style);
      };
    }

    var SCENES = [
      { id: "standard", name: "通用", description: "日常与校园工作的通用入口，按任务使用全部可用工具与协作能力。" },
      { id: "lesson-planning", name: "备课与教学设计" },
      { id: "materials-assessment", name: "资料与练习测评" },
      { id: "grade-analysis", name: "成绩分析" },
      { id: "classroom-coordination", name: "班级协作" },
    ];

    function teacherRoster(presets) {
      return SCENES.every(function (scene) {
        return presets.some(function (row) { return row.id === scene.id; });
      });
    }

    function sceneRows(presets) {
      return SCENES.map(function (scene) {
        var row = presets.find(function (entry) { return entry.id === scene.id; });
        return row && Object.assign({}, row, { name: scene.name, description: scene.description || row.description });
      }).filter(Boolean);
    }

    function SceneHeader(props) {
      var preset = props.useSessions(function (state) {
        var value = state.byId[props.sessionId];
        return value && value.projectionValues && value.projectionValues.agentPreset;
      });
      if (typeof preset !== "string") return null;
      var scene = SCENES.find(function (entry) { return entry.id === preset; });
      var label = scene ? scene.name : "历史场景 · " + preset;
      return react.createElement("span", { className: "mochi-scene-header", title: "本会话开始时选择的场景" }, label);
    }

    function SceneSettings(props) {
      var state = props.useAgentPresetSection(function (value) { return value; });
      react.useEffect(function () { props.load(); }, [props.load]);
      return react.createElement("section", { className: "mochi-scene-settings" },
        react.createElement("h2", null, "场景"),
        react.createElement("p", null, "通用适合日常与校园工作，也可以选择更专注的场景。默认场景用于新会话。"),
        state.error ? react.createElement("p", { role: "alert" }, state.error) : null,
        react.createElement("div", { className: "mochi-scene-cards", role: "group", "aria-label": "新会话默认场景" },
          state.rows.map(function (row) {
            return react.createElement("button", {
              key: row.id, type: "button", className: "mochi-scene-card", "aria-pressed": row.isDefault,
              disabled: state.saving || row.broken !== undefined,
              onClick: function () { props.makeDefault(row.id); },
            }, react.createElement("strong", null, row.name),
              react.createElement("span", null, row.description || "专注处理这类校园任务。"),
              row.broken !== undefined ? react.createElement("small", null, "场景加载失败") :
                (row.isDefault ? react.createElement("small", null, "新会话默认") : null));
          })));
    }

    // Keep the official staging, settings synchronization and session lock intact.
    // Only this private facade filters presentation; the host roster stays complete.
    function createSceneFacade(ctx, disposers) {
      var alwaysEnabled = { getSnapshot: function () { return true; }, subscribe: function () { return function () {}; } };
      function adapt(scope) {
        var slots = new Proxy(scope.slots, { get: function (target, key) {
          if (key !== "register") return typeof target[key] === "function" ? target[key].bind(target) : target[key];
          return function (options, Component) {
            var mapped = Object.assign({}, options, { priority: -20, locale: "mochi.scenes" });
            if (options.name === "settings.section") {
              mapped.label = function () { return "场景"; };
              Component = SceneSettings;
            } else if (options.name === "conversation.session.header.actions") Component = SceneHeader;
            return target.register(mapped, Component);
          };
        } });
        var presets = new Proxy(scope.remote.agentPresets, { get: function (target, key) {
          if (key === "list") return async function () {
            var result = await target.list();
            return result.ok ? Object.assign({}, result, { value: Object.assign({}, result.value, { presets: sceneRows(result.value.presets) }) }) : result;
          };
          return typeof target[key] === "function" ? target[key].bind(target) : target[key];
        } });
        var remote = new Proxy(scope.remote, { get: function (target, key) {
          if (key === "agentPresets") return presets;
          return typeof target[key] === "function" ? target[key].bind(target) : target[key];
        } });
        var locale = new Proxy(scope.locale, { get: function (target, key) {
          if (key === "register") return function (ns, dictionaries) {
            var zh = Object.assign({}, dictionaries.zh, {
              nav: "场景", seatHint: "选择新会话的场景", headerHint: "本会话开始时选择的场景",
              presetStandardName: "通用", presetStandardDescription: SCENES[0].description,
            });
            return target.register("mochi.scenes", Object.assign({}, dictionaries, { zh: zh }));
          };
          if (key === "bind") return function () { return target.bind("mochi.scenes"); };
          return typeof target[key] === "function" ? target[key].bind(target) : target[key];
        } });
        var configForms = new Proxy(scope.configForms, { get: function (target, key) {
          if (key === "developerTools") return { enabled: alwaysEnabled };
          return target[key];
        } });
        return new Proxy(scope, { get: function (target, key) {
          if (key === "slots") return slots;
          if (key === "remote") return remote;
          if (key === "locale") return locale;
          if (key === "configForms") return configForms;
          if (key === "effect") return function (callback, label) {
            var dispose = target.effect(callback, label);
            disposers.push(dispose);
            return dispose;
          };
          if (key === "inject") return function (services, callback) {
            var fiber = target.inject(services, function (child) { return callback(adapt(child)); });
            disposers.push(function () { return fiber.dispose(); });
            return fiber;
          };
          var value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      }
      return adapt(ctx);
    }

    function isLegacyScene(id) {
      return id === "minimal" || id === "ptc" || id === "cordis";
    }

    async function migrateTeacherDefault(scope, roster, current) {
      var chosen = roster.presets.find(function (row) { return row.isDefault; });
      if (!chosen || !isLegacyScene(chosen.id)) return;
      var described = await scope.remote.settings.describe();
      if (!current()) return;
      if (!described.ok) throw new Error(described.error.message);
      var namespace = described.value.namespaces.find(function (row) { return row.ns === "agent-preset-registry"; });
      if (!namespace || !Number.isInteger(namespace.revision)) throw new Error("无法读取默认场景的设置版本。");
      if (isLegacyScene(namespace.value && namespace.value.selectedDefault)) {
        if (!described.value.writable) throw new Error("当前设置只读，无法将历史默认场景迁移为通用。");
        var saved = await scope.remote.settings.update("agent-preset-registry", { selectedDefault: "standard" }, namespace.revision);
        if (!current()) return;
        if (!saved.ok) throw new Error(saved.error.message);
      }
      var verified = await scope.remote.agentPresets.list();
      if (!current()) return;
      if (!verified.ok) throw new Error(verified.error.message);
      var effective = verified.value.presets.find(function (row) { return row.isDefault; });
      if (!effective || !SCENES.some(function (scene) { return scene.id === effective.id; })) {
        throw new Error("默认场景尚未迁移成功，请重试。");
      }
    }

    function installScenePicker(ctx) {
      var official = require("@deepseek-ai/dsh-client-ui-agent-preset");
      ctx.inject(official.inject, function (scope) {
        scope.effect(function () {
          var active = true;
          var installed = false;
          var generation = 0;
          var disposers = [];
          var failures = [];
          function clearFailure() {
            failures.splice(0).reverse().forEach(function (dispose) { dispose(); });
          }
          function showFailure(error) {
            clearFailure();
            var message = "默认场景更新失败：" + (error instanceof Error ? error.message : String(error));
            function Notice() {
              return react.createElement("div", { className: "mochi-scene-settings", role: "alert" },
                react.createElement("p", null, message),
                react.createElement("button", { type: "button", onClick: discover }, "重试"));
            }
            failures.push(scope.slots.register({ name: "conversation.hero.agentPreset", priority: -20 }, Notice));
            failures.push(scope.slots.register({ name: "settings.section", id: "agent-presets", priority: -20, order: 20, label: function () { return "场景"; } }, Notice));
            failures.push(scope.slots.register({ name: "conversation.session.header.actions", id: "agent-preset", priority: -20, order: -10 }, SceneHeader));
          }
          function discover() {
            if (!active || installed) return;
            var request = ++generation;
            var teacher = false;
            function current() { return active && request === generation && !installed; }
            Promise.resolve().then(function () { return scope.remote.agentPresets.list(); }).then(async function (result) {
              // Classroom rosters retain the dedicated classroom UI and capabilities.
              if (!current() || !result.ok || !teacherRoster(result.value.presets)) return;
              teacher = true;
              await migrateTeacherDefault(scope, result.value, current);
              if (!current()) return;
              clearFailure();
              official.apply(createSceneFacade(scope, disposers));
              installed = true;
            }).catch(function (error) {
              if (!current()) return;
              if (teacher) showFailure(error);
              else scope.logger?.warn?.("场景列表读取失败", error);
            });
          }
          var stopReset = scope.on("connection/reset", discover);
          discover();
          return function () {
            active = false;
            stopReset();
            clearFailure();
            return disposers.reverse().reduce(function (pending, dispose) {
              return pending.then(function () { return dispose(); });
            }, Promise.resolve());
          };
        }, "mochi-modes: teacher scene picker");
      });
    }

    // These keys specialize only folded command lifecycle cards. User messages
    // and immutable Session events never pass through this rendering slot.
    function RetiredModeCommand() { return null; }

    function installRetiredCommandViews(ctx) {
      ["mochi-work", "mochi-chat"].forEach(function (command) {
        ctx.slots.inject("conversation.chat.commandview", function* () {
          yield ctx.slots.register({
            name: "conversation.chat.commandview", key: command, priority: -20,
          }, RetiredModeCommand);
        });
      });
    }

    // Read official immutable presentation facts; never synthesize an answer.
    function hasEmptyCompletedReply(turn, tail, process) {
      if (!turn || !turn.start || turn.status !== "closed" || turn.end?.data.reason.kind !== "completed") return false;
      if (!tail || tail.closing !== null || !process || process.messageCount !== 0 ||
          process.toolCallCount !== 0 || process.subagentCount !== 0) return false;
      return turn.steps.length > 0 && turn.steps.every(function (step) {
        var assistant = step.data.get("assistant-step");
        return step.status === "closed" && assistant?.status === "settled" && assistant.finalNode &&
          !assistant.finalNode.interrupted && assistant.blocks.every(function (block) {
            return block.kind === "reasoning" || (block.kind === "text" && block.text.trim() === "");
          });
      });
    }

    function EmptyReplyNotice(props) {
      var tailSource = props.turn.data.source("turn-tail");
      var processSource = props.turn.data.source("turn-process");
      var tail = react.useSyncExternalStore(tailSource.subscribe, tailSource.getSnapshot);
      var process = react.useSyncExternalStore(processSource.subscribe, processSource.getSnapshot);
      if (!hasEmptyCompletedReply(props.turn, tail, process)) return null;
      return react.createElement("div", {
        className: "mochi-empty-reply", role: "note", "data-mochi-empty-reply": props.turn.turn,
      }, "本轮未返回正文，请重试。");
    }

    function installEmptyReplyNotice(ctx) {
      ctx.slots.inject("conversation.chat.turnTail", function* () {
        yield ctx.slots.register({
          name: "conversation.chat.turnTail", id: "mochi-empty-reply", order: 90,
        }, EmptyReplyNotice);
      });
    }

    function apply(ctx) {
      installScenePicker(ctx);
      installRetiredCommandViews(ctx);
      installEmptyReplyNotice(ctx);
      ctx.effect(function () { return installStyles(); }, "mochi-scenes: styles");
    }

    module.exports.apply = apply;
    module.exports.inject = ["slots", "remote"];
    module.exports.__test = {
      SCENES: SCENES,
      installRetiredCommandViews: installRetiredCommandViews,
      RetiredModeCommand: RetiredModeCommand,
      hasEmptyCompletedReply: hasEmptyCompletedReply,
      EmptyReplyNotice: EmptyReplyNotice,
      installEmptyReplyNotice: installEmptyReplyNotice,
      teacherRoster: teacherRoster,
      sceneRows: sceneRows,
      createSceneFacade: createSceneFacade,
      installScenePicker: installScenePicker,
      migrateTeacherDefault: migrateTeacherDefault,
      SceneHeader: SceneHeader,
      SceneSettings: SceneSettings,
    };
    return module.exports;
  },
});
