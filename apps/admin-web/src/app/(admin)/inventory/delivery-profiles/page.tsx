import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import DeliveryProfilesTemplate from '@/features/inventory/delivery-profiles/template';

export default function Page() {
  return (
    <RouteGuard screen="/inventory/delivery-profiles">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <DeliveryProfilesTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
