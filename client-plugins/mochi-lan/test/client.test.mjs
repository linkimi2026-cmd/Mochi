import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { randomUUID } from "node:crypto";

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
  const intervals = [];
  const stateWrites = [];
  const head = {
    appendChild(node) { node.parentNode = this; created.push(node); },
    removeChild(node) { node.parentNode = null; },
  };
  const document = {
    head,
    documentElement: { dataset: {} },
    activeElement: options.activeElement ?? null,
    getElementById() { return null; },
    createElement() { return { id: "", textContent: "", parentNode: null }; },
    querySelector(selector) { return options.querySelector?.(selector) ?? null; },
    querySelectorAll(selector) { return options.querySelectorAll?.(selector) ?? []; },
    addEventListener(name, listener) { documentListeners.set(name, listener); },
    removeEventListener(name, listener) { if (documentListeners.get(name) === listener) documentListeners.delete(name); },
  };
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...(props ?? {}), children } }; },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
    useState(initial) {
      const index = stateIndex++;
      const value = options.stateValues && Object.hasOwn(options.stateValues, index)
        ? options.stateValues[index]
        : typeof initial === "function" ? initial() : initial;
      return [value, (next) => { stateWrites.push({ index, next }); }];
    },
    useRef(initial) {
      const index = refIndex++;
      if (!refs[index]) refs[index] = { current: initial };
      return refs[index];
    },
    useEffect(setup) {
      if (options.runEffects !== true) return;
      effectDisposers.push(setup());
    },
    useMemo(factory) { return factory(); },
  };
  let stateIndex = 0;
  let refIndex = 0;
  const refs = [];
  const sandbox = {
    AbortController,
    Array,
    Boolean,
    CustomEvent: class { constructor(type, options) { this.type=type;this.detail=options.detail; } },
    Date: options.Date ?? Date,
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
    crypto: { randomUUID },
    document,
    fetch: fetchImpl ?? (async () => { throw new Error("unexpected real request"); }),
    setInterval: options.runEffects === true ? (callback, ms) => {
      const interval = { callback, ms, active: true };
      intervals.push(interval);
      return interval;
    } : setInterval,
    clearInterval: options.runEffects === true ? (interval) => { interval.active = false; } : clearInterval,
    setTimeout,
    window: {
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      ...(options.matchMedia ? { matchMedia: options.matchMedia } : {}),
      ...(options.desktopBridge ? { mochiLanDesktop: options.desktopBridge } : {}),
      ...(options.railBridge ? { mochiRailDesktop: options.railBridge } : {}),
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
    stateWrites,
    resetRender() { stateIndex = 0; refIndex = 0; },
    tickIntervals(ms) { intervals.filter((item) => item.active && item.ms === ms).forEach((item) => item.callback()); },
    disposeEffects() { effectDisposers.reverse().forEach((dispose) => dispose?.()); },
  };
}

test("everyday LAN tasks stay in Mochi chat and the guide is concise and role-aware", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const readText = (node) => {
    if (Array.isArray(node)) return node.map(readText).join(" ");
    if (!node || typeof node !== "object") return typeof node === "string" ? node : "";
    return readText(node.props?.children);
  };
  const childTypes = (node, found = []) => {
    if (Array.isArray(node)) node.forEach((item) => childTypes(item, found));
    else if (node && typeof node === "object") { found.push(node.type); childTypes(node.props?.children, found); }
    return found;
  };
  const teacherGuide = api.ChatGuideCard({ snapshot: api.normalizeSnapshot({ lockedRole: "teacher", identity: teacherIdentity }) });
  const classroomGuide = api.ChatGuideCard({ snapshot: api.normalizeSnapshot({ lockedRole: "classroom", identity: classroomIdentity }) });
  assert.equal(teacherGuide.props["data-role"], "teacher");
  assert.equal(classroomGuide.props["data-role"], "classroom");
  assert.match(readText(teacherGuide), /教室屏上显示的临时代码/u, "teacher-side pairing uses the classroom's short code");
  assert.match(readText(teacherGuide), /发送通知/u);
  assert.match(readText(teacherGuide), /检查连接/u);
  assert.match(readText(classroomGuide), /待审批申请/u, "the classroom checks incoming requests for approval");
  assert.match(readText(classroomGuide), /设备指纹/u, "identity checks precede approval");
  assert.match(readText(classroomGuide), /本机临时代码/u, "the classroom shares its own visible short code with the teacher");
  assert.match(readText(classroomGuide), /预约讲题/u);
  assert.match(readText(classroomGuide), /网络地址和发现状态仅供查看/u, "classroom network guidance stays status-only");
  assert.doesNotMatch(readText(classroomGuide), /老师设备地址|地址探测|检查连接/u, "classroom chat does not promise a probe it cannot initiate");
  assert.doesNotMatch(readText(classroomGuide), /李明|张三|座号 3/u, "examples stay generic on shared classroom devices");
  for (const guide of [teacherGuide, classroomGuide]) {
    assert.deepEqual(childTypes(guide).filter((type) => ["form", "input", "textarea", "select", "button"].includes(type)), []);
    assert.equal(guide.props["aria-label"], "Mochi 对话使用示例");
  }

  const discovery = api.DiscoveryCard({ snapshot: api.normalizeSnapshot({ lockedRole: "teacher", identity: teacherIdentity }), candidates: [{ identity: classroomIdentity, address: { host: "10.0.0.7", port: 47832 } }] });
  assert.deepEqual(childTypes(discovery).filter((type) => ["form", "input", "textarea", "select", "button"].includes(type)), [], "nearby devices are status only; pairing starts from a natural-language chat message");
  assert.match(readText(discovery), /教室屏上的临时代码/u, "teacher discovery guides pairing with the classroom code");
  const classroomDiscovery = api.DiscoveryCard({ snapshot: api.normalizeSnapshot({ lockedRole: "classroom", identity: classroomIdentity }), candidates: [] });
  assert.match(readText(classroomDiscovery), /配对申请后先核对身份/u);
  assert.match(readText(classroomDiscovery), /网络地址和发现状态仅供查看/u);
});

