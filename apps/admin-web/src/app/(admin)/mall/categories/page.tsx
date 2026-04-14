import RouteGuard from '@/components/layout/route-guard';
import CategoryListTemplate from '@/features/categories/template';

export default function CategoriesPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <CategoryListTemplate />
      </div>
    </RouteGuard>
  );
}

