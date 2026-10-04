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
      pairAccept: API_BASE + "/pair/accept",
      pairReject: API_BASE + "/pair/reject",
      messageSeen: API_BASE + "/message-seen",
    });
    var STYLE_ID = "mochi-lan-client-style";
    var POLL_MS = 3_000;
    var REQUEST_KINDS = Object.freeze(["appointment", "question", "makeup", "other"]);

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
      // The service saves the complete local identity verified at delivery.
      // Older rows without it remain history for either device role.
      if (!recipient.role || !recipient.endpointId || !recipient.schoolId
        || (recipient.role === "classroom" && !recipient.classId)
        || !recipient.displayName || !recipient.fingerprint) return null;
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

    function directiveProjection(value) {
      if (!value || typeof value !== "object") return null;
      var verdicts = rows(value.verdicts).slice(0, 64).map(function (row) {
        var action = ["call", "pass", "fail", "retry"].includes(row.action) ? row.action : "";
        var student = text(row.student, 120);
        var seat = Number(row.seat);
        if (!action || !student) return null;
        return Object.freeze({
          student: student,
          action: action,
          seat: Number.isSafeInteger(seat) && seat >= 1 && seat <= 999 ? seat : null,
          note: text(row.note, 200),
        });
      }).filter(Boolean);
      return verdicts.length ? Object.freeze({ item: text(value.item, 120), verdicts: Object.freeze(verdicts) }) : null;
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
        pairingCode: Object.freeze({ code: /^\d{6}$/u.test(input.pairingCode?.code || "") ? input.pairingCode.code : "", expiresAt: unixMilliseconds(input.pairingCode?.expiresAt) }),
        http: input.http !== null && typeof input.http === "object" ? Object.freeze({
          host: text(input.http.host, 128),
          port: Number.isSafeInteger(Number(input.http.port)) ? Number(input.http.port) : 0,
        }) : null,
        localAddresses: Object.freeze(rows(input.localAddresses).slice(0, 16).map(function (row) {
          var item = object(row);
          var port = Number(item.port);
          return Object.freeze({ name: text(item.name, 80), address: text(item.address, 45), port: Number.isSafeInteger(port) && port > 0 && port <= 65535 ? port : 0 });
        }).filter(function (row) { return row.address && row.port; })),
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
            contentType: text(item.contentType, 24),
            request: item.request && typeof item.request === "object" ? item.request : null,
            directive: directiveProjection(item.directive),
            response: item.response && typeof item.response === "object" ? item.response : null,
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
            sender: item.sender ? identityProjection(item.sender) : null,
            peer: identityProjection(item.peer),
            body: text(item.body, 65536),
            contentType: text(item.contentType, 24),
            request: item.request && typeof item.request === "object" ? item.request : null,
            directive: directiveProjection(item.directive),
            response: item.response && typeof item.response === "object" ? item.response : null,
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

    function requestKind(request) {
      var kind = object(request).kind;
      if (REQUEST_KINDS.indexOf(kind) >= 0) return kind;
      // Old requests predate the kind field; a saved time is the only reliable
      // signal that they used the appointment flow.
      return object(request).slot ? "appointment" : "other";
    }

    function requestKindLabel(request) {
      return ({ appointment: "预约讲题", question: "提问", makeup: "补做登记", other: "留言" })[requestKind(request)];
    }

    function linkedRequest(snapshot, response) {
      var id = text(object(response).replyToMessageId, 120);
      return rows(snapshot?.outbox).find(function (item) { return item.messageId === id && item.contentType === "REQUEST"; }) || null;
    }

    function confirmedTimeMismatch(response, request) {
      return response?.decision === "confirmed" && request && requestKind(request) === "appointment"
        && String(response.slot || "").trim().replace(/\s+/gu, " ") !== String(request.slot || "").trim().replace(/\s+/gu, " ");
    }

    function appointmentDecisionText(response, request) {
      if (confirmedTimeMismatch(response, request)) {
        return "历史记录异常：学生申请时间“" + request.slot + "”，旧版回复却确认“" + response.slot + "”";
      }
      return response?.decision === "confirmed" ? "确认时间：" + (response.slot || "") : "改期建议：" + (response.slot || "");
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
        SCHOOL_MISMATCH: "学校标识不一致，不能继续配对。核对两端“本机身份”里的学校；登录校园账号不会自动改写它。",
        ROLE_FORBIDDEN: "当前角色没有此操作权限。",
        PAIRING_REQUIRED: "目标不是可用的已配对设备。",
        PEER_BLOCKED: "该设备已被拉黑。",
        FINGERPRINT_MISMATCH: "设备指纹与发现结果不一致。刷新并在对方屏幕核对新指纹，核对前不要重复申请。",
        PEER_VERSION_UNSUPPORTED: "对端未提供地址恢复验证，请检查两端 Mochi 是否已更新。",
        PROBE_REFUSED: "目标 TCP 端口拒绝连接。确认对方 Mochi 正在运行，再核对其“网络地址与监听端口”。",
        PROBE_TIMEOUT: "探测等待 5 秒后超时；这不能单独判断网络原因。核对地址和两端网络，再让学校网管检查隔离或防火墙。",
        PROBE_CANCELLED: "探测已取消。",
        PROBE_INVALID: "目标返回了无效响应或身份。",
        PROBE_FAILED: "连接探测遇到未分类错误。",
        DISCOVERY_UNAVAILABLE: "候选设备未响应，请检查地址或网络。",
        DISCOVERY_INVALID: "候选设备返回了无效的发现响应。",
        IDENTITY_REQUIRED: "对方尚未配置本机身份，请先完成身份设置。",
        ROLE_LOCK_REQUIRED: "此设备尚未由桌面启动配置锁定教师或教室角色。",
        MESSAGE_NOT_FOUND: "找不到这条收件。",
        MESSAGE_LIMIT: "本机或对端消息箱已满，投递未完成；已有待处理记录仍保留。请处理待办或联系管理员检查容量。",
        PAIR_REQUEST_NOT_FOUND: "找不到待确认的相识申请。",
        PAIRING_CODE_INVALID: "配对码无效或已过期，请核对对方屏幕上的新码。",
        PAIRING_CODE_RATE_LIMITED: "配对码尝试次数过多，请稍后再试。",
        RESPONSE_ALREADY_SENT: "这条学生请求已回复。",
        RESPONSE_REQUEST_MISMATCH: "原请求与当前教室配对不匹配，无法回复。",
        LAN_APPROVAL_STALE: "核对期间设备身份或配对已变化，请刷新后重新确认。",
        PAIRING_CHANGED: "原消息的设备身份或配对已变化，不能继续投递。",
        RECEIPT_UNCONFIRMED: "已读回执尚未确认，信件已保留，请重试。",
        DELIVERY_UNKNOWN: "投递结果未知；不会自动重发。",
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
        acceptPair: function (requestId, signal) { return call(ROUTES.pairAccept, { method: "POST", body: { requestId: requestId }, signal: signal }); },
        rejectPair: function (requestId, signal) { return call(ROUTES.pairReject, { method: "POST", body: { requestId: requestId }, signal: signal }); },
        markSeen: function (messageId, signal) { return call(ROUTES.messageSeen, { method: "POST", body: { messageId: messageId }, signal: signal }); },
      });
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
      if (action.type === "pair-accept") return api.acceptPair(value.requestId, signal);
      if (action.type === "pair-reject") return api.rejectPair(value.requestId, signal);
      if (action.type === "message-seen") return api.markSeen(value.messageId, signal);
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
    function closeLanPanel() { updateUi({ open: false, focusedMessageId: "", profileRequested: false }); }

    var currentProfile = null, firstProfilePrompt = false;
    function profileProjection(value) {
      if (!value || !["teacher", "classroom"].includes(value.role) || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("PROFILE_UNAVAILABLE");
      return Object.freeze({role:value.role,revision:value.revision,preferredAddress:text(value.preferredAddress,80),classroomAddress:text(value.classroomAddress,80),configured:value.configured===true,setupDismissed:value.setupDismissed===true});
    }
    function publishProfile(snapshot, dismissed) {
      currentProfile = snapshot;
      if (typeof document !== "undefined") document.documentElement.dataset.mochiUserProfileReady = String(Boolean(snapshot?.configured));
      window.dispatchEvent(new CustomEvent("mochi-user-profile-updated", {detail:{role:snapshot?.role,configured:Boolean(snapshot?.configured)}}));
      if (dismissed) {
        firstProfilePrompt = false;
        if (typeof document !== "undefined") document.documentElement.dataset.mochiUserProfilePromptDone = "true";
        window.dispatchEvent(new CustomEvent("mochi-user-profile-dismissed", {detail:{configured:Boolean(snapshot?.configured)}}));
      }
    }
    function openUserProfile() { updateUi({open:true,focusedMessageId:"",profileRequested:true}); }
    async function saveUserProfile(snapshot, changes) {
      return profileProjection(await requestJson("/api/mochi-profile",{method:"PATCH",body:{expectedRevision:snapshot.revision,changes:changes}}));
    }
    async function dismissUserProfile() {
      var snapshot=currentProfile;
      closeLanPanel();
      if (!firstProfilePrompt || !snapshot) return;
      try { snapshot=await saveUserProfile(snapshot,{setupDismissed:true}); } catch (_) { /* Closing must remain available when storage is unavailable. */ }
      publishProfile(snapshot,true);
    }

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

    function reportRailSyncHealth(ok) {
      var bridge = typeof window === "object" ? window.mochiRailDesktop : null;
      if (!bridge || typeof bridge.reportSyncHealth !== "function") return false;
      try { return bridge.reportSyncHealth(ok) === true; } catch (_) { return false; }
    }

    function installStyles() {
      if (typeof document === "undefined") return function () {};
      var existing = document.getElementById(STYLE_ID);
      if (existing) return function () {};
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = [
        ".mochi-lan-setup-hint{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:14px;border:1px solid var(--dsw-alias-border-l2,#ded8cb);border-radius:12px}.mochi-lan-setup-hint p{margin:4px 0 0}.mochi-lan-profile-edit>summary,.mochi-lan-identity-edit>summary{min-block-size:36px;display:list-item;padding-block:8px;cursor:pointer;overflow-wrap:anywhere}.mochi-lan-folders{display:flex;gap:4px;inline-size:fit-content;max-inline-size:100%;padding:4px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,#ded8cb);margin:12px 0}.mochi-lan-folders button{min-block-size:44px;padding:8px 22px;border:0;border-radius:8px;font:600 14px/1.4 system-ui;color:inherit;background:transparent;cursor:pointer}.mochi-lan-folders button[aria-pressed='true']{background:var(--dsw-alias-bg-base,#fffdf7);box-shadow:0 1px 4px #00000012}.mochi-lan-folders button:focus-visible,.mochi-lan-panel summary:focus-visible,.mochi-lan-panel-footer button:focus-visible{outline:2px solid currentColor;outline-offset:3px}.mochi-lan-folders button:active{transform:translateY(1px)}.mochi-lan-technical{min-inline-size:0;border:1px solid var(--dsw-alias-border-l2,#ded8cb);border-radius:14px;padding:10px 12px}.mochi-lan-technical>summary{min-block-size:28px;cursor:pointer;font-weight:600}.mochi-lan-technical>.mochi-lan-card{margin-block-start:10px}.mochi-lan-pane{display:grid;gap:14px}.mochi-lan-pane[hidden]{display:none}.mochi-mail-hint{margin:0;font-size:13px;line-height:1.6}",
        ".mochi-lan-card form{display:grid;gap:8px;margin-top:12px}.mochi-lan-card form label{display:grid;gap:5px;font-size:13px}.mochi-lan-card form input{min-inline-size:0;inline-size:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2,#ded8cb);border-radius:10px;background:var(--dsw-alias-bg-base,#fffdf7);color:inherit;font:inherit}",
        ".mochi-lan-footer.mochi-lan-footer--rail{inline-size:36px;min-inline-size:0;min-block-size:40px;padding:0;justify-content:center;box-sizing:border-box;margin-inline:auto}.mochi-lan-footer--rail>span:not(.mochi-lan-footer__rail-icon){display:none}.mochi-lan-footer__rail-icon{display:flex;align-items:center;justify-content:center}",
        ".mochi-lan-history{margin-top:18px;border-top:1px solid var(--dsw-alias-border-l2,#ded8cb);padding-top:12px}.mochi-lan-history>summary{cursor:pointer;font-size:13px;color:var(--dsw-alias-label-secondary,#786e5c);margin-bottom:12px}.mochi-lan-message-details{font-size:12px;color:var(--dsw-alias-label-secondary,#786e5c)}.mochi-lan-message-details>summary{cursor:pointer;padding:5px 0}.mochi-lan-message-details[open]{padding-bottom:8px}",
        ".mochi-lan-overlay{position:fixed;inset:0;z-index:32;display:grid;place-items:center;padding:20px;box-sizing:border-box;background:rgba(20,31,25,.24);backdrop-filter:blur(22px) saturate(1.18);-webkit-backdrop-filter:blur(22px) saturate(1.18);pointer-events:auto}",
        ".mochi-lan-overlay[hidden]{display:none}",
        ".mochi-lan-panel{inline-size:min(900px,100%);max-block-size:min(840px,calc(100vh - 40px));overflow:auto;border:1px solid rgba(255,255,255,.68);border-radius:28px;background:rgba(247,250,246,.88);color:#203329;box-shadow:0 32px 90px rgba(12,24,17,.3),inset 0 1px 0 rgba(255,255,255,.76);backdrop-filter:blur(32px) saturate(1.24);-webkit-backdrop-filter:blur(32px) saturate(1.24);font:400 14px/1.55 'PingFang SC','Noto Sans CJK SC',system-ui,sans-serif;animation:mochi-lan-enter 220ms cubic-bezier(.2,.8,.2,1) both}",
        ".mochi-lan-head{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;gap:14px;padding:20px 22px;background:rgba(247,250,246,.82);border-bottom:1px solid rgba(77,100,85,.12);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px)}",
        ".mochi-lan-head__eyebrow{margin:0 0 4px;color:#668071;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.mochi-lan-head__title{margin:0;color:#1f493a;font:720 22px/1.2 'PingFang SC',system-ui,sans-serif;letter-spacing:-.025em}.mochi-lan-head__desc{margin:6px 0 0;color:#587063;font-size:13px}.mochi-lan-close{min-inline-size:40px;min-block-size:40px;margin-left:auto;border:1px solid rgba(51,91,70,.16);border-radius:50%;background:rgba(255,255,255,.62);color:#244f3e;padding:8px 12px;cursor:pointer;font:600 12px/1 system-ui}.mochi-lan-close:hover{background:#fff}",
        ".mochi-lan-body{display:grid;gap:14px;padding:18px}.mochi-lan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.mochi-lan-card{min-width:0;border:1px solid rgba(255,255,255,.72);border-radius:19px;background:rgba(255,255,255,.57);padding:16px;box-shadow:0 8px 22px -20px rgba(27,48,37,.68),inset 0 1px 0 rgba(255,255,255,.58);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}",
        ".mochi-lan-card--wide{grid-column:1/-1}.mochi-lan-card__title{margin:0;color:#244f3e;font:700 15px/1.35 'PingFang SC',system-ui,sans-serif}.mochi-lan-card__intro{margin:5px 0 0;color:#607267;font-size:12px}.mochi-lan-list{display:grid;gap:8px;margin-top:11px}.mochi-lan-row{display:grid;gap:6px;padding:11px 12px;border:1px solid rgba(77,100,85,.12);border-radius:14px;background:rgba(255,255,255,.56)}.mochi-lan-row__top{display:flex;align-items:flex-start;gap:8px;justify-content:space-between}.mochi-lan-row__name{font-weight:700;overflow-wrap:anywhere}.mochi-lan-meta{color:#617267;font-size:12px;overflow-wrap:anywhere}.mochi-lan-fingerprint{font:500 11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#52675a;overflow-wrap:anywhere}",
        ".mochi-lan-guide{overflow:hidden;border:1px solid rgba(255,255,255,.74);border-radius:22px;background:linear-gradient(135deg,rgba(255,255,255,.76),rgba(225,238,229,.68));padding:18px 20px;box-shadow:0 12px 30px -28px rgba(30,65,44,.52),inset 0 1px 0 rgba(255,255,255,.82)}.mochi-lan-guide__eyebrow{margin:0 0 5px;color:#678071;font-size:11px;font-weight:750;letter-spacing:.08em}.mochi-lan-guide__title{margin:0;color:#1f493a;font:700 18px/1.3 'PingFang SC',system-ui,sans-serif;letter-spacing:-.02em}.mochi-lan-guide__desc{margin:6px 0 0;color:#587063;font-size:13px}.mochi-lan-guide__examples{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:9px;margin-top:14px}.mochi-lan-guide__example{min-width:0;margin:0;padding:12px 13px;border:1px solid rgba(72,112,86,.11);border-radius:15px;background:rgba(255,255,255,.58);color:#2d4e3b}.mochi-lan-guide__label{display:block;margin-bottom:5px;color:#6b8574;font-size:11px;font-weight:700}.mochi-lan-guide__quote{margin:0;font-size:13px;line-height:1.45;overflow-wrap:anywhere}",
        ".mochi-lan-code{margin-top:10px;padding:10px 12px;border:1px solid rgba(77,100,85,.13);border-radius:14px;background:rgba(255,255,255,.55)}.mochi-lan-code summary{color:#315744;font-size:12px;font-weight:700;cursor:pointer}.mochi-lan-code__value{display:block;margin-top:7px;text-align:center;letter-spacing:.24em;color:#1f493a;font:700 27px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}",
        ".mochi-lan-notice{display:grid;gap:8px;border:1px solid rgba(191,128,50,.34);border-radius:19px;background:rgba(255,243,218,.84);padding:15px;box-shadow:0 10px 24px -22px rgba(81,52,18,.7)}.mochi-lan-notice__title{margin:0;color:#774516;font:750 16px/1.35 'PingFang SC',system-ui,sans-serif}.mochi-lan-notice__body{max-block-size:min(160px,24vh);overflow:auto;padding:10px 11px;border-radius:12px;background:rgba(255,255,255,.64);color:#563d1d;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}",
        ".mochi-lan-status{display:inline-flex;align-items:center;gap:5px;flex:none;padding:4px 8px;border-radius:999px;background:#e7f0e8;color:#28523e;font-size:11px;font-weight:650}.mochi-lan-status::before{content:'';inline-size:6px;block-size:6px;border-radius:50%;background:currentColor}.mochi-lan-status--warn{background:#fff0d2;color:#8a5a1d}.mochi-lan-status--danger{background:#f8e2dc;color:#9a452e}.mochi-lan-status--quiet{background:#ecefe9;color:#68736c}",
        ".mochi-lan-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:11px}.mochi-lan-button{min-block-size:38px;border:1px solid rgba(42,87,67,.16);border-radius:999px;background:#2d6a51;color:#fff;padding:9px 14px;cursor:pointer;font:650 12px/1 system-ui;transition:background-color 140ms ease,transform 140ms ease}.mochi-lan-button:hover{background:#225640;transform:translateY(-1px)}.mochi-lan-button:focus-visible,.mochi-lan-close:focus-visible{outline:3px solid rgba(69,130,91,.4);outline-offset:2px}.mochi-lan-button:disabled{cursor:not-allowed;opacity:.48;transform:none}.mochi-lan-button--soft{background:rgba(255,255,255,.68);color:#28523e}.mochi-lan-button--soft:hover{background:#fff}",
        ".mochi-lan-confirm{border:1px solid rgba(191,128,50,.35);border-radius:19px;background:rgba(255,243,218,.87);padding:15px}.mochi-lan-confirm__title{margin:0;color:#774516;font-weight:750}.mochi-lan-confirm__body{margin:6px 0;color:#664b28;font-size:13px}.mochi-lan-confirm__target{margin:8px 0;padding:10px;border-radius:12px;background:rgba(255,255,255,.62);color:#563d1d;white-space:pre-wrap;overflow-wrap:anywhere;font:500 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.mochi-lan-error{border:1px solid rgba(154,69,46,.25);border-radius:14px;background:rgba(255,240,235,.92);color:#8e3f2c;padding:11px;font-size:13px}.mochi-lan-empty{margin:10px 0 0;color:#718076;font-size:12px}.mochi-lan-bodytext{white-space:pre-wrap;overflow-wrap:anywhere;color:#31483b;font-size:13px}",
        ".mochi-lan-directive{display:grid;gap:4px;max-block-size:min(220px,32vh);overflow:auto;padding:10px 11px;border-radius:12px;background:rgba(45,106,81,.07);font-size:12px}.mochi-lan-row[data-mochi-lan-focused='true']{border-color:#c38b44;box-shadow:0 0 0 2px rgba(195,139,68,.18)}",
        ".mochi-lan-footer{display:flex;align-items:center;gap:8px;inline-size:100%;min-block-size:40px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,#eff5ed);padding:8px 10px;cursor:pointer;text-align:left;font:600 13px/1.3 'PingFang SC',system-ui,sans-serif}.mochi-lan-footer:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.09))}.mochi-lan-footer__dot{inline-size:8px;block-size:8px;border-radius:50%;background:#c38b44;box-shadow:0 0 0 3px rgba(195,139,68,.16)}.mochi-lan-footer__dot[data-ready='true']{background:#67a879}.mochi-lan-footer__meta{margin-left:auto;color:var(--dsw-alias-label-secondary,#aebbb2);font-size:11px}",
        "@keyframes mochi-lan-enter{from{opacity:0;transform:translateY(8px) scale(.99)}to{opacity:1;transform:translateY(0) scale(1)}}@media(prefers-reduced-motion:reduce){.mochi-lan-panel{animation:none;scroll-behavior:auto}.mochi-lan-button{transition:none}.mochi-lan-button:hover{transform:none}}@media(prefers-reduced-transparency:reduce){.mochi-lan-overlay{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(20,31,25,.48)}.mochi-lan-panel{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(247,250,246,.98)}.mochi-lan-head{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(247,250,246,.98)}.mochi-lan-card,.mochi-lan-guide{backdrop-filter:none;-webkit-backdrop-filter:none;background:#f5f8f3}}@media(prefers-contrast:more){.mochi-lan-panel,.mochi-lan-card,.mochi-lan-guide,.mochi-lan-row{border-color:rgba(24,54,37,.42)}.mochi-lan-meta,.mochi-lan-card__intro,.mochi-lan-head__desc{color:#3d5546}}@media(max-width:600px){.mochi-lan-overlay{padding:8px}.mochi-lan-panel{max-block-size:calc(100vh - 16px);border-radius:21px}.mochi-lan-head{padding:15px 16px}.mochi-lan-body{gap:11px;padding:12px}.mochi-lan-guide{padding:15px}.mochi-lan-guide__examples{grid-template-columns:1fr}}",
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

    function directiveActionLabel(action) {
      return { call: "请到指定地点", pass: "过关", fail: "不过关", retry: "需补做" }[action] || "处置";
    }

    function DirectiveDetails(props) {
      var directive = props.directive;
      if (!directive) return null;
      return React.createElement("div", { className: "mochi-lan-directive" },
        React.createElement("strong", null, directive.item || "学生处置"),
        directive.verdicts.map(function (row, index) {
          return React.createElement("div", { className: "mochi-lan-bodytext", key: index },
            (index + 1) + ". " + row.student + (row.seat ? "（" + row.seat + " 号）" : "")
              + " · " + directiveActionLabel(row.action) + (row.note ? " — " + row.note : ""));
        })
      );
    }

    function baseFocusedMessageId(value) {
      return text(value, 120).replace(/#\d+$/u, "");
    }

    function connectionStep(snapshot, candidates) {
      if (!snapshot.lockedRole) return { id: "role", step: 1, title: "先选这台电脑的用途", detail: "办公室电脑选教师端，教室一体机选教室端。在 Mochi 的桌面菜单中选择角色后重新打开。" };
      if (!snapshot.identity) return { id: "identity", step: 1, title: "先告诉 Mochi：这是谁的电脑", detail: snapshot.lockedRole === "teacher" ? "在“设置本机学校与设备”填写学校和设备名称；也可以返回对话告诉 Mochi。" : "在“设置本机学校与设备”填写学校、班级和设备名称；学校需与教师端一致，也可以通过对话设置。" };
      if (!snapshot.started) return { id: "service", step: 2, title: "本机连接服务尚未就绪", detail: "先点刷新；仍未就绪时从 Mochi 桌面菜单打开诊断。暂时不要反复输入配对码。" };
      if (snapshot.pendingPairings.length) return { id: "approve", step: 3, title: "有配对申请，等你核对", detail: "在下方“待确认配对”核对学校、老师姓名和设备指纹，再点“核对后接受”。只发现设备还不算完成配对。" };
      var peers = snapshot.peers.filter(function (peer) { return !peer.blocked; });
      if (peers.length) {
        var nearby = peers.some(function (peer) { return peerPresence(peer, candidates, snapshot.blockedPeers) === "nearby"; });
        var confirmed = snapshot.outbox.some(function (message) {
          return peers.some(function (peer) { return identityMatches(peer.identity, message.peer); })
            && snapshot.receipts.some(function (receipt) { return receipt.messageId === message.messageId && identityMatches(receipt.from, message.peer); });
        });
        return { id: "paired", step: 4, title: confirmed ? "测试纸条已收到人工回执" : nearby ? "配对已保存，发一张测试纸条" : "配对已保存，先确认对方可达", detail: confirmed
          ? "已看到回执证实这张纸条已被对方确认；这不代表设备会一直在线。日常消息继续查看各自的送达与已看到结果。"
          : (nearby ? "当前发现了同一设备，仍需实际收发验收。" : "最近未发现同一设备，这不能单独断定离线。先确认两台电脑都打开 Mochi，再刷新或按已保存地址检查连接。") + "在教师端说“给【班级】发一条测试通知”，确认发送后，到教室端点“已读，撕下”。收到已看到回执，才算走通这次收发。" };
      }
      var available = rows(candidates).some(function (candidate) { return canRequestPair(snapshot.identity, candidate); });
      return { id: "pair", step: 2, title: snapshot.lockedRole === "teacher" ? (available ? "发现教室，先核对设备再取配对码" : "去教室屏取配对码") : "把下方配对码交给老师", detail: snapshot.lockedRole === "teacher" ? "在下方展开目标设备，核对学校、班级、名称与指纹，再到教室屏取 6 位配对码。回到对话说“用配对码【6 位码】连接教室”；核对后确认申请，等待教室屏接受。等待期间不要重复发起。" : "教师在自己的 Mochi 对话里说“用配对码【6 位码】连接教室”。本机收到申请后，会在下方出现接受按钮。先核对学校、教师姓名与指纹；过期后使用新码。" };
    }

    function ConnectionGuide(props) {
      var current = props.fresh === false ? {id:"refresh",step:2,title:"当前连接状态尚未更新",detail:"下方身份与配对是最近保存的记录。先点“重新连接”，刷新成功后再核对设备；当前不据旧发现结果发起申请。"} : connectionStep(props.snapshot, props.candidates);
      return React.createElement("section", { className: "mochi-lan-guide mochi-lan-connection-guide", "aria-label": "连接下一步", "data-step": current.id },
        React.createElement("p", { className: "mochi-lan-guide__eyebrow" }, "两台电脑，四步连好"),
        React.createElement("ol", { className: "mochi-lan-steps" }, ["设置身份", "教师发起", "教室接受", "纸条验收"].map(function (label, i) {
          return React.createElement("li", { key: label, "aria-current": current.step === i + 1 ? "step" : undefined }, (i + 1) + ". " + label);
        })),
        React.createElement("h2", { className: "mochi-lan-guide__title" }, current.title),
        React.createElement("p", { className: "mochi-lan-guide__desc" }, current.detail),
        React.createElement("p", { className: "mochi-lan-meta" }, "两台电脑需接入互通的校园网络；有线网与 Wi-Fi 也可以互连，是否互通取决于学校网络设置。"),
        React.createElement("details", null,
          React.createElement("summary", null, "没有发现设备，或配对后收不到？"),
          React.createElement("p", { className: "mochi-lan-card__intro" }, "先确认对方已开机且 Mochi 正在运行，再刷新。把下方“网络地址与监听端口”里的地址告诉 Mochi，要求检查连接；不要把“附近发现”“已配对”当成“消息已送达”。发现不到但地址能连通时，仍可按地址配对；跨网段隔离或防火墙阻断需要学校网管处理。")
        )
      );
    }

    function IdentityCard(props) {
      var identity = props.snapshot.identity;
      return React.createElement("section", { className: "mochi-lan-card", "aria-label": "本机身份状态" },
        React.createElement("h2", { className: "mochi-lan-card__title" }, "本机身份"),
        identity ? React.createElement("div", { className: "mochi-lan-list" },
          React.createElement("article", { className: "mochi-lan-row" },
            React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, identity.displayName), React.createElement(Status, null, roleLabel(identity.role))),
            React.createElement(DetailLine, { identity: identity }),
            React.createElement("div", { className: "mochi-lan-fingerprint" }, identity.fingerprint || "指纹生成中"),
            React.createElement("p", { className: "mochi-lan-meta" }, "这里是本机设备身份；校园账号在“设置”中登录。两端学校需一致，教室班级也要核对。")
          )
        ) : React.createElement("div", { className: "mochi-lan-row" },
          React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, "尚未设置本机身份"), React.createElement(Status, { kind: "warn" }, props.snapshot.lockedRole ? roleLabel(props.snapshot.lockedRole) : "角色未锁定")),
          React.createElement("p", { className: "mochi-lan-card__intro" }, props.snapshot.lockedRole ? "直接告诉 Mochi 学校、班级（教室端）和设备显示名称即可完成初始化。" : "请先在桌面配置锁定教师端或教室端角色；随后身份初始化也可以直接告诉 Mochi。")
        )
      );
    }

    function UserProfileCard(props) {
      var profileState=React.useState(null), profile=profileState[0];
      var addressState=React.useState(""), address=addressState[0];
      var errorState=React.useState(""), error=errorState[0];
      var conflictState=React.useState(false), conflict=conflictState[0];
      var busyState=React.useState(false), busy=busyState[0], lock=React.useRef(false);
      var authState=React.useState(window.mochiCampusIdentitySnapshot || {status:"unknown"}), auth=authState[0];
      var addressSummaryRef=React.useRef(null), addressFocusPending=React.useRef(false);
      React.useEffect(function(){
        if (!addressFocusPending.current || props.profileRequested || !profile) return;
        addressFocusPending.current=false;
        var summary=addressSummaryRef.current, editor=summary?.parentElement;
        if (!editor) return;
        var restore=editor.contains(document.activeElement);
        editor.open=false;
        if (restore) summary.focus({preventScroll:true});
      },[profile?.revision,props.profileRequested]);
      var schoolState=React.useState(""), school=schoolState[0];
      var classState=React.useState(""), classId=classState[0];
      var deviceState=React.useState(""), device=deviceState[0];
      function adopt(value){profileState[1](value);addressState[1](value.role==="teacher"?value.preferredAddress:value.classroomAddress);publishProfile(value,value.configured||value.setupDismissed)}
      React.useEffect(function(){var alive=true;var abort=new AbortController();requestJson("/api/mochi-profile",{signal:abort.signal}).then(function(value){if(!alive)return;var next=profileProjection(value);adopt(next);if(!next.configured&&!next.setupDismissed){firstProfilePrompt=true;openUserProfile()}}).catch(function(e){if(!alive||e.name==="AbortError")return;errorState[1]("称呼设置暂不可用，可继续使用并稍后重试。");publishProfile(null,true)});return function(){alive=false;abort.abort()}},[]);
      React.useEffect(function(){var identity=props.snapshot.identity;schoolState[1](identity?.schoolId||"");classState[1](identity?.classId||"");deviceState[1](identity?.displayName||"")},[props.snapshot.identity?.schoolId,props.snapshot.identity?.classId,props.snapshot.identity?.displayName]);
      React.useEffect(function(){function changed(event){authState[1](event.detail||{status:"unknown"})}window.addEventListener("campus:auth-state",changed);return function(){window.removeEventListener("campus:auth-state",changed)}},[]);
      async function reloadProfile(){if(lock.current)return;lock.current=true;busyState[1](true);try{adopt(profileProjection(await requestJson("/api/mochi-profile")));conflictState[1](false);errorState[1]("")}catch(_){errorState[1]("最新称呼暂时无法读取，请稍后重试。")}finally{lock.current=false;busyState[1](false)}}
      async function save(event){event.preventDefault();if(lock.current||!profile||conflict)return;lock.current=true;busyState[1](true);errorState[1]("");try{var key=profile.role==="teacher"?"preferredAddress":"classroomAddress";var changes={setupDismissed:true};changes[key]=address;var saved=await saveUserProfile(profile,changes);addressFocusPending.current=true;adopt(saved);updateUi({profileRequested:false})}catch(e){conflictState[1](e.code==="PROFILE_CHANGED");errorState[1](e.code==="PROFILE_CHANGED"?"称呼已在另一页面修改，未覆盖。先读取最新称呼，核对后再修改。":"称呼未保存，请检查长度后重试；可继续使用。")}finally{lock.current=false;busyState[1](false)}}
      async function saveIdentity(event){event.preventDefault();if(lock.current||!profile)return;lock.current=true;busyState[1](true);errorState[1]("");try{var identity={schoolId:school,displayName:device};if(profile.role==="classroom")identity.classId=classId;await requestJson(API_BASE+"/identity",{method:"POST",body:{identity:identity}});props.onRefresh()}catch(e){errorState[1](errorLabel(e))}finally{lock.current=false;busyState[1](false)}}
      var authLabel=auth.status==="authenticated"&&auth.user ? "校园已登录："+text(auth.user.name,80) : auth.status==="unauthenticated" ? "校园账号尚未登录" : "校园身份：状态待验证";
      var addressEditor = profile ? React.createElement("details", { key:"address", className:"mochi-lan-profile-edit", open:Boolean(props.profileRequested || error || (!profile.configured && !profile.setupDismissed)) || undefined },
        React.createElement("summary", {ref:addressSummaryRef}, (profile.role === "teacher" ? profile.preferredAddress : profile.classroomAddress) ? (profile.role === "teacher" ? profile.preferredAddress : profile.classroomAddress) + " · 编辑称呼" : "设置 Mochi 的称呼"),
        React.createElement("form", { onSubmit:save, "data-mochi-user-profile-form":"true" },
          React.createElement("label", null, profile.role === "teacher" ? "Mochi 怎么称呼你？" : "Mochi 怎么称呼这个班的小伙伴？",
            React.createElement("input", { value:address, maxLength:80, "data-mochi-user-address":"true", placeholder:profile.role === "teacher" ? "例如：王老师、小林" : "例如：星星班的小伙伴们", disabled:busy, onChange:function(e){addressState[1](e.target.value)} })),
          React.createElement("p", { className:"mochi-lan-meta" }, "称呼偏好，可随时修改；不是认证实名。"),
          React.createElement("div", { className:"mochi-lan-actions" },
            React.createElement("button", { className:"mochi-lan-button", type:"submit", disabled:busy || conflict }, busy ? "正在保存…" : "保存称呼"),
            React.createElement("button", { className:"mochi-lan-button mochi-lan-button--soft", type:"button", disabled:busy, onClick:dismissUserProfile }, "稍后设置")))) : null;
      var identityEditor = profile ? React.createElement("details", { key:"identity", className:"mochi-lan-identity-edit", open:!props.snapshot.identity || undefined },
        React.createElement("summary", null, props.snapshot.identity ? [props.snapshot.identity.displayName,props.snapshot.identity.schoolId,props.snapshot.identity.classId].filter(Boolean).join(" · ") + " · 编辑本机信息" : "设置本机学校与设备"),
        React.createElement("form", { onSubmit:saveIdentity, "data-mochi-lan-identity-form":"true" },
          React.createElement("label", null, "学校", React.createElement("input", { value:school, maxLength:120, required:true, disabled:busy, onChange:function(e){schoolState[1](e.target.value)} })),
          profile.role === "classroom" ? React.createElement("label", null, "班级", React.createElement("input", { value:classId, maxLength:120, required:true, disabled:busy, onChange:function(e){classState[1](e.target.value)} })) : null,
          React.createElement("label", null, "设备显示名称", React.createElement("input", { value:device, maxLength:80, required:true, disabled:busy, onChange:function(e){deviceState[1](e.target.value)} })),
          React.createElement("p", { className:"mochi-lan-meta" }, "这是本机收发信件的信息，不会登录校园账号或授予校园权限；两端学校需一致。"),
          React.createElement("div", { className:"mochi-lan-actions" }, React.createElement("button", { className:"mochi-lan-button", type:"submit", disabled:busy }, "保存本机身份")))) : null;
      return React.createElement("section", { className:"mochi-lan-card", "aria-label":"称呼与基本信息" },
        React.createElement("h2", { className:"mochi-lan-card__title" }, "称呼与本机信息"),
        React.createElement("p", { className:"mochi-lan-meta", "data-mochi-campus-auth":auth.status }, authLabel),
        error ? React.createElement("p", { className:"mochi-lan-error", role:"alert" }, error) : null,
        conflict ? React.createElement("button", { className:"mochi-lan-button mochi-lan-button--soft", type:"button", disabled:busy, onClick:reloadProfile }, "读取最新称呼") : null,
        profile ? React.createElement(React.Fragment, null, props.snapshot.identity ? [addressEditor,identityEditor] : [identityEditor,addressEditor])
          : React.createElement("p", { className:"mochi-lan-meta" }, error ? "可以继续聊天，稍后从设备与连接重试。" : "正在读取本机称呼…"));
    }

    function ChatGuideCard(props) {
      var role = props.snapshot.lockedRole;
      var teacher = role === "teacher";
      var classroom = role === "classroom";
      var configured = Boolean(props.snapshot.identity);
      var examples = !configured && teacher ? [
        ["设置身份", "请把本机教师身份设置为【学校】，显示名为【教师姓名】。"],
      ] : !configured && classroom ? [
        ["设置身份", "请把本机教室身份设置为【学校】【班级】，显示名为【教室名称】。"],
      ] : teacher ? [
        ["配对教室", "请使用教室屏上显示的临时代码【6 位码】查找设备；核对学校和设备指纹后发起配对。"],
        ["发送通知", "把这条通知发给【班级】的教室屏：……"],
        ["检查连接", "教室设备地址是【IP:端口】，请帮我检查连接。"],
      ] : classroom ? [
        ["核对配对申请", "请检查教师发来的待审批申请，核对学校、身份和设备指纹，再让我选择接受或拒绝。"],
        ["预约讲题", "帮我向老师预约一次讲题，时间是【时间】。"],
        ["告诉老师配对码", "请使用教室屏上显示的本机临时代码发起配对；网络地址和发现状态仅供查看。"],
      ] : [];
      var description = !role
        ? "当前桌面尚未锁定本机角色；请先在桌面配置选择教师端或教室端。之后身份设置和日常操作都能直接告诉 Mochi。"
        : !configured
          ? "首次设置也可以直接告诉 Mochi；它会按桌面已锁定的角色核对身份信息。"
          : "不必填写任务表。像平时发消息一样告诉 Mochi；需要发送或建立配对时，它会先展示目标与内容供你确认。";
      return React.createElement("section", { className: "mochi-lan-guide", "aria-label": "Mochi 对话使用示例", "data-role": role || "unset" },
        React.createElement("p", { className: "mochi-lan-guide__eyebrow" }, "MOCHI 对话"),
        React.createElement("h2", { className: "mochi-lan-guide__title" }, "直接发消息，就能处理日常事情"),
        React.createElement("p", { className: "mochi-lan-guide__desc" }, description),
        examples.length ? React.createElement("div", { className: "mochi-lan-guide__examples" }, examples.map(function (item) {
          return React.createElement("article", { className: "mochi-lan-guide__example", key: item[0] },
            React.createElement("span", { className: "mochi-lan-guide__label" }, item[0]),
            React.createElement("p", { className: "mochi-lan-guide__quote" }, "“" + item[1] + "”")
          );
        })) : null
      );
    }

    function NearbyDeviceRow(props) {
      var candidate = props.candidate;
      var identity = candidate.identity;
      var canPair = canRequestPair(props.localIdentity, candidate);
      var kind = candidate.blocked ? "danger" : candidate.paired ? "" : canPair ? "warn" : "quiet";
      var label = candidate.blocked ? "已拉黑" : candidate.paired ? "已配对，当前附近" : canPair ? "附近发现，尚未配对" : "发现设备，暂不可配对";
      return React.createElement("article", { className: "mochi-lan-row" },
        React.createElement("div", { className: "mochi-lan-row__top" },
          React.createElement("strong", { className: "mochi-lan-row__name" }, identity.displayName || "未命名设备"),
          React.createElement(Status, { kind: kind }, label)
        ),
        React.createElement(DetailLine, { identity: identity, address: candidate.address }),
        React.createElement("div", { className: "mochi-lan-fingerprint" }, identity.fingerprint || "候选未提供指纹"),
        React.createElement("details", null,
          React.createElement("summary", null, "核对这台设备"),
          React.createElement("p", { className: "mochi-lan-meta" }, candidate.blocked ? "该设备已拉黑。如需恢复，请在对话中明确说明；这里不会自动解除。" : candidate.paired ? "配对已保存。发现结果只是附近可见，下一步用测试纸条核实收发。" : canPair ? "核对本机与此设备的学校、班级和屏幕指纹。教师取教室屏上的 6 位配对码，在对话里确认发起；教室还需接受。展开详情不会发出申请。" : "暂不可配对：请先核对两端身份是否已设置、学校是否一致，以及是否为教师与教室两种角色。")
        )
      );
    }

    function DiscoveryCard(props) {
      var candidates = props.candidates;
      var guidance = props.snapshot.lockedRole === "teacher"
        ? "设备列表每 3 秒更新。教师端可使用教室屏上的临时代码发起配对；连接排查请直接告诉 Mochi。"
        : props.snapshot.lockedRole === "classroom"
          ? "设备列表每 3 秒更新。将本机临时代码提供给教师；收到配对申请后先核对身份，再明确选择接受或拒绝。网络地址和发现状态仅供查看。"
          : "设备列表每 3 秒更新。配对与连接排查请直接在 Mochi 对话里说明。";
      return React.createElement("section", { className: "mochi-lan-card mochi-lan-card--wide", "aria-label": "附近设备状态" },
        React.createElement("div", { className: "mochi-lan-row__top" },
          React.createElement("h2", { className: "mochi-lan-card__title" }, "附近设备"),
          React.createElement(Status, { kind: props.fresh === false ? "quiet" : props.snapshot.discovery.status === "ACTIVE" ? "" : props.snapshot.discovery.status === "DEGRADED" ? "warn" : "quiet" }, props.fresh === false ? "状态未更新" : props.snapshot.discovery.status || "状态未知")
        ),
        React.createElement("p", { className: "mochi-lan-card__intro" }, guidance),
        candidates.length ? React.createElement("div", { className: "mochi-lan-list", "aria-live": "off" }, candidates.map(function (candidate) {
          return React.createElement(NearbyDeviceRow, { key: candidate.identity.endpointId + "@" + candidate.address.host, candidate: candidate, localIdentity: props.snapshot.identity });
        })) : React.createElement("p", { className: "mochi-lan-empty" }, props.snapshot.identity ? "目前没有发现附近设备。" : "完成本机身份设置后，这里会显示附近设备。")
      );
    }

    function visibleFocusCandidate(element) {
      if (element.closest?.("[hidden]")) return false;
      for (var ancestor=element.parentElement; ancestor; ancestor=ancestor.parentElement) {
        if (ancestor.tagName !== "DETAILS" || ancestor.open) continue;
        var summary=Array.from(ancestor.children).find(function(child){return child.tagName === "SUMMARY";});
        if (!summary || (element !== summary && !summary.contains(element))) return false;
      }
      return !element.getClientRects || element.getClientRects().length > 0;
    }

    function wrapTab(event, focusable) {
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && event.target === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first.focus(); }
      else if (focusable.indexOf(event.target) === -1) { event.preventDefault(); first.focus(); }
    }

    function PairingCard(props) {
      var snapshot = props.snapshot;
      return React.createElement("section", { className: "mochi-lan-card" },
        React.createElement("h2", { className: "mochi-lan-card__title" }, "设备配对"),
        React.createElement("p", { className: "mochi-lan-card__intro" }, snapshot.lockedRole === "classroom" ? "教室设备只接受同校教师的待确认配对申请。" : snapshot.lockedRole === "teacher" ? "教师设备只向经过身份核对的教室发起配对。" : "先由桌面启动配置锁定本机角色。"),
        snapshot.pairingCode.code ? React.createElement("div", { className: "mochi-lan-code", "aria-label": "本机临时配对码" },
          React.createElement("div", { className: "mochi-lan-meta" }, "本机临时配对码 · 2 分钟有效"),
          React.createElement("strong", { className: "mochi-lan-code__value" }, snapshot.pairingCode.code)
        ) : null,
        React.createElement("details", { className: "mochi-lan-code", open: snapshot.discovery.status === "DEGRADED" },
          React.createElement("summary", null, "网络地址与监听端口"),
          React.createElement("p", { className: "mochi-lan-card__intro" }, "仅供 Mochi 排查连接使用；附近发现正常也不代表对端一定可达。"),
          snapshot.localAddresses.length ? React.createElement("div", { className: "mochi-lan-list" }, snapshot.localAddresses.map(function (row) {
            return React.createElement("div", { className: "mochi-lan-row", key: row.name + ":" + row.address },
              React.createElement("strong", { className: "mochi-lan-row__name" }, row.address + ":" + row.port),
              React.createElement("div", { className: "mochi-lan-meta" }, "网卡：" + row.name)
            );
          })) : React.createElement("p", { className: "mochi-lan-empty" }, "暂时没有可用的 IPv4 地址，请检查本机网络连接。")
        ),
        snapshot.pendingPairings.length ? React.createElement(React.Fragment || "div", null,
          React.createElement("h3", { className: "mochi-lan-card__title", style: { marginTop: "14px" } }, "待确认配对"),
          React.createElement("div", { className: "mochi-lan-list" }, snapshot.pendingPairings.map(function (pending) {
            return React.createElement("article", { className: "mochi-lan-row", key: pending.requestId },
              React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, pending.peer.displayName), React.createElement(Status, { kind: "warn" }, "待人工确认")),
              React.createElement(DetailLine, { identity: pending.peer }),
              React.createElement("div", { className: "mochi-lan-fingerprint" }, pending.peer.fingerprint),
              React.createElement("div", { className: "mochi-lan-actions" },
                React.createElement("button", { className: "mochi-lan-button", type: "button", disabled: props.busy || snapshot.lockedRole !== "classroom", onClick: function () { props.onConfirm(confirmationFor("pair-accept", { requestId: pending.requestId, peer: pending.peer })); } }, "核对后接受"),
                React.createElement("button", { className: "mochi-lan-button mochi-lan-button--soft", type: "button", disabled: props.busy || snapshot.lockedRole !== "classroom", onClick: function () { props.onConfirm(confirmationFor("pair-reject", { requestId: pending.requestId, peer: pending.peer })); } }, "拒绝申请")
              )
            );
          }))
        ) : React.createElement("p", { className: "mochi-lan-empty" }, "暂无待确认的配对申请。"),
        snapshot.peers.length ? React.createElement("div", { className: "mochi-lan-list" }, snapshot.peers.map(function (peer) {
          var presence = peerPresence(peer, props.candidates, snapshot.blockedPeers);
          var status = presence === "blocked" ? ["danger", "已拉黑"] : props.fresh === false ? ["quiet", "配对已保存，状态待刷新"] : presence === "nearby" ? ["", "已配对，附近可见"] : ["quiet", "已配对，暂未发现"];
          return React.createElement("article", { className: "mochi-lan-row", key: peer.identity.endpointId },
            React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, peer.identity.displayName), React.createElement(Status, { kind: status[0] }, status[1])),
            React.createElement(DetailLine, { identity: peer.identity, address: peer.address }),
            React.createElement("div", { className: "mochi-lan-fingerprint" }, peer.identity.fingerprint),
            presence === "not-discovered" ? React.createElement("div", { className: "mochi-lan-meta" }, "最近未发现广播；这不能单独判断设备是否离线。") : null
          );
        })) : React.createElement("p", { className: "mochi-lan-empty" }, "还没有已配对设备。"),
        snapshot.blockedPeers.length ? React.createElement("details", { className: "mochi-lan-code" },
          React.createElement("summary", null, "已拉黑设备 · " + snapshot.blockedPeers.length),
          React.createElement("div", { className: "mochi-lan-list" }, snapshot.blockedPeers.map(function (peer) {
            return React.createElement("div", { className: "mochi-lan-row", key: peer.endpointId },
              React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, peer.endpointId), React.createElement(Status, { kind: "danger" }, "已拉黑")),
              React.createElement("div", { className: "mochi-lan-meta" }, "解除拉黑或重新配对，请直接在 Mochi 对话里说明。")
            );
          }))
        ) : null
      );
    }

    async function tearReadPaper(messageId) {
      if (typeof document === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
      var paper = Array.from(document.querySelectorAll("article[data-mochi-lan-focus-message]")).find(function (item) {
        return item.getAttribute("data-mochi-lan-focus-message") === messageId && item.getClientRects().length;
      });
      if (!paper || typeof paper.animate !== "function") return;
      var rect = paper.getBoundingClientRect();
      var pieces = [];
      try {
        for (var side = 0; side < 2; side += 1) {
          var piece = paper.cloneNode(true);
          piece.removeAttribute("id"); piece.removeAttribute("data-mochi-lan-focus-message");
          piece.querySelectorAll("[id]").forEach(function (node) { node.removeAttribute("id"); });
          piece.classList.add("mochi-letter-piece"); piece.inert = true; piece.setAttribute("aria-hidden", "true");
          var edge = [];
          for (var step = 0; step <= 20; step += 1) edge.push((step * 5) + "% " + (step % 2 ? 51 : 49) + "%");
          piece.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;margin:0;box-sizing:border-box;left:" + rect.left + "px;top:" + rect.top + "px;width:" + rect.width + "px;height:" + rect.height + "px;clip-path:polygon(" + (side ? edge.join(",") + ",100% 100%,0 100%" : "0 0,100% 0," + edge.reverse().join(",")) + ")";
          document.body.appendChild(piece);
          pieces.push(piece);
        }
        paper.style.visibility = "hidden";
        await Promise.all(pieces.map(function (piece, index) {
          return piece.animate([{transform:"translate(0,0) rotate(0)",opacity:1},{transform: index ? "translate(32px,60px) rotate(7deg)" : "translate(-24px,-18px) rotate(-5deg)",opacity:0}], {duration:420,easing:"cubic-bezier(.2,.7,.3,1)",fill:"forwards"}).finished.catch(function () {});
        }));
      } finally {
        pieces.forEach(function (piece) { piece.remove(); });
        paper.style.visibility = "";
      }
    }

    function messageGroups(items, pending, render, focusedId, historyLabel) {
      var current = items.filter(pending);
      var history = items.filter(function (item) { return !pending(item); });
      return React.createElement(React.Fragment, null,
        current.length ? React.createElement("div", { className: "mochi-lan-list" }, current.map(render))
          : React.createElement("p", { className: "mochi-lan-empty" }, "这里没有待查看的信"),
        history.length ? React.createElement("details", { className: "mochi-lan-history", open: history.some(function (item) { return item.messageId === focusedId; }) || undefined },
          React.createElement("summary", null, (historyLabel || "已读收好与历史") + " · " + history.length),
          React.createElement("div", { className: "mochi-lan-list" }, history.map(render))) : null
      );
    }

    function MessageDetails(props) {
      return React.createElement("details", { className: "mochi-lan-message-details" },
        React.createElement("summary", null, "消息详情"), props.children);
    }

    function InboxCard(props) {
      var snapshot = props.snapshot;
      var lockedRole = snapshot.lockedRole;
      var classroomInbox = rows(snapshot.inbox).filter(function (item) { return !item.response || !linkedRequest(snapshot, item.response); });
      var teacherOutbox = rows(snapshot.outbox);
      var focusedId = baseFocusedMessageId(props.focusedMessageId);
      var canFocus = (lockedRole === "classroom" ? classroomInbox : teacherOutbox).some(function (item) { return item.messageId === focusedId; });
      React.useEffect(function () {
        if (!canFocus || typeof document === "undefined") return;
        var targets = document.querySelectorAll("[data-mochi-lan-focus-message]");
        for (var index = 0; index < targets.length; index += 1) {
          if (targets[index].getAttribute("data-mochi-lan-focus-message") === focusedId) {
            targets[index].scrollIntoView?.({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth" });
            break;
          }
        }
      }, [focusedId, canFocus]);
      return React.createElement("section", { className: "mochi-lan-card mochi-lan-card--wide" },
        React.createElement("h2", { className: "mochi-lan-card__title" }, lockedRole === "classroom" ? "教师通知" : "已发信件"),
        React.createElement("p", { className: "mochi-lan-card__intro" }, lockedRole === "classroom" ? "未确认的通知会保留在这里。" : lockedRole === "teacher" ? "给教室发送通知，请在 Mochi 对话中说明。" : "角色尚未锁定，不能执行收件确认或发送。"),
        lockedRole === "classroom" ? (classroomInbox.length ? messageGroups(classroomInbox, function (message) { return inboxBinding(snapshot, message) === "ACTIVE" && (!message.seenAt || message.seenReceipt !== "ACKNOWLEDGED"); }, function (message) {
          var binding = inboxBinding(snapshot, message);
          var actionable = binding === "ACTIVE";
          var historyLabel = binding === "MISSING_RECIPIENT" ? "历史收件未记录接收身份，不能发送已看到回执。"
            : binding === "RECIPIENT_MISMATCH" ? "历史收件的原目标与当前教室身份不一致，不能发送已看到回执。"
              : binding === "SENDER_UNPAIRED" ? "历史收件的原教师配对身份已变化，不能发送已看到回执。"
                : "";
          return React.createElement("article", { className: "mochi-lan-row", key: message.messageId, "data-mochi-lan-focus-message": message.messageId, "data-mochi-lan-focused": canFocus && message.messageId === focusedId ? "true" : undefined },
            React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, message.from.displayName || "已配对教师"), React.createElement(Status, { kind: actionable ? (message.seenAt ? "" : "warn") : "quiet" }, actionable ? (message.seenAt ? (message.seenReceipt === "ACKNOWLEDGED" ? "已读" : "回执待确认") : "待查看") : "历史收件")),
            React.createElement(MessageDetails, null, React.createElement(DetailLine, { identity: message.from }), React.createElement("div", { className: "mochi-lan-meta" }, "目标班级：" + (message.recipient?.classId || "历史收件身份未记录"))),
            React.createElement("div", { className: "mochi-lan-bodytext" }, message.body),
            message.attachment ? React.createElement("div", { className: "mochi-lan-meta" }, "课件：" + message.attachment.filename, (message.fileOpen || message.deliveryAck?.fileOpen) ? " · " + (message.fileOpen || message.deliveryAck.fileOpen).detail : (message.attachment.openWith === "wps" ? " · 等待 WPS 打开回执" : " · 已接收文件不代表已打开")) : null,
            message.directive ? React.createElement(MessageDetails, null, React.createElement(DirectiveDetails, { directive: message.directive })) : null,
            message.response ? React.createElement("div", { className: "mochi-lan-notice__body" }, message.response.decision === "replied" ? "教师文字回复：" + message.body : "教师回复：" + (message.response.decision === "confirmed" ? "确认时间 " : "建议改期 ") + message.response.slot) : null,
            React.createElement("div", { className: "mochi-lan-meta" }, localTimeLabel(message.receivedAt)),
            actionable ? (message.seenAt && message.seenReceipt === "ACKNOWLEDGED" ? React.createElement("div", { className: "mochi-lan-meta" }, "已读 · 收好了") : React.createElement("div", { className: "mochi-lan-actions" }, React.createElement("button", { className: "mochi-lan-button", type: "button", disabled: props.busy, onClick: function () { props.onConfirm(confirmationFor("message-seen", { messageId: message.messageId, from: message.from, body: message.body })); } }, "已读，撕下"))) : React.createElement("div", { className: "mochi-lan-meta" }, historyLabel)
          );
        }, focusedId) : React.createElement("p", { className: "mochi-lan-empty" }, "暂无教师通知")) : (teacherOutbox.length ? messageGroups(teacherOutbox, function (message) { return !snapshot.receipts.some(function (receipt) { return receipt.messageId === message.messageId && identityMatches(receipt.from, message.peer); }); }, function (message) {
          var receipt = snapshot.receipts.find(function (item) {
            return item.messageId === message.messageId && item.from.endpointId === message.targetEndpointId
              && item.from.fingerprint === message.peer.fingerprint;
          });
          return React.createElement("article", { className: "mochi-lan-row", key: message.messageId,
            "data-mochi-lan-focus-message": message.messageId,
            "data-mochi-lan-focused": baseFocusedMessageId(props.focusedMessageId) === message.messageId ? "true" : undefined },
            React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("strong", { className: "mochi-lan-row__name" }, message.peer.displayName || message.targetEndpointId), React.createElement(Status, { kind: message.delivery === "ACKNOWLEDGED" ? "" : "warn" }, receipt ? "已看到" : message.delivery === "ACKNOWLEDGED" ? "已送达 · 待查看" : message.delivery === "FAILED" ? "发送失败" : "等待送达")),
            React.createElement(MessageDetails, null, React.createElement(DetailLine, { identity: message.peer })),
            React.createElement("div", { className: "mochi-lan-bodytext" }, message.body),
            message.attachment ? React.createElement("div", { className: "mochi-lan-meta" }, "课件：" + message.attachment.filename, (message.fileOpen || message.deliveryAck?.fileOpen) ? " · " + (message.fileOpen || message.deliveryAck.fileOpen).detail : (message.attachment.openWith === "wps" ? " · 等待 WPS 打开回执" : " · 已接收文件不代表已打开")) : null,
            message.directive ? React.createElement(MessageDetails, null, React.createElement(DirectiveDetails, { directive: message.directive })) : null,
            React.createElement("div", { className: "mochi-lan-meta" }, receipt ? "对方已于 " + localTimeLabel(receipt.seenAt) + " 人工确认已看到" : "尚未收到人工已看到回执"),
            message.failureCode ? React.createElement("div", { className: "mochi-lan-meta" }, "最近结果：" + message.failureCode) : null
          );
        }, focusedId) : React.createElement("p", { className: "mochi-lan-empty" }, "暂无已发通知"))
      );
    }

    function TeacherRequestRow(props) {
      var message = props.message;
      var active = inboxBinding(props.snapshot, message) === "ACTIVE";
      var reply = rows(props.snapshot.outbox).find(function (item) { return item.response?.replyToMessageId === message.messageId; });
      var legacyTimeMismatch = confirmedTimeMismatch(reply?.response, message.request);
      var replySeen = reply && rows(props.snapshot.receipts).find(function (item) {
        return item.messageId === reply.messageId && item.from.endpointId === message.from.endpointId && item.from.fingerprint === message.from.fingerprint;
      });
      var replyStatus = reply?.delivery === "ACKNOWLEDGED" ? "已回复"
        : reply?.delivery === "UNKNOWN" ? "投递结果不明"
          : reply?.delivery === "PENDING" ? "正在投递"
            : reply ? "尚未确认投递" : "等待老师回复";
      var from = message.from;
      return React.createElement("article", { className: "mochi-lan-row", key: message.messageId, "data-mochi-lan-focus-message": message.messageId },
        React.createElement("div", { className: "mochi-lan-row__top" },
          React.createElement("strong", { className: "mochi-lan-row__name" }, requestKindLabel(message.request) + " · " + (message.request.student || "学生自述") + (message.request.seat ? " · " + message.request.seat + " 号" : "")),
          React.createElement(Status, { kind: !active ? "quiet" : legacyTimeMismatch ? "warn" : replySeen || reply?.delivery === "ACKNOWLEDGED" ? "" : "warn" }, active ? (legacyTimeMismatch ? "历史回复时间异常" : replySeen ? "对方已读" : replyStatus) + (message.seenAt ? " · 已读" : "") : "历史请求 · 仅可查看")
        ),
        React.createElement(MessageDetails, null, React.createElement(DetailLine, { identity: from })),
        React.createElement("div", { className: "mochi-lan-meta" }, [message.request.material, message.request.position, message.request.topic].filter(Boolean).join(" · ")),
        React.createElement("div", { className: "mochi-lan-bodytext" }, message.body),
        message.request.slot ? React.createElement("div", { className: "mochi-lan-request-time" }, React.createElement("span", null, "希望时间"), React.createElement("strong", null, message.request.slot)) : null,
        !active ? React.createElement("div", { className: "mochi-lan-meta" }, "原身份或教室配对已变化；此记录只可查看。")
          : message.seenAt ? React.createElement("div", { className: "mochi-lan-meta" }, "已看到回执：" + receiptLabel(message.seenReceipt), message.seenReceipt !== "ACKNOWLEDGED" ? React.createElement("button", { className: "mochi-lan-button mochi-lan-button--soft", type: "button", disabled: props.busy, onClick: function () { props.onConfirm(confirmationFor("message-seen", { messageId: message.messageId, from: from, body: message.body })); } }, "重试已看到回执") : null)
            : React.createElement("div", { className: "mochi-lan-actions" }, React.createElement("button", { className: "mochi-lan-button mochi-lan-button--soft", type: "button", disabled: props.busy, onClick: function () { props.onConfirm(confirmationFor("message-seen", { messageId: message.messageId, from: from, body: message.body })); } }, "已读，撕下")),
        reply ? React.createElement("div", null,
          React.createElement("div", { className: "mochi-lan-meta" }, (reply.response.decision === "replied" ? "教师文字回复：" + reply.body : appointmentDecisionText(reply.response, message.request)) + " · " + replyStatus),
          React.createElement("div", { className: "mochi-lan-meta" }, replySeen ? "教室已人工确认看到教师回复" : "教室尚未人工确认看到教师回复")
        ) : null,
        React.createElement("div", { className: "mochi-lan-meta" }, "收到：" + localTimeLabel(message.receivedAt))
      );
    }

    function ClassroomRequestRow(props) {
      var message = props.message;
      var active = Boolean(message.sender && identityMatches(message.sender, props.snapshot.identity))
        && rows(props.snapshot.peers).some(function (peer) { return peer.blocked !== true && identityMatches(peer.identity, message.peer); });
      var teacherReply = rows(props.snapshot.inbox).find(function (item) {
        return item.response?.replyToMessageId === message.messageId
          && item.from.endpointId === message.targetEndpointId
          && item.from.fingerprint === message.peer.fingerprint;
      });
      var legacyTimeMismatch = confirmedTimeMismatch(teacherReply?.response, message.request);
      var seenReceipt = rows(props.snapshot.receipts).find(function (item) {
        return item.messageId === message.messageId
          && item.from.endpointId === message.targetEndpointId
          && item.from.fingerprint === message.peer.fingerprint;
      });
      return React.createElement("article", { className: "mochi-lan-row", key: message.messageId, "data-mochi-lan-focus-message": teacherReply?.messageId || message.messageId },
        React.createElement("div", { className: "mochi-lan-row__top" },
          React.createElement("strong", { className: "mochi-lan-row__name" }, (teacherReply ? (teacherReply.from.displayName || "老师") + "的回信" : requestKindLabel(message.request)) + " · " + (message.request?.topic || "学生请求")),
          React.createElement(Status, { kind: !active ? "quiet" : legacyTimeMismatch ? "warn" : teacherReply ? "" : "warn" }, !active ? "历史请求 · 仅可查看" : legacyTimeMismatch ? "历史回复时间异常" : teacherReply ? (teacherReply.response.decision === "replied" ? "老师已回复" : teacherReply.response.decision === "confirmed" ? "老师已确认" : "老师建议改期") : (seenReceipt ? "教师已看到" : message.delivery === "ACKNOWLEDGED" ? "已送达教师，尚无已看到回执" : message.delivery === "UNKNOWN" ? "投递结果不明" : "正在投递"))
        ),
        React.createElement(MessageDetails, null, React.createElement(DetailLine, { identity: message.peer }), teacherReply ? React.createElement("div", { className: "mochi-lan-bodytext" }, "我的原信：" + message.body) : null, React.createElement("div", { className: "mochi-lan-meta" }, seenReceipt ? "教师已看到原信：" + localTimeLabel(seenReceipt.seenAt) : "未收到单独查看回执")),
        teacherReply ? null : React.createElement("div", { className: "mochi-lan-bodytext" }, message.body),
        !teacherReply && message.request.slot ? React.createElement("div", { className: "mochi-lan-request-time" }, React.createElement("span", null, "希望时间"), React.createElement("strong", null, message.request.slot)) : null,
        !active ? React.createElement("div", { className: "mochi-lan-meta" }, "原教室身份或教师配对已变化；此记录只可查看。") : null,

        teacherReply ? React.createElement("div", null,
          React.createElement("div", { className: "mochi-lan-bodytext" }, teacherReply.response.decision === "replied" ? "教师文字回复：" + teacherReply.body : appointmentDecisionText(teacherReply.response, message.request)),
          teacherReply.seenAt ? React.createElement(MessageDetails, null, "已读回执：" + receiptLabel(teacherReply.seenReceipt)) : null,
          !active ? null : teacherReply.seenAt ? (teacherReply.seenReceipt !== "ACKNOWLEDGED" ? React.createElement("button", { className: "mochi-lan-button mochi-lan-button--soft", type: "button", disabled: props.busy, onClick: function () { props.onConfirm(confirmationFor("message-seen", { messageId: teacherReply.messageId, from: teacherReply.from, body: teacherReply.body })); } }, "重试已看到回执") : null) : React.createElement("button", { className: "mochi-lan-button", type: "button", disabled: props.busy, onClick: function () { props.onConfirm(confirmationFor("message-seen", { messageId: teacherReply.messageId, from: teacherReply.from, body: teacherReply.body })); } }, "已读，撕下")
        ) : null
      );
    }

    function ClassroomRequestsCard(props) {
      React.useEffect(function () {
        if (props.snapshot.lockedRole !== "classroom" || !props.focusedMessageId || typeof document === "undefined") return;
        var target = Array.from(document.querySelectorAll("article[data-mochi-lan-focus-message]")).find(function (item) { return item.getAttribute("data-mochi-lan-focus-message") === props.focusedMessageId; });
        target?.scrollIntoView?.({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth" });
      }, [props.focusedMessageId, props.snapshot.lockedRole]);

      if (props.snapshot.lockedRole !== "classroom") return null;
      var requests = rows(props.snapshot.outbox).filter(function (item) {
        return item.contentType === "REQUEST" && item.request && (!props.inboxOnly || rows(props.snapshot.inbox).some(function (reply) { return reply.response?.replyToMessageId === item.messageId && identityMatches(reply.from, item.peer); }));
      });
      return React.createElement("section", { className: "mochi-lan-card mochi-lan-card--wide" },
        React.createElement("h2", { className: "mochi-lan-card__title" }, props.inboxOnly ? "老师的回信" : "我的请求进度"),
        React.createElement("p", { className: "mochi-lan-card__intro" }, props.inboxOnly ? "回信读完可收好；原请求与回复详情仍会保留。" : "送达、已读和老师回复分别显示；新请求请直接发消息给 Mochi。"),
        requests.length ? messageGroups(requests, function (message) {
          return !rows(props.snapshot.inbox).some(function (reply) { return reply.response?.replyToMessageId === message.messageId && identityMatches(reply.from, message.peer) && reply.seenAt && reply.seenReceipt === "ACKNOWLEDGED"; });
        }, function (message) { return React.createElement(ClassroomRequestRow, { key: message.messageId, message: message, snapshot: props.snapshot, busy: props.busy, onConfirm: props.onConfirm }); }, linkedRequest(props.snapshot, rows(props.snapshot.inbox).find(function (item) { return item.messageId === props.focusedMessageId; })?.response)?.messageId) : React.createElement("p", { className: "mochi-lan-empty" }, "暂无已提交的学生请求。")
      );
    }

    function TeacherRequestsCard(props) {
      var requests = props.snapshot.lockedRole === "teacher"
        ? rows(props.snapshot.inbox).filter(function (item) { return item.contentType === "REQUEST" && item.request; }) : [];
      var focusedId = baseFocusedMessageId(props.focusedMessageId);
      var canFocus = props.snapshot.lockedRole === "teacher" && (
        requests.some(function (item) { return item.messageId === focusedId; })
        || rows(props.snapshot.outbox).some(function (item) { return item.messageId === focusedId; })
      );
      React.useEffect(function () {
        if (!canFocus || typeof document === "undefined") return;
        var targets = document.querySelectorAll("[data-mochi-lan-focus-message]");
        for (var index = 0; index < targets.length; index += 1) {
          if (targets[index].getAttribute("data-mochi-lan-focus-message") === focusedId) {
            targets[index].scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth" });
            break;
          }
        }
      }, [focusedId, canFocus]);
      if (props.snapshot.lockedRole !== "teacher") return null;
      return React.createElement("section", { className: "mochi-lan-card mochi-lan-card--wide" },
        React.createElement("h2", { className: "mochi-lan-card__title" }, "学生请求"),
        React.createElement("p", { className: "mochi-lan-card__intro" }, "回复或调整预约时间，请在 Mochi 对话中说明。"),
        requests.length ? messageGroups(requests, function (message) {
          return inboxBinding(props.snapshot, message) === "ACTIVE" && !rows(props.snapshot.outbox).some(function (reply) {
            return reply.response?.replyToMessageId === message.messageId && reply.delivery === "ACKNOWLEDGED" && identityMatches(reply.peer, message.from);
          });
        }, function (message) {
          return React.createElement(TeacherRequestRow, { key: message.messageId, message: message, snapshot: props.snapshot, busy: props.busy, onConfirm: props.onConfirm });
        }, focusedId, "已回复与历史请求") : React.createElement("p", { className: "mochi-lan-empty" }, "暂无学生请求")
      );
    }

    function IncomingMessageCard(props) {
      var message = focusedInboxMessage(props.snapshot, props.messageId)
        || focusedInboxMessage(props.snapshot, focusedUnreadMessageId(null, props.snapshot));
      if (!message) return null;
      var classroomClassId = text(message.recipient?.classId, 120);
      var reply = message.response;
      var linked = linkedRequest(props.snapshot, reply);
      var kindLabel = linked ? requestKindLabel(linked.request) : "学生请求";
      var textReply = reply?.decision === "replied";
      return React.createElement("section", { className: "mochi-lan-notice", role: "alert", "aria-live": "assertive", "aria-label": reply ? "教师回复" : "新教室通知", "data-mochi-lan-focus-message": message.messageId },
        React.createElement("div", { className: "mochi-lan-row__top" }, React.createElement("h2", { className: "mochi-lan-notice__title" }, reply ? "教师回复 · " + kindLabel : "新通知"), React.createElement(Status, { kind: "warn" }, "待人工已看到")),
        React.createElement("div", { className: "mochi-lan-meta" }, "发件教师：" + (message.from.displayName || "名称暂不可用")),
        React.createElement(DetailLine, { identity: message.from }),
        React.createElement("div", { className: "mochi-lan-meta" }, "目标班级：" + (classroomClassId || "当前班级未设置")),
        textReply ? null : React.createElement("div", { className: "mochi-lan-notice__body" }, message.body),
        reply ? React.createElement("div", { className: "mochi-lan-notice__body" }, textReply ? "教师文字回复：" + message.body : appointmentDecisionText(reply, linked?.request)) : null,
        React.createElement(DirectiveDetails, { directive: message.directive }),
        React.createElement("div", { className: "mochi-lan-meta" }, "收到：" + localTimeLabel(message.receivedAt)),
        React.createElement("div", { className: "mochi-lan-actions" }, React.createElement("button", { className: "mochi-lan-button", type: "button", disabled: props.busy, onClick: function () { props.onConfirm(confirmationFor("message-seen", { messageId: message.messageId, from: message.from, body: message.body })); } }, "已读，撕下"))
      );
    }

    function confirmationTarget(action) {
      var value = action?.value || {};
      if (action?.type === "message-seen") return [value.from?.displayName || "已配对教师", value.from?.schoolId || "", value.from?.classId || "", "消息：" + (value.body || "")].join("\n");
      var peer = value.peer || {};
      return [peer.displayName || "待确认设备", peer.schoolId || "", peer.classId || "", peer.role ? roleLabel(peer.role) : "", peer.fingerprint || ""].filter(Boolean).join("\n");
    }

    function confirmationCopy(action) {
      var copies = {
        "pair-accept": ["确认接受相识", "接受后，这个已验证教师设备才可按审批流程向本教室投递通知。", "接受相识"],
        "pair-reject": ["确认拒绝相识", "将删除本次待确认申请，不建立发送权限。", "拒绝申请"],
        "message-seen": ["确认已看到", "向这条消息的发送方确认你已阅读；这不代表事项已经处理完成。", "确认已看到"],
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
          React.createElement("button", { className: "mochi-lan-button", type: "button", disabled: props.busy, onClick: props.onProceed }, props.busy ? "正在提交…" : copy[2]),
          React.createElement("button", { className: "mochi-lan-button mochi-lan-button--soft", type: "button", disabled: props.busy, onClick: props.onCancel }, "返回核对")
        )
      );
    }

    function focusedMailboxFolder(snapshot, messageId) {
      var id = baseFocusedMessageId(messageId);
      if (!id) return "inbox";
      return rows(snapshot.inbox).some(function (message) { return message.messageId === id; }) ? "inbox"
        : rows(snapshot.outbox).some(function (message) { return message.messageId === id; }) ? "sent" : "inbox";
    }

    function MailboxContents(props) {
      var snapshot = props.snapshot;
      var shared = { snapshot: snapshot, busy: props.busy, focusedMessageId: props.focusedMessageId, onConfirm: props.onConfirm };
      if (props.folder === "sent") {
        return snapshot.lockedRole === "teacher" ? React.createElement(InboxCard, shared)
          : React.createElement(ClassroomRequestsCard, shared);
      }
      if (snapshot.lockedRole === "teacher") return React.createElement(TeacherRequestsCard, shared);
      return React.createElement(React.Fragment, null,
        React.createElement(InboxCard, shared),
        rows(snapshot.inbox).some(function (message) { return Boolean(linkedRequest(snapshot, message.response)); })
          ? React.createElement(ClassroomRequestsCard, Object.assign({}, shared, { inboxOnly: true })) : null);
    }

    function LanPanel(props) {
      var snapshotState = React.useState(emptySnapshot());
      var snapshot = snapshotState[0];
      var setSnapshot = snapshotState[1];
      var discoveryState = React.useState(Object.freeze([]));
      var discovered = discoveryState[0];
      var setDiscovered = discoveryState[1];
      var receiptBusy = React.useRef(false);
      var confirmationBusy = React.useRef(false);
      var attentionRef = React.useRef(null);
      var cursorRef = React.useRef(0);
      var refreshFailureRef = React.useRef(false);
      var paneState = React.useState("messages");
      var pane = paneState[0];
      var setPane = paneState[1];
      var paneTitleRef=React.useRef(null), paneFocusPending=React.useRef(false);
      function selectPane(next){ if(next === pane)return;paneFocusPending.current=true;setPane(next); }
      React.useEffect(function(){
        if (!paneFocusPending.current) return;
        paneFocusPending.current=false;
        paneTitleRef.current?.focus({preventScroll:true});
      },[pane]);
      React.useEffect(function () { if (props.profileRequested) setPane("connection"); else if (props.focusedMessageId) setPane("messages"); }, [props.focusedMessageId,props.profileRequested]);
      var phaseState = React.useState("loading");
      var phase = phaseState[0];
      var setPhase = phaseState[1];
      var failureState = React.useState("");
      var failure = failureState[0];
      var setFailure = failureState[1];
      var confirmationState = React.useState(null);
      var confirmation = confirmationState[0];
      var setConfirmation = confirmationState[1];
      var busyState = React.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var refreshState = React.useState(0);
      var refreshNonce = refreshState[0];
      var requestRefresh = function () { refreshState[1](function (value) { return value + 1; }); };
      var folderState = React.useState("inbox");
      var folder = folderState[0];
      var setFolder = folderState[1];
      React.useEffect(function () { if (props.focusedMessageId) setFolder(focusedMailboxFolder(snapshot, props.focusedMessageId)); }, [props.focusedMessageId, snapshot.lockedRole]);
      var api = React.useMemo ? React.useMemo(function () { return createLanApi(); }, []) : createLanApi();

      React.useEffect(function () {
        var alive = true;
        var controller = new AbortController();
        var refreshing = false;
        async function refresh() {
          if (refreshing) return;
          refreshing = true;
          try {
            var statePayload = await api.state(controller.signal);
            var discoveryPayload = await api.discovery(controller.signal);
            try {
              var eventPayload = await api.events(cursorRef.current, controller.signal);
              cursorRef.current = Number.isSafeInteger(Number(eventPayload?.cursor)) ? Number(eventPayload.cursor) : cursorRef.current;
            } catch (_) {
              // State and discovery remain authoritative if the event cursor is unavailable.
            }
            if (!alive) return;
            var nextSnapshot = normalizeSnapshot(statePayload);
            var nextDiscovery = normalizeDiscovery(discoveryPayload);
            var nextAttention = attentionState(nextSnapshot);
            var attentionKinds = newAttentionKinds(attentionRef.current, nextAttention);
            var focusedMessageId = attentionKinds.includes("incoming-message") ? focusedUnreadMessageId(attentionRef.current, nextSnapshot) : "";
            attentionRef.current = nextAttention;
            setSnapshot(nextSnapshot);
            setDiscovered(nextDiscovery);
            if (refreshFailureRef.current) { refreshFailureRef.current = false; setFailure(""); }
            setPhase("ready");
            requestRailSync(statePayload);
            reportRailSyncHealth(true);
            updateUi({ configured: nextSnapshot.configured, role: nextSnapshot.lockedRole, nearby: nextDiscovery.length, inbox: unreadInboxMessages(nextSnapshot).length, discoveryStatus: nextSnapshot.discovery.status, discoveryErrorCode: nextSnapshot.discovery.errorCode, connectionFailed: false });
            if (attentionKinds.length) {
              var desktopMessages = typeof window.mochiRailDesktop?.pushLanState === "function";
              var needsPanel = attentionKinds.includes("pairing-request") || !desktopMessages;
              if (needsPanel) {
                if (focusedMessageId) openLanPanelForMessage(focusedMessageId);
                else openLanPanel();
              }
              attentionKinds.filter(function (kind) { return kind !== "incoming-message" || !desktopMessages; }).forEach(requestDesktopAttention);
            }
          } catch (error) {
            if (!alive || error?.name === "AbortError") return;
            refreshFailureRef.current = true;
            setPhase("failed");
            setFailure(errorLabel(error));
            setDiscovered(Object.freeze([]));
            updateUi({ nearby: 0, connectionFailed: true });
            reportRailSyncHealth(false);
          } finally {
            refreshing = false;
          }
        }
        void refresh();
        var timer = setInterval(function () { void refresh(); }, POLL_MS);
        return function () { alive = false; controller.abort(); clearInterval(timer); };
      }, [api, refreshNonce]);

      async function proceed() {
        if (!confirmation || busy || confirmationBusy.current || receiptBusy.current) return;
        confirmationBusy.current = true;
        setBusy(true);
        setFailure("");
        try {
          await executeConfirmation(api, confirmation);
          setConfirmation(null);
        } catch (error) {
          setFailure(errorLabel(error));
        } finally {
          confirmationBusy.current = false;
          setBusy(false);
          requestRefresh();
        }
      }

      async function readLetter(action) {
        if (action?.type !== "message-seen") { setConfirmation(action); return; }
        if (receiptBusy.current || confirmationBusy.current || busy) return;
        receiptBusy.current = true; setBusy(true); setFailure("");
        try {
          var result = await executeConfirmation(api, action);
          if (result?.status !== "ACKNOWLEDGED" || result.messageId !== action.value.messageId) {
            throw Object.assign(new Error("RECEIPT_UNCONFIRMED"), { code: "RECEIPT_UNCONFIRMED" });
          }
          await tearReadPaper(action.value.messageId);
          if (uiSnapshot().open) document.querySelector(".mochi-lan-close")?.focus();
        } catch (error) {
          setFailure(errorLabel(error));
        } finally {
          receiptBusy.current = false; setBusy(false); requestRefresh();
        }
      }

      function panelKeyDown(event) {
        if (event.key !== "Tab") return;
        var focusable = Array.from(event.currentTarget.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])"))
          .filter(visibleFocusCandidate);
        wrapTab(event, focusable);
      }

      return React.createElement("section", { className: "mochi-lan-panel", role: "dialog", "aria-modal": true, "aria-label": pane === "connection" ? "设备与连接" : pane === "help" ? "使用说明" : "Mochi 小信箱", onKeyDown: panelKeyDown },
        React.createElement("header", { className: "mochi-lan-head" },
          React.createElement("div", null,
            React.createElement("p", { className: "mochi-lan-head__eyebrow" }, "Mochi / 校园"),
            React.createElement("h1", { className: "mochi-lan-head__title", ref:paneTitleRef, tabIndex:-1 }, pane === "connection" ? "设备与连接" : pane === "help" ? "使用说明" : "Mochi 小信箱"),
            React.createElement("p", { className: "mochi-lan-head__desc" }, phase === "loading" ? "正在读取连接状态…" : pane === "connection" ? "本机身份、已配对设备与连接状态。" : pane === "help" ? "通过 Mochi 对话处理校园事务。" : "一封一封慢慢看，读完就撕下收好。")
          ),
          React.createElement("button", { className: "mochi-lan-close", type: "button", "aria-label": "关闭小信箱", onClick: props.onClose }, React.createElement("svg", {width:16,height:16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.7,"aria-hidden":true}, React.createElement("path",{d:"m6 6 12 12M18 6 6 18"})))
        ),
        React.createElement("main", { className: "mochi-lan-body" },
          failure ? React.createElement("div", { className: "mochi-lan-error", role: "alert" }, failure) : null,
          phase === "failed" ? React.createElement("div", { className: "mochi-lan-actions" }, React.createElement("button", { className: "mochi-lan-button", type: "button", onClick: requestRefresh }, "重新连接")) : null,
          React.createElement(ConfirmationCard, { action: confirmation, busy: busy, onProceed: proceed, onCancel: function () { if (!busy) setConfirmation(null); } }),
          React.createElement("section", { className: "mochi-lan-pane mochi-lan-mailbox", hidden: pane !== "messages" },
            React.createElement("div", { className: "mochi-mail-slot", "aria-hidden": true }, React.createElement("span", null, "MOCHI POST")),
            phase !== "loading" && !snapshot.identity ? React.createElement("section", { className: "mochi-lan-setup-hint", "aria-label": "本机信息尚未完成" },
              React.createElement("div", null, React.createElement("strong", null, "先让 Mochi 认出这台电脑"),
                React.createElement("p", { className: "mochi-lan-meta" }, snapshot.lockedRole === "classroom" ? "填好学校、班级与设备名称后，才能和老师收发信件。" : "填好学校与设备名称后，才能和教室收发信件。")),
              React.createElement("button", { type: "button", className: "mochi-lan-button", onClick: function () { selectPane("connection"); } }, "设置本机信息")) : null,
            React.createElement("nav", { className: "mochi-lan-folders", "aria-label": "信件分类" },
              [ ["inbox", "收件"], ["sent", "已发"] ].map(function (item) {
                return React.createElement("button", { key: item[0], type: "button", "aria-pressed": folder === item[0], onClick: function () { setFolder(item[0]); }, disabled: busy }, item[1]);
              })),
            React.createElement("p", { className: "mochi-mail-hint" }, folder === "sent" ? "送达不等于已读。对方点“已读，撕下”后，这里才会出现人工回执。" : "“已读，撕下”会告诉对方你已看到，并收好这封信；不代表事项已处理。"),
            React.createElement(MailboxContents, { snapshot: snapshot, folder: folder, busy: busy, focusedMessageId: props.focusedMessageId, onConfirm: readLetter })
          ),
          React.createElement("section", { className: "mochi-lan-pane", hidden: pane !== "connection" },
            React.createElement(UserProfileCard,{snapshot:snapshot,onRefresh:requestRefresh,profileRequested:props.profileRequested}),
            React.createElement("details", { className:"mochi-lan-technical" },
              React.createElement("summary", null, "连接状态与下一步"), React.createElement(ConnectionGuide, { snapshot: snapshot, candidates: discovered, fresh: phase === "ready" })),
            phase === "failed" ? React.createElement("p", { className: "mochi-lan-meta", role: "status" }, "下方身份与配对是最近保存的记录，当前连接尚未刷新成功；请先点“重新连接”。") : null,
            React.createElement("div", { className: "mochi-lan-grid" },
              snapshot.identity ? React.createElement("details", { className: "mochi-lan-technical" },
                React.createElement("summary", null, "本机身份详情"), React.createElement(IdentityCard, { snapshot: snapshot })) : null,
              React.createElement("details", { className:"mochi-lan-technical", open: Boolean(snapshot.pendingPairings.length) || undefined },
                React.createElement("summary", null, snapshot.pendingPairings.length ? "有 " + snapshot.pendingPairings.length + " 个配对申请待确认" : "配对设备 · " + snapshot.peers.filter(function (peer) { return !peer.blocked; }).length + " 台已保存"),
                React.createElement(PairingCard, { snapshot: snapshot, candidates: discovered, busy: busy, onConfirm: readLetter, fresh: phase === "ready" }))
            ),
            React.createElement("details", { className: "mochi-lan-technical" },
              React.createElement("summary", null, "附近设备与发现详情"), React.createElement(DiscoveryCard, { snapshot: snapshot, candidates: discovered, fresh: phase === "ready" }))
          ),
          React.createElement("section", { className: "mochi-lan-pane", hidden: pane !== "help" }, React.createElement(ChatGuideCard, { snapshot: snapshot }))
        ),
        React.createElement("footer", { className: "mochi-lan-panel-footer" },
          pane !== "messages" ? React.createElement("button", { type: "button", disabled: busy, onClick: function () { selectPane("messages"); } }, "返回消息") : React.createElement(React.Fragment, null,
            React.createElement("button", { type: "button", disabled: busy, onClick: function () { selectPane("connection"); } }, "设备与连接"),
            React.createElement("button", { type: "button", disabled: busy, onClick: function () { selectPane("help"); } }, "使用说明")
          ),
          React.createElement("button", { className: "mochi-lan-refresh", type: "button", disabled: busy, onClick: requestRefresh }, "刷新")
        )
      );
    }

    function LanOverlay() {
      var state = React.useSyncExternalStore(subscribeUi, uiSnapshot);
      React.useEffect(function () {
        if (!state.open || typeof document === "undefined") return;
        var returnFocus = document.activeElement;
        document.querySelector(".mochi-lan-panel .mochi-lan-close")?.focus();
        return function () {
          if (!uiSnapshot().open && returnFocus?.isConnected !== false) returnFocus?.focus?.();
        };
      }, [state.open]);
      return React.createElement("div", {
        className: "mochi-lan-overlay",
        hidden: !state.open,
        "aria-hidden": !state.open,
        onMouseDown: function (event) { if (event.target === event.currentTarget) void dismissUserProfile(); },
      }, React.createElement(LanPanel, { onClose: dismissUserProfile, focusedMessageId: state.focusedMessageId,profileRequested:state.profileRequested }));
    }

    function LanFooterAction(props) {
      var state = React.useSyncExternalStore(subscribeUi, uiSnapshot);
      var label = footerLabel(state);
      return React.createElement("button", {
        type: "button",
        className: "mochi-lan-footer" + (props?.wide === false ? " mochi-lan-footer--rail" : ""),
        "aria-label": "小信箱，" + label,
        title: "小信箱 · " + label,
        onClick: openLanPanel,
      },
      props?.wide === false ? React.createElement("span", { className: "mochi-lan-footer__rail-icon", "aria-hidden": true }, React.createElement("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7 }, React.createElement("rect", { x: 3, y: 5, width: 18, height: 14, rx: 3 }), React.createElement("path", { d: "m4 7 8 6 8-6" }))) : null,
      React.createElement("span", { className: "mochi-lan-footer__dot", "data-ready": state.configured ? "true" : "false", "aria-hidden": true }),
      React.createElement("span", null, "小信箱"),
      React.createElement("span", { className: "mochi-lan-footer__meta" }, label));
    }

    function footerLabel(state) {
      var label = state.connectionFailed ? "连接状态未更新 · 请刷新" : !state.configured ? "待设置身份" : state.discoveryStatus === "DEGRADED" ? "发现异常 · 可让 Mochi 排查" : state.nearby ? "附近 " + state.nearby + " 台" : "正在发现";
      if (state.inbox) label += " · " + state.inbox + " 条待看";
      return label;
    }

    function installEscape() {
      if (typeof document === "undefined") return function () {};
      function onKeyDown(event) { if (event.key === "Escape" && uiSnapshot().open) void dismissUserProfile(); }
      document.addEventListener("keydown", onKeyDown);
      window.addEventListener?.("mochi-open-user-profile",openUserProfile);
      return function () { document.removeEventListener("keydown", onKeyDown);window.removeEventListener?.("mochi-open-user-profile",openUserProfile); };
    }

    function installFocusMessage() {
      var bridge = typeof window === "object" ? window.mochiRailDesktop : null;
      if (typeof bridge?.onFocusMessage !== "function") return function () {};
      var dispose = bridge.onFocusMessage(function (messageId) {
        if (typeof messageId === "string" && messageId.length <= 120) openLanPanelForMessage(messageId);
      });
      return typeof dispose === "function" ? dispose : function () {};
    }

    function apply(ctx) {
      ctx.effect(function () { return installStyles(); }, "mochi-lan-client: styles");
      ctx.effect(function () { return installEscape(); }, "mochi-lan-client: close controls");
      ctx.effect(installFocusMessage, "mochi-lan-client: focus requested message");
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
      errorLabel: errorLabel,
      ROUTES: ROUTES,
      localTimeLabel: localTimeLabel,
      recipientProjection: recipientProjection,
      identityMatches: identityMatches,
      inboxBinding: inboxBinding,
      messageGroups: messageGroups,
      MailboxContents: MailboxContents,
      focusedMailboxFolder: focusedMailboxFolder,
      visibleFocusCandidate: visibleFocusCandidate,
      tearReadPaper: tearReadPaper,
      normalizeSnapshot: normalizeSnapshot,
      normalizeDiscovery: normalizeDiscovery,
      footerLabel: footerLabel,
      canRequestPair: canRequestPair,
      peerPresence: peerPresence,
      requestJson: requestJson,
      createLanApi: createLanApi,
      confirmationFor: confirmationFor,
      confirmationTarget: confirmationTarget,
      executeConfirmation: executeConfirmation,
      emptySnapshot: emptySnapshot,
      attentionState: attentionState,
      newAttentionKinds: newAttentionKinds,
      focusedUnreadMessageId: focusedUnreadMessageId,
      focusedInboxMessage: focusedInboxMessage,
      requestRailSync: requestRailSync,
      connectionStep: connectionStep,
      ConnectionGuide: ConnectionGuide,
      IdentityCard: IdentityCard,
      profileProjection: profileProjection,
      UserProfileCard: UserProfileCard,
      ChatGuideCard: ChatGuideCard,
      DiscoveryCard: DiscoveryCard,
      PairingCard: PairingCard,
      InboxCard: InboxCard,
      TeacherRequestsCard: TeacherRequestsCard,
      TeacherRequestRow: TeacherRequestRow,
      ClassroomRequestsCard: ClassroomRequestsCard,
      ClassroomRequestRow: ClassroomRequestRow,
      IncomingMessageCard: IncomingMessageCard,
      ConfirmationCard: ConfirmationCard,
      LanPanel: LanPanel,
      LanOverlay: LanOverlay,
      openLanPanel: openLanPanel,
      openLanPanelForMessage: openLanPanelForMessage,
      uiSnapshot: uiSnapshot,
      installFocusMessage: installFocusMessage,
    };
    return module.exports;
  },
});
