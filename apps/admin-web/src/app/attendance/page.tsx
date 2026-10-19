import { AttendanceCard } from '@/features/attendance/components/attendance-card';
import { AttendanceRefreshButton } from '@/features/attendance/components/attendance-refresh-button';

export default function Page() {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6 sm:py-8">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-2 flex justify-end">
          <AttendanceRefreshButton />
        </div>
        <AttendanceCard />
      </div>
    </main>
  );
}