test("legacy Host without profile API keeps normal LAN tasks in Mochi chat", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const resolve = (node) => {
    if (Array.isArray(node)) return node.map(resolve);
    if (node === null || node === undefined || typeof node === "boolean") return node;
    if (typeof node !== "object") return node;
    if (typeof node.type === "function") return resolve(node.type(node.props));
    return { ...node, props: { ...node.props, children: resolve(node.props?.children) } };
  };
  const controls = (tree) => {
    const found = [];
    const visit = (node, insideClosedDetails = false) => {
      if (Array.isArray(node)) return node.forEach((child) => visit(child, insideClosedDetails));
      if (!node || typeof node !== "object") return;
      const hidden = insideClosedDetails || (node.type === "details" && node.props.open !== true);
      if (["form", "input", "textarea", "select"].includes(node.type) && !hidden) found.push(node.type);
      visit(node.props?.children, hidden);
    };
    visit(tree);
    return found;
  };
  const configured = api.normalizeSnapshot({ configured: true, lockedRole: "teacher", identity: teacherIdentity });
  const configuredClient = loadClient(undefined, { stateValues: { 0: configured } });
  const panel = resolve(configuredClient.plugin.__test.LanPanel({ onClose() {} }));
  assert.equal(panel.props.role, "dialog");
  assert.deepEqual(controls(panel), [], "normal status and history use no task input fields");

  const firstUse = api.normalizeSnapshot({ lockedRole: "classroom" });
  const setupGuide = api.ChatGuideCard({ snapshot: firstUse });
  assert.match(JSON.stringify(plain(setupGuide)), /首次设置也可以直接告诉 Mochi/u);
  assert.match(JSON.stringify(plain(setupGuide)), /设置身份/u);
  const setupStatus = api.IdentityCard({ snapshot: firstUse });
  assert.match(JSON.stringify(plain(setupStatus)), /尚未设置本机身份/u);
  assert.deepEqual(controls(resolve(setupStatus)), [], "first-use identity setup is also chat-based");
});

test("request and reply history never sends automatically and only exposes explicit seen acknowledgments", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const walk = (node, found = []) => {
    if (Array.isArray(node)) node.forEach((item) => walk(item, found));
    else if (node && typeof node === "object") { found.push(node); walk(node.props?.children, found); }
    return found;
  };
  const teacherRequest = {
    messageId: "request-history-1", from: classroomIdentity, recipient: teacherIdentity,
    contentType: "REQUEST", request: { kind: "question", topic: "代数" }, body: "想请老师解释这一题。",
    receivedAt: "2026-09-24T08:00:00.000Z", seenAt: "", seenReceipt: "",
  };
  const teacherSnapshot = api.normalizeSnapshot({ lockedRole: "teacher", identity: teacherIdentity, peers: [classroomIdentity], inbox: [teacherRequest] });
  const actions = [];
  const teacherRow = api.TeacherRequestRow({ message: teacherSnapshot.inbox[0], snapshot: teacherSnapshot, busy: false, onConfirm: (action) => actions.push(action) });
  const teacherNodes = walk(teacherRow);
  assert.equal(teacherNodes.some((node) => node.type === "form" || ["input", "textarea", "select"].includes(node.type)), false);
  const seenRequest = teacherNodes.find((node) => node.type === "button" && node.props.children.includes("已读，撕下"));
  assert.ok(seenRequest, "teacher acknowledgment remains explicit");
  seenRequest.props.onClick();
  assert.equal(actions[0].type, "message-seen");
  assert.equal(actions[0].value.messageId, "request-history-1");

  const classroomRequest = {
    messageId: "request-history-1", targetEndpointId: "teacher-1", sender: classroomIdentity, peer: teacherIdentity,
    contentType: "REQUEST", request: { kind: "question", topic: "代数" }, body: "想请老师解释这一题。", delivery: "ACKNOWLEDGED",
  };
  const reply = {
    messageId: "reply-history-1", from: teacherIdentity, recipient: classroomIdentity,
    response: { replyToMessageId: "request-history-1", decision: "replied" }, body: "请看课本例题。", receivedAt: "2026-09-24T08:01:00.000Z",
  };
  const classroomSnapshot = api.normalizeSnapshot({ lockedRole: "classroom", identity: classroomIdentity, peers: [teacherIdentity], outbox: [classroomRequest], inbox: [reply] });
  const replyActions = [];
  const classroomRow = api.ClassroomRequestRow({ message: classroomSnapshot.outbox[0], snapshot: classroomSnapshot, busy: false, onConfirm: (action) => replyActions.push(action) });
  const classroomNodes = walk(classroomRow);
  assert.equal(classroomNodes.some((node) => node.type === "form" || ["input", "textarea", "select"].includes(node.type)), false);
  assert.match(JSON.stringify(plain(classroomRow)), /未收到单独查看回执/u, "delivery does not become an implied seen acknowledgment");
  const seenReply = classroomNodes.find((node) => node.type === "button" && node.props.children.includes("已读，撕下"));
  assert.ok(seenReply, "the student explicitly confirms seeing the reply");
  seenReply.props.onClick();
  assert.equal(replyActions[0].type, "message-seen");
  assert.equal(replyActions[0].value.messageId, "reply-history-1");
  assert.equal(classroomNodes.some((node) => node.type === "button" && /重试发送|核对后回复/u.test(String(node.props.children))), false, "send and reply actions are handled in Mochi chat");
});

test("pairing details are read-only except for explicit pending-pair approvals", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const actions = [];
  const snapshot = api.normalizeSnapshot({
    lockedRole: "classroom", identity: classroomIdentity,
    pairingCode: { code: "123456", expiresAt: Date.now() + 60_000 },
    localAddresses: [{ name: "Ethernet", address: "10.20.30.44", port: 47832 }],
    pendingPairings: [{ requestId: "pair-1", peer: teacherIdentity }],
  });
  const card = api.PairingCard({ snapshot, candidates: [], busy: false, onConfirm: (action) => actions.push(action) });
  const nodes = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    visit(node.props?.children);
  };
  visit(card);
  assert.equal(nodes.some((node) => node.type === "form" || ["input", "textarea", "select"].includes(node.type)), false, "there is no pairing-code or address entry control");
  assert.match(nodes.map((node) => typeof node === "string" ? node : "").join(" ") + JSON.stringify(plain(card)), /123456/u, "the temporary code stays visible as read-only status");
  const accept = nodes.find((node) => node.type === "button" && node.props.children.includes("核对后接受"));
  assert.ok(accept);
  accept.props.onClick();
  assert.equal(actions[0].type, "pair-accept");
  assert.match(api.confirmationTarget(actions[0]), /sha256:teacher/u);
});

test("glass LAN panel respects reduced motion, reduced transparency, and the native hidden contract", () => {
  const { plugin, created } = loadClient();
  plugin.apply({ effect(setup) { setup(); }, slots: { inject() {} } });
  const css = created.find((node) => node.id === "mochi-lan-client-style")?.textContent || "";
  assert.match(css, /backdrop-filter:blur/u);
  assert.match(css, /prefers-reduced-motion:reduce/u);
  assert.match(css, /prefers-reduced-transparency:reduce/u);
  assert.match(css, /prefers-contrast:more/u);
  assert.match(css, /\.mochi-lan-overlay\[hidden\]\{display:none\}/u);
});

