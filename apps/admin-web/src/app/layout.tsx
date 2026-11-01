// src/app/layout.tsx
import { AuthExpiredHandler } from '@/components/layout/auth-expired-handler';
import { PermissionDeniedHandler } from '@/components/layout/permission-denied-handler';
import { MainLayout } from '@/components/layout/main-layout';
import { MyPermissionsHydration } from '@/components/auth/my-permissions-hydration';
import { PiiModeProvider } from '@/components/pii/pii-mode-context';
import { getAdminSite } from '@/lib/tenant-shell/site.server';
import { toShellBrand } from '@/lib/tenant-shell/shell-brand';
import { ObservabilityProvider } from '@/components/providers/observability-provider';
import QueryProvider from '@/components/providers/query-provider';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { connection } from 'next/server';
import { Toaster } from 'sonner';
import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';

const inter = Inter({ subsets: ['latin'] });

// 들어온 주소로 셸·브랜드가 갈린다 — 언제나 요청마다 그린다. OpenNext 캐시 키에 Host 가 없어 정적으로 구우면 한 주소의 브랜드가
// 다른 주소에 나간다(scripts/tenancy/brand-pages-dynamic.spec.ts 가 지킨다).
export const dynamic = 'force-dynamic';

/**
 * 탭 제목·파비콘. 테넌트 셸은 그 테넌트 이름과 로고(없으면 `data:,` — 비우면 브라우저가 기본 `/favicon.ico` 를 스스로 부른다).
 * 파비콘 파일 규칙(`app/favicon.ico`)은 모든 주소에 박혀서 `public/` 에 두고 여기서 고른다.
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getAdminSite();
  if (site.kind === 'tenant') {
    return {
      title: site.displayName,
      description: site.displayName,
      icons: { icon: site.logoUrl ?? 'data:,' },
    };
  }
  if (site.kind === 'unavailable') return { title: '관리자', icons: { icon: 'data:,' } };
  return {
    title: 'LCNINE 관리자 시스템',
    description: 'LCNINE 관리자 시스템',
    icons: { icon: '/favicon.ico' },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 가림 모드 스위치를 빌드 때가 아니라 요청 때 읽는다.
  await connection();
  const revealRequired = process.env.PII_REVEAL_REQUIRED === 'true';
  const brand = toShellBrand(await getAdminSite());
  return (
    <html lang="ko">
      <body className={inter.className} suppressHydrationWarning>
        <QueryProvider>
          <TooltipProvider>
            <ObservabilityProvider />
            <MyPermissionsHydration>
              <PiiModeProvider revealRequired={revealRequired}>
                <MainLayout brand={brand}>{children}</MainLayout>
              </PiiModeProvider>
            </MyPermissionsHydration>
            <AuthExpiredHandler />
            <PermissionDeniedHandler />
            <Toaster />
            <ReactQueryDevtools
              initialIsOpen={false}
              buttonPosition="bottom-left"
            />
          </TooltipProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
