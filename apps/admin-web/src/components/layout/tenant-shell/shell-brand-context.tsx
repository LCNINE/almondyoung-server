'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ShellBrand } from '@/lib/tenant-shell/shell-brand';

const ShellBrandContext = createContext<ShellBrand>({ kind: 'default' });

/** 이 화면이 어느 셸 안에 있는가 — 루트 레이아웃이 들어온 주소로 정해 내려 준다. */
export function ShellBrandProvider({ brand, children }: { brand: ShellBrand; children: ReactNode }) {
  return <ShellBrandContext.Provider value={brand}>{children}</ShellBrandContext.Provider>;
}

export function useShellBrand(): ShellBrand {
  return useContext(ShellBrandContext);
}
