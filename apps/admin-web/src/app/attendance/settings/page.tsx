import Link from 'next/link';
import { AttendanceSettingsPage } from '@/features/attendance/components/attendance-settings';
import { BrowserPushSettings } from '@/features/attendance/components/browser-push-settings';

export default function Page() {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-xl space-y-6">
        <Link href="/attendance" className="text-sm text-indigo-600">
          ← 오늘의 근무
        </Link>
        <AttendanceSettingsPage />
        <BrowserPushSettings />
      </div>
    </main>
  );
}
