import RouteGuard from '@/components/layout/route-guard';
import BlacklistListTemplate from '@/features/blacklists/template';

export default function BlacklistPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <BlacklistListTemplate />
      </div>
    </RouteGuard>
  );
}
