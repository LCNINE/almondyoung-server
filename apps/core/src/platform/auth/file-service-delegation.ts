import { sign } from 'jsonwebtoken';

/**
 * core 가 사람 대신 file-service 를 부를 때의 토큰(RFC 8693 위임 표기). `sub` 는 그 사람, `act.sub` 는 core,
 * 받는 쪽은 file-service 로 못박는다. 역할·스코프는 싣지 않는다 — file-service 는 내부 서명과 허용 서비스 목록으로만
 * 시스템 주체를 인정한다(`apps/file-service/src/access/service-delegation.ts`).
 */
export function signFileServiceDelegation(secret: string, onBehalfOf: string, expiresIn: '1m' | '5m'): string {
  return sign({ sub: onBehalfOf, act: { sub: 'core' }, aud: 'file-service' }, secret, {
    algorithm: 'HS256',
    expiresIn,
  });
}
