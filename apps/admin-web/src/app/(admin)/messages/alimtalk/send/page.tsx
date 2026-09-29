import RouteGuard from '@/components/layout/route-guard';
import AlimtalkSendTemplate from '@/features/messages/alimtalk/send';

export default function AlimtalkSendPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <AlimtalkSendTemplate />
      </div>
    </RouteGuard>
  );
}
