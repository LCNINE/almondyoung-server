import RouteGuard from '@/components/layout/route-guard';
import { FulfillmentDetail } from '@/features/order/fulfillments/detail';

export default async function FulfillmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <FulfillmentDetail id={id} />
      </div>
    </RouteGuard>
  );
}
