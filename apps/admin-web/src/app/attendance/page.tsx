import Link from 'next/link';
import { AttendanceCard } from '@/features/attendance/components/attendance-card';

export default function Page() {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-md">
        <header className="mb-6 px-2">
          <p className="text-xs font-semibold tracking-wide text-indigo-600">
            ALMONDYOUNG
          </p>
          <h1 className="mt-3 text-2xl font-bold">오늘도 반가워요.</h1>
        </header>
        <AttendanceCard mobile />
        <p className="mt-6 text-center text-xs text-slate-400">
          홈 화면에 추가하면 출결을 더 빠르게 열 수 있어요.
        </p>
        <Link
          href="/company/attendance"
          className="mt-4 block text-center text-sm text-indigo-600"
        >
          직원 근무 현황 보기 →
        </Link>
      </div>
    </main>
  );
}
