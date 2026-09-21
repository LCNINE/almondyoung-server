import RouteGuard from '@/components/layout/route-guard';
import SmsTemplatesTemplate from '@/features/messages/templates/template';

export default function SmsTemplatesPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SmsTemplatesTemplate />
      </div>
    </RouteGuard>
  );
}
