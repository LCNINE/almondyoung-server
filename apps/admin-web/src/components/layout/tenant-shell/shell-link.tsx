'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { tenantShellScreenOf } from '@/lib/tenant-shell/allowlist';
import { useShellBrand } from './shell-brand-context';

/**
 * 테넌트 셸에서 허용 목록 밖 화면으로 가는 링크. 기존 셸에서는 그냥 `Link` 이고, 테넌트 셸에서는 그 화면이 404 라
 * 링크 없이 글자만 남긴다. 테넌트 셸 화면이 싣는 코드의 목록 밖 링크는 이걸 써야 한다(`tenant-shell.gate.spec.ts`).
 */
export function ShellLink({ href, children, className, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const brand = useShellBrand();
  if (brand.kind !== 'default' && !tenantShellScreenOf(href.split(/[?#]/)[0])) {
    return <span>{children}</span>;
  }
  return (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}
