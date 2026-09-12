import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");

const plain = (value) => JSON.parse(JSON.stringify(value));

const classroomIdentity = Object.freeze({
  endpointId: "room-1",
  role: "classroom",
  schoolId: "嘉兴一中",
  classId: "高一（3）班",
  displayName: "一班教室",
  fingerprint: "sha256:room",
});
const teacherIdentity = Object.freeze({
  endpointId: "teacher-1",
  role: "teacher",
  schoolId: "嘉兴一中",
  displayName: "王老师",
  fingerprint: "sha256:teacher",
});
const activePeer = Object.freeze({ ...teacherIdentity, address: { host: "10.0.0.4", port: 47832 }, online: true });
const activeInbox = (messageId, extras = {}) => ({
  messageId,
  seenAt: "",
  from: teacherIdentity,
  recipient: classroomIdentity,
  ...extras,
});

function loadClient(fetchImpl, options = {}) {
  const factories = new Map();
  const created = [];
  const documentListeners = new Map();
  const effectDisposers = [];
  const head = {
    appendChild(node) { node.parentNode = this; created.push(node); },
    removeChild(node) { node.parentNode = null; },
  };
  const document = {
    head,
    getElementById() { return null; },
    createElement() { return { id: "", textContent: "", parentNode: null }; },
    addEventListener(name, listener) { documentListeners.set(name, listener); },
    removeEventListener(name, listener) { if (documentListeners.get(name) === listener) documentListeners.delete(name); },
  };
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...(props ?? {}), children } }; },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
    useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; },
    useEffect(setup) {
      if (options.runEffects !== true) return;
      effectDisposers.push(setup());
    },
    useMemo(factory) { return factory(); },
  };
  const sandbox = {
    AbortController,
    Array,
    Boolean,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    URL,
    console,
    document,
    fetch: fetchImpl ?? (async () => { throw new Error("unexpected real request"); }),
    setInterval: options.runEffects === true ? () => 1 : setInterval,
    clearInterval: options.runEffects === true ? () => {} : clearInterval,
    window: {
      ...(options.desktopBridge ? { mochiLanDesktop: options.desktopBridge } : {}),
      __ModuleLoader__: {
        load(entry) { factories.set(entry.id, entry.factory); },
      },
    },
  };
  vm.runInNewContext(source, sandbox, { filename: "mochi-lan/client.js" });
  const factory = factories.get("mochi-lan-client");
  assert.ok(factory, "browser package registers through ModuleLoader");
  const plugin = factory((name) => {
    if (name === "react") return react;
    throw new Error(`unexpected dependency: ${name}`);
  });
  return {
    plugin,
    created,
    documentListeners,
    disposeEffects() { effectDisposers.reverse().forEach((dispose) => dispose?.()); },
  };
}

test("locked role identity input only permits host-owned role and omits it from wire data", async () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  assert.equal(api.identityInput({ schoolId: "嘉兴一中", displayName: "七一班教室" }, "").ok, false, "an unlocked device cannot self-select a role");
  assert.equal(api.identityInput({ schoolId: "嘉兴一中", displayName: "七一班教室" }, "classroom").ok, false, "classroom requires classId");
  const teacher = api.identityInput({ schoolId: "嘉兴一中", classId: "高一（3）班", displayName: "王老师的 Mac", role: "classroom" }, "teacher");
  assert.equal(teacher.ok, true);
  assert.deepEqual(plain(teacher.identity), { schoolId: "嘉兴一中", classId: "高一（3）班", displayName: "王老师的 Mac" });
  assert.equal(Object.hasOwn(teacher.identity, "role"), false);

  const calls = [];
  const lan = api.createLanApi(async (path, options) => {
    calls.push({ path, options });
    return {};
  });
  await lan.configureIdentity({ endpointId: "teacher-1", role: "classroom", schoolId: "嘉兴一中", classId: "高一（3）班", displayName: "王老师的 Mac", userConfirmed: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, api.ROUTES.identity);
  assert.deepEqual(plain(calls[0].options.body), {
    identity: { endpointId: "teacher-1", schoolId: "嘉兴一中", classId: "高一（3）班", displayName: "王老师的 Mac" },
  });
  assert.equal(JSON.stringify(calls[0].options.body).includes("role"), false);
  assert.equal(JSON.stringify(calls[0].options.body).includes("userConfirmed"), false);
});