test("the outer LAN dialog takes focus, traps Tab, and returns focus when closed", () => {
  const focused = [];
  const opener = { isConnected: true, focus() { focused.push("opener"); } };
  const close = { focus() { focused.push("close"); } };
  const { plugin, disposeEffects } = loadClient(undefined, {
    runEffects: true,
    activeElement: opener,
    querySelector(selector) { assert.equal(selector, ".mochi-lan-panel .mochi-lan-close"); return close; },
  });
  const api = plugin.__test;
  api.openLanPanel();
  const overlay = api.LanOverlay();
  assert.equal(overlay.props.hidden, false);
  assert.deepEqual(focused, ["close"]);
  overlay.props.children[0].props.onClose();
  disposeEffects();
  assert.deepEqual(focused, ["close", "opener"]);

  const panel = loadClient().plugin.__test.LanPanel({ onClose() {} });
  const elements = ["first", "last"].map((name) => ({ closest() { return null; }, focus() { focused.push(name); } }));
  const currentTarget = { querySelectorAll() { return elements; } };
  let prevented = 0;
  panel.props.onKeyDown({ key: "Tab", target: elements[1], currentTarget, shiftKey: false, preventDefault() { prevented += 1; } });
  panel.props.onKeyDown({ key: "Tab", target: elements[0], currentTarget, shiftKey: true, preventDefault() { prevented += 1; } });
  assert.deepEqual(focused.slice(-2), ["first", "last"]);
  assert.equal(prevented, 2);
});

test("identity-required errors explain that the other device needs local identity setup", () => {
  const { plugin } = loadClient();
  assert.equal(plugin.__test.errorLabel({ code: "IDENTITY_REQUIRED" }), "对方尚未配置本机身份，请先完成身份设置。");
  assert.match(plugin.__test.errorLabel({ code: "MESSAGE_LIMIT" }), /消息箱已满/u);
});

test("legacy identity card keeps role-aware chat setup as a fallback", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  assert.equal("configureIdentity" in api.createLanApi(async () => ({})), false);
  assert.equal(Object.hasOwn(api.ROUTES, "identity"), false);
  const roleExamples = [
    ["teacher", "请把本机教师身份设置为【学校】，显示名为【教师姓名】。"],
    ["classroom", "请把本机教室身份设置为【学校】【班级】，显示名为【教室名称】。"],
  ];
  for (const [role, example] of roleExamples) {
    const guide = api.ChatGuideCard({ snapshot: api.normalizeSnapshot({ lockedRole: role }) });
    assert.match(JSON.stringify(plain(guide)), new RegExp(example.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.deepEqual(JSON.stringify(plain(guide)).match(/"type":"(?:form|input|textarea|select)"/gu), null);
  }
});

test("empty and exceptional setup states stay unavailable instead of inferring a peer", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const empty = api.emptySnapshot();
  assert.equal(empty.configured, false);
  assert.equal(empty.lockedRole, "");
  assert.equal(empty.identity, null);
  assert.equal(empty.peers.length, 0);
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
  assert.equal(api.footerLabel({ configured: true, nearby: 0, inbox: 0, discoveryStatus: normalized.discovery.status }), "发现异常 · 可让 Mochi 排查");
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

test("discovery status reflects matching paired identities without offering a pairing control", () => {
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

test("only explicit pair approvals and seen receipts are exposed as LAN mutations", async () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const calls = [];
  const lan = api.createLanApi(async (path, options) => {
    calls.push({ path, options });
    return { ok: true };
  });
  await api.executeConfirmation(lan, api.confirmationFor("pair-accept", { requestId: "pair-1", peer: teacherIdentity }));
  await api.executeConfirmation(lan, api.confirmationFor("pair-reject", { requestId: "pair-2", peer: teacherIdentity }));
  await api.executeConfirmation(lan, api.confirmationFor("message-seen", { messageId: "notice-1" }));
  assert.deepEqual(calls.map((call) => call.path), [api.ROUTES.pairAccept, api.ROUTES.pairReject, api.ROUTES.messageSeen]);
  assert.deepEqual(calls.map((call) => plain(call.options.body)), [{ requestId: "pair-1" }, { requestId: "pair-2" }, { messageId: "notice-1" }]);
  assert.equal(Object.values(api.ROUTES).some((route) => route.endsWith("/send")), false, "message sending stays in Mochi chat");
  for (const type of ["student-request", "teacher-response", "identity", "pair-request", "peer-unpair", "peer-block", "peer-unblock"]) {
    await assert.rejects(api.executeConfirmation(lan, api.confirmationFor(type, {})), /LAN_ACTION_INVALID/u, `${type} has no panel mutation path`);
  }
});

test("LAN diagnostics show the live interface IP and listener port instead of 0.0.0.0", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const snapshot = api.normalizeSnapshot({
    lockedRole: "classroom", identity: classroomIdentity, discovery: { enabled: true, status: "DEGRADED" },
    http: { host: "0.0.0.0", port: 47832 },
    localAddresses: [{ name: "Ethernet 2", address: "10.20.30.44", port: 47833 }],
  });
  const tree = api.PairingCard({ snapshot, candidates: [], busy: false, onConfirm() {} });
  const textParts = [];
  const details = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node === "string") { textParts.push(node); return; }
    if (!node || typeof node !== "object") return;
    if (node.type === "details") details.push(node);
    visit(node.props?.children);
  };
  visit(tree);
  const content = textParts.join(" ");
  assert.match(content, /10\.20\.30\.44:47833/u);
  assert.match(content, /网卡：Ethernet 2/u);
  assert.doesNotMatch(content, /0\.0\.0\.0/u);
  assert.equal(details.some((node) => node.props.open === true), true, "network diagnostics open when discovery degrades");
});

function findRendered(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) return node.map(item => findRendered(item, predicate)).find(Boolean);
  if (predicate(node)) return node;
  if (typeof node.type === 'function') return findRendered(node.type(node.props), predicate);
  return findRendered(node.props?.children, predicate);
}

