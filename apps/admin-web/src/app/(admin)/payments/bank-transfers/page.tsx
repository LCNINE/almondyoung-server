import RouteGuard from '@/components/layout/route-guard';
import BankTransferListTemplate from '@/features/payments/template/bank-transfer-list-template';

export default function BankTransfersPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <BankTransferListTemplate />
      </div>
    </RouteGuard>
  );
}
