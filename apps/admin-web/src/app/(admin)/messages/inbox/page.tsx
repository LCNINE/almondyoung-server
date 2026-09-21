import RouteGuard from '@/components/layout/route-guard';
import SmsInboxTemplate from '@/features/messages/inbox/template';

export default function SmsInboxPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SmsInboxTemplate />
      </div>
    </RouteGuard>
  );
}
