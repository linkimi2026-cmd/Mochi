import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./client.js", import.meta.url), "utf8");
const packageMeta = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
assert.ok(
	packageMeta.dsh.client.inject.includes("@deepseek-ai/dsh-client-locale"),
	"the package manifest declares the locale runtime used by the client bundle",
);

class FakeStyle {
	setProperty(name, value) { this[name] = value; }
	removeProperty(name) { delete this[name]; }
}

class FakeElement {
	constructor(document, rect = { left: 0, top: 0, width: 0, height: 0 }) {
		this.document = document;
		this.rect = rect;
		this.children = [];
		this.parentNode = null;
		this._id = "";
		this.attributes = {};
		this.dataset = {};
		this.style = new FakeStyle();
		this.listeners = new Map();
		this.isConnected = false;
		this.offsetParent = null;
		this._selectors = new Map();
	}

	get id() { return this._id; }
	set id(value) {
		this._id = value;
		if (value) this.document.byId.set(value, this);
	}

	get parentElement() { return this.parentNode; }

	appendChild(child) {
		child.parentNode = this;
		child.isConnected = this.isConnected;
		this.children.push(child);
		return child;
	}

	removeChild(child) {
		this.children = this.children.filter((item) => item !== child);
		child.parentNode = null;
		child.isConnected = false;
	}

	remove() {
		if (this.parentNode) this.parentNode.removeChild(this);
	}

	setAttribute(name, value) { this.attributes[name] = String(value); }
	hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
	getAttribute(name) { return this.attributes[name] ?? null; }

	addEventListener(type, handler, capture = false) {
		const entries = this.listeners.get(type) ?? [];
		entries.push({ handler, capture });
		this.listeners.set(type, entries);
	}

	removeEventListener(type, handler, capture = false) {
		this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => (
			entry.handler !== handler || entry.capture !== capture
		)));
	}

	dispatch(type, target) {
		for (const entry of this.listeners.get(type) ?? []) entry.handler({ target });
	}

	listenerCount(type) { return (this.listeners.get(type) ?? []).length; }

	contains(node) {
		for (let cursor = node; cursor; cursor = cursor.parentNode) {
			if (cursor === this) return true;
		}
		return false;
	}

	closest(selector) {
		for (let cursor = this; cursor; cursor = cursor.parentNode) {
			if (selector === '[role="tab"]' && cursor.getAttribute("role") === "tab") return cursor;
			const slot = selector.match(/^\[data-slot="(.+)"\]$/);
			if (slot && cursor.getAttribute("data-slot") === slot[1]) return cursor;
		}
		return null;
	}

	querySelector(selector) { return this._selectors.get(selector) ?? null; }
	getBoundingClientRect() { return this.rect; }

	set innerHTML(value) {
		const stageId = value.match(/<div id="([^"]+)"/u)?.[1];
		if (!stageId) return;
		const title = new FakeElement(this.document);
		const desc = new FakeElement(this.document);
		const close = new FakeElement(this.document);
		const stage = new FakeElement(this.document);
		const mount = new FakeElement(this.document);
		const booting = new FakeElement(this.document);
		mount.id = stageId;
		stage.appendChild(mount);
		stage.appendChild(booting);
		this._selectors.set(".jxl-widget-panel__title", title);
		this._selectors.set(".jxl-widget-panel__desc", desc);
		this._selectors.set(".jxl-widget-panel__close", close);
		this._selectors.set(".jxl-widget-panel__stage", stage);
		this._selectors.set(".jxl-widget-panel__stage > div[id]", mount);
		this._selectors.set(".jxl-widget-panel__booting", booting);
		stage._selectors.set(".jxl-widget-panel__booting", booting);
	}
}

