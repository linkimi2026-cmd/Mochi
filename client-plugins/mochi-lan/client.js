window.__ModuleLoader__.load({
  id: "mochi-lan-client",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");

    var API_BASE = "/api/mochi-lan";
    var ROUTES = Object.freeze({
      state: API_BASE + "/state",
      discovery: API_BASE + "/discovery",
      events: API_BASE + "/events",
      identity: API_BASE + "/identity",
      pairProbe: API_BASE + "/pair/probe",
      pairRequest: API_BASE + "/pair/request",
      pairAccept: API_BASE + "/pair/accept",
      pairReject: API_BASE + "/pair/reject",
      peerUnpair: API_BASE + "/peer/unpair",
      peerBlock: API_BASE + "/peer/block",
      messageSeen: API_BASE + "/message-seen",
      // [Mochi 2026-09-18] 反向通道：教室端唯一的外发动作。
      requestSend: API_BASE + "/request/send",
    });
    var STYLE_ID = "mochi-lan-client-style";
    var POLL_MS = 3_000;

    function own(value, key) {
      return value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key);
    }

    function object(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
    }

    function rows(value) {
      return Array.isArray(value) ? value.filter(function (item) { return item !== null && typeof item === "object"; }) : [];
    }

    function text(value, maximum) {
      if (typeof value !== "string") return "";
      return value.normalize("NFC").trim().slice(0, maximum || 240);
    }

    function localTimeLabel(value) {
      var source = text(value, 80);
      var milliseconds = Date.parse(source);
      if (!source || !Number.isFinite(milliseconds)) return "收到时间暂不可用";
      var date = new Date(milliseconds);
      function pad(number) { return String(number).padStart(2, "0"); }
      return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-")
        + " " + [pad(date.getHours()), pad(date.getMinutes())].join(":");
    }

    function identityProjection(value) {
      var input = object(value);
      return Object.freeze({
        endpointId: text(input.endpointId, 80),
        role: input.role === "teacher" || input.role === "classroom" ? input.role : "",
        schoolId: text(input.schoolId, 120),
        classId: text(input.classId, 120),
        displayName: text(input.displayName, 80),
        fingerprint: text(input.fingerprint, 96),
      });
    }

    function recipientProjection(value) {
      if (value === null || value === undefined || typeof value !== "object") return null;
      var recipient = identityProjection(value);
      // A received message can only be actionable when it has the complete
      // classroom identity that was durably verified at delivery time. Older
      // rows without this field stay visible as history, never as current
      // classroom work.
      if (recipient.role !== "classroom" || !recipient.endpointId || !recipient.schoolId
        || !recipient.classId || !recipient.displayName || !recipient.fingerprint) return null;
      return recipient;
    }

    function identityMatches(left, right) {
      var first = identityProjection(left);
      var second = identityProjection(right);
      return Boolean(first.endpointId && first.role && first.schoolId && first.displayName && first.fingerprint)
        && first.endpointId === second.endpointId
        && first.role === second.role
        && first.schoolId === second.schoolId
        && first.classId === second.classId
        && first.displayName === second.displayName
        && first.fingerprint === second.fingerprint;
    }

    function addressProjection(value) {
      var input = object(value);
      var port = Number(input.port);
      return Object.freeze({
        host: text(input.host, 128),
        port: Number.isSafeInteger(port) && port > 0 && port <= 65535 ? port : 0,
      });
    }

    function unixMilliseconds(value) {
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
    }

    function candidateProjection(value) {
      var input = object(value);
      return Object.freeze({
        identity: identityProjection(input.identity || input),
        address: addressProjection(input.address),
        seenAt: text(input.seenAt, 80),
        // Beacon expiry is a numeric epoch value on the LAN service wire.
        // Keep it numeric so this UI cannot accidentally reinterpret it as a
        // formatted timestamp or treat a malformed value as still fresh.
        expiresAt: unixMilliseconds(input.expiresAt),
        paired: input.paired === true,
        blocked: input.blocked === true,
        publicKey: input.publicKey !== null && typeof input.publicKey === "object" ? input.publicKey : null,
      });
    }

    function discoveryProjection(value) {
      var input = object(value);
      var status = ["STARTING", "ACTIVE", "DEGRADED", "DISABLED", "STOPPED"].includes(input.status) ? input.status : "";
      var errorCode = typeof input.errorCode === "string" && /^[A-Z0-9_]{1,40}$/u.test(input.errorCode) ? input.errorCode : "";
      return Object.freeze({ enabled: input.enabled === true, status: status, errorCode: errorCode });
    }

    function normalizeSnapshot(value) {
      var input = object(value);
      return Object.freeze({
        configured: input.configured === true,
        started: input.started === true,
        lockedRole: input.lockedRole === "teacher" || input.lockedRole === "classroom" ? input.lockedRole : "",
        discovery: discoveryProjection(input.discovery),
        http: input.http !== null && typeof input.http === "object" ? Object.freeze({
          host: text(input.http.host, 128),
          port: Number.isSafeInteger(Number(input.http.port)) ? Number(input.http.port) : 0,
        }) : null,
        identity: input.identity === null || input.identity === undefined ? null : identityProjection(input.identity),
        peers: Object.freeze(rows(input.peers).map(function (row) {
          var item = object(row);
          return Object.freeze({
            identity: identityProjection(item),
            address: addressProjection(item.address),
            pairedAt: text(item.pairedAt, 80),
            blocked: item.blocked === true,
            online: item.online === true,
            lastDiscoveredAt: text(item.lastDiscoveredAt, 80),
          });
        })),
        blockedPeers: Object.freeze(rows(input.blockedPeers).map(function (row) {
          var item = object(row);
          return Object.freeze({ endpointId: text(item.endpointId, 80), updatedAt: text(item.updatedAt, 80) });
        })),
        pendingPairings: Object.freeze(rows(input.pendingPairings).map(function (row) {
          var item = object(row);
          return Object.freeze({ requestId: text(item.requestId, 120), peer: identityProjection(item.peer), receivedAt: text(item.receivedAt, 80) });
        })),
        inbox: Object.freeze(rows(input.inbox).map(function (row) {
          var item = object(row);
          return Object.freeze({
            messageId: text(item.messageId, 120),
            from: identityProjection(item.from),
            recipient: recipientProjection(item.recipient),
            body: text(item.body, 65536),
            receivedAt: text(item.receivedAt, 80),
            updatedAt: text(item.updatedAt, 80),
            seenAt: text(item.seenAt, 80),
            seenReceipt: text(item.seenReceipt, 40),
          });
        })),
        outbox: Object.freeze(rows(input.outbox).map(function (row) {
          var item = object(row);
          return Object.freeze({
            messageId: text(item.messageId, 120),
            targetEndpointId: text(item.targetEndpointId, 80),
            peer: identityProjection(item.peer),
            body: text(item.body, 65536),
            delivery: text(item.delivery, 40),
            createdAt: text(item.createdAt, 80),
            updatedAt: text(item.updatedAt, 80),
            failureCode: text(item.failureCode, 80),
          });
        })),
        receipts: Object.freeze(rows(input.receipts).map(function (row) {
          var item = object(row);
          return Object.freeze({ messageId: text(item.messageId, 120), from: identityProjection(item.from), seenAt: text(item.seenAt, 80), receivedAt: text(item.receivedAt, 80) });
        })),
      });
    }

    function emptySnapshot() {
      return normalizeSnapshot({ configured: false, started: false, identity: null });
    }

    function normalizeDiscovery(value) {
      var input = object(value);
      return Object.freeze(rows(input.candidates).map(candidateProjection));
    }

    function roleLabel(role) {
      return role === "teacher" ? "教师端" : role === "classroom" ? "教室端" : "未设置角色";
    }

    function receiptLabel(value) {
      if (value === "ACKNOWLEDGED") return "已看到回执已确认";
      if (value === "UNKNOWN") return "已看到回执结果未知";
      return value ? value : "尚未确认已看到";
    }

    function errorLabel(error) {
      var code = typeof error?.code === "string" ? error.code : "";
      var labels = {
        INVALID_REQUEST: "请求格式无效，请检查填写内容。",
        INVALID_INPUT: "填写内容无效，请检查学校、班级、名称或地址。",
        LOCAL_APPROVAL_REQUIRED: "当前操作未获得本机受控授权。",
        SCHOOL_MISMATCH: "学校标识不一致，不能继续相识。",
        ROLE_FORBIDDEN: "当前角色没有此操作权限。",
        PAIRING_REQUIRED: "目标不是可用的已配对设备。",
        PEER_BLOCKED: "该设备已被拉黑。",
        FINGERPRINT_MISMATCH: "设备指纹与发现结果不一致。",
        DISCOVERY_UNAVAILABLE: "候选设备未响应，请检查地址或网络。",
        DISCOVERY_INVALID: "候选设备返回了无效的发现响应。",
        ROLE_LOCK_REQUIRED: "此设备尚未由桌面启动配置锁定教师或教室角色。",
        DELIVERY_UNKNOWN: "投递结果未知；不会自动重发。",
        MESSAGE_NOT_FOUND: "找不到这条收件。",
        PAIR_REQUEST_NOT_FOUND: "找不到待确认的相识申请。",
      };
      return labels[code] || "本机 LAN 服务暂时不可用，请稍后刷新。";
    }

    function createRequestError(response, payload) {
      var error = new Error(typeof payload?.code === "string" ? payload.code : "LAN_REQUEST_FAILED");
      error.code = typeof payload?.code === "string" ? payload.code : "LAN_REQUEST_FAILED";
      error.status = response.status;
      return error;
    }

    async function requestJson(path, options) {
      var input = options || {};
      var response;
      try {
        response = await fetch(path, {
          method: input.method || "GET",
          headers: input.body === undefined ? undefined : { "content-type": "application/json" },
          body: input.body === undefined ? undefined : JSON.stringify(input.body),
          credentials: "same-origin",
          cache: "no-store",
          signal: input.signal,
        });
      } catch (_) {
        var unavailable = new Error("LAN_REQUEST_UNAVAILABLE");
        unavailable.code = "LAN_REQUEST_UNAVAILABLE";
        throw unavailable;
      }
      var payload = null;
      try { payload = await response.json(); } catch (_) { /* status handling below */ }
      if (!response.ok || payload === null || typeof payload !== "object") throw createRequestError(response, payload);
      return payload;
    }

    function createLanApi(request) {
      var call = typeof request === "function" ? request : requestJson;
      return Object.freeze({
        state: function (signal) { return call(ROUTES.state, { signal: signal }); },
        discovery: function (signal) { return call(ROUTES.discovery, { signal: signal }); },
        events: function (cursor, signal) { return call(ROUTES.events + "?cursor=" + encodeURIComponent(String(cursor || 0)), { signal: signal }); },
        configureIdentity: function (identity, signal) {
          var source = object(identity);
          var wireIdentity = Object.assign(
            {},
            source.endpointId ? { endpointId: source.endpointId } : {},
            { schoolId: source.schoolId, displayName: source.displayName },
            source.classId ? { classId: source.classId } : {},
          );
          return call(ROUTES.identity, { method: "POST", body: { identity: wireIdentity }, signal: signal });
        },
        probe: function (address, expectedFingerprint, signal) {
          return call(ROUTES.pairProbe, { method: "POST", body: Object.assign({ address: address }, expectedFingerprint ? { expectedFingerprint: expectedFingerprint } : {}), signal: signal });
        },
        requestPair: function (candidate, address, signal) { return call(ROUTES.pairRequest, { method: "POST", body: { candidate: candidate, address: address }, signal: signal }); },
        acceptPair: function (requestId, signal) { return call(ROUTES.pairAccept, { method: "POST", body: { requestId: requestId }, signal: signal }); },
        rejectPair: function (requestId, signal) { return call(ROUTES.pairReject, { method: "POST", body: { requestId: requestId }, signal: signal }); },
        unpair: function (endpointId, signal) { return call(ROUTES.peerUnpair, { method: "POST", body: { endpointId: endpointId }, signal: signal }); },
        block: function (endpointId, signal) { return call(ROUTES.peerBlock, { method: "POST", body: { endpointId: endpointId }, signal: signal }); },
        markSeen: function (messageId, signal) { return call(ROUTES.messageSeen, { method: "POST", body: { messageId: messageId }, signal: signal }); },
        sendRequest: function (targetEndpointId, request, body, signal) {
          return call(ROUTES.requestSend, {
            method: "POST",
            body: { targetEndpointId: targetEndpointId, request: request, body: body },
            signal: signal,
          });
        },
      });
    }

    /**
     * 学生预约的输入校验。
     *
     * 学生姓名是**自填**字段：教室端是一台共用设备，服务层只保证它随信封签名没被
     * 中途改过，不构成在校身份证明。所以这里既不查名册也不做「实名」暗示——
     * 只挡住空值和越界，并让 UI 明确写成「学生自填」。
     */
    var REQUEST_KINDS = Object.freeze(["appointment", "question", "makeup", "other"]);
    function studentRequestInput(draft, targetEndpointId) {
      var source = object(draft);
      var target = text(targetEndpointId, 80);
      var student = text(source.student, 120);
      // [Mochi 2026-09-18] material + position 就是「哪份作业的哪道题」。以前这两个
      // 位置不存在，学生只能把题目位置塞进正文，老师端待办条上就只剩一坨截断的字，
      // 老师没法提前翻页备课。两者都可选，所以不填也照旧能提交。
      var material = text(source.material, 120);
      var position = text(source.position, 120);
      var topic = text(source.topic, 120);
      var slot = text(source.slot, 120);
      var body = text(source.body, 2000);
      var kind = REQUEST_KINDS.indexOf(source.kind) >= 0 ? source.kind : "appointment";
      var seat = source.seat === "" || source.seat === undefined || source.seat === null ? null : Number(source.seat);
      if (!target) return Object.freeze({ ok: false, message: "尚未配对到教师端，无法提交预约。" });
      if (!student) return Object.freeze({ ok: false, message: "请填写学生姓名。" });
      if (!body) return Object.freeze({ ok: false, message: "请填写要预约的问题。" });
      if (seat !== null && (!Number.isSafeInteger(seat) || seat < 1 || seat > 999)) return Object.freeze({ ok: false, message: "座号必须是 1 到 999 的整数。" });
      return Object.freeze({
        ok: true,
        request: Object.freeze(Object.assign(
          { student: student, kind: kind },
          seat === null ? {} : { seat: seat },
          material ? { material: material } : {},
          position ? { position: position } : {},
          topic ? { topic: topic } : {},
          slot ? { slot: slot } : {},
        )),
        body: body,
      });
    }

    function identityInput(draft, lockedRole) {
      var source = object(draft);
      var schoolId = text(source.schoolId, 120);
      var classId = text(source.classId, 120);
      var displayName = text(source.displayName, 80);
      if (lockedRole !== "teacher" && lockedRole !== "classroom") return Object.freeze({ ok: false, message: "此设备尚未锁定教师或教室角色。" });
      if (!schoolId) return Object.freeze({ ok: false, message: "请填写学校标识。" });
      if (!displayName) return Object.freeze({ ok: false, message: "请填写设备显示名称。" });
      if (lockedRole === "classroom" && !classId) return Object.freeze({ ok: false, message: "教室端必须填写班级。" });
      return Object.freeze({ ok: true, identity: Object.freeze(Object.assign({ schoolId: schoolId, displayName: displayName }, classId ? { classId: classId } : {})) });
    }

    function manualAddressInput(draft) {
      var source = object(draft);
      var host = text(source.host, 128);
      var port = Number(source.port);
      if (!host) return Object.freeze({ ok: false, message: "请填写教室设备的 IP 地址。" });
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return Object.freeze({ ok: false, message: "端口必须介于 1 到 65535。" });
      return Object.freeze({ ok: true, address: Object.freeze({ host: host, port: port }) });
    }

    function canRequestPair(local, candidate) {
      if (!local || local.role !== "teacher") return false;
      var remote = candidateProjection(candidate).identity;
      return remote.role === "classroom" && remote.schoolId === local.schoolId && Boolean(remote.classId)
        && Boolean(remote.endpointId) && Boolean(remote.fingerprint);
    }

    function peerPresence(peer, candidates, blockedPeers) {
      var identity = peer?.identity || identityProjection(peer);
      if (rows(blockedPeers).some(function (item) { return text(item.endpointId, 80) === identity.endpointId; })) return "blocked";
      if (peer?.online === true) return "nearby";
      if (rows(candidates).some(function (item) {
        var candidate = candidateProjection(item).identity;
        return candidate.endpointId === identity.endpointId && candidate.fingerprint === identity.fingerprint;
      })) return "nearby";
      return "not-discovered";
    }

    function confirmationFor(type, value) {
      return Object.freeze({ type: type, value: value });
    }

    async function executeConfirmation(api, action, signal) {
      if (!action || !api) throw new Error("LAN_ACTION_INVALID");
      var value = action.value;
      if (action.type === "identity") return api.configureIdentity(value.identity, signal);
      if (action.type === "pair-request") return api.requestPair(value.candidate, value.address, signal);
      if (action.type === "pair-accept") return api.acceptPair(value.requestId, signal);
      if (action.type === "pair-reject") return api.rejectPair(value.requestId, signal);
      if (action.type === "peer-unpair") return api.unpair(value.endpointId, signal);
      if (action.type === "peer-block") return api.block(value.endpointId, signal);
      if (action.type === "message-seen") return api.markSeen(value.messageId, signal);
      if (action.type === "student-request") return api.sendRequest(value.targetEndpointId, value.request, value.body, signal);
      throw new Error("LAN_ACTION_INVALID");
    }

    var uiListeners = new Set();
    var uiState = Object.freeze({ open: false, focusedMessageId: "", configured: false, role: "", nearby: 0, inbox: 0, discoveryStatus: "", discoveryErrorCode: "" });

    function subscribeUi(listener) {
      uiListeners.add(listener);
      return function () { uiListeners.delete(listener); };
    }

    function uiSnapshot() { return uiState; }

    function updateUi(patch) {
      uiState = Object.freeze(Object.assign({}, uiState, patch));
      uiListeners.forEach(function (listener) { try { listener(); } catch (_) {} });
    }

    function openLanPanel() { updateUi({ open: true, focusedMessageId: "" }); }
    function openLanPanelForMessage(messageId) { updateUi({ open: true, focusedMessageId: text(messageId, 120) }); }
    function closeLanPanel() { updateUi({ open: false, focusedMessageId: "" }); }

    function attentionIds(value) {
      return String(value || "").split("\u0000").filter(Boolean);
    }

    function hasNewAttentionId(previous, next) {
      var before = new Set(attentionIds(previous));
      return attentionIds(next).some(function (id) { return !before.has(id); });
    }

    function inboxBinding(snapshot, message) {
      if (!message?.recipient) return "MISSING_RECIPIENT";
      if (!snapshot?.identity || !identityMatches(message.recipient, snapshot.identity)) return "RECIPIENT_MISMATCH";
      var paired = rows(snapshot.peers).some(function (peer) {
        return peer?.blocked !== true && identityMatches(peer?.identity, message.from);
      });
      return paired ? "ACTIVE" : "SENDER_UNPAIRED";
    }

    function unreadInboxMessages(snapshot) {
      return rows(snapshot?.inbox).filter(function (item) {
        return inboxBinding(snapshot, item) === "ACTIVE"
          && !text(item.seenAt, 80) && Boolean(text(item.messageId, 120));
      });
    }

    function attentionState(snapshot) {
      if (snapshot?.lockedRole !== "classroom") return Object.freeze({ inbox: "", pairings: "" });
      var unread = unreadInboxMessages(snapshot)
        .map(function (item) { return text(item.messageId, 120); })
        .sort()
        .join("\u0000");
      var pairings = rows(snapshot.pendingPairings)
        .map(function (item) { return text(item.requestId, 120); })
        .filter(Boolean)
        .sort()
        .join("\u0000");
      return Object.freeze({ inbox: unread, pairings: pairings });
    }

    function newAttentionKinds(previous, next) {
      var kinds = [];
      if (hasNewAttentionId(previous?.inbox, next.inbox)) kinds.push("incoming-message");
      if (hasNewAttentionId(previous?.pairings, next.pairings)) kinds.push("pairing-request");
      return Object.freeze(kinds);
    }

    function focusedUnreadMessageId(previousAttention, snapshot) {
      var before = new Set(attentionIds(previousAttention?.inbox));
      var messages = unreadInboxMessages(snapshot);
      var next = messages.find(function (item) { return !before.has(text(item.messageId, 120)); }) || messages[0];
      return text(next?.messageId, 120);
    }

    function focusedInboxMessage(snapshot, messageId) {
      var target = text(messageId, 120);
      if (!target || snapshot?.lockedRole !== "classroom") return null;
      return unreadInboxMessages(snapshot).find(function (item) { return text(item.messageId, 120) === target; }) || null;
    }

    function requestDesktopAttention(kind) {
      var bridge = typeof window === "object" ? window.mochiLanDesktop : null;
      if (!bridge || typeof bridge.attention !== "function") return;
      try { void bridge.attention(kind); } catch (_) {}
    }

    /**
     * 把「原始 LAN 快照」转推给桌面常驻条。
     *
     * 页面在这里刻意不做任何业务判断：哪些算待办、哪些该弹窗，全部由主进程派生
     * （dsh/rail-model.ts）。两块屏——老师那条待办横条、教室那块名单常驻屏——
     * 因此始终看到同一份判断；如果页面也自己算一遍，就会出现「两处判断、只修了
     * 一处」的情况，而那种不一致只在演示时才被看见。
     *
     * 这里只做传输层去重：原始负载没变就不推，免得每 3 秒搬一次同样的数据。
     */
    var lastPushedLanState = "";
    function requestRailSync(rawState) {
      var bridge = typeof window === "object" ? window.mochiRailDesktop : null;
      if (!bridge || typeof bridge.pushLanState !== "function") return false;
      var encoded;
      try { encoded = JSON.stringify(rawState); } catch (_) { return false; }
      if (encoded === lastPushedLanState) return false;
      var accepted = false;
      try { accepted = bridge.pushLanState(rawState) === true; } catch (_) { accepted = false; }
      // 推进只在真的推成功之后：否则一次失败会让这份数据永远不再重推，
      // 常驻条就永久停在旧内容上，而页面看上去一切正常。
      if (accepted) lastPushedLanState = encoded;
      return accepted;
    }

    function installStyles() {
      if (typeof document === "undefined") return function () {};
      var existing = document.getElementById(STYLE_ID);
      if (existing) return function () {};
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = [
        ".mochi-lan-overlay{position:fixed;inset:0;z-index:32;display:grid;place-items:center;padding:20px;box-sizing:border-box;background:rgba(22,31,26,.38);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);pointer-events:auto}",
        ".mochi-lan-overlay[hidden]{display:none}",
        ".mochi-lan-panel{inline-size:min(920px,100%);max-block-size:min(820px,calc(100vh - 40px));overflow:auto;border:1px solid rgba(77,100,85,.34);border-radius:22px;background:#f7f3e8;color:#203329;box-shadow:0 28px 80px rgba(13,23,18,.42);font:400 14px/1.55 'PingFang SC','Noto Sans CJK SC',system-ui,sans-serif}",
        ".mochi-lan-head{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;gap:12px;padding:18px 20px;background:rgba(247,243,232,.94);border-bottom:1px solid rgba(77,100,85,.18);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}",
        ".mochi-lan-head__title{margin:0;color:#1f493a;font:700 20px/1.2 'PingFang SC',system-ui,sans-serif}.mochi-lan-head__desc{margin:5px 0 0;color:#587063;font-size:12px}.mochi-lan-close{margin-left:auto;border:1px solid rgba(51,91,70,.28);border-radius:999px;background:#fffaf0;color:#244f3e;padding:7px 12px;cursor:pointer;font:600 12px/1 system-ui}",
        ".mochi-lan-body{display:grid;gap:14px;padding:18px}.mochi-lan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.mochi-lan-card{min-width:0;border:1px solid rgba(77,100,85,.2);border-radius:16px;background:rgba(255,252,244,.9);padding:14px;box-shadow:0 8px 20px -20px rgba(27,48,37,.7)}",
        ".mochi-lan-card--wide{grid-column:1/-1}.mochi-lan-card__title{margin:0;color:#244f3e;font:700 15px/1.35 'PingFang SC',system-ui,sans-serif}.mochi-lan-card__intro{margin:5px 0 0;color:#607267;font-size:12px}.mochi-lan-list{display:grid;gap:8px;margin-top:11px}.mochi-lan-row{display:grid;gap:6px;padding:10px;border:1px solid rgba(77,100,85,.16);border-radius:12px;background:#fdf9ef}.mochi-lan-row__top{display:flex;align-items:flex-start;gap:8px;justify-content:space-between}.mochi-lan-row__name{font-weight:700;overflow-wrap:anywhere}.mochi-lan-meta{color:#617267;font-size:12px;overflow-wrap:anywhere}.mochi-lan-fingerprint{font:500 11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#52675a;overflow-wrap:anywhere}",
        ".mochi-lan-notice{display:grid;gap:8px;border:1px solid rgba(191,128,50,.48);border-radius:16px;background:#fff0cf;padding:14px;box-shadow:0 10px 24px -22px rgba(81,52,18,.7)}.mochi-lan-notice__title{margin:0;color:#774516;font:750 16px/1.35 'PingFang SC',system-ui,sans-serif}.mochi-lan-notice__body{max-block-size:min(160px,24vh);overflow:auto;padding:9px;border-radius:10px;background:rgba(255,255,255,.55);color:#563d1d;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}",
        ".mochi-lan-status{display:inline-flex;align-items:center;gap:5px;flex:none;padding:3px 7px;border-radius:999px;background:#e8efe8;color:#28523e;font-size:11px;font-weight:650}.mochi-lan-status::before{content:'';inline-size:6px;block-size:6px;border-radius:50%;background:currentColor}.mochi-lan-status--warn{background:#f8e8c9;color:#96601e}.mochi-lan-status--danger{background:#f6ddd4;color:#9a452e}.mochi-lan-status--quiet{background:#ecece6;color:#68736c}",
        ".mochi-lan-fields{display:grid;gap:8px;margin-top:11px}.mochi-lan-field{display:grid;gap:4px;color:#365546;font-size:12px;font-weight:650}.mochi-lan-field input,.mochi-lan-field select{inline-size:100%;box-sizing:border-box;border:1px solid rgba(57,87,69,.28);border-radius:9px;background:#fffdf6;color:#203329;padding:8px 9px;font:400 14px/1.35 system-ui}.mochi-lan-field input:focus,.mochi-lan-field select:focus{outline:2px solid rgba(195,139,68,.52);outline-offset:1px}",
        ".mochi-lan-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.mochi-lan-button{border:1px solid rgba(42,87,67,.28);border-radius:999px;background:#2d6a51;color:#fffaf0;padding:7px 11px;cursor:pointer;font:650 12px/1 system-ui}.mochi-lan-button:hover{background:#225640}.mochi-lan-button:disabled{cursor:not-allowed;opacity:.48}.mochi-lan-button--soft{background:#fffaf0;color:#28523e}.mochi-lan-button--danger{background:#984e35}.mochi-lan-button--danger:hover{background:#7d3c2a}",
        ".mochi-lan-confirm{border:1px solid rgba(191,128,50,.45);border-radius:15px;background:#fff0cf;padding:13px}.mochi-lan-confirm__title{margin:0;color:#774516;font-weight:750}.mochi-lan-confirm__body{margin:6px 0;color:#664b28;font-size:13px}.mochi-lan-confirm__target{margin:8px 0;padding:9px;border-radius:10px;background:rgba(255,255,255,.55);color:#563d1d;white-space:pre-wrap;overflow-wrap:anywhere;font:500 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.mochi-lan-error{border:1px solid rgba(154,69,46,.35);border-radius:12px;background:#fff0eb;color:#8e3f2c;padding:10px;font-size:13px}.mochi-lan-empty{margin:10px 0 0;color:#718076;font-size:12px}.mochi-lan-bodytext{white-space:pre-wrap;overflow-wrap:anywhere;color:#31483b;font-size:13px}",
        ".mochi-lan-footer{display:flex;align-items:center;gap:8px;inline-size:100%;min-block-size:36px;border:0;border-radius:11px;background:transparent;color:var(--dsw-alias-label-primary,#eff5ed);padding:7px 9px;cursor:pointer;text-align:left;font:600 13px/1.3 'PingFang SC',system-ui,sans-serif}.mochi-lan-footer:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.09))}.mochi-lan-footer__dot{inline-size:8px;block-size:8px;border-radius:50%;background:#c38b44;box-shadow:0 0 0 3px rgba(195,139,68,.16)}.mochi-lan-footer__dot[data-ready='true']{background:#67a879}.mochi-lan-footer__meta{margin-left:auto;color:var(--dsw-alias-label-secondary,#aebbb2);font-size:11px}@media (prefers-reduced-motion:reduce){.mochi-lan-panel{scroll-behavior:auto}}@media (max-width:600px){.mochi-lan-overlay{padding:8px}.mochi-lan-panel{max-block-size:calc(100vh - 16px);border-radius:16px}.mochi-lan-head{padding:14px}.mochi-lan-body{padding:12px}}",
      ].join("\n");
      document.head.appendChild(style);
      return function () { if (style.parentNode) style.parentNode.removeChild(style); };
    }

    function DetailLine(props) {
      var identity = props.identity;
      var address = props.address;
      var parts = [roleLabel(identity.role), identity.schoolId || "学校未设置"];
      if (identity.classId) parts.push(identity.classId);
      if (address?.host && address?.port) parts.push(address.host + ":" + address.port);
      return React.createElement("div", { className: "mochi-lan-meta" }, parts.join(" · "));
    }

    function Status(props) {
      return React.createElement("span", { className: "mochi-lan-status" + (props.kind ? " mochi-lan-status--" + props.kind : "") }, props.children);
    }

    function IdentityForm(props) {
      var identity = props.identity;
      var initial = {
        schoolId: identity?.schoolId || "",
        classId: identity?.classId || "",
        displayName: identity?.displayName || "",
      };
      var state = React.useState(initial);
      var draft = state[0];
      var setDraft = state[1];
      var errorState = React.useState("");
      var error = errorState[0];
      var setError = errorState[1];
      function set(key, value) { setDraft(function (current) { return Object.assign({}, current, (function () { var next = {}; next[key] = value; return next; })()); }); }
      function submit(event) {
        event.preventDefault();
        var result = identityInput(draft, props.lockedRole);
        if (!result.ok) { setError(result.message); return; }
        setError("");
        props.onConfirm(confirmationFor("identity", { identity: result.identity, lockedRole: props.lockedRole }));
      }
      return React.createElement("form", { className: "mochi-lan-fields", onSubmit: submit },
        React.createElement("div", { className: "mochi-lan-meta" }, props.lockedRole ? "宿主锁定角色：" + roleLabel(props.lockedRole) + "（此页面不能改变）" : "宿主尚未锁定角色；请从对应教师端或教室端启动配置进入。"),
        React.createElement("label", { className: "mochi-lan-field" }, "学校标识",
          React.createElement("input", { value: draft.schoolId, maxLength: 120, autoComplete: "organization", placeholder: "例如：嘉兴一中", onChange: function (event) { set("schoolId", event.target.value); } })
        ),
        props.lockedRole === "classroom" ? React.createElement("label", { className: "mochi-lan-field" }, "班级（教室端必填）",
          React.createElement("input", { value: draft.classId, maxLength: 120, placeholder: "例如：高一（3）班", onChange: function (event) { set("classId", event.target.value); } })
        ) : React.createElement("label", { className: "mochi-lan-field" }, "班级（教师端可选）",
          React.createElement("input", { value: draft.classId, maxLength: 120, placeholder: "如需绑定班级可填写", onChange: function (event) { set("classId", event.target.value); } })
        ),
        React.createElement("label", { className: "mochi-lan-field" }, "设备显示名称",
          React.createElement("input", { value: draft.displayName, maxLength: 80, placeholder: props.lockedRole === "teacher" ? "例如：王老师的 Mac" : "例如：高一（3）班教室", onChange: function (event) { set("displayName", event.target.value); } })
        ),
        error ? React.createElement("div", { className: "mochi-lan-error", role: "alert" }, error) : null,
        React.createElement("div", { className: "mochi-lan-actions" },
          React.createElement("button", { className: "mochi-lan-button", type: "submit", disabled: !props.lockedRole }, identity ? "核对后保存身份" : "核对后创建身份")
        )
      );
    }

    function IdentityCard(props) {
      var identity = props.snapshot.identity;
      return React.createElement("section", { className: "mochi-lan-card" },
        React.createElement("h2", { className: "mochi-lan-card__title" }, "本机身份"),
        React.createElement("p", { className: "mochi-lan-card__intro" }, "宿主已锁定“" + (props.snapshot.lockedRole ? roleLabel(props.snapshot.lockedRole) : "未设置角色") + "”；身份变更会清除已有相识，私钥不显示、不进入浏览器或模型。"),
        identity ? React.createElement("div", { className: "mochi-lan-list" },
          React.createElement("div", { className: "mochi-lan-row" },
            React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, identity.displayName), React.createElement(Status, null, roleLabel(identity.role))),
            React.createElement(DetailLine, { identity: identity }),
            React.createElement("div", { className: "mochi-lan-fingerprint" }, identity.fingerprint || "指纹生成中")
          )
        ) : null,
        React.createElement(IdentityForm, { key: (identity?.endpointId || "new") + ":" + props.snapshot.lockedRole, identity: identity, lockedRole: props.snapshot.lockedRole, onConfirm: props.onConfirm })
      );
    }

    function AddressForm(props) {
      var state = React.useState({ host: "", port: "47832" });
      var draft = state[0];
      var setDraft = state[1];
      var errorState = React.useState("");
      var error = errorState[0];
      var setError = errorState[1];
      function submit(event) {
        event.preventDefault();
        var result = manualAddressInput(draft);
        if (!result.ok) { setError(result.message); return; }
        setError("");
        props.onProbe(result.address, "");
      }
      return React.createElement("form", { className: "mochi-lan-fields", onSubmit: submit },
        React.createElement("label", { className: "mochi-lan-field" }, "教室 IP 地址",
          React.createElement("input", { value: draft.host, placeholder: "例如：10.0.0.42", inputMode: "text", onChange: function (event) { setDraft(Object.assign({}, draft, { host: event.target.value })); } })
        ),
        React.createElement("label", { className: "mochi-lan-field" }, "LAN 端口",
          React.createElement("input", { value: draft.port, inputMode: "numeric", maxLength: 5, onChange: function (event) { setDraft(Object.assign({}, draft, { port: event.target.value })); } })
        ),
        error ? React.createElement("div", { className: "mochi-lan-error", role: "alert" }, error) : null,
        React.createElement("div", { className: "mochi-lan-actions" }, React.createElement("button", { className: "mochi-lan-button mochi-lan-button--soft", type: "submit", disabled: props.disabled }, "验证手动地址"))
      );
    }

    function CandidateRow(props) {
      var candidate = props.candidate;
      var identity = candidate.identity;
      var canPair = canRequestPair(props.localIdentity, candidate);
      var discoveryKind = candidate.blocked ? "danger" : candidate.paired ? "" : canPair ? "" : "warn";
      var discoveryText = candidate.blocked ? "已拉黑" : candidate.paired ? "已配对，当前附近" : canPair ? "附近发现，未配对" : "仅发现，不能发起相识";
      return React.createElement("div", { className: "mochi-lan-row" },
        React.createElement("div", { className: "mochi-lan-row__top" },
          React.createElement("strong", { className: "mochi-lan-row__name" }, identity.displayName || "未命名设备"),
          React.createElement(Status, { kind: discoveryKind }, discoveryText)
        ),
        React.createElement(DetailLine, { identity: identity, address: candidate.address }),
        React.createElement("div", { className: "mochi-lan-fingerprint" }, identity.fingerprint || "候选未提供指纹"),
        React.createElement("div", { className: "mochi-lan-actions" },
          React.createElement("button", { className: "mochi-lan-button mochi-lan-button--soft", type: "button", disabled: props.disabled || !props.localIdentity || candidate.blocked, onClick: function () { props.onProbe(candidate.address, identity.fingerprint); } }, candidate.paired ? "复核身份与指纹" : "验证身份与指纹")
        )
      );
    }

    function DiscoveryCard(props) {
      var candidates = props.candidates;
      return React.createElement("section", { className: "mochi-lan-card mochi-lan-card--wide" },
        React.createElement("h2", { className: "mochi-lan-card__title" }, "附近设备"),
        React.createElement("p", { className: "mochi-lan-card__intro" }, "每 3 秒自动更新。发现信息不是信任关系；必须先验证学校、班级、角色和指纹，再由教师发起相识。手动 IP 仅作发现失败时的备用。"),
        candidates.length ? React.createElement("div", { className: "mochi-lan-list" }, candidates.map(function (candidate) {
          return React.createElement(CandidateRow, { key: candidate.identity.endpointId + "@" + candidate.address.host, candidate: candidate, localIdentity: props.snapshot.identity, disabled: props.busy, onProbe: props.onProbe });
        })) : React.createElement("p", { className: "mochi-lan-empty" }, props.snapshot.identity ? "暂未发现附近设备。请确认两端在同一校园局域网；也可使用手动 IP 验证。" : "请先创建本机身份，随后会自动显示附近设备。"),
        React.createElement(AddressForm, { disabled: props.busy || !props.snapshot.identity, onProbe: props.onProbe })
      );
    }

    function VerifiedCandidateCard(props) {
      var verified = props.verified;
      if (!verified) return null;
      var candidate = verified.candidate;
      var allowed = canRequestPair(props.localIdentity, candidate);
      return React.createElement("section", { className: "mochi-lan-card mochi-lan-card--wide" },
        React.createElement("h2", { className: "mochi-lan-card__title" }, "已验证候选"),
        React.createElement("p", { className: "mochi-lan-card__intro" }, "此结果仅证明该地址返回的身份与所示指纹一致，仍未建立相识或投递权限。"),
        React.createElement("div", { className: "mochi-lan-row" },
          React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, candidate.identity.displayName), React.createElement(Status, { kind: allowed ? "" : "warn" }, allowed ? "可提交相识确认" : "角色或学校不匹配")),
          React.createElement(DetailLine, { identity: candidate.identity, address: verified.address }),
          React.createElement("div", { className: "mochi-lan-fingerprint" }, candidate.identity.fingerprint),
          allowed ? React.createElement("div", { className: "mochi-lan-actions" }, React.createElement("button", { className: "mochi-lan-button", type: "button", disabled: props.busy, onClick: function () { props.onConfirm(confirmationFor("pair-request", { candidate: verified.rawCandidate, address: verified.address })); } }, "核对目标后发起相识")) : null
        )
      );
    }

    function PairingCard(props) {
      var snapshot = props.snapshot;
      return React.createElement("section", { className: "mochi-lan-card" },
        React.createElement("h2", { className: "mochi-lan-card__title" }, "相识与已配对"),
        React.createElement("p", { className: "mochi-lan-card__intro" }, snapshot.lockedRole === "classroom" ? "教室端只接受来自同校教师的待确认申请。" : snapshot.lockedRole === "teacher" ? "教师端只能向已验证的教室端发起相识。" : "请先由桌面启动配置锁定本机角色。"),
        snapshot.pendingPairings.length ? React.createElement("div", { className: "mochi-lan-list" }, snapshot.pendingPairings.map(function (pending) {
          return React.createElement("div", { className: "mochi-lan-row", key: pending.requestId },
            React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, pending.peer.displayName), React.createElement(Status, { kind: "warn" }, "待人工确认")),
            React.createElement(DetailLine, { identity: pending.peer }),
            React.createElement("div", { className: "mochi-lan-fingerprint" }, pending.peer.fingerprint),
            React.createElement("div", { className: "mochi-lan-actions" },
              React.createElement("button", { className: "mochi-lan-button", type: "button", disabled: props.busy || snapshot.lockedRole !== "classroom", onClick: function () { props.onConfirm(confirmationFor("pair-accept", { requestId: pending.requestId, peer: pending.peer })); } }, "核对后接受"),
              React.createElement("button", { className: "mochi-lan-button mochi-lan-button--soft", type: "button", disabled: props.busy || snapshot.lockedRole !== "classroom", onClick: function () { props.onConfirm(confirmationFor("pair-reject", { requestId: pending.requestId, peer: pending.peer })); } }, "拒绝申请")
            )
          );
        })) : React.createElement("p", { className: "mochi-lan-empty" }, "暂无待确认的相识申请。"),
        snapshot.peers.length ? React.createElement("div", { className: "mochi-lan-list" }, snapshot.peers.map(function (peer) {
          var presence = peerPresence(peer, props.candidates, snapshot.blockedPeers);
          var status = presence === "nearby" ? ["", "已配对，发现信标有效"] : presence === "blocked" ? ["danger", "已拉黑"] : ["quiet", "已配对，当前未发现"];
          return React.createElement("div", { className: "mochi-lan-row", key: peer.identity.endpointId },
            React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, peer.identity.displayName), React.createElement(Status, { kind: status[0] }, status[1])),
            React.createElement(DetailLine, { identity: peer.identity, address: peer.address }),
            React.createElement("div", { className: "mochi-lan-fingerprint" }, peer.identity.fingerprint),
            presence === "not-discovered" ? React.createElement("div", { className: "mochi-lan-meta" }, "当前未发现不代表设备一定离线；仅表示最近发现信标未出现。") : null,
            React.createElement("div", { className: "mochi-lan-actions" },
              React.createElement("button", { className: "mochi-lan-button mochi-lan-button--soft", type: "button", disabled: props.busy, onClick: function () { props.onConfirm(confirmationFor("peer-unpair", { endpointId: peer.identity.endpointId, peer: peer.identity })); } }, "解除配对"),
              React.createElement("button", { className: "mochi-lan-button mochi-lan-button--danger", type: "button", disabled: props.busy, onClick: function () { props.onConfirm(confirmationFor("peer-block", { endpointId: peer.identity.endpointId, peer: peer.identity })); } }, "拉黑设备")
            )
          );
        })) : React.createElement("p", { className: "mochi-lan-empty" }, "尚未与任何设备建立相识。"),
        snapshot.blockedPeers.length ? React.createElement("div", { className: "mochi-lan-list" }, snapshot.blockedPeers.map(function (peer) {
          return React.createElement("div", { className: "mochi-lan-row", key: peer.endpointId }, React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, peer.endpointId), React.createElement(Status, { kind: "danger" }, "已拉黑")), React.createElement("div", { className: "mochi-lan-meta" }, "拉黑后不会接收配对或投递；当前服务没有解除拉黑入口。"));
        })) : null
      );
    }

    function InboxCard(props) {
      var snapshot = props.snapshot;
      var lockedRole = snapshot.lockedRole;
      return React.createElement("section", { className: "mochi-lan-card mochi-lan-card--wide" },
        React.createElement("h2", { className: "mochi-lan-card__title" }, lockedRole === "classroom" ? "教室收件箱" : "通知与已看到回执"),
        React.createElement("p", { className: "mochi-lan-card__intro" }, lockedRole === "classroom" ? "只有人工点击“已看到”才会向已配对教师发送签名回执。" : lockedRole === "teacher" ? "教师端不通过此面板发通知；所有发件仍经已审批的 dispatch 路径。" : "角色尚未锁定，不能执行收件确认或发送。"),
        lockedRole === "classroom" ? (snapshot.inbox.length ? React.createElement("div", { className: "mochi-lan-list" }, snapshot.inbox.map(function (message) {
          var binding = inboxBinding(snapshot, message);
          var actionable = binding === "ACTIVE";
          var historyLabel = binding === "MISSING_RECIPIENT" ? "历史收件未记录接收身份，不能发送已看到回执。"
            : binding === "RECIPIENT_MISMATCH" ? "历史收件的原目标与当前教室身份不一致，不能发送已看到回执。"
              : binding === "SENDER_UNPAIRED" ? "历史收件的原教师配对身份已变化，不能发送已看到回执。"
                : "";
          return React.createElement("article", { className: "mochi-lan-row", key: message.messageId },
            React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, message.from.displayName || "已配对教师"), React.createElement(Status, { kind: actionable ? (message.seenAt ? "" : "warn") : "quiet" }, actionable ? (message.seenAt ? "已看到" : "待人工已看到") : "历史收件")),
            React.createElement(DetailLine, { identity: message.from }),
            React.createElement("div", { className: "mochi-lan-meta" }, "目标班级：" + (message.recipient?.classId || "历史收件身份未记录")),
            React.createElement("div", { className: "mochi-lan-bodytext" }, message.body),
            React.createElement("div", { className: "mochi-lan-meta" }, localTimeLabel(message.receivedAt)),
            actionable ? (message.seenAt ? React.createElement("div", { className: "mochi-lan-meta" }, receiptLabel(message.seenReceipt)) : React.createElement("div", { className: "mochi-lan-actions" }, React.createElement("button", { className: "mochi-lan-button", type: "button", disabled: props.busy, onClick: function () { props.onConfirm(confirmationFor("message-seen", { messageId: message.messageId, from: message.from, body: message.body })); } }, "我已看到"))) : React.createElement("div", { className: "mochi-lan-meta" }, historyLabel)
          );
        })) : React.createElement("p", { className: "mochi-lan-empty" }, "暂无收件。陌生发现设备不能直接投递。")) : (snapshot.outbox.length ? React.createElement("div", { className: "mochi-lan-list" }, snapshot.outbox.map(function (message) {
          var receipt = snapshot.receipts.find(function (item) { return item.messageId === message.messageId; });
          return React.createElement("article", { className: "mochi-lan-row", key: message.messageId },
            React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, message.peer.displayName || message.targetEndpointId), React.createElement(Status, { kind: message.delivery === "ACKNOWLEDGED" ? "" : "warn" }, message.delivery || "投递状态未知")),
            React.createElement(DetailLine, { identity: message.peer }),
            React.createElement("div", { className: "mochi-lan-bodytext" }, message.body),
            React.createElement("div", { className: "mochi-lan-meta" }, receipt ? "对方已于 " + receipt.seenAt + " 确认看到" : "尚未收到人工已看到回执"),
            message.failureCode ? React.createElement("div", { className: "mochi-lan-meta" }, "最近结果：" + message.failureCode) : null
          );
        })) : React.createElement("p", { className: "mochi-lan-empty" }, "暂无经审批的教室通知。"))
      );
    }

    function IncomingMessageCard(props) {
      var message = focusedInboxMessage(props.snapshot, props.messageId)
        || focusedInboxMessage(props.snapshot, focusedUnreadMessageId(null, props.snapshot));
      if (!message) return null;
      var classroomClassId = text(message.recipient?.classId, 120);
      return React.createElement("section", { className: "mochi-lan-notice", role: "alert", "aria-live": "assertive", "aria-label": "新教室通知", "data-mochi-lan-focus-message": message.messageId },
        React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("h2", { className: "mochi-lan-notice__title" }, "新通知"), React.createElement(Status, { kind: "warn" }, "待人工已看到")),
        React.createElement("div", { className: "mochi-lan-meta" }, "发件教师：" + (message.from.displayName || "名称暂不可用")),
        React.createElement(DetailLine, { identity: message.from }),
        React.createElement("div", { className: "mochi-lan-meta" }, "目标班级：" + (classroomClassId || "当前班级未设置")),
        React.createElement("div", { className: "mochi-lan-notice__body" }, message.body),
        React.createElement("div", { className: "mochi-lan-meta" }, "收到：" + localTimeLabel(message.receivedAt)),
        React.createElement("div", { className: "mochi-lan-actions" }, React.createElement("button", { className: "mochi-lan-button", type: "button", disabled: props.busy, onClick: function () { props.onConfirm(confirmationFor("message-seen", { messageId: message.messageId, from: message.from, body: message.body })); } }, "我已看到"))
      );
    }

    function confirmationTarget(action) {
      var value = action?.value || {};
      var identity = value.peer || value.candidate;
      if (action?.type === "identity") {
        var next = value.identity || {};
        return [roleLabel(value.lockedRole), next.schoolId, next.classId || "（未绑定班级）", next.displayName].join("\n");
      }
      if (action?.type === "message-seen") return [value.from?.displayName || "已配对教师", value.from?.schoolId || "", value.from?.classId || "", "消息：" + (value.body || "")].join("\n");
      if (action?.type === "student-request") {
        var req = value.request || {};
        var where = [req.material, req.position].filter(Boolean).join(" ");
        return [
          value.peer?.displayName || "已配对教师",
          value.peer?.schoolId || "",
          "学生（自填）：" + (req.student || "") + (req.seat ? " · " + req.seat + " 号" : ""),
          where ? "要讲：" + where : "",
          req.topic ? "知识点：" + req.topic : "",
          req.slot ? "时间：" + req.slot : "",
          "学生原话：" + (value.body || ""),
        ].filter(Boolean).join("\n");
      }
      return [identity?.displayName || value.endpointId || value.requestId || "目标未识别", identity?.schoolId || "", identity?.classId || "", identity?.role ? roleLabel(identity.role) : "", identity?.fingerprint || ""].filter(Boolean).join("\n");
    }

    function confirmationCopy(action) {
      var copies = {
        identity: ["确认保存本机身份", "身份改动会解除现有配对。请确认学校、角色和班级无误。", "保存身份"],
        "pair-request": ["确认发起相识", "仅向下方已验证的教室设备发送配对申请；不会发送教学内容。", "发起相识"],
        "pair-accept": ["确认接受相识", "接受后，这个已验证教师设备才可按审批流程向本教室投递通知。", "接受相识"],
        "pair-reject": ["确认拒绝相识", "将删除本次待确认申请，不建立发送权限。", "拒绝申请"],
        "peer-unpair": ["确认解除配对", "解除后不再允许该设备投递或接收；不会自动拉黑。", "解除配对"],
        "peer-block": ["确认拉黑设备", "将解除配对并拒绝该设备后续相识或投递；当前服务没有解除拉黑入口。", "拉黑设备"],
        "message-seen": ["确认已看到", "这会向下方已验证教师发送签名“已看到”回执。", "确认已看到"],
        "student-request": ["确认提交预约", "学生姓名是学生在教室设备上自填的，不构成在校身份证明；提交后教师端待办条会收到这条预约，老师看到的是上面的「要讲」和你的原话。", "提交预约"],
      };
      return copies[action?.type] || ["确认操作", "请核对目标后继续。", "继续"];
    }

    function ConfirmationCard(props) {
      var action = props.action;
      if (!action) return null;
      var copy = confirmationCopy(action);
      return React.createElement("section", { className: "mochi-lan-confirm", role: "alertdialog", "aria-label": copy[0] },
        React.createElement("h2", { className: "mochi-lan-confirm__title" }, copy[0]),
        React.createElement("p", { className: "mochi-lan-confirm__body" }, copy[1]),
        React.createElement("div", { className: "mochi-lan-confirm__target" }, confirmationTarget(action)),
        React.createElement("div", { className: "mochi-lan-actions" },
          React.createElement("button", { className: action.type === "peer-block" ? "mochi-lan-button mochi-lan-button--danger" : "mochi-lan-button", type: "button", disabled: props.busy, onClick: props.onProceed }, props.busy ? "正在提交…" : copy[2]),
          React.createElement("button", { className: "mochi-lan-button mochi-lan-button--soft", type: "button", disabled: props.busy, onClick: props.onCancel }, "返回核对")
        )
      );
    }

    /**
     * 教室端的学生预约入口。
     *
     * 这是整套系统里唯一「学生自己发起」的动作，所以它在 UI 上也要像学生的动作，
     * 而不是老师的：字段是「谁 · 想约什么 · 什么时候」，提交前有一次核对，并且
     * 明说姓名是学生自填的——教室端是一台共用设备，服务层只能保证这条预约在传输
     * 途中没被改过，不能证明写字的人就是名单上的那个人。
     *
     * 只在教室端出现。教师端没有这张卡片，因为教师不能替学生发预约，
     * 服务层也会按方向拒绝。
     */
    function StudentRequestCard(props) {
      var teachers = rows(props.snapshot.peers).filter(function (peer) {
        return peer.identity.role === "teacher" && peer.blocked !== true && peer.identity.endpointId;
      });
      var emptyDraft = { student: "", seat: "", kind: "appointment", material: "", position: "", topic: "", slot: "", body: "" };
      var state = React.useState(emptyDraft);
      var draft = state[0];
      var setDraft = state[1];
      var errorState = React.useState("");
      var error = errorState[0];
      var setError = errorState[1];
      var succeeded = props.successNonce;
      React.useEffect(function () {
        // 提交成功后才清空，而不是一点「提交」就清空：学生还要在核对卡上确认一次，
        // 中途取消时输入必须还在。
        setDraft(emptyDraft);
      }, [succeeded]);
      if (props.snapshot.lockedRole !== "classroom") return null;
      function set(key, value) {
        var next = Object.assign({}, draft);
        next[key] = value;
        setDraft(next);
      }
      function submit(event) {
        event.preventDefault();
        var target = teachers[0];
        if (!target) { setError("尚未与教师端建立配对，无法提交预约。"); return; }
        var result = studentRequestInput(draft, target.identity.endpointId);
        if (!result.ok) { setError(result.message); return; }
        setError("");
        props.onConfirm(confirmationFor("student-request", {
          targetEndpointId: target.identity.endpointId,
          peer: target.identity,
          request: result.request,
          body: result.body,
        }));
      }
      return React.createElement("section", { className: "mochi-lan-card" },
        React.createElement("h2", { className: "mochi-lan-card__title" }, "提交预约"),
        React.createElement("p", { className: "mochi-lan-card__intro" }, teachers.length
          ? "提交给：" + teachers.map(function (peer) { return peer.identity.displayName || "未命名教师端"; }).join("、") + "。姓名由学生自己填写。"
          : "尚未与教师端配对，暂时无法提交预约。"),
        React.createElement("form", { className: "mochi-lan-fields", onSubmit: submit },
          React.createElement("label", { className: "mochi-lan-field" }, "学生姓名（自填）",
            React.createElement("input", { value: draft.student, maxLength: 120, placeholder: "例如：李明", onChange: function (event) { set("student", event.target.value); } })
          ),
          React.createElement("label", { className: "mochi-lan-field" }, "座号（可选）",
            React.createElement("input", { value: draft.seat, inputMode: "numeric", maxLength: 3, placeholder: "例如：3", onChange: function (event) { set("seat", event.target.value); } })
          ),
          React.createElement("label", { className: "mochi-lan-field" }, "预约类型",
            React.createElement("select", { value: draft.kind, onChange: function (event) { set("kind", event.target.value); } },
              React.createElement("option", { value: "appointment" }, "预约讲题"),
              React.createElement("option", { value: "question" }, "提问"),
              React.createElement("option", { value: "makeup" }, "补做登记"),
              React.createElement("option", { value: "other" }, "留言")
            )
          ),
          React.createElement("label", { className: "mochi-lan-field" }, "哪份作业/材料（可选）",
            React.createElement("input", { value: draft.material, maxLength: 120, placeholder: "例如：步步高 Unit 5", onChange: function (event) { set("material", event.target.value); } })
          ),
          React.createElement("label", { className: "mochi-lan-field" }, "哪道题（可选）",
            React.createElement("input", { value: draft.position, maxLength: 120, placeholder: "例如：完形填空第 7 空", onChange: function (event) { set("position", event.target.value); } })
          ),
          React.createElement("label", { className: "mochi-lan-field" }, "知识点（可选）",
            React.createElement("input", { value: draft.topic, maxLength: 120, placeholder: "例如：二次函数", onChange: function (event) { set("topic", event.target.value); } })
          ),
          React.createElement("label", { className: "mochi-lan-field" }, "希望的时间（可选）",
            React.createElement("input", { value: draft.slot, maxLength: 120, placeholder: "例如：第八节晚自习", onChange: function (event) { set("slot", event.target.value); } })
          ),
          React.createElement("label", { className: "mochi-lan-field" }, "要问的问题",
            React.createElement("input", { value: draft.body, maxLength: 2000, placeholder: "例如：第三题不太懂", onChange: function (event) { set("body", event.target.value); } })
          ),
          error ? React.createElement("div", { className: "mochi-lan-error", role: "alert" }, error) : null,
          React.createElement("div", { className: "mochi-lan-actions" },
            React.createElement("button", { className: "mochi-lan-button", type: "submit", disabled: props.busy || teachers.length === 0 }, "核对后提交")
          )
        )
      );
    }

    function LanPanel(props) {
      var snapshotState = React.useState(emptySnapshot());
      var snapshot = snapshotState[0];
      var setSnapshot = snapshotState[1];
      var discoveryState = React.useState(Object.freeze([]));
      var discovered = discoveryState[0];
      var setDiscovered = discoveryState[1];
      var phaseState = React.useState("loading");
      var phase = phaseState[0];
      var setPhase = phaseState[1];
      var failureState = React.useState("");
      var failure = failureState[0];
      var setFailure = failureState[1];
      var verifiedState = React.useState(null);
      var verified = verifiedState[0];
      var setVerified = verifiedState[1];
      var confirmationState = React.useState(null);
      var confirmation = confirmationState[0];
      var setConfirmation = confirmationState[1];
      var busyState = React.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var refreshState = React.useState(0);
      var refreshNonce = refreshState[0];
      var requestRefresh = function () { refreshState[1](function (value) { return value + 1; }); };
      // 学生预约提交成功后 +1，用来清空表单（见 StudentRequestCard 里的 effect）。
      // 用计数而不是布尔，是因为连续两次成功也必须各自触发一次清空。
      var requestNonceState = React.useState(0);
      var requestSentNonce = requestNonceState[0];
      var setRequestSentNonce = requestNonceState[1];
      var api = React.useMemo ? React.useMemo(function () { return createLanApi(); }, []) : createLanApi();

      React.useEffect(function () {
        var alive = true;
        var controller = new AbortController();
        var cursor = 0;
        var refreshing = false;
        var previousAttention = null;
        async function refresh() {
          if (refreshing) return;
          refreshing = true;
          try {
            var statePayload = await api.state(controller.signal);
            var discoveryPayload = await api.discovery(controller.signal);
            try {
              var eventPayload = await api.events(cursor, controller.signal);
              cursor = Number.isSafeInteger(Number(eventPayload?.cursor)) ? Number(eventPayload.cursor) : cursor;
            } catch (_) {
              // State/discovery reads above are authoritative. A dropped event
              // cursor only makes the next polling cycle refresh state again.
            }
            if (!alive) return;
            var nextSnapshot = normalizeSnapshot(statePayload);
            var nextDiscovery = normalizeDiscovery(discoveryPayload);
            var nextAttention = attentionState(nextSnapshot);
            var attentionKinds = newAttentionKinds(previousAttention, nextAttention);
            var focusedMessageId = attentionKinds.includes("incoming-message") ? focusedUnreadMessageId(previousAttention, nextSnapshot) : "";
            previousAttention = nextAttention;
            setSnapshot(nextSnapshot);
            setDiscovered(nextDiscovery);
            setFailure("");
            setPhase("ready");
            // 常驻条吃的是未经归一化的原始响应体：预约描述、发件角色、已看到时刻
            // 这些字段只在原文里，归一化后的投影会丢掉它们。
            requestRailSync(statePayload);
            updateUi({ configured: nextSnapshot.configured, role: nextSnapshot.lockedRole, nearby: nextDiscovery.length, inbox: unreadInboxMessages(nextSnapshot).length, discoveryStatus: nextSnapshot.discovery.status, discoveryErrorCode: nextSnapshot.discovery.errorCode });
            if (attentionKinds.length) {
              if (focusedMessageId) openLanPanelForMessage(focusedMessageId);
              else openLanPanel();
              attentionKinds.forEach(requestDesktopAttention);
            }
          } catch (error) {
            if (!alive || error?.name === "AbortError") return;
            setPhase("failed");
            setFailure(errorLabel(error));
          } finally {
            refreshing = false;
          }
        }
        void refresh();
        var timer = setInterval(function () { void refresh(); }, POLL_MS);
        return function () { alive = false; controller.abort(); clearInterval(timer); };
      }, [api, refreshNonce]);

      async function probe(address, expectedFingerprint) {
        if (busy) return;
        setBusy(true);
        setFailure("");
        try {
          var result = await api.probe(address, expectedFingerprint);
          var candidate = candidateProjection(result?.candidate);
          var nextAddress = addressProjection(result?.address || address);
          if (!candidate.identity.endpointId || !candidate.identity.fingerprint || !candidate.publicKey) throw Object.assign(new Error("DISCOVERY_INVALID"), { code: "DISCOVERY_INVALID" });
          setVerified({ candidate: candidate, rawCandidate: result.candidate, address: nextAddress });
        } catch (error) {
          setFailure(errorLabel(error));
        } finally {
          setBusy(false);
          requestRefresh();
        }
      }

      async function proceed() {
        if (!confirmation || busy) return;
        setBusy(true);
        setFailure("");
        try {
          await executeConfirmation(api, confirmation);
          // 学生预约成功后清空表单：否则学生会以为没提交成功而连点两次，
          // 教师端待办条上就会出现两条一模一样的预约。
          if (confirmation.type === "student-request") setRequestSentNonce(function (value) { return value + 1; });
          setConfirmation(null);
          if (confirmation.type !== "pair-request") setVerified(null);
        } catch (error) {
          setFailure(errorLabel(error));
        } finally {
          setBusy(false);
          requestRefresh();
        }
      }

      return React.createElement("section", { className: "mochi-lan-panel", role: "dialog", "aria-modal": true, "aria-label": "教室连接" },
        React.createElement("header", { className: "mochi-lan-head" },
          React.createElement("div", null, React.createElement("h1", { className: "mochi-lan-head__title" }, "教室连接"), React.createElement("p", { className: "mochi-lan-head__desc" }, phase === "loading" ? "正在读取本机 LAN 状态…" : "教师与教室各自独立身份；发现不等于相识，投递不等于已看到。")),
          React.createElement("button", { className: "mochi-lan-close", type: "button", onClick: props.onClose }, "关闭")
        ),
        React.createElement("main", { className: "mochi-lan-body" },
          failure ? React.createElement("div", { className: "mochi-lan-error", role: "alert" }, failure) : null,
          phase === "failed" ? React.createElement("div", { className: "mochi-lan-actions" }, React.createElement("button", { className: "mochi-lan-button", type: "button", onClick: requestRefresh }, "重新连接")) : null,
          React.createElement(ConfirmationCard, { action: confirmation, busy: busy, onProceed: proceed, onCancel: function () { if (!busy) setConfirmation(null); } }),
          React.createElement(IncomingMessageCard, { snapshot: snapshot, messageId: props.focusedMessageId, busy: busy, onConfirm: setConfirmation }),
          React.createElement("div", { className: "mochi-lan-grid" },
            React.createElement(IdentityCard, { snapshot: snapshot, onConfirm: setConfirmation }),
            React.createElement(PairingCard, { snapshot: snapshot, candidates: discovered, busy: busy, onConfirm: setConfirmation })
          ),
          React.createElement(DiscoveryCard, { snapshot: snapshot, candidates: discovered, busy: busy, onProbe: probe }),
          React.createElement(VerifiedCandidateCard, { verified: verified, localIdentity: snapshot.identity, busy: busy, onConfirm: setConfirmation }),
          React.createElement(InboxCard, { snapshot: snapshot, busy: busy, onConfirm: setConfirmation }),
          React.createElement(StudentRequestCard, { snapshot: snapshot, busy: busy, successNonce: requestSentNonce, onConfirm: setConfirmation }),
          React.createElement("div", { className: "mochi-lan-actions" }, React.createElement("button", { className: "mochi-lan-button mochi-lan-button--soft", type: "button", disabled: busy, onClick: requestRefresh }, "立即刷新状态"))
        )
      );
    }

    function LanOverlay() {
      var state = React.useSyncExternalStore(subscribeUi, uiSnapshot);
      return React.createElement("div", {
        className: "mochi-lan-overlay",
        hidden: !state.open,
        "aria-hidden": !state.open,
        onMouseDown: function (event) { if (event.target === event.currentTarget) closeLanPanel(); },
      }, React.createElement(LanPanel, { onClose: closeLanPanel, focusedMessageId: state.focusedMessageId }));
    }

    function LanFooterAction(props) {
      var state = React.useSyncExternalStore(subscribeUi, uiSnapshot);
      var label = footerLabel(state);
      return React.createElement("button", {
        type: "button",
        className: "mochi-lan-footer" + (props?.wide === false ? " mochi-lan-footer--rail" : ""),
        "aria-label": "教室连接，" + label,
        onClick: openLanPanel,
      },
      React.createElement("span", { className: "mochi-lan-footer__dot", "data-ready": state.configured ? "true" : "false", "aria-hidden": true }),
      React.createElement("span", null, "教室连接"),
      React.createElement("span", { className: "mochi-lan-footer__meta" }, label));
    }

    function footerLabel(state) {
      var label = !state.configured ? "待设置身份" : state.discoveryStatus === "DEGRADED" ? "自动发现暂不可用，可手动连接" : state.nearby ? "附近 " + state.nearby + " 台" : "正在发现";
      if (state.inbox) label += " · " + state.inbox + " 条待看";
      return label;
    }

    function installEscape() {
      if (typeof document === "undefined") return function () {};
      function onKeyDown(event) { if (event.key === "Escape" && uiSnapshot().open) closeLanPanel(); }
      document.addEventListener("keydown", onKeyDown);
      return function () { document.removeEventListener("keydown", onKeyDown); };
    }

    function apply(ctx) {
      ctx.effect(function () { return installStyles(); }, "mochi-lan-client: styles");
      ctx.effect(function () { return installEscape(); }, "mochi-lan-client: close controls");
      ctx.slots.inject("shell.overlay", function* () {
        yield ctx.slots.register({ name: "shell.overlay", id: "mochi-lan-overlay", order: 24 }, LanOverlay);
      });
      ctx.slots.inject("sidebar.footer.action", function* () {
        yield ctx.slots.register({ name: "sidebar.footer.action", id: "mochi-lan-entry", order: 24 }, LanFooterAction);
      });
    }

    module.exports.apply = apply;
    module.exports.inject = ["slots"];
    module.exports.__test = {
      API_BASE: API_BASE,
      ROUTES: ROUTES,
      localTimeLabel: localTimeLabel,
      recipientProjection: recipientProjection,
      identityMatches: identityMatches,
      inboxBinding: inboxBinding,
      normalizeSnapshot: normalizeSnapshot,
      normalizeDiscovery: normalizeDiscovery,
      footerLabel: footerLabel,
      identityInput: identityInput,
      manualAddressInput: manualAddressInput,
      canRequestPair: canRequestPair,
      peerPresence: peerPresence,
      requestJson: requestJson,
      createLanApi: createLanApi,
      confirmationFor: confirmationFor,
      executeConfirmation: executeConfirmation,
      emptySnapshot: emptySnapshot,
      attentionState: attentionState,
      newAttentionKinds: newAttentionKinds,
      focusedUnreadMessageId: focusedUnreadMessageId,
      focusedInboxMessage: focusedInboxMessage,
      studentRequestInput: studentRequestInput,
      requestRailSync: requestRailSync,
      StudentRequestCard: StudentRequestCard,
      InboxCard: InboxCard,
      IncomingMessageCard: IncomingMessageCard,
      openLanPanel: openLanPanel,
      openLanPanelForMessage: openLanPanelForMessage,
      uiSnapshot: uiSnapshot,
    };
    return module.exports;
  },
});
