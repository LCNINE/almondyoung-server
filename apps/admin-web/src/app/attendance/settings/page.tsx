import { AttendancePageLayout } from '@/features/attendance/components/attendance-page-layout';
import { AttendanceSettingsPage } from '@/features/attendance/components/attendance-settings';
import { BrowserPushSettings } from '@/features/attendance/components/browser-push-settings';

export default function Page() {
  return (
    <AttendancePageLayout title="근무·알림 설정">
      <AttendanceSettingsPage showHeading={false} />
      <BrowserPushSettings />
    </AttendancePageLayout>
  );
}
