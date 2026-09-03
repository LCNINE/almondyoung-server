import RouteGuard from '@/components/layout/route-guard';
import { ArchiveTemplate } from '@/features/archive/template';

export default function ArchiveHomePage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <ArchiveTemplate />
    </RouteGuard>
  );
}
