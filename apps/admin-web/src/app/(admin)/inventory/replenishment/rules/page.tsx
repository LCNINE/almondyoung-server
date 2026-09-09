import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import ReplenishmentRulesTemplate from '@/features/inventory/replenishment/rules/template';

export default function InventoryReplenishmentRulesPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <ReplenishmentRulesTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
