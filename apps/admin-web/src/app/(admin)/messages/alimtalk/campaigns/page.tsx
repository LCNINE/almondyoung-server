import RouteGuard from '@/components/layout/route-guard';
import AlimtalkCampaignsTemplate from '@/features/messages/alimtalk/campaigns';

export default function AlimtalkCampaignsPage() {
  return (
    <RouteGuard screen="/messages/alimtalk/campaigns">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <AlimtalkCampaignsTemplate />
      </div>
    </RouteGuard>
  );
}