const byId = new Map();
const makeElement = (rect) => new FakeElement({ byId }, rect);
const document = {
	byId,
	head: makeElement(),
	body: makeElement(),
	createElement: () => makeElement(),
	getElementById: (id) => byId.get(id) ?? null,
	querySelector: () => null,
	listeners: new Map(),
	addEventListener(type, handler) {
		const entries = this.listeners.get(type) ?? [];
		entries.push(handler);
		this.listeners.set(type, entries);
	},
	removeEventListener(type, handler) {
		this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== handler));
	},
};
document.head.isConnected = true;
document.body.isConnected = true;

const overlay = makeElement({ left: 0, top: 0, width: 1100, height: 814 });
overlay.isConnected = true;
const conversationSlot = makeElement();
conversationSlot.setAttribute("data-slot", "conversation");
const conversationRoot = makeElement({ left: 280, top: 0, width: 820, height: 814 });
conversationSlot.appendChild(conversationRoot);
const headerSlot = makeElement();
headerSlot.setAttribute("data-slot", "conversation.session.header");
conversationRoot.appendChild(headerSlot);
const nativeChatTab = makeElement();
nativeChatTab.setAttribute("role", "tab");
headerSlot.appendChild(nativeChatTab);
const scrollBody = makeElement({ left: 280, top: 76, width: 820, height: 738 });
conversationRoot.appendChild(scrollBody);
const sessionSlot = makeElement();
sessionSlot.setAttribute("data-slot", "conversation.session");
scrollBody.appendChild(sessionSlot);

document.querySelector = (selector) => {
	if (selector === '[data-slot="conversation"]') return conversationSlot;
	if (selector === '[data-slot="conversation.session"]') return sessionSlot;
	return null;
};

const observers = [];
class FakeObserver {
	constructor(callback) {
		this.callback = callback;
		this.observed = new Set();
		this.disconnected = false;
		observers.push(this);
	}
	observe(node) { this.observed.add(node); }
	unobserve(node) { this.observed.delete(node); }
	disconnect() { this.disconnected = true; this.observed.clear(); }
}

const windowListeners = new Map();
let nextFrame = 0;
const frames = new Map();
const window = {
	__ModuleLoader__: { load: (entry) => { window.entry = entry; } },
	addEventListener: (type, handler) => {
		const entries = windowListeners.get(type) ?? [];
		entries.push(handler);
		windowListeners.set(type, entries);
	},
	removeEventListener: (type, handler) => {
		windowListeners.set(type, (windowListeners.get(type) ?? []).filter((entry) => entry !== handler));
	},
	requestAnimationFrame: (callback) => {
		const id = ++nextFrame;
		frames.set(id, callback);
		return id;
	},
	cancelAnimationFrame: (id) => { frames.delete(id); },
};

function flushFrames() {
	for (const [id, callback] of [...frames]) {
		frames.delete(id);
		callback();
	}
}

const registrations = [];
const effectDisposers = [];
const localeCalls = [];
let localeDisposals = 0;
let snapshotOverride;
const stateUpdates = [];
const react = {
	createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
	useSyncExternalStore: (_subscribe, getSnapshot) => snapshotOverride ?? getSnapshot(),
	useState: (initial) => [initial, (next) => { stateUpdates.push(next); }],
};
const context = {
	window,
	document,
	console: { error: () => {} },
	ResizeObserver: FakeObserver,
	MutationObserver: FakeObserver,
	require: (name) => {
		if (name === "react") return react;
		if (name === "jxl-brand") return { mountLoading: () => () => {} };
		throw new Error(`unexpected module: ${name}`);
	},
};

const script = new vm.Script(source, {
	filename: "client.js",
	importModuleDynamically: () => new Promise(() => {}),
});
script.runInNewContext(context);
assert.ok(window.entry, "the client bundle should register with the module loader");

const plugin = window.entry.factory(context.require);
plugin.apply({
	effect: (setup) => {
		const dispose = setup();
		effectDisposers.push(dispose);
		return () => { dispose?.(); };
	},
	slots: {
		inject: (_name, generator) => {
			for (const _dispose of generator()) {}
		},
		register: (options, component) => {
			registrations.push({ options, component });
			return () => {};
		},
	},
	locale: {
		register: (...args) => {
			localeCalls.push(args);
			return () => { localeDisposals += 1; };
		},
	},
});

