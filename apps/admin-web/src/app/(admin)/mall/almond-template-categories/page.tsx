import RouteGuard from '@/components/layout/route-guard';
import AlmondTemplateCategoriesTemplate from '@/features/mall/almond-template-categories/template';

export default function AlmondTemplateCategoriesPage() {
  return (
    <RouteGuard screen="/mall/almond-template-categories">
      <div className="flex w-full max-w-[1200px] flex-col gap-y-2 p-3">
        <AlmondTemplateCategoriesTemplate />
      </div>
    </RouteGuard>
  );
}
