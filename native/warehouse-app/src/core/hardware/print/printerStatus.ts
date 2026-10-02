/**
 * 마지막 출력 결과 — 스테이션 상태바의 «프린터» 칸(스펙 §5.5)이 읽는다.
 * 앱의 모든 출력은 `printRaw` 를 지나므로 거기서 적는다. 프린터 설정을 바꾸면 옛 결과는 의미가 없어 지운다.
 */
let lastFailed = false;
// 바뀔 때마다 오르는 판수 — 상태바는 이걸 useSyncExternalStore 의 스냅숏으로 쓴다. `lastFailed` 를 스냅숏으로 쓰면
// 프린터를 새로 설정할 때(false → false) 다시 그려지지 않아, 설정했는데도 «미설정» 빨강이 남는다.
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((listener) => listener());
};

export function reportPrintOutcome(ok: boolean): void {
  lastFailed = !ok;
  emit();
}

/** 프린터 설정이 바뀌었다 — 옛 실패를 지우고, 설정 여부를 다시 읽게 알린다. */
export function resetPrintOutcome(): void {
  lastFailed = false;
  emit();
}

export function subscribePrintOutcome(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function printerStatusVersion(): number {
  return version;
}

export function lastPrintFailed(): boolean {
  return lastFailed;
}
