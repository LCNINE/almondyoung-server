import { findPermission } from '@permission-catalog';

/** 요구 권한 키를 화면 이름으로. 목록에 없는 키는 키 그대로 보여 준다. */
export function permissionNames(keys: readonly string[]): string {
  return keys
    .map((key) => `‘${findPermission(key)?.label ?? key}’`)
    .join(' 또는 ');
}
