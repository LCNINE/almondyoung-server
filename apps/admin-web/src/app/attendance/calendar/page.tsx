import { AttendancePageLayout } from '@/features/attendance/components/attendance-page-layout';
import { SharedCalendar } from '@/features/attendance/components/shared-calendar';

export default function Page() {
  return (
    <AttendancePageLayout title="휴가·반차 일정" wide fillViewport>
      <SharedCalendar initialScope="personal" showHeading={false} fitViewport />
    </AttendancePageLayout>
  );
}
