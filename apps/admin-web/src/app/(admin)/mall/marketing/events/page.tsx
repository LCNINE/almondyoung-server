import RouteGuard from '@/components/layout/route-guard';
import MarketingEventsTemplate from '@/features/mall/marketing/events/template/marketing-events-template';

export default function MarketingEventsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <MarketingEventsTemplate />
      </div>
    </RouteGuard>
  );
}
