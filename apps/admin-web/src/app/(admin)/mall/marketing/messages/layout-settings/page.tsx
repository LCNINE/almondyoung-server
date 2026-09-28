import RouteGuard from '@/components/layout/route-guard';
import EmailLayoutSettingsTemplate from '@/features/messages/notifications/template/layout-settings';

export default function EmailLayoutSettingsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <EmailLayoutSettingsTemplate />
      </div>
    </RouteGuard>
  );
}
