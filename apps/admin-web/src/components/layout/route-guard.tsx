import { getMyPermissions } from '@/lib/auth/my-permissions.server';
import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { canAccess, firstAccessiblePath, resolveScreenAccess } from '@/lib/auth/screen-access';
import { mainMenus } from '@/lib/utils/menu';
import { redirect } from 'next/navigation';
import { ForbiddenPanel, PermissionUnavailablePanel } from './forbidden-panel';

/**
 * 화면 진입 판정. 화면은 자기 경로(`screen`)만 넘기고, 필요한 권한은 경로 권한표가 정한다.
 * 화면 판정은 안내일 뿐 강제는 각 API 가 한다 — 여기서 막혀도 데이터는 백엔드가 지킨다.
 */
export default async function RouteGuard({ screen, children }: { screen: string; children: React.ReactNode }) {
  if (process.env.BYPASS_AUTH === 'true') return <>{children}</>;

  const access = resolveScreenAccess(screen);
  if (!access) throw new Error(`screen access is not declared: ${screen}`);
  if (access.kind === 'open') return <>{children}</>;
  if (access.kind === 'authenticated') {
    if (!(await getTokenPayload())) redirect('/login');
    return <>{children}</>;
  }

  const state = await getMyPermissions();
  if (state.state === 'unauthenticated') redirect('/login');
  if (state.state === 'unavailable') return <PermissionUnavailablePanel />;
  if (canAccess(access, state.permissions)) return <>{children}</>;
  if (screen === '/') {
    const first = firstAccessiblePath(mainMenus, state.permissions);
    if (first) redirect(first);
  }
  return <ForbiddenPanel required={access.anyOf} />;
}
