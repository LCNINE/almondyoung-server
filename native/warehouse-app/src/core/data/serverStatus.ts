/**
 * 마지막 요청이 서버에 닿았는가 — 스테이션 상태바의 «서버» 칸(스펙 §5.5).
 * 응답이 오면(4xx·5xx 여도) 닿은 것이고, fetch 자체가 던지면(네트워크·시간 초과) 못 닿은 것이다.
 * 이 파일은 루트 core 통합 스펙이 httpClient 를 통해 함께 불러온다 — 브라우저 전용 API 를 쓰지 말 것.
 */
export type ServerReach = 'unknown' | 'up' | 'down';

let reach: ServerReach = 'unknown';
const listeners = new Set<() => void>();

export function reportServerReach(next: 'up' | 'down'): void {
  if (reach === next) return;
  reach = next;
  listeners.forEach((listener) => listener());
}

export function subscribeServerReach(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentServerReach(): ServerReach {
  return reach;
}
