import { AttendanceSettingsPage } from '@/features/attendance/components/attendance-settings';
import { BrowserPushSettings } from '@/features/attendance/components/browser-push-settings';

export default function Page() {
  return (
    <div className="space-y-6">
      <AttendanceSettingsPage />
      <BrowserPushSettings />
    </div>
  );
}
