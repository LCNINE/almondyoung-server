'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Home, Search, Package, List, Bell, Ruler } from 'lucide-react';
import { LucideIcon } from 'lucide-react';
import { MOBILE_SCREENS } from '@/lib/utils/mobile-menu';

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

// 경로·이름은 역할의 「로그인 첫 화면」 후보와 같이 쓰려고 MOBILE_SCREENS 에 둔다. 여기는 아이콘만 붙인다.
const ICONS: Record<string, LucideIcon> = {
  home: Home,
  search: Search,
  inbound: Package,
  pick: List,
  'sku-field-capture': Ruler,
  schedule: Bell,
};
const BADGES: Record<string, number> = { schedule: 2 };

const MOBILE_NAVIGATION_ITEMS: NavigationItem[] = MOBILE_SCREENS.map((s) => ({
  id: s.id,
  label: s.title,
  icon: ICONS[s.id] ?? Home,
  path: s.path,
  badge: BADGES[s.id],
}));

export default function MobileBottomNavigation({
  currentPath,
  onNavigate,
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
                ${
                  active
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
              <span
                className={`text-xs font-medium truncate max-w-full ${
                  active ? 'text-blue-600' : 'text-gray-600'
                }`}
              >
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
