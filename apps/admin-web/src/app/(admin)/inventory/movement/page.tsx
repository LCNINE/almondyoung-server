import RouteGuard from '@/components/layout/route-guard';
import MovementTemplate from '@/features/inventory/movement/template';

export default function MovementPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <MovementTemplate />
      </div>
    </RouteGuard>
  );
}
