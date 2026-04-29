import RouteGuard from '@/components/layout/route-guard';
import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { redirect } from 'next/navigation';
import CsvTemplate from '@/features/mall/csv/template';

export default async function CsvPage() {
  const payload = await getTokenPayload();
  if (!payload) redirect('/login');

  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <CsvTemplate userId={payload.sub} />
      </div>
    </RouteGuard>
  );
}
