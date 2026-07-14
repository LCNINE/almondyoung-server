import RouteGuard from '@/components/layout/route-guard';
import { SessionList } from '@/features/mall/product-imports/session-list';

export default function ProductImportsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SessionList />
      </div>
    </RouteGuard>
  );
}
