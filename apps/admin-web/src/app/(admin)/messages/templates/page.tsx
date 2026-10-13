import RouteGuard from '@/components/layout/route-guard';
import SmsTemplatesTemplate from '@/features/messages/templates/template';

export default function SmsTemplatesPage() {
  return (
    <RouteGuard screen="/messages/templates">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SmsTemplatesTemplate />
      </div>
    </RouteGuard>
  );
}