test("teacher outbox shows bounded signed roster details and rail focus resolves verdict suffixes", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const snapshot = api.normalizeSnapshot({
    lockedRole: "teacher", identity: teacherIdentity,
    outbox: [{
      messageId: "roster-1", targetEndpointId: "room-1", peer: classroomIdentity,
      contentType: "NOTIFY", body: "【第 5 单元听写】名单见下。", delivery: "ACKNOWLEDGED",
      directive: { item: "第 5 单元听写", verdicts: [
        { student: "李明", seat: 3, action: "fail", note: "课间来重听第 2 段。" },
        { student: "张同学", action: "call", note: "请于下课后到教师办公室。" },
        { student: "无效", action: "arbitrary", note: "不应显示" },
      ] },
    }],
    receipts: [{ messageId: "roster-1", from: { ...classroomIdentity, fingerprint: "sha256:imposter" }, seenAt: "2026-09-24T08:00:00.000Z" }],
  });
  assert.equal(snapshot.outbox[0].directive.verdicts.length, 2, "unknown action is excluded from the UI projection");
  const card = api.InboxCard({ snapshot, focusedMessageId: "roster-1#1", busy: false, onConfirm() {} });
  const article = findRendered(card, node => node.type === "article");
  assert.equal(article.props["data-mochi-lan-focus-message"], "roster-1");
  assert.equal(article.props["data-mochi-lan-focused"], "true");
  function renderedText(node) {
    if (node === null || node === undefined || typeof node === "boolean") return "";
    if (Array.isArray(node)) return node.map(renderedText).join(" ");
    if (typeof node !== "object") return String(node);
    if (typeof node.type === "function") return renderedText(node.type(node.props));
    return renderedText(node.props?.children);
  }
  const content = renderedText(article);
  assert.match(content, /李明（3 号） · 不过关 — 课间来重听第 2 段/u);
  assert.match(content, /张同学 · 请到指定地点 — 请于下课后到教师办公室/u);
  assert.doesNotMatch(content, /不应显示/u);
  assert.match(content, /尚未收到人工已看到回执/u, "a receipt from a changed fingerprint cannot count");

  let scrolled = 0;
  const focusClient = loadClient(undefined, { runEffects: true, querySelectorAll() { return [{
    getAttribute() { return "roster-1"; }, scrollIntoView() { scrolled += 1; },
  }]; } });
  focusClient.plugin.__test.TeacherRequestsCard({ snapshot, focusedMessageId: "roster-1#1", busy: false, onConfirm() {} });
  assert.equal(scrolled, 1, "rail focus scrolls to the matching outbox message");
  focusClient.disposeEffects();
});

test("classroom rail focus opens a full seen roster at the original message", () => {
  let scrolled = 0;
  let scrollBehavior = "";
  const { plugin, disposeEffects } = loadClient(undefined, { runEffects: true, matchMedia() { return { matches: true }; }, querySelectorAll() { return [{
    getAttribute() { return "dictation-64"; }, scrollIntoView(options) { scrolled += 1; scrollBehavior = options.behavior; },
  }]; } });
  const snapshot = plugin.__test.normalizeSnapshot({
    lockedRole: "classroom", identity: classroomIdentity, peers: [teacherIdentity],
    inbox: [activeInbox("dictation-64", {
      seenAt: "2026-09-24T08:00:00.000Z", body: "全班听写结果。",
      directive: { item: "第 5 单元", verdicts: Array.from({ length: 64 }, (_, index) => ({ student: `学生${index + 1}`, action: "fail" })) },
    })],
  });
  try {
    const card = plugin.__test.InboxCard({ snapshot, focusedMessageId: "dictation-64#50", busy: false, onConfirm() {} });
    const article = findRendered(card, node => node.type === "article");
    assert.equal(article.props["data-mochi-lan-focused"], "true");
    assert.equal(article.props["data-mochi-lan-focus-message"], "dictation-64");
    assert.equal(scrolled, 1, "a seen roster is still reachable from the desktop rail");
    assert.equal(scrollBehavior, "auto", "focus honors reduced motion");
    assert.equal(snapshot.inbox[0].directive.verdicts.length, 64);
    plugin.__test.TeacherRequestsCard({ snapshot, focusedMessageId: "dictation-64#50", busy: false, onConfirm() {} });
    assert.equal(scrolled, 1, "the teacher-only card cannot scroll the classroom roster a second time");
  } finally {
    disposeEffects();
  }
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
  assert.match(rendered, /已读，撕下/u);
  assert.match(rendered, /收到：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/u, "wire timestamp is presented in a local readable form");
  assert.doesNotMatch(rendered, /2026-09-09T01:02:00\.000Z/u, "the front card does not display the raw UTC wire timestamp");
  assert.equal(api.localTimeLabel("invalid"), "收到时间暂不可用");
  const findButton = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.type === "button" && node.props?.children?.includes("已读，撕下")) return node;
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

test("the classroom reply alert shows the teacher's appointment time before acknowledgment", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const request = {
    messageId: "student-request-1", targetEndpointId: teacherIdentity.endpointId,
    sender: classroomIdentity, peer: teacherIdentity, contentType: "REQUEST",
    request: { student: "李明", kind: "appointment", slot: "周五课后" }, body: "请老师讲一下。",
  };
  const snapshot = api.normalizeSnapshot({
    lockedRole: "classroom", identity: classroomIdentity, peers: [teacherIdentity],
    outbox: [request],
    inbox: [activeInbox("reply-1", {
      body: "老师建议调整预约时间。",
      response: { replyToMessageId: "student-request-1", decision: "confirmed", slot: "周一课后" },
    })],
  });
  const card = api.IncomingMessageCard({ snapshot, messageId: "reply-1", busy: false, onConfirm() {} });
  const rendered = JSON.stringify(plain(card));
  assert.match(rendered, /教师回复 · 预约讲题/u);
  assert.match(rendered, /历史记录异常：学生申请时间“周五课后”，旧版回复却确认“周一课后”/u);
  assert.match(rendered, /已读，撕下/u);
  assert.deepEqual(plain(snapshot.inbox[0].response), { replyToMessageId: "student-request-1", decision: "confirmed", slot: "周一课后" }, "the signed historical response remains unchanged");
  const row = api.ClassroomRequestRow({ message: snapshot.outbox[0], snapshot, busy: false, onConfirm() {} });
  assert.match(JSON.stringify(plain(row)), /历史记录异常：学生申请时间/u);
  assert.match(JSON.stringify(plain(row)), /学生申请时间“周五课后”，旧版回复却确认“周一课后”/u);
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
  assert.doesNotMatch(rendered, /已读，撕下/u, "history offers no local seen action or receipt");
});

