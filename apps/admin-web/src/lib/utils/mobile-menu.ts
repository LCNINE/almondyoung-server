/**
 * 모바일 하단 내비의 화면 목록. 내비(`components/mobile/bottom-navigation.tsx`)와
 * 역할의 「로그인 첫 화면」 후보(`lib/auth/role-editor.ts`)가 같이 쓴다 —
 * 모바일 화면은 사이드바(`mainMenus`)에 없어서, 여기 없으면 첫 화면으로 고를 수 없다.
 */
export interface MobileScreen {
  readonly id: string;
  readonly title: string;
  readonly path: string;
}

export const MOBILE_SCREENS: readonly MobileScreen[] = [
  { id: 'home', title: '홈', path: '/mobile/schedule' },
  { id: 'search', title: '재고상품 검색', path: '/mobile/search' },
  { id: 'inbound', title: '입/출고', path: '/mobile/inbound' },
  { id: 'pick', title: '피킹리스트', path: '/mobile/pick' },
  { id: 'sku-field-capture', title: '실측', path: '/mobile/sku-field-capture' },
  { id: 'schedule', title: '알림', path: '/mobile/invoice' },
];
