// 순수 규칙 — 미들웨어(Edge)가 import 한다. next·server-only 를 import 하지 않는다.
import { canAccess, resolveScreenAccess } from '../auth/screen-access';

/**
 * 테넌트 셸의 허용 목록 — 테넌트마다가 아니라 코드에 하나다(비공개 ADR 0008). 목록 밖 화면은 테넌트 도메인에서 404 다.
 * 키는 `screen-access.ts` 와 같은 화면 경로(동적 세그먼트는 `[id]` 그대로)다. 메뉴에 없는 화면은 메뉴 화면 아래 경로여야 한다(상세·만들기).
 *
 * 새 화면을 더하면 `tenant-shell.gate.spec.ts` 가 다시 잰다 — 그 화면이 테넌트 1 만 섬기는 업스트림(Medusa·wallet …)을 부르지
 * 않는지, `screen-access.ts` 에 있는지, 본문에 아몬드영·LCNINE 문구가 없는지.
 * ⚠️ 셸은 방어선이 아니다. 목록 밖 경로의 404 는 화면 정리일 뿐이고, 서버 쪽 문(DB 라우팅·공유 서비스 문·서버 자격증명 라우트)이 따로 막는다.
 */
export const TENANT_SHELL_SCREENS = [
  '/inventory/warehouses',
  '/inventory/warehouses/new',
  '/inventory/locations',
  '/inventory/skus',
  '/inventory/sku-groups',
  '/inventory/delivery-profiles',
  '/mall/products-list',
  '/mall/products-list/[masterId]',
  '/mall/products-list/[masterId]/versions',
  '/mall/product-registration',
  '/mall/my-drafts',
  '/mall/bulk-sessions',
  '/mall/bulk-sessions/[id]',
  '/mall/categories',
  '/mall/tags',
] as const;

export type TenantShellScreen = (typeof TENANT_SHELL_SCREENS)[number];

export interface TenantShellMenuGroup {
  readonly title: string;
  readonly items: readonly { readonly title: string; readonly path: TenantShellScreen }[];
}

/** 테넌트 셸 사이드바·모바일 메뉴. 제목은 기존 셸 메뉴(`lib/utils/menu.ts`)와 같다. */
export const TENANT_SHELL_MENU: readonly TenantShellMenuGroup[] = [
  {
    title: '재고',
    items: [
      { title: '창고 관리', path: '/inventory/warehouses' },
      { title: '로케이션 관리', path: '/inventory/locations' },
      { title: 'SKU 마스터 관리', path: '/inventory/skus' },
      { title: 'SKU 그룹 관리', path: '/inventory/sku-groups' },
      { title: '배송 프로필', path: '/inventory/delivery-profiles' },
    ],
  },
  {
    title: '상품관리',
    items: [
      { title: '목록', path: '/mall/products-list' },
      { title: '등록', path: '/mall/product-registration' },
      { title: '작성중인 상품', path: '/mall/my-drafts' },
      { title: '엑셀 일괄 등록/수정', path: '/mall/bulk-sessions' },
      { title: '분류/카테고리', path: '/mall/categories' },
      { title: '태그', path: '/mall/tags' },
    ],
  },
];

export function isTenantShellScreen(screen: string): screen is TenantShellScreen {
  return TENANT_SHELL_SCREENS.some((s) => s === screen);
}

const segmentsOf = (path: string) => path.split('/').filter(Boolean);

/** 이 경로가 허용 목록의 어느 화면인가. 목록 밖이면 null. */
export function tenantShellScreenOf(pathname: string): TenantShellScreen | null {
  const actual = segmentsOf(pathname);
  for (const screen of TENANT_SHELL_SCREENS) {
    const pattern = segmentsOf(screen);
    if (
      pattern.length === actual.length &&
      pattern.every((seg, i) => (seg.startsWith('[') && seg.endsWith(']') ? actual[i] !== '' : seg === actual[i]))
    ) {
      return screen;
    }
  }
  return null;
}

const opens = (screen: string, held: ReadonlySet<string>) => {
  const access = resolveScreenAccess(screen);
  return access !== undefined && canAccess(access, held);
};

/**
 * 테넌트 셸의 첫 화면. 역할의 첫 화면(`landingPath`)이 목록에 있고 열 수 있으면 그곳, 아니면 메뉴 순서로 처음 열 수 있는 화면.
 * 하나도 못 열면 null.
 */
export function chooseTenantLanding(mine: {
  readonly permissions: ReadonlySet<string>;
  readonly landingPath: string | null;
}): TenantShellScreen | null {
  const landing = mine.landingPath ? tenantShellScreenOf(mine.landingPath) : null;
  if (landing && landing === mine.landingPath && opens(landing, mine.permissions)) return landing;
  for (const group of TENANT_SHELL_MENU) {
    for (const item of group.items) if (opens(item.path, mine.permissions)) return item.path;
  }
  return null;
}
