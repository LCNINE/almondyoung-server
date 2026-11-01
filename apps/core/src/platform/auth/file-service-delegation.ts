import { sign } from 'jsonwebtoken';

/**
 * core 가 사람 대신 file-service 를 부를 때의 토큰(RFC 8693 위임 표기). `sub` 는 그 사람, `act.sub` 는 core,
 * 받는 쪽은 file-service 로 못박는다. 역할·스코프는 싣지 않는다 — file-service 는 내부 서명과 허용 서비스 목록으로만
 * 시스템 주체를 인정한다(`apps/file-service/src/access/service-delegation.ts`).
 *
 * `tenant` 는 지금 맥락(요청·크론)의 테넌트다(`OutboundTenant.tenantId()`). file-service 는 그 테넌트의 버킷에 쓰고,
 * 위임의 예외도 그 테넌트 파일에만 연다. 맥락이 없으면(전환 배포 ① 만) 싣지 않는다 — 기본 테넌트로 채우지 않는다.
 */
export function signFileServiceDelegation(
  secret: string,
  onBehalfOf: string,
  expiresIn: '1m' | '5m',
  tenant: string | undefined,
): string {
  return sign({ sub: onBehalfOf, act: { sub: 'core' }, aud: 'file-service', ...tenantClaim(tenant) }, secret, {
    algorithm: 'HS256',
    expiresIn,
  });
}

/** file-service 토큰의 `tenant` 클레임. core 가 서명하는 file-service 토큰 둘(위임·`ownerToken`)이 같이 쓴다. */
export function tenantClaim(tenant: string | undefined): { tenant?: string } {
  return tenant ? { tenant } : {};
}
