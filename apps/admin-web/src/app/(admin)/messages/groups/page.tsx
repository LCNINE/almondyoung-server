import RouteGuard from '@/components/layout/route-guard';
import SmsRecipientGroupsTemplate from '@/features/messages/groups/template';

export default function SmsRecipientGroupsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SmsRecipientGroupsTemplate />
      </div>
    </RouteGuard>
  );
}