test("empty and exceptional setup states stay unavailable instead of inferring a peer", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const empty = api.emptySnapshot();
  assert.equal(empty.configured, false);
  assert.equal(empty.lockedRole, "");
  assert.equal(empty.identity, null);
  assert.equal(empty.peers.length, 0);
  assert.equal(api.manualAddressInput({ host: "", port: "47832" }).ok, false);
  assert.equal(api.manualAddressInput({ host: "10.1.1.42", port: "0" }).ok, false);
  assert.deepEqual(plain(api.manualAddressInput({ host: "10.1.1.42", port: "47832" }).address), { host: "10.1.1.42", port: 47832 });

  const normalized = api.normalizeSnapshot({
    configured: true,
    lockedRole: "classroom",
    discovery: { enabled: true, status: "DEGRADED", errorCode: "EADDRINUSE" },
    identity: { endpointId: "room-1", role: "classroom", schoolId: "嘉兴一中", classId: "高一（3）班", displayName: "一班教室", fingerprint: "sha256:room", privateKey: "must-not-project" },
    peers: [{ endpointId: "teacher-1", role: "teacher", schoolId: "嘉兴一中", displayName: "王老师", fingerprint: "sha256:teacher", address: { host: "10.0.0.4", port: 47832 }, online: false, privateKey: "must-not-project" }],
    blockedPeers: [{ endpointId: "blocked-1", updatedAt: "2026-09-09T00:00:00.000Z", secret: "must-not-project" }],
  });
  assert.equal(normalized.lockedRole, "classroom");
  assert.deepEqual(plain(normalized.discovery), { enabled: true, status: "DEGRADED", errorCode: "EADDRINUSE" });
  assert.equal(api.footerLabel({ configured: true, nearby: 0, inbox: 0, discoveryStatus: normalized.discovery.status }), "自动发现暂不可用，可手动连接");
  assert.equal(Object.hasOwn(normalized.identity, "privateKey"), false);
  assert.equal(Object.hasOwn(normalized.peers[0], "privateKey"), false);
  assert.equal(normalized.peers[0].online, false);
  assert.deepEqual(plain(normalized.blockedPeers), [{ endpointId: "blocked-1", updatedAt: "2026-09-09T00:00:00.000Z" }]);
});

test("same-origin route client carries only browser session credentials and surfaces fixed error codes", async () => {
  const requests = [];
  const { plugin } = loadClient(async (path, options) => {
    requests.push({ path, options });
    if (path.endsWith("/forbidden")) return { ok: false, status: 403, json: async () => ({ code: "ROLE_FORBIDDEN" }) };
    return { ok: true, status: 200, json: async () => ({ configured: false }) };
  });
  const value = await plugin.__test.requestJson(plugin.__test.ROUTES.state);
  assert.equal(value.configured, false);
  assert.equal(requests[0].path, "/api/mochi-lan/state");
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[0].options.cache, "no-store");
  await assert.rejects(
    () => plugin.__test.requestJson("/api/mochi-lan/forbidden"),
    (error) => error?.code === "ROLE_FORBIDDEN" && error?.status === 403,
  );
});

test("discovery is distinct from pairing and only an exact verified teacher-to-classroom target can request pairing", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const teacher = { endpointId: "teacher-1", role: "teacher", schoolId: "嘉兴一中", displayName: "王老师", fingerprint: "sha256:teacher" };
  const classroom = {
    endpointId: "room-1", role: "classroom", schoolId: "嘉兴一中", classId: "高一（3）班", displayName: "一班教室", fingerprint: "sha256:room", address: { host: "10.0.0.7", port: 47832 }, paired: false, blocked: false,
  };
  assert.equal(api.canRequestPair(teacher, classroom), true);
  const projected = api.normalizeDiscovery({ candidates: [{ ...classroom, seenAt: "2026-09-09T00:00:00.000Z", expiresAt: 1_789_000_000_000 }] })[0];
  assert.equal(projected.expiresAt, 1_789_000_000_000, "beacon expiry stays numeric on the UI boundary");
  assert.equal(api.canRequestPair(teacher, projected), true, "the UI's nested candidate projection preserves a verified target");
  assert.equal(api.canRequestPair({ ...teacher, role: "classroom" }, classroom), false);
  assert.equal(api.canRequestPair(teacher, { ...classroom, schoolId: "另一学校" }), false);
  assert.equal(api.canRequestPair(teacher, { ...classroom, role: "teacher" }), false);
  assert.equal(api.peerPresence({ identity: classroom, online: true }, [classroom], []), "nearby");
  assert.equal(api.peerPresence({ identity: classroom, online: false }, [], []), "not-discovered");
  assert.equal(api.peerPresence({ identity: classroom, online: false }, [{ ...classroom, fingerprint: "sha256:imposter" }], []), "not-discovered", "a matching endpointId without the paired fingerprint is not nearby");
  assert.equal(api.peerPresence({ identity: classroom, online: true }, [classroom], [{ endpointId: "room-1" }]), "blocked");
});

