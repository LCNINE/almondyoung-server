// src/app/layout.tsx
import { AuthExpiredHandler } from '@/components/layout/auth-expired-handler';
import { MainLayout } from '@/components/layout/main-layout';
import { MockProvider } from '@/components/providers/mock-provider';
import QueryProvider from '@/components/providers/query-provider';
import { userApi } from '@/lib';
import { authQueryKeys } from '@/lib/services/auth';
import { server } from '@/lib/mock/server';
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'LCNINE 관리자 시스템',
  description: 'LCNINE 관리자 시스템',
};

// 서버에서 Mock 초기화
if (typeof window === 'undefined') {
  server.listen({
    onUnhandledRequest: 'warn',
  });
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const queryClient = new QueryClient();

  await queryClient.prefetchQuery({
    queryKey: authQueryKeys.me(),
    queryFn: () => userApi.getMe(),
  });

  return (
    <html lang="ko">
      <body className={inter.className}>
        <MockProvider>
          <QueryProvider>
            <HydrationBoundary state={dehydrate(queryClient)}>
              <MainLayout>{children}</MainLayout>
              <AuthExpiredHandler />
              <Toaster />
              <ReactQueryDevtools initialIsOpen={false} />
            </HydrationBoundary>
          </QueryProvider>
        </MockProvider>
      </body>
    </html>
  );
}
