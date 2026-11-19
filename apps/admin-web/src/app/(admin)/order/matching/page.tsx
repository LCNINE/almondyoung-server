import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import { Spinner } from '@/components/ui/spinner';
import MatchingTemplate from '@/features/order/matching/template';

export default function OrderMatchingPage() {
  return (
    <RouteGuard screen="/order/matching">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense
          fallback={
            <div className="flex h-screen items-center justify-center">
              <Spinner size="lg" className="h-10 w-10" />
            </div>
          }
        >
          <MatchingTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
