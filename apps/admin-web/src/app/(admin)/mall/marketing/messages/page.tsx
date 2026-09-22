import RouteGuard from '@/components/layout/route-guard';
import NotificationSettingsTemplate from '@/features/messages/notifications/template';

export default function NotificationSettingsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <NotificationSettingsTemplate />
      </div>
    </RouteGuard>
  );
}
