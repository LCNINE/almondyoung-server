import RouteGuard from '@/components/layout/route-guard';
import RegionalInvoiceTemplate from '@/features/order/regional-invoice/template/RegionalInvoiceTemplate';

// (자체배송) 지역별 출고 페이지
export default function OrderRegionalInvoicePage() {
  return (
    <RouteGuard
      requireRole={['admin', 'master']}
    >
      <RegionalInvoiceTemplate />
    </RouteGuard>
  );
}
