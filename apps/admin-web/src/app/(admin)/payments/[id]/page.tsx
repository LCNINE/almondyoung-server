import { TwoColumnPage } from '@/components/admin-ui-experimental/layout';
import { PaymentDetailMain } from './payment-detail-main';
import { PaymentDetailSidebar } from './payment-detail-sidebar';

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
      <TwoColumnPage>
        <PaymentDetailMain intentId={id} />
        <PaymentDetailSidebar intentId={id} />
      </TwoColumnPage>
    </div>
  );
}
