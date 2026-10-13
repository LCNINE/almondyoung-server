import RouteGuard from '@/components/layout/route-guard';
import AlimtalkTemplatesTemplate from '@/features/messages/alimtalk/templates';

export default function AlimtalkTemplatesPage() {
  return (
    <RouteGuard screen="/messages/alimtalk/templates">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <AlimtalkTemplatesTemplate />
      </div>
    </RouteGuard>
  );
}
