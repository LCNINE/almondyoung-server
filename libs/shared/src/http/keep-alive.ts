import { Server } from 'http';

/**
 * AWS Application/Classic Load Balancer 의 기본 idle timeout (초 단위 60s).
 * Node HTTP 서버의 keep-alive 는 이 값보다 길어야 ALB 가 재사용하려는 idle
 * 커넥션을 Node 가 먼저 닫아 RST 가 나는 race (간헐적 502) 를 피한다.
 */
export const ALB_IDLE_TIMEOUT_MS = 60_000;

/**
 * Node HTTP 서버의 keep-alive 를 ALB idle timeout 보다 길게 맞춘다.
 * ALB 뒤에 뜨는 Express 기반 서비스 의 간헐적 502 (connection-reuse race) 방지용.
 */
export function applyAlbKeepAlive(server: Server): void {
  server.keepAliveTimeout = 65_000;
  // headersTimeout 은 keepAliveTimeout 보다 커야 한다 — 안 그러면 Node 가 헤더를
  // 다 받기 전에 keep-alive 소켓을 닫아 같은 race 를 다시 만든다.
  server.headersTimeout = 66_000;
}
