import RouteGuard from '@/components/layout/route-guard';
import MyDraftsTemplate from '@/features/mall/my-drafts/template';

export default function MyDraftsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <MyDraftsTemplate />
      </div>
    </RouteGuard>
  );
}
