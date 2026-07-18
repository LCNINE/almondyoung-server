import RouteGuard from '@/components/layout/route-guard';
import { RefundRequestsContent } from './refund-requests-content';

export default function RefundRequestsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <RefundRequestsContent />
      </div>
    </RouteGuard>
  );
}
