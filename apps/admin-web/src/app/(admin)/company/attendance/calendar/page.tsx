import { SharedCalendar } from '@/features/attendance/components/shared-calendar';
import { ATTENDANCE_CALENDAR_VIEWPORT_CLASS } from '@/features/attendance/components/attendance-page-layout';

export default function Page() {
  return (
    <div className="-mx-4 sm:-mx-8">
      <div className={ATTENDANCE_CALENDAR_VIEWPORT_CLASS}>
        <SharedCalendar showHeading={false} fitViewport />
      </div>
    </div>
  );
}
