export interface BreadcrumbItem {
  label: string;
  href?: string;
}

const mallProductBreadcrumbs = [
  { prefix: '/mall/products-list', label: '상품 목록' },
  { prefix: '/mall/product-registration', label: '상품 등록' },
  { prefix: '/mall/categories', label: '분류/카테고리' },
  { prefix: '/mall/tags', label: '태그' },
  { prefix: '/mall/channel-listings', label: '채널 노출 관리' },
  { prefix: '/mall/channel-categories', label: '채널 카테고리' },
  { prefix: '/mall/bulk', label: '일괄 작업' },
  { prefix: '/mall/csv', label: 'CSV 가져오기/내보내기' },
  { prefix: '/mall/audit', label: '감사 이력/승인' },
  { prefix: '/mall/digital-assets', label: '디지털 자산' },
  { prefix: '/mall/pricing', label: '가격 관리' },
];

function getMallProductBreadcrumbLabel(pathname: string): string | null {
  return (
    mallProductBreadcrumbs.find(
      ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )?.label ?? null
  );
}

// 경로별 브레드크럼 매핑
export const getBreadcrumbItems = (pathname: string): BreadcrumbItem[] => {
  const items: BreadcrumbItem[] = [{ label: '홈', href: '/' }];

  // 발주처 관련 페이지들
  if (pathname.startsWith('/account/supplier')) {
    items.push({ label: '채널/고객 관리', href: '/account/sales-channel' });
    items.push({ label: '발주처 관리', href: '/account/supplier' });

    if (pathname.includes('/register')) {
      items.push({ label: '발주처 등록' });
    } else if (pathname.includes('/edit/')) {
      items.push({ label: '발주처 수정' });
    }
  }
  // 판매처 관련 페이지들
  else if (pathname.startsWith('/account/sales-channel')) {
    items.push({ label: '채널/고객 관리' });
    items.push({ label: '판매처 관리' });
  }

  // 고객 관련 페이지들
  else if (pathname.startsWith('/account/customer')) {
    items.push({ label: '채널/고객 관리' });
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
  // 재고 관련 페이지들
  else if (pathname.startsWith('/inventory/')) {
    items.push({ label: '재고관리' });
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
  // 자사몰/상품 관련 페이지들
  else if (pathname.startsWith('/mall/')) {
    const productBreadcrumbLabel = getMallProductBreadcrumbLabel(pathname);

    if (productBreadcrumbLabel) {
      items.push({ label: '상품관리' });
      items.push({ label: productBreadcrumbLabel });
    } else {
      items.push({ label: '자사몰 관리' });
      if (pathname.includes('/settings')) {
        items.push({ label: '설정' });
      }
    }
  }
  // 멤버십 관련 페이지들
  else if (pathname.startsWith('/membership/')) {
    items.push({ label: '멤버십 관리' });
  }
  // 이벤트 추적 관련 페이지들
  else if (pathname.startsWith('/events/trace/')) {
    const parts = pathname.split('/').filter(Boolean);
    const resType = decodeURIComponent(parts[2] ?? '');
    const resId = decodeURIComponent(parts[3] ?? '');
    items.push({ label: '이벤트 추적', href: '/events/trace' });
    if (resType && resId) items.push({ label: `${resType} / ${resId}` });
  } else if (pathname === '/events/trace') {
    items.push({ label: '이벤트 추적' });
  }

  return items;
};
