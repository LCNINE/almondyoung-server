import { Link } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { usePendingPlans } from './queries';

function formatDate(iso: string | null): string {
  if (!iso) return '예정일 미정';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '예정일 미정';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function PendingPlanListScreen() {
  const { warehouseId, isSet } = useWarehouse();
  const plans = usePendingPlans(warehouseId);

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="입고" backTo="/" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  // 서버는 전량 입고돼도 plan.status 를 닫지 않아서 잔여 항목이 없는 예정이
  // 계속 내려온다. 현장에는 할 일이 없는 카드라 감춘다.
  const open = (plans.data?.pendingPlans ?? []).filter((p) => p.items.length > 0);

  return (
    <div className="space-y-4">
      <ScreenHeader title="입고" backTo="/" />

      <Link
        to="/inbound/quick"
        className="block rounded-lg border border-blue-300 bg-blue-50 p-3 text-center text-sm font-semibold text-blue-700"
      >
        간편입고
      </Link>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">입고 예정</h2>
        {plans.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(plans.error, 'inbound')}
          </p>
        ) : plans.isLoading ? (
          <p className="text-sm text-gray-500">불러오는 중…</p>
        ) : open.length === 0 ? (
          <p className="text-sm text-gray-500">입고 예정이 없어요. 간편입고로 진행해 주세요.</p>
        ) : (
          <ul className="space-y-2">
            {open.map((plan) => (
              <li key={plan.planId}>
                <Link
                  to="/inbound/plans/$planId"
                  params={{ planId: plan.planId }}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 active:bg-gray-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-gray-800">
                      {plan.purchaseOrder.supplier?.name ?? '발주처 미상'}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {formatDate(plan.expectedDate)} · {plan.items.length}품목
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                    잔여 {plan.totalPendingQuantity}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
