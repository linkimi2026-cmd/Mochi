/**
 * Parse timestamps emitted by D1. CURRENT_TIMESTAMP is UTC but SQLite returns
 * it without an offset; making that explicit keeps calendar-day decisions
 * stable across local development, Workers, and tests.
 */
export function parseStoredUtcDate(value: string | number | Date) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const text = String(value || "").trim();
  if (!text) return new Date(Number.NaN);
  const normalized = /^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  return new Date(normalized);
}

export function shanghaiDate(value: string | number | Date = Date.now()) {
  const instant = parseStoredUtcDate(value);
  if (!Number.isFinite(instant.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year || "0000"}-${values.month || "00"}-${values.day || "00"}`;
}

/**
 * Read the campus clock without parsing locale-formatted text.  `zh-CN` can
 * include a literal “时” in an hour-only formatter, which makes Number(...) a
 * NaN and silently falls through to the evening greeting.  Shanghai is UTC+8
 * year-round, so shifting the instant and reading UTC parts is deterministic
 * in browsers, Workers, tests, and the mini-program runtime.
 */
export function shanghaiClock(value: string | number | Date = Date.now()) {
  const instant = parseStoredUtcDate(value);
  const timestamp = instant.getTime();
  if (!Number.isFinite(timestamp)) return null;
  const shifted = new Date(timestamp + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

export function shanghaiHour(value: string | number | Date = Date.now()) {
  return shanghaiClock(value)?.hour ?? null;
}

export function shanghaiGreeting(value: string | number | Date = Date.now()) {
  const hour = shanghaiHour(value);
  if (hour === null || hour < 11) return "早安";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}
