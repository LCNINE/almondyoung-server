import { Suspense } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import RouteGuard from '@/components/layout/route-guard';
import { Spinner } from '@/components/ui/spinner';
import EventTraceDetailTemplate from '@/features/events/trace-detail/template/EventTraceDetailTemplate';

type Props = { params: Promise<{ resourceType: string; resourceId: string }> };

export default async function EventTraceDetailPage({ params }: Props) {
  const { resourceType, resourceId } = await params;

  return (
    <RouteGuard requireRole={['admin', 'master']} requiredScope={['admin:access', 'master']}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-screen">
            <Spinner size="lg" className="w-10 h-10" />
          </div>
        }
      >
        <ReactFlowProvider>
          <EventTraceDetailTemplate
            resourceType={resourceType}
            resourceId={resourceId}
          />
        </ReactFlowProvider>
      </Suspense>
    </RouteGuard>
  );
}
