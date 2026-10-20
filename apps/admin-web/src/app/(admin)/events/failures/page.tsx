import RouteGuard from '@/components/layout/route-guard';
import EventFailuresTemplate from '@/features/events/failures/template';

export default function EventFailuresPage() {
  return (
    <RouteGuard screen="/events/failures">
      <EventFailuresTemplate />
    </RouteGuard>
  );
}
