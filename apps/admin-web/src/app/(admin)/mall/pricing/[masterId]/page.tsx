import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import PricingDetailTemplate from '@/features/mall/pricing-detail/template';

interface Props {
  params: Promise<{ masterId: string }>;
}

export default async function PricingDetailPage({ params }: Props) {
  const { masterId } = await params;

  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <PricingDetailTemplate masterId={masterId} />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
