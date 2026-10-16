import type { Metadata } from 'next';
import RouteGuard from '@/components/layout/route-guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '아몬드영 출결',
  manifest: '/attendance/manifest.webmanifest',
  icons: { apple: '/attendance/icon-180.png' },
  appleWebApp: {
    capable: true,
    title: '아몬드영 출결',
    statusBarStyle: 'default',
  },
};

export default function MobileAttendanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RouteGuard requireRole={['admin', 'master']}>{children}</RouteGuard>;
}
