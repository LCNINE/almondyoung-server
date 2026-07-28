'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useWarehouses } from '@/lib/services/inventory';
import type { WarehouseDto } from '@/lib/types/dto/inventory';
import { methodsForStrategies, PICKING_METHOD_LABELS } from '@/lib/utils/picking-method';
import { PickingMethodDialog } from '../picking-method-dialog';

const WAREHOUSE_TYPE_LABELS: Record<WarehouseDto['type'], string> = {
  domestic: '국내',
  overseas: '해외',
  bonded: '보세',
  return: '반품',
};

export function WarehousesTable() {
  const { data: warehouses = [], isLoading } = useWarehouses();
  const [editRow, setEditRow] = useState<WarehouseDto | null>(null);

  return (
    <div className="px-4 py-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이름</TableHead>
            <TableHead>타입</TableHead>
            <TableHead>위치</TableHead>
            <TableHead>피킹 방식</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={5}>불러오는 중...</TableCell>
            </TableRow>
          )}
          {!isLoading && warehouses.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>등록된 창고가 없습니다.</TableCell>
            </TableRow>
          )}
          {warehouses.map((warehouse) => {
            const methods = methodsForStrategies(warehouse.supportedPickingStrategies ?? []);
            return (
              <TableRow key={warehouse.id}>
                <TableCell className="font-medium">{warehouse.name}</TableCell>
                <TableCell>{WAREHOUSE_TYPE_LABELS[warehouse.type] ?? warehouse.type}</TableCell>
                <TableCell>{warehouse.location || '-'}</TableCell>
                <TableCell>
                  {methods.length === 0 ? (
                    // 빈 값은 유효한 저장이면서 동시에 출고 정지를 뜻한다 — 화면에서 보여야 한다.
                    <span className="text-destructive">⚠ 설정 없음 — 출고 배치 생성 불가</span>
                  ) : (
                    methods.map((method) => PICKING_METHOD_LABELS[method]).join(', ')
                  )}
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setEditRow(warehouse)}>
                    편집
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <PickingMethodDialog
        open={!!editRow}
        onOpenChange={(open) => {
          if (!open) setEditRow(null);
        }}
        warehouse={editRow}
      />
    </div>
  );
}
