// src/components/layout/header.tsx
'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Link from 'next/link';
import { AssistantButton } from '@/features/assistant/components/assistant-button';
import { MobileNav } from './mobile-nav';
import { useSignout } from '@/lib/services/auth';
import { useMe, useMyRoles } from '@/lib/services/users';
import { Loader2, LogOut, User } from 'lucide-react';
import { toast } from 'sonner';

interface HeaderProps {
  activeMenu: string;
  activeItem?: string;
  onMenuChange: (menuId: string) => void;
  withSidebar: boolean;
}

export function Header({
  activeMenu,
  activeItem,
  onMenuChange,
  withSidebar,
}: HeaderProps) {
  const { mutateAsync: signout, isPending: isSigningOut } = useSignout();

  const { data: me, isLoading: isMeLoading } = useMe();
  const { data: myRoles, isLoading: isMyRolesLoading } = useMyRoles();

  const isLoading = isMyRolesLoading;

  // 로그아웃 처리
  const handleLogout = async () => {
    try {
      await signout(undefined, {
        onSuccess: (data: { redirectUrl?: string } | undefined) => {
          // IdP(auth-web) 세션까지 종료하려면 서버가 돌려준 end_session URL 로 이동해야 한다.
          // 여기서 /login 으로 바로 가면 auth-web 세션이 남아 자동 재로그인된다.
          window.location.href = data?.redirectUrl ?? '/login';
        },
        onError: (error) => {
          console.error('Logout failed:', error);
          toast.error('로그아웃에 실패했습니다.');
        },
      });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // 사용자 이름 추출 (이메일에서 @ 앞부분 또는 username 사용)
  const getUserDisplayName = () => {
    if (!me) return '사용자';
    return me.username || me.email?.split('@')[0] || me.loginId || '사용자';
  };

  // 사용자 역할 표시
  const getUserRole = () => {
    const roleName = myRoles?.roles?.[0]?.role?.name;

    switch (roleName) {
      case 'MASTER':
        return '마스터 관리자';
      case 'ADMIN':
        return '관리자';
      default:
        return '사용자';
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 lg:px-6 lg:py-2">
        {/* 햄버거 (모바일) */}
        <MobileNav
          activeMenu={activeMenu}
          activeItem={activeItem}
          onMenuChange={onMenuChange}
        />

        {/* 로고 */}
        <Link
          href="/"
          className={`flex items-center mx-3 lg:mr-6 lg:mx-0 shrink-0 ${withSidebar ? 'lg:hidden' : ''}`}
        >
          <span className="text-lg font-bold tracking-tight text-blue-600">
            LCNINE
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <AssistantButton />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                disabled={isSigningOut}
              >
                {isSigningOut ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Avatar className="w-8 h-8">
                    <AvatarImage src="/placeholder-avatar.jpg" />
                    <AvatarFallback className="text-sm text-blue-600 bg-blue-100">
                      {getUserDisplayName().charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5 text-sm">
                <div className="font-medium">{getUserDisplayName()}</div>
                <div className="text-xs text-gray-500">{getUserRole()}</div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <Link
                  href="/company/my-account"
                  className="flex items-center w-full gap-2"
                >
                  <User className="w-4 h-4 mr-2" />
                  프로필 설정
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600" onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
