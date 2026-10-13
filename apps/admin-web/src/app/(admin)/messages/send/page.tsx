import RouteGuard from '@/components/layout/route-guard';
import SmsSendTemplate from '@/features/messages/send/template';

export default function SmsSendPage() {
  return (
    <RouteGuard screen="/messages/send">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SmsSendTemplate />
      </div>
    </RouteGuard>
  );
}
