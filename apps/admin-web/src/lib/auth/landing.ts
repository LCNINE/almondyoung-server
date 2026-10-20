import type { MyPermissions } from './my-permissions';
import type { MainMenu } from '../utils/menu';
import {
  canAccess,
  firstAccessiblePath,
  resolveScreenAccess,
} from './screen-access';

/**
 * 로그인 직후 목적지. 가려던 곳이 있으면 그곳, 기본 목적지(`/`)면 역할이 지정한 첫 화면.
 * 첫 화면은 그 사람이 열 수 있을 때만 — 아니면 지금처럼 `/`(권한이 없으면 거기서 첫 메뉴로 보낸다).
 */
export function chooseLanding(
  mine: Pick<MyPermissions, 'permissions' | 'landingPath'>,
  requested: string
): string {
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

/**
 * `/`(대시보드)를 못 여는 사람이 `/` 에 왔을 때 보낼 곳. 역할의 첫 화면을 먼저, 없거나 못 열면 사이드바 첫 메뉴.
 * 첫 화면은 로그인 콜백에서만 적용돼, 첫 비밀번호 변경 뒤처럼 `/` 로 들어오면 PC 메뉴로 갔다.
 */
export function homeRedirect(
  mine: Pick<MyPermissions, 'permissions' | 'landingPath'>,
  menus: readonly MainMenu[]
): string | null {
  const landing = chooseLanding(mine, '/');
  if (landing !== '/') return landing;
  return firstAccessiblePath(menus, mine.permissions);
}
