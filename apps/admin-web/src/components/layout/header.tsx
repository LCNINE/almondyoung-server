// src/components/layout/header.tsx
'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
import { MobileNav } from './mobile-nav';
import { useSignout } from '@/lib/services/auth';
import { useMe, useMyRoles } from '@/lib/services/users';
import { getFirstPagePath, mainMenus } from '@/lib/utils/menu';
import {
  BarChart3,
  Boxes,
  Building2,
  Crown,
  Headphones,
  Loader2,
  LogOut,
  Package,
  Settings,
  Store,
  User,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

const iconMap = {
  Users,
  Building2,
  Package,
  Boxes,
  Headphones,
  BarChart3,
  Store,
  Crown,
};

interface HeaderProps {
  activeMenu: string;
  activeItem?: string;
  onMenuChange: (menuId: string) => void;
}

export function Header({ activeMenu, activeItem, onMenuChange }: HeaderProps) {
  const router = useRouter();

  const { mutateAsync: signout, isPending: isSigningOut } = useSignout();

  const { data: me, isLoading: isMeLoading } = useMe();
  const { data: myRoles, isLoading: isMyRolesLoading } = useMyRoles();

  const isLoading = isMyRolesLoading;

  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 드롭다운 닫기 지연 함수
  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setHoveredMenu(null);
      setIsDropdownOpen(false);
    }, 300); // 300ms 지연
  };

  // 드롭다운 열기 함수
  const handleMouseEnter = (menuId: string) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setHoveredMenu(menuId);
    setIsDropdownOpen(true);
  };

  // 헤더 메뉴 클릭 시 첫 번째 페이지로 이동
  const handleMenuClick = (menuId: string) => {
    onMenuChange(menuId);
    const firstPath = getFirstPagePath(menuId);

    if (firstPath) {
      router.push(firstPath);
    }
  };

  // 드롭다운 아이템 클릭 시 해당 페이지로 이동
  const handleDropdownItemClick = (path: string, itemTitle: string) => {
    console.log('Dropdown item clicked:', itemTitle, path); // 디버깅용
    if (path) {
      router.push(path);
    }
  };

  // 로그아웃 처리
  const handleLogout = async () => {
    try {
      await signout(undefined, {
        onSuccess: () => {
          window.location.href = '/login';
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
    const roleName = myRoles?.roles[0].role.name;

    switch (roleName) {
      case 'MASTER':
        return '마스터 관리자';
      case 'ADMIN':
        return '관리자';
      default:
        return '사용자';
    }
  };

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <header className="bg-white border-b border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 lg:px-6 lg:py-4">
        {/* 햄버거 (모바일) */}
        <MobileNav
          activeMenu={activeMenu}
          activeItem={activeItem}
          onMenuChange={onMenuChange}
        />

        {/* 로고 */}
        <Link
          href="/"
          className="flex items-center mx-3 lg:mr-6 lg:mx-0 shrink-0"
        >
          <span className="text-lg font-bold tracking-tight text-blue-600">
            LCNINE
          </span>
        </Link>

        {/* 메인 메뉴 (데스크톱) */}
        <nav className="items-center flex-1 hidden space-x-3 lg:flex">
          {mainMenus.map((menu) => {
            const IconComponent = iconMap[menu.icon as keyof typeof iconMap];
            const isActive = activeMenu === menu.id;
            const isHovered = hoveredMenu === menu.id;

            return (
              <div
                key={menu.id}
                className="relative"
                onMouseEnter={() => handleMouseEnter(menu.id)}
                onMouseLeave={handleMouseLeave}
              >
                <Button
                  variant="ghost"
                  className={`text-sm px-4 py-2 transition-colors ${
                    isActive
                      ? 'text-blue-600 hover:text-blue-700'
                      : isHovered
                        ? 'text-blue-600 hover:text-blue-700'
                        : 'text-gray-600 hover:text-blue-600'
                  }`}
                  onClick={() => handleMenuClick(menu.id)}
                >
                  {IconComponent && <IconComponent className="w-4 h-4 mr-0" />}
                  {menu.title}
                </Button>

                {/* 호버 드롭다운 - 아코디언 형태 */}
                {isHovered && isDropdownOpen && (
                  <div
                    className="absolute left-0 z-50 mt-2 bg-white border border-gray-200 rounded-lg shadow-xl top-full w-96"
                    onMouseEnter={() => handleMouseEnter(menu.id)}
                    onMouseLeave={handleMouseLeave}
                  >
                    <div className="p-4">
                      <h3 className="mb-4 text-lg font-semibold text-gray-900">
                        {menu.title}
                      </h3>
                      <Accordion type="single" collapsible className="w-full">
                        {menu.children.map((item, index) => (
                          <AccordionItem
                            key={item.id}
                            value={`item-${index}`}
                            className="border-none"
                          >
                            <AccordionTrigger
                              className="py-3 px-0 hover:no-underline [&[data-state=open]>svg]:rotate-180"
                              onClick={() => {
                                // 아이템에 path가 있으면 바로 이동, 없으면 아코디언 토글
                                if (item.path) {
                                  handleDropdownItemClick(
                                    item.path,
                                    item.title
                                  );
                                }
                              }}
                            >
                              <div className="flex items-center justify-between w-full">
                                <div className="flex items-center">
                                  <div className="text-sm font-medium text-gray-900">
                                    {item.title}
                                  </div>
                                  {item.isComingSoon && (
                                    <span className="ml-2 text-xs text-gray-400">
                                      (준비중)
                                    </span>
                                  )}
                                </div>
                              </div>
                            </AccordionTrigger>
                            {item.children && item.children.length > 0 && (
                              <AccordionContent className="pb-2">
                                <div className="ml-4 space-y-1">
                                  {item.children.map((subItem) => (
                                    <div
                                      key={subItem.id}
                                      className="flex items-center p-2 rounded cursor-pointer hover:bg-gray-50"
                                      onClick={() =>
                                        subItem.path &&
                                        handleDropdownItemClick(
                                          subItem.path,
                                          subItem.title
                                        )
                                      }
                                    >
                                      <div className="text-xs text-gray-600">
                                        {subItem.title}
                                        {subItem.isComingSoon && (
                                          <span className="ml-1 text-gray-400">
                                            (준비중)
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </AccordionContent>
                            )}
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* 사용자 정보 */}
        <div className="flex items-center">
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
