/**
 * JWT Payload Interface
 * AuthenticationService.validatePayload()가 반환하는 타입
 */
export interface JwtPayload {
  userId: string;
  email: string;
  roles: string[];
  scopes?: string[];
  [key: string]: any;  // 기타 payload 필드
}
