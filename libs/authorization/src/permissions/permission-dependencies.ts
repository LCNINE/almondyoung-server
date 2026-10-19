import { PERMISSION_CATALOG } from './permission-catalog';
import type { PermissionDefinition } from './permission.types';

/**
 * 권한 의존 — 역할 편집 화면(켤 때 위로, 끌 때 아래로)과 user-service 의 저장 검증이 같은 함수를 쓴다.
 */
const BY_KEY: ReadonlyMap<string, PermissionDefinition> = new Map(PERMISSION_CATALOG.map((p) => [p.key, p]));

function sameTargetRead(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3 || parts[2] === 'read') return null;
  const read = `${parts[0]}.${parts[1]}.read`;
  return BY_KEY.has(read) ? read : null;
}

export function directRequirements(key: string): readonly string[] {
  const def = BY_KEY.get(key);
  if (!def) return [];
  const read = sameTargetRead(key);
  return [...new Set([...(read ? [read] : []), ...def.requires])];
}

export function missingRequirements(keys: Iterable<string>): { key: string; requires: string }[] {
  const held = new Set(keys);
  const missing: { key: string; requires: string }[] = [];
  for (const key of held) {
    for (const requires of directRequirements(key)) if (!held.has(requires)) missing.push({ key, requires });
  }
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return missing.sort((a, b) => order(a.key, b.key) || order(a.requires, b.requires));
}

export function withRequirements(keys: Iterable<string>): Set<string> {
  const out = new Set(keys);
  const queue = [...out];
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    for (const requires of directRequirements(key)) {
      if (!out.has(requires)) {
        out.add(requires);
        queue.push(requires);
      }
    }
  }
  return out;
}

/** `removed` 를 끄고, 그것에 (거쳐서라도) 기대는 것만 함께 끈다 — 이번 조작과 무관한 기존 누락은 건드리지 않는다. */
export function withoutDependents(keys: Iterable<string>, removed: string): Set<string> {
  const out = new Set(keys);
  out.delete(removed);
  const gone = new Set([removed]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const key of [...out]) {
      if (directRequirements(key).some((r) => gone.has(r))) {
        out.delete(key);
        gone.add(key);
        changed = true;
      }
    }
  }
  return out;
}
