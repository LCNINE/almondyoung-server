'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PermissionStatusBanner } from '@/components/auth/permission-status-banner';
import { PiiMaskedBanner } from '@/components/pii/pii-masked-banner';
import type { ShellBrand } from '@/lib/tenant-shell/shell-brand';
import { usesStandaloneLayout } from './page-layout-mode';
import { ShellBrandProvider } from './tenant-shell/shell-brand-context';

const AdminShell = dynamic(() =>
  import('./admin-shell').then((module) => module.AdminShell)
);
const TenantShell = dynamic(() =>
  import('./tenant-shell/tenant-shell').then((module) => module.TenantShell)
);

/** 들어온 주소가 셸을 정한다(루트 레이아웃이 `brand` 로 내려 준다). 본문은 두 셸이 같다. */
export function MainLayout({
  brand,
  children,
}: {
  brand: ShellBrand;
  children: ReactNode;
}) {
  return (
    <ShellBrandProvider brand={brand}>
      {brand.kind === 'tenant' ? (
        <TenantLayout displayName={brand.displayName} logoUrl={brand.logoUrl}>
          {children}
        </TenantLayout>
      ) : brand.kind === 'neutral' ? (
        children
      ) : (
        <DefaultLayout>{children}</DefaultLayout>
      )}
    </ShellBrandProvider>
  );
}

/** 테넌트 셸 — 데모 배너는 없다(테넌트 도메인은 데모 배포가 아니다). */
function TenantLayout({
  displayName,
  logoUrl,
  children,
}: {
  displayName: string;
  logoUrl: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (usesStandaloneLayout(pathname)) return <>{children}</>;
  return (
    <TenantShell
      displayName={displayName}
      logoUrl={logoUrl}
      banner={
        <>
          <PermissionStatusBanner />
          <PiiMaskedBanner />
        </>
      }
    >
      {children}
    </TenantShell>
  );
}

function DefaultLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const demoBanner = process.env.NEXT_PUBLIC_APP_STAGE === 'demo' && (
    <div className="flex items-center justify-between gap-3 bg-amber-100 px-5 py-2 text-sm text-amber-950">
      <span>
        <strong>DEMO</strong> · 시연 데이터 · 택배와 알림은 모의 처리됩니다.
      </span>
      <Link
        href="/demo"
        className="shrink-0 whitespace-nowrap font-semibold underline"
      >
        시연 콘솔
      </Link>
    </div>
  );

  // 셸 밖 화면도 권한 조회 실패는 알린다(쓰기 버튼이 이유 없이 사라지지 않게)
  const statusBanners = (
    <>
      <PermissionStatusBanner />
      <PiiMaskedBanner />
    </>
  );

  if (pathname.startsWith('/mall/marketing/time-sale')) {
    return (
      <>
        {statusBanners}
        {children}
      </>
    );
  }

  if (usesStandaloneLayout(pathname)) {
    const signedOut =
      pathname === '/login' ||
      pathname === '/unauthorized' ||
      pathname === '/wrong-account';
    return (
      <>
        {demoBanner}
        {signedOut ? null : statusBanners}
        {children}
      </>
    );
  }

  return (
    <AdminShell
      banner={
        <>
          {demoBanner}
          {statusBanners}
        </>
      }
    >
      {children}
    </AdminShell>
  );
}
