import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ClassroomCallSpeech {
  text: string;
  messageId: string;
}

export type ClassroomCallSpeaker = (request: ClassroomCallSpeech) => void | boolean | "busy" | Promise<void | boolean | "busy">;

type DeliveryStage = "baseline" | "observed" | "attempted" | "queued" | "deferred";

interface DeliveryEntry {
  messageId: string;
  stage: DeliveryStage;
}

interface IdentityLedger {
  key: string;
  baseline: boolean;
  entries: DeliveryEntry[];
}

interface DeliveryStore {
  version: 1;
  identities: IdentityLedger[];
}

interface PublicIdentity {
  endpointId: string;
  role: "teacher" | "classroom";
  schoolId: string;
  classId?: string;
  displayName: string;
  fingerprint: string;
}

export interface ClassroomCallObservation {
  status: "ignored" | "baseline" | "unchanged" | "observed" | "storage-unavailable";
  handedOff: string[];
  attempted: string[];
}

const MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;
const MAX_IDENTITIES = 8;
const MAX_ENTRIES_PER_IDENTITY = 1_200;
const MAX_LAN_INBOX_ROWS = 1_000;
const MAX_HANDOFFS_PER_OBSERVATION = 20;
const IDENTITY_FIELDS = ["endpointId", "role", "schoolId", "classId", "displayName", "fingerprint"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identity(value: unknown, role?: PublicIdentity["role"]): PublicIdentity | null {
  if (!isRecord(value)) return null;
  if (typeof value.endpointId !== "string" || value.endpointId.length === 0
    || (value.role !== "teacher" && value.role !== "classroom")
    || typeof value.schoolId !== "string" || value.schoolId.length === 0
    || typeof value.displayName !== "string" || value.displayName.length === 0
    || typeof value.fingerprint !== "string" || value.fingerprint.length === 0
    || (value.classId !== undefined && (typeof value.classId !== "string" || value.classId.length === 0))
    || (role !== undefined && value.role !== role)) return null;
  return {
    endpointId: value.endpointId,
    role: value.role,
    schoolId: value.schoolId,
    ...(value.classId === undefined ? {} : { classId: value.classId as string }),
    displayName: value.displayName,
    fingerprint: value.fingerprint,
  };
}

function identityKey(value: PublicIdentity): string {
  const canonical = JSON.stringify(IDENTITY_FIELDS.map((field) => value[field] ?? null));
  return createHash("sha256").update(canonical).digest("hex");
}

function sameIdentity(left: PublicIdentity | null, right: PublicIdentity | null): boolean {
  return left !== null && right !== null
    && IDENTITY_FIELDS.every((field) => (left[field] ?? null) === (right[field] ?? null));
}

function validStore(value: unknown): value is DeliveryStore {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.identities)
    || value.identities.length > MAX_IDENTITIES) return false;
  return value.identities.every((row) => isRecord(row)
    && typeof row.key === "string" && /^[a-f0-9]{64}$/u.test(row.key)
    && typeof row.baseline === "boolean"
    && Array.isArray(row.entries) && row.entries.length <= MAX_ENTRIES_PER_IDENTITY
    && row.entries.every((entry) => isRecord(entry)
      && typeof entry.messageId === "string" && MESSAGE_ID.test(entry.messageId)
      && ["baseline", "observed", "attempted", "queued", "deferred"].includes(String(entry.stage)))
    && new Set(row.entries.map((entry) => (entry as DeliveryEntry).messageId)).size === row.entries.length);
}

function readStore(dataPath: string): { store: DeliveryStore; available: boolean } {
  const empty: DeliveryStore = { version: 1, identities: [] };
  if (!existsSync(dataPath)) return { store: empty, available: true };
  try {
    const parsed: unknown = JSON.parse(readFileSync(dataPath, "utf8"));
    return validStore(parsed) ? { store: parsed, available: true } : { store: empty, available: false };
  } catch {
    return { store: empty, available: false };
  }
}

