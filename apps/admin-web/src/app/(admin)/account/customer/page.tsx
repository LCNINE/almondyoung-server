import RouteGuard from '@/components/layout/route-guard';
import CustomerListTemplate from '@/features/customers/template';

/**
 * user-service 고객 목록 페이지입니다.
 * medusa-customer이랑 헷갈리시지 않도록 주의해주세요.
 */
export default function CustomerPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <CustomerListTemplate />
      </div>
    </RouteGuard>
  );
}
