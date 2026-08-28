import RouteGuard from '@/components/layout/route-guard';
import TimeSaleFormTemplate from '@/features/mall/marketing/time-sale/template/time-sale-form-template';

export default async function MarketingTimeSaleEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <TimeSaleFormTemplate generalId={id} />
      </div>
    </RouteGuard>
  );
}
