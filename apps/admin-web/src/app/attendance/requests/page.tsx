import { AttendancePageLayout } from '@/features/attendance/components/attendance-page-layout';
import { CorrectionRequests } from '@/features/attendance/components/correction-requests';

export default function Page() {
  return (
    <AttendancePageLayout title="정정·예외 요청">
      <CorrectionRequests showHeading={false} />
    </AttendancePageLayout>
  );
}