function writeStore(dataPath: string, store: DeliveryStore): boolean {
  const temporaryPath = `${dataPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(dataPath), { recursive: true });
    writeFileSync(temporaryPath, JSON.stringify(store), { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, dataPath);
    return true;
  } catch {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The delivery stays unspoken if persistence fails.
    }
    return false;
  }
}

function isPrintableText(value: unknown, maximum: number): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.normalize("NFC");
  for (const character of normalized) {
    const point = character.codePointAt(0);
    if (point !== undefined && (point < 32 || (point >= 127 && point <= 159))) return false;
  }
  return normalized.trim().length <= maximum;
}

function speechForApprovedCallNote(student: string, note: unknown): string {
  if (!isPrintableText(note, 200)) return `${student}，请查看教室屏幕上的老师通知。`;
  // mochi_call_student appends `。` only when instruction is absent. With an
  // instruction its exact serialized note ends at the instruction text.
  const match = /^请(?:于(?<when>[^到；。]{1,40}))?到(?<location>[^；。]{1,80})(?:；(?<instruction>[^。]{1,80})|。)$/u.exec(note);
  if (!match?.groups || !match.groups.location) return `${student}，请查看教室屏幕上的老师通知。`;
  const when = match.groups.when ? `于${match.groups.when}` : "";
  return `${student}，请${when}到${match.groups.location}。`;
}

function inboxRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function messageId(value: unknown): string | null {
  return typeof value === "string" && MESSAGE_ID.test(value) ? value : null;
}

function findCurrentTeacherPeer(snapshot: Record<string, unknown>, sender: PublicIdentity): PublicIdentity | null {
  if (!Array.isArray(snapshot.peers)) return null;
  for (const candidate of snapshot.peers) {
    if (!isRecord(candidate) || candidate.blocked !== false) continue;
    const peer = identity(candidate, "teacher");
    if (peer && sameIdentity(peer, sender) && peer.schoolId === sender.schoolId) return peer;
  }
  return null;
}

function isSingleCall(row: Record<string, unknown>, sender: PublicIdentity): string | null {
  if (row.contentType !== "NOTIFY" || row.request !== undefined || row.response !== undefined
    || row.attachment !== undefined || !isRecord(row.directive)) return null;
  const directive = row.directive;
  if (Object.keys(directive).some((key) => key !== "item" && key !== "verdicts")
    || directive.item !== "老师叫号"
    || !Array.isArray(directive.verdicts) || directive.verdicts.length !== 1) return null;
  const verdict = directive.verdicts[0];
  if (!isRecord(verdict) || Object.keys(verdict).some((key) => !["student", "seat", "action", "note"].includes(key))
    || verdict.action !== "call" || !isPrintableText(verdict.student, 48)
    || (verdict.note !== undefined && !isPrintableText(verdict.note, 200))
    || (verdict.seat !== undefined && (!Number.isSafeInteger(verdict.seat) || Number(verdict.seat) < 1 || Number(verdict.seat) > 999))) return null;
  const student = verdict.student.trim();
  if (student.length === 0 || student.length > 48) return null;
  if (sender.role !== "teacher") return null;
  // The shared classroom is public. Only the approved student name and a fixed,
  // short phrase parsed from mochi_call_student's note template enter TTS. The
  // instruction tail and the message body may contain private text and are omitted.
  return speechForApprovedCallNote(student, verdict.note);
}

function approvedCallText(row: Record<string, unknown>, local: PublicIdentity, snapshot: Record<string, unknown>): string | null {
  const sender = identity(row.from, "teacher");
  const recipient = identity(row.recipient, "classroom");
  const peer = sender ? findCurrentTeacherPeer(snapshot, sender) : null;
  return sender && peer && recipient && sameIdentity(recipient, local) && recipient.schoolId === peer.schoolId
    ? isSingleCall(row, sender)
    : null;
}

function getLedger(store: DeliveryStore, key: string): IdentityLedger | undefined {
  return store.identities.find((ledger) => ledger.key === key);
}

function trimLedger(ledger: IdentityLedger, currentIds: ReadonlySet<string>): void {
  if (ledger.entries.length <= MAX_ENTRIES_PER_IDENTITY) return;
  const activeCount = ledger.entries.reduce((count, entry) => count + Number(currentIds.has(entry.messageId)), 0);
  const historyLimit = Math.max(0, MAX_ENTRIES_PER_IDENTITY - activeCount);
  const historicalIds = ledger.entries.filter((entry) => !currentIds.has(entry.messageId)).map((entry) => entry.messageId);
  const keepHistory = new Set(historyLimit === 0 ? [] : historicalIds.slice(-historyLimit));
  ledger.entries = ledger.entries.filter((entry) => currentIds.has(entry.messageId) || keepHistory.has(entry.messageId));
}

function rememberIdentity(store: DeliveryStore, ledger: IdentityLedger): void {
  store.identities = store.identities.filter((row) => row.key !== ledger.key);
  store.identities.push(ledger);
  if (store.identities.length > MAX_IDENTITIES) store.identities.splice(0, store.identities.length - MAX_IDENTITIES);
}

/**
 * Observe authenticated LAN snapshots for new, single-student teacher calls.
 * First snapshot for each local identity is a silent baseline so old inbox rows
 * never speak on startup. Delivery is marked attempted before the injected
 * speaker runs; callbacks receive messageId for their own idempotency. An
 * explicit "busy" means the callback definitely did not enqueue speech.
 * Those message ids stay deferred; void, false, or an exception is terminal.
 */
export function createClassroomCallObserver(dataPath: string, speak: ClassroomCallSpeaker) {
  const loaded = readStore(dataPath);
  let store = loaded.store;
  let storageAvailable = loaded.available;
  let activeIdentityKey: string | null = null;
  let pending: Promise<unknown> = Promise.resolve();

  async function observe(lanState: unknown): Promise<ClassroomCallObservation> {
    if (!storageAvailable) return { status: "storage-unavailable", handedOff: [], attempted: [] };
    if (!isRecord(lanState) || lanState.started !== true || lanState.configured !== true || lanState.lockedRole !== "classroom") {
      return { status: "ignored", handedOff: [], attempted: [] };
    }
    const local = identity(lanState.identity, "classroom");
    if (!local || typeof local.classId !== "string") return { status: "ignored", handedOff: [], attempted: [] };
    const rows = inboxRows(lanState.inbox);
    if (rows.length > MAX_LAN_INBOX_ROWS) return { status: "ignored", handedOff: [], attempted: [] };
    const currentIds = new Set(rows.map((row) => messageId(row.messageId)).filter((id): id is string => id !== null));
    const rowsById = new Map<string, Record<string, unknown> | null>();
    for (const row of rows) {
      const id = messageId(row.messageId);
      if (id === null) continue;
      rowsById.set(id, rowsById.has(id) ? null : row);
    }
    const key = identityKey(local);
    let ledger = getLedger(store, key);
    const known = new Set(ledger?.entries.map((entry) => entry.messageId) ?? []);

    if (activeIdentityKey !== key || !ledger?.baseline) {
      ledger ??= { key, baseline: true, entries: [] };
      ledger.baseline = true;
      // Startup is deliberately silent. A previous process may have marked an
      // item deferred after backpressure, but it must not speak from the backlog.
      for (const entry of ledger.entries) {
        if (entry.stage === "deferred") entry.stage = "attempted";
      }
      for (const row of rows) {
        const id = messageId(row.messageId);
        if (id !== null && !known.has(id)) {
          known.add(id);
          ledger.entries.push({ messageId: id, stage: "baseline" });
        }
      }
      trimLedger(ledger, currentIds);
      rememberIdentity(store, ledger);
      if (!writeStore(dataPath, store)) {
        storageAvailable = false;
        return { status: "storage-unavailable", handedOff: [], attempted: [] };
      }
      activeIdentityKey = key;
      return { status: "baseline", handedOff: [], attempted: [] };
    }

    const candidates: ClassroomCallSpeech[] = [];
    let added = false;

    // Deferred items are eligible only while their exact message remains in
    // the authenticated inbox and the same teacher is still an active peer.
    // Missing, duplicated, malformed, or revoked calls become terminal.
    for (const entry of ledger?.entries ?? []) {
      if (entry.stage !== "deferred") continue;
      const row = rowsById.get(entry.messageId);
      const text = row ? approvedCallText(row, local, lanState) : null;
      if (text === null) {
        entry.stage = "attempted";
        added = true;
        continue;
      }
      candidates.push({ text, messageId: entry.messageId });
    }

    for (const row of rows) {
      const id = messageId(row.messageId);
      if (id === null || known.has(id)) continue;
      known.add(id);
      const text = rowsById.get(id) ? approvedCallText(row, local, lanState) : null;
      ledger?.entries.push({ messageId: id, stage: text === null ? "observed" : "deferred" });
      if (text !== null) candidates.push({ text, messageId: id });
      added = true;
    }
    const handoffs = candidates.slice(0, MAX_HANDOFFS_PER_OBSERVATION);
    if (!added && handoffs.length === 0) return { status: "unchanged", handedOff: [], attempted: [] };
    for (const handoff of handoffs) {
      const entry = ledger?.entries.find((row) => row.messageId === handoff.messageId);
      if (entry) entry.stage = "attempted";
    }
    trimLedger(ledger, currentIds);
    rememberIdentity(store, ledger);
    if (!writeStore(dataPath, store)) {
      storageAvailable = false;
      return { status: "storage-unavailable", handedOff: [], attempted: [] };
    }

    const handedOff: string[] = [];
    const attempted: string[] = [];
    for (const handoff of handoffs) {
      attempted.push(handoff.messageId);
      try {
        const queued = await speak(handoff);
        if (queued === true) {
          const entry = ledger.entries.find((row) => row.messageId === handoff.messageId);
          if (entry) entry.stage = "queued";
          trimLedger(ledger, currentIds);
          rememberIdentity(store, ledger);
          if (!writeStore(dataPath, store)) storageAvailable = false;
          handedOff.push(handoff.messageId);
        } else if (queued === "busy") {
          const entry = ledger.entries.find((row) => row.messageId === handoff.messageId);
          if (entry) entry.stage = "deferred";
          trimLedger(ledger, currentIds);
          rememberIdentity(store, ledger);
          if (!writeStore(dataPath, store)) storageAvailable = false;
        }
      } catch {
        // The pre-call attempted marker intentionally prevents retries. A failed
        // or unknown handoff is surfaced separately from any heard/seen receipt.
      }
    }
    return { status: "observed", handedOff, attempted };
  }

  return {
    observe(lanState: unknown): Promise<ClassroomCallObservation> {
      const next = pending.then(() => observe(lanState));
      pending = next.catch(() => undefined);
      return next;
    },
  };
}
