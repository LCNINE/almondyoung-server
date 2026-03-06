import RouteGuard from '@/components/layout/route-guard';
import { Spinner } from '@/components/ui/spinner';
import EventTraceTemplate from '@/features/events/trace/template/EventTraceTemplate';
import { Suspense } from 'react';

export default function EventTracePage() {
  return (
    <RouteGuard requireRole={['admin', 'master']} requiredScope={['admin:access', 'master']}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-screen">
            <Spinner size="lg" className="w-10 h-10" />
          </div>
        }
      >
        <EventTraceTemplate />
      </Suspense>
    </RouteGuard>
  );
}
