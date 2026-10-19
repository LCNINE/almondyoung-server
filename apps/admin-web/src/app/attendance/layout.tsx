import type { Metadata } from 'next';
import { attendanceStartupImages } from '@/features/attendance/lib/attendance-startup-images';
import RouteGuard from '@/components/layout/route-guard';
import { AttendanceAppStartup } from '@/features/attendance/components/attendance-app-startup';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '아몬드영 워크',
  applicationName: '아몬드영 워크',
  manifest: '/attendance/manifest.webmanifest?v=clock-2',
  icons: {
    icon: '/attendance/icon-192.png?v=clock-2',
    apple: '/attendance/icon-180.png?v=clock-2',
  },
  appleWebApp: {
    capable: true,
    title: '아몬드영 워크',
    statusBarStyle: 'default',
    startupImage: attendanceStartupImages,
  },
};

export default function MobileAttendanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <AttendanceAppStartup>{children}</AttendanceAppStartup>
    </RouteGuard>
  );
}
