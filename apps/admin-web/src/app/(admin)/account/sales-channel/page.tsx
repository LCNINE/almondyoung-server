import RouteGuard from '@/components/layout/route-guard';
import SalesChannelTemplate from '@/features/sales-channel/template';

export default function SalesChannelPage() {
  return (
    <RouteGuard screen="/account/sales-channel">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SalesChannelTemplate />
      </div>
    </RouteGuard>
  );
}
