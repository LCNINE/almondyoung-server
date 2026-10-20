import type { MyPermissions } from './my-permissions';
import { canAccess, resolveScreenAccess } from './screen-access';

/**
 * 로그인 직후 목적지. 가려던 곳이 있으면 그곳, 기본 목적지(`/`)면 역할이 지정한 첫 화면.
 * 첫 화면은 그 사람이 열 수 있을 때만 — 아니면 지금처럼 `/`(권한이 없으면 거기서 첫 메뉴로 보낸다).
 */
export function chooseLanding(mine: MyPermissions, requested: string): string {
  if (requested !== '/' || !mine.landingPath) return requested;
  const access = resolveScreenAccess(mine.landingPath);
  if (
    !access ||
    access.kind !== 'permission' ||
    !canAccess(access, mine.permissions)
  )
    return requested;
  return mine.landingPath;
}
