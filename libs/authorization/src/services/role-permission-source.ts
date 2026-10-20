export interface RolePermissionSnapshot {
  readonly version: string;
  /** 역할 이름은 사람이 정한다 — 객체 키로 두면 `constructor` 같은 상속 속성과 겹친다. */
  readonly roles: ReadonlyMap<string, readonly string[]>;
}

export type SnapshotFetch =
  | { readonly status: 'not_modified' }
  | { readonly status: 'loaded'; readonly snapshot: RolePermissionSnapshot };

/** 역할별 권한을 어디서 받는가. 기본은 user-service HTTP, user-service 자신은 DB. */
export abstract class RolePermissionSource {
  abstract isConfigured(): boolean;
  /** knownVersion 과 같으면 not_modified. 실패는 throw. */
  abstract fetch(knownVersion: string | null): Promise<SnapshotFetch>;
}

/** 응답 본문을 검사하며 Map 으로 옮긴다. `JSON.parse` 결과의 자기 속성만 읽는다. */
export function parseSnapshot(body: unknown): RolePermissionSnapshot {
  if (typeof body !== 'object' || body === null || !('version' in body) || !('roles' in body)) {
    throw new Error('role-permissions body is malformed');
  }
  const { version, roles } = body;
  if (
    typeof version !== 'string' ||
    version === '' ||
    typeof roles !== 'object' ||
    roles === null ||
    Array.isArray(roles)
  ) {
    throw new Error('role-permissions body is malformed');
  }
  const byRole = new Map<string, readonly string[]>();
  for (const [role, keys] of Object.entries(roles)) {
    if (!Array.isArray(keys)) throw new Error('role-permissions entry for a role is not a list');
    const strings = keys.filter((key): key is string => typeof key === 'string');
    if (strings.length !== keys.length) throw new Error('role-permissions entry holds a non-string key');
    byRole.set(role, strings);
  }
  return { version, roles: byRole };
}
