/**
 * 권한 판정 낙인 — «이 요청은 이 라우트에서 이 권한으로 들어왔다»는 증표.
 *
 * 라우트 가드(`PermissionGuard`)만 남긴다. 낙인은 요청 객체를 키로 한 WeakMap 에 있고 발급한 객체만 인정하므로,
 * 본문·헤더·다른 라우트에서 같은 모양을 만들어도 통과로 보이지 않는다. 판정을 소비하는 서비스는 역할을 다시
 * 따지는 대신 이 낙인을 받는다 — 같은 서비스 메서드를 권한이 다른 라우트 둘이 부르는 곳에서 라우트의 구분을
 * 잃지 않는다.
 */
export interface PermissionDecision {
  readonly permission: string;
  readonly granted: true;
}

const stamps = new WeakMap<object, Map<string, PermissionDecision>>();
const issued = new WeakSet<object>();

export function recordPermissionDecisions(request: object, permissions: readonly string[]): void {
  if (permissions.length === 0) return;
  const held = stamps.get(request) ?? new Map<string, PermissionDecision>();
  for (const permission of permissions) {
    if (held.has(permission)) continue;
    const decision: PermissionDecision = Object.freeze({ permission, granted: true });
    issued.add(decision);
    held.set(permission, decision);
  }
  stamps.set(request, held);
}

export function getPermissionDecision(request: unknown, permission: string): PermissionDecision | undefined {
  if (typeof request !== 'object' || request === null) return undefined;
  return stamps.get(request)?.get(permission);
}

export function isPermissionDecision(value: unknown, permission: string): value is PermissionDecision {
  return (
    typeof value === 'object' &&
    value !== null &&
    issued.has(value) &&
    'permission' in value &&
    value.permission === permission
  );
}
