import RouteGuard from '@/components/layout/route-guard';
import LegacyIgnoredMatchingTemplate from '@/features/matching/legacy-ignored/template';

export default function LegacyIgnoredMatchingPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <LegacyIgnoredMatchingTemplate />
      </div>
    </RouteGuard>
  );
}
