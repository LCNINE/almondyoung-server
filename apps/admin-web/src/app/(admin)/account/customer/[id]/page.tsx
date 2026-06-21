import { TwoColumnPage } from '@/components/admin-ui-experimental/layout';
import { CustomerDetailGeneral } from './_components/customer-detail-general';
import { CustomerDetailShop } from './_components/customer-detail-shop';
import { CustomerDetailBusiness } from './_components/customer-detail-business';
import { CustomerBlacklist } from './_components/customer-blacklist';

/**
 * user-service 고객 목록 페이지입니다.
 * medusa-customer이랑 헷갈리시지 않도록 주의해주세요.
 */
export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
      <TwoColumnPage>
        <CustomerDetailGeneral customerId={id} />
        <CustomerDetailShop userId={id} />
      </TwoColumnPage>
      <TwoColumnPage>
        <CustomerBlacklist userId={id} />
        <CustomerDetailBusiness userId={id} />
      </TwoColumnPage>
    </div>
  );
}
