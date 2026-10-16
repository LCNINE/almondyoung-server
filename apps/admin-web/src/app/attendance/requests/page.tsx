import Link from 'next/link';
import { CorrectionRequests } from '@/features/attendance/components/correction-requests';

export default function Page() {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-xl space-y-6">
        <Link href="/attendance" className="text-sm text-indigo-600">
          ← 오늘의 근무
        </Link>
        <CorrectionRequests />
      </div>
    </main>
  );
}
