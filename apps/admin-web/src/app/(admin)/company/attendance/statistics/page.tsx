import RouteGuard from '@/components/layout/route-guard';
import { AttendanceStatistics } from '@/features/attendance/components/attendance-statistics';

export default function Page() {
  return (
    <RouteGuard screen="/company/attendance/statistics">
      <AttendanceStatistics />
    </RouteGuard>
  );
}
