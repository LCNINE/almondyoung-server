import { AttendanceSettingsPage } from '@/features/attendance/components/attendance-settings';
import { BrowserPushSettings } from '@/features/attendance/components/browser-push-settings';

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <AttendanceSettingsPage />
      <BrowserPushSettings />
    </div>
  );
}
