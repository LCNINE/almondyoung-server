import RouteGuard from '@/components/layout/route-guard';
import ReturnExchangeTemplate from '@/features/cs/return-exchange/template';

export default function ReturnExchangePage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ReturnExchangeTemplate />
      </div>
    </RouteGuard>
  );
}
