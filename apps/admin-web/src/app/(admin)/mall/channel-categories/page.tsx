import RouteGuard from '@/components/layout/route-guard';
import ChannelCategoriesTemplate from '@/features/mall/channel-categories/template';

export default function ChannelCategoriesPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ChannelCategoriesTemplate />
      </div>
    </RouteGuard>
  );
}
