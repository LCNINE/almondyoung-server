// src/app/layout.tsx
import { AuthExpiredHandler } from '@/components/layout/auth-expired-handler';
import { MainLayout } from '@/components/layout/main-layout';
import { ObservabilityProvider } from '@/components/providers/observability-provider';
import QueryProvider from '@/components/providers/query-provider';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'LCNINE 관리자 시스템',
  description: 'LCNINE 관리자 시스템',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={inter.className}>
        <QueryProvider>
          <TooltipProvider>
            <ObservabilityProvider />
            <MainLayout>{children}</MainLayout>
            <AuthExpiredHandler />
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
