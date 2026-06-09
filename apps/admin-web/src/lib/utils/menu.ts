/** @format */

// src/lib/utils/menu.ts
export interface MenuItem {
  id: string;
  title: string;
  icon?: string;
  children?: MenuItem[];
  isComingSoon?: boolean;
  path?: string;
}

export interface MainMenu {
  id: string;
  title: string;
  icon: string;
  children: MenuItem[];
  defaultPath?: string; // 첫 번째 페이지 경로 추가
}

export const mainMenus: MainMenu[] = [
  {
    id: 'company',
    title: '회사/조직',
    icon: 'Users',
    defaultPath: '/company/my-account', // 첫 번째 페이지
    children: [
      {
        id: 'user-management',
        title: '사용자관리',
        children: [
          {
            id: 'my-account',
            title: '내 계정 정보',
            path: '/company/my-account',
            children: [
              { id: 'sub-users', title: '하부사용자 관리', isComingSoon: true },
              { id: 'attendance', title: '출퇴근', isComingSoon: true },
            ],
          },
          {
            id: 'admin-accounts',
            title: '관리자 계정',
            path: '/users',
          },
        ],
      },
      {
        id: 'management-support',
        title: '경영지원',
        children: [
          { id: 'operation-docs', title: '운영문서', isComingSoon: true },
          { id: 'resolutions', title: '결의서', isComingSoon: true },
          { id: 'leave-attendance', title: '휴가/근태', isComingSoon: true },
        ],
      },
      {
        id: 'environment-settings',
        title: '환경설정',
        children: [
          {
            id: 'menu-customize',
            title: '메뉴 커스터마이즈',
            isComingSoon: true,
          },
          {
            id: 'integration',
            title: 'OAuth 클라이언트',
            path: '/company/integrations/oauth-clients',
          },
        ],
      },
    ],
  },
  {
    id: 'account-management',
    title: '거래처관리',
    icon: 'Building2',
    defaultPath: '/account/sales-channel', // 첫 번째 페이지
    children: [
      {
        id: 'sales-channel',
        title: '판매처 관리(채널정보)',
        path: '/account/sales-channel',
        children: [
          {
            id: 'medusa-customers',
            title: '메두사 고객',
            path: '/account/sales-channel/medusa-customers',
          },
        ],
      },
      {
        id: 'customer',
        title: '고객 관리',
        children: [
          {
            id: 'customer-list',
            title: '고객 조회',
            path: '/account/customer',
          },
          { id: 'blacklist', title: '블랙리스트', path: '/account/blacklist' },
        ],
      },
    ],
  },
  {
    id: 'order-shipment',
    title: '주문/출고관리',
    icon: 'Package',
    defaultPath: '/order/history', // 첫 번째 페이지
    children: [
      {
        id: 'order-collection',
        title: '주문수집',
        children: [{ id: 'matching', title: '매칭', path: '/order/matching' }],
      },
      {
        id: 'order-input',
        title: '주문입력',
        children: [
          {
            id: 'manual-single',
            title: '주문입력 (수동/건별)',
            path: '/order/manual-single',
          },
          {
            id: 'manual-bulk',
            title: '주문입력 (수동/대량)',
            path: '/order/manual-bulk',
          },
          {
            id: 'fulfillment-manual',
            title: '출고주문 생성 (수동)',
            path: '/order/fulfillment-manual',
          },
        ],
      },
      {
        id: 'order-history',
        title: '주문내역 목록',
        path: '/order/history',
      },
      {
        id: 'shipment',
        title: '출고',
        children: [
          {
            id: 'fulfillments',
            title: '출고주문',
            path: '/order/fulfillments',
          },
          {
            id: 'regional-invoice',
            title: '(자체배송) 지역별 출고',
            path: '/order/regional-invoice',
          },
          {
            id: 'print-invoices-by-order',
            title: '주문별 송장 출력',
            path: '/order/print-invoices-by-order',
          },
          {
            id: 'shipment-round',
            title: '송장 출력 / 출고 회차별 조회',
            path: '/order/shipment-round',
          },
          {
            id: 'picking-list',
            title: '피킹리스트',
            path: '/order/picking-list',
          },
          {
            id: 'inspection-dispatch',
            title: '검수발송',
            path: '/order/inspection',
          },
          {
            id: 'fulfillments',
            title: 'FO 목록',
            path: '/order/fulfillments',
          },
          {
            id: 'outbound-batches',
            title: '출고 배치',
            path: '/order/outbound-batches',
          },
          {
            id: 'direct-ship',
            title: '직배송 운영',
            path: '/order/direct-ship',
          },
          {
            id: 'consolidation',
            title: '합포장 분석',
            path: '/order/consolidation',
          },
          {
            id: 'location-optimization',
            title: '위치 최적화',
            path: '/order/location-optimization',
          },
        ],
      },
      {
        id: 'sales-channel-shipment',
        title: '판매처 발송처리&현황',
        isComingSoon: true,
      },
    ],
  },
  {
    id: 'inventory-product',
    title: '재고&상품 관리',
    icon: 'Boxes',
    defaultPath: '/inventory/status', // 첫 번째 페이지
    children: [
      {
        id: 'inventory-status',
        title: '재고 현황',
        path: '/inventory/status',
      },
      {
        id: 'inventory-skus',
        title: 'SKU 마스터 관리',
        path: '/inventory/skus',
      },
      {
        id: 'inventory-sku-groups',
        title: 'SKU 그룹 관리',
        path: '/inventory/sku-groups',
      },
      {
        id: 'inventory-transfers',
        title: '재고 이동(잡)',
        path: '/inventory/transfers',
      },
      {
        id: 'inventory-movement',
        title: '재고 즉시 이동',
        path: '/inventory/movement',
      },
      {
        id: 'inventory-reservations',
        title: '재고 예약',
        path: '/inventory/reservations',
      },
      {
        id: 'inventory-stocktaking',
        title: '재고 실사',
        path: '/inventory/stocktaking',
      },
      {
        id: 'inventory-purchase-orders',
        title: '발주관리',
        path: '/inventory/purchase-orders',
      },
      {
        id: 'inventory-inbound',
        title: '입고 관리',
        path: '/inventory/inbound',
      },
      {
        id: 'inventory-suppliers',
        title: '공급처 관리',
        path: '/inventory/suppliers',
      },
      {
        id: 'inventory-supplier-categories',
        title: '공급처 분류',
        path: '/inventory/supplier-categories',
      },
      {
        id: 'inventory-locations',
        title: '로케이션 관리',
        path: '/inventory/locations',
      },
      {
        id: 'inventory-holders',
        title: '재고 소유자 관리',
        path: '/inventory/holders',
      },
      {
        id: 'inventory-returns',
        title: '회수/반품 처리',
        path: '/inventory/returns',
      },
      {
        id: 'product-matching',
        title: '상품 매칭',
        path: '/matching/products',
      },
      {
        id: 'variant-matching',
        title: '옵션 매칭',
        path: '/matching/variants',
      },
      {
        id: 'legacy-ignored-matching',
        title: '레거시 매칭 감사',
        path: '/matching/legacy-ignored',
      },
      {
        id: 'product-registration',
        title: '상품 등록',
        path: '/inventory/product-registration',
      },
      {
        id: 'purchase-order',
        title: '발주',
        children: [
          { id: 'domestic-po', title: '발주리스트 (국내)' },
          { id: 'overseas-po', title: '발주리스트 (해외)' },
          { id: 'create-po', title: '발주 생성' },
        ],
      },
      {
        id: 'product-inout',
        title: '상품 입출고',
        children: [
          { id: 'domestic-receiving', title: '입고리스트 (국내)' },
          { id: 'overseas-receiving', title: '입고리스트 (해외)' },
          { id: 'individual-inout', title: '개별 입/출고' },
        ],
      },
      {
        id: 'barcode-management',
        title: '바코드 관리',
        children: [
          { id: 'product-barcode', title: '상품 바코드' },
          { id: 'location-barcode', title: '위치 바코드' },
        ],
      },
    ],
  },
  {
    id: 'customer-service',
    title: 'CS',
    icon: 'Headphones',
    defaultPath: '/cs/management', // 첫 번째 페이지
    children: [
      {
        id: 'channel-talk',
        title: '실시간 채널톡',
        isComingSoon: true,
      },
      {
        id: 'cs-management',
        title: 'CS 목록',
        path: '/cs/management',
      },
      {
        id: 'return-exchange',
        title: '반품&교환 관리',
        path: '/cs/return-exchange',
      },
      {
        id: 'review-management',
        title: '리뷰 관리',
        path: '/cs/reviews',
      },
      {
        id: 'qna-management',
        title: 'Q&A관리',
        path: '/cs/qna',
      },
      {
        id: 'business-license-management',
        title: '사업자 인증 검토',
        path: '/cs/business-licenses',
      },
      {
        id: 'chatbot-settings',
        title: '챗봇 설정',
        isComingSoon: true,
      },
    ],
  },
  {
    id: 'sales-statistics',
    title: '판매/통계',
    icon: 'BarChart3',
    children: [
      {
        id: 'sales-status',
        title: '판매 현황',
        children: [
          { id: 'by-product', title: '상품별' },
          { id: 'by-option', title: '옵션별' },
          { id: 'by-period', title: '기간별' },
          { id: 'by-membership', title: '회원등급별' },
        ],
      },
      {
        id: 'analytics',
        title: '애널리틱스',
        children: [
          { id: 'customer-behavior', title: '고객 행동' },
          { id: 'conversion-rate', title: '전환율' },
        ],
      },
      {
        id: 'shipping-statistics',
        title: '배송 통계',
        children: [
          { id: 'combined-shipping', title: '합배송' },
          { id: 'wrong-shipping', title: '오배송' },
          { id: 'package-size', title: '택배 사이즈' },
        ],
      },
    ],
  },
  {
    id: 'own-mall',
    title: '자사몰 관리',
    icon: 'Store',
    defaultPath: '/mall/settings', // 첫 번째 페이지
    children: [
      {
        id: 'mall-selection',
        title: '쇼핑몰 선택',
        isComingSoon: true,
      },
      {
        id: 'products',
        title: '상품',
        children: [
          { id: 'product-dashboard', title: '대시보드' },
          { id: 'product-list', title: '목록', path: '/mall/products-list' },
          {
            id: 'product-registration',
            title: '등록',
            path: '/mall/product-registration',
          },
          {
            id: 'product-category',
            title: '분류/카테고리',
            path: '/mall/categories',
          },
          { id: 'product-tags', title: '태그', path: '/mall/tags' },
          {
            id: 'channel-listings',
            title: '채널 노출 관리',
            path: '/mall/channel-listings',
          },
          {
            id: 'channel-categories',
            title: '채널 카테고리',
            path: '/mall/channel-categories',
          },
          { id: 'product-display', title: '진열' },
          { id: 'deleted-products', title: '휴지통(삭제상품 관리)' },
          { id: 'product-bulk', title: '일괄 작업', path: '/mall/bulk' },
          {
            id: 'product-csv',
            title: 'CSV 가져오기/내보내기',
            path: '/mall/csv',
          },
          { id: 'product-audit', title: '감사 이력/승인', path: '/mall/audit' },
          {
            id: 'digital-assets',
            title: '디지털 자산',
            path: '/mall/digital-assets',
          },
        ],
      },
      {
        id: 'marketing',
        title: '마케팅',
        children: [
          { id: 'messages', title: '메시지 or 푸시알림' },
          {
            id: 'banner-groups',
            title: '배너 그룹',
            path: '/mall/banner-groups',
          },
          { id: 'popups', title: '팝업' },
          { id: 'points', title: '적립금', path: '/mall/marketing/points' },
          { id: 'coupons', title: '쿠폰', path: '/mall/marketing/coupons' },
          { id: 'promotions', title: '프로모션' },
          { id: 'deposit', title: '예치금' },
          { id: 'events', title: '이벤트' },
        ],
      },
      {
        id: 'customer-operations',
        title: '고객지원/운영',
        children: [{ id: 'notices', title: '공지사항', path: '/mall/notices' }],
      },
      {
        id: 'display-management',
        title: '화면/전시 관리',
        isComingSoon: true,
      },
      {
        id: 'store-regions',
        title: '리전 설정 (통화/세금)',
        path: '/mall/regions',
      },
      {
        id: 'settings',
        title: '설정',
        path: '/mall/settings',
      },
    ],
  },
  {
    id: 'payment-management',
    title: '결제 관리',
    icon: 'CreditCard',
    defaultPath: '/payments',
    children: [
      {
        id: 'payment-list',
        title: '결제 내역',
        path: '/payments',
      },
      {
        id: 'refund-list',
        title: '환불 내역',
        path: '/payments/refunds',
      },
      {
        id: 'bank-transfer-list',
        title: '무통장입금 확인',
        path: '/payments/bank-transfers',
      },
      {
        id: 'points-management',
        title: '적립금 관리',
        path: '/payments/points',
      },
      {
        id: 'payment-methods-management',
        title: '결제수단 관리',
        path: '/payments/methods',
      },
      {
        id: 'region-management',
        title: '리전·결제수단 관리',
        path: '/payments/regions',
      },
    ],
  },
  {
    id: 'membership',
    title: '멤버십 관리',
    icon: 'Crown',
    defaultPath: '/membership/members',
    children: [
      {
        id: 'member-management',
        title: '멤버십 회원 관리',
        children: [
          {
            id: 'member-inquiry',
            title: '회원 조회',
            path: '/membership/members',
          },
          {
            id: 'recurring-billing',
            title: '정기결제 관리',
            path: '/membership/recurring-billing',
          },
          {
            id: 'payment-history',
            title: '결제 내역 조회',
            path: '/membership/billing-history',
          },
          {
            id: 'cancellation-history',
            title: '해지 내역 조회',
            path: '/membership/cancellations',
          },
        ],
      },
      {
        id: 'benefit-management',
        title: '멤버십 혜택 관리',
        children: [
          {
            id: 'membership-plans',
            title: '멤버십 플랜',
            path: '/membership/plans',
          },
        ],
      },
    ],
  },
];

