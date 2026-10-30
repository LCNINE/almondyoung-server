import RouteGuard from '@/components/layout/route-guard';
import { FulfillmentDetail } from '@/features/order/fulfillments/components/detail';

export default async function FulfillmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ shipmentId?: string | string[] }>;
}) {
  const { id } = await params;
  const { shipmentId } = await searchParams;
  return (
    <RouteGuard screen="/order/fulfillments/[id]">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <FulfillmentDetail
          id={id}
          shipmentId={typeof shipmentId === 'string' ? shipmentId : undefined}
        />
      </div>
    </RouteGuard>
  );
}
