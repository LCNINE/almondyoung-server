/**
 * 파일을 «시스템»으로서 다룰 수 있는 서비스. 사람이 아니라 서비스가 부르는 토큰은 이 목록에 있을 때만 시스템으로 본다.
 * 토큰의 표기(`act`·`client_id`)는 누가 불렀는지를 적을 뿐이고, 근거는 내부 서명과 이 목록이다.
 */
export const TRUSTED_FILE_DELEGATES = ['core', 'ugc-service'] as const;
export type FileDelegate = (typeof TRUSTED_FILE_DELEGATES)[number];

const FILE_SERVICE_AUDIENCE = 'file-service';

/** 옛 표기(역할 없음 + `scopes:['master']`)에서 서비스를 고르는 `sub`. 나머지는 core 가 발급한 것이다. */
const LEGACY_UGC_SUBJECT = '00000000-0000-4000-8000-000000a1d001';

/** 토큰에서 온 값 그대로 — 모양을 믿지 않고 여기서 좁힌다. */
export interface DelegationClaims {
  readonly userId?: unknown;
  readonly roles?: unknown;
  readonly scopes?: unknown;
  readonly act?: unknown;
  readonly client_id?: unknown;
  readonly aud?: unknown;
}

export interface Delegation {
  readonly delegate: FileDelegate;
  readonly notation: 'standard' | 'legacy';
}

/**
 * 서비스가 부른 토큰이면 어느 서비스인지 돌려준다. 사람 토큰(역할이 있는 토큰)은 늘 null 이다.
 *
 * 새 표기: 받는 쪽(`aud`)이 file-service 이고, 사람 대신 부르면 `act.sub`(RFC 8693), 사람 없이 부르면 `client_id`(RFC 9068).
 * 옛 표기(역할 없음 + `scopes:['master']`)는 새 표기와 무관하게 예전 조건 그대로 읽는다 — 거절은 다음 단계에서 한다.
 */
export function delegationOf(claims: DelegationClaims): Delegation | null {
  if (!withoutRoles(claims.roles)) return null;
  const delegate = addressedToFileService(claims.aud)
    ? (trusted(actorOf(claims.act)) ?? trusted(claims.client_id))
    : undefined;
  if (delegate) return { delegate, notation: 'standard' };
  if (Array.isArray(claims.scopes) && claims.scopes.includes('master')) {
    return { delegate: claims.userId === LEGACY_UGC_SUBJECT ? 'ugc-service' : 'core', notation: 'legacy' };
  }
  return null;
}

/** 예전 판정 `(roles ?? []).length === 0` 과 같은 결과를 낸다 — 비정상 값에서도. */
function withoutRoles(roles: unknown): boolean {
  const value: unknown = roles ?? [];
  return typeof value === 'object' && value !== null && 'length' in value
    ? value.length === 0
    : typeof value === 'string' && value.length === 0;
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