test("all state-changing LAN actions use fixed host routes; the UI exposes no send bypass", async () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const calls = [];
  const lan = api.createLanApi(async (path, options) => {
    calls.push({ path, options });
    return { ok: true };
  });
  await api.executeConfirmation(lan, api.confirmationFor("pair-request", {
    candidate: { endpointId: "room-1", role: "classroom", schoolId: "嘉兴一中", classId: "高一（3）班", displayName: "一班教室", fingerprint: "sha256:room", publicKey: { kty: "OKP" } },
    address: { host: "10.0.0.7", port: 47832 },
  }));
  await api.executeConfirmation(lan, api.confirmationFor("peer-unpair", { endpointId: "room-1" }));
  await api.executeConfirmation(lan, api.confirmationFor("peer-block", { endpointId: "room-1" }));
  await api.executeConfirmation(lan, api.confirmationFor("message-seen", { messageId: "notice-1" }));
  assert.deepEqual(calls.map((call) => call.path), [api.ROUTES.pairRequest, api.ROUTES.peerUnpair, api.ROUTES.peerBlock, api.ROUTES.messageSeen]);
  assert.equal(Object.values(api.ROUTES).some((route) => /send/u.test(route)), false);
  assert.doesNotMatch(source, /\/api\/mochi-lan\/send/u);
});

test("classroom LAN attention opens once for startup inbox and new pairing state without granting an action", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const classroom = api.normalizeSnapshot({
    lockedRole: "classroom",
    identity: classroomIdentity,
    peers: [activePeer],
    inbox: [activeInbox("notice-1")],
    pendingPairings: [{ requestId: "pair-1" }],
  });
  const initial = api.attentionState(classroom);
  assert.deepEqual(plain(api.newAttentionKinds(null, initial)), ["incoming-message", "pairing-request"], "unread startup state must draw attention once");
  assert.deepEqual(plain(api.newAttentionKinds(initial, initial)), [], "polling the same state must not repeatedly steal focus");

  const next = api.attentionState(api.normalizeSnapshot({
    lockedRole: "classroom",
    identity: classroomIdentity,
    peers: [activePeer],
    inbox: [activeInbox("notice-1"), activeInbox("notice-2")],
    pendingPairings: [{ requestId: "pair-1" }],
  }));
  assert.deepEqual(plain(api.newAttentionKinds(initial, next)), ["incoming-message"]);
  const afterSeen = api.attentionState(api.normalizeSnapshot({
    lockedRole: "classroom",
    identity: classroomIdentity,
    peers: [activePeer],
    inbox: [activeInbox("notice-2")],
    pendingPairings: [{ requestId: "pair-1" }],
  }));
  assert.deepEqual(plain(api.newAttentionKinds(next, afterSeen)), [], "marking another message seen must not replay attention for an older unread message");
  assert.equal(api.focusedUnreadMessageId(initial, api.normalizeSnapshot({
    lockedRole: "classroom",
    identity: classroomIdentity,
    peers: [activePeer],
    inbox: [activeInbox("notice-1"), activeInbox("notice-2")],
  })), "notice-2", "a newly added unread message becomes the first overlay notification target");
  const teacher = api.attentionState(api.normalizeSnapshot({
    lockedRole: "teacher",
    inbox: [{ messageId: "notice-1", seenAt: "" }],
    pendingPairings: [{ requestId: "pair-1" }],
  }));
  assert.deepEqual(plain(api.newAttentionKinds(null, teacher)), [], "teacher notifications remain in the approved dispatch/outbox flow");
  assert.doesNotMatch(source, /mochiLanDesktop\.attention\([^)]*messageId/u, "desktop attention bridge must never receive a message identifier");
  assert.doesNotMatch(source, /mochiLanDesktop\.attention\([^)]*body/u, "desktop attention bridge must never receive message content");
});

