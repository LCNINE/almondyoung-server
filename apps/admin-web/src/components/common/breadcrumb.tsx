/** @format */

'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

// 경로별 브레드크럼 매핑
const getBreadcrumbItems = (pathname: string): BreadcrumbItem[] => {
  // const segments = pathname.split('/').filter(Boolean);
  const items: BreadcrumbItem[] = [{ label: '홈', href: '/' }];

  // 발주처 관련 페이지들
  if (pathname.startsWith('/account/supplier')) {
    items.push({ label: '거래처관리', href: '/account/sales-channel' });
    items.push({ label: '발주처 관리', href: '/account/supplier' });

    if (pathname.includes('/register')) {
      items.push({ label: '발주처 등록' });
    } else if (pathname.includes('/edit/')) {
      items.push({ label: '발주처 수정' });
    }
  }
  // 판매처 관련 페이지들
  else if (pathname.startsWith('/account/sales-channel')) {
    items.push({ label: '거래처관리' });
    items.push({ label: '판매처 관리' });
  }

  // 고객 관련 페이지들
  else if (pathname.startsWith('/account/customer')) {
    items.push({ label: '거래처관리' });
    items.push({ label: '고객 관리' });
  }

  // 회사/조직 관련 페이지들
  else if (pathname.startsWith('/company/')) {
    items.push({ label: '회사/조직' });
    if (pathname.includes('/my-account')) {
      items.push({ label: '내 계정 정보' });
    }
  }
  // 주문/출고 관련 페이지들
  else if (pathname.startsWith('/order/')) {
    items.push({ label: '주문/출고관리' });
    if (pathname.includes('/history')) {
      items.push({ label: '주문내역 목록' });
    } else if (pathname.includes('/matching')) {
      items.push({ label: '매칭' });
    } else if (pathname.includes('/manual-single')) {
      items.push({ label: '주문입력 (수동/건별)' });
    } else if (pathname.includes('/manual-bulk')) {
      items.push({ label: '주문입력 (수동/대량)' });
    } else if (pathname.includes('/regional-invoice')) {
      items.push({ label: '지역별 출고' });
    } else if (pathname.includes('/regional-invoice')) {
      items.push({ label: '송장출력' });
    } else if (pathname.includes('/shipment-round')) {
      items.push({ label: '출고회차별조회' });
    } else if (pathname.includes('/picking-list')) {
      items.push({ label: '피킹리스트' });
    } else if (pathname.includes('/inspection')) {
      items.push({ label: '검수발송' });
    }
  }
  // 재고/상품 관련 페이지들
  else if (pathname.startsWith('/inventory/')) {
    items.push({ label: '재고&상품 관리' });
    if (pathname.includes('/status')) {
      items.push({ label: '재고 현황' });
    } else if (pathname.includes('/product-registration')) {
      items.push({ label: '상품 등록' });
    }
  }
  // CS 관련 페이지들
  else if (pathname.startsWith('/cs/')) {
    items.push({ label: 'CS' });
    if (pathname.includes('/management')) {
      items.push({ label: 'CS 목록' });
    } else if (pathname.includes('/return-exchange')) {
      items.push({ label: '반품&교환 관리' });
    }
  }
  // 자사몰 관련 페이지들
  else if (pathname.startsWith('/mall/')) {
    items.push({ label: '자사몰 관리' });
    if (pathname.includes('/settings')) {
      items.push({ label: '설정' });
    }
  }
  // 멤버십 관련 페이지들
  else if (pathname.startsWith('/membership/')) {
    items.push({ label: '멤버십 관리' });
  }

  return items;
};

export function Breadcrumb() {
  const pathname = usePathname();
  const items = getBreadcrumbItems(pathname);

  return (
    <nav className="flex items-center space-x-1 text-sm text-gray-500 my-4 px-4 ">
      {items.map((item, index) => (
        <div key={index} className="flex items-center">
          {index > 0 && <ChevronRight className="w-4 h-4 mx-1" />}
          {item.href ? (
            <Link
              href={item.href}
              className="hover:text-gray-700 transition-colors"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-gray-900 font-medium">{item.label}</span>
          )}
        </div>
      ))}
    </nav>
  );
}
