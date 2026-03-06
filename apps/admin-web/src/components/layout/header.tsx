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
import { useSignout } from '@/lib/services/auth';
import { useMe, useMyRoles } from '@/lib/services/users';
import { getFirstPagePath, mainMenus } from '@/lib/utils/menu';
import {
  BarChart3,
  Boxes,
  Building2,
  ChevronDown,
  Crown,
  Headphones,
  Home,
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
  onMenuChange: (menuId: string) => void;
}

export function Header({ activeMenu, onMenuChange }: HeaderProps) {
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
    console.log('Header menu clicked:', menuId); // 디버깅용
    onMenuChange(menuId);
    const firstPath = getFirstPagePath(menuId);
    console.log('First path:', firstPath); // 디버깅용
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
      signout(undefined, {
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
      <div className="flex items-center justify-between px-6 py-4">
        {/* 로고 */}
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-bold text-gray-900">LCNINE</h1>
        </div>

        {/* 메인 메뉴 */}
        <nav className="flex items-center space-x-3">
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
                    className="absolute top-full left-0 mt-2 w-96 bg-white border border-gray-200 rounded-lg shadow-xl z-50"
                    onMouseEnter={() => handleMouseEnter(menu.id)}
                    onMouseLeave={handleMouseLeave}
                  >
                    <div className="p-4">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">
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
                                      className="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer"
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
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-700 hover:text-blue-600"
          >
            <Home className="w-4 h-4 mr-2" />홈
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center space-x-2 text-gray-700 hover:text-blue-600"
              >
                <Avatar className="w-8 h-8">
                  <AvatarImage src="/placeholder-avatar.jpg" />
                  <AvatarFallback className="bg-blue-100 text-blue-600">
                    {getUserDisplayName().charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="text-left">
                  {isSigningOut ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <div className="text-sm font-medium">
                        {getUserDisplayName()}
                      </div>
                      <div className="text-xs text-gray-500">
                        {getUserRole()}
                      </div>
                    </>
                  )}
                </div>
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                프로필 설정
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                계정 설정
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600" onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
