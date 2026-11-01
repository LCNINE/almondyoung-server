import type { AdminSite } from './site-rules';

/** 브라우저로 넘기는 셸 정보 — 테넌트 id·auth 주소는 싣지 않는다(화면이 쓸 일이 없다). */
export type ShellBrand =
  | { readonly kind: 'default' }
  | { readonly kind: 'tenant'; readonly displayName: string; readonly logoUrl: string | null }
  /** 중립 화면 — 미들웨어가 먼저 끊으므로 레이아웃에 올 일이 거의 없다. 와도 셸 없이 본문만. */
  | { readonly kind: 'neutral' };

export function toShellBrand(site: AdminSite): ShellBrand {
  if (site.kind === 'tenant') return { kind: 'tenant', displayName: site.displayName, logoUrl: site.logoUrl };
  if (site.kind === 'unavailable') return { kind: 'neutral' };
  return { kind: 'default' };
}

/**
 * 테넌트 1 만 섬기는 업스트림 — served-tenant 앱(`SERVED_TENANT_ID` 하나만)과 Medusa(한 벌). 테넌트 셸에서는 못 쓴다.
 * 게이트(`tenant-shell.gate.spec.ts`)의 `TENANT_ONE_ONLY_UPSTREAM` 과 같은 목록이다. 테넌트마다 한 벌씩 생기면 여기서 뺀다.
 */
export const TENANT_ONE_ONLY_UPSTREAMS = [
  'medusa',
  'wallet',
  'membership',
  'notification',
  'channel-adapter',
  'ugc',
  'analytics',
  'search',
] as const;

export type TenantOneOnlyUpstream = (typeof TENANT_ONE_ONLY_UPSTREAMS)[number];

const NONE: ReadonlySet<TenantOneOnlyUpstream> = new Set();
const ALL: ReadonlySet<TenantOneOnlyUpstream> = new Set(TENANT_ONE_ONLY_UPSTREAMS);

/** 이 셸에서 못 쓰는 업스트림. 기존 셸은 없음, 테넌트 셸·중립 화면은 전부(중립 화면은 테넌트를 모른다). */
export function unavailableUpstreamsOf(brand: ShellBrand): ReadonlySet<TenantOneOnlyUpstream> {
  return brand.kind === 'default' ? NONE : ALL;
}