test("a mounted classroom overlay checks existing inbox before its first footer click", async () => {
  const notifications = [];
  const eventPaths = [];
  const { plugin, disposeEffects, resetRender } = loadClient(async (path) => {
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
    if (path.startsWith("/api/mochi-lan/events?cursor=")) { eventPaths.push(path); return { ok: true, status: 200, json: async () => ({ cursor: 2, events: [] }) }; }
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
    assert.equal(api.footerLabel(plugin.__test.uiSnapshot()), "发现异常 · 可让 Mochi 排查 · 1 条待看");
    disposeEffects();
    resetRender();
    panel.type({ onClose() {} });
    for (let tick = 0; tick < 8 && eventPaths.length < 2; tick += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(notifications, ["incoming-message", "pairing-request"], "an effect restart cannot replay old unread or pairing attention");
    assert.deepEqual(eventPaths, ["/api/mochi-lan/events?cursor=0", "/api/mochi-lan/events?cursor=2"], "the event cursor survives an effect restart");
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

test("the browser deduplicates rail rows but reports each poll and its failure", async () => {
  const pushed = [];
  const health = [];
  let failState = false;
  const { plugin, disposeEffects, tickIntervals } = loadClient(async (path) => {
    if (path === "/api/mochi-lan/state") {
      if (failState) throw new Error("offline fixture");
      return { ok: true, status: 200, json: async () => ({ lockedRole: "teacher", inbox: [{ messageId: "req-1" }] }) };
    }
    if (path === "/api/mochi-lan/discovery") return { ok: true, status: 200, json: async () => ({ candidates: [] }) };
    if (path.startsWith("/api/mochi-lan/events?cursor=")) return { ok: true, status: 200, json: async () => ({ cursor: 1, events: [] }) };
    throw new Error(`unexpected route: ${path}`);
  }, {
    runEffects: true,
    railBridge: {
      pushLanState(state) { pushed.push(state); return true; },
      reportSyncHealth(ok) { health.push(ok); return true; },
    },
  });
  const api = plugin.__test;
  try {
    // 直接驱动 refresh：注册 overlay 后渲染一次面板即可触发生命周期里的轮询。
    const registrations = [];
    plugin.apply({
      effect(setup) { return setup(); },
      slots: {
        inject(name, generator) { for (const entry of generator()) registrations.push({ name, entry }); },
        register(options, component) { return { options, component }; },
      },
    });
    const overlay = registrations.find((item) => item.name === "shell.overlay").entry.component;
    const panel = overlay().props.children[0];
    panel.type({ onClose() {} });
    for (let tick = 0; tick < 8 && pushed.length === 0; tick += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(pushed.length, 1, "首次状态必须推给常驻条");
    // 推的是**原始响应体**，不是归一化后的投影：预约描述、发件角色、已看到时刻
    // 这些字段只在原文里，面板自己的投影会丢掉它们。
    assert.equal(pushed[0].inbox[0].messageId, "req-1");
    assert.equal(Object.hasOwn(pushed[0], "lockedRole"), true);
    assert.deepEqual(health, [true], "首轮成功必须报告同步健康");

    failState = true;
    tickIntervals(3_000);
    for (let tick = 0; tick < 8 && health.length < 2; tick += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(health, [true, false], "轮询失败必须让桌宠得知旧数据已过期");
    assert.equal(pushed.length, 1, "失败不能伪造空快照并清掉待办");

    failState = false;
    tickIntervals(3_000);
    for (let tick = 0; tick < 8 && health.length < 3; tick += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(health, [true, false, true], "内容相同的成功轮询仍必须解除旧数据提示");
    assert.equal(pushed.length, 1, "恢复时相同内容不重复推送");

    // 原样再推一次同一份负载（去重是按内容比的，不是按对象引用）。
    api.requestRailSync(pushed[0]);
    assert.equal(pushed.length, 1, "内容没变不重复推");
    api.requestRailSync({ lockedRole: pushed[0].lockedRole, inbox: [{ messageId: "req-2" }] });
    assert.equal(pushed.length, 2, "内容变了要推");
  } finally {
    disposeEffects();
  }
});

test("a failing rail push is retried on the next poll instead of being marked as delivered", () => {
  let attempts = 0;
  const { plugin } = loadClient(undefined, {
    // 第一次失败、之后成功：这是「主进程还没建好常驻条」时最可能出现的时序。
    railBridge: { pushLanState() { attempts += 1; return attempts > 1; } },
  });
  const api = plugin.__test;
  assert.equal(api.requestRailSync({ inbox: [] }), false, "首次推送失败");
  assert.equal(attempts, 1);
  assert.equal(api.requestRailSync({ inbox: [] }), true, "失败后同一份数据必须重推");
  assert.equal(attempts, 2);
  assert.equal(api.requestRailSync({ inbox: [] }), false, "成功之后同样的数据不再重推");
  assert.equal(attempts, 2);
});

test("desktop focus bridge carries only a bounded message id and unsubscribes cleanly", () => {
  const listeners = new Set();
  const { plugin } = loadClient(undefined, { railBridge: {
    onFocusMessage(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  } });
  const dispose = plugin.__test.installFocusMessage();
  const listener = [...listeners][0];
  assert.equal(typeof listener, "function");
  listener("student-request-1");
  assert.equal(plugin.__test.uiSnapshot().focusedMessageId, "student-request-1");
  listener({ messageId: "student-request-2", body: "must not cross bridge" });
  assert.equal(plugin.__test.uiSnapshot().focusedMessageId, "student-request-1", "bridge accepts only the message id string");
  listener("x".repeat(121));
  assert.equal(plugin.__test.uiSnapshot().focusedMessageId, "student-request-1", "oversized id is ignored");
  dispose();
  assert.equal(listeners.size, 0, "plugin disposal removes the desktop listener");
});


test("已确认消息进入折叠历史；桌宠定位历史消息时展开，不能自动发回执", () => {
  const { plugin } = loadClient();
  const api = plugin.__test;
  const snapshot = api.normalizeSnapshot({ lockedRole: "classroom", identity: classroomIdentity, peers: [teacherIdentity], inbox: [
    activeInbox("pending", { body: "请到办公室" }),
    activeInbox("done", { body: "昨天的通知", seenAt: "2026-09-29T08:00:00Z", seenReceipt: "ACKNOWLEDGED" }),
  ] });
  const props = { snapshot, busy: false, onConfirm() { throw Error("no automatic receipts"); } };
  const tree = api.InboxCard(props);
  const history = findRendered(tree, node => node.props?.className === "mochi-lan-history");
  assert.equal(history.props.open, undefined);
  assert.equal(findRendered(history, node => node.type === "article").props["data-mochi-lan-focus-message"], "done");
  const focused = api.InboxCard({ ...props, focusedMessageId: "done" });
  assert.equal(findRendered(focused, node => node.props?.className === "mochi-lan-history").props.open, true);
});


test("桌宠接管新信后不自动打开收件箱或抢主窗口焦点", async () => {
  const notifications = [];
  const client = loadClient(async path => ({ ok: true, status: 200, json: async () => path.endsWith('/state')
    ? { configured: true, lockedRole: 'classroom', identity: classroomIdentity, peers: [activePeer], inbox: [activeInbox('pet-letter')] }
    : path.includes('/discovery') ? { candidates: [] } : { cursor: 0, events: [] } }), {
    runEffects: true,
    railBridge: { pushLanState() { return true; }, reportSyncHealth() { return true; } },
    desktopBridge: { attention(kind) { notifications.push(kind); } },
  });
  try {
    client.plugin.__test.LanPanel({ onClose() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(notifications, []);
    assert.equal(client.plugin.__test.uiSnapshot().open, false);
  } finally { client.disposeEffects(); }
});

test("connection guidance prioritizes prerequisites and never equates pairing with delivery", () => {
  const { connectionStep, normalizeSnapshot } = loadClient().plugin.__test;
  const state = (extra = {}) => normalizeSnapshot({ lockedRole: "teacher", started: true, identity: teacherIdentity, peers: [], pendingPairings: [], ...extra });
  assert.equal(connectionStep(state({ lockedRole: "" })).id, "role");
  assert.equal(connectionStep(state({ identity: null })).id, "identity");
  assert.equal(connectionStep(state({ started: false, peers: [activePeer] })).id, "service");
  assert.equal(connectionStep(state({ peers: [{ ...activePeer, blocked: true }] })).id, "pair");
  const paired = connectionStep(state({ peers: [{ ...activePeer, online: false }] }));
  assert.equal(paired.id, "paired");
  assert.match(paired.detail, /收到已看到回执/u);
  assert.doesNotMatch(paired.title, /已连接|已送达|连接成功/u);
  assert.match(connectionStep(state({ lockedRole: "classroom", identity: classroomIdentity })).title, /交给老师/u);
});

test('pairing guidance separates discovery, saved pairing, and a real human receipt', () => {
  const api = loadClient().plugin.__test;
  const state = extra => api.normalizeSnapshot({lockedRole:'teacher',started:true,identity:teacherIdentity,...extra});
  const candidate={identity:classroomIdentity,address:{host:'10.0.0.7',port:47832}};
  assert.match(api.connectionStep(state({}),[candidate]).title,/先核对/u);
  const paired=state({peers:[{...classroomIdentity,online:false}]});
  assert.match(api.connectionStep(paired,[]).title,/先确认对方可达/u);
  assert.match(api.connectionStep(paired,[candidate]).detail,/仍需实际收发/u);
  const receipt=state({peers:[classroomIdentity],outbox:[{messageId:'notice-1',peer:classroomIdentity}],receipts:[{messageId:'notice-1',from:classroomIdentity}]});
  assert.match(api.connectionStep(receipt,[]).title,/人工回执/u);
  assert.match(api.connectionStep(receipt,[]).detail,/不代表设备会一直在线/u);
  const wrong=state({peers:[classroomIdentity],outbox:[{messageId:'notice-1',peer:classroomIdentity}],receipts:[{messageId:'notice-1',from:{...classroomIdentity,fingerprint:'changed'}}]});
  assert.doesNotMatch(api.connectionStep(wrong,[]).title,/已收到/u);
});

test('a failed refresh invalidates nearby status until a successful refresh', async () => {
  let failed=false;
  const client=loadClient(async path=>{if(failed)throw Error('offline');return{ok:true,status:200,json:async()=>path.includes('/discovery')?{candidates:[{identity:classroomIdentity}]}:{configured:true,lockedRole:'teacher',identity:teacherIdentity,discovery:{status:'ACTIVE'}}}}, {runEffects:true});
  try {
    client.plugin.__test.LanPanel({onClose(){}});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(client.plugin.__test.uiSnapshot().nearby,1);
    failed=true;client.tickIntervals(3000);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(client.plugin.__test.uiSnapshot().nearby,0);
    assert.match(client.plugin.__test.footerLabel(client.plugin.__test.uiSnapshot()),/状态未更新/u);
    failed=false;client.tickIntervals(3000);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(client.plugin.__test.uiSnapshot().connectionFailed,false);
  }finally{client.disposeEffects()}
});

test('two confirmation clicks before rerender send exactly one request', async () => {
  let calls=0,release;
  const waiting=new Promise(resolve=>{release=resolve});
  const action={type:'pair-accept',value:{requestId:'pending-1',peer:teacherIdentity}};
  const client=loadClient(async ()=>{calls++;await waiting;return{ok:true,status:200,json:async()=>({})}}, {stateValues:{5:action}});
  const panel=client.plugin.__test.LanPanel({onClose(){}});
  let confirmation;
  const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!node||typeof node!=='object')return;if(node.type===client.plugin.__test.ConfirmationCard)confirmation=node;visit(node.props?.children)};
  visit(panel);assert.ok(confirmation);
  const first=confirmation.props.onProceed();const second=confirmation.props.onProceed();
  assert.equal(calls,1);release();await Promise.all([first,second]);assert.equal(calls,1);
});

test('modern quick setup keeps nickname, LAN labels, and campus authentication separate', async () => {
  const find=(node,predicate,result=[])=>{if(Array.isArray(node)){node.forEach(n=>find(n,predicate,result));return result}if(!node||typeof node!=='object')return result;if(predicate(node))result.push(node);find(node.props?.children,predicate,result);return result};
  for(const role of ['teacher','classroom']){
    const calls=[],field=role==='teacher'?'preferredAddress':'classroomAddress';
    const profile={role,revision:7,preferredAddress:'',classroomAddress:'',configured:false,setupDismissed:false};
    const client=loadClient(async(path,options)=>{const body=JSON.parse(options.body);calls.push({path,body});return{ok:true,status:200,json:async()=>({...profile,...body.changes,revision:8,configured:true})}}, {stateValues:{0:profile,1:role==='teacher'?'王老师':'星星班的小伙伴们',5:{status:'unknown',lastVerified:{id:1,name:'旧认证名'}},6:'学校',7:'班级',8:'本机设备'}});
    const api=client.plugin.__test,card=api.UserProfileCard({snapshot:api.normalizeSnapshot({lockedRole:role}),onRefresh(){}});
    const forms=find(card,n=>n.type==='form');assert.equal(forms.length,2);
    await forms.find(form=>form.props['data-mochi-user-profile-form']==='true').props.onSubmit({preventDefault(){}});assert.equal(calls[0].path,'/api/mochi-profile');assert.equal(calls[0].body.expectedRevision,7);
    assert.deepEqual(Object.keys(calls[0].body.changes).sort(),[field,'setupDismissed'].sort());
    await forms.find(form=>form.props['data-mochi-lan-identity-form']==='true').props.onSubmit({preventDefault(){}});assert.equal(calls[1].path,'/api/mochi-lan/identity');assert.equal(calls[1].body.identity.role,undefined,'Host locks role, never browser input');assert.equal(calls[1].body.identity.schoolId,'学校');assert.equal(calls[1].body.identity.classId,role==='classroom'?'班级':undefined);
    assert.match(JSON.stringify(plain(card)),/校园身份：状态待验证/u);assert.doesNotMatch(JSON.stringify(plain(card)),/校园已登录：旧认证名/u);
    assert.ok(!calls.some(c=>c.path.includes('/auth/')),'Basic profile setup never sends a campus login');
  }
});

test('mailbox separates incoming requests from sent letters without creating a send endpoint', () => {
  const api = loadClient().plugin.__test;
  const snapshot = api.normalizeSnapshot({ lockedRole: 'teacher', identity: teacherIdentity, peers: [classroomIdentity],
    inbox: [{ ...activeInbox('incoming'), from: classroomIdentity, recipient: teacherIdentity, contentType: 'REQUEST', request: { kind: 'question' }, body: '请讲解这道题' }],
    outbox: [{ messageId: 'reply', peer: classroomIdentity, targetEndpointId: 'room-1', body: '请看例题', response: { replyToMessageId: 'incoming', decision: 'replied' }, delivery: 'ACKNOWLEDGED' }],
  });
  const incoming = api.MailboxContents({ snapshot, folder: 'inbox', onConfirm() {} });
  assert.equal(incoming.type, api.TeacherRequestsCard);
  const sent = api.MailboxContents({ snapshot, folder: 'sent', onConfirm() {} });
  assert.equal(sent.type, api.InboxCard);
  assert.ok(findRendered(sent, node => node.type === 'article' && node.props['data-mochi-lan-focus-message'] === 'reply'));
  assert.equal(api.focusedMailboxFolder(snapshot, 'incoming#1'), 'inbox');
  assert.equal(api.focusedMailboxFolder(snapshot, 'reply'), 'sent');
  assert.deepEqual(Object.keys(api.ROUTES).sort(), ['discovery', 'events', 'messageSeen', 'pairAccept', 'pairReject', 'state']);
});

test('reading a student request never moves an unanswered task into processed history', () => {
  const api = loadClient().plugin.__test;
  const message = { ...activeInbox('read-unanswered'), from: classroomIdentity, recipient: teacherIdentity,
    contentType: 'REQUEST', request: { kind: 'question' }, body: '仍需老师回复', seenAt: '2026-10-01T08:00:00Z', seenReceipt: 'ACKNOWLEDGED' };
  const snapshot = api.normalizeSnapshot({ lockedRole: 'teacher', identity: teacherIdentity, peers: [classroomIdentity], inbox: [message] });
  const card = api.TeacherRequestsCard({ snapshot, onConfirm() { throw Error('no implicit seen action'); } });
  assert.ok(findRendered(card, node => node.type === 'article' && node.props['data-mochi-lan-focus-message'] === message.messageId));
  assert.equal(findRendered(card, node => node.props?.className === 'mochi-lan-history'), undefined);
  const replied = api.normalizeSnapshot({ ...snapshot, outbox: [{ messageId: 'answer', peer: classroomIdentity, targetEndpointId: 'room-1', response: { replyToMessageId: message.messageId, decision: 'replied' }, delivery: 'ACKNOWLEDGED' }] });
  const history = findRendered(api.TeacherRequestsCard({ snapshot: replied, onConfirm() {} }), node => node.props?.className === 'mochi-lan-history');
  assert.ok(history);
  assert.match(JSON.stringify(history), /已回复与历史请求/u);
});

test('classroom inbox shows teacher replies while the sent view keeps the original request', () => {
  const api = loadClient().plugin.__test;
  const snapshot = api.normalizeSnapshot({ lockedRole: 'classroom', identity: classroomIdentity, peers: [teacherIdentity],
    outbox: [{ messageId: 'question', sender: classroomIdentity, peer: teacherIdentity, targetEndpointId: 'teacher-1', contentType: 'REQUEST', request: { kind: 'question' }, body: '原问题', delivery: 'ACKNOWLEDGED' }],
    inbox: [activeInbox('reply', { body: '回答', response: { replyToMessageId: 'question', decision: 'replied' } })],
  });
  const incoming = api.MailboxContents({ snapshot, folder: 'inbox', onConfirm() {} });
  assert.ok(findRendered(incoming, node => node.type === 'article' && node.props['data-mochi-lan-focus-message'] === 'reply'));
  const sent = api.MailboxContents({ snapshot, folder: 'sent', onConfirm() {} });
  assert.equal(sent.type, api.ClassroomRequestsCard);
  assert.equal(api.focusedMailboxFolder(snapshot, 'reply'), 'inbox');
});

test('configured profile is a compact editable summary, while first-use and explicit edit preserve nickname controls', () => {
  const profile = { role:'teacher', revision:1, configured:true, setupDismissed:true, preferredAddress:'王老师', classroomAddress:'' };
  function card(value, requested = false) {
    const client = loadClient(undefined, { stateValues:{0:value,1:value.preferredAddress} });
    return client.plugin.__test.UserProfileCard({snapshot:client.plugin.__test.normalizeSnapshot({lockedRole:'teacher',identity:teacherIdentity}),profileRequested:requested,onRefresh(){}});
  }
  const compact = card(profile);
  const details = findRendered(compact, node => node.props?.className === 'mochi-lan-profile-edit');
  assert.equal(details.props.open, undefined);
  assert.match(JSON.stringify(details), /王老师 · 编辑称呼/u);
  assert.equal(findRendered(card(profile, true), node => node.props?.className === 'mochi-lan-profile-edit').props.open, true);
  const first = card({...profile,configured:false,setupDismissed:false,preferredAddress:''});
  assert.equal(findRendered(first, node => node.props?.className === 'mochi-lan-profile-edit').props.open, true);
  assert.ok(findRendered(first, node => node.props?.['data-mochi-user-address'] === 'true'), 'existing guide input hook is intact');
});

test('initial mailbox stays on messages and offers missing local identity as one action', async () => {
  const client = loadClient(async path => ({ok:true,status:200,json:async()=>path.endsWith('/state')?{configured:false,lockedRole:'teacher'}:path.includes('/discovery')?{candidates:[]}:{cursor:0,events:[]}}),{runEffects:true,stateValues:{3:'ready'}});
  try {
    const panel = client.plugin.__test.LanPanel({onClose(){}});
    const hint = findRendered(panel,node=>node.props?.['aria-label']==='本机信息尚未完成');
    assert.ok(hint);
    const action = findRendered(hint,node=>node.type==='button');
    assert.equal(action.props.children[0],'设置本机信息');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(client.stateWrites.some(row=>row.index===2 && row.next==='connection'),false,'an empty inbox does not dump all setup forms into the first page');
    action.props.onClick();
    assert.equal(client.stateWrites.at(-1).index,2);
    assert.equal(client.stateWrites.at(-1).next,'connection');
  } finally {client.disposeEffects();}
});

test('nickname and local identity editors are siblings; missing identity is directly editable', () => {
  const profile = {role:'classroom',revision:2,configured:true,setupDismissed:true,preferredAddress:'',classroomAddress:'星星班的小伙伴们'};
  const client = loadClient(undefined,{stateValues:{0:profile,1:profile.classroomAddress}});
  const api = client.plugin.__test;
  const tree = api.UserProfileCard({snapshot:api.normalizeSnapshot({lockedRole:'classroom'}),onRefresh(){}});
  const nickname = findRendered(tree,node=>node.props?.className==='mochi-lan-profile-edit');
  const identity = findRendered(tree,node=>node.props?.className==='mochi-lan-identity-edit');
  assert.equal(nickname.props.open,undefined);
  assert.equal(identity.props.open,true);
  assert.equal(findRendered(nickname,node=>node===identity),undefined,'local setup is not hidden behind nickname editing');
  assert.equal(findRendered(identity,node=>node.type==='form').props.children.filter(node=>node?.type==='label').length,3);
  assert.match(api.connectionStep(api.normalizeSnapshot({lockedRole:'classroom'})).detail,/设置本机学校与设备/u);
  assert.doesNotMatch(api.connectionStep(api.normalizeSnapshot({lockedRole:'classroom'})).detail,/上方展开|快速设置/u);
});

test('Tab candidates exclude closed disclosure bodies even when a browser returns layout rectangles', () => {
  const api=loadClient().plugin.__test;
  const details={tagName:'DETAILS',open:false,parentElement:null,children:[]};
  const summary={tagName:'SUMMARY',parentElement:details,contains(node){return node===this || node===icon;},closest(){return null;},getClientRects(){return [{}];}};
  const icon={tagName:'BUTTON',parentElement:summary,closest(){return null;},getClientRects(){return [{}];}};
  const form={tagName:'FORM',parentElement:details};
  const input={tagName:'INPUT',parentElement:form,closest(){return null;},getClientRects(){return [{}];}};
  details.children=[summary,form];
  assert.equal(api.visibleFocusCandidate(summary),true);
  assert.equal(api.visibleFocusCandidate(icon),true);
  assert.equal(api.visibleFocusCandidate(input),false);
  details.open=true;
  assert.equal(api.visibleFocusCandidate(input),true);
  input.closest=()=>({hidden:true});
  assert.equal(api.visibleFocusCandidate(input),false);
});

test('user pane changes restore a visible heading after commit; initial loading does not steal focus', async () => {
  const focused=[];
  const stateValues={3:'ready'};
  const client=loadClient(async path=>({ok:true,status:200,json:async()=>path.endsWith('/state')?{lockedRole:'teacher'}:path.includes('/discovery')?{candidates:[]}:{cursor:0,events:[]}}),{runEffects:true,stateValues});
  try {
    const api=client.plugin.__test;
    const first=api.LanPanel({onClose(){}});
    const heading=findRendered(first,node=>node.props?.className==='mochi-lan-head__title');
    heading.props.ref.current={focus(options){focused.push(options);}};
    assert.equal(heading.props.tabIndex,-1);
    assert.equal(focused.length,0);
    const hint=findRendered(first,node=>node.props?.['aria-label']==='本机信息尚未完成');
    findRendered(hint,node=>node.type==='button').props.onClick();
    assert.equal(focused.length,0,'focus waits for the new pane to commit');
    stateValues[2]='connection';client.resetRender();api.LanPanel({onClose(){}});
    assert.deepEqual(plain(focused),[{preventScroll:true}]);
    client.resetRender();api.LanPanel({onClose(){}});
    assert.equal(focused.length,1,'ordinary refresh does not repeat focus');
  } finally {client.disposeEffects();}
});

test('successful nickname save closes the editor and returns focus to its summary, without stealing another surface focus', async () => {
  for (const stayedInside of [true,false]) {
    const profile={role:'teacher',revision:2,configured:true,setupDismissed:true,preferredAddress:'王老师',classroomAddress:''};
    const saved={...profile,revision:3,preferredAddress:'小林'};
    const button={tagName:'BUTTON'};
    const focused=[];
    const editor={tagName:'DETAILS',open:true,contains(node){return stayedInside && node===button;}};
    const stateValues={0:profile,1:'小林'};
    const client=loadClient(async(_path,options)=>({ok:true,status:200,json:async()=>options.method==='PATCH'?saved:profile}),{runEffects:true,stateValues,activeElement:button});
    try {
      const api=client.plugin.__test;
      const props={snapshot:api.normalizeSnapshot({lockedRole:'teacher',identity:teacherIdentity}),profileRequested:true,onRefresh(){}};
      const first=api.UserProfileCard(props);
      const edit=findRendered(first,node=>node.props?.className==='mochi-lan-profile-edit');
      const summary=findRendered(edit,node=>node.type==='summary');
      summary.props.ref.current={parentElement:editor,focus(options){focused.push(options);}};
      await new Promise(resolve=>setImmediate(resolve));
      await findRendered(edit,node=>node.type==='form').props.onSubmit({preventDefault(){}});
      assert.equal(focused.length,0,'wait for the saved view to commit');
      stateValues[0]=saved;client.resetRender();api.UserProfileCard({...props,profileRequested:false});
      assert.equal(editor.open,false);
      assert.equal(focused.length,stayedInside?1:0,'a newly focused guide or dialog is not overridden');
    } finally {client.disposeEffects();}
  }
});

test('settings starts with necessary local information, never with expanded connection explanations or duplicate missing identity', () => {
  for (const configured of [false,true]) {
    const state={lockedRole:'teacher',identity:configured?teacherIdentity:null,pendingPairings:[{requestId:'pair-1',peer:classroomIdentity}]};
    const client=loadClient(undefined,{stateValues:{0:loadClient().plugin.__test.normalizeSnapshot(state),2:'connection',3:'ready'}});
    const api=client.plugin.__test;
    const panel=api.LanPanel({onClose(){}});
    const connection=findRendered(panel,node=>node.type==='section' && node.props.className==='mochi-lan-pane' && node.props.hidden===false);
    assert.equal(connection.props.children[0].type,api.UserProfileCard);
    const guide=connection.props.children[1];
    assert.equal(guide.type,'details');
    assert.equal(guide.props.open,undefined,'four-step guidance stays closed even with missing identity or pending pairing');
    const grid=connection.props.children.find(node=>node?.props?.className==='mochi-lan-grid');
    const identity=grid.props.children[0];
    assert.equal(Boolean(identity),configured,'missing identity has no duplicate detail card');
    if(configured)assert.equal(identity.props.open,undefined);
    assert.equal(grid.props.children[1].props.open,true,'pending pairing remains directly visible in its own section');
  }
});

test('missing local identity fields precede nickname editing, and configured editors remain compact siblings', () => {
  const profile={role:'classroom',revision:1,configured:false,setupDismissed:false,preferredAddress:'',classroomAddress:''};
  for(const configured of [false,true]) {
    const client=loadClient(undefined,{stateValues:{0:profile}});
    const api=client.plugin.__test;
    const card=api.UserProfileCard({snapshot:api.normalizeSnapshot({lockedRole:'classroom',identity:configured?classroomIdentity:null}),onRefresh(){}});
    const editors=card.props.children.find(node=>Array.isArray(node?.props?.children?.[0]))?.props.children[0];
    assert.ok(editors);
    assert.equal(editors[0].props.className,configured?'mochi-lan-profile-edit':'mochi-lan-identity-edit');
    assert.equal(editors[1].props.className,configured?'mochi-lan-identity-edit':'mochi-lan-profile-edit');
    const identity=editors.find(node=>node.props.className==='mochi-lan-identity-edit');
    assert.equal(identity.props.open,configured?undefined:true);
  }
});
