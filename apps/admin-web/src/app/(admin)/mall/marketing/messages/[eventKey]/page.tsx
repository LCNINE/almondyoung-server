import RouteGuard from '@/components/layout/route-guard';
import NotificationDetailTemplate from '@/features/messages/notifications/template/detail';

export default async function NotificationDetailPage({ params }: { params: Promise<{ eventKey: string }> }) {
  const { eventKey } = await params;
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <NotificationDetailTemplate eventKey={eventKey} />
      </div>
    </RouteGuard>
  );
}
