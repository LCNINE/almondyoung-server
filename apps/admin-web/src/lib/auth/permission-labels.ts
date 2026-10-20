import { findPermission } from '@permission-catalog';

/** 권한 키 → 화면 이름. 목록에 없는 키는 키 그대로(지어내지 않는다). */
export function permissionLabel(key: string): string {
  return findPermission(key)?.label ?? key;
}

/** 403 안내 문구. 서버가 요구 권한을 알려 주면 그 이름으로, 아니면 서버 문구 그대로. */
export function permissionDeniedMessage(required: readonly string[], serverMessage: string): string {
  if (required.length === 0) return serverMessage;
  return `이 작업에는 ${required.map(permissionLabel).join(' 또는 ')} 권한이 필요합니다.`;
}

/** 강제 모드 403 본문(`requiredPermissions`)에서만 읽는다. 옛 가드 403 이면 빈 목록. */
export function readRequiredPermissions(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || !('requiredPermissions' in body)) return [];
  const value: unknown = body.requiredPermissions;
  if (!Array.isArray(value)) return [];
  return value.filter((key): key is string => typeof key === 'string');
}
