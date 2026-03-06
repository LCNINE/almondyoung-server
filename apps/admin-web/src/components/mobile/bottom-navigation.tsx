'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Home, Search, Package, List, Bell } from 'lucide-react';
import { LucideIcon } from 'lucide-react';

interface NavigationItem {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  badge?: number;
}

interface MobileBottomNavigationProps {
  currentPath?: string;
  onNavigate?: (path: string) => void;
}

const MOBILE_NAVIGATION_ITEMS: NavigationItem[] = [
  {
    id: 'home',
    label: '홈',
    icon: Home,
    path: '/mobile/schedule', // 홈은 스케줄 페이지로 매핑 (명백한 모바일 경로)
  },
  {
    id: 'search',
    label: '재고상품 검색',
    icon: Search,
    path: '/mobile/search', // 명백한 모바일 전용 페이지 경로
  },
  {
    id: 'inbound',
    label: '입/출고',
    icon: Package,
    path: '/mobile/inbound', // 명백한 모바일 전용 페이지 경로
  },
  {
    id: 'pick',
    label: '피킹리스트',
    icon: List,
    path: '/mobile/pick', // 명백한 모바일 전용 페이지 경로
  },
  {
    id: 'schedule',
    label: '알림',
    icon: Bell,
    path: '/mobile/invoice', // 알림은 invoice 페이지로 매핑 (명백한 모바일 경로)
    badge: 2,
  },
];

export default function MobileBottomNavigation({ 
  currentPath, 
  onNavigate 
}: MobileBottomNavigationProps) {
  const pathname = usePathname();
  const router = useRouter();
  
  // Use provided currentPath or fallback to usePathname
  const activePath = currentPath || pathname;
  
  const handleNavigate = (path: string) => {
    if (onNavigate) {
      onNavigate(path);
    } else {
      router.push(path);
    }
  };

  const isActive = (itemPath: string) => {
    // Exact match for specific pages
    if (activePath === itemPath) {
      return true;
    }
    // For pages with sub-routes, check if current path starts with item path
    if (activePath.startsWith(itemPath + '/')) {
      return true;
    }
    return false;
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-pb">
      <div className="flex items-center justify-around px-2 py-2">
        {MOBILE_NAVIGATION_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          
          return (
            <button
              key={item.id}
              onClick={() => handleNavigate(item.path)}
              className={`
                flex flex-col items-center justify-center min-w-0 flex-1 px-1 py-2 rounded-lg
                transition-colors duration-200 relative
                ${active 
                  ? 'text-blue-600 bg-blue-50' 
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }
              `}
              aria-label={item.label}
            >
              <div className="relative">
                <Icon 
                  size={20} 
                  className={`mb-1 ${active ? 'text-blue-600' : 'text-gray-600'}`} 
                />
                {item.badge && item.badge > 0 && (
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span className={`text-xs font-medium truncate max-w-full ${
                active ? 'text-blue-600' : 'text-gray-600'
              }`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export { MOBILE_NAVIGATION_ITEMS };
export type { NavigationItem, MobileBottomNavigationProps };