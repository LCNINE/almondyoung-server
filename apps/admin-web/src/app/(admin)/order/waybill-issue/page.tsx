/** @format */

import RouteGuard from '@/components/layout/route-guard';
import WaybillIssueTemplate from '@/features/order/waybill-issue/template/WaybillIssueTemplate';

// 운송장 일괄 발급 페이지
export default function OrderWaybillIssuePage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <WaybillIssueTemplate />
    </RouteGuard>
  );
}
