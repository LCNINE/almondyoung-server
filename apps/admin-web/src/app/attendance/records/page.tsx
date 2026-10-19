import { AttendancePageLayout } from '@/features/attendance/components/attendance-page-layout';
import { AttendanceRecords } from '@/features/attendance/components/attendance-records';

export default function Page() {
  return (
    <AttendancePageLayout title="출퇴근 기록">
      <AttendanceRecords showHeading={false} />
    </AttendancePageLayout>
  );
}
