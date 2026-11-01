import { resolveScreenAccess } from '../auth/screen-access';
import { TENANT_SHELL_MENU, TENANT_SHELL_SCREENS } from './allowlist';
import type { TenantOneOnlyUpstream } from './shell-brand';
import { codeOf, pageFileOf, reachableFrom } from './tenant-shell-reach';

/**
 * 테넌트 셸 허용 목록 게이트(비공개 ADR 0008). 목록의 화면이
 * ① `screen-access.ts` 의 권한으로 판정되고,
 * ② 테넌트 1 만 섬기는 업스트림(Medusa·wallet·membership·notification·channel-adapter·ugc·analytics·search)을 부르지 않고,
 * ③ 아몬드영·LCNINE 문구를 싣지 않는다.
 * ②③ 은 페이지에서 값으로 import 하는 코드를 따라가 잰다 — 새 화면을 목록에 더하면 그 화면이 싣는 코드로 다시 잰다.
 * 그래프는 파일 단위라 넓게 잡는다. 실제로 부르지 않거나(묶음 객체에 함께 실렸을 뿐) 셸이 숨기는 블록은 아래 대장에 사유와 함께 적는다.
 * 대장에 적힌 파일이 더는 닿지 않으면 그것도 빨갛다(지울 것).
 * 셸이 숨기는 블록은 import 는 남는다 — 대신 `HIDDEN_BLOCKS` 의 파일이 셸 신호(`useUpstreamAvailable`)를 보는지 잰다.
 */

/** 테넌트 1 만 섬기는 업스트림을 부르는 흔적. `const/api-const.ts`(정의하는 곳)는 빼고, 그 상수·경로를 쓰는 파일을 센다. */
const TENANT_ONE_ONLY_UPSTREAM =
  /\b(MEDUSA_BASE_URL|WALLET_SERVICE_BASE_URL|MEMBERSHIP_SERVICE_BASE_URL|NOTIFICATION_SERVICE_BASE_URL|CHANNEL_ADAPTER_SERVICE_BASE_URL|UGC_SERVICE_BASE_URL|ANALYTICS_SERVICE_BASE_URL|SEARCH_SERVICE_BASE_URL)\b|\/proxy\/(medusa|wallet|membership|notification|channel|ugc|analytics|search)\b|\/api\/fulfillment\/channel-dispatch/;
const DEFINES_UPSTREAMS = new Set(['const/api-const.ts']);

const BRAND = /아몬드|LCNINE/;

/** 닿지만 괜찮은 업스트림 호출 — 파일 → 사유. «22» 는 셸이 알려 주는 «못 쓰는 업스트림»을 보고 그 블록을 숨기는 티켓이다. */
const UPSTREAM_LEDGER: Readonly<Record<string, string>> = {
  'lib/api/domains/medusa/shipping-groups.ts':
    '배송비 그룹(Medusa) — 상품 목록의 일괄 정책 모달·상품 상세가 import 한다. 셸 신호 뒤에서만 부른다(HIDDEN_BLOCKS)',
  'lib/api/domains/products/shop-listings.client.ts':
    '`products` 묶음 객체(lib/api/domains/products/index.ts)에 함께 실려 닿을 뿐 — 목록 화면의 훅은 샵 매매(ugc)를 부르지 않는다',
  'lib/api/domains/products/almond-templates.client.ts':
    '`products` 묶음 객체에 함께 실려 닿을 뿐 — 목록 화면의 훅은 템플릿(ugc)을 부르지 않는다',
  'lib/demo/capabilities.ts': '시연 배포가 막는 경로 목록(문자열)이다 — 부르지 않는다',
};

/** 닿지만 테넌트 셸에 그려지지 않는 브랜드 문구 — 파일 → 사유. */
const BRAND_LEDGER: Readonly<Record<string, string>> = {
  'lib/utils/menu.ts': '기존 셸 메뉴 정의 — route-guard 의 `/` 판정이 import 할 뿐 테넌트 셸은 그리지 않는다',
  'lib/services/matching/transformers.ts':
    '판매채널 이름표(주문 매칭) — 상품 상세의 매칭 열·단건 SKU 연결 패널이 import 한다. 셸 신호 뒤에서만 그린다(HIDDEN_BLOCKS)',
};

/**
 * 셸이 «못 쓰는 업스트림»을 알려 주면 숨는 본문 블록 — 블록 → 그 블록을 그리는 파일(그 파일이 그 업스트림의 신호를 본다).
 * 채널 노출(멤버십 노출 스위치)은 core 를 거쳐 채널 어댑터가 스토어로 옮기므로 그래프에 안 잡힌다 — 그래서 여기 손으로 적는다.
 */
