/**
 * JWT Payload Interface
 * AuthenticationService.validatePayload()가 반환하는 타입
 */
export interface JwtPayload {
  userId: string;
  email: string;
  roles: string[];
  scopes?: string[];
  /** 서비스 위임 토큰의 표기 — 값의 모양은 `access/service-delegation.ts` 가 좁힌다. */
  act?: unknown;
  client_id?: unknown;
  aud?: unknown;
  [key: string]: any; // 기타 payload 필드
}
