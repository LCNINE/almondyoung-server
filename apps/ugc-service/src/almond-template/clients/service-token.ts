import { sign } from 'jsonwebtoken';

/** 인쇄 파일을 올리고 받는 주체 id. file-service 의 업로드 소유자(uuid)로 남으므로 바꾸지 않는다. */
export const ALMOND_PRINT_SERVICE_SUBJECT = '00000000-0000-4000-8000-000000a1d001';

/**
 * 사람 없이 ugc 가 file-service 를 부르는 토큰(RFC 9068 서비스 단독 표기) — `client_id` 는 ugc, 받는 쪽은 file-service.
 * `tenant` 는 ugc 가 섬기는 테넌트(`OutboundTenant.tenantId()`) — file-service 가 그 테넌트 버킷에 쓴다. 없으면 싣지 않는다.
 */
// ponytail: 5분 상한 — 렌더+대기열이 5분을 넘으면 실패한다. 늘려야 하면 file-service 요청마다 발급할 것.
export function mintServiceToken(secret: string, tenant: string | undefined): string {
  return sign(
    { sub: ALMOND_PRINT_SERVICE_SUBJECT, client_id: 'ugc-service', aud: 'file-service', ...(tenant ? { tenant } : {}) },
    secret,
    { algorithm: 'HS256', expiresIn: '5m' },
  );
}
