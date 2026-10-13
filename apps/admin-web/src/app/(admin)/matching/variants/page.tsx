import RouteGuard from '@/components/layout/route-guard';
import VariantsMatchingTemplate from '@/features/matching/variants/template';

export default function VariantsMatchingPage() {
  return (
    <RouteGuard screen="/matching/variants">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <VariantsMatchingTemplate />
      </div>
    </RouteGuard>
  );
}
