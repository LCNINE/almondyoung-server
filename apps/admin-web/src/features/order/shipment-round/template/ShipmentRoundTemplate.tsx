/** @format */
'use client';

import { Pagination } from '@/components/common';
import ShipmentRoundForm from '../components/shipment-round-form';
import OrderShipmentRoundTable from '../components/shipment-round-table';

// 송장 출력 / 출고 회차별 조회 톔플릿
export default function ShipmentRoundTemplate() {
  return (
    <div>
      <ShipmentRoundForm />

      <OrderShipmentRoundTable />

      <Pagination
        currentPage={1}
        totalPages={1}
        totalItems={1}
        itemsPerPage={1}
        onPageChange={() => {}}
      />
    </div>
  );
}
