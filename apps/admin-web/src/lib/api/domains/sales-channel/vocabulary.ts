/**
 * 판매채널 화면이 쓰는 두 축의 어휘.
 *
 * - `site` = 채널 **정체** (`medusa` / `naver` / ...). 정본은 서버의 `SALES_CHANNELS` 다.
 * - `type` = 채널 **형태** (`ONLINE` / `MARKETPLACE` / ...). 정본은 서버 DTO 의 `@IsEnum` 배열이다.
 *
 * 여기 있는 것은 **표시 라벨뿐**이다. 값 목록이 서버와 갈리면 `vocabulary.spec.ts` 가 잡는다.
 * 이 파일은 순수 `.ts` 여야 한다 — admin-web 은 컴포넌트 테스트가 불가능하므로, 판정 가능한
 * 로직을 `.tsx` 밖으로 빼는 것이 유일한 검증 수단이다.
 */

export type SalesChannelSite = 'medusa' | 'naver' | 'coupang' | '3pl';

export const SALES_CHANNEL_SITE_LABELS: Record<SalesChannelSite, string> = {
  medusa: '아몬드영 (자사몰)',
  naver: '네이버 스마트스토어',
  coupang: '쿠팡',
  '3pl': '3PL',
};

export const SALES_CHANNEL_SITE_OPTIONS: ReadonlyArray<{
  value: SalesChannelSite;
  label: string;
}> = (
  // as: Object.keys widens to string[] even though SALES_CHANNEL_SITE_LABELS is typed as
  // Record<SalesChannelSite, string> — every key of that record is a SalesChannelSite by
  // construction, so narrowing back is safe.
  Object.keys(SALES_CHANNEL_SITE_LABELS) as SalesChannelSite[]
).map((value) => ({
  value,
  label: SALES_CHANNEL_SITE_LABELS[value],
}));

export function siteLabel(site: string): string {
  // as: lookup-with-fallback — an unrecognized `site` string simply misses the record (fine,
  // `?? site` returns the raw value below) rather than producing a wrong result, so the cast
  // does not hide a type error.
  return SALES_CHANNEL_SITE_LABELS[site as SalesChannelSite] ?? site;
}

export type ChannelFormType = 'ONLINE' | 'OFFLINE' | 'MARKETPLACE' | 'MOBILE_APP' | 'SOCIAL_COMMERCE';

export const CHANNEL_TYPE_OPTIONS: ReadonlyArray<{
  value: ChannelFormType;
  label: string;
}> = [
  { value: 'ONLINE', label: '온라인' },
  { value: 'OFFLINE', label: '오프라인' },
  { value: 'MARKETPLACE', label: '오픈마켓' },
  { value: 'MOBILE_APP', label: '모바일 앱' },
  { value: 'SOCIAL_COMMERCE', label: '소셜커머스' },
];

export const DEFAULT_CHANNEL_TYPE: ChannelFormType = 'ONLINE';