test("a classroom unread notification is rendered before settings and still requires a manual seen action", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const snapshot = api.normalizeSnapshot({
    lockedRole: "classroom",
    identity: classroomIdentity,
    peers: [activePeer],
    inbox: [
      { messageId: "notice-seen", seenAt: "2026-09-09T01:00:00.000Z", from: { displayName: "已读教师" }, body: "不应再次提示" },
      activeInbox("notice-new", { receivedAt: "2026-09-09T01:02:00.000Z", body: "请人工确认本条测试通知。" }),
    ],
  });
  assert.equal(api.focusedInboxMessage(snapshot, "notice-seen"), null, "a previously seen row never becomes a new-notice card");
  assert.equal(api.focusedUnreadMessageId(null, snapshot), "notice-new");
  let confirmation = null;
  const card = api.IncomingMessageCard({ snapshot, messageId: "notice-new", busy: false, onConfirm(value) { confirmation = value; } });
  assert.equal(card.props.className, "mochi-lan-notice");
  assert.equal(card.props["data-mochi-lan-focus-message"], "notice-new");
  const manualCard = api.IncomingMessageCard({ snapshot, messageId: "", busy: false, onConfirm() {} });
  assert.equal(manualCard.props["data-mochi-lan-focus-message"], "notice-new", "a manual reopen keeps an outstanding unread message ahead of settings instead of making the operator hunt for it");
  const rendered = JSON.stringify(plain(card));
  assert.match(rendered, /新通知/u);
  assert.match(rendered, /发件教师：王老师/u);
  assert.match(rendered, /目标班级：高一（3）班/u);
  assert.match(rendered, /请人工确认本条测试通知。/u);
  assert.match(rendered, /我已看到/u);
  assert.match(rendered, /收到：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/u, "wire timestamp is presented in a local readable form");
  assert.doesNotMatch(rendered, /2026-09-09T01:02:00\.000Z/u, "the front card does not display the raw UTC wire timestamp");
  assert.equal(api.localTimeLabel("invalid"), "收到时间暂不可用");
  const findButton = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.type === "button" && node.props?.children?.includes("我已看到")) return node;
    for (const child of node.props?.children ?? []) {
      const found = findButton(child);
      if (found) return found;
    }
    return null;
  };
  const button = findButton(card);
  assert.ok(button, "the front notification exposes its own manual seen button");
  button.props.onClick();
  assert.deepEqual(plain(confirmation), {
    type: "message-seen",
    value: {
      messageId: "notice-new",
      from: { endpointId: "teacher-1", role: "teacher", schoolId: "嘉兴一中", classId: "", displayName: "王老师", fingerprint: "sha256:teacher" },
      body: "请人工确认本条测试通知。",
    },
  });
  api.openLanPanelForMessage("notice-new");
  assert.equal(api.uiSnapshot().focusedMessageId, "notice-new");
  api.openLanPanel();
  assert.equal(api.uiSnapshot().focusedMessageId, "", "the normal footer still opens the full settings view without forcing an old notice");
  assert.ok(source.indexOf("React.createElement(IncomingMessageCard") < source.indexOf('React.createElement("div", { className: "mochi-lan-grid" }'), "the unread card must be rendered before identity and pairing settings");
});

test("historical inbox rows never inherit the current classroom identity or offer a seen receipt", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const oldClassroom = { ...classroomIdentity, classId: "高一（2）班", displayName: "二班教室", fingerprint: "sha256:old-room" };
  const rekeyedTeacher = { ...teacherIdentity, fingerprint: "sha256:rekeyed-teacher" };
  const snapshot = api.normalizeSnapshot({
    lockedRole: "classroom",
    identity: classroomIdentity,
    peers: [activePeer],
    inbox: [
      { messageId: "legacy-no-recipient", seenAt: "", from: teacherIdentity, body: "旧状态只有正文。" },
      { messageId: "other-class", seenAt: "", from: teacherIdentity, recipient: oldClassroom, body: "原目标是另一班。" },
      { messageId: "rekeyed-teacher", seenAt: "", from: rekeyedTeacher, recipient: classroomIdentity, body: "同 endpointId 但已换钥匙。" },
    ],
  });
  assert.equal(api.inboxBinding(snapshot, snapshot.inbox[0]), "MISSING_RECIPIENT");
  assert.equal(api.inboxBinding(snapshot, snapshot.inbox[1]), "RECIPIENT_MISMATCH");
  assert.equal(api.inboxBinding(snapshot, snapshot.inbox[2]), "SENDER_UNPAIRED");
  assert.equal(api.attentionState(snapshot).inbox, "", "historical rows do not trigger a classroom popup");
  assert.equal(api.focusedUnreadMessageId(null, snapshot), "");
  assert.equal(api.IncomingMessageCard({ snapshot, messageId: "other-class", busy: false, onConfirm() {} }), null);
  const rendered = JSON.stringify(plain(api.InboxCard({ snapshot, busy: false, onConfirm() {} })));
  assert.match(rendered, /历史收件未记录接收身份/u);
  assert.match(rendered, /原目标与当前教室身份不一致/u);
  assert.match(rendered, /原教师配对身份已变化/u);
  assert.match(rendered, /目标班级：高一（2）班/u, "history keeps the original target class instead of guessing the current one");
  assert.doesNotMatch(rendered, /我已看到/u, "history offers no local seen action or receipt");
});

