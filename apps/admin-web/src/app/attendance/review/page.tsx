import RouteGuard from '@/components/layout/route-guard';
import { AttendancePageLayout } from '@/features/attendance/components/attendance-page-layout';
import { CorrectionRequests } from '@/features/attendance/components/correction-requests';

export default function Page() {
  return (
    <RouteGuard requireRole={['master']}>
      <AttendancePageLayout title="출결 요청 검토">
        <CorrectionRequests review showHeading={false} />
      </AttendancePageLayout>
    </RouteGuard>
  );
}