const HIDDEN_BLOCKS: readonly { block: string; upstream: TenantOneOnlyUpstream; files: readonly string[] }[] = [
  {
    block: '배송비 그룹',
    upstream: 'medusa',
    files: [
      'features/mall/products-detail/components/general/index.tsx',
      'features/mall/bulk/components/bulk-policy-modal/index.tsx',
    ],
  },
  {
    block: '단건 SKU 연결 패널(매칭 열)',
    upstream: 'medusa',
    files: ['features/mall/products-detail/components/variants/index.tsx'],
  },
  {
    block: '채널 노출',
    upstream: 'channel-adapter',
    files: [
      'features/mall/products-detail/components/general/index.tsx',
      'features/mall/bulk/components/bulk-policy-modal/index.tsx',
    ],
  },
];

/** 테넌트 셸 자신 — 테넌트 도메인에서만(또는 두 셸 모두에) 그려지는 파일. */
const SHELL_FILES = [
  'components/layout/tenant-shell/tenant-shell.tsx',
  'components/layout/tenant-shell/shell-brand-context.tsx',
  'app/wrong-account/page.tsx',
  'app/not-found.tsx',
  'components/auth/permission-status-banner.tsx',
  'components/pii/pii-masked-banner.tsx',
  'lib/tenant-shell/neutral-page.ts',
  'lib/tenant-shell/allowlist.ts',
];

const pages = TENANT_SHELL_SCREENS.map((screen) => ({ screen, page: pageFileOf(screen) }));
const reached = new Map<string, Set<string>>();
for (const root of [...pages.map((p) => p.page).filter((p): p is string => p !== null), SHELL_FILES[0]]) {
  for (const file of reachableFrom(root)) {
    if (!reached.has(file)) reached.set(file, new Set());
    reached.get(file)!.add(root);
  }
}
const hits = (pattern: RegExp, skip: ReadonlySet<string> = new Set()) =>
  [...reached.keys()].filter((f) => !skip.has(f) && pattern.test(codeOf(f))).sort();

describe('테넌트 셸 허용 목록 게이트', () => {
  it('목록의 화면마다 페이지가 있고 그래프가 실제로 따라간다 — 빈 결과는 검사가 깨졌다는 뜻이다', () => {
    expect(pages.filter((p) => p.page === null).map((p) => p.screen)).toEqual([]);
    expect(reached.size).toBeGreaterThan(100);
  });

  it('목록의 화면은 screen-access 의 권한으로 판정된다', () => {
    expect(TENANT_SHELL_SCREENS.filter((s) => resolveScreenAccess(s)?.kind !== 'permission')).toEqual([]);
  });

  it('메뉴는 목록의 화면만 가리키고, 메뉴에 없는 화면은 메뉴 화면 아래 경로다(상세·만들기)', () => {
    const inMenu = TENANT_SHELL_MENU.flatMap((g) => g.items.map((i) => i.path as string));
    expect(inMenu.filter((p) => !(TENANT_SHELL_SCREENS as readonly string[]).includes(p))).toEqual([]);
    expect(
      TENANT_SHELL_SCREENS.filter((s) => !inMenu.includes(s) && !inMenu.some((m) => s.startsWith(`${m}/`))),
    ).toEqual([]);
  });

  it('셸이 숨기는 블록을 그리는 파일은 목록의 화면에 닿고, 그 업스트림의 셸 신호를 본다', () => {
    const files = HIDDEN_BLOCKS.flatMap((b) => b.files.map((f) => ({ ...b, file: f })));
    expect(files.filter((b) => !reached.has(b.file)).map((b) => b.file)).toEqual([]);
    expect(
      files
        .filter((b) => !codeOf(b.file).includes(`useUpstreamAvailable('${b.upstream}')`))
        .map((b) => `${b.block}: ${b.file}`),
    ).toEqual([]);
  });

  it('목록의 화면이 테넌트 1 만 섬기는 업스트림을 부르지 않는다(대장의 사유 밖)', () => {
    const found = hits(TENANT_ONE_ONLY_UPSTREAM, DEFINES_UPSTREAMS);
    expect(found.filter((f) => !Object.hasOwn(UPSTREAM_LEDGER, f))).toEqual([]);
    expect(Object.keys(UPSTREAM_LEDGER).filter((f) => !found.includes(f))).toEqual([]);
  });

  it('목록의 화면과 테넌트 셸이 싣는 코드에 아몬드영·LCNINE 문구가 없다(대장의 사유 밖)', () => {
    const found = hits(BRAND);
    expect(found.filter((f) => !Object.hasOwn(BRAND_LEDGER, f))).toEqual([]);
    expect(Object.keys(BRAND_LEDGER).filter((f) => !found.includes(f))).toEqual([]);
  });

  it('테넌트 셸 자신의 파일에는 브랜드 흔적이 없다(코드 이름의 almond 도, 주석은 빼고)', () => {
    expect(SHELL_FILES.filter((f) => /아몬드|LCNINE|almond/i.test(codeOf(f)))).toEqual([]);
  });
});
