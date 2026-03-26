import { TwoColumnPage } from "@/components/admin-ui-experimental/layout";
import { CustomerDetailGeneral } from "./customer-detail-general";
import { CustomerDetailShop } from "./customer-detail-shop";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
      <TwoColumnPage>
        <CustomerDetailGeneral customerId={id} />
        <CustomerDetailShop userId={id} />
      </TwoColumnPage>
    </div>
  )
}
