import { Warehouse as WarehouseIcon, Check } from 'lucide-react';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { cn } from '../../core/design/cn';
import { useWarehouses } from './useWarehouses';

/** 창고 선택 목록. /settings 와 "창고 미설정" 인라인 카드가 공유한다. */
export function WarehousePicker({ onPicked }: { onPicked?: () => void }) {
  const { warehouseId, setWarehouse } = useWarehouse();
  const { data, isLoading, isError, error } = useWarehouses();

  if (isError) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {errorMessage(error)}
      </p>
    );
  }
  if (isLoading) return <p className="text-sm text-gray-500">불러오는 중…</p>;

  const warehouses = data ?? [];
  if (warehouses.length === 0) {
    return <p className="text-sm text-gray-500">등록된 창고가 없어요.</p>;
  }

  return (
    <ul className="space-y-2">
      {warehouses.map((w) => {
        const active = w.id === warehouseId;
        return (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => {
                setWarehouse({ id: w.id, name: w.name });
                onPicked?.();
              }}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border p-4 text-left active:bg-gray-50',
                active
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white'
              )}
            >
              <WarehouseIcon
                className="h-5 w-5 shrink-0 text-blue-600"
                aria-hidden
              />
              <span className="flex-1">
                <span className="block font-semibold text-gray-800">
                  {w.name}
                </span>
                {w.location ? (
                  <span className="block text-xs text-gray-500">
                    {w.location}
                  </span>
                ) : null}
              </span>
              {active ? (
                <Check className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
