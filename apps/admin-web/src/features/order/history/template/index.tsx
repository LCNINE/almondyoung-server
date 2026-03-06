// src/features/order/history/template/index.tsx
'use client';

import { usePermission } from '@/hooks/use-permission';
import FilterBox from '../components/filter-box';
import OrderTable from '../components/table';
import { OrderHistoryFilterProvider } from '../contexts/filter.context';

export default function OrderHistoryTemplate() {
  const { hasScope } = usePermission();

  

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-xl font-semibold">주문 내역</h1>
      <p className="text-sm text-gray-600">
        모든 주문 내역을 확인하고, 이 페이지에서 주문 확정 및 출고지시까지
        처리할 수 있습니다.
      </p>

      <OrderHistoryFilterProvider>
        <FilterBox />
        <OrderTable />
      </OrderHistoryFilterProvider>

      <section className="text-xs text-gray-500">
        <h2 className="font-medium text-gray-700 mb-1">중요 노티스</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            출고지시 시 피킹리스트 생성은 자동화 대상입니다. (상품 수 1개인
            주문은 단일 피킹리스트로 묶는 등)
          </li>
          <li>
            양쪽 랙 동선 최적화, 3PL 주문은 별도 처리 가능하도록 설계되어야
            합니다.
          </li>
          <li>
            직배송 선택 시, 자동으로 부분출고로 분리된 직배송 상품을 별도
            조회합니다.
          </li>
        </ul>
      </section>
    </div>
  );
}
