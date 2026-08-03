import type { ConflictDecisionMap, ConflictMap } from './bulk-session.types';

/**
 * 충돌 판정을 한 곳에 모은다.
 *
 * 승인 가드(`BulkSessionManager.approve`)와 목록 필터(`BulkSessionReader.getItems`)가
 * **같은** 술어를 써야 한다. 복사본이 생기면 "목록에는 미결정이 안 보이는데 승인은
 * 409" 같은 상태가 만들어진다.
 *
 * `toConflictMap`/`toConflictDecisionMap` 은 `bulk-session.reader.ts` 에 있던 것을 그대로
 * 옮겼다 — 동작을 바꾸지 않는 순수 이동이다(시그니처·본문·주석 동일). 리더는 여기서
 * 다시 import 해 재export 한다(외부 소비자, 예: `bulk-session-job.manager.ts` 가 그대로
 * `./bulk-session.reader` 에서 import 할 수 있어야 한다).
 */

export const CONFLICT_FILTER_VALUES = ['any', 'undecided'] as const;
export type ConflictFilter = (typeof CONFLICT_FILTER_VALUES)[number];

export function isConflictFilter(value: string): value is ConflictFilter {
  return (CONFLICT_FILTER_VALUES as readonly string[]).includes(value);
}

interface ConflictEntry {
  base: string;
  mine: string;
  current: string;
}

/**
 * conflict/conflictDecision 은 `.$type<>()` 없는 jsonb 라 drizzle 이 `unknown` 으로 돌려준다
 * — 런타임에 형태를 확인해야 한다. `bulk-session.types.ts` 의 `isBulkItemInput` 등과 같은
 * 관례: `as Partial<X>` 로 타입만 좁히고 실제 판정은 아래 typeof 로 한다.
 */
function isConflictEntry(value: unknown): value is ConflictEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<ConflictEntry>;
  return typeof v.base === 'string' && typeof v.mine === 'string' && typeof v.current === 'string';
}

/** jsonb 로 왕복한 conflict 열을 되살린다. 형태가 다르면(옛 코드가 쓴 값 등) 그 필드만 버린다. */
export function toConflictMap(value: unknown): ConflictMap {
  if (typeof value !== 'object' || value === null) return {};
  const out: ConflictMap = {};
  // `Object.entries(value)` 를 `value: object` 에 바로 쓰면 TS 가 색인 시그니처가 없는
  // 오버로드로 빠져 `[string, any][]` 가 된다(no-unsafe-assignment) — 위 isConflictEntry
  // 와 같은 근거로 한 번만 좁혀서 `Object.entries` 가 `[string, unknown][]` 오버로드를
  // 타게 한다.
  const record = value as Record<string, unknown>;
  for (const [field, entry] of Object.entries(record)) {
    if (isConflictEntry(entry)) out[field] = entry;
  }
  return out;
}

/** jsonb 로 왕복한 conflictDecision 열을 되살린다. `overwrite`/`skip` 이 아닌 값은 버린다. */
export function toConflictDecisionMap(value: unknown): ConflictDecisionMap {
  if (typeof value !== 'object' || value === null) return {};
  const out: ConflictDecisionMap = {};
  // toConflictMap 과 같은 이유의 캐스팅 — Object.entries 가 unknown 오버로드를 타게 한다.
  const record = value as Record<string, unknown>;
  for (const [field, decision] of Object.entries(record)) {
    if (decision === 'overwrite' || decision === 'skip') out[field] = decision;
  }
  return out;
}

/** 이 행에서 아직 사람이 정하지 않은 충돌 **필드** 수. 행 수가 아니다. */
export function countUndecided(conflict: unknown, decision: unknown): number {
  const conflictMap = toConflictMap(conflict);
  const decisionMap = toConflictDecisionMap(decision);
  return Object.keys(conflictMap).filter((field) => !decisionMap[field]).length;
}

export function hasUndecided(conflict: unknown, decision: unknown): boolean {
  return countUndecided(conflict, decision) > 0;
}
