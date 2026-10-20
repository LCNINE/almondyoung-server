import RouteGuard from '@/components/layout/route-guard';
import { WageWorkerDetailView } from '@/features/attendance/wage/wage-worker-detail';
import { WageTabs } from '@/features/attendance/wage/wage-ui';

export default async function Page({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  return (
    <RouteGuard screen="/company/attendance/wage/workers/[userId]">
      <WageTabs />
      <WageWorkerDetailView userId={userId} />
    </RouteGuard>
  );
}
