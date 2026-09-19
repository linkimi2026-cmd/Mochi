import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RailSurface } from "./protocol";
import type { RailPosition, RailPositionStore } from "./rail";

/**
 * [Mochi 2026-09-18] 常驻条位置记忆。
 *
 * 落盘位置由调用方给出（通常是该角色 userData 目录下的一个 JSON），因此教师端与
 * 教室端的位移互不影响——两个角色本来就各自一份 userData。
 *
 * 一律「失败即无记忆」而不是抛错：位置只是使用体验，老师拖动一次就好，
 * 绝不能因为一次坏写把应用启动搞挂。写入走 临时文件 + rename，避免断电/强杀
 * 留下半截 JSON 之后再也读不出来。
 */

const FILE_VERSION = 1;
const MAX_COORDINATE = 100_000;

interface StoredShape {
  version: number;
  positions: Partial<Record<RailSurface, RailPosition>>;
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}

function readPosition(value: unknown): RailPosition | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!isFiniteCoordinate(candidate.x) || !isFiniteCoordinate(candidate.y)) return null;
  return { x: Math.round(candidate.x), y: Math.round(candidate.y) };
}

function readStored(filePath: string): StoredShape {
  const empty: StoredShape = { version: FILE_VERSION, positions: {} };
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return empty;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return empty;
  const source = (parsed as Record<string, unknown>).positions;
  if (typeof source !== "object" || source === null || Array.isArray(source)) return empty;
  const positions: StoredShape["positions"] = {};
  for (const surface of ["teacher-rail", "classroom-board"] as const) {
    const position = readPosition((source as Record<string, unknown>)[surface]);
    if (position !== null) positions[surface] = position;
  }
  return { version: FILE_VERSION, positions };
}

export function createRailPositionStore(filePath: string): RailPositionStore {
  // 同一个进程里可能来回读，缓存在内存里即可；写的时候同步更新缓存。
  let cache: StoredShape | null = null;

  function load(): StoredShape {
    cache ??= readStored(filePath);
    return cache;
  }

  function persist(next: StoredShape): void {
    const payload = `${JSON.stringify(next)}\n`;
    const temporary = `${filePath}.tmp`;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(temporary, payload, "utf8");
      renameSync(temporary, filePath);
    } catch {
      // 磁盘只读、目录被占用等情况下一律降级为「本次会话内的记忆」，
      // 不向上报错，也不留下 .tmp 残骸影响下次启动。
    }
  }

  return {
    load(surface: RailSurface): RailPosition | null {
      return load().positions[surface] ?? null;
    },
    save(surface: RailSurface, position: RailPosition): void {
      const current = load();
      const previous = current.positions[surface];
      if (previous !== undefined && previous.x === position.x && previous.y === position.y) return;
      const next: StoredShape = {
        version: FILE_VERSION,
        positions: { ...current.positions, [surface]: position },
      };
      cache = next;
      persist(next);
    },
  };
}
