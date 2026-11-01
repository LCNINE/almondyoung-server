'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Loader2, LogOut, Menu } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { usePermissions } from '@/hooks/use-permission';
import { canAccess, resolveScreenAccess } from '@/lib/auth/screen-access';
import { useTenantShellSignout } from '@/lib/services/auth/tenant-signout';
import { useMe } from '@/lib/services/users';
import { TENANT_SHELL_MENU, tenantShellScreenOf, type TenantShellMenuGroup } from '@/lib/tenant-shell/allowlist';
import { cn } from '@/lib/utils/ui';

/**
 * 테넌트 셸 — 테넌트 도메인에서만 뜨는 바깥 틀(사이드바·헤더·모바일 메뉴). 브랜드는 그 테넌트 이름·로고뿐이고, 메뉴는 허용 목록뿐이다.
 * 기존 셸의 검색·AI 버튼·프로필 설정 링크는 없다(목록 밖 화면이거나 테넌트 1 서비스다). 화면 본문은 기존 컴포넌트 그대로.
 * 이 폴더의 파일에는 아몬드영·LCNINE 문구가 없다(tenant-shell.gate.spec 이 센다).
 */
export function TenantShell({
  displayName,
  logoUrl,
  banner,
  children,
}: {
  displayName: string;
  logoUrl: string | null;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const menu = useVisibleMenu();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-svh w-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
        <div className="p-4">
          <Brand displayName={displayName} logoUrl={logoUrl} />
        </div>
        <MenuList menu={menu} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {banner}
        <header className="sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 lg:px-6 lg:py-2">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="메뉴 열기"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="mx-3 lg:hidden">
              <Brand displayName={displayName} logoUrl={logoUrl} />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <AccountMenu />
            </div>
          </div>
        </header>
        <main className="bg-white py-4">{children}</main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="flex w-72 flex-col p-0">
          <SheetTitle className="sr-only">메뉴</SheetTitle>
          <div className="border-b border-gray-100 px-4 py-4">
            <Brand displayName={displayName} logoUrl={logoUrl} />
          </div>
          <MenuList menu={menu} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Brand({ displayName, logoUrl }: { displayName: string; logoUrl: string | null }) {
  return (
    <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
      {logoUrl ? (
        // 테넌트 로고는 테넌트 행의 외부 주소다 — next/image 의 원격 허용 목록에 테넌트 도메인을 적지 않는다.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-7 w-7 rounded object-contain" />
      ) : null}
      <span className="truncate">{displayName}</span>
    </Link>
  );
}

/** 허용 목록 메뉴 중 이 사람이 열 수 있는 것 — 기존 셸과 같은 경로 권한표로 거른다. 권한을 받기 전엔 비워 둔다. */
function useVisibleMenu(): TenantShellMenuGroup[] {
  const { status, permissions } = usePermissions();
  if (status !== 'ready') return [];
  return TENANT_SHELL_MENU.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const access = resolveScreenAccess(item.path);
      return access !== undefined && canAccess(access, permissions);
    }),
  })).filter((group) => group.items.length > 0);
}

function MenuList({ menu, onNavigate }: { menu: TenantShellMenuGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = tenantShellScreenOf(pathname);
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
      {menu.map((group) => (
        <div key={group.title}>
          <div className="px-3 py-1 text-xs font-semibold text-gray-500">{group.title}</div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = current !== null && (current === item.path || current.startsWith(`${item.path}/`));
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={onNavigate}
                  className={cn(
                    'block rounded-md px-3 py-2 text-sm transition-colors',
                    active ? 'bg-blue-50 font-medium text-blue-600' : 'text-gray-700 hover:bg-gray-100'
                  )}
                >
                  {item.title}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function AccountMenu() {
  const { mutateAsync: signout, isPending } = useTenantShellSignout();
  const { data: me } = useMe();
  const { roles } = usePermissions();
  const name = me ? me.username || me.email?.split('@')[0] || me.loginId || '사용자' : '사용자';

  const logout = async () => {
    try {
      await signout(undefined, {
        // 이 테넌트의 auth-web 세션까지 끝내려면 서버가 돌려준 end_session 주소로 가야 한다.
        onSuccess: (data: { redirectUrl?: string } | undefined) => {
          window.location.href = data?.redirectUrl ?? '/login';
        },
        onError: () => toast.error('로그아웃에 실패했습니다.'),
      });
    } catch {
      // onError 가 알린다
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-gray-100 text-sm text-gray-700">{name.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5 text-sm">
          <div className="font-medium">{name}</div>
          <div className="text-xs text-gray-500">{roles.map((role) => role.displayName).join(', ') || '사용자'}</div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-red-600" onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
