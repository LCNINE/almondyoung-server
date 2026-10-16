import Link from 'next/link';
import { SharedCalendar } from '@/features/attendance/components/shared-calendar';

export default function Page() {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <Link href="/attendance" className="text-sm text-indigo-600">
          ← 오늘의 근무
        </Link>
        <SharedCalendar initialScope="personal" />
      </div>
    </main>
  );
}
