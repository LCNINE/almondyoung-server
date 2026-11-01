import { getMyPermissions } from '@/lib/auth/my-permissions.server';
import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { canAccess, resolveScreenAccess } from '@/lib/auth/screen-access';
import { homeRedirect } from '@/lib/auth/landing';
import { mainMenus } from '@/lib/utils/menu';
import { chooseTenantLanding, isTenantShellScreen, TENANT_SHELL_MENU } from '@/lib/tenant-shell/allowlist';
import { getAdminSite } from '@/lib/tenant-shell/site.server';
import { notFound, redirect } from 'next/navigation';
import { ForbiddenPanel, PermissionUnavailablePanel } from './forbidden-panel';

/**
 * 화면 진입 판정. 화면은 자기 경로(`screen`)만 넘기고, 필요한 권한은 경로 권한표가 정한다.
 * 화면 판정은 안내일 뿐 강제는 각 API 가 한다 — 여기서 막혀도 데이터는 백엔드가 지킨다.
 */
export default async function RouteGuard({
  screen,
  children,
}: {
  screen: string;
  children: React.ReactNode;
}) {
  if (process.env.BYPASS_AUTH === 'true') return <>{children}</>;

  const access = resolveScreenAccess(screen);
  if (!access) throw new Error(`screen access is not declared: ${screen}`);

  // 테넌트 셸은 허용 목록 화면만 — 미들웨어가 먼저 404 를 내고, 여기는 그 매칭이 빠졌을 때의 둘째 줄이다. `/`(대시보드)는 그리지 않고
  // 첫 화면으로 보낸다.
  const site = await getAdminSite();
  if (site.kind === 'tenant') {
    if (screen === '/') {
      const state = await getMyPermissions();
      if (state.state === 'unauthenticated') redirect('/login');
      if (state.state === 'unavailable') return <PermissionUnavailablePanel />;
      const landing = chooseTenantLanding(state);
      if (landing) redirect(landing);
      return <ForbiddenPanel required={tenantMenuPermissions()} />;
    }
    if (!isTenantShellScreen(screen)) notFound();
  }

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
    const next = homeRedirect(state, mainMenus);
    if (next) redirect(next);
  }
  return <ForbiddenPanel required={access.anyOf} />;
}

/** 테넌트 셸 메뉴를 하나라도 여는 권한들 — 아무것도 못 여는 사람에게 무엇을 요청할지 보인다. */
function tenantMenuPermissions(): string[] {
  const keys = TENANT_SHELL_MENU.flatMap((group) =>
    group.items.flatMap((item) => {
      const access = resolveScreenAccess(item.path);
      return access?.kind === 'permission' ? access.anyOf : [];
    })
  );
  return [...new Set(keys)];
}
