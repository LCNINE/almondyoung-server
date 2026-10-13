/**
 * 사람이 아닌 내부 호출자(컨슈머·크론·서비스 위임). 판정 지점은 이 주체를 역할 이름이 아니라 «시스템»으로 본다.
 *
 * 브랜드는 모듈 안의 WeakSet 이다 — 같은 모양의 객체를 만들어도 시스템 주체가 되지 않는다.
 * 요청 본문·토큰에서 온 값으로는 만들 수 없고, 코드가 `systemPrincipal()` 을 불러야만 생긴다.
 */
export interface SystemPrincipal {
  readonly name: string;
}

export type AuthzSubject = { readonly roles: readonly string[] } | SystemPrincipal;

const issued = new WeakSet<object>();
const byName = new Map<string, SystemPrincipal>();

export function systemPrincipal(name: string): SystemPrincipal {
  const existing = byName.get(name);
  if (existing) return existing;
  const principal: SystemPrincipal = Object.freeze({ name });
  issued.add(principal);
  byName.set(name, principal);
  return principal;
}

export function isSystemPrincipal(value: unknown): value is SystemPrincipal {
  return typeof value === 'object' && value !== null && issued.has(value);
}
