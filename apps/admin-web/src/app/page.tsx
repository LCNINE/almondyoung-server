import RouteGuard from '@/components/layout/route-guard';
import MainTemplate from '@/features/main/template/MainTemplate';

export default function HomePage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <MainTemplate />
    </RouteGuard>
  );
}
