import { TwoColumnPage } from '@/components/admin-ui-experimental/layout';
import { MedusaCustomerDetailGeneral } from './medusa-customer-detail-general';
import { MedusaCustomerDetailAddresses } from './medusa-customer-detail-addresses';

export default async function MedusaCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
      <TwoColumnPage>
        <MedusaCustomerDetailGeneral customerId={id} />
        <MedusaCustomerDetailAddresses customerId={id} />
      </TwoColumnPage>
    </div>
  );
}
