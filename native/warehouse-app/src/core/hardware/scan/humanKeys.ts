/**
 * 사람이 친 키를 스캐너 묶음과 가른다(스테이션 UI 스펙 §5.6). 스캐너는 글자를 수 ms 간격으로 몰아 보내고 Enter 로 끝낸다 —
 * 글자 하나가 혼자 들어오고 다음 키가 늦게 오면(또는 그만큼 시간이 지나면) 사람이 친 것이다.
 *
 * - 글자는 사람 것으로 확정될 때까지 미룬다(최대 maxInterKeyMs). 바로 다음 글자가 붙어 오면 둘 다 스캔이다
 * - 제어 키(HUMAN_CONTROL_KEYS)는 바로 낸다. 미뤄 둔 글자가 있으면 그것부터 내서 순서를 지킨다
 * - 스캔 묶음 뒤의 Enter 는 스캔의 끝이다 — 사람 Enter 로 내지 않는다(결품 창이 스캐너 Enter 로 확정되면 안 된다).
 *   글자 간격보다 늦어도(스캐너의 끝 지연·글자와 Enter 사이에 낀 긴 렌더) scanEndMaxMs 까지는 끝으로 본다 — 사람은
 *   묶음(≤ maxInterKeyMs)을 칠 수 없다. 그보다 늦으면 사람이 친 Enter 다
 * - 수정 키(Shift 등)는 통째로 무시한다. 스캐너가 대문자·기호에 Shift 를 끼워 보내므로, 제어 키로 다루면
 *   묶음 상태가 끊겨 끝 Enter 와 첫 글자가 사람 키로 샌다
 */
export const HUMAN_CONTROL_KEYS: ReadonlySet<string> = new Set([
  'Enter',
  'Backspace',
  'ArrowUp',
  'ArrowDown',
  'Escape',
]);

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'AltGraph',
]);

export function createHumanKeyDetector(opts: { maxInterKeyMs?: number; scanEndMaxMs?: number } = {}) {
  const maxInterKeyMs = opts.maxInterKeyMs ?? 50;
  const scanEndMaxMs = opts.scanEndMaxMs ?? 300;
  let lastAt = -Infinity;
  let pending: { key: string; at: number } | null = null;
  let burst = false;

  function reset() {
    lastAt = -Infinity;
    pending = null;
    burst = false;
  }

  function feed(key: string, at: number): string[] {
    if (MODIFIER_KEYS.has(key)) return [];
    const out: string[] = [];
    const fast = at - lastAt <= maxInterKeyMs;
    if (key.length === 1) {
      if (fast) {
        // 앞 글자에 바로 붙어 왔다 — 둘 다 스캐너 묶음이다
        pending = null;
        burst = true;
      } else {
        if (pending) out.push(pending.key);
        pending = { key, at };
        burst = false;
      }
      lastAt = at;
      return out;
    }
    const scanEnd = key === 'Enter' && burst && at - lastAt <= scanEndMaxMs;
    if (pending) out.push(pending.key);
    reset();
    if (!scanEnd && HUMAN_CONTROL_KEYS.has(key)) out.push(key);
    return out;
  }

  /** 미뤄 둔 글자가 확정될 만큼 시간이 지났으면 낸다 — 타이머가 부른다. */
  function flush(at: number): string[] {
    if (pending === null || at - pending.at <= maxInterKeyMs) return [];
    const { key } = pending;
    pending = null;
    return [key];
  }

  return { feed, flush, reset };
}