test("a mounted classroom overlay checks existing inbox before its first footer click", async () => {
  const notifications = [];
  const { plugin, disposeEffects } = loadClient(async (path) => {
    if (path === "/api/mochi-lan/state") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          configured: true,
          lockedRole: "classroom",
          discovery: { enabled: true, status: "DEGRADED", errorCode: "EADDRINUSE" },
          identity: classroomIdentity,
          peers: [activePeer],
          inbox: [activeInbox("notice-before-open")],
          pendingPairings: [{ requestId: "pair-before-open", peer: { displayName: "王老师" } }],
        }),
      };
    }
    if (path === "/api/mochi-lan/discovery") return { ok: true, status: 200, json: async () => ({ candidates: [] }) };
    if (path.startsWith("/api/mochi-lan/events?cursor=")) return { ok: true, status: 200, json: async () => ({ cursor: 2, events: [] }) };
    throw new Error(`unexpected route: ${path}`);
  }, {
    runEffects: true,
    desktopBridge: { attention(kind) { notifications.push(kind); return Promise.resolve(true); } },
  });
  const api = plugin.__test;
  try {
    const registrations = [];
    plugin.apply({
      effect(setup) { return setup(); },
      slots: {
        inject(name, generator) { for (const entry of generator()) registrations.push({ name, entry }); },
        register(options, component) { return { options, component }; },
      },
    });
    const overlay = registrations.find((item) => item.name === "shell.overlay").entry.component;
    const overlayView = overlay();
    const panel = overlayView.props.children[0];
    panel.type({ onClose() {} });
    for (let tick = 0; tick < 8 && notifications.length === 0; tick += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.deepEqual(notifications, ["incoming-message", "pairing-request"], "existing classroom state must request only fixed desktop attention kinds");
    assert.equal(plugin.__test.uiSnapshot().open, true, "existing unread state must open the LAN confirmation surface");
    assert.equal(plugin.__test.uiSnapshot().focusedMessageId, "notice-before-open", "the opened classroom overlay prioritizes the unread message instead of the settings grid");
    assert.equal(plugin.__test.uiSnapshot().discoveryStatus, "DEGRADED", "the authenticated state wire must retain degraded discovery status");
    assert.equal(plugin.__test.uiSnapshot().discoveryErrorCode, "EADDRINUSE", "the authenticated state wire must retain the fixed discovery error code");
    assert.equal(api.footerLabel(plugin.__test.uiSnapshot()), "自动发现暂不可用，可手动连接 · 1 条待看");
  } finally {
    disposeEffects();
  }
});

test("browser contribution stays additive: footer entry plus overlay only", () => {
  const { plugin, documentListeners } = loadClient();
  const registrations = [];
  const disposers = [];
  plugin.apply({
    effect(setup) {
      const dispose = setup();
      disposers.push(dispose);
      return dispose;
    },
    slots: {
      inject(name, generator) {
        for (const entry of generator()) registrations.push({ name, entry });
      },
      register(options, component) { return { options, component }; },
    },
  });
  assert.equal(Array.from(plugin.inject).join(","), "slots");
  assert.equal(registrations.map((item) => item.name).join(","), "shell.overlay,sidebar.footer.action");
  assert.equal(registrations.some((item) => item.name === "root" || item.name === "settings.section"), false);
  assert.equal(registrations.find((item) => item.entry.options.id === "mochi-lan-overlay")?.entry.options.order, 24);
  assert.equal(registrations.find((item) => item.entry.options.id === "mochi-lan-entry")?.entry.options.order, 24);
  assert.equal(documentListeners.has("keydown"), true, "Escape close handler is lifecycle-owned");
  disposers.reverse().forEach((dispose) => dispose?.());
  assert.equal(documentListeners.has("keydown"), false, "teardown removes Escape handler");
});

test("LAN overlay preserves the native hidden contract despite its grid layout", () => {
  assert.match(
    source,
    /\.mochi-lan-overlay\[hidden\]\{display:none\}/,
    "the overlay style must not override React's hidden state with display:grid",
  );
});