// 첫 번째 페이지를 찾는 헬퍼 함수 추가
export function getFirstPagePath(menuId: string): string | null {
  const menu = getMenuById(menuId);
  if (!menu) return null;

  // defaultPath가 있으면 사용
  if (menu.defaultPath) return menu.defaultPath;

  // 없으면 children에서 첫 번째 path 찾기
  function findFirstPath(items: MenuItem[]): string | null {
    for (const item of items) {
      if (item.path) return item.path;
      if (item.children) {
        const found = findFirstPath(item.children);
        if (found) return found;
      }
    }
    return null;
  }

  return findFirstPath(menu.children);
}

// 현재 경로에 해당하는 메뉴와 아이템을 찾는 함수 수정
export function getActiveMenuAndItem(currentPath: string): {
  menuId: string | null;
  itemId: string | null;
} {
  // 정확한 경로 매칭을 찾는 함수
  function findExactMatch(
    items: MenuItem[],
    targetPath: string
  ): MenuItem | null {
    for (const item of items) {
      if (item.path === targetPath) return item;
      if (item.children) {
        const found = findExactMatch(item.children, targetPath);
        if (found) return found;
      }
    }
    return null;
  }

  // 하위 경로 매칭을 찾는 함수 (가장 긴 경로 우선)
  function findPrefixMatch(
    items: MenuItem[],
    targetPath: string
  ): MenuItem | null {
    let bestMatch: MenuItem | null = null;
    let bestMatchLength = 0;

    function search(items: MenuItem[]) {
      for (const item of items) {
        if (item.path && targetPath.startsWith(item.path + '/')) {
          if (item.path.length > bestMatchLength) {
            bestMatch = item;
            bestMatchLength = item.path.length;
          }
        }
        if (item.children) {
          search(item.children);
        }
      }
    }

    search(items);
    return bestMatch;
  }

  // 1단계: 정확한 경로 매칭 먼저 시도
  for (const menu of mainMenus) {
    const exactMatch = findExactMatch(menu.children, currentPath);
    if (exactMatch) {
      return { menuId: menu.id, itemId: exactMatch.id };
    }
  }

  // 2단계: 하위 경로 매칭 시도 (가장 긴 경로 우선)
  for (const menu of mainMenus) {
    const prefixMatch = findPrefixMatch(menu.children, currentPath);
    if (prefixMatch) {
      return { menuId: menu.id, itemId: prefixMatch.id };
    }
  }

  return { menuId: null, itemId: null };
}

export function getMenuById(id: string): MainMenu | null {
  return mainMenus.find((menu) => menu.id === id) || null;
}
export function getMenuItemById(
  menuId: string,
  itemId: string
): MenuItem | null {
  const menu = getMenuById(menuId);
  if (!menu) return null;

  function findItem(items: MenuItem[]): MenuItem | null {
    for (const item of items) {
      if (item.id === itemId) return item;
      if (item.children) {
        const found = findItem(item.children);
        if (found) return found;
      }
    }
    return null;
  }

  return findItem(menu.children);
}
