import RouteGuard from '@/components/layout/route-guard';
import { AttendancePageLayout } from '@/features/attendance/components/attendance-page-layout';
import { AttendanceStatistics } from '@/features/attendance/components/attendance-statistics';

export default function Page() {
  return (
    <RouteGuard screen="/attendance/statistics">
      <AttendancePageLayout title="월별 출퇴근 통계">
        <AttendanceStatistics showHeading={false} />
      </AttendancePageLayout>
    </RouteGuard>
  );
}
