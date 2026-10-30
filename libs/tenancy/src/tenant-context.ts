/**
 * 지금 맥락(요청·메시지)의 테넌트를 싣는 CLS 키. 문이 맥락을 세우고(토큰·봉투), 이벤트 찍기·DB 선택·서비스 간
 * 헤더가 이 키 하나를 읽는다. 키가 없으면 «맥락 없음»이다 — 기본 테넌트로 채우지 않는다.
 */
export const TENANT_CONTEXT_KEY = 'tenancy.tenantId';
