/**
 * 파일을 «시스템»으로서 다룰 수 있는 서비스. 사람이 아니라 서비스가 부르는 토큰은 이 목록에 있을 때만 시스템으로 본다.
 * 토큰의 표기(`act`·`client_id`)는 누가 불렀는지를 적을 뿐이고, 근거는 내부 서명과 이 목록이다.
 */
export const TRUSTED_FILE_DELEGATES = ['core', 'ugc-service'] as const;
export type FileDelegate = (typeof TRUSTED_FILE_DELEGATES)[number];

const FILE_SERVICE_AUDIENCE = 'file-service';

/** 토큰에서 온 값 그대로 — 모양을 믿지 않고 여기서 좁힌다. */
export interface DelegationClaims {
  readonly roles?: unknown;
  readonly act?: unknown;
  readonly client_id?: unknown;
  readonly aud?: unknown;
}

/**
 * 서비스가 부른 토큰이면 어느 서비스인지 돌려준다. 사람 토큰(역할이 있는 토큰)은 늘 null 이다.
 *
 * 받는 쪽(`aud`)이 file-service 이고, 사람 대신 부르면 `act.sub`(RFC 8693), 사람 없이 부르면 `client_id`(RFC 9068).
 */
export function delegationOf(claims: DelegationClaims): FileDelegate | null {
  if (!withoutRoles(claims.roles) || !addressedToFileService(claims.aud)) return null;
  return trusted(actorOf(claims.act)) ?? trusted(claims.client_id) ?? null;
}

function withoutRoles(roles: unknown): boolean {
  return roles === undefined || roles === null || (Array.isArray(roles) && roles.length === 0);
}

function addressedToFileService(aud: unknown): boolean {
  return aud === FILE_SERVICE_AUDIENCE || (Array.isArray(aud) && aud.includes(FILE_SERVICE_AUDIENCE));
}

function actorOf(act: unknown): unknown {
  return typeof act === 'object' && act !== null && 'sub' in act ? act.sub : undefined;
}

function trusted(name: unknown): FileDelegate | undefined {
  return TRUSTED_FILE_DELEGATES.find((delegate) => delegate === name);
}
