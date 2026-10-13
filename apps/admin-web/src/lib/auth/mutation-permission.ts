import type { Permission } from '@permission-catalog';
import { permissionLabel } from './permission-labels';
import { canAny } from './screen-access';

/**
 * 쓰기 동작(뮤테이션 훅)에 필요한 권한. 목록 = 그중 하나, `allOf` = 묶음마다 하나씩 모두(여러 API 를 차례로 부르는 동작),
 * `'self'` = 로그인한 본인 계정 동작(내 정보·비밀번호·로그아웃).
 * 훅 선언 뒤에 `useX.permission = [...] as const satisfies PermissionRequirement;` 로 적는다 — 화면은 훅을 가리켜 판정한다.
 */
export type PermissionRequirement =
  | readonly Permission[]
  | { readonly allOf: readonly (readonly Permission[])[] }
  | 'self';

/** 판정에 필요한 모양만. 키 타입은 선언 쪽 `satisfies` 가 지킨다(게이트가 구문 트리에서 읽은 값도 같은 함수로 판정한다). */
export type RequirementShape = readonly string[] | { readonly allOf: readonly (readonly string[])[] } | 'self';

export interface PermissionedAction {
  readonly permission: PermissionRequirement;
}

declare module '@tanstack/react-query' {
  interface Register {
    /** 컴포넌트 안에서 바로 만든 뮤테이션의 권한 선언(훅으로 뺄 수 없는 곳) */
    mutationMeta: { readonly permission?: PermissionRequirement };
  }
}

function isAllOf<K extends string>(
  r: readonly K[] | { readonly allOf: readonly (readonly K[])[] },
): r is { readonly allOf: readonly (readonly K[])[] } {
  return 'allOf' in r;
}

export function requirementMet(held: ReadonlySet<string>, r: RequirementShape): boolean {
  if (r === 'self') return true;
  return isAllOf(r) ? r.allOf.every((group) => canAny(held, group)) : canAny(held, r);
}

export function requirementKeys(r: PermissionRequirement): Permission[] {
  if (r === 'self') return [];
  return isAllOf(r) ? r.allOf.flat() : [...r];
}

export function requirementMessage(r: PermissionRequirement): string {
  if (r === 'self') return '';
  if (isAllOf(r)) {
    return `이 작업에는 ${r.allOf.map((group) => group.map(permissionLabel).join(' 또는 ')).join(', ')} 권한이 모두 필요합니다.`;
  }
  return `이 작업에는 ${r.map(permissionLabel).join(' 또는 ')} 권한이 필요합니다.`;
}

/** 동작 여럿을 함께 요구할 때의 요구(전부 필요). 본인 동작만 있으면 `'self'`. */
export function combinedRequirement(actions: readonly PermissionedAction[]): PermissionRequirement {
  const groups = actions.flatMap((a): (readonly Permission[])[] => {
    const p = a.permission;
    if (p === 'self') return [];
    return isAllOf(p) ? [...p.allOf] : [p];
  });
  if (groups.length === 0) return 'self';
  return groups.length === 1 ? groups[0] : { allOf: groups };
}
