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
