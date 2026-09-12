import type { Session } from "electron";
import type {
  DoctorHostModelCheckCode,
  DoctorHostModelCheckResult,
  DoctorHostModelOutcome,
  DoctorHostModelProbe,
  DoctorHostModelProbeUnavailableReason,
  DoctorHostModelStatus,
} from "./doctor";

export const DOCTOR_HOST_MODEL_CHECK_PATH = "/api/mochi-doctor/check-model";
export const DOCTOR_HOST_MODEL_CHECK_VERSION = "mochi-doctor-model-check/v1";
export const DOCTOR_HOST_MODEL_SCOPE = "mochi-mimo";

const MAX_DOCTOR_RESPONSE_BYTES = 16 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const ACCEPTED_HTTP_STATUSES = new Set([200, 400, 409, 499]);

type DoctorHostSession = Pick<Session, "fetch">;
type AllowedOutcomeStatuses = Readonly<Record<string, DoctorHostModelStatus | undefined>>;

export interface DoctorHostClientConfig {
  /** A clean, currently-ready loopback origin. It never carries an auth token. */
  origin?: string;
  /** The same Electron session that loaded the authenticated official SPA. */
  session?: DoctorHostSession;
}

const MODEL_OUTCOME_STATUSES: AllowedOutcomeStatuses = {
  OK: "ok",
  INVALID_REQUEST: "unavailable",
  CHECK_IN_PROGRESS: "unavailable",
  PROVIDER_UNAVAILABLE: "unavailable",
  NO_MODEL: "unavailable",
  MISSING_CREDENTIAL: "unavailable",
  INVALID_CREDENTIAL: "error",
  AUTH_FAILED: "error",
  ACCOUNT_UNAVAILABLE: "unavailable",
  UPSTREAM_UNAVAILABLE: "unavailable",
  TIMEOUT: "unavailable",
  CANCELLED: "cancelled",
  UNKNOWN_FAILURE: "error",
};

const CREDENTIAL_OUTCOME_STATUSES: AllowedOutcomeStatuses = {
  OK: "ok",
  MISSING_CREDENTIAL: "unavailable",
  INVALID_CREDENTIAL: "error",
  AUTH_FAILED: "error",
  NOT_CHECKED: "not-checked",
};

class DoctorHostResponseTooLargeError extends Error {
  constructor() {
    super("doctor host response exceeded fixed limit");
    this.name = "DoctorHostResponseTooLargeError";
  }
}

function fixedUnavailable(reason: DoctorHostModelProbeUnavailableReason): DoctorHostModelCheckResult {
  return { kind: "unavailable", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseOutcome(value: unknown, allowedStatuses: AllowedOutcomeStatuses): DoctorHostModelOutcome | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["status", "code", "durationMs"])) return undefined;
  const { status, code, durationMs } = value;
  if (typeof status !== "string" || typeof code !== "string" || typeof durationMs !== "number") return undefined;
  const expectedStatus = allowedStatuses[code];
  if (expectedStatus === undefined || expectedStatus !== status) return undefined;
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 4_500) return undefined;
  return {
    status: expectedStatus,
    code: code as DoctorHostModelCheckCode,
    durationMs,
  };
}

function parseHostResult(value: unknown): Extract<DoctorHostModelCheckResult, { kind: "result" }> | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "scope", "model-service", "credentials"])) return undefined;
  if (value.version !== DOCTOR_HOST_MODEL_CHECK_VERSION || value.scope !== DOCTOR_HOST_MODEL_SCOPE) return undefined;
  const modelService = parseOutcome(value["model-service"], MODEL_OUTCOME_STATUSES);
  const credentials = parseOutcome(value.credentials, CREDENTIAL_OUTCOME_STATUSES);
  if (!modelService || !credentials) return undefined;
  return { kind: "result", modelService, credentials };
}

function endpointFor(origin: string | undefined): URL | undefined {
  if (!origin) return undefined;
  try {
    const base = new URL(origin);
    if (
      (base.protocol !== "http:" && base.protocol !== "https:")
      || !LOOPBACK_HOSTS.has(base.hostname)
      || base.username
      || base.password
      || base.pathname !== "/"
      || base.search
      || base.hash
    ) return undefined;
    return new URL(DOCTOR_HOST_MODEL_CHECK_PATH, base);
  } catch {
    return undefined;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("doctor host probe aborted");
}

function isJsonResponse(response: Response): boolean {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function readBoundedResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > MAX_DOCTOR_RESPONSE_BYTES) throw new DoctorHostResponseTooLargeError();
  }
  if (!response.body) throw new Error("doctor host response has no body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const cancelReader = () => { void reader.cancel(); };
  signal.addEventListener("abort", cancelReader, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      byteLength += value.byteLength;
      if (byteLength > MAX_DOCTOR_RESPONSE_BYTES) {
        void reader.cancel();
        throw new DoctorHostResponseTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }

  throwIfAborted(signal);
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
  } catch {
    throw new Error("doctor host response is not valid JSON");
  }
}

function matchesHttpStatus(status: number, result: Extract<DoctorHostModelCheckResult, { kind: "result" }>): boolean {
  if (status === 200) return true;
  if (status === 400) return result.modelService.code === "INVALID_REQUEST" && result.credentials.code === "NOT_CHECKED";
  if (status === 409) return result.modelService.code === "CHECK_IN_PROGRESS" && result.credentials.code === "NOT_CHECKED";
  return status === 499 && result.modelService.code === "CANCELLED" && result.credentials.code === "NOT_CHECKED";
}

/**
 * Creates one fixed-scope, same-session request callback for one Doctor run.
 * Callers must create it from the currently-ready host origin, rather than
 * retaining it across sidecar restarts or credential changes.
 */
export function createDoctorHostModelProbe(config: DoctorHostClientConfig): DoctorHostModelProbe {
  return async (signal) => {
    const endpoint = endpointFor(config.origin);
    if (!endpoint || !config.session) return fixedUnavailable("host-not-ready");
    try {
      throwIfAborted(signal);
      const response = await config.session.fetch(endpoint.toString(), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: "{}",
        credentials: "include",
        redirect: "manual",
        signal,
      });
      throwIfAborted(signal);

      if (response.status === 401) return fixedUnavailable("unauthenticated");
      if (response.status === 403) return fixedUnavailable("forbidden");
      if (response.status === 404) return fixedUnavailable("endpoint-missing");
      if (!ACCEPTED_HTTP_STATUSES.has(response.status) || !isJsonResponse(response)) {
        return fixedUnavailable("unexpected-response");
      }

      const parsed = parseHostResult(await readBoundedResponse(response, signal));
      if (!parsed || !matchesHttpStatus(response.status, parsed)) return fixedUnavailable("unexpected-response");
      return parsed;
    } catch (error) {
      if (signal.aborted) throw error;
      return fixedUnavailable(error instanceof DoctorHostResponseTooLargeError ? "response-too-large" : "request-failed");
    }
  };
}
