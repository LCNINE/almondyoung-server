import RouteGuard from '@/components/layout/route-guard';
import ChannelListingsTemplate from '@/features/mall/channel-listings/template';

export default function ChannelListingsPage() {
  return (
    <RouteGuard screen="/mall/channel-listings">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ChannelListingsTemplate />
      </div>
    </RouteGuard>
  );
}
