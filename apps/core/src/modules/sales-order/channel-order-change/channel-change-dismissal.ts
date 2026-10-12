import type { RecordedChannelDelta } from './channel-order-change.types';

/**
 * #1016 6번 행 스펙 §6. 운영자가 «무시»한 차이와 똑같은 차이로는 pending 을 다시 띄우지 않는다.
 * core 는 이벤트마다 판매주문과 처음부터 다시 diff 하므로, 이 억제가 없으면 PIM 식별만 바뀐 해시
 * 변경이나 «다시 확인» 하나로 무시한 행이 그대로 되살아난다.
 */

const OUTSIDE_FINGERPRINT = new Set(['outcome', 'blockers']);

/** 키를 정렬한 JSON — jsonb 왕복은 키 순서를 보장하지 않는다. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 같은 차이 = 같은 지문. 막힌 사유·결과는 뺀다 — 그 사이 송장이 발급됐다고 다시 물을 이유가 없다. */
export function deltaFingerprint(delta: object): string {
  return canonical(Object.fromEntries(Object.entries(delta).filter(([key]) => !OUTSIDE_FINGERPRINT.has(key))));
}

function isPendingRecord(value: unknown): value is object {
  return value !== null && typeof value === 'object' && 'outcome' in value && value.outcome === 'pending';
}

/**
 * 이번 기록의 pending 델타가 **전부** 가장 최근 무시 행의 pending 델타 안에 있으면 pending 을 뺀다.
 * 하나라도 새것이면 그대로 둔다 — 새 pending 행이 이번 이벤트의 델타 전부를 담는다(스펙 §6.2).
 */
export function suppressDismissed(
  recorded: RecordedChannelDelta[],
  dismissedDeltas: readonly unknown[] | null,
): RecordedChannelDelta[] {
  if (!dismissedDeltas) return recorded;
  const pending = recorded.filter((delta) => delta.outcome === 'pending');
  if (pending.length === 0) return recorded;
  const dismissed = new Set(dismissedDeltas.filter(isPendingRecord).map(deltaFingerprint));
  const allDismissed = pending.every((delta) => dismissed.has(deltaFingerprint(delta)));
  return allDismissed ? recorded.filter((delta) => delta.outcome !== 'pending') : recorded;
}
