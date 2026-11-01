'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { unavailableUpstreamsOf, type ShellBrand, type TenantOneOnlyUpstream } from '@/lib/tenant-shell/shell-brand';

const ShellBrandContext = createContext<ShellBrand>({ kind: 'default' });

/** 이 화면이 어느 셸 안에 있는가 — 루트 레이아웃이 들어온 주소로 정해 내려 준다. */
export function ShellBrandProvider({ brand, children }: { brand: ShellBrand; children: ReactNode }) {
  return <ShellBrandContext.Provider value={brand}>{children}</ShellBrandContext.Provider>;
}

export function useShellBrand(): ShellBrand {
  return useContext(ShellBrandContext);
}

/**
 * 이 셸에서 그 업스트림을 쓸 수 있는가. 못 쓰면 그 업스트림을 부르는 본문 블록은 숨고 쿼리도 켜지 않는다 —
 * 숨기만 하고 쿼리를 켜 두면 브라우저가 그대로 부른다.
 */
export function useUpstreamAvailable(upstream: TenantOneOnlyUpstream): boolean {
  return !unavailableUpstreamsOf(useShellBrand()).has(upstream);
}
