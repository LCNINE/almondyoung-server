import { missingRequirements } from '@app/authorization';
import { BadRequestError } from '@app/shared';
import { CUSTOMER_ROLE_NAMES, SYSTEM_ROLE_NAME } from '../iam.constants';
import { IamEscalationError, RoleNameTakenError } from '../iam.errors';

/** 역할 이름은 토큰에 실리는 식별자다 — 만들 때만 정하고 바꾸지 않는다. 화면엔 표시 이름을 쓴다. */
export const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]{1,49}$/;

export const isSystemRole = (name: string): boolean => name === SYSTEM_ROLE_NAME;
export const isCustomerRole = (name: string): boolean => CUSTOMER_ROLE_NAMES.includes(name);

export function assertRoleName(name: string): void {
  if (!ROLE_NAME_PATTERN.test(name)) {
    throw new BadRequestError('역할 ID는 영문 소문자로 시작하고 소문자·숫자·밑줄 2~50자여야 합니다.');
  }
  if (isSystemRole(name) || isCustomerRole(name)) {
    throw new RoleNameTakenError(`'${name}' 은(는) 예약된 역할 ID입니다.`);
  }
}

export interface PermissionState {
  readonly systemOnly: boolean;
  readonly deprecated: boolean;
}

const pairKey = (m: { key: string; requires: string }) => `${m.key}>${m.requires}`;

/**
 * 저장할 권한 집합의 형식 검증. 의존은 화면과 같은 함수로 본다 — 다만 이번 저장이 «새로 연» 누락만 막는다
 * (이미 있던 누락 때문에 무관한 저장까지 막지 않는다).
 */
export function assertPermissionSet(
  next: readonly string[],
  before: readonly string[],
  states: ReadonlyMap<string, PermissionState>,
): void {
  const had = new Set(before);
  const unknown = next.filter((key) => !states.has(key));
  if (unknown.length > 0) throw new BadRequestError(`없는 권한입니다: ${unknown.join(', ')}`);
  // 시스템 전용·폐기 권한은 «새로» 켜지 못한다. 카탈로그가 나중에 그렇게 바꾼 권한을 이미 가진 역할은
  // 그 권한을 지닌 채 다른 권한을 고칠 수 있다(화면 그리드엔 보이지 않으므로 끄라고 요구할 수도 없다).
  const systemOnly = next.filter((key) => states.get(key)?.systemOnly && !had.has(key));
  if (systemOnly.length > 0) throw new BadRequestError(`사람에게 줄 수 없는 권한입니다: ${systemOnly.join(', ')}`);
  const retiredNew = next.filter((key) => states.get(key)?.deprecated && !had.has(key));
  if (retiredNew.length > 0) {
    throw new BadRequestError(`더는 쓰지 않는 권한은 새로 켤 수 없습니다: ${retiredNew.join(', ')}`);
  }
  const old = new Set(missingRequirements(before).map(pairKey));
  const opened = missingRequirements(next).filter((m) => !old.has(pairKey(m)));
  if (opened.length > 0) {
    throw new BadRequestError(
      `함께 켜야 하는 조회 권한이 빠졌습니다: ${opened.map((m) => `${m.key} → ${m.requires}`).join(', ')}`,
    );
  }
}

/**
 * 권한 상승 방지 — 내가 가진 권한만 남에게 줄 수 있다. 폐기·시스템 전용 권한은 사람 누구도 갖지 않으므로
 * 묻지 않는다(새로 켜는 것은 assertPermissionSet 이 먼저 막는다).
 */
export function assertGrantable(
  actorPermissions: ReadonlySet<string>,
  wanted: Iterable<string>,
  states: ReadonlyMap<string, PermissionState>,
  message: string,
): void {
  const beyond = [...new Set(wanted)]
    .filter((key) => !states.get(key)?.deprecated && !states.get(key)?.systemOnly && !actorPermissions.has(key))
    .sort();
  if (beyond.length > 0) {
    throw new IamEscalationError(`${message} — 내가 가진 권한만 줄 수 있습니다: ${beyond.join(', ')}`);
  }
}
