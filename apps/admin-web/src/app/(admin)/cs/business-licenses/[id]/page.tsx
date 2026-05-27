import RouteGuard from '@/components/layout/route-guard';
import { BusinessLicenseDetail } from '@/features/cs/business-licenses/components/detail';

export default async function BusinessLicenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <BusinessLicenseDetail id={id} />
      </div>
    </RouteGuard>
  );
}
