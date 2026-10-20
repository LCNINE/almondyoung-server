import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import SkuFieldCaptureProgressTemplate from '@/features/inventory/sku-field-capture/progress-template';

export default function Page() {
  return (
    <RouteGuard screen="/inventory/sku-field-capture">
      <Suspense>
        <SkuFieldCaptureProgressTemplate />
      </Suspense>
    </RouteGuard>
  );
}