assert.equal(windowListeners.get("mochi:close-campus")?.length ?? 0, 1, "close event is fiber-owned");
assert.equal(document.listeners.get("keydown")?.length ?? 0, 1, "Escape listener is fiber-owned");
assert.deepEqual(Array.from(plugin.inject), ["slots", "locale"], "the locale service is declared as a runtime dependency");
const workspaceLocale = localeCalls.find(([namespace, locale]) => namespace === "workspace" && locale === "zh-JXL");
assert.ok(workspaceLocale, "the exact official workspace namespace receives the Jiaxing locale entry");
assert.equal(workspaceLocale[2]["section.workspaces"], "任务", "the visual label is a real locale entry, not CSS replacement text");
assert.doesNotMatch(source, /bhn1Oq_sectionHeader|font-size:0|::before\{content:"任务"/u, "no hashed selector or pseudo text replaces the workspace label");

const overlayRegistration = registrations.find(({ options }) => options.name === "shell.overlay");
assert.ok(overlayRegistration, "the campus host should register through the official shell.overlay slot");
const hostVNode = overlayRegistration.component();
const host = makeElement();
host.offsetParent = overlay;
overlay.appendChild(host);
hostVNode.props.ref(host);

const campusWorkRegistration = registrations.find(({ options }) => options.id === "jxl-campus-work");
assert.ok(campusWorkRegistration, "the five campus entries should be a single official footer-slot group");
assert.equal(registrations.filter(({ options }) => options.name === "sidebar.footer.action").length, 1, "the group does not create a sixth or duplicate footer action");

function flattenChildren(vnode) {
	return (vnode?.props?.children ?? []).flat(Infinity).filter(Boolean);
}

function findVNodes(vnode, predicate, found = []) {
	if (!vnode || typeof vnode !== "object") return found;
	if (predicate(vnode)) found.push(vnode);
	for (const child of flattenChildren(vnode)) findVNodes(child, predicate, found);
	return found;
}

function renderCampusEntries({ wide = true, snapshot } = {}) {
	snapshotOverride = snapshot;
	const group = campusWorkRegistration.component({ wide });
	const entryComponents = findVNodes(group, (vnode) => typeof vnode.type === "function" && vnode.type.name === "WidgetEntry");
	const buttons = entryComponents.map((entry) => entry.type(entry.props));
	snapshotOverride = undefined;
	return { group, entryComponents, buttons };
}

const initialCampus = renderCampusEntries();
assert.equal(initialCampus.entryComponents.length, 5, "the campus group contains exactly the five approved entries");
const groupHeader = findVNodes(initialCampus.group, (vnode) => vnode.type === "button" && vnode.props.className === "jxl-campus-group__toggle")[0];
assert.ok(groupHeader, "wide sidebar exposes an accessible campus-work disclosure");
assert.equal(groupHeader.props["aria-expanded"], true);
assert.equal(groupHeader.props["aria-controls"], "jxl-campus-work-links");
groupHeader.props.onClick();
assert.equal(stateUpdates.at(-1), false, "the disclosure requests a true collapsed state");
const initialLinks = findVNodes(initialCampus.group, (vnode) => vnode.props?.id === "jxl-campus-work-links")[0];
assert.equal(initialLinks.props.role, "group");
assert.equal(initialLinks.props["aria-label"], "校园工作入口");
assert.match(
	source,
	/\.jxl-campus-group__links\[hidden\]\{display:none !important;\}/u,
	"a collapsed group forces display:none, so the footer flex rule cannot leave its rows visible",
);
assert.equal(initialCampus.buttons.every((button) => button.props["data-state"] === "idle"), true, "all entries begin idle");
assert.deepEqual(
	initialCampus.buttons.map((button) => button.props.children[0].props.name),
	["clipboard-check", "arrow-left-right", "messages-square", "contact-round", "chart-no-axes-combined"],
	"the five approved capabilities use distinct semantic Lucide-derived icons",
);
const railCampus = renderCampusEntries({ wide: false });
assert.match(railCampus.group.props.className, /is-rail/u, "the official wide owner prop selects the compact rail presentation");
assert.equal(findVNodes(railCampus.group, (vnode) => vnode.type === "button" && vnode.props.className === "jxl-campus-group__toggle").length, 0, "the rail has no hidden duplicate group toggle");
assert.equal(railCampus.buttons.length, 5, "all five capabilities remain reachable in the rail");

const dashboardButton = initialCampus.buttons[0];
dashboardButton.props.onClick();

assert.equal(host.style.left, "280px", "host starts at the native conversation column, not the sidebar");
assert.equal(host.style.top, "76px", "host begins below the native header tabs");
assert.equal(host.style.width, "820px");
assert.equal(host.style.height, "738px");
assert.equal(host.children.length, 1, "opening the sidebar action mounts one campus panel");
assert.equal(conversationRoot.listenerCount("click"), 1, "native view return is scoped to the conversation root");

const bootingCampus = renderCampusEntries();
const bootingDashboard = bootingCampus.buttons[0];
assert.match(bootingDashboard.props.className, /is-active is-booting/u, "the selected state remains visible while the widget boots");
assert.equal(bootingDashboard.props["aria-current"], "page");
assert.match(bootingDashboard.props["aria-label"], /正在打开/u);
for (const [phase, copy] of [["failed", "加载失败"], ["live", "当前已打开"]]) {
	const stateCampus = renderCampusEntries({ snapshot: phase + ":dashboard" });
	const stateButton = stateCampus.buttons[0];
	assert.match(stateButton.props.className, new RegExp("is-active is-" + phase), "the selected state remains visible for " + phase);
	assert.equal(stateButton.props["aria-current"], "page");
	assert.match(stateButton.props["aria-label"], new RegExp(copy));
}

conversationRoot.rect = { left: 56, top: 0, width: 511, height: 814 };
scrollBody.rect = { left: 56, top: 76, width: 511, height: 738 };
for (const observer of observers) observer.callback([]);
flushFrames();
assert.equal(host.style.left, "56px", "sidebar collapse recomputes the conversation boundary");
assert.equal(host.style.top, "76px", "sidebar resize still leaves the header tab strip uncovered");
assert.equal(host.style.width, "511px", "narrow conversation width is read from the native slot region");

conversationRoot.dispatch("click", nativeChatTab);
assert.equal(host.children.length, 0, "an already-selected native Chat tab closes the campus overlay");
assert.equal(conversationRoot.listenerCount("click"), 0, "closing removes the native tab listener");
assert.equal(windowListeners.get("resize")?.length ?? 0, 0, "closing removes geometry listeners");

dashboardButton.props.onClick();
assert.equal(host.children.length, 1, "the campus action can open again after native return");
const campusInternalTab = makeElement();
campusInternalTab.setAttribute("role", "tab");
host.children[0].appendChild(campusInternalTab);
conversationRoot.dispatch("click", campusInternalTab);
assert.equal(host.children.length, 1, "a campus-internal tab cannot trigger the native return handler");

hostVNode.props.ref(null);
assert.equal(host.children.length, 0, "overlay slot teardown closes the mounted panel");
assert.equal(conversationRoot.listenerCount("click"), 0, "overlay slot teardown removes the native tab listener");
assert.ok(observers.every((observer) => observer.disconnected), "overlay slot teardown disconnects theme and geometry observers");

for (const dispose of effectDisposers) dispose?.();
assert.equal(windowListeners.get("mochi:close-campus")?.length ?? 0, 0, "fiber teardown removes the close event listener");
assert.equal(document.listeners.get("keydown")?.length ?? 0, 0, "fiber teardown removes the Escape listener");
assert.equal(localeDisposals, 1, "fiber teardown removes the workspace locale contribution");

console.log("jxl-campus navigation test passed: official overlay bounds, grouped sidebar states, locale copy, native tab return, and cleanup");
