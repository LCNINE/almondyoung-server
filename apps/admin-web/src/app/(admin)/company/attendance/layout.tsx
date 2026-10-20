import RouteGuard from '@/components/layout/route-guard';
import { AttendanceNavigation } from '@/features/attendance/components/attendance-navigation';

export default function AttendanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RouteGuard screen="/company/attendance">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8">
        <AttendanceNavigation />
        {children}
      </div>
    </RouteGuard>
  );
}
